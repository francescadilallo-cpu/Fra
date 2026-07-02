"""Unit tests for Salesforce record ingestion + metadata-declared relations.

Covers the pure pieces (no network): SOQL record fetching against a faked
transport, ingestable-field selection, the metadata→relations derivation that
feeds the KG, the record-table naming rule, and the manager's lazy
``metadata_relations`` property.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.connectors.duckdb_source_manager import DuckDBSourceManager
from app.connectors.salesforce_connector import (
    SalesforceConnector,
    ingestable_field_names,
    salesforce_metadata_relations,
    sf_record_row_limit,
)
from app.connectors.source_registry import SourceConfig


def _schema_dict() -> dict:
    """Cached-schema-JSON shape (asdict of SalesforceSchema)."""
    return {
        "objects": [
            {
                "name": "Account",
                "fields": [
                    {"name": "Id", "type": "id", "is_relation": False},
                    {"name": "Name", "type": "string", "is_relation": False},
                ],
            },
            {
                "name": "Opportunity",
                "fields": [
                    {"name": "Id", "type": "id", "is_relation": False},
                    {"name": "Amount", "type": "currency", "is_relation": False},
                    {
                        "name": "AccountId",
                        "type": "reference",
                        "is_relation": True,
                        "relation_to": "Account",
                    },
                ],
            },
            {
                "name": "Task",
                "fields": [
                    {
                        "name": "WhoId",
                        "type": "reference",
                        "is_relation": True,
                        "relation_to": "Contact, Lead",
                    },
                ],
            },
        ]
    }


class TestMetadataRelations:
    def test_declared_fk_between_ingested_tables(self):
        rels = salesforce_metadata_relations(
            _schema_dict(),
            {"Account": "sf_account", "Opportunity": "sf_opportunity"},
        )
        assert {
            "from_table": "sf_opportunity",
            "to_table": "sf_account",
            "via_column": "AccountId",
            "edge_type": "FK_AccountId",
        } in rels

    def test_non_ingested_targets_skipped(self):
        # Task ingested but neither Contact nor Lead → no relation emitted.
        rels = salesforce_metadata_relations(_schema_dict(), {"Task": "sf_task"})
        assert rels == []

    def test_polymorphic_lookup_yields_one_edge_per_ingested_target(self):
        rels = salesforce_metadata_relations(
            _schema_dict(), {"Task": "sf_task", "Contact": "sf_contact"}
        )
        assert rels == [
            {
                "from_table": "sf_task",
                "to_table": "sf_contact",
                "via_column": "WhoId",
                "edge_type": "FK_WhoId",
            }
        ]


class TestIngestableFields:
    def test_scalars_kept_compound_skipped(self):
        fields = [
            {"name": "Id", "type": "id"},
            {"name": "Name", "type": "string"},
            {"name": "BillingAddress", "type": "address"},  # compound → skipped
            {"name": "Photo", "type": "base64"},  # binary → skipped
        ]
        assert ingestable_field_names(fields) == ["Id", "Name"]


class TestRowLimit:
    def test_default_and_env(self, monkeypatch):
        monkeypatch.delenv("FRA_SF_ROW_LIMIT", raising=False)
        assert sf_record_row_limit() == 2000
        monkeypatch.setenv("FRA_SF_ROW_LIMIT", "500")
        assert sf_record_row_limit() == 500
        monkeypatch.setenv("FRA_SF_ROW_LIMIT", "0")
        assert sf_record_row_limit() == 0  # unlimited
        monkeypatch.setenv("FRA_SF_ROW_LIMIT", "garbage")
        assert sf_record_row_limit() == 2000


class TestFetchRecords:
    def _connector_with_pages(self, pages: list[dict]) -> SalesforceConnector:
        sf = SalesforceConnector.__new__(SalesforceConnector)
        sf.instance_url = "https://example.my.salesforce.com"
        calls: list[str] = []

        def fake_get(path: str):
            calls.append(path)
            return pages[len(calls) - 1]

        sf._get = fake_get  # type: ignore[method-assign]
        sf._calls = calls  # type: ignore[attr-defined]
        return sf

    def test_strips_attributes_and_paginates(self):
        pages = [
            {
                "records": [
                    {"attributes": {"type": "Account"}, "Id": "1", "Name": "A"},
                ],
                "nextRecordsUrl": "/services/data/v59.0/query/01g-next",
            },
            {"records": [{"attributes": {"type": "Account"}, "Id": "2", "Name": "B"}]},
        ]
        sf = self._connector_with_pages(pages)
        records = sf.fetch_records("Account", ["Id", "Name"], limit=0)
        assert records == [{"Id": "1", "Name": "A"}, {"Id": "2", "Name": "B"}]
        assert len(sf._calls) == 2  # followed pagination

    def test_limit_stops_pagination(self):
        pages = [
            {
                "records": [{"Id": "1"}, {"Id": "2"}],
                "nextRecordsUrl": "/services/data/v59.0/query/01g-next",
            },
        ]
        sf = self._connector_with_pages(pages)
        records = sf.fetch_records("Account", ["Id"], limit=2)
        assert [r["Id"] for r in records] == ["1", "2"]
        assert len(sf._calls) == 1  # limit reached — no second page fetched

    def test_no_fields_no_query(self):
        sf = self._connector_with_pages([])
        assert sf.fetch_records("Account", [], limit=10) == []


class TestRecordTableName:
    def _mgr_with_counts(self, counts: dict) -> DuckDBSourceManager:
        mgr = DuckDBSourceManager.__new__(DuckDBSourceManager)
        mgr._row_counts = counts
        return mgr

    def _cfg(self, sid: str) -> SourceConfig:
        return SourceConfig(id=sid, connector_type="salesforce", label="SF")

    def test_clean_name_when_free(self):
        mgr = self._mgr_with_counts({})
        assert mgr._sf_record_table_name(self._cfg("abc-123"), "Account") == (
            "sf_account"
        )

    def test_own_reingest_keeps_clean_name(self):
        mgr = self._mgr_with_counts({"abc-123.sf_account": 10})
        assert mgr._sf_record_table_name(self._cfg("abc-123"), "Account") == (
            "sf_account"
        )

    def test_collision_with_other_source_prefixes(self):
        mgr = self._mgr_with_counts({"other-src.sf_account": 10})
        name = mgr._sf_record_table_name(self._cfg("abc-123-def"), "Account")
        assert name == "sf_abc_123_" + "account"


class TestManagerMetadataRelations:
    def test_lazy_property_maps_objects_to_existing_tables(self, monkeypatch):
        import app.connectors.duckdb_source_manager as dsm

        mgr = DuckDBSourceManager.__new__(DuckDBSourceManager)
        cfg = SourceConfig(id="src-1", connector_type="salesforce", label="SF")

        class _Reg:
            def list(self):
                return [cfg]

        mgr._registry = _Reg()
        mgr.get_schema_info = lambda: {  # type: ignore[method-assign]
            "sf_account": {},
            "sf_opportunity": {},
        }
        monkeypatch.setattr(
            "app.connectors.salesforce_connector.load_salesforce_schema",
            lambda sid: _schema_dict(),
        )
        assert dsm is not None  # keep import referenced
        rels = mgr.metadata_relations
        assert any(
            r["from_table"] == "sf_opportunity" and r["to_table"] == "sf_account"
            for r in rels
        )

    def test_non_salesforce_sources_ignored(self, monkeypatch):
        mgr = DuckDBSourceManager.__new__(DuckDBSourceManager)
        cfg = SourceConfig(id="src-1", connector_type="csv", label="CSV")

        class _Reg:
            def list(self):
                return [cfg]

        mgr._registry = _Reg()
        mgr.get_schema_info = lambda: {"orders": {}}  # type: ignore[method-assign]
        assert mgr.metadata_relations == []


class TestInternalMetadataTables:
    def test_property_lists_sf_catalog_tables(self):
        mgr = DuckDBSourceManager.__new__(DuckDBSourceManager)
        sf = SourceConfig(id="src-1", connector_type="salesforce", label="SF")
        csv = SourceConfig(id="src-2", connector_type="csv", label="CSV")

        class _Reg:
            def list(self):
                return [sf, csv]

        mgr._registry = _Reg()
        assert mgr.internal_metadata_tables == frozenset(
            {"sf_src_1_objects", "sf_src_1_fields"}
        )

    def test_build_from_schema_skips_internal_tables(self):
        from app.kg.graph import KnowledgeGraph

        class _Mgr:
            internal_metadata_tables = frozenset({"sf_src_1_objects"})

            def get_schema_info(self):
                return {
                    "sf_account": {"columns": [{"name": "Id", "type": "id"}]},
                    "sf_src_1_objects": {
                        "columns": [{"name": "object_name", "type": "str"}]
                    },
                }

            def execute(self, sql, *a, **kw):
                return []

        kg = KnowledgeGraph()
        kg.build_from_schema(_Mgr())
        tables = {a.get("table") for _n, a in kg.all_nodes()}
        assert "sf_account" in tables
        assert "sf_src_1_objects" not in tables


class TestSelectRecordObjects:
    _objs = [
        {"name": "Account", "is_custom": False},
        {"name": "EmailMessage", "is_custom": False},  # standard, non-priority
        {"name": "Progetto__c", "is_custom": True},
    ]

    def test_default_priority_plus_custom(self):
        from app.connectors.salesforce_connector import select_record_objects

        names = [o["name"] for o in select_record_objects(self._objs, None)]
        assert names == ["Account", "Progetto__c"]  # EmailMessage excluded

    def test_explicit_string_selection_wins(self):
        from app.connectors.salesforce_connector import select_record_objects

        names = [
            o["name"]
            for o in select_record_objects(self._objs, "EmailMessage, Progetto__c")
        ]
        assert names == ["EmailMessage", "Progetto__c"]

    def test_explicit_list_selection(self):
        from app.connectors.salesforce_connector import select_record_objects

        names = [o["name"] for o in select_record_objects(self._objs, ["Account"])]
        assert names == ["Account"]

    def test_blank_explicit_falls_back_to_default(self):
        from app.connectors.salesforce_connector import select_record_objects

        names = [o["name"] for o in select_record_objects(self._objs, "  ,  ")]
        assert names == ["Account", "Progetto__c"]


class TestMaxObjects:
    def test_default_and_env(self, monkeypatch):
        from app.connectors.salesforce_connector import sf_max_objects

        monkeypatch.delenv("FRA_SF_MAX_OBJECTS", raising=False)
        assert sf_max_objects() == 40
        monkeypatch.setenv("FRA_SF_MAX_OBJECTS", "10")
        assert sf_max_objects() == 10
        monkeypatch.setenv("FRA_SF_MAX_OBJECTS", "0")
        assert sf_max_objects() == 40  # invalid → fallback


class TestRelationDedupe:
    def test_declared_relation_upgrades_heuristic_edge(self):
        """A join found by value-overlap AND declared by metadata must yield ONE
        edge, upgraded to manual — not a parallel duplicate in the draft."""
        from app.kg.graph import KnowledgeGraph

        class _Mgr:
            def get_schema_info(self):
                return {
                    "sf_opportunity": {
                        "columns": [
                            {"name": "Id", "type": "id"},
                            {"name": "AccountId", "type": "reference"},
                        ]
                    },
                    "sf_account": {"columns": [{"name": "Id", "type": "id"}]},
                }

            def execute(self, sql, *a, **kw):
                if '"AccountId"' in sql:
                    return [{"v": v} for v in ("a1", "a2", "a3", "a4", "a5")]
                if '"Id"' in sql and "sf_account" in sql:
                    return [{"v": v} for v in ("a1", "a2", "a3", "a4", "a5", "a6")]
                return []

        kg = KnowledgeGraph()
        kg.build_from_schema(_Mgr())  # value-overlap finds FK_AccountId
        edges_before = kg.edge_count
        assert any(
            d.get("type") == "FK_AccountId" and not d.get("manual")
            for _s, _t, d in kg.iter_edges()
        )

        declared = [
            {
                "from_table": "sf_opportunity",
                "to_table": "sf_account",
                "via_column": "AccountId",
                "edge_type": "FK_AccountId",
            }
        ]
        kg.ingest_manual_relations(declared)
        assert kg.edge_count == edges_before  # upgraded in place, not duplicated
        assert any(
            d.get("type") == "FK_AccountId" and d.get("manual") is True
            for _s, _t, d in kg.iter_edges()
        )
        # Re-ingesting (e.g. catalog + metadata both carry it) still no growth.
        kg.ingest_manual_relations(declared)
        assert kg.edge_count == edges_before
