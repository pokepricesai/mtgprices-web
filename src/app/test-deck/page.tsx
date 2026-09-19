// app/test-deck/page.tsx, Test Your Deck landing page.
//
// Test Your Deck is deck-specific and lives at /decks/[id]/test. This
// route is only an entry point that lists the caller's decks, each
// with a link to its per-deck test flow. It does NOT reimplement any
// of the test/simulation logic.

import type { Metadata } from 'next'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/supabase/server'
import { listUserDecks } from '@/lib/mtg/decks'
import { FORMAT_BY_KEY } from '@/lib/mtg/formats.data'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Test Your Deck',
  description: 'Opening hands, mulligan analysis, draw odds and mana feasibility for any deck you save on MTGPrices.',
  alternates: { canonical: `${SITE_URL}/test-deck` },
  openGraph: { url: `${SITE_URL}/test-deck` },
}

export default async function TestDeckLanding() {
  const user = await getCurrentUser()
  const decks = user ? await listUserDecks() : []

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Test Your Deck</div>
      <h1 className="display" style={{
        margin: '6px 0 0', fontSize: 'clamp(32px, 4vw, 44px)',
        color: 'var(--text-strong)', lineHeight: 1.1,
      }}>Test Your Deck</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15.5, marginTop: 10, lineHeight: 1.6, maxWidth: 720 }}>
        Draw opening hands, model London mulligans, check draw odds and see whether your mana
        base can actually support your curve. Every test is deterministic and runs against the
        exact list you saved. No AI.
      </p>

      <div style={{
        marginTop: 22, padding: 18,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8 }}>What Test Your Deck covers</div>
        <ul style={{
          margin: 0, paddingLeft: 22, color: 'var(--text)', fontSize: 14, lineHeight: 1.65,
        }}>
          <li>Opening hands with a London mulligan model. Keep or mulligan, see what you got.</li>
          <li>Draw odds. Quantify how often a specific card shows up in your first N draws.</li>
          <li>Mana analysis. Whether your untapped coloured sources actually match your curve.</li>
          <li>A manual goldfish sandbox for testing the first few turns by hand.</li>
        </ul>
      </div>

      {!user ? (
        <SignInPanel />
      ) : decks.length === 0 ? (
        <EmptyPanel />
      ) : (
        <div style={{ marginTop: 22 }}>
          <div className="label-mono" style={{ marginBottom: 10, color: 'var(--gold-600)' }}>Pick a deck</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {decks.map((d) => (
              <Link
                key={d.id}
                href={`/decks/${d.id}/test`}
                className="card-hover card-hover-gold"
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 12, padding: '14px 16px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 12, textDecoration: 'none', color: 'var(--text)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name || 'Untitled deck'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                    {FORMAT_BY_KEY[d.format]?.label ?? d.format}
                    {d.is_public ? ' · Public' : ''}
                  </div>
                </div>
                <span className="btn btn-gold btn-sm" style={{ pointerEvents: 'none' }}>
                  Test this deck
                </span>
              </Link>
            ))}
          </div>
          <div style={{ marginTop: 18, fontSize: 13, color: 'var(--text-muted)' }}>
            Want to start something new? <Link href="/decks/new" style={{ color: 'var(--primary)' }}>Create a deck</Link>.
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyPanel() {
  return (
    <div style={{
      marginTop: 22, padding: 22,
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
    }}>
      <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>You do not have a deck yet</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
        Test Your Deck runs against the decks you save on MTGPrices. Create your first deck
        and you can test it straight away.
      </p>
      <div style={{ marginTop: 12 }}>
        <Link href="/decks/new" className="btn btn-gold">Create a deck</Link>
      </div>
    </div>
  )
}

function SignInPanel() {
  const nextParam = encodeURIComponent('/test-deck')
  return (
    <div style={{
      marginTop: 22, padding: 22,
      background: 'linear-gradient(180deg, rgba(232,169,75,0.10) 0%, rgba(232,169,75,0) 60%), var(--surface)',
      border: '1px solid var(--border)', borderRadius: 14,
    }}>
      <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Sign in to test a deck</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
        Test Your Deck works with the decks you save on MTGPrices. Sign in to your account or
        create a new one to build a deck and start testing.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <Link href={`/login?next=${nextParam}`} className="btn btn-primary btn-sm">Sign in</Link>
        <Link href={`/login?next=${nextParam}&intent=signup`} className="btn btn-gold btn-sm">Create account</Link>
      </div>
    </div>
  )
}
