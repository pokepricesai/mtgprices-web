'use client'
// Owner sharing controls: Private/Public toggle, slug, copy public URL.

import { useState } from 'react'

type Props = {
  deckId: string
  initial: { is_public: boolean; slug: string | null; name: string }
}

export default function DeckSharePanel({ deckId, initial }: Props) {
  const [isPublic, setIsPublic] = useState(initial.is_public)
  const [slug, setSlug] = useState(initial.slug ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const publicUrl = slug ? `https://mtgprices.io/decks/public/${slug}` : null

  async function toggle(next: boolean) {
    setSaving(true); setError(null)
    const res = await fetch(`/api/decks/${deckId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: next }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.reason ?? j.error ?? 'Failed')
      return
    }
    const j = await res.json()
    setIsPublic(j.deck.is_public)
    setSlug(j.deck.slug ?? '')
  }

  async function updateSlug() {
    if (!slug.trim()) return
    setSaving(true); setError(null)
    const res = await fetch(`/api/decks/${deckId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
    setSaving(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.reason ?? j.error ?? 'Failed')
    } else {
      const j = await res.json()
      setSlug(j.deck.slug ?? '')
    }
  }

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true); setTimeout(() => setCopied(false), 1200)
    } catch { /* ignore */ }
  }

  return (
    <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div className="label-mono" style={{ marginBottom: 10 }}>Sharing</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => toggle(!isPublic)}
          disabled={saving}
          style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 700,
            border: '1px solid var(--border)', borderRadius: 999,
            background: isPublic ? 'var(--green)' : 'var(--bg-light)',
            color: isPublic ? '#fff' : 'var(--text)',
            cursor: saving ? 'wait' : 'pointer',
          }}
        >{isPublic ? '● Public' : '○ Private'}</button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {isPublic ? 'Anyone with the link can view.' : 'Only you can see this deck.'}
        </span>
      </div>
      {isPublic && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>mtgprices.io/decks/public/</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onBlur={updateSlug}
            placeholder="deck-slug"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
              padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-light)', color: 'var(--text)', minWidth: 180,
            }}
          />
          {publicUrl && (
            <button type="button" onClick={copyUrl} style={{
              padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: 'transparent', color: 'var(--primary)',
              border: '1px solid var(--primary)', borderRadius: 6,
            }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          )}
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{error}</div>}
    </div>
  )
}
