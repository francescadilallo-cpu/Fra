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
} from 'lucide-react'
import { fetchDashboard } from '../api/client'
import type { DashboardData } from '../types'

const STATUS_COLORS: Record<string, string> = {
  confirmed:     'bg-blue-500/20 text-blue-300',
  in_production: 'bg-yellow-500/20 text-yellow-300',
  shipped:       'bg-purple-500/20 text-purple-300',
  delivered:     'bg-teal-500/20 text-teal-300',
  cancelled:     'bg-red-500/20 text-red-300',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

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
        <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="card flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>Errore nel caricamento: {error}</span>
        </div>
      </div>
    )
  }

  const kpis = [
    {
      label: 'Preventivi Totali',
      value: data.total_quotes,
      icon: FileText,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
      suffix: '',
    },
    {
      label: 'Ordini Totali',
      value: data.total_orders,
      icon: ShoppingCart,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
      suffix: '',
    },
    {
      label: 'Tasso di Conversione',
      value: data.quote_conversion_rate,
      icon: TrendingUp,
      color: 'text-teal-400',
      bg: 'bg-teal-400/10',
      suffix: '%',
    },
    {
      label: 'Valore Preventivi Aperti',
      value: formatCurrency(data.open_quotes_value),
      icon: Users,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
      suffix: '',
      raw: true,
    },
  ]

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Panoramica del sistema ERP – Manufacturing Order Management
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card flex items-start gap-4">
            <div className={`${kpi.bg} rounded-lg p-2.5 mt-0.5`}>
              <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">{kpi.label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${kpi.color}`}>
                {kpi.raw ? kpi.value : `${kpi.value}${kpi.suffix}`}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Data Sources + Recent Orders */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Data Sources */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-400" />
              Sorgenti Dati
            </h2>
            <span className="badge bg-teal-500/10 text-teal-400 border border-teal-500/20">
              {data.data_sources.length} Connesse
            </span>
          </div>

          <div className="space-y-4">
            {data.data_sources.map((ds) => (
              <div
                key={ds.name}
                className="bg-navy-900 rounded-lg p-4 border border-navy-700"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-teal-400" />
                      <span className="text-sm font-medium text-white">{ds.name}</span>
                    </div>
                    <span className="text-xs text-slate-500 ml-5">{ds.type}</span>
                  </div>
                  <span className="badge bg-teal-500/10 text-teal-400 text-xs">
                    {ds.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {Object.entries(ds.row_counts).map(([tbl, cnt]) => (
                    <div key={tbl} className="flex items-center justify-between bg-navy-800 rounded px-2.5 py-1.5">
                      <span className="text-xs text-slate-400">{tbl}</span>
                      <span className="text-xs font-semibold text-white">{cnt.toLocaleString('it-IT')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-navy-700 flex items-center justify-between text-xs text-slate-500">
            <span>Clienti: <strong className="text-slate-300">{data.total_customers}</strong></span>
            <span>Prodotti: <strong className="text-slate-300">{data.total_products}</strong></span>
          </div>
        </div>

        {/* Recent Orders */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-purple-400" />
              Ordini Recenti
            </h2>
            <ArrowUpRight className="w-4 h-4 text-slate-500" />
          </div>

          <div className="space-y-3">
            {data.recent_orders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between py-2.5 border-b border-navy-700 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{order.customer_name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    #{order.id} · {order.date}
                  </p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-sm font-semibold text-white">{formatCurrency(order.total_value)}</p>
                  <span className={`badge text-xs mt-1 ${STATUS_COLORS[order.status] ?? 'bg-slate-700 text-slate-300'}`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
