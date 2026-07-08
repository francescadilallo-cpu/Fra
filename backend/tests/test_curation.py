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
