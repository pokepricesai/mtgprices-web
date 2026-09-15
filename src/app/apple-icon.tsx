// Apple touch icon (180×180). Same visual language as the small favicon
// but with a proportionally larger monogram and accent dot.
import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'
export const dynamic = 'force-static'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #171a21 0%, #111318 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          borderRadius: 36,
        }}
      >
        <span
          style={{
            color: '#F3F0E8',
            fontSize: 116,
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
            right: 28,
            bottom: 34,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#C9A55C',
          }}
        />
      </div>
    ),
    { ...size },
  )
}
