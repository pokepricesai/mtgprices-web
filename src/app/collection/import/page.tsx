// app/collection/import/page.tsx, CSV import for the collection.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import ImportClient from './ImportClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Import CSV',
  description: 'Import your MTG collection from Moxfield, Deckbox, Archidekt or a generic CSV.',
  alternates: { canonical: 'https://mtgprices.io/collection/import' },
  openGraph: { url: 'https://mtgprices.io/collection/import' },
  robots: { index: false, follow: false },
}

export default async function ImportPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/collection/import')

  return (
    <div style={{ maxWidth: 780, margin: '40px auto', padding: '0 24px 80px' }}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        <Link href="/collection" style={{ color: 'inherit' }}>Collection</Link>
        <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
        <span style={{ color: 'var(--text)' }}>Import</span>
      </nav>
      <div className="label-mono">Collection · Import</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 26 }}>Import from CSV</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.55 }}>
        Paste or upload a CSV exported from Moxfield, Deckbox, Archidekt, or a plain
        <code style={{ margin: '0 4px', padding: '1px 6px', background: 'var(--bg-light)', borderRadius: 4, fontSize: 12 }}>name, set, collector_number, quantity, condition, finish</code>
        file. We match on set code + collector number first, then card name.
        Anything ambiguous is flagged, never silently imported.
      </p>
      <ImportClient />
    </div>
  )
}
