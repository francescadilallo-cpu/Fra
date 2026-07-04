# CODE AUDIT, CRITICITA E MIGLIORAMENTI (REVISIONE POST-FIX)

## 1) Scope e metodo

Revisione aggiornata dopo gli interventi eseguiti su sicurezza backend, contratti frontend/backend e concorrenza del semantic state.

Fonti considerate:

- Analisi statica del codice backend/frontend
- Verifica errori editor sui file modificati: nessun errore rilevato
- Verifica runtime aggiornata in sessione corrente:
	- frontend: `npm install` + `npm run build` eseguiti con successo
	- backend: suite agentic verde (`12 passed`), suite neuro-simbolica/golden eseguite con 4 failure funzionali residui

Conseguenza: affidabilita alta su hardening/security e governance agentica; resta una regressione semantica puntuale sul parser intent da chiudere prima della piena baseline CI.

Aggiornamento implementativo odierno (ripristino post-cleanup):

- ripristinati quality gates CI completi in `.github/workflows/ci.yml`
- ripristinata baseline static typing con `backend/mypy.ini` + step MyPy in CI
- ripristinata evaluation faithfulness automatizzata (`backend/tests/test_faithfulness_eval.py`) con artifact `faithfulness_report.json`
- ripristinata cache Redis opzionale su `/api/semantic/ask` con invalidazione su mutate-path
- ripristinata suite regressiva cache (`backend/tests/test_semantic_cache.py`)
- ripristinata modalita no-datalake (`FRA_STORAGE_MODE=nostore`) con snapshot persistente opzionale
- ripristinato endpoint admin `/api/ontology/validate` + validazione ontologica hard-fail
- ripristinato gate performance (benchmark + regression check p95) con artifact CI
- riallineato percorso legacy `/api/ask` come alias sicuro verso `/api/semantic/ask`


## 2) Executive summary aggiornato

Stato generale: migliorato in modo significativo.

Rischio complessivo attuale: medio (prima medio-alto), grazie a:

- introduzione auth JWT + RBAC server-side
- CORS non piu wildcard, configurabile via env
- lock thread-safe con double-checked locking per lazy init
- contratto /api/semantic/status allineato e validato anche runtime lato frontend

Rischi principali ancora aperti:

- hardening JWT custom (M6) e dependency governance


## 3) Findings ordinati per severita (stato aggiornato)

## CRITICO

### C1 - API backend senza auth/authorization

Stato: RISOLTO

Evidenza aggiornata:

- Implementato endpoint token OAuth2 password flow e validazione JWT con RBAC in backend/app/main.py
- Protetti endpoint sensibili di mutazione/stato semantico: /api/semantic/ask, /api/ontology/mappings (PUT), /api/kg/build
- Protetto anche endpoint di dump dati grezzi: /api/data/{table} (RBAC user/admin)
- Protetto anche endpoint di stato semantico: /api/semantic/status (RBAC user/admin)
- Rate limiting introdotto via slowapi: /api/semantic/ask 5/min per utente/IP, /api/auth/token e /api/auth/login 5/min per IP
- Handler custom 429 con messaggio pulito su superamento limite

Azioni residue:

1. valutare allineamento policy tra app limiter e API gateway/WAF


### C2 - Password demo hardcoded lato client

Stato: RISOLTO

Evidenza aggiornata:

- frontend/src/components/AccessGate.tsx non usa piu ACCESS_CODE hardcoded
- AccessGate esegue login verso backend (/api/auth/token)
- token JWT gestito da frontend/src/api/client.ts

Azioni residue:

1. migliorare UX su error handling login (messaggi per 401/503 distinti)


### C3 - Token API simulati con full token in UI

Stato: RISOLTO

Evidenza aggiornata:

- frontend/src/components/AdminSections.tsx non contiene piu token demo hardcoded iniziali
- inizializzazione token UI vuota; token disponibili solo se generati runtime
- riferimenti audit token-like resi non realistici (token_ref_*)

Azioni residue:

1. integrare token lifecycle con backend reale (create/revoke server-side)


## ALTO

### H1 - CORS troppo permissivo

Stato: RISOLTO

Evidenza aggiornata:

- backend/app/main.py usa ALLOWED_ORIGINS da environment con fallback http://localhost:5173
- rimossa configurazione allow_origins=["*"]

