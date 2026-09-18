import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Get in touch with the MTGPrices team.',
  alternates: { canonical: 'https://mtgprices.io/contact' },
  openGraph: { url: 'https://mtgprices.io/contact' },
}

export default function ContactPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
      <div className="label-mono">Contact</div>
      <h1 style={{ marginTop: 6, fontSize: 30 }}>Say hello</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 15 }}>
        Feedback, corrections, dealer partnership enquiries. All welcome.
      </p>

      <div
        style={{
          marginTop: 32,
          padding: 20,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}
      >
        <div className="label-mono">Email</div>
        <a
          href="mailto:hello@mtgprices.io"
          style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)', marginTop: 6, display: 'inline-block' }}
        >
          hello@mtgprices.io
        </a>
      </div>
    </div>
  )
}
