"""GraphRAG retrieval over the in-process Knowledge Graph.

Given a natural-language question, lexically link it to *type-level* KG nodes
(tables, ``Concept`` and ``Metric`` nodes), extract the touching sub-graph
(FK/manual relations, ``DESCRIBES``, ``MEASURES``) and render a compact,
grounded-context block that is injected into the LLM SQL-generation prompt.

KG-only and dependency-free: lexical entity-linking, no embeddings/vector DB —
in keeping with the memory-bounded deployment. Degrades to an empty context when
nothing matches, so callers can append it unconditionally.
"""

from __future__ import annotations

import difflib
import re
from typing import Any

from app.semantic.canonical import canonical_concept, concept_aliases

_MIN_TOKEN = 3
_MAX_NODES = 8
_MAX_EDGES_PER_NODE = 6
# Conservative similarity for the fuzzy fallback (catches typos/morphological
# variants like "custmers"→"customers" without false positives). Stdlib only —
# no embeddings/dependencies, so it stays light on memory-bounded deployments.
_FUZZY_CUTOFF = 0.86

# Small stopword set (EN + a few IT) so generic words don't match node labels.
_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "what",
    "which",
    "how",
    "many",
    "much",
    "are",
    "was",
    "were",
    "per",
    "into",
    "all",
    "any",
    "show",
    "list",
    "give",
    "tell",
    "top",
    "count",
    "total",
    "average",
    "sum",
    "che",
    "con",
    "per",
    "dei",
    "delle",
    "degli",
    "come",
    "quanti",
    "quante",
    "sono",
    "del",
    "della",
    "una",
    "uno",
    "gli",
    "the",
}


def _tokenize(question: str) -> list[str]:
    toks = re.findall(r"[a-zA-Z0-9_]+", (question or "").lower())
    return [t for t in toks if len(t) >= _MIN_TOKEN and t not in _STOPWORDS]


def _display_label(node_id: str, attrs: dict) -> str:
    if attrs.get("canonical_id") == "__schema__":
        return str(attrs.get("table") or node_id.split(":")[0])
    return str(attrs.get("label") or attrs.get("canonical_id") or node_id)


def _kind(attrs: dict) -> str:
    et = str(attrs.get("entity_type") or "")
    if et == "Concept":
        return "concept"
    if et == "Metric":
        return "metric"
    return "table"


def _node_table(node_id: str, attrs: dict) -> str | None:
    """The data table a node belongs to (None for concept/metric nodes)."""
    if attrs.get("canonical_id") == "__schema__":
        return str(attrs.get("table") or node_id.split(":")[0])
    if _kind(attrs) == "table":
        return str(attrs.get("table") or node_id.split(":")[0])
    return None


