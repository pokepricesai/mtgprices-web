'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { CONDITIONS_ORDERED, CONDITION_SHORT, type CardCondition } from '@/lib/mtg/collection.data'

type Props = {
  itemId: string
  quantity: number
  condition: CardCondition
}

export default function CollectionRowActions({ itemId, quantity, condition }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function updateQuantity(delta: number) {
    const supabase = getSupabaseBrowserClient()
    setBusy(true)
    if (quantity + delta <= 0) {
      await supabase.from('mtg_collection_items').delete().eq('id', itemId)
    } else {
      await supabase.from('mtg_collection_items').update({ quantity: quantity + delta }).eq('id', itemId)
    }
    setBusy(false)
    router.refresh()
  }

  async function changeCondition(c: CardCondition) {
    if (c === condition) return
    setBusy(true)
    const supabase = getSupabaseBrowserClient()
    // Attempt update, if a row with the target condition already
    // exists, Postgres will 23505 on the unique constraint; we handle
    // that by merging.
    const { error } = await supabase.from('mtg_collection_items')
      .update({ condition: c })
      .eq('id', itemId)
    if (error && error.code === '23505') {
      // A row with (user, finish, target-condition) already exists ,
      // merge quantities and delete the current row.
      const { data: cur } = await supabase.from('mtg_collection_items').select('printing_finish_id, quantity').eq('id', itemId).single()
      if (cur) {
        const { data: existing } = await supabase.from('mtg_collection_items')
          .select('id, quantity')
          .eq('printing_finish_id', cur.printing_finish_id)
          .eq('condition', c)
          .single()
        if (existing) {
          await supabase.from('mtg_collection_items').update({ quantity: existing.quantity + cur.quantity }).eq('id', existing.id)
          await supabase.from('mtg_collection_items').delete().eq('id', itemId)
        }
      }
    }
    setBusy(false)
    router.refresh()
  }

  async function removeAll() {
    if (!confirm('Remove all copies of this printing/condition from your collection?')) return
    setBusy(true)
    const supabase = getSupabaseBrowserClient()
    await supabase.from('mtg_collection_items').delete().eq('id', itemId)
    setBusy(false)
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
      <button type="button" onClick={() => updateQuantity(-1)} disabled={busy} style={btnStyle} aria-label="Remove one" title="Remove one">–</button>
      <button type="button" onClick={() => updateQuantity(+1)} disabled={busy} style={btnStyle} aria-label="Add one" title="Add one">+</button>
      <details style={{ position: 'relative' }}>
        <summary style={{ ...btnStyle, listStyle: 'none', cursor: 'pointer', display: 'inline-flex' }} aria-label="Change condition">{CONDITION_SHORT[condition]}</summary>
        <div style={{
          position: 'absolute', right: 0, top: 32, zIndex: 5,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 6, minWidth: 150, boxShadow: '0 8px 24px rgba(23,32,58,0.10)',
        }}>
          {CONDITIONS_ORDERED.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => changeCondition(c)}
              disabled={busy}
              style={{
                display: 'block', width: '100%', padding: '6px 8px',
                background: c === condition ? 'var(--primary-soft)' : 'transparent',
                color: 'var(--text)', border: 'none', textAlign: 'left', fontSize: 12,
                cursor: 'pointer', borderRadius: 6, fontFamily: 'inherit',
              }}
            >{CONDITION_SHORT[c]} · {c.replace(/_/g, ' ')}</button>
          ))}
        </div>
      </details>
      <button type="button" onClick={removeAll} disabled={busy} style={{ ...btnStyle, color: 'var(--red)' }} aria-label="Remove all" title="Remove all">×</button>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 12, fontWeight: 700,
  background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text)', cursor: 'pointer', minWidth: 30,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
