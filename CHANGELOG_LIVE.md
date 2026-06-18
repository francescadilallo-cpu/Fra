# Live Version — Change Log

This file tracks every change made to the **live** (sellable) version of the
product, newest first. Each entry lists the files touched and the intent, so
work is traceable across sessions and the git history is easy to reconcile.

> Live mode = real user data (JWT `mode="live"`). Demo mode = curated sample
> data. Changes here must improve what *live* users see, without leaking demo
> content.

---

## 2026-06-18

### Frontend: QueryInterface — "no sources" CTA for fresh live workspaces
- `frontend/src/components/QueryInterface.tsx`
  - Added `questionsLoaded` state so the component knows when the example-questions fetch has settled.
  - When a live user has no data sources connected, the backend returns an empty array from `/api/semantic/example-questions`. Previously the suggestions section was silently hidden. Now a "No data sources connected yet" hint is shown with a "Go to Sources" inline link that fires `navigate-to-tab` → `sources`.
  - The hint only appears when: `!IS_DEMO_MODE && questionsLoaded && exampleQuestions.length === 0 && backendOnline === true` — i.e., never flashes during loading, never shown in demo mode, never shown when the backend is confirmed offline (the existing "No data source connected" amber banner already handles that case).
  - Added `Database` icon import from `lucide-react`.

### Frontend: consistent `backendErrorMessage()` usage across all catch blocks
- `frontend/src/components/ContextTab.tsx`
  - Added import: `backendErrorMessage` from `'../api/semantic'`.
  - 4 catch blocks (uploadDocument, createEntity, createMetric, createGlossaryTerm) were using inline `(e as ...).response?.data?.detail` extraction. Replaced all with `backendErrorMessage(e)`, which correctly handles FastAPI validation arrays, nested `detail.message`, and 500/503 status codes.
- `frontend/src/components/DataSourcesView.tsx`
  - `listSources` catch (line ~557) was using `err?.response?.data?.detail`. Replaced with `backendErrorMessage(err)`.
- `frontend/src/components/AgentsView.tsx`
  - `executeAgentCommand` catch was using a deep `?.response?.data?.detail?.message` extraction. Replaced with `backendErrorMessage(e)` (already handles `detail.message` objects). Added `backendErrorMessage` to the existing `semantic` import.

### Frontend: extend 401 dedup guard to agents and queries API modules
- `frontend/src/api/agents.ts`, `frontend/src/api/queries.ts`
  - Both modules had their own inline 401 interceptors (`clearAuthToken(); window.dispatchEvent(new CustomEvent('logout-requested'))`) that bypassed the shared `handle401()` dedup guard added in an earlier commit. If the agents and queries axios instances all fired 401 simultaneously, each module would trigger its own `logout-requested` event. Replaced both with `handle401(status)` so all four axios instances (client, semantic, agents, queries) share the same dedup lock.

### Config: workspace setup UX improvements for new live users
- `frontend/src/components/AdminSections.tsx`
  - `WorkspaceSection`: added `id="workspace-section"` to the section element so the header CTA can scroll directly to it.
  - Company name input placeholder: `"Company name"` → `"e.g. Acme Corp"` — more immediately scannable for users who haven't set one.
- `frontend/src/components/Layout.tsx`
  - "Set up workspace" header CTA: now scrolls to `#workspace-section` with `scrollIntoView()` (150 ms delay to allow tab transition) after navigating to the Config tab. Without this, users landed at the top of a long Config page and had to discover the Workspace section by scrolling.

### Backend: fix Italian-language error messages shown to live English users
- `backend/app/main.py`
  - Rate limit (429) response: "Troppe richieste. Riprova tra poco." → "Too many requests — please wait a moment and try again."
  - `SemanticSecurityViolationError` (returned when the semantic layer blocks a query on security grounds): "Query semantica non valida o non autorizzata" → "This query is not available for your workspace." — consistent with the existing generic wording used in `layer.py` for the same exception class.

