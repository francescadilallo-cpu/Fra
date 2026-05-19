import type { NavTab } from '../types'

interface Props {
  onNavigate: (tab: NavTab) => void
}

export default function OverviewScreen({ onNavigate }: Props) {
  return (
    <div className="min-h-full bg-white text-slate-900 overflow-auto">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="px-12 py-16 border-b border-slate-100">
        <div className="max-w-3xl">
          <span className="inline-block text-xs font-semibold tracking-widest text-teal-600 uppercase mb-6">
            Pitch · 2026
          </span>

          <h1 className="text-4xl font-bold text-slate-900 leading-tight mb-3">
            Semantic<span className="text-teal-600">Intelligence</span>
          </h1>
          <p className="text-lg text-slate-500 mb-8">
            The Missing Infrastructure Layer for Enterprise AI
          </p>

          <blockquote className="border-l-2 border-teal-500 pl-4 mb-10">
            <p className="italic text-slate-600 text-base leading-relaxed">
              "We build the foundation that turns European mid-market companies into true Agentic
              Organizations — where AI agents operate on trusted, shared knowledge and every
              decision is traceable, compliant, and fast."
            </p>
          </blockquote>

          <button
            onClick={() => onNavigate('dashboard')}
            className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors"
          >
            Esplora la Demo →
          </button>
        </div>
      </section>

      {/* ── Problem: metrics ──────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">
            01 — IL PROBLEMA
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            Il <span className="font-extrabold">95%</span> delle iniziative AI in azienda fallisce
          </h2>

          <div className="grid grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-red-500">
              <p className="text-4xl font-extrabold text-red-500 mb-2">95%</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                delle iniziative AI enterprise non genera valore
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Solo il 5% delle soluzioni AI custom raggiunge la scala produttiva
              </p>
              <p className="text-xs text-slate-400 italic">
                Source: MIT / World Economic Forum
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-500">
              <p className="text-4xl font-extrabold text-amber-500 mb-2">42%</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                delle aziende ha abbandonato i progetti AI nel 2025
              </p>
              <p className="text-xs text-slate-500 mb-3">
                In aumento dal 17% dell'anno precedente
              </p>
              <p className="text-xs text-slate-400 italic">Source: S&amp;P Global</p>
            </div>

            {/* Card 3 */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-teal-500">
              <p className="text-4xl font-extrabold text-teal-600 mb-2">2-4 anni</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                tempo medio per vedere il ROI atteso di 7-12 mesi
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Solo il 6% dei dirigenti EU vede ritorni entro 12 mesi
              </p>
              <p className="text-xs text-slate-400 italic">Source: Deloitte EU</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Problem: root causes ──────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">
            01 — IL PROBLEMA
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            Le aziende corrono verso l'AI{' '}
            <span className="font-extrabold">e non ottengono nulla in cambio</span>
          </h2>

          <div className="grid grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-red-400">
              <div className="text-2xl mb-3">🗄️</div>
              <h3 className="font-semibold text-slate-900 mb-2">Dati Frammentati</h3>
              <p className="text-sm text-slate-500">
                ERP, CRM, MES, fogli Excel — ognuno con il proprio linguaggio. Nessun output AI
                affidabile.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-400">
              <div className="text-2xl mb-3">🍝</div>
              <h3 className="font-semibold text-slate-900 mb-2">Spaghetti AI</h3>
              <p className="text-sm text-slate-500">
                Ogni funzione aziendale lancia il proprio progetto AI con logiche, vendor e
                metriche diverse.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-orange-400">
              <div className="text-2xl mb-3">🤖</div>
              <h3 className="font-semibold text-slate-900 mb-2">Agenti che Allucinano</h3>
              <p className="text-sm text-slate-500">
                Agenti su dati non definiti producono output non verificabili. Le aziende perdono
                fiducia.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Solution ──────────────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">
            02 — LA SOLUZIONE
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            La risposta non è più AI.{' '}
            <span className="font-extrabold">È la fondazione sotto di essa.</span>
          </h2>

          <div className="grid grid-cols-2 gap-6">
            {/* Semantic Foundation */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-teal-500">
              <h3 className="font-semibold text-slate-900 text-lg mb-2">
                The Semantic Foundation
              </h3>
              <p className="text-sm text-slate-500 mb-5">
                Un modello semantico formale del business, strutturato in due layer interconnessi.
              </p>
              <div className="space-y-3">
                <div className="bg-teal-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-teal-800">Ontological Layer</p>
                  <p className="text-xs text-teal-700 mt-0.5">
                    Definisce entità, relazioni e regole attraverso tutti i sistemi
                  </p>
                </div>
                <div className="bg-teal-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-teal-800">Executive Layer</p>
                  <p className="text-xs text-teal-700 mt-0.5">
                    Traduce le decisioni degli agenti in azioni reali sui sistemi
                  </p>
                </div>
              </div>
            </div>

            {/* Agentic Orchestration */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-400">
              <h3 className="font-semibold text-slate-900 text-lg mb-2">
                Agentic Orchestration
              </h3>
              <p className="text-sm text-slate-500 mb-5">
                Costruito sulla fondazione semantica, gli agenti AI condividono contesto, passano
                task e generano valore in tutta l'organizzazione.
              </p>
              <div className="space-y-3">
                <div className="bg-amber-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">MCP-compatible API layer</p>
                </div>
                <div className="bg-amber-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">Vocabolario comune verificato</p>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-8 text-center text-sm text-slate-500 italic">
            La maggior parte delle aziende costruisce agenti AI sulla sabbia. Noi ti aiutiamo a
            costruirli sulla roccia.
          </p>
        </div>
      </section>

      {/* ── Market ────────────────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">
            04 — OPPORTUNITÀ DI MERCATO
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            Un mercato da <span className="font-extrabold">$7.7B</span> che cresce al 23% —{' '}
            <span className="font-extrabold">con un gap nel mid-market EU</span>
          </h2>

          <div className="space-y-4">
            {/* Row 1 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-6 border-l-4 border-l-teal-500">
              <p className="text-2xl font-bold text-teal-600 w-28 flex-shrink-0">$2.71B</p>
              <div>
                <p className="text-sm font-semibold text-slate-900">Market size 2025</p>
                <p className="text-xs text-slate-500">crescita a $7.73B entro il 2030</p>
              </div>
            </div>

            {/* Row 2 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-6 border-l-4 border-l-teal-500">
              <p className="text-2xl font-bold text-teal-600 w-28 flex-shrink-0">23.3%</p>
              <div>
                <p className="text-sm font-semibold text-slate-900">CAGR 2025-2030</p>
                <p className="text-xs text-slate-500">segmento servizi: 27.8% CAGR</p>
              </div>
            </div>

            {/* Row 3 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-6 border-l-4 border-l-teal-500">
              <p className="text-2xl font-bold text-teal-600 w-28 flex-shrink-0 leading-tight">
                EU Mid-Market
              </p>
              <div>
                <p className="text-sm font-semibold text-slate-900">White Space</p>
                <p className="text-xs text-slate-500">
                  Nessun player combina ontologia formale + deployment AI-assisted + layer agentico
                  per il mid-market EU.{' '}
                  <span className="font-semibold text-slate-700">
                    Questo è il nostro punto di ingresso strutturale.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Footer ────────────────────────────────────────────────────── */}
      <section className="px-12 py-20 bg-slate-50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-slate-900 leading-snug mb-8">
            Costruiamo il semantic layer
            <br />
            di cui ogni azienda AI-powered
            <br />
            <span className="font-extrabold">in Europa ha bisogno</span>
          </h2>

          <ul className="text-sm text-slate-600 space-y-2 mb-10 text-left inline-block">
            {[
              '$7.7B market · 23% CAGR · EU mid-market non servito',
              'Zero competitor diretti nel nostro posizionamento esatto',
              'Revenue dal primo giorno via modello consulting',
              'EU AI Act crea tailwind regolatorio immediato',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="text-teal-600 font-bold flex-shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>

          <div>
            <button
              onClick={() => onNavigate('dashboard')}
              className="bg-teal-600 text-white rounded-lg px-6 py-3 text-sm font-semibold hover:bg-teal-700 transition-colors"
            >
              Esplora la Demo →
            </button>
          </div>
        </div>
      </section>

    </div>
  )
}
