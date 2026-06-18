# Live Version — Change Log

This file tracks every change made to the **live** (sellable) version of the
product, newest first. Each entry lists the files touched and the intent, so
work is traceable across sessions and the git history is easy to reconcile.

> Live mode = real user data (JWT `mode="live"`). Demo mode = curated sample
> data. Changes here must improve what *live* users see, without leaking demo
> content.

---

## 2026-06-18

### ProcessView: fix connector count in post-run summary for live users
- `frontend/src/components/ProcessView.tsx`
  - The "Rows Extracted" summary card showed `sector.connectors.length` (AW-specific: 4) as a fallback when `liveConfig` was not yet loaded. Live users without a backend response would briefly see "4 sources connected" even with 0 real connectors.
  - Fixed: fallback is now `IS_DEMO_MODE ? sector.connectors : []`, so live users see "0 sources connected" accurately.

### OntologyGraph: fix AW entity name leaking into MCP tool spec for live users
- `frontend/src/components/OntologyGraph.tsx`
  - The MCP Server tool schema (`list_entities`) showed an example class URI using `sector.ontology.nodes[0]?.data.label` as a fallback when no extended ontology nodes existed. For a live manufacturing-sector user with no ontology built yet, this would surface the first AW entity label (e.g. "SalesOrderHeader") in the exported API spec.
  - Fixed: fallback to `sector.ontology.nodes[0]?.data.label` is now guarded by `IS_DEMO_MODE`, so live users see the generic `'Entity'` placeholder.

### MappingView: replace AW-specific form placeholders with generic examples
- `frontend/src/components/MappingView.tsx`
  - "Add Definition" form had `placeholder="e.g. SalesOrder"` (entity) and `placeholder="e.g. subtotal_amount"` (field) — both AdventureWorks-specific field names visible to all live users.
  - Replaced with generic: `"e.g. Customer"` and `"e.g. revenue"`.

### QueryInterface: guard AW-specific disambiguation fallback from live users
- `frontend/src/components/QueryInterface.tsx`
  - `DisambiguationCard` had a demo-only fallback (hardcoded "fatturato" / revenue disambiguation from AdventureWorks) that was not guarded against live mode. A live user running a query via the LLM path that triggered `isDisambiguation:true` without structured candidates would have seen AW-specific content in their workspace.
  - Now: for live users with no structured candidates, shows a generic "Ambiguous term — can you be more specific?" message with a link to the Semantic Layer Definitions tab. The AW-specific fallback is retained under the `IS_DEMO_MODE` guard.

### DataExplorer: clear empty state for live users instead of empty table
- `frontend/src/components/DataExplorer.tsx`
  - When a live user selects an entity, the DataTable previously rendered a table header with 0 rows and a broken "Download CSV" button (empty file). Live users can't load row-level data in the browser.
  - Now shows a centred empty state: entity name, "No row-level preview available" message explaining the limitation, and an "Open in Query AI" button that pre-fills a `SELECT * FROM <table> LIMIT 20` query and navigates to the Query AI tab.

### SemanticLayerView: proper empty state for Field Mappings tab
- `frontend/src/components/SemanticLayerView.tsx`
  - Field Mappings tab showed "No mappings match your search." even when no search was active and the semantic layer hadn't been built. Now shows a distinct "No field mappings yet" empty state with a note to build from Data Sources, and reserves the "No mappings match your search" message for when a search filter is active but yields no results.

### Dashboard: welcome banner and agent panel copy corrected for live mode
- `frontend/src/components/Dashboard.tsx`
  - Welcome banner subtitle was "Your semantic layer is ready · 0 entities" for fresh live workspaces → now "Connect a data source to start building your semantic layer" when no entities exist.
  - AgentIntelligence panel "No agents run yet for this sector." → "No agents run yet." in live mode; CTA "Go to Agents →" → "Create your first agent →".

