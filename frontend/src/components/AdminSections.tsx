import { useEffect, useState } from 'react'
import {
  Users, UserPlus, Key, Plus, Bell, FileClock, MessageSquare, Mail, Webhook,
  Eye, EyeOff, Copy, Trash2, X, Loader2, CheckCircle2, Send, ShieldCheck,
  AlertCircle, MoreHorizontal, Globe, Filter, Lock, Sparkles, History,
} from 'lucide-react'
import { IS_DEMO_MODE } from '../lib/demoMode'
import { getTokenSubject } from '../api/client'
import { listAuditEntries, type BackendAuditEntry } from '../api/audit'

// ── Users & Roles ────────────────────────────────────────────────────────────

type UserRole = 'admin' | 'editor' | 'viewer'

interface User {
  id: string
  name: string
  email: string
  role: UserRole
  status: 'active' | 'pending'
  twoFA: boolean
  lastSeen: string
  avatar: string
  color: string
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:  'bg-purple-50 text-purple-700 border-purple-200',
  editor: 'bg-blue-50 text-blue-700 border-blue-200',
  viewer: 'bg-slate-100 text-slate-600 border-slate-200',
}

const ROLE_DESC: Record<UserRole, string> = {
  admin:  'Full access · manage users, tokens, governance',
  editor: 'Edit ontology, run agents, generate reports',
  viewer: 'Read-only access to dashboards and ontology',
}

const DEMO_USERS: User[] = [
  { id:'u1', name:'Francesca Di Lallo',  email:'francesca@semint.ai',     role:'admin',  status:'active',  twoFA:true,  lastSeen:'active now', avatar:'FD', color:'bg-teal-500' },
  { id:'u2', name:'Marco Rossi',          email:'marco.rossi@semint.ai',   role:'editor', status:'active',  twoFA:true,  lastSeen:'2h ago',     avatar:'MR', color:'bg-blue-500' },
  { id:'u3', name:'Giulia Ferrari',       email:'giulia.f@semint.ai',      role:'viewer', status:'active',  twoFA:false, lastSeen:'yesterday',  avatar:'GF', color:'bg-purple-500' },
  { id:'u4', name:'Luca Bianchi',         email:'luca.b@semint.ai',        role:'editor', status:'active',  twoFA:true,  lastSeen:'1 week ago', avatar:'LB', color:'bg-amber-500' },
  { id:'u5', name:'Alessandro Conti',     email:'alessandro.c@semint.ai',  role:'editor', status:'pending', twoFA:false, lastSeen:'—',          avatar:'AC', color:'bg-slate-400' },
]

// Live workspaces show the real logged-in account, not a fabricated team
function initialUsers(): User[] {
  if (IS_DEMO_MODE) return DEMO_USERS
  const sub = getTokenSubject()
  if (!sub) return []
  const initials = sub.slice(0, 2).toUpperCase()
  return [{
    id: 'me', name: sub, email: sub.includes('@') ? sub : '',
    role: 'admin', status: 'active', twoFA: false,
    lastSeen: 'active now', avatar: initials, color: 'bg-teal-500',
  }]
}

