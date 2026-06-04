"""Seed dataset of golden query templates for ERP/CRM/HR/PIM deployments.

This module defines the default query templates that are inserted into the
MetadataCatalog on first install.  Each entry maps a human-readable question
to a parameterised SQL query and a set of keywords that should trigger it.

Templates use two safe substitution tokens:
  {year}  — replaced with the requested 4-digit year (default 2024)
  {limit} — replaced with the requested row limit (default 10, max 100)

All other SQL is left verbatim so the queries work against the AdventureWorks-
style ERP/CRM/HR/PIM tables created by the DuckDB source manager.
"""

from __future__ import annotations

SEED_TEMPLATES: list[dict] = [
    # ── Q1: Employee count ────────────────────────────────────────────────────
    {
        "name": "Numero dipendenti totale",
        "description": "Numero totale di dipendenti nel sistema HR",
        "sql_query": "SELECT COUNT(*) AS cnt FROM dipendenti_hr",
        "keywords": [
            "quanti dipendenti",
            "numero dipendenti",
            "totale dipendenti",
            "how many employees",
            "total employees",
            "employee count",
            "headcount",
        ],
        "sources": ["dipendenti_hr"],
    },
    # ── Q1b: Employees per department ────────────────────────────────────────
    {
        "name": "Dipendenti per reparto",
        "description": "Numero di dipendenti per reparto",
        "sql_query": (
            "SELECT Reparto, COUNT(*) AS cnt "
            "FROM dipendenti_hr "
            "GROUP BY Reparto "
            "ORDER BY cnt DESC"
        ),
        "keywords": [
            "dipendenti per reparto",
            "headcount per reparto",
            "employees by department",
            "quanti dipendenti per reparto",
            "how many employees per department",
        ],
        "sources": ["dipendenti_hr"],
    },
    # ── Q11: Employees by department group ───────────────────────────────────
    {
        "name": "Dipendenti per gruppo reparto",
        "description": "Numero di dipendenti per gruppo di reparto",
        "sql_query": (
            "SELECT GruppoReparto, COUNT(*) AS cnt "
            "FROM dipendenti_hr "
            "GROUP BY GruppoReparto "
            "ORDER BY cnt DESC"
        ),
        "keywords": [
            "dipendenti per gruppo",
            "headcount per gruppo reparto",
            "employees by department group",
            "gruppo reparto",
            "department group",
        ],
        "sources": ["dipendenti_hr"],
    },
    # ── Q5: Average hourly rate ───────────────────────────────────────────────
    {
        "name": "Retribuzione oraria media",
        "description": "Retribuzione oraria media dei dipendenti",
        "sql_query": (
            "SELECT ROUND(AVG(CAST(RetribuzioneOraria AS DOUBLE)), 4) AS avg_rate "
            "FROM dipendenti_hr"
        ),
        "keywords": [
            "retribuzione media",
            "paga media",
            "stipendio medio",
            "salario medio",
            "average hourly rate",
            "avg hourly rate",
            "retribuzione oraria",
        ],
        "sources": ["dipendenti_hr"],
    },
    # ── Q2: Product price list ────────────────────────────────────────────────
    {
        "name": "Listino prezzi prodotti",
        "description": "Prezzi di listino e costi standard dei prodotti",
        "sql_query": (
            "SELECT displayName, listPrice, standardCost "
            "FROM product_catalog_pim "
            "ORDER BY displayName "
            "LIMIT {limit}"
        ),
        "keywords": [
            "prezzo prodotto",
            "listino prezzi",
            "product price",
            "price list",
            "costo prodotto",
            "product cost",
        ],
        "sources": ["product_catalog_pim"],
    },
    # ── Q12: Make-only products ───────────────────────────────────────────────
    {
        "name": "Prodotti make only",
        "description": "Numero di prodotti fabbricati internamente (isMakeOnly = true)",
        "sql_query": (
            "SELECT COUNT(*) AS cnt FROM product_catalog_pim WHERE isMakeOnly = true"
        ),
        "keywords": [
            "make only",
            "makeonly",
            "prodotti interni",
            "prodotti fabbricati internamente",
            "internally manufactured",
            "make-only products",
        ],
        "sources": ["product_catalog_pim"],
    },
    # ── Q3: Order count ───────────────────────────────────────────────────────
    {
        "name": "Numero ordini",
        "description": "Numero totale di ordini di vendita",
        "sql_query": "SELECT COUNT(*) AS cnt FROM sales_order_header",
        "keywords": [
            "quanti ordini",
            "numero ordini",
            "totale ordini",
            "how many orders",
            "total orders",
            "order count",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q3y: Order count by year ──────────────────────────────────────────────
    {
        "name": "Numero ordini per anno",
        "description": "Numero di ordini di vendita in un anno specifico",
        "sql_query": (
            "SELECT COUNT(*) AS cnt "
            "FROM sales_order_header "
            "WHERE strftime('%Y', CAST(order_date AS DATE)) = '{year}'"
        ),
        "keywords": [
            "quanti ordini nel anno",
            "ordini anno",
            "orders in year",
            "order count by year",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q4: B2B active companies ──────────────────────────────────────────────
    {
        "name": "Aziende B2B attive",
        "description": "Numero di aziende B2B attive nel CRM",
        "sql_query": (
            "SELECT COUNT(DISTINCT ragioneSociale) AS cnt "
            "FROM account "
            "WHERE accountType = 'B2B' AND isActive = 1 "
            "AND ragioneSociale IS NOT NULL AND ragioneSociale != ''"
        ),
        "keywords": [
            "aziende b2b attive",
            "clienti b2b",
            "b2b active",
            "active b2b companies",
            "quante aziende b2b",
            "how many b2b",
        ],
        "sources": ["account"],
    },
    # ── Q13: Customers by state ───────────────────────────────────────────────
    {
        "name": "Clienti per stato/provincia",
        "description": "Lista clienti con stato/provincia di residenza",
        "sql_query": """SELECT a.accountId, a.ragioneSociale, a.nomeContatto, sp.stateName
FROM account a
JOIN account_address aa ON aa.accountRef = a.accountId
JOIN address addr ON addr.addressId = aa.addressRef
JOIN state_province sp ON sp.stateId = addr.stateProvinceId
WHERE a.accountId > 0
ORDER BY a.ragioneSociale, a.nomeContatto
LIMIT {limit}""",
        "keywords": [
            "clienti per stato",
            "clienti per provincia",
            "customers by state",
            "customers by province",
            "clienti california",
        ],
        "sources": ["account", "account_address", "address", "state_province"],
    },
    # ── Q6: Top salesperson by order count ───────────────────────────────────
    {
        "name": "Top venditore per numero ordini",
        "description": "Il venditore con il maggior numero di ordini gestiti",
        "sql_query": """SELECT salesperson_ref, COUNT(*) AS n
FROM sales_order_header
WHERE salesperson_ref IS NOT NULL
GROUP BY salesperson_ref
ORDER BY n DESC
LIMIT 1""",
        "keywords": [
            "venditore più ordini",
            "venditore gestito più ordini",
            "top salesperson by orders",
            "best salesperson orders",
            "chi ha gestito più ordini",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q6y: Top salesperson by orders for a year ─────────────────────────────
    {
        "name": "Top venditore per ordini (anno)",
        "description": "Il venditore con il maggior numero di ordini in un anno specifico",
        "sql_query": """SELECT salesperson_ref, COUNT(*) AS n
FROM sales_order_header
WHERE strftime('%Y', CAST(order_date AS DATE)) = '{year}'
  AND salesperson_ref IS NOT NULL
GROUP BY salesperson_ref
ORDER BY n DESC
LIMIT 1""",
        "keywords": [
            "venditore più ordini anno",
            "top salesperson orders year",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q14: Top salespersons by revenue ─────────────────────────────────────
    {
        "name": "Top venditori per fatturato",
        "description": "I migliori venditori ordinati per fatturato (total_due)",
        "sql_query": """SELECT salesperson_ref, ROUND(SUM(total_due), 2) AS revenue
FROM sales_order_header
WHERE salesperson_ref IS NOT NULL
GROUP BY salesperson_ref
ORDER BY revenue DESC
LIMIT {limit}""",
        "keywords": [
            "top venditori fatturato",
            "top salespersons revenue",
            "migliori venditori",
            "best salespersons by revenue",
            "venditori top fatturato",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q14y: Top salespersons by revenue for a year ──────────────────────────
    {
        "name": "Top venditori per fatturato (anno)",
        "description": "I migliori venditori per fatturato in un anno specifico",
        "sql_query": """SELECT salesperson_ref, ROUND(SUM(total_due), 2) AS revenue
FROM sales_order_header
WHERE strftime('%Y', CAST(order_date AS DATE)) = '{year}'
  AND salesperson_ref IS NOT NULL
GROUP BY salesperson_ref
ORDER BY revenue DESC
LIMIT {limit}""",
        "keywords": [
            "top venditori fatturato anno",
            "top salespersons revenue year",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q7: Revenue by territory ──────────────────────────────────────────────
    {
        "name": "Fatturato per territorio",
        "description": "Fatturato totale per territorio di vendita",
        "sql_query": """SELECT t.territory_name, ROUND(SUM(h.total_due), 2) AS revenue
FROM sales_order_header h
JOIN territory t ON h.territory_ref = t.territory_id
GROUP BY t.territory_name
ORDER BY revenue DESC""",
        "keywords": [
            "fatturato per territorio",
            "revenue by territory",
            "incassi per territorio",
            "vendite per territorio",
            "sales by territory",
        ],
        "sources": ["sales_order_header", "territory"],
    },
    # ── Q7y: Revenue by territory for a year ─────────────────────────────────
    {
        "name": "Fatturato per territorio (anno)",
        "description": "Fatturato totale per territorio in un anno specifico",
        "sql_query": """SELECT t.territory_name, ROUND(SUM(h.total_due), 2) AS revenue
FROM sales_order_header h
JOIN territory t ON h.territory_ref = t.territory_id
WHERE strftime('%Y', CAST(h.order_date AS DATE)) = '{year}'
GROUP BY t.territory_name
ORDER BY revenue DESC""",
        "keywords": [
            "fatturato territorio anno",
            "revenue by territory year",
        ],
        "sources": ["sales_order_header", "territory"],
    },
    # ── Q17: Revenue vs quota ─────────────────────────────────────────────────
    {
        "name": "Fatturato vs quota venditore",
        "description": "Confronto fatturato realizzato vs quota per ogni venditore",
        "sql_query": """SELECT h.salesperson_ref,
       ROUND(SUM(h.total_due), 2) AS revenue,
       MAX(sp.sales_quota) AS quota,
       ROUND(SUM(h.total_due) / NULLIF(MAX(sp.sales_quota), 0) * 100, 1) AS pct_quota
FROM sales_order_header h
JOIN salesperson sp ON h.salesperson_ref = sp.salesperson_id
WHERE h.salesperson_ref IS NOT NULL
GROUP BY h.salesperson_ref
ORDER BY revenue DESC""",
        "keywords": [
            "fatturato vs quota",
            "revenue vs quota",
            "quota venditore",
            "salesperson quota",
            "raggiunto quota",
            "quota attainment",
        ],
        "sources": ["sales_order_header", "salesperson"],
    },
    # ── Q8: Top customer by spend ─────────────────────────────────────────────
    {
        "name": "Cliente con maggiore spesa",
        "description": "Il cliente che ha speso di più in assoluto",
        "sql_query": """SELECT customer_ref, ROUND(SUM(total_due), 2) AS spesa
FROM sales_order_header
GROUP BY customer_ref
ORDER BY spesa DESC
LIMIT 1""",
        "keywords": [
            "cliente più speso",
            "cliente top spesa",
            "top customer by spend",
            "customer highest spend",
            "chi ha speso di più",
            "biggest customer",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q9: Top products by quantity ──────────────────────────────────────────
    {
        "name": "Top prodotti per quantità venduta",
        "description": "I prodotti più venduti per quantità totale",
        "sql_query": """SELECT product_ref, SUM(qty) AS qty_totale
FROM sales_order_line
GROUP BY product_ref
ORDER BY qty_totale DESC
LIMIT {limit}""",
        "keywords": [
            "prodotti più venduti",
            "top prodotti quantità",
            "top products by quantity",
            "best selling products",
            "prodotti per quantità",
            "most sold products",
        ],
        "sources": ["sales_order_line"],
    },
    # ── Q10: Customer state with most orders ──────────────────────────────────
    {
        "name": "Cliente con più ordini",
        "description": "Il cliente con il maggior numero di ordini",
        "sql_query": """SELECT customer_ref, COUNT(*) AS n
FROM sales_order_header
GROUP BY customer_ref
ORDER BY n DESC
LIMIT 1""",
        "keywords": [
            "cliente più ordini",
            "customer most orders",
            "chi ha più ordini",
            "customer with most orders",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Q15: Margin per salesperson ───────────────────────────────────────────
    {
        "name": "Margine per venditore",
        "description": "Margine lordo per venditore (qty * (listPrice - standardCost))",
        "sql_query": """SELECT h.salesperson_ref, l.product_ref,
       SUM(l.qty) AS total_qty
FROM sales_order_header h
JOIN sales_order_line l ON l.order_id = h.order_id
WHERE h.salesperson_ref IS NOT NULL
GROUP BY h.salesperson_ref, l.product_ref""",
        "keywords": [
            "margine per venditore",
            "margin per salesperson",
            "margine venditore",
            "salesperson margin",
            "profitto venditore",
        ],
        "sources": ["sales_order_header", "sales_order_line"],
    },
    # ── Q16: Average revenue by segment (B2B vs B2C) ─────────────────────────
    {
        "name": "Fatturato medio per segmento",
        "description": "Fatturato medio per segmento cliente (B2B vs B2C)",
        "sql_query": """SELECT
    a.accountType,
    COUNT(DISTINCT s.customer_ref)       AS n_customers,
    ROUND(SUM(s.total_due), 2)           AS total_revenue,
    ROUND(AVG(s.total_due), 2)           AS avg_per_order,
    ROUND(SUM(s.total_due) /
        NULLIF(COUNT(DISTINCT s.customer_ref), 0), 2) AS avg_per_customer
FROM sales_order_header s
JOIN account a ON s.customer_ref = a.accountId
WHERE a.accountId > 0
GROUP BY a.accountType
ORDER BY a.accountType""",
        "keywords": [
            "fatturato medio segmento",
            "revenue by segment",
            "average revenue b2b b2c",
            "fatturato b2b vs b2c",
            "revenue per segment",
            "media fatturato segmento",
        ],
        "sources": ["sales_order_header", "account"],
    },
    # ── Q18: Top category by margin ───────────────────────────────────────────
    {
        "name": "Categoria con margine più alto",
        "description": "Quantità venduta per categoria di prodotto (base per calcolo margine)",
        "sql_query": (
            "SELECT product_ref, SUM(qty) AS total_qty "
            "FROM sales_order_line "
            "GROUP BY product_ref"
        ),
        "keywords": [
            "categoria margine",
            "top category by margin",
            "categoria con margine più alto",
            "highest margin category",
            "margine per categoria",
            "margin by category",
        ],
        "sources": ["sales_order_line"],
    },
    # ── Q19: Orders with discount ─────────────────────────────────────────────
    {
        "name": "Ordini con sconto",
        "description": "Numero di ordini che includono almeno una linea con offerta speciale",
        "sql_query": (
            "SELECT COUNT(DISTINCT order_id) AS cnt "
            "FROM sales_order_line "
            "WHERE offer_ref != 1"
        ),
        "keywords": [
            "ordini con sconto",
            "orders with discount",
            "ordini scontati",
            "discounted orders",
            "offerta speciale",
            "special offer orders",
        ],
        "sources": ["sales_order_line"],
    },
    # ── Q20: Unique customers after dedup ─────────────────────────────────────
    {
        "name": "Clienti unici (post deduplicazione)",
        "description": "Conteggio clienti unici escludendo i duplicati (accountId < 0)",
        "sql_query": (
            "SELECT COUNT(*) AS total, "
            "SUM(CASE WHEN accountId < 0 THEN 1 ELSE 0 END) AS duplicates, "
            "SUM(CASE WHEN accountId > 0 THEN 1 ELSE 0 END) AS unique_customers "
            "FROM account"
        ),
        "keywords": [
            "clienti unici",
            "unique customers",
            "quanti clienti unici",
            "clienti dopo deduplicazione",
            "unique accounts",
            "customers after dedup",
        ],
        "sources": ["account"],
    },
    # ── Q24: Duplicate accounts check ─────────────────────────────────────────
    {
        "name": "Account duplicati",
        "description": "Numero di record duplicati nel CRM (accountId < 0)",
        "sql_query": ("SELECT COUNT(*) AS dups FROM account WHERE accountId < 0"),
        "keywords": [
            "account duplicati",
            "duplicate accounts",
            "duplicati crm",
            "crm duplicates",
            "quanti duplicati",
            "how many duplicates",
        ],
        "sources": ["account"],
    },
    # ── Revenue with tax ──────────────────────────────────────────────────────
    {
        "name": "Incassi totali (con tasse)",
        "description": "Fatturato totale lordo incluse tasse e spedizione (SUM total_due)",
        "sql_query": (
            "SELECT ROUND(SUM(total_due), 2) AS revenue_with_tax "
            "FROM sales_order_header"
        ),
        "keywords": [
            "incassi totali",
            "revenue with tax",
            "fatturato lordo",
            "total revenue with tax",
            "total due",
            "incassi",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Revenue with tax by year ──────────────────────────────────────────────
    {
        "name": "Incassi totali per anno",
        "description": "Fatturato totale lordo in un anno specifico",
        "sql_query": (
            "SELECT ROUND(SUM(total_due), 2) AS revenue_with_tax "
            "FROM sales_order_header "
            "WHERE strftime('%Y', CAST(order_date AS DATE)) = '{year}'"
        ),
        "keywords": [
            "incassi anno",
            "revenue with tax year",
            "fatturato anno",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Customers without orders (anti-join) ──────────────────────────────────
    {
        "name": "Clienti senza ordini",
        "description": "Clienti CRM che non hanno mai effettuato un ordine",
        "sql_query": """SELECT a.accountId, a.ragioneSociale, a.nomeContatto, a.accountType
FROM account a
WHERE a.accountId > 0
  AND a.accountId NOT IN (
      SELECT DISTINCT customer_ref
      FROM sales_order_header
      WHERE customer_ref IS NOT NULL
  )
ORDER BY a.ragioneSociale
LIMIT {limit}""",
        "keywords": [
            "clienti senza ordini",
            "customers without orders",
            "clienti mai ordinato",
            "customers never ordered",
            "clienti no ordini",
            "inactive customers no orders",
        ],
        "sources": ["account", "sales_order_header"],
    },
    # ── Revenue (subtotal, no tax) ────────────────────────────────────────────
    {
        "name": "Revenue netto (senza tasse)",
        "description": "Fatturato netto senza tasse e spedizione (SUM subtotal_amount)",
        "sql_query": (
            "SELECT ROUND(SUM(subtotal_amount), 2) AS revenue FROM sales_order_header"
        ),
        "keywords": [
            "revenue netto",
            "fatturato netto",
            "revenue without tax",
            "subtotal amount",
            "revenue senza tasse",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Revenue by year ───────────────────────────────────────────────────────
    {
        "name": "Revenue per anno",
        "description": "Fatturato netto per anno",
        "sql_query": (
            "SELECT strftime('%Y', CAST(order_date AS DATE)) AS anno, "
            "ROUND(SUM(subtotal_amount), 2) AS revenue "
            "FROM sales_order_header "
            "GROUP BY anno "
            "ORDER BY anno"
        ),
        "keywords": [
            "revenue per anno",
            "fatturato per anno",
            "annual revenue",
            "yearly revenue",
            "revenue annuale",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Revenue by month ──────────────────────────────────────────────────────
    {
        "name": "Revenue mensile",
        "description": "Fatturato mensile (anno e mese)",
        "sql_query": (
            "SELECT strftime('%Y-%m', CAST(order_date AS DATE)) AS mese, "
            "ROUND(SUM(total_due), 2) AS revenue "
            "FROM sales_order_header "
            "GROUP BY mese "
            "ORDER BY mese"
        ),
        "keywords": [
            "revenue mensile",
            "fatturato mensile",
            "monthly revenue",
            "revenue per mese",
            "vendite mensili",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Active customers ──────────────────────────────────────────────────────
    {
        "name": "Clienti attivi",
        "description": "Numero di clienti attivi (accountId > 0 e isActive = 1)",
        "sql_query": (
            "SELECT COUNT(*) AS active_customers "
            "FROM account "
            "WHERE accountId > 0 AND isActive = 1"
        ),
        "keywords": [
            "clienti attivi",
            "active customers",
            "quanti clienti attivi",
            "how many active customers",
            "clienti isActive",
        ],
        "sources": ["account"],
    },
    # ── Products by category ──────────────────────────────────────────────────
    {
        "name": "Prodotti per categoria",
        "description": "Numero di prodotti per categoria nel catalogo PIM",
        "sql_query": (
            "SELECT categoryPath, COUNT(*) AS cnt "
            "FROM product_catalog_pim "
            "GROUP BY categoryPath "
            "ORDER BY cnt DESC"
        ),
        "keywords": [
            "prodotti per categoria",
            "products by category",
            "categorie prodotto",
            "product categories",
            "quanti prodotti per categoria",
        ],
        "sources": ["product_catalog_pim"],
    },
    # ── Average order value ───────────────────────────────────────────────────
    {
        "name": "Valore medio ordine",
        "description": "Valore medio di un ordine di vendita",
        "sql_query": (
            "SELECT ROUND(AVG(total_due), 2) AS avg_order_value FROM sales_order_header"
        ),
        "keywords": [
            "valore medio ordine",
            "average order value",
            "aov",
            "media ordine",
            "avg order",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Orders per customer ───────────────────────────────────────────────────
    {
        "name": "Ordini per cliente",
        "description": "Numero di ordini per cliente, ordinati per volume decrescente",
        "sql_query": (
            "SELECT customer_ref, COUNT(*) AS n_orders, "
            "ROUND(SUM(total_due), 2) AS total_spend "
            "FROM sales_order_header "
            "GROUP BY customer_ref "
            "ORDER BY n_orders DESC "
            "LIMIT {limit}"
        ),
        "keywords": [
            "ordini per cliente",
            "orders per customer",
            "quanti ordini per cliente",
            "customer order count",
        ],
        "sources": ["sales_order_header"],
    },
    # ── Product catalog overview ──────────────────────────────────────────────
    {
        "name": "Catalogo prodotti",
        "description": "Lista prodotti con prezzo e costo dal catalogo PIM",
        "sql_query": (
            "SELECT displayName, listPrice, standardCost, categoryPath, isMakeOnly "
            "FROM product_catalog_pim "
            "ORDER BY displayName "
            "LIMIT {limit}"
        ),
        "keywords": [
            "catalogo prodotti",
            "product catalog",
            "lista prodotti",
            "product list",
            "tutti i prodotti",
            "all products",
        ],
        "sources": ["product_catalog_pim"],
    },
    # ── All territories ───────────────────────────────────────────────────────
    {
        "name": "Lista territori di vendita",
        "description": "Elenco di tutti i territori di vendita",
        "sql_query": (
            "SELECT territory_id, territory_name FROM territory ORDER BY territory_name"
        ),
        "keywords": [
            "territori vendita",
            "sales territories",
            "lista territori",
            "all territories",
            "territory list",
        ],
        "sources": ["territory"],
    },
    # ── Salesperson quota list ────────────────────────────────────────────────
    {
        "name": "Quote venditori",
        "description": "Lista venditori con le rispettive quote di vendita",
        "sql_query": (
            "SELECT salesperson_id, sales_quota, sales_ytd "
            "FROM salesperson "
            "ORDER BY sales_quota DESC"
        ),
        "keywords": [
            "quote venditori",
            "salesperson quota",
            "quota vendite",
            "sales quota list",
            "target venditori",
        ],
        "sources": ["salesperson"],
    },
]
