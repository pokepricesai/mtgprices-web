'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import BuildWithAI from './BuildWithAI'

type Props = {
  formats: Array<{ key: string; label: string; group: string; hasCommander: boolean; blurb: string }>
}

export default function NewDeckClient({ formats }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [format, setFormat] = useState('commander')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) { setError('Give the deck a name.'); return }
    setSaving(true)
    const s = getSupabaseBrowserClient()
    const { data: { user } } = await s.auth.getUser()
    if (!user) { setSaving(false); setError('Not signed in.'); return }
    const { data, error: e2 } = await s.from('mtg_decks').insert({
      user_id: user.id,
      name: trimmed,
      format,
      description: description.trim() || null,
    }).select().single()
    setSaving(false)
    if (e2 || !data) { setError(e2?.message ?? 'Failed to create deck.'); return }
    router.push(`/decks/${data.id}`)
  }

  const currentFormat = formats.find((f) => f.key === format)

  return (
    <form onSubmit={submit} style={{ marginTop: 24, display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="label-mono">Deck name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Atraxa Superfriends"
          autoFocus
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span className="label-mono">Format</span>
        <select value={format} onChange={(e) => setFormat(e.target.value)} style={inputStyle}>
          {Array.from(new Set(formats.map((f) => f.group))).map((g) => (
            <optgroup key={g} label={`${g} formats`}>
              {formats.filter((f) => f.group === g).map((f) => (
                <option key={f.key} value={f.key}>{f.label}{f.hasCommander ? ' — commander-based' : ''}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {currentFormat && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{currentFormat.blurb}</div>
        )}
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        <span className="label-mono">Notes (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="short description, strategy notes…"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </label>

      {error && (
        <div style={{ padding: 10, background: 'rgba(180,65,70,0.10)', border: '1px solid rgba(180,65,70,0.28)', borderRadius: 10, color: 'var(--red)', fontSize: 13 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '11px 20px', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', flex: 1,
        }}>{saving ? 'Creating…' : 'Create deck manually'}</button>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
        <BuildWithAI formats={formats} />
      </div>
    </form>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '11px 14px', border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)',
  borderRadius: 10, fontSize: 14, outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
}
