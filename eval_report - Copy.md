# Fra Semantic Layer — Eval Report

| Q | Level | Outcome | Latency (ms) | Sources | Metadata | Disamb | Notes |
|---|-------|---------|-------------|---------|---------|--------|-------|
| Q1 | 1 | ok | 68.7 | hr_pim | True | False |  |
| Q2 | 1 | ok | 25.9 | hr_pim | True | False |  |
| Q3 | 1 | ok | 1.3 | erp | True | False |  |
| Q4 | 1 | ok | 5.8 | crm | True | False |  |
| Q5 | 1 | ok | 26.3 | hr_pim | True | False |  |
| Q6 | 2 | ok | 37.5 | erp,hr_pim | True | False |  |
| Q7 | 2 | ok | 17.5 | erp | True | False |  |
| Q8 | 2 | ok | 34.3 | erp,crm | True | False |  |
| Q9 | 2 | ok | 207.7 | erp,hr_pim | True | False |  |
| Q10 | 2 | ok | 1.2 | crm | True | False |  |
| Q11 | 2 | ok | 27.6 | hr_pim | True | False |  |
| Q12 | 2 | ok | 25.5 | hr_pim | True | False |  |
| Q13 | 2 | ok | 12.1 | crm | True | False |  |
| Q14 | 3 | ok | 102.8 | erp,hr_pim | True | False |  |
| Q15 | 3 | ok | 130.5 | erp,hr_pim | True | False |  |
| Q16 | 3 | ok | 73.6 | erp,crm | True | False |  |
| Q17 | 3 | ok | 5.5 | erp | True | False |  |
| Q18 | 3 | ok | 79.9 | erp,hr_pim | True | False |  |
| Q19 | 3 | ok | 10.1 | erp | True | False |  |
| Q20 | 3 | ok | 2.0 | crm | True | False |  |
| Q21 | 4 | ambiguity | 0.0 |  | False | True | ['revenue (~subtotal_amount)', 'revenue_with_tax (~total_due)'] |
| Q22 | 4 | disambiguation | 28.3 | hr_pim | True | True | ['Mary Dempsey (matricola 19, Marketing)', 'Mary Gibson (matricola 23, Marketing)', 'Mary Baker (matricola 104, Producti |
| Q23 | 4 | ok | 4.2 | Customer,Employee,Product,SalesOrder,SalesOrderLine,Salesperson,Territory | True | False |  |
| Q24 | 4 | ok | 5.9 | crm | True | False |  |
| Q25 | 4 | no_data | 0.0 |  | False | False | Il campo 'nazionalità dipendente' non è disponibile in nessuna delle fonti dati (ERP, CRM, HR/PIM). AdventureWorks non c |

**Total: 25 questions**
- ✅ ok: 22
- ⚠️ ambiguity (correctly raised): 1
- 🔀 disambiguation: 1
- ℹ️ no_data (impossible): 1
- ❌ error: 0