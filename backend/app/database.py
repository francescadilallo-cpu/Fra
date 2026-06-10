"""
SQLite mock ERP database with realistic Italian manufacturing data.
Generation is idempotent: skips creation if the DB already exists and is
populated.
"""

import json
import sqlite3
import random
from pathlib import Path
from datetime import date, timedelta

from faker import Faker

DB_PATH = Path(__file__).parent.parent / "data" / "erp_mock.db"

fake = Faker("it_IT")
random.seed(42)
Faker.seed(42)

# ── Schema ─────────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    sector        TEXT NOT NULL,
    country       TEXT NOT NULL DEFAULT 'IT',
    vat_number    TEXT NOT NULL,
    credit_limit  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sku             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    unit_price      REAL NOT NULL,
    unit_of_measure TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id  INTEGER NOT NULL REFERENCES customers(id),
    date         TEXT NOT NULL,
    status       TEXT NOT NULL CHECK(status IN ('draft','sent','accepted','rejected','expired')),
    total_value  REAL NOT NULL,
    valid_until  TEXT NOT NULL,
    created_by   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id    INTEGER NOT NULL REFERENCES quotes(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    quantity    REAL NOT NULL,
    unit_price  REAL NOT NULL,
    discount_pct REAL NOT NULL DEFAULT 0,
    line_total  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id      INTEGER REFERENCES quotes(id),
    customer_id   INTEGER NOT NULL REFERENCES customers(id),
    date          TEXT NOT NULL,
    status        TEXT NOT NULL CHECK(status IN ('confirmed','in_production','shipped','delivered','cancelled')),
    delivery_date TEXT NOT NULL,
    total_value   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS order_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    INTEGER NOT NULL REFERENCES orders(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    quantity    REAL NOT NULL,
    unit_price  REAL NOT NULL,
    line_total  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sl_metrics (
    id TEXT PRIMARY KEY,
    sector_id TEXT NOT NULL DEFAULT 'manufacturing',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'sum',
    entity TEXT NOT NULL DEFAULT '',
    field TEXT DEFAULT '',
    numerator TEXT DEFAULT '',
    denominator TEXT DEFAULT '',
    expression TEXT DEFAULT '',
    filters_json TEXT DEFAULT '[]',
    time_dimension TEXT DEFAULT '',
    grains_json TEXT DEFAULT '["month","quarter","year"]',
    format TEXT DEFAULT 'number',
    status TEXT DEFAULT 'draft',
    owner TEXT DEFAULT '',
    tags_json TEXT DEFAULT '[]',
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sl_hierarchies (
    id TEXT PRIMARY KEY,
    sector_id TEXT NOT NULL DEFAULT 'manufacturing',
    name TEXT NOT NULL,
    entity TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'categorical',
    levels_json TEXT DEFAULT '[]',
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sl_segments (
    id TEXT PRIMARY KEY,
    sector_id TEXT NOT NULL DEFAULT 'manufacturing',
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    entity TEXT NOT NULL DEFAULT '',
    conditions_json TEXT DEFAULT '[]',
    tags_json TEXT DEFAULT '[]',
    used_by_json TEXT DEFAULT '[]',
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sl_metrics_sector ON sl_metrics(sector_id, is_builtin);
CREATE INDEX IF NOT EXISTS idx_sl_hierarchies_sector ON sl_hierarchies(sector_id, is_builtin);
CREATE INDEX IF NOT EXISTS idx_sl_segments_sector ON sl_segments(sector_id, is_builtin);
"""

# ── Seed data helpers ──────────────────────────────────────────────────────────

SECTORS = [
    "Automotive",
    "Aerospace",
    "Meccanica di Precisione",
    "Elettronica",
    "Impianti Industriali",
    "Packaging",
    "Energia",
    "Ferroviario",
]

CATEGORIES = [
    "Componenti Meccanici",
    "Elettronica Industriale",
    "Materiali Grezzi",
    "Semilavorati",
    "Attrezzature",
    "Consumabili",
]

UOM = ["pz", "kg", "m", "m²", "l", "set"]

PRODUCT_NAMES = [
    "Flangia DN100 PN16",
    'Valvola a sfera 2"',
    "Cuscinetto SKF 6205",
    "Piastra in acciaio inox 304",
    "Cilindro idraulico 50/200",
    "Sensore di pressione 0-10bar",
    "Guarnizione PTFE 3mm",
    "Profilo alluminio 40x40 L=3m",
    "Motore brushless 400W",
    "Riduttore epicicloidale i=10",
    "Inverter trifase 7.5kW",
    "Connettore M12 8 poli",
    "Tubo flessibile DN25 L=1m",
    "Staffa di fissaggio tipo A",
    "Morsetto DIN 3x2.5mm²",
    "Interruttore magnetotermico 16A",
    "Encoder incrementale 1024ppr",
    "Cavo schermato 4x0.75mm²",
    "Pompa centrifuga 50l/min",
    "Filtro aria G4 500x500",
    "Vite TCEI M8x30 A2",
    "Dado autobloccante M10 A2",
    "Rondella piana M12 acciaio",
    "Ruota dentata modulo 2 Z=40",
    "Cinghia dentata T10-1000",
    "Attuatore pneumatico 63mm",
    "PLC Siemens S7-1200",
    "Pannello HMI 7 pollici",
    "Cella di carico 500kg",
    "Termoresistenza PT100 classe A",
]

STATUSES_QUOTE = ["draft", "sent", "accepted", "rejected", "expired"]
STATUSES_ORDER = ["confirmed", "in_production", "shipped", "delivered", "cancelled"]

WEIGHTS_QUOTE = [0.10, 0.25, 0.35, 0.15, 0.15]
WEIGHTS_ORDER = [0.10, 0.20, 0.20, 0.40, 0.10]

AGENTS = [
    "Marco Rossi",
    "Giulia Ferrari",
    "Luca Bianchi",
    "Sara Conti",
    "Andrea Russo",
]


def _random_date(start_days_ago: int, end_days_ago: int = 0) -> str:
    today = date.today()
    delta = random.randint(end_days_ago, start_days_ago)
    return (today - timedelta(days=delta)).isoformat()


# ── Public API ─────────────────────────────────────────────────────────────────


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    # WAL mode: concurrent readers don't block a writer, and a writer doesn't
    # block readers. Critical under FastAPI's multi-threaded request handling.
    conn.execute("PRAGMA journal_mode = WAL")
    # NORMAL is crash-safe (data survives OS crash) and much faster than FULL.
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    # Wait up to 5 s instead of raising "database is locked" immediately.
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db() -> None:
    """Create schema and populate with mock data if the DB is empty."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        conn.commit()

        # Idempotency check for mock data only
        count = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        if count == 0:
            _seed_customers(conn)
            _seed_products(conn)
            customer_ids = [r[0] for r in conn.execute("SELECT id FROM customers")]
            product_ids = [r[0] for r in conn.execute("SELECT id FROM products")]
            _seed_quotes(conn, customer_ids, product_ids)
            quote_rows = conn.execute(
                "SELECT id, customer_id, total_value FROM quotes WHERE status='accepted'"
            ).fetchall()
            _seed_orders(conn, quote_rows, product_ids)
            conn.commit()

        # Always seed semantic definitions (idempotent per-row checks inside)
        _seed_semantic_definitions(conn)
        conn.commit()
    finally:
        conn.close()


def _seed_customers(conn: sqlite3.Connection) -> None:
    for _ in range(20):
        name = fake.company()
        conn.execute(
            "INSERT INTO customers (name, sector, country, vat_number, credit_limit) VALUES (?,?,?,?,?)",
            (
                name,
                random.choice(SECTORS),
                "IT",
                f"IT{fake.numerify('###########')}",
                round(random.uniform(50_000, 500_000), 2),
            ),
        )


def _seed_products(conn: sqlite3.Connection) -> None:
    for i, pname in enumerate(PRODUCT_NAMES):
        sku = f"SKU-{1000 + i}"
        price = round(random.uniform(5, 2500), 2)
        conn.execute(
            "INSERT INTO products (sku, name, category, unit_price, unit_of_measure) VALUES (?,?,?,?,?)",
            (sku, pname, random.choice(CATEGORIES), price, random.choice(UOM)),
        )


def _seed_quotes(
    conn: sqlite3.Connection, customer_ids: list, product_ids: list
) -> None:
    for _ in range(50):
        cid = random.choice(customer_ids)
        q_date = _random_date(180, 0)
        valid_until = (
            date.fromisoformat(q_date) + timedelta(days=random.randint(30, 90))
        ).isoformat()
        status = random.choices(STATUSES_QUOTE, weights=WEIGHTS_QUOTE)[0]

        # Determine quote total from lines
        lines = []
        for _ in range(random.randint(1, 5)):
            pid = random.choice(product_ids)
            qty = round(random.uniform(1, 50), 2)
            price = conn.execute(
                "SELECT unit_price FROM products WHERE id=?", (pid,)
            ).fetchone()[0]
            disc = round(random.uniform(0, 20), 2)
            total = round(qty * price * (1 - disc / 100), 2)
            lines.append((pid, qty, price, disc, total))

        quote_total = round(sum(row[4] for row in lines), 2)

        cursor = conn.execute(
            "INSERT INTO quotes (customer_id, date, status, total_value, valid_until, created_by) VALUES (?,?,?,?,?,?)",
            (cid, q_date, status, quote_total, valid_until, random.choice(AGENTS)),
        )
        qid = cursor.lastrowid

        for pid, qty, price, disc, total in lines:
            conn.execute(
                "INSERT INTO quote_lines (quote_id, product_id, quantity, unit_price, discount_pct, line_total) VALUES (?,?,?,?,?,?)",
                (qid, pid, qty, price, disc, total),
            )


def _seed_orders(conn: sqlite3.Connection, quote_rows: list, product_ids: list) -> None:
    # Create orders from accepted quotes (up to 40)
    selected = quote_rows[: min(40, len(quote_rows))]
    for row in selected:
        qid, cid, quote_value = row[0], row[1], row[2]
        o_date = _random_date(90, 0)
        delivery_date = (
            date.fromisoformat(o_date) + timedelta(days=random.randint(14, 60))
        ).isoformat()
        status = random.choices(STATUSES_ORDER, weights=WEIGHTS_ORDER)[0]

        cursor = conn.execute(
            "INSERT INTO orders (quote_id, customer_id, date, status, delivery_date, total_value) VALUES (?,?,?,?,?,?)",
            (qid, cid, o_date, status, delivery_date, quote_value),
        )
        oid = cursor.lastrowid

        for _ in range(random.randint(1, 4)):
            pid = random.choice(product_ids)
            qty = round(random.uniform(1, 30), 2)
            price = conn.execute(
                "SELECT unit_price FROM products WHERE id=?", (pid,)
            ).fetchone()[0]
            total = round(qty * price, 2)
            conn.execute(
                "INSERT INTO order_lines (order_id, product_id, quantity, unit_price, line_total) VALUES (?,?,?,?,?)",
                (oid, pid, qty, price, total),
            )


def _seed_semantic_definitions(conn: sqlite3.Connection) -> None:
    """Insert built-in semantic definitions if they don't already exist."""

    # ── Metrics ──────────────────────────────────────────────────────────────
    metrics = [
        {
            "id": "revenue",
            "name": "Revenue",
            "description": "Net revenue — subtotal before tax and freight.",
            "type": "sum",
            "entity": "SalesOrder",
            "field": "subtotal_amount",
            "numerator": "",
            "denominator": "",
            "expression": "",
            "filters_json": "[]",
            "time_dimension": "",
            "grains_json": '["day","month","quarter","year"]',
            "format": "currency",
            "status": "verified",
            "owner": "Finance",
            "tags_json": '["sales","core"]',
        },
        {
            "id": "gross_revenue",
            "name": "Gross Revenue",
            "description": "Total billed including tax and freight.",
            "type": "sum",
            "entity": "SalesOrder",
            "field": "total_due",
            "numerator": "",
            "denominator": "",
            "expression": "",
            "filters_json": "[]",
            "time_dimension": "",
            "grains_json": '["day","month","quarter","year"]',
            "format": "currency",
            "status": "verified",
            "owner": "Finance",
            "tags_json": '["billing"]',
        },
        {
            "id": "order_count",
            "name": "Order Count",
            "description": "Number of sales orders placed.",
            "type": "count",
            "entity": "SalesOrder",
            "field": "order_id",
            "numerator": "",
            "denominator": "",
            "expression": "",
            "filters_json": "[]",
            "time_dimension": "",
            "grains_json": '["day","week","month","quarter","year"]',
            "format": "number",
            "status": "verified",
            "owner": "Sales",
            "tags_json": '["sales","core"]',
        },
        {
            "id": "aov",
            "name": "Avg Order Value",
            "description": "Average net revenue per order. Revenue ÷ Order Count.",
            "type": "ratio",
            "entity": "SalesOrder",
            "field": "",
            "numerator": "Revenue",
            "denominator": "Order Count",
            "expression": "",
            "filters_json": "[]",
            "time_dimension": "",
            "grains_json": '["month","quarter","year"]',
            "format": "currency",
            "status": "verified",
            "owner": "Sales",
            "tags_json": '["efficiency"]',
        },
        {
            "id": "unique_customers",
            "name": "Unique Customers",
            "description": "Count of distinct customers with at least one order.",
            "type": "count_distinct",
            "entity": "SalesOrder",
            "field": "customer_ref",
            "numerator": "",
            "denominator": "",
            "expression": "",
            "filters_json": "[]",
            "time_dimension": "",
            "grains_json": '["month","quarter","year"]',
            "format": "number",
            "status": "verified",
            "owner": "Sales",
            "tags_json": '["customers"]',
        },
    ]

    for m in metrics:
        existing = conn.execute(
            "SELECT id FROM sl_metrics WHERE id = ?", (m["id"],)
        ).fetchone()
        if existing is None:
            conn.execute(
                """INSERT INTO sl_metrics
                   (id, sector_id, name, description, type, entity, field,
                    numerator, denominator, expression, filters_json,
                    time_dimension, grains_json, format, status, owner,
                    tags_json, is_builtin)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
                (
                    m["id"],
                    "manufacturing",
                    m["name"],
                    m["description"],
                    m["type"],
                    m["entity"],
                    m["field"],
                    m["numerator"],
                    m["denominator"],
                    m["expression"],
                    m["filters_json"],
                    m["time_dimension"],
                    m["grains_json"],
                    m["format"],
                    m["status"],
                    m["owner"],
                    m["tags_json"],
                ),
            )

    # ── Hierarchies ───────────────────────────────────────────────────────────
    hierarchies = [
        {
            "id": "date",
            "name": "Date",
            "entity": "SalesOrder",
            "description": "Drill-down from year to day on order date.",
            "type": "time",
            "levels_json": json.dumps(
                [
                    {"name": "Year", "field": "YEAR(order_date)"},
                    {"name": "Quarter", "field": "QUARTER(order_date)"},
                    {"name": "Month", "field": "MONTH(order_date)"},
                    {"name": "Week", "field": "WEEK(order_date)"},
                    {"name": "Day", "field": "DATE(order_date)"},
                ]
            ),
        },
        {
            "id": "territory",
            "name": "Territory",
            "entity": "territory",
            "description": "Geographic drill-down.",
            "type": "categorical",
            "levels_json": json.dumps(
                [
                    {"name": "Group", "field": "region_group"},
                    {"name": "Territory", "field": "territory_name"},
                ]
            ),
        },
        {
            "id": "product",
            "name": "Product",
            "entity": "product",
            "description": "Product catalog drill-down.",
            "type": "categorical",
            "levels_json": json.dumps(
                [
                    {"name": "Category", "field": "category"},
                    {"name": "Name", "field": "name"},
                ]
            ),
        },
    ]

    for h in hierarchies:
        existing = conn.execute(
            "SELECT id FROM sl_hierarchies WHERE id = ?", (h["id"],)
        ).fetchone()
        if existing is None:
            conn.execute(
                """INSERT INTO sl_hierarchies
                   (id, sector_id, name, entity, description, type, levels_json, is_builtin)
                   VALUES (?,?,?,?,?,?,?,1)""",
                (
                    h["id"],
                    "manufacturing",
                    h["name"],
                    h["entity"],
                    h["description"],
                    h["type"],
                    h["levels_json"],
                ),
            )

    # ── Segments ──────────────────────────────────────────────────────────────
    segments = [
        {
            "id": "online",
            "name": "Online Orders",
            "description": "Self-service orders via e-commerce.",
            "entity": "SalesOrder",
            "conditions_json": json.dumps(
                [{"field": "online_order_flag", "operator": "=", "value": "1"}]
            ),
            "tags_json": '["channel","digital"]',
            "used_by_json": '["Order Count"]',
        },
        {
            "id": "high_value",
            "name": "High-Value Orders",
            "description": "Orders with net revenue ≥ $1,000.",
            "entity": "SalesOrder",
            "conditions_json": json.dumps(
                [{"field": "subtotal_amount", "operator": ">=", "value": "1000"}]
            ),
            "tags_json": '["tier"]',
            "used_by_json": '["Revenue"]',
        },
    ]

    for s in segments:
        existing = conn.execute(
            "SELECT id FROM sl_segments WHERE id = ?", (s["id"],)
        ).fetchone()
        if existing is None:
            conn.execute(
                """INSERT INTO sl_segments
                   (id, sector_id, name, description, entity,
                    conditions_json, tags_json, used_by_json, is_builtin)
                   VALUES (?,?,?,?,?,?,?,?,1)""",
                (
                    s["id"],
                    "manufacturing",
                    s["name"],
                    s["description"],
                    s["entity"],
                    s["conditions_json"],
                    s["tags_json"],
                    s["used_by_json"],
                ),
            )


def get_table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = ["customers", "products", "quotes", "quote_lines", "orders", "order_lines"]
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
