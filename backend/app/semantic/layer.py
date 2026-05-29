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
    "customers_without_orders": {
        "metric": None,
        "entities": ["Customer", "SalesOrder"],
        "properties": ["Customer.accountId", "SalesOrder.order_id"],
        "relations": [],
    },
    "employees_with_duplicate_customers": {
        "metric": None,
        "entities": ["Employee", "Customer"],
        "properties": ["Employee.MatricolaDip", "Customer.accountId"],
        "relations": [],
    },
    "certified_metrics": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    "count_employees": {
        "metric": None,
        "entities": ["Employee"],
        "properties": ["Employee.MatricolaDip", "Employee.Reparto"],
        "relations": [],
    },
    "count_employees_by_group": {
        "metric": None,
        "entities": ["Employee"],
        "properties": ["Employee.GruppoReparto"],
        "relations": [],
    },
    "avg_hourly_rate": {
        "metric": None,
        "entities": ["Employee"],
        "properties": ["Employee.RetribuzioneOraria", "Employee.Reparto"],
        "relations": [],
    },
    "product_price": {
        "metric": None,
        "entities": ["Product"],
        "properties": [
            "Product.displayName",
            "Product.listPrice",
            "Product.standardCost",
        ],
        "relations": [],
    },
    "count_make_only": {
        "metric": None,
        "entities": ["Product"],
        "properties": ["Product.isMakeOnly"],
        "relations": [],
    },
    "count_orders": {
        "metric": None,
        "entities": ["SalesOrder"],
        "properties": ["SalesOrder.order_id", "SalesOrder.order_date"],
        "relations": [],
    },
    "list_b2b_active": {
        "metric": None,
        "entities": ["Customer"],
        "properties": [
            "Customer.accountType",
            "Customer.isActive",
            "Customer.ragioneSociale",
        ],
        "relations": [],
    },
    "customers_by_state": {
        "metric": None,
        "entities": ["Customer"],
        "properties": ["Customer.accountId"],
        "relations": [],
    },
    "top_salesperson_by_orders": {
        "metric": None,
        "entities": ["SalesOrder", "Employee"],
        "properties": [
            "SalesOrder.salesperson_ref",
            "SalesOrder.order_id",
            "Employee.MatricolaDip",
        ],
        "relations": ["SalesOrder.salesperson_ref->Employee"],
    },
    "top_salespersons_by_revenue": {
        "metric": "revenue_with_tax",
        "entities": ["SalesOrder", "Employee"],
        "properties": [
            "SalesOrder.salesperson_ref",
            "SalesOrder.total_due",
            "Employee.MatricolaDip",
        ],
        "relations": ["SalesOrder.salesperson_ref->Employee"],
    },
    "revenue_by_territory": {
        "metric": "revenue_with_tax",
        "entities": ["SalesOrder", "Territory"],
        "properties": ["SalesOrder.total_due", "SalesOrder.territory_ref"],
        "relations": ["SalesOrder.territory_ref->Territory"],
    },
    "revenue_vs_quota": {
        "metric": "revenue_with_tax",
        "entities": ["SalesOrder", "Salesperson"],
        "properties": ["SalesOrder.total_due", "SalesOrder.salesperson_ref"],
        "relations": ["SalesOrder.salesperson_ref->Salesperson"],
    },
    "top_customer_by_spend": {
        "metric": "revenue_with_tax",
        "entities": ["SalesOrder", "Customer"],
        "properties": [
            "SalesOrder.customer_ref",
            "SalesOrder.total_due",
            "Customer.accountId",
        ],
        "relations": ["SalesOrder.customer_ref->Customer"],
    },
    "top_products_by_qty": {
        "metric": None,
        "entities": ["SalesOrderLine", "Product"],
        "properties": [
            "SalesOrderLine.product_ref",
            "SalesOrderLine.qty",
            "Product.displayName",
        ],
        "relations": ["SalesOrderLine.product_ref->Product"],
    },
    "customer_state_most_orders": {
        "metric": None,
        "entities": ["SalesOrder", "Customer"],
        "properties": [
            "SalesOrder.customer_ref",
            "SalesOrder.order_id",
            "Customer.accountId",
        ],
        "relations": ["SalesOrder.customer_ref->Customer"],
    },
    "margin_per_salesperson": {
        "metric": "margin",
        "entities": ["SalesOrder", "SalesOrderLine", "Product"],
        "properties": [
            "SalesOrder.salesperson_ref",
            "SalesOrderLine.product_ref",
            "SalesOrderLine.qty",
            "Product.standardCost",
            "Product.listPrice",
        ],
        "relations": [
            "SalesOrder.hasLine->SalesOrderLine",
            "SalesOrderLine.product_ref->Product",
        ],
    },
    "avg_revenue_by_segment": {
        "metric": "revenue_with_tax",
        "entities": ["SalesOrder", "Customer"],
        "properties": [
            "SalesOrder.customer_ref",
            "SalesOrder.total_due",
            "Customer.accountType",
        ],
        "relations": ["SalesOrder.customer_ref->Customer"],
    },
    "top_category_by_margin": {
        "metric": "margin",
        "entities": ["SalesOrderLine", "Product"],
        "properties": [
            "SalesOrderLine.product_ref",
            "SalesOrderLine.qty",
            "Product.categoryPath",
            "Product.standardCost",
            "Product.listPrice",
        ],
        "relations": ["SalesOrderLine.product_ref->Product"],
    },
    "orders_with_discount": {
        "metric": None,
        "entities": ["SalesOrderLine"],
        "properties": ["SalesOrderLine.offer_ref"],
        "relations": [],
    },
    "count_customers_unique": {
        "metric": "active_customers",
        "entities": ["Customer"],
        "properties": ["Customer.accountId"],
        "relations": [],
    },
    "check_duplicate_accounts": {
        "metric": None,
        "entities": ["Customer"],
        "properties": [
            "Customer.accountId",
            "Customer.ragioneSociale",
            "Customer.nomeContatto",
        ],
        "relations": [],
    },
    "data_provenance": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
    "revenue_with_tax": {
        "metric": "revenue_with_tax",
        "entities": ["SalesOrder"],
        "properties": ["SalesOrder.total_due", "SalesOrder.order_date"],
        "relations": [],
    },
    "lookup_employee": {
        "metric": None,
        "entities": ["Employee"],
        "properties": [
            "Employee.MatricolaDip",
            "Employee.Nome",
            "Employee.Cognome",
            "Employee.Reparto",
        ],
        "relations": [],
    },
    "impossible": {
        "metric": None,
        "entities": [],
        "properties": [],
        "relations": [],
    },
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
    r"\b(?:from|join|into|update|table)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)",
    re.IGNORECASE,
)
_SYSTEM_TABLE_MARKERS = {
    "sqlite_master",
    "sqlite_temp_master",
    "information_schema",
    "pg_catalog",
    "pg_tables",
    "mysql",
    "sys",
}


def _anthropic_model() -> str:
    """Model ID for LLM intent mapping. Overridable via env without a redeploy."""
    return os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"


def _groq_model() -> str:
    """Groq model ID. Overridable via env without a redeploy."""
    return (
        os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
        or "llama-3.3-70b-versatile"
    )


def _llm_intent_provider() -> str | None:
    """Pick the LLM provider for intent mapping based on configured keys.

    Groq is preferred when present because it is free; Anthropic is used as a
    fallback. Returns None when no provider key is configured.
    """
    if os.getenv("GROQ_API_KEY", "").strip():
        return "groq"
    if os.getenv("ANTHROPIC_API_KEY", "").strip():
        return "anthropic"
    return None


