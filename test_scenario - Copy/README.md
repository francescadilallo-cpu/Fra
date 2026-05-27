# Scenario di test: AdventureWorks distribuito

Scenario realistico per testare un **Semantic Layer / Ontologia / KG**
come strato intermedio tra dati aziendali e agenti.

I dati provengono da **AdventureWorks 2014** (sample database Microsoft, ~70 tabelle,
multi-dominio: vendite/HR/produzione) ma sono stati spezzati in 3 fonti eterogenee
e "sporcati" con incoerenze realistiche.

---

## Le 3 fonti

| # | Sistema simulato | Tecnologia | Contenuto | File |
|---|---|---|---|---|
| 1 | **OrionSales** (ERP) | PostgreSQL | ordini, dettagli ordini, venditori, territori, offerte | `output/erp_postgres/orion_sales_dump.sql` |
| 2 | **ClientHub** (CRM) | SQLite | clienti, contatti, indirizzi, geografia | `output/crm_sqlite/clienthub.db` |
| 3 | **HR + PIM** (legacy) | CSV + JSON | dipendenti (italiano), catalogo prodotti | `output/hr_pim_files/*` |

### Incoerenze introdotte (sporcamento "medio")

- **Naming convention diverse** tra fonti:
  - ERP → `snake_case` (`order_id`, `customer_ref`, `total_due`)
  - CRM → `camelCase` + italiano (`accountId`, `ragioneSociale`, `nomeContatto`)
  - HR → italiano puro (`MatricolaDip`, `Nome`, `Cognome`, `RetribuzioneOraria`)
  - PIM → `camelCase` con metadata (`sku`, `internal_id`, `categoryPath`, `listPrice`)

- **Date in 3 formati diversi**:
  - ERP: ISO `2014-05-31`
  - CRM: ISO con timestamp `2014-01-01T00:00:00`
  - HR: italiano `31/05/2014`
  - PIM: US legacy `05/31/2014`

- **Identificatori che attraversano le fonti** ma con nomi diversi:
  - cliente: `customer_ref` (ERP) → `accountId` (CRM)
  - venditore: `salesperson_ref` (ERP) → `MatricolaDip` (HR) → `contactId` (CRM)
  - prodotto: `product_ref` (ERP) → `internal_id` (PIM) — anche `sku` come chiave alternativa
  - territorio: `territory_ref` (ERP) → `territoryHint` (CRM)

- **~1.9% duplicati** sui clienti nel CRM (stesso cliente con ID negativo e piccole varianti di formato → spazi, lowercase email)

- **~3% valori mancanti** su campi non-chiave (email, telefono, retribuzione)

- **Nomi/cognomi**: nel CRM B2C sono concatenati in `nomeContatto`; nell'HR sono separati in `Nome`/`Cognome`. Nel CRM `contact` sono di nuovo separati. → test classico per la fusione di entità Persona.

- **B2B vs B2C nel CRM**: stesso schema, ma per B2B la "ragione sociale" è in italiano (`ragioneSociale`) e `nomeContatto` è vuoto; per B2C l'opposto.

---

## Setup veloce

### 1. ERP su Postgres (Docker)

```bash
docker run -d --name aw-erp -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
docker cp output/erp_postgres/orion_sales_dump.sql aw-erp:/tmp/
docker exec -i aw-erp psql -U postgres -f /tmp/orion_sales_dump.sql

# Test:
docker exec -i aw-erp psql -U postgres -c "SELECT COUNT(*) FROM orion_sales.sales_order_header;"
```

### 2. CRM SQLite (zero setup)

```bash
sqlite3 output/crm_sqlite/clienthub.db "SELECT accountType, COUNT(*) FROM account GROUP BY accountType;"
```

### 3. HR + PIM (file)

```bash
# HR CSV (separatore ;)
head output/hr_pim_files/dipendenti_hr.csv

# PIM JSON
jq '._meta, (.products | length)' output/hr_pim_files/product_catalog_pim.json
```

---

## Come testare il tuo Semantic Layer

L'idea è collegare il tuo layer a queste 3 fonti e poi sottoporre **domande in linguaggio naturale**
che richiedano di:

1. **Risolvere semanticamente** termini ambigui ("fatturato", "clienti attivi", "top venditore")
2. **Fare join cross-fonte** seguendo l'ontologia
3. **Disambiguare entità duplicate** (clienti CRM con ID negativi)
4. **Gestire formati diversi** (date, valute, naming)
5. **Restituire metadata** (provenienza del dato, freschezza, definizione di business)

Vedi `golden_questions.md` per la lista di 25 domande pronte da usare come test set.