Follow-up consigliato:

1. impostare ALLOWED_ORIGINS per ambiente (dev/stage/prod)
2. verificare necessita effettiva di allow_credentials=True


### H2 - Frontend con import mancante (build break potenziale)

Stato: RISOLTO

Evidenza aggiornata:

- frontend/src/App.tsx ora referenzia SemanticLayerView coerente col file esistente


### H3 - Contratto API non allineato su semantic status

Stato: RISOLTO

Evidenza aggiornata:

- tipo SemanticStatusResponse centralizzato in frontend/src/types/semantic.ts
- client tipizzato + parser runtime parseSemanticStatusResponse in frontend/src/api/client.ts
- vista aggiornata in frontend/src/components/SemanticLayerView.tsx

Beneficio:

- eliminati mismatch silenziosi e ridotti rischi di property undefined


### H4 - Endpoint query legacy con guardrail SQL limitato

Stato: RISOLTO

Evidenza aggiornata:

- backend/app/main.py centralizza il flusso query su semantic layer per /api/semantic/ask
- /api/query rimosso dal backend API
- /api/semantic/ask protetto con Depends(get_current_user)
- /api/semantic/ask accetta payload normalizzato (question/query, session_id, context)
- backend/app/semantic/layer.py usa Anthropic solo per mapping intent ontologico (JSON), non per generare SQL
- backend/app/semantic/layer.py applica guardrail rigido su output LLM prima della conversione in chiamate connettori
- esecuzione query avviene solo tramite template deterministici validati da contratto intent + ontology + metadata catalog
- in caso di mismatch ontologico/metadati viene sollevata SemanticOntologyViolationError (HTTP 422)
- in caso di anomalia security (injection/tabelle non autorizzate) l esecuzione viene interrotta con log sicurezza e messaggio utente pulito: "Query semantica non valida o non autorizzata"

Impatto residuo:

- ridotta drasticamente la superficie di allucinazione/esecuzione arbitraria nel percorso API query


## MEDIO

### M7 - Regressione intent parser su subset golden questions

Stato: APERTO (NUOVO)

Evidenza aggiornata (sessione corrente):

- test run: `python -m pytest -q tests/test_neurosymbolic_pipeline.py tests/test_golden_questions.py`
- esito: 4 failure, 17 passed
- failure principali:
	- F1/F4/L2 -> `SEMANTIC_ONTOLOGY_VIOLATION` con intent `unknown`
	- F3 -> risposta 200 ma `provenance.ontology_intent.intent_type` assente

Ipotesi root-cause:

- copertura incompleta regole parser su sinonimi/varianti linguistiche (es. `piu` senza accento, pattern `revenue with tax totale`)
- condizione troppo restrittiva nel ramo `revenue_by_territory` quando la domanda contiene `fatturato`

Azioni:

1. ampliare regole parser/fallback per varianti lessicali italiane non accentate
2. correggere la regola `revenue_by_territory` per coprire esplicitamente `fatturato per territorio`
3. estendere test parser unitari su sinonimi (fatturato/revenue/incassi, piu/più)

### M1 - Global semantic state non protetto da lock

Stato: RISOLTO

Evidenza aggiornata:

- Thread-safe lazy init implementata con double-checked locking in backend/app/main.py
- lock condiviso anche su rebuild /api/kg/build
- uso RLock per evitare deadlock in chiamate annidate


### M2 - ContextManager non integrato nel path API

Stato: APERTO

Evidenza:

- /api/semantic/ask non usa session_id/continuita contestuale utente

Azioni:

1. introdurre session_id nel payload
2. attivare remember/resolve per disambiguazioni multi-turn


### M3 - Dipendenze non completamente pinned

Stato: APERTO (PARZIALE)

Evidenza aggiornata:

- aggiunta python-multipart, ma diverse dipendenze restano non pin

Azioni:

1. pin completo requirements
2. introdurre constraints/lockfile
3. scanner vuln periodico


### M4 - Docker backend include dipendenze dev nel runtime

Stato: APERTO

Evidenza:

- requirements runtime include pytest/pytest-asyncio

Azioni:

1. split requirements (runtime vs dev)
2. hardening immagine (non-root, slim, multi-stage)


