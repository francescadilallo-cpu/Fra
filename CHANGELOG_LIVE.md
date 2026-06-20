# Live Version — Change Log

This file tracks every change made to the **live** (sellable) version of the
product, newest first. Each entry lists the files touched and the intent, so
work is traceable across sessions and the git history is easy to reconcile.

> Live mode = real user data (JWT `mode="live"`). Demo mode = curated sample
> data. Changes here must improve what *live* users see, without leaking demo
> content.

---

## 2026-06-20 (session cont. 7)

### Polish: UX sweep — ProcessView heading, AdminSections notification text

- **ProcessView.tsx**: Page H1 "Process" → "Setup" (matches sidebar nav); lifecycle empty state "Process stages" → "Lifecycle stages" (matches section heading)
- **AdminSections.tsx**: Notification channels description "pipeline events" → "setup events"

Also verified as demo-only (no changes needed): fatturato disambiguation in QueryInterface (gated by `!IS_DEMO_MODE`); demo source names in OverviewScreen (gated by `isAW`); DEMO_AUDIT entries in AdminSections (gated by `IS_DEMO_MODE`); all AGENTS[sectorId] entries with "semantic layer" / "Knowledge Graph"; queryEngine.ts AW responses.

---

## 2026-06-20 (session cont. 6)

### Polish: final jargon sweep — backend audit log + command palette + mapping tab

- **backend/app/main.py**: `_audit()` message "Rebuilt knowledge graph" → "Rebuilt data model" (visible to live users in AuditLogSection)
- **CommandPalette.tsx**: Command label "Run Semantic Pipeline" → "Run Setup"; nav item label "Process" → "Setup" (matches sidebar)
- **MappingView.tsx**: Tab label "Semantic Definitions" → "Field Definitions"

All other remaining "semantic"/"ontology"/"Knowledge Graph"/"pipeline" occurrences verified as demo-only (gated by `IS_DEMO_MODE`), internal code identifiers, API docs/logs, or the intentional OWL/RDF developer export.

---

## 2026-06-20 (session cont. 5)

### Polish: "pipeline" / "Knowledge Graph" / "Process" consistency pass + live workspace name fix

- **ProcessView.tsx**: Nav label "Process" → "Setup"; run button "Run Pipeline" → "Run Setup" / "Re-run Setup"
- **Layout.tsx**: Nav entry "Process" → "Setup"; sidebar brand updated to "DataIntelligence"
- **Dashboard.tsx**: "Run Pipeline →" → "Run Setup →"; badge "✓ Pipeline synced" → "✓ Synced"
- **OverviewScreen.tsx**: All "Run Pipeline →" → "Run Setup →"; "Cross-source Knowledge Graph" → "Cross-source Entity Graph"; "Build the layer to generate the graph" → "Run setup to generate the graph"
- **SemanticLayerView.tsx**: "Run Pipeline →" → "Run Setup →"; "auto-extracted from your pipeline" → "from your data"
- **MappingView.tsx**: "Run Pipeline →" → "Run Setup →"; "build the semantic layer... run the pipeline" → "build the data model... run setup"
- **SemanticDraftView.tsx**: "after a pipeline run" → "after running setup"
- **QueryInterface.tsx**: "Run Pipeline →" CTA label → "Run Setup →"
- **AgentsView.tsx**: Custom agent `TEMPLATE_LOG_STEPS` "WRITE ... → Knowledge Graph" → "→ data model" (5 occurrences — live-user custom agents)
- **OntologyGraph.tsx**: Entity Graph subline now shows `liveConfig.name` for live users instead of demo-specific "Manufacturing Sales Ontology — Cross-source" title; architecture layer "SEMANTIC LAYER" → "DATA MODEL LAYER"; "Data Model Components" section heading

---

## 2026-06-20 (session cont. 4)

### Polish: deep jargon sweep — "semantic" terminology eliminated from live-user UI

**SemanticLayerView.tsx** (entity editor + field panel + query no-match):
- `placeholder="= semantic name"` → `"= same as field name"` (physical column input)
- `'Field mapping — semantic → physical'` → `'Business name → physical column'`
- `'Field definitions — semantic → physical column'` → `'Field name → physical column'`
- `"New semantic entity"` → `"New entity"`; description updated accordingly
- `"Entity name (semantic)"` label → `"Entity name"`
- `"Define how semantic field names map..."` → `"Define how field names map..."`
- Column header `"Semantic name"` → `"Field name"` (new-entity form)
- `"New semantic definition"` → `"New field definition"`
- `"No semantic match found"` → `"No match found"`
- `"in the Semantics section"` → `"in the Definitions section"`
- `"Semantic name *"` (add-field row label) → `"Field name *"`
- `"Semantic name (concept)"` (entity edit label) → `"Entity name"`
- `"Semantic name (how you query)..."` description → `"Field name (how you query)..."`
- Column header `"Semantic name"` (entity editor) → `"Field name"`
- Nav group `'Semantics'` → `'Analytics'` (sidebar section heading)
- Bridge section desc `"Semantic joins..."` → `"Joins..."`

**OntologyBuilder.tsx** (property table):
- Column header `"Semantic name"` → `"Field name"`
- `placeholder="= semantic"` → `"= same as field name"`

**OntologyGraph.tsx** (entity detail panel + architecture tab):
- Table header `"Semantic name"` → `"Field name"` (entity property popup)
- `"= semantic"` fallback → `"= same name"` (physical column equal to field name)
- `"Semantic Layer Components"` section heading → `"Data Model Components"`

**Layout.tsx** (sidebar brand):
- `"Semantic<span>Intelligence</span>"` → `"Data<span>Intelligence</span>"`
- `"Semantic Data Layer Platform"` → `"Data Intelligence Platform"`
- `"SemanticIntelligence"` footer label → `"DataIntelligence"`

**AccessGate.tsx** (login screen):
- `"Semantic<span>Intelligence</span>"` → `"Data<span>Intelligence</span>"`
- `"Semantic Data Layer Platform"` → `"Data Intelligence Platform"`

**OnboardingWizard.tsx** (step 1, live-user facing):
- `"Welcome to SemanticIntelligence"` → `"Welcome to DataIntelligence"`

**CommandPalette.tsx** (footer branding):
- `"SemanticIntelligence"` → `"DataIntelligence"`

**MappingView.tsx** (field definitions / ambiguities view):
- Page heading `"Semantic Layer"` → `"Data Model"`
- Subline `"semantic definitions and ambiguities"` → `"field definitions and ambiguities"`
- Empty state `"No semantic definitions yet"` → `"No field definitions yet"`
- Empty state `"Build the semantic layer to auto-generate..."` → `"Run setup to auto-generate..."`
- Counter `"{n} semantic definitions"` → `"{n} field definitions"`
- Add form `"New semantic definition"` → `"New field definition"`
- Ambiguity hint `"when the semantic layer finds conflicting..."` → `"when the data model finds conflicting..."`
- Ambiguity count `"resolved at query time by the semantic layer"` → `"...by the data model"`

**OverviewScreen.tsx** (hero + solution section):
- H1 `"Semantic<span>Intelligence</span>"` → `"Data<span>Intelligence</span>"`
- Hero subtitle `"The semantic layer that transforms..."` → `"The data model that transforms..."`
- Section heading `"A semantic layer that unifies..."` → `"A unified data model that disambiguates..."`
- Card title `"Semantic Definitions"` → `"Field Definitions"`
- Problem card `"No reliable join without a semantic layer."` → `"...without a common data model."`

---

## 2026-06-20 (session cont. 3)

### Polish: final jargon pass — live-user strings across 8 files

- `frontend/src/components/OntologyGraph.tsx`
  - Page heading "Ontology" → "Entity Graph" (main `<h1>`, shown to all users)
  - Subline "N classes · N object properties" → "N entities · N relationships"
  - Empty state guidance: "Ontology Builder AI" → "Builder AI"; "run the pipeline" → "run setup"

- `frontend/src/components/AgentsView.tsx`
  - "built on your ontology" → "built on your data model" (shown when user has custom agents)
  - "Semantic Layer Activity Log" → "Agent Activity Log" (always-visible footer log)

- `frontend/src/components/ConfigurationView.tsx`
  - Sector templates description: "ontology, mappings and connectors" → "entity definitions, mappings and connectors"

- `frontend/src/components/ProcessView.tsx`
  - `buildLiveLogs` (live-user pipeline): "Building Knowledge Graph..." → "Building data model..."; "knowledge nodes created" → "entities indexed"

- `frontend/src/components/Dashboard.tsx`
  - Data Model stat cards: "Know. Nodes" → "Nodes", "Know. Edges" → "Edges"

- `frontend/src/components/OntologyBuilder.tsx`
  - Page header stat line "N classes · N relations" → "N entities · N relationships"

- `backend/app/main.py`
  - `_safe_ingest_error` fallback for build endpoint: "Semantic layer build failed" → "Data model build failed"
  - `_safe_ingest_error` fallback for sync/reload: "Knowledge graph rebuild failed" → "Data model rebuild failed"

---

## 2026-06-20 (session cont. 2)

### Fix + improve: connector error wrapping; jargon in backend API errors and frontend empty states

- `backend/app/connectors/duckdb_source_manager.py`
  - PostgreSQL DuckDB fallback (`except ImportError` path): raw DuckDB exceptions on connect and per-table read now wrapped in clear `ValueError` messages
  - MySQL DuckDB fallback (`except ImportError` path): same fix — clear messages on connect failure and table-not-found

- `backend/app/main.py`
  - 8 endpoints returning "Semantic layer not ready — build it from Data Sources first" → "Data model not ready — connect a data source and run setup first"

- `frontend/src/components/OntologyGraph.tsx`
  - "No ontology built yet" → "No data model built yet" (live-user empty state in graph view)

- `frontend/src/components/DataExplorer.tsx`
  - "run the pipeline — entities are auto-discovered from your schema" → "run setup — entities are auto-extracted from your tables"

- `frontend/src/components/Layout.tsx`
  - Sidebar nav labels (Build section, visible to all users):
    - "Ontology" → "Entity Graph"
    - "Ontology Builder" → "Builder AI"
    - "Knowledge Graph" → "Data Model"

- Cross-component label consistency update (all references to old nav labels):
  - `Dashboard.tsx` — card heading "Knowledge Graph" → "Data Model"
  - `ProcessView.tsx` — "KG Nodes Created" → "Entities Indexed", "KG Edges Indexed" → "Relationships", "ontology classes" → "entity types", "instances in Knowledge Graph" → "entity instances indexed", "Semantic layer ready" → "Data model ready", "View Ontology" → "View Data Model"
  - `OverviewScreen.tsx` — step titles updated; status badges "Ontology" → "Entity graph", "Knowledge Graph" → "Data model"
  - `QueryInterface.tsx` — "Knowledge Graph → Definitions" → "Data Model → Definitions"
  - `SemanticDraftView.tsx` — "Metrics tab in the Knowledge Graph" → "Metrics tab in Data Model"
  - `CommandPalette.tsx` — "Ontology" → "Entity Graph", `sembuilder` → "Data Model"
  - `AccessGate.tsx` — demo option description: "semantic ambiguities, Knowledge Graph already built" → "data ambiguities, Data Model already built"

