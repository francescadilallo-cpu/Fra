"""Regression tests for shared (multi-worker) rate-limit bucket storage.

slowapi's `Limiter` defaults to an in-process `MemoryStorage` — a plain dict
guarded by a thread lock. That's correct for a single-process deployment, but
the moment the platform scales to multiple worker processes/instances (its
stated goal — see SEMANTIC_REDIS_URL / the semantic-cache namespace fix), each
worker starts enforcing its *own* copy of LOGIN_RATE_LIMIT/SEMANTIC_RATE_LIMIT,
silently multiplying the configured ceiling by the worker count. These tests
pin down that `_build_rate_limiter()` opts into shared Redis-backed storage
when configured, and degrades gracefully — never crashing app startup — when
it isn't configured or the configured value is unusable.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent


@pytest.fixture(scope="session")
def app_module():
    import sys

    sys.path.insert(0, str(ROOT))
    import app.main as main_module

    return main_module


def _storage_class_name(limiter) -> str:
    return type(limiter._storage).__name__


class TestRateLimiterStorageSelection:
    def test_defaults_to_in_process_storage_when_unconfigured(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(app_module, "_rate_limit_storage_uri", lambda: None)

        built = app_module._build_rate_limiter()

        assert _storage_class_name(built) == "MemoryStorage"

    def test_uses_shared_redis_storage_when_uri_configured(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A configured URI must produce Redis-backed (shared) storage — the
        whole point being that every worker hits the same bucket counters
        instead of each keeping its own, so the *effective* limit a client
        experiences stays LOGIN_RATE_LIMIT/SEMANTIC_RATE_LIMIT regardless of
        how many workers are serving it."""
        monkeypatch.setattr(
            app_module,
            "_rate_limit_storage_uri",
            lambda: "redis://localhost:6399/0",
        )

        built = app_module._build_rate_limiter()

        assert _storage_class_name(built) == "RedisStorage"
        assert built._storage_uri == "redis://localhost:6399/0"

    def test_falls_back_to_in_process_storage_on_unusable_uri(
        self, app_module, monkeypatch: pytest.MonkeyPatch, caplog
    ) -> None:
        """A malformed/unsupported storage URI must degrade to in-process
        buckets — not crash the app at import time. `Limiter.__init__` builds
        the storage backend eagerly (`storage_from_string`), so a bad scheme
        raises immediately; that must be caught and logged, never propagated,
        since `limiter = _build_rate_limiter()` runs at module import."""
        monkeypatch.setattr(
            app_module,
            "_rate_limit_storage_uri",
            lambda: "not-a-real-storage-scheme",
        )

        with caplog.at_level("WARNING", logger=app_module.logger.name):
            built = app_module._build_rate_limiter()

        assert _storage_class_name(built) == "MemoryStorage"
        assert any(
            "Rate limit shared storage unusable" in record.message
            for record in caplog.records
        )

    def test_in_memory_fallback_enabled_regardless_of_backend(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """If a configured Redis becomes unreachable *after* startup, slowapi
        must degrade to per-process limiting instead of raising 5xxs on every
        rate-limited request — that's what `in_memory_fallback_enabled` is
        for. It must be set on every code path, including the plain
        in-process (no URI configured) one, where it's a costless no-op."""
        monkeypatch.setattr(app_module, "_rate_limit_storage_uri", lambda: None)
        unconfigured = app_module._build_rate_limiter()
        assert unconfigured._in_memory_fallback_enabled is True

        monkeypatch.setattr(
            app_module,
            "_rate_limit_storage_uri",
            lambda: "redis://localhost:6399/0",
        )
        configured = app_module._build_rate_limiter()
        assert configured._in_memory_fallback_enabled is True


class TestRateLimitStorageUriResolution:
    """`_rate_limit_storage_uri()` is what `_build_rate_limiter()` consults —
    pin down its env-var precedence/fallback directly so a future refactor
    can't silently change which Redis a multi-worker deployment shares."""

    def test_prefers_dedicated_env_var_over_semantic_redis_url(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("RATE_LIMIT_STORAGE_URI", "redis://dedicated:6379/2")
        monkeypatch.setenv("SEMANTIC_REDIS_URL", "redis://shared-cache:6379/0")

        assert app_module._rate_limit_storage_uri() == "redis://dedicated:6379/2"

    def test_reuses_semantic_redis_url_when_no_dedicated_uri(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("RATE_LIMIT_STORAGE_URI", raising=False)
        monkeypatch.setenv("SEMANTIC_REDIS_URL", "redis://shared-cache:6379/0")

        assert app_module._rate_limit_storage_uri() == "redis://shared-cache:6379/0"

    def test_blank_dedicated_uri_falls_through_to_semantic_redis_url(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("RATE_LIMIT_STORAGE_URI", "   ")
        monkeypatch.setenv("SEMANTIC_REDIS_URL", "redis://shared-cache:6379/0")

        assert app_module._rate_limit_storage_uri() == "redis://shared-cache:6379/0"

    def test_none_when_neither_is_configured(
        self, app_module, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("RATE_LIMIT_STORAGE_URI", raising=False)
        monkeypatch.delenv("SEMANTIC_REDIS_URL", raising=False)

        assert app_module._rate_limit_storage_uri() is None