### M5 - Incoerenza dichiarata vs implementata nel connector ERP

Stato: APERTO

Evidenza:

- doc/commenti parlano di DuckDB, implementazione effettiva usa SQLite in-memory per il dump

Azioni:

1. allineare docstring/commenti
2. motivare scelta tecnica nel codice/documentazione


### M6 - Implementazione JWT custom (manutenzione e hardening)

Stato: PARZIALE

Evidenza aggiornata:

- migrate da python-jose a PyJWT (commit 216f46c) e poi da PyJWT a implementazione pure-Python HS256 (commit bab390c) per risolvere binding cryptography rotto su Render
- implementazione custom HMAC presente in backend/app/main.py

Impatto residuo:

- implementazione non standard, maggiore rischio manutentivo
- serve test negativi su token malformati/claims invalidi

Azioni residue:

1. aggiungere test negativi JWT (token malformato, exp scaduto, firma errata)
2. mantenere policy chiara issuer/audience/exp/nbf nei commenti


## BASSO

### L3 - Salesforce credentials stored plaintext (noto, atteso)

Stato: APERTO (noto, accettato per ora)

Evidenza:

- backend/data/salesforce_config.json contiene password e security_token in chiaro
- il file risiede su Render persistent disk; non è in git (gitignored per policy)

Impatto:

- accesso al filesystem del container espone le credenziali in chiaro
- non critico su Render free tier (container isolato, singolo tenant)

Azioni consigliate:

1. cifrare i campi sensibili con Fernet (cryptography) usando FRA_SECRET_KEY come chiave
2. o delegare la gestione credenziali a un vault (es. Render Secret Files, Doppler)
3. aggiungere backend/data/salesforce_config.json al .gitignore se non già presente


### L4 - Salesforce schema non aggiornato automaticamente

Stato: APERTO

Evidenza:

- salesforce_schema_{id}.json viene scritto al primo connect e aggiornato solo via POST /api/salesforce/schema/{id}/refresh esplicito
- lo schema Salesforce dell'org può cambiare (nuovi oggetti custom, nuovi campi)

Azioni consigliate:

1. aggiungere un cron job (o trigger su /api/sources/{id}/sync) che ri-fetcha lo schema ogni N giorni
2. esporre data fetch (fetched_at) nell'UI per evidenziare schema obsoleto


### L1 - Codice morto o ridondante

Stato: APERTO

Evidenza:

- backend/app/metadata/catalog.py: variabile n_entity non usata


### L2 - Convivenza due motori query senza policy esplicita

Stato: RISOLTO

Evidenza aggiornata:

- consolidamento applicato: percorso query API unificato su semantic layer
- /api/query eliminato; unico endpoint query: /api/semantic/ask


## 4) Vulnerability checklist sintetica (aggiornata)

- Auth server-side: SI (implementata)
- Authorization per ruolo: SI (RBAC admin/user)
- CORS production-ready: PARZIALE (env-based, da finalizzare per ambienti reali)
- Segreti hardcoded frontend: RIDOTTI (rimossi gate hardcoded e token demo iniziali)
- SQL hardening LLM-generated: RISOLTO nel path API (LLM non genera SQL eseguibile)
- Rate limiting: PRESENTE (slowapi, policy endpoint sensibili)
- Security headers: DA CONFIGURARE SU REVERSE PROXY
- Dependency governance: PARZIALE
- Concorrenza lazy init semantic state: RISOLTA


## 5) Qualita codice e manutenibilita

Punti forti aggiornati:

- modularita backend solida
- hardening security base introdotto (JWT/RBAC/CORS env)
- contratto semantic status centralizzato e validato runtime
- concorrenza su semantic lazy init resa thread-safe

Punti da migliorare:

- governance dipendenze e immagine docker
- integrazione ContextManager multi-turn


## 6) Piano di progresso consigliato (re-baselined)

### Fase 1 - Residual Critical/High (1 settimana)

1. aggiungere test runtime in CI per endpoint protetti, rate limiting e token expiry


### Fase 2 - Security hardening backend (1-2 settimane)

1. mantenere disaccoppiata la mappatura intent LLM dalla generazione query eseguibile
2. valutare libreria JWT standard al posto dell implementazione custom
3. aggiungere test di security per auth e token validation


