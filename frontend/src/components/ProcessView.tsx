import { FileText, Send, CheckCircle, ShoppingCart, Factory, Package, Clock } from 'lucide-react'
import { useSector } from '../contexts/SectorContext'

// Generic stage style palette used to colour the 4 sector-driven processStages
const STAGE_STYLES = [
  { icon: FileText,    color: 'text-slate-700', bg: 'bg-slate-50',  border: 'border-slate-200' },
  { icon: Send,        color: 'text-blue-700',  bg: 'bg-blue-50',   border: 'border-blue-200' },
  { icon: Factory,     color: 'text-amber-700', bg: 'bg-amber-50',  border: 'border-amber-200' },
  { icon: CheckCircle, color: 'text-teal-700',  bg: 'bg-teal-50',   border: 'border-teal-200' },
  { icon: ShoppingCart,color: 'text-purple-700',bg: 'bg-purple-50', border: 'border-purple-200' },
  { icon: Package,     color: 'text-green-700', bg: 'bg-green-50',  border: 'border-green-200' },
]

const AVG_DAYS = ['1.2 gg', '3.5 gg', '8.3 gg', '1.5 gg']

const ACTIVE_CASES = [
  { id: 9,  name: 'Caso #9',  value: 34750,  stage: 'Stadio 2', daysInStage: 2  },
  { id: 13, name: 'Caso #13', value: 61200,  stage: 'Stadio 2', daysInStage: 1  },
  { id: 11, name: 'Caso #11', value: 142067, stage: 'Stadio 3', daysInStage: 6  },
  { id: 3,  name: 'Caso #3',  value: 98451,  stage: 'Stadio 3', daysInStage: 11 },
  { id: 7,  name: 'Caso #7',  value: 82300,  stage: 'Stadio 4', daysInStage: 2  },
]

const STAGE_COLORS: Record<string, string> = {
  'Stadio 2': 'bg-blue-50 text-blue-700 border border-blue-200',
  'Stadio 3': 'bg-amber-50 text-amber-700 border border-amber-200',
  'Stadio 4': 'bg-teal-50 text-teal-700 border border-teal-200',
}

function fmt(v: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v)
}

export default function ProcessView() {
  const { sector } = useSector()
  const funnel = sector.funnel
  const maxCount = funnel[0]?.count ?? 1
  const hasMonetary = funnel.some((s) => s.value > 0)

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Processo</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {sector.name} · {sector.domain}
        </p>
      </div>

      {/* Timeline stages (4-stage lifecycle from sector) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-900 mb-6">Ciclo di Vita</h2>
        <div className="flex items-start gap-2 overflow-x-auto pb-2">
          {sector.processStages.map((stage, i) => {
            const style = STAGE_STYLES[i % STAGE_STYLES.length]
            const Icon = style.icon
            const funnelItem = funnel[Math.min(i, funnel.length - 1)]
            const avgDays = AVG_DAYS[i % AVG_DAYS.length]
            return (
              <div key={stage.key} className="flex items-start gap-2 flex-shrink-0">
                <div className={`rounded-xl border ${style.border} ${style.bg} p-4 w-40 text-center`}>
                  <div className="flex justify-center mb-2">
                    <Icon className={`w-6 h-6 ${style.color}`} />
                  </div>
                  <p className={`text-sm font-bold ${style.color}`}>{stage.label}</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{funnelItem?.count.toLocaleString('it-IT') ?? 0}</p>
                  {hasMonetary && funnelItem?.value ? (
                    <p className="text-xs text-slate-500 mt-0.5">{fmt(funnelItem.value)}</p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-0.5">—</p>
                  )}
                  <div className="mt-2 flex items-center justify-center gap-1 text-xs text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{avgDays}</span>
                  </div>
                </div>
                {i < sector.processStages.length - 1 && (
                  <div className="mt-10 text-slate-300 text-xl font-light flex-shrink-0">→</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Funnel bars (full funnel) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-900 mb-5">Funnel di Conversione</h2>
        <div className="space-y-3">
          {funnel.map((item, i) => {
            const pct = Math.round((item.count / maxCount) * 100)
            const opacity = 1 - i * 0.1
            return (
              <div key={item.stage} className="flex items-center gap-4">
                <span className="text-sm text-slate-600 w-44 flex-shrink-0">{item.stage}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center px-3 transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: `rgba(13,148,136,${opacity})` }}
                  >
                    <span className="text-xs font-semibold text-white">{item.count.toLocaleString('it-IT')}</span>
                  </div>
                </div>
                <span className="text-sm text-slate-500 w-28 text-right flex-shrink-0">
                  {item.value > 0 ? fmt(item.value) : '—'}
                </span>
                <span className="text-xs text-slate-400 w-10 text-right flex-shrink-0">{pct}%</span>
              </div>
            )
          })}
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500">
          Tasso di conversione: <strong className="text-teal-600">{Math.round((funnel[funnel.length - 1]?.count / Math.max(1, funnel[0]?.count)) * 100)}%</strong>
          {' · '}Stadi: <strong className="text-teal-600">{funnel.length}</strong>
        </div>
      </div>

      {/* Active cases */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-900 mb-4">Casi Attivi</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="text-left pb-2 font-medium">#</th>
                <th className="text-left pb-2 font-medium">Nome</th>
                <th className="text-left pb-2 font-medium">Fase</th>
                <th className="text-right pb-2 font-medium">Valore</th>
                <th className="text-right pb-2 font-medium">Giorni in fase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ACTIVE_CASES.map(c => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3 text-slate-400">#{c.id}</td>
                  <td className="py-3 text-slate-900 font-medium">{c.name}</td>
                  <td className="py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${STAGE_COLORS[c.stage] ?? 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                      {c.stage}
                    </span>
                  </td>
                  <td className="py-3 text-right text-slate-900">{fmt(c.value)}</td>
                  <td className={`py-3 text-right font-semibold ${c.daysInStage > 8 ? 'text-amber-600' : 'text-slate-600'}`}>
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
