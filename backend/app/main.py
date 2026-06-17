"""
SemanticIntelligence – FastAPI application entry point.
"""

import base64
import hashlib
import hmac
import json
import math as _math
import sqlite3 as _sqlite3
import logging
import os
import re
import threading
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Callable, Literal

from dotenv import load_dotenv
from fastapi import (
    Depends,
    FastAPI,
    Form,
    HTTPException,
    Path as _ApiPath,
    Query,
    Request,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field, field_validator, model_validator
import jwt as _pyjwt
from jwt.exceptions import ExpiredSignatureError as _JWTExpiredSignatureError
from jwt.exceptions import InvalidTokenError as _JWTInvalidTokenError
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from .database import get_connection, get_table_counts, init_db
from .models import (
    DashboardData,
    HierarchyCreate,
    MappingUpdateRequest,
    MappingsResponse,
    MetricCreate,
    PaginatedData,
    RecentOrder,
    SegmentCreate,
)
from .agentic.executive import ActionEffect, ExecutiveAgenticLayer
from .agentic.router import build_agent_router
from .ontology.manufacturing import get_ontology
from .ontology.mapper import get_flat_mappings, get_mappings, update_mapping
from .semantic.doc_loader import DocLoader
from .semantic.template_generator import generate_templates_from_draft
from .context.router import router as context_router
from .audit.router import router as audit_router
from .audit.store import get_audit_store
from .users.router import router as users_router
from .notifications.router import router as notifications_router
from .tokens.router import router as tokens_router
from .workspace.router import router as workspace_router
from .context.store import default_store as _context_store

load_dotenv()
logger = logging.getLogger(__name__)


# ── Security config ────────────────────────────────────────────────────────────

DEFAULT_ALLOWED_ORIGIN = "http://localhost:5173"
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "30")
)
JWT_ISSUER = os.getenv("JWT_ISSUER", "semanticintelligence-api")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "semanticintelligence-clients")
AUTH_USERS_JSON_ENV = "AUTH_USERS_JSON"

# Rate limits (configurable via env so the platform can scale without a redeploy).
# Login stays strict to deter brute-force; the query endpoints are generous so
# normal bursts of questions don't trip a 429.
LOGIN_RATE_LIMIT = os.getenv("LOGIN_RATE_LIMIT", "").strip() or "10/minute"
SEMANTIC_RATE_LIMIT = os.getenv("SEMANTIC_RATE_LIMIT", "").strip() or "60/minute"
DEFAULT_SECTOR = os.getenv("DEFAULT_SECTOR", "manufacturing")


def _real_ip(request: Request) -> str:
    """Extract the real client IP, honouring reverse-proxy forwarding headers."""
    return (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or get_remote_address(request)
    )


def _login_limit_key(request: Request) -> str:
    return f"ip:{_real_ip(request)}"


def _semantic_limit_key(request: Request) -> str:
    # Prefer token fingerprint as user key; fallback to real client IP.
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        token_fingerprint = hashlib.sha256(auth.encode("utf-8")).hexdigest()[:20]
        return f"token:{token_fingerprint}"
    return f"ip:{_real_ip(request)}"


def _rate_limit_storage_uri() -> str | None:
    """Resolve the shared bucket-storage URI; None means "use in-process".

    Without a shared store, slowapi keeps per-IP/per-token request counts in
    an in-process MemoryStorage: each worker enforces its *own* copy, so a
    client effectively gets LOGIN_RATE_LIMIT/SEMANTIC_RATE_LIMIT *per worker*
    — silently multiplying the configured ceiling by the worker count (the
    very thing rate limiting exists to prevent). Reuses SEMANTIC_REDIS_URL
    when no dedicated URI is given, since deployments typically run a single
    shared Redis for both purposes.
    """
    return (
        os.getenv("RATE_LIMIT_STORAGE_URI", "").strip()
        or os.getenv("SEMANTIC_REDIS_URL", "").strip()
        or None
    )


def _build_rate_limiter() -> Limiter:
    """Construct the limiter, preferring shared Redis-backed bucket storage.

    A bad storage URI must degrade gracefully (log + fall back to in-process
    buckets) rather than crash the app at import time — `Limiter.__init__`
    builds the storage backend eagerly (`storage_from_string`), so an
    unparsable URI raises immediately. `in_memory_fallback_enabled` covers the
    complementary runtime case: if Redis becomes unreachable after startup,
    slowapi switches to per-process limiting instead of raising 5xxs on every
    rate-limited request, and probes for recovery automatically.
    """
    storage_uri = _rate_limit_storage_uri()
    if storage_uri:
        try:
            return Limiter(
                key_func=get_remote_address,
                storage_uri=storage_uri,
                in_memory_fallback_enabled=True,
            )
        except Exception as exc:
            logger.warning(
                "Rate limit shared storage unusable (%s); falling back to "
                "in-process limiting (buckets won't be shared across workers)",
                exc,
            )
    return Limiter(key_func=get_remote_address, in_memory_fallback_enabled=True)


limiter = _build_rate_limiter()

_semantic_redis_client: Any = None
_semantic_redis_client_initialized = False
_semantic_redis_lock = threading.Lock()
_semantic_cache_namespace = 0
_semantic_ns_lock = threading.Lock()
# Shared invalidation generation, kept in Redis so every worker process agrees
# on it — see _semantic_cache_namespace_value()/_bump_semantic_cache_namespace().
_SEMANTIC_CACHE_NS_REDIS_KEY = "semantic:ask:ns"
_IN_PROCESS_CACHE_MAX = 256
# LRU: hits move the entry to the back, eviction pops from the front — a hot
# query stays cached under sustained load instead of being evicted FIFO-style.
_in_process_cache: OrderedDict[str, str] = OrderedDict()
_in_process_cache_lock = threading.Lock()


def _rate_limit_handler(_: Request, __: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "error": "RATE_LIMIT_EXCEEDED",
            "message": "Troppe richieste. Riprova tra poco.",
        },
    )


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip().strip("\"'")
    if not raw:
        return []  # empty → allow_origins=["*"] branch below
    return [o.strip().strip("\"'") for o in raw.split(",") if o.strip()]


def _semantic_cache_ttl_seconds() -> int:
    raw = os.getenv("SEMANTIC_REDIS_TTL_SECONDS", "120").strip()
    try:
        ttl = int(raw)
    except ValueError:
        ttl = 120
    return max(1, ttl)


def _get_semantic_redis_client() -> Any:
    global _semantic_redis_client_initialized, _semantic_redis_client

    if _semantic_redis_client_initialized:
        return _semantic_redis_client

    with _semantic_redis_lock:
        if _semantic_redis_client_initialized:
            return _semantic_redis_client

        url = os.getenv("SEMANTIC_REDIS_URL", "").strip()
        if not url:
            _semantic_redis_client_initialized = True
            _semantic_redis_client = None
            return None

        try:
            import redis

            client = redis.Redis.from_url(url, decode_responses=True)
            client.ping()
            _semantic_redis_client = client
        except Exception as exc:
            logger.warning("Redis cache disabled: %s", exc)
            _semantic_redis_client = None

        _semantic_redis_client_initialized = True
        return _semantic_redis_client


def _safe_json(raw: str | None, default: Any) -> Any:
    """Parse JSON stored in the DB; return default on corrupt/missing data."""
    try:
        return json.loads(raw) if raw else default
    except json.JSONDecodeError:
        return default


def _semantic_cache_namespace_value(redis_client: Any) -> int:
    """Return the cache-invalidation generation to key lookups off of.

    With SEMANTIC_REDIS_URL configured, the cache is *shared* across worker
    processes/instances, but the plain ``_semantic_cache_namespace`` int is
    process-local. Bumping only the local copy (as the worker that handles a
    write-back/sync would) leaves every *other* worker still computing
    ``v{old_ns}:...`` keys — so they keep reading (and re-writing) pre-mutation
    answers out of the shared cache for up to SEMANTIC_REDIS_TTL_SECONDS,
    serving stale results even though that worker "invalidated" the cache.
    Reading the generation from Redis (incremented atomically by the same
    bump) keeps every worker in agreement. Falls back to the process-local
    counter when Redis is unavailable, which matches the in-process-cache path
    (also process-local, so the two stay consistent with each other).
    """
    if redis_client is not None:
        try:
            raw = redis_client.get(_SEMANTIC_CACHE_NS_REDIS_KEY)
            if raw is not None:
                return int(raw)
        except Exception:
            pass
    return _semantic_cache_namespace


def _semantic_cache_key(
    question: str,
    context: dict[str, Any],
    redis_client: Any = None,
    mode: str = "demo",
) -> str:
    payload = json.dumps(
        {"q": question.strip(), "ctx": context, "mode": mode},
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    ns = _semantic_cache_namespace_value(redis_client)
    return f"semantic:ask:v{ns}:{digest}"


def _bump_semantic_cache_namespace() -> None:
    global _semantic_cache_namespace
    redis_client = _get_semantic_redis_client()
    if redis_client is not None:
        try:
            redis_client.incr(_SEMANTIC_CACHE_NS_REDIS_KEY)
        except Exception as exc:
            logger.warning("semantic cache namespace bump (redis) failed: %s", exc)
    with _semantic_ns_lock:
        _semantic_cache_namespace += 1
    with _in_process_cache_lock:
        _in_process_cache.clear()


def _get_jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET_KEY", "")
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT_SECRET_KEY is not configured",
        )
    return secret


def _jwt_encode(payload: dict[str, Any], secret: str) -> str:
    return _pyjwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def _jwt_decode(token: str, secret: str) -> dict[str, Any]:
    try:
        return _pyjwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
        )
    except _JWTExpiredSignatureError as exc:
        raise ValueError("Token expired") from exc
    except _JWTInvalidTokenError as exc:
        raise ValueError("Invalid token") from exc


_MAX_PASSWORD_BYTES = 4096  # fast-reject oversized inputs before PBKDF2


def _verify_password(password: str, stored_hash: str) -> bool:
    """Verify passwords stored as pbkdf2_sha256$iterations$salt$hash."""
    if len(password.encode("utf-8")) > _MAX_PASSWORD_BYTES:
        return False
    try:
        scheme, iters_raw, salt, expected = stored_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iters_raw)
        if iterations < 1 or iterations > 1_000_000:
            return False
    except (TypeError, ValueError):
        return False

    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    )
    candidate_b64 = base64.b64encode(candidate).decode("ascii")
    return hmac.compare_digest(candidate_b64, expected)


def _load_auth_users() -> dict[str, dict[str, Any]]:
    """Load users from AUTH_USERS_JSON env. No credentials are hardcoded in code."""
    raw = os.getenv(AUTH_USERS_JSON_ENV, "")
    if not raw:
        return {}
    try:
        users = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("%s contains invalid JSON", AUTH_USERS_JSON_ENV)
        return {}

    if not isinstance(users, list):
        logger.error("%s must be a JSON array", AUTH_USERS_JSON_ENV)
        return {}

    allowed_roles = {"admin", "user"}
    result: dict[str, dict[str, Any]] = {}
    for entry in users:
        if not isinstance(entry, dict):
            continue
        username = str(entry.get("username", "")).strip()
        password_hash = str(entry.get("password_hash", "")).strip()
        role = str(entry.get("role", "user")).strip().lower()
        disabled = bool(entry.get("disabled", False))

        if not username or not password_hash or role not in allowed_roles:
            continue
        result[username] = {
            "username": username,
            "password_hash": password_hash,
            "role": role,
            "disabled": disabled,
        }
    return result


def _authenticate_user(username: str, password: str) -> dict[str, Any] | None:
    users = _load_auth_users()
    user = users.get(username)
    if not user or user.get("disabled"):
        return None
    if not _verify_password(password, user["password_hash"]):
        return None
    return user


def _create_access_token(
    subject: str, role: Literal["admin", "user"], mode: Literal["demo", "live"] = "demo"
) -> tuple[str, int]:
    secret = _get_jwt_secret()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "mode": mode,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
    }
    if JWT_ACCESS_TOKEN_EXPIRE_MINUTES > 0:
        expire_at = now + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        payload["exp"] = int(expire_at.timestamp())
        expires_in = int((expire_at - now).total_seconds())
    else:
        expires_in = -1  # no expiry
    token = _jwt_encode(payload, secret)
    return token, expires_in


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    role: Literal["admin", "user"]
    mode: Literal["demo", "live"] = "demo"


class UserPrincipal(BaseModel):
    username: str
    role: Literal["admin", "user"]
    mode: Literal["demo", "live"] = "demo"


def get_current_user(token: str = Depends(oauth2_scheme)) -> UserPrincipal:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    secret = _get_jwt_secret()
    try:
        payload = _jwt_decode(token, secret)
    except ValueError:
        raise credentials_exc

    subject = payload.get("sub")
    role = payload.get("role")
    if not isinstance(subject, str) or role not in {"admin", "user"}:
        raise credentials_exc

    # Re-check disabled flag — a valid token for a now-disabled account must be rejected.
    users = _load_auth_users()
    live_user = users.get(subject)
    if not live_user or live_user.get("disabled"):
        raise credentials_exc

    raw_mode = payload.get("mode", "demo")
    resolved_mode: Literal["demo", "live"] = "live" if raw_mode == "live" else "demo"
    return UserPrincipal(username=subject, role=role, mode=resolved_mode)


def require_roles(*roles: Literal["admin", "user"]) -> Callable[..., UserPrincipal]:
    allowed = set(roles)

    def _checker(
        current_user: UserPrincipal = Depends(get_current_user),
    ) -> UserPrincipal:
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role privileges",
            )
        return current_user

    return _checker


# ── Semantic Layer global state (lazy-initialised on first /api/semantic/* call) ──

_semantic_state: dict[str, Any] = {
    "loaded": False,
    "layer": None,
    "ontology": None,
    "kg": None,
    "catalog": None,
    "erp": None,
    "crm": None,
    "hr_pim": None,
}
_semantic_init_lock = threading.RLock()

_SCENARIO_PATH = Path(__file__).parent.parent.parent / "test_scenario"


