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
import { useSector } from '../contexts/SectorContext'

// Status → Tailwind badge colours (light theme)
const STATUS_COLORS: Record<string, string> = {
  Confirmed:       'bg-blue-50 text-blue-700 border border-blue-200',
  'In Production': 'bg-amber-50 text-amber-700 border border-amber-200',
  Shipped:         'bg-purple-50 text-purple-700 border border-purple-200',
  Delivered:       'bg-teal-50 text-teal-700 border border-teal-200',
  Cancelled:       'bg-red-50 text-red-700 border border-red-200',
  Draft:           'bg-slate-100 text-slate-600 border border-slate-200',
  Sent:            'bg-sky-50 text-sky-700 border border-sky-200',
  Accepted:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Rejected:        'bg-rose-50 text-rose-700 border border-rose-200',
  Expired:         'bg-orange-50 text-orange-700 border border-orange-200',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

// ── Funnel component (inline) ────────────────────────────────────────────────
function ProcessFunnel({ stages }: { stages: ProcessFunnelStage[] }) {
  const maxCount = stages[0]?.count ?? 1
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal-600" />
          Process Funnel
        </h2>
        <span className="text-xs text-slate-500">{stages[0]?.count.toLocaleString('en-US') ?? 0} total</span>
      </div>
      <div className="space-y-3">
        {stages.map((s, i) => {
          const pct = (s.count / maxCount) * 100
          const opacity = Math.round(100 - (i / Math.max(1, stages.length - 1)) * 60)
          return (
            <div key={s.stage} className="flex items-center gap-3">
              <span className="w-44 text-xs text-slate-600 text-right flex-shrink-0">{s.stage}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-400 transition-all duration-700"
                  style={{ width: `${pct}%`, opacity: opacity / 100 }}
                />
              </div>
              <span className="w-14 text-center text-xs font-bold text-slate-900 flex-shrink-0">{s.count.toLocaleString('en-US')}</span>
              <span className="w-28 text-right text-xs text-slate-500 flex-shrink-0">
                {s.value > 0 ? formatCurrency(s.value) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Activity dot colour ──────────────────────────────────────────────────────
function activityDot(type: RecentActivity['type']) {
  return type === 'order' ? 'bg-purple-500' : 'bg-teal-500'
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { sector } = useSector()
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
        <div className="bg-white border border-red-200 rounded-xl p-5 flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>Loading error: {error}</span>
        </div>
      </div>
    )
  }

  // Pull KPI numbers from sector funnel (multi-sector aware)
  const funnel = sector.funnel
  const totalQuotes = funnel[0]?.count ?? 0
  const orderStageIndex = Math.min(3, funnel.length - 1)
  const totalOrders = funnel[orderStageIndex]?.count ?? 0
  const conversion = totalQuotes > 0 ? Math.round((totalOrders / totalQuotes) * 100) : 0
  const openValue = funnel.reduce((sum, s) => sum + s.value, 0)
  const hasMonetary = funnel.some((s) => s.value > 0)

  const kpis = [
    {
      label: sector.kpiLabels.quotes,
      value: totalQuotes.toLocaleString('en-US'),
      icon: FileText,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      suffix: '',
      trend: +12,
    },
    {
      label: sector.kpiLabels.orders,
      value: totalOrders.toLocaleString('en-US'),
      icon: ShoppingCart,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
      suffix: '',
      trend: +8,
    },
    {
      label: sector.kpiLabels.conversion,
      value: conversion,
      icon: TrendingUp,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
      suffix: '%',
      trend: +3,
    },
    {
      label: sector.kpiLabels.openValue,
      value: hasMonetary ? formatCurrency(openValue) : totalQuotes.toLocaleString('en-US'),
      icon: Users,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      suffix: '',
      raw: true,
      trend: -5,
    },
  ]

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {sector.name} · {sector.domain}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {kpis.map((kpi) => {
          const TrendIcon = kpi.trend >= 0 ? ArrowUp : ArrowDown
          const trendColor = kpi.trend >= 0 ? 'text-teal-600' : 'text-red-600'
          return (
            <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl p-5 flex items-start gap-4">
              <div className={`${kpi.bg} rounded-lg p-3 mt-0.5`}>
                <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500 font-medium">{kpi.label}</p>
                <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>
                  {kpi.raw ? kpi.value : `${kpi.value}${kpi.suffix}`}
                </p>
                <div className={`flex items-center gap-1 mt-1.5 text-xs ${trendColor}`}>
                  <TrendIcon className="w-3 h-3" />
                  <span>{Math.abs(kpi.trend)}% vs prev. month</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Process Funnel (sector-aware) */}
      <ProcessFunnel stages={sector.funnel} />

      {/* TODO: sector-specific data for recent_orders and recent_activities */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Column 1: Recent Activities */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-600" />
              Recent Activities
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
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_COLORS[act.status] ?? 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                      {act.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Recent Orders */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-purple-600" />
              Recent Orders
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
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium mt-1 ${STATUS_COLORS[order.status] ?? 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                    {order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Data Sources */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900 flex items-center gap-2">
              <Database className="w-4 h-4 text-teal-600" />
              Data Sources
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-200">
              {data.data_sources.length} Connected
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
                    <span className="text-xs text-slate-500 ml-5">{ds.type}</span>
                  </div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700 border border-teal-200">
                    {ds.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {Object.entries(ds.row_counts).map(([tbl, cnt]) => (
                    <div key={tbl} className="flex items-center justify-between bg-white rounded px-2.5 py-1.5 border border-slate-200">
                      <span className="text-xs text-slate-500">{tbl}</span>
                      <span className="text-xs font-semibold text-slate-900">{cnt.toLocaleString('en-US')}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Customers: <strong className="text-slate-700">{data.total_customers}</strong></span>
            <span>Products: <strong className="text-slate-700">{data.total_products}</strong></span>
          </div>

          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <Package className="w-3.5 h-3.5" />
            <span>Last sync: <strong className="text-slate-600">today, 09:14</strong></span>
          </div>
        </div>
      </div>
    </div>
  )
}
