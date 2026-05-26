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
    badge: 'Gratuito · LLaMA 3.3 70b → 8b fallback',
    hint: 'console.groq.com → API Keys',
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
  },
  {
    id: 'gemini',
    label: 'Google Gemini Flash',
    free: true,
    badge: 'Gratuito · Gemini 2.0 Flash',
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

const AW_SYSTEM_PROMPT = `You are a semantic query engine for AdventureWorks 2014 (4-source data platform).
Respond in the same language as the question (English or Italian).
Output ONLY a single valid JSON object — no markdown, no explanation, no text outside the JSON.

## SCHEMA

ERP (PostgreSQL):
  SalesOrder: orderId, orderDate, shipDate, status, subtotalAmount, taxAmt, freight, totalDue, territoryId, customer_ref, salesPersonId, onlineOrderFlag — 31,465 rows
  SalesPerson: salesPersonId, salesYTD, salesLastYear, bonus, commissionPct, territoryId — 17 rows
  SalesOrderLine: orderId, productId, quantity, unitPrice, unitPriceDiscount, lineTotal — 121,317 rows
  SalesTerritory: territoryId, name, countryRegion, group, salesYTD — 10 rows
  Customer: customerId, accountNumber, territoryId — 19,185 rows
CRM (SQLite): accounts: accountId, companyName, creditLimit, country, segment — 19,829 clean (372 dupes with accountId<0 excluded)
HR (CSV): dipendenti_hr: matricolaDip, cognome, nome, ruolo, stipendio, repartoId — 290 rows
PIM (JSON): product_catalog: internal_id, name, category, subcategory, listPrice, standardCost, color, size, weight — 504 products

Bridges: ERP.salesPersonId ↔ HR.matricolaDip (100% match); ERP.productId ↔ PIM.internal_id (99.6%); ERP.customer_ref ↔ CRM.accountId (93.2%)

## KEY FACTS — use these exact numbers, never invent others

Revenue 2014: subtotalAmount (net) = $20,127,070 | totalDue (gross) = $22,410,568 | tax+freight = $2,283,498 (11.3%)
Orders: 31,465 total | avg net $639.65 | Online: 27,659 (87.9%, avg $356) | In-store: 3,806 (12.1%, avg $2,704)
Customers (deduped CRM): 19,829 | ERP-matched: 18,484 (93.2%) | CRM-only prospects: 1,345
Quarterly net: Q1 $4,121,485 (7,312 orders) | Q2 $5,182,930 (8,204) | Q3 $5,847,621 (8,847) | Q4 $4,975,034 (7,102)
YoY: 2011 had 1,607 orders avg $7,868 net $12,646,110 | 2014 had 31,465 orders avg $640 net $20,127,070

Product categories (ERP×PIM): Bikes 97 SKUs $19,791,723 (98% of revenue) | Components 189 SKUs $931,644 | Clothing 35 SKUs $339,772 | Accessories 36 SKUs $231,521
Top products: Mountain-200 Black,38 $261,436 | Road-150 Red,62 $106,420 | Touring-1000 Blue,60 $32,726

Top salespersons by salesYTD:
  1. Linda Mitchell #276 — $4,251,368 | bonus $2,000 | comm 1.5%
  2. Rachel Reiter #289 — $4,116,871 | bonus $5,150 | comm 2.0% ← highest est. total comp
  3. José Saraiva #275 — $3,763,178 | bonus $4,100 | comm 1.2%
  4. Lynn Tsoflias #277 — $3,189,418 | bonus $2,500 | comm 1.5%
  5. Ranjit Vargas #290 — $3,121,616 | bonus $985  | comm 1.6%
  6. David Campbell #282 — $2,604,540 | bonus $5,000 | comm 1.5%
  7. Sonia Valdez #281 — $2,458,535 | bonus $3,550 | comm 1.0%
  8. Jae Pak #279 — $2,315,185 | bonus $6,700 ← highest bonus but ranks 8th by revenue

Territories by salesYTD: Southwest $10,510,853 (8,512 orders) | Northwest $7,887,186 | Canada $6,771,829 | Australia $5,977,814 | UK $5,012,905 | France $4,772,398 | Germany $3,805,202 | Central $3,072,175

## SEMANTIC RULES

- "revenue" / "fatturato" / "ricavi" without qualifier → isDisambiguation: true, explain both subtotalAmount ($20.1M net) and totalDue ($22.4M gross)
- "subtotal" / "net revenue" / "subtotalAmount" → use $20,127,070, isDisambiguation: false
- "total due" / "gross" / "billed" → use $22,410,568, isDisambiguation: false
- Cross-source joins: mention the bridge used in steps

## OUTPUT FORMAT

Return exactly this JSON structure:
{
  "sql": "-- brief comment\nSELECT ... FROM ...",
  "rows": [{"column": "value"}],
  "summary": "Answer with **bold** key numbers. 1-2 sentences.",
  "interpreted_as": "Short label e.g. Top salesperson by YTD revenue",
  "chartData": {"type": "bar", "title": "Chart title", "labels": ["A","B"], "values": [100, 200], "unit": "$"},
  "sources": [{"id": "erp", "label": "ERP OrionSales", "bg": "bg-blue-100", "text": "text-blue-700"}],
  "steps": ["① Locate source table", "② Apply filter/join", "③ Return result"],
  "followUps": ["Related question 1?", "Related question 2?", "Related question 3?"],
  "isDisambiguation": false
}

Source badge values (copy exactly):
  ERP:  {"id":"erp","label":"ERP OrionSales","bg":"bg-blue-100","text":"text-blue-700"}
  CRM:  {"id":"crm","label":"CRM ClientHub","bg":"bg-violet-100","text":"text-violet-700"}
  HR:   {"id":"hr","label":"HR CSV","bg":"bg-amber-100","text":"text-amber-700"}
  PIM:  {"id":"pim","label":"PIM JSON","bg":"bg-teal-100","text":"text-teal-700"}
  KG:   {"id":"kg","label":"Knowledge Graph","bg":"bg-slate-100","text":"text-slate-600"}

Rules: rows max 10 entries | steps 2-4 items | followUps exactly 3 | include chartData whenever a ranked list or comparison makes sense.`

// ── Parse raw LLM text → EngineResult ─────────────────────────────────────────

function parseResult(text: string): EngineResult {
  let clean = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim()

  // Extract the outermost JSON object in case the model added preamble/postamble
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start !== -1 && end > start) {
    clean = clean.slice(start, end + 1)
  }

  try {
    const parsed = JSON.parse(clean) as Partial<EngineResult>
    return {
      sql: parsed.sql ?? '-- query',
      rows: parsed.rows ?? [],
      summary: parsed.summary ?? '',
      interpreted_as: parsed.interpreted_as ?? '',
      chartData: parsed.chartData,
      sources: parsed.sources,
      steps: parsed.steps,
      followUps: parsed.followUps,
      isDisambiguation: parsed.isDisambiguation ?? false,
    }
  } catch {
    throw new Error(`LLM returned non-JSON: ${clean.slice(0, 300)}`)
  }
}

