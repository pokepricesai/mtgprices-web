// Default OG / Twitter share image at 1200×630. Deep midnight-navy card
// with gold + arcane-blue accents, echoing the MTGPrices wordmark.
import { ImageResponse } from 'next/og'

export const alt = 'MTGPrices. Live MTG card prices, sets, and deck intelligence'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-static'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background:
            'radial-gradient(120% 100% at 15% 15%, #1b3163 0%, #0d1b3a 45%, #08122a 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          position: 'relative',
        }}
      >
        {/* Gold aurora */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -140,
            width: 520,
            height: 520,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at center, rgba(232,169,75,0.28), rgba(232,169,75,0) 65%)',
          }}
        />
        {/* Ember spark */}
        <div
          style={{
            position: 'absolute',
            bottom: -120,
            left: -80,
            width: 360,
            height: 360,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at center, rgba(232,90,44,0.22), rgba(232,90,44,0) 60%)',
          }}
        />

        {/* Top-left wordmark */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              color: '#F4E8CE',
              fontSize: 40,
              fontWeight: 800,
              fontFamily: 'sans-serif',
              letterSpacing: '-0.02em',
            }}
          >
            MTGPrices
          </span>
          <span
            style={{
              color: '#E8A94B',
              fontSize: 18,
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            .io
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1000 }}>
          <span
            style={{
              color: '#8FB3E2',
              fontSize: 18,
              fontFamily: 'monospace',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            Prices · Printings · Decks · Rules
          </span>
          <span
            style={{
              color: '#F6EED9',
              fontSize: 78,
              fontWeight: 800,
              fontFamily: 'sans-serif',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              display: 'flex',
              flexWrap: 'wrap',
            }}
          >
            Know every card. Build better decks.
          </span>
        </div>

        {/* Footer strip */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span
            style={{
              display: 'flex',
              padding: '12px 22px',
              background:
                'linear-gradient(135deg, #E8A94B 0%, #D97428 100%)',
              color: '#1a0f04',
              borderRadius: 14,
              fontSize: 22,
              fontWeight: 800,
              fontFamily: 'sans-serif',
              letterSpacing: '-0.01em',
            }}
          >
            mtgprices.io
          </span>
          <span
            style={{
              display: 'flex',
              color: '#B7C6DE',
              fontSize: 22,
              fontFamily: 'sans-serif',
            }}
          >
            Live pricing · Card Finder · Deck Builder · Test Your Deck
          </span>
        </div>
      </div>
    ),
    { ...size },
  )
}