### Backend: semantic layer LLM SQL execution error no longer leaks DuckDB internals
- `backend/app/semantic/layer.py`
  - `_execute_llm_sql()`: when the generated SQL fails to execute against DuckDB, the catch block returned `answer=f"Query failed: {exc}"` — the raw DuckDB exception (could include column names, table internals, or parse errors) went directly into the user-visible answer field. Now returns "The query could not be executed. Please try rephrasing your question."; the full exception is still logged at WARNING level with the offending SQL.

### DataSourcesView: fix error handling and empty-state copy for live users
- `frontend/src/components/DataSourcesView.tsx`
  - Empty state for connected sources panel: "No additional sources connected" used the word "additional" which implied there were already some base sources — confusing for live users who have none. Live mode now reads "No sources connected yet".
  - Sources load error banner: appended the unconditional suffix "— connect a source below to start (auth required)" regardless of the actual error type (could be a 500, timeout, etc.). Removed the suffix; the error message from the server is sufficient.
  - Error handling in `submitCredentials`, `disconnectSource`, `syncById`, and `ingestCsv`: all four catch blocks used inline `(err as ...).response.data.detail ?? 'fallback'` extraction, bypassing the shared `backendErrorMessage()` utility (which handles FastAPI arrays, 500/503 fallbacks, and ECONNABORTED). Switched all four to use `backendErrorMessage()`.

### Backend: data_store_status and aw_engine no longer expose raw exceptions to users
- `backend/app/main.py`
  - `GET /api/data/store/status` (accessible by all authenticated users): catch block returned `{"error": str(exc)}` — the raw Python exception, potentially exposing file paths or internal state. Now returns `{"error": "Unable to load data store status"}` and logs the detail at ERROR level.
- `backend/app/query/aw_engine.py`
  - NL→SQL generation failure returned `"summary": f"Errore nella generazione della query: {exc}"` — an Italian-language message that included the raw exception (e.g. API auth errors). Now returns `"Impossibile generare la query — riprovare."` (generic Italian retry message); the full exception is still logged at ERROR level.

### Backend: ingester error messages improved for Excel, SQLite, and PostgreSQL failures
- `backend/app/connectors/duckdb_source_manager.py`
  - `_ingest_excel()`: wrapped `pd.read_excel()` in try/except; openpyxl/xlrd errors (corrupted file, wrong format) now surface as a readable ValueError ("Could not read Excel file…") instead of a raw internal traceback. Added an empty-DataFrame guard that raises ValueError("Excel file contains no rows") so users know immediately the sheet is blank.
  - `_ingest_sqlite_generic()`: wrapped `sqlite3.connect()` in try/except `sqlite3.Error`; connection failures (corrupted DB, wrong file type) now surface as "Could not open SQLite database…" instead of a raw C-level sqlite3 error.
  - `_ingest_postgresql()`: wrapped `psycopg2.connect()` in try/except `psycopg2.OperationalError`; connection refusals and auth failures now surface as "Could not connect to PostgreSQL: …" with the OperationalError detail (host, port, auth) rather than a raw psycopg2 exception.

### Frontend: fresh live workspace "Set up workspace" button in header
- `frontend/src/components/Layout.tsx`
  - When a live user has no company name set, the header now shows a dashed "Set up workspace" button (with a Building2 icon) that navigates to the Config tab. Previously the header was blank in this area, giving no indication that workspace setup was needed.

### Frontend: deduplicate 401 logout, fix error message quality
- `frontend/src/api/client.ts`
  - Added `handle401(status)` shared helper with a `_logoutPending` dedup guard. When multiple in-flight requests all fail with 401 simultaneously (token expired mid-session), only the first one clears the token and fires `logout-requested`; subsequent 401s are no-ops. Guard resets after 5 s so future logins work normally.
