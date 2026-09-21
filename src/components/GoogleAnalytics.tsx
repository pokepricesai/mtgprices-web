'use client'

// src/components/GoogleAnalytics.tsx
// Google Analytics 4 for the App Router. Injected once from layout.tsx.
//
// Two behaviours matter:
//
// 1. Initial load. next/script (strategy=afterInteractive) loads
//    gtag.js after hydration. We initialise dataLayer + gtag as GA
//    prescribes and mark send_page_view=false so the initial view is
//    NOT double-counted. The effect below fires the first page_view.
//
// 2. Client-side route changes. Next.js App Router does not trigger a
//    full page load between routes, so gtag would otherwise miss them.
//    A usePathname / useSearchParams effect fires an explicit
//    `page_view` on every path or query-string change.
//
// The component renders nothing when GA is not configured (missing
// NEXT_PUBLIC_GA_ID) or when NODE_ENV is not 'production'. This keeps
// analytics off of localhost and preview builds by default.

import Script from 'next/script'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, Suspense } from 'react'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

const GA_ID = process.env.NEXT_PUBLIC_GA_ID
const IS_ENABLED = process.env.NODE_ENV === 'production' && Boolean(GA_ID)

export default function GoogleAnalytics() {
  if (!IS_ENABLED || !GA_ID) return null
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { send_page_view: false });
        `}
      </Script>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
    </>
  )
}

// Split into its own component so useSearchParams() does not force
// the entire GA wrapper into dynamic rendering. Suspense-boundary at
// the caller is required by the App Router.
function PageViewTracker() {
  const pathname = usePathname()
  const search = useSearchParams()

  useEffect(() => {
    if (!IS_ENABLED || !GA_ID || typeof window === 'undefined') return
    if (typeof window.gtag !== 'function') return
    const query = search?.toString() ?? ''
    const pagePath = pathname + (query ? `?${query}` : '')
    window.gtag('event', 'page_view', {
      page_path: pagePath,
      page_location: window.location.href,
      page_title: document.title,
      send_to: GA_ID,
    })
  }, [pathname, search])

  return null
}