### Fase 3 - Stabilita operativa (1-2 settimane)

1. pin dipendenze + split runtime/dev
2. CI minima: lint + build frontend + test backend + scan dipendenze
3. hardening Docker (non-root, immagine snella)


## 7) KPI consigliati (invariati + nuovi)

- Mean latency /api/semantic/ask (p50, p95)
- Error rate per endpoint
- % richieste con provenance completa
- test pass rate backend + frontend build success rate
- vulnerability count da scanner dipendenze
- auth failure rate (401/403) per endpoint protetto


## 8) Prossimi passi pratici suggeriti

1. Aprire task security per M6 (JWT custom)
2. Configurare pipeline CI minima con quality gates
3. Estendere suite test neuro-simbolica su casi avversari OWL/metadata
4. Aggiungere test negativi JWT, RBAC e rate limiting per endpoint sensibili

Aggiornamento verifica:

- aggiunto backend/tests/test_neurosymbolic_pipeline.py con test su:
	- raise esplicito SemanticOntologyViolationError su mapping non conforme
	- presenza lineage/validation obbligatoria nella risposta di SemanticLayer.ask
	- blocco guardrail su keyword SQL distruttive e system tables
- rifatta backend/tests/test_golden_questions.py come suite API-level su /api/semantic/ask con:
	- golden questions multi-dominio (finanza/logistica/produzione)
	- asserzioni su intent accuracy, provenance grounding e assenza allucinazioni
	- casi negativi controllati (out-of-scope/malevoli/payload invalido)
- introdotto Executive Agentic Layer con endpoint dedicati write-back governato:
	- /api/agent/execute (admin-only, enqueue PENDING_HUMAN_APPROVAL)
	- /api/agent/approve/{action_id} (human-in-the-loop approvazione/rifiuto)
	- /api/agent/audit (tracciamento audit semantico)
	- separazione decisione agentica / esecuzione connettori, con validazione ontologica e vincoli business
- aggiunto backend/tests/test_agentic_endpoints.py con copertura API-level su:
	- execute -> status PENDING_HUMAN_APPROVAL + validation checks
	- approve -> path APPROVED/EXECUTED e path REJECTED
	- approve sequenziale -> seconda approvazione su action gia EXECUTED ritorna HTTP 409 controllato
	- audit -> presenza tracce semantiche lifecycle
	- casi negativi: comando invalido, violazione business rule, action_id assente, no-auth e non-admin
	- concorrenza: doppia approvazione simultanea sullo stesso action_id con lock-safe/idempotent behavior
- runtime locale verificato dopo setup dipendenze minime:
	- `python -m pytest -q tests/test_agentic_endpoints.py` -> 12 passed
- warning deprecazione eliminato in backend/app/agentic/router.py:
	- sostituita costante `HTTP_422_UNPROCESSABLE_ENTITY` con `HTTP_422_UNPROCESSABLE_CONTENT`


## 9) Spunti utente ad alto valore (valutazione)

La proposta e molto utile e allineata con i rischi reali del progetto. Qui sotto la traduzione in piano operativo concreto.

### 9.1 Stress test ontologico con dati sporchi/contraddittori

Valore: ALTO

Perche serve qui:

- oggi il loader ontologico in [backend/app/ontology/ontology.py](backend/app/ontology/ontology.py) carica YAML ma non applica vincoli OWL forti o controlli semantici estesi
- rischio: il sistema accetta configurazioni incoerenti e poi produce risposte non affidabili

Implementazione consigliata:

1. creare fixture "dirty" in test_scenario (violazioni intenzionali: relazioni con target inesistente, type mismatch, campi mandatory mancanti)
2. aggiungere test dedicati in backend/tests che devono fallire esplicitamente con eccezione di validazione
3. introdurre validatore di coerenza ontologica prima di Ontology.load completata

Output atteso:

- se il dato e contraddittorio, il sistema deve rifiutare il bootstrap in modo deterministico


### 9.2 Esecuzione a ciclo chiuso con mock action server

Valore: ALTO

Perche serve qui:

- oggi il sistema e orientato a query/analisi; per agentic execution serve un canale sicuro di intent-to-action senza side effect reali

Implementazione consigliata:

