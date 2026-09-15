// Default OG / Twitter share image at 1200×630. Dark premium brand card.
import { ImageResponse } from 'next/og'

export const alt = 'MTGPrices — live MTG card prices, sets, and history'
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
          background: '#111318',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          position: 'relative',
        }}
      >
        {/* Subtle backdrop pattern — offset gold dot */}
        <div
          style={{
            position: 'absolute',
            top: -80,
            right: -80,
            width: 360,
            height: 360,
            borderRadius: '50%',
            background: 'radial-gradient(circle at center, rgba(201,165,92,0.14), rgba(201,165,92,0) 60%)',
          }}
        />

        {/* Top-left wordmark */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              color: '#F3F0E8',
              fontSize: 38,
              fontWeight: 800,
              fontFamily: 'sans-serif',
              letterSpacing: '-0.02em',
            }}
          >
            MTGPrices
          </span>
          <span
            style={{
              color: '#C9A55C',
              fontSize: 16,
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            .io
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 960 }}>
          <span
            style={{
              color: '#9AA3B2',
              fontSize: 18,
              fontFamily: 'monospace',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            Public beta · powered by Scryfall + MTGJSON
          </span>
          <span
            style={{
              color: '#F3F0E8',
              fontSize: 82,
              fontWeight: 800,
              fontFamily: 'sans-serif',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              display: 'flex',
              flexWrap: 'wrap',
            }}
          >
            Live prices for every&nbsp;<span style={{ color: '#C9A55C' }}>Magic</span>&nbsp;printing.
          </span>
        </div>

        {/* Footer strip */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span
            style={{
              display: 'flex',
              padding: '10px 20px',
              background: '#7C5CE7',
              color: '#fff',
              borderRadius: 12,
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'sans-serif',
            }}
          >
            mtgprices.io
          </span>
          <span
            style={{
              display: 'flex',
              color: '#9AA3B2',
              fontSize: 22,
              fontFamily: 'sans-serif',
            }}
          >
            Historical charts · legality · rulings · every printing
          </span>
        </div>
      </div>
    ),
    { ...size },
  )
}
