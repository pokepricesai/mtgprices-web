// app/privacy/page.tsx
import Link from 'next/link'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'

export const metadata = {
  title: 'Privacy Policy — PokePrices',
  description: 'How PokePrices handles your data — short version: we collect very little, never sell it, and let you delete anything you create.',
  alternates: { canonical: 'https://www.pokeprices.io/privacy' },
}

export default function PrivacyPage() {
  const updated = 'May 2026'

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: 17, fontWeight: 800, color: 'var(--text)',
        fontFamily: "'Figtree', sans-serif", margin: '0 0 12px',
        paddingBottom: 8, borderBottom: '1px solid var(--border)',
      }}>{title}</h2>
      <div style={{
        fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75,
        fontFamily: "'Figtree', sans-serif",
      }}>
        {children}
      </div>
    </div>
  )

  const P = ({ children }: { children: React.ReactNode }) => (
    <p style={{ margin: '0 0 12px' }}>{children}</p>
  )

  const UL = ({ children }: { children: React.ReactNode }) => (
    <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>{children}</ul>
  )

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
      <BreadcrumbSchema items={[{ name: 'Privacy Policy' }]} />

      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <Link href="/" style={{
          fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none',
          fontFamily: "'Figtree', sans-serif", display: 'block', marginBottom: 24,
        }}>
          ← Back to PokePrices
        </Link>
        <h1 style={{
          fontSize: 32, fontWeight: 900, margin: '0 0 8px',
          fontFamily: "'Outfit', sans-serif", color: 'var(--text)',
        }}>
          Privacy Policy
        </h1>
        <p style={{
          fontSize: 13, color: 'var(--text-muted)', margin: 0,
          fontFamily: "'Figtree', sans-serif",
        }}>
          Last updated: {updated}
        </p>
      </div>

      {/* Short version */}
      <div style={{
        background: 'rgba(26,95,173,0.05)', border: '1px solid rgba(26,95,173,0.15)',
        borderRadius: 12, padding: '16px 20px', marginBottom: 36,
        fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7,
        fontFamily: "'Figtree', sans-serif",
      }}>
        <strong style={{ color: 'var(--text)' }}>Short version:</strong> PokePrices is free, no login required to use the price data. We collect very little. We do not sell, rent, or share your data with marketers. If you create an account to use the trackers, you can delete it and your data at any time. Full detail below.
      </div>

      <Section title="1. Who runs this site">
        <P>PokePrices.io is operated by Luke, an independent UK-based developer. Contact: <a href="mailto:contact@pokeprices.io" style={{ color: 'var(--primary)' }}>contact@pokeprices.io</a>.</P>
      </Section>

      <Section title="2. What we collect when you just visit">
        <P>Browsing PokePrices anonymously — looking at card pages, sets, insights, the AI assistant — does not require an account and does not require you to give us any personal information.</P>
        <P>We use Google Analytics to count visits and understand which pages people use. This drops standard analytics cookies and records your approximate location (country level), device type, browser and the pages you view. We do not use the analytics data to identify you personally. You can opt out at the browser level using any standard ad/analytics blocker.</P>
        <P>Our hosting providers (Vercel for the website, Supabase for the database) keep short-lived request logs that include IP addresses for security and abuse prevention. These logs roll over automatically and are not used for marketing.</P>
      </Section>

      <Section title="3. Newsletter signup (opt-in)">
        <P>If you give us your email address through the "Monthly collector digest" signup, we store it so we can send you the monthly digest you asked for. We do not share or sell email addresses. Every digest has an unsubscribe link, and clicking unsubscribe permanently removes you from the list.</P>
      </Section>

      <Section title="4. Creating an account (for the trackers)">
        <P>Trackers — Portfolio, Watchlist, Set Completion, Smart Alerts, Card Show Planner — require an account so we can save your work to you and not someone else. Authentication is handled by Supabase Auth. We use it because it is reputable and we did not want to roll our own.</P>
        <P>When you create an account we store:</P>
        <UL>
          <li>Your email address (or a Google-issued identifier if you sign in with Google).</li>
          <li>A user ID (random, opaque) we use internally to link your portfolio, watchlist and alerts to you.</li>
          <li>An optional display name and chosen Pokémon avatar (kept in user metadata).</li>
          <li>Whatever you put into the trackers — cards you own, watched cards, set progress, alert thresholds.</li>
          <li>Your email preferences (digest on/off, alert delivery cadence).</li>
        </UL>
        <P>We do not collect, ask for, or store any payment information. We never request your real name, address, date of birth or phone number.</P>
        <P>If you sign in with Google, Google sends us your email address and a Google account identifier. We do not get access to your contacts, calendar, Drive or anything else.</P>
      </Section>

      <Section title="5. Cookies">
        <P>We use a small number of cookies, all of which fall into the "strictly necessary" or "analytics" categories under UK / EU rules:</P>
        <UL>
          <li><strong style={{ color: 'var(--text)' }}>Authentication cookies</strong> — only set if you sign in. These keep you logged in. Provided by Supabase.</li>
          <li><strong style={{ color: 'var(--text)' }}>Analytics cookies</strong> — Google Analytics first-party cookies that count visits.</li>
          <li><strong style={{ color: 'var(--text)' }}>Affiliate attribution</strong> — when you click an eBay listing link, eBay drops their own cookie so they can attribute the sale to us. We never see who clicked or what you bought; we only see aggregate commission totals.</li>
        </UL>
        <P>We do not use behavioural advertising cookies, retargeting pixels, or cross-site tracking.</P>
      </Section>

      <Section title="6. AI assistant">
        <P>The "Ask Me Anything" chat is anonymous. Each chat session gets a random session ID generated in your browser. We do not link conversations to your account or your email. Your messages are sent to our AI provider (Anthropic) so it can generate a response; we do not use the conversations to train any model.</P>
        <P>Please do not put personal information into the chat — it is not the right tool for that.</P>
      </Section>

      <Section title="7. Third parties we share data with">
        <P>We do not sell or rent data. Some services are essential to running the site:</P>
        <UL>
          <li><strong style={{ color: 'var(--text)' }}>Vercel</strong> — web hosting. Sees standard request logs.</li>
          <li><strong style={{ color: 'var(--text)' }}>Supabase</strong> — database and authentication. Stores your account, tracker data and email preferences.</li>
          <li><strong style={{ color: 'var(--text)' }}>Google Analytics</strong> — anonymous traffic measurement.</li>
          <li><strong style={{ color: 'var(--text)' }}>Anthropic</strong> — powers the AI assistant. Receives the chat messages you send so it can respond.</li>
          <li><strong style={{ color: 'var(--text)' }}>Google Sign-In</strong> — optional, only if you choose to sign in with Google. Google receives the standard data needed to authenticate you.</li>
          <li><strong style={{ color: 'var(--text)' }}>eBay Partner Network</strong> — affiliate links to eBay listings. Sets a cookie when you click through.</li>
        </UL>
      </Section>

      <Section title="8. How long we keep your data">
        <P>Newsletter email addresses — until you unsubscribe.</P>
        <P>Account data — until you delete your account (see below). Portfolio / watchlist / alert data lives alongside your account and goes with it.</P>
        <P>Analytics data — retained per Google Analytics' default (currently 14 months).</P>
        <P>AI chat sessions — not stored against your identity. Anthropic retains the raw API calls per their data policy.</P>
      </Section>

      <Section title="9. Your rights">
        <P>You have rights under UK GDPR (and equivalent rights under EU GDPR and most other regimes):</P>
        <UL>
          <li><strong style={{ color: 'var(--text)' }}>Access</strong> — ask what we hold about you.</li>
          <li><strong style={{ color: 'var(--text)' }}>Correction</strong> — fix anything that is wrong.</li>
          <li><strong style={{ color: 'var(--text)' }}>Deletion</strong> — have your account and all associated tracker data removed.</li>
          <li><strong style={{ color: 'var(--text)' }}>Portability</strong> — get a copy of your tracker data in a portable format.</li>
          <li><strong style={{ color: 'var(--text)' }}>Withdraw consent</strong> — unsubscribe from email, opt out of analytics, delete your account.</li>
        </UL>
        <P>Email <a href="mailto:contact@pokeprices.io" style={{ color: 'var(--primary)' }}>contact@pokeprices.io</a> and we will action requests within 7 days. You can also delete your own account directly from <Link href="/dashboard/settings" style={{ color: 'var(--primary)' }}>Settings</Link>.</P>
        <P>If you are unhappy with how we have handled your data, you have the right to complain to the UK Information Commissioner's Office at <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>ico.org.uk</a>.</P>
      </Section>

      <Section title="10. Children">
        <P>PokePrices is not directed at children under 13. We do not knowingly collect data from anyone under 13. If you believe we have collected data from a child, contact us and we will remove it.</P>
      </Section>

      <Section title="11. International transfers">
        <P>Our hosting providers (Vercel, Supabase) and analytics provider (Google) may store and process data in regions outside the UK / EU, including the United States. These providers use standard contractual clauses and other recognised safeguards for international data transfers.</P>
      </Section>

      <Section title="12. Changes to this policy">
        <P>If we make material changes to how we handle data, we will update this page and refresh the date at the top. For significant changes that affect existing account holders, we will also send a notice via the newsletter or email if you have one on file.</P>
      </Section>

      <Section title="13. Contact">
        <P>Anything privacy-related: <a href="mailto:contact@pokeprices.io" style={{ color: 'var(--primary)' }}>contact@pokeprices.io</a>. Real human, reads every message.</P>
      </Section>

      {/* Footer nav */}
      <div style={{
        borderTop: '1px solid var(--border)', paddingTop: 24, marginTop: 8,
        display: 'flex', gap: 20, flexWrap: 'wrap',
      }}>
        {[
          { href: '/', label: 'Home' },
          { href: '/terms', label: 'Terms of Service' },
          { href: '/contact', label: 'Contact' },
        ].map(l => (
          <Link key={l.href} href={l.href} style={{
            fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none',
            fontFamily: "'Figtree', sans-serif",
          }}>
            {l.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