function InviteUserModal({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string, role: UserRole) => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('editor')
  const [sending, setSending] = useState(false)

  function handleSend() {
    if (!email.trim() || !email.includes('@')) return
    setSending(true)
    setTimeout(() => {
      onInvite(email.trim(), role)
      onClose()
    }, 800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-teal-600" />
            <h3 className="font-semibold text-slate-900">Invite team member</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-1">Email *</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-2">Role</label>
            <div className="space-y-1.5">
              {(['admin','editor','viewer'] as UserRole[]).map(r => (
                <label key={r} className={`flex items-start gap-3 p-2.5 border rounded-lg cursor-pointer transition-colors ${role === r ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input
                    type="radio"
                    name="role"
                    checked={role === r}
                    onChange={() => setRole(r)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 capitalize">{r}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${ROLE_COLORS[r]}`}>{r.toUpperCase()}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{ROLE_DESC[r]}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-400 flex items-start gap-1.5">
            <ShieldCheck className="w-3 h-3 mt-0.5 flex-shrink-0" />
            Invitee will receive an email with a one-time link valid 7 days. 2FA required at first login.
          </p>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Cancel</button>
          <button
            onClick={handleSend}
            disabled={!email.trim() || !email.includes('@') || sending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {sending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UsersSection() {
  const [users, setUsers] = useState<User[]>(initialUsers)
  const [showInvite, setShowInvite] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  function changeRole(id: string, role: UserRole) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u))
  }
  function removeUser(id: string) {
    setUsers(prev => prev.filter(u => u.id !== id))
    setOpenMenu(null)
  }
  function invite(email: string, role: UserRole) {
    const name = email.split('@')[0].replace(/[.]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    setUsers(prev => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        name: name,
        email,
        role,
        status: 'pending',
        twoFA: false,
        lastSeen: '—',
        avatar: initials,
        color: 'bg-slate-400',
      },
    ])
  }

  const activeUsers = users.filter(u => u.status === 'active')
  const admins = users.filter(u => u.role === 'admin').length
  const pending = users.filter(u => u.status === 'pending').length

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} onInvite={invite} />}

      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-600" />
            Users & Roles
          </h2>
          <p className="text-xs text-slate-500 mt-1">Role-based access control · 2FA enforced for admin and editor roles.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2 py-1 rounded-full">{activeUsers.length} active</span>
          <span className="text-xs bg-purple-50 text-purple-700 font-medium px-2 py-1 rounded-full">{admins} admin</span>
          {pending > 0 && <span className="text-xs bg-amber-50 text-amber-700 font-medium px-2 py-1 rounded-full">{pending} pending</span>}
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite
          </button>
        </div>
      </div>

      <div className="mt-5 border border-slate-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              {['Member','Role','2FA','Last seen',''].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full ${u.color} text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                      {u.avatar}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-slate-900 truncate">{u.name}</p>
                        {u.status === 'pending' && (
                          <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1 py-0.5 leading-none font-semibold">PENDING</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={e => changeRole(u.id, e.target.value as UserRole)}
                    className={`text-xs font-semibold border rounded px-2 py-1 outline-none cursor-pointer ${ROLE_COLORS[u.role]}`}
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  {u.twoFA ? (
                    <span className="inline-flex items-center gap-1 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded px-1.5 py-0.5">
                      <Lock className="w-3 h-3" /> On
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      <AlertCircle className="w-3 h-3" /> Off
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{u.lastSeen}</td>
                <td className="px-4 py-3 text-right relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === u.id ? null : u.id)}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {openMenu === u.id && (
                    <div className="absolute right-3 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 w-40 py-1">
                      {u.status === 'pending' && (
                        <button className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                          <Send className="w-3 h-3" /> Resend invite
                        </button>
                      )}
                      <button className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                        <Key className="w-3 h-3" /> Reset password
                      </button>
                      <button
                        onClick={() => removeUser(u.id)}
                        className="w-full text-left text-xs px-3 py-1.5 hover:bg-red-50 text-red-600 flex items-center gap-2"
                      >
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── API Tokens ───────────────────────────────────────────────────────────────

interface ApiToken {
  id: string
  name: string
  tokenPreview: string
  fullToken: string
  scopes: string[]
  createdAt: string
  lastUsed: string
  status: 'active' | 'expiring'
}

const TOKEN_SCOPES = [
  { key: 'read:ontology',  label: 'Read ontology' },
  { key: 'write:ontology', label: 'Edit ontology' },
  { key: 'read:agents',    label: 'Read agent state' },
  { key: 'write:agents',   label: 'Run/control agents' },
  { key: 'read:metrics',   label: 'Read metrics & KPIs' },
  { key: 'admin',          label: 'Administrative' },
]

const INITIAL_TOKENS: ApiToken[] = []

function randomToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'demo_token_'
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

function GenerateTokenModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, scopes: string[]) => void }) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['read:ontology'])
  const [generating, setGenerating] = useState(false)

  function toggleScope(key: string) {
    setScopes(prev => prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key])
  }

  function handleGenerate() {
    if (!name.trim() || scopes.length === 0) return
    setGenerating(true)
    setTimeout(() => {
      onCreate(name.trim(), scopes)
      onClose()
    }, 700)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-teal-600" />
            <h3 className="font-semibold text-slate-900">Generate API token</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-1">Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Mobile app integration"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:border-teal-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700 block mb-2">Scopes *</label>
            <div className="space-y-1">
              {TOKEN_SCOPES.map(s => (
                <label key={s.key} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s.key)}
                    onChange={() => toggleScope(s.key)}
                    className="rounded"
                  />
                  <span className="font-mono text-[11px] text-slate-700">{s.key}</span>
                  <span className="text-xs text-slate-400 flex-1">{s.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Cancel</button>
          <button
            onClick={handleGenerate}
            disabled={!name.trim() || scopes.length === 0 || generating}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'Generating…' : 'Generate token'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ApiTokensSection() {
  const [tokens, setTokens] = useState<ApiToken[]>(INITIAL_TOKENS)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [newToken, setNewToken] = useState<ApiToken | null>(null)

  function toggleReveal(id: string) {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function copyToken(token: string, id: string) {
    navigator.clipboard?.writeText(token).catch(() => {})
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  function revokeToken(id: string) {
    setTokens(prev => prev.filter(t => t.id !== id))
  }

  function createToken(name: string, scopes: string[]) {
    const full = randomToken()
    const preview = `${full.slice(0, 8)}••••••${full.slice(-4)}`
    const id = `t-${Date.now()}`
    const tok: ApiToken = {
      id, name, fullToken: full, tokenPreview: preview,
      scopes, createdAt: new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }),
      lastUsed: 'never', status: 'active',
    }
    setTokens(prev => [tok, ...prev])
    setNewToken(tok)
    setRevealed(prev => new Set([...prev, id]))
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      {showModal && <GenerateTokenModal onClose={() => setShowModal(false)} onCreate={createToken} />}

      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Key className="w-4 h-4 text-teal-600" />
            API Tokens
          </h2>
          <p className="text-xs text-slate-500 mt-1">Programmatic access keys · scope-limited · auto-rotated every 90 days.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2 py-1 rounded-full">{tokens.filter(t => t.status === 'active').length} active</span>
          {tokens.some(t => t.status === 'expiring') && (
            <span className="text-xs bg-amber-50 text-amber-700 font-medium px-2 py-1 rounded-full">{tokens.filter(t => t.status === 'expiring').length} expiring</span>
          )}
          <button
            onClick={() => { setNewToken(null); setShowModal(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Generate token
          </button>
        </div>
      </div>

      {newToken && (
        <div className="mt-4 bg-amber-50/60 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">Save this token — it won't be shown again</p>
              <div className="mt-2 flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-700 overflow-x-auto">
                <span className="flex-1 select-all">{newToken.fullToken}</span>
                <button
                  onClick={() => copyToken(newToken.fullToken, newToken.id)}
                  className="flex items-center gap-1 text-teal-700 hover:text-teal-900 font-medium text-[11px] flex-shrink-0"
                >
                  {copied === newToken.id ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === newToken.id ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button onClick={() => setNewToken(null)} className="mt-2 text-[11px] text-amber-700 hover:text-amber-900">I've saved it — dismiss</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 space-y-2">
        {tokens.map(t => {
          const isRevealed = revealed.has(t.id)
          const display = isRevealed ? t.fullToken : t.tokenPreview
          return (
            <div key={t.id} className={`border rounded-xl p-4 transition-colors ${t.status === 'expiring' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                    {t.status === 'expiring' && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 leading-none">EXPIRES IN 7 DAYS</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1">{display}</span>
                    <button
                      onClick={() => toggleReveal(t.id)}
                      className="text-slate-400 hover:text-slate-700 transition-colors p-1"
                      title={isRevealed ? 'Hide' : 'Reveal'}
                    >
                      {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => copyToken(t.fullToken, t.id)}
                      className="text-slate-400 hover:text-teal-700 transition-colors p-1"
                      title="Copy"
                    >
                      {copied === t.id ? <CheckCircle2 className="w-3.5 h-3.5 text-teal-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.scopes.map(s => (
                      <span key={s} className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{s}</span>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-400">
                    <span>Created {t.createdAt}</span>
                    <span>·</span>
                    <span>Last used <strong className="text-slate-600">{t.lastUsed}</strong></span>
                  </div>
                </div>
                <button
                  onClick={() => revokeToken(t.id)}
                  className="text-xs text-slate-400 hover:text-red-600 transition-colors flex items-center gap-1 flex-shrink-0 px-2 py-1 rounded hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Revoke
                </button>
              </div>
            </div>
          )
        })}

        {tokens.length === 0 && (
          <div className="border border-dashed border-slate-300 rounded-xl p-6 text-center text-xs text-slate-500 bg-slate-50">
            No API tokens configured. Generate a token to grant programmatic access.
          </div>
        )}
      </div>
    </section>
  )
}

// ── Notification Channels ────────────────────────────────────────────────────

type ChannelType = 'slack' | 'email' | 'teams' | 'webhook'
type Severity = 'critical' | 'warning' | 'info'

interface Channel {
  id: string
  name: string
  type: ChannelType
  destination: string
  enabled: boolean
}

const CHANNEL_META: Record<ChannelType, { icon: typeof MessageSquare; color: string; bg: string; label: string }> = {
  slack:   { icon: MessageSquare, color: 'text-purple-600', bg: 'bg-purple-50', label: 'Slack' },
  email:   { icon: Mail,          color: 'text-blue-600',   bg: 'bg-blue-50',   label: 'Email' },
  teams:   { icon: MessageSquare, color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'Teams' },
  webhook: { icon: Webhook,       color: 'text-amber-600',  bg: 'bg-amber-50',  label: 'Webhook' },
}

const SEVERITY_META: Record<Severity, { label: string; color: string; bg: string; dot: string }> = {
  critical: { label: 'Critical', color: 'text-red-700',    bg: 'bg-red-50 border-red-200',       dot: 'bg-red-500'    },
  warning:  { label: 'Warning',  color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',  dot: 'bg-amber-500'  },
  info:     { label: 'Info',     color: 'text-slate-600',  bg: 'bg-slate-50 border-slate-200',   dot: 'bg-slate-400'  },
}

const DEMO_CHANNELS: Channel[] = [
  { id:'c1', name:'#ops-alerts',         type:'slack',   destination:'semint.slack.com / #ops-alerts',    enabled:true  },
  { id:'c2', name:'Ops Email Group',     type:'email',   destination:'ops@semint.ai',                      enabled:true  },
  { id:'c3', name:'Compliance Channel',  type:'teams',   destination:'Teams · Compliance',                 enabled:false },
  { id:'c4', name:'PagerDuty webhook',   type:'webhook', destination:'events.pagerduty.com/v2/enqueue',    enabled:true  },
]

const DEMO_ROUTING: Record<Severity, string[]> = {
  critical: ['c1','c2','c4'],
  warning:  ['c1','c2'],
  info:     [],
}

const INITIAL_CHANNELS: Channel[] = IS_DEMO_MODE ? DEMO_CHANNELS : []
const INITIAL_ROUTING: Record<Severity, string[]> = IS_DEMO_MODE
  ? DEMO_ROUTING
  : { critical: [], warning: [], info: [] }

type ChannelTest = { state: 'idle' | 'testing' | 'ok'; latency?: number }

export function NotificationsSection() {
  const [channels, setChannels] = useState<Channel[]>(INITIAL_CHANNELS)
  const [routing, setRouting] = useState<Record<Severity, string[]>>(INITIAL_ROUTING)
  const [tests, setTests] = useState<Record<string, ChannelTest>>({})

  function toggleChannel(id: string) {
    setChannels(prev => prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c))
  }

  function testChannel(id: string) {
    setTests(prev => ({ ...prev, [id]: { state: 'testing' } }))
    setTimeout(() => {
      setTests(prev => ({ ...prev, [id]: { state: 'ok', latency: Math.floor(80 + Math.random() * 280) } }))
      setTimeout(() => setTests(prev => ({ ...prev, [id]: { state: 'idle' } })), 3000)
    }, 700 + Math.random() * 800)
  }

  function toggleRoute(sev: Severity, channelId: string) {
    setRouting(prev => ({
      ...prev,
      [sev]: prev[sev].includes(channelId) ? prev[sev].filter(c => c !== channelId) : [...prev[sev], channelId],
    }))
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Bell className="w-4 h-4 text-teal-600" />
            Notification Channels
          </h2>
          <p className="text-xs text-slate-500 mt-1">Where agent findings, pipeline events and governance alerts are delivered.</p>
        </div>
        <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2 py-1 rounded-full">
          {channels.filter(c => c.enabled).length}/{channels.length} active
        </span>
      </div>

      {channels.length === 0 && (
        <div className="mt-5 border-2 border-dashed border-slate-200 rounded-xl py-8 text-center">
          <Bell className="w-6 h-6 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-500">No notification channels configured</p>
          <p className="text-xs text-slate-400 mt-1">Connect Slack, email, Teams, or a webhook to receive agent findings and alerts.</p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
        {channels.map(c => {
          const meta = CHANNEL_META[c.type]
          const Icon = meta.icon
          const test = tests[c.id] ?? { state: 'idle' as const }
          return (
            <div key={c.id} className={`border rounded-xl p-4 transition-colors ${c.enabled ? 'bg-white border-slate-200' : 'bg-slate-50/50 border-slate-200'}`}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-semibold ${c.enabled ? 'text-slate-900' : 'text-slate-400'}`}>{c.name}</p>
                    <span className="text-[9px] font-bold bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 leading-none uppercase">{meta.label}</span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{c.destination}</p>
                </div>
                <button
                  onClick={() => toggleChannel(c.id)}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${c.enabled ? 'bg-teal-500' : 'bg-slate-200'}`}
                >
                  <div className={`absolute top-0.5 ${c.enabled ? 'right-0.5' : 'left-0.5'} w-4 h-4 bg-white rounded-full shadow-sm transition-all`} />
                </button>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                {test.state === 'ok' ? (
                  <span className="text-xs text-teal-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Test delivered · {test.latency}ms
                  </span>
                ) : test.state === 'testing' ? (
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Sending test…
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Last test: a few hours ago</span>
                )}
                <button
                  onClick={() => testChannel(c.id)}
                  disabled={!c.enabled || test.state === 'testing'}
                  className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                    !c.enabled || test.state === 'testing' ? 'text-slate-300 cursor-not-allowed' : 'text-teal-600 hover:bg-teal-50'
                  }`}
                >
                  <Send className="w-3 h-3 inline mr-0.5" />
                  Send test
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Routing matrix */}
      <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-700">Severity routing</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Choose which channels receive each severity level.</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Severity</th>
              {channels.map(c => (
                <th key={c.id} className="px-2 py-2 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap">
                  {c.name.replace(/^#/, '').slice(0, 14)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['critical','warning','info'] as Severity[]).map(sev => {
              const meta = SEVERITY_META[sev]
              return (
                <tr key={sev} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded border ${meta.bg} ${meta.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </td>
                  {channels.map(c => (
                    <td key={c.id} className="px-2 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={routing[sev].includes(c.id) && c.enabled}
                        disabled={!c.enabled}
                        onChange={() => toggleRoute(sev, c.id)}
                        className="rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ── Audit Log ────────────────────────────────────────────────────────────────

type AuditCategory = 'auth' | 'config' | 'data' | 'reports'

interface AuditEntry {
  id: string
  ts: string
  user: string
  avatar: string
  avatarColor: string
  action: string
  resource: string
  ip: string
  category: AuditCategory
}

const CATEGORY_META: Record<AuditCategory, { label: string; color: string; bg: string; dot: string }> = {
  auth:    { label: 'Auth',    color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', dot: 'bg-purple-500' },
  config:  { label: 'Config',  color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',     dot: 'bg-blue-500'   },
  data:    { label: 'Data',    color: 'text-teal-700',   bg: 'bg-teal-50 border-teal-200',     dot: 'bg-teal-500'   },
  reports: { label: 'Reports', color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',   dot: 'bg-amber-500'  },
}

const DEMO_AUDIT: AuditEntry[] = [
  { id:'a1',  ts:'just now',   user:'Francesca Di Lallo', avatar:'FD', avatarColor:'bg-teal-500',   action:'Generated executive report', resource:'manufacturing · 20 May 2026', ip:'94.32.118.4',  category:'reports' },
  { id:'a2',  ts:'2m ago',     user:'Marco Rossi',         avatar:'MR', avatarColor:'bg-blue-500',   action:'Triggered pipeline run',     resource:'pipeline · manufacturing',     ip:'94.32.118.7',  category:'data'    },
  { id:'a3',  ts:'12m ago',    user:'Francesca Di Lallo', avatar:'FD', avatarColor:'bg-teal-500',   action:'Updated governance rule',    resource:'Human-in-the-loop · enabled',  ip:'94.32.118.4',  category:'config'  },
  { id:'a4',  ts:'34m ago',    user:'API · Datadog',       avatar:'DD', avatarColor:'bg-slate-500',  action:'Token used',                 resource:'token_ref_7d2f · read:metrics', ip:'52.40.21.118', category:'auth'    },
  { id:'a5',  ts:'1h ago',     user:'Marco Rossi',         avatar:'MR', avatarColor:'bg-blue-500',   action:'Added connector',            resource:'Snowflake DWH',                ip:'94.32.118.7',  category:'config'  },
  { id:'a6',  ts:'1h ago',     user:'Giulia Ferrari',      avatar:'GF', avatarColor:'bg-purple-500', action:'Logged in',                  resource:'2FA verified · Chrome 134',    ip:'93.41.227.21', category:'auth'    },
  { id:'a7',  ts:'2h ago',     user:'Francesca Di Lallo', avatar:'FD', avatarColor:'bg-teal-500',   action:'Ran agent',                  resource:'Risk Scoring Agent',           ip:'94.32.118.4',  category:'data'    },
  { id:'a8',  ts:'3h ago',     user:'Luca Bianchi',        avatar:'LB', avatarColor:'bg-amber-500',  action:'Edited ontology mapping',    resource:'mfg:Order.totalValue',         ip:'78.13.94.201', category:'config'  },
  { id:'a9',  ts:'4h ago',     user:'API · CI/CD',         avatar:'CI', avatarColor:'bg-slate-500',  action:'Token used',                 resource:'token_ref_a14c · read:ontology', ip:'18.221.4.87',  category:'auth'    },
  { id:'a10', ts:'yesterday',  user:'Francesca Di Lallo', avatar:'FD', avatarColor:'bg-teal-500',   action:'Invited user',               resource:'alessandro.c@semint.ai · editor', ip:'94.32.118.4',  category:'auth'    },
  { id:'a11', ts:'yesterday',  user:'Marco Rossi',         avatar:'MR', avatarColor:'bg-blue-500',   action:'Exported report',            resource:'finance · Q1-2026',            ip:'94.32.118.7',  category:'reports' },
  { id:'a12', ts:'2 days ago', user:'Francesca Di Lallo', avatar:'FD', avatarColor:'bg-teal-500',   action:'Generated API token',        resource:'Production CI/CD',             ip:'94.32.118.4',  category:'auth'    },
  { id:'a13', ts:'2 days ago', user:'Giulia Ferrari',      avatar:'GF', avatarColor:'bg-purple-500', action:'Viewed audit log',           resource:'audit · last 7d',              ip:'93.41.227.21', category:'auth'    },
  { id:'a14', ts:'3 days ago', user:'System',              avatar:'SY', avatarColor:'bg-slate-700',  action:'Auto-rotated AI key',        resource:'claude-haiku-4',               ip:'system',       category:'config'  },
  { id:'a15', ts:'1 week ago', user:'Francesca Di Lallo', avatar:'FD', avatarColor:'bg-teal-500',   action:'Switched sector template',   resource:'manufacturing → retail',       ip:'94.32.118.4',  category:'config'  },
]

const FILTERS: Array<{ key: AuditCategory | 'all'; label: string }> = [
  { key: 'all',     label: 'All' },
  { key: 'auth',    label: 'Auth' },
  { key: 'config',  label: 'Config' },
  { key: 'data',    label: 'Data' },
  { key: 'reports', label: 'Reports' },
]

const AVATAR_COLORS = ['bg-teal-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500']

function backendToAuditEntry(e: BackendAuditEntry): AuditEntry {
  const d = new Date(e.ts)
  const secs = Math.round((Date.now() - d.getTime()) / 1000)
  const ts = secs < 60 ? 'just now'
    : secs < 3600 ? `${Math.round(secs / 60)}m ago`
    : secs < 86400 ? `${Math.round(secs / 3600)}h ago`
    : d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
  const initials = e.username.slice(0, 2).toUpperCase()
  // Stable colour per username so the same actor always gets the same avatar
  const colorIdx = [...e.username].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length
  return {
    id: String(e.id),
    ts,
    user: e.username,
    avatar: initials,
    avatarColor: AVATAR_COLORS[colorIdx],
    action: e.action,
    resource: e.resource,
    ip: e.ip || '—',
    category: e.category,
  }
}

export function AuditLogSection() {
  const [filter, setFilter] = useState<AuditCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  const [liveEntries, setLiveEntries] = useState<AuditEntry[]>([])

  // Live audit trail comes from the backend; the curated entries are demo-only
  useEffect(() => {
    if (IS_DEMO_MODE) return
    listAuditEntries({ limit: 200 })
      .then(rows => setLiveEntries(rows.map(backendToAuditEntry)))
      .catch(() => {})
  }, [])

  const entries = IS_DEMO_MODE ? DEMO_AUDIT : liveEntries
  const filtered = entries.filter(e => {
    if (filter !== 'all' && e.category !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return e.user.toLowerCase().includes(q) || e.action.toLowerCase().includes(q) || e.resource.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <FileClock className="w-4 h-4 text-teal-600" />
            Audit Log
          </h2>
          <p className="text-xs text-slate-500 mt-1">Immutable record of admin and API actions · retained 7 years for EU AI Act Art. 12.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-slate-100 text-slate-600 font-medium px-2 py-1 rounded-full">{filtered.length} entries</span>
          <button className="text-xs text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1">
            <History className="w-3 h-3" /> Export CSV
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3 h-3 text-slate-400" />
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                filter === f.key
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search action, user, resource…"
          className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:border-teal-400 outline-none w-56"
        />
      </div>

      <div className="mt-4 border border-slate-100 rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-100">
              {['When','Who','Action','Resource','IP'].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-400">
                  {entries.length === 0
                    ? 'No audit events recorded yet — admin and API actions will appear here.'
                    : 'No audit entries match your filter.'}
                </td>
              </tr>
            ) : filtered.map(e => {
              const cat = CATEGORY_META[e.category]
              return (
                <tr key={e.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap font-mono">{e.ts}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full ${e.avatarColor} text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0`}>
                        {e.avatar}
                      </div>
                      <span className="text-xs text-slate-700">{e.user}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${cat.dot}`} />
                      <span className="text-xs text-slate-800">{e.action}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${cat.bg} ${cat.color}`}>{cat.label.toUpperCase()}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">{e.resource}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 font-mono">
                    <span className="inline-flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      {e.ip}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
