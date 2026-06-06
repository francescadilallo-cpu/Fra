"""Regression tests: the Knowledge Graph must not go stale after a source
sync / add / remove / full re-ingest.

`sync_source`, `add_source`, `remove_source`, and `rebuild_data_store` all
mutate the underlying DuckDB snapshot (new rows, new/removed tables, changed
schemas) and then call a refresh helper to bring derived state back in sync.
That helper used to repopulate only the *catalog*
(`catalog.populate_from_manager`), leaving the in-memory `KnowledgeGraph` —
and everything derived from it (the semantic draft's relations,
`/api/semantic/status`'s node/edge counts, the executive agentic layer's
graph patches) — frozen at whatever the snapshot looked like when the KG was
first built.

`_refresh_catalog_and_kg_after_rebuild` now rebuilds the KG too, into a fresh
instance (NOT by re-running the loaders on the existing graph — KnowledgeGraph
is backed by a `networkx.MultiDiGraph`, whose `add_edge()` always appends a
parallel edge, so looping the loaders in place would silently double every
edge on each successive sync).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import app.main as main_module
from app.kg.graph import KnowledgeGraph

_SCHEMA_V1 = {
    "customers": {
        "columns": [{"name": "id"}, {"name": "name"}],
        "row_count": 2,
    },
}

# v2 adds an "orders" table with a customer_id FK — the KG must pick up both
# the new node *and* the new FK-heuristic edge once refreshed.
_SCHEMA_V2 = {
    "customers": {
        "columns": [{"name": "id"}, {"name": "name"}],
        "row_count": 2,
    },
    "orders": {
        "columns": [{"name": "id"}, {"name": "customer_id"}],
        "row_count": 5,
    },
}


def _make_mgr(schema: dict) -> MagicMock:
    mgr = MagicMock()
    mgr.get_schema_info.return_value = schema
    return mgr


@pytest.fixture()
def semantic_state(monkeypatch):
    """Seed _semantic_state with a real KG (built from the v1 schema, like
    _ensure_semantic_loaded would) plus a stub catalog, and no ontology — so
    refreshes go through the build_from_schema() fallback path."""
    kg = KnowledgeGraph()
    kg.build_from_schema(_make_mgr(_SCHEMA_V1))
    assert kg.node_count == 1
    assert kg.edge_count == 0

    catalog = MagicMock()
    monkeypatch.setitem(main_module._semantic_state, "kg", kg)
    monkeypatch.setitem(main_module._semantic_state, "catalog", catalog)
    monkeypatch.setitem(main_module._semantic_state, "ontology", None)
    return catalog


class TestKgRefreshReflectsNewSnapshot:
    def test_stale_kg_is_replaced_with_one_reflecting_the_new_schema(
        self, semantic_state
    ):
        catalog = semantic_state
        old_kg = main_module._semantic_state["kg"]

        # Simulate what sync_source/add_source/rebuild_data_store do: the
        # snapshot now has a new "orders" table with a customer_id FK.
        main_module._refresh_catalog_and_kg_after_rebuild(_make_mgr(_SCHEMA_V2))

        new_kg = main_module._semantic_state["kg"]
        assert new_kg is not old_kg, (
            "KG must be replaced by a freshly-built instance, not left "
            "pointing at the stale pre-sync graph"
        )
        assert new_kg.node_count == 2, "new 'orders' table missing from KG"
        assert new_kg.edge_count == 1, "customer_id FK edge missing from KG"

        # The catalog refresh must still happen alongside the KG refresh.
        catalog.populate_from_manager.assert_called_once()

    def test_repeated_refreshes_do_not_inflate_edge_counts(self, semantic_state):
        """Guards against the MultiDiGraph parallel-edge trap: rebuilding in
        place (instead of into a fresh instance) would add duplicate edges on
        every successive sync."""
        mgr = _make_mgr(_SCHEMA_V2)

        main_module._refresh_catalog_and_kg_after_rebuild(mgr)
        first = main_module._semantic_state["kg"]
        assert first.node_count == 2
        assert first.edge_count == 1

        main_module._refresh_catalog_and_kg_after_rebuild(mgr)
        second = main_module._semantic_state["kg"]
        assert second is not first
        assert second.node_count == 2
        assert second.edge_count == 1, "edge count must not double on re-sync"

    def test_noop_when_semantic_layer_not_yet_loaded(self, monkeypatch):
        """Before _ensure_semantic_loaded() has ever run, kg/catalog are None
        — the refresh must be a quiet no-op, not raise."""
        monkeypatch.setitem(main_module._semantic_state, "kg", None)
        monkeypatch.setitem(main_module._semantic_state, "catalog", None)
        monkeypatch.setitem(main_module._semantic_state, "ontology", None)

        main_module._refresh_catalog_and_kg_after_rebuild(_make_mgr(_SCHEMA_V1))

        assert main_module._semantic_state["kg"] is None
        assert main_module._semantic_state["catalog"] is None

    def test_kg_refresh_failure_is_logged_not_raised(self, semantic_state, caplog):
        """A broken snapshot (e.g. mid-rebuild) must not crash the sync
        endpoint — the old KG stays in place and the failure is logged."""
        old_kg = main_module._semantic_state["kg"]
        mgr = MagicMock()
        mgr.get_schema_info.side_effect = RuntimeError("snapshot unavailable")

        main_module._refresh_catalog_and_kg_after_rebuild(mgr)

        assert main_module._semantic_state["kg"] is old_kg


class TestSemanticCacheIsInvalidatedAfterCatalogRefresh:
    """add_source / remove_source / sync_source / rebuild_data_store all funnel
    through _refresh_catalog_and_kg_after_rebuild(), which calls
    catalog.populate_from_manager() — live-mutating the very same
    MetadataCatalog instance layer.ask() consults on every question, both for
    entity/attribute/metric resolution (self._catalog.list_entities() /
    get_entity() / get_attribute() / list_metrics()) and for the LLM
    SQL-generation schema prompt (self._catalog.get_schema_context(), see
    layer.py:1311). Once a source is added, removed, or (re-)synced, the set
    of tables/columns the catalog reports has changed — yet the helper never
    bumped the semantic-ask cache namespace, so a pre-change cached answer
    kept being served (citing tables/columns that no longer exist, or omitting
    ones that just appeared) until it expired from the cache or got evicted."""

    class _DummyLayer:
        def __init__(self) -> None:
            self.clears = 0

        def clear_semantic_cache(self) -> None:
            self.clears += 1

    def test_bumps_namespace_and_clears_layer_cache(
        self, semantic_state, monkeypatch
    ) -> None:
        layer = self._DummyLayer()
        monkeypatch.setattr(main_module, "_semantic_cache_namespace", 0)
        monkeypatch.setitem(main_module._semantic_state, "layer", layer)

        main_module._refresh_catalog_and_kg_after_rebuild(_make_mgr(_SCHEMA_V2))

        assert main_module._semantic_cache_namespace == 1, (
            "the catalog was just live-mutated to reflect the new schema — "
            "a cached pre-refresh answer must not keep being served as if "
            "the source add/remove/sync never happened"
        )
        assert layer.clears == 1

    def test_repeated_refreshes_bump_repeatedly(
        self, semantic_state, monkeypatch
    ) -> None:
        layer = self._DummyLayer()
        monkeypatch.setattr(main_module, "_semantic_cache_namespace", 0)
        monkeypatch.setitem(main_module._semantic_state, "layer", layer)
        mgr = _make_mgr(_SCHEMA_V2)

        main_module._refresh_catalog_and_kg_after_rebuild(mgr)
        main_module._refresh_catalog_and_kg_after_rebuild(mgr)

        assert main_module._semantic_cache_namespace == 2
        assert layer.clears == 2

    def test_noop_when_semantic_layer_not_yet_loaded_does_not_bump(
        self, monkeypatch
    ) -> None:
        """Mirrors test_noop_when_semantic_layer_not_yet_loaded: before
        _ensure_semantic_loaded() has ever run, there is no cached layer to
        invalidate — bumping would just waste a Redis round-trip on every
        no-op call, and would make the cache namespace grow unboundedly
        every time an admin merely *looks at* the sources list before the
        semantic stack finishes its first load."""
        monkeypatch.setattr(main_module, "_semantic_cache_namespace", 0)
        monkeypatch.setitem(main_module._semantic_state, "kg", None)
        monkeypatch.setitem(main_module._semantic_state, "catalog", None)
        monkeypatch.setitem(main_module._semantic_state, "ontology", None)
        monkeypatch.setitem(main_module._semantic_state, "layer", None)

        main_module._refresh_catalog_and_kg_after_rebuild(_make_mgr(_SCHEMA_V1))

        assert main_module._semantic_cache_namespace == 0
