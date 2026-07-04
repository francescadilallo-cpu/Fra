import { useState, useEffect, useRef } from 'react'
import { Trash2, Upload, FileText, Plus, BookOpen, Tag, BarChart2, X, Loader2 } from 'lucide-react'
import { IS_DEMO_MODE } from '../lib/demoMode'
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  listEntities,
  createEntity,
  deleteEntity,
  listMetrics,
  createMetric,
  deleteMetric,
  listGlossary,
  createGlossaryTerm,
  deleteGlossaryTerm,
  type ContextDocumentMeta,
  type ContextEntity,
  type ContextMetric,
  type GlossaryTerm,
} from '../api/context'
import { backendErrorMessage } from '../api/semantic'

type SubTab = 'documents' | 'entities' | 'metrics' | 'glossary'

// Demo fallback data — shown when IS_DEMO_MODE and the backend is unreachable
const DEMO_FALLBACK_DOCS: ContextDocumentMeta[] = [
  { id: 1, filename: 'OrionSales_Process_Context.md', file_type: 'md', created_at: '2024-01-15T09:00:00Z' },
  { id: 2, filename: 'Revenue_Disambiguation_Rules.md', file_type: 'md', created_at: '2024-01-15T09:01:00Z' },
]
const DEMO_FALLBACK_ENTITIES: ContextEntity[] = [
  { id: 1, name: 'SalesOrder', display_name: 'Sales Order', synonyms: ['order', 'ordine', 'vendita'], description: 'Customer purchase order from ERP (sales_order_header + lines). Key fields: subtotalAmount (net revenue), totalDue (gross), onlineOrderFlag.', source: 'erp', created_at: '2024-01-15T09:00:00Z' },
  { id: 2, name: 'Customer', display_name: 'Customer', synonyms: ['account', 'cliente', 'buyer', 'conto'], description: 'Legal entity or individual that places orders. Source: crm.accounts (ClientHub). Bridge: accountId ↔ ERP customer_ref.', source: 'crm', created_at: '2024-01-15T09:00:00Z' },
  { id: 3, name: 'Salesperson', display_name: 'Salesperson', synonyms: ['rep', 'agent', 'venditore', 'agente commerciale'], description: 'Sales representative linked to HR employees via salesPersonId ↔ matricolaDip bridge. 14 active reps.', source: 'erp', created_at: '2024-01-15T09:00:00Z' },
  { id: 4, name: 'Territory', display_name: 'Territory', synonyms: ['region', 'area', 'zona', 'distretto'], description: 'Sales territory grouping customers and reps by geography. 10 territories.', source: 'erp', created_at: '2024-01-15T09:00:00Z' },
  { id: 5, name: 'Product', display_name: 'Product', synonyms: ['item', 'sku', 'articolo', 'prodotto'], description: 'Product catalogue from PIM (pim_products / product_catalog). 504 products, 98% revenue from Bikes category.', source: 'pim', created_at: '2024-01-15T09:00:00Z' },
  { id: 6, name: 'Employee', display_name: 'Employee', synonyms: ['dipendente', 'worker', 'staff'], description: 'HR employee record with Italian schema (matricolaDip, cognome, nome, stipendio, ruolo). 290 employees.', source: 'hr', created_at: '2024-01-15T09:00:00Z' },
]
const DEMO_FALLBACK_METRICS: ContextMetric[] = [
  { id: 1, name: 'total_revenue', display_name: 'Total Revenue', synonyms: ['fatturato', 'ricavi', 'revenue', 'entrate'], description: 'SUM of SubTotal from sales_order_header — pre-tax, pre-freight. The authoritative revenue metric. 2014 value: $20.1M.', unit: 'USD', certified: true, created_at: '2024-01-15T09:00:00Z' },
  { id: 2, name: 'gross_revenue', display_name: 'Gross Revenue', synonyms: ['ricavi lordi', 'total_due', 'billed revenue'], description: 'SUM of TotalDue — includes tax and freight (~11.3% above net). Use for billing/AR, NOT for commercial KPIs.', unit: 'USD', certified: false, created_at: '2024-01-15T09:00:00Z' },
  { id: 3, name: 'order_count', display_name: 'Order Count', synonyms: ['numero ordini', 'orders', 'transazioni'], description: 'COUNT(DISTINCT SalesOrderID) in a given time window. 31,465 total orders in the dataset.', unit: 'count', certified: true, created_at: '2024-01-15T09:00:00Z' },
  { id: 4, name: 'active_customers', display_name: 'Active Customers', synonyms: ['clienti attivi', 'buyers'], description: 'Customers with at least one order in the period. Based on ERP↔CRM bridge (93.2% match rate = 18,484 matched accounts).', unit: 'count', certified: true, created_at: '2024-01-15T09:00:00Z' },
  { id: 5, name: 'avg_order_value', display_name: 'Avg. Order Value', synonyms: ['valore medio ordine', 'AOV', 'ticket medio'], description: 'total_revenue / order_count. Calculated on SubTotal (net). Excludes tax and freight.', unit: 'USD', certified: false, created_at: '2024-01-15T09:00:00Z' },
]
const DEMO_FALLBACK_GLOSSARY: GlossaryTerm[] = [
  { id: 1, term: 'fatturato', definition: 'Italian term for revenue. In OrionSales → subtotalAmount (SubTotal, pre-tax). NOT TotalDue. When asked for "fatturato" always use the total_revenue metric (SUM of SubTotal).', created_at: '2024-01-15T09:00:00Z' },
  { id: 2, term: 'subtotal_amount', definition: 'ERP field SubTotal in sales_order_header. Pre-tax, pre-freight. The correct revenue figure for commercial reporting ($20.1M in 2014). Maps to total_revenue metric.', created_at: '2024-01-15T09:00:00Z' },
  { id: 3, term: 'total_due', definition: 'ERP field TotalDue. Includes tax + freight (~11.3% above SubTotal). $22.4M in 2014. Use for billing/AR. Do NOT use for revenue KPIs unless explicitly requested.', created_at: '2024-01-15T09:00:00Z' },
  { id: 4, term: 'bridge', definition: 'Cross-system join linking records across sources. E.g., ERP↔CRM: customer_ref ↔ accountId (93.2% match). ERP↔HR: salesPersonId ↔ matricolaDip (100%). ERP↔PIM: productId ↔ internal_id.', created_at: '2024-01-15T09:00:00Z' },
  { id: 5, term: 'matricolaDip', definition: 'Italian HR primary key for employees ("employee ID"). Bridges to ERP salesPersonId. All 14 sales reps are matched (100% bridge health).', created_at: '2024-01-15T09:00:00Z' },
  { id: 6, term: 'online_order_flag', definition: 'Boolean field in sales_order_header. 1 = online channel (87.9% of orders), 0 = in-store/offline (12.1%). Used for channel segmentation analysis.', created_at: '2024-01-15T09:00:00Z' },
  { id: 7, term: 'knowledge_graph', definition: 'Unified in-memory graph of all entities across ERP/CRM/HR/PIM. 193,062 nodes, 313,193 edges. Deduplication removes 372 CRM duplicate accounts (accountId < 0).', created_at: '2024-01-15T09:00:00Z' },
]

