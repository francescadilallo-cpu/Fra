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
            Explore the Demo →
          </button>
        </div>
      </section>

      {/* ── Problem: metrics ──────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">
            01 — THE PROBLEM
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            <span className="font-extrabold">95%</span> of enterprise AI initiatives fail
          </h2>

          <div className="grid grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-red-500">
              <p className="text-4xl font-extrabold text-red-500 mb-2">95%</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                of enterprise AI initiatives generate no value
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Only 5% of custom AI solutions reach production scale
              </p>
              <p className="text-xs text-slate-400 italic">
                Source: MIT / World Economic Forum
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-500">
              <p className="text-4xl font-extrabold text-amber-500 mb-2">42%</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                of companies abandoned AI projects in 2025
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Up from 17% the year before
              </p>
              <p className="text-xs text-slate-400 italic">Source: S&amp;P Global</p>
            </div>

            {/* Card 3 */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-teal-500">
              <p className="text-4xl font-extrabold text-teal-600 mb-2">2-4 years</p>
              <p className="text-sm font-semibold text-slate-900 mb-1">
                average time to see the expected ROI of 7-12 months
              </p>
              <p className="text-xs text-slate-500 mb-3">
                Only 6% of EU executives see returns within 12 months
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
            01 — THE PROBLEM
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            Companies are racing toward AI{' '}
            <span className="font-extrabold">and getting nothing in return</span>
          </h2>

          <div className="grid grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-red-400">
              <div className="text-2xl mb-3">🗄️</div>
              <h3 className="font-semibold text-slate-900 mb-2">Fragmented Data</h3>
              <p className="text-sm text-slate-500">
                ERP, CRM, MES, Excel sheets — each with its own language. No reliable AI output.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-400">
              <div className="text-2xl mb-3">🍝</div>
              <h3 className="font-semibold text-slate-900 mb-2">Spaghetti AI</h3>
              <p className="text-sm text-slate-500">
                Each business function launches its own AI project with different logic, vendors, and metrics.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-orange-400">
              <div className="text-2xl mb-3">🤖</div>
              <h3 className="font-semibold text-slate-900 mb-2">Hallucinating Agents</h3>
              <p className="text-sm text-slate-500">
                Agents on undefined data produce unverifiable outputs. Companies lose trust.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Solution ──────────────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100 bg-slate-50">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">
            02 — THE SOLUTION
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            The answer is not more AI.{' '}
            <span className="font-extrabold">It is the foundation beneath it.</span>
          </h2>

          <div className="grid grid-cols-2 gap-6">
            {/* Semantic Foundation */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-teal-500">
              <h3 className="font-semibold text-slate-900 text-lg mb-2">
                The Semantic Foundation
              </h3>
              <p className="text-sm text-slate-500 mb-5">
                A formal semantic model of the business, structured into two interconnected layers.
              </p>
              <div className="space-y-3">
                <div className="bg-teal-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-teal-800">Ontological Layer</p>
                  <p className="text-xs text-teal-700 mt-0.5">
                    Defines entities, relations and rules across all systems
                  </p>
                </div>
                <div className="bg-teal-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-teal-800">Executive Layer</p>
                  <p className="text-xs text-teal-700 mt-0.5">
                    Translates agent decisions into real actions on the systems
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
                Built on the semantic foundation, AI agents share context, hand off tasks and generate value across the organization.
              </p>
              <div className="space-y-3">
                <div className="bg-amber-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">MCP-compatible API layer</p>
                </div>
                <div className="bg-amber-50 rounded-lg px-4 py-3">
                  <p className="text-sm font-semibold text-amber-800">Verified common vocabulary</p>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-8 text-center text-sm text-slate-500 italic">
            Most companies build AI agents on sand. We help you build them on rock.
          </p>
        </div>
      </section>

      {/* ── Market ────────────────────────────────────────────────────────── */}
      <section className="px-12 py-14 border-b border-slate-100">
        <div className="max-w-5xl">
          <span className="text-xs font-semibold tracking-widest text-teal-600 uppercase">
            04 — MARKET OPPORTUNITY
          </span>
          <h2 className="mt-3 text-3xl font-bold text-slate-900 mb-10">
            A <span className="font-extrabold">$7.7B</span> market growing at 23% —{' '}
            <span className="font-extrabold">with a gap in the EU mid-market</span>
          </h2>

          <div className="space-y-4">
            {/* Row 1 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-6 border-l-4 border-l-teal-500">
              <p className="text-2xl font-bold text-teal-600 w-28 flex-shrink-0">$2.71B</p>
              <div>
                <p className="text-sm font-semibold text-slate-900">Market size 2025</p>
                <p className="text-xs text-slate-500">growing to $7.73B by 2030</p>
              </div>
            </div>

            {/* Row 2 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-6 border-l-4 border-l-teal-500">
              <p className="text-2xl font-bold text-teal-600 w-28 flex-shrink-0">23.3%</p>
              <div>
                <p className="text-sm font-semibold text-slate-900">CAGR 2025-2030</p>
                <p className="text-xs text-slate-500">services segment: 27.8% CAGR</p>
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
                  No player combines formal ontology + AI-assisted deployment + agentic layer for the EU mid-market.{' '}
                  <span className="font-semibold text-slate-700">
                    This is our structural entry point.
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
            We build the semantic layer
            <br />
            every AI-powered company
            <br />
            <span className="font-extrabold">in Europe needs</span>
          </h2>

          <ul className="text-sm text-slate-600 space-y-2 mb-10 text-left inline-block">
            {[
              '$7.7B market · 23% CAGR · underserved EU mid-market',
              'Zero direct competitors in our exact positioning',
              'Revenue from day one via consulting model',
              'EU AI Act creates immediate regulatory tailwind',
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
              Explore the Demo →
            </button>
          </div>
        </div>
      </section>

    </div>
  )
}
