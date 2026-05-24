# Golden Questions — test set per il Semantic Layer

25 domande di test ordinate per difficoltà crescente. Per ognuna è indicato
**cosa stai veramente testando** del tuo layer e **quali fonti dovrebbero essere toccate**.

Tieni a portata la "verità" (calcolabile via SQL direttamente sui dump) e poi confronta
con la risposta che il layer + un agente producono.

---

## 🟢 Livello 1 — Single source, semantica diretta (5 domande)

**Q1.** *Quanti dipendenti lavorano nel reparto "Engineering"?*  
→ solo HR. Test: il layer mappa "reparto" → `Reparto` (campo italiano).

**Q2.** *Qual è il prezzo di listino della mountain bike "Mountain-200 Black, 38"?*  
→ solo PIM. Test: matching su `displayName`.

**Q3.** *Quanti ordini abbiamo nel sistema?*  
→ solo ERP. Test: il layer sa cosa è "ordine" → `sales_order_header`, **non** `sales_order_line`.

**Q4.** *Elenco delle aziende clienti (B2B) attive.*  
→ solo CRM. Test: filtra `accountType='B2B'` e `isActive=1`, ma deve anche **dedurre** dai duplicati.

**Q5.** *Qual è la retribuzione oraria media nel reparto Production?*  
→ solo HR. Test: gestione campo italiano + media con nulli.

---

## 🟡 Livello 2 — Join cross-fonte semplice (8 domande)

**Q6.** *Chi è il venditore che ha gestito più ordini nel 2014?*  
→ ERP (count ordini per `salesperson_ref`) **+** HR (per recuperare nome/cognome da `MatricolaDip`).  
Test: il layer sa che `salesperson_ref` ≡ `MatricolaDip`.

**Q7.** *Qual è il fatturato totale per territorio nel 2014?*  
→ ERP. Test: il layer disambigua "fatturato" → somma di `total_due` (non `subtotal_amount`!), e sa che "2014" significa `EXTRACT(YEAR FROM order_date)`.

**Q8.** *Qual è il cliente che ha speso di più in assoluto?*  
→ ERP (`SUM(total_due) GROUP BY customer_ref`) **+** CRM (per recuperare il nome).  
Test: cross-fonte ERP→CRM.

**Q9.** *Top 5 prodotti più venduti per quantità.*  
→ ERP (`SUM(qty) FROM sales_order_line GROUP BY product_ref`) **+** PIM (per il `displayName`).  
Test: cross-fonte ERP→PIM, e gestione chiavi (`product_ref` ≡ `internal_id`).

**Q10.** *In quale stato/provincia abita il cliente con maggior numero di ordini?*  
→ ERP **+** CRM (`account` → `account_address` → `address` → `state_province`).  
Test: 4 join tutti nel CRM più 1 cross-fonte verso l'ERP.

**Q11.** *Quanti dipendenti ci sono per gruppo di reparto?*  
→ solo HR. Test: comprende `GruppoReparto` come dimensione di aggregazione.

**Q12.** *Quanti prodotti sono "make only" (prodotti internamente)?*  
→ solo PIM. Test: il layer capisce il flag `isMakeOnly`.

**Q13.** *Quali clienti hanno indirizzo in California?*  
→ solo CRM. Test: doppio join con state_province.

---

## 🟠 Livello 3 — Join multi-fonte + filtri contestuali (7 domande)

**Q14.** *Top 3 venditori per fatturato 2014 con il loro reparto di appartenenza.*  
→ ERP (fatturato per venditore) **+** HR (reparto). Test: il layer sa che il venditore è prima un *dipendente*.

**Q15.** *Per ogni venditore, qual è il margine commerciale 2014?*  
→ ERP (ricavi da `sales_order_detail`) **+** PIM (`standardCost` per calcolare il costo).  
Test: il layer sa cos'è "margine" (ricavi − costi) e fa join `product_ref` ↔ `internal_id`.

**Q16.** *Qual è il fatturato medio per cliente B2B vs B2C?*  
→ ERP (ordini) **+** CRM (segmentazione B2B/B2C).  
Test: doppio cross-fonte e segmentazione semantica.

**Q17.** *Per ogni territorio, qual è il fatturato vs la quota assegnata al venditore di quel territorio?*  
→ ERP (`sales_order_header` aggregato + `salesperson.sales_quota`).  
Test: il layer comprende il concetto di "raggiungimento quota".

**Q18.** *Qual è la categoria di prodotti con il margine percentuale più alto?*  
→ ERP **+** PIM. Test: serve il `categoryPath` (gerarchia), calcolo del margine, e ordinamento per %.

**Q19.** *Quanti ordini hanno applicato uno sconto da offerta speciale?*  
→ solo ERP. Test: filtra `offer_ref != 1` (1 = nessuna offerta in AdventureWorks).

**Q20.** *Quanti clienti unici abbiamo, considerando i duplicati?*  
→ solo CRM. Test cruciale: il layer riconosce che gli account con ID negativi sono duplicati e li deduplica (per email + nome normalizzato).

---

## 🔴 Livello 4 — Ambiguità, governance, edge case (5 domande)

**Q21.** *Qual è il "fatturato" del 2014?*  
→ Test ambiguità: il layer dovrebbe disambiguare:
- subtotal_amount (= ricavi puri)
- total_due (= ricavi + tasse + spedizione)
- aggregato di sales_order_line.line_total
Dovrebbe **chiedere** quale definizione usare, o restituire più valori con spiegazione.

**Q22.** *Mostrami il dipendente "Mary".*  
→ Test ambiguità: ci sono più "Mary" in HR e in CRM. Il layer chiede di specificare, o restituisce lista con disambiguazione.

**Q23.** *Da quale fonte arriva il dato del fatturato cliente XYZ, e quando è stato aggiornato l'ultima volta?*  
→ Test **metadata/governance**: il layer espone provenienza, freschezza.

**Q24.** *Cliente "Adventure Works Cycles" — ha più di un account?*  
→ Test deduplica: il layer trova i duplicati in CRM e segnala l'ambiguità invece di restituire un singolo record.

**Q25.** *Calcola il fatturato annualizzato del top venditore italiano (assumendo residenza ITA).*  
→ Test impossibile sintatticamente con questi dati (in AdventureWorks non c'è un campo "nazionalità dipendente").  
Il layer dovrebbe **dire** che il dato non è disponibile invece di inventarsi una risposta.

---

## Come strutturare la valutazione

Per ogni domanda, registra:

| Campo | Esempio |
|---|---|
| `domanda_id` | Q14 |
| `livello` | 3 |
| `verita_ground_truth` | calcolata via SQL diretto |
| `risposta_layer` | output del tuo semantic layer |
| `tempo_ms` | latenza |
| `n_chiamate_fonti` | ERP=1, HR=1 |
| `metadata_restituiti` | provenance? freschezza? definizione? |
| `corretto` | sì/no/parziale |
| `ambiguita_gestita` | sì/no/non_applicabile |
| `note` | osservazioni qualitative |

**Metriche di sintesi consigliate:**
- Accuracy per livello (1→4)
- % di domande ambigue dove il layer ha chiesto chiarimento (invece di indovinare)
- % di risposte con metadata di provenienza
- Tempo medio per livello

Una soglia "il layer funziona" ragionevole su uno scenario come questo è:
- Livello 1: 100%
- Livello 2: ≥90%
- Livello 3: ≥75%
- Livello 4: ≥60% **+** gestione esplicita dell'ambiguità nel 100% dei casi
