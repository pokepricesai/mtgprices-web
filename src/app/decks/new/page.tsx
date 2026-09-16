// app/decks/new/page.tsx — new deck setup.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { FORMATS } from '@/lib/mtg/formats.data'
import { FORMAT_RULES } from '@/lib/mtg/format-rules'
import NewDeckClient from './NewDeckClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'New deck',
  description: 'Start a new MTG deck.',
  alternates: { canonical: 'https://mtgprices.io/decks/new' },
  openGraph: { url: 'https://mtgprices.io/decks/new' },
  robots: { index: false, follow: false },
}

export default async function NewDeckPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/decks/new')

  const supportedFormats = FORMATS.filter((f) => FORMAT_RULES[f.key])
  return (
    <div style={{ maxWidth: 620, margin: '40px auto', padding: '0 24px 80px' }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        <Link href="/decks" style={{ color: 'inherit' }}>My decks</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <span style={{ color: 'var(--text)' }}>New</span>
      </nav>
      <div className="label-mono">Play · Decks · New</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28 }}>New deck</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>
        Pick a format and give your deck a name. You can change either later.
      </p>
      <NewDeckClient
        formats={supportedFormats.map((f) => ({
          key: f.key,
          label: f.label,
          group: f.group,
          hasCommander: FORMAT_RULES[f.key].hasCommander,
          blurb: f.blurb,
        }))}
      />
    </div>
  )
}
