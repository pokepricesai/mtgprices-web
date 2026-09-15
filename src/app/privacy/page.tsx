import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How MTGPrices handles your data — short version: we collect very little.',
  alternates: { canonical: 'https://mtgprices.io/privacy' },
}

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
      <div className="label-mono">Legal</div>
      <h1 style={{ marginTop: 6, fontSize: 30 }}>Privacy</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>Last updated: {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>

      <div style={{ marginTop: 32, color: 'var(--text)', lineHeight: 1.7, fontSize: 15 }}>
        <p>MTGPrices is a free MTG price and catalogue reference. We do not require accounts to browse.</p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>Analytics</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          We use Google Analytics to understand aggregate site usage. No personally identifying data is collected
          from casual browsing.
        </p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>Data sources</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          MTG catalogue data comes from Scryfall. Price data comes from MTGJSON, which aggregates public pricing
          published by TCGplayer, Cardmarket, Card Kingdom, ManaPool and Cardhoarder. Card images © Wizards of the
          Coast.
        </p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>Contact</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Questions about your data? See <a href="/contact" style={{ color: 'var(--primary)' }}>the contact page</a>.
        </p>
      </div>
    </div>
  )
}
