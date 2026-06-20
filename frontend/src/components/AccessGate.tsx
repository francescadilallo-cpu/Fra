import { useState } from 'react'
import { Brain, Eye, EyeOff, Lock, ArrowLeft, Database, Sparkles } from 'lucide-react'
import { login } from '../api/client'

export const SESSION_KEY = 'si-access-granted'

type Step = 'credentials' | 'mode'
type Mode = 'demo' | 'live'

export default function AccessGate({ onGrant }: { onGrant: () => void }) {
  const [step, setStep] = useState<Step>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [shake, setShake] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function goToMode() {
    if (!username.trim() || !password.trim()) return
    setError(null)
    setStep('mode')
  }

  async function selectMode(mode: Mode) {
    setLoading(true)
    try {
      await login(username.trim(), password, mode)
      onGrant()
    } catch {
      setShake(true)
      setError('Invalid credentials — please go back and try again.')
      setStep('credentials')
      setPassword('')
      setTimeout(() => setShake(false), 500)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-teal-500/10 ring-1 ring-teal-500/25 flex items-center justify-center mb-4">
            <Brain className="w-7 h-7 text-teal-400" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Data<span className="text-teal-400">Intelligence</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">Data Intelligence Platform</p>
        </div>

        {/* Step 1 — Credentials */}
        {step === 'credentials' && (
          <div
            className={`bg-white rounded-2xl shadow-2xl p-7 transition-all ${shake ? 'animate-shake' : ''}`}
            style={shake ? { animation: 'shake 0.4s ease-in-out' } : {}}
          >
            <div className="flex items-center gap-2 mb-5">
              <Lock className="w-4 h-4 text-slate-400" />
              <p className="text-sm font-semibold text-slate-700">Secure Access</p>
            </div>

            <label className="block text-xs font-medium text-slate-500 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(null) }}
              onKeyDown={e => e.key === 'Enter' && goToMode()}
              placeholder="Username"
              autoFocus
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none transition-colors border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:bg-white"
            />

            <label className="block text-xs font-medium text-slate-500 mb-1.5 mt-3">Password</label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null) }}
                onKeyDown={e => e.key === 'Enter' && goToMode()}
                placeholder="Password"
                className={`w-full px-4 py-2.5 pr-10 rounded-lg border text-sm outline-none transition-colors ${
                  error
                    ? 'border-red-300 bg-red-50 text-red-900 placeholder-red-400'
                    : 'border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:bg-white'
                }`}
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}

            <button
              onClick={goToMode}
              disabled={!username.trim() || !password.trim()}
              className="w-full mt-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 2 — Mode selection */}
        {step === 'mode' && (
          <div className="bg-white rounded-2xl shadow-2xl p-7">
            <button
              onClick={() => { setStep('credentials'); setError(null) }}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-5"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>

            <p className="text-sm font-semibold text-slate-700 mb-1">Choose your workspace</p>
            <p className="text-xs text-slate-400 mb-5">You can change this later in settings.</p>

            <div className="flex flex-col gap-3">
              {/* Demo mode */}
              <button
                onClick={() => void selectMode('demo')}
                disabled={loading}
                className="group text-left border-2 border-slate-200 hover:border-teal-400 hover:bg-teal-50 rounded-xl p-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-teal-100 group-hover:bg-teal-200 flex items-center justify-center flex-shrink-0 transition-colors">
                    <Sparkles className="w-4 h-4 text-teal-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 mb-0.5">Demo — AdventureWorks</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Explore with pre-loaded bicycle manufacturing data — 4 connected sources, real data ambiguities, Data Model already built.
                    </p>
                  </div>
                </div>
              </button>

              {/* Live mode */}
              <button
                onClick={() => void selectMode('live')}
                disabled={loading}
                className="group text-left border-2 border-slate-200 hover:border-violet-400 hover:bg-violet-50 rounded-xl p-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-violet-100 group-hover:bg-violet-200 flex items-center justify-center flex-shrink-0 transition-colors">
                    <Database className="w-4 h-4 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 mb-0.5">Live — Your data</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Start fresh with your own data sources. Connect ERP, CRM, HR or any file — your data model builds from scratch.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            {loading && (
              <p className="text-xs text-slate-400 text-center mt-4 animate-pulse">Signing in…</p>
            )}
          </div>
        )}

        <p className="text-center text-xs text-slate-600 mt-6">Authorized access only</p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-8px); }
          40%       { transform: translateX(8px); }
          60%       { transform: translateX(-5px); }
          80%       { transform: translateX(5px); }
        }
      `}</style>
    </div>
  )
}
