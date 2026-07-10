# Orientamento al progetto — Fra / DataIntelligence

> Documento di riferimento rapido. Aggiornato al 2026-07-10.

---

## 1. Cos'è il prodotto

**DataIntelligence** (nome interno: *Fra*) è una piattaforma SaaS di **data intelligence** che:
- connette più sorgenti dati aziendali (ERP, CRM, HR, file CSV, database)
- costruisce un **data model unificato** (entità, relazioni, metriche)
- permette di **fare domande in linguaggio naturale** sui dati ("chi è il top salesperson?")
- fa girare **agenti AI** automatici per monitoraggio, anomalie, riconciliazioni

---

## 2. Struttura del repository

```
Fra/
├── frontend/          # App React + TypeScript (Vite, Tailwind, ReactFlow)
│   └── src/
│       ├── components/   # Tutte le "pagine" e widget dell'app
│       ├── api/          # Chiamate HTTP al backend
│       ├── data/         # Dati demo, motore query, store locali
│       ├── contexts/     # React context (SectorContext)
│       └── lib/          # Utility (demoMode.ts, ecc.)
│
├── backend/           # FastAPI + Python
│   └── app/
│       ├── main.py        # Entry point, tutti gli endpoint REST
│       ├── connectors/    # Adattatori sorgenti (Postgres, SQLite, DuckDB, file)
│       ├── kg/            # Knowledge graph (graph.py)
│       ├── semantic/      # Semantic layer (metriche, gerarchie, glossario)
│       ├── agentic/       # Agenti AI aziendali
│       ├── query/         # Query engine NL→SQL
│       ├── ontology/      # Definizione ontologie + mapper
│       ├── audit/         # Log di audit
│       └── database.py    # Connessione SQLite interna
│
├── CHANGELOG_LIVE.md  # Log di tutte le modifiche live (questa sessione)
└── docker-compose.yml # Setup locale
```

---

## 3. Il concetto più importante: Demo vs Live

Tutta la codebase ruota attorno a **una sola variabile booleana**:

```typescript
// frontend/src/lib/demoMode.ts
export const IS_DEMO_MODE = getModeFromToken() !== 'live'
```

Il valore è determinato dal **JWT** dell'utente: se il token contiene `mode: "live"`, l'app si comporta in modo completamente diverso.

| | **Demo mode** | **Live mode** |
|---|---|---|
| Chi lo vede | Chiunque provi la demo | Clienti reali paganti |
| Dati | Dati fittizi AdventureWorks (ERP manufacturing) | Dati reali dell'azienda del cliente |
| Settori | Switcha tra Manufacturing / Retail / Healthcare / Finance | Sempre "manufacturing" come default (non rilevante) |
| Agenti precostituiti | Sì (Sales Performance, CRM Dedup, ecc.) | No — il cliente crea i suoi |
| Audit log | Voci demo hardcoded | Voci reali dal backend (`_audit()`) |
| Query engine | Risposte precalcolate per AdventureWorks | Chiama `/api/ask` → `/api/semantic/ask` backend |
| DataSourcesView | Layout flat con tutte le sezioni | Wizard 8 step (Discovery→Activation→Evolution) |

**Regola d'oro nel codice:** tutto ciò che è dietro `IS_DEMO_MODE ? ... : ...` mostra contenuto diverso. Il codice live non deve mai "vedere" termini AdventureWorks, settori demo, o termini tecnici come "semantic layer" / "ontology".

---

## 4. La navigazione — le sezioni dell'app

La sidebar è divisa in sezioni logiche:

### START
| Tab | Componente | Funzione |
|---|---|---|
| **Overview** | `OverviewScreen.tsx` | Landing page / pitch dell'app |

### CONNECT
| Tab | Componente | Funzione |
|---|---|---|
| **Data Sources** | `DataSourcesView.tsx` | Connette DB, file CSV, SaaS (Postgres, SQLite, DuckDB, upload) |
| **Data Explorer** | `DataExplorer.tsx` | Naviga le tabelle/entità, scarica CSV |