- `frontend/src/api/semantic.ts`
  - Removed the duplicated 401 interceptor; now calls `handle401()` from `client.ts` so both axios instances share the dedup guard.
  - `backendErrorMessage()`: fixed FastAPI pydantic validation errors — `detail` is an array of `{msg, type, loc}` objects; now joins `.msg` fields (was falling through to the raw axios message like "Request failed with status code 422"). Added friendly fallbacks for HTTP 500 ("Server error — please try again"), 503 ("Service temporarily unavailable"), and ECONNABORTED timeouts.
- `frontend/src/components/QueryInterface.tsx`
  - Error display: when a 401 is returned during a query, the axios interceptor already handles logout. The catch block no longer adds an error message to the chat for 401 responses (which would show briefly before the login screen replaced it).

### Backend: semantic layer data-provenance and template error messages no longer leak demo table names
- `backend/app/semantic/layer.py`
  - `_q_data_provenance()`: before this fix, asking "provenienza dati" / "fonte dati" / "aggiornato" in live mode returned ALL catalog entities including the full AdventureWorks table metadata. Now filters the entity list through `_thread_local.hidden_tables` (the same guard used everywhere else in the semantic layer) so live users only see entities from their own sources.
  - `_execute_template_query()`: when a template's SQL references a hidden demo table, `_validate_generated_sql()` raised `SemanticSecurityViolationError("…table outside this workspace: dipendenti_hr")` — the raw exception message (including the table name) was returned directly to the user. Now catches `SemanticSecurityViolationError` separately and returns "This template is not available for your workspace." Template execution errors (non-security) also return a generic message and log the detail at WARNING level.
  - LLM ontology mapping failure: when the ANTHROPIC_API_KEY is invalid or rate-limited, the raw provider error (`401 Authentication Error: invalid_api_key`) was included in the 422 response to the user. Now logs the provider error at ERROR level and raises a sanitised "The semantic service is temporarily unavailable. Please try again." message instead.

### Backend: semantic sources endpoint returns generic error messages
- `backend/app/main.py`
  - `/api/semantic/sources` DuckDB unified path: raw exception (could include file paths, connection strings, DuckDB internals) replaced with `"Unable to load source metadata"`; error logged at ERROR level.
  - Same for the legacy per-domain connector fallback path.

### Backend: parquet connector registered as implemented
- `backend/app/connectors/source_registry.py`
  - `parquet` had a full ingester (`_ingest_parquet`) in `duckdb_source_manager.py` but was absent from `IMPLEMENTED_CONNECTOR_TYPES`. This meant registering a parquet source would not trigger a rebuild, and the source would silently be skipped. Added `parquet` to the set so it flows through the normal add-source → rebuild path.

### SemanticDraftView: meaningful empty states for Entities and Relations tabs
- `frontend/src/components/SemanticDraftView.tsx`
  - EntitiesTab empty state: replaced one-liner "No entities detected — try rebuilding after connecting sources." with a centred card: explanatory text + "Connect a data source →" CTA using the `navigate-to-tab` event.
  - RelationsTab empty state: replaced flat text with the same pattern — explains FK auto-detection and links to Data Sources.

### AgentBuilder: empty entity list directs to correct next step
- `frontend/src/components/AgentBuilder.tsx`
  - "No entities in the ontology yet — add them in Ontology Builder first." misdirected live users to the Ontology Builder when the real first step is connecting a data source. Updated to: "No entities yet — connect a data source and run the pipeline, or build entities manually in the Ontology Builder."

### Backend: malformed AUTH_USERS_JSON_ENV returns 503 instead of silent 401
- `backend/app/main.py`
  - Previously: if `AUTH_USERS_JSON_ENV` was set but contained invalid JSON, an empty array, or all malformed entries, every login attempt returned 401 "Incorrect username or password" — indistinguishable from a bad password, locking all users out with no diagnostic signal.
  - Now: login returns 503 "AUTH_USERS_JSON_ENV is set but contains no valid user entries — check server configuration" when the env var parses to an empty user table, so operators immediately know the problem is configuration, not credentials.

