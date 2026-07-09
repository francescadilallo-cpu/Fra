"""Canonical entity naming — human display names + cross-source concept grouping.

Two deterministic layers, no LLM involved:

1. **Display name** — turns a physical table name into something a business
   user recognises: ``sf_salesforce_6650fdb1_account`` → "Account",
   ``crm_accounts`` → "Account", ``sales_order_header`` → "Sales Order Header".
   A connector-provided label (e.g. the Salesforce SObject label) always wins
   over the heuristic.

2. **Canonical concept** — maps equivalent entities from different sources to
   ONE business concept via a multilingual alias dictionary: the Salesforce
   ``Account`` object, a ``crm_accounts`` table and a ``legacy_customers`` CSV
   all resolve to **Customer**. The concept is the grouping key the Knowledge
   Graph uses to bridge same-entity tables across sources (SAME_AS), and its
   aliases feed NL entity linking so a question in human language ("clienti",
   "customers", "account") lands on the right unified entity.

The alias map is deliberately conservative: only unambiguous business nouns.
Anything not listed simply gets no concept (→ no automatic grouping) rather
than a wrong one. The dictionary itself lives in ``concepts.yaml`` next to
this module (path overridable via ``FRA_CONCEPTS_PATH``), so it can be
extended without touching code.
"""

from __future__ import annotations

import logging
import os
import re
import unicodedata
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

# Leading tokens that identify the *source*, not the entity. Also any token
# containing a digit (source ids like ``salesforce`` + ``6650fdb1``) is
# treated as source junk when it appears before the first business token.
_SOURCE_PREFIXES = frozenset(
    {"sf", "crm", "erp", "hr", "pim", "legacy", "src", "raw", "stg", "dw", "tmp"}
)

_TOKEN_RE = re.compile(r"[^a-z0-9]+")


