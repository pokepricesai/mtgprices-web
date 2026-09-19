// src/components/mtg/Avatar.tsx
// Renders an MTGPrices avatar motif as a self-contained SVG or, for
// the 'google' key, wraps the visitor's OAuth profile image. All motifs
// are our own work.
//
// Sizes are quantised so the browser can subpixel-align the strokes.

import { resolveAvatar, type AvatarKey } from '@/lib/mtg/avatars'

type Props = {
  avatarKey: AvatarKey | string | null | undefined
  // Optional URL for the 'google' avatar variant. When not provided the
  // component falls back to the default gem so we never render a
  // broken image.
  googleImageUrl?: string | null
  size?: number
  ariaLabel?: string
}

export default function Avatar({ avatarKey, googleImageUrl, size = 32, ariaLabel }: Props) {
  const def = resolveAvatar(avatarKey)

  if (def.kind === 'google') {
    if (googleImageUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={googleImageUrl}
          alt={ariaLabel ?? 'Profile photo'}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          style={{
            width: size, height: size,
            borderRadius: '50%', objectFit: 'cover',
            border: '1px solid var(--border)',
            display: 'block',
          }}
        />
      )
    }
    return <Gem from="#7EA9E1" to="#164889" size={size} ariaLabel={ariaLabel ?? 'Arcane gem'} />
  }

  if (def.kind === 'gem') {
    return <Gem from={def.from!} to={def.to!} size={size} ariaLabel={ariaLabel ?? def.label} />
  }
  if (def.kind === 'card') {
    return <MiniCard from={def.from!} to={def.to!} size={size} ariaLabel={ariaLabel ?? def.label} />
  }
  return <StarSpark from={def.from!} to={def.to!} size={size} ariaLabel={ariaLabel ?? def.label} />
}

function Gem({ from, to, size, ariaLabel }: { from: string; to: string; size: number; ariaLabel: string }) {
  const id = `gem-${from.slice(1)}-${to.slice(1)}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <linearGradient id={id + '-face'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor="rgba(255,255,255,0.4)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="var(--surface)" stroke="var(--border)" />
      {/* Diamond gem */}
      <polygon points="24,8 38,22 24,40 10,22" fill={`url(#${id})`} />
      <polygon points="24,8 38,22 24,22 10,22" fill={`url(#${id}-face)`} />
      <polyline points="16,22 24,14 32,22" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

function MiniCard({ from, to, size, ariaLabel }: { from: string; to: string; size: number; ariaLabel: string }) {
  const id = `card-${from.slice(1)}-${to.slice(1)}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="var(--surface)" stroke="var(--border)" />
      {/* Card silhouette */}
      <rect x="12" y="10" width="24" height="28" rx="3" fill={`url(#${id})`} stroke="rgba(255,255,255,0.4)" strokeWidth="0.6" />
      <rect x="16" y="14" width="16" height="10" rx="1.5" fill="rgba(255,255,255,0.28)" />
      <line x1="16" y1="28" x2="32" y2="28" stroke="rgba(255,255,255,0.35)" strokeWidth="0.9" />
      <line x1="16" y1="31" x2="30" y2="31" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
      <line x1="16" y1="34" x2="28" y2="34" stroke="rgba(255,255,255,0.20)" strokeWidth="0.7" />
    </svg>
  )
}

function StarSpark({ from, to, size, ariaLabel }: { from: string; to: string; size: number; ariaLabel: string }) {
  const id = `star-${from.slice(1)}-${to.slice(1)}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block' }}
    >
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="var(--surface)" stroke="var(--border)" />
      <polygon
        points="24,8 27,20 40,24 27,28 24,40 21,28 8,24 21,20"
        fill={`url(#${id})`}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="0.6"
      />
    </svg>
  )
}
