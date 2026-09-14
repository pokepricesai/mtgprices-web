'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import OnboardingEmailTester from '@/components/admin/OnboardingEmailTester'
import OnboardingAutomationStatus from '@/components/admin/OnboardingAutomationStatus'
// Block 5A-W-47C-FIX1 — shared admin header (Admin Home + Return to
// site links).
import AdminToolHeader from '@/components/admin/AdminToolHeader'
import {
  TEMPLATE_LABELS,
  TEMPLATES_IMPLEMENTED,
  WEEKLY_PACK_QUOTA,
  VISUAL_STYLES,
  PRICE_TIERS,
  TIME_WINDOWS,
  BUDGETS,
  GENERATIONS,
  TONES,
  PRODUCT_MODES,
  defaultOptionsFor,
  type SocialContentPost,
  type TemplateType,
  type CardBattleOptions,
  type MarketMoverOptions,
  type GradingGapOptions,
  type ThenVsNowOptions,
  type BudgetBuilderOptions,
  type CollectorPulseOptions,
  type PokemonBattleOptions,
  type GuessThePokemonOptions,
  type MostTradedOptions,
} from '@/lib/contentStudio'

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices2024'
// Block 5A-W-47C — unified admin sessionStorage key shared with
// /admin, /admin/insights and /admin/newsletter-studio so Luke doesn't
// re-enter the password when moving between admin tools in the same
// browser tab.
const SESSION_KEY = 'admin_authed'

