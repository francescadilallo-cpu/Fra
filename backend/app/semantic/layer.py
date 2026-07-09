"""SemanticLayer — NL question → Intent → QueryPlan → Result.

Metrics defined
---------------
revenue            SUM(subtotal_amount)
revenue_with_tax   SUM(total_due)
margin             SUM(qty * (list_price - standard_cost))  [cross ERP+PIM]
active_customers   COUNT(DISTINCT customer_ref)

Synonym/alias map
-----------------
"fatturato"      → AMBIGUOUS → AmbiguityError(candidates=["revenue", "revenue_with_tax"])
"incassi"        → revenue_with_tax
"ordini"         → SalesOrder (not SalesOrderLine)
"venditore/venditori" → Salesperson
"dipendenti"     → Employee
"reparto"        → Reparto field in HR

Resolution flow
---------------
NL question → rule-based intent → (fallback Claude API if ANTHROPIC_API_KEY set)
→ QueryPlan → execute via connectors → Result with metadata.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from app.semantic.doc_schema import SemanticDocs

logger = logging.getLogger(__name__)


# ── AmbiguityError ────────────────────────────────────────────────────────────


class AmbiguityError(Exception):
    """Raised when a query cannot be resolved without disambiguation."""

    def __init__(self, message: str, candidates: list[str]) -> None:
        super().__init__(message)
        self.candidates = candidates


class SemanticOntologyViolationError(Exception):
    """Raised when inferred intent violates ontology or metadata constraints."""

    pass


class SemanticSecurityViolationError(SemanticOntologyViolationError):
    """Raised when LLM output contains unsafe or unauthorized query patterns."""

    pass


# ── Result ────────────────────────────────────────────────────────────────────


@dataclass
class Result:
    answer: Any
    interpreted_as: str = ""
    sql_used: str | None = None
    sources_touched: list[str] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)
    latency_ms: float = 0.0
    disambiguation_required: bool = False
    candidates: list[str] = field(default_factory=list)
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "answer": self.answer,
            "interpreted_as": self.interpreted_as,
            "sql_used": self.sql_used,
            "sources_touched": self.sources_touched,
            "provenance": self.provenance,
            "latency_ms": self.latency_ms,
            "disambiguation_required": self.disambiguation_required,
            "candidates": self.candidates,
            "notes": self.notes,
        }


# ── Intent ────────────────────────────────────────────────────────────────────


@dataclass
class Intent:
    """Parsed intent from a natural language question."""

    intent_type: str  # e.g. "count_employees", "revenue", "top_products"
    filters: dict[str, Any] = field(default_factory=dict)
    dimensions: list[str] = field(default_factory=list)
    limit: int | None = None
    year: int | None = None
    raw_question: str = ""


@dataclass
class OntologyIntentMapping:
    """Ontology-grounded intent emitted by the FM mapping stage."""

    intent_type: str
    metric: str | None = None
    entities: list[str] = field(default_factory=list)
    properties: list[str] = field(default_factory=list)
    relations: list[str] = field(default_factory=list)
    filters: dict[str, Any] = field(default_factory=dict)
    limit: int | None = None
    year: int | None = None
    model: str = ""
    raw_payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class NeuroSymbolicPlan:
    """Deterministic plan validated against ontology + metadata catalog."""

    intent_type: str
    metric: str | None
    entities: list[str]
    properties: list[str]
    relations: list[str]
    connectors: list[str]
    tables: list[str]
    validation_steps: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "intent_type": self.intent_type,
            "metric": self.metric,
            "entities": self.entities,
            "properties": self.properties,
            "relations": self.relations,
            "connectors": self.connectors,
            "tables": self.tables,
            "validation_steps": self.validation_steps,
        }


_INTENT_CONTRACTS: dict[str, dict[str, Any]] = {
    # ── structural intents (no SQL, return system info) ───────────────────────
    "entity_not_modeled": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    "glossary_lookup": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    "disambiguation_rules": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    "certified_metrics": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    "data_provenance": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    "impossible": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    # ── fallback / LLM-generated ──────────────────────────────────────────────
    "unknown": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
}


_DANGEROUS_SQL_RE = re.compile(
    r"\b(drop|alter|delete|insert|update|truncate|grant|revoke|create|attach|pragma)\b",
    re.IGNORECASE,
)
_PROMPT_INJECTION_RE = re.compile(
    r"ignore\s+(all\s+)?(previous|prior)\s+instructions|"
    r"system\s+prompt|"
    r"developer\s+message|"
    r"jailbreak|"
    r"bypass\s+guardrails|"
    r"tool\s+call|function\s+call",
    re.IGNORECASE,
)
_SQL_META_TOKENS_RE = re.compile(r";|--|/\*|\*/")
_SQL_TABLE_ACCESS_RE = re.compile(
    r"\b(?:from|join|into|update|table)\s+"
    r'((?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*)(?:\.(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_]*))*)',
    re.IGNORECASE,
)


def _split_table_ref(table_ref: str) -> list[str]:
    """Split a possibly schema-qualified, possibly double-quoted table
    reference into its lowercase unquoted parts."""
    return [p.strip('"').lower() for p in re.findall(r'"[^"]+"|[^.]+', table_ref)]


_SYSTEM_TABLE_MARKERS = {
    "sqlite_master",
    "sqlite_temp_master",
    "information_schema",
    "pg_catalog",
    "pg_tables",
    "mysql",
    "sys",
    # DuckDB catalog & introspection tables
    "duckdb_schemas",
    "duckdb_tables",
    "duckdb_columns",
    "duckdb_views",
    "duckdb_functions",
    "duckdb_sequences",
    "duckdb_constraints",
    "pragma_table_info",
    "pragma_database_list",
    "pragma_index_list",
}


def _anthropic_model() -> str:
    """Model ID for LLM intent mapping. Overridable via env without a redeploy."""
    return (
        os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"
    )


def _groq_model() -> str:
    """Groq model ID. Overridable via env without a redeploy."""
    return (
        os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
        or "llama-3.3-70b-versatile"
    )


def _llm_intent_provider() -> str | None:
    """Pick the LLM provider based on configured keys.

    Anthropic (Claude) is the default when its key is present — it powers the
    judgement-heavy paths (curation advisor) and supports structured outputs
    and prompt caching; Groq is the fallback. ``FRA_LLM_PROVIDER`` forces a
    specific provider (its key must still be configured). Returns None when
    no provider key is configured.
    """
    has_anthropic = bool(os.getenv("ANTHROPIC_API_KEY", "").strip())
    has_groq = bool(os.getenv("GROQ_API_KEY", "").strip())
    forced = os.getenv("FRA_LLM_PROVIDER", "").strip().lower()
    if forced == "anthropic" and has_anthropic:
        return "anthropic"
    if forced == "groq" and has_groq:
        return "groq"
    if forced:
        logger.warning(
            "FRA_LLM_PROVIDER=%r has no matching API key — falling back", forced
        )
    if has_anthropic:
        return "anthropic"
    if has_groq:
        return "groq"
    return None


def _complete_json_via_groq(
    system_prompt: str, user_content: str, max_tokens: int = 500
) -> str:
    """Call Groq's OpenAI-compatible chat endpoint and return the raw text."""
    import httpx

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    payload = {
        "model": _groq_model(),
        "max_tokens": max_tokens,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
    }
    _MAX_ATTEMPTS = 3
    for attempt in range(_MAX_ATTEMPTS):
        resp = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            # 15 s keeps a slow Groq response from tying up the FastAPI threadpool
            # thread for too long. The route is sync (threadpool), so a long block
            # here delays other requests queued behind it.
            timeout=15.0,
        )
        if resp.status_code == 429 and attempt < _MAX_ATTEMPTS - 1:
            # Groq rate-limited — back off and retry (1 s, 2 s)
            time.sleep(2**attempt)
            continue
        break
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _complete_json_via_anthropic(
    system_prompt: "str | list[dict]",
    user_content: str,
    max_tokens: int = 500,
    schema: dict | None = None,
) -> str:
    """Call Anthropic's Messages API and return the raw text.

    *system_prompt* may be a plain string or a list of system text blocks
    (letting callers set ``cache_control`` on stable blocks for prompt
    caching). When *schema* is given, the response is constrained to that
    JSON Schema via structured outputs (``output_config.format``, sent
    through ``extra_body`` for SDK-version tolerance); if the configured
    model rejects it, the call falls back to plain prompt-driven JSON.
    """
    import anthropic

    client = anthropic.Anthropic(
        api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
        timeout=30.0,
    )

    def _call(extra: dict | None) -> str:
        msg = client.messages.create(
            model=_anthropic_model(),
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
            **({"extra_body": extra} if extra else {}),
        )
        if not msg.content:
            raise ValueError("Anthropic returned empty content array")
        # Skip non-text blocks (e.g. thinking) — take the first text block.
        for block in msg.content:
            if hasattr(block, "text") and getattr(block, "type", "") == "text":
                return block.text
        raise ValueError("Anthropic response contained no text block")

    if schema is not None:
        try:
            return _call(
                {"output_config": {"format": {"type": "json_schema", "schema": schema}}}
            )
        except anthropic.BadRequestError as exc:
            # Model/SDK without structured-outputs support — degrade to the
            # prompt-driven JSON contract instead of failing the feature.
            logger.warning(
                "structured outputs unavailable (%s) — falling back to plain JSON",
                exc,
            )
    return _call(None)


