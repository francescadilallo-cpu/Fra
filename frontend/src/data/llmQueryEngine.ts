import type { EngineResult } from './queryEngine'

// ── Provider definitions ──────────────────────────────────────────────────────

export type LLMProvider = 'anthropic' | 'groq' | 'gemini'

export interface ProviderConfig {
  id: LLMProvider
  label: string
  free: boolean
  badge: string
  hint: string
  keyUrl: string
  keyPlaceholder: string
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'groq',
    label: 'Groq',
    free: true,
    badge: 'Gratuito · LLaMA 3.3 70b',
    hint: 'console.groq.com → API Keys',
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
  },
  {
    id: 'gemini',
    label: 'Google Gemini Flash',
    free: true,
    badge: 'Gratuito · 1M token/day',
    hint: 'aistudio.google.com → Get API Key',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza...',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    free: false,
    badge: 'A pagamento · Haiku $0.001/query',
    hint: 'console.anthropic.com → API Keys',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-api03-...',
  },
]

// ── AdventureWorks system prompt ──────────────────────────────────────────────

const AW_SYSTEM_PROMPT = `You are the Query AI engine for the AdventureWorks Semantic Intelligence platform.
You answer questions about AdventureWorks 2014 data, which spans 4 source systems connected by a semantic layer and Knowledge Graph.
You understand English and Italian.

## Data Sources

### 1. ERP OrionSales (PostgreSQL / DuckDB) — 153,225 rows
- SalesOrder(orderId, orderDate, shipDate, dueDate, status, subtotalAmount, taxAmt, freight, totalDue, territoryId, customer_ref, salesPersonId, onlineOrderFlag) — 31,465 rows
- SalesPerson(salesPersonId, salesYTD, salesLastYear, bonus, commissionPct, territoryId) — 17 rows
- SalesOrderLine(orderLineId, orderId, productId, quantity, unitPrice, unitPriceDiscount, lineTotal) — 121,317 rows
- SalesTerritory(territoryId, name, countryRegion, group, salesYTD, salesLastYear) — 10 rows
- Customer(customerId, accountNumber, territoryId) — 19,185 rows

### 2. CRM ClientHub (SQLite) — 20,201 raw → 19,829 clean
- accounts(accountId, companyName, creditLimit, country, email, phone, segment)
- 372 rows with accountId < 0 are legacy migration duplicates → excluded

### 3. HR CSV dipendenti_hr — 290 rows (Italian schema)
- Columns: matricolaDip, cognome, nome, dataNascita, dataAssunzione, ruolo, stipendio, repartoId
- Mapping: matricolaDip→employeeId, cognome→lastName, nome→firstName, ruolo→jobTitle

### 4. PIM JSON product_catalog — 504 products
- Fields: internal_id, name, category, subcategory, listPrice, standardCost, color, size, weight

## Cross-source Bridges
- SOLD_BY: ERP.salesPersonId ↔ HR.matricolaDip — 14/14 (100%)
- OF_PRODUCT: ERP.productId ↔ PIM.internal_id — 457/504 (99.6%, 47 orphans)
- PLACED_BY: ERP.customer_ref ↔ CRM.accountId — 18,484/19,829 (93.2%)

## Knowledge Graph
193,062 nodes, 313,193 edges

## Key Facts — use EXACT numbers
- Net revenue 2014 (subtotalAmount): $20,127,070
- Gross revenue 2014 (totalDue): $22,410,568
- Tax + freight: $2,283,498 (11.3% of net)
- Total orders 2014: 31,465 | Avg net order: $639.65
- Unique customers (after dedup): 19,829
- Top salesperson salesYTD: Linda Mitchell (#276) $4,251,368.55
- Jae Pak (#279) highest bonus $6,700 but ranks 8th by salesYTD ($2,315,185)
- Top territory: Southwest $10,510,853.87 (8,512 orders)
- Quarterly net: Q1 $4,121,485 · Q2 $5,182,930 · Q3 $5,847,621 · Q4 $4,975,034

## Top 8 Salespersons (salesYTD)
1. Mitchell, Linda #276 — $4,251,368 · bonus $2,000
2. Reiter, Rachel #289 — $4,116,871 · bonus $5,150
3. Saraiva, José #275 — $3,763,178 · bonus $4,100
4. Tsoflias, Lynn #277 — $3,189,418 · bonus $2,500
5. Vargas, Ranjit #290 — $3,121,616 · bonus $985
6. Campbell, David #282 — $2,604,540 · bonus $5,000
7. Valdez, Sonia #281 — $2,458,535 · bonus $3,550
8. Pak, Jae #279 — $2,315,185 · bonus $6,700

## Territories (salesYTD)
Southwest $10,510,853 · Northwest $7,887,186 · Canada $6,771,829 · Australia $5,977,814
UK $5,012,905 · France $4,772,398 · Germany $3,805,202 · Central $3,072,175

## SEMANTIC RULE — Revenue Ambiguity
"fatturato"/"revenue"/"ricavi" are AMBIGUOUS:
- subtotalAmount = net (excl. tax+freight) → $20.1M
- totalDue = gross (incl. tax+freight) → $22.4M
If unspecified, set isDisambiguation: true.

## Response Format — ONLY valid JSON, no markdown fences, no text outside
{
  "sql": "-- comment\nSELECT ...",
  "rows": [{"col": "value"}],
  "summary": "**bold** for key numbers",
  "interpreted_as": "brief SQL-style label",
  "chartData": {"type":"bar","title":"","labels":[],"values":[],"unit":"$"},
  "sources": [{"id":"erp","label":"ERP OrionSales","bg":"bg-blue-100","text":"text-blue-700"}],
  "steps": ["① ...", "② ...", "③ ..."],
  "followUps": ["Q1?", "Q2?", "Q3?"],
  "isDisambiguation": false
}
Source badges: ERP bg-blue-100/text-blue-700 · CRM bg-violet-100/text-violet-700 · HR bg-amber-100/text-amber-700 · PIM bg-teal-100/text-teal-700 · KG bg-slate-100/text-slate-600

IMPORTANT: Keep the total JSON response under 1500 tokens. Use short SQL comments, concise summary (1-2 sentences), max 3 steps, max 3 followUps. rows: max 8 entries. Do NOT wrap in markdown fences.`