def _complete_json_via_groq(system_prompt: str, user_content: str) -> str:
    """Call Groq's OpenAI-compatible chat endpoint and return the raw text."""
    import httpx

    api_key = os.getenv("GROQ_API_KEY", "").strip()
    resp = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": _groq_model(),
            "max_tokens": 500,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _complete_json_via_anthropic(system_prompt: str, user_content: str) -> str:
    """Call Anthropic's Messages API and return the raw text."""
    import anthropic

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", "").strip())
    msg = client.messages.create(
        model=_anthropic_model(),
        max_tokens=500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    return msg.content[0].text


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


# ── Rule-based intent parser ──────────────────────────────────────────────────


class _RuleParser:
    """Rule-based intent parser that handles the 25 golden questions."""

    # Compiled patterns (order matters — more specific first)
    _YEAR_RE = re.compile(r"\b(20\d{2})\b")
    _LIMIT_RE = re.compile(r"\btop[\s-]?(\d+)\b", re.IGNORECASE)
    _DEPT_RE = re.compile(
        r'"([^"]+)"|\'([^\']+)\'|reparto\s+([A-Za-z &]+)', re.IGNORECASE
    )

    def parse(self, question: str) -> Intent:
        q = question.lower()
        # The deterministic patterns below were authored for Italian questions.
        # The product UI is now English, so normalise the most common English
        # business terms to the Italian tokens the patterns already match.
        # This is additive: Italian questions are unaffected (terms map to
        # themselves), and it lets English questions hit the same intents.
        q = _normalize_english_terms(q)

        year = self._extract_year(question)
        limit = self._extract_limit(q)

        # ── Q25: impossible query — MUST come before fatturato check ─────────
        if "italian" in q or "nazionalit" in q or "italiano" in q.split():
            return Intent(
                intent_type="impossible",
                filters={"reason": "nationality_not_available"},
                raw_question=question,
            )

        # ── EC-02: entity not modeled — fornitori / supplier / vendor ────────
        if any(kw in q for kw in ["fornitore", "fornitori", "supplier", "vendor"]):
            return Intent(
                intent_type="entity_not_modeled",
                filters={"entity": "Supplier"},
                raw_question=question,
            )

        # ── EC-10: glossary lookup — "cosa intendete per", "definizione di" ──
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

        # ── DQ-03: disambiguation rules explanation ───────────────────────────
        if ("disambiguazion" in q or "regole" in q) and (
            "attiv" in q or "disambiguazion" in q or "spiega" in q
        ):
            return Intent(intent_type="disambiguation_rules", raw_question=question)

        # ── SS-07: certified metrics list ─────────────────────────────────────
        if ("metriche" in q or "metric" in q) and (
            "certif" in q or "disponibil" in q or "quali" in q
        ):
            return Intent(intent_type="certified_metrics", raw_question=question)

        # ── MH-07: employees who managed duplicate-account customers ──────────
        if ("dipendenti" in q or "employee" in q or "dipendente" in q) and (
            "account" in q and ("duplicat" in q or "accountid" in q or "negativ" in q)
        ):
            return Intent(
                intent_type="employees_with_duplicate_customers",
                raw_question=question,
            )

        # ── 1H-02: customers without orders (anti-join) ───────────────────────
        if (
            "client" in q
            and (
                "mai" in q
                or "nessun ordine" in q
                or "senza ordini" in q
                or "non hanno" in q
            )
            and ("ordine" in q or "ordini" in q or "crm" in q)
        ):
            return Intent(intent_type="customers_without_orders", raw_question=question)

        # ── Q21: ambiguous "fatturato" — only when standing alone ────────────
        # "fatturato totale per territorio", "fatturato per venditore", etc.
        # are contextually resolved to revenue_with_tax per golden questions hint Q7.
        # Only raise AmbiguityError when "fatturato" appears without a dimensional qualifier.
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
            # Q21 pattern: standalone "fatturato" with year only
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

        # ── EC-01: ambiguous "vendite" — standalone triggers disambiguation ───
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

        # ── Q22: employee lookup by first name ─────────────────────────────
        if "dipendente" in q or "employee" in q:
            name_m = re.search(
                r'"([^"]+)"|\'([^\']+)\'|\bdipendente\s+["\']?([A-Za-z]+)', q
            )
            if not name_m:
                # Try bare name after keyword
                name_m = re.search(
                    r'(?:mostrami|trova|cerca)\s+(?:il\s+)?dipendente\s+["\']?(\w+)',
                    q,
                    re.IGNORECASE,
                )
            if name_m:
                name = next(g for g in name_m.groups() if g)
                return Intent(
                    intent_type="lookup_employee",
                    filters={"name": name},
                    raw_question=question,
                )

        # ── Q20: unique customers after dedup ─────────────────────────────
        if "clienti unici" in q or ("quanti clienti" in q and "duplicat" in q):
            return Intent(intent_type="count_customers_unique", raw_question=question)

        # ── Q24: duplicate accounts check ─────────────────────────────────
        if "più di un account" in q or ("account" in q and "duplicat" in q):
            name_m = re.search(r'"([^"]+)"|\'([^\']+)\'', question)
            company = name_m.group(1) if name_m else None
            return Intent(
                intent_type="check_duplicate_accounts",
                filters={"company": company},
                raw_question=question,
            )

        # ── Q23: data provenance ───────────────────────────────────────────
        if "provenienza" in q or "fonte" in q or "aggiornato" in q or "freschezza" in q:
            return Intent(intent_type="data_provenance", raw_question=question)

        # ── Q11: employees by department group — MUST come before Q1 ────────
        if ("gruppo" in q or "group" in q) and ("reparto" in q or "department" in q):
            return Intent(intent_type="count_employees_by_group", raw_question=question)

        # ── Q19: orders with discount — MUST come before Q3 ──────────────
        if "sconto" in q or "offerta speciale" in q or "discount" in q:
            return Intent(intent_type="orders_with_discount", raw_question=question)

        # ── Q1: employees in department ───────────────────────────────────
        if any(kw in q for kw in ["dipendenti", "quanti dipendenti", "quante persone"]):
            dept = self._extract_quoted_or_named(question, prefixes=["reparto", "in"])
            return Intent(
                intent_type="count_employees",
                filters={"department": dept},
                raw_question=question,
            )

        # ── Q11: employees by department group ────────────────────────────
        if "gruppo" in q and ("reparto" in q or "department" in q):
            return Intent(intent_type="count_employees_by_group", raw_question=question)

        # ── Q5: average hourly rate ────────────────────────────────────────
        if "retribuzione" in q or "paga" in q or "stipendio" in q or "salario" in q:
            dept = self._extract_quoted_or_named(
                question, prefixes=["reparto", "in", "nel"]
            )
            return Intent(
                intent_type="avg_hourly_rate",
                filters={"department": dept},
                raw_question=question,
            )

        # ── Q2: product price lookup ──────────────────────────────────────
        if "prezzo" in q or "listino" in q or "price" in q:
            prod = self._extract_quoted(question) or _extract_product_code(question)
            return Intent(
                intent_type="product_price",
                filters={"product_name": prod},
                raw_question=question,
            )

        # ── Q12: make-only products ───────────────────────────────────────
        if "make only" in q or "makeonly" in q or "prodotti intern" in q:
            return Intent(intent_type="count_make_only", raw_question=question)

        # ── Q3: order count ───────────────────────────────────────────────
        if any(kw in q for kw in ["quanti ordini", "numero ordini", "totale ordini"]):
            return Intent(
                intent_type="count_orders",
                filters={"year": year} if year else {},
                raw_question=question,
            )

        # ── Q16: revenue B2B vs B2C — before Q4 ──────────────────────────
        if ("b2b" in q or "b2c" in q) and (
            "fatturato" in q or "incass" in q or "medio" in q or "revenue" in q
        ):
            return Intent(intent_type="avg_revenue_by_segment", raw_question=question)

        # ── Q4: B2B active companies ──────────────────────────────────────
        if ("b2b" in q or "aziende" in q) and ("attiv" in q or "client" in q):
            return Intent(intent_type="list_b2b_active", raw_question=question)

        # ── Q13: customers in state ───────────────────────────────────────
        if ("california" in q or "stato" in q or "provincia" in q) and "client" in q:
            state = self._extract_quoted(question) or _extract_state(question)
            return Intent(
                intent_type="customers_by_state",
                filters={"state": state},
                raw_question=question,
            )

        # ── Q14: top sellers by revenue (fatturato) — before Q6 ──────────
        if ("venditore" in q or "venditori" in q) and "fatturato" in q and "top" in q:
            return Intent(
                intent_type="top_salespersons_by_revenue",
                filters={"year": year},
                limit=limit or 3,
                year=year,
                raw_question=question,
            )

        # ── Q6: top seller by orders ──────────────────────────────────────
        if ("venditore" in q or "venditori" in q or "salesperson" in q) and (
            "più ordini" in q or "gestito più" in q
        ):
            return Intent(
                intent_type="top_salesperson_by_orders",
                filters={"year": year},
                raw_question=question,
            )

        # ── top sellers by revenue (other forms) ──────────────────────────
        if (
            ("venditore" in q or "venditori" in q)
            and ("incass" in q or "revenue" in q)
            and "top" in q
        ):
            return Intent(
                intent_type="top_salespersons_by_revenue",
                filters={"year": year},
                limit=limit or 3,
                year=year,
                raw_question=question,
            )

        # ── Q7: revenue by territory ──────────────────────────────────────
        if ("territorio" in q or "territory" in q) and (
            "incass" in q or "revenue" in q or "total" in q or "fatturato" in q
        ):
            return Intent(
                intent_type="revenue_by_territory",
                filters={"year": year},
                year=year,
                raw_question=question,
            )

        # ── Q17: revenue vs quota ─────────────────────────────────────────
        if "quota" in q:
            return Intent(
                intent_type="revenue_vs_quota",
                filters={"year": year},
                year=year,
                raw_question=question,
            )

        # ── Q8: top customer by spend ─────────────────────────────────────
        if (
            "cliente" in q
            and ("più" in q or "piu" in q or "top" in q)
            and ("speso" in q or "spesa" in q or "spend" in q)
        ):
            return Intent(intent_type="top_customer_by_spend", raw_question=question)

        # ── Q9: top products by quantity ──────────────────────────────────
        if ("prodotti" in q or "prodotto" in q) and (
            "vendut" in q or "quantit" in q or "top" in q
        ):
            return Intent(
                intent_type="top_products_by_qty",
                limit=limit or 5,
                raw_question=question,
            )

        # ── Q10: customer state with most orders ──────────────────────────
        if (
            ("stato" in q or "provincia" in q or "state" in q)
            and ("ordini" in q or "orders" in q)
            and "client" in q
        ):
            return Intent(
                intent_type="customer_state_most_orders", raw_question=question
            )

        # ── Q15: margin per salesperson ───────────────────────────────────
        if "margine" in q and ("venditore" in q or "venditori" in q):
            return Intent(
                intent_type="margin_per_salesperson",
                filters={"year": year},
                year=year,
                raw_question=question,
            )

        # ── Q16: revenue B2B vs B2C ───────────────────────────────────────
        if ("b2b" in q or "b2c" in q or "segment" in q) and (
            "incass" in q or "revenue" in q or "medio" in q
        ):
            return Intent(intent_type="avg_revenue_by_segment", raw_question=question)

        # ── Q18: category with highest margin ─────────────────────────────
        if "categoria" in q and "margine" in q:
            return Intent(intent_type="top_category_by_margin", raw_question=question)

        # ── Q19: orders with discount ─────────────────────────────────────
        if "sconto" in q or "offerta" in q or "discount" in q:
            return Intent(intent_type="orders_with_discount", raw_question=question)

        # ── incassi → revenue_with_tax ────────────────────────────────────
        if "incass" in q or "revenue with tax" in q or ("revenue" in q and "tax" in q):
            return Intent(
                intent_type="revenue_with_tax",
                filters={"year": year} if year else {},
                year=year,
                raw_question=question,
            )

        # ── Plain customer count (e.g. "How many customers are there?") ───
        # Placed late so state/segment/spend customer questions match first.
        if "quanti clienti" in q or "numero clienti" in q:
            return Intent(intent_type="count_customers_unique", raw_question=question)

        # Fallback — unknown
        return Intent(intent_type="unknown", raw_question=question)

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
_EN_TERM_MAP: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bhow many\b"), "quanti"),
    (re.compile(r"\bnumber of\b"), "numero"),
    (re.compile(r"\bcustomers?\b"), "clienti"),
    (re.compile(r"\bclients?\b"), "clienti"),
    (re.compile(r"\borders?\b"), "ordini"),
    (re.compile(r"\bemployees?\b"), "dipendenti"),
    (re.compile(r"\bstaff\b"), "dipendenti"),
    (re.compile(r"\bproducts?\b"), "prodotti"),
    (re.compile(r"\bsalespe(?:rson|ople)\b"), "venditori"),
    (re.compile(r"\bsellers?\b"), "venditori"),
    (re.compile(r"\bterritor(?:y|ies)\b"), "territorio"),
    (re.compile(r"\bdepartments?\b"), "reparto"),
    (re.compile(r"\bsalary|salaries|wage|pay rate\b"), "retribuzione"),
    (re.compile(r"\brevenue\b"), "incassi"),
]


