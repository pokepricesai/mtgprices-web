'use client'

// src/app/settings/DeleteProfileForm.tsx
// Requires the user to type DELETE, calls the API, then signs out and
// returns to the homepage. Does NOT touch auth.users. That identity is
// shared with Poképrices.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

export default function DeleteProfileForm() {
  const router = useRouter()
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const armed = confirmText.trim().toUpperCase() === 'DELETE'

  async function submit() {
    if (!armed || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/account/delete-profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBusy(false)
        setError(json.error ?? `HTTP ${res.status}`)
        return
      }
      // Server has wiped MTGPrices data. Sign out client-side (which
      // clears the Supabase cookie) then return to /.
      const supabase = getSupabaseBrowserClient()
      await supabase.auth.signOut().catch(() => {})
      router.push('/?profile-deleted=1')
      router.refresh()
    } catch (err: any) {
      setBusy(false)
      setError(String(err?.message ?? err))
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Type DELETE to continue
      </label>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="DELETE"
        disabled={busy}
        style={{
          padding: '10px 12px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'var(--bg-light)',
          color: 'var(--text)', fontSize: 15, fontFamily: 'inherit',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={submit}
          disabled={!armed || busy}
          style={{
            padding: '10px 16px', borderRadius: 10,
            background: armed ? 'var(--red)' : 'var(--bg-strong)',
            color: '#fff', border: 'none', cursor: armed ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            opacity: armed && !busy ? 1 : 0.75,
          }}
        >{busy ? 'Deleting…' : 'Delete my MTGPrices profile'}</button>
        {error && <span style={{ color: 'var(--red)', fontSize: 12 }}>{error}</span>}
      </div>
    </div>
  )
}
