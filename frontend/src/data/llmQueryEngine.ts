import type { EngineResult } from './queryEngine'

// ── Dynamic system prompt (fetched from backend, cached per session) ──────────

let _cachedSystemPrompt: string | null = null

async function getSystemPrompt(): Promise<string> {
  if (_cachedSystemPrompt) return _cachedSystemPrompt
  try {
    const res = await fetch('/api/semantic/system-prompt')
    if (res.ok) {
      const data = await res.json() as { prompt?: string }
      if (data.prompt) {
        _cachedSystemPrompt = data.prompt
        return _cachedSystemPrompt
      }
    }
  } catch {
    // backend unavailable — fall through to minimal fallback
  }
  // Minimal fallback: no schema knowledge, LLM will say "no data available"
  _cachedSystemPrompt =
    'You are a data intelligence assistant. ' +
    'Respond in the user\'s language. ' +
    'Output ONLY valid JSON: {"sql":"SELECT 1","rows":[],"summary":"...","interpreted_as":"...","chartData":null,"sources":[],"steps":[],"followUps":[],"isDisambiguation":false}. ' +
    'If no schema is loaded, set summary to "Data sources not yet loaded." and sql to "SELECT 1 AS not_available".'
  return _cachedSystemPrompt
}

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
  const systemPrompt = await getSystemPrompt()
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
      system: systemPrompt,
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
  const systemPrompt = await getSystemPrompt()
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
        { role: 'system', content: systemPrompt },
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
  const systemPrompt = await getSystemPrompt()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
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
  if (!key) throw new Error('API key is empty — open the AI provider panel and enter your key.')
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
