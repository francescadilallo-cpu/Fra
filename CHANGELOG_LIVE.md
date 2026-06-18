# Live Version — Change Log

This file tracks every change made to the **live** (sellable) version of the
product, newest first. Each entry lists the files touched and the intent, so
work is traceable across sessions and the git history is easy to reconcile.

> Live mode = real user data (JWT `mode="live"`). Demo mode = curated sample
> data. Changes here must improve what *live* users see, without leaking demo
> content.

---

## 2026-06-18

### Fix demo content leaks in MappingView and ProcessView
- `frontend/src/components/MappingView.tsx`
  - `SemanticDefinitionsPanel`: initial state was `DEMO_DEFS` unconditionally — live users would see AdventureWorks field definitions flash on every load. Now starts empty for live mode; shows a loading spinner while fetching, then a proper "No semantic definitions yet" empty state.
  - `AmbiguityLogPanel`: same bug — initial state was `DEMO_AMBIGUITIES`. Now starts empty for live; shows spinner, then "No ambiguities documented" empty state.
  - Field Mappings column header: renamed from "ERP Field" (demo-specific) to "Source Field".
- `frontend/src/components/ProcessView.tsx`
  - Lifecycle stage avg-days indicator (`0.5 d`, `2.1 d`, …) was shown for live users. Now hidden unless `IS_DEMO_MODE`.
  - Pipeline completion summary: "Entities Mapped" now uses real `liveConfig.ontology.nodes.length`; "KG Edges Indexed" uses real `liveConfig.ontology.edges.length` instead of `'0'`; "3 cross-source bridges" sub-text replaced with dynamic relationship count for live users.

### Remove AdventureWorks leaks from the live Overview "Solution" section
- `frontend/src/components/OverviewScreen.tsx` — the Solution cards rendered for all modes hardcoded demo specifics that live customers could see. Made them live-aware:
  - "Cross-source Knowledge Graph" now describes the user's *real* connected systems (`connectors.join(' ↔ ')`) and KG node/edge counts instead of `PLACED_BY, SOLD_BY, OF_PRODUCT link ERP↔CRM↔HR↔PIM`.
  - "Semantic Definitions" drops the `"fatturato"` example in live mode, using a generic phrasing.

---

## 2026-06-17

### Data-driven disambiguation card for live ambiguities
- `frontend/src/data/queryEngine.ts` — added `candidates?: string[]` to `EngineResult`.
- `frontend/src/api/semantic.ts` — plumb backend `candidates` through `adaptAskResult`; prefer the human-readable `notes` explanation in the summary box.
- `frontend/src/components/QueryInterface.tsx` — `DisambiguationCard` now renders the backend's real candidate metric definitions (2- or 3-up grid) instead of the hardcoded demo "Net Revenue vs Gross Revenue" scenario; demo card kept as fallback for the local engine path.

### Live Dashboard: real Data Sources, Data Entities, KPI cards
- `frontend/src/api/semantic.ts` — added `DataStoreStatus` interface + `getDataStoreStatus()` (`GET /api/data/store/status`).
- `frontend/src/components/Dashboard.tsx`
  - Data Sources panel shows real table counts and row counts (prefix-matched per connector) instead of hardcoded `0 tables / '—' rows`.
  - Fixed currency bug: live entity row counts render as plain numbers with a "rows" suffix, not USD.
  - "Recent Records" → "Data Entities" (Database icon) in live mode.
  - 4th KPI card shows the `date_range` stat from `kpi_stats` when available, else entity count.
  - Activity feed gains a data-store entry (total rows / table count).

---

<!--
Template for new entries:

## YYYY-MM-DD

### Short title of the change
- `path/to/file` — what changed and why.
-->