### Dashboard: welcome banner shows accurate status for fresh live workspaces
- `frontend/src/components/Dashboard.tsx`
  - Welcome banner subtitle was always "Your semantic layer is ready · N entities" — for a live workspace with 0 entities this reads "ready · 0 entities" which is incorrect.
  - In live mode: shows "Semantic layer active · N entities" when entities exist, or "Connect a data source to start building your semantic layer" when none do.
  - Demo mode keeps the original "ready" wording unchanged.

### OntologyGraph: empty state for live workspaces with no built ontology
- `frontend/src/components/OntologyGraph.tsx`
  - Added `onNavigate?: (tab: NavTab) => void` prop.
  - When `IS_DEMO_MODE=false` and no ontology nodes exist, an overlay card appears on the graph canvas guiding users to either "Connect a data source →" or "Build manually with AI".
  - Previously: live users with no semantic layer saw a blank ReactFlow canvas with no next-step guidance.
- `frontend/src/App.tsx` — passes `onNavigate={setActiveTab}` to `<OntologyGraph />`.

### ConfigurationView: fake connector test disabled in live mode
- `frontend/src/components/ConfigurationView.tsx`
  - `testConnection` is now a no-op in live mode — clicking Test no longer simulates fake latency/success results for customers with unconnected sources.
  - `ConnectorCard` Test button is only rendered when the connector is `connected`; live users see clean "Available" status without a misleading clickable Test action.

### UseCasesView: demo CTAs hidden from live users; workspace corruption fixed
- `frontend/src/components/UseCasesView.tsx`
  - `loadScenario` (the "Load scenario → Dashboard" CTA) is now guarded by `IS_DEMO_MODE`: it no longer overwrites a live user's `si-company-name` in localStorage with "AdventureWorks Cycles".
  - `handleDemoQuery` similarly guarded so "Try live in Query AI →" never fires in live mode.
  - Live users see a single "Replicate this with your data →" CTA on each case card that navigates to Data Sources — actionable next step without leaking demo state.

### AdminSections: real webhook test replaces simulated delay
- `frontend/src/components/AdminSections.tsx`
  - `testChannel` converted from sync fake (`setTimeout`) to `async` function: live mode now calls `apiTestChannel(id)` (real HTTP POST via backend `httpx` client), shows actual latency from the backend response.
  - Added `'error'` to `ChannelTest` state union; renders "Test failed — could not reach destination" in red when the backend returns an error.
  - Demo mode keeps the simulated delay path; live mode uses the real endpoint.
  - "Last test: a few hours ago" placeholder replaced with `—` (no stale/fake timestamp shown to live users).

### ProcessView: onNavigate prop, conversion rate fix, empty-state CTA
- `frontend/src/components/ProcessView.tsx`
  - Added `onNavigate?: (tab: NavTab) => void` prop (imported `NavTab` from `types/index`).
  - "No active cases yet" empty state gains a "Connect a data source →" CTA button wired to `onNavigate('sources')`.
  - Conversion rate footer: no longer shows `0%` when funnel is empty — renders `—` instead.
  - Added `ArrowRight` to lucide imports.
- `frontend/src/App.tsx` — passes `onNavigate={setActiveTab}` to `<ProcessView />`.

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

### Dashboard: empty states for fresh live workspaces
- `frontend/src/components/Dashboard.tsx`
  - "Recent Activity" panel: added a guided empty state for live users who have not yet connected any sources (was silently empty).
  - "Data Entities" panel: added an empty state that links to the semantic layer builder.
  - "Data Sources" panel: added an empty state that links to the sources view when no connectors are configured yet.

### DataExplorer: real entity row counts from backend for live users
- `frontend/src/components/DataExplorer.tsx`
  - `row_count` for live ontology nodes was always `0` (hardcoded in `buildExtendedOntology` for extension nodes). Now fetches `getLiveConfig()` on mount in live mode and overlays real `row_count` values from `liveConfig.ontology.nodes`, keyed by entity label.
  - The header "N records in production DB" badge now shows accurate counts for live users with a built semantic layer.

