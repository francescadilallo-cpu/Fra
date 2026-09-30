"""Shared pytest configuration.

``backend/app/main.py`` calls ``load_dotenv()``, which walks up from the cwd and
picks up a developer's repo-root ``.env``. A local ``.env`` that enables the
AdventureWorks demo seeding (``FRA_SEED_DEMO_SOURCES=true``, the default written
by ``scripts/local-setup.sh``) then pre-populates the context store and the
source registry, and every test that asserts on an empty or exact listing fails.

Neutralise the seeding flag for the whole session so the suite behaves the same
locally and in CI. Tests that need the seeding on set it themselves with
``monkeypatch.setenv``, which still wins inside their own scope.
"""

from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True, scope="session")
def _disable_demo_seeding() -> None:
    os.environ["FRA_SEED_DEMO_SOURCES"] = "false"