// ── Sleep helper ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

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

async function callGroqOnce(question: string, apiKey: string, model: string): Promise<EngineResult> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AW_SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error?: { message?: string } }
    const msg = e.error?.message ?? `Groq ${res.status}`
    const err = new Error(msg)
    ;(err as Error & { status?: number }).status = res.status
    throw err
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> }
  return parseResult(data.choices[0]?.message?.content ?? '')
}

async function callGroq(question: string, apiKey: string): Promise<EngineResult> {
  // Try 70b first (higher quality), fall back to 8b-instant on rate limit
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
  let lastError: Error = new Error('Groq unavailable')

  for (const model of models) {
    try {
      return await callGroqOnce(question, apiKey, model)
    } catch (e) {
      lastError = e as Error
      const status = (e as Error & { status?: number }).status
      if (status === 429) {
        // Rate limited on this model — wait briefly then try next
        await sleep(1500)
        continue
      }
      throw e
    }
  }
  // Both models rate-limited — surface a clean message
  throw new Error('Rate limit Groq: attendi qualche secondo e riprova. (' + lastError.message.slice(0, 100) + ')')
}

async function callGemini(question: string, apiKey: string): Promise<EngineResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: AW_SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: question }] }],
      generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
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

function validateKey(key: string, provider: LLMProvider): void {
  if (!key) throw new Error('API key is empty — open the LLM panel and enter your key.')
  if (provider === 'groq' && !key.startsWith('gsk_'))
    throw new Error('Groq key must start with "gsk_". Get one free at console.groq.com/keys')
  if (provider === 'anthropic' && !key.startsWith('sk-ant'))
    throw new Error('Anthropic key must start with "sk-ant-". Get one at console.anthropic.com/settings/keys')
  if (provider === 'gemini' && !key.startsWith('AIza'))
    throw new Error('Gemini key must start with "AIza". Get one free at aistudio.google.com/app/apikey')
}

export async function executeLLMQuery(
  question: string,
  apiKey: string,
  provider: LLMProvider,
): Promise<EngineResult> {
  validateKey(apiKey, provider)
  switch (provider) {
    case 'anthropic': return callAnthropic(question, apiKey)
    case 'groq':      return callGroq(question, apiKey)
    case 'gemini':    return callGemini(question, apiKey)
  }
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const KEY_STORAGE  = 'aw-llm-api-key'
const PROV_STORAGE = 'aw-llm-provider'

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