// Edge function URL slug. Supabase assigns its own random slug when you
// create a function via the dashboard (e.g. "smooth-responder"); renaming
// the display name doesn't change the slug. Override via env var if the
// slug ever changes.
const GENERATE_FN_SLUG = process.env.NEXT_PUBLIC_CONTENT_STUDIO_FN_SLUG || 'smooth-responder'
const GENERATE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${GENERATE_FN_SLUG}`
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── Login screen ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(SESSION_KEY, '1') } catch {}
      onLogin()
    } else { setErr(true); setPw('') }
  }

  return (
    <div style={{ maxWidth: 380, margin: '120px auto', padding: 24, background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)' }}>
      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Content Studio</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 16px' }}>
        Admin password required.
      </p>
      <form onSubmit={handleSubmit}>
        <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(false) }} placeholder="Password"
          style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${err ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }} />
        {err && <p style={{ fontSize: 12, color: '#ef4444', margin: '8px 0 0', fontFamily: "'Figtree', sans-serif" }}>Wrong password.</p>}
        <button type="submit" style={{ width: '100%', marginTop: 12, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
          Enter
        </button>
      </form>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function callGenerate(template_type: TemplateType, options: any): Promise<SocialContentPost> {
  let res: Response
  try {
    res = await fetch(GENERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ template_type, options }),
    })
  } catch (e: any) {
    // Network-layer error — almost always CORS preflight failure or the
    // function not being reachable. Surface a hint.
    throw new Error(
      `Cannot reach edge function (${e?.message || 'network error'}). ` +
      `Check that content-studio-generate is deployed and verify_jwt is OFF.`
    )
  }
  let data: any = null
  try { data = await res.json() } catch {}
  if (!res.ok) {
    const detail = data?.error || data?.message || (await res.text().catch(() => '')) || `HTTP ${res.status}`
    throw new Error(detail)
  }
  if (!data?.post) throw new Error('Edge function returned no post')
  return data.post as SocialContentPost
}

function renderUrl(id: string): string {
  return `/api/content-studio/render?id=${encodeURIComponent(id)}`
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

// ── Admin mutation helpers (Block 1A) ───────────────────────────────────────
// social_content_posts no longer accepts anon writes. All status changes and
// deletes route through /api/admin/content-studio/posts, which requires a
// Supabase Auth bearer token plus an email on the server-only allow-list
// ADMIN_ALLOWED_EMAILS.

async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

type AdminMutateResult = {
  ok:     boolean
  status: number
  data:   any
  error:  string
}

async function adminMutate(
  method: 'PATCH' | 'DELETE',
  body: any,
): Promise<AdminMutateResult> {
  const token = await getAccessToken()
  if (!token) {
    return { ok: false, status: 401, data: null, error: 'sign-in required' }
  }
  let res: Response
  try {
    res = await fetch('/api/admin/content-studio/posts', {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e?.message || 'network error' }
  }
  let data: any = null
  try { data = await res.json() } catch {}
  if (!res.ok) {
    return { ok: false, status: res.status, data, error: data?.error || `HTTP ${res.status}` }
  }
  return { ok: true, status: res.status, data, error: '' }
}

function adminMutateErrorMessage(res: AdminMutateResult): string {
  if (res.status === 401) return 'Sign in as an admin to make changes (top right).'
  if (res.status === 403) return 'Your account is not on the admin allow-list.'
  if (res.status === 503) return 'Admin allow-list is not configured on the server.'
  return res.error || 'Action failed.'
}

// ── Options panels ──────────────────────────────────────────────────────────

const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12,
  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5,
}
const selectStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
  fontSize: 13, outline: 'none', textTransform: 'none', letterSpacing: 0, fontWeight: 400,
}
const inputStyle: React.CSSProperties = {
  ...selectStyle,
  cursor: 'text',
}

// Shared tone-selector field — adds one dropdown column to any panel.
function ToneFieldInput<O extends { tone?: string }>(
  { opts, onChange }: { opts: O; onChange: (o: O) => void }
) {
  return (
    <label style={fieldStyle}>
      Tone
      <select value={opts.tone || 'default'} onChange={e => onChange({ ...opts, tone: e.target.value as any })} style={selectStyle}>
        {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
    </label>
  )
}

// Card autocomplete picker — used by Then vs Now (and ready for other
// templates later). Hits the search_global RPC and lets the user lock in
// a specific card by URL slug.
function CardPickerField<O extends { card_slug?: string; card_label?: string }>(
  { opts, onChange }: { opts: O; onChange: (o: O) => void }
) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!q.trim() || q.length < 2) { setResults([]); return }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_global', { query: q })
      if (cancelled) return
      const cards = (data || []).filter((r: any) => r.result_type === 'card').slice(0, 8)
      setResults(cards)
      setSearching(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q])

  if (opts.card_slug) {
    return (
      <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
        Pinned card
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'rgba(26,95,173,0.08)', border: '1px solid var(--primary)' }}>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>{opts.card_label || opts.card_slug}</span>
          <button type="button" onClick={() => onChange({ ...opts, card_slug: undefined, card_label: undefined })}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      </label>
    )
  }

  return (
    <label style={{ ...fieldStyle, position: 'relative', gridColumn: '1 / -1' }}>
      Pin a specific card (optional)
      <input
        type="text"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search by card name…"
        style={inputStyle}
      />
      {open && (q.length >= 2) && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 240, overflowY: 'auto', zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          {searching && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>}
          {!searching && results.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--text-muted)' }}>No matches</div>}
          {results.map((r, i) => {
            const slug = (r.url_slug || r.card_slug || '').toString().replace(/^pc-/, '')
            const label = `${r.name}${r.subtitle || r.set_name ? ` · ${r.subtitle || r.set_name}` : ''}`
            return (
              <button key={i} type="button"
                onMouseDown={() => {
                  onChange({ ...opts, card_slug: slug, card_label: label })
                  setQ(''); setOpen(false)
                }}
                style={{ display: 'flex', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', fontFamily: "'Figtree', sans-serif" }}>
                <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }}>{label}</span>
              </button>
            )
          })}
        </div>
      )}
    </label>
  )
}

// Shared price-tier field with optional custom target+tolerance inputs.
function PriceTierField<O extends { price_tier: any; custom_target_gbp?: number; custom_tolerance_pct?: number }>(
  { opts, onChange }: { opts: O; onChange: (o: O) => void }
) {
  return (
    <>
      <label style={fieldStyle}>
        Price tier
        <select value={opts.price_tier} onChange={e => onChange({ ...opts, price_tier: e.target.value as any })} style={selectStyle}>
          {PRICE_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      {opts.price_tier === 'custom' && (
        <>
          <label style={fieldStyle}>
            Target (£)
            <input
              type="number" min={1} step={1}
              value={opts.custom_target_gbp ?? 100}
              onChange={e => onChange({ ...opts, custom_target_gbp: Number(e.target.value) || 0 })}
              style={inputStyle}
            />
          </label>
          <label style={fieldStyle}>
            Tolerance (±%)
            <input
              type="number" min={1} max={90} step={5}
              value={opts.custom_tolerance_pct ?? 20}
              onChange={e => onChange({ ...opts, custom_tolerance_pct: Number(e.target.value) || 20 })}
              style={inputStyle}
            />
          </label>
        </>
      )}
    </>
  )
}

function CardBattlePanel({ opts, onChange }: { opts: CardBattleOptions; onChange: (o: CardBattleOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Product
        <select value={opts.product_mode || 'cards'} onChange={e => onChange({ ...opts, product_mode: e.target.value as any })} style={selectStyle}>
          {PRODUCT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      <PriceTierField opts={opts} onChange={onChange} />
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

function GradingGapPanel({ opts, onChange }: { opts: GradingGapOptions; onChange: (o: GradingGapOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <PriceTierField opts={opts} onChange={onChange} />
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

function ThenVsNowPanel({ opts, onChange }: { opts: ThenVsNowOptions; onChange: (o: ThenVsNowOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Time span
        <select value={opts.span} onChange={e => onChange({ ...opts, span: e.target.value as any })} style={selectStyle}>
          <option value="2y">2 years</option>
          <option value="3y">3 years</option>
          <option value="5y">5 years</option>
        </select>
      </label>
      <PriceTierField opts={opts} onChange={onChange} />
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
      <CardPickerField opts={opts} onChange={onChange} />
    </div>
  )
}

function BudgetBuilderPanel({ opts, onChange }: { opts: BudgetBuilderOptions; onChange: (o: BudgetBuilderOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Budget (USD)
        <select value={opts.budget_usd} onChange={e => onChange({ ...opts, budget_usd: Number(e.target.value) as any })} style={selectStyle}>
          {BUDGETS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

function CollectorPulsePanel({ opts, onChange }: { opts: CollectorPulseOptions; onChange: (o: CollectorPulseOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Window
        <select value={opts.time_window} onChange={e => onChange({ ...opts, time_window: e.target.value as any })} style={selectStyle}>
          {TIME_WINDOWS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Min raw ($)
        <input type="number" min={5} step={5}
          value={opts.min_raw_usd ?? 20}
          onChange={e => onChange({ ...opts, min_raw_usd: Number(e.target.value) || 5 })}
          style={inputStyle} />
      </label>
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

function PokemonBattlePanel({ opts, onChange }: { opts: PokemonBattleOptions; onChange: (o: PokemonBattleOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Generation
        <select value={opts.generation} onChange={e => onChange({ ...opts, generation: e.target.value as any })} style={selectStyle}>
          {GENERATIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

function MostTradedPanel({ opts, onChange }: { opts: MostTradedOptions; onChange: (o: MostTradedOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Product
        <select value={opts.product_mode || 'cards'} onChange={e => onChange({ ...opts, product_mode: e.target.value as any })} style={selectStyle}>
          {PRODUCT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Min raw ($)
        <input type="number" min={5} step={5}
          value={opts.min_raw_usd ?? 20}
          onChange={e => onChange({ ...opts, min_raw_usd: Number(e.target.value) || 5 })}
          style={inputStyle} />
      </label>
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

function GuessThePokemonPanel({ opts, onChange }: { opts: GuessThePokemonOptions; onChange: (o: GuessThePokemonOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Generation
        <select value={opts.generation} onChange={e => onChange({ ...opts, generation: e.target.value as any })} style={selectStyle}>
          {GENERATIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Difficulty
        <select value={opts.difficulty} onChange={e => onChange({ ...opts, difficulty: e.target.value as any })} style={selectStyle}>
          <option value="silhouette">Silhouette</option>
          <option value="blurred">Blurred</option>
        </select>
      </label>
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

function MarketMoverPanel({ opts, onChange }: { opts: MarketMoverOptions; onChange: (o: MarketMoverOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Window
        <select value={opts.time_window} onChange={e => onChange({ ...opts, time_window: e.target.value as any })} style={selectStyle}>
          {TIME_WINDOWS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Direction
        <select value={opts.direction} onChange={e => onChange({ ...opts, direction: e.target.value as any })} style={selectStyle}>
          <option value="up">Risers</option>
          <option value="down">Fallers</option>
        </select>
      </label>
      <label style={fieldStyle}>
        Min raw ($)
        <input type="number" min={5} step={5}
          value={opts.min_raw_usd ?? 20}
          onChange={e => onChange({ ...opts, min_raw_usd: Number(e.target.value) || 5 })}
          style={inputStyle} />
      </label>
      <PriceTierField opts={opts} onChange={onChange} />
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <ToneFieldInput opts={opts} onChange={onChange} />
    </div>
  )
}

// ── Post card ───────────────────────────────────────────────────────────────

function PostCard({ post, selected, onSelectChange, onUpdate, onDelete, onRegenerate, onActionError }: {
  post: SocialContentPost
  selected: boolean
  onSelectChange: (id: string, checked: boolean) => void
  onUpdate: (p: SocialContentPost) => void
  onDelete: (id: string) => void
  onRegenerate: (post: SocialContentPost) => void
  onActionError: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'twitter' | 'instagram' | null>(null)
  // Use post.updated_at as the initial cache key so any old browser-cached
  // render is automatically busted when the post changes server-side.
  const [imgKey, setImgKey] = useState(() => post.updated_at || post.created_at || '0')

  async function setStatus(status: SocialContentPost['status']) {
    setBusy(true)
    const res = await adminMutate('PATCH', { ids: [post.id], status })
    if (!res.ok) {
      onActionError(`Couldn't update status: ${adminMutateErrorMessage(res)}`)
    } else if (res.data?.rows?.[0]) {
      onUpdate(res.data.rows[0] as SocialContentPost)
    }
    setBusy(false)
  }

  async function handleCopy(which: 'twitter' | 'instagram') {
    const text = which === 'twitter' ? post.twitter_copy : post.instagram_caption
    if (!text) return
    await copyToClipboard(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1400)
  }

  const statusColor: Record<SocialContentPost['status'], string> = {
    draft: 'var(--text-muted)', approved: '#22c55e', rejected: '#ef4444', used: 'var(--primary)',
  }
  const statusBg: Record<SocialContentPost['status'], string> = {
    draft: 'var(--bg-light)', approved: 'rgba(34,197,94,0.10)',
    rejected: 'rgba(239,68,68,0.10)', used: 'rgba(26,95,173,0.10)',
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: "'Figtree', sans-serif", opacity: busy ? 0.6 : 1, transition: 'opacity 0.15s' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={selected} onChange={e => onSelectChange(post.id, e.target.checked)} />
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)' }}>
            {TEMPLATE_LABELS[post.template_type]}
          </span>
        </label>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: statusBg[post.status], color: statusColor[post.status], textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {post.status}
        </span>
      </div>

      {/* Image preview — Guess the Pokémon shows both silhouette + reveal */}
      {post.template_type === 'guess_the_pokemon' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div style={{ position: 'relative', aspectRatio: '1 / 1', background: 'var(--bg-light)', borderRadius: 10, overflow: 'hidden' }}>
            <img key={`s-${imgKey}`} src={`${renderUrl(post.id)}&v=${imgKey}`} alt="Silhouette"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 8, background: 'rgba(15,23,42,0.85)', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>Silhouette</span>
          </div>
          <div style={{ position: 'relative', aspectRatio: '1 / 1', background: 'var(--bg-light)', borderRadius: 10, overflow: 'hidden' }}>
            <img key={`r-${imgKey}`} src={`${renderUrl(post.id)}&reveal=1&v=${imgKey}`} alt="Reveal"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 8, background: 'rgba(34,197,94,0.95)', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>Reveal</span>
          </div>
        </div>
      ) : (
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: 'var(--bg-light)', borderRadius: 10, overflow: 'hidden' }}>
          <img key={imgKey} src={`${renderUrl(post.id)}&v=${imgKey}`} alt={post.title || ''}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}

      {/* Title + hook */}
      {post.title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{post.title}</div>
      )}

      {/* Tweet */}
      {post.twitter_copy && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)' }}>Twitter / X</span>
            <button onClick={() => handleCopy('twitter')} style={{ fontSize: 10, fontWeight: 700, color: copied === 'twitter' ? '#22c55e' : 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              {copied === 'twitter' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, background: 'var(--bg-light)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
            {post.twitter_copy}
          </div>
        </div>
      )}

      {/* Instagram */}
      {post.instagram_caption && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)' }}>Instagram</span>
            <button onClick={() => handleCopy('instagram')} style={{ fontSize: 10, fontWeight: 700, color: copied === 'instagram' ? '#22c55e' : 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              {copied === 'instagram' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, background: 'var(--bg-light)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', maxHeight: 110, overflowY: 'auto' }}>
            {post.instagram_caption}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        <a href={`${renderUrl(post.id)}&v=${imgKey}`} download={`${post.id}.png`}
          style={{ flex: 1, minWidth: 100, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, textAlign: 'center', textDecoration: 'none', cursor: 'pointer' }}>
          ⬇ PNG
        </a>
        {post.template_type === 'guess_the_pokemon' && (
          <a href={`${renderUrl(post.id)}&reveal=1&v=${imgKey}`} download={`${post.id}-reveal.png`}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, textAlign: 'center', textDecoration: 'none', cursor: 'pointer' }}>
            ⬇ Reveal
          </a>
        )}
        <button onClick={() => { setImgKey(String(Date.now())) }}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
        <button onClick={() => onRegenerate(post)} disabled={busy}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          ⟳ Regenerate
        </button>
        {post.status !== 'approved' && (
          <button onClick={() => setStatus('approved')} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #22c55e', background: 'rgba(34,197,94,0.08)', color: '#16a34a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            ✓ Approve
          </button>
        )}
        {post.status !== 'rejected' && (
          <button onClick={() => setStatus('rejected')} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #ef4444', background: 'rgba(239,68,68,0.06)', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            ✗ Reject
          </button>
        )}
        {post.status === 'approved' && (
          <button onClick={() => setStatus('used')} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--primary)', background: 'rgba(26,95,173,0.08)', color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Mark used
          </button>
        )}
        <button onClick={() => onDelete(post.id)} disabled={busy}
          title="Delete"
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          🗑
        </button>
      </div>
    </div>
  )
}

