"""
SQLite mock ERP database with realistic Italian manufacturing data.
Generation is idempotent: skips creation if the DB already exists and is
populated.
"""
import os
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
"""

# ── Seed data helpers ──────────────────────────────────────────────────────────

SECTORS = [
    "Automotive", "Aerospace", "Meccanica di Precisione", "Elettronica",
    "Impianti Industriali", "Packaging", "Energia", "Ferroviario",
]

CATEGORIES = [
    "Componenti Meccanici", "Elettronica Industriale", "Materiali Grezzi",
    "Semilavorati", "Attrezzature", "Consumabili",
]

UOM = ["pz", "kg", "m", "m²", "l", "set"]

PRODUCT_NAMES = [
    "Flangia DN100 PN16", "Valvola a sfera 2\"", "Cuscinetto SKF 6205",
    "Piastra in acciaio inox 304", "Cilindro idraulico 50/200",
    "Sensore di pressione 0-10bar", "Guarnizione PTFE 3mm",
    "Profilo alluminio 40x40 L=3m", "Motore brushless 400W",
    "Riduttore epicicloidale i=10", "Inverter trifase 7.5kW",
    "Connettore M12 8 poli", "Tubo flessibile DN25 L=1m",
    "Staffa di fissaggio tipo A", "Morsetto DIN 3x2.5mm²",
    "Interruttore magnetotermico 16A", "Encoder incrementale 1024ppr",
    "Cavo schermato 4x0.75mm²", "Pompa centrifuga 50l/min",
    "Filtro aria G4 500x500", "Vite TCEI M8x30 A2",
    "Dado autobloccante M10 A2", "Rondella piana M12 acciaio",
    "Ruota dentata modulo 2 Z=40", "Cinghia dentata T10-1000",
    "Attuatore pneumatico 63mm", "PLC Siemens S7-1200",
    "Pannello HMI 7 pollici", "Cella di carico 500kg",
    "Termoresistenza PT100 classe A",
]

STATUSES_QUOTE = ["draft", "sent", "accepted", "rejected", "expired"]
STATUSES_ORDER = ["confirmed", "in_production", "shipped", "delivered", "cancelled"]

WEIGHTS_QUOTE = [0.10, 0.25, 0.35, 0.15, 0.15]
WEIGHTS_ORDER = [0.10, 0.20, 0.20, 0.40, 0.10]

AGENTS = [
    "Marco Rossi", "Giulia Ferrari", "Luca Bianchi",
    "Sara Conti", "Andrea Russo",
]


def _random_date(start_days_ago: int, end_days_ago: int = 0) -> str:
    today = date.today()
    delta = random.randint(end_days_ago, start_days_ago)
    return (today - timedelta(days=delta)).isoformat()


# ── Public API ─────────────────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create schema and populate with mock data if the DB is empty."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        conn.commit()

        # Idempotency check
        count = conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0]
        if count > 0:
            return

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


def _seed_quotes(conn: sqlite3.Connection, customer_ids: list, product_ids: list) -> None:
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

        quote_total = round(sum(l[4] for l in lines), 2)

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


def get_table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = ["customers", "products", "quotes", "quote_lines", "orders", "order_lines"]
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