### Backend: sync_source and rebuild_data_store return 501 for unsupported connector types
- `backend/app/main.py`
  - `POST /api/sources/{id}/sync`: previously caught all exceptions as 500. Now catches `NotImplementedError` specifically and returns 501 so callers know the connector type is not yet implemented, not that the server crashed.
  - `POST /api/data/store/rebuild`: previously had no error handling at all. Now wrapped in try/except; `NotImplementedError` → 501, all other exceptions → 500 with structured `{"detail": "Rebuild failed: …"}` and an `ERROR`-level log entry.

### Backend: semantic layer null check and warmup log level
- `backend/app/main.py`
  - `semantic_ask`: changed `_semantic_state["layer"]` to `.get("layer")` with an explicit 503 guard — prevents a potential KeyError if warmup partially initialises state.
  - Background warmup thread: failure now logged at `ERROR` (was `WARNING`) with `exc_info=True` so the full traceback appears in operator logs.

### ComplianceView: empty state explains why no entities exist for fresh live workspaces
- `frontend/src/components/ComplianceView.tsx`
  - Live users with an empty ontology saw "No entities classified yet." with a link but no explanation. Added a brief description: "Compliance classifications appear here once you build the semantic layer from your connected data sources."

### Backend: context store seeded AW data no longer visible to live users
- `backend/app/context/store.py`
  - Added `is_seeded: bool = False` field to `ContextEntity`, `ContextMetric`, and `ContextGlossaryTerm` dataclasses.
  - Schema: `is_seeded INTEGER NOT NULL DEFAULT 0` column added to `context_entities`, `context_metrics`, `context_glossary` tables (CREATE TABLE + ALTER TABLE migration for existing DBs).
  - Startup migration backfills `is_seeded=1` for all known AdventureWorks demo records (7 entities, 5 metrics, 7 glossary terms) so existing deployments are fixed without a manual DB reset.
  - `add_entity()`, `add_metric()`, `add_glossary_term()` each accept an `is_seeded` keyword argument (default `False`).
  - `list_entities()`, `list_metrics()`, `list_glossary()` accept `exclude_seeded: bool = False`; when `True`, the SQL `WHERE is_seeded = 0` filter is applied.
  - `seed_demo_data()` now passes `is_seeded=True` to all three add methods so newly seeded records are correctly tagged.
  - `to_semantic_docs_override()` accepts `mode: str = "demo"` and calls the list methods with `exclude_seeded=(mode == "live")`. The memoised cache is now a `dict` keyed by mode so live and demo builds are cached independently.
- `backend/app/main.py`
  - Semantic ask endpoint passes `mode=_current_user.mode` to `_context_store.to_semantic_docs_override()`.
- `backend/app/context/router.py`
  - `GET /api/context/entities`, `GET /api/context/metrics`, `GET /api/context/glossary` now authenticate the caller via a lazy `_get_current_user` proxy dependency and pass `exclude_seeded=(mode == "live")` to the store, so live users don't see AW demo entities/metrics/glossary in the Context tab UI.
  - Added a local `_oauth2_scheme` (`OAuth2PasswordBearer`) to avoid circular imports (the existing `_get_current_user_dep()` helper was designed for future use but called at module-load time, which would fail because `main.py` defines `oauth2_scheme` and `get_current_user` after importing this router).

### Dashboard: fix "Revenue 2014" KPI label leaking to live manufacturing users
- `frontend/src/components/Dashboard.tsx`
  - The 4th KPI card's label fell back to `sector.kpiLabels.openValue` which for the manufacturing sector is `'Revenue 2014'` — a reference to the AdventureWorks 2014 dataset. Live manufacturing-sector users saw this AW-specific label on their dashboard.
  - Fixed: live mode now always shows `'Total Value'` for this KPI card. Demo mode retains the sector-specific label.

