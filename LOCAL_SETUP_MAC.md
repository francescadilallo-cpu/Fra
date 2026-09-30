# Far girare Fra in locale (macOS)

Guida per eseguire l'intero stack sul proprio Mac, con i dati demo AdventureWorks
già inclusi nel repo (`test_scenario/`, ~18 MB). Nessun Docker, nessun Render.

Procedura verificata su `claude/branch-diff-main-pxfn76` (il branch più avanzato:
41 commit davanti a `main`, che non ne ha nessuno di esclusivo) — backend,
frontend, autenticazione, seed delle
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
| `FRA_SEED_DEMO_SOURCES` | `true` | registra ERP/CRM/HR/PIM da `test_scenario/` con i path locali |
| `FRA_SKIP_WARMUP` | `true` | KG costruito alla prima query, non al boot |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | evita il logout a metà sessione di test |

### Profilo risorse (scelto automaticamente)

`local-setup.sh` legge RAM e spazio libero sul volume che ospita il repo e
scrive il `.env` di conseguenza. Misure sul dataset demo AdventureWorks:

| Profilo | Condizione | `FRA_STORAGE_MODE` | Tetto KG | Grafo | Tempo | Picco RAM | Scrive su disco |
|---|---|---|---|---|---|---|---|
| **full** | > 8 GB RAM **e** > 15 GB liberi | `snapshot` | nessuno | 173.786 nodi / 131.472 archi | ~12 s | ~593 MB | sì |
| **constrained** | ≤ 8 GB RAM **o** ≤ 15 GB liberi | `nostore` | 20.000 | 60.803 nodi / 39.040 archi | ~5 s | ~375 MB | **no** |

Forzare a mano: `FRA_LOCAL_PROFILE=constrained ./scripts/local-setup.sh`.

**Perché il disco conta più della RAM.** 593 MB non mettono in crisi un Mac da
8 GB, ma su un volume APFS quasi pieno la scrittura dello snapshot DuckDB
rallenta fino a bloccarsi: il backend resta vivo e non risponde più, e ogni
richiesta va in timeout (`curl` restituisce `exit: 28`). Sembra un crash, è
saturazione del disco. `nostore` tiene tutto in memoria e non scrive nulla,
al prezzo di ricostruire a ogni riavvio (~5 s).

**Da non copiare da Render:** nel `backend/Dockerfile` i due limiti valgono
`5000` per stare nei 512 MB del piano free. Anche nel profilo constrained il
valore locale è 4× più generoso.

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
cd frontend && npm test                           # vitest
cd backend && pytest tests/
```