- `frontend/src/components/OntologyBuilder.tsx`
  - Fix pre-existing TypeScript unused parameter warning (`sectorId` → `_sectorId` in `buildAddClassIntent`)

- `frontend/src/components/OntologyGraph.tsx`
  - Sub-tab "Ontology Graph" → "Entity Graph"

- `frontend/src/components/SemanticLayerView.tsx`
  - Section nav descriptions: "Semantic concepts" → "Business entities", "Cross-system joins" → "Cross-source connections", "Disambiguation" → "Conflict rules"
  - Sub-tab "Semantic Definitions" → "Field Definitions"
  - Sidebar heading "Semantic Layer" → "Data Model"
  - Section description "Semantic layer status..." → "Data model status..."
  - Mappings table headers: "Ontology Class" → "Entity", "Ontology Property" → "Entity Field"
  - Setup guide step descriptions simplified: "Connect semantic names to physical tables" → "Map entity names to your data tables", "Resolve terms that map to multiple fields" → "Clarify terms with conflicting definitions"

- `frontend/src/components/ProcessView.tsx` (additional)
  - "Semantic Layer Pipeline" → "Setup Pipeline" (pipeline panel heading)
  - "KG Nodes Created" → "Entities Indexed"; "KG Edges Indexed" → "Relationships"
  - Sub-labels: "ontology classes" → "entity types"; "instances in Knowledge Graph" → "entity instances indexed"
  - "Semantic layer ready" → "Data model ready"; "View Ontology" → "View Data Model"

- `frontend/src/components/DataSourcesView.tsx` (additional)
  - Build step "Building knowledge graph…" → "Building data model…"

- `frontend/src/components/SemanticDraftView.tsx` (additional)
  - "The AI uses this knowledge graph..." → "The AI uses this data model..."

- `frontend/src/components/ComplianceView.tsx`
  - "run the setup wizard" → "run setup"

---

## 2026-06-20 (session cont.)

### Improve: extended jargon sweep — 10 more files cleaned

- `backend/app/main.py` — 503 message "The semantic layer is not ready yet" → "The data model is not ready yet"; size error "ontology extension" → "data model extension"
- `frontend/src/components/OntologyBuilder.tsx` — Builder AI title, bot welcome message for live users, AI message text (rationale, duplicate checks), analyzing spinner, reset dialog
- `frontend/src/components/OnboardingWizard.tsx` — step 1 tagline "The semantic layer for European businesses" → "AI-powered data platform..."
- `frontend/src/components/ConfigurationView.tsx` — agents section subtitle
- `frontend/src/data/llmQueryEngine.ts` — empty key error "LLM panel" → "AI provider panel"
- `frontend/src/components/SemanticLayerView.tsx` — 8 additional strings (bridge desc, definitions empty state, ambiguity count, setup guide heading, sources empty state×2, query templates desc, bridges page desc)
- `frontend/src/components/ProcessView.tsx` — "Synced from semantic layer" → "Data model synced"
- `frontend/src/components/AgentsView.tsx` — agent start log, agents subtitle
- `frontend/src/components/DataSourcesView.tsx` — waitlist panel text
- `frontend/src/components/OverviewScreen.tsx` — live-user CTA heading
- `frontend/src/data/reportGenerator.ts` — 3 strings in downloaded report (recommendations, KPI sub-label, report section)

---

## 2026-06-20 (session 10bf)

### Fix + improve: MySQL/Parquet ingester errors; jargon cleanup across 6 frontend files

