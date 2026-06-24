"""Salesforce connector — OAuth 2.0 Authorization Code + PKCE flow.

Authentication flow (Web Server / Authorization Code + PKCE):
  1. GET  /api/salesforce/auth/start   → generate state + PKCE pair, return SF auth URL
  2. User logs in at Salesforce (popup)
  3. SF redirects → GET /api/salesforce/auth/callback?code=...&state=...
  4. Backend exchanges code+verifier for access_token + refresh_token
  5. Tokens stored in backend/data/salesforce_config.json

Token refresh (transparent):
  POST {instance_url}/services/oauth2/token  grant_type=refresh_token

Schema retrieval:
  GET /services/data/v59.0/sobjects/            → list of all SObjects
  GET /services/data/v59.0/sobjects/{obj}/describe/ → full field metadata

Ingestion into DuckDB:
  Creates two tables per source:
    sf_{source_id}_objects  — one row per SObject
    sf_{source_id}_fields   — one row per field across all objects
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

_SF_API_VERSION = "v59.0"
_DATA_DIR = Path(__file__).parent.parent.parent / "data"

# Standard SObjects most relevant for business analysis (prioritised in schema fetch)
_PRIORITY_OBJECTS = {
    "Account",
    "Contact",
    "Lead",
    "Opportunity",
    "OpportunityLineItem",
    "Product2",
    "Pricebook2",
    "PricebookEntry",
    "Case",
    "CaseComment",
    "Task",
    "Event",
    "Activity",
    "Campaign",
    "CampaignMember",
    "Quote",
    "QuoteLineItem",
    "Order",
    "OrderItem",
    "Contract",
    "Asset",
    "User",
    "UserRole",
}


# ── PKCE helpers ──────────────────────────────────────────────────────────────


def generate_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for PKCE S256."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def build_authorization_url(
    instance_url: str,
    client_id: str,
    redirect_uri: str,
    code_challenge: str,
    state: str,
) -> str:
    """Build the Salesforce OAuth2 authorization URL."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": state,
        "prompt": "login",  # always show login page, respects MFA
    }
    return f"{instance_url.rstrip('/')}/services/oauth2/authorize?{urlencode(params)}"


def exchange_code_for_token(
    instance_url: str,
    client_id: str,
    client_secret: str,
    code: str,
    code_verifier: str,
    redirect_uri: str,
) -> dict:
    """Exchange an authorization code for access_token + refresh_token.

    Returns the full token response dict from Salesforce.
    Raises SalesforceAuthError on failure.
    """
    try:
        resp = httpx.post(
            f"{instance_url.rstrip('/')}/services/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "code_verifier": code_verifier,
                "redirect_uri": redirect_uri,
            },
            timeout=30,
        )
    except httpx.RequestError as exc:
        raise SalesforceAuthError(
            f"Could not reach Salesforce at {instance_url}: {exc}"
        ) from exc

    if resp.status_code != 200:
        try:
            detail = resp.json()
            msg = detail.get("error_description") or detail.get("error") or resp.text
        except Exception:
            msg = resp.text
        raise SalesforceAuthError(
            f"Salesforce token exchange failed ({resp.status_code}): {msg}"
        )

    result = resp.json()
    if "access_token" not in result:
        raise SalesforceAuthError(
            f"Salesforce token response missing access_token: {result}"
        )
    return result


# ── Dataclasses ───────────────────────────────────────────────────────────────


@dataclass
class SalesforceField:
    name: str
    label: str
    type: str
    is_required: bool
    is_relation: bool
    relation_to: str | None


@dataclass
class SalesforceObject:
    name: str
    label: str
    field_count: int
    is_custom: bool
    key_prefix: str | None
    fields: list[SalesforceField] = field(default_factory=list)


@dataclass
class SalesforceSchema:
    instance_url: str
    org_id: str
    api_version: str
    object_count: int
    objects: list[SalesforceObject]
    fetched_at: str


@dataclass
class SchemaGraphNode:
    name: str
    label: str
    is_custom: bool
    is_queryable: bool
    key_prefix: str | None
    field_count: int


@dataclass
class SchemaGraphEdge:
    from_object: str
    to_object: str
    field_name: str
    field_label: str
    relationship_name: str | None
    is_required: bool


@dataclass
class SalesforceSchemaGraph:
    source_id: str
    instance_url: str
    org_id: str
    api_version: str
    total_objects: int
    described_objects: int
    nodes: list[SchemaGraphNode]
    edges: list[SchemaGraphEdge]
    built_at: str