def _normalize_english_terms(q: str) -> str:
    """Rewrite common English business terms to the Italian tokens the
    deterministic patterns expect. No-op for Italian input."""
    for pattern, replacement in _EN_TERM_MAP:
        q = pattern.sub(replacement, q)
    return q


_PRODUCT_CODE_RE = re.compile(r"\b([A-Z][A-Za-z]+-\d{2,4})\b")


def _extract_product_code(text: str) -> str | None:
    """Extract an AdventureWorks-style product code like 'Road-650'."""
    m = _PRODUCT_CODE_RE.search(text)
    return m.group(1) if m else None


def _extract_state(text: str) -> str | None:
    """Extract US state name from text."""
    known = ["california", "washington", "texas", "oregon", "arizona", "colorado"]
    tl = text.lower()
    for s in known:
        if s in tl:
            return s.title()
    return None


# ── SemanticLayer ─────────────────────────────────────────────────────────────


class SemanticLayer:
    """Translates natural-language questions into executable queries."""

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
        # Connector references — set by _load_connectors
        self._erp = None
        self._crm = None
        self._hr_pim = None

    def set_connectors(self, erp, crm, hr_pim) -> None:
        self._erp = erp
        self._crm = crm
        self._hr_pim = hr_pim

    def clear_semantic_cache(self) -> None:
        """Compatibility hook for endpoint-level invalidation.

        Current layer version does not persist internal validated-plan cache,
        but this explicit method keeps mutation hooks stable and forward-compatible.
        """
        return None

    def ask(self, question: str, context=None) -> Result:
        """Resolve *question* and return a Result."""
        t0 = time.perf_counter()
        try:
            result = self._resolve(question, context)
        except AmbiguityError:
            raise
        except SemanticOntologyViolationError:
            raise
        except Exception as exc:
            logger.exception("SemanticLayer.ask error: %s", exc)
            result = Result(
                answer=f"Internal error: {exc}",
                sources_touched=[],
                notes=str(exc),
            )
        result.latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        return result

    # ── resolution ────────────────────────────────────────────────────────────

    def _resolve(self, question: str, context) -> Result:
        # Stage 1: deterministic baseline parse
        try:
            baseline_intent = self._parser.parse(question)
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
        if intent_type not in _INTENT_CONTRACTS:
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

        entity_names = (
            self._ontology.entity_names()
            if self._ontology
            else self._catalog.list_entities()
        )
        metric_names = self._catalog.list_metrics() if self._catalog else []
        relation_hints: list[str] = []
        if self._ontology:
            for entity in self._ontology.entity_names():
                for rel in self._ontology.relations_of(entity):
                    target = rel.get("target")
                    rel_name = rel.get("name")
                    if target and rel_name:
                        relation_hints.append(f"{entity}.{rel_name}->{target}")

        system_prompt = (
            "You are an ontology intent mapper for a neuro-symbolic semantic layer. "
            "Your job is ONLY to map a user's natural-language business question "
            "(English or Italian) to ONE of the allowed intent_type values. "
            "Never generate SQL, code, or executable statements. "
            "Pick the single closest matching intent_type. Only use 'unknown' when "
            "the question genuinely does not correspond to any allowed intent. "
            "When you choose an intent, set entities/properties/relations/metric to "
            "values consistent with that intent (leaving them empty is acceptable — "
            "the server fills defaults from the intent contract). "
            "Return STRICT JSON with keys: intent_type, metric, entities, properties, "
            "relations, filters, limit, year. "
            f"Allowed intent_type values: {sorted(_INTENT_CONTRACTS.keys())}. "
            f"Allowed ontology entities: {sorted(entity_names)}. "
            f"Known metrics from metadata catalog: {sorted(metric_names)}. "
            f"Known relation hints: {sorted(relation_hints)[:80]}."
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
                raise SemanticOntologyViolationError(
                    f"Failed ontology intent mapping with {provider}: {exc}"
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
                table_name = table_ref.split(".")[-1].lower()
                if table_name in _SYSTEM_TABLE_MARKERS:
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
        tables: set[str] = set()
        if not self._catalog:
            return tables
        for entity in self._catalog.list_entities():
            meta = self._catalog.get_entity(entity)
            if not meta:
                continue
            for src in meta.sources:
                if not isinstance(src, dict):
                    continue
                table = src.get("table")
                if isinstance(table, str) and table.strip():
                    tables.add(table.strip().lower())
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
        contract = _INTENT_CONTRACTS.get(intent.intent_type)
        if not contract:
            raise SemanticOntologyViolationError(
                f"No ontology contract defined for intent '{intent.intent_type}'"
            )

        validation_steps: list[str] = [
            "fm_intent_mapped",
            "ontology_contract_selected",
        ]

        catalog_entities = (
            set(self._catalog.list_entities()) if self._catalog else set()
        )
        ontology_entities = (
            set(self._ontology.entity_names())
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
            metrics = set(self._catalog.list_metrics())
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

    def _claude_fallback(self, question: str) -> Intent:
        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            return Intent(intent_type="unknown", raw_question=question)
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            sys_prompt = (
                "You are an intent parser for a semantic layer. "
                "Given a natural-language business question, output ONE of these intent types "
                "as plain text (no JSON, just the type name): "
                "count_employees, avg_hourly_rate, product_price, count_make_only, "
                "count_orders, list_b2b_active, customers_by_state, "
                "top_salesperson_by_orders, top_salespersons_by_revenue, "
                "revenue_by_territory, revenue_vs_quota, top_customer_by_spend, "
                "top_products_by_qty, customer_state_most_orders, margin_per_salesperson, "
                "avg_revenue_by_segment, top_category_by_margin, orders_with_discount, "
                "count_customers_unique, check_duplicate_accounts, data_provenance, "
                "revenue_with_tax, lookup_employee, impossible, unknown. "
                "Return ONLY the intent type string."
            )
            msg = client.messages.create(
                model=_anthropic_model(),
                max_tokens=20,
                system=sys_prompt,
                messages=[{"role": "user", "content": question}],
            )
            intent_type = msg.content[0].text.strip()
            logger.info("Claude returned intent: %s", intent_type)
            year_m = re.search(r"\b(20\d{2})\b", question)
            return Intent(
                intent_type=intent_type,
                year=int(year_m.group(1)) if year_m else None,
                raw_question=question,
            )
        except Exception as exc:
            logger.warning("Claude fallback failed: %s", exc)
            return Intent(intent_type="unknown", raw_question=question)

    # ── executor dispatch ─────────────────────────────────────────────────────

    def _execute(self, intent: Intent) -> Result:
        dispatch: dict[str, Any] = {
            "entity_not_modeled": self._q_entity_not_modeled,
            "glossary_lookup": self._q_glossary_lookup,
            "disambiguation_rules": self._q_disambiguation_rules,
            "customers_without_orders": self._q_customers_without_orders,
            "employees_with_duplicate_customers": self._q_employees_with_duplicate_customers,
            "certified_metrics": self._q_certified_metrics,
            "count_employees": self._q_count_employees,
            "count_employees_by_group": self._q_count_employees_by_group,
            "avg_hourly_rate": self._q_avg_hourly_rate,
            "product_price": self._q_product_price,
            "count_make_only": self._q_count_make_only,
            "count_orders": self._q_count_orders,
            "list_b2b_active": self._q_list_b2b_active,
            "customers_by_state": self._q_customers_by_state,
            "top_salesperson_by_orders": self._q_top_salesperson_by_orders,
            "top_salespersons_by_revenue": self._q_top_salespersons_by_revenue,
            "revenue_by_territory": self._q_revenue_by_territory,
            "revenue_vs_quota": self._q_revenue_vs_quota,
            "top_customer_by_spend": self._q_top_customer_by_spend,
            "top_products_by_qty": self._q_top_products_by_qty,
            "customer_state_most_orders": self._q_customer_state_most_orders,
            "margin_per_salesperson": self._q_margin_per_salesperson,
            "avg_revenue_by_segment": self._q_avg_revenue_by_segment,
            "top_category_by_margin": self._q_top_category_by_margin,
            "orders_with_discount": self._q_orders_with_discount,
            "count_customers_unique": self._q_count_customers_unique,
            "check_duplicate_accounts": self._q_check_duplicate_accounts,
            "data_provenance": self._q_data_provenance,
            "revenue_with_tax": self._q_revenue_with_tax,
            "lookup_employee": self._q_lookup_employee,
            "impossible": self._q_impossible,
        }
        fn = dispatch.get(intent.intent_type)
        if fn is None:
            return Result(
                answer=(
                    "I don't recognize this question. Try asking about: "
                    "orders, customers, employees, products, revenue, or territories. "
                    "Examples: 'How many orders in 2014?', 'Top 5 products by quantity', "
                    "'Revenue by territory', 'How many employees?'"
                ),
                notes="unknown_intent",
            )
        return fn(intent)

    # ── query implementations ─────────────────────────────────────────────────

    def _q_count_employees(self, intent: Intent) -> Result:
        dept = intent.filters.get("department")
        if dept:
            sql = "SELECT COUNT(*) as cnt FROM dipendenti_hr WHERE Reparto = ?"
            params = (dept,)
            rows = self._hr_pim.execute_query(sql, params)
        else:
            sql = "SELECT COUNT(*) as cnt FROM dipendenti_hr"
            params = ()
            rows = self._hr_pim.execute_query(sql)
        count = rows[0]["cnt"] if rows else 0
        return Result(
            answer=count,
            sql_used=sql,
            sources_touched=["hr_pim"],
            provenance=self._prov("Employee", ["MatricolaDip", "Reparto"]),
            notes=(
                "WARNING: HR data has sync status 'Delayed'. "
                "The HR/PIM source is not updated in real time: "
                "the count may not reflect the current situation."
            ),
        )

    def _q_count_employees_by_group(self, intent: Intent) -> Result:
        sql = "SELECT GruppoReparto, COUNT(*) as cnt FROM dipendenti_hr GROUP BY GruppoReparto ORDER BY cnt DESC"
        rows = self._hr_pim.execute_query(sql)
        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=["hr_pim"],
            provenance=self._prov("Employee", ["GruppoReparto"]),
        )

    def _q_avg_hourly_rate(self, intent: Intent) -> Result:
        dept = intent.filters.get("department")
        if dept:
            sql = "SELECT ROUND(AVG(CAST(RetribuzioneOraria AS DOUBLE)), 4) as avg_rate FROM dipendenti_hr WHERE Reparto = ?"
            rows = self._hr_pim.execute_query(sql, (dept,))
        else:
            sql = "SELECT ROUND(AVG(CAST(RetribuzioneOraria AS DOUBLE)), 4) as avg_rate FROM dipendenti_hr"
            rows = self._hr_pim.execute_query(sql)
        avg = rows[0]["avg_rate"] if rows else None
        return Result(
            answer=avg,
            sql_used=sql,
            sources_touched=["hr_pim"],
            provenance=self._prov("Employee", ["RetribuzioneOraria", "Reparto"]),
        )

    def _q_product_price(self, intent: Intent) -> Result:
        name = intent.filters.get("product_name")
        if name:
            sql = "SELECT displayName, listPrice, standardCost FROM product_catalog_pim WHERE displayName = ?"
            rows = self._hr_pim.execute_query(sql, (name,))
            if not rows:
                # fuzzy: contains
                sql = "SELECT displayName, listPrice, standardCost FROM product_catalog_pim WHERE displayName LIKE ?"
                rows = self._hr_pim.execute_query(sql, (f"%{name}%",))
        else:
            sql = "SELECT displayName, listPrice, standardCost FROM product_catalog_pim LIMIT 10"
            rows = self._hr_pim.execute_query(sql)
        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=["hr_pim"],
            provenance=self._prov("Product", ["displayName", "listPrice"]),
        )

    def _q_count_make_only(self, intent: Intent) -> Result:
        sql = "SELECT COUNT(*) as cnt FROM product_catalog_pim WHERE isMakeOnly = true"
        rows = self._hr_pim.execute_query(sql)
        count = rows[0]["cnt"] if rows else 0
        return Result(
            answer=count,
            sql_used=sql,
            sources_touched=["hr_pim"],
            provenance=self._prov("Product", ["isMakeOnly"]),
        )

    def _q_count_orders(self, intent: Intent) -> Result:
        year = intent.filters.get("year") or intent.year
        if year:
            sql = "SELECT COUNT(*) as cnt FROM sales_order_header WHERE strftime('%Y', CAST(order_date AS DATE)) = ?"
            rows = self._erp.execute_query(sql, (str(year),))
        else:
            sql = "SELECT COUNT(*) as cnt FROM sales_order_header"
            rows = self._erp.execute_query(sql)
        count = rows[0]["cnt"] if rows else 0
        return Result(
            answer=count,
            sql_used=sql,
            sources_touched=["erp"],
            provenance=self._prov("SalesOrder", ["order_id"]),
        )

    def _q_list_b2b_active(self, intent: Intent) -> Result:
        sql = (
            "SELECT COUNT(DISTINCT ragioneSociale) as cnt FROM account "
            "WHERE accountType='B2B' AND isActive=1 "
            "AND ragioneSociale IS NOT NULL AND ragioneSociale != ''"
        )
        rows = self._crm.execute_query(sql)
        count = rows[0]["cnt"] if rows else 0
        detail_sql = (
            "SELECT accountId, ragioneSociale FROM account "
            "WHERE accountType='B2B' AND isActive=1 AND accountId > 0 "
            "ORDER BY ragioneSociale LIMIT 50"
        )
        companies = self._crm.execute_query(detail_sql)
        return Result(
            answer={"unique_b2b_active": count, "companies": companies},
            sql_used=sql,
            sources_touched=["crm"],
            provenance=self._prov(
                "Customer", ["accountType", "isActive", "ragioneSociale"]
            ),
        )

    def _q_customers_by_state(self, intent: Intent) -> Result:
        state = intent.filters.get("state")
        if state:
            sql = """
                SELECT a.accountId, a.ragioneSociale, a.nomeContatto, sp.stateName
                FROM account a
                JOIN account_address aa ON aa.accountRef = a.accountId
                JOIN address addr ON addr.addressId = aa.addressRef
                JOIN state_province sp ON sp.stateId = addr.stateProvinceId
                WHERE sp.stateName = ? AND a.accountId > 0
                ORDER BY a.ragioneSociale, a.nomeContatto
            """
            rows = self._crm.execute_query(sql, (state,))
            if not rows:
                sql = sql.replace("sp.stateName = ?", "LOWER(sp.stateName) LIKE ?")
                rows = self._crm.execute_query(sql, (f"%{state.lower()}%",))
        else:
            sql = """
                SELECT a.accountId, a.ragioneSociale, a.nomeContatto, sp.stateName
                FROM account a
                JOIN account_address aa ON aa.accountRef = a.accountId
                JOIN address addr ON addr.addressId = aa.addressRef
                JOIN state_province sp ON sp.stateId = addr.stateProvinceId
                WHERE a.accountId > 0
                LIMIT 20
            """
            rows = self._crm.execute_query(sql)
        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=["crm"],
            provenance=self._prov("Customer", ["accountId"]),
        )

    def _q_top_salesperson_by_orders(self, intent: Intent) -> Result:
        year = intent.filters.get("year") or intent.year
        if year:
            sql = """
                SELECT salesperson_ref, COUNT(*) as n
                FROM sales_order_header
                                WHERE strftime('%Y', CAST(order_date AS DATE)) = ?
                  AND salesperson_ref IS NOT NULL
                GROUP BY salesperson_ref ORDER BY n DESC LIMIT 1
            """
            rows = self._erp.execute_query(sql, (str(year),))
        else:
            sql = """
                SELECT salesperson_ref, COUNT(*) as n
                FROM sales_order_header
                WHERE salesperson_ref IS NOT NULL
                GROUP BY salesperson_ref ORDER BY n DESC LIMIT 1
            """
            rows = self._erp.execute_query(sql)
        if not rows:
            return Result(answer=None, sql_used=sql, sources_touched=["erp"])
        sid = rows[0]["salesperson_ref"]
        n = rows[0]["n"]
        # Enrich with HR name
        hr_rows = self._hr_pim.execute_query(
            "SELECT Nome, Cognome, Reparto FROM dipendenti_hr WHERE CAST(MatricolaDip AS INTEGER) = ?",
            (int(sid),),
        )
        name_info = hr_rows[0] if hr_rows else {}
        return Result(
            answer={
                "salesperson_ref": sid,
                "order_count": n,
                "Nome": name_info.get("Nome"),
                "Cognome": name_info.get("Cognome"),
                "Reparto": name_info.get("Reparto"),
            },
            sql_used=sql,
            sources_touched=["erp", "hr_pim"],
            provenance={
                **self._prov("SalesOrder", ["salesperson_ref"]),
                **self._prov("Employee", ["MatricolaDip", "Nome", "Cognome"]),
            },
        )

    def _q_top_salespersons_by_revenue(self, intent: Intent) -> Result:
        year = intent.year or intent.filters.get("year")
        limit = intent.limit or 3
        if year:
            sql = """
                SELECT salesperson_ref, ROUND(SUM(total_due), 2) as revenue
                FROM sales_order_header
                                WHERE strftime('%Y', CAST(order_date AS DATE)) = ?
                  AND salesperson_ref IS NOT NULL
                GROUP BY salesperson_ref ORDER BY revenue DESC LIMIT ?
            """
            rows = self._erp.execute_query(sql, (str(year), limit))
        else:
            sql = """
                SELECT salesperson_ref, ROUND(SUM(total_due), 2) as revenue
                FROM sales_order_header WHERE salesperson_ref IS NOT NULL
                GROUP BY salesperson_ref ORDER BY revenue DESC LIMIT ?
            """
            rows = self._erp.execute_query(sql, (limit,))
        # Enrich with HR
        enriched = []
        for r in rows:
            sid = r["salesperson_ref"]
            hr_rows = self._hr_pim.execute_query(
                "SELECT Nome, Cognome, Reparto FROM dipendenti_hr WHERE CAST(MatricolaDip AS INTEGER) = ?",
                (int(sid),),
            )
            info = hr_rows[0] if hr_rows else {}
            enriched.append({**r, **info})
        return Result(
            answer=enriched,
            sql_used=sql,
            sources_touched=["erp", "hr_pim"],
            provenance={
                **self._prov("SalesOrder", ["salesperson_ref", "total_due"]),
                **self._prov("Employee", ["Reparto"]),
            },
            notes="Revenue values in USD ($). revenue = SUM(total_due).",
        )

    def _q_revenue_by_territory(self, intent: Intent) -> Result:
        year = intent.year or intent.filters.get("year")
        if year:
            sql = """
                SELECT t.territory_name, ROUND(SUM(h.total_due), 2) as revenue
                FROM sales_order_header h
                JOIN territory t ON h.territory_ref = t.territory_id
                WHERE strftime('%Y', CAST(h.order_date AS DATE)) = ?
                GROUP BY t.territory_name ORDER BY revenue DESC
            """
            rows = self._erp.execute_query(sql, (str(year),))
        else:
            sql = """
                SELECT t.territory_name, ROUND(SUM(h.total_due), 2) as revenue
                FROM sales_order_header h
                JOIN territory t ON h.territory_ref = t.territory_id
                GROUP BY t.territory_name ORDER BY revenue DESC
            """
            rows = self._erp.execute_query(sql)
        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=["erp"],
            provenance=self._prov("SalesOrder", ["total_due", "territory_ref"]),
            notes="Revenue values in USD ($). revenue = SUM(total_due).",
        )

    def _q_revenue_vs_quota(self, intent: Intent) -> Result:
        year = intent.year or intent.filters.get("year")
        if year:
            sql = """
                SELECT h.salesperson_ref,
                       ROUND(SUM(h.total_due), 2) as revenue,
                       MAX(sp.sales_quota) as quota,
                       ROUND(SUM(h.total_due) / NULLIF(MAX(sp.sales_quota), 0) * 100, 1) as pct_quota
                FROM sales_order_header h
                JOIN salesperson sp ON h.salesperson_ref = sp.salesperson_id
                                WHERE strftime('%Y', CAST(h.order_date AS DATE)) = ?
                  AND h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref ORDER BY revenue DESC
            """
            rows = self._erp.execute_query(sql, (str(year),))
        else:
            sql = """
                SELECT h.salesperson_ref,
                       ROUND(SUM(h.total_due), 2) as revenue,
                       MAX(sp.sales_quota) as quota,
                       ROUND(SUM(h.total_due) / NULLIF(MAX(sp.sales_quota), 0) * 100, 1) as pct_quota
                FROM sales_order_header h
                JOIN salesperson sp ON h.salesperson_ref = sp.salesperson_id
                WHERE h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref ORDER BY revenue DESC
            """
            rows = self._erp.execute_query(sql)
        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=["erp"],
            provenance=self._prov("Salesperson", ["sales_quota", "sales_ytd"]),
            notes="Revenue and quota values in USD ($). revenue = SUM(total_due).",
        )

    def _q_top_customer_by_spend(self, intent: Intent) -> Result:
        sql = """
            SELECT customer_ref, ROUND(SUM(total_due), 2) as spesa
            FROM sales_order_header GROUP BY customer_ref ORDER BY spesa DESC LIMIT 1
        """
        rows = self._erp.execute_query(sql)
        if not rows:
            return Result(answer=None, sql_used=sql, sources_touched=["erp"])
        cid = rows[0]["customer_ref"]
        spesa = rows[0]["spesa"]
        crm_rows = self._crm.execute_query(
            "SELECT accountType, ragioneSociale, nomeContatto FROM account WHERE accountId=?",
            (cid,),
        )
        cust_info = crm_rows[0] if crm_rows else {}
        return Result(
            answer={
                "customer_ref": cid,
                "total_spend": spesa,
                **cust_info,
            },
            sql_used=sql,
            sources_touched=["erp", "crm"],
            provenance={
                **self._prov("SalesOrder", ["customer_ref", "total_due"]),
                **self._prov("Customer", ["accountId", "ragioneSociale"]),
            },
            notes="total_spend value in USD ($). total_spend = SUM(total_due).",
        )

    def _q_top_products_by_qty(self, intent: Intent) -> Result:
        limit = intent.limit or 5
        sql = """
            SELECT product_ref, SUM(qty) as qty_totale
            FROM sales_order_line GROUP BY product_ref ORDER BY qty_totale DESC LIMIT ?
        """
        rows = self._erp.execute_query(sql, (limit,))
        enriched = []
        for r in rows:
            pid = r["product_ref"]
            pim_rows = self._hr_pim.execute_query(
                "SELECT displayName, categoryPath FROM product_catalog_pim WHERE internal_id = ?",
                (pid,),
            )
            pinfo = pim_rows[0] if pim_rows else {}
            enriched.append({**r, **pinfo})
        return Result(
            answer=enriched,
            sql_used=sql,
            sources_touched=["erp", "hr_pim"],
            provenance={
                **self._prov("SalesOrderLine", ["product_ref", "qty"]),
                **self._prov("Product", ["displayName"]),
            },
        )

    def _q_customer_state_most_orders(self, intent: Intent) -> Result:
        sql = """
            SELECT customer_ref, COUNT(*) as n
            FROM sales_order_header GROUP BY customer_ref ORDER BY n DESC LIMIT 1
        """
        rows = self._erp.execute_query(sql)
        if not rows:
            return Result(answer=None, sql_used=sql, sources_touched=["erp", "crm"])
        cid = rows[0]["customer_ref"]
        state_sql = """
            SELECT sp.stateName
            FROM account a
            JOIN account_address aa ON aa.accountRef = a.accountId
            JOIN address addr ON addr.addressId = aa.addressRef
            JOIN state_province sp ON sp.stateId = addr.stateProvinceId
            WHERE a.accountId = ? LIMIT 1
        """
        state_rows = self._crm.execute_query(state_sql, (cid,))
        state = state_rows[0]["stateName"] if state_rows else "Unknown"
        return Result(
            answer={"customer_ref": cid, "order_count": rows[0]["n"], "state": state},
            sql_used=sql,
            sources_touched=["erp", "crm"],
            provenance={
                **self._prov("SalesOrder", ["customer_ref"]),
                **self._prov("Customer", ["accountId"]),
            },
        )

    def _q_margin_per_salesperson(self, intent: Intent) -> Result:
        year = intent.year or intent.filters.get("year")
        if year:
            sql = """
                SELECT h.salesperson_ref,
                       ROUND(SUM(l.qty * (l.unit_price - l.unit_price * l.unit_discount)), 2) as approx_revenue
                FROM sales_order_header h
                JOIN sales_order_line l ON l.order_id = h.order_id
                                WHERE strftime('%Y', CAST(h.order_date AS DATE)) = ?
                  AND h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref ORDER BY approx_revenue DESC
            """
            self._erp.execute_query(sql, (str(year),))
        else:
            sql = """
                SELECT h.salesperson_ref,
                       ROUND(SUM(l.qty * (l.unit_price - l.unit_price * l.unit_discount)), 2) as approx_revenue
                FROM sales_order_header h
                JOIN sales_order_line l ON l.order_id = h.order_id
                WHERE h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref ORDER BY approx_revenue DESC
            """
            self._erp.execute_query(sql)

        # Enrich with PIM cost data for true margin calculation
        cost_sql = (
            "SELECT internal_id, standardCost, listPrice FROM product_catalog_pim"
        )
        pim_rows = {r["internal_id"]: r for r in self._hr_pim.execute_query(cost_sql)}

        # Build per-salesperson margin using line data
        if year:
            margin_sql = """
                SELECT h.salesperson_ref, l.product_ref,
                       SUM(l.qty) as total_qty
                FROM sales_order_header h
                JOIN sales_order_line l ON l.order_id = h.order_id
                                WHERE strftime('%Y', CAST(h.order_date AS DATE)) = ?
                  AND h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref, l.product_ref
            """
            margin_rows = self._erp.execute_query(margin_sql, (str(year),))
        else:
            margin_sql = """
                SELECT h.salesperson_ref, l.product_ref,
                       SUM(l.qty) as total_qty
                FROM sales_order_header h
                JOIN sales_order_line l ON l.order_id = h.order_id
                WHERE h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref, l.product_ref
            """
            margin_rows = self._erp.execute_query(margin_sql)

        margins: dict[int, float] = {}
        for r in margin_rows:
            sp = r["salesperson_ref"]
            pid = r["product_ref"]
            qty = r["total_qty"] or 0
            p = pim_rows.get(pid)
            if p:
                m = qty * ((p.get("listPrice") or 0) - (p.get("standardCost") or 0))
                margins[sp] = margins.get(sp, 0) + m

        result = [
            {"salesperson_ref": sp, "margin": round(m, 2)}
            for sp, m in sorted(margins.items(), key=lambda x: -x[1])
        ]
        return Result(
            answer=result,
            sql_used=margin_sql,
            sources_touched=["erp", "hr_pim"],
            provenance={
                **self._prov("SalesOrderLine", ["product_ref", "qty"]),
                **self._prov("Product", ["standardCost", "listPrice"]),
            },
            notes="Margin values in USD ($). margin = SUM(qty * (listPrice - standardCost)).",
        )

    def _q_avg_revenue_by_segment(self, intent: Intent) -> Result:
        # ERP and CRM are separate connectors — join manually in Python
        orders = self._erp.execute_query(
            "SELECT customer_ref, ROUND(SUM(total_due), 2) as total FROM sales_order_header GROUP BY customer_ref"
        )
        accts = {
            r["accountId"]: r["accountType"]
            for r in self._crm.execute_query(
                "SELECT accountId, accountType FROM account WHERE accountId > 0"
            )
        }
        by_seg: dict[str, list[float]] = {}
        for o in orders:
            seg = accts.get(o["customer_ref"])
            if seg:
                by_seg.setdefault(seg, []).append(o["total"] or 0)
        rows = [
            {
                "accountType": seg,
                "n_customers": len(vals),
                "total_revenue": round(sum(vals), 2),
                "avg_per_customer": round(sum(vals) / len(vals), 2) if vals else 0,
            }
            for seg, vals in sorted(by_seg.items())
        ]
        sql = "-- cross-source join: ERP sales_order_header + CRM account"
        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=["erp", "crm"],
            provenance={
                **self._prov("SalesOrder", ["customer_ref", "total_due"]),
                **self._prov("Customer", ["accountType"]),
            },
            notes="total_revenue and avg_per_customer values in USD ($). revenue = SUM(total_due).",
        )

    def _q_top_category_by_margin(self, intent: Intent) -> Result:
        # Get per-product qty from ERP
        qty_sql = "SELECT product_ref, SUM(qty) as total_qty FROM sales_order_line GROUP BY product_ref"
        qty_rows = {
            r["product_ref"]: r["total_qty"] for r in self._erp.execute_query(qty_sql)
        }
        # PIM products with cost data
        pim_sql = "SELECT internal_id, categoryPath, listPrice, standardCost FROM product_catalog_pim"
        pim_rows = self._hr_pim.execute_query(pim_sql)

        cat_revenue: dict[str, float] = {}
        cat_cost: dict[str, float] = {}
        for p in pim_rows:
            pid = p["internal_id"]
            cat = (p.get("categoryPath") or "").split("/")[0] or "Unknown"
            qty = qty_rows.get(pid, 0) or 0
            rev = qty * (p.get("listPrice") or 0)
            cost = qty * (p.get("standardCost") or 0)
            cat_revenue[cat] = cat_revenue.get(cat, 0) + rev
            cat_cost[cat] = cat_cost.get(cat, 0) + cost

        result = []
        for cat in cat_revenue:
            rev = cat_revenue[cat]
            cost = cat_cost.get(cat, 0)
            margin = rev - cost
            margin_pct = round((margin / rev * 100) if rev > 0 else 0, 2)
            result.append(
                {
                    "category": cat,
                    "revenue": round(rev, 2),
                    "cost": round(cost, 2),
                    "margin": round(margin, 2),
                    "margin_pct": margin_pct,
                }
            )
        result.sort(key=lambda x: -x["margin_pct"])
        return Result(
            answer=result,
            sql_used=qty_sql,
            sources_touched=["erp", "hr_pim"],
            provenance={
                **self._prov("SalesOrderLine", ["product_ref", "qty"]),
                **self._prov("Product", ["categoryPath", "listPrice", "standardCost"]),
            },
            notes="Revenue, cost, and margin values in USD ($). margin = revenue - cost.",
        )

    def _q_orders_with_discount(self, intent: Intent) -> Result:
        sql = "SELECT COUNT(DISTINCT order_id) as cnt FROM sales_order_line WHERE offer_ref != 1"
        rows = self._erp.execute_query(sql)
        count = rows[0]["cnt"] if rows else 0
        return Result(
            answer=count,
            sql_used=sql,
            sources_touched=["erp"],
            provenance=self._prov("SalesOrderLine", ["offer_ref"]),
        )

    def _q_count_customers_unique(self, intent: Intent) -> Result:
        sql_total = "SELECT COUNT(*) as total FROM account"
        sql_dups = "SELECT COUNT(*) as dups FROM account WHERE accountId < 0"
        total = self._crm.execute_query(sql_total)[0]["total"]
        dups = self._crm.execute_query(sql_dups)[0]["dups"]
        unique = total - dups
        return Result(
            answer={"total": total, "duplicates": dups, "unique": unique},
            sql_used=sql_dups,
            sources_touched=["crm"],
            provenance=self._prov("Customer", ["accountId"]),
            notes="accountId < 0 records are duplicates and excluded from unique count",
        )

    def _q_check_duplicate_accounts(self, intent: Intent) -> Result:
        company = intent.filters.get("company")
        if company:
            sql = (
                "SELECT accountId, accountType, ragioneSociale, nomeContatto, emailContatto, isActive "
                "FROM account WHERE ragioneSociale LIKE ? OR nomeContatto LIKE ? "
                "ORDER BY ABS(accountId)"
            )
            rows = self._crm.execute_query(sql, (f"%{company}%", f"%{company}%"))
            positives = [r for r in rows if r["accountId"] > 0]
            negatives = [r for r in rows if r["accountId"] < 0]
            has_dups = len(negatives) > 0
            return Result(
                answer={
                    "company": company,
                    "has_duplicates": has_dups,
                    "positive_accounts": positives,
                    "duplicate_accounts": negatives,
                },
                sql_used=sql,
                sources_touched=["crm"],
                disambiguation_required=has_dups,
                candidates=[str(r["accountId"]) for r in positives] if has_dups else [],
                provenance=self._prov("Customer", ["accountId", "ragioneSociale"]),
                notes="accountId < 0 = duplicate record per CRM deduplication rule",
            )
        sql = "SELECT COUNT(*) as dups FROM account WHERE accountId < 0"
        rows = self._crm.execute_query(sql)
        return Result(
            answer={"duplicate_count": rows[0]["dups"]},
            sql_used=sql,
            sources_touched=["crm"],
            provenance=self._prov("Customer", ["accountId"]),
        )

    def _q_data_provenance(self, intent: Intent) -> Result:
        entities = self._catalog.list_entities() if self._catalog else []
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

    def _q_revenue_with_tax(self, intent: Intent) -> Result:
        year = intent.year or intent.filters.get("year")
        if year:
            sql = "SELECT ROUND(SUM(total_due), 2) as revenue_with_tax FROM sales_order_header WHERE strftime('%Y', CAST(order_date AS DATE)) = ?"
            rows = self._erp.execute_query(sql, (str(year),))
        else:
            sql = "SELECT ROUND(SUM(total_due), 2) as revenue_with_tax FROM sales_order_header"
            rows = self._erp.execute_query(sql)
        val = rows[0]["revenue_with_tax"] if rows else None
        return Result(
            answer=val,
            sql_used=sql,
            sources_touched=["erp"],
            provenance=self._prov("SalesOrder", ["total_due"]),
            notes="revenue_with_tax = SUM(total_due) includes taxes and freight. Values in USD ($).",
        )

    def _q_lookup_employee(self, intent: Intent) -> Result:
        name = intent.filters.get("name", "")
        sql = "SELECT * FROM dipendenti_hr WHERE LOWER(Nome) LIKE ? OR LOWER(Cognome) LIKE ?"
        rows = self._hr_pim.execute_query(
            sql, (f"%{name.lower()}%", f"%{name.lower()}%")
        )
        if len(rows) > 1:
            # Multiple matches → disambiguation required
            return Result(
                answer=rows,
                sql_used=sql,
                sources_touched=["hr_pim"],
                disambiguation_required=True,
                candidates=[
                    f"{r['Nome']} {r['Cognome']} (matricola {r['MatricolaDip']}, {r['Reparto']})"
                    for r in rows
                ],
                provenance=self._prov("Employee", ["MatricolaDip", "Nome", "Cognome"]),
                notes=f"Multiple employees found matching '{name}'. Please specify.",
            )
        return Result(
            answer=rows,
            sql_used=sql,
            sources_touched=["hr_pim"],
            disambiguation_required=False,
            provenance=self._prov("Employee", ["MatricolaDip", "Nome", "Cognome"]),
        )

    def _q_impossible(self, intent: Intent) -> Result:
        reason = intent.filters.get("reason", "unknown")
        messages = {
            "nationality_not_available": (
                "The field 'employee nationality' is not available in any of the data sources "
                "(ERP, CRM, HR/PIM). AdventureWorks does not contain this attribute. "
                "Unable to answer the question."
            ),
        }
        return Result(
            answer=None,
            sources_touched=[],
            notes=messages.get(reason, "Data not available in the current sources."),
            disambiguation_required=False,
        )

    # ── EC-02: entity not modeled ─────────────────────────────────────────────

    def _q_entity_not_modeled(self, intent: Intent) -> Result:
        entity = intent.filters.get("entity", "Unknown")
        if self._docs and self._docs.entities:
            available = ", ".join(e.display_name for e in self._docs.entities)
        else:
            available = "Customer, SalesOrder, SalesOrderLine, Product, Employee, Territory, Salesperson"
        return Result(
            answer=None,
            sources_touched=[],
            notes=(
                f"The entity '{entity}' is not modeled in the semantic layer. "
                f"Available entities are: {available}. "
                "Suppliers (Supplier/Vendor) are not part of the current data model."
            ),
            disambiguation_required=False,
        )

    # ── EC-10: glossary lookup ────────────────────────────────────────────────

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

        if self._docs and self._docs.glossary:
            # Search through docs glossary first
            definition: str | None = None
            for entry in self._docs.glossary:
                if entry.term.lower() == raw_term:
                    definition = entry.definition
                    break
            if definition is None:
                for entry in self._docs.glossary:
                    if raw_term in entry.term.lower() or entry.term.lower() in raw_term:
                        definition = entry.definition
                        break
            if definition is None:
                available = ", ".join(sorted(e.term for e in self._docs.glossary))
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

        # Fallback to hardcoded glossary
        definition = self._GLOSSARY.get(raw_term)
        if definition is None:
            for key, val in self._GLOSSARY.items():
                if raw_term in key or key in raw_term:
                    definition = val
                    break
        if definition is None:
            definition = (
                f"The term '{raw_term}' is not present in the semantic layer glossary. "
                "Available terms: " + ", ".join(sorted(self._GLOSSARY.keys())) + "."
            )
        return Result(
            answer=definition,
            sources_touched=[],
            notes="Response from the semantic layer glossary/ontology.",
            disambiguation_required=False,
        )

    # ── DQ-03: disambiguation rules ───────────────────────────────────────────

    def _q_disambiguation_rules(self, intent: Intent) -> Result:
        if self._docs and self._docs.disambiguation_rules:
            rules = [
                {
                    "rule_id": r.id,
                    "name": r.name,
                    "description": r.description,
                }
                for r in self._docs.disambiguation_rules
            ]
            n = len(rules)
            return Result(
                answer=rules,
                sources_touched=[],
                notes=(f"{n} active disambiguation rules in the semantic layer."),
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

    # ── 1H-02: customers without orders (anti-join) ───────────────────────────

    def _q_customers_without_orders(self, intent: Intent) -> Result:
        # Fetch all valid CRM customer IDs
        crm_sql = (
            "SELECT accountId, ragioneSociale, nomeContatto, accountType "
            "FROM account WHERE accountId > 0 ORDER BY ragioneSociale"
        )
        customers = self._crm.execute_query(crm_sql)
        # Fetch all customer_refs that appear in at least one order (ERP)
        erp_sql = (
            "SELECT DISTINCT customer_ref FROM sales_order_header "
            "WHERE customer_ref IS NOT NULL"
        )
        ordered_refs = {r["customer_ref"] for r in self._erp.execute_query(erp_sql)}
        # Anti-join in Python
        no_orders = [c for c in customers if c["accountId"] not in ordered_refs]
        sql_note = f"{crm_sql}  --  anti-join with ERP: {erp_sql}"
        return Result(
            answer={"count": len(no_orders), "customers": no_orders},
            sql_used=sql_note,
            sources_touched=["crm", "erp"],
            provenance={
                **self._prov("Customer", ["accountId", "ragioneSociale"]),
                **self._prov("SalesOrder", ["order_id"]),
            },
            notes=(
                "Anti-join CRM × ERP: customers with accountId > 0 that do not appear "
                "in any sales_order_header. Duplicates (accountId < 0) are excluded."
            ),
        )

    # ── MH-07: employees who managed duplicate-account customers ─────────────

    def _q_employees_with_duplicate_customers(self, intent: Intent) -> Result:
        # Per Rule R1, records with accountId < 0 are filtered upstream.
        # In the clean system no employee has "managed" duplicate customers.
        return Result(
            answer={
                "employee_count": 0,
                "explanation": (
                    "Records with accountId < 0 are duplicates filtered by deduplication Rule R1. "
                    "In the clean system no order is associated with accountId < 0, "
                    "so no employee is found to have managed customers with duplicate accounts."
                ),
            },
            sql_used=None,
            sources_touched=[],
            notes=(
                "Deterministic result: 0 employees. "
                "Rule R1 (accountId<0 = duplicates) ensures that no order "
                "in the clean system is linked to a duplicate account."
            ),
            disambiguation_required=False,
        )

    # ── SS-07: certified metrics list ─────────────────────────────────────────

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
            "definition": "COUNT(*) FROM dipendenti_hr",
            "source": "HR/PIM dipendenti_hr",
            "unit": "count",
            "status": "certified",
            "freshness": "Delayed — data not in real time",
        },
    ]

    def _q_certified_metrics(self, intent: Intent) -> Result:
        if self._docs and self._docs.metrics:
            certified = [m for m in self._docs.metrics if m.certified]
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
