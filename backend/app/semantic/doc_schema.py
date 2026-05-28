from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class EntityDoc(BaseModel):
    name: str
    display_name: str
    synonyms: list[str] = Field(default_factory=list)
    description: str = ""
    source: str = ""
    primary_key: str = ""
    filter_active: str | None = None
    freshness: Literal["realtime", "delayed"] | None = None


class MetricDoc(BaseModel):
    name: str
    display_name: str
    synonyms: list[str] = Field(default_factory=list)
    description: str = ""
    unit: str | None = None
    sql_template: str | None = None
    certified: bool = False


class GlossaryTerm(BaseModel):
    term: str
    definition: str


class DisambiguationRule(BaseModel):
    id: str
    name: str
    description: str


class SemanticDocs(BaseModel):
    entities: list[EntityDoc] = Field(default_factory=list)
    metrics: list[MetricDoc] = Field(default_factory=list)
    glossary: list[GlossaryTerm] = Field(default_factory=list)
    disambiguation_rules: list[DisambiguationRule] = Field(default_factory=list)
