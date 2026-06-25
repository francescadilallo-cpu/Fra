"""KnowledgeGraph — builds a networkx MultiDiGraph from ERP, CRM, and HR/PIM data.

Node types : Customer, Employee, Salesperson, Product, SalesOrder,
             SalesOrderLine, Territory, Address, Offer
Edge types : PLACED_BY, SOLD_BY, WORKS_IN, CONTAINS_LINE, OF_PRODUCT,
             IN_TERRITORY, LOCATED_AT

Identity resolution
-------------------
* customer_ref (ERP) ↔ accountId (CRM) — same numeric ID
* salesperson_ref (ERP) ↔ MatricolaDip (HR) ↔ salesperson_id (ERP salesperson)
* product_ref (ERP) ↔ internal_id (PIM), sku as alt key

Deduplication
-------------
CRM accounts with accountId < 0 are duplicates.  They are merged with their
positive counterpart using normalised email match.  Provenance is stored on
every node as a list of {source, original_id, table} dicts.
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Iterator
from typing import Any

import networkx as nx

logger = logging.getLogger(__name__)


def _edge_limit() -> int:
    """Per-relation edge cap when building the KG from the ontology.

    Bounds memory — each edge becomes a networkx entry. Defaults to 100k.
    Set FRA_KG_EDGE_LIMIT=0 for unlimited, or to a custom value. Invalid or
    negative values fall back to the default.
    """
    raw = os.getenv("FRA_KG_EDGE_LIMIT", "100000").strip()
    try:
        val = int(raw)
    except ValueError:
        return 100000
    return val if val >= 0 else 100000


def _node_limit() -> int:
    """Per-entity node cap when building the KG from the ontology.

    Bounds memory — each row becomes an in-memory networkx node carrying its
    attributes. Defaults to 200k. Set FRA_KG_NODE_LIMIT=0 for unlimited, or a
    custom value. Invalid or negative values fall back to the default.
    """
    raw = os.getenv("FRA_KG_NODE_LIMIT", "200000").strip()
    try:
        val = int(raw)
    except ValueError:
        return 200000
    return val if val >= 0 else 200000


# Value-overlap FK detection bounds (Phase 3 of build_from_schema).
_FK_VALUE_SAMPLE = 50  # distinct values sampled per column
_FK_VALUE_OVERLAP = 0.5  # min share of FK values found in a PK column
_FK_MAX_PROBES = 200  # cap on candidate columns sampled (whole build)

_SENTINEL = object()


def _chain_first(first, rest):
    """Re-attach an eagerly-pulled first item to the front of a generator."""
    yield first
    yield from rest


# ── helpers ───────────────────────────────────────────────────────────────────


def _normalize_table_name(name: str) -> str:
    """Strip common file extensions from an ontology source table name.

    The YAML may reference source files with extensions
    (e.g. ``dipendenti_hr.csv``, ``product_catalog_pim.json``).
    DuckDB stores the ingested tables without extensions.
    """
    _KNOWN_EXT = {"csv", "json", "xlsx", "xls", "parquet", "sql"}
    parts = name.rsplit(".", 1)
    if len(parts) == 2 and parts[1].lower() in _KNOWN_EXT:
        return parts[0]
    return name


_VIA_RE = re.compile(r"(\w+)\s*(?:→|->)\s*(\w+)\.(\w+)")


# ── helpers ───────────────────────────────────────────────────────────────────


def _norm_email(email: str | None) -> str | None:
    if not email:
        return None
    return email.strip().lower()


def _norm_name(name: str | None) -> str | None:
    if not name:
        return None
    return re.sub(r"\s+", " ", name.strip().lower())


# ── KnowledgeGraph ────────────────────────────────────────────────────────────


class KnowledgeGraph:
    """Multi-source knowledge graph with identity resolution and provenance."""

    def __init__(self) -> None:
        self._g: nx.MultiDiGraph = nx.MultiDiGraph()
        self._dedup_count: int = 0
        # Maps (entity_type, canonical_id) → node_id string
        self._entity_index: dict[tuple[str, Any], str] = {}
        # Maps CRM negative accountId → positive canonical accountId
        self._dup_map: dict[int, int] = {}

    # ── public API ────────────────────────────────────────────────────────────

    def build(self, erp, crm, hr_pim) -> None:  # type hints skipped to avoid circular
        """Populate the graph from the three connectors.

        Each loader is wrapped individually: a missing table or corrupt data in
        one entity type does NOT prevent the remaining entities from loading.
        """
        logger.info("Building knowledge graph…")

        _loaders = [
            ("territories", self._load_territories, erp),
            ("offers", self._load_offers, erp),
            ("crm_customers", self._load_crm_customers, crm),
            ("hr_employees", self._load_hr_employees, hr_pim),
            ("pim_products", self._load_pim_products, hr_pim),
            ("erp_salespersons", self._load_erp_salespersons, erp),
            # SalesOrder/SalesOrderLine are NOT loaded here — queried via DuckDB SQL
            # to avoid 150k+ networkx nodes (~400MB) on Render's free-tier instance.
            ("crm_addresses", self._load_crm_addresses, crm),
        ]
        for name, loader, connector in _loaders:
            try:
                loader(connector)
            except Exception as exc:
                logger.warning("KG loader '%s' failed (partial KG): %s", name, exc)

        logger.info(
            "KG built: %d nodes, %d edges, %d duplicates merged",
            self._g.number_of_nodes(),
            self._g.number_of_edges(),
            self._dedup_count,
        )

    @staticmethod
    def _iter_rows(mgr, sql: str):
        """Yield rows for *sql*, preferring the manager's streaming fetch.

        Returns an iterator, or None if the query failed. Falls back to
        execute_all() for managers/adapters that don't implement execute_iter
        (e.g. test doubles), preserving backward compatibility.
        """
        execute_iter = getattr(mgr, "execute_iter", None)
        try:
            if callable(execute_iter):
                gen = execute_iter(sql)
                # Pull the first row eagerly so a query error surfaces here
                # (and we can report it) rather than mid-iteration.
                first = next(gen, _SENTINEL)
                if first is _SENTINEL:
                    return iter(())
                return _chain_first(first, gen)
            return iter(mgr.execute_all(sql))
        except Exception as exc:
            logger.warning("KG row fetch failed for %s: %s", sql, exc)
            return None

    @staticmethod
    def _resolve_pk_fields(entity_cfg: dict, primary_src: dict) -> list[str]:
        """Primary-key columns for an ontology entity.

        Prefers the source-level ``key_field``; falls back to the entity-level
        ``primary_key`` (which may be a composite list, e.g. SalesOrderLine's
        ``[order_id, line_id]``); defaults to ``id``. Without this fallback a
        composite-key entity silently loaded zero nodes and its edge queries
        failed on the nonexistent ``id`` column.
        """
        kf = primary_src.get("key_field")
        if kf:
            return [str(kf)]
        pk = entity_cfg.get("primary_key")
        if isinstance(pk, str) and pk.strip():
            return [pk.strip()]
        if isinstance(pk, list) and pk:
            return [str(p) for p in pk]
        return ["id"]

    @staticmethod
    def _composite_id(values: list) -> str | int | None:
        """Node-id component from pk values — None if any component is NULL."""
        if any(v is None for v in values):
            return None
        if len(values) == 1:
            return values[0]
        return "-".join(str(v) for v in values)

    def build_from_ontology(self, mgr, ontology) -> None:
        """Build the knowledge graph from ontology source definitions + DuckDB tables.

        This is the schema-driven alternative to build(): instead of hardcoded
        loaders per entity type, it reads entity→table mappings from the ontology
        YAML and loads nodes directly from the DuckDB unified snapshot.

        Phase 1 — Nodes: for every entity declared in the ontology, find its
        source table in DuckDB, load all rows, and add a node per row.

        Phase 2 — Edges: for every many_to_one / one_to_one relation with a
        ``via: from_col → TargetEntity.target_pk`` definition, run a lightweight
        SQL query to materialise edges without loading all rows into Python.

        Falls back gracefully when a table is absent (partial KG is safe).
        """
        logger.info("Building knowledge graph from ontology…")

        # Discover available DuckDB tables once
        try:
            available_tables = set(mgr.get_schema_info().keys())
        except Exception as exc:
            logger.warning("build_from_ontology: schema discovery failed: %s", exc)
            available_tables = set()

        entities_cfg: dict[str, Any] = getattr(ontology, "_entities_cfg", {})

        # entity_name → DuckDB table name (after normalisation)
        entity_table_map: dict[str, str] = {}
        # entity_name → primary-key column names in DuckDB (composite-safe)
        entity_pk_map: dict[str, list[str]] = {}

        # ── Phase 1: load nodes ───────────────────────────────────────────────
        for entity_name, entity_cfg in entities_cfg.items():
            if not isinstance(entity_cfg, dict):
                continue
            sources = entity_cfg.get("sources") or []
            if not sources:
                continue

            primary_src = sources[0]
            raw_table = primary_src.get("table", "")
            key_fields = self._resolve_pk_fields(entity_cfg, primary_src)
            table = _normalize_table_name(raw_table)

            if table not in available_tables:
                logger.debug(
                    "build_from_ontology: entity '%s' — table '%s' not in DuckDB, skipping",
                    entity_name,
                    table,
                )
                continue

            entity_table_map[entity_name] = table
            entity_pk_map[entity_name] = key_fields

            safe = table.replace('"', '""')
            node_limit = _node_limit()
            # Stream rows in batches (when the manager supports it) so a large
            # table is never fully materialised into one Python list, and we can
            # stop at the cap without fetching the rest.
            rows_iter = self._iter_rows(mgr, f'SELECT * FROM "{safe}"')
            if rows_iter is None:
                logger.warning(
                    "build_from_ontology: load failed for entity '%s' (table '%s')",
                    entity_name,
                    table,
                )
                continue

            source_id = primary_src.get("source", "unknown")
            loaded = 0
            truncated = False
            for row in rows_iter:
                if node_limit > 0 and loaded >= node_limit:
                    truncated = True
                    break
                pk_val = self._composite_id([row.get(f) for f in key_fields])
                if pk_val is None:
                    continue
                node_id = f"{entity_name}:{pk_val}"
                self._add_node(
                    node_id,
                    entity_type=entity_name,
                    canonical_id=pk_val,
                    data={k: v for k, v in row.items()},
                    provenance=[
                        {"source": source_id, "original_id": pk_val, "table": table}
                    ],
                )
                loaded += 1
            if truncated:
                logger.warning(
                    "build_from_ontology: entity '%s' hit the %d-node cap — the "
                    "knowledge graph may be incomplete. Raise FRA_KG_NODE_LIMIT "
                    "(or set 0 for unlimited) to load all nodes.",
                    entity_name,
                    node_limit,
                )
            logger.debug(
                "build_from_ontology: %d nodes loaded for '%s'", loaded, entity_name
            )

        # ── Phase 2: build edges from relation definitions ────────────────────
        for entity_name, entity_cfg in entities_cfg.items():
            if not isinstance(entity_cfg, dict):
                continue
            from_table = entity_table_map.get(entity_name)
            from_pk = entity_pk_map.get(entity_name)
            if not from_table or not from_pk:
                continue

            attrs = entity_cfg.get("attributes") or {}
            for attr_name, attr_cfg in attrs.items():
                if not isinstance(attr_cfg, dict) or "relation" not in attr_cfg:
                    continue
                rel_kind = attr_cfg.get("relation", "")
                if rel_kind == "one_to_many":
                    continue  # no FK in the from-table, skip
                via = str(attr_cfg.get("via", "")).strip()
                target_entity = attr_cfg.get("target", "")
                if not via or not target_entity:
                    continue

                m = _VIA_RE.match(via)
                if not m:
                    continue
                from_col, _tgt, _tgt_key = m.groups()
                edge_type = attr_name.upper()

                safe_from = from_table.replace('"', '""')
                pk_select = ", ".join('"' + p.replace('"', '""') + '"' for p in from_pk)
                safe_col = from_col.replace('"', '""')
                edge_limit = _edge_limit()
                base_query = (
                    f'SELECT {pk_select}, "{safe_col}" '
                    f'FROM "{safe_from}" '
                    f'WHERE "{safe_col}" IS NOT NULL'
                )
                # Fetch one extra row so truncation can be detected and warned
                # about, rather than silently dropping data.
                query = (
                    f"{base_query} LIMIT {edge_limit + 1}"
                    if edge_limit > 0
                    else base_query
                )
                try:
                    # mgr.execute() is the *frontend-query* path and silently
                    # caps results at 100 rows — that would defeat both
                    # FRA_KG_EDGE_LIMIT (default 100k) and the truncation
                    # detection below (len(edge_rows) would never exceed
                    # edge_limit). execute_all() respects the SQL LIMIT above.
                    edge_rows = mgr.execute_all(query)
                except Exception as exc:
                    logger.warning(
                        "build_from_ontology: edge query failed %s.%s: %s",
                        entity_name,
                        attr_name,
                        exc,
                    )
                    continue

                truncated = edge_limit > 0 and len(edge_rows) > edge_limit
                if truncated:
                    edge_rows = edge_rows[:edge_limit]

                edges_added = 0
                for row in edge_rows:
                    from_id = self._composite_id([row.get(p) for p in from_pk])
                    to_id = row.get(from_col)
                    if from_id is None or to_id is None:
                        continue
                    # Apply CRM dedup map if targeting Customer
                    if target_entity == "Customer":
                        try:
                            to_id = self._dup_map.get(int(to_id), int(to_id))
                        except (TypeError, ValueError):
                            pass
                    from_node = f"{entity_name}:{from_id}"
                    to_node = f"{target_entity}:{to_id}"
                    self._add_edge(from_node, to_node, edge_type)
                    edges_added += 1

                if truncated:
                    logger.warning(
                        "build_from_ontology: edge query for %s.%s hit the %d-row "
                        "cap — the knowledge graph may be incomplete. "
                        "Raise FRA_KG_EDGE_LIMIT (or set 0 for unlimited) to load "
                        "all edges.",
                        entity_name,
                        attr_name,
                        edge_limit,
                    )
                logger.debug(
                    "build_from_ontology: %d edges %s-[%s]->%s",
                    edges_added,
                    entity_name,
                    edge_type,
                    target_entity,
                )

        logger.info(
            "KG built from ontology: %d nodes, %d edges",
            self._g.number_of_nodes(),
            self._g.number_of_edges(),
        )

    def build_from_schema(self, mgr) -> None:
        """Build a lightweight schema graph from the DuckDB unified snapshot.

        Creates one representative node per table and detects potential FK
        relationships via column name heuristics (_id / _ref / _fk suffixes and
        their camelCase equivalents).  No rows are loaded — purely structural,
        making it safe and fast for any schema size.

        Suitable as a zero-config fallback when no ontology YAML is present.
        """
        logger.info("Building knowledge graph from schema…")

        try:
            schema = mgr.get_schema_info()
        except Exception as exc:
            logger.warning("build_from_schema: schema discovery failed: %s", exc)
            return

        table_names = set(schema.keys())

        # Phase 1 — one schema-level node per table
        for table, info in schema.items():
            cols = [c.get("name", "") for c in info.get("columns", [])]
            node_id = f"{table}:__schema__"
            self._add_node(
                node_id,
                entity_type=table,
                canonical_id="__schema__",
                data={
                    "table": table,
                    "columns": cols,
                    "row_count": info.get("row_count", 0),
                },
                provenance=[{"source": "schema", "original_id": table, "table": table}],
            )

        # Phase 2 — FK-heuristic edges (by column-name suffix → table-name match)
        _FK_SUFFIXES = ("_id", "_ref", "_fk", "Id", "Ref", "FK")
        resolved: set[tuple[str, str]] = set()  # (table, col) already linked by name

        for table, info in schema.items():
            from_node = f"{table}:__schema__"
            for col in info.get("columns", []):
                col_name: str = col.get("name", "")
                for suffix in _FK_SUFFIXES:
                    if not col_name.endswith(suffix) or col_name == suffix:
                        continue
                    prefix = col_name[: -len(suffix)]
                    candidates = [
                        prefix,
                        prefix + "s",
                        prefix + "es",
                        prefix.rstrip("_"),
                        prefix.rstrip("_") + "s",
                        prefix.lower(),
                        prefix.lower() + "s",
                    ]
                    for candidate in candidates:
                        if candidate in table_names and candidate != table:
                            to_node = f"{candidate}:__schema__"
                            self._add_edge(from_node, to_node, f"FK_{col_name}")
                            resolved.add((table, col_name))
                            logger.debug(
                                "build_from_schema: %s.%s → %s",
                                table,
                                col_name,
                                candidate,
                            )
                            break
                    break  # first matching suffix wins per column

        # Phase 3 — value-overlap FK detection (names that don't match table
        # names, and cross-source joins). Gated + bounded; degrades on error.
        if os.getenv("FRA_KG_FK_VALUE_SCAN", "true").strip().lower() in {
            "1",
            "true",
            "yes",
        }:
            try:
                self._value_overlap_fk(mgr, schema, resolved)
            except Exception as exc:  # noqa: BLE001 — never break the build
                logger.warning(
                    "build_from_schema value-overlap FK scan skipped: %s", exc
                )

        logger.info(
            "KG built from schema: %d nodes, %d edges",
            self._g.number_of_nodes(),
            self._g.number_of_edges(),
        )

    def _value_overlap_fk(self, mgr, schema: dict, resolved: set) -> None:
        """Detect FKs by sampled value overlap: a candidate column whose values
        substantially fall within another table's primary-key values is a FK,
        even when its name doesn't match the table (incl. cross-source). Bounded
        by sample size and a probe cap; all queries are read-only with LIMIT."""

        def _norm(v) -> str | None:
            return None if v is None else str(v)

        # Primary-key candidate columns per table.
        pk_candidates: dict[str, list[str]] = {}
        for t, info in schema.items():
            names = [c.get("name", "") for c in info.get("columns", [])]
            tl = t.lower()
            pk_candidates[t] = [
                n for n in names if n.lower() in ("id", "pk", f"{tl}_id", f"{tl}id")
            ]

        val_cache: dict[tuple[str, str], set] = {}

        def _sample(table: str, col: str) -> set:
            key = (table, col)
            if key in val_cache:
                return val_cache[key]
            vals: set = set()
            try:
                rows = mgr.execute(
                    f'SELECT DISTINCT "{col}" AS v FROM "{table}" '
                    f'WHERE "{col}" IS NOT NULL LIMIT {_FK_VALUE_SAMPLE}'
                )
                vals = {_norm(r.get("v")) for r in rows}
                vals.discard(None)
            except Exception:  # noqa: BLE001
                vals = set()
            val_cache[key] = vals
            return vals

        probes = 0
        for table, info in schema.items():
            from_node = f"{table}:__schema__"
            for col in info.get("columns", []):
                name = col.get("name", "")
                ln = name.lower()
                if (table, name) in resolved:
                    continue
                if not any(k in ln for k in ("id", "ref", "key")):
                    continue
                if probes >= _FK_MAX_PROBES:
                    return
                fk_vals = _sample(table, name)
                probes += 1
                if not fk_vals:
                    continue
                target = None
                for other, _oinfo in schema.items():
                    if other == table:
                        continue
                    for pkcol in pk_candidates.get(other, []):
                        pk_vals = _sample(other, pkcol)
                        if not pk_vals:
                            continue
                        inter = len(fk_vals & pk_vals)
                        if inter and inter / len(fk_vals) >= _FK_VALUE_OVERLAP:
                            target = other
                            break
                    if target:
                        break
                if target:
                    self._add_edge(from_node, f"{target}:__schema__", f"FK_{name}")
                    logger.debug("value-overlap FK: %s.%s → %s", table, name, target)

    def _table_node(self, table: str) -> str:
        """Return a table-level node id for *table*, creating a minimal schema
        node if none exists. Reuses the ``{table}:__schema__`` node from
        build_from_schema when present so manual edges attach to the same node."""
        schema_id = f"{table}:__schema__"
        if schema_id not in self._g:
            self._add_node(
                schema_id,
                entity_type=table,
                canonical_id="__schema__",
                data={"table": table, "columns": [], "row_count": 0},
                provenance=[
                    {"source": "manual_relation", "original_id": table, "table": table}
                ],
            )
        return schema_id

    def ingest_manual_relations(self, relations: list[dict]) -> int:
        """Add user-defined / auto-applied relations as graph edges.

        Relations created by the auto-build proposal or by conversational
        integration live in the MetadataCatalog; ingesting them here makes the
        Knowledge Graph reflect the integrated, context-informed model rather
        than only FK-inferred structure. Edges are tagged ``manual=True``.
        Returns the number of edges added.
        """
        if not relations:
            return 0
        added = 0
        seen: set[tuple[str, str, str]] = set()
        for rel in relations:
            ft = str(rel.get("from_table", "")).strip()
            tt = str(rel.get("to_table", "")).strip()
            edge_type = str(rel.get("edge_type") or "FK").strip() or "FK"
            if not ft or not tt or ft == tt:
                continue
            src = self._table_node(ft)
            dst = self._table_node(tt)
            key = (src, dst, edge_type)
            if key in seen:
                continue
            seen.add(key)
            self._add_edge(src, dst, edge_type, manual=True)
            added += 1
        if added:
            logger.info("KG ingested %d manual relation(s)", added)
        return added

    def ingest_context_entities(self, entities: list[dict]) -> int:
        """Add document-derived business concepts as graph nodes.

        Entities extracted from uploaded context documents (see
        ``context/doc_analyzer``) become ``Concept:{name}`` nodes tagged
        ``source="document"`` and, when their name/synonyms match a data-backed
        table or entity, a ``DESCRIBES`` edge grounds the concept to that node.
        This folds business vocabulary from the context into the graph alongside
        the data structure. Returns the number of concept nodes added.
        """
        if not entities:
            return 0

        # Index data-backed nodes by table name and entity type, preferring
        # schema-level (table) nodes over per-row nodes.
        label_to_node: dict[str, str] = {}
        for nid, attrs in self._g.nodes(data=True):
            is_schema = attrs.get("canonical_id") == "__schema__"
            for key in (
                str(attrs.get("table") or "").lower(),
                str(attrs.get("entity_type") or "").lower(),
            ):
                if key and (key not in label_to_node or is_schema):
                    label_to_node[key] = nid

        def _match(label: str) -> str | None:
            lbl = label.lower()
            return (
                label_to_node.get(lbl)
                or label_to_node.get(lbl.rstrip("s"))
                or label_to_node.get(lbl + "s")
            )

        added = 0
        for e in entities:
            name = str(e.get("name", "")).strip()
            if not name:
                continue
            synonyms = [
                str(s).strip() for s in (e.get("synonyms") or []) if str(s).strip()
            ]
            cnode = f"Concept:{name}"
            if cnode not in self._g:
                self._add_node(
                    cnode,
                    entity_type="Concept",
                    canonical_id=name,
                    data={
                        "label": name,
                        "source": "document",
                        "synonyms": synonyms,
                    },
                    provenance=[{"source": "document", "original_id": name}],
                )
                added += 1
            # Ground the concept to the data node it describes, if any.
            for label in [name, *synonyms]:
                target = _match(label)
                if target and target != cnode:
                    self._add_edge(cnode, target, "DESCRIBES", source="document")
                    break
        if added:
            logger.info("KG ingested %d context concept(s)", added)
        return added

    def ingest_context_metrics(self, metrics: list[dict]) -> int:
        """Add document-derived business metrics as graph nodes.

        Metrics extracted from context documents become ``Metric:{name}`` nodes
        tagged ``source="document"``. When a word of the metric name matches a
        data table, entity or already-ingested concept, a ``MEASURES`` edge
        grounds the metric to what it quantifies. Returns the number of metric
        nodes added.
        """
        if not metrics:
            return 0

        # Index data/concept nodes by table, entity type, and canonical label.
        label_to_node: dict[str, str] = {}
        for nid, attrs in self._g.nodes(data=True):
            is_schema = attrs.get("canonical_id") == "__schema__"
            for key in (
                str(attrs.get("table") or "").lower(),
                str(attrs.get("entity_type") or "").lower(),
                str(attrs.get("canonical_id") or "").lower(),
                str(attrs.get("label") or "").lower(),
            ):
                if key and key not in {"__schema__", "concept", "metric"}:
                    if key not in label_to_node or is_schema:
                        label_to_node[key] = nid

        def _match(word: str) -> str | None:
            w = word.lower()
            return (
                label_to_node.get(w)
                or label_to_node.get(w.rstrip("s"))
                or label_to_node.get(w + "s")
            )

        added = 0
        for m in metrics:
            name = str(m.get("name", "")).strip()
            if not name:
                continue
            mnode = f"Metric:{name}"
            if mnode not in self._g:
                self._add_node(
                    mnode,
                    entity_type="Metric",
                    canonical_id=name,
                    data={
                        "label": name,
                        "source": "document",
                        "unit": str(m.get("unit", "")),
                    },
                    provenance=[{"source": "document", "original_id": name}],
                )
                added += 1
            # Ground the metric to what it measures (first word match wins).
            for word in name.replace("_", " ").split():
                target = _match(word)
                if target and target != mnode:
                    self._add_edge(mnode, target, "MEASURES", source="document")
                    break
        if added:
            logger.info("KG ingested %d context metric(s)", added)
        return added

    def _type_level_label_index(self) -> dict[str, str]:
        """Map label/entity_type/canonical_id (lowercased) → node id for the
        type-level nodes (tables, Concept, Metric). Schema/table nodes win ties."""
        index: dict[str, str] = {}
        for nid, attrs in self._g.nodes(data=True):
            is_table = attrs.get("canonical_id") == "__schema__"
            et = str(attrs.get("entity_type") or "")
            if not (is_table or et in ("Concept", "Metric")):
                continue
            for key in (
                str(attrs.get("table") or "").lower(),
                et.lower(),
                str(attrs.get("canonical_id") or "").lower(),
                str(attrs.get("label") or "").lower(),
            ):
                if key and key not in {"__schema__", "concept", "metric"}:
                    if key not in index or is_table:
                        index[key] = nid
        return index

    def attach_aliases(self, aliases: dict[str, list[str]]) -> int:
        """Append business aliases (synonyms) onto matching type-level nodes.

        *aliases* maps a label (table/entity/concept/metric name) → alias terms.
        graph_rag already indexes node ``synonyms`` for linking, so attaching
        aliases here makes business terminology (glossary, proposed synonyms)
        link to the right node. Unknown labels are ignored. Returns the number
        of alias terms added.
        """
        if not aliases:
            return 0
        index = self._type_level_label_index()

        def _resolve(label: str) -> str | None:
            key = label.strip().lower()
            return index.get(key) or index.get(key.rstrip("s")) or index.get(key + "s")

        added = 0
        for label, terms in aliases.items():
            nid = _resolve(str(label))
            if nid is None:
                continue
            current = list(self._g.nodes[nid].get("synonyms") or [])
            seen = {s.lower() for s in current}
            for term in terms:
                t = str(term).strip()
                if t and t.lower() not in seen:
                    current.append(t)
                    seen.add(t.lower())
                    added += 1
            self._g.nodes[nid]["synonyms"] = current
        if added:
            logger.info("KG attached %d alias term(s)", added)
        return added

    def ingest_glossary_aliases(self, glossary: list[dict]) -> int:
        """Attach glossary terms as aliases of the node their definition refers to.

        Conservative: a term becomes an alias of a node only when that node's
        label appears in the term's *definition* (so "ARR" defined as "annual
        recurring revenue" aliases the Revenue node). Terms that already name a
        node, or whose definition references nothing known, are skipped — no
        spurious aliases. Returns the number of alias terms attached.
        """
        if not glossary:
            return 0
        index = self._type_level_label_index()
        label_set = set(index.keys())
        aliases: dict[str, list[str]] = {}
        for g in glossary:
            term = str(g.get("term", "")).strip()
            definition = str(g.get("definition", "")).strip().lower()
            if not term or not definition:
                continue
            tl = term.lower()
            # Term already names a node → it links directly, no alias needed.
            if tl in label_set or tl.rstrip("s") in label_set or tl + "s" in label_set:
                continue
            def_words = set(re.findall(r"[a-z0-9_]+", definition))
            matched: str | None = None
            for lbl in label_set:
                hit = (
                    (lbl in def_words or lbl.rstrip("s") in def_words)
                    if " " not in lbl
                    else lbl in definition
                )
                if hit:
                    matched = lbl
                    break
            if matched:
                aliases.setdefault(matched, []).append(term)
        return self.attach_aliases(aliases)

    @property
    def node_count(self) -> int:
        return self._g.number_of_nodes()

    @property
    def edge_count(self) -> int:
        return self._g.number_of_edges()

    @property
    def dedup_count(self) -> int:
        return self._dedup_count

    def neighbors(self, node_id: str, edge_type: str | None = None) -> list[str]:
        """Return neighbour node IDs reachable from *node_id*.

        If *edge_type* is given, only edges with that type label are traversed.
        """
        if node_id not in self._g:
            return []
        result: list[str] = []
        for _, dst, data in self._g.out_edges(node_id, data=True):
            if edge_type is None or data.get("type") == edge_type:
                result.append(dst)
        return result

    def path(self, src: str, dst: str, max_hops: int = 3) -> list[str]:
        """Return the shortest path between *src* and *dst* (up to *max_hops* edges).

        Uses the undirected view of the graph so that edges can be traversed
        in both directions.
        """
        try:
            undirected = self._g.to_undirected()
            paths = nx.shortest_path(undirected, source=src, target=dst)
            if len(paths) - 1 > max_hops:
                return []
            return paths
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return []

    def subgraph(self, entity_type: str) -> nx.MultiDiGraph:
        """Return the induced subgraph for nodes of *entity_type*."""
        nodes = [
            n
            for n, data in self._g.nodes(data=True)
            if data.get("entity_type") == entity_type
        ]
        return self._g.subgraph(nodes).copy()

    def count_nodes_of_type(self, entity_type: str) -> int:
        """Count nodes of an entity type without copying an induced subgraph.

        subgraph(t).number_of_nodes() builds a full copy just to count; this
        streams the node view instead — O(1) memory.
        """
        return sum(
            1
            for _, data in self._g.nodes(data=True)
            if data.get("entity_type") == entity_type
        )

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        if node_id in self._g:
            return dict(self._g.nodes[node_id])
        return None

    def node_id_for(self, entity_type: str, canonical_id: Any) -> str | None:
        return self._entity_index.get((entity_type, canonical_id))

    def all_nodes(self) -> list[tuple[str, dict]]:
        return list(self._g.nodes(data=True))

    def all_edges(self) -> list[tuple[str, str, dict]]:
        return list(self._g.edges(data=True))

    def iter_edges(self) -> "Iterator[tuple[str, str, dict]]":
        """Stream (src, dst, data) edge tuples without building a full list.

        Use this instead of all_edges() when you only need to scan edges once
        (e.g. deriving distinct schema-level relations), to avoid copying the
        entire edge set into a Python list.
        """
        return iter(self._g.edges(data=True))

    # ── private: node helpers ─────────────────────────────────────────────────

    def _add_node(
        self,
        node_id: str,
        entity_type: str,
        canonical_id: Any,
        data: dict,
        provenance: list[dict],
    ) -> None:
        self._g.add_node(
            node_id,
            entity_type=entity_type,
            canonical_id=canonical_id,
            provenance=provenance,
            **data,
        )
        self._entity_index[(entity_type, canonical_id)] = node_id

    def _add_edge(self, src: str, dst: str, edge_type: str, **attrs) -> None:
        if src in self._g and dst in self._g:
            self._g.add_edge(src, dst, type=edge_type, **attrs)
        else:
            logger.debug(
                "Skipping edge %s -[%s]-> %s (node(s) missing)", src, edge_type, dst
            )

    # ── private: loaders ──────────────────────────────────────────────────────

    def _load_territories(self, erp) -> None:
        for row in erp.load_entity("Territory"):
            tid = row["territory_id"]
            node_id = f"Territory:{tid}"
            self._add_node(
                node_id,
                entity_type="Territory",
                canonical_id=tid,
                data={k: v for k, v in row.items()},
                provenance=[
                    {"source": "erp", "original_id": tid, "table": "territory"}
                ],
            )

    def _load_offers(self, erp) -> None:
        for row in erp.load_entity("Offer"):
            oid = row["offer_id"]
            node_id = f"Offer:{oid}"
            self._add_node(
                node_id,
                entity_type="Offer",
                canonical_id=oid,
                data={k: v for k, v in row.items()},
                provenance=[{"source": "erp", "original_id": oid, "table": "offer"}],
            )

    def _load_crm_customers(self, crm) -> None:
        """Load CRM accounts, merge duplicates (accountId < 0) by email."""
        rows = list(crm.load_entity("Customer"))

        # Build positive-account index keyed by normalised email
        pos_by_email: dict[str, dict] = {}
        for row in rows:
            if row["accountId"] > 0:
                em = _norm_email(row.get("emailContatto"))
                if em:
                    pos_by_email[em] = row

        for row in rows:
            aid = row["accountId"]
            if aid < 0:
                # Duplicate: find canonical via email
                em = _norm_email(row.get("emailContatto"))
                canonical = pos_by_email.get(em) if em is not None else None
                if canonical:
                    self._dup_map[aid] = canonical["accountId"]
                    self._dedup_count += 1
                else:
                    # No match found — skip (treat as orphan duplicate)
                    logger.debug(
                        "Orphan duplicate accountId=%d, no canonical found", aid
                    )
                continue

            display_name = row.get("ragioneSociale") or row.get("nomeContatto")
            node_id = f"Customer:{aid}"
            self._add_node(
                node_id,
                entity_type="Customer",
                canonical_id=aid,
                data={
                    "account_type": row.get("accountType"),
                    "display_name": display_name,
                    "email": row.get("emailContatto"),
                    "phone": row.get("telefonoContatto"),
                    "territory_hint": row.get("territoryHint"),
                    "is_active": bool(row.get("isActive")),
                    "ragioneSociale": row.get("ragioneSociale"),
                    "nomeContatto": row.get("nomeContatto"),
                    "personRef": row.get("personRef"),
                    "storeRef": row.get("storeRef"),
                    "createdAt": row.get("createdAt"),
                },
                provenance=[{"source": "crm", "original_id": aid, "table": "account"}],
            )

    def _load_hr_employees(self, hr_pim) -> None:
        for row in hr_pim.load_entity("Employee"):
            try:
                eid = int(row["MatricolaDip"])
            except (KeyError, ValueError, TypeError):
                continue
            node_id = f"Employee:{eid}"
            self._add_node(
                node_id,
                entity_type="Employee",
                canonical_id=eid,
                data={
                    "first_name": row.get("Nome"),
                    "last_name": row.get("Cognome"),
                    "full_name": f"{row.get('Nome', '')} {row.get('Cognome', '')}".strip(),
                    "job_title": row.get("Mansione"),
                    "department": row.get("Reparto"),
                    "department_group": row.get("GruppoReparto"),
                    "hire_date": row.get("DataAssunzione"),
                    "birth_date": row.get("DataNascita"),
                    "gender": row.get("Genere"),
                    "marital_status": row.get("StatoCivile"),
                    "vacation_hours": _safe_float(row.get("OreFerieResidue")),
                    "sick_hours": _safe_float(row.get("OreMalattiaResidue")),
                    "hourly_rate": _safe_float(row.get("RetribuzioneOraria")),
                    "pay_frequency": _safe_int(row.get("FrequenzaPaga")),
                },
                provenance=[
                    {"source": "hr_pim", "original_id": eid, "table": "dipendenti_hr"}
                ],
            )

    def _load_pim_products(self, hr_pim) -> None:
        for row in hr_pim.load_entity("Product"):
            pid = row.get("internal_id")
            if pid is None:
                continue
            node_id = f"Product:{pid}"
            self._add_node(
                node_id,
                entity_type="Product",
                canonical_id=pid,
                data={
                    "sku": row.get("sku"),
                    "display_name": row.get("displayName"),
                    "category_path": row.get("categoryPath"),
                    "model_name": row.get("modelName"),
                    "color": row.get("color"),
                    "size": row.get("size"),
                    "weight": _safe_float(row.get("weight")),
                    "weight_unit": row.get("weightUnit"),
                    "standard_cost": _safe_float(row.get("standardCost")),
                    "list_price": _safe_float(row.get("listPrice")),
                    "is_make_only": row.get("isMakeOnly"),
                    "is_purchasable": row.get("isPurchasable"),
                    "sell_start_date": row.get("sellStartDate"),
                    "sell_end_date": row.get("sellEndDate"),
                },
                provenance=[
                    {
                        "source": "hr_pim",
                        "original_id": pid,
                        "table": "product_catalog_pim",
                    }
                ],
            )

    def _load_erp_salespersons(self, erp) -> None:
        """Promote Employee nodes to Salesperson or create new Salesperson nodes."""
        for row in erp.load_entity("Salesperson"):
            sid = row["salesperson_id"]
            node_id = f"Employee:{sid}"

            # Promote existing employee node to Salesperson
            if node_id in self._g:
                existing = dict(self._g.nodes[node_id])
                existing["entity_type"] = "Salesperson"
                existing["territory_ref"] = row.get("territory_ref")
                existing["sales_quota"] = _safe_float(row.get("sales_quota"))
                existing["bonus"] = _safe_float(row.get("bonus"))
                existing["commission_pct"] = _safe_float(row.get("commission_pct"))
                existing["sales_ytd"] = _safe_float(row.get("sales_ytd"))
                existing["sales_last_year"] = _safe_float(row.get("sales_last_year"))
                provenance = existing.get("provenance", [])
                provenance.append(
                    {"source": "erp", "original_id": sid, "table": "salesperson"}
                )
                existing["provenance"] = provenance
                nx.set_node_attributes(self._g, {node_id: existing})
                self._entity_index[("Salesperson", sid)] = node_id
            else:
                # No HR record found — create a minimal Salesperson node
                self._add_node(
                    node_id,
                    entity_type="Salesperson",
                    canonical_id=sid,
                    data={
                        "territory_ref": row.get("territory_ref"),
                        "sales_quota": _safe_float(row.get("sales_quota")),
                        "bonus": _safe_float(row.get("bonus")),
                        "commission_pct": _safe_float(row.get("commission_pct")),
                        "sales_ytd": _safe_float(row.get("sales_ytd")),
                        "sales_last_year": _safe_float(row.get("sales_last_year")),
                    },
                    provenance=[
                        {"source": "erp", "original_id": sid, "table": "salesperson"}
                    ],
                )

            # WORKS_IN edge to Territory
            t_ref = row.get("territory_ref")
            if t_ref is not None:
                t_node = f"Territory:{t_ref}"
                self._add_edge(node_id, t_node, "WORKS_IN")

    def _load_sales_orders(self, erp) -> None:
        for row in erp.load_entity("SalesOrder"):
            oid = row["order_id"]
            node_id = f"SalesOrder:{oid}"
            self._add_node(
                node_id,
                entity_type="SalesOrder",
                canonical_id=oid,
                data={k: v for k, v in row.items()},
                provenance=[
                    {"source": "erp", "original_id": oid, "table": "sales_order_header"}
                ],
            )

            # PLACED_BY → Customer
            cref = row.get("customer_ref")
            if cref is not None:
                canonical_cref = self._dup_map.get(cref, cref)
                c_node = f"Customer:{canonical_cref}"
                self._add_edge(node_id, c_node, "PLACED_BY")

            # SOLD_BY → Employee/Salesperson
            sref = row.get("salesperson_ref")
            if sref is not None:
                sp_node = f"Employee:{sref}"
                self._add_edge(node_id, sp_node, "SOLD_BY")

            # IN_TERRITORY
            tref = row.get("territory_ref")
            if tref is not None:
                t_node = f"Territory:{tref}"
                self._add_edge(node_id, t_node, "IN_TERRITORY")

    def _load_sales_order_lines(self, erp) -> None:
        for row in erp.load_entity("SalesOrderLine"):
            oid = row["order_id"]
            lid = row["line_id"]
            node_id = f"SalesOrderLine:{oid}:{lid}"
            self._add_node(
                node_id,
                entity_type="SalesOrderLine",
                canonical_id=(oid, lid),
                data={k: v for k, v in row.items()},
                provenance=[
                    {
                        "source": "erp",
                        "original_id": (oid, lid),
                        "table": "sales_order_line",
                    }
                ],
            )

            # CONTAINS_LINE: SalesOrder → SalesOrderLine
            so_node = f"SalesOrder:{oid}"
            self._add_edge(so_node, node_id, "CONTAINS_LINE")

            # OF_PRODUCT: SalesOrderLine → Product
            pref = row.get("product_ref")
            if pref is not None:
                p_node = f"Product:{pref}"
                self._add_edge(node_id, p_node, "OF_PRODUCT")

            # Link to Offer
            oref = row.get("offer_ref")
            if oref and oref != 1:  # offer_id=1 means no special offer
                o_node = f"Offer:{oref}"
                self._add_edge(node_id, o_node, "HAS_OFFER")

    def _load_crm_addresses(self, crm) -> None:
        # Load address nodes
        for row in crm.load_entity("Address"):
            aid = row["addressId"]
            node_id = f"Address:{aid}"
            self._add_node(
                node_id,
                entity_type="Address",
                canonical_id=aid,
                data={k: v for k, v in row.items()},
                provenance=[{"source": "crm", "original_id": aid, "table": "address"}],
            )

        # account_address join table → LOCATED_AT edges
        aa_rows = crm.execute_query("SELECT * FROM account_address")
        for row in aa_rows:
            acc_ref = row.get("accountRef")
            addr_ref = row.get("addressRef")
            if acc_ref is None or addr_ref is None:
                continue
            canonical_acc = self._dup_map.get(acc_ref, acc_ref)
            c_node = f"Customer:{canonical_acc}"
            a_node = f"Address:{addr_ref}"
            self._add_edge(c_node, a_node, "LOCATED_AT")


# ── utilities ─────────────────────────────────────────────────────────────────


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f  # NaN check
    except (ValueError, TypeError):
        return None


def _safe_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None