### AgentsView: fix availableEntities using AW sector nodes for live users
- `frontend/src/components/AgentsView.tsx`
  - `availableEntities` (the entity dropdown in the Agent Builder modal) was built from `SECTORS[sectorId].ontology.nodes` — the AW sector nodes — as a base for all modes. A live manufacturing-sector user opening the agent builder would see AW entity names (SalesOrder, Customer, Employee…) in the dropdown even with no live ontology built.
  - Fixed: in live mode, base entities come from `liveConfig?.ontology.nodes` (real backend entities) instead of the sector's demo ontology. Builder-added nodes from the extension store are still merged in.

### ContextTab: replace AW-specific entity form placeholders with generic examples
- `frontend/src/components/ContextTab.tsx`
  - "Add entity" form: `placeholder="e.g. SalesOrder"` (technical name) and `"e.g. Sales Order"` (display name) → both replaced with `"e.g. Customer"`.

### SemanticLayerView: replace AW-specific form placeholders with generic examples
- `frontend/src/components/SemanticLayerView.tsx`
  - Metrics "Add Metric" form: `placeholder="e.g. subtotalAmount"` → `"e.g. amount"` (AW-specific field)
  - Disambiguation Rules "Add Rule" form: `placeholder="e.g. subtotalAmount"` and `"e.g. totalDue"` → `"e.g. net_amount"` and `"e.g. gross_amount"`
  - Definitions "Add Definition" form: `placeholder="e.g. SalesOrder"` (entity) and `"e.g. subtotal_amount"` (field) → `"e.g. Customer"` and `"e.g. revenue"`

### SemanticLayerView: add empty state for Entities section when no ontology exists
- `frontend/src/components/SemanticLayerView.tsx`
  - The Entities section showed an empty list (no message) when a live user had no ontology built yet. With just a header and "Add entity" button, there was no guidance on how to get entities.
  - Now shows: network icon, "No entities yet" heading, explanation that entities are auto-extracted when data sources are connected + the pipeline is run, and a "Connect a data source →" CTA button.

### AdminSections: notification channel test shows correct status for unimplemented delivery types
- `frontend/src/components/AdminSections.tsx`
  - Testing a Slack, Email, or Teams notification channel called the real backend endpoint, which returned `{ ok: true, latency_ms: null, note: "… delivery not yet implemented" }`. The frontend treated this as a full success and showed "✓ Test delivered · 0ms" — misleading for live users who expected delivery confirmation.
  - Now: if the backend returns a `note` field (indicating partial/unimplemented delivery), the channel card shows "⚠ Channel saved — delivery not yet active on this deployment" in amber instead of the false green checkmark. True webhook delivery continues to show the confirmed result with real latency.

### OntologyGraph: add empty state for Entities tab when no ontology exists
- `frontend/src/components/OntologyGraph.tsx`
  - The Entities tab inside the OntologyGraph panel showed a blank list (no rows, no message) when a live user had no ontology nodes yet. There was no guidance on what to do next.
  - Added a centred empty state visible only in live mode when `extendedOntology.nodes.length === 0`: table icon, "No entities yet" heading, brief explanation, and two CTA buttons — "Connect sources →" (navigates to the Sources tab) and "Build manually" (navigates to the Builder tab).

### OntologyGraph: fix "from Builder" badge logic for live users
- `frontend/src/components/OntologyGraph.tsx`
  - The "+X from Builder" badge in the Ontology header used `extendedOntology.nodes.length > sector.ontology.nodes.length` for both demo and live mode. In live mode, `sector.ontology.nodes.length` is the AW node count (10+ nodes), so the badge would never appear even when a live user had added custom entities via the Builder.
  - Fixed: in live mode, the badge now shows whenever `extendedOntology.nodes.length > 0` (any builder additions), displaying "+N from Builder" accurately.

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
