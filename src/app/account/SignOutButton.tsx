'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

export default function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    const supabase = getSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      style={{
        background: 'transparent', color: 'var(--text)',
        border: '1px solid var(--border)', padding: '10px 16px',
        borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: busy ? 'wait' : 'pointer',
      }}
    >{busy ? 'Signing out…' : 'Sign out'}</button>
  )
}
