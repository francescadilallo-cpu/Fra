# Fra Semantic Layer — Eval Report

| Q | Level | Outcome | Latency (ms) | Sources | Metadata | Disamb | Notes |
|---|-------|---------|-------------|---------|---------|--------|-------|
| Q1 | 1 | ok | 53.8 | hr_pim | True | False |  |
| Q2 | 1 | ok | 22.0 | hr_pim | True | False |  |
| Q3 | 1 | ok | 1.0 | erp | True | False |  |
| Q4 | 1 | ok | 4.5 | crm | True | False |  |
| Q5 | 1 | ok | 21.9 | hr_pim | True | False |  |
| Q6 | 2 | ok | 30.1 | erp,hr_pim | True | False |  |
| Q7 | 2 | ok | 12.5 | erp | True | False |  |
| Q8 | 2 | ok | 19.5 | erp,crm | True | False |  |
| Q9 | 2 | ok | 140.6 | erp,hr_pim | True | False |  |
| Q10 | 2 | ok | 1.0 | crm | True | False |  |
| Q11 | 2 | ok | 23.4 | hr_pim | True | False |  |
| Q12 | 2 | ok | 21.9 | hr_pim | True | False |  |
| Q13 | 2 | ok | 9.3 | crm | True | False |  |
| Q14 | 3 | ok | 70.6 | erp,hr_pim | True | False |  |
| Q15 | 3 | ok | 94.7 | erp,hr_pim | True | False |  |
| Q16 | 3 | ok | 58.0 | erp,crm | True | False |  |
| Q17 | 3 | ok | 3.9 | erp | True | False |  |
| Q18 | 3 | ok | 61.4 | erp,hr_pim | True | False |  |
| Q19 | 3 | ok | 6.3 | erp | True | False |  |
| Q20 | 3 | ok | 1.6 | crm | True | False |  |
| Q21 | 4 | ambiguity | 0.0 |  | False | True | ['revenue (~subtotal_amount)', 'revenue_with_tax (~total_due)'] |
| Q22 | 4 | disambiguation | 22.8 | hr_pim | True | True | ['Mary Dempsey (matricola 19, Marketing)', 'Mary Gibson (matricola 23, Marketing)', 'Mary Baker (matricola 104, Producti |
| Q23 | 4 | ok | 3.4 | Customer,Employee,Product,SalesOrder,SalesOrderLine,Salesperson,Territory | True | False |  |
| Q24 | 4 | ok | 4.7 | crm | True | False |  |
| Q25 | 4 | no_data | 0.0 |  | False | False | Il campo 'nazionalità dipendente' non è disponibile in nessuna delle fonti dati (ERP, CRM, HR/PIM). AdventureWorks non c |

**Total: 25 questions**
- ✅ ok: 22
- ⚠️ ambiguity (correctly raised): 1
- 🔀 disambiguation: 1
- ℹ️ no_data (impossible): 1
- ❌ error: 0