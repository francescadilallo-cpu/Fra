"""Salesforce write-back tests — NL parsing, fail-closed validation, the full
HITL lifecycle (nothing written before approval), re-validation at approval
time, and clean failure surfacing. The Salesforce gateway is always faked."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.agentic.executive import (
    AgentExecutionError,
    AgentSemanticValidationError,
    ExecutiveAgenticLayer,
)

RECORD_ID = "001A000001BcDeF"  # 15-char Salesforce id


def _layer(sf_check=None, sf_update=None):
    return ExecutiveAgenticLayer(
        get_ontology=lambda: None,
        get_db_connection=lambda: None,
        sf_check=sf_check,
        sf_update=sf_update,
    )


class TestParsing:
    def test_english_command(self):
        layer = _layer(sf_check=lambda o, f, r: None, sf_update=lambda *a: None)
        a = layer._parse_command(
            f"update salesforce Account {RECORD_ID} set Phone to +39 02 1234567"
        )
        assert a.action_type == "UPDATE_SALESFORCE_FIELD"
        assert (a.sf_object, a.sf_record_id, a.sf_field) == (
            "Account",
            RECORD_ID,
            "Phone",
        )
        assert a.sf_value == "+39 02 1234567"

    def test_italian_command(self):
        layer = _layer(sf_check=lambda o, f, r: None, sf_update=lambda *a: None)
        a = layer._parse_command(
            f"aggiorna su salesforce Account {RECORD_ID} campo Rating a Hot"
        )
        assert a.action_type == "UPDATE_SALESFORCE_FIELD"
        assert a.sf_field == "Rating" and a.sf_value == "Hot"

    def test_value_length_bounded(self):
        layer = _layer(sf_check=lambda o, f, r: None, sf_update=lambda *a: None)
        with pytest.raises(AgentSemanticValidationError, match="500"):
            layer._parse_command(
                f"update salesforce Account {RECORD_ID} set Phone to {'x' * 501}"
            )


class TestValidation:
    def test_not_configured_fails_closed(self):
        layer = _layer()  # no gateway injected
        with pytest.raises(AgentSemanticValidationError, match="not configured"):
            layer.submit_command(
                f"update salesforce Account {RECORD_ID} set Phone to 123456",
                "alice",
                "admin",
            )

    def test_system_field_always_blocked(self):
        layer = _layer(sf_check=lambda o, f, r: None, sf_update=lambda *a: None)
        with pytest.raises(AgentSemanticValidationError, match="system field"):
            layer.submit_command(
                f"update salesforce Account {RECORD_ID} set CreatedDate to 2020-01-01",
                "alice",
                "admin",
            )

    def test_gateway_error_blocks(self):
        layer = _layer(
            sf_check=lambda o, f, r: f"Field '{f}' is not updateable",
            sf_update=lambda *a: None,
        )
        with pytest.raises(AgentSemanticValidationError, match="not updateable"):
            layer.submit_command(
                f"update salesforce Account {RECORD_ID} set Name to ACME",
                "alice",
                "admin",
            )

    def test_gateway_exception_fails_closed(self):
        def _boom(o, f, r):
            raise RuntimeError("network down")

        layer = _layer(sf_check=_boom, sf_update=lambda *a: None)
        with pytest.raises(AgentSemanticValidationError, match="Could not verify"):
            layer.submit_command(
                f"update salesforce Account {RECORD_ID} set Phone to 123456",
                "alice",
                "admin",
            )


class TestLifecycle:
    def test_nothing_written_before_approval_then_patch_on_approve(self):
        written: list[tuple] = []
        layer = _layer(
            sf_check=lambda o, f, r: None,
            sf_update=lambda *a: written.append(a),
        )
        action = layer.submit_command(
            f"update salesforce Account {RECORD_ID} set Phone to 0212345678",
            "alice",
            "admin",
        )
        assert action.status == "PENDING_HUMAN_APPROVAL"
        assert written == []  # HITL invariant

        done = layer.approve_action(
            action.action_id, "boss", "admin", approve=True, manager_note=None
        )
        assert done.status in ("SYNCED", "EXECUTED")
        assert written == [("Account", RECORD_ID, "Phone", "0212345678")]

    def test_rejection_never_writes(self):
        written: list[tuple] = []
        layer = _layer(
            sf_check=lambda o, f, r: None,
            sf_update=lambda *a: written.append(a),
        )
        action = layer.submit_command(
            f"update salesforce Account {RECORD_ID} set Phone to 0212345678",
            "alice",
            "admin",
        )
        done = layer.approve_action(
            action.action_id, "boss", "admin", approve=False, manager_note="no"
        )
        assert done.status == "REJECTED" and written == []

    def test_revalidation_at_approval_blocks_stale_action(self):
        # Field is updateable at submission, permission revoked before approval.
        state = {"ok": True}
        layer = _layer(
            sf_check=lambda o, f, r: None if state["ok"] else "no longer updateable",
            sf_update=lambda *a: (_ for _ in ()).throw(AssertionError("must not run")),
        )
        action = layer.submit_command(
            f"update salesforce Account {RECORD_ID} set Phone to 0212345678",
            "alice",
            "admin",
        )
        state["ok"] = False
        with pytest.raises(AgentExecutionError, match="Re-validation failed"):
            layer.approve_action(
                action.action_id, "boss", "admin", approve=True, manager_note=None
            )
        assert layer.get_action(action.action_id).status == "FAILED"

    def test_salesforce_rejection_surfaces_cleanly(self):
        def _patch_fails(*a):
            raise RuntimeError("REQUIRED_FIELD_MISSING at https://internal...")

        layer = _layer(sf_check=lambda o, f, r: None, sf_update=_patch_fails)
        action = layer.submit_command(
            f"update salesforce Account {RECORD_ID} set Phone to 0212345678",
            "alice",
            "admin",
        )
        with pytest.raises(AgentExecutionError) as exc:
            layer.approve_action(
                action.action_id, "boss", "admin", approve=True, manager_note=None
            )
        # Clean message, no internal URL leaked.
        assert "internal" not in str(exc.value)
        assert "Salesforce rejected" in str(exc.value)