def _ensure_semantic_loaded() -> None:
    """Lazily build semantic stack exactly once (thread-safe).

    Double-checked locking keeps the fast path lock-free after initialization.
    """
    if _semantic_state["loaded"]:
        return

    with _semantic_init_lock:
        if _semantic_state["loaded"]:
            return

        from .connectors.duckdb_source_manager import (
            get_source_manager,
            ERPDuckDBAdapter,
            CRMDuckDBAdapter,
            HRPIMDuckDBAdapter,
        )
        from .ontology.ontology import Ontology
        from .kg.graph import KnowledgeGraph
        from .metadata.catalog import MetadataCatalog
        from .semantic.layer import SemanticLayer
        from .context.manager import ContextManager

        # All four sources share the same DuckDB snapshot — built once, zero extra RAM
        _mgr = get_source_manager(_SCENARIO_PATH)
        erp = ERPDuckDBAdapter(_mgr)
        crm = CRMDuckDBAdapter(_mgr)
        hr_pim = HRPIMDuckDBAdapter(_mgr)

        ontology_path = _SCENARIO_PATH / "ontology_example.yaml"
        try:
            ontology = Ontology.load(ontology_path) if ontology_path.exists() else None
        except Exception as exc:
            logger.warning(
                "Could not load ontology from %s: %s — running without ontology",
                ontology_path,
                exc,
            )
            ontology = None

        kg = KnowledgeGraph()
        if ontology is not None:
            # Schema-driven: reads entity→table mappings from the YAML, works with
            # any registered source including custom domains beyond ERP/CRM/HR/PIM.
            kg.build_from_ontology(_mgr, ontology)
        else:
            # Fallback: schema-driven, works with any registered source.
            kg.build_from_schema(_mgr)

        # Durable catalog: user-edited query templates, entity descriptions and
        # context notes must survive restarts. The in-memory default would wipe
        # them on every boot (and make SEED_SQL_MIGRATIONS pointless). Seeding
        # and populate_*() are idempotent upserts, so reopening an existing
        # file is safe.
        metadata_db_url = os.getenv("METADATA_DB_URL", "").strip() or (
            f"sqlite:///{Path(__file__).parent.parent / 'data' / 'metadata.db'}"
        )
        catalog = MetadataCatalog(metadata_db_url)
        # Schema-driven discovery first — source of truth for table/column
        # structure. populate_from_manager() must run before populate() so that
        # schema-discovered entries exist before business metadata is layered on.
        # Running populate() first would create phantom entities for tables not
        # yet in DuckDB, which corrupt the LLM SQL schema context.
        catalog.populate_from_manager(_mgr)
        catalog.populate([erp, crm, hr_pim], ontology, kg, mgr=_mgr)
        # Remove entities created by populate() whose tables aren't in the actual
        # DuckDB snapshot — prevents them from appearing in the LLM schema context.
        try:
            _known = frozenset(_mgr.get_schema_info().keys())
            catalog.prune_phantom_entities(_known)
        except Exception as _prune_exc:
            logger.warning("catalog prune skipped: %s", _prune_exc)

        ctx_mgr = ContextManager()
        _DOCS_PATH = (
            Path(__file__).parent.parent.parent / "test_scenario" / "semantic_docs"
        )
        _semantic_docs = DocLoader(_DOCS_PATH).load() if _DOCS_PATH.exists() else None
        layer = SemanticLayer(ontology, kg, catalog, ctx_mgr, docs=_semantic_docs)
        layer.set_connectors(erp, crm, hr_pim)
        layer.set_manager(_mgr)  # enables schema-driven LLM SQL for unknown intents

        _semantic_state.update(
            {
                "loaded": True,
                "layer": layer,
                "base_docs": _semantic_docs,
                "ontology": ontology,
                "kg": kg,
                "catalog": catalog,
                "mgr": _mgr,
                "erp": erp,
                "crm": crm,
                "hr_pim": hr_pim,
            }
        )
        # Seed golden query templates on first install (never overwrites existing,
        # but upgrades rows still holding a superseded seed SQL verbatim)
        from app.semantic.seed_templates import SEED_SQL_MIGRATIONS, SEED_TEMPLATES

        n = catalog.seed_default_templates(SEED_TEMPLATES, SEED_SQL_MIGRATIONS)
        if n:
            logger.info("Seeded %d default query templates", n)
        # Seed default glossary terms as context docs on first install
        from app.semantic.glossary import DEFAULT_GLOSSARY

        n = catalog.seed_glossary_docs(DEFAULT_GLOSSARY)
        if n:
            logger.info("Seeded %d glossary terms as context docs", n)
        # Apply semantic annotations (name, description, field docs) from YAML config
        annotations = catalog._load_entity_annotations()
        n = catalog.seed_entity_annotations(annotations)
        if n:
            logger.info("Applied semantic annotations to %d entities", n)
        # Load user-defined query templates into the semantic layer
        layer.set_templates(catalog.list_templates())
        # Inject any registered context documents into the LLM prompt
        _sync_context_docs_to_layer()


def _refresh_catalog_and_kg_after_rebuild(mgr) -> None:
    """Refresh the catalog AND the Knowledge Graph after a snapshot rebuild.

    Called after mgr.rebuild() / mgr.ingest_one() (source sync, add/remove, or
    full re-ingest) so that schema *and data* changes are immediately reflected
    in schema-driven LLM SQL generation (catalog) and in KG-derived views —
    the semantic draft's relations, /api/semantic/status's node/edge counts,
    and the executive agentic layer's graph patches. Without this, the KG
    keeps showing nodes/edges/relations from the snapshot that existed when it
    was first built, even though the underlying tables have since changed.

    No-op for either half if the semantic layer hasn't been loaded yet.
    """
    catalog = _semantic_state.get("catalog")
    if catalog is not None:
        try:
            catalog.populate_from_manager(mgr)
            # populate_from_manager only upserts — entities whose tables were
            # just removed (source disconnect) would otherwise linger forever
            # in the draft and in the LLM schema context.
            catalog.prune_phantom_entities(frozenset(mgr.get_schema_info().keys()))
        except Exception as exc:
            logger.warning("catalog refresh after rebuild failed: %s", exc)

    kg = _semantic_state.get("kg")
    if kg is not None:
        try:
            from .kg.graph import KnowledgeGraph

            # Probe schema discovery before committing to a rebuild:
            # build_from_ontology()/build_from_schema() swallow
            # get_schema_info() failures internally and degrade to an empty
            # graph instead of raising — which would otherwise let a
            # transient snapshot read error silently replace a perfectly
            # good KG with an empty one.
            mgr.get_schema_info()

            # Rebuild into a fresh instance rather than re-running the loaders
            # on the existing graph: KnowledgeGraph is backed by a
            # MultiDiGraph, whose add_edge() always appends a parallel edge —
            # looping the loaders in place would silently double (then
            # triple, ...) every edge on each successive sync.
            new_kg = KnowledgeGraph()
            ontology = _semantic_state.get("ontology")
            if ontology is not None:
                new_kg.build_from_ontology(mgr, ontology)
            else:
                new_kg.build_from_schema(mgr)
            _semantic_state["kg"] = new_kg
        except Exception as exc:
            logger.warning("KG refresh after rebuild failed: %s", exc)

    layer = _semantic_state.get("layer")
    if layer is not None:
        # catalog.populate_from_manager() above just live-mutated the very
        # same MetadataCatalog instance layer.ask() consults on every
        # question — for entity/attribute/metric resolution
        # (self._catalog.list_entities() / get_entity() / get_attribute() /
        # list_metrics()) AND for the LLM SQL-generation schema prompt
        # (self._catalog.get_schema_context(), see layer.py:1311). Once a
        # source is added, removed, or (re-)synced, the set of
        # tables/columns the catalog reports has changed, so every answer
        # cached under the old generation may cite tables/columns that no
        # longer exist (or omit ones that just appeared) until it expires
        # from the cache (or lingers indefinitely in the in-process LRU when
        # no Redis is configured). Bump + clear so the next ask() recomputes
        # against the refreshed catalog instead of serving a pre-refresh
        # answer. Gated on `layer is not None` (rather than running
        # unconditionally like the catalog/KG refresh blocks above) because
        # this function is a documented no-op before the semantic layer has
        # ever been loaded — there is no cached layer to invalidate yet, and
        # bumping would just waste a Redis round-trip on every no-op call.
        _bump_semantic_cache_namespace()
        try:
            layer.clear_semantic_cache()
        except Exception:
            pass


def _sync_context_docs_to_layer() -> None:
    """Push context_doc registry entries into the semantic layer LLM prompt."""
    layer = _semantic_state.get("layer")
    if layer is None:
        return
    from .connectors.source_registry import get_source_registry

    registry = get_source_registry()
    docs = [
        {"title": c.label, "content": c.params.get("content", "")}
        for c in registry.list()
        if c.connector_type == "context_doc"
    ]
    layer.set_context_docs(docs)


# Adventure Works demo scenario tables, by every name the codebase knows them
# under: registry target tables, the legacy file-connector aliases used by the
# semantic catalog and KG provenance, and the internal build-metadata table.
# This must be a static set (not derived from the registry) because the demo
# data also ships inside the unified DuckDB snapshot, which loads even when
# FRA_SEED_DEMO_SOURCES is off and the registry is empty.
_DEMO_SCENARIO_TABLES: frozenset[str] = frozenset(
    {
        "account",
        "contact",
        "address",
        "account_address",
        "state_province",
        "hr_employees",
        "pim_products",
        "sales_order_header",
        "sales_order_line",
        "salesperson",
        "territory",
        "offer",
        "dipendenti_hr",
        "product_catalog_pim",
        "_build_meta",
    }
)

# Schema prefixes under which the demo tables appear (unified DuckDB snapshot
# schemas plus the legacy hr_pim file-connector namespace).
_DEMO_SCHEMA_PREFIXES = ("erp", "crm", "hr", "pim", "hr_pim")


def _hidden_demo_tables(user: UserPrincipal) -> frozenset[str]:
    """Demo-source tables to hide from live-mode users.

    Live-mode users get a from-scratch experience: everything derived from the
    pre-seeded Adventure Works scenario is filtered out of the semantic read
    endpoints. Demo-mode users see everything. The set covers bare table names,
    schema-prefixed variants (``crm.account``) and registry is_default sources.

    Tables owned by a user-added (non-default) source are never hidden, even
    when their name collides with a demo table — "account", "contact" or
    "offer" are perfectly normal business table names, and hiding them would
    make the user's own uploaded data vanish.
    """
    if user.mode != "live":
        return frozenset()
    from .connectors.source_registry import get_source_registry

    tables: set[str] = set(_DEMO_SCENARIO_TABLES)
    user_tables: set[str] = set()
    for cfg in get_source_registry().list():
        if cfg.is_default:
            tables.update(cfg.target_tables)
            tables.update(f"{cfg.id}.{t}" for t in cfg.target_tables)
        else:
            owned = set(cfg.target_tables)
            table_name = (cfg.params or {}).get("table_name")
            if table_name:
                owned.add(str(table_name))
            user_tables.update(owned)
            user_tables.update(f"{cfg.id}.{t}" for t in owned)
    for prefix in _DEMO_SCHEMA_PREFIXES:
        tables.update(f"{prefix}.{t}" for t in _DEMO_SCENARIO_TABLES)
    return frozenset(tables - user_tables)


def _kg_counts_excluding(kg, hidden: frozenset[str]) -> tuple[int, int]:
    """Node/edge counts of the KG ignoring nodes sourced from hidden tables."""
    if not hidden:
        return kg.node_count, kg.edge_count
    visible: set[str] = set()
    for node_id, data in kg.all_nodes():
        prov = data.get("provenance") or []
        table = (
            prov[0].get("table", "")
            if prov and isinstance(prov[0], dict)
            else node_id.split(":")[0]
        )
        if table in hidden:
            continue
        visible.add(node_id)
    edge_count = sum(
        1 for src, dst, _ in kg.iter_edges() if src in visible and dst in visible
    )
    return len(visible), edge_count


def _get_semantic_draft(hidden: frozenset[str] = frozenset()) -> dict:
    """Return the current semantic layer state as an editable draft dict.

    *hidden* is a set of table names whose derived entities, relations and
    templates must be excluded (live-mode users hiding the demo dataset).
    """
    catalog = _semantic_state.get("catalog")
    kg = _semantic_state.get("kg")

    all_entities = catalog.get_draft_entities() if catalog else []
    entities = [e for e in all_entities if e["table"] not in hidden]
    metrics = catalog.get_draft_metrics() if catalog else []
    # Relations reference KG node-id prefixes, which can be entity names or
    # table names depending on the build path — hide both forms.
    hidden_keys = set(hidden) | {
        e["name"] for e in all_entities if e["table"] in hidden
    }
    if hidden:
        # Drop any metric whose formula references a hidden (demo) table —
        # not just when the workspace is empty, otherwise demo metrics
        # reappear as soon as the first real source is connected.
        _ref_re = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
        metrics = [
            m
            for m in metrics
            if not (set(_ref_re.findall(m.get("formula") or "")) & hidden_keys)
        ]

    relations: list[dict] = []
    if kg:
        seen: set[tuple] = set()
        for src, dst, data in kg.iter_edges():
            edge_type = data.get("type", "")
            src_table = src.split(":")[0]
            dst_table = dst.split(":")[0]
            if src_table in hidden_keys or dst_table in hidden_keys:
                continue
            key = (src_table, dst_table, edge_type)
            if key not in seen:
                seen.add(key)
                relations.append(
                    {
                        "from_table": src_table,
                        "to_table": dst_table,
                        "via_column": edge_type[3:]
                        if edge_type.startswith("FK_")
                        else "",
                        "edge_type": edge_type,
                    }
                )

    from .connectors.source_registry import get_source_registry

    registry = get_source_registry()
    context_docs = [
        {
            "id": c.id,
            "title": c.label,
            "content": c.params.get("content", ""),
            "created_at": c.connected_at,
        }
        for c in registry.list()
        if c.connector_type == "context_doc"
    ]

    templates = catalog.list_templates() if catalog else []
    if hidden:
        templates = [
            t for t in templates if not (set(t.get("sources") or []) & hidden_keys)
        ]
        if not entities:
            templates = []

    return {
        "entities": entities,
        "relations": relations,
        "metrics": metrics,
        "context_docs": context_docs,
        "templates": templates,
        "loaded": _semantic_state.get("loaded", False),
        "built_at": datetime.utcnow().isoformat(),
    }


def _hot_reload_templates() -> None:
    """Push fresh templates to the live SemanticLayer instance.

    Templates are matched against incoming questions and can deterministically
    answer them (see SemanticLayer._execute_template_query / dynamic tpl_<id>
    intents) — a create/update/delete here changes what layer.ask() returns
    for matching questions. Bump the cache namespace so a pre-edit cached
    answer doesn't keep being served (skipping the new/changed/removed
    template entirely) until it expires or gets evicted.
    """
    _ensure_semantic_loaded()
    layer = _semantic_state.get("layer")
    catalog = _semantic_state.get("catalog")
    if layer is not None and catalog is not None:
        layer.set_templates(catalog.list_templates())
    _bump_semantic_cache_namespace()
    if layer is not None:
        try:
            layer.clear_semantic_cache()
        except Exception:
            pass


