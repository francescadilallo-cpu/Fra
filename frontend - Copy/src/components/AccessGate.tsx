import { useState } from 'react'
import { Brain, Eye, EyeOff, Lock } from 'lucide-react'
import { login } from '../api/client'

export const SESSION_KEY = 'si-access-granted'

export default function AccessGate({ onGrant }: { onGrant: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [shake, setShake] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!username.trim() || !password.trim()) return
    setLoading(true)
    try {
      await login(username.trim(), password)
      onGrant()
    } catch {
      setShake(true)
      setError('Invalid credentials or authentication service unavailable.')
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
            Semantic<span className="text-teal-400">Intelligence</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">Semantic Data Layer Platform</p>
        </div>

        {/* Card */}
        <div
          className={`bg-white rounded-2xl shadow-2xl p-7 transition-all ${shake ? 'animate-shake' : ''}`}
          style={shake ? { animation: 'shake 0.4s ease-in-out' } : {}}
        >
          <div className="flex items-center gap-2 mb-5">
            <Lock className="w-4 h-4 text-slate-400" />
            <p className="text-sm font-semibold text-slate-700">Secure Access</p>
          </div>

          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(null) }}
            onKeyDown={e => e.key === 'Enter' && void submit()}
            placeholder="Username"
            autoFocus
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none transition-colors border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 focus:border-teal-400 focus:bg-white"
          />

          <label className="block text-xs font-medium text-slate-500 mb-1.5 mt-3">
            Password
          </label>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              onKeyDown={e => e.key === 'Enter' && void submit()}
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

          {error && (
            <p className="text-xs text-red-500 mt-1.5">{error}</p>
          )}

          <button
            onClick={() => void submit()}
            disabled={loading || !username.trim() || !password.trim()}
            className="w-full mt-4 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Authorized access only
        </p>
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
