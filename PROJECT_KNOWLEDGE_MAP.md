# PROJECT KNOWLEDGE MAP

## 1) Obiettivo del documento

Questo documento mappa le funzionalita del progetto SemanticIntelligence/Fra in modo operativo, con riferimenti ai file principali per orientarsi rapidamente su:

- architettura end-to-end
- backend (API, semantic layer, connettori, KG, metadata)
- frontend (shell applicativa, viste, moduli dati)
- CLI e test
- flussi principali di esecuzione


## 2) Architettura ad alto livello

Flusso logico principale:

- Backend API entrypoint: backend/app/main.py
- Semantic layer: backend/app/semantic/layer.py
- Knowledge graph: backend/app/kg/graph.py
- Metadata catalog: backend/app/metadata/catalog.py
- Frontend app shell: frontend/src/App.tsx
- Frontend API client (semantic): frontend/src/api/semantic.ts


File: backend/app/main.py (~5000 righe — leggere per sezioni, non dall'inizio)

Endpoint principali:

- GET /api/health — stato servizio
- GET /api/dashboard — KPI sintetici
- POST /api/auth/token, POST /api/auth/login — OAuth2 password flow, rate limit 5/min per IP
- GET /api/semantic/status — stato semantic stack (entities, KG nodes/edges, metadata)
- GET /api/semantic/live-config — configurazione workspace live (entità, metriche, connettori)
- GET /api/semantic/draft — draft completo (entities, relations, metrics, context_docs)
- POST /api/semantic/build — costruisce semantic layer; chiama _refresh_catalog_and_kg_after_rebuild()
- POST /api/semantic/ask — query NL, rate limit 5/min, cache Redis opzionale
- POST /api/ask — alias legacy compatibile verso /api/semantic/ask
- GET /api/sources, POST /api/sources — gestione sorgenti dati live
- DELETE /api/sources/{id} — rimuove sorgente; pulisce anche salesforce_config.json se connector_type=salesforce
- POST /api/sources/{id}/sync
- GET /api/salesforce/schema/{source_id} — schema Salesforce cached (objects + fields)
- POST /api/salesforce/schema/{source_id}/refresh — ri-autentica e aggiorna lo schema senza re-inserire credenziali
- GET /api/semantic/sources — sorgenti caricate nel semantic stack
- GET /api/semantic/metrics, POST /api/semantic/metrics, DELETE /api/semantic/metrics/{id}
- GET /api/semantic/hierarchies, POST, DELETE
- GET /api/semantic/segments, POST, DELETE
- GET /api/semantic/draft/relations, POST /api/semantic/draft/relations, DELETE /{id}
- PATCH /api/semantic/draft/entities/{name} — aggiorna descrizione/note entità
- GET /api/semantic/templates, POST, PATCH, DELETE — query template gestiti da MetadataCatalog
- GET /api/semantic/example-questions — domande esempio per il query interface
- GET /api/semantic/coverage — copertura ontologica
- GET /api/semantic/mapping-defs — definizioni di campo per il frontend
- POST /api/ontology/validate — admin-only, hard-fail 422 su YAML incoerente
- GET /api/ontology/graph, GET /api/ontology/mappings, PUT /api/ontology/mappings
- GET /api/data/{table} — paginazione dati, RBAC user/admin
- GET /api/data/store/status, POST /api/data/store/rebuild
- POST /api/agent/execute — HITL write-back, admin-only, PENDING_HUMAN_APPROVAL
- POST /api/agent/approve/{action_id}, GET /api/agent/audit
- GET /api/agents/custom, POST, PUT, DELETE — agenti custom live
- GET /api/queries/saved, POST, DELETE — query salvate
- GET /api/ontology/extension, PUT /api/ontology/extension — bridge cross-source (localStorage sync)


### 3.2 Semantic Layer (core ragionamento)

File: backend/app/semantic/layer.py

Responsabilita:

- orchestrazione neuro-simbolica centralizzata per la query NL
- mapping intent via Anthropic in JSON strutturato su classi/proprieta/relazioni ontologiche
- guardrail di sicurezza sull output LLM (prompt injection e SQL injection blocking)
- validazione hard-fail contro contratto intent + ontology + metadata catalog
- generazione query deterministica (template tipizzati, nessun SQL arbitrario generato da LLM)
- composizione risultato con lineage completo (connectors/tabelle/entita/proprieta)
- GraphRAG (`semantic/graph_rag.py`): nel path LLM-SQL (`_execute_llm_sql`) il prompt è grounded sul KG — entity-linking del quesito ai nodi (tabelle/`Concept`/`Metric`), estrazione sotto-grafo (relazioni, `DESCRIBES`, `MEASURES`) iniettata nel prompt; nodi/archi usati in `provenance.graph_context`. KG-only, lessicale, degrade se nessun match
- selezione tabelle del prompt guidata dal GraphRAG: `build_graph_context` ritorna le `tables` rilevanti → passate come `priority_tables` a `catalog.get_schema_context` (sempre incluse, mai droppate dal cap `max_tables`). Risolve il caso schemi grandi/multi-fonte: la tabella che serve è sempre nel prompt

Controlli security specifici nel semantic layer:

- blocco keyword SQL distruttive (DROP/ALTER/DELETE/INSERT/UPDATE/TRUNCATE/...)
- blocco meta-token SQL e stringhe raw SQL non autorizzate
- blocco tentativi accesso a tabelle di sistema (es. sqlite_master, information_schema, pg_catalog)
- blocco accesso a tabelle non mappate nel Metadata Catalog
- security logging esplicito su evento di blocco

Intent supportati (macro categorie):

- HR: count dipendenti, lookup employee, retribuzione media
- ERP sales: count ordini, top venditori, revenue per territorio, quota vs revenue
- CRM customer: aziende B2B attive, clienti per stato, dedup account
- cross-source: margine per venditore, revenue by segment, categoria con margine massimo
- governance: data provenance, query impossible


### 3.3 Connettori dati

File:

- backend/app/connectors/base.py
- backend/app/connectors/duckdb_source_manager.py  ← primario
- backend/app/connectors/postgres_connector.py
- backend/app/connectors/sqlite_connector.py
- backend/app/connectors/file_connector.py
- backend/app/connectors/source_registry.py
- backend/app/connectors/salesforce_connector.py  ← nuovo

Ruoli:

- DuckDBSourceManager (registry-driven) — connettore primario in produzione:
  - `FRA_STORAGE_MODE=snapshot` (default Render): usa fra_unified.duckdb committato
  - `FRA_STORAGE_MODE=nostore`: runtime in-memory, nessuna persistenza locale
  - ERPDuckDBAdapter, CRMDuckDBAdapter, HRPIMDuckDBAdapter condividono lo stesso file snapshot
  - source_registry.py: persistenza SQLite delle sorgenti utente live
  - IMPLEMENTED_CONNECTOR_TYPES include ora: erp_sqldump, crm_sqlite, hr_csv, pim_json, csv, json, excel, sqlite, postgresql, mysql, parquet, context_doc, **salesforce**
- BaseConnector: contratto comune (load_entity, describe, execute_query)
- PostgresConnector: carica dump SQL ERP in SQLite in-memory (demo legacy)
- SQLiteConnector: accesso a clienthub.db CRM (demo legacy)
- FileConnector: carica HR CSV e PIM JSON; normalizza date; query via DuckDB in-memory
- **SalesforceConnector**: OAuth2 PKCE flow; recupera schema SObject via REST API v59.0; crea tabelle metadati DuckDB sf_{id}_objects/sf_{id}_fields; persiste credentials in `data_dir()/salesforce_config.json` e schema in `salesforce_schema_{id}.json`
  - **Record ingestion**: per gli oggetti prioritari (Account, Opportunity, …) `fetch_records()` (SOQL + paginazione nextRecordsUrl, solo campi scalari via `ingestable_field_names`) → tabelle record `sf_<oggetto>` (collisione multi-sorgente → `sf_<id8>_<oggetto>`); bounded `FRA_SF_ROW_LIMIT` (default 2000, 0=unlimited), gate `FRA_SF_INGEST_RECORDS`; `cfg.target_tables` popolato (UI + drop su re-sync)
  - **Relazioni dichiarate**: `salesforce_metadata_relations()` deriva FK esatte dal describe (`referenceTo`, anche lookup polimorfici) dal JSON cache; esposte da `DuckDBSourceManager.metadata_relations` (lazy, snapshot-safe) e iniettate nel KG via `ingest_manual_relations` dopo `build_from_schema` (entrambi i build sites in main.py)


### 3.4 Knowledge Graph

File: backend/app/kg/graph.py

Responsabilita:

- costruzione grafo networkx MultiDiGraph multi-sorgente
- nodi tipizzati (Customer, Employee, Salesperson, Product, SalesOrder, ...)
- edges semantici (PLACED_BY, SOLD_BY, CONTAINS_LINE, OF_PRODUCT, ...)
- identity resolution tra ERP/CRM/HR/PIM
- dedup CRM (accountId < 0)
- provenance per nodo

Utility API:

- node_count, edge_count, dedup_count
- neighbors, path, subgraph
- get_node, all_nodes, all_edges


### 3.5 Metadata Catalog

File: backend/app/metadata/catalog.py

Responsabilita:

- persistenza metadata su SQLite via SQLAlchemy
- tabelle meta: entity_meta, attribute_meta, metric_meta
- calcolo data type, nullability, sample values da dati reali
- mapping lineage metriche -> campi sorgente
- expose API programmatica:
  - get_entity / get_attribute / get_metric
  - list_entities / list_metrics / row_count

Metriche codificate:

- revenue
- revenue_with_tax
- margin
- active_customers


### 3.6 Ontology e mapping semantico

File:

- backend/app/ontology/ontology.py
- backend/app/ontology/manufacturing.py
- backend/app/ontology/mapper.py

Ruoli:

- ontology.py: modelli business canonici + loader YAML + export RDF
- manufacturing.py + mapper.py: stack legacy usato da endpoint ontologia/dashboard


### 3.7 DB interno e modelli API

File:

- backend/app/database.py
- backend/app/models.py

Ruoli:

- database.py: schema mock ERP SQLite e helper connessione
- models.py: request/response models per endpoint REST


### 3.8 Context management

File: backend/app/context/manager.py

Ruolo:

- stato sessione in-memory thread-safe
- history intent/risultati
- memoria risoluzioni disambiguazione


### 3.8-bis Executive Agentic Layer (azione governata)

File:

- backend/app/agentic/executive.py
- backend/app/agentic/router.py

Responsabilita:

- ciclo agentico command -> parse -> semantic validation -> pending queue -> human approval -> execution
- separazione netta decisione agentica vs esecuzione write-back reale
- enforcement vincoli business tramite ontologia (SalesOrder) e controllo dati runtime
- audit semantico strutturato per compliance (EU AI Act-ready)

Pattern HITL:

1. proposta azione da comando NL
2. validazione semantica e vincoli business
3. enqueue stato PENDING_HUMAN_APPROVAL
4. approvazione manager endpoint dedicato
5. write-back sicuro con query parametrizzate

Nota compatibilita HTTP:

- endpoint /api/agent/execute usa HTTP 422 con costante aggiornata `HTTP_422_UNPROCESSABLE_CONTENT` per compatibilita con stack FastAPI/Starlette recenti


### 3.8-ter Auto-build pipeline (Contesto → Fonti → KG/Semantic Layer)

File:

- backend/app/pipeline/runs.py — `PipelineRun`/`StageStatus` + `PipelineRunStore` (in-process, thread-safe)
- backend/app/pipeline/orchestrator.py — `run_build_pipeline()` orchestra i 5 stadi
- backend/app/context/doc_analyzer.py — `analyze_documents()` estrae priors dai documenti
- backend/app/semantic/apply.py — `apply_proposal()` persiste la proposta; helper condivisi `insert_sl_metric()`/`merge_proposal_metrics_into_draft()`
- backend/app/semantic/integrate.py — stadio 4: `interpret_instruction()`/`apply_ops()` (integrazione conversazionale, ops additive)
- backend/app/agentic/verifier.py — stadio 5: `verify_model()` controlli reali schema-aware + critica LLM opzionale

Responsabilita:

- 5 stadi: (1) contesto/documenti → priors, (2) fonti dati, (3) build auto-applicato (analyze priors-biased → apply → `reload_semantic()` → template), (4) integrazione conversazionale/manuale, (5) verifica = consistenza schema + replay query (`query_runner`) + faithfulness risposte (`answer_runner`), report in `PipelineRun.report`
- colma il gap proposta→apply: `/api/semantic/analyze` proponeva soltanto; ora la pipeline scrive relazioni/metriche/descrizioni nel modello e ricostruisce KG+SL
- le relazioni applicate (proposta + integrazione conversazionale) sono ingerite nel KG come archi `manual=True` (`KnowledgeGraph.ingest_manual_relations`, chiamato in `_ensure_semantic_loaded`/`_refresh_catalog_and_kg_after_rebuild`): il grafo riflette il modello informato dal contesto, non solo gli FK inferiti
- le entità di business estratte dai documenti entrano nel KG come nodi `Concept` ancorati alle tabelle via archi `DESCRIBES` (`KnowledgeGraph.ingest_context_entities`, da `_doc_context_entities()`); le metriche dai documenti come nodi `Metric` ancorati via `MEASURES` (`ingest_context_metrics`, da `_context_metrics()`). Gli archi `DESCRIBES`/`MEASURES` sono esclusi dalle relazioni tabella-tabella del draft
- alias di business sui nodi (`attach_aliases`): glossario (`ingest_glossary_aliases`, term→nodo se la definizione cita un label noto **o una parola-componente unica** di un label multi-parola, es. "account" → `crm_accounts`; componenti ambigue ignorate) + sinonimi proposti da `analyze` → migliorano il recall del linking GraphRAG
- FK detection: oltre ai suffissi nome, fase value-overlap in `build_from_schema` (campiona valori, confronta con PK-candidate) → join con nomi diversi e cross-source; bounded + gated da `FRA_KG_FK_VALUE_SCAN`. Anti-falsi-positivi: arco solo su match **univoco** (overlap con più tabelle → dominio generico, scartato) e con ≥`_FK_MIN_DISTINCT` valori distinti
- **merge same-entity (N fonti)**: fase `_same_entity_bridges` in `build_from_schema` — due tabelle di fonti diverse che descrivono la stessa entità (chiavi con Jaccard ≥`_MERGE_KEY_JACCARD` **e** colonne condivise ≥`_MERGE_COL_OVERLAP`) → arco `SAME_AS`; bounded (`_MERGE_MAX_PAIRS`), gated `FRA_KG_ENTITY_MERGE`. Gira **prima** del FK scan, che diventa merge-aware (FK verso gemelle → instradata alla gemella affine per nome via `_column_names_table`; niente FK id↔id tra gemelle). GraphRAG narra "same entity as X"; template `Unique <t> across sources` (UNION dedup); stadio 5 `_check_same_as_coverage` (EXCEPT bidirezionale → advisory sui gap di copertura). UI: riga `SAME_AS` come chip "merged entity" (1≡1)
- multi-fonte gestito riusando `get_schema_info()` su tutte le live tables (data model diversi unificati in DuckDB)
- endpoint: `POST /api/pipeline/run` (auto-applica, 409 se già in corso), `GET /api/pipeline/status`, `POST /api/semantic/integrate` (stadio 4)
- frontend: vista `PipelineView` (tab `pipeline` "Auto-Build") con polling stato per-stadio, report di verifica e box "Refine by instruction"

### 3.8-quater MCP server (Semantic Layer per agenti AI)

File: backend/app/mcp_server.py

- endpoint JSON-RPC 2.0 `POST /api/mcp` (Model Context Protocol), read-only, JWT-autenticato
- tool: `ask` (NL→risposta layer con SQL/sources/graph_context), `list_metrics`, `get_data_model`
- `handle_jsonrpc`: initialize/tools.list/tools.call/ping + ack notifiche; dispatch riusa `semantic_ask`/`get_metrics`/`_get_semantic_draft` col principal; errori tool come `isError`
- subset MCP implementato a mano (nessuna dipendenza); SSE/notifiche e tool di scrittura fuori scope v1
- confine demo/live via `_hidden_demo_tables(principal)`; guardie SQL/ontologia ereditate dal layer

### 3.9 Query engine legacy LLM-to-SQL

Stato:

- dismesso e rimosso dal path backend operativo
- strategia query consolidata esclusivamente su backend/app/semantic/layer.py


### 3.10 CLI

File:

- backend/app/cli.py
- backend/fra/cli.py

Comandi:

- fra load
- fra ask "domanda"
- fra report (genera eval_report.md su golden questions)


### 3.11 Testing

File: backend/tests/test_golden_questions.py
File: backend/tests/test_neurosymbolic_pipeline.py
File: backend/tests/test_agentic_endpoints.py
File: backend/tests/test_semantic_cache.py
File: backend/tests/test_faithfulness_eval.py
File: backend/tests/test_performance_profile.py
File: backend/tests/check_perf_regression.py
File: backend/tests/test_check_perf_regression.py
File: backend/tests/test_ontology_validation_hard_fail.py
File: backend/tests/test_ontology_validation_endpoint.py

Copertura:

- suite API-level su /api/semantic/ask con FastAPI TestClient
- 12 golden questions business divise per categoria (finanza, logistica, produzione)
- validazione intent/provenance/anti-allucinazione su risposta endpoint
- casi negativi controllati (payload vuoto, fuori contesto, prompt malevolo)
- test specifici neuro-simbolici: violazione ontologica esplicita e lineage obbligatoria in output
- test API Executive Agentic Layer su /api/agent/execute, /api/agent/approve/{action_id}, /api/agent/audit
- verifica policy admin-only, coda PENDING_HUMAN_APPROVAL, approvazione/rifiuto, errori controllati e audit trail
- test endpoint-level sequenziale: seconda approve su action gia EXECUTED ritorna HTTP 409 controllato
- test concorrenza: doppia approvazione simultanea sullo stesso action_id con lock-safe behavior (1 EXECUTED + 1 errore controllato)
- test cache semantica:
  - namespace invalidation su mapping update e KG rebuild
  - cache-hit endpoint-level su `/api/semantic/ask` con backend Redis opzionale
- faithfulness evaluation automatizzata:
  - suite opt-in `backend/tests/test_faithfulness_eval.py`
  - score grounding su golden questions e soglia via `FAITHFULNESS_MIN_SCORE`
  - report artifact `faithfulness_report.json`
- performance profiling + regression gate:
  - benchmark opt-in `backend/tests/test_performance_profile.py` con output `perf_metrics.json`
  - storico append-only `backend/tests/perf_history.json`
  - gate `backend/tests/check_perf_regression.py` (blocco su regressione p95 oltre +20%)
- validazione ontologia hard-fail:
  - loader: `OntologyValidationError` su YAML incoerente
  - endpoint admin `/api/ontology/validate`
- esecuzione locale verificata: `python -m pytest -q tests/test_agentic_endpoints.py` -> 12 passed
- verifica estesa sessione corrente:
  - frontend: `npm run build` OK
  - backend: `tests/test_neurosymbolic_pipeline.py` + `tests/test_golden_questions.py` quasi verdi con 4 failure residui su intent mapping `unknown` (F1/F4/L2) e intent assente (F3)


## 4) Mappa frontend per area funzionale

### 4.1 Shell applicativa e routing tab

File:

- frontend/src/App.tsx
- frontend/src/components/Layout.tsx

Tab principali gestite da App:

- overview
- usecases
- sembuilder
- dashboard
- ontology
- builder
- agents
- sources
- data
- query
- mappings
- process
- compliance
- config

Gestione sessione/tenant:

- access gate demo
- onboarding wizard
- multi-company locale (create/switch/archive)


### 4.2 Viste principali

Cartella: frontend/src/components

- AccessGate.tsx: login UI (OAuth2 verso /api/auth/token)
- Dashboard.tsx: KPI live (real data da /api/data/store/status, /api/semantic/draft)
- DataSourcesView.tsx: **wizard 8 step in live mode** (Discovery→Sources→Profiling→Quality→AI Model→Human Review→Activation→Evolution); flat layout in demo mode
- SemanticLayerView.tsx: navigazione a sezioni via `setSection(SLSection)` — overview/sources/entities/bridges/relations/rules/metrics/hierarchies/segments/definitions/playground
- SemanticDraftView.tsx: revisione entità/metriche del draft semantico
- OntologyGraph.tsx: grafo visuale ReactFlow entità e relazioni
- OntologyBuilder.tsx: chatbot AI per costruire il data model
- QueryInterface.tsx: NL query, demo engine locale o backend /api/ask
- AgentsView.tsx / AgentBuilder.tsx / AgentWorkflows.tsx: agenti custom live e workflow
- ProcessView.tsx: pipeline setup (extract→enrich→index) con stati live
- ComplianceView.tsx: GDPR data map + EU AI Act risk register
- ConfigurationView.tsx / AdminSections.tsx: utenti, token API, notifiche, audit log
- UseCasesView.tsx: esempi per settore
- CommandPalette.tsx: navigazione rapida (⌘K)


### 4.3 API client frontend

File principali:

- **frontend/src/api/semantic.ts** — tutte le chiamate /api/semantic/*, /api/ask, /api/sources; tipi SemanticDraft, BackendSource, BackendMetric, DraftEntity, DraftRelation
- frontend/src/api/client.ts — Axios instance + JWT interceptor + helper login/logout; token in localStorage
- **frontend/src/api/sources.ts** — CONNECTOR_BACKEND_MAP con credential schema per tutti i connettori; Salesforce ha 6 campi OAuth2 (instance_url, client_id, client_secret, username, password, security_token); tipi SalesforceSchema/SalesforceObject/SalesforceField; getSalesforceSchema() e refreshSalesforceSchema()
- frontend/src/api/agents.ts, queries.ts, workspace.ts, users.ts, tokens.ts — client per domini specifici

Pattern condiviso:
- token JWT letto da localStorage, iniettato in Authorization header via interceptor
- handle401() dedup guard condiviso tra tutti gli Axios instance
- backendErrorMessage(err) estrae err.response.data.detail per toast errori


### 4.4 Moduli dati e stato locale

Cartella: frontend/src/data

Elementi chiave:

- queryEngine.ts: parser NL lato frontend (demo) + tipi EngineResult condivisi con semantic.ts
- ontologyExtensions.ts: bridge cross-source in localStorage (SavedExtension con fromField/toField); storage key mode-scoped
- sectors.ts, connectors.ts, agentStore.ts, reportGenerator.ts, complianceData.ts

Regola storage split:
- Bridges (cross-source) → localStorage via ontologyExtensions.ts
- Relations, Metrics, Hierarchies, Segments → API backend (MetadataCatalog SQLite)


## 5) Flussi operativi principali

### Flusso A: domanda semantica

1. UI invoca endpoint unico /api/semantic/ask
2. Backend lazy-load semantic stack (connectors -> KG -> catalog -> layer)
3. Mapping intent ontologico via LLM + validazione hard su ontology/catalog
4. Esecuzione query deterministica su uno o piu connettori
5. Risposta con answer + provenance + latency

Nota di decommission:

- /api/query e stato rimosso dal backend operativo per eliminare il debito tecnico del motore legacy


### Flusso B: evaluation golden questions

1. pytest lancia fixture stack completo
2. esegue tutte le Q1..Q25
3. valida outcome atteso (ok/ambiguity/disambiguation/no_data)
4. produce eval_report.md


### Flusso C: gestione mapping ontologia

1. UI chiama /api/ontology/mappings
2. backend restituisce mapping flatten + raw
3. update tramite PUT /api/ontology/mappings


## 6) Configurazione e runtime

File principali:

- backend/requirements.txt
- backend/.env.example
- backend/Dockerfile
- frontend/Dockerfile
- docker-compose.yml

Note operative:

- backend esposto su 8000; frontend Vite dev su 5173
- ANTHROPIC_API_KEY (o GROQ_API_KEY) per intent mapping LLM; degradazione graceful senza chiave
- slowapi: rate limit 5/min su /api/semantic/ask e /api/auth/*; handler custom HTTP 429

Render free tier (512MB RAM) — ENV vars in backend/Dockerfile:

| Var | Valore | Effetto |
|---|---|---|
| FRA_STORAGE_MODE | snapshot | Usa fra_unified.duckdb committato (~780KB) |
| FRA_KG_NODE_LIMIT | 5000 | KG capped ~15MB (default 200k = ~400MB) |
| FRA_KG_EDGE_LIMIT | 5000 | Edge store capped |
| FRA_SKIP_WARMUP | true | KG built lazy su prima query, non al boot |
| JWT_ACCESS_TOKEN_EXPIRE_MINUTES | 10080 | 7 giorni sessione |

Aumentare FRA_KG_NODE/EDGE_LIMIT a 0 (illimitato) su piani con ≥2GB RAM.


## 7) Indice rapido di navigazione codice

- Guida operativa Claude Code: CLAUDE.md
- API e bootstrap backend: backend/app/main.py
- Semantic orchestration: backend/app/semantic/layer.py
- DuckDB source manager: backend/app/connectors/duckdb_source_manager.py
- KG builder: backend/app/kg/graph.py
- Metadata engine: backend/app/metadata/catalog.py
- Ontology business: backend/app/ontology/ontology.py
- Context session store: backend/app/context/manager.py
- CLI: backend/app/cli.py
- Test integrativi: backend/tests/test_api_integration.py
- Test KG: backend/tests/test_kg_graph.py
- Test agentic endpoints: backend/tests/test_agentic_endpoints.py
- Frontend shell: frontend/src/App.tsx
- Frontend layout/navigation: frontend/src/components/Layout.tsx
- Frontend API client (semantic): frontend/src/api/semantic.ts
- Demo/live switch: frontend/src/lib/demoMode.ts
- Bridge storage cross-source: frontend/src/data/ontologyExtensions.ts
- Data workbench wizard (live): frontend/src/components/DataSourcesView.tsx
- Semantic layer sections: frontend/src/components/SemanticLayerView.tsx
- Changelog modifiche live: CHANGELOG_LIVE.md


## 8) Gap documentali residui

Per completare una knowledge base ancora piu forte, conviene aggiungere:

- diagramma sequence su lazy loading semantic stack
- matrice ownership file/moduli
- policy versioning per ontologia e mapping

## 9) Quality gates CI ripristinati

File: .github/workflows/ci.yml

- backend lint/format con Ruff
- static typing baseline con MyPy (`backend/mypy.ini`)
- backend test suite + smoke test agentic dedicato
- faithfulness evaluation automatizzata con upload artifact
- security scan dipendenze con pip-audit
- frontend build TypeScript/Vite
