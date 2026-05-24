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

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ── AmbiguityError ────────────────────────────────────────────────────────────

class AmbiguityError(Exception):
    """Raised when a query cannot be resolved without disambiguation."""

    def __init__(self, message: str, candidates: list[str]) -> None:
        super().__init__(message)
        self.candidates = candidates


# ── Result ────────────────────────────────────────────────────────────────────

@dataclass
class Result:
    answer: Any
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

    intent_type: str           # e.g. "count_employees", "revenue", "top_products"
    filters: dict[str, Any] = field(default_factory=dict)
    dimensions: list[str] = field(default_factory=list)
    limit: int | None = None
    year: int | None = None
    raw_question: str = ""


# ── Rule-based intent parser ──────────────────────────────────────────────────

class _RuleParser:
    """Rule-based intent parser that handles the 25 golden questions."""

    # Compiled patterns (order matters — more specific first)
    _YEAR_RE = re.compile(r"\b(20\d{2})\b")
    _LIMIT_RE = re.compile(r"\btop[\s-]?(\d+)\b", re.IGNORECASE)
    _DEPT_RE = re.compile(r'"([^"]+)"|\'([^\']+)\'|reparto\s+([A-Za-z &]+)', re.IGNORECASE)

    def parse(self, question: str) -> Intent:
        q = question.lower()

        year = self._extract_year(question)
        limit = self._extract_limit(q)

        # ── Q25: impossible query — MUST come before fatturato check ─────────
        if "italian" in q or "nazionalit" in q or "italiano" in q.split():
            return Intent(
                intent_type="impossible",
                filters={"reason": "nationality_not_available"},
                raw_question=question,
            )

        # ── Q21: ambiguous "fatturato" — only when standing alone ────────────
        # "fatturato totale per territorio", "fatturato per venditore", etc.
        # are contextually resolved to revenue_with_tax per golden questions hint Q7.
        # Only raise AmbiguityError when "fatturato" appears without a dimensional qualifier.
        _FATTURATO_QUALIFIERS = [
            "per territorio", "per venditore", "per cliente", "medio", "per categoria",
            "vs", "quota", "lordo", "netto", "incass", "annualizzato", "fonte",
            "cliente ", "reparto", "b2b", "b2c",
        ]
        if "fatturato" in q:
            has_qualifier = any(x in q for x in _FATTURATO_QUALIFIERS)
            # Q21 pattern: standalone "fatturato" with year only
            is_standalone = not has_qualifier
            if is_standalone:
                raise AmbiguityError(
                    "Il termine 'fatturato' è ambiguo: potrebbe indicare i ricavi puri "
                    "(subtotal_amount, ~$20M) oppure il lordo con tasse e spedizione "
                    "(total_due, ~$22.4M). Specificare quale definizione usare.",
                    candidates=["revenue (~subtotal_amount)", "revenue_with_tax (~total_due)"],
                )

        # ── Q22: employee lookup by first name ─────────────────────────────
        if "dipendente" in q or "employee" in q:
            name_m = re.search(r'"([^"]+)"|\'([^\']+)\'|\bdipendente\s+["\']?([A-Za-z]+)', q)
            if not name_m:
                # Try bare name after keyword
                name_m = re.search(r'(?:mostrami|trova|cerca)\s+(?:il\s+)?dipendente\s+["\']?(\w+)', q, re.IGNORECASE)
            if name_m:
                name = next(g for g in name_m.groups() if g)
                return Intent(intent_type="lookup_employee", filters={"name": name}, raw_question=question)

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
            dept = self._extract_quoted_or_named(question, prefixes=["reparto", "in", "nel"])
            return Intent(
                intent_type="avg_hourly_rate",
                filters={"department": dept},
                raw_question=question,
            )

        # ── Q2: product price lookup ──────────────────────────────────────
        if "prezzo" in q or "listino" in q or "price" in q:
            prod = self._extract_quoted(question)
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
        if ("b2b" in q or "b2c" in q) and ("fatturato" in q or "incass" in q or "medio" in q or "revenue" in q):
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
        if ("venditore" in q or "venditori" in q) and (
            "incass" in q or "revenue" in q
        ) and "top" in q:
            return Intent(
                intent_type="top_salespersons_by_revenue",
                filters={"year": year},
                limit=limit or 3,
                year=year,
                raw_question=question,
            )

        # ── Q7: revenue by territory ──────────────────────────────────────
        if ("territorio" in q or "territory" in q) and (
            "incass" in q or "revenue" in q or "total" in q or "fatturato" not in q
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
        if "cliente" in q and ("più" in q or "top" in q) and ("speso" in q or "spesa" in q or "spend" in q):
            return Intent(intent_type="top_customer_by_spend", raw_question=question)

        # ── Q9: top products by quantity ──────────────────────────────────
        if ("prodotti" in q or "prodotto" in q) and ("vendut" in q or "quantit" in q or "top" in q):
            return Intent(
                intent_type="top_products_by_qty",
                limit=limit or 5,
                raw_question=question,
            )

        # ── Q10: customer state with most orders ──────────────────────────
        if ("stato" in q or "provincia" in q or "state" in q) and (
            "ordini" in q or "orders" in q
        ) and "client" in q:
            return Intent(intent_type="customer_state_most_orders", raw_question=question)

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
        if "incass" in q:
            return Intent(
                intent_type="revenue_with_tax",
                filters={"year": year} if year else {},
                year=year,
                raw_question=question,
            )

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
        rm = re.search(r'reparto\s+([A-Z][A-Za-z &]+)', text)
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

    def __init__(self, ontology, kg, catalog, context_manager=None) -> None:
        self._ontology = ontology
        self._kg = kg
        self._catalog = catalog
        self._ctx_mgr = context_manager
        self._parser = _RuleParser()
        # Connector references — set by _load_connectors
        self._erp = None
        self._crm = None
        self._hr_pim = None

    def set_connectors(self, erp, crm, hr_pim) -> None:
        self._erp = erp
        self._crm = crm
        self._hr_pim = hr_pim

    def ask(self, question: str, context=None) -> Result:
        """Resolve *question* and return a Result."""
        t0 = time.perf_counter()
        try:
            result = self._resolve(question, context)
        except AmbiguityError:
            raise
        except Exception as exc:
            logger.exception("SemanticLayer.ask error: %s", exc)
            result = Result(
                answer=f"Errore interno: {exc}",
                sources_touched=[],
                notes=str(exc),
            )
        result.latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        return result

    # ── resolution ────────────────────────────────────────────────────────────

    def _resolve(self, question: str, context) -> Result:
        # Rule-based parse — may raise AmbiguityError
        try:
            intent = self._parser.parse(question)
        except AmbiguityError:
            raise
        except Exception as exc:
            logger.warning("Rule parser failed: %s — falling back to Claude", exc)
            intent = self._claude_fallback(question)

        if intent.intent_type == "unknown":
            # Try Claude if available
            intent = self._claude_fallback(question)

        return self._execute(intent)

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
                model="claude-sonnet-4-6",
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
                answer=f"Domanda non compresa (intent='{intent.intent_type}'). "
                       "Prova a essere più specifico.",
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
            sql = "SELECT COUNT(*) as cnt FROM sales_order_header WHERE strftime('%Y', order_date) = ?"
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
            provenance=self._prov("Customer", ["accountType", "isActive", "ragioneSociale"]),
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
                WHERE strftime('%Y', order_date) = ?
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
                WHERE strftime('%Y', order_date) = ?
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
        )

    def _q_revenue_by_territory(self, intent: Intent) -> Result:
        year = intent.year or intent.filters.get("year")
        if year:
            sql = """
                SELECT t.territory_name, ROUND(SUM(h.total_due), 2) as revenue
                FROM sales_order_header h
                JOIN territory t ON h.territory_ref = t.territory_id
                WHERE strftime('%Y', h.order_date) = ?
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
                WHERE strftime('%Y', h.order_date) = ?
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
                WHERE strftime('%Y', h.order_date) = ?
                  AND h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref ORDER BY approx_revenue DESC
            """
            erp_rows = self._erp.execute_query(sql, (str(year),))
        else:
            sql = """
                SELECT h.salesperson_ref,
                       ROUND(SUM(l.qty * (l.unit_price - l.unit_price * l.unit_discount)), 2) as approx_revenue
                FROM sales_order_header h
                JOIN sales_order_line l ON l.order_id = h.order_id
                WHERE h.salesperson_ref IS NOT NULL
                GROUP BY h.salesperson_ref ORDER BY approx_revenue DESC
            """
            erp_rows = self._erp.execute_query(sql)

        # Enrich with PIM cost data for true margin calculation
        cost_sql = "SELECT internal_id, standardCost, listPrice FROM product_catalog_pim"
        pim_rows = {r["internal_id"]: r for r in self._hr_pim.execute_query(cost_sql)}

        # Build per-salesperson margin using line data
        if year:
            margin_sql = """
                SELECT h.salesperson_ref, l.product_ref,
                       SUM(l.qty) as total_qty
                FROM sales_order_header h
                JOIN sales_order_line l ON l.order_id = h.order_id
                WHERE strftime('%Y', h.order_date) = ?
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
        )

    def _q_avg_revenue_by_segment(self, intent: Intent) -> Result:
        # ERP and CRM are separate connectors — join manually in Python
        orders = self._erp.execute_query(
            "SELECT customer_ref, ROUND(SUM(total_due), 2) as total FROM sales_order_header GROUP BY customer_ref"
        )
        accts = {
            r["accountId"]: r["accountType"]
            for r in self._crm.execute_query("SELECT accountId, accountType FROM account WHERE accountId > 0")
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
        )

    def _q_top_category_by_margin(self, intent: Intent) -> Result:
        # Get per-product qty from ERP
        qty_sql = "SELECT product_ref, SUM(qty) as total_qty FROM sales_order_line GROUP BY product_ref"
        qty_rows = {r["product_ref"]: r["total_qty"] for r in self._erp.execute_query(qty_sql)}
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
            result.append({
                "category": cat,
                "revenue": round(rev, 2),
                "cost": round(cost, 2),
                "margin": round(margin, 2),
                "margin_pct": margin_pct,
            })
        result.sort(key=lambda x: -x["margin_pct"])
        return Result(
            answer=result,
            sql_used=qty_sql,
            sources_touched=["erp", "hr_pim"],
            provenance={
                **self._prov("SalesOrderLine", ["product_ref", "qty"]),
                **self._prov("Product", ["categoryPath", "listPrice", "standardCost"]),
            },
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
        metrics = self._catalog.list_metrics() if self._catalog else []
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
            sql = "SELECT ROUND(SUM(total_due), 2) as revenue_with_tax FROM sales_order_header WHERE strftime('%Y', order_date) = ?"
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
            notes="revenue_with_tax = SUM(total_due) includes taxes and freight",
        )

    def _q_lookup_employee(self, intent: Intent) -> Result:
        name = intent.filters.get("name", "")
        sql = "SELECT * FROM dipendenti_hr WHERE LOWER(Nome) LIKE ? OR LOWER(Cognome) LIKE ?"
        rows = self._hr_pim.execute_query(sql, (f"%{name.lower()}%", f"%{name.lower()}%"))
        if len(rows) > 1:
            # Multiple matches → disambiguation required
            return Result(
                answer=rows,
                sql_used=sql,
                sources_touched=["hr_pim"],
                disambiguation_required=True,
                candidates=[f"{r['Nome']} {r['Cognome']} (matricola {r['MatricolaDip']}, {r['Reparto']})" for r in rows],
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
                "Il campo 'nazionalità dipendente' non è disponibile in nessuna delle fonti dati "
                "(ERP, CRM, HR/PIM). AdventureWorks non contiene questo attributo. "
                "Impossibile rispondere alla domanda."
            ),
        }
        return Result(
            answer=None,
            sources_touched=[],
            notes=messages.get(reason, "Dato non disponibile nelle fonti correnti."),
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
