# AGENTS.md

## Scopo

Queste istruzioni definiscono il comportamento obbligatorio dell'agente su questo repository.

## Regola principale: manutenzione documentazione continua

Ogni volta che viene effettuata una modifica al codice o alla configurazione del progetto, l'agente deve aggiornare anche i seguenti file:

- PROJECT_KNOWLEDGE_MAP.md
- CODE_AUDIT_AND_IMPROVEMENTS.md

Questa regola vale per ogni change set, inclusi fix piccoli, refactor, security hardening, nuove feature, aggiornamenti dependency, modifiche Docker/CI e aggiornamenti endpoint/API.

## Procedura obbligatoria post-modifica

Dopo qualunque edit, prima di chiudere il task, l'agente deve eseguire questi passi:

1. Identificare i file modificati e l'impatto architetturale/funzionale.
2. Aggiornare PROJECT_KNOWLEDGE_MAP.md:
- endpoint/flow/componenti cambiati
- nuovi file e responsabilita
- eventuali variazioni runtime/configurazione
3. Aggiornare CODE_AUDIT_AND_IMPROVEMENTS.md:
- stato finding (RISOLTO/PARZIALE/APERTO)
- nuove criticita emerse
- checklist vulnerabilita aggiornata
- piano priorita aggiornato se necessario
4. Se una modifica non ha impatto reale sui due documenti, aggiungere comunque una breve nota esplicita nei documenti o nel riepilogo finale indicando "nessun impatto sostanziale".

## Criteri di aggiornamento minimo

Per mantenere i documenti coerenti senza rumore:

- Aggiornare solo sezioni impattate.
- Evitare riscritture totali se non necessarie.
- Mantenere allineamento con lo stato reale del codice in main.py, frontend/src e backend/app.

## Checklist di chiusura task (obbligatoria)

Prima di considerare completato un task con modifiche:

- [ ] codice aggiornato
- [ ] errori/lint principali verificati
- [ ] PROJECT_KNOWLEDGE_MAP.md aggiornato
- [ ] CODE_AUDIT_AND_IMPROVEMENTS.md aggiornato
- [ ] riepilogo finale include cosa e stato aggiornato nei due documenti