- `backend/app/connectors/duckdb_source_manager.py` — `_ingest_mysql`, `_ingest_parquet`

  **MySQL table-not-found**: `pymysql.ProgrammingError` (table doesn't exist) was uncaught and produced the generic "Ingestion failed" fallback. Now raises a clear ValueError: "Table 'my_table' not found in MySQL database — check that the table exists and the database name is correct."

  **Parquet read errors**: A corrupted or non-Parquet file would raise a raw DuckDB exception string. Now wrapped in a ValueError: "Cannot read Parquet file 'foo.parquet': … — the file may be corrupted or not a valid Parquet file."

- `frontend/src/components/DataSourcesView.tsx` — empty state, source status, success toast, header subtitle
- `frontend/src/components/SemanticLayerView.tsx` — relations empty state
- `frontend/src/components/SemanticDraftView.tsx` — stat chip, context notes label, context doc description
- `frontend/src/components/QueryInterface.tsx` — AI provider label and loading text
- `frontend/src/components/OverviewScreen.tsx` — step 1 description
- `frontend/src/components/ComplianceView.tsx` — live-user empty state guidance
- `frontend/src/components/AgentBuilder.tsx` — event trigger labels

  Jargon removed across all files:
  - "FK edges" → "Relationships"
  - "injected into LLM prompts" → "used when generating AI queries"
  - "Context documents are injected into LLM prompts when generating SQL" → "Context documents guide AI query generation"
  - "Querying semantic layer…" → "Processing your question…"
  - "LLM Provider" → "AI Provider"
  - "LLM active" / "LLM" fallback → "AI active" / "AI"
  - "ingest into the semantic layer" → "start querying your data"
  - "start ingesting" → "get started"
  - "Run the pipeline to ingest data" → "Run setup to load data"
  - "Semantic layer built — N sources ingested" → "Your data is ready — N sources connected" (success toast)
  - "data is ingested and becomes queryable instantly" → "data loads automatically and becomes queryable instantly"
  - "No relations found in the semantic layer yet" → "No relationships found yet"
  - "Build the semantic layer to auto-populate entity relations, or define FK edges" → "Run the setup to discover relationships automatically, or define them"
  - "build the semantic layer from your connected data sources" → "connect your data sources and run the setup wizard"
  - "Connect a data source to build your ontology" → "Connect a data source to get started"
  - "When a new ontology entity is added" → "When a new entity type is added to the data model"
  - "When the data pipeline completes" → "When data processing completes"

---

## 2026-06-20 (session 10be — continued)

### Improve: CSV ingester auto-converts Google Sheets URLs; PG ingester table-not-found error

- `backend/app/connectors/duckdb_source_manager.py` — `_ingest_csv`, `_ingest_postgresql`

  **CSV URL / Google Sheets**: Users who paste a standard Google Sheets sharing URL (`.../edit#gid=0`) received a cryptic DuckDB parse error because the URL returns HTML. Fixed:
  1. Sheets edit/view URLs are auto-converted to `/export?format=csv&gid=...` at ingest time — users can paste the sharing link directly without knowing the export URL pattern.
  2. Any URL that returns `text/html` content-type now raises a clear error: "URL returned HTML instead of CSV — the file may require login or the link may not be publicly shared."

  **PostgreSQL table-not-found**: When a table in the `tables` list didn't exist in the database, `psycopg2.ProgrammingError` was swallowed and replaced with the generic "Ingestion failed" fallback. Now raises: "Table 'my_table' not found in schema 'public' — check that the table exists and the schema name is correct."

---

## 2026-06-20 (session 10be)

### Fix: JSON ingester — better error messages for malformed files and missing records_key

- `backend/app/connectors/duckdb_source_manager.py` — `_ingest_json_file`

  Three improvements:
  1. `json.JSONDecodeError` (which IS a ValueError subclass) now produces a readable message: "JSON file 'foo.json' is not valid JSON: …" instead of a raw Python traceback.
  2. If `records_key` is configured but the key doesn't exist in the JSON object, the error now lists available top-level keys: "records_key 'data' not found. Available: 'results', 'items'".
  3. The "not a list" error now names the file and shows the actual type it found, making it easier to diagnose nested-object payloads.

---

## 2026-06-20 (session 10bd)

### Improve: remove developer jargon from live-user UI text

- `frontend/src/components/DataSourcesView.tsx` — header subtitle, build CTA subtitle, ingest overlay, upload section tag
- `frontend/src/components/MappingView.tsx` — mapping table column headers
- `backend/app/connectors/duckdb_source_manager.py` — SQLite ingester error handling (committed separately)

  **DataSourcesView**: Four places used developer terminology visible to all users:
  - Header subtitle: "data ingests into DuckDB" → "data is ingested" (DuckDB is an implementation detail)
  - Build CTA subtitle: "auto-extracted from schema" → "auto-discovered from your data"
  - Upload section tag: "auto-mapping to your ontology" → "fields auto-matched to your data model"
  - Ingest overlay: "Ingesting to DuckDB…" → "Processing your data…"

  **MappingView**: Field mapping table column headers used ontology jargon:
  - "Ontology Class" → "Entity"
  - "Ontology Property (click to edit)" → "Mapped Property (click to edit)"
  - "URI" → "Schema URI"

---

## 2026-06-20 (session 10bc)

### Improve: MappingView proper empty state + QueryInterface onboarding CTA

- `frontend/src/components/MappingView.tsx` — Field Mappings tab empty state
- `frontend/src/components/QueryInterface.tsx` — no-questions CTA

  **MappingView**: The "Field Mappings" tab showed a generic "No mappings match your search." for fresh workspaces with no ontology. Fixed: when `allMappings.length === 0` (no ontology at all), renders a proper empty state with "Connect a source →" and "Run Pipeline →" buttons. The generic "no results" message is preserved for the case where there ARE mappings but the search filter returns nothing.

  **QueryInterface**: The empty-state card for `exampleQuestions.length === 0` said "No data sources connected yet" — which was wrong for users who HAVE sources but haven't built the semantic layer. Rewritten to: "No example questions available yet — you can still type any question" with two sequential CTAs: "1. Connect a source →" and "2. Run Pipeline →", covering both cases (no sources and no layer).

---

## 2026-06-20 (session 10bb)

### Improve: SemanticLayerView setup guide + DataSourcesView error UX

- `frontend/src/components/SemanticLayerView.tsx` — setup guide condition
- `frontend/src/components/DataSourcesView.tsx` — source card text

  **SemanticLayerView**: Setup guide was hidden as soon as `sourcesCount > 0` (first source connected), leaving the user with "0 Entities" and "0 KG Nodes" stat cards and no guidance. Changed condition to `!isDemoWorkspace && nodeCount === 0` — the guide now stays visible until the semantic layer has actually been built (entities > 0). When sources exist but no entities yet, the header shows a "Run Pipeline →" button and the subtitle changes to "N sources connected — run the pipeline to auto-discover entities."

  **DataSourcesView**: Error message for broken sources was `truncate` (single line, cut off). Changed to `line-clamp-3` with `title` tooltip so users can read the full DSN/connection error without expanding. Also fixed the "synced never" text for pending-but-not-yet-synced sources: now shows "Run the pipeline to ingest data" (pending), "Not yet synced" (other unsynced), or the actual row count + relative time if synced.

---

## 2026-06-20 (session 10ba)

### Feature: Relations tab — add/delete user-defined joins in SemanticDraftView

- `backend/app/metadata/catalog.py` — `ManualRelationRow` SQLAlchemy model + `_migrate_schema()` + `add_manual_relation()` / `remove_manual_relation()` / `list_manual_relations()`
- `backend/app/main.py` — `RelationCreate` Pydantic model + `POST /api/semantic/draft/relations` + `DELETE /api/semantic/draft/relations/{id}` + `_get_semantic_draft()` now merges KG edges (`is_manual=False`) with manual relations (`is_manual=True`)
- `frontend/src/api/semantic.ts` — `DraftRelation` extended with `id?` / `is_manual?`; new `addRelation()` / `removeRelation()` API functions
- `frontend/src/components/SemanticDraftView.tsx` — `RelationsTab` rewritten with full CRUD: "Add relation" button opens an inline form with table dropdowns; manual rows show a trash icon; auto-detected KG rows show an `auto` badge and are read-only (rebuilt on next pipeline run)

---

## 2026-06-20 (session 10az)

### Improve: QueryInterface error hints + Dashboard empty-state for fresh live workspaces

- `frontend/src/components/QueryInterface.tsx` — error bubble
- `frontend/src/components/Dashboard.tsx` — KPI section

  **QueryInterface**: Extended the HTTP-status navCTA logic:
  - 404 (table reference stale) now also shows "Run Pipeline →" CTA (same as 503), prompting a rebuild.
  - 422 (ontology violation — the question doesn't match the data model) now shows an inline tip: "Try using the exact table or column names from your data model, or rephrase to ask about a specific entity." Previously the user saw an opaque error with no guidance.

  **Dashboard**: Added a teal "Your workspace is empty" banner that appears below the KPI grid for live users when `totalRecords === 0` and no entities are in the semantic layer. Banner includes a "Connect a source →" button that navigates directly to the Data Sources tab. Eliminates the confusing "Records ingested: 0" KPI-only state fresh users used to land on.

---

## 2026-06-20 (session 10ay)

### Feature: MySQL data source connector (live ingestion)

- `backend/app/connectors/source_registry.py` — Added `"mysql"` to `IMPLEMENTED_CONNECTOR_TYPES`
- `backend/app/connectors/duckdb_source_manager.py` — Added `_ingest_mysql()` method + dispatcher
- `frontend/src/api/sources.ts` — Restored MySQL credential form (removed `waitlist_only`, added params_schema)

  **What**: Full MySQL ingestion support via the standard `_stream_cursor_into_table()` pipeline.
  Primary path uses `pymysql.cursors.SSDictCursor` (server-side streaming) for memory-efficient row streaming. Fallback path uses DuckDB's `mysql_scanner` extension if pymysql is unavailable.
  Respects the `FRA_PG_INGEST_LIMIT` env var (default 100 k rows). Over-limit tables are truncated with a warning. Multiple tables per source supported. Frontend shows the DSN + tables credential form instead of the waitlist panel.

---

## 2026-06-20 (session 10ax)

### Fix: CSV column mapping allows manual override for unmatched columns

- `frontend/src/components/DataSourcesView.tsx` — `UploadPanel`

  **Problem**: The CSV column mapping table disabled the include/exclude toggle for columns with `confidence === 'none'` (no ontology match found). If all columns scored `none` — likely for a fresh live workspace with no ontology built yet — the "Ingest" button stayed disabled and users were stuck with no way to proceed.

  **Fix**: Removed `disabled` from the toggle button for `none`-confidence columns. They now show a dashed border to signal "no auto-match, but you can include manually". A hover tooltip explains: "No ontology match found — click to include anyway". The footer hint text also updated to mention unmatched columns are togglable. Users can now always ingest a CSV regardless of whether the semantic layer has been built.

---

## 2026-06-20 (session 10aw)

### Improve: smarter example questions for fresh live workspaces

- `backend/app/main.py` — `list_example_questions()`, `_refresh_catalog_and_kg_after_rebuild()`

  **Problem 1**: The generated fallback questions for live users with no templates used raw table names (e.g., `csv_abc12345`) and were generic ("How many records are in X?", "Show me the first 10 rows from X"). Not useful.

  **Fix 1**: Questions now use `user_description` if set (e.g., "Sales Orders") otherwise the entity name. Detects column patterns to generate smarter questions: date columns → "Show me X records from the last 30 days", amount/revenue columns → "What is the total [column] in X?".

  **Problem 2**: Auto-template generation (`generate_templates_from_draft`) only ran during a full `/api/semantic/build`. Source add, remove, and sync operations called `_refresh_catalog_and_kg_after_rebuild()` without regenerating templates, leaving the QueryInterface with stale or empty example questions after a CSV upload.

  **Fix 2**: Added `generate_templates_from_draft()` + `catalog.upsert_auto_templates()` + `layer.set_templates()` at the end of `_refresh_catalog_and_kg_after_rebuild()`. Templates now refresh automatically on every source change, not just on explicit builds.

---

## 2026-06-20 (session 10av)

### Fix: live onboarding lands users on Data Sources tab after completion

- `frontend/src/App.tsx` — `onComplete` callback and new `useEffect`

  **Problem**: After the onboarding wizard completes for a live user, `window.location.reload()` resets all React state. The user was dropped on the Overview tab with no guidance on what to do next — they had to find the Data Sources tab on their own.

  **Fix**: Set `sessionStorage.setItem('si-post-onboarding-tab', 'sources')` in `onComplete` (live mode only, before the reload). A new `useEffect` reads and clears this key after `granted=true`, then navigates directly to the Data Sources tab. Demo users are unaffected.

### Fix: SaaS connectors show "in progress" panel instead of fake credential form

- `frontend/src/api/sources.ts` — `ConnectorBackendDef` interface, `CONNECTOR_BACKEND_MAP`
- `frontend/src/components/DataSourcesView.tsx` — `CredentialModal`

  **Problem**: 18 connectors (Shopify, Stripe, TeamSystem, Salesforce, etc.) were marked `status: 'available'` in the UI. Clicking "Connect" opened a credential form. Submitting created a backend source record that stayed `status: 'pending'` forever — backend ingestion is not yet implemented for these connector types. Users thought they'd connected their data but nothing was ingested.

  **Fix**: Added `waitlist_only?: boolean` to `ConnectorBackendDef`. All 18 unimplemented SaaS connector types are now marked `waitlist_only: true`. `CredentialModal` detects this flag and renders an informational panel instead of the credential form: explains to use CSV export as a workaround, and offers a "Notify me when ready" button (client-side state only, no API call). Connectors that actually work (PostgreSQL, Google Sheets via CSV, Airtable via CSV) are unchanged.

---

## 2026-06-20 (session 10au)

### Audit: comprehensive live/demo isolation review — no new bugs found

Full read-through of all 20+ frontend components and all backend API endpoints, verifying:

- **Demo content isolation**: Every `DEMO_*` / `DEMO_*` constant is guarded by `IS_DEMO_MODE` or `isDemoWorkspace`. `WORKFLOWS` in `AgentWorkflows.tsx` returns `[]` for live mode. `OnboardingWizard.tsx` collapses to 1 step for live users (`TOTAL_STEPS = IS_DEMO_MODE ? 5 : 1`). `UseCasesView.tsx` filters out the AdventureWorks case (`uc.id !== 'adventureworks'`). `DEMO_CONTEXT_DOCS` in `SemanticDraftView.tsx` is only used as a demo-mode fallback.
- **Raw exception sanitization**: All backend HTTP 500 responses use `_safe_ingest_error()` or fixed strings. Agentic router uses `_safe_msg` pattern (only `ValueError`/`AgentSemanticValidationError` messages pass through; everything else → "Action execution failed — see audit log for details"). Template CRUD exposes only developer-crafted `ValueError`/`KeyError` messages. `backendErrorMessage()` on the frontend shows backend `detail` when present, falls back to generic text.
- **Hidden demo tables**: `/api/data/{table}`, `/api/semantic/coverage`, `/api/semantic/sources`, `/api/semantic/live-config`, `/api/data/store/status`, `/api/semantic/ask`, `/api/semantic/build`, `/api/semantic/draft`, `/api/kg/build`, `/api/semantic/system-prompt` all call `_hidden_demo_tables(current_user)` and filter accordingly.
- **Empty states / CTAs**: All live-user empty states have actionable CTAs (e.g., "Connect a data source", "Get started"). `SemanticDraftView.tsx` dispatches to Data Sources tab. `OntologyGraph.tsx` offers "Connect a data source" and "Build manually with AI" buttons.
- **Audit log**: `AuditLogSection` in `AdminSections.tsx` uses backend `listAuditEntries()` for live mode; `DEMO_AUDIT` is only used when `IS_DEMO_MODE`.

No code changes were required. All isolation contracts are being upheld.

---

## 2026-06-20 (session 10at)

### Backend: fix freshness_status mismatch between backend and frontend

- `backend/app/main.py` — `semantic_sources()` (unified path and legacy fallback)

  **Bug**: `FreshnessBadge` in `SemanticLayerView.tsx` only handles `'fresh' | 'warning' | 'stale'`. The backend's unified source path returned `'outdated'` for sources older than 7 days and `'unknown'` for the legacy fallback path. Both unrecognized values caused `colors[status]` and `labels[status]` to be `undefined`, silently rendering the badge with no class or text.

  **Fix**: Updated backend to emit `'warning'` (1–7 days) and `'stale'` (7+ days) to match the frontend type contract. Legacy fallback path also updated from `'unknown'` to `'warning'`. All three returned values are now exactly `'fresh' | 'warning' | 'stale'`.

---

## 2026-06-20 (session 10as)

### Backend: refresh built_at timestamp after each catalog/KG rebuild

- `backend/app/main.py` — `_refresh_catalog_and_kg_after_rebuild()`

  **Bug**: `_semantic_state["built_at"]` was set once in `_ensure_semantic_loaded()` (initial process startup) and never updated. After a source add, remove, or sync — which triggers `mgr.rebuild()` then `_refresh_catalog_and_kg_after_rebuild()` — the catalog and KG were updated in-memory but `built_at` remained at the original process-start time. The Dashboard activity feed and SemanticLayerView's `draft.built_at` therefore showed the startup timestamp rather than the time of the most recent data change.

  **Fix**: At the end of `_refresh_catalog_and_kg_after_rebuild()`, after catalog, KG, and cache invalidation steps complete, set `_semantic_state["built_at"] = datetime.utcnow().isoformat()` when `loaded=True`. This makes the timestamp reflect the most recent actual rebuild, so live users see accurate "Semantic layer built" activity timestamps.

---

## 2026-06-20 (session 10ar)

### Fix: OntologyBuilder canvas stays empty for live users until sector switch

- `frontend/src/components/OntologyBuilder.tsx` — canvas sync `useEffect`

  **Bug**: `useState<Node[]>(initial.nodes)` only runs once (on first render). When a live user opens OntologyBuilder, `liveConfig=null` on mount so `initial.nodes=[]`. The async `getLiveConfig()` resolves and sets `liveConfig`, which recomputes `initial` via `useMemo` — but does NOT update the `useState`. The existing `useEffect([sectorId, sector, liveConfig])` only updated nodes/edges when the *sector* changed, not when `liveConfig` changed. Result: live users always saw an empty canvas until they switched sectors.

  **Fix**: Added `lastLiveConfigRef` to track the previous `liveConfig`. When `liveConfig` changes without a sector change (initial load or `pipeline-run-updated`), the effect now syncs nodes/edges from the new `buildInitialState()` result. Sector changes still reset messages and pending (same as before).

---

## 2026-06-20 (session 10aq)

### Frontend: dispatch pipeline-run-updated after addSource (connector + CSV) and removeSource

- `frontend/src/components/DataSourcesView.tsx` — `submitCredentials()`, CSV ingest block, `disconnectSource()`

  The backend `POST /api/sources` calls `mgr.rebuild()` and `_refresh_catalog_and_kg_after_rebuild()` for all implemented connector types, rebuilding the in-memory knowledge graph and catalog. Similarly, `DELETE /api/sources/{id}` always rebuilds. The frontend was missing `pipeline-run-updated` dispatches after all three operations — only `syncById()` and `handleBuildSemanticLayer()` dispatched the event. Added dispatches to all three paths so every view that listens (Dashboard, DataExplorer, AgentsView, OntologyGraph, SemanticLayerView, etc.) refreshes immediately when a source is added, removed, or CSV-ingested.

---

## 2026-06-19 (continued — session 10ap)

### Frontend: dispatch pipeline-run-updated after individual source sync

- `frontend/src/components/DataSourcesView.tsx` — `syncById()`

  When a user syncs a single source via the "Sync now" button, the backend re-ingests that source and updates entity row counts. The `pipeline-run-updated` event was not dispatched, so DataExplorer row counts, AgentsView liveRowCounts, and Dashboard storeStatus remained stale. Now dispatches immediately on successful sync so all listeners refresh.

---

## 2026-06-19 (continued — session 10ao)

### Frontend: DataSourcesView build now dispatches pipeline-run-updated

- `frontend/src/components/DataSourcesView.tsx` — `handleBuildSemanticLayer()`

  When a user builds the semantic layer from the "Data Sources" tab (after connecting a first source), the success path did not dispatch `pipeline-run-updated`. All the views that now listen to this event (Dashboard, SemanticDraftView, OntologyGraph, SemanticLayerView, AgentsView, OverviewScreen, DataExplorer, OntologyBuilder, MappingView, QueryInterface) would remain stale until a page reload. Now dispatches `pipeline-run-updated` immediately after the build API call succeeds so all dependent views refresh atomically.

---

## 2026-06-19 (continued — session 10an)

### Frontend: refresh QueryInterface example questions on pipeline-run-updated

- `frontend/src/components/QueryInterface.tsx` — `listExampleQuestions()` useEffect

  `listExampleQuestions()` returns questions derived from semantic layer templates, which are auto-generated from the schema on each build. After a pipeline run, new templates and entity-based questions become available, but the QueryInterface only fetched them on mount — leaving the suggestion panel stale. Now re-fetches on `pipeline-run-updated` (live mode only) so fresh questions appear immediately after a build.

---

## 2026-06-19 (continued — session 10am)

### Frontend: add pipeline-run-updated listeners to MappingView (definitions + ambiguities)

- `frontend/src/components/MappingView.tsx` — `SemanticDefinitionsPanel`, `AmbiguityLogPanel`

  Both sub-components fetched `/api/semantic/mapping-defs` once on mount and never refreshed. After a pipeline run, semantic definitions and ambiguity entries auto-generated from the new schema would only appear after a page reload. Both panels now listen to `pipeline-run-updated` (live mode only) and reload their data immediately.

---

## 2026-06-19 (continued — session 10al)

### Backend: sanitize YAML parse error detail in ontology validation endpoint

- `backend/app/main.py` — `validate_ontology_file()` — broad `except Exception` handler

  The `/api/semantic/ontology/validate` endpoint's catch-all `except Exception` used `f"Failed to parse ontology file: {exc}"` as the HTTPException detail. YAML scanner errors, file I/O errors, and similar can expose internal paths, YAML parser internals, and Python class names. Replaced with a fixed user-friendly message; full exception is now logged at WARNING level server-side.

---

## 2026-06-19 (continued — session 10ak)

### Frontend: add pipeline-run-updated listeners to OverviewScreen, DataExplorer, OntologyBuilder

- `frontend/src/components/OverviewScreen.tsx` — extracted `loadOverviewData()` fn, added listener
- `frontend/src/components/DataExplorer.tsx` — added listener for liveRowCounts refresh
- `frontend/src/components/OntologyBuilder.tsx` — added listener for liveConfig refresh

  Completing the `pipeline-run-updated` refresh sweep across all semantic-data-consuming views. These three components fetched `semanticStatus`, `getLiveConfig`, `semanticSources`, and `listSources` once on mount and never refreshed. After a pipeline run, the OverviewScreen setup checklist, DataExplorer row counts, and OntologyBuilder entity/edge graph now update immediately without a page reload.

---

## 2026-06-19 (continued — session 10aj)

### Frontend: refresh remaining live views (Dashboard storeStatus, AgentsView) after pipeline run

- `frontend/src/components/Dashboard.tsx` — added `getDataStoreStatus` to `pipeline-run-updated` handler
- `frontend/src/components/AgentsView.tsx` — added `pipeline-run-updated` listener for `liveConfig`/`liveRowCounts`

  Following the `pipeline-run-updated` refresh work (session 10ah/10ai), two more stale data paths were identified:
  - Dashboard's `storeStatus` (DuckDB row counts, built_at) was not refreshed on pipeline run — now re-fetched alongside `liveConfig` and `draft`
  - AgentsView's `liveConfig` (used to populate `liveRowCounts` displayed on custom agent cards) was fetched once on mount and never updated — now listens to `pipeline-run-updated` and refreshes immediately

---

## 2026-06-19 (continued — session 10ai)

### Frontend: auto-refresh Semantic views after pipeline run

- `frontend/src/components/SemanticDraftView.tsx` — added `pipeline-run-updated` listener
- `frontend/src/components/OntologyGraph.tsx` — added `pipeline-run-updated` listener (live mode only)
- `frontend/src/components/SemanticLayerView.tsx` — added `pipeline-run-updated` listener (live mode only)

  The "Run Pipeline" button in ProcessView dispatches `pipeline-run-updated` on completion. Before this change, three views that display semantic layer data only loaded once on mount:
  - `SemanticDraftView` polled every 5s while `loaded=false`, but stopped polling after the first successful load — a force rebuild left it stale
  - `OntologyGraph` never refreshed its live config
  - `SemanticLayerView` never refreshed draft/sources/metrics/hierarchies

  All three now listen to `pipeline-run-updated` and reload their data immediately when the pipeline completes.

---

## 2026-06-19 (continued — session 10ah)

### Frontend: refresh Dashboard activity feed immediately after pipeline run

- `frontend/src/components/Dashboard.tsx` — `pipeline-run-updated` listener

  The Dashboard's `pipeline-run-updated` event handler only refreshed `pipelineLastRun` from localStorage. After a successful "Run Pipeline" build, the activity feed entry "Semantic layer built — N entities, M metrics" and the connector/ontology stats only updated on the next page load. Now the handler also re-fetches `liveConfig` and `draft` from the backend (live mode only) so the activity feed, entity/metric counts, and "built_at" in the activity card update immediately when the pipeline finishes.

---

## 2026-06-19 (continued — session 10ag)

### Backend/Frontend: fix built_at in live-config endpoint (same as semantic draft fix)

- `backend/app/main.py` — `get_live_config()` — early-return and main-return paths
- `frontend/src/api/semantic.ts` — `LiveConfig.built_at` type widened to `string | null`

  `get_live_config()` had the same `datetime.utcnow().isoformat()` bug as `_get_semantic_draft()`: the not-loaded early return returned current request time, and the happy path also returned current request time. Dashboard uses `liveConfig?.built_at` as a secondary fallback for the "Last sync" display — so fresh live workspaces incorrectly showed "just now" instead of "Never". Both return sites now use `_semantic_state.get("built_at")` (None until first build). TypeScript `LiveConfig.built_at` widened from `string` to `string | null` to match; existing null guards in Dashboard.tsx are already sufficient.

---

## 2026-06-19 (continued — session 10af)

### Backend: sanitize httpx error detail leaking from webhook test endpoint

- `backend/app/notifications/router.py` — `test_channel()`

  `POST /api/notifications/channels/{id}/test` was constructing the `HTTPException` detail with `f"Could not reach webhook: {exc}"`. `httpx.RequestError` messages can contain internal details like host resolution failures, DNS errors, or connection timeout internals. Replaced with a fixed user-friendly message: "Could not reach the webhook endpoint — check the URL and network connectivity".

---

## 2026-06-19 (continued — session 10ae)

### Backend/Frontend: fix misleading "Last sync: just now" timestamp for live users

- `backend/app/main.py` — `_semantic_state`, `_ensure_semantic_loaded()`, `_get_semantic_draft()`
- `frontend/src/api/semantic.ts` — `SemanticDraft.built_at` type

  `_get_semantic_draft()` was always returning `datetime.utcnow().isoformat()` for `built_at`, meaning every call to `/api/semantic/build` or `/api/semantic/draft` reported the current request time as the layer's build time — never the actual time the semantic layer was constructed. This caused the Dashboard "Last sync" widget to show "just now" even for fresh live workspaces that had never been built.

  Fix: `built_at` is now stored in `_semantic_state` when `_ensure_semantic_loaded()` actually finishes building the layer, and `_get_semantic_draft()` reads it back (`None` until first build). The TypeScript `SemanticDraft.built_at` type is widened from `string` to `string | null` to match. Dashboard.tsx already uses `liveConfig?.built_at` with optional chaining, so `null` falls through correctly to show "Never" for unbuilt live workspaces.

---

## 2026-06-19 (continued — session 10ad)

### Frontend: ProcessView uses force=true when triggering live rebuild

- `frontend/src/api/semantic.ts` — `buildSemanticLayer()` — added optional `force` param
- `frontend/src/components/ProcessView.tsx` — passes `force=true` for live builds

  `buildSemanticLayer()` previously always sent `force=false` (the backend default), which means the rebuild is skipped if the layer is already loaded. For the ProcessView "Run Pipeline" button, the user is explicitly requesting a rebuild — possibly because they added or updated a source. Now the ProcessView call passes `force=true` so the backend always rebuilds, and the `buildSemanticLayer` API signature is extended to accept an optional `force` boolean (false by default for the DataSourcesView path, which is always a first-build).

---

## 2026-06-19 (continued — session 10ac)

### Backend: sanitize errors from /api/kg/build endpoint

- `backend/app/main.py` — `rebuild_knowledge_graph()`

  `_ensure_semantic_loaded()` in the `/api/kg/build` admin endpoint had no exception handling. A build failure would propagate as a raw 500. Wrapped in try/except with `_safe_ingest_error()` — the same pattern as `build_semantic_layer`.

---

## 2026-06-19 (continued — session 10ab)

### Backend: catch-all for unexpected errors in semantic_ask

- `backend/app/main.py` — `semantic_ask()` / `ask_legacy_alias()`

  The `layer.ask()` call was wrapped in try/except for `AmbiguityError`, `SemanticSecurityViolationError`, and `SemanticOntologyViolationError`, but had no catch-all. Any other unexpected exception (LLM client error, SQL parse failure, etc.) would propagate as an unhandled 500 with a raw stack trace visible to the client. Added a final `except Exception` that logs the full traceback server-side and returns a generic sanitized 500 detail to the caller.

---

## 2026-06-19 (continued — session 10aa)

### Frontend: ProcessView live build — add 30-second timeout to prevent infinite polling

- `frontend/src/components/ProcessView.tsx` — `runPipeline()` `finalize` closure

  The poll-for-build-result loop in `finalize()` had no termination condition beyond the build resolving. If the backend hangs indefinitely, the 500ms timer would loop forever. Added a `buildDeadline = Date.now() + offset + 30_000` guard: once the deadline passes without the build resolving, the request is aborted and a "Build timed out" error toast is shown — matching DataSourcesView's behaviour.

---

## 2026-06-19 (continued — session 10z)

### Frontend: ProcessView "Run Pipeline" triggers a real backend build for live users

- `frontend/src/components/ProcessView.tsx` — `runPipeline()`, `stopPipeline()`

  The "Run Pipeline" button in ProcessView was a pure UI animation for all users — no actual backend call was made for live workspaces, and `pipeline-last-run` was written to localStorage regardless, making the Dashboard show a fake "Pipeline synced" timestamp for live users.

  Fixed: for live users, `runPipeline()` now fires `buildSemanticLayer()` (with an `AbortController`) in parallel with the existing animation. The animation always plays to completion for a smooth UX, but the pipeline is only marked "done" once the real build resolves. If the build fails, the animation is aborted and the sanitized error message from the backend is shown via toast. `stopPipeline()` now also aborts any in-flight build request.

---

## 2026-06-19 (continued — session 10y)

### Frontend: surface backend error message in build-semantic-layer toast

- `frontend/src/components/DataSourcesView.tsx` — `handleBuildSemanticLayer()`

  The catch block showed a hardcoded generic string ("Build failed — check backend connection or source configuration") even though the backend now emits a sanitized, user-actionable `detail` field on failure. Changed to `backendErrorMessage(err) || <fallback>` so the sanitized backend message (e.g. "Semantic layer build failed — please check your source configuration and try again") reaches the toast when available.

---

## 2026-06-19 (continued — session 10x)

### Backend: sanitize errors from `/api/semantic/build` endpoint

- `backend/app/main.py` — `build_semantic_layer()`

  `reload_semantic()` was called inside `build_semantic_layer` with no exception handling. A crash during ontology loading, KG build, or catalog population would propagate as a raw 500 with internal stack trace / DuckDB error details visible to the client. Wrapped the executor call in a try/except that re-raises via `_safe_ingest_error()` — same pattern already used by all ingestion endpoints. Internal engine errors are replaced by a generic "Semantic layer build failed — please check your source configuration and try again" message; `ValueError` / `FileNotFoundError` / `NotImplementedError` (which carry user-actionable messages) pass through.

---

## 2026-06-19 (continued — session 10w)

### Frontend: "Try a query" CTA in SemanticDraftView header for live users

- `frontend/src/components/SemanticDraftView.tsx`

  After a live user builds the semantic layer and lands on the Schema Config view, there was no indication of what to do next. Added a "Try a query →" button in the header that only appears for live users (`!IS_DEMO_MODE`) once at least one entity has been discovered. Clicking it fires the `navigate-to-tab` event to take the user directly to the QueryInterface, making the "build → explore" journey explicit.

---

## 2026-06-19 (continued — session 10v)

### Comprehensive live/demo audit — all remaining paths verified clean

Full systematic sweep of every component and backend endpoint not covered by prior sessions. No new bugs found — all paths correctly guarded.

**Frontend components confirmed clean:**
- `AgentWorkflows.tsx` — `WORKFLOWS[sectorId]` AW names properly gated; `AgentsView.tsx` uses `IS_DEMO_MODE ? WORKFLOWS[...] : []`
- `ConfigurationView.tsx` — `AGENT_SECTOR` AW content gated; `AWConfigSources` gated; Test button only rendered when `connected`, and `connected` is only true in demo mode
- `SemanticDraftView.tsx` — empty states navigate to sources; `DEMO_CONTEXT_DOCS` gated by `IS_DEMO_MODE`
- `OnboardingWizard.tsx`, `AgentBuilder.tsx`, `CommandPalette.tsx`, `Layout.tsx`, `ComplianceView.tsx` — all clean
- `ContextTab.tsx` — `DEMO_FALLBACK_*` only in `if (IS_DEMO_MODE)` catch blocks; live errors show generic message
- `MappingView.tsx` — `DEMO_DEFS` / `DEMO_AMBIGUITIES` only in `IS_DEMO_MODE` guards; live empty states properly shown
- `Dashboard.tsx` — KPI cards, activities, entities, sources all derive from real backend data for live users

**Backend endpoints confirmed clean:**
- `/api/ask` (legacy) — alias to `semantic_ask()`; no separate AW path
- `aw_engine.py:run_aw_query()` — dead code, never called from any endpoint
- `context/router.py` — `list_entities`, `list_metrics` use `exclude_seeded=True` for live users
- `context/store.py:seed_demo_data()` — only called when `FRA_SEED_DEMO_SOURCES=true` env var set
- `semantic_ask()` — `hidden_tables`, `merged_docs` (no AW base docs for live), 409/503 guards all correct
- `list_templates()` and `list_example_questions()` — both filter demo-sourced templates for live users
- `sl_metrics`, `sl_hierarchies`, `sl_segments` — `AND is_builtin = 0` applied for live users
- `to_semantic_docs_override(mode="live")` — `exclude_seeded=True` for live; user-created docs only

**Dead code identified (no action needed):**
- `api/mockData.ts` — exports AW mock data but is never imported by any component

---

## 2026-06-19 (continued — session 10u)

### Frontend: fix "Clear" buttons in QueryInterface failing silently for live users

- `frontend/src/components/QueryInterface.tsx`

  The "Clear" buttons for recent query history and saved favorites called `localStorage.removeItem(\`query-history-${sectorId}\`)` using the raw sector id, but the keys were stored under `query-history-${modeScopedSector(sectorId)}` (i.e. `query-history-live-manufacturing` for live users). Result: for live users, "Clear" appeared to work (local state reset) but the data survived in localStorage and reappeared on reload. Also, the bulk-delete of backend saved queries on "Clear favorites" passed `stableQueryId(sectorId, q)` (raw sector), but the backend records were keyed under the mode-scoped id — so deletions silently failed. All three references now use `modeScopedSector(sectorId)`.

---

## 2026-06-19 (continued — session 10t)

### Frontend: scope agent-run localStorage key to mode to prevent live↔demo run bleed

- `frontend/src/data/agentStore.ts`

  Agent run summaries were stored under `agent-runs-${sectorId}` (e.g. `agent-runs-manufacturing`) regardless of mode. A live user's agent runs could therefore appear when switching to demo mode on the same browser, and vice versa. Fixed: `KEY` now uses `modeScopedSector(sectorId)` → `agent-runs-manufacturing` for demo, `agent-runs-live-manufacturing` for live.

---

## 2026-06-19 (continued — session 10s)

### Frontend: fix custom-agent backend isolation between live and demo users

- `frontend/src/data/customAgents.ts`

  Same bucket-sharing bug as saved queries: `listAgents(sectorId)` and `createAgent(agent)` both used the raw sector id (`manufacturing`) rather than the mode-scoped one (`live-manufacturing`). Live and demo users could therefore see each other's custom agents when fetched from the backend. Fixed:
  - `listAgents()` now receives `modeScopedSector(sectorId)` so the GET uses the correct scope.
  - `addCustomAgentPersisted()` now creates a `backendAgent` with `sectorId: modeScopedSector(...)` before calling `createAgent()`, so the POST writes to the correct scope.
  localStorage is unaffected (the KEY function already applied `modeScopedSector` there).

---

## 2026-06-19 (continued — session 10r)

### Frontend: fix saved-query backend isolation between live and demo users

- `frontend/src/components/QueryInterface.tsx`

  Saved queries persisted to the backend (`/api/queries/saved`) used the raw sector id (e.g. `manufacturing`) as the `sector_id` scope, so live and demo users shared the same backend bucket. Now `modeScopedSector(sectorId)` is used when calling `listSavedQueries` and `saveQueryRemote` / `deleteSavedQueryRemote`, giving live users an isolated `live-<sector>` namespace. localStorage favorites (already scoped via `modeScopedSector`) are unaffected.

---

## 2026-06-19 (continued — session 10q)

### Frontend: actionable navigation CTAs in QueryInterface error bubbles for 409/503

- `frontend/src/components/QueryInterface.tsx`

  When a live user asked a question and got a 409 ("No data sources connected") or 503 ("semantic layer not ready") error, the chat showed an error message with no actionable next step — just the error text and no Retry button (correctly suppressed since retrying would produce the same error). Now:
  - HTTP 409 error: shows "Connect a data source →" button that navigates to the Sources tab
  - HTTP 503 error: shows "Run Pipeline →" button that navigates to the Process tab
  Added `httpStatus?: number` field to the `Message` interface so `MessageBubble` can distinguish these error types without string-matching the error text.

---

## 2026-06-19 (continued — session 10p)

### Backend: generic disambiguation hint in LLM system prompt for live users

- `backend/app/main.py` (`get_system_prompt`)

  The `/api/semantic/system-prompt` endpoint (used in direct-LLM frontend mode) appended an instruction `"isDisambiguation: true only when 'fatturato'/'revenue' is ambiguous"` to every system prompt, including those served to live-mode users. "Fatturato" is an AdventureWorks / Italian-ERP term with no relevance outside the demo dataset. For live users the instruction is now replaced with a generic form: `"isDisambiguation: true when a key term in the question maps to multiple possible columns and a follow-up clarification is needed"` — broader and not tied to any demo vocabulary.

---

## 2026-06-19 (continued — session 10o)

### Frontend: context-aware empty state CTA in Dashboard "Data Entities" section

- `frontend/src/components/Dashboard.tsx`

  The "Data Entities" panel on the Dashboard always showed "Build the semantic layer →" when empty for live users, regardless of whether data sources were already connected. Live users with connectors registered but no pipeline run yet now see "Run Pipeline →" (navigates to Process tab) instead — more accurate next step since they don't need to re-configure sources. Live users with no connectors still see "Connect a data source →" (navigates to Sources tab).

---

## 2026-06-19 (continued — session 10n)

### Frontend: keep no-sources warning visible in ProcessView during and after pipeline simulation

- `frontend/src/components/ProcessView.tsx`

  The "No data sources connected yet" amber banner in ProcessView was gated by `runState === 'idle'`, causing it to disappear the moment a live user clicked "Run Pipeline". The simulation then completed showing empty log entries while the banner was gone, hiding the explanation for why nothing useful happened. Removed the idle-state guard so the banner persists in all run states (running, done, and idle) for live users with no connected sources.

---

## 2026-06-19 (continued — session 10m)

### Frontend: fix misleading "No data source connected" message when backend is offline in QueryInterface

- `frontend/src/components/QueryInterface.tsx`

  When the backend was temporarily unreachable, live users saw an amber banner titled "No data source connected" — which is inaccurate: their data sources are connected, the backend is just down. Replaced with "Backend temporarily unavailable / Could not reach the query service. Please try again in a moment." Demo mode banner unchanged (shows "Demo engine active").

---

## 2026-06-19 (continued — session 10l)

### Frontend: context-aware primary CTA in OverviewScreen dark section

- `frontend/src/components/OverviewScreen.tsx`

  The dark "Ready to build your semantic layer?" CTA section at the bottom of the Overview page always showed "Start from Connect →" as its primary button for live users, regardless of pipeline state. Made it follow the same progressive logic as the hero section: if the semantic pipeline is built → "Query Your Data →" (navigates to Query); if sources are registered but not yet built → "Run Pipeline →" (navigates to Process); if no sources at all → "Connect First Source →" (navigates to Sources). Demo mode keeps the original "Start from Connect →" label unchanged. Eliminates the jarring experience of seeing "Start from Connect →" when a live user already has a full semantic layer built.

---

## 2026-06-19 (continued — session 10k)

### Frontend: suppress misleading Retry button on prerequisite-failure errors in QueryInterface

- `frontend/src/components/QueryInterface.tsx`

  When a live user submits a query but hasn't connected data sources (HTTP 409) or the pipeline hasn't been built yet (HTTP 503), the error bubble previously showed a "Retry" button. Retrying immediately produces the same error — the prerequisite hasn't changed. Added `canRetry = status !== 409 && status !== 503` so the Retry button is suppressed for these two statuses. The descriptive error message ("No data sources connected. Add a data source before asking questions." / "The semantic layer is not ready yet.") remains visible and guides the user to the correct next action.

---

## 2026-06-19 (continued — session 10j)

### Frontend: pre-run warning for live users with no sources in ProcessView

- `frontend/src/components/ProcessView.tsx`

  Added a pre-run warning banner inside the Semantic Layer Pipeline card. When a live user visits the Process tab and no data sources have been ingested yet (`liveConfig !== null && connectors.length === 0` and pipeline is idle), an amber callout now appears before the step indicators: "No data sources connected yet. Connect a source before running the pipeline." with a "Go to Sources →" CTA. This prevents the confusing experience of running the pipeline and seeing only empty/warning log output. The banner is hidden once any source is connected or when the pipeline is running/done.

---

## 2026-06-19 (continued — session 10i)

### Frontend: context-aware empty states for live users in SemanticLayerView

- `frontend/src/components/SemanticLayerView.tsx`

  **Sources section empty state**: When a live user visits Semantic Layer → Data Sources with no backend sources ingested yet and no manually-documented sources, the empty state previously just offered "Document manually." For live users with the backend online but no sources connected, the primary CTA now says "Go to Connect →" (dispatches `navigate-to-tab: sources`) with a secondary "Document manually" option. Demo mode and offline mode are unchanged.

  **Metrics section empty state**: Was a generic "No metrics defined yet." For live users with the backend online, the message is now context-aware:
  - Pipeline built (`kgStatus !== null`): "No metrics were auto-extracted from your pipeline. Define them manually above."
  - Pipeline not yet built (`kgStatus === null`): "Run the semantic pipeline first — metrics will be auto-extracted from your data. You can also define custom ones manually above."

  **Hierarchies section empty state**: Same pattern — when live + backend online + pipeline not built, the message now reads "Run the semantic pipeline to auto-extract dimension hierarchies, or define them manually above." instead of the generic instruction.

---

## 2026-06-19 (continued — session 10h)

### Frontend: UX improvements for live users in OverviewScreen

- `frontend/src/components/OverviewScreen.tsx`

  **KG stats in status bar for live users**: The dark status bar chip showing Knowledge Graph node/edge counts was gated by `isAW` (manufacturing demo only). Live users who had built their pipeline never saw KG stats even though the data was available from `semStatus?.kg_nodes`. Changed condition from `{isAW && ...}` to `{(isAW || kgNodes > 0) && ...}` — live users with a built pipeline now see `X nodes · Y edges` in the status bar. The `isAW` fallback ("not yet built") is preserved for demo users who haven't built yet.

  **Context-aware primary CTA for live workspaces**: The hero section always showed "Start from Connect →" regardless of workspace state. For live users mid-journey this was misleading — if sources are connected but the pipeline hasn't run, "Run Pipeline →" is the next action; if the pipeline is built, "Query Your Data →" is more relevant. Added a 3-state conditional:
  - No sources → "Connect First Source →" (→ sources tab)
  - Sources registered, pipeline not built → "Run Pipeline →" (→ process tab)
  - Pipeline built (`semBuilt`) → "Query Your Data →" (→ query tab)
  Demo mode keeps the original "Start from Connect →" unchanged.

  **Live-data chips in Guided Journey cards**: The journey cards showed AW demo chips (e.g. "193,062 nodes · 313,193 edges") for demo users but nothing for live users. Added live-specific data chips for non-demo workspaces:
  - Step 1 (Sources): shows `N source(s) connected` when sources are registered
  - Step 2 (Ontology): shows `N entities · N relationships` when entities exist
  - Steps 3–4 (KG / Semantic Layer): shows `N nodes · N edges` when pipeline is built
  These are derived from the same real-time state already loaded (`registeredSources`, `entityCount`, `edgeCount`, `kgNodes`) — no extra API calls.

---

## 2026-06-19 (continued — session 10g)

### Frontend: fix double-wrapped error messages in QueryInterface
- `frontend/src/components/QueryInterface.tsx`
  - The inner `try/catch` around `ask()` was re-throwing a wrapped `new Error(`Backend: ${backendErrorMessage(e)}`)`. The outer `.catch()` handler then called `backendErrorMessage(e)` on this plain `Error`, which returns `String(e)` = `"Error: Backend: ..."`, then added another `"Error: "` prefix — yielding triple-prefixed messages like `"Error: Error: Backend: No data sources connected..."` to users.
  - Fix: removed the inner `try/catch` (letting the AxiosError propagate naturally to the outer handler). Updated the outer `.catch()` to distinguish AxiosErrors (using `backendErrorMessage`) from plain `Error` objects (using `.message` directly). Now shows clean messages like `"Error: No data sources connected. Add a data source before asking questions."`.
  - Side benefit: the 409 status check in the outer catch now correctly fires for backend errors (previously the wrapped plain `Error` had no `.response.status` property, so the 401 guard was silently bypassed for backend auth errors).

## 2026-06-19 (continued — session 10f)

### Backend + Frontend: fix two remaining demo-content leaks

#### `backend/app/main.py` — `semantic_sources` legacy fallback
- The legacy connector fallback path at the bottom of `semantic_sources()` (lines ~2315-2343) iterated `["erp", "crm", "hr_pim"]` — the three hardcoded demo connector names. This path executes when `mgr is None` (no unified DuckDB source manager loaded). A live user whose pipeline hadn't initialized `mgr` yet would see these AW connector names in the API response (even though the `hidden` filter at the top of the path would have caught any table-level data).
- Added an early-return guard: `if hidden: return []`. Live users never have "erp"/"crm"/"hr_pim" connectors — the legacy path is demo-only.

#### `frontend/src/components/AgentBuilder.tsx` — schedule label visible in live mode
- The inline label `(accelerated in demo)` was rendered unconditionally in the agent schedule selector UI (no `IS_DEMO_MODE` guard). Live users saw this parenthetical text when building a scheduled agent.
- Added `import { IS_DEMO_MODE } from '../lib/demoMode'` and wrapped the label in `{IS_DEMO_MODE && ...}`.

## 2026-06-19 (continued — session 10e)

### Backend: filter demo context doc from GET /api/semantic/draft/context; deduplicate formula regex
- `backend/app/main.py`
  - `list_draft_context()` (`GET /api/semantic/draft/context`): Added `_hidden_demo_tables(current_user)` filter — live-mode users no longer see the AW "OrionSales — Business Context" doc from this endpoint (same guard applied in `_get_semantic_draft()`). Changed `_` parameter to `current_user` so the mode is accessible.
  - Extracted `_FORMULA_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")` as a module-level constant (alongside `_FUNNEL_IDENT_RE`). Replaced two local `re.compile(...)` calls inside `_get_semantic_draft()` (line 832) and `get_live_config()` (line 3564) with the shared constant to avoid recompiling the pattern on every request.

## 2026-06-19 (continued — session 10d)

### Backend: hide demo context doc from /api/semantic/draft for live users
- `backend/app/main.py`
  - `_get_semantic_draft()`: The `context_docs` list comprehension returned all `connector_type == "context_doc"` registry entries without filtering by `is_default`. The AW demo seeds a context doc ("OrionSales — Business Context", `is_default=True`) that describes bicycle-manufacturer business rules. Live users could see this in the `SemanticDraftView` "Context" tab via `GET /api/semantic/draft`. Added `and (not hidden or not c.is_default)` to the comprehension — when `hidden` is non-empty (live mode), only non-default context docs are returned.

## 2026-06-19 (continued — session 10c)

### Backend: fix metric formula leak in get_live_config endpoint
- `backend/app/main.py`
  - `/api/live-config` (`get_live_config`): The guard at lines 3551-3553 only cleared `metrics_raw` when `hidden and not entities`. For live users who had connected their own sources (entities non-empty), `metrics_raw` still contained AW metrics including Italian labels like "Fatturato (ricavi puri)" and formulas like `SUM(sales_order_header.subtotal_amount)`. These were returned to the frontend and could appear as KPI labels in the Dashboard (line 426: `liveConfig?.metrics.find(m => m.name === 'revenue')?.label`).
  - Applied the same regex-token formula filter already used by `/api/semantic/status` (lines 828-837): extract identifier tokens from each metric's formula and exclude any metric whose token set intersects the hidden table names. Now consistent across both endpoints regardless of whether the user has real entities yet.

## 2026-06-19 (continued — session 10b)

### Backend: apply formula-based metric filter in plan validator
- `backend/app/semantic/layer.py`
  - `_build_validated_plan()`: The metric validation at line 1221 used `m not in _hidden_bp` (entity-name filter). Like the intent classifier bug above, AW metric names ("revenue") don't match hidden table names, so they passed as valid plan metrics for live users. Added the same formula-based filter: when `_hidden_bp` is non-empty, fetch `list_metric_objects()` formulas and exclude metrics whose formula references any hidden table before checking if the plan's metric is valid.

## 2026-06-19 (continued — session 10)

### Backend: filter AW-seeded catalog metrics from live-mode responses
- `backend/app/semantic/layer.py`
  - `_llm_ontology_mapping()` (intent classifier): The metric names passed to the LLM were filtered only by exact name match against `hidden_tables`. Since AW metrics are named "revenue", "revenue_with_tax", etc. (not table names), they slipped through. Added formula-based filtering: when in live mode, fetches `list_metric_objects()` and excludes any metric whose formula references a hidden table (e.g. `SUM(sales_order_header.subtotal_amount)` is excluded because "sales_order_header" is a hidden table). Prevents the LLM intent classifier from treating AW metric definitions as available options for live users.
  - `_q_certified_metrics()`: When `catalog.list_metric_objects()` returned results, it was returning ALL catalog metrics including AW-seeded ones with AW-specific formulas (`SUM(sales_order_header.subtotal_amount)`, `SUM(sales_order_header.total_due)`, etc.) to live users asking "what metrics are available?" Added `_cm_hidden_lower` filter: excludes any catalog metric whose formula contains a hidden table name before building the response. Live users with no user-defined metrics now fall through to the `"No certified metrics configured"` response rather than receiving AW formulas.

## 2026-06-19 (continued — session 9)

### Backend: sanitize raw exception messages in AgentExecutionError
- `backend/app/agentic/executive.py`
  - In `approve_action()`, the broad `except Exception` handler wrapped arbitrary exception strings directly into `AgentExecutionError(str(exc))`. The router then returned this as `detail.message` in HTTP 409 responses. A raw `sqlite3.OperationalError` or `OSError` from `_execute_writeback` or `_propagate_changes` could expose internal schema details (table names, column names, file paths) to API callers.
  - Fix: only pass the original exception message through if the exception is a known, controlled validation type (`ValueError` or `AgentSemanticValidationError`). All other exception types are replaced with a generic "Action execution failed — see audit log for details" message. The full exception is still logged to the audit record (unchanged), so operators can diagnose failures without the details leaking to callers.

## 2026-06-19 (continued — session 8)

### Frontend: exclude AdventureWorks case card from UseCasesView for live users
- `frontend/src/components/UseCasesView.tsx`
  - The `USE_CASES` array contains an "AdventureWorks Cycles" entry with explicit AW schema identifiers: "fatturato", "subtotal_amount", "total_due", "matricolaDip", "dipendenti_hr", "product_catalog_pim", salesperson names "Linda Mitchell" and "Jae Pak". The array was rendered without an `IS_DEMO_MODE` guard, so live users saw this card.
  - Added `displayedCases`: for live mode, filters out the entry with `id === 'adventureworks'`. Demo mode continues to show all 4 cases.
  - Updated header strip case count and sector list to derive from `displayedCases`.
  - Updated card grid to map `displayedCases` instead of `USE_CASES`.
  - Updated summary stats section ("The N use cases", total value, sectors) to compute dynamically from `displayedCases`, so the numbers remain consistent in both modes.

## 2026-06-19 (continued — session 7)

### Frontend: OverviewScreen shows registered sources before pipeline is built
- `frontend/src/components/OverviewScreen.tsx`
  - Added `listSources()` call (from `../api/sources`) to the parallel `useEffect` fetch. Stores non-default registered sources in a new `registeredSources` state slice.
  - `stepDone(step)`: Step 1 (Sources) is now marked done as soon as any non-default source is registered in the registry — independent of whether the pipeline has been built. Previously `stepDone(1)` returned `semBuilt || isAW`, so a live user who connected a source but hadn't yet run the pipeline saw step 1 as "not started" even though the source was present in the registry.
  - Status bar "Sources" chip: Falls back to `registeredSources` label list when `connectors` (pipeline-reported) is empty. Shows "N registered" instead of "none connected yet" when sources exist pre-pipeline.
  - Workspace status card "Data Sources" value and sub-text: Uses `connectors.length || registeredSources.length` so the card shows the correct count regardless of pipeline state.
  - Problem section "N systems" stat: Same fallback to `registeredSources.length`.
  - CTA bullet: Shows "N sources registered — run pipeline to activate" when sources exist but the pipeline hasn't run yet.

## 2026-06-19 (continued — session 6)

### Backend: root-cause fix — exclude AW base docs from live-mode ask() calls
- `backend/app/main.py`
  - `semantic_ask()` endpoint: When `hidden` is non-empty (live mode), the `merged_docs` object passed to `layer.ask()` now contains ONLY the user's own context-store entries — NOT the AW YAML semantic docs (`_base_docs`). Previously, `_base_docs` was always merged in regardless of mode. This meant `_effective_docs` inside every `_q_*` handler contained AW entities, metrics, glossary terms, and disambiguation rules for live users. All the per-handler `_live` guards were defensive workarounds for this root cause. With this fix, live users' `_effective_docs` is clean: it only reflects what the user has explicitly added via the Context tab (or is empty for a fresh workspace), and the `_live` guards become a true defense-in-depth layer rather than the primary protection.

## 2026-06-19 (continued — session 5)

### Backend: filter default (AW) context docs from live-mode LLM SQL prompts
- `backend/app/main.py`
  - `_sync_context_docs_to_layer()`: Now includes `is_default` in the dict passed to `set_context_docs()`, so the layer can distinguish user-created context docs from seeded demo ones.
- `backend/app/semantic/layer.py`
  - `_execute_llm_sql()`: When in live mode (`hidden_tables` non-empty), filters out context docs where `is_default=True` before building the LLM system prompt. Previously, in a hybrid demo+live deployment (where `FRA_SEED_DEMO_SOURCES=true`), the OrionSales business context doc (with AW-specific disambiguation rules, revenue figures, bridge structures, etc.) was injected verbatim into every live user's SQL generation prompt — confusing the LLM with irrelevant AW schema details and potentially leaking AW terminology into LLM reasoning traces.

## 2026-06-19 (continued — session 4)

### Backend: defense-in-depth — filter hidden demo tables from payload validator and plan builder
- `backend/app/semantic/layer.py`
  - `_allowed_catalog_tables()`: Now reads `hidden_tables` from the thread-local and excludes both hidden entity names and their source table names from the result set. Previously, AW source tables (SalesOrderHeader, HumanResources.Employee, etc.) were included in the "allowed" set, meaning the `_validate_llm_payload_security()` guard would pass LLM payload strings that referenced them. Now those tables are excluded, so any LLM payload that sneaks in an AW table reference is blocked at the payload security gate before it ever reaches SQL generation.
  - `_build_validated_plan()`: Added `_hidden_bp` (read from `hidden_tables` thread-local) and applied it when building `catalog_entities` and `metrics` sets. Without this, an AW entity or metric that slipped past the intent classifier filter would have passed the catalog-membership check in the plan validator. With this change the plan builder validates against only the entities and metrics visible to the current request.

## 2026-06-19 (continued — session 3)

### Backend: filter hidden tables from intent classifier system prompt
- `backend/app/semantic/layer.py`
  - `_llm_ontology_mapping()`: The system prompt for the LLM intent classifier listed AW demo entity names, metric names, relation hints, and table names. For live users, all four lists are now filtered by `hidden_tables`. Previously the classifier saw "Allowed ontology entities: SalesOrder, Customer, account, dipendenti_hr…" and "Known metrics: total_revenue, gross_revenue…" for live users — this could cause incorrect intent classification (e.g., mapping a generic question to AW-specific handlers) as well as leaking AW terminology into log artifacts. The filter uses the same `getattr(thread_local, 'hidden_tables', frozenset())` pattern used throughout live-mode guards.

## 2026-06-19 (continued)

### Backend: filter hidden tables from "no LLM configured" entity hint in _execute_llm_sql
- `backend/app/semantic/layer.py`
  - `_execute_llm_sql()`: When no LLM provider is configured, the method builds a hint like "Try asking about: account, sales_order_header…" using `self._catalog.list_entities()`. That call returns ALL entity names including AW demo entities. Fixed to filter by `hidden_tables` (same thread-local pattern used throughout the live-mode guards) before building the hint string.

## 2026-06-19

### Backend: fix AW entity names leaking into live-mode "entity not modeled" responses
- `backend/app/semantic/layer.py`
  - `_q_entity_not_modeled()`: For live-mode requests (`hidden_tables` non-empty), now queries `self._catalog.get_draft_entities()` filtered by `hidden_tables` to get only the user's own entities, rather than falling through to `self._ontology.entity_names()` or `self._catalog.list_entities()` which both return AW demo entities (the shared ontology is not per-request filtered). If the live user has no entities yet, returns a CTA ("Connect a data source and run the pipeline"). Demo mode path unchanged.

## 2026-06-18 (session 3)

### Backend: fix `aw:` URI prefix leaking into live-mode ontology nodes
- `backend/app/main.py`
  - `get_live_config()` (line ~3597): Changed `uri: f"aw:{e['name']}"` to `uri: f"entity:{e['name']}"` for nodes built from live-user data. The `aw:` prefix (short for AdventureWorks) was leaking into the `uri` field of live-user ontology nodes and was displayed in the UI in `OntologyGraph.tsx` ("URI: aw:Orders"), `SemanticLayerView.tsx`, and `MappingView.tsx`. The prefix is purely presentational (no functional branching on it), so `entity:` is a clean drop-in that removes the AW branding from live users' views.

### Backend: tag seeded AW glossary terms as `is_builtin=True`; exclude from live-mode glossary lookups
- `backend/app/metadata/catalog.py`
  - Added `is_builtin: Mapped[bool]` column to `ContextDocRow` (default `False`, `server_default="0"`)
  - Added `Boolean` to the SQLAlchemy imports
  - `_migrate_schema()`: adds `ALTER TABLE context_docs ADD COLUMN is_builtin INTEGER DEFAULT 0` for existing databases
  - `seed_glossary_docs()`: sets `is_builtin=True` on newly seeded rows; also back-fills the flag on rows that already existed (created before the column was added)
  - `list_context_docs()`: accepts `exclude_builtin: bool = False`; when `True`, filters with `.where(ContextDocRow.is_builtin.is_(False))` so user-added glossary entries are returned but seeded AW entries are not
- `backend/app/semantic/layer.py`
  - `_q_glossary_lookup()`: computes `_live_mode` from `hidden_tables` and passes `exclude_builtin=_live_mode` to `list_context_docs()`. Removed duplicate `_live` variable from the hardcoded-fallback block (now uses `_live_mode`). Updated live-mode "not found" message: "not in your workspace glossary — add via Semantic Layer → Context tab."
  - **Effect**: a fresh live user asking "define fatturato" no longer receives AW-specific definitions (subtotal_amount, total_due, ~$20M figures). They receive the CTA to add glossary terms. Live users who have added their own glossary terms continue to see those. Demo users are unaffected.

## 2026-06-18 (continued)

### Backend: improve 503 error messages for "layer not ready" cases
- `backend/app/main.py`
  - `POST /api/semantic/ask` (line ~1769): Changed `"Semantic layer is not loaded — check server logs"` to `"The semantic layer is not ready yet. Connect a data source and build the pipeline to enable querying."` This message is passed through `backendErrorMessage()` on the frontend (string detail bypasses the generic 503 fallback) and shown directly in the query error bubble — the previous message included an internal "check server logs" instruction that users cannot act on.
  - Six edit/template management endpoints (lines ~2681–2911): Changed `"Semantic layer not loaded"` to `"Semantic layer not ready — build it from Data Sources first"`. These endpoints are hit when users try to edit entities/metrics/templates before the pipeline has been run; the new message explains what to do.

### Frontend: live users can now choose their industry sector during onboarding
- `frontend/src/components/OnboardingWizard.tsx`
  - **Before**: live users were silently defaulted to `manufacturing` sector (`selectedSector = 'manufacturing'`) with the industry picker hidden behind `IS_DEMO_MODE`. This meant connector recommendations in Configuration, ontology builder prompts, and workspace UI were always manufacturing-flavoured regardless of the user's actual industry.
  - **After**: the sector picker (4-card grid: Manufacturing / Retail / Healthcare / Finance) is shown for both demo and live users in step 1. `selectedSector` now starts as `null` for everyone, so the "Get started" button stays disabled until both a company name and an industry are chosen. `canAdvanceStep1` already required `selectedSector !== null`, so no logic change was needed beyond removing the `IS_DEMO_MODE &&` guard.
  - Demo-only wizard steps (ontology preview, custom entity, connectors, recommended agent) are unchanged — those are only shown in demo mode (`TOTAL_STEPS = IS_DEMO_MODE ? 5 : 1` is preserved).

### Frontend: empty states for Lifecycle and Conversion Funnel in ProcessView for live users
- `frontend/src/components/ProcessView.tsx`
  - **Lifecycle section**: when `processStages` is empty and `!IS_DEMO_MODE`, show a message "Process stages will appear here once data sources are connected and the pipeline has run." with a "Connect a data source" link. Previously the section header was visible but the content area was blank.
  - **Conversion Funnel section**: when `funnel` is empty and `!IS_DEMO_MODE`, show "Funnel metrics will be derived from your transaction data once the pipeline runs." with a "Run pipeline" CTA. Previously the summary footer ("Conversion rate: — · Stages: 0") was visible with no content above it, which looked broken.
  - In both cases, live users with real data (from `liveConfig`) are unaffected — the non-empty path renders as before.

### Backend: sanitize raw exceptions in sync/delete/rebuild source endpoints
- `backend/app/connectors/duckdb_source_manager.py`
  - Added `fallback` kwarg to `_safe_ingest_error()` (default unchanged) so callers can supply context-specific user-facing fallback messages without exposing raw DuckDB catalog errors.
- `backend/app/main.py`
  - **`POST /api/sources/{id}/sync`**: `except Exception as exc: detail=str(exc)` — leaked raw DuckDB catalog errors (e.g., "Catalog Error: Table with name X does not exist!") verbatim to the caller. Fixed to use `_safe_ingest_error(exc)`.
  - **`DELETE /api/sources/{id}`**: `detail=f"Source removed from registry but snapshot rebuild failed: {exc}"` — same leak on rebuild failure after removal. Fixed to use `_safe_ingest_error(exc, fallback="Source removed — snapshot rebuild failed…")`.
  - **`POST /api/data/store/rebuild`**: `detail=f"Rebuild failed: {exc}"` — same leak on full-store rebuild. Fixed to use `_safe_ingest_error(exc, fallback="Rebuild failed — please check your source configurations and try again")`.

---

## 2026-06-18

### Backend: AW-specific intent heuristics skipped for live-mode requests
- `backend/app/semantic/layer.py`
  - Two rule-based guards in `_resolve_intent()` applied to ALL users, not just demo mode:
    1. **Nationality guard** (line ~429): If a user typed "italian", "nazionalit", or "italiano", the handler returned an "impossible" response: "The field 'employee nationality' is not available in any of the configured data sources." This is AW-specific — the AW HR CSV has no nationality column. Live users with HR data that does include nationality would get a wrong "impossible" answer.
    2. **Supplier guard** (line ~437): If a user typed "fornitore", "fornitori", "supplier", or "vendor", the handler returned `entity_not_modeled` with entity "Supplier". Live users who have modelled a Supplier entity in their ontology would get "Supplier is not modeled" incorrectly.
  - Both guards are now wrapped in `if not _is_live` using the `hidden_tables` thread-local. Live users fall through to the LLM SQL generation path.

### Backend: AW certified-metrics fallback skipped for live-mode requests
- `backend/app/semantic/layer.py`
  - `_q_certified_metrics()` fell back to `_CERTIFIED_METRICS` (a hardcoded list with AW-specific `revenue = SUM(subtotal_amount)`, `active_customers = COUNT(DISTINCT accountId) WHERE accountId > 0`, etc.) when both `_effective_docs` and `_catalog` returned no metrics. Live users asking "what metrics are available?" would receive AW metric definitions. Gated fallback on `not _live`; live users now get an empty list with a neutral message.

### Backend: AW disambiguation rules fallback skipped for live-mode requests
- `backend/app/semantic/layer.py`
  - `_q_disambiguation_rules()` fell back to three hardcoded AW rules (R1: accountId dedup, R2: subtotal_amount/total_due, R3: HR freshness) when `_effective_docs` was None. A live user asking "what are the disambiguation rules?" would receive AW-specific rules entirely unrelated to their workspace.
  - Fix: fallback is now gated on `not _live`. Live users receive an empty rules list with "No disambiguation rules configured for this workspace."

### Backend: AW glossary fallback skipped for live-mode requests
- `backend/app/semantic/layer.py`
  - `_q_glossary_lookup()` has a deprecated `_GLOSSARY` dict fallback (last resort when no effective docs and no catalog glossary docs exist). The dict contains AW-specific definitions for "cliente attivo", "fatturato", "revenue", "revenue_with_tax", "margin", "active_customers", "duplicato", "accountid", "make only" — all with dollar figures and AW column names.
  - A live user asking "what is fatturato?" would previously receive: `"'Fatturato' is an ambiguous term in the system: it can refer to revenue (SUM subtotal_amount, ~$20M)…"`.
  - Fix: the `_GLOSSARY` path is now gated on `not _live` using the `hidden_tables` thread-local. Live users get a generic "term not in your glossary — add via Context tab" response instead.

### Backend: Italian ambiguity guards skip live-mode requests
- `backend/app/semantic/layer.py`
  - The `_resolve_intent()` method contained two AmbiguityError guards triggered by Italian terms: one for "fatturato" (mentioning `subtotal_amount`, `~$20M`, `total_due`, `~$22.4M`) and one for "vendite" (mentioning `SalesOrder`). These guards encode AdventureWorks demo dataset semantics.
  - A live Italian-language user who types "fatturato" or "vendite" would get a disambiguation prompt referencing AW column names and dollar figures unrelated to their workspace.
  - Fix: both guards are now wrapped in `if not _is_live_mode:` where `_is_live_mode = bool(hidden_tables)`. The `hidden_tables` frozenset is populated for live users by `main.py` at request time. Live users' queries fall through to the LLM SQL generation path which uses their actual schema context.

### Backend: remove hardcoded AW entity names from "entity not modeled" fallback
- `backend/app/semantic/layer.py`
  - `_q_entity_not_modeled()` had a final fallback at the bottom of its if/elif chain (used when `_effective_docs`, `_ontology`, and `_catalog` are all None) that listed `"Customer, SalesOrder, SalesOrderLine, Product, Employee, Territory, Salesperson"` — the AdventureWorks demo entity set. A live user who queries an unrecognised entity while the semantic layer is still initialising would see AW entity names, not their own.
  - Replaced with `None` sentinel; when no entity list is available, the message now reads "Connect a data source and run the pipeline to build your ontology." instead.

### Backend: sanitize source ingestion error messages before storing in registry
- `backend/app/connectors/duckdb_source_manager.py`
  - Added `_safe_ingest_error(exc)` helper. Our own `ValueError` / `FileNotFoundError` / `NotImplementedError` carry crafted messages the user needs (e.g. "Could not connect to PostgreSQL: …", "Excel file contains no rows"). Any other exception type (DuckDB catalog errors like "Catalog Error: Table 'X' already exists", driver internals, etc.) is replaced with a generic "Ingestion failed — please check the source configuration and try again".
  - Line 699: `self._registry.patch(cfg.id, status="error", error_msg=str(exc))` → `error_msg=_safe_ingest_error(exc)`
- `backend/app/main.py`
  - `add_source` endpoint rebuild failure (line ~2151): same pattern. Imports and uses `_safe_ingest_error` from the connector module. Previously a raw `str(exc)` from the rebuild loop (which can be a DuckDB catalog error with internal table names) was stored and returned verbatim via `GET /api/sources` to all authenticated users (`user` + `admin` roles).

### Frontend: DataExplorer empty state for live workspaces with no ontology
- `frontend/src/components/DataExplorer.tsx`
  - When a live user has no entities in their ontology (`!IS_DEMO_MODE && ontology.nodes.length === 0`), the explorer previously showed a blank entity list sidebar and the text "Select an entity to browse its data" — which is confusing when there is nothing to select.
  - Now renders a centred empty state with "No entities in your ontology yet" and a "Go to Ontology Builder" inline link that fires `navigate-to-tab` → `sembuilder`.

### Frontend: QueryInterface query error handler uses backendErrorMessage
- `frontend/src/components/QueryInterface.tsx`
  - The `resolve().catch` handler for `/api/semantic/ask` errors was using `e instanceof Error ? e.message : 'Unknown error'` — which could surface raw Axios or JS error messages (e.g. network stack traces, serialised objects) to users in the chat error bubble.
  - Replaced with `backendErrorMessage(e)` which handles FastAPI validation arrays, 500/503 fallbacks, ECONNABORTED, and nested `detail.message` objects. `backendErrorMessage` was already imported in this file.

---


### Frontend: QueryInterface — "no sources" CTA for fresh live workspaces
- `frontend/src/components/QueryInterface.tsx`
  - Added `questionsLoaded` state so the component knows when the example-questions fetch has settled.
  - When a live user has no data sources connected, the backend returns an empty array from `/api/semantic/example-questions`. Previously the suggestions section was silently hidden. Now a "No data sources connected yet" hint is shown with a "Go to Sources" inline link that fires `navigate-to-tab` → `sources`.
  - The hint only appears when: `!IS_DEMO_MODE && questionsLoaded && exampleQuestions.length === 0 && backendOnline === true` — i.e., never flashes during loading, never shown in demo mode, never shown when the backend is confirmed offline (the existing "No data source connected" amber banner already handles that case).
  - Added `Database` icon import from `lucide-react`.

### Frontend: consistent `backendErrorMessage()` usage across all catch blocks — SemanticDraftView included
- `frontend/src/components/SemanticDraftView.tsx`
  - `QueryTemplateForm` save handler catch block was using `e instanceof Error ? e.message : 'fallback'` — which exposes raw JS/Axios error messages (e.g., constraint violations, timeouts) to users. Replaced with `backendErrorMessage(e)`.

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

### Backend: English command support and English error messages in agentic executive layer
- `backend/app/agentic/executive.py`
  - `_parse_command`: The command parser only accepted Italian-language commands (regex patterns for "Sposta la data di consegna", "Segna l'ordine come", "Cancella l'ordine") but the AgentsView.tsx UI showed English examples ("Update the delivery date of order…", "Mark order as shipped", "Cancel order"). Added English regex patterns so both Italian and English commands are accepted.
  - Added English terms ("shipped", "delivered", "processing") to `_STATUS_MAP` (was `_STATUS_IT_MAP`). Old name retained as alias to avoid breaking existing references.
  - All Italian-language error messages in `_parse_command`, `submit_command`, `_validate_semantics`, and `approve_action` translated to English (e.g., "Ordine X non trovato" → "Order X not found", "Transizione di stato non valida" → "Invalid status transition", etc.).
  - Italian rationale strings ("Write-back governato via Executive Agentic Layer") translated to English.
- `backend/tests/test_executive_agentic.py`
  - Updated test match patterns to use English strings (`"not supported"`, `"Invalid date"`, `"not found"`, `"Invalid status transition"` etc.).
  - Added 9 new English-command parse tests covering all three English regex paths (update delivery date, mark as status, cancel) and an English unsupported-command guard.

### Backend: sanitize SemanticOntologyViolationError message in /api/semantic/ask
- `backend/app/main.py`
  - `SemanticOntologyViolationError` catch block was returning `str(e)` to the HTTP client. The underlying error messages contain internal entity names, intent contract details, and property paths (e.g., `"Ontology violation: entities ['X'] are outside intent contract ['Y']"`). These are confusing for live users and expose internal schema details. Replaced with a generic user-friendly message: `"Your question doesn't match the available data model. Try rephrasing or ask about a different entity."`. The original error is now logged at INFO level for debugging.

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
