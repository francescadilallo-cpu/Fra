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
    badge: 'Gratuito · LLaMA 3.1 8b instant',
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

const AW_SYSTEM_PROMPT = `You are a Query AI for AdventureWorks 2014. Answer in English or Italian. Output ONLY a JSON object — no other text.

SCHEMA:
- ERP: SalesOrder(orderId,orderDate,subtotalAmount,taxAmt,freight,totalDue,territoryId,customer_ref,salesPersonId) 31465 rows; SalesPerson(salesPersonId,salesYTD,salesLastYear,bonus,commissionPct,territoryId) 17 rows; SalesOrderLine(orderId,productId,quantity,unitPrice,lineTotal) 121317 rows; SalesTerritory(territoryId,name,countryRegion,salesYTD) 10 rows; Customer(customerId,territoryId) 19185 rows
- CRM: accounts(accountId,companyName,creditLimit,country,segment) 19829 clean (372 legacy dupes excluded)
- HR: dipendenti_hr(matricolaDip,cognome,nome,ruolo,stipendio,repartoId) 290 rows
- PIM: product_catalog(internal_id,name,category,subcategory,listPrice,standardCost) 504 products
BRIDGES: SOLD_BY ERP.salesPersonId↔HR.matricolaDip 100%; OF_PRODUCT ERP.productId↔PIM.internal_id 99.6%; PLACED_BY ERP.customer_ref↔CRM.accountId 93.2%

KEY FACTS (use exactly):
Net revenue(subtotalAmount)=$20,127,070 | Gross(totalDue)=$22,410,568 | Orders=31,465 | Customers=19,829
Top salesperson: Linda Mitchell #276 $4,251,368 YTD | Top territory: Southwest $10,510,853
Q1=$4,121,485 Q2=$5,182,930 Q3=$5,847,621 Q4=$4,975,034
Salespersons YTD: Mitchell$4.25M Reiter$4.12M Saraiva$3.76M Tsoflias$3.19M Vargas$3.12M Campbell$2.60M Valdez$2.46M Pak$2.32M
Territories: Southwest$10.5M Northwest$7.9M Canada$6.8M Australia$6.0M UK$5.0M France$4.8M Germany$3.8M

RULE: "revenue"/"fatturato" without qualifier → set isDisambiguation:true, explain both subtotalAmount($20.1M) and totalDue($22.4M)

JSON schema (all fields required, keep response under 800 tokens):
{"sql":"SELECT ...","rows":[{"col":"val"}],"summary":"**bold** numbers","interpreted_as":"label","chartData":{"type":"bar","title":"","labels":[],"values":[],"unit":"$"},"sources":[{"id":"erp","label":"ERP OrionSales","bg":"bg-blue-100","text":"text-blue-700"}],"steps":["① ...","② ..."],"followUps":["Q?","Q?"],"isDisambiguation":false}
Source IDs: erp=bg-blue-100/text-blue-700 crm=bg-violet-100/text-violet-700 hr=bg-amber-100/text-amber-700 pim=bg-teal-100/text-teal-700`

// ── Parse raw LLM text → EngineResult ─────────────────────────────────────────

function parseResult(text: string): EngineResult {
  // Strip markdown fences first
  let clean = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim()

  // Extract the JSON object — LLaMA often adds preamble/postamble text
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
      model: 'llama-3.1-8b-instant',
      max_tokens: 2048,
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
    if (res.status === 429) throw new Error(`Rate limit Groq — aspetta qualche secondo e riprova. (${msg.slice(0, 80)})`)
    throw new Error(msg)
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
      generationConfig: { maxOutputTokens: 4096, temperature: 0.2, responseMimeType: 'application/json' },
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
