"""
ground_truth.py — Calcola le risposte vere a alcune domande chiave delle
golden questions, lavorando direttamente sui dati distribuiti sulle 3 fonti.

Carica tutto in memoria via pandas/sqlite per semplicità.
"""

import json
import re
import sqlite3
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
ERP_SQL = ROOT / "erp_postgres/orion_sales_dump.sql"
CRM_DB = ROOT / "crm_sqlite/clienthub.db"
HR_CSV = ROOT / "hr_pim_files/dipendenti_hr.csv"
PIM_JSON = ROOT / "hr_pim_files/product_catalog_pim.json"


# ─── carico l'ERP in SQLite in memoria ──────────────────────────────────────
def load_erp_to_memory():
    """Parsea il dump SQL ERP e carica le INSERT in un SQLite in memoria."""
    text = ERP_SQL.read_text(encoding="utf-8")
    mem = sqlite3.connect(":memory:")
    cur = mem.cursor()

    # Estrai le CREATE TABLE — il dump è in PostgreSQL ma le sintassi base sono compatibili
    create_pattern = re.compile(
        r"CREATE TABLE\s+(\w+)\s*\((.*?)\);", re.DOTALL | re.IGNORECASE
    )
    for m in create_pattern.finditer(text):
        tname = m.group(1)
        body = m.group(2)
        # rimuovi i tipi specifici Postgres che SQLite non gradisce
        body_sqlite = re.sub(r"NUMERIC\(\d+,\d+\)", "REAL", body, flags=re.IGNORECASE)
        body_sqlite = re.sub(r"CHAR\(\d+\)", "TEXT", body_sqlite, flags=re.IGNORECASE)
        body_sqlite = re.sub(r"VARCHAR\(\d+\)", "TEXT", body_sqlite, flags=re.IGNORECASE)
        body_sqlite = re.sub(r"DEFAULT\s+'[^']*'", "", body_sqlite, flags=re.IGNORECASE)
        cur.execute(f"CREATE TABLE {tname} ({body_sqlite})")

    # Esegui le INSERT (sono compatibili SQLite)
    for line in text.split("\n"):
        if line.startswith("INSERT INTO"):
            try:
                cur.execute(line.rstrip(";"))
            except Exception as e:
                # qualche riga può fallire per via di NULL/quoting; le saltiamo
                pass
    mem.commit()
    return mem


print("⏳ Caricamento ERP in memoria…")
erp = load_erp_to_memory()
crm = sqlite3.connect(str(CRM_DB))

# HR in pandas (separatore ;)
hr = pd.read_csv(HR_CSV, sep=";")
# PIM in pandas
pim_data = json.loads(PIM_JSON.read_text(encoding="utf-8"))
pim = pd.DataFrame(pim_data["products"])

print(f"✅ ERP: {erp.execute('SELECT COUNT(*) FROM sales_order_header').fetchone()[0]} ordini")
print(f"✅ CRM: {crm.execute('SELECT COUNT(*) FROM account').fetchone()[0]} account")
print(f"✅ HR : {len(hr)} dipendenti")
print(f"✅ PIM: {len(pim)} prodotti")
print()

# ─── Q1: dipendenti in Engineering ──────────────────────────────────────────
q1 = (hr["Reparto"] == "Engineering").sum()
print(f"Q1 — Dipendenti in Engineering: {q1}")

# ─── Q3: numero ordini totale ───────────────────────────────────────────────
q3 = erp.execute("SELECT COUNT(*) FROM sales_order_header").fetchone()[0]
print(f"Q3 — Totale ordini: {q3}")

# ─── Q4: aziende B2B attive nel CRM (con deduplica per ragione sociale) ─────
q4 = crm.execute("""
    SELECT COUNT(DISTINCT ragioneSociale) FROM account
    WHERE accountType='B2B' AND isActive=1 AND ragioneSociale IS NOT NULL AND ragioneSociale != ''
""").fetchone()[0]
print(f"Q4 — Aziende B2B uniche attive: {q4}")

