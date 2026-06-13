"""Tests for WorkspaceStore."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.workspace.store import WorkspaceStore


@pytest.fixture
def store(tmp_path: Path) -> WorkspaceStore:
    return WorkspaceStore(db_path=tmp_path / "workspace.db")


def test_initial_state_is_empty(store: WorkspaceStore) -> None:
    assert store.get_name() is None
    assert store.get_sector() is None


def test_set_and_get_name(store: WorkspaceStore) -> None:
    store.update(name="Acme Corp", sector_id=None)
    assert store.get_name() == "Acme Corp"


def test_set_and_get_sector(store: WorkspaceStore) -> None:
    store.update(name=None, sector_id="retail")
    assert store.get_sector() == "retail"


def test_update_both(store: WorkspaceStore) -> None:
    store.update(name="Contoso", sector_id="manufacturing")
    assert store.get_name() == "Contoso"
    assert store.get_sector() == "manufacturing"


def test_update_overwrites(store: WorkspaceStore) -> None:
    store.update(name="First", sector_id="retail")
    store.update(name="Second", sector_id=None)
    assert store.get_name() == "Second"
    assert store.get_sector() == "retail"


def test_invalid_sector_is_rejected(store: WorkspaceStore) -> None:
    store.update(name=None, sector_id="invalid_sector")
    assert store.get_sector() is None


def test_name_is_truncated_to_200_chars(store: WorkspaceStore) -> None:
    long_name = "x" * 300
    store.update(name=long_name, sector_id=None)
    assert store.get_name() == "x" * 200


def test_valid_sectors(store: WorkspaceStore) -> None:
    for sector in ("manufacturing", "retail", "healthcare", "finance"):
        store.update(name=None, sector_id=sector)
        assert store.get_sector() == sector


def test_none_args_dont_clear(store: WorkspaceStore) -> None:
    store.update(name="Keep this", sector_id="retail")
    store.update(name=None, sector_id=None)
    assert store.get_name() == "Keep this"
    assert store.get_sector() == "retail"