def build_graph_context(
    kg: Any,
    question: str,
    hidden_tables: frozenset[str] = frozenset(),
    max_nodes: int = _MAX_NODES,
) -> dict[str, Any]:
    """Return ``{context, nodes, edges}`` for *question* against *kg*.

    ``context`` is a prompt-ready text block (empty when nothing matches);
    ``nodes``/``edges`` capture what was retrieved, for provenance/citations.
    """
    empty = {"context": "", "nodes": [], "edges": [], "tables": []}
    if kg is None or not question:
        return empty
    try:
        all_nodes = kg.all_nodes()
    except Exception:  # noqa: BLE001 — retrieval must never break a query
        return empty

    tokens = set(_tokenize(question))
    q_lower = (question or "").lower()
    if not tokens:
        return empty

    # ── Index type-level nodes (tables, concepts, metrics) by label/word ──────
    attrs_by_id: dict[str, dict] = {}
    label_to_node: dict[str, str] = {}

    def _index(label: str, node_id: str, prefer: bool) -> None:
        key = label.strip().lower()
        if key and (prefer or key not in label_to_node):
            label_to_node[key] = node_id

    for node_id, attrs in all_nodes:
        is_table = attrs.get("canonical_id") == "__schema__"
        kind = _kind(attrs)
        if not (is_table or kind in ("concept", "metric")):
            continue  # skip per-row data nodes — keep linking type-level
        attrs_by_id[node_id] = attrs
        label = _display_label(node_id, attrs)
        _index(label, node_id, prefer=is_table)
        if is_table:
            _index(str(attrs.get("entity_type") or ""), node_id, prefer=True)
        # Index synonyms and significant words of multi-word labels. Words are
        # split on underscores too, so snake_case table names link by their
        # components ("top accounts" → sf_account, sales_order_header → "order").
        for syn in attrs.get("synonyms") or []:
            _index(str(syn), node_id, prefer=False)
        for word in re.findall(r"[a-z0-9]+", label.lower()):
            if len(word) >= _MIN_TOKEN and word not in _STOPWORDS:
                _index(word, node_id, prefer=False)

    # ── Canonical-concept aliases (weakest tier, exact-match only) ────────────
    # A table whose name resolves to a business concept is reachable by every
    # alias of that concept, in any listed language — "clienti"/"customers"/
    # "account" all land on the same unified entity regardless of the physical
    # table name. Kept in a separate index so aliases never shadow real
    # labels/synonyms and never enter the fuzzy-match pool.
    alias_to_node: dict[str, str] = {}
    for node_id, attrs in attrs_by_id.items():
        if attrs.get("canonical_id") != "__schema__":
            continue
        table = _node_table(node_id, attrs) or ""
        concept = canonical_concept(table) if table else None
        if concept:
            for key in {concept.lower(), *concept_aliases(concept)}:
                alias_to_node.setdefault(key, node_id)

    def _match(word: str) -> str | None:
        return (
            label_to_node.get(word)
            or label_to_node.get(word.rstrip("s"))
            or label_to_node.get(word + "s")
            or alias_to_node.get(word)
            or alias_to_node.get(word.rstrip("s"))
            or alias_to_node.get(word + "s")
        )

    # ── Entity-linking: collect matched nodes (stable order, capped) ──────────
    matched: list[str] = []
    seen: set[str] = set()

    def _add(node_id: str | None) -> None:
        if node_id and node_id not in seen and node_id in attrs_by_id:
            seen.add(node_id)
            matched.append(node_id)

    # Multi-word labels contained verbatim in the question rank first.
    for label, node_id in label_to_node.items():
        if " " in label and label in q_lower:
            _add(node_id)
    # Exact (with singular/plural) match, then a conservative fuzzy fallback for
    # tokens that didn't match — catches typos / morphological variants.
    label_keys = list(label_to_node.keys())
    for tok in tokens:
        nid = _match(tok)
        if nid is None:
            close = difflib.get_close_matches(
                tok, label_keys, n=1, cutoff=_FUZZY_CUTOFF
            )
            if close:
                nid = label_to_node.get(close[0])
        _add(nid)

    # Drop hidden-table nodes; cap.
    visible = [
        nid
        for nid in matched
        if _node_table(nid, attrs_by_id[nid]) not in hidden_tables
    ][:max_nodes]
    if not visible:
        return empty

    # ── Sub-graph extraction: edges touching matched nodes ────────────────────
    node_table: dict[str, str | None] = {}
    label_cache: dict[str, str] = {}
    for nid, attrs in all_nodes:
        node_table[nid] = _node_table(nid, attrs)
        label_cache[nid] = _display_label(nid, attrs)

    adjacency: dict[str, list[tuple[str, str, str]]] = {}
    try:
        for src, dst, data in kg.iter_edges():
            etype = str(data.get("type") or "")
            adjacency.setdefault(src, []).append((dst, etype, "out"))
            adjacency.setdefault(dst, []).append((src, etype, "in"))
    except Exception:  # noqa: BLE001
        adjacency = {}

    def _rel_phrase(other_id: str, etype: str, direction: str) -> str | None:
        other_tbl = node_table.get(other_id)
        if other_tbl is not None and other_tbl in hidden_tables:
            return None
        other = label_cache.get(other_id, other_id)
        if etype.startswith("FK"):
            via = etype[3:] if etype.startswith("FK_") else ""
            return f"related to {other}" + (f" (via {via})" if via else "")
        if etype == "DESCRIBES":
            return (
                f"describes {other}"
                if direction == "out"
                else f"described by concept {other}"
            )
        if etype == "MEASURES":
            return (
                f"measures {other}"
                if direction == "out"
                else f"measured by metric {other}"
            )
        if etype == "SAME_AS":
            # Cross-source entity merge: both tables describe the same records.
            return f"same entity as {other} (cross-source — same records)"
        return f"linked to {other}"

    lines: list[str] = []
    out_edges: list[dict] = []
    out_nodes: list[dict] = []
    rel_tables: list[str] = []

    def _add_table(name: str | None) -> None:
        if name and name not in rel_tables:
            rel_tables.append(name)

    for nid in visible:
        attrs = attrs_by_id[nid]
        kind = _kind(attrs)
        label = label_cache[nid]
        out_nodes.append({"id": nid, "label": label, "kind": kind})
        _add_table(node_table.get(nid))  # the matched node's own data table
        phrases: list[str] = []
        for other_id, etype, direction in adjacency.get(nid, [])[:_MAX_EDGES_PER_NODE]:
            phrase = _rel_phrase(other_id, etype, direction)
            if phrase:
                phrases.append(phrase)
                _add_table(node_table.get(other_id))  # FK/described/measured table
                out_edges.append(
                    {
                        "from": label,
                        "to": label_cache.get(other_id, other_id),
                        "type": etype,
                    }
                )
        suffix = f" — {'; '.join(dict.fromkeys(phrases))}" if phrases else ""
        qualifier = "table" if kind == "table" else kind
        lines.append(f"- {label} ({qualifier}){suffix}.")

    context = (
        "### Knowledge graph context (grounded model — use these names and links)\n"
        + "\n".join(lines)
    )
    return {
        "context": context,
        "nodes": out_nodes,
        "edges": out_edges,
        "tables": rel_tables,
    }
