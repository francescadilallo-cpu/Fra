# Far girare Fra in locale (macOS)

Guida per eseguire l'intero stack sul proprio Mac, con i dati demo AdventureWorks
già inclusi nel repo (`test_scenario/`, ~18 MB). Nessun Docker, nessun Render.

Procedura verificata su `main` — backend, frontend, autenticazione, seed delle
4 sorgenti demo e build del Knowledge Graph (~174k nodi, ~13 s a freddo).

---

## 1. Prerequisiti

```bash
brew install python@3.11 node
```

- **Python 3.11** — `backend/.python-version` lo pinna. `duckdb==1.5.3` e `pandas`
  hanno wheel pronte per 3.11 su Apple Silicon e Intel: su altre versioni rischi
  una compilazione da sorgente.
- **Node 20+** — Vite 5.
- Docker **non** serve: i dati demo sono file (dump SQL, SQLite, CSV, JSON) letti
  direttamente da DuckDB.

## 2. Setup (una volta sola)

```bash
git clone https://github.com/francescadilallo-cpu/Fra.git
cd Fra
./scripts/local-setup.sh
```

Lo script crea `.venv`, installa le dipendenze di backend e frontend e genera un
`.env` con un account admin funzionante. È idempotente e non sovrascrive mai un
`.env` esistente.

Per scegliere la password: `FRA_LOCAL_PASSWORD='...' ./scripts/local-setup.sh`
(default `fra-local-dev`).

## 3. Avvio

```bash
./scripts/local-run.sh
```

| | |
|---|---|
| Frontend | <http://localhost:5173> |
| Backend | <http://localhost:8000/api/health> |
| API docs | <http://localhost:8000/docs> |
| Login | `admin` / `fra-local-dev` |

`Ctrl-C` ferma entrambi i processi.

Vite fa già da proxy `/api` → `:8000` (`frontend/vite.config.ts`), quindi in
sviluppo **non** serve impostare `VITE_API_URL`.

### Avvio manuale (due terminali)

```bash
# terminale 1
cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000

# terminale 2
cd frontend && npm run dev
```

`load_dotenv()` in `backend/app/main.py` risale dalla cwd, quindi il `.env` nella
root del repo viene letto anche lanciando uvicorn da `backend/`.

---

## 4. Demo mode vs Live mode

La modalità si sceglie **al login** (campo `mode` su `POST /api/auth/token`), non
in fase di build — lo stesso ambiente locale serve entrambe.

| | Demo | Live |
|---|---|---|
| Dati | AdventureWorks da `test_scenario/` | sorgenti registrate via `POST /api/sources` |
| Query | risposte pre-calcolate lato frontend | `/api/ask` · `/api/semantic/ask` (LLM) |
| `ANTHROPIC_API_KEY` | non serve | **serve** |

Senza `ANTHROPIC_API_KEY` il backend parte comunque: `/api/config/llm-status`
risponde `{"configured": false}` e `/api/semantic/ask` risolve solo i template
deterministici — le domande fuori template tornano `SEMANTIC_ONTOLOGY_VIOLATION`.
Per testare davvero il percorso NL→SQL aggiungi la chiave in `.env` e riavvia.

## 5. Variabili d'ambiente locali

Quelle scritte da `local-setup.sh`:

| Var | Valore locale | Perché |
|---|---|---|
| `FRA_STORAGE_MODE` | `snapshot` | snapshot DuckDB persistente in `backend/data/`, niente re-ingest a ogni riavvio |
| `FRA_SEED_DEMO_SOURCES` | `true` | registra ERP/CRM/HR/PIM da `test_scenario/` con i path locali |
| `FRA_SKIP_WARMUP` | `true` | KG costruito alla prima query, non al boot |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | evita il logout a metà sessione di test |

**Da non copiare da Render:** `FRA_KG_NODE_LIMIT` / `FRA_KG_EDGE_LIMIT` valgono
`5000` nel `backend/Dockerfile` per stare nei 512 MB del piano free. In locale
lasciali non impostati (illimitato): il KG completo è ~174k nodi / ~131k archi e
su un Mac con ≥ 8 GB gira senza problemi. Con i limiti attivi vedresti un grafo
troncato e risultati diversi dal previsto.

## 6. Reset

```bash
rm -f backend/data/*.duckdb backend/data/*.db   # rebuild dello snapshot e del registry
rm -rf .venv frontend/node_modules .env         # ripartire da zero
```

Tutto ciò che sta in `backend/data/` è generato a runtime e già gitignorato.

## 7. Prima di committare

```bash
ruff format backend && ruff check backend --fix   # gate CI (ruff è nel .venv)
cd frontend && npx tsc --noEmit
cd backend && pytest tests/
```