def _extract_json_payload(text: str) -> dict[str, Any]:
    """Extract a JSON object from model text output."""
    raw = text.strip()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fenced:
        parsed = json.loads(fenced.group(1))
        if isinstance(parsed, dict):
            return parsed

    inline = re.search(r"\{.*\}", raw, re.DOTALL)
    if inline:
        parsed = json.loads(inline.group(0))
        if isinstance(parsed, dict):
            return parsed

    raise ValueError("Could not parse JSON payload from model output")


def complete_json_llm(
    system_prompt: str, user_content: str, max_tokens: int = 800
) -> dict[str, Any] | None:
    """Provider-agnostic JSON completion used by Smart Connect analysis.

    Picks the configured provider (Anthropic default, Groq fallback), runs a
    JSON-mode completion, and returns the parsed object. Returns ``None`` when
    no LLM provider is configured so callers can degrade gracefully. Raises on
    provider/transport errors or unparseable output.
    """
    provider = _llm_intent_provider()
    if provider is None:
        return None
    if provider == "groq":
        raw_text = _complete_json_via_groq(system_prompt, user_content, max_tokens)
    else:
        raw_text = _complete_json_via_anthropic(system_prompt, user_content, max_tokens)
    return _extract_json_payload(raw_text)


# ── Rule-based intent parser ──────────────────────────────────────────────────


class _RuleParser:
    """Rule-based intent parser — handles structural intents and template matching.

    SQL-based golden-question handlers have been removed; those questions are
    now served by seed Query Templates in the DB or by LLM-generated SQL.
    """

    # Compiled patterns (order matters — more specific first)
    _YEAR_RE = re.compile(r"\b(20\d{2})\b")
    _LIMIT_RE = re.compile(r"\btop[\s-]?(\d+)\b", re.IGNORECASE)
    _DEPT_RE = re.compile(
        r'"([^"]+)"|\'([^\']+)\'|repasto\s+([A-Za-z &]+)', re.IGNORECASE
    )

    def parse(self, question: str, templates: list[dict] | None = None) -> Intent:
        q = question.lower()
        # The deterministic patterns below were authored for Italian questions.
        # The product UI is now English, so normalise the most common English
        # business terms to the Italian tokens the patterns already match.
        # This is additive: Italian questions are unaffected (terms map to
        # themselves), and it lets English questions hit the same intents.
        q = _normalize_english_terms(q)

        year = self._extract_year(question)
        limit = self._extract_limit(q)

        # ── Step 1: Template keyword matching — checked FIRST ─────────────────
        # Templates registered in the DB take priority over structural patterns
        # so user-defined overrides always win.
        #
        # Keywords are checked against BOTH the normalised question (Italian
        # tokens) and the raw question: English keywords like "monthly
        # revenue" would otherwise never match once the term map has rewritten
        # "revenue" → "incassi". Among all matches the LONGEST keyword wins —
        # a generic keyword like "incassi" must not shadow a more specific
        # template ("fatturato mensile") just because it appears earlier.
        if templates:
            q_lower = q.lower()
            raw_lower = question.lower()
            # Live workspaces must not match demo templates: without this the
            # lowest-id demo template ("Revenue" on a hidden table) shadows the
            # user's own metric template, and the SQL guardrail then rejects
            # the query with an unhelpful "not available" instead of answering.
            _hidden_tbls = {
                str(h).lower()
                for h in getattr(
                    SemanticLayer._thread_local, "hidden_tables", frozenset()
                )
            }

            def _touches_hidden(tpl: dict) -> bool:
                if not _hidden_tbls:
                    return False
                if {str(s).lower() for s in tpl.get("sources") or []} & _hidden_tbls:
                    return True
                sql_tokens = set(
                    re.findall(
                        r"[a-z_][a-z0-9_]*", (tpl.get("sql_query") or "").lower()
                    )
                )
                return bool(sql_tokens & _hidden_tbls)

            best_len = -1
            best_tpl: dict | None = None
            for tpl in templates:
                if not tpl.get("is_active", True):
                    continue
                if _touches_hidden(tpl):
                    continue
                for kw in tpl.get("keywords", []):
                    k = kw.lower()
                    if len(k) > best_len and (k in q_lower or k in raw_lower):
                        best_len = len(k)
                        best_tpl = tpl
            if best_tpl is not None:
                return Intent(
                    intent_type=best_tpl["intent_type"],
                    filters={"year": year} if year else {},
                    limit=limit,
                    year=year,
                    raw_question=question,
                )

        # ── Step 2: Structural intent patterns ────────────────────────────────
        # These return system info (no SQL). Keep these regardless of templates.

        # ── AW demo-specific heuristics — skipped for live-mode requests ─────
        _is_live = bool(
            getattr(SemanticLayer._thread_local, "hidden_tables", frozenset())
        )
        if not _is_live:
            # Nationality field is not modeled in the AW HR dataset.
            if "italian" in q or "nazionalit" in q or "italiano" in q.split():
                return Intent(
                    intent_type="impossible",
                    filters={"reason": "nationality_not_available"},
                    raw_question=question,
                )

            # Supplier is not an entity in the AW ontology.
            if any(kw in q for kw in ["fornitore", "fornitori", "supplier", "vendor"]):
                return Intent(
                    intent_type="entity_not_modeled",
                    filters={"entity": "Supplier"},
                    raw_question=question,
                )

        # ── Glossary lookup ───────────────────────────────────────────────
        _GLOSSARY_TRIGGERS = [
            "cosa intendete per",
            "definizione di",
            "cosa significa",
            "cosa vuol dire",
            "cosa si intende per",
        ]
        if any(t in q for t in _GLOSSARY_TRIGGERS):
            # Extract the term after the trigger phrase
            term = None
            for t in _GLOSSARY_TRIGGERS:
                idx = q.find(t)
                if idx != -1:
                    term = (
                        question[idx + len(t) :].strip(" '\"?.,").split()[0]
                        if question[idx + len(t) :].strip()
                        else None
                    )
                    break
            return Intent(
                intent_type="glossary_lookup",
                filters={"term": term},
                raw_question=question,
            )

        # ── Disambiguation rules explanation ──────────────────────────────
        if ("disambiguazion" in q or "regole" in q) and (
            "attiv" in q or "disambiguazion" in q or "spiega" in q
        ):
            return Intent(intent_type="disambiguation_rules", raw_question=question)

        # ── Certified metrics list ────────────────────────────────────────
        if ("metriche" in q or "metric" in q) and (
            "certif" in q or "disponibil" in q or "quali" in q
        ):
            return Intent(intent_type="certified_metrics", raw_question=question)

        # ── Data provenance ───────────────────────────────────────────────
        if "provenienza" in q or "fonte" in q or "aggiornato" in q or "freschezza" in q:
            return Intent(intent_type="data_provenance", raw_question=question)

        # ── Ambiguity guards (raise before unknown fallback) ──────────────
        # These guards encode AW demo dataset semantics (subtotal_amount vs
        # total_due, SalesOrder count vs revenue).  Skip them for live-mode
        # requests so Italian live users don't get AW-specific messages.
        _is_live_mode = bool(
            getattr(SemanticLayer._thread_local, "hidden_tables", frozenset())
        )

        if not _is_live_mode:
            # "fatturato" standalone — ambiguous between revenue and revenue_with_tax
            _FATTURATO_QUALIFIERS = [
                "per territorio",
                "per venditore",
                "per cliente",
                "medio",
                "per categoria",
                "vs",
                "quota",
                "lordo",
                "netto",
                "incass",
                "annualizzato",
                "fonte",
                "cliente ",
                "reparto",
                "b2b",
                "b2c",
                "venditore",
                "venditori",
                "top",
            ]
            if "fatturato" in q:
                has_qualifier = any(x in q for x in _FATTURATO_QUALIFIERS)
                is_standalone = not has_qualifier
                if is_standalone:
                    raise AmbiguityError(
                        "The term 'fatturato' is ambiguous: it could refer to pure revenue "
                        "(subtotal_amount, ~$20M) or gross revenue including taxes and shipping "
                        "(total_due, ~$22.4M). Please specify which definition to use.",
                        candidates=[
                            "revenue (~subtotal_amount)",
                            "revenue_with_tax (~total_due)",
                        ],
                    )

            # "vendite" standalone — ambiguous between order count and revenue
            _VENDITE_QUALIFIERS = [
                "per territorio",
                "per venditore",
                "per cliente",
                "per categoria",
                "per prodotto",
                "per reparto",
                "per mese",
                "per anno",
                "top",
                "media",
                "totale",
                "b2b",
                "b2c",
            ]
            if "vendite" in q and not any(kw in q for kw in _VENDITE_QUALIFIERS):
                raise AmbiguityError(
                    "The term 'vendite' is ambiguous: it could refer to the number of orders "
                    "(count SalesOrder) or to revenue (revenue/revenue_with_tax). "
                    "Please specify which metric to use.",
                    candidates=[
                        "count_orders (number of orders)",
                        "revenue (~subtotal_amount)",
                        "revenue_with_tax (~total_due)",
                    ],
                )

        # ── Step 3: Unknown — LLM SQL generation fallback ─────────────────────
        # Pass year/limit so that LLM-SQL and template paths can use them.
        return Intent(
            intent_type="unknown",
            filters={"year": year} if year else {},
            limit=limit,
            year=year,
            raw_question=question,
        )

    # ── helpers ───────────────────────────────────────────────────────────────

    def _extract_year(self, text: str) -> int | None:
        m = self._YEAR_RE.search(text)
        return int(m.group(1)) if m else None

    def _extract_limit(self, text: str) -> int | None:
        m = self._LIMIT_RE.search(text)
        return int(m.group(1)) if m else None

    def _extract_quoted(self, text: str) -> str | None:
        m = re.search(r'"([^"]+)"|\'([^\']+)\'', text)
        if m:
            return m.group(1) or m.group(2)
        return None

    def _extract_quoted_or_named(self, text: str, prefixes: list[str]) -> str | None:
        q = self._extract_quoted(text)
        if q:
            return q
        # Try "reparto <DeptName>" pattern (word after reparto keyword)
        rm = re.search(r"reparto\s+([A-Z][A-Za-z &]+)", text)
        if rm:
            return rm.group(1).strip().rstrip("?.")
        for prefix in prefixes:
            m = re.search(
                rf'\b{prefix}\s+["\']?([A-Z][A-Za-z &]+?)(?:["\']|\s*$|\s*\?)',
                text,
                re.IGNORECASE,
            )
            if m:
                candidate = m.group(1).strip().rstrip("?.")
                # Reject common Italian stop words
                stop = {"nel", "in", "il", "la", "lo", "di", "reparto", "del", "dei"}
                if candidate.lower() not in stop:
                    return candidate
        return None


