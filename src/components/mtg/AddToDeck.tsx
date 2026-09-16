'use client'
// AddToDeck — a small dropdown that lists the caller's decks and lets
// them push a single oracle_card_id into a chosen deck. Optionally
// records the current printing_finish_id as the preferred printing so
// the deck picks up that printing's price + owned status.

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import type { DeckZone } from '@/lib/mtg/deck-rules'

type Props = {
  oracleId: string
  cardName: string
  /** Optional preferred printing (usually the printing the user is
   *  looking at when they click). */
  preferredFinishId?: string | null
}

export default function AddToDeck({ oracleId, cardName, preferredFinishId }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [decks, setDecks] = useState<Array<{ id: string; name: string; format: string }>>([])
  const [zone, setZone] = useState<DeckZone>('main')
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = getSupabaseBrowserClient()
      const { data: user } = await s.auth.getUser()
      if (cancelled) return
      const isIn = Boolean(user.user)
      setSignedIn(isIn)
      setChecked(true)
      if (isIn) {
        const { data } = await s.from('mtg_decks').select('id, name, format').order('updated_at', { ascending: false })
        if (!cancelled) setDecks((data ?? []) as any[])
      }
    })()
    return () => { cancelled = true }
  }, [])

  function toggle() {
    if (!checked) return
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname ?? '/')}`)
      return
    }
    setOpen((v) => !v)
    setStatus(null)
  }

  async function addToDeck(deckId: string) {
    const s = getSupabaseBrowserClient()
    // Upsert into (deck, oracle, zone).
    const { data: existing } = await s.from('mtg_deck_cards')
      .select('id, quantity, printing_finish_id')
      .eq('deck_id', deckId)
      .eq('oracle_card_id', oracleId)
      .eq('zone', zone)
      .maybeSingle()
    if (existing) {
      const { error } = await s.from('mtg_deck_cards').update({
        quantity: existing.quantity + 1,
        printing_finish_id: existing.printing_finish_id ?? preferredFinishId ?? null,
      }).eq('id', existing.id)
      if (error) { setStatus({ kind: 'err', msg: error.message }); return }
    } else {
      const { error } = await s.from('mtg_deck_cards').insert({
        deck_id: deckId,
        oracle_card_id: oracleId,
        quantity: 1,
        zone,
        printing_finish_id: preferredFinishId ?? null,
      })
      if (error) { setStatus({ kind: 'err', msg: error.message }); return }
    }
    setStatus({ kind: 'ok', msg: `Added ${cardName} to deck.` })
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={toggle}
        disabled={!checked}
        style={{
          background: 'transparent', color: 'var(--primary)',
          border: '1px solid var(--primary)',
          padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700,
          cursor: checked ? 'pointer' : 'wait', width: '100%',
        }}
      >{signedIn === false ? 'Sign in to add to a deck' : '+ Add to Deck'}</button>

      {open && signedIn && (
        <div style={{
          marginTop: 8, padding: 12, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10,
        }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Zone:
            <select value={zone} onChange={(e) => setZone(e.target.value as DeckZone)} style={pickerStyle}>
              <option value="main">Main</option>
              <option value="commander">Commander</option>
              <option value="sideboard">Sideboard</option>
              <option value="companion">Companion</option>
              <option value="maybeboard">Maybeboard</option>
            </select>
          </label>
          {decks.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              You don't have any decks yet. <a href="/decks/new" style={{ color: 'var(--primary)' }}>Create one →</a>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
              {decks.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => addToDeck(d.id)}
                  style={{
                    textAlign: 'left', padding: '6px 10px', borderRadius: 8,
                    background: 'var(--bg-light)', border: '1px solid var(--border)',
                    fontSize: 13, cursor: 'pointer', color: 'var(--text)',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.format}</div>
                </button>
              ))}
            </div>
          )}
          {status && (
            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 12,
              background: status.kind === 'ok' ? 'rgba(43,134,89,0.12)' : 'rgba(180,65,70,0.12)',
              color: status.kind === 'ok' ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${status.kind === 'ok' ? 'rgba(43,134,89,0.28)' : 'rgba(180,65,70,0.28)'}`,
            }}>{status.msg}</div>
          )}
        </div>
      )}
    </div>
  )
}

const pickerStyle: React.CSSProperties = {
  fontSize: 12, padding: '3px 8px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontFamily: 'inherit',
}