def reload_semantic() -> None:
    """Force full rebuild of the semantic stack (thread-safe)."""
    with _semantic_init_lock:
        _semantic_state["loaded"] = False
    _ensure_semantic_loaded()
    _sync_context_docs_to_layer()
    # _ensure_semantic_loaded() just swapped in a brand-new SemanticLayer
    # instance (plus fresh ontology/catalog/KG/templates) — every answer
    # cached under the old generation reflects the OLD stack and must stop
    # being served immediately, not linger for up to the cache TTL (or
    # indefinitely from the in-process LRU when no Redis is configured).
    _bump_semantic_cache_namespace()
    layer = _semantic_state.get("layer")
    if layer is not None:
        try:
            layer.clear_semantic_cache()
        except Exception:
            pass


# ── Pydantic models for semantic endpoints ──────────────────────────────────


class SemanticAskRequest(BaseModel):
    question: str | None = Field(
        default=None, max_length=2000, description="Primary NL question field"
    )
    query: str | None = Field(
        default=None,
        max_length=2000,
        description="Alias for question in normalized clients",
    )
    session_id: str | None = Field(
        default=None, max_length=128, description="Optional semantic session identifier"
    )
    context: dict[str, Any] = Field(
        default_factory=dict, description="Optional normalized semantic context"
    )

    @model_validator(mode="after")
    def _validate_normalized_payload(self) -> "SemanticAskRequest":
        q = (self.question or "").strip()
        alias = (self.query or "").strip()
        if not q and not alias:
            raise ValueError("Either 'question' or 'query' must be provided")
        if len(self.context) > 32:
            raise ValueError("context dict must not exceed 32 keys")
        total_value_bytes = sum(len(str(v)) for v in self.context.values())
        if total_value_bytes > 4096:
            raise ValueError("context values must not exceed 4096 total characters")
        return self

    def normalized_question(self) -> str:
        q = (self.question or "").strip()
        if q:
            return q
        return (self.query or "").strip()


class SemanticAskResponse(BaseModel):
    answer: Any
    sql_used: str | None = None
    sources_touched: list[str] = []
    provenance: dict[str, Any] = {}
    latency_ms: float = 0.0
    disambiguation_required: bool = False
    candidates: list[str] = []
    notes: str = ""
    ambiguity_error: bool = False


class EntityDraftUpdate(BaseModel):
    user_description: str | None = Field(default=None, max_length=2000)
    context_notes: str | None = Field(default=None, max_length=2000)


class MetricDraftUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    formula: str | None = Field(default=None, max_length=500)
    label: str | None = Field(default=None, max_length=200)


class ContextDocCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20000)


class QueryTemplatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    sql_query: str = Field(min_length=10, max_length=8000)
    keywords: list[Annotated[str, Field(max_length=200)]] = Field(
        default_factory=list, max_length=50
    )
    sources: list[Annotated[str, Field(max_length=256)]] = Field(
        default_factory=list, max_length=50
    )

    @field_validator("sql_query")
    @classmethod
    def _check_tokens(cls, v: str) -> str:
        import re as _re

        allowed = {"year", "limit"}
        found = set(_re.findall(r"\{(\w+)\}", v))
        bad = found - allowed
        if bad:
            raise ValueError(
                f"Unsupported template tokens: {bad}. Only {{year}} and {{limit}} are allowed."
            )
        return v


class QueryTemplateUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    sql_query: str | None = Field(default=None, min_length=10, max_length=8000)
    keywords: list[Annotated[str, Field(max_length=200)]] | None = Field(
        default=None, max_length=50
    )
    sources: list[Annotated[str, Field(max_length=256)]] | None = Field(
        default=None, max_length=50
    )

    @field_validator("sql_query")
    @classmethod
    def _check_tokens(cls, v: str | None) -> str | None:
        if v is None:
            return v
        import re as _re

        allowed = {"year", "limit"}
        found = set(_re.findall(r"\{(\w+)\}", v))
        bad = found - allowed
        if bad:
            raise ValueError(
                f"Unsupported template tokens: {bad}. Only {{year}} and {{limit}} are allowed."
            )
        return v


class OntologyValidateRequest(BaseModel):
    ontology_path: str | None = Field(
        default=None,
        max_length=256,
        description="Optional path relative to test_scenario/ for admin validation",
    )


def _resolve_ontology_validation_path(raw: str | None) -> Path:
    if not raw:
        return _SCENARIO_PATH / "ontology_example.yaml"

    candidate = (_SCENARIO_PATH / raw).resolve()
    scenario_root = _SCENARIO_PATH.resolve()
    # Use is_relative_to to correctly handle symlinks and path traversal
    if not candidate.is_relative_to(scenario_root):
        raise HTTPException(status_code=400, detail="Invalid ontology path scope")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="Ontology file not found")
    return candidate


# ── Lifespan ───────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise DB, manufacturing ontology, and DuckDB data snapshot at startup."""
    _secret = os.getenv("JWT_SECRET_KEY", "")
    if len(_secret) < 32:
        logger.warning(
            "JWT_SECRET_KEY is %d bytes — minimum 32 bytes required for HS256 security",
            len(_secret),
        )
    init_db()
    conn = get_connection()
    try:
        onto = get_ontology()
        onto.populate_from_db(conn)
    finally:
        conn.close()

    # Warm up the DuckDB snapshot on first boot so queries are instant from the start.
    # On subsequent restarts this just opens the existing file (<100 ms).
    from .connectors.duckdb_source_manager import get_source_manager

    get_source_manager(_SCENARIO_PATH)

    # Kick off the semantic stack build in a background thread so the server
    # starts accepting traffic immediately (passes the platform health check)
    # rather than blocking in the lifespan until the KG is ready.  When the
    # first semantic request arrives it either finds the stack already loaded
    # (fast path) or waits briefly for the background thread to finish
    # (the _semantic_init_lock ensures only one build ever runs).
    def _background_warmup() -> None:
        try:
            _ensure_semantic_loaded()
        except Exception as exc:
            logger.warning("Background semantic stack warmup failed: %s", exc)

    import threading as _threading  # noqa: PLC0415

    _threading.Thread(
        target=_background_warmup, daemon=True, name="semantic-warmup"
    ).start()

    yield


# ── App factory ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="SemanticIntelligence API",
    version="0.1.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
app.add_middleware(SlowAPIMiddleware)
# Large JSON payloads (data pages, semantic drafts, templates) compress
# 5-10x; clients that don't send Accept-Encoding are unaffected.
app.add_middleware(GZipMiddleware, minimum_size=1024)

_explicit_origins = _parse_allowed_origins()
if _explicit_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_explicit_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # No ALLOWED_ORIGINS env var → open CORS for all origins.
    # Safe because all data endpoints require a JWT Bearer token.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Reject obviously oversized requests before the JSON parser buffers them.
# Protects against Content-Length bombs on endpoints without per-field caps.
_MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024  # 2 MB


@app.middleware("http")
async def _reject_oversized_requests(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl is not None:
        try:
            if int(cl) > _MAX_REQUEST_BODY_BYTES:
                return JSONResponse(
                    status_code=413, content={"detail": "Request body too large"}
                )
        except ValueError:
            pass
    return await call_next(request)


def _get_agentic_ontology() -> Any:
    _ensure_semantic_loaded()
    return _semantic_state.get("ontology")


def _agentic_kg_patcher(effect: ActionEffect) -> int:
    import networkx as nx

    kg = _semantic_state.get("kg")
    if kg is None or not effect.affected_node_ids or not effect.changed_fields:
        return 0
    patched = 0
    for node_id in effect.affected_node_ids:
        if node_id in kg._g:
            nx.set_node_attributes(kg._g, {node_id: effect.changed_fields})
            patched += 1
    return patched


def _agentic_cache_invalidator() -> int:
    _bump_semantic_cache_namespace()
    layer = _semantic_state.get("layer")
    if layer is not None:
        try:
            layer.clear_semantic_cache()
        except Exception:
            pass
    return 1


_agentic_layer = ExecutiveAgenticLayer(
    get_ontology=_get_agentic_ontology,
    get_db_connection=get_connection,
    kg_patcher=_agentic_kg_patcher,
    cache_invalidator=_agentic_cache_invalidator,
    # File-backed state so the pending-approval queue and audit trail survive
    # restarts and are shared across worker processes.
    state_db_path=Path(__file__).parent.parent / "data" / "agent_state.db",
)
app.include_router(build_agent_router(_agentic_layer, require_roles("admin")))
app.include_router(
    context_router,
    dependencies=[Depends(require_roles("user", "admin"))],
)
app.include_router(
    audit_router,
    dependencies=[Depends(require_roles("user", "admin"))],
)
app.include_router(
    users_router,
    dependencies=[Depends(require_roles("admin"))],
)
app.include_router(
    notifications_router,
    dependencies=[Depends(require_roles("admin"))],
)
app.include_router(
    tokens_router,
    dependencies=[Depends(require_roles("admin"))],
)
app.include_router(
    workspace_router,
    dependencies=[Depends(require_roles("user", "admin"))],
)


def _audit(
    request: Request | None,
    user: "UserPrincipal",
    action: str,
    resource: str = "",
    category: str = "config",
) -> None:
    """Record an audit entry for a mutating action. Never raises."""
    ip = ""
    if request is not None:
        # Prefer the real-client IP forwarded by a trusted reverse proxy (nginx
        # sets X-Real-IP; other proxies may use X-Forwarded-For instead).
        ip = (
            request.headers.get("X-Real-IP")
            or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or (request.client.host if request.client else "")
        )
    get_audit_store().log(
        username=user.username,
        action=action,
        resource=resource,
        ip=ip,
        category=category,
    )


# ── Routes ─────────────────────────────────────────────────────────────────────


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "SemanticIntelligence API"}


@app.post("/api/auth/login", response_model=TokenResponse)
@app.post("/api/auth/token", response_model=TokenResponse)
@limiter.limit(LOGIN_RATE_LIMIT, key_func=_login_limit_key)
def login_for_access_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    mode: str = Form("demo", max_length=32),
) -> TokenResponse:
    if not os.getenv(AUTH_USERS_JSON_ENV, ""):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{AUTH_USERS_JSON_ENV} is not configured",
        )

    user = _authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    resolved_mode: Literal["demo", "live"] = "live" if mode == "live" else "demo"
    token, expires_in = _create_access_token(
        subject=user["username"],
        role=user["role"],
        mode=resolved_mode,
    )
    _audit(
        request,
        UserPrincipal(username=user["username"], role=user["role"], mode=resolved_mode),
        "Logged in",
        f"mode={resolved_mode}",
        category="auth",
    )
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        role=user["role"],
        mode=resolved_mode,
    )


@app.get("/api/auth/me", tags=["auth"])
def get_me(principal: UserPrincipal = Depends(require_roles("user", "admin"))) -> dict:
    return {
        "username": principal.username,
        "role": principal.role,
        "mode": principal.mode,
    }


