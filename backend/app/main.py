"""
SemanticIntelligence – FastAPI application entry point.
"""

import base64
import hashlib
import hmac
import json
import sqlite3 as _sqlite3
import logging
import os
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
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
from .agentic.executive import ExecutiveAgenticLayer
from .agentic.router import build_agent_router
from .ontology.manufacturing import get_ontology
from .ontology.mapper import get_flat_mappings, get_mappings, update_mapping
from .semantic.doc_loader import DocLoader
from .semantic.template_generator import generate_templates_from_draft
from .context.router import router as context_router
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


def _login_limit_key(request: Request) -> str:
    return f"ip:{get_remote_address(request)}"


def _semantic_limit_key(request: Request) -> str:
    # Prefer token fingerprint as user key; fallback to remote IP.
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        token_fingerprint = hashlib.sha256(auth.encode("utf-8")).hexdigest()[:20]
        return f"token:{token_fingerprint}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=get_remote_address)

_semantic_redis_client: Any = None
_semantic_redis_client_initialized = False
_semantic_redis_lock = threading.Lock()
_semantic_cache_namespace = 0
_semantic_ns_lock = threading.Lock()


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


def _semantic_cache_key(question: str, context: dict[str, Any]) -> str:
    payload = json.dumps(
        {"q": question.strip(), "ctx": context},
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"semantic:ask:v{_semantic_cache_namespace}:{digest}"


def _bump_semantic_cache_namespace() -> None:
    global _semantic_cache_namespace
    with _semantic_ns_lock:
        _semantic_cache_namespace += 1


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


def _verify_password(password: str, stored_hash: str) -> bool:
    """Verify passwords stored as pbkdf2_sha256$iterations$salt$hash."""
    try:
        scheme, iters_raw, salt, expected = stored_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iters_raw)
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
    subject: str, role: Literal["admin", "user"]
) -> tuple[str, int]:
    secret = _get_jwt_secret()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
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


class UserPrincipal(BaseModel):
    username: str
    role: Literal["admin", "user"]


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

    return UserPrincipal(username=subject, role=role)


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

        catalog = MetadataCatalog()
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
        # Seed golden query templates on first install (never overwrites existing)
        from app.semantic.seed_templates import SEED_TEMPLATES

        n = catalog.seed_default_templates(SEED_TEMPLATES)
        if n:
            logger.info("Seeded %d default query templates", n)
        # Seed default glossary terms as context docs on first install
        from app.semantic.glossary import DEFAULT_GLOSSARY

        n = catalog.seed_glossary_docs(DEFAULT_GLOSSARY)
        if n:
            logger.info("Seeded %d glossary terms as context docs", n)
        # Load user-defined query templates into the semantic layer
        layer.set_templates(catalog.list_templates())
        # Inject any registered context documents into the LLM prompt
        _sync_context_docs_to_layer()


def _refresh_catalog_after_rebuild(mgr) -> None:
    """Re-populate the catalog from the DuckDB snapshot after any rebuild.

    Called after mgr.rebuild() / mgr.ingest_one() so that newly added (or
    removed) tables are immediately reflected in schema-driven LLM SQL generation.
    No-op if the semantic layer hasn't been loaded yet.
    """
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        return
    try:
        catalog.populate_from_manager(mgr)
    except Exception as exc:
        logger.warning("_refresh_catalog_after_rebuild failed: %s", exc)


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


def _get_semantic_draft() -> dict:
    """Return the current semantic layer state as an editable draft dict."""
    catalog = _semantic_state.get("catalog")
    kg = _semantic_state.get("kg")

    entities = catalog.get_draft_entities() if catalog else []
    metrics = catalog.get_draft_metrics() if catalog else []

    relations: list[dict] = []
    if kg:
        seen: set[tuple] = set()
        for src, dst, data in kg.all_edges():
            edge_type = data.get("type", "")
            src_table = src.split(":")[0]
            dst_table = dst.split(":")[0]
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

    return {
        "entities": entities,
        "relations": relations,
        "metrics": metrics,
        "context_docs": context_docs,
        "templates": catalog.list_templates() if catalog else [],
        "loaded": _semantic_state.get("loaded", False),
        "built_at": datetime.utcnow().isoformat(),
    }


def _hot_reload_templates() -> None:
    """Push fresh templates to the live SemanticLayer instance."""
    _ensure_semantic_loaded()
    layer = _semantic_state.get("layer")
    catalog = _semantic_state.get("catalog")
    if layer is not None and catalog is not None:
        layer.set_templates(catalog.list_templates())


