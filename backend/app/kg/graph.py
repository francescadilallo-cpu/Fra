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
import re
from typing import Any

import networkx as nx

logger = logging.getLogger(__name__)


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
        # entity_name → primary-key column name in DuckDB
        entity_pk_map: dict[str, str] = {}

        # ── Phase 1: load nodes ───────────────────────────────────────────────
        for entity_name, entity_cfg in entities_cfg.items():
            if not isinstance(entity_cfg, dict):
                continue
            sources = entity_cfg.get("sources") or []
            if not sources:
                continue

            primary_src = sources[0]
            raw_table = primary_src.get("table", "")
            key_field = primary_src.get("key_field", "id")
            table = _normalize_table_name(raw_table)

            if table not in available_tables:
                logger.debug(
                    "build_from_ontology: entity '%s' — table '%s' not in DuckDB, skipping",
                    entity_name,
                    table,
                )
                continue

            entity_table_map[entity_name] = table
            entity_pk_map[entity_name] = key_field

            safe = table.replace('"', '""')
            try:
                rows = mgr.execute_all(f'SELECT * FROM "{safe}"')
            except Exception as exc:
                logger.warning(
                    "build_from_ontology: load failed for entity '%s' (table '%s'): %s",
                    entity_name,
                    table,
                    exc,
                )
                continue

            source_id = primary_src.get("source", "unknown")
            loaded = 0
            for row in rows:
                pk_val = row.get(key_field)
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
                safe_pk = from_pk.replace('"', '""')
                safe_col = from_col.replace('"', '""')
                _EDGE_LIMIT = 100_000
                try:
                    edge_rows = mgr.execute(
                        f'SELECT "{safe_pk}", "{safe_col}" '
                        f'FROM "{safe_from}" '
                        f'WHERE "{safe_col}" IS NOT NULL '
                        f"LIMIT {_EDGE_LIMIT}"
                    )
                except Exception as exc:
                    logger.warning(
                        "build_from_ontology: edge query failed %s.%s: %s",
                        entity_name,
                        attr_name,
                        exc,
                    )
                    continue

                edges_added = 0
                for row in edge_rows:
                    from_id = row.get(from_pk)
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

                if edges_added >= _EDGE_LIMIT:
                    logger.warning(
                        "build_from_ontology: edge query for %s.%s hit the %d-row "
                        "cap — the knowledge graph may be incomplete. "
                        "Raise _EDGE_LIMIT or add pagination to load all edges.",
                        entity_name,
                        attr_name,
                        _EDGE_LIMIT,
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
                canonical = pos_by_email.get(em)
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
