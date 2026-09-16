'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

type Props = { nextPath: string; initialError?: string }

export default function LoginClient({ nextPath, initialError }: Props) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)

  async function signInWithGoogle() {
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) setError(error.message)
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)
    setSent(false)
    const supabase = getSupabaseBrowserClient()
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo, shouldCreateUser: true },
    })
    setSending(false)
    if (error) setError(error.message); else setSent(true)
  }

  return (
    <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
      {error && (
        <div style={{
          padding: 12, background: 'rgba(180,65,70,0.10)', border: '1px solid rgba(180,65,70,0.28)',
          borderRadius: 10, color: 'var(--red)', fontSize: 13,
        }}>{error}</div>
      )}

      <button
        type="button"
        onClick={signInWithGoogle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          background: 'var(--surface)', border: '1px solid var(--border)',
          color: 'var(--text)', padding: '12px 16px', borderRadius: 10,
          fontSize: 15, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.1A6.99 6.99 0 015.46 12c0-.73.13-1.44.36-2.1V7.06H2.18A11 11 0 001 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/>
        </svg>
        Continue with Google
      </button>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        color: 'var(--text-muted)', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span>Or use email</span>
        <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <form onSubmit={sendMagicLink} style={{ display: 'grid', gap: 8 }}>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          style={{
            padding: '12px 14px', border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text)', borderRadius: 10, fontSize: 15, outline: 'none',
            fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={sending || !email.trim()}
          style={{
            background: 'var(--primary)', color: '#fff', border: 'none',
            padding: '11px 16px', borderRadius: 10,
            fontWeight: 700, fontSize: 14, cursor: sending ? 'wait' : 'pointer',
            opacity: sending || !email.trim() ? 0.6 : 1,
          }}
        >
          {sending ? 'Sending…' : 'Email me a magic link'}
        </button>
      </form>

      {sent && (
        <div style={{
          padding: 12, background: 'rgba(43,134,89,0.10)', border: '1px solid rgba(43,134,89,0.28)',
          borderRadius: 10, color: 'var(--green)', fontSize: 13,
        }}>
          Check your inbox — a magic-link sign-in email is on the way.
        </div>
      )}
    </div>
  )
}
