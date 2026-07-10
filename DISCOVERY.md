# DISCOVERY — Fra Semantic Layer Platform

> **[NOTA STORICA — 2026-07-10]** Questo documento descrive la discovery
> iniziale del progetto e NON riflette più il codice attuale (il layout
> `backend/fra/`, le "3 sorgenti fisse" e vari moduli sono cambiati).
> Le fonti aggiornate sono `PROJECT_KNOWLEDGE_MAP.md` (mappa del codice),
> `ORIENTAMENTO.md` (overview prodotto) e `CHANGELOG_LIVE.md` (cronologia).


## Architecture Overview

Fra is a distributed Semantic Layer platform that unifies three heterogeneous data sources (ERP, CRM, HR/PIM) into a single queryable ontology. The backend is a FastAPI application (Python 3.11, Pydantic v2) that exposes both REST endpoints and a CLI (`fra`).

## Repository Layout

```
Fra/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI entry point (existing routes + new /api/semantic/*)
│   │   ├── database.py         # SQLite helpers for the existing internal DB
│   │   ├── models.py           # Pydantic API models (existing)
│   │   ├── connectors/
│   │   │   ├── base.py         # BaseConnector ABC + SourceMeta
│   │   │   ├── postgres_connector.py   # ERP SQL dump → SQLite in-memory
│   │   │   ├── sqlite_connector.py     # CRM clienthub.db
│   │   │   └── file_connector.py       # HR CSV + PIM JSON (Step 2)
│   │   ├── ontology/
│   │   │   ├── manufacturing.py        # Legacy manufacturing ontology (untouched)
│   │   │   ├── mapper.py               # Legacy mapper (untouched)
│   │   │   └── ontology.py             # New business ontology: Pydantic models + YAML loader (Step 3)
│   │   ├── kg/
│   │   │   ├── __init__.py
│   │   │   └── graph.py                # KnowledgeGraph: networkx MultiDiGraph (Step 4)
│   │   ├── metadata/
│   │   │   ├── __init__.py
│   │   │   └── catalog.py              # MetadataCatalog: SQLAlchemy + SQLite (Step 5)
│   │   ├── semantic/
│   │   │   ├── __init__.py
│   │   │   └── layer.py                # SemanticLayer: NL → Intent → Result (Step 6)
│   │   ├── context/
│   │   │   ├── __init__.py
│   │   │   └── manager.py              # ContextManager: in-process session state (Step 7)
│   │   └── cli.py                      # CLI entry point (Step 8)
│   ├── fra/
│   │   ├── __init__.py
│   │   └── cli.py                      # Thin wrapper → app.cli (Step 8)
│   ├── tests/
│   │   └── test_golden_questions.py    # 25 golden questions eval (Step 10)
│   └── requirements.txt
├── test_scenario/
│   ├── erp_postgres/orion_sales_dump.sql
│   ├── crm_sqlite/clienthub.db
│   ├── hr_pim_files/dipendenti_hr.csv
│   ├── hr_pim_files/product_catalog_pim.json
│   ├── ontology_example.yaml           # Canonical source-to-entity field mapping
│   ├── golden_questions.md             # 25 test questions (4 difficulty levels)
│   └── ground_truth.py                # Reference answers computed directly from data
├── frontend/                           # React/Vite frontend (untouched)
└── docker-compose.yml
```

## Data Sources

| Source | Connector | Key Field | Notes |
|--------|-----------|-----------|-------|
| ERP (OrionSales PostgreSQL dump) | `PostgresConnector` | `order_id`, `salesperson_ref`, `customer_ref`, `product_ref` | Loaded into SQLite in-memory via regex parsing |
| CRM (clienthub.db SQLite) | `SQLiteConnector` | `accountId` | `accountId < 0` → duplicate; deduplicate by email + name |
| HR CSV (`;`-sep, Italian dates) | `FileConnector` | `MatricolaDip` | Dates DD/MM/YYYY → ISO 8601 |
| PIM JSON (camelCase, US dates) | `FileConnector` | `internal_id` (alt: `sku`) | Dates MM/DD/YYYY → ISO 8601 |

## ERP Tables and Columns

- `sales_order_header`: order_id, order_number, order_date, ship_date, due_date, status_code, customer_ref, salesperson_ref, territory_ref, subtotal_amount, tax_amount, freight_amount, total_due, currency_iso
- `sales_order_line`: order_id, line_id, product_ref, qty, unit_price, unit_discount, line_total, offer_ref
- `salesperson`: salesperson_id, territory_ref, sales_quota, bonus, commission_pct, sales_ytd, sales_last_year
- `territory`: territory_id, territory_name, country_code, region_group, sales_ytd, cost_ytd
- `offer`: offer_id, description, discount_pct, offer_type, category, start_date, end_date, min_qty, max_qty

## CRM Tables and Columns

- `account`: accountId, accountType, personRef, storeRef, ragioneSociale, nomeContatto, emailContatto, telefonoContatto, territoryHint, createdAt, isActive
- `address`: addressId, line1, line2, city, stateProvinceId, postalCode
- `account_address`: accountRef, addressRef, addressType
- `state_province`: stateId, stateCode, stateName, countryCode, territoryRef
- `country`: countryCode, countryName

## HR CSV Columns

MatricolaDip, Nome, Cognome, Mansione, Reparto, GruppoReparto, DataAssunzione, DataNascita, Genere, StatoCivile, OreFerieResidue, OreMalattiaResidue, RetribuzioneOraria, FrequenzaPaga

## PIM JSON Fields

sku, internal_id, displayName, categoryPath, modelName, color, size, weight, weightUnit, standardCost, listPrice, isMakeOnly, isPurchasable, sellStartDate, sellEndDate

## Identity Resolution Rules

| ERP field | Linked to | Notes |
|-----------|-----------|-------|
| `customer_ref` | CRM `accountId` | Same numeric ID; skip negative CRM IDs (duplicates) |
| `salesperson_ref` | HR `MatricolaDip` AND ERP `salesperson.salesperson_id` | Same BusinessEntityID |
| `product_ref` | PIM `internal_id` (alt: `sku`) | Direct numeric match |

## Naming Conventions

- Python: `snake_case` for functions/variables, `PascalCase` for classes
- Files: `snake_case.py`
- Pydantic v2 throughout; `from __future__ import annotations` at top of every module
- `BaseConnector.load_entity(entity_type: str)` yields `Iterable[dict]`
- `BaseConnector.execute_query(sql, params=())` returns `list[dict]`
- `BaseConnector.describe()` returns `SourceMeta`

## Metrics Semantics

| Term | Maps to | Note |
|------|---------|------|
| `revenue` | `SUM(subtotal_amount)` | Tax-excluded |
| `revenue_with_tax` | `SUM(total_due)` | Includes tax + freight |
| `fatturato` | AMBIGUOUS | Raises `AmbiguityError` |
| `incassi` / `incasso` | `revenue_with_tax` | |
| `margin` | `SUM(qty * (listPrice - standardCost))` | Requires ERP+PIM join |
| `active_customers` | `COUNT(DISTINCT customer_ref)` | From orders |

## Integration Points

- **Connectors → KG**: `KnowledgeGraph.build(erp, crm, hr_pim)` calls `load_entity()` on all connectors
- **KG → MetadataCatalog**: `populate()` reads KG node/edge stats and computes nullability, sample values
- **MetadataCatalog → SemanticLayer**: SemanticLayer receives catalog for provenance injection into Result
- **SemanticLayer → ContextManager**: per-session disambiguation history
- **CLI / FastAPI → SemanticLayer**: both call `SemanticLayer.ask(question)`