const SUB_TABS: { id: SubTab; label: string; icon: typeof FileText }[] = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'entities', label: 'Entities', icon: Tag },
  { id: 'metrics', label: 'Metrics', icon: BarChart2 },
  { id: 'glossary', label: 'Glossary', icon: BookOpen },
]

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {children}
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="text-red-400 hover:text-red-600 flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ── Documenti sub-tab ─────────────────────────────────────────────────────────

function DocumentsTab() {
  const [docs, setDocs] = useState<ContextDocumentMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = async () => {
    try {
      setDocs(await listDocuments())
    } catch {
      if (IS_DEMO_MODE) {
        setDocs(DEMO_FALLBACK_DOCS)
      } else {
        setError('Unable to load documents.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleFile = async (file: File) => {
    setError(null)
    setUploading(true)
    try {
      await uploadDocument(file)
      await reload()
    } catch (e: unknown) {
      const msg = backendErrorMessage(e)
      setError(msg ?? 'Upload failed. Check the file format.')
    } finally {
      setUploading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteDocument(id)
      await reload()
    } catch {
      setError('Unable to delete the document.')
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <SectionCard>
        <SectionHeader
          title="Upload documents"
          subtitle="Supported: .txt, .md, .pdf — content guides AI query responses"
        />
        <div className="p-5">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf"
            className="hidden"
            onChange={handleInputChange}
          />
          <div
            onClick={() => !uploading && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer select-none ${
              dragging
                ? 'border-teal-400 bg-teal-50'
                : uploading
                ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
                : 'border-slate-200 hover:border-teal-300 hover:bg-slate-50'
            }`}
          >
            <Upload className={`w-8 h-8 mx-auto mb-2 ${dragging ? 'text-teal-500' : 'text-slate-300'}`} />
            {uploading ? (
              <p className="text-sm text-slate-500">Uploading…</p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-700">
                  Drag a file here or <span className="text-teal-600 underline">click to select</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">.txt · .md · .pdf</p>
              </>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Uploaded documents" subtitle={`${docs.length} document${docs.length !== 1 ? 's' : ''}`} />
        {loading ? (
          <div className="px-5 py-8 flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : docs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            No documents uploaded. Add a file above.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 group">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{doc.filename}</p>
                  <p className="text-xs text-slate-400">
                    {doc.file_type.toUpperCase()} · {new Date(doc.created_at).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}

// ── Entities sub-tab ──────────────────────────────────────────────────────────

const EMPTY_ENTITY = { name: '', display_name: '', synonyms: '', description: '', source: '' }

function EntitiesTab() {
  const [entities, setEntities] = useState<ContextEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_ENTITY)
  const [showForm, setShowForm] = useState(false)

  const reload = async () => {
    try {
      setEntities(await listEntities())
    } catch {
      if (IS_DEMO_MODE) {
        setEntities(DEMO_FALLBACK_ENTITIES)
      } else {
        setError('Unable to load entities.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.display_name.trim()) {
      setError('Name and display name are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await createEntity({
        name: form.name.trim(),
        display_name: form.display_name.trim(),
        synonyms: form.synonyms.split(',').map(s => s.trim()).filter(Boolean),
        description: form.description.trim(),
        source: form.source.trim(),
      })
      setForm(EMPTY_ENTITY)
      setShowForm(false)
      await reload()
    } catch (e: unknown) {
      const msg = backendErrorMessage(e)
      setError(msg ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteEntity(id)
      await reload()
    } catch {
      setError('Unable to delete the entity.')
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <SectionCard>
        <SectionHeader title="New entity" subtitle="Define a domain entity with synonyms and description" />
        <div className="p-5">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add entity
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Technical name *</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    placeholder="e.g. Customer"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Display name *</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    placeholder="e.g. Customer"
                    value={form.display_name}
                    onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Synonyms (comma-separated)</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                  placeholder="e.g. order, sale, transaction"
                  value={form.synonyms}
                  onChange={e => setForm(f => ({ ...f, synonyms: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 resize-none"
                  rows={2}
                  placeholder="Description of the entity in the business domain"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Data source</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                  placeholder="e.g. erp, crm"
                  value={form.source}
                  onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save entity'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setForm(EMPTY_ENTITY); setError(null) }}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Defined entities" subtitle={`${entities.length} ${entities.length !== 1 ? 'entities' : 'entity'}`} />
        {loading ? (
          <div className="px-5 py-8 flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : entities.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            No entities defined. Add one above.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entities.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 group">
                <Tag className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-800">{e.display_name}</p>
                    <code className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-mono">{e.name}</code>
                    {e.source && (
                      <span className="text-[10px] bg-teal-50 text-teal-600 rounded px-1.5 py-0.5">{e.source}</span>
                    )}
                  </div>
                  {e.description && <p className="text-xs text-slate-500 mt-0.5">{e.description}</p>}
                  {e.synonyms.length > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      Synonyms: {e.synonyms.join(', ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}

// ── Metrics sub-tab ───────────────────────────────────────────────────────────

const EMPTY_METRIC = { name: '', display_name: '', synonyms: '', description: '', unit: '', certified: false }

function MetricsTab() {
  const [metrics, setMetrics] = useState<ContextMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_METRIC)
  const [showForm, setShowForm] = useState(false)

  const reload = async () => {
    try {
      setMetrics(await listMetrics())
    } catch {
      if (IS_DEMO_MODE) {
        setMetrics(DEMO_FALLBACK_METRICS)
      } else {
        setError('Unable to load metrics.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.display_name.trim()) {
      setError('Name and display name are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await createMetric({
        name: form.name.trim(),
        display_name: form.display_name.trim(),
        synonyms: form.synonyms.split(',').map(s => s.trim()).filter(Boolean),
        description: form.description.trim(),
        unit: form.unit.trim(),
        certified: form.certified,
      })
      setForm(EMPTY_METRIC)
      setShowForm(false)
      await reload()
    } catch (e: unknown) {
      const msg = backendErrorMessage(e)
      setError(msg ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteMetric(id)
      await reload()
    } catch {
      setError('Unable to delete the metric.')
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <SectionCard>
        <SectionHeader title="New metric" subtitle="Define a business metric with unit and certification" />
        <div className="p-5">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add metric
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Technical name *</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    placeholder="e.g. total_revenue"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Display name *</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    placeholder="e.g. Total Revenue"
                    value={form.display_name}
                    onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Synonyms (comma-separated)</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    placeholder="e.g. revenue, income, sales"
                    value={form.synonyms}
                    onChange={e => setForm(f => ({ ...f, synonyms: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Unit of measure</label>
                  <input
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                    placeholder="e.g. EUR, %, units"
                    value={form.unit}
                    onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 resize-none"
                  rows={2}
                  placeholder="How is this metric calculated?"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400"
                  checked={form.certified}
                  onChange={e => setForm(f => ({ ...f, certified: e.target.checked }))}
                />
                <span className="text-sm text-slate-700">Certified metric</span>
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save metric'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setForm(EMPTY_METRIC); setError(null) }}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Defined metrics" subtitle={`${metrics.length} metric${metrics.length !== 1 ? 's' : ''}`} />
        {loading ? (
          <div className="px-5 py-8 flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : metrics.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            No metrics defined. Add one above.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {metrics.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 group">
                <BarChart2 className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-800">{m.display_name}</p>
                    <code className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 font-mono">{m.name}</code>
                    {m.unit && (
                      <span className="text-[10px] bg-amber-50 text-amber-600 rounded px-1.5 py-0.5">{m.unit}</span>
                    )}
                    {m.certified && (
                      <span className="text-[10px] bg-green-50 text-green-700 rounded px-1.5 py-0.5 font-semibold">CERTIFIED</span>
                    )}
                  </div>
                  {m.description && <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>}
                  {m.synonyms.length > 0 && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      Synonyms: {m.synonyms.join(', ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}

// ── Glossary sub-tab ──────────────────────────────────────────────────────────

const EMPTY_GLOSSARY = { term: '', definition: '' }

function GlossaryTab() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_GLOSSARY)
  const [showForm, setShowForm] = useState(false)

  const reload = async () => {
    try {
      setTerms(await listGlossary())
    } catch {
      if (IS_DEMO_MODE) {
        setTerms(DEMO_FALLBACK_GLOSSARY)
      } else {
        setError('Unable to load the glossary.')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.term.trim() || !form.definition.trim()) {
      setError('Term and definition are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await createGlossaryTerm(form.term.trim(), form.definition.trim())
      setForm(EMPTY_GLOSSARY)
      setShowForm(false)
      await reload()
    } catch (e: unknown) {
      const msg = backendErrorMessage(e)
      setError(msg ?? 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteGlossaryTerm(id)
      await reload()
    } catch {
      setError('Unable to delete the term.')
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <SectionCard>
        <SectionHeader title="New term" subtitle="Add a definition to the business glossary" />
        <div className="p-5">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add term
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Term *</label>
                <input
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400"
                  placeholder="e.g. net revenue"
                  value={form.term}
                  onChange={e => setForm(f => ({ ...f, term: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Definition *</label>
                <textarea
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 resize-none"
                  rows={3}
                  placeholder="Define the business meaning of this term"
                  value={form.definition}
                  onChange={e => setForm(f => ({ ...f, definition: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save term'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setForm(EMPTY_GLOSSARY); setError(null) }}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </SectionCard>

      <SectionCard>
        <SectionHeader title="Glossary" subtitle={`${terms.length} term${terms.length !== 1 ? 's' : ''}`} />
        {loading ? (
          <div className="px-5 py-8 flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>
        ) : terms.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            No terms in the glossary. Add one above.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {terms.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 group">
                <BookOpen className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{t.term}</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{t.definition}</p>
                </div>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}

// ── Main ContextTab ───────────────────────────────────────────────────────────

export default function ContextTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('documents')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="mb-6 flex items-center gap-2.5">
        <span className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0">
          <BookOpen className="h-4 w-4 text-white" />
        </span>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Context</h2>
          <p className="text-sm text-slate-500 mt-1">
            Add business context to guide AI query responses. Documents and definitions you upload take priority over auto-detected information.
          </p>
        </div>
      </div>

      {/* Sub-tab nav */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-200">
        {SUB_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSubTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeSubTab === id
                ? 'border-teal-500 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {activeSubTab === 'documents' && <DocumentsTab />}
      {activeSubTab === 'entities' && <EntitiesTab />}
      {activeSubTab === 'metrics' && <MetricsTab />}
      {activeSubTab === 'glossary' && <GlossaryTab />}
    </div>
  )
}
