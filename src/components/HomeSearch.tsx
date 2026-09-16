'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = { placeholder?: string }

export default function HomeSearch({ placeholder = 'Search MTG cards…' }: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = q.trim()
    if (!trimmed) return
    router.push(`/cards/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <span
          aria-hidden
          style={{
            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
            fontSize: 16, color: 'var(--text-muted)', pointerEvents: 'none',
          }}
        >⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label="Search MTG cards"
          style={{
            width: '100%', padding: '14px 14px 14px 40px',
            borderRadius: 12, border: '1px solid var(--border)',
            background: 'var(--bg-light)', color: 'var(--text)',
            fontSize: 16, outline: 'none', boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <button
        type="submit"
        style={{
          background: 'var(--primary)', color: '#fff',
          border: 'none', borderRadius: 12,
          padding: '0 20px', fontWeight: 700, fontSize: 15, cursor: 'pointer',
        }}
      >Search</button>
    </form>
  )
}