// ── Admin Supabase Auth session bar ────────────────────────────────────────
// Mutations now require a real Supabase Auth session whose email is in
// ADMIN_ALLOWED_EMAILS server-side. This widget shows the current session
// status and offers an inline sign-in so the admin doesn't have to leave
// the page. The legacy password gate above is preserved purely as a UI
// convenience — it carries no security authority.

function AdminSessionBar() {
  const [email, setEmail] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const [signinEmail, setSigninEmail] = useState('')
  const [signinPw, setSigninPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setEmail(data.session?.user?.email ?? null)
      setLoaded(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!mounted) return
      setEmail(session?.user?.email ?? null)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function handleSignIn() {
    if (!signinEmail.trim() || !signinPw) return
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({
      email:    signinEmail.trim(),
      password: signinPw,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setShowSignIn(false)
    setSigninPw('')
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  if (!loaded) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 14px', borderRadius: 10, marginBottom: 14,
      background: email ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
      border: `1px solid ${email ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
      fontFamily: "'Figtree', sans-serif", fontSize: 12,
    }}>
      <span style={{ fontWeight: 700, color: email ? '#16a34a' : '#b91c1c' }}>
        {email ? `Signed in as ${email}` : 'Not signed in'}
      </span>
      <span style={{ color: 'var(--text-muted)', flex: 1 }}>
        {email
          ? 'Approve / reject / delete actions will be allowed if this email is on the admin allow-list.'
          : 'Sign in with your admin Supabase account to approve, reject, or delete posts.'}
      </span>
      {email
        ? (
          <button onClick={handleSignOut}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Sign out
          </button>
        )
        : (
          <button onClick={() => setShowSignIn(s => !s)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            {showSignIn ? 'Cancel' : 'Sign in'}
          </button>
        )}

      {showSignIn && !email && (
        <div style={{ flexBasis: '100%', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <input
            type="email" autoComplete="email" value={signinEmail}
            onChange={e => setSigninEmail(e.target.value)}
            placeholder="admin@email"
            style={{ flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none' }}
          />
          <input
            type="password" autoComplete="current-password" value={signinPw}
            onChange={e => setSigninPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) handleSignIn() }}
            placeholder="Password"
            style={{ flex: 1, minWidth: 180, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none' }}
          />
          <button onClick={handleSignIn} disabled={busy || !signinEmail.trim() || !signinPw}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {err && <p style={{ flexBasis: '100%', fontSize: 11, color: '#b91c1c', margin: 0 }}>{err}</p>}
        </div>
      )}
    </div>
  )
}

// ── Main client ─────────────────────────────────────────────────────────────

export default function ContentStudioClient() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [posts, setPosts] = useState<SocialContentPost[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'rejected' | 'used'>('all')
  const [lastError, setLastError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Resend smoke test — sends one fixed-recipient email via the
  // server-only /api/admin/test-resend route. Recipient is set on the
  // server (EMAIL_TEST_RECIPIENT); the button cannot override it.
  const [resendBusy,   setResendBusy]   = useState(false)
  const [resendStatus, setResendStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const sendResendTest = useCallback(async () => {
    setResendBusy(true)
    setResendStatus(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setResendStatus({ ok: false, text: 'Sign in first.' })
        return
      }
      const res = await fetch('/api/admin/test-resend', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      let data: { success?: boolean; emailId?: string | null; error?: string } = {}
      try { data = await res.json() } catch { /* fine */ }
      if (res.ok && data.success) {
        setResendStatus({ ok: true, text: data.emailId ? `Sent (id ${data.emailId})` : 'Sent.' })
      } else {
        setResendStatus({ ok: false, text: data.error || `Failed (HTTP ${res.status})` })
      }
    } catch (e: any) {
      setResendStatus({ ok: false, text: e?.message || 'Network error' })
    } finally {
      setResendBusy(false)
    }
  }, [])

  // Global options per template type
  const [cardBattleOpts,     setCardBattleOpts]     = useState<CardBattleOptions>(defaultOptionsFor('card_battle')      as CardBattleOptions)
  const [marketMoverOpts,    setMarketMoverOpts]    = useState<MarketMoverOptions>(defaultOptionsFor('market_mover')    as MarketMoverOptions)
  const [gradingGapOpts,     setGradingGapOpts]     = useState<GradingGapOptions>(defaultOptionsFor('grading_gap')      as GradingGapOptions)
  const [thenVsNowOpts,      setThenVsNowOpts]      = useState<ThenVsNowOptions>(defaultOptionsFor('then_vs_now')       as ThenVsNowOptions)
  const [budgetBuilderOpts,  setBudgetBuilderOpts]  = useState<BudgetBuilderOptions>(defaultOptionsFor('budget_builder') as BudgetBuilderOptions)
  const [collectorPulseOpts, setCollectorPulseOpts] = useState<CollectorPulseOptions>(defaultOptionsFor('collector_pulse') as CollectorPulseOptions)
  const [pokemonBattleOpts,  setPokemonBattleOpts]  = useState<PokemonBattleOptions>(defaultOptionsFor('pokemon_battle')   as PokemonBattleOptions)
  const [guessOpts,          setGuessOpts]          = useState<GuessThePokemonOptions>(defaultOptionsFor('guess_the_pokemon') as GuessThePokemonOptions)
  const [mostTradedOpts,     setMostTradedOpts]     = useState<MostTradedOptions>(defaultOptionsFor('most_traded') as MostTradedOptions)

  function optionsFor(t: TemplateType): any {
    switch (t) {
      case 'card_battle':       return cardBattleOpts
      case 'market_mover':      return marketMoverOpts
      case 'grading_gap':       return gradingGapOpts
      case 'then_vs_now':       return thenVsNowOpts
      case 'budget_builder':    return budgetBuilderOpts
      case 'collector_pulse':   return collectorPulseOpts
      case 'pokemon_battle':    return pokemonBattleOpts
      case 'guess_the_pokemon': return guessOpts
      case 'most_traded':       return mostTradedOpts
      default: return {}
    }
  }

  useEffect(() => {
    try {
      setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
    } catch { setAuthed(false) }
  }, [])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('social_content_posts')
      .select('*').order('created_at', { ascending: false }).limit(200)
    setPosts((data || []) as SocialContentPost[])
    setLoading(false)
  }, [])

  useEffect(() => { if (authed) loadPosts() }, [authed, loadPosts])

  // Build the pack — one entry per quota slot for every implemented template.
  const weeklyTasks = (() => {
    const tasks: { template_type: TemplateType; options: any }[] = []
    for (const t of TEMPLATES_IMPLEMENTED) {
      for (let i = 0; i < WEEKLY_PACK_QUOTA[t]; i++) {
        tasks.push({ template_type: t, options: optionsFor(t) })
      }
    }
    return tasks
  })()

  async function generateWeeklyPack() {
    setGenerating(true)
    setLastError(null)
    setProgress({ done: 0, total: weeklyTasks.length })
    const results: SocialContentPost[] = []
    const errors: string[] = []
    let done = 0
    // Block 5A-W-58I — coordinate archetype variety across a batch by
    // passing variant_index. The edge function uses the index (mod
    // pool size) to prefer a different archetype for each parallel
    // call, so 5 card_battle posts do not all land on the same MODE.
    // Reset the counter per template so two market_mover slots start
    // from 0, 1 rather than sharing indexes with the card_battle run.
    const perTemplateCounter = new Map<TemplateType, number>()
    await Promise.all(weeklyTasks.map(async t => {
      const idx = perTemplateCounter.get(t.template_type) ?? 0
      perTemplateCounter.set(t.template_type, idx + 1)
      try {
        const post = await callGenerate(t.template_type, { ...t.options, variant_index: idx })
        results.push(post)
      } catch (e: any) {
        errors.push(`${TEMPLATE_LABELS[t.template_type]}: ${e?.message || e}`)
      } finally {
        done += 1
        setProgress({ done, total: weeklyTasks.length })
      }
    }))
    setPosts(prev => [...results, ...prev])
    setGenerating(false)
    setProgress(null)
    if (errors.length > 0) {
      setLastError(`${errors.length} of ${weeklyTasks.length} generations failed. First error: ${errors[0]}`)
    }
  }

  async function generateOne(template_type: TemplateType) {
    if (!TEMPLATES_IMPLEMENTED.includes(template_type)) {
      alert(`${TEMPLATE_LABELS[template_type]} is coming in Phase C.`)
      return
    }
    setGenerating(true)
    setLastError(null)
    try {
      // Block 5A-W-58I — even a single generate picks a random-ish
      // archetype server-side (no variant_index means true random).
      const post = await callGenerate(template_type, optionsFor(template_type))
      setPosts(prev => [post, ...prev])
    } catch (e: any) {
      setLastError(`${TEMPLATE_LABELS[template_type]}: ${e?.message || e}`)
    } finally { setGenerating(false) }
  }

  async function regenerate(post: SocialContentPost) {
    setGenerating(true)
    try {
      // Block 5A-W-58I — tell the edge function which archetype the
      // previous draft used so regenerate lands on something
      // different. If the previous archetype is missing (older
      // drafts, non-58I posts), avoid_archetype is undefined and the
      // server falls back to random selection over the full pool.
      const prevArchetype: string | undefined =
        (post.data_payload && typeof post.data_payload === 'object' && (post.data_payload as any).archetype)
          ? String((post.data_payload as any).archetype)
          : undefined
      const opts = { ...(post.generated_options || {}), avoid_archetype: prevArchetype }
      const newPost = await callGenerate(post.template_type, opts)
      // Delete the old draft, keep approved/used.
      if (post.status === 'draft' || post.status === 'rejected') {
        const del = await adminMutate('DELETE', { ids: [post.id] })
        if (!del.ok) {
          // Generation succeeded but old draft couldn't be removed; surface
          // the auth failure but keep the new post so work is not lost.
          setLastError(`Regenerated, but old draft was not removed: ${adminMutateErrorMessage(del)}`)
          setPosts(prev => [newPost, ...prev])
        } else {
          setPosts(prev => [newPost, ...prev.filter(p => p.id !== post.id)])
        }
      } else {
        setPosts(prev => [newPost, ...prev])
      }
    } catch (e: any) {
      alert(`Regeneration failed: ${e?.message || e}`)
    } finally { setGenerating(false) }
  }

  async function deletePost(id: string) {
    if (!confirm('Delete this post?')) return
    const res = await adminMutate('DELETE', { ids: [id] })
    if (!res.ok) {
      setLastError(`Couldn't delete: ${adminMutateErrorMessage(res)}`)
      return
    }
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  function updatePost(p: SocialContentPost) {
    setPosts(prev => prev.map(x => x.id === p.id ? p : x))
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function bulkSetStatus(status: SocialContentPost['status']) {
    if (selectedIds.size === 0) return
    if (!confirm(`Set ${selectedIds.size} posts to "${status}"?`)) return
    const ids = Array.from(selectedIds)
    const res = await adminMutate('PATCH', { ids, status })
    if (!res.ok) {
      setLastError(`Bulk status update failed: ${adminMutateErrorMessage(res)}`)
      return
    }
    const rows: any[] = res.data?.rows ?? []
    const updatedById = new Map(rows.map((r: any) => [r.id, r as SocialContentPost]))
    setPosts(prev => prev.map(p => updatedById.get(p.id) || p))
    setSelectedIds(new Set())
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} posts? This can't be undone.`)) return
    const ids = Array.from(selectedIds)
    const res = await adminMutate('DELETE', { ids })
    if (!res.ok) {
      setLastError(`Bulk delete failed: ${adminMutateErrorMessage(res)}`)
      return
    }
    const idSet = new Set(ids)
    setPosts(prev => prev.filter(p => !idSet.has(p.id)))
    setSelectedIds(new Set())
  }

  function selectAllVisible(visible: SocialContentPost[]) {
    setSelectedIds(new Set(visible.map(p => p.id)))
  }
  function clearSelection() { setSelectedIds(new Set()) }

  if (authed === null) return null
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  const visiblePosts = filter === 'all' ? posts : posts.filter(p => p.status === filter)
  const counts = {
    all:      posts.length,
    draft:    posts.filter(p => p.status === 'draft').length,
    approved: posts.filter(p => p.status === 'approved').length,
    rejected: posts.filter(p => p.status === 'rejected').length,
    used:     posts.filter(p => p.status === 'used').length,
  }

  return (
    <>
      {/* FIX1 — shared admin header at the top of every authenticated
          Content Studio view so Luke can return to /admin or the
          public site without leaving the tool state behind. */}
      <AdminToolHeader toolName="Content Studio" />
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px', fontFamily: "'Figtree', sans-serif" }}>
      {/* Admin Supabase Auth session status (Block 1A) */}
      <AdminSessionBar />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: '0 0 4px', color: 'var(--text)' }}>Weekly Content Studio</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Generate a balanced pack of 21 social posts per week. Each template uses the settings configured on its tile below — adjust before clicking Generate.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={sendResendTest} disabled={resendBusy}
            title="Sends one email to EMAIL_TEST_RECIPIENT via the Vercel Resend API. Recipient is server-controlled."
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: resendBusy ? 'not-allowed' : 'pointer', opacity: resendBusy ? 0.7 : 1 }}>
            {resendBusy ? 'Sending…' : 'Send Resend test email'}
          </button>
          {resendStatus && (
            <span style={{ fontSize: 11, color: resendStatus.ok ? '#22c55e' : '#b91c1c', fontFamily: "'Figtree', sans-serif" }}>
              {resendStatus.text}
            </span>
          )}
          <button onClick={generateWeeklyPack} disabled={generating}
            style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1 }}>
            {generating && progress
              ? `Generating ${progress.done}/${progress.total}…`
              : `⚡ Generate Weekly Pack (${weeklyTasks.length} posts)`}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {lastError && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#b91c1c', lineHeight: 1.5, fontFamily: "'Figtree', sans-serif" }}>
            <strong>Generation error.</strong> {lastError}
          </div>
          <button onClick={() => setLastError(null)}
            style={{ background: 'transparent', border: 'none', color: '#b91c1c', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Block 3B operator-UX — onboarding email testing panel.
          Renders alongside the existing basic Resend test button
          (which is still in the header). Uses the Block 3A admin
          email routes; never touches onboarding state. */}
      <OnboardingEmailTester getAccessToken={getAccessToken} />

      {/* Block 3D operator-UX — onboarding automation status.
          Reads /api/admin/onboarding-status; "Run now" calls
          /api/admin/run-onboarding-processor. The browser never
          sees CRON_SECRET. */}
      <OnboardingAutomationStatus getAccessToken={getAccessToken} />

      {/* Per-template option panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 18 }}>
        <OptionsCard title="Card Battle" count={WEEKLY_PACK_QUOTA.card_battle} summary={summarizeOptions('card_battle', cardBattleOpts)} onSingle={() => generateOne('card_battle')} disabled={generating}>
          <CardBattlePanel opts={cardBattleOpts} onChange={setCardBattleOpts} />
        </OptionsCard>
        <OptionsCard title="Market Mover" count={WEEKLY_PACK_QUOTA.market_mover} summary={summarizeOptions('market_mover', marketMoverOpts)} onSingle={() => generateOne('market_mover')} disabled={generating}>
          <MarketMoverPanel opts={marketMoverOpts} onChange={setMarketMoverOpts} />
        </OptionsCard>
        <OptionsCard title="Grading Gap" count={WEEKLY_PACK_QUOTA.grading_gap} summary={summarizeOptions('grading_gap', gradingGapOpts)} onSingle={() => generateOne('grading_gap')} disabled={generating}>
          <GradingGapPanel opts={gradingGapOpts} onChange={setGradingGapOpts} />
        </OptionsCard>
        <OptionsCard title="Then vs Now" count={WEEKLY_PACK_QUOTA.then_vs_now} summary={summarizeOptions('then_vs_now', thenVsNowOpts)} onSingle={() => generateOne('then_vs_now')} disabled={generating}>
          <ThenVsNowPanel opts={thenVsNowOpts} onChange={setThenVsNowOpts} />
        </OptionsCard>
        <OptionsCard title="Budget Builder" count={WEEKLY_PACK_QUOTA.budget_builder} summary={summarizeOptions('budget_builder', budgetBuilderOpts)} onSingle={() => generateOne('budget_builder')} disabled={generating}>
          <BudgetBuilderPanel opts={budgetBuilderOpts} onChange={setBudgetBuilderOpts} />
        </OptionsCard>
        <OptionsCard title="Collector Pulse" count={WEEKLY_PACK_QUOTA.collector_pulse} summary={summarizeOptions('collector_pulse', collectorPulseOpts)} onSingle={() => generateOne('collector_pulse')} disabled={generating}>
          <CollectorPulsePanel opts={collectorPulseOpts} onChange={setCollectorPulseOpts} />
        </OptionsCard>
        <OptionsCard title="Pokémon Battle" count={WEEKLY_PACK_QUOTA.pokemon_battle} summary={summarizeOptions('pokemon_battle', pokemonBattleOpts)} onSingle={() => generateOne('pokemon_battle')} disabled={generating}>
          <PokemonBattlePanel opts={pokemonBattleOpts} onChange={setPokemonBattleOpts} />
        </OptionsCard>
        <OptionsCard title="Guess the Pokémon" count={WEEKLY_PACK_QUOTA.guess_the_pokemon} summary={summarizeOptions('guess_the_pokemon', guessOpts)} onSingle={() => generateOne('guess_the_pokemon')} disabled={generating}>
          <GuessThePokemonPanel opts={guessOpts} onChange={setGuessOpts} />
        </OptionsCard>
        <OptionsCard title="Most Traded" count={WEEKLY_PACK_QUOTA.most_traded} summary={summarizeOptions('most_traded', mostTradedOpts)} onSingle={() => generateOne('most_traded')} disabled={generating}>
          <MostTradedPanel opts={mostTradedOpts} onChange={setMostTradedOpts} />
        </OptionsCard>
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(['all', 'draft', 'approved', 'used', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{
              padding: '6px 12px', borderRadius: 18, border: '1px solid var(--border)',
              background: filter === s ? 'var(--primary)' : 'transparent',
              color: filter === s ? '#fff' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
            }}>
            {s} {counts[s] > 0 ? `(${counts[s]})` : ''}
          </button>
        ))}
      </div>

      {/* Bulk action bar (above grid) */}
      {visiblePosts.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10, padding: '10px 12px', background: selectedIds.size > 0 ? 'rgba(26,95,173,0.08)' : 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
            <span style={{ fontWeight: 700, color: selectedIds.size > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
              {selectedIds.size} selected
            </span>
            <button onClick={() => selectAllVisible(visiblePosts)} style={{ background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
              Select all {visiblePosts.length}
            </button>
            {selectedIds.size > 0 && (
              <button onClick={clearSelection} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                Clear
              </button>
            )}
          </div>
          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => bulkSetStatus('approved')}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #22c55e', background: 'rgba(34,197,94,0.08)', color: '#16a34a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                ✓ Approve all
              </button>
              <button onClick={() => bulkSetStatus('rejected')}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #ef4444', background: 'rgba(239,68,68,0.06)', color: '#dc2626', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                ✗ Reject all
              </button>
              <button onClick={() => bulkSetStatus('used')}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--primary)', background: 'rgba(26,95,173,0.08)', color: 'var(--primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Mark used
              </button>
              <button onClick={bulkDelete}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                🗑 Delete all
              </button>
            </div>
          )}
        </div>
      )}

      {/* AI Image Workshop — experimental separate tool */}
      <AiImageWorkshop />

      {/* Posts grid */}
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
      ) : visiblePosts.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 16, padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            No posts yet. Hit Generate Weekly Pack to spin up your first 21.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {visiblePosts.map(p => (
            <PostCard key={p.id} post={p}
              selected={selectedIds.has(p.id)}
              onSelectChange={toggleSelected}
              onUpdate={updatePost}
              onDelete={deletePost}
              onRegenerate={regenerate}
              onActionError={setLastError} />
          ))}
        </div>
      )}
    </div>
    </>
  )
}