def _fold(text: str) -> str:
    """Lowercase + strip accents so "Opportunità" matches alias "opportunita"."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _tokens(table: str) -> list[str]:
    """Business tokens of a table name, source prefixes and id junk stripped."""
    parts = [t for t in _TOKEN_RE.split(_fold(table)) if t]
    # Drop leading source markers: known prefixes, tokens with digits, and the
    # connector-type word that often follows the prefix (sf_salesforce_…).
    # Never drop the last remaining token — "product2" is a business name
    # (the Salesforce Product2 object), not source junk.
    while len(parts) > 1:
        head = parts[0]
        if (
            head in _SOURCE_PREFIXES
            or any(c.isdigit() for c in head)
            or head in ("salesforce", "hubspot", "dynamics", "zoho")
        ):
            parts.pop(0)
            continue
        break
    # Trailing id junk (…_6650fdb1) can also appear mid-name; drop digit tokens.
    return [t for t in parts if not any(c.isdigit() for c in t)] or parts


def _singular(word: str) -> str:
    """Light English singularisation. Italian plurals are handled by the alias
    map instead — mechanical IT singularisation produces wrong words."""
    if len(word) <= 3:
        return word
    if word.endswith("ies"):
        return word[:-3] + "y"
    if word.endswith(("ses", "xes", "zes", "ches", "shes")):
        return word[:-2]
    if word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def table_base_name(table: str) -> str:
    """Normalised business base name of a table (source prefixes stripped),
    e.g. ``sf_x_pazienti`` → ``pazienti``. Used as the alias key when the
    learning loop folds an approved decision into the workspace pack."""
    toks = _tokens(table)
    return "_".join(toks) if toks else table.lower()


def display_name(table: str, label: str | None = None) -> str:
    """Human-friendly entity name for *table*. A connector label wins outright."""
    if label and label.strip():
        return label.strip()
    toks = _tokens(table)
    if not toks:
        return table
    # Singularise only the last token: sales_orders → Sales Order
    toks = toks[:-1] + [_singular(toks[-1])]
    return " ".join(t.capitalize() for t in toks)


# ── Canonical concepts ────────────────────────────────────────────────────────
# concept → aliases, loaded from concepts.yaml (see module docstring). Aliases
# are matched against the normalised table base name, its singular, AND the
# connector label. EN + IT out of the box.


def _concepts_path() -> Path:
    override = os.getenv("FRA_CONCEPTS_PATH", "").strip()
    return Path(override) if override else Path(__file__).with_name("concepts.yaml")


def _load_concept_aliases() -> dict[str, frozenset[str]]:
    """Read the concept dictionary from YAML. A missing or broken file logs an
    error and yields an empty dictionary — entities then simply get no concept
    (no cross-source grouping) instead of the process failing to import."""
    path = _concepts_path()
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        section = raw.get("concepts") if isinstance(raw, dict) else None
        if not isinstance(section, dict):
            raise ValueError("missing top-level 'concepts' mapping")
        out: dict[str, frozenset[str]] = {}
        for concept, aliases in section.items():
            name = str(concept).strip()
            if not name or not isinstance(aliases, list):
                continue
            folded = {_fold(str(a).strip()) for a in aliases if str(a).strip()}
            if folded:
                out[name] = frozenset(folded)
        if not out:
            raise ValueError("no concepts defined")
        return out
    except Exception as exc:  # noqa: BLE001 — a bad dictionary must not brick boot
        logger.error(
            "concept dictionary %s unreadable (%s) — cross-source grouping disabled",
            path,
            exc,
        )
        return {}


_CONCEPT_ALIASES: dict[str, frozenset[str]] = _load_concept_aliases()

# Reverse index alias → concept, built once. extend_aliases() adds
# workspace-specific entries on top (e.g. a clinic mapping "paziente" →
# Customer) — they never overwrite the built-in dictionary.
_ALIAS_TO_CONCEPT: dict[str, str] = {
    alias: concept for concept, aliases in _CONCEPT_ALIASES.items() for alias in aliases
}


def extend_aliases(concept: str, aliases: list[str] | tuple[str, ...]) -> int:
    """Register workspace aliases for *concept* (created if unknown).

    Loaded from the workspace curation skill pack at build time. Built-in
    aliases always win on conflict. Returns how many aliases were added.
    """
    added = 0
    concept = concept.strip()
    if not concept:
        return 0
    existing = set(_CONCEPT_ALIASES.get(concept, frozenset()))
    for alias in aliases:
        key = _fold(str(alias).strip())
        if not key or key in _ALIAS_TO_CONCEPT:
            continue
        _ALIAS_TO_CONCEPT[key] = concept
        existing.add(key)
        added += 1
    if added:
        _CONCEPT_ALIASES[concept] = frozenset(existing)
    return added


def canonical_concept(table: str, label: str | None = None) -> str | None:
    """The business concept *table* represents, or None when unknown.

    Matches (in order): the connector label, the full normalised base name,
    its singular, and the last token — so ``crm_accounts``, the Salesforce
    ``Account`` label and ``legacy_customers`` all return "Customer".
    """
    candidates: list[str] = []
    if label and label.strip():
        norm_label = "_".join(t for t in _TOKEN_RE.split(_fold(label.strip())) if t)
        candidates += [norm_label, _singular(norm_label)]
    toks = _tokens(table)
    if toks:
        base = "_".join(toks)
        candidates += [base, _singular(base), toks[-1], _singular(toks[-1])]
    for cand in candidates:
        concept = _ALIAS_TO_CONCEPT.get(cand)
        if concept:
            return concept
    return None


def concept_aliases(concept: str) -> frozenset[str]:
    """All NL aliases for *concept* (empty set when the concept is unknown)."""
    return _CONCEPT_ALIASES.get(concept, frozenset())


def known_concepts() -> list[str]:
    """All canonical concept names, sorted (for validation and UI pickers)."""
    return sorted(_CONCEPT_ALIASES)


def resolve_concept_name(raw: str) -> str | None:
    """Resolve a user-typed concept ("customer", "Clienti") to its canonical
    concept name ("Customer"). Accepts the concept name itself or any alias."""
    folded = _fold(raw.strip())
    for concept in _CONCEPT_ALIASES:
        if folded == concept.lower():
            return concept
    return _ALIAS_TO_CONCEPT.get(folded) or _ALIAS_TO_CONCEPT.get(_singular(folded))
