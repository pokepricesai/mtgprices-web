// app/layout.tsx
import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import SiteStructuredData from '@/components/SiteStructuredData'
import ScrollToTop from '@/components/ScrollToTop'
import AnalyticsInit from '@/components/AnalyticsInit'
// Block 5A-W-50E — ambient popstate listener that marks each history
// navigation so per-route scroll restoration hooks can distinguish a
// browser Back arrival from a fresh visit.
import NavHistoryListener from '@/components/NavHistoryListener'

export const metadata: Metadata = {
  metadataBase: new URL('https://www.pokeprices.io'),
  title: 'PokePrices — Pokémon Card Value Checker & Price Guide',
  description: 'Free Pokémon card value checker — live raw and PSA 10 prices for 40,000+ cards. Price guide with grading spreads, PSA population and 30-day trends. No login.',
  authors: [{ name: 'PokePrices' }],
  creator: 'PokePrices',
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: 'https://www.pokeprices.io',
    siteName: 'PokePrices',
    title: 'PokePrices — Pokémon Card Value Checker & Price Guide',
    description: 'Free Pokémon card value checker — live raw and PSA 10 prices for 40,000+ cards. Price guide with grading spreads, PSA population and 30-day trends.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'PokePrices — Pokémon Card Value Checker & Price Guide',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PokePrices — Pokémon Card Value Checker & Price Guide',
    description: 'Free Pokémon card value checker — live raw and PSA 10 prices for 40,000+ cards. Price guide with grading spreads, PSA population and 30-day trends.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-32x32.png',
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800;900&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* Impact site-ownership verification. Impact's crawler expects the
            value= attribute literally (not the standard content=), so this
            is rendered as raw JSX rather than through Next's Metadata API,
            which would emit content=. Ownership verification only — no
            Impact tracking scripts are loaded from this tag. */}
        <meta
          {...({
            name:  'impact-site-verification',
            value: 'c311cc8d-61a2-4ec7-97ac-fa7394d477bb',
          } as Record<string, string>)}
        />
      </head>
      <body className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-91WBNN7V11"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-91WBNN7V11');
          `}
        </Script>
        <SiteStructuredData />
        <ScrollToTop />
        <NavHistoryListener />
        <AnalyticsInit />
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}