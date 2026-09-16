'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { VALUATION_BASES, DEFAULT_BASIS, findBasis, type ValuationBasis } from '@/lib/mtg/valuation.data'

type Props = {
  current: {
    provider: string
    currency: string
    price_type: string
    market: string
  }
}

export default function ValuationBasisPicker({ current }: Props) {
  const router = useRouter()
  const initial = findBasis({
    provider: current.provider,
    currency: current.currency as 'USD' | 'EUR',
    price_type: current.price_type as 'retail' | 'buylist',
    market: current.market as 'paper' | 'mtgo',
  }) ?? DEFAULT_BASIS
  const [selected, setSelected] = useState<ValuationBasis>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    setSaved(false)
    const supabase = getSupabaseBrowserClient()
    const { data: user } = await supabase.auth.getUser()
    const uid = user.user?.id
    if (!uid) { setSaving(false); return }
    const { error } = await supabase.from('mtg_user_prefs').upsert({
      user_id: uid,
      valuation_provider: selected.provider,
      valuation_currency: selected.currency,
      valuation_price_type: selected.price_type,
      valuation_market: selected.market,
    })
    setSaving(false)
    if (!error) {
      setSaved(true)
      router.refresh()
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        {VALUATION_BASES.map((b) => {
          const isSelected = b.provider === selected.provider
            && b.currency === selected.currency
            && b.price_type === selected.price_type
            && b.market === selected.market
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setSelected(b)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', textAlign: 'left',
                background: isSelected ? 'var(--primary-soft)' : 'var(--bg-light)',
                border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 10, cursor: 'pointer',
                color: 'var(--text)', fontFamily: 'inherit',
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{b.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {b.description}
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                background: 'var(--surface)', color: 'var(--text-muted)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}>{b.currency}</span>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            background: 'var(--primary)', color: '#fff', border: 'none',
            padding: '8px 14px', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}
        >{saving ? 'Saving…' : 'Save default'}</button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 12 }}>Saved.</span>}
      </div>
    </div>
  )
}