# English → Italian term normalisation for the deterministic parser.
# Applied to the lowercased question before pattern matching. Replacements use
# word boundaries and only rewrite English tokens, so Italian questions (which
# never contain these English words) are left unchanged.


def _load_term_map() -> list[tuple[re.Pattern[str], str]]:
    """Load English-to-Italian term mappings from term_map.json.

    Falls back to empty list if the file is missing or malformed.
    """
    import json as _json
    import pathlib as _pathlib

    _path = _pathlib.Path(__file__).parent / "term_map.json"
    try:
        data = _json.loads(_path.read_text(encoding="utf-8"))
        return [
            (re.compile(pattern), replacement)
            for pattern, replacement in data.get("mappings", [])
        ]
    except (FileNotFoundError, KeyError, ValueError, re.error):
        return []


_EN_TERM_MAP: list[tuple[re.Pattern[str], str]] = _load_term_map()


def _normalize_english_terms(q: str) -> str:
    """Rewrite common English business terms to the Italian tokens the
    deterministic patterns expect. No-op for Italian input."""
    for pattern, replacement in _EN_TERM_MAP:
        q = pattern.sub(replacement, q)
    return q


# ── SemanticLayer ─────────────────────────────────────────────────────────────


class SemanticLayer:
    """Translates natural-language questions into executable queries."""

    # Per-thread docs override — set at the top of ask() so that concurrent
    # requests each see their own merged docs without mutating shared state.
    _thread_local: threading.local = threading.local()

    def __init__(
        self,
        ontology,
        kg,
        catalog,
        context_manager=None,
        docs: SemanticDocs | None = None,
    ) -> None:
        self._ontology = ontology
        self._kg = kg
        self._catalog = catalog
        self._ctx_mgr = context_manager
        self._docs = docs
        self._parser = _RuleParser()
        # Connector references — set by set_connectors()
        self._erp = None
        self._crm = None
        self._hr_pim = None
        # DuckDB manager — set by set_manager() for schema-driven LLM SQL generation
        self._mgr = None
        # User-defined query templates — hot-reloaded via set_templates()
        self._templates: list[dict] = []

    @property
    def _effective_docs(self) -> SemanticDocs | None:
        """Return the per-request docs override if set, otherwise the instance default."""
        tl = SemanticLayer._thread_local
        override = getattr(tl, "docs", None)
        return override if override is not None else self._docs

    def set_connectors(self, erp, crm, hr_pim) -> None:
        self._erp = erp
        self._crm = crm
        self._hr_pim = hr_pim

    def set_manager(self, mgr) -> None:
        """Bind the DuckDB source manager for schema-driven LLM SQL generation."""
        self._mgr = mgr
        try:
            self._known_tables: frozenset[str] = frozenset(mgr.get_schema_info().keys())
        except Exception as _exc:
            logger.warning("set_manager: could not cache table list: %s", _exc)
            self._known_tables = frozenset()

    def set_context_docs(self, docs: list[dict]) -> None:
        """Inject global context documents into LLM SQL generation prompts."""
        self._context_docs: list[dict] = list(docs or [])

    def set_templates(self, templates: list[dict]) -> None:
        """Hot-reload query templates from the catalog (called after DB writes)."""
        self._templates = list(templates)

    def _reload_templates(self) -> None:
        """No-op placeholder; hot-reload is done via set_templates()."""
        pass

    def _exec(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute SQL against the unified DuckDB snapshot.

        Used by _execute_llm_sql() and any new schema-agnostic handler.
        Falls back to the first available legacy adapter when mgr is not set
        (e.g. in unit tests that bypass set_manager()).
        """
        mgr = getattr(self, "_mgr", None)
        if mgr is not None:
            return mgr.execute(sql, params)
        for adapter in (
            getattr(self, "_erp", None),
            getattr(self, "_crm", None),
            getattr(self, "_hr_pim", None),
        ):
            if adapter is not None:
                return adapter.execute_query(sql, params)
        raise RuntimeError(
            "No DuckDB manager or adapter configured. "
            "Call set_manager(mgr) before using the semantic layer."
        )

    def clear_semantic_cache(self) -> None:
        """Compatibility hook for endpoint-level invalidation.

        Current layer version does not persist internal validated-plan cache,
        but this explicit method keeps mutation hooks stable and forward-compatible.
        """
        return None

    def ask(
        self,
        question: str,
        context=None,
        docs_override: SemanticDocs | None = None,
        hidden_tables: frozenset[str] = frozenset(),
    ) -> Result:
        """Resolve *question* and return a Result.

        *hidden_tables* lists tables that must be invisible to this request
        (live-mode users must never see demo tables in generated SQL).
        """
        SemanticLayer._thread_local.docs = docs_override
        SemanticLayer._thread_local.hidden_tables = hidden_tables
        t0 = time.perf_counter()
        try:
            result = self._resolve(question, context)
        except AmbiguityError:
            raise
        except SemanticOntologyViolationError:
            raise
        except Exception as exc:
            # Catch-all for the whole pipeline: the exception text can contain
            # provider auth errors, file paths or other internals. Log it,
            # return a generic message.
            logger.exception("SemanticLayer.ask error: %s", exc)
            result = Result(
                answer=(
                    "Something went wrong while answering this question — "
                    "please try again or rephrase it."
                ),
                sources_touched=[],
                notes="internal_error",
            )
        finally:
            # Always clear the thread-locals so docs and visibility never bleed
            # into the next request that runs on this thread.
            SemanticLayer._thread_local.docs = None
            SemanticLayer._thread_local.hidden_tables = frozenset()
        result.latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        return result

    # ── resolution ────────────────────────────────────────────────────────────

    def _resolve(self, question: str, context) -> Result:
        # Stage 1: deterministic baseline parse
        try:
            baseline_intent = self._parser.parse(question, templates=self._templates)
        except AmbiguityError:
            raise
        except Exception as exc:
            logger.warning("Rule parser failed: %s", exc)
            baseline_intent = Intent(intent_type="unknown", raw_question=question)

        # Stage 2: FM maps NL to ontology concepts (never SQL)
        mapped_intent, mapping = self._map_to_ontology_intent(question, baseline_intent)

        # Stage 3: ontology + metadata validation and deterministic plan
        plan = self._build_validated_plan(mapped_intent, mapping)

        # Stage 4: deterministic query execution via typed templates
        result = self._execute(mapped_intent)
        result.interpreted_as = (
            f"intent={mapped_intent.intent_type}; entities={','.join(plan.entities) or '-'}; "
            f"metric={plan.metric or '-'}"
        )

        # Stage 5: enforce complete lineage/provenance in final response
        self._inject_plan_lineage(result, plan, question, mapping)
        return result

    def _map_to_ontology_intent(
        self,
        question: str,
        baseline_intent: Intent,
    ) -> tuple[Intent, OntologyIntentMapping]:
        mapping = self._llm_ontology_mapping(question, baseline_intent)
        if mapping is None:
            mapping = self._fallback_mapping_from_rule(baseline_intent)

        intent_type = mapping.intent_type or baseline_intent.intent_type
        # Preserve dynamic template intents (tpl_<id>) before contract check
        _is_template_intent = intent_type.startswith("tpl_")
        if not _is_template_intent and intent_type not in _INTENT_CONTRACTS:
            # The model picked an intent we don't support: treat it as 'unknown'
            # so the executor returns a friendly hint rather than raising a 422.
            logger.info("LLM mapped to unsupported intent '%s' → unknown", intent_type)
            intent_type = "unknown"

        # The executor dispatches purely on intent_type and uses only
        # filters/year/limit. The LLM-supplied entities/properties/relations are
        # NOT needed for execution and only risk failing strict ontology
        # validation. Re-derive them from the trusted intent contract so a valid
        # intent_type always produces a valid, executable plan.
        contract = _INTENT_CONTRACTS.get(intent_type, {})
        mapping.entities = list(contract.get("entities", []))
        mapping.properties = list(contract.get("properties", []))
        mapping.relations = list(contract.get("relations", []))
        mapping.metric = contract.get("metric")

        merged_filters = dict(baseline_intent.filters)
        merged_filters.update(mapping.filters)
        merged_intent = Intent(
            intent_type=intent_type,
            filters=merged_filters,
            dimensions=list(baseline_intent.dimensions),
            limit=mapping.limit if mapping.limit is not None else baseline_intent.limit,
            year=mapping.year if mapping.year is not None else baseline_intent.year,
            raw_question=question,
        )
        return merged_intent, mapping

    def _llm_ontology_mapping(
        self,
        question: str,
        baseline_intent: Intent,
    ) -> OntologyIntentMapping | None:
        provider = _llm_intent_provider()
        strict = os.getenv("SEMANTIC_REQUIRE_LLM_INTENT", "1").strip().lower() not in {
            "0",
            "false",
            "no",
        }
        if provider is None:
            if strict:
                raise SemanticOntologyViolationError(
                    "An LLM key (GROQ_API_KEY or ANTHROPIC_API_KEY) is required "
                    "for ontology intent mapping"
                )
            return None

        # For live-mode requests, exclude demo-scenario tables so the intent
        # classifier is not confused by AW entity/metric names it can't query.
        _hidden = getattr(SemanticLayer._thread_local, "hidden_tables", frozenset())

        _raw_entities = (
            self._ontology.entity_names()
            if self._ontology
            else (self._catalog.list_entities() if self._catalog else [])
        )
        entity_names = [e for e in _raw_entities if e not in _hidden]

        _raw_metrics = self._catalog.list_metrics() if self._catalog else []
        # Filter out metrics whose formula references a hidden table (AW demo-specific
        # formulas like SUM(sales_order_header.subtotal_amount) must not appear in
        # the live-mode intent classifier prompt).
        if _hidden and self._catalog:
            _hidden_lower = {h.lower() for h in _hidden}
            _metric_objs = {
                m.name: m.formula for m in self._catalog.list_metric_objects()
            }
            metric_names = [
                m
                for m in _raw_metrics
                if not any(
                    h in (_metric_objs.get(m) or "").lower() for h in _hidden_lower
                )
            ]
        else:
            metric_names = [m for m in _raw_metrics if m not in _hidden]

        relation_hints: list[str] = []
        if self._ontology:
            for entity in entity_names:
                for rel in self._ontology.relations_of(entity):
                    target = rel.get("target")
                    rel_name = rel.get("name")
                    if target and rel_name and target not in _hidden:
                        relation_hints.append(f"{entity}.{rel_name}->{target}")

        # Compact table list for the intent mapper (helps the LLM decide if a
        # question is answerable and guides it toward 'unknown' for out-of-scope ones)
        table_names: list[str] = []
        if self._mgr:
            try:
                schema = self._mgr.get_schema_info()
                table_names = sorted(k for k in schema if k not in _hidden)[:25]
            except Exception:
                pass
        elif self._catalog:
            table_names = sorted(
                e for e in self._catalog.list_entities() if e not in _hidden
            )[:25]

        system_prompt = (
            "You are an ontology intent mapper for a neuro-symbolic semantic layer. "
            "Your job is ONLY to map a user's natural-language business question "
            "(English or Italian) to ONE of the allowed intent_type values. "
            "Never generate SQL, code, or executable statements. "
            "Pick the single closest matching intent_type. Use 'unknown' when "
            "the question does not match any allowed intent — the system will then "
            "generate SQL automatically from the available tables. "
            "When you choose an intent, set entities/properties/relations/metric to "
            "values consistent with that intent (leaving them empty is acceptable — "
            "the server fills defaults from the intent contract). "
            "Return STRICT JSON with keys: intent_type, metric, entities, properties, "
            "relations, filters, limit, year. "
            f"Allowed intent_type values: {sorted(_INTENT_CONTRACTS.keys())}. "
            f"Allowed ontology entities: {sorted(entity_names)}. "
            f"Known metrics from metadata catalog: {sorted(metric_names)}. "
            f"Known relation hints: {sorted(relation_hints)[:80]}. "
            f"Available DuckDB tables (for context only): {table_names}."
        )
        user_prompt = {
            "question": question,
            "baseline_intent": baseline_intent.intent_type,
            "year": baseline_intent.year,
            "limit": baseline_intent.limit,
            "filters": baseline_intent.filters,
        }

        try:
            user_content = json.dumps(user_prompt)
            if provider == "groq":
                raw_text = _complete_json_via_groq(system_prompt, user_content)
            else:
                raw_text = _complete_json_via_anthropic(system_prompt, user_content)
            payload = _extract_json_payload(raw_text)
        except Exception as exc:
            if strict:
                logger.error(
                    "LLM ontology mapping failed (%s): %s", provider, exc, exc_info=True
                )
                raise SemanticOntologyViolationError(
                    "The semantic service is temporarily unavailable. Please try again."
                ) from exc
            logger.warning("LLM ontology mapping failed, using rule fallback: %s", exc)
            return None

        intent_type = str(
            payload.get("intent_type", baseline_intent.intent_type)
        ).strip()
        metric = payload.get("metric")
        entities = [
            str(x).strip() for x in payload.get("entities", []) if str(x).strip()
        ]
        properties = [
            str(x).strip() for x in payload.get("properties", []) if str(x).strip()
        ]
        relations = [
            str(x).strip() for x in payload.get("relations", []) if str(x).strip()
        ]
        filters = (
            payload.get("filters", {})
            if isinstance(payload.get("filters", {}), dict)
            else {}
        )
        year = payload.get("year") if isinstance(payload.get("year"), int) else None
        limit = payload.get("limit") if isinstance(payload.get("limit"), int) else None

        self._validate_llm_payload_security(payload)

        return OntologyIntentMapping(
            intent_type=intent_type,
            metric=str(metric).strip()
            if isinstance(metric, str) and metric.strip()
            else None,
            entities=entities,
            properties=properties,
            relations=relations,
            filters=filters,
            limit=limit,
            year=year,
            model=_groq_model() if provider == "groq" else _anthropic_model(),
            raw_payload=payload,
        )

    def _fallback_mapping_from_rule(self, intent: Intent) -> OntologyIntentMapping:
        contract = _INTENT_CONTRACTS.get(
            intent.intent_type,
            {"entities": [], "properties": [], "relations": [], "metric": None},
        )
        return OntologyIntentMapping(
            intent_type=intent.intent_type,
            metric=contract.get("metric"),
            entities=list(contract.get("entities", [])),
            properties=list(contract.get("properties", [])),
            relations=list(contract.get("relations", [])),
            filters=dict(intent.filters),
            limit=intent.limit,
            year=intent.year,
            model="rule_fallback",
            raw_payload={"source": "rule_parser"},
        )

    def _validate_llm_payload_security(self, payload: dict[str, Any]) -> None:
        """Strict guardrail over LLM JSON output before any connector interaction."""
        allowed_tables = self._allowed_catalog_tables()

        for path, value in self._iter_string_leaves(payload):
            normalized = value.strip()
            if not normalized:
                continue

            if _PROMPT_INJECTION_RE.search(normalized):
                self._security_block(
                    reason="prompt_injection_pattern",
                    path=path,
                    value=normalized,
                )

            if _DANGEROUS_SQL_RE.search(normalized):
                self._security_block(
                    reason="destructive_sql_keyword",
                    path=path,
                    value=normalized,
                )

            if _SQL_META_TOKENS_RE.search(normalized):
                self._security_block(
                    reason="sql_meta_token",
                    path=path,
                    value=normalized,
                )

            if re.search(r"\bselect\b", normalized, re.IGNORECASE):
                self._security_block(
                    reason="raw_sql_not_allowed",
                    path=path,
                    value=normalized,
                )

            for table_ref in _SQL_TABLE_ACCESS_RE.findall(normalized):
                parts = _split_table_ref(table_ref)
                table_name = parts[-1]
                if any(p in _SYSTEM_TABLE_MARKERS for p in parts):
                    self._security_block(
                        reason="system_table_access",
                        path=path,
                        value=normalized,
                    )
                if allowed_tables and table_name not in allowed_tables:
                    self._security_block(
                        reason="table_not_mapped_in_catalog",
                        path=path,
                        value=normalized,
                    )

    def _allowed_catalog_tables(self) -> set[str]:
        hidden: frozenset[str] = getattr(
            SemanticLayer._thread_local, "hidden_tables", frozenset()
        )
        hidden_lower = {h.lower() for h in hidden}
        tables: set[str] = set()
        if not self._catalog:
            return tables
        for entity in self._catalog.list_entities():
            if entity.lower() in hidden_lower:
                continue
            meta = self._catalog.get_entity(entity)
            if not meta:
                continue
            for src in meta.sources:
                if not isinstance(src, dict):
                    continue
                table = src.get("table")
                if isinstance(table, str) and table.strip():
                    t = table.strip().lower()
                    if t not in hidden_lower:
                        tables.add(t)
        return tables

    def _iter_string_leaves(
        self, payload: Any, path: str = "$"
    ) -> list[tuple[str, str]]:
        leaves: list[tuple[str, str]] = []
        if isinstance(payload, str):
            leaves.append((path, payload))
            return leaves
        if isinstance(payload, dict):
            for key, value in payload.items():
                leaves.extend(self._iter_string_leaves(value, f"{path}.{key}"))
            return leaves
        if isinstance(payload, list):
            for idx, item in enumerate(payload):
                leaves.extend(self._iter_string_leaves(item, f"{path}[{idx}]"))
            return leaves
        return leaves

    def _security_block(self, reason: str, path: str, value: str) -> None:
        logger.error(
            "SECURITY_GUARDRAIL_BLOCK reason=%s path=%s value=%r",
            reason,
            path,
            value[:240],
        )
        raise SemanticSecurityViolationError(f"Blocked unsafe LLM output ({reason})")

    def _build_validated_plan(
        self,
        intent: Intent,
        mapping: OntologyIntentMapping,
    ) -> NeuroSymbolicPlan:
        # Dynamic template intents have no ontology contract — return a minimal plan
        if intent.intent_type.startswith("tpl_"):
            return NeuroSymbolicPlan(
                intent_type=intent.intent_type,
                metric=None,
                entities=[],
                properties=[],
                relations=[],
                connectors=[],
                tables=[],
                validation_steps=["template_intent"],
            )

        contract = _INTENT_CONTRACTS.get(intent.intent_type)
        if not contract:
            raise SemanticOntologyViolationError(
                f"No ontology contract defined for intent '{intent.intent_type}'"
            )

        validation_steps: list[str] = [
            "fm_intent_mapped",
            "ontology_contract_selected",
        ]

        _hidden_bp: frozenset[str] = getattr(
            SemanticLayer._thread_local, "hidden_tables", frozenset()
        )
        catalog_entities = (
            {e for e in self._catalog.list_entities() if e not in _hidden_bp}
            if self._catalog
            else set()
        )
        ontology_entities = (
            {e for e in self._ontology.entity_names() if e not in _hidden_bp}
            if self._ontology
            else set(catalog_entities)
        )
        allowed_entities = set(contract.get("entities", []))
        candidate_entities = set(mapping.entities or contract.get("entities", []))

        if not candidate_entities.issubset(allowed_entities):
            raise SemanticOntologyViolationError(
                f"Ontology violation: entities {sorted(candidate_entities)} are outside intent contract {sorted(allowed_entities)}"
            )

        for entity in sorted(candidate_entities):
            if entity not in ontology_entities:
                raise SemanticOntologyViolationError(
                    f"Ontology violation: unknown entity '{entity}'"
                )
            if catalog_entities and entity not in catalog_entities:
                raise SemanticOntologyViolationError(
                    f"Metadata violation: entity '{entity}' not present in catalog"
                )
        validation_steps.append("entities_validated")

        allowed_properties = set(contract.get("properties", []))
        candidate_properties = set(mapping.properties or contract.get("properties", []))
        if not candidate_properties.issubset(allowed_properties):
            raise SemanticOntologyViolationError(
                "Ontology violation: model requested properties outside allowed contract"
            )

        for prop in sorted(candidate_properties):
            if "." not in prop:
                raise SemanticOntologyViolationError(
                    f"Invalid property format '{prop}', expected Entity.attribute"
                )
            entity, attribute = prop.split(".", 1)
            if entity not in candidate_entities and candidate_entities:
                raise SemanticOntologyViolationError(
                    f"Property '{prop}' references undeclared entity '{entity}'"
                )
            if self._catalog and not self._catalog.get_attribute(entity, attribute):
                raise SemanticOntologyViolationError(
                    f"Metadata violation: attribute '{prop}' not found in catalog"
                )
        validation_steps.append("properties_validated")

        metric = (
            mapping.metric if mapping.metric is not None else contract.get("metric")
        )
        if metric and self._catalog:
            if _hidden_bp:
                _hidden_bp_lower = {h.lower() for h in _hidden_bp}
                _all_metric_objs = {
                    m.name: m.formula for m in self._catalog.list_metric_objects()
                }
                metrics = {
                    m
                    for m in self._catalog.list_metrics()
                    if m not in _hidden_bp
                    and not any(
                        h in (_all_metric_objs.get(m) or "").lower()
                        for h in _hidden_bp_lower
                    )
                }
            else:
                metrics = {
                    m for m in self._catalog.list_metrics() if m not in _hidden_bp
                }
            if metric not in metrics:
                raise SemanticOntologyViolationError(
                    f"Metadata violation: metric '{metric}' not found in catalog"
                )
        validation_steps.append("metrics_validated")

        allowed_relations = set(contract.get("relations", []))
        candidate_relations = set(mapping.relations or contract.get("relations", []))
        if not candidate_relations.issubset(allowed_relations):
            raise SemanticOntologyViolationError(
                "Ontology violation: relation path outside allowed contract"
            )
        validation_steps.append("relations_validated")

        connector_set: set[str] = set()
        table_set: set[str] = set()
        for entity in sorted(candidate_entities):
            ent = self._catalog.get_entity(entity) if self._catalog else None
            if not ent:
                continue
            for src in ent.sources:
                if not isinstance(src, dict):
                    continue
                connector = (
                    src.get("source") or src.get("connector") or src.get("system")
                )
                table = src.get("table")
                if isinstance(connector, str) and connector:
                    connector_set.add(connector)
                if isinstance(table, str) and table:
                    table_set.add(table)
        validation_steps.append("lineage_sources_collected")

        return NeuroSymbolicPlan(
            intent_type=intent.intent_type,
            metric=metric,
            entities=sorted(candidate_entities),
            properties=sorted(candidate_properties),
            relations=sorted(candidate_relations),
            connectors=sorted(connector_set),
            tables=sorted(table_set),
            validation_steps=validation_steps,
        )

    def _inject_plan_lineage(
        self,
        result: Result,
        plan: NeuroSymbolicPlan,
        question: str,
        mapping: OntologyIntentMapping,
    ) -> None:
        original_provenance = result.provenance or {}
        result.sources_touched = sorted(
            set(result.sources_touched).union(plan.connectors)
        )
        result.provenance = {
            "lineage": {
                "connectors": plan.connectors,
                "tables": plan.tables,
            },
            "ontology_intent": {
                "intent_type": plan.intent_type,
                "metric": plan.metric,
                "entities": plan.entities,
                "properties": plan.properties,
                "relations": plan.relations,
            },
            "validation": {
                "steps": plan.validation_steps,
                "status": "validated",
            },
            "question": question,
            "model_mapping": {
                "model": mapping.model,
                "raw": mapping.raw_payload,
            },
            "resolved_provenance": original_provenance,
        }

    # ── executor dispatch ─────────────────────────────────────────────────────

    def _execute(self, intent: Intent) -> Result:
        # Only structural (non-SQL) handlers are wired here.
        # All SQL-based golden-question handlers have been removed; those
        # questions are now served by seed Query Templates or LLM-generated SQL.
        dispatch: dict[str, Any] = {
            "impossible": self._q_impossible,
            "entity_not_modeled": self._q_entity_not_modeled,
            "disambiguation_rules": self._q_disambiguation_rules,
            "data_provenance": self._q_data_provenance,
            "glossary_lookup": self._q_glossary_lookup,
            "certified_metrics": self._q_certified_metrics,
        }
        # inject dynamic template handlers
        for tpl in self._templates:
            if tpl.get("is_active", True):
                dispatch[tpl["intent_type"]] = self._execute_template_query

        fn = dispatch.get(intent.intent_type)
        if fn is None:
            return self._execute_llm_sql(intent)
        try:
            return fn(intent)
        except Exception as _exc:
            _emsg = str(_exc).lower()
            if getattr(self, "_mgr", None) is not None and any(
                kw in _emsg
                for kw in (
                    "does not exist",
                    "not found",
                    "catalog error",
                    "no such table",
                )
            ):
                logger.info(
                    "Handler '%s' hit missing-table error, falling back to LLM SQL: %s",
                    intent.intent_type,
                    _exc,
                )
                return self._execute_llm_sql(intent)
            raise

    def _validate_generated_sql(self, sql: str) -> None:
        """Security check for LLM-generated SQL before execution.

        Stricter than payload validation: the SQL is actually executed, so we
        block DDL/DML, multi-statement, comment injection, and system tables.
        """
        stripped = sql.strip()
        if not re.match(r"^\s*(WITH|SELECT)\b", stripped, re.IGNORECASE):
            raise SemanticSecurityViolationError(
                "Generated SQL must start with SELECT or WITH"
            )
        if _DANGEROUS_SQL_RE.search(stripped):
            raise SemanticSecurityViolationError(
                "Generated SQL contains dangerous DDL/DML keyword"
            )
        if "--" in stripped or "/*" in stripped:
            raise SemanticSecurityViolationError(
                "Generated SQL contains comment tokens"
            )
        if ";" in stripped:
            raise SemanticSecurityViolationError(
                "Generated SQL contains semicolon (multi-statement blocked)"
            )
        hidden: frozenset[str] = getattr(
            SemanticLayer._thread_local, "hidden_tables", frozenset()
        )
        hidden_lower = {h.lower() for h in hidden}
        for table_ref in _SQL_TABLE_ACCESS_RE.findall(stripped):
            parts = _split_table_ref(table_ref)
            if any(p in _SYSTEM_TABLE_MARKERS for p in parts):
                raise SemanticSecurityViolationError(
                    f"Generated SQL accesses system table: {table_ref}"
                )
            # Live-mode users must never touch demo tables, even if the model
            # hallucinates one that was excluded from its schema context.
            if hidden_lower and (
                ".".join(parts) in hidden_lower or any(p in hidden_lower for p in parts)
            ):
                raise SemanticSecurityViolationError(
                    f"Generated SQL accesses a table outside this workspace: {table_ref}"
                )

    def _execute_llm_sql(self, intent: Intent) -> Result:
        """Generate and execute SQL via LLM for questions with no hardcoded handler.

        Uses the full DuckDB schema context so the LLM can write valid SQL against
        any registered source, not just the golden ERP/CRM/HR/PIM tables.
        """
        provider = _llm_intent_provider()
        if provider is None:
            # Build the hint from catalog entities visible to this request.
            _hidden = getattr(SemanticLayer._thread_local, "hidden_tables", frozenset())
            if self._catalog:
                _all = self._catalog.list_entities()
                _hint_tables = sorted(e for e in _all if e not in _hidden)[:6]
            else:
                _hint_tables = []
            _hint = (
                f" Try asking about: {', '.join(_hint_tables)}." if _hint_tables else ""
            )
            return Result(
                answer=(
                    "I don't recognize this question type. "
                    "No LLM key is configured for dynamic SQL generation." + _hint
                ),
                notes="unknown_intent_no_llm",
            )

        if self._mgr is None:
            return Result(
                answer="Dynamic SQL generation requires a configured data manager.",
                notes="no_manager",
            )

        # Build schema context from catalog (populated from DuckDB snapshot).
        # Hidden tables (demo data for live-mode users) are excluded so the
        # model can neither reference them nor reveal their existence.
        _hidden: frozenset[str] = getattr(
            SemanticLayer._thread_local, "hidden_tables", frozenset()
        )
        # GraphRAG: retrieve the relevant sub-graph (relations, concepts,
        # metrics) for this question first. Its tables seed the schema prompt as
        # *priority tables* (always included, never dropped by the table cap), so
        # the tables a question needs are present no matter how many tables the
        # unified multi-source model has. Degrades to empty when nothing matches.
        _graph_block = ""
        _graph_prov: dict[str, Any] = {}
        _priority_tables: frozenset[str] = frozenset()
        if self._kg is not None:
            try:
                from .graph_rag import build_graph_context

                _gr = build_graph_context(self._kg, intent.raw_question, _hidden)
                _priority_tables = frozenset(_gr.get("tables") or [])
                if _gr.get("context"):
                    _graph_block = "\n\n" + _gr["context"]
                    _graph_prov = {"nodes": _gr["nodes"], "edges": _gr["edges"]}
            except Exception as _gr_exc:  # noqa: BLE001 — never break the query
                logger.debug("graph context retrieval skipped: %s", _gr_exc)

        schema_ctx = (
            self._catalog.get_schema_context(
                exclude_tables=_hidden, priority_tables=_priority_tables
            )
            if self._catalog
            else "No schema available."
        )

        # Append any user-supplied business context notes to the schema prompt.
        # In live mode, exclude default (AW demo) context docs — they describe
        # the demo dataset, not the user's own data, so they would confuse the
        # LLM rather than help it.
        _all_ctx_docs = getattr(self, "_context_docs", []) or []
        _ctx_docs = (
            [d for d in _all_ctx_docs if not d.get("is_default", False)]
            if _hidden
            else _all_ctx_docs
        )
        _ctx_block = ""
        if _ctx_docs:
            _ctx_parts = [
                f"### {d.get('title', 'Context')}\n{d.get('content', '')}"
                for d in _ctx_docs
                if d.get("content")
            ]
            if _ctx_parts:
                _ctx_block = "\n\n### Business Context\n" + "\n\n".join(_ctx_parts)

        system_prompt = (
            "You are a SQL generator for a DuckDB analytical database. "
            "Generate a single SELECT query (or CTE + SELECT) that answers the "
            "user's business question using ONLY the tables and columns listed below. "
            "Return a JSON object with exactly one key: 'sql' containing the query string. "
            "Rules: SELECT only (no DDL, no DML). "
            "No semicolons. No comment tokens (-- or /*). "
            "Use double-quoted identifiers when column or table names contain spaces. "
            "If the question cannot be answered from the available schema, return "
            '{"sql": "", "reason": "<explanation>"}.\n\n'
            f"{schema_ctx}{_ctx_block}{_graph_block}"
        )
        user_content = json.dumps(
            {
                "question": intent.raw_question,
                "hint": intent.intent_type,
                "filters": intent.filters,
                "year": intent.year,
                "limit": intent.limit,
            }
        )

        try:
            if provider == "groq":
                raw_text = _complete_json_via_groq(
                    system_prompt, user_content, max_tokens=1200
                )
            else:
                raw_text = _complete_json_via_anthropic(
                    system_prompt, user_content, max_tokens=1200
                )
            payload = _extract_json_payload(raw_text)
        except Exception as exc:
            # Provider exceptions can embed auth errors, request ids and other
            # internals — log the detail but never surface it to the end user.
            logger.warning("_execute_llm_sql: LLM call failed: %s", exc)
            return Result(
                answer=(
                    "The query service is temporarily unavailable — "
                    "please try again in a moment."
                ),
                notes="llm_sql_generation_failed",
            )

        sql = str(payload.get("sql", "")).strip()
        if not sql:
            reason = payload.get(
                "reason", "question cannot be answered from available data"
            )
            return Result(
                answer=f"This question cannot be answered: {reason}",
                notes="llm_sql_no_query",
            )

        try:
            self._validate_generated_sql(sql)
        except SemanticSecurityViolationError as exc:
            logger.error("_execute_llm_sql: security block on generated SQL: %s", exc)
            raise

        try:
            rows = self._mgr.execute(sql)
        except Exception as exc:
            logger.warning("_execute_llm_sql: execution failed: %s | sql=%s", exc, sql)
            return Result(
                answer="The query could not be executed. Please try rephrasing your question.",
                sql_used=sql,
                notes="llm_sql_exec_error",
            )

        # Derive which tables were touched from SQL
        touched = list(
            {
                ref.split(".")[-1]
                for ref in _SQL_TABLE_ACCESS_RE.findall(sql)
                if ref.split(".")[-1].lower() not in _SYSTEM_TABLE_MARKERS
            }
        )

        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=touched or ["duckdb_unified"],
            provenance={
                "generated_by": "llm_sql",
                "provider": provider,
                "intent_hint": intent.intent_type,
                **({"graph_context": _graph_prov} if _graph_prov else {}),
            },
            notes="Dynamic SQL generated from schema context.",
        )

    # ── structural query handlers ─────────────────────────────────────────────
    # SQL-based golden-question handlers have been removed. Those questions are
    # now served by seed Query Templates (DB) or LLM-generated SQL fallback.

    def _q_data_provenance(self, intent: Intent) -> Result:
        all_entities = self._catalog.list_entities() if self._catalog else []
        # Filter out tables that are invisible to this request (e.g. demo tables
        # for live-mode users) — they must not appear in provenance output.
        hidden: frozenset[str] = getattr(
            SemanticLayer._thread_local, "hidden_tables", frozenset()
        )
        entities = [e for e in all_entities if e not in hidden]
        prov_data: dict = {}
        for ent in entities:
            meta = self._catalog.get_entity(ent)
            if meta:
                prov_data[ent] = meta.to_dict()
        return Result(
            answer=prov_data,
            sources_touched=entities,
            provenance=prov_data,
            notes="Full provenance dump from MetadataCatalog",
        )

    def _q_impossible(self, intent: Intent) -> Result:
        reason = intent.filters.get("reason", "unknown")
        messages = {
            "nationality_not_available": (
                "The field 'employee nationality' is not available in any of the configured data sources. "
                "This attribute is not available in the current dataset. "
                "Unable to answer the question."
            ),
        }
        msg = messages.get(reason, "Data not available in the current sources.")
        return Result(
            answer=msg,
            sources_touched=[],
            notes=msg,
            disambiguation_required=False,
        )

    # ── EC-02: entity not modeled ─────────────────────────────────────────────

    def _q_entity_not_modeled(self, intent: Intent) -> Result:
        entity = intent.filters.get("entity", "Unknown")
        _live = bool(getattr(SemanticLayer._thread_local, "hidden_tables", frozenset()))
        if _live:
            # For live users, list only their own entities (not the demo ones
            # that share the same catalog/ontology instance).
            hidden = getattr(SemanticLayer._thread_local, "hidden_tables", frozenset())
            available: str | None = None
            if self._catalog:
                all_draft = self._catalog.get_draft_entities()
                live_entities = [
                    e["name"] for e in all_draft if e.get("table") not in hidden
                ]
                if live_entities:
                    available = ", ".join(sorted(live_entities)[:12])
            if available:
                msg = (
                    f"The entity '{entity}' is not in your semantic layer. "
                    f"Available entities are: {available}."
                )
            else:
                msg = (
                    f"The entity '{entity}' is not in your workspace yet. "
                    "Connect a data source and run the pipeline to build your ontology."
                )
        else:
            if self._effective_docs and self._effective_docs.entities:
                available = ", ".join(
                    e.display_name for e in self._effective_docs.entities
                )
            elif self._ontology:
                available = ", ".join(sorted(self._ontology.entity_names()))
            elif self._catalog:
                available = ", ".join(sorted(self._catalog.list_entities())[:12])
            else:
                available = None
            if available:
                msg = (
                    f"The entity '{entity}' is not modeled in the semantic layer. "
                    f"Available entities are: {available}."
                )
            else:
                msg = (
                    f"The entity '{entity}' is not modeled in the semantic layer. "
                    "Connect a data source and run the pipeline to build your ontology."
                )
        return Result(
            answer=msg,
            sources_touched=[],
            notes=msg,
            disambiguation_required=False,
        )

    # ── EC-10: glossary lookup ────────────────────────────────────────────────

    # DEPRECATED: _GLOSSARY is kept as a last-resort fallback only.
    # On startup, these terms are seeded as Context Documents in the catalog
    # (see app.semantic.glossary.DEFAULT_GLOSSARY + catalog.seed_glossary_docs).
    # The handler now reads from the catalog first so users can edit/extend terms
    # without touching Python code.  Do not add new terms here.
    _GLOSSARY: dict[str, str] = {
        "cliente attivo": (
            "An 'active customer' is a CRM account with isActive=1 and accountId > 0 "
            "(accountId < 0 indicates a duplicate excluded from the clean model). "
            "Can be B2B or B2C."
        ),
        "fatturato": (
            "'Fatturato' is an ambiguous term in the system: it can refer to "
            "revenue (SUM subtotal_amount, ~$20M) or revenue_with_tax "
            "(SUM total_due, ~$22.4M which includes taxes and shipping). "
            "Please specify which definition to use."
        ),
        "revenue": (
            "revenue = SUM(subtotal_amount) — pure revenue without taxes or shipping (~$20M). "
            "Values in USD ($)."
        ),
        "revenue_with_tax": (
            "revenue_with_tax = SUM(total_due) — gross revenue including taxes and shipping (~$22.4M). "
            "Values in USD ($)."
        ),
        "margin": (
            "margin = SUM(qty * (listPrice - standardCost)) — gross margin per product. "
            "Calculated cross-ERP+PIM. Values in USD ($)."
        ),
        "active_customers": (
            "active_customers = COUNT(DISTINCT accountId) WHERE accountId > 0 AND isActive=1. "
            "Duplicates (accountId < 0) are excluded by the deduplication Rule."
        ),
        "duplicato": (
            "A 'duplicate' is a CRM record with accountId < 0. "
            "The disambiguation Rule automatically excludes these records from all metrics."
        ),
        "accountid": (
            "accountId > 0 = valid customer record; "
            "accountId < 0 = CRM duplicate (excluded from the clean model by the deduplication Rule)."
        ),
        "make only": (
            "'Make Only' product (isMakeOnly=true in PIM): product manufactured internally, "
            "not purchased from external suppliers."
        ),
        "hr": (
            "HR/PIM is the data source for employees and product catalog. "
            "Sync status is 'Delayed': data may not be updated in real time."
        ),
    }

    def _q_glossary_lookup(self, intent: Intent) -> Result:
        raw_term = (intent.filters.get("term") or "").lower().strip(" '\"?.,")

        if self._effective_docs and self._effective_docs.glossary:
            # Search through docs glossary first
            definition: str | None = None
            for entry in self._effective_docs.glossary:
                if entry.term.lower() == raw_term:
                    definition = entry.definition
                    break
            if definition is None and raw_term:
                for entry in self._effective_docs.glossary:
                    if raw_term in entry.term.lower() or entry.term.lower() in raw_term:
                        definition = entry.definition
                        break
            if definition is None:
                available = ", ".join(
                    sorted(e.term for e in self._effective_docs.glossary)
                )
                definition = (
                    f"The term '{raw_term}' is not present in the semantic layer glossary. "
                    f"Available terms: {available}."
                )
            return Result(
                answer=definition,
                sources_touched=[],
                notes="Response from the semantic layer glossary/ontology.",
                disambiguation_required=False,
            )

        # Try catalog context docs (titles starting with "Glossary: ") — user-editable.
        # In live mode, exclude builtin-seeded terms (demo AW definitions) so users
        # only see glossary entries they explicitly added themselves.
        _live_mode = bool(
            getattr(SemanticLayer._thread_local, "hidden_tables", frozenset())
        )
        if self._catalog:
            catalog_docs = self._catalog.list_context_docs(exclude_builtin=_live_mode)
            glossary_docs = [
                d for d in catalog_docs if d["title"].startswith("Glossary: ")
            ]
            if glossary_docs:
                definition = None
                for doc in glossary_docs:
                    term_key = doc["title"][len("Glossary: ") :].lower()
                    if term_key == raw_term:
                        definition = doc["content"]
                        break
                if definition is None and raw_term:
                    for doc in glossary_docs:
                        term_key = doc["title"][len("Glossary: ") :].lower()
                        if raw_term in term_key or term_key in raw_term:
                            definition = doc["content"]
                            break
                if definition is None:
                    available = ", ".join(
                        sorted(d["title"][len("Glossary: ") :] for d in glossary_docs)
                    )
                    definition = (
                        f"The term '{raw_term}' is not present in the semantic layer glossary. "
                        f"Available terms: {available}."
                    )
                return Result(
                    answer=definition,
                    sources_touched=[],
                    notes="Response from the semantic layer glossary/ontology.",
                    disambiguation_required=False,
                )

        # Fallback to hardcoded glossary (deprecated — terms should be seeded as context docs).
        # Skipped for live-mode requests: _GLOSSARY encodes AW demo semantics and would
        # return AW-specific definitions (column names, dollar figures) to live users.
        if not _live_mode:
            definition = self._GLOSSARY.get(raw_term)
            if definition is None and raw_term:
                for key, val in self._GLOSSARY.items():
                    if raw_term in key or key in raw_term:
                        definition = val
                        break
            if definition is None:
                definition = (
                    f"The term '{raw_term}' is not present in the semantic layer glossary. "
                    "Available terms: " + ", ".join(sorted(self._GLOSSARY.keys())) + "."
                )
        else:
            definition = (
                f"The term '{raw_term}' is not in your workspace glossary. "
                "Add glossary definitions via the Semantic Layer → Context tab."
            )
        return Result(
            answer=definition,
            sources_touched=[],
            notes="Response from the semantic layer glossary/ontology.",
            disambiguation_required=False,
        )

    # ── DQ-03: disambiguation rules ───────────────────────────────────────────

    def _q_disambiguation_rules(self, intent: Intent) -> Result:
        if self._effective_docs and self._effective_docs.disambiguation_rules:
            rules = [
                {
                    "rule_id": r.id,
                    "name": r.name,
                    "description": r.description,
                }
                for r in self._effective_docs.disambiguation_rules
            ]
            n = len(rules)
            return Result(
                answer=rules,
                sources_touched=[],
                notes=(f"{n} active disambiguation rules in the semantic layer."),
                disambiguation_required=False,
            )

        # Hardcoded rules are AW demo-specific — never surface to live users.
        _live = bool(getattr(SemanticLayer._thread_local, "hidden_tables", frozenset()))
        if _live:
            return Result(
                answer=[],
                sources_touched=[],
                notes="No disambiguation rules configured for this workspace.",
                disambiguation_required=False,
            )
        rules = [
            {
                "rule_id": "R1",
                "name": "accountId deduplication",
                "description": (
                    "CRM records with accountId < 0 are duplicates. "
                    "All counts and metrics automatically exclude these records "
                    "(filter: WHERE accountId > 0 or accountId >= 0)."
                ),
            },
            {
                "rule_id": "R2",
                "name": "Revenue vs subtotal_amount",
                "description": (
                    "The term 'fatturato'/'revenue' is ambiguous: "
                    "revenue = SUM(subtotal_amount) (~$20M, without taxes/shipping); "
                    "revenue_with_tax = SUM(total_due) (~$22.4M, with taxes and shipping). "
                    "Without an explicit qualifier, an AmbiguityError is raised."
                ),
            },
            {
                "rule_id": "R3",
                "name": "HR freshness Delayed",
                "description": (
                    "The HR/PIM source has sync status 'Delayed': "
                    "employee data is not updated in real time. "
                    "Employee counts may not reflect the current situation. "
                    "All HR responses include a freshness warning."
                ),
            },
        ]
        return Result(
            answer=rules,
            sources_touched=[],
            notes=(
                "3 active disambiguation rules in the semantic layer: "
                "R1=accountId<0 duplicates, R2=revenue ambiguity, R3=HR freshness delayed."
            ),
            disambiguation_required=False,
        )

    # ── SS-07: certified metrics list ─────────────────────────────────────────

    # DEPRECATED: _CERTIFIED_METRICS is kept as a last-resort fallback only.
    # The handler now reads from self._catalog.list_metric_objects() first.
    # Only used when the catalog returns zero metrics (e.g. during cold-start tests).
    # Do not add new metrics here — add them to the catalog instead.
    _CERTIFIED_METRICS: list[dict[str, str]] = [
        {
            "name": "revenue",
            "definition": "SUM(subtotal_amount)",
            "source": "ERP sales_order_header",
            "unit": "USD ($)",
            "status": "certified",
        },
        {
            "name": "revenue_with_tax",
            "definition": "SUM(total_due)",
            "source": "ERP sales_order_header",
            "unit": "USD ($)",
            "status": "certified",
        },
        {
            "name": "margin",
            "definition": "SUM(qty * (listPrice - standardCost))",
            "source": "ERP sales_order_line + PIM product_catalog_pim",
            "unit": "USD ($)",
            "status": "certified",
        },
        {
            "name": "active_customers",
            "definition": "COUNT(DISTINCT accountId) WHERE accountId > 0 AND isActive=1",
            "source": "CRM account",
            "unit": "count",
            "status": "certified",
        },
        {
            "name": "count_orders",
            "definition": "COUNT(*) FROM sales_order_header",
            "source": "ERP sales_order_header",
            "unit": "count",
            "status": "certified",
        },
        {
            "name": "count_employees",
            "definition": "COUNT(*) FROM hr_employees",
            "source": "HR/PIM hr_employees",
            "unit": "count",
            "status": "certified",
            "freshness": "Delayed — data not in real time",
        },
    ]

    def _q_certified_metrics(self, intent: Intent) -> Result:
        if self._effective_docs and self._effective_docs.metrics:
            certified = [m for m in self._effective_docs.metrics if m.certified]
            answer = [
                {
                    "name": m.name,
                    "display_name": m.display_name,
                    "description": m.description,
                    "unit": m.unit,
                    "status": "certified",
                }
                for m in certified
            ]
            return Result(
                answer=answer,
                sources_touched=[],
                notes=(
                    f"{len(certified)} certified metrics available in the semantic layer. "
                    "Fixed and deterministic list."
                ),
                disambiguation_required=False,
            )

        # Try catalog metrics — user-editable via the metadata catalog
        if self._catalog:
            _cm_hidden: frozenset[str] = getattr(
                SemanticLayer._thread_local, "hidden_tables", frozenset()
            )
            _cm_hidden_lower = {h.lower() for h in _cm_hidden}
            catalog_metrics = self._catalog.list_metric_objects()
            if _cm_hidden_lower:
                # Exclude metrics whose formula references a hidden demo table
                # (e.g. SUM(sales_order_header.subtotal_amount) must not reach live users).
                catalog_metrics = [
                    m
                    for m in catalog_metrics
                    if not any(h in (m.formula or "").lower() for h in _cm_hidden_lower)
                ]
            if catalog_metrics:
                answer = [
                    {
                        "name": m.name,
                        "definition": m.formula,
                        "source": ", ".join(m.sources_touched)
                        if m.sources_touched
                        else "",
                        "unit": m.unit,
                        "status": "certified",
                    }
                    for m in catalog_metrics
                ]
                return Result(
                    answer=answer,
                    sources_touched=[],
                    notes=(
                        f"{len(answer)} certified metrics available in the semantic layer. "
                        "Fixed and deterministic list."
                    ),
                    disambiguation_required=False,
                )

        # Fallback to hardcoded list (deprecated — metrics should come from the catalog).
        # Skipped for live-mode requests: _CERTIFIED_METRICS encodes AW demo semantics.
        _live = bool(getattr(SemanticLayer._thread_local, "hidden_tables", frozenset()))
        if _live:
            return Result(
                answer=[],
                sources_touched=[],
                notes="No certified metrics configured for this workspace yet.",
                disambiguation_required=False,
            )
        return Result(
            answer=self._CERTIFIED_METRICS,
            sources_touched=[],
            notes=(
                f"{len(self._CERTIFIED_METRICS)} certified metrics available in the semantic layer. "
                "Fixed and deterministic list."
            ),
            disambiguation_required=False,
        )

    # ── provenance helper ─────────────────────────────────────────────────────

    def _prov(self, entity: str, attributes: list[str]) -> dict:
        if not self._catalog:
            return {}
        prov: dict = {}
        ent_meta = self._catalog.get_entity(entity)
        if ent_meta:
            prov[entity] = ent_meta.to_dict()
        for attr in attributes:
            attr_meta = self._catalog.get_attribute(entity, attr)
            if attr_meta:
                prov[f"{entity}.{attr}"] = attr_meta.to_dict()
        return prov

    def _execute_template_query(self, intent: "Intent") -> "Result":
        """Execute a user-defined query template with safe token substitution."""
        import re as _re

        tpl_id_str = intent.intent_type[4:]  # strip "tpl_"
        tpl = next(
            (
                t
                for t in self._templates
                if str(t["id"]) == tpl_id_str and t.get("is_active", True)
            ),
            None,
        )
        if tpl is None:
            return Result(
                answer="Template not found or inactive.",
                notes="template_missing",
            )

        sql = tpl["sql_query"]

        # Safe substitution of {year}
        # Prefer filters["year"] (rule parser path); fall back to intent.year
        # (set by LLM mapping when the rule parser didn't extract a year).
        year_val = (
            intent.filters.get("year")
            if intent.filters.get("year") is not None
            else intent.year
        )
        if year_val is not None:
            try:
                y = int(year_val)
                if not (2000 <= y <= 2100):
                    raise ValueError
                sql = sql.replace("{year}", str(y))
            except ValueError:
                sql = sql.replace("{year}", "2024")
        else:
            sql = sql.replace("{year}", "2024")

        # Safe substitution of {limit}
        # Prefer filters["limit"]; fall back to intent.limit (set by rule parser).
        limit_val = (
            intent.filters.get("limit")
            if intent.filters.get("limit") is not None
            else intent.limit
        )
        if limit_val is not None:
            try:
                lim = int(limit_val)
                lim = max(1, min(lim, 100))
                sql = sql.replace("{limit}", str(lim))
            except ValueError:
                sql = sql.replace("{limit}", "10")
        else:
            sql = sql.replace("{limit}", "10")

        # Reject any remaining unfilled tokens
        remaining = _re.findall(r"\{(\w+)\}", sql)
        if remaining:
            return Result(
                answer=f"Template has unsupported tokens: {remaining}",
                notes="template_bad_tokens",
            )

        try:
            self._validate_generated_sql(sql)
        except SemanticSecurityViolationError:
            # Do not echo the table name — live users must not learn which demo
            # tables exist from error messages.
            return Result(
                answer="This template is not available for your workspace.",
                notes="template_unavailable",
            )
        except Exception as exc:
            logger.warning("Template SQL failed validation: %s", exc)
            return Result(
                answer="Template query could not be validated.",
                notes="template_invalid_sql",
            )

        try:
            rows = self._exec(sql)
        except Exception as exc:
            logger.warning("Template query execution failed: %s", exc)
            return Result(
                answer="Template query failed — check server logs for details.",
                sql_used=sql,
                notes="template_exec_error",
            )

        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=tpl.get("sources", []) or ["duckdb_unified"],
            notes=f"template:{tpl['name']}",
        )