### BUILD
| Tab | Componente | Funzione |
|---|---|---|
| **Entity Graph** | `OntologyGraph.tsx` | Grafo visuale di entità e relazioni (ReactFlow) |
| **Builder AI** | `OntologyBuilder.tsx` | Chatbot che costruisce il data model in linguaggio naturale |
| **Data Model** | `SemanticLayerView.tsx` | Metriche, gerarchie, segmenti, bridge cross-sorgente |
| **Context** | `ContextTab.tsx` | Contesto semantico aggiuntivo per il query engine |

### QUERY & ACT
| Tab | Componente | Funzione |
|---|---|---|
| **Query AI** | `QueryInterface.tsx` | NL → SQL, risponde in tabelle/grafici/testo |
| **Agents** | `AgentsView.tsx` | Agenti AI automatici (monitor, alert, riconciliatori) |

### MONITOR
| Tab | Componente | Funzione |
|---|---|---|
| **Dashboard** | `Dashboard.tsx` | KPI, statistiche, report esecutivo |
| **Compliance** | `ComplianceView.tsx` | GDPR data map + EU AI Act risk register |

### MORE
| Tab | Componente | Funzione |
|---|---|---|
| **Use Cases** | `UseCasesView.tsx` | Esempi di casi d'uso per settore |
| **Setup** | `ProcessView.tsx` | Esegue la pipeline (extract→enrich→index), mostra lifecycle |
| **Configuration** | `ConfigurationView.tsx` / `AdminSections.tsx` | Utenti, token API, notifiche, audit log |

---

## 5. Backend — i moduli principali

```
backend/app/main.py     ← core endpoint (~6.300 righe, 80 endpoint inline)
backend/app/semantic/   ← semantic layer: intent, metriche, concetti canonici, provider LLM
backend/app/curation/   ← scrematura schema: motore a regole + skill pack + advisor LLM
backend/app/agentic/    ← Executive Agentic Layer: azioni con approvazione umana (HITL)
backend/app/kg/         ← Knowledge Graph networkx
backend/app/connectors/ ← DuckDB, Postgres, SQLite, file, Salesforce (solo metadati di default)
backend/app/pipeline/   ← orchestratore auto-build a 5 stadi
```

I gruppi di endpoint più recenti sono router estratti (agentic, curation, context, audit, users, notifications, tokens, workspace, MCP); i nuovi gruppi nascono come router, non dentro main.py.

**Endpoint principali (prefisso `/api`):**
- `POST /api/auth/token` — JWT con `mode: live | demo`
- `GET /api/semantic/status` — stato del data model (entity count, KG nodes, ecc.)
- `GET /api/semantic/live-config` — configurazione workspace live
- `POST /api/pipeline/run` — pipeline auto-build (context→sources→build→verify)
- `POST /api/semantic/ask` (alias `/api/ask`) — query in linguaggio naturale
- `GET /api/curation/report`, `POST /api/curation/advise` (job asincrono) — scrematura schema
- `POST /api/agent/execute`, `POST /api/agent/actions/{id}/approve` — azioni HITL
- `POST /api/mcp` — server MCP read-only per agenti esterni