### ComplianceView: fix misleading 100% scores and add empty-state CTA
- `frontend/src/components/ComplianceView.tsx`
  - `ScoreBar` showed 100% GDPR/EU AI Act compliance for fresh live workspaces (formula gives 100 when no entities are assessed). Added `unassessed` prop that renders "Not assessed" instead of a fake perfect score.
  - GDPR Data Map empty state ("No entities classified yet") now shows a CTA linking to Data Sources for live users, so they know the next step.
  - Added `onNavigate` prop (optional) so the CTA can trigger tab navigation.
- `frontend/src/App.tsx` — wires `onNavigate` to `ComplianceView`.

### AgentsView: custom agent metrics use real entity row counts
- `frontend/src/components/AgentsView.tsx`
  - `customToAgentDef` previously returned hardcoded result metrics (`'840' records checked`, `'5' alerts triggered`, etc.) visible to live users who run custom agents. Now accepts `rowCounts: Record<string, number>` and derives metric values from the actual row count of the agent's primary entity.
  - Fetches `getLiveConfig()` on mount in live mode and builds a `liveRowCounts` map from ontology node row counts, passed through to all `customToAgentDef` call sites (including scheduled/event-triggered runs).
  - Falls back to `'—'` for any entity with no known row count rather than showing a fake number.

### SemanticDraftView: actionable empty state for Metrics tab
- `frontend/src/components/SemanticDraftView.tsx`
  - "No metrics defined yet" message now links to the Data Sources tab and explains the two ways to add metrics, instead of just saying "Add them manually or rebuild."

### Remove Italian text leaks from QueryInterface and SemanticLayerView
- `frontend/src/components/QueryInterface.tsx`
  - LLM API key panel had three Italian strings shown to all users (demo and live): "chiave salvata solo nel browser", "ottieni la chiave gratuita →", and "Salva" button label. Replaced with English equivalents.
- `frontend/src/components/SemanticLayerView.tsx`
  - "Add disambiguation rule" form placeholder was `"revenue" / "fatturato"` — the Italian/AW-specific term was shown to live users as a hint. Changed to generic `"revenue" / "net_sales"`.

### ProcessView: real KG node/edge counts in pipeline completion summary
- `frontend/src/components/ProcessView.tsx`
  - `semanticStatus()` was already fetched on load but only used to build pipeline logs. Now also stored in `kgStatus` state.
  - Pipeline completion summary "KG Nodes Created" and "KG Edges Indexed" cards now show real `kgStatus.kg_nodes` / `kgStatus.kg_edges` for live users instead of the demo `summary.enrichments` / `summary.triples` values.
  - Fallback chain: real KG count → ontology edge count → 0.

### SemanticLayerView: real KG node/edge counts from backend
- `frontend/src/components/SemanticLayerView.tsx`
  - Overview stat cards "KG Nodes" and "KG Edges" were using estimated values for live users (`totalRows` and `edgeCount * 8`). Now calls `semanticStatus()` on load and uses real `kg_nodes` / `kg_edges` from the backend, falling back to the estimates only if the API returns nothing.

### Remove demo content leaks from AgentsView and DataExplorer
- `frontend/src/components/AgentsView.tsx`
  - `ExecutiveActionsPanel` example text was Italian AdventureWorks commands ("Sposta la data di consegna…") — visible to live admin users because the panel is only shown in live mode. Replaced with generic English examples.
- `frontend/src/components/DataExplorer.tsx`
  - AW source system badge ("CRM — ClientHub", "ERP — OrionSales", "HR — CSV (IT schema)") was rendered for any user whose selected entity matched `AW_SOURCE_MAP` — no mode guard. Added `IS_DEMO_MODE &&` so the badge only appears in demo workspaces.

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
