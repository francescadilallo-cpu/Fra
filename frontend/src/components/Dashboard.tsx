import { useEffect, useState } from 'react'
import {
  TrendingUp,
  ShoppingCart,
  FileText,
  Users,
  Database,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Activity,
  Package,
} from 'lucide-react'
import { fetchDashboard } from '../api/client'
import type { DashboardData, ProcessFunnelStage, RecentActivity } from '../types'

// Italian status → Tailwind badge colours (light theme)
const STATUS_COLORS: Record<string, string> = {
  Confermato:      'bg-blue-50 text-blue-600',
  'In Produzione': 'bg-amber-50 text-amber-600',
  Spedito:         'bg-purple-50 text-purple-600',
  Consegnato:      'bg-teal-50 text-teal-700',
  Annullato:       'bg-red-50 text-red-600',
  Bozza:           'bg-slate-100 text-slate-500',
  Inviato:         'bg-sky-50 text-sky-600',
  Accettato:       'bg-emerald-50 text-emerald-600',
  Rifiutato:       'bg-rose-50 text-rose-600',
  Scaduto:         'bg-orange-50 text-orange-600',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

// ── Funnel component (inline) ────────────────────────────────────────────────
function ProcessFunnel({ stages }: { stages: ProcessFunnelStage[] }) {
  const maxCount = stages[0]?.count ?? 1
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal-600" />
          Funnel Processo: Preventivo → Consegna
        </h2>
        <span className="text-xs text-slate-400">{stages[0]?.count ?? 0} preventivi totali</span>
      </div>
      <div className="space-y-3">
        {stages.map((s, i) => {
          const pct = (s.count / maxCount) * 100
          // opacity decreases from 100 → 40 as stages progress
          const opacity = Math.round(100 - (i / (stages.length - 1)) * 60)
          return (
            <div key={s.stage} className="flex items-center gap-3">
              <span className="w-44 text-xs text-slate-500 text-right flex-shrink-0">{s.stage}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-600 transition-all duration-700"
                  style={{ width: `${pct}%`, opacity: opacity / 100 }}
                />
              </div>
              <span className="w-8 text-center text-xs font-bold text-slate-900 flex-shrink-0">{s.count}</span>
              <span className="w-28 text-right text-xs text-slate-400 flex-shrink-0">{formatCurrency(s.value)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Activity dot colour ──────────────────────────────────────────────────────
function activityDot(type: RecentActivity['type']) {
  return type === 'order' ? 'bg-purple-400' : 'bg-teal-500'
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDashboard()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="card flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>Errore nel caricamento: {error}</span>
        </div>
      </div>
    )
  }

  // KPI trend indicators (mock deltas for presentation)
  const kpis = [
    {
      label: 'Preventivi Totali',
      value: data.total_quotes,
      icon: FileText,
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-50',
      suffix: '',
      trend: +12,
    },
    {
      label: 'Ordini Totali',
      value: data.total_orders,
      icon: ShoppingCart,
      iconColor: 'text-purple-500',
      iconBg: 'bg-purple-50',
      suffix: '',
      trend: +8,
    },
    {
      label: 'Tasso di Conversione',
      value: data.quote_conversion_rate,
      icon: TrendingUp,
      iconColor: 'text-teal-600',
      iconBg: 'bg-teal-50',
      suffix: '%',
      trend: +3,
    },
    {
      label: 'Valore Preventivi Aperti',
      value: formatCurrency(data.open_quotes_value),
      icon: Users,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-50',
      suffix: '',
      raw: true,
      trend: -5,
    },
  ]

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Panoramica del sistema ERP – Manufacturing Order Management
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {kpis.map((kpi) => {
          const TrendIcon = kpi.trend >= 0 ? ArrowUp : ArrowDown
          const trendColor = kpi.trend >= 0 ? 'text-teal-600' : 'text-red-500'
          return (
            <div key={kpi.label} className="card flex items-start gap-4 py-5">
              <div className={`${kpi.iconBg} rounded-lg p-3 mt-0.5`}>
                <kpi.icon className={`w-5 h-5 ${kpi.iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{kpi.label}</p>
                <p className="text-2xl font-bold mt-1 text-slate-900">
                  {kpi.raw ? kpi.value : `${kpi.value}${kpi.suffix}`}
                </p>
                <div className={`flex items-center gap-1 mt-1.5 text-xs ${trendColor}`}>
                  <TrendIcon className="w-3 h-3" />
                  <span>{Math.abs(kpi.trend)}% vs mese prec.</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Process Funnel */}
      <ProcessFunnel stages={data.process_funnel} />

      {/* Three-column bottom section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Column 1: Recent Activities */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-600" />
              Attività Recenti
            </h2>
          </div>
          <div className="space-y-3">
            {data.recent_activities.map((act) => (
              <div key={act.id} className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${activityDot(act.type)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 leading-snug">{act.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-slate-400">{act.time}</span>
                    <span className={`badge ${STATUS_COLORS[act.status] ?? 'bg-slate-100 text-slate-500'}`}>
                      {act.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Recent Orders */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-purple-500" />
              Ordini Recenti
            </h2>
            <ArrowUpRight className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-3">
            {data.recent_orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{order.customer_name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    #{order.id} · {order.date}
                  </p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(order.total_value)}</p>
                  <span className={`badge mt-1 ${STATUS_COLORS[order.status] ?? 'bg-slate-100 text-slate-500'}`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Data Sources */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-600" />
              Sorgenti Dati
            </h2>
            <span className="badge bg-teal-50 text-teal-700 border border-teal-200">
              {data.data_sources.length} Connesse
            </span>
          </div>

          <div className="space-y-4">
            {data.data_sources.map((ds) => (
              <div
                key={ds.name}
                className="bg-slate-50 rounded-lg p-4 border border-slate-200"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-teal-600" />
                      <span className="text-sm font-medium text-slate-900">{ds.name}</span>
                    </div>
                    <span className="text-xs text-slate-400 ml-5">{ds.type}</span>
                  </div>
                  <span className="badge bg-teal-50 text-teal-700 text-xs">
                    {ds.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {Object.entries(ds.row_counts).map(([tbl, cnt]) => (
                    <div key={tbl} className="flex items-center justify-between bg-white rounded px-2.5 py-1.5 border border-slate-200">
                      <span className="text-xs text-slate-500">{tbl}</span>
                      <span className="text-xs font-semibold text-slate-900">{cnt.toLocaleString('it-IT')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
            <span>Clienti: <strong className="text-slate-700">{data.total_customers}</strong></span>
            <span>Prodotti: <strong className="text-slate-700">{data.total_products}</strong></span>
          </div>

          {/* Quick stats row */}
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Package className="w-3.5 h-3.5" />
            <span>Ultima sincronizzazione: <strong className="text-slate-700">oggi, 09:14</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