// ── Parse raw LLM text → EngineResult ─────────────────────────────────────────

function parseResult(text: string): EngineResult {
  const clean = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim()
  try {
    return JSON.parse(clean) as EngineResult
  } catch {
    throw new Error(`LLM returned non-JSON: ${clean.slice(0, 200)}`)
  }
}

// ── Provider-specific callers ──────────────────────────────────────────────────

async function callAnthropic(question: string, apiKey: string): Promise<EngineResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-allow-browser': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: AW_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: question }],
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(e.error?.message ?? `Anthropic ${res.status}`)
  }
  const data = await res.json() as { content: Array<{ type: string; text: string }> }
  return parseResult(data.content.find(c => c.type === 'text')?.text ?? '')
}

async function callGroq(question: string, apiKey: string): Promise<EngineResult> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: AW_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(e.error?.message ?? `Groq ${res.status}`)
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> }
  return parseResult(data.choices[0]?.message?.content ?? '')
}

async function callGemini(question: string, apiKey: string): Promise<EngineResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: AW_SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: question }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(e.error?.message ?? `Gemini ${res.status}`)
  }
  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  }
  return parseResult(data.candidates[0]?.content?.parts[0]?.text ?? '')
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function executeLLMQuery(
  question: string,
  apiKey: string,
  provider: LLMProvider,
): Promise<EngineResult> {
  switch (provider) {
    case 'anthropic': return callAnthropic(question, apiKey)
    case 'groq':      return callGroq(question, apiKey)
    case 'gemini':    return callGemini(question, apiKey)
  }
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const KEY_STORAGE   = 'aw-llm-api-key'
const PROV_STORAGE  = 'aw-llm-provider'

export function getStoredCredentials(): { key: string; provider: LLMProvider } {
  try {
    const key = localStorage.getItem(KEY_STORAGE) ?? ''
    const provider = (localStorage.getItem(PROV_STORAGE) ?? 'groq') as LLMProvider
    return { key, provider }
  } catch { return { key: '', provider: 'groq' } }
}

export function saveCredentials(key: string, provider: LLMProvider): void {
  try {
    localStorage.setItem(KEY_STORAGE, key)
    localStorage.setItem(PROV_STORAGE, provider)
  } catch { /* ignore */ }
}

export function clearCredentials(): void {
  try {
    localStorage.removeItem(KEY_STORAGE)
    localStorage.removeItem(PROV_STORAGE)
  } catch { /* ignore */ }
}

// Legacy compat
export function getStoredApiKey(): string { return getStoredCredentials().key }
export function saveApiKey(key: string): void { saveCredentials(key, getStoredCredentials().provider) }
export function clearApiKey(): void { clearCredentials() }