# ─── Q6: venditore con più ordini nel 2014 ──────────────────────────────────
top_seller = erp.execute("""
    SELECT salesperson_ref, COUNT(*) as n
    FROM sales_order_header
    WHERE strftime('%Y', order_date) = '2014'
      AND salesperson_ref IS NOT NULL
    GROUP BY salesperson_ref
    ORDER BY n DESC LIMIT 1
""").fetchone()
if top_seller:
    sid, n = top_seller
    name = hr[hr["MatricolaDip"] == sid][["Nome", "Cognome"]].values
    nome_completo = " ".join(name[0]) if len(name) else "?"
    print(f"Q6 — Top venditore 2014: matricola={sid} ({nome_completo}) con {n} ordini")

# ─── Q7: fatturato totale per territorio 2014 (top 5) ───────────────────────
print(f"\nQ7 — Fatturato 2014 per territorio (top 5):")
for row in erp.execute("""
    SELECT t.territory_name, ROUND(SUM(h.total_due), 2) as fatturato
    FROM sales_order_header h JOIN territory t ON h.territory_ref = t.territory_id
    WHERE strftime('%Y', h.order_date) = '2014'
    GROUP BY t.territory_name
    ORDER BY fatturato DESC LIMIT 5
"""):
    print(f"  - {row[0]}: ${row[1]:,.2f}")

# ─── Q8: cliente che ha speso di più ────────────────────────────────────────
top_cust = erp.execute("""
    SELECT customer_ref, ROUND(SUM(total_due), 2) as spesa
    FROM sales_order_header
    GROUP BY customer_ref ORDER BY spesa DESC LIMIT 1
""").fetchone()
cid, spesa = top_cust
cust_info = crm.execute(
    "SELECT accountType, ragioneSociale, nomeContatto FROM account WHERE accountId=?", (cid,)
).fetchone()
print(f"\nQ8 — Top cliente: ID={cid}, spesa=${spesa:,.2f}, tipo={cust_info[0]}, nome='{cust_info[1] or cust_info[2]}'")

# ─── Q9: top 5 prodotti per quantità ────────────────────────────────────────
print(f"\nQ9 — Top 5 prodotti per quantità venduta:")
top_prods = erp.execute("""
    SELECT product_ref, SUM(qty) as qty_totale
    FROM sales_order_line
    GROUP BY product_ref ORDER BY qty_totale DESC LIMIT 5
""").fetchall()
for pid, qty in top_prods:
    name_row = pim[pim["internal_id"] == pid]["displayName"]
    name = name_row.values[0] if len(name_row) else "?"
    print(f"  - {name} (PIM id={pid}): {qty} pezzi")

# ─── Q20: numero clienti unici dopo deduplica ───────────────────────────────
total = crm.execute("SELECT COUNT(*) FROM account").fetchone()[0]
duplicates = crm.execute("SELECT COUNT(*) FROM account WHERE accountId < 0").fetchone()[0]
unique = total - duplicates
print(f"\nQ20 — Clienti unici dopo deduplica: {unique} (totale: {total}, duplicati: {duplicates})")

# ─── Q21: ambiguità "fatturato" 2014 ────────────────────────────────────────
subtot, totdue = erp.execute("""
    SELECT ROUND(SUM(subtotal_amount), 2), ROUND(SUM(total_due), 2)
    FROM sales_order_header
    WHERE strftime('%Y', order_date) = '2014'
""").fetchone()
print(f"\nQ21 — 'Fatturato' 2014 (ambiguo):")
print(f"  - subtotal (ricavi puri): ${subtot:,.2f}")
print(f"  - total_due (con tasse+spedizione): ${totdue:,.2f}")

print("\n✅ Ground truth calcolata. Usa questi numeri per validare il tuo Semantic Layer.")