1. aggiungere un mock server locale che espone endpoint di azione non distruttivi (es. update_order_status)
2. loggare payload ricevuto con timestamp, utente, intent, confidence, motivazione
3. far orchestrare all agente la chiamata verso mock invece che DB reale

Output atteso:

- log con intenzione corretta e tracciabile, nessuna scrittura su sistemi reali


### 9.3 Faithfulness score (grounding) con RAGAS/DeepEval

Valore: ALTO

Perche serve qui:

- rischio principale dei sistemi semantici: risposta plausibile ma non grounded nelle fonti integrate

Implementazione consigliata:

1. creare set di domande con evidenza attesa (provenance minima obbligatoria)
2. misurare faithfulness e answer relevancy con pipeline automatica
3. impostare soglia minima in CI per bloccare regressioni

Output atteso:

- metrica oggettiva su allucinazione e grounding

Stato implementazione:

- PARZIALE RISOLTO: presente evaluation automatizzata con metrica grounding threshold-based in CI
- evoluzione futura consigliata: integrazione RAGAS/DeepEval per metriche avanzate multi-dimensione


### 9.4 Analisi statica con Ruff + Mypy

Valore: ALTO

Perche serve qui:

- forte superficie Python backend e logica semantica complessa
- il typing statico riduce bug difficili in runtime concorrente

Implementazione consigliata:

1. introdurre configurazione Ruff e Mypy nel backend
2. definire baseline iniziale e ridurre gradualmente i warning
3. esecuzione in CI su ogni PR

Output atteso:

- regressioni semantiche e di typing intercettate prima del merge

Stato implementazione:

- RISOLTO (baseline): configurazione MyPy introdotta e gate CI attivo


### 9.5 Performance profiling (cProfile / py-spy)

Valore: MEDIO-ALTO

Perche serve qui:

- in sistemi come questo il collo di bottiglia e spesso su join cross-source, parsing e serializzazione, non solo sul modello LLM

Implementazione consigliata:

1. profilare endpoint /api/semantic/ask su scenari realistici
2. isolare tempo su parse intent, query connector, enrich provenance
3. introdurre benchmark p50/p95 ripetibile

Output atteso:

- identificazione dei veri hotspot e priorita di ottimizzazione

Stato implementazione:

- RISOLTO (fase 1): benchmark opt-in + artifact metrics + regression gate automatico in CI (fail su p95)


### 9.6 Caching strategico (Redis) per query frequenti

Valore: MEDIO-ALTO

Perche serve qui:

- molte domande business sono ripetitive (dashboard, KPI standard)
- il semantic layer puo beneficiare di memoization su domanda normalizzata + contesto

Implementazione consigliata:

1. introdurre cache key per intent normalizzato + filtri
2. TTL differenziato per tipo metrica
3. invalidazione su rebuild KG e aggiornamento mapping

Output atteso:

- latenza ridotta e carico inferiore sui connettori

Stato implementazione:

- RISOLTO (fase 1): cache Redis opzionale su endpoint `/api/semantic/ask` con TTL configurabile e invalidazione namespace su mapping/KG rebuild

### 9.7 No datalake locale by default

Valore: ALTO

Stato implementazione:

- RISOLTO: `FRA_STORAGE_MODE=nostore` impostabile come default operativo, con persistenza locale disattivata
- Modalita `snapshot` mantenuta come opzione compatibile per ambienti che la richiedono

Impatto:

- riduzione superficie data-at-rest locale
- allineamento compliance per ambienti sensibili


## 10) Priorita esecutiva suggerita (da questi spunti)

1. Stress test ontologico + validazione hard-fail
2. Ruff/Mypy in CI
3. Faithfulness evaluation automatizzata
4. Mock action server per agentic execution safe
5. Profiling e poi caching Redis guidato da dati


## 11) Recap operativo creato

- creato file di recap evolutivo richiesto: `RECAP_FUNZIONALITA_E_MODIFICHE_DA_INIZIO_LAVORI.md`
- include funzionalita introdotte, hardening, agentic layer, coverage test e stato operativo corrente


## 12) Auto-build pipeline (2026-06-25) — stato e follow-up

Introdotto lo scheletro della pipeline auto-build (`backend/app/pipeline/`, `context/doc_analyzer.py`, `semantic/apply.py`, `agentic/verifier.py`). Stadi 1–3 funzionanti e auto-applicati, 4–5 stub.

