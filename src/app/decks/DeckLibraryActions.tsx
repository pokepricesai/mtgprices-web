'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

type Props = { deckId: string; deckName: string }

export default function DeckLibraryActions({ deckId, deckName }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function rename() {
    const next = prompt('New deck name:', deckName)?.trim()
    if (!next || next === deckName) return
    setBusy(true)
    const s = getSupabaseBrowserClient()
    await s.from('mtg_decks').update({ name: next }).eq('id', deckId)
    setBusy(false)
    router.refresh()
  }

  async function duplicate() {
    setBusy(true)
    const res = await fetch(`/api/decks/${deckId}/duplicate`, { method: 'POST' })
    setBusy(false)
    if (res.ok) router.refresh()
  }

  async function remove() {
    if (!confirm(`Delete "${deckName}"? This cannot be undone.`)) return
    setBusy(true)
    const s = getSupabaseBrowserClient()
    await s.from('mtg_decks').delete().eq('id', deckId)
    setBusy(false)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
      <button type="button" onClick={rename} disabled={busy} style={btn}>Rename</button>
      <button type="button" onClick={duplicate} disabled={busy} style={btn}>Duplicate</button>
      <button type="button" onClick={remove} disabled={busy} style={{ ...btn, color: 'var(--red)' }}>Delete</button>
    </div>
  )
}

const btn: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)',
  color: 'var(--text)', padding: '4px 10px', borderRadius: 8, fontSize: 12,
  fontWeight: 600, cursor: 'pointer',
}
