// app/ai/page.tsx, public "Ask MTGPrices AI" surface.
//
// Logged-out visitors see the header + example prompts and are asked
// to sign in when they submit. Logged-in visitors see a deck picker
// (optional context), send a prompt, and get a grounded answer + card
// widgets. All AI mechanics reuse the existing infrastructure:
// rate-limit at 6 ops / 50 cents per user per rolling 24h, Vercel AI
// Gateway on Sonnet 5, grounded via the public-tools set.

import type { Metadata } from 'next'
import Link from 'next/link'
import { getCurrentUser, getSupabaseServerClient } from '@/lib/supabase/server'
import AskClient from './AskClient'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://mtgprices.io'

export const metadata: Metadata = {
  title: 'Ask MTGPrices AI',
  description: 'Ask about Magic: The Gathering cards, prices, formats, deck ideas and alternatives. Answers are grounded in the MTGPrices database.',
  alternates: { canonical: `${SITE_URL}/ai` },
  openGraph: { url: `${SITE_URL}/ai` },
}

const EXAMPLES = [
  'How much is Sol Ring?',
  'Find cheap red removal for Commander',
  'Is Lightning Bolt legal in Modern?',
  'What are cheaper alternatives to Rhystic Study?',
  'Find cards that create Treasure tokens',
  'Help improve my Commander deck',
  'What cards are moving in price?',
]

export default async function AskPage() {
  const user = await getCurrentUser()
  let decks: { id: string; name: string; format: string }[] = []
  if (user) {
    const supabase = await getSupabaseServerClient()
    const { data } = await supabase
      .from('mtg_decks')
      .select('id, name, format')
      .order('updated_at', { ascending: false })
      .limit(20)
    decks = (data ?? []) as any
  }
  const nextParam = encodeURIComponent('/ai')

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Ask MTGPrices AI</div>
      <h1 className="display" style={{
        margin: '6px 0 0', fontSize: 'clamp(32px, 4vw, 44px)',
        color: 'var(--text-strong)', lineHeight: 1.1,
      }}>Ask MTGPrices</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15.5, marginTop: 10, lineHeight: 1.6, maxWidth: 720 }}>
        Ask about cards, prices, formats, deck ideas and alternatives. Answers are grounded in
        the MTGPrices database. If the AI does not know a card, it will say so rather than invent one.
      </p>

      {!user && (
        <div style={{
          marginTop: 22, padding: 16,
          background: 'linear-gradient(180deg, rgba(232,169,75,0.10) 0%, rgba(232,169,75,0) 60%), var(--surface)',
          border: '1px solid var(--border)', borderRadius: 14,
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 14 }}>Sign in to ask a question. Free preview quota applies.</span>
          <Link href={`/login?next=${nextParam}`} className="btn btn-primary btn-sm">Sign in</Link>
          <Link href={`/login?next=${nextParam}&intent=signup`} className="btn btn-ghost btn-sm">Create account</Link>
        </div>
      )}

      <AskClient signedIn={Boolean(user)} decks={decks} examples={EXAMPLES} />

      <section style={{
        marginTop: 34, padding: 20,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8 }}>How grounding works</div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          MTGPrices AI can only cite cards that a search returned during your question. It cannot
          invent card names, oracle text, prices or legalities. Prices are always TCGplayer USD
          paper retail unless the answer says otherwise. For deck specific analysis (Analyse,
          Improve, Replace) open a deck on the {' '}
          <Link href="/decks" style={{ color: 'var(--primary)' }}>My Decks</Link> page.
        </p>
      </section>
    </div>
  )
}
