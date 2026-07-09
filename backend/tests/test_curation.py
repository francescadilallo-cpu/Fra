"""Curation layer tests — engine classification, reversible store, report,
workspace skill pack (rules + aliases)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.curation.engine import curation_report, load_pack, run_curation
from app.curation.store import CurationStore


def _store(tmp_path) -> CurationStore:
    return CurationStore(tmp_path / "decisions.json")


def _schema(**tables):
    """tables: name → (row_count, n_columns)"""
    return {
        name: {
            "row_count": rows,
            "columns": [{"name": f"c{i}"} for i in range(cols)],
        }
        for name, (rows, cols) in tables.items()
    }


class TestStore:
    def test_roundtrip_and_excluded_set(self, tmp_path):
        s = _store(tmp_path)
        s.set_decision("t1", "excluded", "rule:x", decided_by="rule")
        s.set_decision("t2", "kept", "signal:y", decided_by="signal")
        assert s.excluded_tables() == frozenset({"t1"})
        assert s.all_decisions()["t2"]["status"] == "kept"

    def test_user_pin_beats_engine(self, tmp_path):
        s = _store(tmp_path)
        s.set_decision("t1", "kept", "user says keep", decided_by="user")
        s.set_decision("t1", "excluded", "rule:x", decided_by="rule")
        assert s.all_decisions()["t1"]["status"] == "kept"
        # …and a user decision can always overwrite anything (reversibility).
        s.set_decision("t1", "excluded", "user changed mind", decided_by="user")
        assert s.excluded_tables() == frozenset({"t1"})

    def test_forget_reopens_evaluation(self, tmp_path):
        s = _store(tmp_path)
        s.set_decision("t1", "excluded", "rule:x", decided_by="user")
        assert s.forget("t1") and s.all_decisions() == {}
        assert not s.forget("t1")

    def test_denied_merges_are_symmetric_and_persistent(self, tmp_path):
        s = _store(tmp_path)
        assert not s.is_merge_denied("a", "b")
        s.add_denied_merge("Customers", "sf_account", reason="rejected:dup")
        # Order- and case-insensitive.
        assert s.is_merge_denied("sf_account", "customers")
        assert s.is_merge_denied("CUSTOMERS", "SF_ACCOUNT")
        assert not s.is_merge_denied("customers", "orders")
        # Survives a fresh store instance (persisted on disk).
        s2 = _store(tmp_path)
        assert s2.is_merge_denied("sf_account", "Customers")
        assert len(s2.denied_merges()) == 1


class TestEngineSignals:
    def test_rows_concept_connectivity_and_junk(self, tmp_path):
        s = _store(tmp_path)
        schema = _schema(
            crm_accounts=(10, 5),  # rows → kept
            sf_x_case=(0, 8),  # canonical concept (Case) → kept
            linked_zero=(0, 6),  # 0 rows but FK-connected → kept
            floating_zero=(0, 6),  # no signal → uncertain (default policy)
            nightly_backup=(999, 9),  # generic pack: *_backup → excluded
            tiny=(0, 1),  # too few columns → excluded
        )
        decisions = run_curation(
            schema,
            relations=[{"from_table": "linked_zero", "to_table": "crm_accounts"}],
            store=s,
        )
        st = {t: d["status"] for t, d in decisions.items()}
        assert st["crm_accounts"] == "kept"
        assert st["sf_x_case"] == "kept"
        assert st["linked_zero"] == "kept"
        assert st["floating_zero"] == "uncertain"
        assert st["nightly_backup"] == "excluded"
        assert st["tiny"] == "excluded"
        # Every decision is explainable.
        assert decisions["nightly_backup"]["reason"].startswith("rule:generic/")
        assert "canonical-concept" in decisions["sf_x_case"]["reason"]

    def test_protected_tables_never_excluded(self, tmp_path):
        s = _store(tmp_path)
        decisions = run_curation(
            _schema(scratch_backup=(0, 1)),
            protected={"scratch_backup"},
            store=s,
        )
        assert decisions["scratch_backup"]["status"] == "kept"
        assert decisions["scratch_backup"]["reason"] == "protected:user-curated"

    def test_user_pin_survives_rerun(self, tmp_path):
        s = _store(tmp_path)
        s.set_decision("crm_accounts", "excluded", "user hides it", decided_by="user")
        decisions = run_curation(_schema(crm_accounts=(10, 5)), store=s)
        assert decisions["crm_accounts"]["status"] == "excluded"

    def test_salesforce_pack_applies_by_source_type(self, tmp_path):
        s = _store(tmp_path)
        decisions = run_curation(
            _schema(sf_x_pricebookentry=(0, 12), sf_x_account=(0, 12)),
            source_types={"salesforce"},
            store=s,
        )
        assert decisions["sf_x_pricebookentry"]["status"] == "excluded"
        assert decisions["sf_x_account"]["status"] == "kept"  # core-crm keep rule


class TestWorkspacePack:
    def test_workspace_rules_and_aliases(self, tmp_path, monkeypatch):
        monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path))
        (tmp_path / "curation_workspace.yaml").write_text(
            "pack: workspace\n"
            "exclude:\n"
            "  - id: scratch\n"
            "    pattern: '.*_scratch$'\n"
            "aliases:\n"
            "  Customer: [paziente, pazienti]\n",
            encoding="utf-8",
        )
        s = _store(tmp_path)
        decisions = run_curation(
            _schema(pazienti=(0, 6), notes_scratch=(50, 6)),
            store=s,
        )
        # Workspace alias: "pazienti" now resolves to Customer → kept.
        assert decisions["pazienti"]["status"] == "kept"
        assert "Customer" in decisions["pazienti"]["reason"]
        # Workspace rule beats the has-rows signal.
        assert decisions["notes_scratch"]["status"] == "excluded"
        assert decisions["notes_scratch"]["reason"] == "rule:workspace/scratch"

    def test_broken_pack_is_skipped_not_fatal(self, tmp_path):
        bad = tmp_path / "bad.yaml"
        bad.write_text(":\n  - not: [valid", encoding="utf-8")
        assert load_pack(bad, "bad") is None


class TestReport:
    def test_report_counts_and_scoping(self, tmp_path):
        s = _store(tmp_path)
        run_curation(
            _schema(crm_accounts=(10, 5), old_backup=(0, 5)),
            store=s,
        )
        report = curation_report(store=s)
        assert report["counts"]["kept"] == 1
        assert report["counts"]["excluded"] == 1
        # A table that disappeared from the schema drops out of the report.
        scoped = curation_report(store=s, schema_tables={"crm_accounts"})
        assert scoped["counts"]["excluded"] == 0


# ── LLM advisor (fake LLM — no network) ───────────────────────────────────────


class TestLlmAdvisor:
    def _setup(self, tmp_path, monkeypatch, llm_json: str):
        from app.curation import llm_advisor

        monkeypatch.setattr(
            llm_advisor, "_complete_json", lambda s, u, schema=None: llm_json
        )
        store = _store(tmp_path)
        store.set_decision("floating_a", "uncertain", "signal:x", decided_by="signal")
        store.set_decision("floating_b", "uncertain", "signal:x", decided_by="signal")
        schema = _schema(floating_a=(0, 5), floating_b=(0, 5), crm_accounts=(10, 5))
        entities = [
            {
                "name": "crm_accounts",
                "table": "crm_accounts",
                "canonical": "Customer",
                "columns": [],
            }
        ]
        return llm_advisor, store, schema, entities

    def test_applies_verdicts_and_queues_merges(self, tmp_path, monkeypatch):
        llm_json = (
            '{"decisions": ['
            '{"table": "floating_a", "decision": "exclude", "reason": "ETL scratch"},'
            '{"table": "floating_b", "decision": "keep", "reason": "looks business"},'
            '{"table": "hallucinated", "decision": "exclude", "reason": "x"}],'
            '"merges": ['
            '{"table": "floating_b", "with_entity": "crm_accounts", "concept": "Customer", "reason": "same figure"},'
            '{"table": "floating_a", "with_entity": "ghost_entity", "concept": "X", "reason": "bad"}]}'
        )
        advisor, store, schema, entities = self._setup(tmp_path, monkeypatch, llm_json)
        queued: list[tuple] = []
        result = advisor.advise(
            schema,
            entities,
            [],
            store,
            submit_merge=lambda t, e: queued.append((t, e)) or "pending_approval:x",
        )
        decisions = store.all_decisions()
        assert decisions["floating_a"]["status"] == "excluded"
        assert decisions["floating_a"]["decided_by"] == "llm"
        assert decisions["floating_b"]["status"] == "kept"
        assert "hallucinated" not in decisions  # hallucination guard
        # Merge to a real entity queued; merge to a hallucinated one dropped.
        assert queued == [("floating_b", "crm_accounts")]
        assert len(result["merge_proposals"]) == 1

    def test_llm_verdict_survives_engine_rerun_but_not_user(
        self, tmp_path, monkeypatch
    ):
        llm_json = '{"decisions": [{"table": "floating_a", "decision": "exclude", "reason": "noise"}], "merges": []}'
        advisor, store, schema, entities = self._setup(tmp_path, monkeypatch, llm_json)
        advisor.advise(schema, entities, [], store, submit_merge=lambda t, e: "x")
        # Engine re-run: floating_a has no signal → would be "uncertain", but
        # the llm pin survives.
        run_curation(_schema(floating_a=(0, 5)), store=store)
        assert store.all_decisions()["floating_a"]["status"] == "excluded"
        # A user decision overrides the llm one.
        store.set_decision("floating_a", "kept", "user wants it", decided_by="user")
        assert store.all_decisions()["floating_a"]["status"] == "kept"

    def test_no_uncertain_is_a_noop(self, tmp_path, monkeypatch):
        from app.curation import llm_advisor

        monkeypatch.setattr(
            llm_advisor,
            "_complete_json",
            lambda s, u, schema=None: (_ for _ in ()).throw(
                AssertionError("must not be called")
            ),
        )
        store = _store(tmp_path)
        result = llm_advisor.advise({}, [], [], store, submit_merge=lambda t, e: "x")
        assert result["applied"] == [] and "note" in result

    def test_low_confidence_verdicts_are_skipped(self, tmp_path, monkeypatch):
        llm_json = (
            '{"decisions": ['
            '{"table": "floating_a", "decision": "exclude", "confidence": 0.4, "reason": "maybe noise"},'
            '{"table": "floating_b", "decision": "keep", "confidence": 0.95, "reason": "clearly business"}],'
            '"merges": ['
            '{"table": "floating_b", "with_entity": "crm_accounts", "concept": "Customer",'
            ' "confidence": 0.3, "reason": "weak hunch"}]}'
        )
        advisor, store, schema, entities = self._setup(tmp_path, monkeypatch, llm_json)
        queued: list[tuple] = []
        result = advisor.advise(
            schema,
            entities,
            [],
            store,
            submit_merge=lambda t, e: queued.append((t, e)) or "x",
        )
        decisions = store.all_decisions()
        # Low-confidence exclude discarded → stays uncertain for a human.
        assert decisions["floating_a"]["status"] == "uncertain"
        assert decisions["floating_b"]["status"] == "kept"
        # Low-confidence merge never reaches the approval queue.
        assert queued == []
        skipped = result["skipped_low_confidence"]
        assert {s["table"] for s in skipped} == {"floating_a", "floating_b"}

    def test_confidence_threshold_env_override(self, tmp_path, monkeypatch):
        monkeypatch.setenv("FRA_CURATION_LLM_MIN_CONFIDENCE", "0.2")
        llm_json = (
            '{"decisions": [{"table": "floating_a", "decision": "exclude",'
            ' "confidence": 0.4, "reason": "noise"}], "merges": []}'
        )
        advisor, store, schema, entities = self._setup(tmp_path, monkeypatch, llm_json)
        advisor.advise(schema, entities, [], store, submit_merge=lambda t, e: "x")
        assert store.all_decisions()["floating_a"]["status"] == "excluded"

    def test_denied_merge_is_never_reproposed(self, tmp_path, monkeypatch):
        llm_json = (
            '{"decisions": [], "merges": ['
            '{"table": "floating_b", "with_entity": "crm_accounts", "concept": "Customer",'
            ' "confidence": 0.9, "reason": "same figure"}]}'
        )
        advisor, store, schema, entities = self._setup(tmp_path, monkeypatch, llm_json)
        store.add_denied_merge("floating_b", "crm_accounts", reason="rejected:test")
        queued: list[tuple] = []
        result = advisor.advise(
            schema,
            entities,
            [],
            store,
            submit_merge=lambda t, e: queued.append((t, e)) or "x",
        )
        assert queued == []
        assert result["merge_proposals"][0]["queued"].startswith("denied:")


# ── Learning loop ─────────────────────────────────────────────────────────────


class TestLearningLoop:
    def test_approved_merge_teaches_alias(self, tmp_path, monkeypatch):
        monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path))
        from app.curation.learning import record_merge
        from app.semantic.canonical import canonical_concept

        added = record_merge(
            {"table": "crm_accounts"},  # resolves to Customer
            {"table": "raw_patients"},  # unknown side → learned
        )
        assert added == 1
        assert canonical_concept("raw_patients") == "Customer"
        # Persisted in the workspace pack for future processes.
        import yaml as _y

        pack = _y.safe_load((tmp_path / "curation_workspace.yaml").read_text())
        assert "patients" in pack["aliases"]["Customer"]

    def test_concept_assignment_teaches_alias(self, tmp_path, monkeypatch):
        monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path))
        from app.curation.learning import record_concept
        from app.semantic.canonical import canonical_concept

        added = record_concept({"table": "erp_soci"}, "Customer")
        assert added == 1
        assert canonical_concept("erp_soci") == "Customer"

    def test_both_sides_known_learns_nothing(self, tmp_path, monkeypatch):
        monkeypatch.setenv("FRA_DATA_DIR", str(tmp_path))
        from app.curation.learning import record_merge

        assert (
            record_merge({"table": "crm_accounts"}, {"table": "legacy_customers"}) == 0
        )

    def test_rejected_merge_lands_on_deny_list(self, tmp_path, monkeypatch):
        from app.curation import store as store_mod
        from app.curation.learning import record_rejected_merge

        s = _store(tmp_path)
        monkeypatch.setattr(store_mod, "get_curation_store", lambda: s)

        class _Action:
            entity = "Pazienti"
            entity_b = "crm_accounts"

        class _Catalog:
            def get_draft_entities(self):
                return [
                    {"name": "Pazienti", "table": "raw_patients"},
                    {"name": "crm_accounts", "table": "crm_accounts"},
                ]

        record_rejected_merge(_Action(), _Catalog(), note="not the same thing")
        # Refs resolved to physical tables and stored symmetrically.
        assert s.is_merge_denied("raw_patients", "crm_accounts")
        assert not s.is_merge_denied("raw_patients", "orders")
