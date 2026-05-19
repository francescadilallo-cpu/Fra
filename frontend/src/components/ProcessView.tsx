import { FileText, Send, CheckCircle, ShoppingCart, Factory, Package, Clock } from 'lucide-react'
import { mockDashboard } from '../api/mockData'

const LIFECYCLE_STAGES = [
  { key: 'Preventivi Creati',    label: 'Preventivo',  icon: FileText,     color: 'text-slate-500',  bg: 'bg-slate-50',     border: 'border-slate-200',    avgDays: '1.2 gg' },
  { key: 'Preventivi Inviati',   label: 'Inviato',     icon: Send,         color: 'text-blue-500',   bg: 'bg-blue-50',      border: 'border-blue-200',     avgDays: '3.5 gg' },
  { key: 'Preventivi Accettati', label: 'Accettato',   icon: CheckCircle,  color: 'text-teal-600',   bg: 'bg-teal-50',      border: 'border-teal-200',     avgDays: '2.1 gg' },
  { key: 'Ordini Confermati',    label: 'Ordine',      icon: ShoppingCart, color: 'text-purple-500', bg: 'bg-purple-50',    border: 'border-purple-200',   avgDays: '1.0 gg' },
  { key: 'In Produzione',        label: 'Produzione',  icon: Factory,      color: 'text-amber-500',  bg: 'bg-amber-50',     border: 'border-amber-200',    avgDays: '8.3 gg' },
  { key: 'Consegnati',           label: 'Consegnato',  icon: Package,      color: 'text-green-600',  bg: 'bg-green-50',     border: 'border-green-200',    avgDays: '1.5 gg' },
]

const ACTIVE_CASES = [
  { id: 9,  customer: 'Rossi Meccanica S.r.l.',     value: 34750,  stage: 'Ordine',     daysInStage: 2  },
  { id: 13, customer: 'Bianchi Impianti S.p.A.',    value: 61200,  stage: 'Ordine',     daysInStage: 1  },
  { id: 11, customer: 'Lettiere-Cremonesi e figli', value: 142067, stage: 'Produzione', daysInStage: 6  },
  { id: 3,  customer: 'Moccia s.r.l.',              value: 98451,  stage: 'Produzione', daysInStage: 11 },
  { id: 7,  customer: 'Ferrari Metalli S.p.A.',     value: 82300,  stage: 'Spedito',    daysInStage: 2  },
]

const STAGE_COLORS: Record<string, string> = {
  Ordine:     'bg-purple-50 text-purple-600',
  Produzione: 'bg-amber-50 text-amber-600',
  Spedito:    'bg-blue-50 text-blue-600',
  Consegnato: 'bg-green-50 text-green-600',
}

function fmt(v: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

export default function ProcessView() {
  const funnel = mockDashboard.process_funnel
  const maxCount = funnel[0].count

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Processo</h1>
        <p className="text-slate-500 mt-1 text-sm">Ciclo di vita ordine manifatturiero — Preventivo → Consegna</p>
      </div>

      {/* Timeline stages */}
      <div className="card">
        <h2 className="font-semibold text-slate-900 mb-6">Ciclo di Vita dell'Ordine</h2>
        <div className="flex items-start gap-2 overflow-x-auto pb-2">
          {LIFECYCLE_STAGES.map((stage, i) => {
            const funnelItem = funnel.find(f => f.stage === stage.key)
            const Icon = stage.icon
            return (
              <div key={stage.key} className="flex items-start gap-2 flex-shrink-0">
                <div className={`rounded-xl border ${stage.border} ${stage.bg} p-4 w-36 text-center`}>
                  <div className="flex justify-center mb-2">
                    <Icon className={`w-6 h-6 ${stage.color}`} />
                  </div>
                  <p className={`text-sm font-semibold ${stage.color}`}>{stage.label}</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{funnelItem?.count ?? 0}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmt(funnelItem?.value ?? 0)}</p>
                  <div className="mt-2 flex items-center justify-center gap-1 text-xs text-slate-400">
                    <Clock className="w-3 h-3" />
                    <span>{stage.avgDays}</span>
                  </div>
                </div>
                {i < LIFECYCLE_STAGES.length - 1 && (
                  <div className="mt-8 text-slate-300 text-xl font-light flex-shrink-0">→</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Funnel bars */}
      <div className="card">
        <h2 className="font-semibold text-slate-900 mb-5">Funnel di Conversione</h2>
        <div className="space-y-3">
          {funnel.map((item, i) => {
            const pct = Math.round((item.count / maxCount) * 100)
            const opacity = 1 - i * 0.1
            return (
              <div key={item.stage} className="flex items-center gap-4">
                <span className="text-sm text-slate-500 w-44 flex-shrink-0">{item.stage}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center px-3"
                    style={{ width: `${pct}%`, backgroundColor: `rgba(13,148,136,${opacity})` }}
                  >
                    <span className="text-xs font-semibold text-white">{item.count}</span>
                  </div>
                </div>
                <span className="text-sm text-slate-400 w-28 text-right flex-shrink-0">{fmt(item.value)}</span>
                <span className="text-xs text-slate-400 w-10 text-right flex-shrink-0">{pct}%</span>
              </div>
            )
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-400">
          Tasso di conversione preventivo→ordine: <strong className="text-teal-600">26%</strong> · Tempo medio ciclo: <strong className="text-teal-600">17.6 gg</strong>
        </div>
      </div>

      {/* Active cases */}
      <div className="card">
        <h2 className="font-semibold text-slate-900 mb-4">Casi Attivi</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200 bg-slate-50">
                <th className="text-left px-3 pb-2 pt-2 font-medium">#</th>
                <th className="text-left px-3 pb-2 pt-2 font-medium">Cliente</th>
                <th className="text-left px-3 pb-2 pt-2 font-medium">Fase</th>
                <th className="text-right px-3 pb-2 pt-2 font-medium">Valore</th>
                <th className="text-right px-3 pb-2 pt-2 font-medium">Giorni in fase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ACTIVE_CASES.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-3 text-slate-400">#{c.id}</td>
                  <td className="py-3 px-3 text-slate-900 font-medium">{c.customer}</td>
                  <td className="py-3 px-3">
                    <span className={`badge ${STAGE_COLORS[c.stage] ?? 'bg-slate-100 text-slate-500'}`}>
                      {c.stage}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-slate-900">{fmt(c.value)}</td>
                  <td className={`py-3 px-3 text-right font-semibold ${c.daysInStage > 8 ? 'text-amber-500' : 'text-slate-600'}`}>
                    {c.daysInStage} gg
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
