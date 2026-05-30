"""MetadataCatalog — SQLAlchemy + SQLite persistence for entity/attribute/metric metadata.

Populated from connectors, the ontology, and the knowledge graph.
Every entity and attribute record stores:
  - source(s) of truth with table.column path
  - data type, nullability_rate (from actual data)
  - business_definition, freshness (timestamp), record_count, sample_values (≤5)
  - quality_flags: {duplicates_detected, null_rate_warning}
  - lineage_edges: [{metric, entity, source_field}]
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy import (
    Column,
    Float,
    Integer,
    String,
    Text,
    create_engine,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

logger = logging.getLogger(__name__)

NULL_RATE_WARN_THRESHOLD = 0.10  # warn if >10 % nulls


# ── SQLAlchemy models ─────────────────────────────────────────────────────────


class Base(DeclarativeBase):
    pass


class EntityMetaRow(Base):
    __tablename__ = "entity_meta"

    name = Column(String, primary_key=True)
    description = Column(Text, default="")
    primary_key = Column(String, default="")
    sources_json = Column(Text, default="[]")  # JSON list of source dicts
    record_count = Column(Integer, default=0)
    freshness = Column(String, default="")  # ISO 8601
    quality_flags_json = Column(Text, default="{}")  # JSON dict
    kg_node_count = Column(Integer, default=0)


class AttributeMetaRow(Base):
    __tablename__ = "attribute_meta"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity = Column(String, nullable=False)
    attribute = Column(String, nullable=False)
    data_type = Column(String, default="unknown")
    nullability_rate = Column(Float, default=0.0)
    business_definition = Column(Text, default="")
    source_path = Column(String, default="")  # e.g. "erp.sales_order_header.total_due"
    sample_values_json = Column(Text, default="[]")
    lineage_edges_json = Column(Text, default="[]")


class MetricMetaRow(Base):
    __tablename__ = "metric_meta"

    name = Column(String, primary_key=True)
    label = Column(String, default="")
    description = Column(Text, default="")
    formula = Column(Text, default="")
    unit = Column(String, default="")
    aliases_json = Column(Text, default="[]")
    requires_join_json = Column(Text, default="[]")
    sources_touched_json = Column(Text, default="[]")


# ── Pydantic-style dataclasses (returned by public API) ──────────────────────


class EntityMeta:
    """Lightweight container for entity metadata."""

    def __init__(self, row: EntityMetaRow) -> None:
        self._row = row

    @property
    def name(self) -> str:
        return self._row.name

    @property
    def description(self) -> str:
        return self._row.description or ""

    @property
    def record_count(self) -> int:
        return self._row.record_count or 0

    @property
    def freshness(self) -> str:
        return self._row.freshness or ""

    @property
    def sources(self) -> list[dict]:
        return json.loads(self._row.sources_json or "[]")

    @property
    def quality_flags(self) -> dict:
        return json.loads(self._row.quality_flags_json or "{}")

    @property
    def kg_node_count(self) -> int:
        return self._row.kg_node_count or 0

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "record_count": self.record_count,
            "freshness": self.freshness,
            "sources": self.sources,
            "quality_flags": self.quality_flags,
            "kg_node_count": self.kg_node_count,
        }


class AttributeMeta:
    """Lightweight container for attribute metadata."""

    def __init__(self, row: AttributeMetaRow) -> None:
        self._row = row

    @property
    def entity(self) -> str:
        return self._row.entity

    @property
    def attribute(self) -> str:
        return self._row.attribute

    @property
    def data_type(self) -> str:
        return self._row.data_type or "unknown"

    @property
    def nullability_rate(self) -> float:
        return self._row.nullability_rate or 0.0

    @property
    def business_definition(self) -> str:
        return self._row.business_definition or ""

    @property
    def source_path(self) -> str:
        return self._row.source_path or ""

    @property
    def sample_values(self) -> list:
        return json.loads(self._row.sample_values_json or "[]")

    @property
    def lineage_edges(self) -> list[dict]:
        return json.loads(self._row.lineage_edges_json or "[]")

    def to_dict(self) -> dict:
        return {
            "entity": self.entity,
            "attribute": self.attribute,
            "data_type": self.data_type,
            "nullability_rate": self.nullability_rate,
            "business_definition": self.business_definition,
            "source_path": self.source_path,
            "sample_values": self.sample_values,
            "lineage_edges": self.lineage_edges,
        }


class MetricMeta:
    """Lightweight container for metric metadata."""

    def __init__(self, row: MetricMetaRow) -> None:
        self._row = row

    @property
    def name(self) -> str:
        return self._row.name

    @property
    def label(self) -> str:
        return self._row.label or ""

    @property
    def description(self) -> str:
        return self._row.description or ""

    @property
    def formula(self) -> str:
        return self._row.formula or ""

    @property
    def unit(self) -> str:
        return self._row.unit or ""

    @property
    def aliases(self) -> list[str]:
        return json.loads(self._row.aliases_json or "[]")

    @property
    def requires_join(self) -> list[str]:
        return json.loads(self._row.requires_join_json or "[]")

    @property
    def sources_touched(self) -> list[str]:
        return json.loads(self._row.sources_touched_json or "[]")

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "formula": self.formula,
            "unit": self.unit,
            "aliases": self.aliases,
            "requires_join": self.requires_join,
            "sources_touched": self.sources_touched,
        }


# ── MetadataCatalog ───────────────────────────────────────────────────────────


class MetadataCatalog:
    """Persists entity/attribute/metric metadata to a SQLite database.

    Parameters
    ----------
    db_url:
        SQLAlchemy database URL.  Defaults to in-memory SQLite.
    """

    def __init__(self, db_url: str = "sqlite:///:memory:") -> None:
        self._engine = create_engine(db_url, echo=False)
        Base.metadata.create_all(self._engine)
        self._Session = sessionmaker(bind=self._engine)
        self._populated = False

    # ── population ────────────────────────────────────────────────────────────

    def populate(self, connectors: list, ontology, kg) -> None:
        """Populate the catalog from connectors, ontology, and KG."""
        logger.info("Populating metadata catalog…")
        now = datetime.utcnow().isoformat()

        with self._Session() as session:
            self._populate_metrics(session, ontology)
            self._populate_erp(session, connectors, ontology, kg, now)
            self._populate_crm(session, connectors, ontology, kg, now)
            self._populate_hr_pim(session, connectors, ontology, kg, now)
            session.commit()

        self._populated = True
        logger.info("Metadata catalog populated.")

    def populate_from_manager(self, mgr) -> None:
        """Auto-discover all tables in the DuckDB snapshot and upsert catalog entries.

        Supplements the hardcoded populate() with schema-driven discovery so that
        any registered source — including sources added at runtime — is immediately
        visible to the semantic layer for LLM SQL generation.
        """
        try:
            schema = mgr.get_schema_info()
        except Exception as exc:
            logger.warning("populate_from_manager: schema discovery failed: %s", exc)
            return

        now = datetime.utcnow().isoformat()
        with self._Session() as session:
            for table, info in schema.items():
                columns = info.get("columns", [])
                row_count = info.get("row_count", 0)
                sample = info.get("sample", [])

                self._upsert_entity(
                    session,
                    name=table,
                    description=f"Auto-discovered from DuckDB snapshot (table: {table})",
                    primary_key="",
                    sources=[{"source": "duckdb_unified", "table": table}],
                    record_count=row_count,
                    freshness=now,
                    quality_flags={},
                    kg_node_count=0,
                )

                for col in columns:
                    col_name = col.get("name", "")
                    col_type = col.get("type", "unknown")
                    if not col_name:
                        continue
                    vals = [
                        str(r.get(col_name))
                        for r in sample
                        if r.get(col_name) is not None
                    ][:5]
                    null_rate = (
                        sum(1 for r in sample if r.get(col_name) is None) / len(sample)
                        if sample
                        else 0.0
                    )
                    self._upsert_attribute(
                        session,
                        entity=table,
                        attribute=col_name,
                        data_type=col_type,
                        nullability_rate=round(null_rate, 4),
                        business_definition="",
                        source_path=f"duckdb_unified.{table}.{col_name}",
                        sample_values=vals,
                        lineage_edges=[],
                    )
            session.commit()
        logger.info(
            "populate_from_manager: upserted %d tables into catalog", len(schema)
        )

    def get_schema_context(self, max_tables: int = 30) -> str:
        """Return a compact LLM-ready description of all catalogued tables.

        Used in the LLM SQL-generation prompt so the model knows exactly which
        tables and columns are available in the DuckDB snapshot.
        """
        with self._Session() as session:
            entity_rows = session.execute(select(EntityMetaRow)).scalars().all()
            attr_rows = session.execute(select(AttributeMetaRow)).scalars().all()

        if not entity_rows:
            return "No schema available."

        # Group attributes by entity
        attrs_by_entity: dict[str, list] = {}
        for ar in attr_rows:
            attrs_by_entity.setdefault(ar.entity, []).append(ar)

        # Deduplicate by actual DuckDB table name — prefer first occurrence
        seen_tables: set[str] = set()
        lines: list[str] = ["Available tables in DuckDB:\n"]
        count = 0

        for row in sorted(entity_rows, key=lambda r: r.name):
            if count >= max_tables:
                break
            sources = json.loads(row.sources_json or "[]")
            table = next(
                (s.get("table", row.name) for s in sources if isinstance(s, dict)),
                row.name,
            )
            if table in seen_tables:
                continue
            seen_tables.add(table)
            count += 1

            record_count = row.record_count or 0
            lines.append(f"Table: {table} ({record_count:,} rows)")
            attrs = attrs_by_entity.get(row.name, [])
            if attrs:
                col_str = ", ".join(f"{a.attribute} {a.data_type}" for a in attrs)
                lines.append(f"  Columns: {col_str}")
            lines.append("")

        return "\n".join(lines)

    # ── public query API ──────────────────────────────────────────────────────

    def get_entity(self, name: str) -> EntityMeta | None:
        with self._Session() as session:
            row = session.get(EntityMetaRow, name)
            return EntityMeta(row) if row else None

    def get_attribute(self, entity: str, attribute: str) -> AttributeMeta | None:
        with self._Session() as session:
            row = session.execute(
                select(AttributeMetaRow).where(
                    AttributeMetaRow.entity == entity,
                    AttributeMetaRow.attribute == attribute,
                )
            ).scalar_one_or_none()
            return AttributeMeta(row) if row else None

    def get_metric(self, name: str) -> MetricMeta | None:
        with self._Session() as session:
            row = session.get(MetricMetaRow, name)
            return MetricMeta(row) if row else None

    def list_entities(self) -> list[str]:
        with self._Session() as session:
            rows = session.execute(select(EntityMetaRow.name)).scalars().all()
            return list(rows)

    def list_metrics(self) -> list[str]:
        with self._Session() as session:
            rows = session.execute(select(MetricMetaRow.name)).scalars().all()
            return list(rows)

    def row_count(self) -> int:
        """Total rows across all catalog tables."""
        with self._Session() as session:
            # count via ORM:
            e = session.query(EntityMetaRow).count()
            a = session.query(AttributeMetaRow).count()
            m = session.query(MetricMetaRow).count()
            return e + a + m

    # ── internal helpers ──────────────────────────────────────────────────────

    def _upsert_entity(
        self,
        session: Session,
        name: str,
        description: str,
        primary_key: str,
        sources: list[dict],
        record_count: int,
        freshness: str,
        quality_flags: dict,
        kg_node_count: int,
    ) -> None:
        existing = session.get(EntityMetaRow, name)
        if existing:
            existing.description = description
            existing.record_count = record_count
            existing.freshness = freshness
            existing.sources_json = json.dumps(sources)
            existing.quality_flags_json = json.dumps(quality_flags)
            existing.kg_node_count = kg_node_count
        else:
            session.add(
                EntityMetaRow(
                    name=name,
                    description=description,
                    primary_key=primary_key,
                    sources_json=json.dumps(sources),
                    record_count=record_count,
                    freshness=freshness,
                    quality_flags_json=json.dumps(quality_flags),
                    kg_node_count=kg_node_count,
                )
            )

    def _upsert_attribute(
        self,
        session: Session,
        entity: str,
        attribute: str,
        data_type: str,
        nullability_rate: float,
        business_definition: str,
        source_path: str,
        sample_values: list,
        lineage_edges: list[dict],
    ) -> None:
        existing = session.execute(
            select(AttributeMetaRow).where(
                AttributeMetaRow.entity == entity,
                AttributeMetaRow.attribute == attribute,
            )
        ).scalar_one_or_none()
        if existing:
            existing.data_type = data_type
            existing.nullability_rate = nullability_rate
            existing.business_definition = business_definition
            existing.source_path = source_path
            existing.sample_values_json = json.dumps(sample_values, default=str)
            existing.lineage_edges_json = json.dumps(lineage_edges)
        else:
            session.add(
                AttributeMetaRow(
                    entity=entity,
                    attribute=attribute,
                    data_type=data_type,
                    nullability_rate=nullability_rate,
                    business_definition=business_definition,
                    source_path=source_path,
                    sample_values_json=json.dumps(sample_values, default=str),
                    lineage_edges_json=json.dumps(lineage_edges),
                )
            )

    # ── per-source population ─────────────────────────────────────────────────

    def _populate_metrics(self, session: Session, ontology) -> None:
        # Static metric definitions
        metrics = [
            MetricMetaRow(
                name="revenue",
                label="Fatturato (ricavi puri)",
                description="Somma di subtotal_amount sugli ordini, esclude tasse e spedizione",
                formula="SUM(sales_order_header.subtotal_amount)",
                unit="USD",
                aliases_json=json.dumps([]),
                requires_join_json=json.dumps([]),
                sources_touched_json=json.dumps(["erp"]),
            ),
            MetricMetaRow(
                name="revenue_with_tax",
                label="Fatturato lordo",
                description="Somma di total_due, include tasse e spedizione",
                formula="SUM(sales_order_header.total_due)",
                unit="USD",
                aliases_json=json.dumps(["incasso", "incassi"]),
                requires_join_json=json.dumps([]),
                sources_touched_json=json.dumps(["erp"]),
            ),
            MetricMetaRow(
                name="margin",
                label="Margine commerciale",
                description="Ricavi meno costi standard di prodotto",
                formula="SUM(sales_order_line.qty * (product.list_price - product.standard_cost))",
                unit="USD",
                aliases_json=json.dumps(["margine"]),
                requires_join_json=json.dumps(["SalesOrderLine", "Product"]),
                sources_touched_json=json.dumps(["erp", "hr_pim"]),
            ),
            MetricMetaRow(
                name="active_customers",
                label="Clienti attivi",
                description="Conteggio distinto di customer_ref con almeno un ordine",
                formula="COUNT(DISTINCT sales_order_header.customer_ref)",
                unit="count",
                aliases_json=json.dumps(["clienti_attivi"]),
                requires_join_json=json.dumps([]),
                sources_touched_json=json.dumps(["erp", "crm"]),
            ),
        ]
        for m in metrics:
            existing = session.get(MetricMetaRow, m.name)
            if not existing:
                session.add(m)

    def _populate_erp(
        self, session: Session, connectors: list, ontology, kg, now: str
    ) -> None:
        # Find ERP connector
        erp = _find_connector(connectors, "erp")
        if erp is None:
            return

        # SalesOrder — use COUNT + sample to avoid loading 31k rows into Python memory
        try:
            orders_count: int = erp.execute_query(
                'SELECT COUNT(*) AS n FROM "sales_order_header"'
            )[0]["n"]
        except Exception:
            orders_count = 0
        try:
            orders_sample = erp.execute_query(
                'SELECT * FROM "sales_order_header" LIMIT 200'
            )
        except Exception:
            orders_sample = []
        self._upsert_entity(
            session,
            name="SalesOrder",
            description="Sales order header.",
            primary_key="order_id",
            sources=[
                {"source": "erp", "table": "sales_order_header", "key": "order_id"}
            ],
            record_count=orders_count,
            freshness=now,
            quality_flags={"duplicates_detected": False, "null_rate_warning": False},
            kg_node_count=0,
        )
        _catalog_columns(
            session,
            self._upsert_attribute,
            entity="SalesOrder",
            rows=orders_sample,
            source_prefix="erp.sales_order_header",
            field_definitions={
                "order_id": "Identificatore ordine",
                "order_number": "Numero ordine (stringa, es. SO43659)",
                "order_date": "Data ordine",
                "total_due": "Totale dovuto (subtotale + tasse + spedizione)",
                "subtotal_amount": "Ricavi puri (senza tasse)",
                "customer_ref": "Riferimento cliente (CRM accountId)",
                "salesperson_ref": "Riferimento venditore (HR MatricolaDip)",
                "territory_ref": "Riferimento territorio",
            },
            lineage={
                "subtotal_amount": [
                    {
                        "metric": "revenue",
                        "entity": "SalesOrder",
                        "source_field": "subtotal_amount",
                    }
                ],
                "total_due": [
                    {
                        "metric": "revenue_with_tax",
                        "entity": "SalesOrder",
                        "source_field": "total_due",
                    }
                ],
            },
        )

        # SalesOrderLine — use COUNT + sample to avoid loading 121k rows into Python memory
        try:
            lines_count: int = erp.execute_query(
                'SELECT COUNT(*) AS n FROM "sales_order_line"'
            )[0]["n"]
        except Exception:
            lines_count = 0
        try:
            lines_sample = erp.execute_query(
                'SELECT * FROM "sales_order_line" LIMIT 200'
            )
        except Exception:
            lines_sample = []
        self._upsert_entity(
            session,
            name="SalesOrderLine",
            description="Sales order line item.",
            primary_key="(order_id, line_id)",
            sources=[{"source": "erp", "table": "sales_order_line"}],
            record_count=lines_count,
            freshness=now,
            quality_flags={"duplicates_detected": False, "null_rate_warning": False},
            kg_node_count=0,
        )
        _catalog_columns(
            session,
            self._upsert_attribute,
            entity="SalesOrderLine",
            rows=lines_sample,
            source_prefix="erp.sales_order_line",
            field_definitions={
                "product_ref": "Riferimento prodotto (PIM internal_id)",
                "qty": "Quantità ordinata",
                "unit_price": "Prezzo unitario",
                "line_total": "Totale riga",
                "offer_ref": "Offerta applicata (1 = nessuna offerta)",
            },
            lineage={
                "qty": [
                    {
                        "metric": "margin",
                        "entity": "SalesOrderLine",
                        "source_field": "qty",
                    }
                ],
                "line_total": [
                    {
                        "metric": "margin",
                        "entity": "SalesOrderLine",
                        "source_field": "line_total",
                    }
                ],
            },
        )

        # Salesperson
        sps = list(erp.load_entity("Salesperson"))
        kg_count_sp = kg.subgraph("Salesperson").number_of_nodes()
        self._upsert_entity(
            session,
            name="Salesperson",
            description="Venditore (sub-ruolo di Employee, con attributi commerciali).",
            primary_key="salesperson_id",
            sources=[
                {"source": "erp", "table": "salesperson", "key": "salesperson_id"},
                {"source": "hr_pim", "table": "dipendenti_hr", "key": "MatricolaDip"},
            ],
            record_count=len(sps),
            freshness=now,
            quality_flags={"duplicates_detected": False, "null_rate_warning": False},
            kg_node_count=kg_count_sp,
        )

        # Territory
        territories = list(erp.load_entity("Territory"))
        kg_count_t = kg.subgraph("Territory").number_of_nodes()
        self._upsert_entity(
            session,
            name="Territory",
            description="Territorio commerciale.",
            primary_key="territory_id",
            sources=[{"source": "erp", "table": "territory", "key": "territory_id"}],
            record_count=len(territories),
            freshness=now,
            quality_flags={"duplicates_detected": False, "null_rate_warning": False},
            kg_node_count=kg_count_t,
        )

    def _populate_crm(
        self, session: Session, connectors: list, ontology, kg, now: str
    ) -> None:
        crm = _find_connector(connectors, "crm")
        if crm is None:
            return

        customers = list(crm.load_entity("Customer"))
        duplicates = [r for r in customers if r["accountId"] < 0]
        kg_count = kg.subgraph("Customer").number_of_nodes()
        null_email_rate = _null_rate(customers, "emailContatto")

        self._upsert_entity(
            session,
            name="Customer",
            description="Cliente B2C o B2B. accountId < 0 indica duplicato.",
            primary_key="accountId",
            sources=[{"source": "crm", "table": "account", "key": "accountId"}],
            record_count=len(customers),
            freshness=now,
            quality_flags={
                "duplicates_detected": len(duplicates) > 0,
                "null_rate_warning": null_email_rate > NULL_RATE_WARN_THRESHOLD,
                "duplicate_count": len(duplicates),
                "dedup_rule": "accountId < 0 → duplicato; merge per email normalizzata",
            },
            kg_node_count=kg_count,
        )
        _catalog_columns(
            session,
            self._upsert_attribute,
            entity="Customer",
            rows=customers,
            source_prefix="crm.account",
            field_definitions={
                "accountId": "Identificatore account CRM",
                "accountType": "Tipo account: B2C o B2B",
                "ragioneSociale": "Ragione sociale (solo B2B)",
                "nomeContatto": "Nome contatto (solo B2C)",
                "emailContatto": "Email principale",
                "territoryHint": "Territorio suggerito",
                "isActive": "Flag cliente attivo",
            },
            lineage={},
        )

    def _populate_hr_pim(
        self, session: Session, connectors: list, ontology, kg, now: str
    ) -> None:
        hr_pim = _find_connector(connectors, "hr_pim")
        if hr_pim is None:
            return

        employees = list(hr_pim.load_entity("Employee"))
        kg_count_e = kg.subgraph("Employee").number_of_nodes()
        null_rate_pay = _null_rate(employees, "RetribuzioneOraria")

        self._upsert_entity(
            session,
            name="Employee",
            description="Dipendente HR. MatricolaDip è anche salesperson_id in ERP.",
            primary_key="MatricolaDip",
            sources=[
                {"source": "hr_pim", "table": "dipendenti_hr", "key": "MatricolaDip"}
            ],
            record_count=len(employees),
            freshness=now,
            quality_flags={
                "duplicates_detected": False,
                "null_rate_warning": null_rate_pay > NULL_RATE_WARN_THRESHOLD,
            },
            kg_node_count=kg_count_e,
        )
        _catalog_columns(
            session,
            self._upsert_attribute,
            entity="Employee",
            rows=employees,
            source_prefix="hr_pim.dipendenti_hr",
            field_definitions={
                "MatricolaDip": "Matricola dipendente (= salesperson_id ERP)",
                "Nome": "Nome",
                "Cognome": "Cognome",
                "Reparto": "Reparto (es. Engineering, Production)",
                "GruppoReparto": "Gruppo reparto",
                "DataAssunzione": "Data assunzione (normalizzata ISO 8601)",
                "RetribuzioneOraria": "Retribuzione oraria (USD)",
            },
            lineage={},
        )

        products = list(hr_pim.load_entity("Product"))
        kg_count_p = kg.subgraph("Product").number_of_nodes()
        self._upsert_entity(
            session,
            name="Product",
            description="Prodotto del catalogo PIM.",
            primary_key="internal_id",
            sources=[
                {
                    "source": "hr_pim",
                    "table": "product_catalog_pim",
                    "key": "internal_id",
                }
            ],
            record_count=len(products),
            freshness=now,
            quality_flags={"duplicates_detected": False, "null_rate_warning": False},
            kg_node_count=kg_count_p,
        )
        _catalog_columns(
            session,
            self._upsert_attribute,
            entity="Product",
            rows=products,
            source_prefix="hr_pim.product_catalog_pim",
            field_definitions={
                "internal_id": "ID prodotto (= product_ref ERP)",
                "sku": "SKU alternativo",
                "displayName": "Nome visualizzato prodotto",
                "categoryPath": "Percorso categoria (es. Bikes/Mountain Bikes)",
                "standardCost": "Costo standard (USD)",
                "listPrice": "Prezzo di listino (USD)",
                "isMakeOnly": "Prodotto solo internamente",
                "sellStartDate": "Data inizio vendita (ISO 8601)",
            },
            lineage={
                "standardCost": [
                    {
                        "metric": "margin",
                        "entity": "Product",
                        "source_field": "standardCost",
                    }
                ],
                "listPrice": [
                    {
                        "metric": "margin",
                        "entity": "Product",
                        "source_field": "listPrice",
                    }
                ],
            },
        )


# ── module-level helpers ──────────────────────────────────────────────────────


def _find_connector(connectors: list, name: str):
    for c in connectors:
        try:
            meta = c.describe()
            if meta.name == name:
                return c
        except Exception as exc:
            import logging as _logging

            _logging.getLogger(__name__).debug(
                "_find_connector: describe() failed: %s", exc
            )
    return None


def _null_rate(rows: list[dict], field: str) -> float:
    if not rows:
        return 0.0
    nulls = sum(1 for r in rows if not r.get(field))
    return nulls / len(rows)


def _catalog_columns(
    session: Session,
    upsert_fn,
    entity: str,
    rows: list[dict],
    source_prefix: str,
    field_definitions: dict[str, str],
    lineage: dict[str, list[dict]],
) -> None:
    """Derive attribute metadata from actual row data."""
    if not rows:
        return
    all_keys = set(rows[0].keys())
    for key in all_keys:
        if key.startswith("_raw_date_"):
            continue
        values = [r.get(key) for r in rows]
        non_null = [v for v in values if v is not None and str(v).strip() != ""]
        null_rate = 1.0 - (len(non_null) / len(rows))
        dtype = _infer_type(non_null)
        samples = list({str(v) for v in non_null[:20] if v is not None})[:5]
        upsert_fn(
            session,
            entity=entity,
            attribute=key,
            data_type=dtype,
            nullability_rate=round(null_rate, 4),
            business_definition=field_definitions.get(key, ""),
            source_path=f"{source_prefix}.{key}",
            sample_values=samples,
            lineage_edges=lineage.get(key, []),
        )


def _infer_type(values: list) -> str:
    if not values:
        return "unknown"
    sample = [v for v in values[:20] if v is not None]
    if not sample:
        return "unknown"
    for v in sample:
        try:
            int(str(v))
            continue
        except ValueError:
            break
    else:
        return "integer"
    for v in sample:
        try:
            float(str(v))
            continue
        except ValueError:
            break
    else:
        return "float"
    return "string"