@app.get("/api/dashboard", response_model=DashboardData)
def dashboard(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> DashboardData:
    if current_user.mode == "live":
        from .connectors.duckdb_source_manager import get_source_manager
        from .connectors.source_registry import get_source_registry

        # Fetch real per-table row counts from DuckDB.
        try:
            mgr = get_source_manager(_SCENARIO_PATH)
            all_row_counts: dict[str, int] = mgr.describe().record_counts
        except Exception:
            all_row_counts = {}

        registry = get_source_registry()
        live_sources = [
            {
                "name": src.label,
                "type": src.connector_type,
                "status": "connected" if src.status == "active" else src.status,
                "tables": src.target_tables,
                "row_counts": {t: all_row_counts.get(t, 0) for t in src.target_tables},
            }
            for src in registry.list()
            if not src.is_default and src.connector_type != "context_doc"
        ]
        total_live_rows = sum(all_row_counts.values())
        return DashboardData(
            total_customers=0,
            total_products=0,
            total_quotes=0,
            total_orders=total_live_rows,
            quote_conversion_rate=0.0,
            open_quotes_value=0.0,
            recent_orders=[],
            data_sources=live_sources,
        )
    conn = get_connection()
    try:
        counts = get_table_counts(conn)

        total_quotes = counts["quotes"]
        total_orders = counts["orders"]
        total_customers = counts["customers"]
        total_products = counts["products"]

        accepted = conn.execute(
            "SELECT COUNT(*) FROM quotes WHERE status='accepted'"
        ).fetchone()[0]
        conversion_rate = round(
            (accepted / total_quotes * 100) if total_quotes else 0, 1
        )

        open_value = conn.execute(
            "SELECT COALESCE(SUM(total_value),0) FROM quotes WHERE status IN ('draft','sent')"
        ).fetchone()[0]

        recent_rows = conn.execute(
            """
            SELECT o.id, c.name as customer_name, o.total_value, o.status, o.date
            FROM orders o
            JOIN customers c ON c.id = o.customer_id
            ORDER BY o.date DESC
            LIMIT 5
            """
        ).fetchall()
        recent_orders = [
            RecentOrder(
                id=r["id"],
                customer_name=r["customer_name"],
                total_value=r["total_value"],
                status=r["status"],
                date=r["date"],
            )
            for r in recent_rows
        ]

        # Data source cards — built dynamically from the source registry
        from .connectors.source_registry import get_source_registry

        registry = get_source_registry()
        data_sources = []
        for src in registry.list():
            # Skip context_doc sources — they are not data tables
            if src.connector_type == "context_doc":
                continue
            # Map "active" status to "connected" for frontend compatibility
            display_status = "connected" if src.status == "active" else src.status
            # Build per-table row counts from the known legacy counts where available,
            # otherwise report 0 (the registry only stores a total row_count, not per-table)
            row_counts = {t: counts.get(t, 0) for t in src.target_tables}
            data_sources.append(
                {
                    "name": src.label,
                    "type": src.connector_type,
                    "status": display_status,
                    "tables": src.target_tables,
                    "row_counts": row_counts,
                }
            )
        # Fall back to a single default card if the registry is empty (first boot)
        if not data_sources:
            data_sources = [
                {
                    "name": "ERP",
                    "type": "sqlite",
                    "status": "connected",
                    "tables": list(counts.keys()),
                    "row_counts": dict(counts),
                }
            ]

        return DashboardData(
            total_customers=total_customers,
            total_products=total_products,
            total_quotes=total_quotes,
            total_orders=total_orders,
            quote_conversion_rate=conversion_rate,
            open_quotes_value=round(open_value, 2),
            recent_orders=recent_orders,
            data_sources=data_sources,
        )
    finally:
        conn.close()


@app.get("/api/ontology/graph")
def ontology_graph(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    if current_user.mode == "live":
        # The static ontology YAML describes the demo dataset only.
        return {"nodes": [], "edges": []}
    onto = get_ontology()
    return onto.get_ontology_graph_data()


@app.get("/api/ontology/mappings", response_model=MappingsResponse)
def ontology_mappings(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> MappingsResponse:
    if current_user.mode == "live":
        # The static mapping YAML describes the demo dataset only.
        return MappingsResponse(mappings=[], raw={})
    flat = get_flat_mappings()
    raw = get_mappings()
    return MappingsResponse(mappings=flat, raw=raw)


@app.put("/api/ontology/mappings")
def update_ontology_mapping(
    req: MappingUpdateRequest,
    _: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    _bump_semantic_cache_namespace()
    if _semantic_state.get("layer") is not None:
        try:
            _semantic_state["layer"].clear_semantic_cache()
        except Exception:
            pass
    success = update_mapping(req.table, req.field, req.ontology_path)
    if not success:
        raise HTTPException(
            status_code=404, detail="Table or field not found in mappings"
        )
    return {
        "success": True,
        "table": req.table,
        "field": req.field,
        "ontology_path": req.ontology_path,
    }


@app.post("/api/ontology/validate")
def validate_ontology_configuration(
    req: OntologyValidateRequest,
    _: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    from .ontology.ontology import Ontology, OntologyValidationError

    path = _resolve_ontology_validation_path(req.ontology_path)
    try:
        ontology = Ontology.load(path)
        return {
            "valid": True,
            "path": str(path),
            "entities": ontology.entity_names(),
            "metrics": ontology.metric_names(),
            "dimensions": ontology.dimension_names(),
        }
    except OntologyValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "ONTOLOGY_VALIDATION_ERROR",
                "message": str(exc),
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "ONTOLOGY_PARSE_ERROR",
                "message": f"Failed to parse ontology file: {exc}",
            },
        )


@app.get("/api/data/{table}", response_model=PaginatedData)
def get_table_data(
    table: Annotated[str, _ApiPath(max_length=256)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> PaginatedData:
    # Auto-discover available tables from DuckDB instead of hardcoded whitelist
    from .connectors.duckdb_source_manager import get_source_manager

    hidden = _hidden_demo_tables(current_user)
    try:
        duckdb_conn = get_source_manager(_SCENARIO_PATH).get_connection()
        try:
            duck_tables = {
                row[0] for row in duckdb_conn.execute("SHOW TABLES").fetchall()
            }
        finally:
            duckdb_conn.close()
    except Exception:
        duck_tables = set()
    # The legacy SQLite DB is entirely demo data — never expose it to
    # live-mode users.
    sqlite_tables: set[str] = set()
    if not hidden:
        try:
            _sl = get_connection()
            try:
                sqlite_tables = {
                    row[0]
                    for row in _sl.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    ).fetchall()
                }
            finally:
                _sl.close()
        except Exception:
            pass
    available = (duck_tables | sqlite_tables) - hidden
    if table not in available:
        raise HTTPException(status_code=404, detail=f"Table '{table}' not found")

    # Double-quote the identifier and escape any embedded double-quotes so that
    # table names with spaces, hyphens, or other special characters don't break
    # the SQL statement. The whitelist check above ensures the name is a real,
    # server-controlled identifier; the quoting here is belt-and-suspenders
    # defence against unusual (but valid) identifier characters.
    table_id = '"' + table.replace('"', '""') + '"'
    offset = (page - 1) * page_size

    # Live-mode users always read from the DuckDB snapshot (their own data).
    # Demo users keep reading legacy tables from SQLite, but tables that only
    # exist in DuckDB (user-added sources) must be served from DuckDB too —
    # name collisions resolve in favour of the user's data for live mode.
    use_duckdb = table in duck_tables and (bool(hidden) or table not in sqlite_tables)
    if use_duckdb:
        dconn = get_source_manager(_SCENARIO_PATH).get_connection()
        try:
            total = dconn.execute(f"SELECT COUNT(*) FROM {table_id}").fetchone()[0]
            cursor = dconn.execute(
                f"SELECT * FROM {table_id} LIMIT {int(page_size)} OFFSET {int(offset)}"
            )
            cols = [d[0] for d in cursor.description]
            data = [dict(zip(cols, row)) for row in cursor.fetchall()]
        except Exception as exc:
            # The table can disappear between the SHOW TABLES whitelist check
            # and this query if a concurrent source removal rebuilds the
            # snapshot — a 404 is accurate, a 500 is not.
            logger.warning("get_table_data: DuckDB read failed for %s: %s", table, exc)
            raise HTTPException(status_code=404, detail=f"Table '{table}' not found")
        finally:
            dconn.close()
        return PaginatedData(
            table=table, total=total, page=page, page_size=page_size, data=data
        )

    conn = get_connection()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM {table_id}").fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM {table_id} LIMIT ? OFFSET ?", (page_size, offset)
        ).fetchall()
        data = [dict(row) for row in rows]
        return PaginatedData(
            table=table,
            total=total,
            page=page,
            page_size=page_size,
            data=data,
        )
    finally:
        conn.close()


# ── Semantic Layer endpoints ────────────────────────────────────────────────────


def _semantic_status_payload(hidden: frozenset[str] = frozenset()) -> dict[str, Any]:
    """Semantic layer status dict, excluding data from *hidden* demo tables."""
    if not _semantic_state["loaded"]:
        return {
            "loaded": False,
            "entities": [],
            "kg_nodes": 0,
            "kg_edges": 0,
            "metadata_rows": 0,
            "sources": [],
            "dedup_count": 0,
        }
    kg = _semantic_state["kg"]
    catalog = _semantic_state["catalog"]
    tables = (
        list(_mgr.describe().tables)
        if (_mgr := _semantic_state.get("mgr")) is not None
        else ["erp", "crm", "hr_pim"]
    )
    if hidden:
        draft_entities = catalog.get_draft_entities()
        visible = [e for e in draft_entities if e["table"] not in hidden]
        entities = [e["name"] for e in visible]
        metadata_rows = sum(e.get("record_count") or 0 for e in visible)
        kg_nodes, kg_edges = _kg_counts_excluding(kg, hidden)
        tables = [t for t in tables if t not in hidden]
        dedup_count = 0
    else:
        entities = catalog.list_entities()
        metadata_rows = catalog.row_count()
        kg_nodes, kg_edges = kg.node_count, kg.edge_count
        dedup_count = kg.dedup_count
    return {
        "loaded": True,
        "entities": entities,
        "kg_nodes": kg_nodes,
        "kg_edges": kg_edges,
        "metadata_rows": metadata_rows,
        "sources": tables,
        "dedup_count": dedup_count,
    }


@app.get("/api/semantic/status")
def semantic_status(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    """Return the current status of the semantic layer (loaded/not loaded)."""
    # Build the stack if this is the first semantic call after a restart —
    # otherwise a freshly-booted backend answers loaded=false/0 entities and
    # the dashboard shows "Not built yet" even though all the data is there.
    _ensure_semantic_loaded()
    return _semantic_status_payload(_hidden_demo_tables(current_user))


@app.post("/api/semantic/ask")
@limiter.limit(SEMANTIC_RATE_LIMIT, key_func=_semantic_limit_key)
def semantic_ask(
    request: Request,
    req: SemanticAskRequest,
    _current_user: UserPrincipal = Depends(get_current_user),
) -> SemanticAskResponse:
    """Ask a natural-language question to the Semantic Layer."""
    from .semantic.layer import (
        AmbiguityError,
        SemanticOntologyViolationError,
        SemanticSecurityViolationError,
    )

    question = req.normalized_question()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    hidden = _hidden_demo_tables(_current_user)
    if hidden:
        from .connectors.source_registry import get_source_registry

        # A registered non-default source counts as "connected" even before a
        # reindex — the hidden-tables guard will prevent demo data leakage, and
        # the ask can fail gracefully if the schema isn't indexed yet.
        has_live_source = any(
            not cfg.is_default for cfg in get_source_registry().list()
        )
        if not has_live_source:
            _ensure_semantic_loaded()
            catalog = _semantic_state.get("catalog")
            draft_entities = catalog.get_draft_entities() if catalog else []
            if not any(e["table"] not in hidden for e in draft_entities):
                # Live workspace with no real sources: answering would silently
                # use the demo dataset.
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "No data sources connected. Add a data source before "
                        "asking questions."
                    ),
                )

    merged_context = {"session_id": req.session_id, **(req.context or {})}
    redis_client = _get_semantic_redis_client()
    cache_key = _semantic_cache_key(
        question, merged_context, redis_client, mode=_current_user.mode
    )
    if redis_client is not None:
        try:
            cached_payload = redis_client.get(cache_key)
            if isinstance(cached_payload, str) and cached_payload.strip():
                return SemanticAskResponse.model_validate_json(cached_payload)
        except Exception:
            pass
    else:
        with _in_process_cache_lock:
            hit = _in_process_cache.get(cache_key)
            if hit is not None:
                _in_process_cache.move_to_end(cache_key)
        if hit:
            return SemanticAskResponse.model_validate_json(hit)

    _ensure_semantic_loaded()
    layer = _semantic_state["layer"]

    # Merge user-provided context (entities, metrics, glossary) with YAML docs.
    # Pass the merged docs directly to ask() instead of mutating the shared layer
    # object, which would cause a race condition under concurrent requests.
    merged_docs = None
    try:
        user_docs = _context_store.to_semantic_docs_override()
        from .semantic.doc_schema import SemanticDocs  # noqa: PLC0415

        _base_docs = _semantic_state.get("base_docs")
        merged_docs = SemanticDocs(
            entities=user_docs.entities + (_base_docs.entities if _base_docs else []),
            metrics=user_docs.metrics + (_base_docs.metrics if _base_docs else []),
            glossary=user_docs.glossary + (_base_docs.glossary if _base_docs else []),
            disambiguation_rules=_base_docs.disambiguation_rules if _base_docs else [],
        )
    except Exception as _merge_exc:
        logger.warning(
            "Context merge failed, proceeding without user docs: %s", _merge_exc
        )

    try:
        result = layer.ask(
            question,
            context=merged_context,
            docs_override=merged_docs,
            hidden_tables=hidden,
        )
        response_model = SemanticAskResponse(
            answer=result.answer,
            sql_used=result.sql_used,
            sources_touched=result.sources_touched,
            provenance=result.provenance,
            latency_ms=result.latency_ms,
            disambiguation_required=result.disambiguation_required,
            candidates=result.candidates,
            notes=result.notes,
            ambiguity_error=False,
        )
        response_json = response_model.model_dump_json()
        if redis_client is not None:
            try:
                redis_client.setex(
                    cache_key, _semantic_cache_ttl_seconds(), response_json
                )
            except Exception:
                pass
        else:
            with _in_process_cache_lock:
                if (
                    cache_key not in _in_process_cache
                    and len(_in_process_cache) >= _IN_PROCESS_CACHE_MAX
                ):
                    _in_process_cache.popitem(last=False)
                _in_process_cache[cache_key] = response_json
                _in_process_cache.move_to_end(cache_key)
        return response_model
    except AmbiguityError as e:
        return SemanticAskResponse(
            answer=None,
            disambiguation_required=True,
            candidates=e.candidates,
            notes=str(e),
            ambiguity_error=True,
        )
    except SemanticSecurityViolationError:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "SEMANTIC_SECURITY_VIOLATION",
                "message": "Query semantica non valida o non autorizzata",
            },
        )
    except SemanticOntologyViolationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "SEMANTIC_ONTOLOGY_VIOLATION",
                "message": str(e),
            },
        )


# ── KG rebuild (admin) ────────────────────────────────────────────────────────


