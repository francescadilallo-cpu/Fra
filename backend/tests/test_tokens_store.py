"""Tests for API token store (app/tokens/store.py)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.tokens.store import TokensStore


@pytest.fixture()
def store(tmp_path) -> TokensStore:
    return TokensStore(db_path=tmp_path / "test_tokens.db")


class TestTokensStore:
    def test_empty_on_init(self, store):
        assert store.list_tokens() == []

    def test_generate_returns_plaintext(self, store):
        record, plaintext = store.generate("CI/CD pipeline", ["read:ontology"])
        assert plaintext.startswith("si_")
        assert len(plaintext) > 20

    def test_generated_token_appears_in_list(self, store):
        store.generate("test token", ["read:metrics"])
        tokens = store.list_tokens()
        assert len(tokens) == 1
        assert tokens[0].name == "test token"
        assert tokens[0].scopes == ["read:metrics"]

    def test_plaintext_not_in_record(self, store):
        record, plaintext = store.generate("tok", ["admin"])
        assert not hasattr(record, "token_hash")
        # preview contains asterisks — plaintext must not be fully exposed
        assert "•" in record.token_preview

    def test_verify_valid_token(self, store):
        record, plaintext = store.generate("tok", ["read:ontology"])
        found = store.verify(plaintext)
        assert found is not None
        assert found.id == record.id

    def test_verify_wrong_token_returns_none(self, store):
        store.generate("tok", ["read:ontology"])
        assert store.verify("si_wrong_token_value") is None

    def test_revoke_removes_from_list(self, store):
        record, _ = store.generate("to-revoke", ["read:ontology"])
        ok = store.revoke(record.id)
        assert ok
        assert store.list_tokens() == []

    def test_verify_revoked_token_returns_none(self, store):
        record, plaintext = store.generate("tok", ["read:ontology"])
        store.revoke(record.id)
        assert store.verify(plaintext) is None

    def test_revoke_nonexistent_returns_false(self, store):
        assert not store.revoke("does-not-exist")

    def test_multiple_tokens_newest_first(self, store):
        store.generate("first", ["read:ontology"])
        store.generate("second", ["write:ontology"])
        toks = store.list_tokens()
        assert toks[0].name == "second"
        assert toks[1].name == "first"

    def test_touch_does_not_raise(self, store):
        _, plaintext = store.generate("tok", ["read:ontology"])
        import hashlib

        h = hashlib.sha256(plaintext.encode()).hexdigest()
        store.touch(h)  # must not raise
        toks = store.list_tokens()
        assert toks[0].last_used_at is not None

    def test_scopes_preserved(self, store):
        record, _ = store.generate("multi", ["read:ontology", "write:agents", "admin"])
        assert set(store.list_tokens()[0].scopes) == {
            "read:ontology",
            "write:agents",
            "admin",
        }

    def test_name_truncated(self, store):
        store.generate("x" * 200, ["read:ontology"])
        assert len(store.list_tokens()[0].name) <= 100

    def test_verify_expired_token_returns_none(self, store):
        record, plaintext = store.generate("expiring", ["read:ontology"], ttl_days=-1)
        assert store.verify(plaintext) is None

    def test_revoke_already_revoked_returns_false(self, store):
        record, _ = store.generate("tok", ["read:ontology"])
        store.revoke(record.id)
        assert not store.revoke(record.id)

    def test_remove_one_token_leaves_others(self, store):
        r1, _ = store.generate("keep", ["read:ontology"])
        r2, _ = store.generate("revoke", ["read:ontology"])
        store.revoke(r2.id)
        remaining = store.list_tokens()
        assert len(remaining) == 1
        assert remaining[0].id == r1.id
