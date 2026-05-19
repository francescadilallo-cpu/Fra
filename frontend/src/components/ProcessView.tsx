import { FileText, Send, CheckCircle, ShoppingCart, Factory, Package, Clock } from 'lucide-react'
import { mockDashboard } from '../api/mockData'

const LIFECYCLE_STAGES = [
  { key: 'Preventivi Creati',    label: 'Preventivo',  icon: FileText,     color: 'text-slate-300',  bg: 'bg-slate-700/50',   border: 'border-slate-600',    avgDays: '1.2 gg' },
  { key: 'Preventivi Inviati',   label: 'Inviato',     icon: Send,         color: 'text-blue-400',   bg: 'bg-blue-500/10',    border: 'border-blue-500/30',  avgDays: '3.5 gg' },
  { key: 'Preventivi Accettati', label: 'Accettato',   icon: CheckCircle,  color: 'text-teal-400',   bg: 'bg-teal-500/10',    border: 'border-teal-500/30',  avgDays: '2.1 gg' },
  { key: 'Ordini Confermati',    label: 'Ordine',      icon: ShoppingCart, color: 'text-purple-400', bg: 'bg-purple-500/10',  border: 'border-purple-500/30', avgDays: '1.0 gg' },
  { key: 'In Produzione',        label: 'Produzione',  icon: Factory,      color: 'text-amber-400',  bg: 'bg-amber-500/10',   border: 'border-amber-500/30', avgDays: '8.3 gg' },
  { key: 'Consegnati',           label: 'Consegnato',  icon: Package,      color: 'text-green-400',  bg: 'bg-green-500/10',   border: 'border-green-500/30', avgDays: '1.5 gg' },
]

const ACTIVE_CASES = [
  { id: 9,  customer: 'Rossi Meccanica S.r.l.',     value: 34750,  stage: 'Ordine',     daysInStage: 2  },
  { id: 13, customer: 'Bianchi Impianti S.p.A.',    value: 61200,  stage: 'Ordine',     daysInStage: 1  },
  { id: 11, customer: 'Lettiere-Cremonesi e figli', value: 142067, stage: 'Produzione', daysInStage: 6  },
  { id: 3,  customer: 'Moccia s.r.l.',              value: 98451,  stage: 'Produzione', daysInStage: 11 },
  { id: 7,  customer: 'Ferrari Metalli S.p.A.',     value: 82300,  stage: 'Spedito',    daysInStage: 2  },
]

const STAGE_COLORS: Record<string, string> = {
  Ordine:     'bg-purple-500/20 text-purple-300',
  Produzione: 'bg-amber-500/20 text-amber-300',
  Spedito:    'bg-blue-500/20 text-blue-300',
  Consegnato: 'bg-green-500/20 text-green-300',
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
        <h1 className="text-2xl font-bold text-white">Processo</h1>
        <p className="text-slate-400 mt-1 text-sm">Ciclo di vita ordine manifatturiero — Preventivo → Consegna</p>
      </div>

      {/* Timeline stages */}
      <div className="card">
        <h2 className="font-semibold text-white mb-6">Ciclo di Vita dell'Ordine</h2>
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
                  <p className={`text-sm font-bold ${stage.color}`}>{stage.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{funnelItem?.count ?? 0}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{fmt(funnelItem?.value ?? 0)}</p>
                  <div className="mt-2 flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{stage.avgDays}</span>
                  </div>
                </div>
                {i < LIFECYCLE_STAGES.length - 1 && (
                  <div className="mt-8 text-slate-600 text-xl font-light flex-shrink-0">→</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Funnel bars */}
      <div className="card">
        <h2 className="font-semibold text-white mb-5">Funnel di Conversione</h2>
        <div className="space-y-3">
          {funnel.map((item, i) => {
            const pct = Math.round((item.count / maxCount) * 100)
            const opacity = 1 - i * 0.1
            return (
              <div key={item.stage} className="flex items-center gap-4">
                <span className="text-sm text-slate-400 w-44 flex-shrink-0">{item.stage}</span>
                <div className="flex-1 bg-navy-900 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center px-3"
                    style={{ width: `${pct}%`, backgroundColor: `rgba(20,184,166,${opacity})` }}
                  >
                    <span className="text-xs font-semibold text-white">{item.count}</span>
                  </div>
                </div>
                <span className="text-sm text-slate-400 w-28 text-right flex-shrink-0">{fmt(item.value)}</span>
                <span className="text-xs text-slate-600 w-10 text-right flex-shrink-0">{pct}%</span>
              </div>
            )
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-navy-700 text-xs text-slate-500">
          Tasso di conversione preventivo→ordine: <strong className="text-teal-400">26%</strong> · Tempo medio ciclo: <strong className="text-teal-400">17.6 gg</strong>
        </div>
      </div>

      {/* Active cases */}
      <div className="card">
        <h2 className="font-semibold text-white mb-4">Casi Attivi</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-navy-700">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Cliente</th>
                <th className="text-left pb-2 font-medium">Fase</th>
                <th className="text-right pb-2 font-medium">Valore</th>
                <th className="text-right pb-2 font-medium">Giorni in fase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-700">
              {ACTIVE_CASES.map(c => (
                <tr key={c.id} className="hover:bg-navy-800/50 transition-colors">
                  <td className="py-3 text-slate-500">#{c.id}</td>
                  <td className="py-3 text-white font-medium">{c.customer}</td>
                  <td className="py-3">
                    <span className={`badge text-xs ${STAGE_COLORS[c.stage] ?? 'bg-slate-700 text-slate-300'}`}>
                      {c.stage}
                    </span>
                  </td>
                  <td className="py-3 text-right text-white">{fmt(c.value)}</td>
                  <td className={`py-3 text-right font-semibold ${c.daysInStage > 8 ? 'text-amber-400' : 'text-slate-300'}`}>
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