@app.post("/api/kg/build")
def rebuild_knowledge_graph(
    request: Request,
    current_user: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    """Rebuild KG + semantic stack. Admin-only because it mutates in-memory system state."""
    with _semantic_init_lock:
        _bump_semantic_cache_namespace()
        if _semantic_state.get("layer") is not None:
            try:
                _semantic_state["layer"].clear_semantic_cache()
            except Exception:
                pass
        _semantic_state.update(
            {
                "loaded": False,
                "layer": None,
                "ontology": None,
                "kg": None,
                "catalog": None,
                "erp": None,
                "crm": None,
                "hr_pim": None,
            }
        )
        _ensure_semantic_loaded()
        hidden = _hidden_demo_tables(current_user)
        status = _semantic_status_payload(hidden)
        _audit(
            request,
            current_user,
            "Rebuilt knowledge graph",
            f"{status['kg_nodes']:,} nodes · {status['kg_edges']:,} edges",
            category="data",
        )
        return {
            "success": True,
            "kg_nodes": status["kg_nodes"],
            "kg_edges": status["kg_edges"],
            "metadata_rows": status["metadata_rows"],
            "dedup_count": status["dedup_count"],
        }


# ── Legacy query alias (secured, routed to semantic pipeline) ─────────────────


@app.post("/api/ask")
@limiter.limit(SEMANTIC_RATE_LIMIT, key_func=_semantic_limit_key)
def ask_legacy_alias(
    request: Request,
    req: SemanticAskRequest,
    _current_user: UserPrincipal = Depends(get_current_user),
) -> SemanticAskResponse:
    return semantic_ask(request, req, _current_user)


# ── Data store management ──────────────────────────────────────────────────────


@app.get("/api/data/store/status")
def data_store_status(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    """Return metadata about the unified DuckDB snapshot."""
    from .connectors.duckdb_source_manager import get_source_manager

    hidden = _hidden_demo_tables(current_user)
    try:
        mgr = get_source_manager(_SCENARIO_PATH)
        meta = mgr.describe()
        tables = [t for t in meta.tables if t not in hidden]
        row_counts = {t: c for t, c in meta.record_counts.items() if t not in hidden}
        # Strip the server filesystem path from the notes before returning
        # them to clients — useful in logs, not in an API payload.
        notes = re.sub(r"\s*\|\s*path=\S+", "", meta.notes or "")
        return {
            "source_type": meta.source_type,
            "built_at": meta.loaded_at.isoformat() if meta.loaded_at else None,
            "tables": tables,
            "row_counts": row_counts,
            "total_rows": sum(row_counts.values()),
            "notes": notes,
        }
    except Exception as exc:
        return {"error": str(exc)}


@app.post("/api/data/store/rebuild")
def rebuild_data_store(
    request: Request,
    current_user: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    """Force full re-ingest of all sources into the DuckDB snapshot. Admin-only."""
    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    row_counts = mgr.rebuild()
    meta = mgr.describe()
    _refresh_catalog_and_kg_after_rebuild(mgr)
    _audit(
        request,
        current_user,
        "Rebuilt data store",
        f"{sum(row_counts.values()):,} rows across {len(row_counts)} tables",
        category="data",
    )
    return {
        "rebuilt": True,
        "built_at": meta.loaded_at.isoformat() if meta.loaded_at else None,
        "row_counts": row_counts,
        "total_rows": sum(row_counts.values()),
    }


# ── Source registry CRUD ───────────────────────────────────────────────────────


class SourceAddRequest(BaseModel):
    connector_type: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=128)
    params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_params(self) -> "SourceAddRequest":
        if len(self.params) > 32:
            raise ValueError("params dict must not exceed 32 keys")
        total_value_bytes = sum(len(str(v)) for v in self.params.values())
        if total_value_bytes > 10 * 1024 * 1024:
            raise ValueError("params values must not exceed 10 MB total")
        return self


class SourceResponse(BaseModel):
    id: str
    connector_type: str
    label: str
    params: dict[str, Any]
    target_tables: list[str]
    row_count: int
    status: str
    error_msg: str | None
    connected_at: str
    last_sync_at: str | None
    is_default: bool


def _redact_dsn(dsn: str) -> str:
    """Mask the password in a connection-string DSN (postgres://u:pw@host/db)."""
    return re.sub(r"://([^:/@]+):[^@]+@", r"://\1:***@", dsn)


def _source_cfg_to_response(cfg) -> SourceResponse:
    params: dict[str, Any] = {}
    for k, v in cfg.params.items():
        if k in ("api_key", "password"):
            continue
        if k == "inline_csv" and isinstance(v, str):
            # The raw payload stays in the registry for rebuilds; echoing it
            # back would put megabytes (or sensitive rows) in every sources
            # listing.
            params[k] = f"<inline data: {len(v.encode('utf-8'))} bytes>"
        elif k == "dsn" and isinstance(v, str):
            params[k] = _redact_dsn(v)
        else:
            params[k] = v
    return SourceResponse(
        id=cfg.id,
        connector_type=cfg.connector_type,
        label=cfg.label,
        params=params,
        target_tables=cfg.target_tables,
        row_count=cfg.row_count,
        status=cfg.status,
        error_msg=cfg.error_msg,
        connected_at=cfg.connected_at,
        last_sync_at=cfg.last_sync_at,
        is_default=cfg.is_default,
    )


@app.get("/api/sources", response_model=list[SourceResponse])
def list_sources(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[SourceResponse]:
    """List configured data sources, filtered by the caller's mode.

    Demo users see all sources including the pre-seeded scenario sources
    (is_default=True). Live users see only manually-added sources so their
    workspace starts clean even when demo sources exist in the shared registry.
    """
    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    sources = mgr.registry.list()
    if current_user.mode == "live":
        sources = [s for s in sources if not s.is_default]
    return [_source_cfg_to_response(s) for s in sources]


@app.post("/api/sources", response_model=SourceResponse, status_code=201)
def add_source(
    req: SourceAddRequest,
    request: Request,
    current_user: UserPrincipal = Depends(require_roles("admin")),
) -> SourceResponse:
    """Register a new data source. Triggers a DuckDB rebuild for implemented types."""
    import uuid
    from .connectors.duckdb_source_manager import get_source_manager
    from .connectors.source_registry import SourceConfig, IMPLEMENTED_CONNECTOR_TYPES

    mgr = get_source_manager(_SCENARIO_PATH)
    source_id = req.params.get("id") or f"{req.connector_type}-{uuid.uuid4().hex[:8]}"
    if mgr.registry.get(source_id) is not None:
        # registry.upsert() is INSERT OR REPLACE — letting a client-supplied
        # "id" collide with an existing source would silently overwrite it
        # (label, connector config, target tables, *and* its is_default flag,
        # since SourceConfig.is_default defaults to False here). For one of
        # the four protected seed sources ("erp"/"crm"/"hr"/"pim") that not
        # only destroys the working connector config but also strips the
        # "cannot remove default source" guard, leaving it deletable — and
        # _seed_defaults() only reseeds an *empty* registry, so it would never
        # come back. Registration must create new sources, not clobber ones
        # that already exist.
        raise HTTPException(
            status_code=409,
            detail=(
                f"Source '{source_id}' already exists; choose a different id "
                "or remove the existing source first"
            ),
        )

    # Physical table names are a single namespace shared by every source in
    # the DuckDB snapshot. Reject names that would collide with the demo
    # dataset when it is seeded on this deployment — otherwise whichever
    # source ingests last silently overwrites the other's table. Underscore
    # names are reserved for internal tables (_build_meta) on any deployment.
    table_name = str(req.params.get("table_name") or "").strip()
    if table_name:
        if table_name.startswith("_"):
            raise HTTPException(
                status_code=422,
                detail="Table names starting with '_' are reserved",
            )
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", table_name):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Table name must start with a letter and contain only "
                    "letters, digits and underscores (max 63 chars)"
                ),
            )
        demo_seeded = any(c.is_default for c in mgr.registry.list())
        if demo_seeded and table_name.lower() in _DEMO_SCENARIO_TABLES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Table name '{table_name}' is reserved by the demo dataset "
                    "on this deployment — rename the table and try again"
                ),
            )

    cfg = SourceConfig(
        id=source_id,
        connector_type=req.connector_type,
        label=req.label,
        params=req.params,
        status="pending",
    )
    mgr.registry.upsert(cfg)

    if req.connector_type in IMPLEMENTED_CONNECTOR_TYPES:
        try:
            mgr.rebuild()
            cfg = mgr.registry.get(source_id) or cfg
            _refresh_catalog_and_kg_after_rebuild(mgr)
        except Exception as exc:
            mgr.registry.patch(source_id, status="error", error_msg=str(exc))
            cfg = mgr.registry.get(source_id) or cfg

    _audit(
        request,
        current_user,
        "Added data source",
        f"{req.label} ({req.connector_type})",
        category="config",
    )
    return _source_cfg_to_response(cfg)


@app.delete("/api/sources/{source_id}", status_code=204)
def remove_source(
    source_id: Annotated[str, _ApiPath(max_length=128)],
    request: Request,
    current_user: UserPrincipal = Depends(require_roles("admin")),
) -> None:
    """Remove a source from the registry and trigger a DuckDB rebuild."""
    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    try:
        mgr.registry.remove(source_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _audit(request, current_user, "Removed data source", source_id, category="config")
    try:
        mgr.rebuild()
        _refresh_catalog_and_kg_after_rebuild(mgr)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Source removed from registry but snapshot rebuild failed: {exc}",
        )