**Provider LLM:** Anthropic (Claude) è il default quando `ANTHROPIC_API_KEY` è presente (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`); Groq è il fallback; `FRA_LLM_PROVIDER` forza la scelta. Senza chiavi tutto degrada ai percorsi deterministici.

**Funzioni interne importanti:**
```python
_audit(conn, user_id, action, resource)   # scrive nel log di audit visibile ai live user
_safe_ingest_error(exc)                   # converte eccezioni in messaggi user-safe
backendErrorMessage(err)                  # frontend: estrae detail.message dall'errore HTTP
```

---

## 6. Frontend — pattern ricorrenti

### `workspaceLabel(sector.name)`
Usato nei sottotitoli di ogni pagina. In demo restituisce il nome del settore ("Manufacturing"). In live restituisce il nome dell'azienda da `localStorage('si-company-name')` o "Live workspace".

### `modeScopedSector(sectorId)`
Namespace per localStorage: in demo usa il sector id puro (`manufacturing`), in live usa `live-manufacturing`. Evita che dati demo contaminino il workspace live.

### `SectorContext`
Context React che tiene traccia del settore attivo. Ha senso solo in demo (4 settori). In live è sempre "manufacturing" come default e il `SectorSwitcher` è nascosto.

### Eventi custom (`window.dispatchEvent`)
Comunicazione cross-componente senza prop drilling:
- `trigger-export-report` → Dashboard genera il report PDF/HTML
- `trigger-pipeline-run` → ProcessView avvia la pipeline
- `pipeline-run-updated` → ProcessView/Dashboard/OntologyBuilder si aggiornano dopo un run
- `open-command-palette` → apre il command palette (⌘K)
- `ontology-entity-added` → AgentsView si aggiorna quando si aggiunge un'entità

---

## 7. Il data model (cosa costruisce il cliente)

Quando un cliente live usa l'app, costruisce progressivamente:

```
1. Sorgenti → collega DB/file
2. Entità   → definisce "Customer", "Order", "Product", ecc. (Entity Graph)
3. Bridge   → collega chiavi tra sorgenti (customer_ref ↔ accountId)
4. Metriche → "Revenue", "Churn Rate", ecc. (Data Model tab)
5. Setup    → esegue la pipeline che indicizza tutto
6. Query    → fa domande in NL
7. Agents   → crea agenti automatici
```

---

## 8. Evoluzioni recenti (storico sintetico)

- **De-jargonizzazione live mode** (giugno 2026): rimosso gergo tecnico ("semantic layer", "ontology", "pipeline") da tutti i percorsi visibili a utenti live; sostituiti con "data model", "entity graph", "setup"
- **Wizard 8 step DataSourcesView** (giugno 2026): in live mode, DataSourcesView è un wizard a step singolo con Rail di navigazione; demo mode usa il layout flat invariato
- **SemanticLayerView sezioni** (giugno 2026): navigazione a sezioni via `setSection(SLSection)` — bridges con fromField/toField, relations con "+ New" sempre visibile, form con fallback free-text
- **Memory fix Render** (giugno 2026): FRA_KG_NODE_LIMIT=5000, FRA_KG_EDGE_LIMIT=5000, FRA_SKIP_WARMUP=true nel Dockerfile per evitare OOM su free tier 512MB
- **Salesforce metadata-only + naming canonico** (luglio 2026): il connettore Salesforce importa solo metadati (schema/relazioni, zero record di default); entità con nomi leggibili (`display_name`) e unificazione cross-source sotto concetti canonici (Account/Customer/Cliente → **Customer**, via `concepts.yaml` + SAME_AS nel KG)
- **Curation layer** (luglio 2026): scrematura spiegabile e reversibile dello schema (regole → segnali → advisor LLM con confidence e cooldown); pannello "Schema curation" in Data Sources; le decisioni umane insegnano alias al sistema (learning loop), i rifiuti finiscono in deny-list
- **Azioni HITL sul data model** (luglio 2026): merge/rinomina/assegna-concetto via comando naturale → coda di approvazione manager → esecuzione con audit; niente viene mai scritto senza approvazione umana
- **Anthropic default** (luglio 2026): Claude è il provider LLM primario, Groq il fallback; advise di curation asincrono (job + polling)

---

## 9. Come girare il progetto in locale

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

Il frontend gira su `http://localhost:5173`, il backend su `http://localhost:8000`.

**Login demo:** usa il form di login, il backend emette un JWT `mode: demo`.
**Login live:** JWT con `mode: live` — tutti i contenuti demo spariscono.

---

## 10. File di documentazione nel repo

| File | Contenuto |
|---|---|
| `CLAUDE.md` | **Guida operativa per Claude Code** — comandi, architettura, regole |
| `CHANGELOG_LIVE.md` | Log cronologico di ogni modifica live |
| `PROJECT_KNOWLEDGE_MAP.md` | Mappa completa del codice |
| `ORIENTAMENTO.md` | Questo file — overview rapido del prodotto |
| `AGENTS.md` | Obblighi di manutenzione doc post-modifica |
| `CODE_AUDIT_AND_IMPROVEMENTS.md` | Security findings e technical debt |
| `DISCOVERY.md` | Note di discovery iniziale |
| `RECAP_FUNZIONALITA_E_MODIFICHE_DA_INIZIO_LAVORI.md` | Recap storico funzionalità |