def reload_semantic() -> None:
    """Force full rebuild of the semantic stack (thread-safe)."""
    with _semantic_init_lock:
        _semantic_state["loaded"] = False
    _ensure_semantic_loaded()
    _sync_context_docs_to_layer()


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
    user_description: str | None = None
    context_notes: str | None = None


class MetricDraftUpdate(BaseModel):
    description: str | None = None
    formula: str | None = None
    label: str | None = None


class ContextDocCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20000)


class QueryTemplatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    sql_query: str = Field(min_length=10, max_length=8000)
    keywords: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)

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
    keywords: list[str] | None = None
    sources: list[str] | None = None

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


def _get_agentic_ontology() -> Any:
    _ensure_semantic_loaded()
    return _semantic_state.get("ontology")


_agentic_layer = ExecutiveAgenticLayer(
    get_ontology=_get_agentic_ontology,
    get_db_connection=get_connection,
)
app.include_router(build_agent_router(_agentic_layer, require_roles("admin")))
app.include_router(
    context_router,
    dependencies=[Depends(require_roles("user", "admin"))],
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

    token, expires_in = _create_access_token(
        subject=user["username"],
        role=user["role"],
    )
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        role=user["role"],
    )


@app.get("/api/dashboard", response_model=DashboardData)
def dashboard(
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> DashboardData:
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
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    onto = get_ontology()
    return onto.get_ontology_graph_data()


@app.get("/api/ontology/mappings", response_model=MappingsResponse)
def ontology_mappings(
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> MappingsResponse:
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
    table: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> PaginatedData:
    # Auto-discover available tables from DuckDB instead of hardcoded whitelist
    from .connectors.duckdb_source_manager import get_source_manager

    try:
        duckdb_conn = get_source_manager(_SCENARIO_PATH).get_connection()
        try:
            available = {
                row[0] for row in duckdb_conn.execute("SHOW TABLES").fetchall()
            }
        finally:
            duckdb_conn.close()
    except Exception:
        available = set()
    # Also include SQLite tables (the actual data backend for this endpoint)
    try:
        _sl = get_connection()
        try:
            available |= {
                row[0]
                for row in _sl.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        finally:
            _sl.close()
    except Exception:
        pass
    if table not in available:
        raise HTTPException(status_code=404, detail=f"Table '{table}' not found")

    conn = get_connection()
    try:
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        offset = (page - 1) * page_size
        rows = conn.execute(
            f"SELECT * FROM {table} LIMIT ? OFFSET ?", (page_size, offset)
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


@app.get("/api/semantic/status")
def semantic_status(
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    """Return the current status of the semantic layer (loaded/not loaded)."""
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
    return {
        "loaded": True,
        "entities": catalog.list_entities(),
        "kg_nodes": kg.node_count,
        "kg_edges": kg.edge_count,
        "metadata_rows": catalog.row_count(),
        "sources": list(_semantic_state.get("mgr").describe().tables)
        if _semantic_state.get("mgr")
        else ["erp", "crm", "hr_pim"],
        "dedup_count": kg.dedup_count,
    }


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

    merged_context = {"session_id": req.session_id, **(req.context or {})}
    redis_client = _get_semantic_redis_client()
    cache_key = _semantic_cache_key(question, merged_context)
    if redis_client is not None:
        try:
            cached_payload = redis_client.get(cache_key)
            if isinstance(cached_payload, str) and cached_payload.strip():
                return SemanticAskResponse.model_validate_json(cached_payload)
        except Exception:
            pass

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
        result = layer.ask(question, context=merged_context, docs_override=merged_docs)
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
        if redis_client is not None:
            try:
                redis_client.setex(
                    cache_key,
                    _semantic_cache_ttl_seconds(),
                    response_model.model_dump_json(),
                )
            except Exception:
                pass
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
    _: UserPrincipal = Depends(require_roles("admin")),
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
        kg = _semantic_state["kg"]
        catalog = _semantic_state["catalog"]
        return {
            "success": True,
            "kg_nodes": kg.node_count,
            "kg_edges": kg.edge_count,
            "metadata_rows": catalog.row_count(),
            "dedup_count": kg.dedup_count,
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
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    """Return metadata about the unified DuckDB snapshot."""
    from .connectors.duckdb_source_manager import get_source_manager

    try:
        mgr = get_source_manager(_SCENARIO_PATH)
        meta = mgr.describe()
        return {
            "source_type": meta.source_type,
            "built_at": meta.loaded_at.isoformat() if meta.loaded_at else None,
            "tables": meta.tables,
            "row_counts": meta.record_counts,
            "total_rows": sum(meta.record_counts.values()),
            "notes": meta.notes,
        }
    except Exception as exc:
        return {"error": str(exc)}


@app.post("/api/data/store/rebuild")
def rebuild_data_store(
    _: UserPrincipal = Depends(require_roles("admin")),
) -> dict[str, Any]:
    """Force full re-ingest of all sources into the DuckDB snapshot. Admin-only."""
    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    row_counts = mgr.rebuild()
    meta = mgr.describe()
    _refresh_catalog_after_rebuild(mgr)
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


def _source_cfg_to_response(cfg) -> SourceResponse:
    return SourceResponse(
        id=cfg.id,
        connector_type=cfg.connector_type,
        label=cfg.label,
        params={
            k: v for k, v in cfg.params.items() if k not in ("api_key", "password")
        },
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
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[SourceResponse]:
    """List all configured data sources."""
    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    return [_source_cfg_to_response(s) for s in mgr.registry.list()]


@app.post("/api/sources", response_model=SourceResponse, status_code=201)
def add_source(
    req: SourceAddRequest,
    _: UserPrincipal = Depends(require_roles("admin")),
) -> SourceResponse:
    """Register a new data source. Triggers a DuckDB rebuild for implemented types."""
    import uuid
    from .connectors.duckdb_source_manager import get_source_manager
    from .connectors.source_registry import SourceConfig, IMPLEMENTED_CONNECTOR_TYPES

    mgr = get_source_manager(_SCENARIO_PATH)
    source_id = req.params.get("id") or f"{req.connector_type}-{uuid.uuid4().hex[:8]}"
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
            _refresh_catalog_after_rebuild(mgr)
        except Exception as exc:
            mgr.registry.patch(source_id, status="error", error_msg=str(exc))
            cfg = mgr.registry.get(source_id) or cfg

    return _source_cfg_to_response(cfg)


@app.delete("/api/sources/{source_id}", status_code=204)
def remove_source(
    source_id: str,
    _: UserPrincipal = Depends(require_roles("admin")),
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
    try:
        mgr.rebuild()
        _refresh_catalog_after_rebuild(mgr)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Source removed from registry but snapshot rebuild failed: {exc}",
        )


@app.post("/api/sources/{source_id}/sync", response_model=SourceResponse)
def sync_source(
    source_id: str,
    _: UserPrincipal = Depends(require_roles("admin")),
) -> SourceResponse:
    """Re-ingest a single source and rebuild the DuckDB snapshot."""
    from .connectors.duckdb_source_manager import get_source_manager

    mgr = get_source_manager(_SCENARIO_PATH)
    cfg = mgr.registry.get(source_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail=f"Source '{source_id}' not found")
    try:
        mgr.ingest_one(source_id)
        _refresh_catalog_after_rebuild(mgr)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    cfg = mgr.registry.get(source_id) or cfg
    return _source_cfg_to_response(cfg)


# ── Semantic sources ───────────────────────────────────────────────────────────


@app.get("/api/semantic/sources")
def semantic_sources(
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    """Return real data source metadata with freshness."""
    _ensure_semantic_loaded()
    mgr = _semantic_state.get("mgr")

    # Prefer unified mgr-based source info (reflects actual registered sources)
    if mgr is not None:
        try:
            meta = mgr.describe()
            built_at = meta.loaded_at
            if built_at is not None:
                age_h = (datetime.utcnow() - built_at).total_seconds() / 3600
                freshness = (
                    "fresh" if age_h < 24 else "stale" if age_h < 168 else "outdated"
                )
            else:
                freshness = "unknown"
            non_empty = sum(1 for c in meta.record_counts.values() if c > 0)
            quality = round(100 * non_empty / max(len(meta.tables), 1))
            return [
                {
                    "id": "unified",
                    "name": meta.name,
                    "source_type": meta.source_type,
                    "tables": meta.tables,
                    "record_counts": meta.record_counts,
                    "total_rows": sum(meta.record_counts.values()),
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
    sector_id: str = Query(default="manufacturing", max_length=64),
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM sl_metrics WHERE sector_id = ? ORDER BY is_builtin DESC, name",
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
    metric_id: str,
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
    sector_id: str = Query(default="manufacturing", max_length=64),
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM sl_hierarchies WHERE sector_id = ? ORDER BY is_builtin DESC, name",
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
    hierarchy_id: str,
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
    sector_id: str = Query(default="manufacturing", max_length=64),
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM sl_segments WHERE sector_id = ? ORDER BY is_builtin DESC, name",
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
    segment_id: str,
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
    sector_id: str = "manufacturing",
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    conn = get_connection()
    try:
        n_metrics = conn.execute(
            "SELECT COUNT(*) FROM sl_metrics WHERE sector_id=?", (sector_id,)
        ).fetchone()[0]
        n_hierarchies = conn.execute(
            "SELECT COUNT(*) FROM sl_hierarchies WHERE sector_id=?", (sector_id,)
        ).fetchone()[0]
        n_segments = conn.execute(
            "SELECT COUNT(*) FROM sl_segments WHERE sector_id=?", (sector_id,)
        ).fetchone()[0]
    finally:
        conn.close()

    status = semantic_status()
    n_entities = len(status.get("entities", []))

    breakdown = {
        "sources": 100 if status.get("loaded") else 0,
        "entities": min(100, n_entities * 10),
        "bridges": 100 if status.get("loaded") else 0,
        "rules": 100 if status.get("loaded") else 0,
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
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    """Force a full rebuild of the KG + catalog, then return the draft config."""
    import asyncio

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, reload_semantic)
    # Auto-generate templates from the freshly-built schema
    catalog = _semantic_state.get("catalog")
    layer = _semantic_state.get("layer")
    if catalog is not None and layer is not None:
        draft = _get_semantic_draft()
        auto_tpls = generate_templates_from_draft(draft)
        n = catalog.upsert_auto_templates(auto_tpls)
        logger.info("Auto-generated %d query templates from semantic layer", n)
        layer.set_templates(catalog.list_templates())
    return _get_semantic_draft()


@app.get(
    "/api/semantic/draft",
    tags=["semantic"],
    summary="Get current semantic layer draft (entities, relations, metrics, context)",
)
def get_semantic_draft_endpoint(
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    _ensure_semantic_loaded()
    return _get_semantic_draft()


@app.patch(
    "/api/semantic/draft/entities/{name}",
    tags=["semantic"],
    summary="Update user description and context notes for an entity",
)
def patch_draft_entity(
    name: str,
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
    name: str,
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
    doc_id: str,
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> dict[str, Any]:
    from .connectors.source_registry import get_source_registry

    registry = get_source_registry()
    cfg = registry.get(doc_id)
    if cfg is None or cfg.connector_type != "context_doc":
        raise HTTPException(status_code=404, detail="Context document not found")
    registry.remove(doc_id)
    _sync_context_docs_to_layer()
    return {"ok": True}


# ── Query Templates CRUD ─────────────────────────────────────────────────────


@app.get("/api/semantic/templates", tags=["semantic"])
async def list_templates(
    _user: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict]:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    return catalog.list_templates()


@app.post("/api/semantic/templates", status_code=201, tags=["semantic"])
async def create_template(
    payload: QueryTemplatePayload,
    _admin: UserPrincipal = Depends(require_roles("admin")),
) -> dict:
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        raise HTTPException(status_code=503, detail="Semantic layer not loaded")
    tpl = catalog.create_template(
        name=payload.name,
        description=payload.description,
        sql_query=payload.sql_query,
        keywords=payload.keywords,
        sources=payload.sources,
    )
    _hot_reload_templates()
    return tpl


@app.patch("/api/semantic/templates/{template_id}", tags=["semantic"])
async def update_template(
    template_id: int,
    payload: QueryTemplateUpdatePayload,
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
    return tpl


@app.delete("/api/semantic/templates/{template_id}", status_code=204, tags=["semantic"])
async def delete_template(
    template_id: int,
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


@app.get("/api/semantic/example-questions", tags=["semantic"])
def list_example_questions() -> list[dict[str, str]]:
    """Return example questions derived from active query templates (public, no auth)."""
    _ensure_semantic_loaded()
    catalog = _semantic_state.get("catalog")
    if catalog is None:
        return []
    templates = catalog.list_templates()
    active = [t for t in templates if t.get("is_active", True)]
    active_sorted = sorted(active, key=lambda t: t.get("name", ""))
    return [
        {"question": t["name"], "description": t.get("description", "")}
        for t in active_sorted[:12]
    ]


# ── Live Config endpoint ──────────────────────────────────────────────────────


import math as _math


def _auto_layout_positions(entities: list[dict], relations: list[dict]) -> dict[str, dict]:
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


@app.get("/api/semantic/live-config", tags=["semantic"])
async def get_live_config(
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
            "built_at": datetime.utcnow().isoformat(),
        }

    catalog = _semantic_state.get("catalog")
    kg = _semantic_state.get("kg")

    # ── Entities & relations from catalog/kg ──────────────────────────────────
    entities: list[dict] = catalog.get_draft_entities() if catalog else []
    metrics_raw: list[dict] = catalog.get_draft_metrics() if catalog else []

    relations: list[dict] = []
    if kg:
        seen: set[tuple] = set()
        for src, dst, data in kg.all_edges():
            edge_type = data.get("type", "")
            src_table = src.split(":")[0]
            dst_table = dst.split(":")[0]
            key = (src_table, dst_table, edge_type)
            if key not in seen:
                seen.add(key)
                relations.append(
                    {
                        "from_table": src_table,
                        "to_table": dst_table,
                        "via_column": edge_type[3:] if edge_type.startswith("FK_") else "",
                        "edge_type": edge_type,
                    }
                )

    # ── Connectors & domain from source registry ──────────────────────────────
    from .connectors.source_registry import get_source_registry

    registry = get_source_registry()
    sources = [
        c for c in registry.list()
        if c.connector_type not in ("context_doc",)
    ]
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
        "built_at": datetime.utcnow().isoformat(),
    }


# ── Custom Agents persistence ─────────────────────────────────────────────────
#
# A lightweight SQLite store (separate from the main DuckDB pipeline) that
# persists user-defined agent definitions so they survive browser cache clears
# and work across devices.

_AGENTS_DB_PATH = Path(os.getenv("DATA_DIR", ".")) / "custom_agents.db"


def _agents_db() -> _sqlite3.Connection:
    conn = _sqlite3.connect(str(_AGENTS_DB_PATH))
    conn.row_factory = _sqlite3.Row
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
    id: str
    sector_id: str
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    template: str = "monitor"
    entities: list[str] = []
    findings: list[dict] = []
    actions: list[str] = []
    trigger: dict = Field(default_factory=lambda: {"kind": "manual"})
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    last_run_at: str | None = None


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
    sector_id: str = Query(default="manufacturing"),
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> list[dict]:
    conn = _agents_db()
    try:
        rows = conn.execute(
            "SELECT * FROM custom_agents WHERE sector_id = ? ORDER BY created_at DESC",
            (sector_id,),
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
    finally:
        conn.close()


@app.put("/api/agents/custom/{agent_id}", tags=["agents"])
def update_custom_agent(
    agent_id: str,
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
    finally:
        conn.close()


@app.delete("/api/agents/custom/{agent_id}", status_code=204, tags=["agents"])
def delete_custom_agent(
    agent_id: str,
    _: UserPrincipal = Depends(require_roles("user", "admin")),
) -> None:
    conn = _agents_db()
    try:
        conn.execute("DELETE FROM custom_agents WHERE id=?", (agent_id,))
        conn.commit()
    finally:
        conn.close()


# ── Saved queries ─────────────────────────────────────────────────────────────

_QUERIES_DB_PATH = Path(os.getenv("DATA_DIR", ".")) / "saved_queries.db"


def _queries_db() -> _sqlite3.Connection:
    conn = _sqlite3.connect(str(_QUERIES_DB_PATH))
    conn.row_factory = _sqlite3.Row
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
    id: str
    sector_id: str
    query: str
    created_at: str


@app.get("/api/queries/saved", tags=["queries"])
def list_saved_queries(
    sector_id: str,
    _user: dict = Depends(get_current_user),
):
    conn = _queries_db()
    try:
        rows = conn.execute(
            "SELECT * FROM saved_queries WHERE sector_id = ? ORDER BY created_at DESC",
            (sector_id,),
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
    finally:
        conn.close()


@app.delete("/api/queries/saved/{query_id}", status_code=204, tags=["queries"])
def delete_saved_query(
    query_id: str,
    _user: dict = Depends(get_current_user),
):
    conn = _queries_db()
    try:
        conn.execute("DELETE FROM saved_queries WHERE id=?", (query_id,))
        conn.commit()
    finally:
        conn.close()