Miglioramento risolto:
- la proposta Smart-Connect ora viene **applicata** (relazioni/metriche/descrizioni) e non più solo mostrata: `/api/semantic/analyze` produceva una proposta mai scritta nel KG/SL.

Aggiornamento 2026-06-25 (stadi 4–5 completati):
- stadio 4: integrazione conversazionale reale (`semantic/integrate.py` + `POST /api/semantic/integrate`), ops additive sanificate.
- stadio 5: `verify_model()` con controlli reali schema-aware + critica LLM opzionale; report in `PipelineRun.report`.

Aggiornamento (stadio 5 — replay query):
- aggiunto query smoke test: i template generati vengono rieseguiti read-only sul dato (`query_runner`); i fallimenti diventano warning `template_query_failed`.

Aggiornamento (stadio 5 — faithfulness):
- aggiunto faithfulness scoring: campiona domande dai template, le fa girare via `layer.ask()` e misura il grounded ratio; sotto soglia → warning `low_faithfulness`.

Aggiornamento (anello contesto→KG):
- le relazioni applicate ora diventano archi del KG (`KnowledgeGraph.ingest_manual_relations`), chiudendo il gap per cui vivevano solo nel catalog accanto al grafo.

Aggiornamento (concetti dai documenti nel KG):
- le entità di business dei documenti diventano nodi `Concept` ancorati alle tabelle via `DESCRIBES` (`ingest_context_entities`). La conoscenza dal contesto è ora rappresentata anche nel grafo.

Aggiornamento (metriche dai documenti nel KG):
- le metriche di contesto diventano nodi `Metric` ancorati via `MEASURES` (`ingest_context_metrics`). Conoscenza dal contesto ora completa nel grafo: concetti + metriche.

Aggiornamento (GraphRAG):
- nel path LLM-SQL il prompt è ora grounded sul KG (`semantic/graph_rag.build_graph_context`): relazioni/concetti/metriche rilevanti iniettati + `provenance.graph_context`. Ispirato a Graphwise/Ontotext ma KG-only (no embeddings).

Aggiornamento (idee Graphwise completate):
- citazioni di provenienza in UI: fatte (`GraphCitations` consuma `provenance.graph_context`).
- server MCP: fatto (`mcp_server.py`, `POST /api/mcp`, read-only, JWT).

Hardening del flusso principale (2026-06-25):
- run pipeline concorrenti: prenotazione atomica (`begin_run`) + no stuck-state.
- `/api/semantic/integrate`: apply protetto + `notes` esplicito.
- bug-fix: faithfulness/critica LLM gated su provider (no warning falso-positivo senza LLM).
- UX path `ask`: risposte degradate (no-LLM/fail) segnalate, non scambiate per dati.
- performance: cap colonne (`max_cols=40`) nel prompt schema; `max_tables=30` già presente.
- test e2e multi-fonte della pipeline come regression guard.

Aggiornamento (selezione tabelle prompt guidata dal GraphRAG):
- risolto il limite del cap fisso: le tabelle rilevanti alla domanda (GraphRAG) sono `priority_tables` sempre incluse nel prompt, mai droppate. Copre schemi grandi e multi-fonte (le priority attraversano le fonti).

Aggiornamento (migliorie stadi 1-3):
- alias da glossario + sinonimi proposta sui nodi KG (`attach_aliases`/`ingest_glossary_aliases`) → recall NL migliore.
- FK value-overlap in `build_from_schema` (nomi diversi + cross-source), bounded e gated da `FRA_KG_FK_VALUE_SCAN`.
- proposta `analyze` con synonyms; metriche con colonne inesistenti scartate in apply.

Aggiornamento (hardening Fase 3 FK + glossario deterministico):
- value-overlap FK ora resiste agli **id generici condivisi**: si crea l'arco solo su match **univoco** (overlap con più tabelle → dominio condiviso, si scarta) e solo se la colonna ha ≥`_FK_MIN_DISTINCT=4` valori distinti (codici a bassa cardinalità saltati).
- `ingest_glossary_aliases` deterministico (scansione label ordinata per lunghezza/alfabetico) → alias stabili tra run e match più specifico. Match anche sulle **parole-componente uniche** dei label multi-parola/snake_case (coerente con `graph_rag`, `_LABEL_MIN_TOKEN`/`_LABEL_STOPWORDS`); componenti condivise da più tabelle scartate → nessun alias ambiguo.

