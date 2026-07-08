"""Curation engine — deterministic keep/exclude classifier for schema tables.

Runs AFTER the connector-level hard filters and BEFORE the Knowledge Graph /
data model are built. Pure and explainable: every decision carries the rule id
or signal that produced it, so the curation report can always answer "why is
this table (not) in my model?".

Decision precedence per table:
  1. pinned user decision (never touched)
  2. protected tables (manual relations, user naming overrides, metric refs)
  3. workspace pack keep / exclude rules
  4. source-type pack + generic pack keep rules
  5. source-type pack + generic pack exclude rules
  6. structural signals (canonical concept, rows, declared FK connectivity,
     column count) → kept or uncertain (policy-controlled)

The workspace pack (``data_dir()/curation_workspace.yaml``) is the editable
"skill" layer: rules and concept aliases a customer adds without a deploy.
Its ``aliases`` section extends the canonical concept dictionary, e.g.::

    aliases:
      Customer: [paziente, pazienti]
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from ..paths import data_dir
from ..semantic.canonical import canonical_concept, extend_aliases
from .store import CurationStore, get_curation_store

logger = logging.getLogger(__name__)

_SKILLS_DIR = Path(__file__).parent / "skills"
_WORKSPACE_PACK = "curation_workspace.yaml"


@dataclass
class _Rule:
    rule_id: str
    pattern: re.Pattern
    pack: str


@dataclass
class SkillPack:
    name: str
    keep: list[_Rule] = field(default_factory=list)
    exclude: list[_Rule] = field(default_factory=list)
    min_columns: int = 2
    uncertain_policy: str = "keep"  # "keep" | "exclude"
    aliases: dict[str, list[str]] = field(default_factory=dict)


def _parse_pack(raw: dict, name: str) -> SkillPack:
    def _rules(section: str) -> list[_Rule]:
        rules = []
        for entry in raw.get(section) or []:
            try:
                rules.append(
                    _Rule(
                        rule_id=str(entry["id"]),
                        pattern=re.compile(str(entry["pattern"]), re.IGNORECASE),
                        pack=name,
                    )
                )
            except (KeyError, re.error) as exc:
                logger.warning(
                    "skill pack %s: bad rule %r skipped (%s)", name, entry, exc
                )
        return rules

    signals = raw.get("signals") or {}
    aliases_raw = raw.get("aliases") or {}
    aliases = {
        str(concept): [str(a) for a in (alias_list or [])]
        for concept, alias_list in aliases_raw.items()
        if isinstance(alias_list, (list, tuple))
    }
    return SkillPack(
        name=name,
        keep=_rules("keep"),
        exclude=_rules("exclude"),
        min_columns=int(signals.get("min_columns", 2) or 2),
        uncertain_policy=str(signals.get("uncertain_policy", "keep")).strip().lower(),
        aliases=aliases,
    )


def load_pack(path: Path, name: str) -> SkillPack | None:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except FileNotFoundError:
        return None
    except Exception as exc:  # noqa: BLE001 — a broken pack must not brick builds
        logger.warning("skill pack %s unreadable: %s", path, exc)
        return None
    if not isinstance(raw, dict):
        return None
    return _parse_pack(raw, name)


def load_packs(source_types: set[str]) -> list[SkillPack]:
    """Workspace pack first (highest priority), then per-source-type packs,
    then the generic pack. Also registers workspace aliases with the
    canonical dictionary as a side effect."""
    packs: list[SkillPack] = []
    ws = load_pack(data_dir() / _WORKSPACE_PACK, "workspace")
    if ws is not None:
        packs.append(ws)
        for concept, aliases in ws.aliases.items():
            extend_aliases(concept, aliases)
    for st in sorted(source_types):
        p = load_pack(_SKILLS_DIR / f"{st}.yaml", st)
        if p is not None:
            packs.append(p)
    generic = load_pack(_SKILLS_DIR / "generic.yaml", "generic")
    if generic is not None:
        packs.append(generic)
    return packs


def workspace_pack_path() -> Path:
    return data_dir() / _WORKSPACE_PACK


# ── Classification ────────────────────────────────────────────────────────────


def _match(rules: list[_Rule], table: str) -> _Rule | None:
    for rule in rules:
        if rule.pattern.search(table):
            return rule
    return None


def run_curation(
    schema: dict[str, dict],
    *,
    source_types: set[str] | None = None,
    relations: list[dict] | None = None,
    labels: dict[str, str] | None = None,
    protected: set[str] | None = None,
    store: CurationStore | None = None,
) -> dict[str, dict]:
    """Classify every table in *schema* and persist the decisions.

    ``relations`` are declared FK relations (``from_table``/``to_table``) used
    as the connectivity signal; ``protected`` tables are always kept (they
    carry user work: manual relations, naming overrides, metric references).
    Returns the full decision map after the run.
    """
    store = store or get_curation_store()
    packs = load_packs(source_types or set())
    relations = relations or []
    labels = labels or {}
    protected = protected or set()

    connected: set[str] = set()
    for rel in relations:
        connected.add(str(rel.get("from_table", "")))
        connected.add(str(rel.get("to_table", "")))

    # Signal thresholds: the most specific pack wins (workspace > source > generic).
    min_columns = packs[0].min_columns if packs else 2
    uncertain_policy = next(
        (
            p.uncertain_policy
            for p in packs
            if p.uncertain_policy in ("keep", "exclude")
        ),
        "keep",
    )

    keep_rules = [r for p in packs for r in p.keep]
    exclude_rules = [r for p in packs for r in p.exclude]

    for table, info in schema.items():
        if table in protected:
            store.set_decision(
                table, "kept", "protected:user-curated", decided_by="rule"
            )
            continue

        rule = _match(keep_rules, table)
        if rule is not None:
            store.set_decision(
                table, "kept", f"rule:{rule.pack}/{rule.rule_id}", decided_by="rule"
            )
            continue
        rule = _match(exclude_rules, table)
        if rule is not None:
            store.set_decision(
                table,
                "excluded",
                f"rule:{rule.pack}/{rule.rule_id}",
                decided_by="rule",
            )
            continue

        # Structural signals
        concept = canonical_concept(table, labels.get(table))
        if concept:
            store.set_decision(
                table,
                "kept",
                f"signal:canonical-concept:{concept}",
                decided_by="signal",
            )
            continue
        row_count = int(info.get("row_count") or 0)
        if row_count > 0:
            store.set_decision(
                table, "kept", f"signal:has-rows:{row_count}", decided_by="signal"
            )
            continue
        if table in connected:
            store.set_decision(
                table, "kept", "signal:fk-connected", decided_by="signal"
            )
            continue
        n_cols = len(info.get("columns") or [])
        if n_cols < min_columns:
            store.set_decision(
                table,
                "excluded",
                f"signal:too-few-columns:{n_cols}<{min_columns}",
                decided_by="signal",
            )
            continue

        # No positive signal: uncertain — policy decides visibility.
        status = "excluded" if uncertain_policy == "exclude" else "uncertain"
        store.set_decision(
            table,
            status,  # type: ignore[arg-type]
            "signal:no-business-signal",
            decided_by="signal",
        )

    return store.all_decisions()


def curation_report(
    store: CurationStore | None = None,
    schema_tables: set[str] | None = None,
) -> dict[str, Any]:
    """Summarise decisions for the API/UI report. When *schema_tables* is
    given, decisions for tables that no longer exist are omitted."""
    store = store or get_curation_store()
    decisions = store.all_decisions()
    if schema_tables is not None:
        decisions = {t: d for t, d in decisions.items() if t in schema_tables}
    by_status: dict[str, list[dict]] = {"kept": [], "excluded": [], "uncertain": []}
    for table, d in sorted(decisions.items()):
        entry = {"table": table, **d}
        by_status.setdefault(d.get("status", "kept"), []).append(entry)
    return {
        "kept": by_status["kept"],
        "excluded": by_status["excluded"],
        "uncertain": by_status["uncertain"],
        "counts": {k: len(v) for k, v in by_status.items()},
    }
