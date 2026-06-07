"""QueryTemplate — Pydantic model for user-defined SQL query templates.

Templates are stored in the MetadataCatalog SQLite DB and loaded into the
SemanticLayer at startup. Each template registers itself as a dynamic intent
(intent_type = f"tpl_{id}") and is matched by keyword before the LLM fallback.

Safe substitution tokens in sql_query:
  {year}  — replaced with a validated 4-digit integer year
  {limit} — replaced with a validated integer in [1, 100]
"""

from __future__ import annotations

import re
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

_ALLOWED_TOKENS = {"year", "limit"}
_TOKEN_RE = re.compile(r"\{(\w+)\}")


class QueryTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    sql_query: str = Field(min_length=10, max_length=8000)
    keywords: list[Annotated[str, Field(max_length=200)]] = Field(
        default_factory=list, max_length=50
    )
    sources: list[Annotated[str, Field(max_length=256)]] = Field(
        default_factory=list, max_length=50
    )

    @model_validator(mode="after")
    def _validate_tokens(self) -> "QueryTemplateCreate":
        found = set(_TOKEN_RE.findall(self.sql_query))
        bad = found - _ALLOWED_TOKENS
        if bad:
            raise ValueError(
                f"Unsupported template tokens: {bad}. "
                f"Only {{year}} and {{limit}} are allowed."
            )
        return self


class QueryTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    sql_query: str | None = Field(default=None, min_length=10, max_length=8000)
    keywords: list[Annotated[str, Field(max_length=200)]] | None = Field(
        default=None, max_length=50
    )
    sources: list[Annotated[str, Field(max_length=256)]] | None = Field(
        default=None, max_length=50
    )

    @model_validator(mode="after")
    def _validate_tokens(self) -> "QueryTemplateUpdate":
        if self.sql_query is not None:
            found = set(_TOKEN_RE.findall(self.sql_query))
            bad = found - _ALLOWED_TOKENS
            if bad:
                raise ValueError(
                    f"Unsupported template tokens: {bad}. "
                    f"Only {{year}} and {{limit}} are allowed."
                )
        return self