Aggiornamento (review sorgenti → KG → SL con Salesforce reale):
- **Salesforce record ingestion**: prima solo metadati (sf_*_objects/fields) → modello non interrogabile sui dati veri. Ora record reali per gli oggetti prioritari in tabelle `sf_<oggetto>` (bounded `FRA_SF_ROW_LIMIT`, gate `FRA_SF_INGEST_RECORDS`); `target_tables` popolato (UI + drop su re-sync).
- **FK dichiarate dal describe** (`referenceTo`) → KG via `metadata_relations` (lazy, snapshot-safe): join esatti per SF, le euristiche nome/valore restano per le altre fonti.
- **GraphRAG**: indice per parole-componenti dei label (split su underscore) → "accounts" linka `sf_account`, "order" linka `sales_order_header`.
- **Persistenza**: chiusi 3 buchi FRA_DATA_DIR sfuggiti (metadata.db, context.db, tokens.db) — erano hardcoded, il modello auto-costruito e i documenti di contesto sparivano al restart anche col disco.

Follow-up residui:
- ~~Salesforce: oggetti custom non ingeriti / nessuna selezione utente~~ → RISOLTO: default = prioritari + tutti i custom; selezione esplicita via `params.objects` (UI: campo "Objects to sync"); describe budget `FRA_SF_MAX_OBJECTS` (40) con ordine priority→custom→standard. Resta il cap 150 campi/oggetto (limite URL SOQL) — eventuale chunking multi-query se servisse.
- SF record tables: `CREATE OR REPLACE` a ogni sync (full refresh); niente delta/incremental sync — accettabile ai volumi attuali (≤2000 righe/oggetto default).
- ~~Le tabelle metadati sf_*_objects/sf_*_fields restano nel modello~~ → RISOLTO: `internal_metadata_tables` (property esatta dal registry) esclusa da `build_from_schema` e dallo stadio 2 pipeline; restano interrogabili in SQL. Rimosso il filtro regex `_FilteredMgr` (era solo nel path refresh → primo boot incoerente).
- recall del linking resta lessicale+fuzzy+alias: il canale vettoriale rimane l'upgrade per terminologie molto diverse (da valutare su dati reali). Costo verifica con LLM (~5 ask) tunable.
- value-overlap FK: i due guard (univocità + cardinalità minima) riducono i falsi positivi; resta da validare le soglie su dati reali (es. FK legittime a bassa cardinalità su dataset piccoli verrebbero saltate — accettabile perché la Fase 2 per nome le copre).
- MCP v1: solo read-only e JSON-RPC non-streaming; valutare SSE/streaming, tool write con HITL, e OAuth MCP dedicato se serve esposizione a terze parti non fidate.
- GraphRAG: entity-linking lessicale; valutare in futuro un canale vettoriale se serve recall maggiore.
- stadio 5 ora copre: consistenza schema, eseguibilità query (replay) e faithfulness risposte. Possibile estensione futura: confronto con ground-truth su golden questions versionate.
- **unificazione dei due store metriche** — PASSO 1 FATTO: `sl_metrics`/`sl_hierarchies`/`sl_segments` estratte da `erp_mock.db` (effimero!) nel nuovo `definitions_store.py` (`data_dir()/definitions.db`, migrazione one-shot con flag anti-resurrezione, seed builtin nel nuovo store). Ora c'è un solo store durabile per le definizioni; resta il passo 2 (fondere la *vista* draft del catalog con questo store — solo se emerge attrito reale).
- integrazione conversazionale: solo ops additive (no rename/delete) per sicurezza; valutare conferma esplicita (HITL) se in futuro si aggiungono ops distruttive.
- due store metriche coesistono (`sl_metrics` vs draft metrics del catalog): valutare unificazione.
- `PipelineRunStore` è in-process: lo stato del run non sopravvive a restart (il risultato KG/SL sì, persistito dal build).
- match proposta→entità per descrizione fatto via `table`: verificare allineamento nomi su build multi-fonte.

