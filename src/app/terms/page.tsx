import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms',
  description: 'Terms of use for MTGPrices.io.',
  alternates: { canonical: 'https://mtgprices.io/terms' },
}

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
      <div className="label-mono">Legal</div>
      <h1 style={{ marginTop: 6, fontSize: 30 }}>Terms of use</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>
        Last updated: {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
      </p>

      <div style={{ marginTop: 32, color: 'var(--text)', lineHeight: 1.7, fontSize: 15 }}>
        <p style={{ color: 'var(--text-muted)' }}>
          MTGPrices.io is provided as-is for informational use only. Prices are aggregated from public sources and
          may be delayed or occasionally incorrect. Nothing on this site is financial or investment advice.
        </p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>MTG intellectual property</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          MAGIC: THE GATHERING, MTG, all card names, card images, and mechanics are © Wizards of the Coast LLC.
          MTGPrices.io is not affiliated with, endorsed by, or sponsored by Wizards of the Coast.
        </p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>Data attribution</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Catalogue data via Scryfall. Price data via MTGJSON, which aggregates public marketplace pricing from
          TCGplayer, Cardmarket, Card Kingdom, ManaPool and Cardhoarder.
        </p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>No warranty</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          The service is provided without warranty of any kind. Use at your own risk.
        </p>
      </div>
    </div>
  )
}
