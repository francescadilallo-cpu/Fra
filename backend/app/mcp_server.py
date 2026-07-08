"""Minimal Model Context Protocol (MCP) server exposing the Semantic Layer.

Lets an external AI agent (Claude, etc.) query the customer's unified data model
in natural language and read its metrics/structure, over a single JSON-RPC 2.0
HTTP endpoint (``POST /api/mcp``). Read-only and JWT-authenticated; the demo/live
boundary is enforced per caller, and every ``ask`` goes through the same SQL/
ontology guardrails as the normal query path.

We implement the small MCP *tools* surface ourselves (no extra dependency):
``initialize``, ``tools/list``, ``tools/call`` and the ``notifications/initialized``
ack, returning ``application/json`` (non-streaming). SSE/streaming and write/agent
tools are intentionally out of scope for v1.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordBearer

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mcp"])

_PROTOCOL_VERSION = "2025-06-18"
_SERVER_INFO = {"name": "fra-semantic-layer", "version": "1.0.0"}

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def _get_current_user(token: str = Depends(_oauth2_scheme)):
    """Lazy proxy to main.get_current_user — avoids circular import at load."""
    from app.main import get_current_user  # noqa: PLC0415

    return get_current_user(token)


# ── Tool registry (read-only) ────────────────────────────────────────────────

_TOOLS: list[dict[str, Any]] = [
    {
        "name": "ask",
        "description": (
            "Ask a natural-language question about the connected business data. "
            "Business terms work in English or Italian ('customers', 'clienti', "
            "'account' all reach the same unified entity). Returns an answer "
            "grounded in the unified data model, with the SQL used, the sources "
            "touched and the knowledge-graph context."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The business question in natural language.",
                }
            },
            "required": ["question"],
        },
    },
    {
        "name": "list_metrics",
        "description": "List the business metrics defined in the semantic layer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "sector_id": {"type": "string", "description": "Optional sector id."}
            },
        },
    },
    {
        "name": "get_data_model",
        "description": (
            "Return the data model: business entities (human-friendly "
            "display_name, canonical business concept, source table), the "
            "unified_entities map grouping equivalent entities from different "
            "sources under one concept (e.g. Customer), and the relations "
            "between entities (type SAME_AS = same real-world entity)."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
]
_TOOL_NAMES = {t["name"] for t in _TOOLS}


# ── Tool dispatch (reuses existing endpoint logic) ───────────────────────────


def _tool_ask(arguments: dict, request: Request, principal: Any) -> dict[str, Any]:
    from app.main import SemanticAskRequest, semantic_ask  # noqa: PLC0415

    question = str(arguments.get("question", "")).strip()
    if not question:
        return _tool_error("question is required")
    resp = semantic_ask(request, SemanticAskRequest(question=question), principal)
    data = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
    text = _stringify(data.get("answer"))
    if data.get("sql_used"):
        text += f"\n\nSQL: {data['sql_used']}"
    return {
        "content": [{"type": "text", "text": text}],
        "structuredContent": {
            "answer": data.get("answer"),
            "sql_used": data.get("sql_used"),
            "sources_touched": data.get("sources_touched", []),
            "provenance": data.get("provenance", {}),
        },
        "isError": False,
    }


def _tool_list_metrics(
    arguments: dict, request: Request, principal: Any
) -> dict[str, Any]:
    from app.main import DEFAULT_SECTOR, get_metrics  # noqa: PLC0415

    sector_id = str(arguments.get("sector_id") or DEFAULT_SECTOR)
    metrics = get_metrics(sector_id, principal)
    slim = [
        {
            "name": m.get("name"),
            "description": m.get("description"),
            "type": m.get("type"),
        }
        for m in metrics
    ]
    return {
        "content": [{"type": "text", "text": _stringify(slim)}],
        "structuredContent": {"metrics": slim},
        "isError": False,
    }


def _tool_get_data_model(
    arguments: dict, request: Request, principal: Any
) -> dict[str, Any]:
    from app.main import (  # noqa: PLC0415
        _ensure_semantic_loaded,
        _get_semantic_draft,
        _hidden_demo_tables,
    )

    _ensure_semantic_loaded()
    draft = _get_semantic_draft(_hidden_demo_tables(principal))
    entities = [
        {
            "name": e.get("name"),
            "display_name": e.get("display_name") or e.get("name"),
            "canonical": e.get("canonical"),
            "table": e.get("table"),
        }
        for e in draft.get("entities", [])
    ]
    # Canonical concepts spanning ≥2 entities: the unified business view an
    # agent should reason about ("Customer" instead of per-source tables).
    by_concept: dict[str, list[str]] = {}
    for e in entities:
        if e["canonical"]:
            by_concept.setdefault(e["canonical"], []).append(e["name"])
    model = {
        "entities": entities,
        "unified_entities": {
            concept: members
            for concept, members in sorted(by_concept.items())
            if len(members) > 1
        },
        "relations": [
            {
                "from": r.get("from_table"),
                "to": r.get("to_table"),
                "via": r.get("via_column"),
                "type": r.get("edge_type"),
            }
            for r in draft.get("relations", [])
        ],
    }
    return {
        "content": [{"type": "text", "text": _stringify(model)}],
        "structuredContent": model,
        "isError": False,
    }


_DISPATCH = {
    "ask": _tool_ask,
    "list_metrics": _tool_list_metrics,
    "get_data_model": _tool_get_data_model,
}


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=str, ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return str(value)


def _tool_error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "isError": True}


def _dispatch_tool(
    name: str, arguments: dict, request: Request, principal: Any
) -> dict[str, Any]:
    handler = _DISPATCH.get(name)
    if handler is None:
        return _tool_error(f"Unknown tool: {name}")
    try:
        return handler(arguments or {}, request, principal)
    except Exception as exc:  # noqa: BLE001 — surface as MCP tool error, not 500
        from fastapi import HTTPException  # noqa: PLC0415

        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        logger.warning("MCP tool '%s' failed: %s", name, detail)
        return _tool_error(f"Tool '{name}' failed: {detail}")


# ── JSON-RPC handling ────────────────────────────────────────────────────────


def _rpc_result(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _rpc_error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def handle_jsonrpc(
    payload: dict, request: Request, principal: Any
) -> dict[str, Any] | None:
    """Handle one JSON-RPC message. Returns the response, or None for a notification."""
    method = payload.get("method")
    req_id = payload.get("id")
    params = payload.get("params") or {}

    if method == "initialize":
        return _rpc_result(
            req_id,
            {
                "protocolVersion": _PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": _SERVER_INFO,
            },
        )
    if method in ("notifications/initialized", "initialized"):
        return None  # ack-only notification
    if method == "ping":
        return _rpc_result(req_id, {})
    if method == "tools/list":
        return _rpc_result(req_id, {"tools": _TOOLS})
    if method == "tools/call":
        name = params.get("name")
        if name not in _TOOL_NAMES:
            return _rpc_error(req_id, -32602, f"Unknown tool: {name}")
        result = _dispatch_tool(name, params.get("arguments") or {}, request, principal)
        return _rpc_result(req_id, result)

    return _rpc_error(req_id, -32601, f"Method not found: {method}")


@router.post("/api/mcp", summary="MCP (Model Context Protocol) JSON-RPC endpoint")
def mcp_endpoint(
    request: Request,
    payload: Any = Body(...),
    principal=Depends(_get_current_user),
) -> JSONResponse:
    """JSON-RPC 2.0 over HTTP. Accepts a single message or a batch (array)."""
    if isinstance(payload, list):
        responses = [
            r
            for r in (handle_jsonrpc(msg, request, principal) for msg in payload)
            if r is not None
        ]
        return JSONResponse(content=responses)
    if not isinstance(payload, dict):
        return JSONResponse(
            content=_rpc_error(None, -32600, "Invalid Request"), status_code=400
        )
    response = handle_jsonrpc(payload, request, principal)
    if response is None:
        return JSONResponse(content=None, status_code=202)
    return JSONResponse(content=response)
