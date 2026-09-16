import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import SiteStructuredData from '@/components/SiteStructuredData'
import { SITE_LAUNCHED, SITE_URL } from '@/lib/launch'

const SITE_NAME = 'MTGPrices'
const SITE_TAGLINE = 'Live MTG card prices, sets, and history'
const SITE_DESCRIPTION =
  'MTGPrices — live Magic: The Gathering card prices, printings, historical charts and set catalogue. Powered by Scryfall + MTGJSON. Free, no login required.'

const GA_ID = process.env.NEXT_PUBLIC_GA_ID

const LAUNCHED_ROBOTS: NonNullable<Metadata['robots']> = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    'max-video-preview': -1,
    'max-image-preview': 'large',
    'max-snippet': -1,
  },
}

const PRE_LAUNCH_ROBOTS: NonNullable<Metadata['robots']> = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: {
    index: false,
    follow: false,
    noimageindex: true,
  },
}

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    locale: 'en_US',
    // Per-page metadata SHOULD set its own openGraph.url so social
    // previews resolve to the specific page. The site-root URL here is
    // the fallback for pages that don't set one (currently just "/").
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    // Images auto-attached from src/app/opengraph-image.tsx
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  alternates: { canonical: SITE_URL },
  robots: SITE_LAUNCHED ? LAUNCHED_ROBOTS : PRE_LAUNCH_ROBOTS,
  // Favicon + apple-icon + OG image are all generated dynamically from
  // src/app/{icon,apple-icon,opengraph-image}.tsx via @vercel/og.
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Figtree:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        {GA_ID ? (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
            <Script id="google-analytics" strategy="afterInteractive">{`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${GA_ID}');
            `}</Script>
          </>
        ) : null}
        <SiteStructuredData />
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
