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


File: backend/app/main.py

Endpoint principali:

- GET /api/health
  - stato servizio
- GET /api/dashboard
  - KPI sintetici (customers/products/quotes/orders, conversion rate, ordini recenti)
- GET /api/ontology/graph
  - grafo ontologico legacy/manufacturing
- GET /api/ontology/mappings
  - mapping tabella/campo -> ontologia
- PUT /api/ontology/mappings
  - update mapping specifico
- GET /api/data/{table}
  - paginazione dati su tabelle whitelisted
  - endpoint protetto: richiede autenticazione RBAC (user/admin)
- GET /api/semantic/status
  - stato semantic stack (loaded, entities, KG stats, metadata stats)
  - endpoint protetto: richiede autenticazione RBAC (user/admin)
- POST /api/semantic/ask
  - endpoint unico di interrogazione NL verso semantic layer neuro-simbolico
  - protetto con autenticazione esplicita via Depends(get_current_user)
  - payload normalizzato: question oppure query (alias), session_id, context
  - rate limiting slowapi: massimo 5 richieste/minuto per utente/IP (429 su superamento)
- POST /api/auth/token e POST /api/auth/login
  - endpoint autenticazione OAuth2 password flow
  - rate limiting slowapi: massimo 5 tentativi/minuto per IP (anti brute force)
- POST /api/agent/execute
  - ingresso command NL esecutivo (write-back) con validazione semantica
  - protetto admin (Depends(require_roles("admin")))
  - output sempre in stato PENDING_HUMAN_APPROVAL se validato
- POST /api/agent/approve/{action_id}
  - endpoint manager per approvazione/rifiuto azione pending
  - su approve esegue write-back sicuro verso connettori/DB
- GET /api/agent/audit
  - audit trail semantico delle fasi PROPOSED/VALIDATED/QUEUED/APPROVED/REJECTED/EXECUTED/FAILED


### 3.2 Semantic Layer (core ragionamento)

File: backend/app/semantic/layer.py

Responsabilita:

- orchestrazione neuro-simbolica centralizzata per la query NL
- mapping intent via Anthropic in JSON strutturato su classi/proprieta/relazioni ontologiche
- guardrail di sicurezza sull output LLM (prompt injection e SQL injection blocking)
- validazione hard-fail contro contratto intent + ontology + metadata catalog
- generazione query deterministica (template tipizzati, nessun SQL arbitrario generato da LLM)
- composizione risultato con lineage completo (connectors/tabelle/entita/proprieta)

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
- backend/app/connectors/postgres_connector.py
- backend/app/connectors/sqlite_connector.py
- backend/app/connectors/file_connector.py

Ruoli:

- BaseConnector: contratto comune (load_entity, describe, execute_query)
- PostgresConnector:
  - carica dump SQL ERP in SQLite in-memory
  - espone query SQL su tabelle ERP
- SQLiteConnector:
  - accesso a clienthub.db CRM
- FileConnector:
  - carica HR CSV e PIM JSON
  - normalizza date (IT DD/MM/YYYY -> ISO, US MM/DD/YYYY -> ISO)
  - espone query SQL via DuckDB su dataframe in-memory


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

- AccessGate.tsx: login UI con autenticazione backend (OAuth2 password flow su /api/auth/token)
- Dashboard.tsx: KPI e sintesi operativa
- OntologyGraph.tsx: visualizzazione grafo ontologico
- OntologyBuilder.tsx: builder ontologia
- QueryInterface.tsx: interfaccia query utente
- MappingView.tsx: gestione mapping
- DataExplorer.tsx: esplorazione tabellare
- DataSourcesView.tsx: sorgenti e stato
- AgentsView.tsx / AgentBuilder.tsx / AgentWorkflows.tsx: sezione agenti
- ProcessView.tsx: orchestrazione/flussi
- ComplianceView.tsx: compliance controls
- ConfigurationView.tsx: configurazioni
- UseCasesView.tsx: use case per dominio
- OnboardingWizard.tsx: setup iniziale
- CommandPalette.tsx: navigazione rapida comandi
- AdminSections.tsx: sezioni admin (gestione utenti, token API generati runtime, audit e notifiche)
- SemanticLayerView.tsx: vista operativa semantic layer


### 4.3 API client frontend

File: frontend/src/api/client.ts

Funzioni principali:

- checkHealth
- login
- fetchDashboard
- fetchOntologyGraph
- fetchMappings
- updateMapping
- runQuery
- fetchTableData

Comportamento auth client:

- token JWT letto dinamicamente da localStorage
- header Authorization: Bearer <token> aggiunto automaticamente via Axios interceptor
- cleanup token su risposta 401 e su logout applicativo

Feature toggle:

- VITE_USE_MOCK=true abilita dati mock


### 4.4 Moduli dati e stato locale

Cartella: frontend/src/data

Elementi chiave:

- companies.ts: gestione company locale e switch
- agentStore.ts: stato e findings agenti
- queryEngine.ts: parser/query simulation lato frontend su ontologia mock
- connectors.ts, sectors.ts, reportGenerator.ts, complianceData.ts, ecc.


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

- backend esposto su 8000
- frontend Nginx su 5173 (container -> port 80)
- variabile ANTHROPIC_API_KEY necessaria per ontology intent mapping neuro-simbolico
- slowapi configurato in backend/app/main.py con handler custom HTTP 429


## 7) Indice rapido di navigazione codice

- API e bootstrap backend: backend/app/main.py
- Semantic orchestration: backend/app/semantic/layer.py
- Connettore ERP dump: backend/app/connectors/postgres_connector.py
- Connettore CRM: backend/app/connectors/sqlite_connector.py
- Connettore file HR/PIM: backend/app/connectors/file_connector.py
- KG builder: backend/app/kg/graph.py
- Metadata engine: backend/app/metadata/catalog.py
- Ontology business: backend/app/ontology/ontology.py
- Context session store: backend/app/context/manager.py
- CLI: backend/app/cli.py
- Test integrativi: backend/tests/test_golden_questions.py
- Test agentic endpoints: backend/tests/test_agentic_endpoints.py
- Frontend shell: frontend/src/App.tsx
- Frontend layout/navigation: frontend/src/components/Layout.tsx
- Frontend API adapter: frontend/src/api/client.ts
- Recap evoluzione lavori: RECAP_FUNZIONALITA_E_MODIFICHE_DA_INIZIO_LAVORI.md


## 8) Gap documentali residui

Per completare una knowledge base ancora piu forte, conviene aggiungere:

- diagramma sequence su lazy loading semantic stack
- matrice ownership file/moduli
- policy versioning per ontologia e mapping
