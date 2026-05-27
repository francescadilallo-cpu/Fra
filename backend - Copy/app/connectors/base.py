"""Base connector ABC and SourceMeta model."""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Iterable

from pydantic import BaseModel


class SourceMeta(BaseModel):
    name: str
    source_type: str
    tables: list[str]
    record_counts: dict[str, int]
    loaded_at: datetime
    notes: str = ""


class BaseConnector(ABC):
    """Abstract base class for all data source connectors."""

    @abstractmethod
    def load_entity(self, entity_type: str) -> Iterable[dict]:
        """Yield rows for the requested entity type as dicts."""
        ...

    @abstractmethod
    def describe(self) -> SourceMeta:
        """Return metadata about this source."""
        ...

    @abstractmethod
    def execute_query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a SQL query and return list of row dicts."""
        ...
