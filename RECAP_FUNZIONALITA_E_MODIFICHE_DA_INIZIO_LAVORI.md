# RECAP FUNZIONALITA E MODIFICHE DA INIZIO LAVORI

> **[NOTA STORICA — 2026-07-10]** Recap fermo a una fase precedente del
> progetto. Per lo stato attuale e la cronologia completa vedere
> `CHANGELOG_LIVE.md`; per la mappa del codice `PROJECT_KNOWLEDGE_MAP.md`.


## 1) Obiettivo della recap

Questo file sintetizza in modo operativo le funzionalita implementate e le modifiche introdotte durante il percorso di hardening e evoluzione del progetto SemanticIntelligence.


## 2) Evoluzione architetturale principale

### 2.1 Consolidamento query path

- dismesso endpoint legacy `/api/query`
- consolidato path unico su `/api/semantic/ask`
- query execution resa neuro-simbolica con validazione ontologica + metadata catalog

### 2.2 Hardening sicurezza backend

- introdotta autenticazione JWT (`/api/auth/token`, alias `/api/auth/login`)
- introdotto RBAC con ruoli `admin` e `user`
- protetti endpoint sensibili:
  - `/api/semantic/ask`
  - `/api/semantic/status`
  - `/api/data/{table}`
  - endpoint di mutazione mapping e rebuild KG
- CORS passato da wildcard a configurazione env (`ALLOWED_ORIGINS`)
- introdotto rate limiting (`slowapi`) con handler 429 pulito su endpoint sensibili

### 2.3 Guardrail anti-injection e anti-allucinazione

- blocco pattern prompt injection
- blocco keyword SQL distruttive (DROP/ALTER/DELETE/INSERT/UPDATE/TRUNCATE)
- blocco accesso tabelle di sistema (`sqlite_master`, `information_schema`, `pg_catalog`, ...)
- blocco tabelle fuori catalogo
- errori semantici/security convertiti in risposta controllata lato API

### 2.4 Concorrenza e lifecycle semantic state

- lazy init thread-safe con `RLock` + double-checked locking
- lock condiviso anche sul rebuild KG
- riduzione rischio race condition su bootstrap semantic stack

### 2.5 Executive Agentic Layer (write-back governato)

Nuovi moduli:

- `backend/app/agentic/executive.py`
- `backend/app/agentic/router.py`

Nuovi endpoint:

- `POST /api/agent/execute`
- `POST /api/agent/approve/{action_id}`
- `GET /api/agent/audit`

Caratteristiche:

- ciclo HITL: proposta -> validazione -> coda pending -> approvazione manager -> esecuzione
- separazione decisione agentica / write-back reale
- validazione ontologica + vincolo business su data consegna
- audit semantico strutturato fasi (`PROPOSED`, `VALIDATED`, `QUEUED`, `APPROVED`, `REJECTED`, `EXECUTED`, `FAILED`)


## 3) Evoluzione frontend

- login reale su backend (`/api/auth/token`) in `AccessGate`
- rimozione token demo hardcoded iniziali in area admin
- gestione token JWT via interceptor Axios (`Authorization: Bearer <token>`)
- allineamento contratto `semantic status` con parsing runtime tipizzato
- correzione wiring view semantic layer in shell app


## 4) Copertura test introdotta/aggiornata

### 4.1 Test neuro-simbolici

- file: `backend/tests/test_neurosymbolic_pipeline.py`
- copertura su lineage obbligatoria, violazioni ontologiche, guardrail security

### 4.2 Test API golden questions

- file: `backend/tests/test_golden_questions.py`
- suite API-level su `/api/semantic/ask` con casi multi-dominio + negativi

### 4.3 Test endpoint Executive Agentic Layer

- file: `backend/tests/test_agentic_endpoints.py`
- copertura:
  - execute -> `PENDING_HUMAN_APPROVAL`
  - approve -> `EXECUTED` e `REJECTED`
  - seconda approve su action eseguita -> `HTTP 409`
  - audit endpoint
  - no-auth / non-admin
  - concorrenza su doppia approvazione simultanea lock-safe

Esito locale piu recente:

- `python -m pytest -q tests/test_agentic_endpoints.py` -> `12 passed`


## 5) Stato operativo corrente (verifica sessione)

### 5.1 Frontend

- `npm install` e `npm run build` eseguiti con successo
- warning bundle size elevata su chunk principale (ottimizzazione consigliata)

### 5.2 Backend

- suite agentic: verde
- suite neuro-simbolica + golden: quasi verde, con failure residue su parsing intent di alcuni casi golden (finanza/logistica)


## 6) Delta qualitativo percepito

Miglioramenti forti rispetto a inizio lavori:

- sicurezza applicativa significativamente piu robusta
- percorso query consolidato e piu governato
- introduzione governance agentica HITL con audit
- testability migliore su API core

Aree ancora da completare:

- robustezza parser/rule fallback per intent golden rimanenti
- hardening JWT custom (valutare libreria standard)
- dependency/CI governance completa (lockfile, scansioni, quality gates)


## 7) Prossimi step consigliati

1. Correggere i 4 failure golden residui nel parser intent (`unknown` su F1/F4/L2 e intent assente su F3).
2. Inserire job CI con test backend/frontend e gate minimi (build, pytest, lint).
3. Ridurre bundle frontend con code splitting su viste pesanti.
4. Valutare persistenza audit/queue agentica su storage durable (non solo in-memory).