@app.post("/api/sources/{source_id}/sync", response_model=SourceResponse)
def sync_source(
    source_id: Annotated[str, _ApiPath(max_length=128)],
    request: Request,
    current_user: UserPrincipal = Depends(require_roles("admin")),
) -> SourceResponse:
    """Re-ingest a single source and rebuild the DuckDB snapshot."""
    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    cfg = mgr.registry.get(source_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found")
    try:
        mgr.ingest_one(source_id)
        _refresh_catalog_and_kg_after_rebuild(mgr)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    cfg = mgr.registry.get(source_id) or cfg
    _audit(request, current_user, "Synced data source", source_id, category="data")
    return _source_cfg_to_response(cfg)


# ── Semantic sources ───────────────────────────────────────────────────────────


@app.get("/api/semantic/sources")
def semantic_sources(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    """Return real data source metadata with freshness."""
    _ensure_semantic_loaded()
    mgr = _semantic_state.get("mgr")
    hidden = _hidden_demo_tables(current_user)

    # Prefer unified mgr-based source info (reflects actual registered sources)
    if mgr is not None:
        try:
            meta = mgr.describe()
            tables = [t for t in meta.tables if t not in hidden]
            record_counts = {
                t: c for t, c in meta.record_counts.items() if t not in hidden
            }
            if hidden and not tables:
                # Live workspace with no real sources yet
                return []
            built_at = meta.loaded_at
            if built_at is not None:
                age_h = (datetime.utcnow() - built_at).total_seconds() / 3600
                freshness = (
                    "fresh" if age_h < 24 else "stale" if age_h < 168 else "outdated"
                )
            else:
                freshness = "unknown"
            non_empty = sum(1 for c in record_counts.values() if c > 0)
            quality = round(100 * non_empty / max(len(tables), 1))
            return [
                {
                    "id": "unified",
                    "name": meta.name,
                    "source_type": meta.source_type,
                    "tables": tables,
                    "record_counts": record_counts,
                    "total_rows": sum(record_counts.values()),
                    "loaded_at": built_at.isoformat() if built_at else None,
                    "quality_score": quality,
                    "freshness_status": freshness,
                }
            ]
        except Exception as exc:
            return [{"id": "unified", "name": "duckdb_unified", "error": str(exc)}]

    # Legacy fallback: iterate the per-domain connectors
    sources = []
    for key in ["erp", "crm", "hr_pim"]:
        connector = _semantic_state.get(key)
        if connector is None:
            continue
        try:
            meta = connector.describe()
            total = sum(meta.record_counts.values())
            sources.append(
                {
                    "id": key,
                    "name": meta.name,
                    "source_type": meta.source_type,
                    "tables": meta.tables,
                    "record_counts": meta.record_counts,
                    "total_rows": total,
                    "loaded_at": meta.loaded_at.isoformat() if meta.loaded_at else None,
                    "quality_score": None,
                    "freshness_status": "unknown",
                }
            )
        except Exception as exc:
            sources.append({"id": key, "name": key, "error": str(exc)})
    return sources


# ── Semantic definitions CRUD ─────────────────────────────────────────────────


@app.get("/api/semantic/metrics")
def get_metrics(
    sector_id: str = Query(default=DEFAULT_SECTOR, max_length=64),
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    # Live-mode users start from scratch: hide the demo-seeded builtin rows.
    builtin_filter = " AND is_builtin = 0" if current_user.mode == "live" else ""
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT * FROM sl_metrics WHERE sector_id = ?{builtin_filter} "
            "ORDER BY is_builtin DESC, name LIMIT 1000",
            (sector_id,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["filters"] = _safe_json(d.pop("filters_json", "[]"), [])
            d["grains"] = _safe_json(d.pop("grains_json", "[]"), [])
            d["tags"] = _safe_json(d.pop("tags_json", "[]"), [])
            d["is_builtin"] = bool(d["is_builtin"])
            result.append(d)
        return result
    finally:
        conn.close()


@app.post("/api/semantic/metrics", status_code=201)
def create_metric(
    m: MetricCreate,
    _: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    mid = f"m-{uuid.uuid4().hex[:12]}"
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO sl_metrics
               (id, sector_id, name, description, type, entity, field, numerator, denominator,
                expression, filters_json, time_dimension, grains_json, format, status, owner, tags_json, is_builtin)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
            (
                mid,
                m.sector_id,
                m.name,
                m.description,
                m.type,
                m.entity,
                m.field,
                m.numerator,
                m.denominator,
                m.expression,
                json.dumps(m.filters),
                m.time_dimension,
                json.dumps(m.grains),
                m.format,
                m.status,
                m.owner,
                json.dumps(m.tags),
            ),
        )
        conn.commit()
        return {"id": mid, **m.model_dump(), "is_builtin": False}
    finally:
        conn.close()


@app.delete("/api/semantic/metrics/{metric_id}", status_code=204)
def delete_metric(
    metric_id: Annotated[str, _ApiPath(max_length=128)],
    _: UserPrincipal = Depends(require_roles("admin")),
) -> None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT is_builtin FROM sl_metrics WHERE id = ?", (metric_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Metric not found")
        if row[0]:
            raise HTTPException(
                status_code=403, detail="Cannot delete built-in metrics"
            )
        conn.execute("DELETE FROM sl_metrics WHERE id = ?", (metric_id,))
        conn.commit()
    finally:
        conn.close()


@app.get("/api/semantic/hierarchies")
def get_hierarchies(
    sector_id: str = Query(default=DEFAULT_SECTOR, max_length=64),
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    # Live-mode users start from scratch: hide the demo-seeded builtin rows.
    builtin_filter = " AND is_builtin = 0" if current_user.mode == "live" else ""
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT * FROM sl_hierarchies WHERE sector_id = ?{builtin_filter} "
            "ORDER BY is_builtin DESC, name LIMIT 1000",
            (sector_id,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["levels"] = _safe_json(d.pop("levels_json", "[]"), [])
            d["is_builtin"] = bool(d["is_builtin"])
            result.append(d)
        return result
    finally:
        conn.close()


@app.post("/api/semantic/hierarchies", status_code=201)
def create_hierarchy(
    h: HierarchyCreate,
    _: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    hid = f"h-{uuid.uuid4().hex[:12]}"
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO sl_hierarchies
               (id, sector_id, name, entity, description, type, levels_json, is_builtin)
               VALUES (?,?,?,?,?,?,?,0)""",
            (
                hid,
                h.sector_id,
                h.name,
                h.entity,
                h.description,
                h.type,
                json.dumps(h.levels),
            ),
        )
        conn.commit()
        return {"id": hid, **h.model_dump(), "is_builtin": False}
    finally:
        conn.close()


@app.delete("/api/semantic/hierarchies/{hierarchy_id}", status_code=204)
def delete_hierarchy(
    hierarchy_id: Annotated[str, _ApiPath(max_length=128)],
    _: UserPrincipal = Depends(require_roles("admin")),
) -> None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT is_builtin FROM sl_hierarchies WHERE id = ?", (hierarchy_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Hierarchy not found")
        if row[0]:
            raise HTTPException(
                status_code=403, detail="Cannot delete built-in hierarchies"
            )
        conn.execute("DELETE FROM sl_hierarchies WHERE id = ?", (hierarchy_id,))
        conn.commit()
    finally:
        conn.close()


@app.get("/api/semantic/segments")
def get_segments(
    sector_id: str = Query(default=DEFAULT_SECTOR, max_length=64),
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    # Live-mode users start from scratch: hide the demo-seeded builtin rows.
    builtin_filter = " AND is_builtin = 0" if current_user.mode == "live" else ""
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT * FROM sl_segments WHERE sector_id = ?{builtin_filter} "
            "ORDER BY is_builtin DESC, name LIMIT 1000",
            (sector_id,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["conditions"] = _safe_json(d.pop("conditions_json", "[]"), [])
            d["tags"] = _safe_json(d.pop("tags_json", "[]"), [])
            d["used_by"] = _safe_json(d.pop("used_by_json", "[]"), [])
            d["is_builtin"] = bool(d["is_builtin"])
            result.append(d)
        return result
    finally:
        conn.close()


@app.post("/api/semantic/segments", status_code=201)
def create_segment(
    s: SegmentCreate,
    _: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    sid = f"seg-{uuid.uuid4().hex[:12]}"
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO sl_segments
               (id, sector_id, name, description, entity, conditions_json, tags_json, used_by_json, is_builtin)
               VALUES (?,?,?,?,?,?,?,?,0)""",
            (
                sid,
                s.sector_id,
                s.name,
                s.description,
                s.entity,
                json.dumps(s.conditions),
                json.dumps(s.tags),
                json.dumps(s.used_by),
            ),
        )
        conn.commit()
        return {"id": sid, **s.model_dump(), "is_builtin": False}
    finally:
        conn.close()


@app.delete("/api/semantic/segments/{segment_id}", status_code=204)
def delete_segment(
    segment_id: Annotated[str, _ApiPath(max_length=128)],
    _: UserPrincipal = Depends(require_roles("admin")),
) -> None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT is_builtin FROM sl_segments WHERE id = ?", (segment_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Segment not found")
        if row[0]:
            raise HTTPException(
                status_code=403, detail="Cannot delete built-in segments"
            )
        conn.execute("DELETE FROM sl_segments WHERE id = ?", (segment_id,))
        conn.commit()
    finally:
        conn.close()


@app.get("/api/semantic/coverage")
def semantic_coverage(
    sector_id: str = Query(default="manufacturing", max_length=64),
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    # Coverage scores read _semantic_status_payload(); without this, a cold
    # process reports zero entities/KG and a misleadingly low score.
    _ensure_semantic_loaded()
    hidden = _hidden_demo_tables(current_user)
    builtin_filter = " AND is_builtin = 0" if hidden else ""
    conn = get_connection()
    try:
        n_metrics = conn.execute(
            f"SELECT COUNT(*) FROM sl_metrics WHERE sector_id=?{builtin_filter}",
            (sector_id,),
        ).fetchone()[0]
        n_hierarchies = conn.execute(
            f"SELECT COUNT(*) FROM sl_hierarchies WHERE sector_id=?{builtin_filter}",
            (sector_id,),
        ).fetchone()[0]
        n_segments = conn.execute(
            f"SELECT COUNT(*) FROM sl_segments WHERE sector_id=?{builtin_filter}",
            (sector_id,),
        ).fetchone()[0]
    finally:
        conn.close()

    status = _semantic_status_payload(hidden)
    n_entities = len(status.get("entities", []))

    has_data = bool(status.get("loaded")) and (not hidden or n_entities > 0)
    breakdown = {
        "sources": 100 if has_data else 0,
        "entities": min(100, n_entities * 10),
        "bridges": 100 if has_data else 0,
        "rules": 100 if has_data else 0,
        "metrics": min(100, n_metrics * 20),
        "hierarchies": min(100, n_hierarchies * 34),
        "segments": min(100, n_segments * 20),
    }
    score = round(sum(breakdown.values()) / len(breakdown))
    return {"sector_id": sector_id, "score": score, "breakdown": breakdown}


# ── Semantic Layer Draft endpoints ────────────────────────────────────────────


@app.post(
    "/api/semantic/build",
    tags=["semantic"],
    summary="Rebuild semantic layer and return draft config",
)
async def build_semantic_layer(
    force: bool = Query(
        default=False, description="Force rebuild even if already loaded"
    ),
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    """Rebuild the KG + catalog and return the draft config.

    Skips the rebuild when already loaded and *force* is not set, so the demo
    workspace responds instantly on subsequent visits.
    """
    import asyncio

    if force or not _semantic_state["loaded"]:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, reload_semantic)
        # Auto-generate templates from the freshly-built schema (always from
        # the full unfiltered draft — templates are shared system-wide)
        catalog = _semantic_state.get("catalog")
        layer = _semantic_state.get("layer")
        if catalog is not None and layer is not None:
            draft = _get_semantic_draft()
            auto_tpls = generate_templates_from_draft(draft)
            n = catalog.upsert_auto_templates(auto_tpls)
            logger.info("Auto-generated %d query templates from semantic layer", n)
            layer.set_templates(catalog.list_templates())
    return _get_semantic_draft(_hidden_demo_tables(current_user))


@app.get(
    "/api/semantic/draft",
    tags=["semantic"],
    summary="Get current semantic layer draft (entities, relations, metrics, context)",
)
def get_semantic_draft_endpoint(
    current_user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    # Return immediately if warmup is still running — the frontend polls until
    # loaded=true rather than blocking the entire request for several seconds.
    if not _semantic_state["loaded"]:
        return {
            "loaded": False,
            "entities": [],
            "relations": [],
            "metrics": [],
            "context_docs": [],
            "templates": [],
            "built_at": "",
        }
    return _get_semantic_draft(_hidden_demo_tables(current_user))


@app.patch(
    "/api/semantic/draft/entities/{name}",
    tags=["semantic"],
    summary="Update user description and context notes for an entity",
)
def patch_draft_entity(
    name: Annotated[str, _ApiPath(max_length=128)],
    body: EntityDraftUpdate,
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    ok = catalog.save_entity_draft(
        name,
        user_description=body.user_description,
        context_notes=body.context_notes,
    )
    if not ok:
        raise HTTPException(status_code=404, detail=f"Entity '{name}' not found")
    _sync_context_docs_to_layer()
    return {"ok": True}


@app.patch(
    "/api/semantic/draft/metrics/{name}",
    tags=["semantic"],
    summary="Update description/formula for a metric",
)
def patch_draft_metric(
    name: Annotated[str, _ApiPath(max_length=128)],
    body: MetricDraftUpdate,
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    ok = catalog.save_metric_draft(
        name,
        description=body.description,
        formula=body.formula,
        label=body.label,
    )
    if not ok:
        raise HTTPException(status_code=404, detail=f"Metric '{name}' not found")
    # catalog.list_metric_objects() feeds metric-definition answers straight
    # into layer.ask() — without this, a cached pre-edit answer keeps citing
    # the old formula/description/label until the cache entry expires/evicts.
    _bump_semantic_cache_namespace()
    layer = _semantic_state.get("layer")
    if layer is not None:
        try:
            layer.clear_semantic_cache()
        except Exception:
            pass
    return {"ok": True}


@app.get(
    "/api/semantic/draft/context",
    tags=["semantic"],
    summary="List global context documents",
)
def list_draft_context(
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    from .connectors.source_registry import get_source_registry

    registry = get_source_registry()
    return [
        {
            "id": c.id,
            "title": c.label,
            "content": c.params.get("content", ""),
            "created_at": c.connected_at,
        }
        for c in registry.list()
        if c.connector_type == "context_doc"
    ]


@app.post(
    "/api/semantic/draft/context",
    tags=["semantic"],
    summary="Add a global context document",
    status_code=201,
)
def add_draft_context(
    body: ContextDocCreate,
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    from .connectors.source_registry import get_source_registry, SourceConfig

    registry = get_source_registry()
    doc_id = f"ctx_{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}"
    cfg = SourceConfig(
        id=doc_id,
        connector_type="context_doc",
        label=body.title,
        params={"content": body.content},
        target_tables=[],
        status="active",
    )
    registry.upsert(cfg)
    _sync_context_docs_to_layer()
    # _sync_context_docs_to_layer() pushes these docs straight into the LLM
    # SQL-generation prompt (layer._context_docs) — without this, a cached
    # pre-edit answer keeps being served without the new business context
    # until the cache entry expires/evicts.
    _bump_semantic_cache_namespace()
    layer = _semantic_state.get("layer")
    if layer is not None:
        try:
            layer.clear_semantic_cache()
        except Exception:
            pass
    return {
        "id": doc_id,
        "title": body.title,
        "content": body.content,
        "created_at": cfg.connected_at,
    }


@app.delete(
    "/api/semantic/draft/context/{doc_id}",
    tags=["semantic"],
    summary="Remove a context document",
)
def delete_draft_context(
    doc_id: Annotated[str, _ApiPath(max_length=128)],
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    from .connectors.source_registry import get_source_registry

    registry = get_source_registry()
    cfg = registry.get(doc_id)
    if cfg is None or cfg.connector_type != "context_doc":
        raise HTTPException(status_code=404, detail="Context document not found")
    registry.remove(doc_id)
    _sync_context_docs_to_layer()
    # Same reasoning as add_draft_context: the removed doc must stop
    # influencing answers immediately, not just once the cache entry expires.
    _bump_semantic_cache_namespace()
    layer = _semantic_state.get("layer")
    if layer is not None:
        try:
            layer.clear_semantic_cache()
        except Exception:
            pass
    return {"ok": True}


# ── Query Templates CRUD ─────────────────────────────────────────────────────


@app.get("/api/semantic/templates", tags=["semantic"])
def list_templates(
    _user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict]:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    templates = catalog.list_templates()
    hidden = _hidden_demo_tables(_user)
    if hidden:
        draft_entities = (
            catalog.get_draft_entities() if _semantic_state.get("loaded") else []
        )
        hidden_keys = set(hidden) | {
            e["name"] for e in draft_entities if e["table"] in hidden
        }
        templates = [
            t for t in templates if not (set(t.get("sources") or []) & hidden_keys)
        ]
        if not any(e["table"] not in hidden for e in draft_entities):
            # Live workspace with no real sources: every template targets demo.
            templates = []
    return templates


@app.post("/api/semantic/templates", status_code=201, tags=["semantic"])
def create_template(
    payload: QueryTemplatePayload,
    request: Request,
    _admin: UserPrincipal = Depends(require_roles("admin")),
) -> dict:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    try:
        tpl = catalog.create_template(
            name=payload.name,
            description=payload.description,
            sql_query=payload.sql_query,
            keywords=payload.keywords,
            sources=payload.sources,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _hot_reload_templates()
    _audit(request, _admin, "Created query template", payload.name, category="config")
    return tpl


@app.patch("/api/semantic/templates/{template_id}", tags=["semantic"])
def update_template(
    template_id: int,
    payload: QueryTemplateUpdatePayload,
    request: Request,
    _admin: UserPrincipal = Depends(require_roles("admin")),
) -> dict:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    try:
        tpl = catalog.update_template(
            template_id,
            **payload.model_dump(exclude_none=True),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _hot_reload_templates()
    _audit(
        request, _admin, "Updated query template", f"#{template_id}", category="config"
    )
    return tpl


@app.delete("/api/semantic/templates/{template_id}", status_code=204, tags=["semantic"])
def delete_template(
    template_id: int,
    request: Request,
    _admin: UserPrincipal = Depends(require_roles("admin")),
) -> None:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    try:
        catalog.delete_template(template_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _hot_reload_templates()
    _audit(
        request, _admin, "Deleted query template", f"#{template_id}", category="config"
    )


def _optional_user_mode(request: Request) -> Literal["demo", "live"]:
    """Best-effort mode extraction for public endpoints: any decode failure
    (missing/invalid/expired token) falls back to demo visibility."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return "demo"
    try:
        payload = _jwt_decode(auth[7:].strip(), _get_jwt_secret())
    except Exception:
        return "demo"
    return "live" if payload.get("mode") == "live" else "demo"


@app.get("/api/semantic/example-questions", tags=["semantic"])
def list_example_questions(request: Request) -> list[dict[str, str]]:
    """Return example questions derived from active query templates (public, no auth)."""
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        return []
    templates = catalog.list_templates()
    if _optional_user_mode(request) == "live":
        # Templates derived from the demo dataset must never surface in a
        # live workspace — filter by source the same way /api/semantic/templates
        # does, instead of returning everything once one real source exists.
        draft_entities = catalog.get_draft_entities()
        hidden = _hidden_demo_tables(
            UserPrincipal(username="_", role="user", mode="live")
        )
        live_entities = [e for e in draft_entities if e["table"] not in hidden]
        if not live_entities:
            return []
        hidden_keys = set(hidden) | {
            e["name"] for e in draft_entities if e["table"] in hidden
        }
        templates = [
            t for t in templates if not (set(t.get("sources") or []) & hidden_keys)
        ]
        active = [t for t in templates if t.get("is_active", True)]
        if not active:
            # No user-created templates yet — generate generic exploratory
            # questions from the discovered entity names so the UI isn't blank.
            generated: list[dict[str, str]] = []
            for entity in live_entities[:4]:
                ename = entity.get("name") or entity.get("table", "")
                generated.append(
                    {
                        "question": f"How many records are in {ename}?",
                        "description": f"Total row count for {ename}",
                    }
                )
                cols = entity.get("columns", [])
                if cols:
                    col_sample = ", ".join(cols[:3])
                    generated.append(
                        {
                            "question": f"Show me the first 10 rows from {ename}",
                            "description": f"Sample data — columns: {col_sample}…",
                        }
                    )
            return generated[:12]
        active_sorted = sorted(active, key=lambda t: t.get("name", ""))
        return [
            {"question": t["name"], "description": t.get("description", "")}
            for t in active_sorted[:12]
        ]
    active = [t for t in templates if t.get("is_active", True)]
    active_sorted = sorted(active, key=lambda t: t.get("name", ""))
    return [
        {"question": t["name"], "description": t.get("description", "")}
        for t in active_sorted[:12]
    ]


# ── System prompt endpoint (used by direct-LLM frontend mode) ────────────────


@app.get("/api/semantic/system-prompt", tags=["semantic"])
def get_system_prompt(request: Request) -> dict:
    """Return a dynamic LLM system prompt built from the live semantic catalog.

    Used by the frontend's direct-LLM mode (user-provided API key) so it always
    reflects the loaded dataset rather than a hardcoded schema.
    """
    from .query.aw_engine import build_system_prompt as _bsp  # noqa: PLC0415

    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    layer = _semantic_state.get("layer")

    # Live-mode users must not see the demo schema in their prompt.
    exclude: frozenset[str] = frozenset()
    if _optional_user_mode(request) == "live":
        exclude = _hidden_demo_tables(
            UserPrincipal(username="_", role="user", mode="live")
        )

    # Build the core schema/SQL prompt
    base_prompt = _bsp(catalog=catalog, layer=layer, exclude_tables=exclude)

    # Append frontend-specific output format (richer than the backend format)
    frontend_format = (
        "\n\n== FRONTEND OUTPUT FORMAT =="
        "\nOverride the RESPONSE FORMAT above. Return this JSON structure instead:\n"
        "{\n"
        '  "sql": "SELECT ...",\n'
        '  "rows": [],\n'
        '  "summary": "1-2 sentences answering the question with key numbers in **bold**.",\n'
        '  "interpreted_as": "Short label, e.g. Top salesperson by YTD revenue",\n'
        '  "chartData": {"type": "bar", "title": "Chart title",'
        ' "labels": ["A","B"], "values": [100, 200], "unit": "€"} or null,\n'
        '  "sources": [{"id": "erp", "label": "ERP", "bg": "bg-blue-100", "text": "text-blue-700"}],\n'
        '  "steps": ["① Locate source table", "② Apply filter/join", "③ Return result"],\n'
        '  "followUps": ["Related question 1?", "Related question 2?", "Related question 3?"],\n'
        '  "isDisambiguation": false\n'
        "}\n"
        "\n- rows: leave as [] — actual data must be fetched via the backend query API"
        "\n- summary: write based on schema knowledge and the SQL you generate"
        "\n- sources: list only the source systems touched by your SQL"
        "\n- steps: 2-4 bullet points describing your query plan"
        "\n- followUps: exactly 3 related questions the user might want to ask next"
        "\n- isDisambiguation: true only when 'fatturato'/'revenue' is ambiguous"
    )

    return {"prompt": base_prompt + frontend_format}


# ── Mapping definitions endpoint ─────────────────────────────────────────────


@app.get("/api/semantic/mapping-defs", tags=["semantic"])
def get_mapping_defs(request: Request) -> dict:
    """Return semantic field definitions and disambiguation rules from YAML config.

    Frontend MappingView.tsx uses this to populate initial definitions rather than
    hardcoding them in TypeScript.  The YAML lives at metadata/mapping_defs.yaml
    and can be edited without a code deploy.
    """
    import pathlib as _pathlib  # noqa: PLC0415

    import yaml as _yaml  # noqa: PLC0415

    if _optional_user_mode(request) == "live":
        # The YAML definitions describe the demo dataset's fields only.
        return {"definitions": [], "ambiguities": []}

    yaml_path = _pathlib.Path(__file__).parent / "metadata" / "mapping_defs.yaml"
    try:
        data = _yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    return {
        "definitions": data.get("definitions", []),
        "ambiguities": data.get("ambiguities", []),
    }


# ── Live Config endpoint ──────────────────────────────────────────────────────


def _auto_layout_positions(
    entities: list[dict], relations: list[dict]
) -> dict[str, dict]:
    """Assign x/y positions using a simple grid layout.

    Entities with more outgoing FK relations go left (source nodes).
    Entities with more incoming FK relations go right (target nodes).
    """
    out_degree: dict[str, int] = {}
    in_degree: dict[str, int] = {}
    for e in entities:
        out_degree[e["name"]] = 0
        in_degree[e["name"]] = 0
    for r in relations:
        for e in entities:
            if e["table"] == r.get("from_table"):
                out_degree[e["name"]] = out_degree.get(e["name"], 0) + 1
            if e["table"] == r.get("to_table"):
                in_degree[e["name"]] = in_degree.get(e["name"], 0) + 1

    sorted_entities = sorted(
        entities,
        key=lambda e: out_degree.get(e["name"], 0) - in_degree.get(e["name"], 0),
        reverse=True,
    )

    n = len(sorted_entities)
    cols = max(1, _math.ceil(_math.sqrt(n)))
    positions: dict[str, dict] = {}
    for i, e in enumerate(sorted_entities):
        row, col = divmod(i, cols)
        positions[e["name"]] = {
            "x": 80 + col * 320,
            "y": 100 + row * 220,
        }
    return positions


_FUNNEL_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# Column names that typically hold an order/transaction lifecycle state
_FUNNEL_STATUS_COLUMNS = {
    # English
    "status",
    "state",
    "stage",
    "phase",
    "step",
    "status_code",
    "order_status",
    "orderstatus",
    "delivery_status",
    "fulfillment_status",
    "payment_status",
    "shipment_status",
    "workflow_state",
    "current_step",
    "step_name",
    "phase_code",
    "action_status",
    # Italian
    "stato",
    "fase",
    "stadio",
    "stato_ordine",
    "stato_spedizione",
    "stato_pagamento",
}

# Substrings that identify a column as status-like when the full name
# doesn't appear in _FUNNEL_STATUS_COLUMNS.
_FUNNEL_STATUS_SUBSTRINGS = ("status", "state", "stage", "stato", "phase", "fase")

# Revenue/amount column name substrings used by _build_live_kpi_stats.
_KPI_AMOUNT_SUBSTRINGS = (
    "amount",
    "revenue",
    "total",
    "price",
    "subtotal",
    "value",
    "sales",
    "turnover",
    "gross",
    "net",
    "cost",
    "income",
    # Italian
    "importo",
    "ricavo",
    "totale",
    "fatturato",
    "prezzo",
    "valore",
)
# Quantity column substrings.
_KPI_QTY_SUBSTRINGS = ("qty", "quantity", "units", "items", "count", "volume")
# Date column substrings.
_KPI_DATE_SUBSTRINGS = ("date", "at", "time", "created", "updated", "data", "giorno")


def _build_live_kpi_stats(entities: list[dict]) -> list[dict]:
    """Compute basic live KPI cards from the user's real data.

    Queries each visible entity table for:
    - SUM of the first detected revenue/amount column → "Total <ColName>"
    - MIN/MAX of the first detected date column → date range card
    Falls back gracefully on any DuckDB error. Returns up to 6 cards.
    """
    if not entities:
        return []

    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    cards: list[dict] = []

    # One shared connection for all queries — avoids repeated open/close overhead.
    conn = None
    try:
        conn = mgr.get_connection()
    except Exception as exc:
        logger.debug("KPI stats: could not open DuckDB connection: %s", exc)
        return []

    try:
        for entity in entities[:8]:
            if len(cards) >= 6:
                break
            table = entity.get("table", "")
            label = entity.get("name") or table
            record_count = entity.get("record_count") or 0
            if not table or not _FUNNEL_IDENT_RE.match(table) or record_count == 0:
                continue

            columns = [c for c in entity.get("columns", []) if isinstance(c, str)]

            # -- Row-count card (always available) --------------------------------
            cards.append(
                {
                    "label": f"{label} rows",
                    "value": record_count,
                    "unit": "rows",
                    "type": "count",
                }
            )

            # -- Revenue/amount SUM card ------------------------------------------
            amount_col = next(
                (
                    c
                    for c in columns
                    if any(sub in c.lower() for sub in _KPI_AMOUNT_SUBSTRINGS)
                ),
                None,
            )
            if amount_col and _FUNNEL_IDENT_RE.match(amount_col) and len(cards) < 6:
                try:
                    result = conn.execute(
                        f'SELECT SUM(CAST("{amount_col}" AS DOUBLE)) FROM "{table}"'  # noqa: S608
                    ).fetchone()
                    if result and result[0] is not None:
                        val = float(result[0])
                        cards.append(
                            {
                                "label": f"Total {amount_col.replace('_', ' ').title()}",
                                "value": round(val, 2),
                                "unit": "",
                                "type": "sum",
                            }
                        )
                except Exception as exc:
                    logger.debug(
                        "KPI sum skipped for %s.%s: %s", table, amount_col, exc
                    )

            # -- Quantity SUM card ------------------------------------------------
            qty_col = next(
                (
                    c
                    for c in columns
                    if any(sub in c.lower() for sub in _KPI_QTY_SUBSTRINGS)
                    and c != amount_col
                ),
                None,
            )
            if qty_col and _FUNNEL_IDENT_RE.match(qty_col) and len(cards) < 6:
                try:
                    result = conn.execute(
                        f'SELECT SUM(CAST("{qty_col}" AS DOUBLE)) FROM "{table}"'  # noqa: S608
                    ).fetchone()
                    if result and result[0] is not None:
                        val = float(result[0])
                        cards.append(
                            {
                                "label": f"Total {qty_col.replace('_', ' ').title()}",
                                "value": round(val, 0),
                                "unit": "units",
                                "type": "sum",
                            }
                        )
                except Exception as exc:
                    logger.debug("KPI qty skipped for %s.%s: %s", table, qty_col, exc)

            # -- Date range card --------------------------------------------------
            date_col = next(
                (
                    c
                    for c in columns
                    if any(sub in c.lower() for sub in _KPI_DATE_SUBSTRINGS)
                    and c.lower()
                    not in {
                        "updated_at",
                        "created_at",
                        "deleted_at",
                        "updated",
                        "created",
                        "deleted",
                    }
                ),
                None,
            ) or next(
                (
                    c
                    for c in columns
                    if any(sub in c.lower() for sub in _KPI_DATE_SUBSTRINGS)
                ),
                None,
            )
            if date_col and _FUNNEL_IDENT_RE.match(date_col) and len(cards) < 6:
                try:
                    result = conn.execute(
                        f'SELECT MIN("{date_col}"::VARCHAR), MAX("{date_col}"::VARCHAR) '  # noqa: S608
                        f'FROM "{table}" WHERE "{date_col}" IS NOT NULL LIMIT 1'
                    ).fetchone()
                    if result and result[0] and result[1]:
                        cards.append(
                            {
                                "label": f"{label} date range",
                                "value": f"{result[0][:10]} – {result[1][:10]}",
                                "unit": "",
                                "type": "date_range",
                            }
                        )
                except Exception as exc:
                    logger.debug(
                        "KPI date range skipped for %s.%s: %s", table, date_col, exc
                    )
    finally:
        conn.close()

    return cards


def _build_live_funnel(entities: list[dict]) -> list[dict] | None:
    """Build a process funnel from the user's real order/transaction data.

    Every count is real: the total row count plus, when the table has a
    status-like column, the actual per-status breakdown from DuckDB. No
    stage is ever fabricated — if there is no status column the funnel is
    just the single true total. Returns None if no suitable table exists.
    """
    order_keywords = {
        "order",
        "ordine",
        "ordini",
        "transaction",
        "sale",
        "vendita",
        "vendite",
        "invoice",
        "fattura",
        "fatture",
        "purchase",
        "booking",
        "contract",
        "deal",
        "shipment",
        "delivery",
        "consegna",
    }
    order_entity = None
    for e in entities:
        tbl = e.get("table", "").lower()
        # Strip common DWH prefixes/suffixes before matching (fact_, dim_, _fact, _detail)
        tbl_stripped = (
            tbl.removeprefix("fact_")
            .removeprefix("dim_")
            .removeprefix("stg_")
            .removesuffix("_fact")
            .removesuffix("_detail")
            .removesuffix("_line")
        )
        if any(kw in tbl_stripped for kw in order_keywords):
            order_entity = e
            break

    if order_entity is None:
        return None

    total = order_entity.get("record_count") or 0
    if total == 0:
        return None

    table = order_entity.get("table", "")
    label = order_entity.get("name") or table
    stages: list[dict] = [{"stage": f"{label} — total", "count": total, "value": 100}]

    # Match status column by exact name OR by substring (handles compound names
    # like "order_status_code", "delivery_status_flag", "stato_ordine_attuale").
    status_col = next(
        (
            c
            for c in order_entity.get("columns", [])
            if isinstance(c, str)
            and (
                c.lower() in _FUNNEL_STATUS_COLUMNS
                or any(sub in c.lower() for sub in _FUNNEL_STATUS_SUBSTRINGS)
            )
        ),
        None,
    )
    if (
        status_col
        and _FUNNEL_IDENT_RE.match(table)
        and _FUNNEL_IDENT_RE.match(status_col)
    ):
        try:
            from .connectors.duckdb_source_manager import get_source_manager

            mgr = get_source_manager(_SCENARIO_PATH)
            conn = mgr.get_connection()
            try:
                rows = conn.execute(
                    f'SELECT "{status_col}" AS s, COUNT(*) AS n '  # noqa: S608
                    f'FROM "{table}" GROUP BY 1 ORDER BY 2 DESC LIMIT 5'
                ).fetchall()
            finally:
                conn.close()
            for val, cnt in rows:
                pct = round(100 * int(cnt) / total) if total else 0
                stages.append(
                    {
                        "stage": str(val) if val is not None else "(no status)",
                        "count": int(cnt),
                        "value": pct,
                    }
                )
        except Exception as exc:
            logger.debug("Live funnel status breakdown skipped: %s", exc)

    return stages


def _build_process_stages(entities: list[dict]) -> list[dict]:
    """Infer process stage labels from entity names."""
    stage_keywords = {
        "quote": "Quote",
        "preventivo": "Preventivo",
        "order": "Order",
        "ordine": "Ordine",
        "ordini": "Ordini",
        "purchase": "Purchase",
        "invoice": "Invoice",
        "fattura": "Fattura",
        "fatture": "Fatture",
        "shipment": "Shipment",
        "spedizione": "Spedizione",
        "delivery": "Delivery",
        "consegna": "Consegna",
        "payment": "Payment",
        "pagamento": "Pagamento",
        "return": "Return",
        "reso": "Reso",
    }
    seen_keys: set[str] = set()
    stages = []
    for e in entities:
        raw = e.get("table", "").lower()
        # Strip DWH prefixes/suffixes so "fact_orders" matches "order", etc.
        tbl = (
            raw.removeprefix("fact_")
            .removeprefix("dim_")
            .removeprefix("stg_")
            .removesuffix("_fact")
            .removesuffix("_detail")
            .removesuffix("_line")
        )
        for kw, label in stage_keywords.items():
            if kw in tbl and kw not in seen_keys:
                seen_keys.add(kw)
                stages.append(
                    {"key": kw, "label": label, "count": e.get("record_count") or 0}
                )
                break
    return stages[:5]


@app.get("/api/semantic/live-config", tags=["semantic"])
def get_live_config(
    _user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict:
    """Return a live-derived sector config: connectors, ontology nodes/edges, metrics."""
    _ensure_semantic_loaded()

    if not _semantic_state.get("loaded"):
        return {
            "name": "Your Dataset",
            "domain": "",
            "connectors": [],
            "ontology": {"nodes": [], "edges": []},
            "metrics": [],
            "funnel": None,
            "process_stages": [],
            "kpi_stats": [],
            "built_at": datetime.utcnow().isoformat(),
        }

    catalog = _semantic_state.get("catalog")
    kg = _semantic_state.get("kg")
    hidden = _hidden_demo_tables(_user)

    # ── Entities & relations from catalog/kg ──────────────────────────────────
    all_entities: list[dict] = catalog.get_draft_entities() if catalog else []
    entities = [e for e in all_entities if e["table"] not in hidden]
    metrics_raw: list[dict] = catalog.get_draft_metrics() if catalog else []
    if hidden and not entities:
        # Live workspace with no real sources yet: metrics all come from demo.
        metrics_raw = []
    # Relations reference KG node-id prefixes, which can be entity names or
    # table names depending on the build path — hide both forms.
    hidden_keys = set(hidden) | {
        e["name"] for e in all_entities if e["table"] in hidden
    }

    relations: list[dict] = []
    if kg:
        seen: set[tuple] = set()
        for src, dst, data in kg.iter_edges():
            edge_type = data.get("type", "")
            src_table = src.split(":")[0]
            dst_table = dst.split(":")[0]
            if src_table in hidden_keys or dst_table in hidden_keys:
                continue
            key = (src_table, dst_table, edge_type)
            if key not in seen:
                seen.add(key)
                relations.append(
                    {
                        "from_table": src_table,
                        "to_table": dst_table,
                        "via_column": edge_type[3:]
                        if edge_type.startswith("FK_")
                        else "",
                        "edge_type": edge_type,
                    }
                )

    # ── Connectors & domain from source registry ──────────────────────────────
    from .connectors.source_registry import get_source_registry

    registry = get_source_registry()
    sources = [c for c in registry.list() if c.connector_type not in ("context_doc",)]
    if hidden:
        sources = [c for c in sources if not c.is_default]
    connector_names = [c.label for c in sources] if sources else []

    # Build domain string from connector types
    type_labels = []
    seen_types: set[str] = set()
    for c in sources:
        ct = c.connector_type
        if ct not in seen_types:
            seen_types.add(ct)
            type_labels.append(ct.replace("_", " ").title())
    domain = " × ".join(type_labels) if type_labels else ""

    # Dataset name: first source label or fallback
    name = sources[0].label if sources else "Your Dataset"

    # ── Auto-layout & build graph nodes ──────────────────────────────────────
    positions = _auto_layout_positions(entities, relations)

    # Build a lookup: table → entity name
    table_to_name: dict[str, str] = {}
    for e in entities:
        table_to_name[e["table"]] = e["name"]

    nodes = []
    for e in entities:
        nodes.append(
            {
                "id": e["name"],
                "type": "ontologyNode",
                "position": positions.get(e["name"], {"x": 80, "y": 100}),
                "data": {
                    "label": e["name"],
                    "uri": f"aw:{e['name']}",
                    "db_table": e["table"],
                    "row_count": e.get("record_count", 0),
                    "properties": [
                        {"name": col, "type": "string"}
                        for col in e.get("columns", [])[:15]
                    ],
                },
            }
        )

    # ── Build graph edges ─────────────────────────────────────────────────────
    edges = []
    seen_edges: set[tuple] = set()
    for r in relations:
        src_name = table_to_name.get(r["from_table"])
        dst_name = table_to_name.get(r["to_table"])
        if src_name is None or dst_name is None:
            continue
        edge_key = (src_name, dst_name)
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        edges.append(
            {
                "id": f"{r['from_table']}-{r['to_table']}",
                "source": src_name,
                "target": dst_name,
                "type": "smoothstep",
                "animated": False,
                "label": r.get("via_column", ""),
            }
        )

    metrics = [
        {
            "name": m["name"],
            "label": m.get("label") or m["name"],
            "formula": m.get("formula", ""),
            "unit": m.get("unit", ""),
        }
        for m in metrics_raw
    ]

    return {
        "name": name,
        "domain": domain,
        "connectors": connector_names,
        "ontology": {"nodes": nodes, "edges": edges},
        "metrics": metrics,
        "funnel": _build_live_funnel(entities),
        "process_stages": _build_process_stages(entities),
        "kpi_stats": _build_live_kpi_stats(entities),
        "built_at": datetime.utcnow().isoformat(),
    }


# ── Custom Agents persistence ─────────────────────────────────────────────────
#
# A lightweight SQLite store (separate from the main DuckDB pipeline) that
# persists user-defined agent definitions so they survive browser cache clears
# and work across devices.

_DEFAULT_DATA_DIR = Path(__file__).parent.parent / "data"


def _user_db_path(filename: str) -> Path:
    """Resolve a user-data SQLite file under DATA_DIR (default: backend/data).

    Earlier versions defaulted DATA_DIR to the process CWD, so saved agents,
    queries and ontology extensions ended up wherever uvicorn happened to be
    launched from — and silently "disappeared" when the launch directory
    changed. Anchor the default next to the other databases, and move a legacy
    CWD copy into place (with its WAL sidecars) so existing data survives.
    """
    env = os.getenv("DATA_DIR", "").strip()
    base = Path(env) if env else _DEFAULT_DATA_DIR
    base.mkdir(parents=True, exist_ok=True)
    target = base / filename
    legacy = Path.cwd() / filename
    target_empty = not target.exists() or target.stat().st_size == 0
    if not env and target_empty and legacy.exists() and legacy != target:
        try:
            for suffix in ("", "-wal", "-shm"):
                src = Path(str(legacy) + suffix)
                if src.exists():
                    src.replace(Path(str(target) + suffix))
            logger.info("Migrated legacy %s from CWD into %s", filename, base)
        except OSError as exc:
            logger.warning("Could not migrate legacy %s: %s", filename, exc)
    return target


_AGENTS_DB_PATH = _user_db_path("custom_agents.db")


def _agents_db() -> _sqlite3.Connection:
    conn = _sqlite3.connect(str(_AGENTS_DB_PATH))
    conn.row_factory = _sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS custom_agents (
            id          TEXT PRIMARY KEY,
            sector_id   TEXT NOT NULL,
            name        TEXT NOT NULL,
            description TEXT DEFAULT '',
            template    TEXT DEFAULT 'monitor',
            entities    TEXT DEFAULT '[]',
            findings    TEXT DEFAULT '[]',
            actions     TEXT DEFAULT '[]',
            trigger     TEXT DEFAULT '{"kind":"manual"}',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            last_run_at TEXT
        )
        """
    )
    conn.commit()
    return conn


class CustomAgentPayload(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    sector_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    template: str = Field(default="monitor", max_length=64)
    entities: list[Annotated[str, Field(max_length=200)]] = Field(
        default_factory=list, max_length=100
    )
    findings: list[dict] = Field(default_factory=list, max_length=500)
    actions: list[Annotated[str, Field(max_length=500)]] = Field(
        default_factory=list, max_length=50
    )
    trigger: dict = Field(default_factory=lambda: {"kind": "manual"})
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        max_length=64,
    )
    last_run_at: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _validate_trigger(self) -> "CustomAgentPayload":
        if len(self.trigger) > 16:
            raise ValueError("trigger dict must not exceed 16 keys")
        return self


def _row_to_agent(row: _sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "sector_id": row["sector_id"],
        "name": row["name"],
        "description": row["description"],
        "template": row["template"],
        "entities": json.loads(row["entities"] or "[]"),
        "findings": json.loads(row["findings"] or "[]"),
        "actions": json.loads(row["actions"] or "[]"),
        "trigger": json.loads(row["trigger"] or '{"kind":"manual"}'),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "last_run_at": row["last_run_at"],
    }


@app.get("/api/agents/custom", tags=["agents"])
def list_custom_agents(
    sector_id: str = Query(default=DEFAULT_SECTOR, max_length=128),
    limit: int = Query(default=200, ge=1, le=1000),
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict]:
    conn = _agents_db()
    try:
        rows = conn.execute(
            "SELECT * FROM custom_agents WHERE sector_id = ? ORDER BY created_at DESC LIMIT ?",
            (sector_id, limit),
        ).fetchall()
        return [_row_to_agent(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/agents/custom", status_code=201, tags=["agents"])
def create_custom_agent(
    body: CustomAgentPayload,
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    conn = _agents_db()
    try:
        conn.execute(
            """
            INSERT INTO custom_agents
              (id, sector_id, name, description, template, entities, findings,
               actions, trigger, created_at, updated_at, last_run_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              name=excluded.name, description=excluded.description,
              template=excluded.template, entities=excluded.entities,
              findings=excluded.findings, actions=excluded.actions,
              trigger=excluded.trigger, updated_at=excluded.updated_at,
              last_run_at=excluded.last_run_at
            """,
            (
                body.id,
                body.sector_id,
                body.name,
                body.description,
                body.template,
                json.dumps(body.entities),
                json.dumps(body.findings),
                json.dumps(body.actions),
                json.dumps(body.trigger),
                body.created_at,
                now,
                body.last_run_at,
            ),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM custom_agents WHERE id=?", (body.id,)
        ).fetchone()
        return _row_to_agent(row)
    except _sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=503, detail="Database temporarily unavailable"
        ) from exc
    finally:
        conn.close()


@app.put("/api/agents/custom/{agent_id}", tags=["agents"])
def update_custom_agent(
    agent_id: Annotated[str, _ApiPath(max_length=128)],
    body: CustomAgentPayload,
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    conn = _agents_db()
    try:
        row = conn.execute(
            "SELECT id FROM custom_agents WHERE id=?", (agent_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Agent not found")
        conn.execute(
            """
            UPDATE custom_agents SET
              name=?, description=?, template=?, entities=?, findings=?,
              actions=?, trigger=?, updated_at=?, last_run_at=?
            WHERE id=?
            """,
            (
                body.name,
                body.description,
                body.template,
                json.dumps(body.entities),
                json.dumps(body.findings),
                json.dumps(body.actions),
                json.dumps(body.trigger),
                now,
                body.last_run_at,
                agent_id,
            ),
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM custom_agents WHERE id=?", (agent_id,)
        ).fetchone()
        return _row_to_agent(updated)
    except _sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=503, detail="Database temporarily unavailable"
        ) from exc
    finally:
        conn.close()


@app.delete("/api/agents/custom/{agent_id}", status_code=204, tags=["agents"])
def delete_custom_agent(
    agent_id: Annotated[str, _ApiPath(max_length=128)],
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> None:
    conn = _agents_db()
    try:
        conn.execute("DELETE FROM custom_agents WHERE id=?", (agent_id,))
        conn.commit()
    except _sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=503, detail="Database temporarily unavailable"
        ) from exc
    finally:
        conn.close()


# ── Saved queries ─────────────────────────────────────────────────────────────

_QUERIES_DB_PATH = _user_db_path("saved_queries.db")


def _queries_db() -> _sqlite3.Connection:
    conn = _sqlite3.connect(str(_QUERIES_DB_PATH))
    conn.row_factory = _sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS saved_queries (
            id TEXT PRIMARY KEY,
            sector_id TEXT NOT NULL,
            query TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"""
    )
    conn.commit()
    return conn


class SavedQueryPayload(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    sector_id: str = Field(min_length=1, max_length=128)
    query: str = Field(min_length=1, max_length=8000)
    created_at: str = Field(max_length=64)


@app.get("/api/queries/saved", tags=["queries"])
def list_saved_queries(
    sector_id: str = Query(min_length=1, max_length=128),
    limit: int = Query(default=100, ge=1, le=500),
    _user: dict = Depends(get_current_user),
):
    conn = _queries_db()
    try:
        rows = conn.execute(
            "SELECT * FROM saved_queries WHERE sector_id = ? ORDER BY created_at DESC LIMIT ?",
            (sector_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/queries/saved", status_code=201, tags=["queries"])
def save_query(
    body: SavedQueryPayload,
    _user: dict = Depends(get_current_user),
):
    conn = _queries_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO saved_queries (id, sector_id, query, created_at) VALUES (?,?,?,?)",
            (body.id, body.sector_id, body.query, body.created_at),
        )
        conn.commit()
        return dict(
            conn.execute(
                "SELECT * FROM saved_queries WHERE id=?", (body.id,)
            ).fetchone()
        )
    except _sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=503, detail="Database temporarily unavailable"
        ) from exc
    finally:
        conn.close()


@app.delete("/api/queries/saved/{query_id}", status_code=204, tags=["queries"])
def delete_saved_query(
    query_id: Annotated[str, _ApiPath(max_length=128)],
    _user: dict = Depends(get_current_user),
):
    conn = _queries_db()
    try:
        conn.execute("DELETE FROM saved_queries WHERE id=?", (query_id,))
        conn.commit()
    except _sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=503, detail="Database temporarily unavailable"
        ) from exc
    finally:
        conn.close()


# ── Ontology builder extension persistence ───────────────────────────────────
# The Ontology Builder keeps its working copy in browser localStorage for
# instant rendering; these endpoints make it durable so a user's hand-built
# ontology survives a new browser, device, or cleared storage.

_ONTOLOGY_EXT_DB_PATH = _user_db_path("ontology_extensions.db")
_ONTOLOGY_EXT_MAX_BYTES = 1 * 1024 * 1024  # 1 MB per workspace document


def _ontology_ext_db() -> _sqlite3.Connection:
    conn = _sqlite3.connect(str(_ONTOLOGY_EXT_DB_PATH))
    conn.row_factory = _sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS ontology_extensions (
            workspace_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
    conn.commit()
    return conn


class OntologyExtensionPayload(BaseModel):
    payload: dict[str, Any]

    @model_validator(mode="after")
    def _validate_size(self) -> "OntologyExtensionPayload":
        if len(json.dumps(self.payload)) > _ONTOLOGY_EXT_MAX_BYTES:
            raise ValueError("ontology extension exceeds 1 MB limit")
        return self


def _check_workspace_mode(workspace_id: str, user: UserPrincipal) -> None:
    """Enforce demo/live workspace isolation on the extension store.

    The frontend derives workspace IDs from the JWT mode: bare sector ids in
    demo, ``live-`` prefixed in live. Without a server-side check, any valid
    token could read or overwrite the other mode's ontology document by simply
    passing its workspace_id.
    """
    is_live_ws = workspace_id.startswith("live-")
    if user.mode == "live" and not is_live_ws:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Live-mode sessions can only access 'live-' workspaces",
        )
    if user.mode != "live" and is_live_ws:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo-mode sessions cannot access 'live-' workspaces",
        )


@app.get("/api/ontology/extension", tags=["ontology"])
def get_ontology_extension(
    workspace_id: str = Query(min_length=1, max_length=128),
    _user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    _check_workspace_mode(workspace_id, _user)
    conn = _ontology_ext_db()
    try:
        row = conn.execute(
            "SELECT payload, updated_at FROM ontology_extensions WHERE workspace_id=?",
            (workspace_id,),
        ).fetchone()
        if row is None:
            return {"payload": None, "updated_at": None}
        try:
            payload = json.loads(row["payload"])
        except ValueError:
            payload = None
        return {"payload": payload, "updated_at": row["updated_at"]}
    finally:
        conn.close()


@app.put("/api/ontology/extension", tags=["ontology"])
def put_ontology_extension(
    body: OntologyExtensionPayload,
    workspace_id: str = Query(min_length=1, max_length=128),
    _user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    _check_workspace_mode(workspace_id, _user)
    now = datetime.now(timezone.utc).isoformat()
    conn = _ontology_ext_db()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO ontology_extensions "
            "(workspace_id, payload, updated_at) VALUES (?,?,?)",
            (workspace_id, json.dumps(body.payload), now),
        )
        conn.commit()
        return {"ok": True, "updated_at": now}
    except _sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=503, detail="Database temporarily unavailable"
        ) from exc
    finally:
        conn.close()
