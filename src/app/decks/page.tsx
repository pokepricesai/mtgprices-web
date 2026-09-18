// app/decks/page.tsx, user's deck library.

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { listUserDecks, getDeckCards } from '@/lib/mtg/decks'
import { buildDeckContext } from '@/lib/mtg/deck-context'
import { getFormatRule } from '@/lib/mtg/format-rules'
import { currencySymbol } from '@/lib/mtg/valuation.data'
import DeckLibraryActions from './DeckLibraryActions'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'My Decks',
  description: 'Your MTG decks.',
  alternates: { canonical: `${SITE_URL}/decks` },
  openGraph: { url: `${SITE_URL}/decks` },
  robots: { index: false, follow: false },
}

export default async function DecksPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/decks')

  const decks = await listUserDecks()

  // Cheap library-level context per deck (we hydrate only totals + value + validation head).
  const summaries = await Promise.all(decks.map(async (d) => {
    const cards = await getDeckCards(d.id)
    const ctx = await buildDeckContext(d, cards)
    return {
      deck: d,
      cardCount: ctx.totals.main + ctx.totals.commander,
      commanderName: ctx.commanders.map((c) => c.name).join(' & ') || null,
      validationOk: ctx.validation.ok,
      issueCount: ctx.validation.issues.length,
      warningCount: ctx.validation.warnings.length,
      deckValue: ctx.pricing.deckValue,
      basis: ctx.pricing.basis,
      ownedCards: ctx.ownership.ownedCards,
      missingCards: ctx.ownership.missingCards,
    }
  }))

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
        <div>
          <div className="label-mono">Play · Decks</div>
          <h1 style={{ margin: '6px 0 0', fontSize: 30 }}>Your MTG decks</h1>
        </div>
        <Link href="/decks/new" style={{
          background: 'var(--primary)', color: '#fff',
          padding: '10px 18px', borderRadius: 10, fontWeight: 700, fontSize: 14,
          textDecoration: 'none',
        }}>+ New deck</Link>
      </div>

      {decks.length === 0 ? (
        <div style={{ padding: 24, background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-muted)', fontSize: 14, textAlign: 'center' }}>
          No decks yet. <Link href="/decks/new" style={{ color: 'var(--primary)' }}>Start your first deck →</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {summaries.map((s) => {
            const rule = getFormatRule(s.deck.format)
            return (
              <div key={s.deck.id} style={{
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 14,
                padding: 16, background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 12,
              }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/decks/${s.deck.id}`} style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700, textDecoration: 'none' }}>{s.deck.name}</Link>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>{rule?.label ?? s.deck.format}</span>
                    <span>· {s.cardCount} cards</span>
                    {s.commanderName && <span>· {s.commanderName}</span>}
                    <span>· updated {s.deck.updated_at.slice(0, 10)}</span>
                  </div>
                  <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{
                      padding: '2px 10px', borderRadius: 999, fontWeight: 700,
                      background: s.validationOk ? 'rgba(43,134,89,0.14)' : 'rgba(180,65,70,0.14)',
                      color: s.validationOk ? 'var(--green)' : 'var(--red)',
                    }}>{s.validationOk ? 'Legal' : `${s.issueCount} issue${s.issueCount === 1 ? '' : 's'}`}</span>
                    {s.warningCount > 0 && <span style={{ color: 'var(--amber)' }}>{s.warningCount} warning{s.warningCount === 1 ? '' : 's'}</span>}
                    <span style={{ color: 'var(--text-muted)' }}>
                      {s.ownedCards + s.missingCards === 0 ? 'no ownership yet' :
                        `${s.ownedCards} owned · ${s.missingCards} missing`}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: 18, fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  }}>{currencySymbol(s.basis.currency)}{s.deckValue.toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.basis.provider} · {s.basis.currency}</div>
                  <DeckLibraryActions deckId={s.deck.id} deckName={s.deck.name} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