// ── AI Image Workshop — experimental ───────────────────────────────────────

function AiImageWorkshop() {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [finalPrompt, setFinalPrompt] = useState<string | null>(null)

  async function generate() {
    if (!prompt.trim()) return
    setBusy(true); setErr(null); setImage(null); setFinalPrompt(null)
    try {
      const res = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({ action: 'ai_image', prompt: prompt.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Image generation failed')
      setImage(data.image)
      setFinalPrompt(data.final_prompt)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally { setBusy(false) }
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 4px', color: 'var(--text)' }}>
            AI Image Workshop <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 12, background: 'var(--bg-light)', marginLeft: 8 }}>Experimental</span>
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Tightly-prompted editorial-style image generation. Each request prepends a strict style preamble (archival photography, minimal composition, no text, no AI glossiness). The free-form prompt sets the subject only.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !busy) generate() }}
          placeholder="e.g. A Charizard Base Set first-edition card resting on a dark velvet cloth"
          style={{ ...inputStyle, flex: 1, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}
          disabled={busy}
        />
        <button onClick={generate} disabled={busy || !prompt.trim()}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, fontFamily: "'Figtree', sans-serif" }}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {err && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#b91c1c' }}>
          {err}{err.includes('OPENAI_API_KEY') && ' — set it in Supabase → Functions → smooth-responder → Secrets.'}
        </div>
      )}

      {image && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <img src={image} alt="" style={{ width: '100%', maxWidth: 540, aspectRatio: '1 / 1', borderRadius: 12, border: '1px solid var(--border)' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={image} download="ai-image.png"
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              ⬇ Download
            </a>
            <button onClick={generate} disabled={busy}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              ⟳ Regenerate
            </button>
          </div>
          {finalPrompt && (
            <details style={{ width: '100%', maxWidth: 540 }}>
              <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Show full prompt</summary>
              <pre style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-light)', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', margin: '6px 0 0', fontFamily: "'Figtree', sans-serif" }}>{finalPrompt}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function OptionsCard({ title, count, children, onSingle, disabled, stub, summary }: {
  title: string; count: number; children?: React.ReactNode
  onSingle?: () => void; disabled?: boolean; stub?: boolean
  summary?: string
}) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, opacity: stub ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Generates {count} per weekly pack
          </div>
          {summary && (
            <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700, marginTop: 4, lineHeight: 1.5, fontFamily: "'Figtree', sans-serif" }}>
              {summary}
            </div>
          )}
        </div>
        {onSingle && (
          <button onClick={onSingle} disabled={disabled}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0 }}>
            + One
          </button>
        )}
        {stub && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, padding: '4px 8px', borderRadius: 12, background: 'var(--bg-light)' }}>
            Phase B
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// Build a one-line summary of the active options for each template card.
function summarizeOptions(t: TemplateType, opts: any): string {
  const v = opts.visual_style ? `${opts.visual_style}` : ''
  switch (t) {
    case 'card_battle':
      return `${opts.product_mode || 'cards'} · ${opts.price_tier} · ${v}${opts.tone && opts.tone !== 'default' ? ` · ${opts.tone}` : ''}`
    case 'market_mover':
      return `${opts.direction} · ${opts.time_window} · ≥$${opts.min_raw_usd ?? 20} · ${opts.price_tier} · ${v}`
    case 'grading_gap':
      return `${opts.price_tier} · ${v}`
    case 'then_vs_now':
      return `${opts.span} · ${opts.price_tier}${opts.card_slug ? ` · pinned: ${opts.card_label || opts.card_slug}` : ''} · ${v}`
    case 'budget_builder':
      return `$${opts.budget_usd} · ${v}`
    case 'collector_pulse':
      return `${opts.time_window} · ≥$${opts.min_raw_usd ?? 20} · ${v}`
    case 'pokemon_battle':
      return `gen ${opts.generation} · ${v}`
    case 'guess_the_pokemon':
      return `gen ${opts.generation} · ${opts.difficulty} · ${v}`
    case 'most_traded':
      return `${opts.product_mode || 'cards'} · ≥$${opts.min_raw_usd ?? 20} · ${v}`
    default: return v
  }
}
