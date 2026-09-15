// Dynamic favicon rendered via @vercel/og. Simple violet-on-dark
// monogram "M" with a gold accent dot. Matches the site header lockup.
import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'
export const dynamic = 'force-static'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#111318',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          borderRadius: 6,
        }}
      >
        <span
          style={{
            color: '#F3F0E8',
            fontSize: 22,
            fontWeight: 800,
            fontFamily: 'sans-serif',
            letterSpacing: '-0.05em',
            lineHeight: 1,
          }}
        >
          M
        </span>
        <span
          style={{
            position: 'absolute',
            right: 4,
            bottom: 5,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#C9A55C',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