# ── Errors ────────────────────────────────────────────────────────────────────


class SalesforceAuthError(ValueError):
    """Raised when Salesforce OAuth2 authentication fails."""


class SalesforceAPIError(RuntimeError):
    """Raised when a Salesforce REST API call fails."""


# ── Connector class ───────────────────────────────────────────────────────────


class SalesforceConnector:
    """Authenticated Salesforce REST API client (Authorization Code + PKCE).

    Instantiate with an access_token obtained via the PKCE flow. Provide
    refresh_token + client_id + client_secret to enable transparent refresh
    when the access_token expires (Salesforce tokens expire after ~2h).
    """

    def __init__(
        self,
        instance_url: str,
        access_token: str,
        *,
        refresh_token: str | None = None,
        client_id: str | None = None,
        client_secret: str | None = None,
    ) -> None:
        self.instance_url = instance_url.rstrip("/")
        self._access_token = access_token
        self._refresh_token = refresh_token
        self._client_id = client_id
        self._client_secret = client_secret
        self._http = httpx.Client(timeout=60)

    def _refresh_access_token(self) -> None:
        """Use the refresh_token to obtain a new access_token in-place."""
        if not (self._refresh_token and self._client_id and self._client_secret):
            raise SalesforceAuthError(
                "Access token expired and no refresh_token/credentials available to renew it. "
                "Reconnect the Salesforce source."
            )
        try:
            resp = self._http.post(
                f"{self.instance_url}/services/oauth2/token",
                data={
                    "grant_type": "refresh_token",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "refresh_token": self._refresh_token,
                },
            )
        except httpx.RequestError as exc:
            raise SalesforceAuthError(
                f"Could not reach Salesforce to refresh token: {exc}"
            ) from exc

        if resp.status_code != 200:
            try:
                msg = resp.json().get("error_description") or resp.text
            except Exception:
                msg = resp.text
            raise SalesforceAuthError(
                f"Token refresh failed ({resp.status_code}): {msg}"
            )

        result = resp.json()
        self._access_token = result["access_token"]
        if "instance_url" in result:
            self.instance_url = result["instance_url"].rstrip("/")
        logger.info("Salesforce access token refreshed")

    def _get(self, path: str) -> Any:
        """Authenticated GET to Salesforce REST API. Refreshes token on 401."""
        url = f"{self.instance_url}/services/data/{_SF_API_VERSION}{path}"
        resp = self._http.get(
            url,
            headers={"Authorization": f"Bearer {self._access_token}"},
        )
        if resp.status_code == 401:
            self._refresh_access_token()
            resp = self._http.get(
                url,
                headers={"Authorization": f"Bearer {self._access_token}"},
            )

        if resp.status_code != 200:
            raise SalesforceAPIError(
                f"Salesforce API {path} returned {resp.status_code}: {resp.text[:400]}"
            )
        return resp.json()

    def get_org_id(self) -> str:
        """Return the Organisation ID via a lightweight SOQL query."""
        try:
            result = self._get("/query?q=SELECT+Id+FROM+Organization+LIMIT+1")
            records = result.get("records", [])
            return records[0]["Id"] if records else "unknown"
        except Exception:
            return "unknown"

    def list_sobjects(self) -> list[dict]:
        """Return the raw list of all SObjects from /sobjects/."""
        result = self._get("/sobjects/")
        return result.get("sobjects", [])

    def describe_object(self, obj_name: str) -> dict:
        """Return the full describe result for one SObject."""
        return self._get(f"/sobjects/{obj_name}/describe/")

    def get_schema(self, max_objects: int = 150) -> SalesforceSchema:
        """
        Retrieve schema for up to *max_objects* SObjects.

        Priority order:
          1. Standard priority objects (Account, Contact, Opportunity, …)
          2. Other standard objects
          3. Custom objects (__c suffix)
        """
        raw_objects = self.list_sobjects()

        # Filter to queryable, non-deprecated objects
        queryable = [
            o
            for o in raw_objects
            if o.get("queryable") and not o.get("deprecatedAndHidden")
        ]

        priority = [o for o in queryable if o["name"] in _PRIORITY_OBJECTS]
        standard = [
            o
            for o in queryable
            if not o.get("custom") and o["name"] not in _PRIORITY_OBJECTS
        ]
        custom = [o for o in queryable if o.get("custom")]

        remaining = max_objects - len(priority)
        selected = priority + standard[: remaining // 2] + custom[: remaining // 2]
        selected = selected[:max_objects]

        objects: list[SalesforceObject] = []
        for obj_meta in selected:
            obj_name = obj_meta["name"]
            try:
                desc = self.describe_object(obj_name)
            except SalesforceAPIError as exc:
                logger.warning("Skipping %s: %s", obj_name, exc)
                continue

            raw_fields = desc.get("fields", [])
            sf_fields = []
            for f in raw_fields:
                refs = f.get("referenceTo") or []
                sf_fields.append(
                    SalesforceField(
                        name=f["name"],
                        label=f.get("label", f["name"]),
                        type=f["type"],
                        is_required=not f.get("nillable", True)
                        and not f.get("defaultedOnCreate", False),
                        is_relation=f["type"] in ("reference",),
                        relation_to=", ".join(refs) if refs else None,
                    )
                )

            objects.append(
                SalesforceObject(
                    name=obj_name,
                    label=obj_meta.get("label", obj_name),
                    field_count=len(sf_fields),
                    is_custom=bool(obj_meta.get("custom")),
                    key_prefix=obj_meta.get("keyPrefix"),
                    fields=sf_fields,
                )
            )

        org_id = self.get_org_id()

        return SalesforceSchema(
            instance_url=self.instance_url,
            org_id=org_id,
            api_version=_SF_API_VERSION,
            object_count=len(objects),
            objects=objects,
            fetched_at=datetime.now(timezone.utc).isoformat(),
        )

    def _post_composite_batch(self, paths: list[str]) -> list[dict]:
        """POST to /composite/batch with up to 25 sub-GET requests."""
        url = f"{self.instance_url}/services/data/{_SF_API_VERSION}/composite/batch"
        payload = {
            "batchRequests": [
                {"method": "GET", "url": f"/services/data/{_SF_API_VERSION}{p}"}
                for p in paths
            ]
        }
        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Content-Type": "application/json",
        }
        resp = self._http.post(url, json=payload, headers=headers, timeout=120)
        if resp.status_code == 401:
            self._refresh_access_token()
            headers["Authorization"] = f"Bearer {self._access_token}"
            resp = self._http.post(url, json=payload, headers=headers, timeout=120)
        if resp.status_code != 200:
            raise SalesforceAPIError(
                f"Composite batch failed {resp.status_code}: {resp.text[:400]}"
            )
        return resp.json().get("results", [])

    def get_schema_graph(self, max_objects: int = 0) -> "SalesforceSchemaGraph":
        """Discover all objects, fields, and relationships via Composite batch API.

        Phase 1: Global Describe → full list of queryable SObjects (no per-object calls).
        Phase 2: Composite batch describe, 25 objects per HTTP request.

        Returns a SalesforceSchemaGraph with nodes (objects) and edges (relationships).
        When max_objects=0 (default) all queryable objects are described.
        """
        raw = self.list_sobjects()
        queryable = [
            o
            for o in raw
            if o.get("queryable") and not o.get("deprecatedAndHidden")
        ]
        if max_objects > 0:
            queryable = queryable[:max_objects]

        node_names: set[str] = {o["name"] for o in queryable}
        name_to_node: dict[str, SchemaGraphNode] = {}
        for o in queryable:
            name_to_node[o["name"]] = SchemaGraphNode(
                name=o["name"],
                label=o.get("label", o["name"]),
                is_custom=bool(o.get("custom")),
                is_queryable=True,
                key_prefix=o.get("keyPrefix"),
                field_count=0,
            )

        edges: list[SchemaGraphEdge] = []
        paths = [f"/sobjects/{o['name']}/describe/" for o in queryable]
        _BATCH = 25

        for i in range(0, len(paths), _BATCH):
            chunk_paths = paths[i : i + _BATCH]
            chunk_objects = queryable[i : i + _BATCH]
            try:
                results = self._post_composite_batch(chunk_paths)
            except SalesforceAPIError as exc:
                logger.warning("Composite batch %d–%d failed: %s", i, i + _BATCH, exc)
                continue

            for obj_meta, result in zip(chunk_objects, results):
                if result.get("statusCode") != 200:
                    logger.debug(
                        "Describe skipped for %s: status %s",
                        obj_meta["name"],
                        result.get("statusCode"),
                    )
                    continue
                desc = result.get("result", {})
                obj_name = obj_meta["name"]
                fields = desc.get("fields", [])

                if obj_name in name_to_node:
                    name_to_node[obj_name].field_count = len(fields)

                for f in fields:
                    if f.get("type") != "reference":
                        continue
                    refs = f.get("referenceTo") or []
                    for ref in refs:
                        if ref not in node_names:
                            continue
                        edges.append(
                            SchemaGraphEdge(
                                from_object=obj_name,
                                to_object=ref,
                                field_name=f["name"],
                                field_label=f.get("label", f["name"]),
                                relationship_name=f.get("relationshipName"),
                                is_required=not f.get("nillable", True),
                            )
                        )

        org_id = self.get_org_id()
        nodes = list(name_to_node.values())
        return SalesforceSchemaGraph(
            source_id="",
            instance_url=self.instance_url,
            org_id=org_id,
            api_version=_SF_API_VERSION,
            total_objects=len(queryable),
            described_objects=sum(1 for n in nodes if n.field_count > 0),
            nodes=nodes,
            edges=edges,
            built_at=datetime.now(timezone.utc).isoformat(),
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "SalesforceConnector":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


# ── Config + schema persistence ───────────────────────────────────────────────


def save_salesforce_config(
    source_id: str,
    token_response: dict,
    client_id: str,
    client_secret: str,
) -> None:
    """Persist PKCE token response for *source_id* to backend/data/salesforce_config.json.

    *token_response* is the dict returned by exchange_code_for_token().
    Stores access_token, refresh_token, instance_url — no passwords.
    """
    config_path = _DATA_DIR / "salesforce_config.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)

    existing: dict = {}
    if config_path.exists():
        try:
            existing = json.loads(config_path.read_text())
        except Exception:
            pass

    existing[source_id] = {
        "instance_url": token_response.get("instance_url", ""),
        "access_token": token_response.get("access_token", ""),
        "refresh_token": token_response.get("refresh_token", ""),
        "client_id": client_id,
        "client_secret": client_secret,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    config_path.write_text(json.dumps(existing, indent=2))
    logger.info("Salesforce PKCE config saved for source '%s'", source_id)


def load_salesforce_config(source_id: str) -> dict | None:
    """Return the persisted credentials for *source_id*, or None."""
    config_path = _DATA_DIR / "salesforce_config.json"
    if not config_path.exists():
        return None
    try:
        data = json.loads(config_path.read_text())
        return data.get(source_id)
    except Exception:
        return None


def save_salesforce_schema(source_id: str, schema: SalesforceSchema) -> None:
    """Cache the retrieved schema to backend/data/salesforce_schema_{source_id}.json."""
    schema_path = _DATA_DIR / f"salesforce_schema_{source_id}.json"
    schema_path.parent.mkdir(parents=True, exist_ok=True)
    schema_path.write_text(json.dumps(asdict(schema), indent=2))
    logger.info(
        "Salesforce schema cached for '%s': %d objects", source_id, schema.object_count
    )


def load_salesforce_schema(source_id: str) -> dict | None:
    """Return the cached schema dict for *source_id*, or None."""
    schema_path = _DATA_DIR / f"salesforce_schema_{source_id}.json"
    if not schema_path.exists():
        return None
    try:
        return json.loads(schema_path.read_text())
    except Exception:
        return None


def delete_salesforce_config(source_id: str) -> None:
    """Remove credentials and cached schema for *source_id* on source deletion."""
    config_path = _DATA_DIR / "salesforce_config.json"
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text())
            if source_id in data:
                del data[source_id]
                config_path.write_text(json.dumps(data, indent=2))
        except Exception:
            pass

    schema_path = _DATA_DIR / f"salesforce_schema_{source_id}.json"
    if schema_path.exists():
        try:
            schema_path.unlink()
        except Exception:
            pass

    _delete_salesforce_profile(source_id)

    graph_path = _DATA_DIR / f"salesforce_schema_graph_{source_id}.json"
    if graph_path.exists():
        try:
            graph_path.unlink()
        except Exception:
            pass


def save_salesforce_schema_graph(source_id: str, graph: "SalesforceSchemaGraph") -> None:
    """Persist the schema graph to disk for *source_id*."""
    path = _DATA_DIR / f"salesforce_schema_graph_{source_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = asdict(graph)
    data["source_id"] = source_id
    path.write_text(json.dumps(data, indent=2))
    logger.info(
        "Schema graph saved for '%s': %d nodes, %d edges",
        source_id,
        len(graph.nodes),
        len(graph.edges),
    )


def load_salesforce_schema_graph(source_id: str) -> dict | None:
    """Return the cached schema graph dict for *source_id*, or None."""
    path = _DATA_DIR / f"salesforce_schema_graph_{source_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


# ── Field-level profiling ─────────────────────────────────────────────────────

# Field types that are worth fetching sample values for (exclude binary/blob)
_PROFILABLE_TYPES = {
    "string",
    "picklist",
    "multipicklist",
    "boolean",
    "int",
    "double",
    "currency",
    "percent",
    "date",
    "datetime",
    "email",
    "phone",
    "url",
    "id",
    "reference",
    "textarea",
    "combobox",
}

# Max distinct values kept in the profile per field
_MAX_TOP_VALUES = 10


@dataclass
class SalesforceFieldProfile:
    field_name: str
    field_label: str
    field_type: str
    is_relation: bool
    populated_count: int  # rows where field is not null/empty
    total_count: int  # total rows sampled
    null_rate: float  # 0.0–1.0
    distinct_count: int
    top_values: list[str]  # up to _MAX_TOP_VALUES most frequent non-null values


@dataclass
class SalesforceObjectProfile:
    object_name: str
    object_label: str
    sample_size: int  # actual rows fetched (≤ requested)
    fields_profiled: int
    field_profiles: list[SalesforceFieldProfile]
    profiled_at: str


@dataclass
class SalesforceSchemaProfile:
    source_id: str
    sample_size_requested: int
    objects_profiled: int
    object_profiles: list[SalesforceObjectProfile]
    profiled_at: str


class SalesforceProfiler:
    """Samples real rows from Salesforce and computes field quality statistics.

    Raw rows are never persisted — only aggregate statistics (null rate,
    distinct count, top values) are stored in the profile JSON.
    """

    # SOQL fields that always exist and are safe to skip in profiling
    _SYSTEM_FIELDS = {
        "Id",
        "IsDeleted",
        "SystemModstamp",
        "LastModifiedById",
        "CreatedById",
        "LastModifiedDate",
        "CreatedDate",
    }

    def __init__(self, connector: SalesforceConnector) -> None:
        self._sf = connector

    def _build_soql(self, obj_name: str, fields: list[str], limit: int) -> str:
        # SOQL field list must not exceed ~200 fields due to URL length limits.
        # Pick the first 150 profilable fields to stay safe.
        safe_fields = fields[:150]
        field_list = ", ".join(safe_fields)
        return f"SELECT {field_list} FROM {obj_name} LIMIT {limit}"

    def profile_sobject(
        self,
        obj_name: str,
        obj_label: str,
        schema_fields: list[SalesforceField],
        sample_size: int = 500,
    ) -> SalesforceObjectProfile | None:
        """Fetch up to *sample_size* rows and compute per-field statistics.

        Returns None if the object is not queryable or SOQL fails.
        """
        # Pick profilable fields (skip system fields and binary types)
        profile_fields = [
            f
            for f in schema_fields
            if f.type in _PROFILABLE_TYPES and f.name not in self._SYSTEM_FIELDS
        ]
        if not profile_fields:
            return None

        field_names = [f.name for f in profile_fields]

        try:
            soql = self._build_soql(obj_name, field_names, sample_size)
            encoded = soql.replace(" ", "+").replace(",", "%2C")
            raw = self._sf._get(f"/query?q={encoded}")
            records: list[dict] = raw.get("records", [])
        except Exception as exc:
            logger.warning("Profile query failed for %s: %s", obj_name, exc)
            return None

        total = len(records)
        if total == 0:
            return None

        field_profiles: list[SalesforceFieldProfile] = []
        for fld in profile_fields:
            values = [r.get(fld.name) for r in records]
            non_null = [
                v
                for v in values
                if v is not None and v != "" and v is not False or v is False
            ]
            # Recalculate: non-null means the field has a real value
            non_null = [v for v in values if v is not None and str(v).strip() != ""]
            populated = len(non_null)
            null_rate = round(1.0 - populated / total, 4) if total > 0 else 1.0

            # Distinct count and top values (string-coerced)
            str_vals = [str(v) for v in non_null]
            from collections import Counter

            counter = Counter(str_vals)
            distinct = len(counter)
            top_values = [v for v, _ in counter.most_common(_MAX_TOP_VALUES)]

            field_profiles.append(
                SalesforceFieldProfile(
                    field_name=fld.name,
                    field_label=fld.label,
                    field_type=fld.type,
                    is_relation=fld.is_relation,
                    populated_count=populated,
                    total_count=total,
                    null_rate=null_rate,
                    distinct_count=distinct,
                    top_values=top_values,
                )
            )

        return SalesforceObjectProfile(
            object_name=obj_name,
            object_label=obj_label,
            sample_size=total,
            fields_profiled=len(field_profiles),
            field_profiles=field_profiles,
            profiled_at=datetime.now(timezone.utc).isoformat(),
        )

    def profile_schema(
        self,
        schema: "SalesforceSchema",
        sample_size: int = 500,
        objects_to_profile: set[str] | None = None,
    ) -> SalesforceSchemaProfile:
        """Profile all objects in *schema* (or the given subset).

        Defaults to _PRIORITY_OBJECTS if *objects_to_profile* is None.
        """
        if objects_to_profile is None:
            objects_to_profile = _PRIORITY_OBJECTS

        target_objects = [
            obj for obj in schema.objects if obj.name in objects_to_profile
        ]
        if not target_objects:
            # Fall back to the first 20 objects if none of the priority ones are present
            target_objects = schema.objects[:20]

        profiles: list[SalesforceObjectProfile] = []
        for obj in target_objects:
            logger.info("Profiling %s (sample=%d)…", obj.name, sample_size)
            prof = self.profile_sobject(
                obj_name=obj.name,
                obj_label=obj.label,
                schema_fields=obj.fields,
                sample_size=sample_size,
            )
            if prof is not None:
                profiles.append(prof)

        return SalesforceSchemaProfile(
            source_id="",  # caller sets this
            sample_size_requested=sample_size,
            objects_profiled=len(profiles),
            object_profiles=profiles,
            profiled_at=datetime.now(timezone.utc).isoformat(),
        )


def save_salesforce_profile(source_id: str, profile: SalesforceSchemaProfile) -> None:
    """Persist aggregated field profiles to backend/data/salesforce_profile_{source_id}.json."""
    profile.source_id = source_id
    profile_path = _DATA_DIR / f"salesforce_profile_{source_id}.json"
    profile_path.parent.mkdir(parents=True, exist_ok=True)
    profile_path.write_text(json.dumps(asdict(profile), indent=2))
    logger.info(
        "Salesforce profile saved for '%s': %d objects profiled",
        source_id,
        profile.objects_profiled,
    )


def load_salesforce_profile(source_id: str) -> dict | None:
    """Return the cached profile dict for *source_id*, or None."""
    profile_path = _DATA_DIR / f"salesforce_profile_{source_id}.json"
    if not profile_path.exists():
        return None
    try:
        return json.loads(profile_path.read_text())
    except Exception:
        return None


def _delete_salesforce_profile(source_id: str) -> None:
    profile_path = _DATA_DIR / f"salesforce_profile_{source_id}.json"
    if profile_path.exists():
        try:
            profile_path.unlink()
        except Exception:
            pass


# ── DuckDB ingest helpers ─────────────────────────────────────────────────────


def build_salesforce_dataframes(
    schema: SalesforceSchema,
) -> tuple["Any", "Any"]:  # (pd.DataFrame, pd.DataFrame)
    """
    Convert a SalesforceSchema into two pandas DataFrames suitable for DuckDB:
      objects_df  — one row per SObject
      fields_df   — one row per field
    """
    import pandas as pd

    objects_rows = []
    fields_rows = []

    for obj in schema.objects:
        objects_rows.append(
            {
                "object_name": obj.name,
                "object_label": obj.label,
                "is_custom": obj.is_custom,
                "field_count": obj.field_count,
                "key_prefix": obj.key_prefix,
            }
        )
        for fld in obj.fields:
            fields_rows.append(
                {
                    "object_name": obj.name,
                    "field_name": fld.name,
                    "field_label": fld.label,
                    "field_type": fld.type,
                    "is_required": fld.is_required,
                    "is_relation": fld.is_relation,
                    "relation_to": fld.relation_to,
                }
            )

    objects_df = (
        pd.DataFrame(objects_rows)
        if objects_rows
        else pd.DataFrame(
            columns=[
                "object_name",
                "object_label",
                "is_custom",
                "field_count",
                "key_prefix",
            ]
        )
    )
    fields_df = (
        pd.DataFrame(fields_rows)
        if fields_rows
        else pd.DataFrame(
            columns=[
                "object_name",
                "field_name",
                "field_label",
                "field_type",
                "is_required",
                "is_relation",
                "relation_to",
            ]
        )
    )

    return objects_df, fields_df
