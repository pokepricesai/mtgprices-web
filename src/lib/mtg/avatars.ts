// src/lib/mtg/avatars.ts
// Original MTGPrices avatar registry. Every avatar is a small piece
// of CSS/SVG data so we don't need image hosting. Nothing here is
// derived from Wizards of the Coast art or the official mana symbol
// set. Everything is our own arcane / gem / card motif work.
//
// Values here are safe to import from both server and client code.

export type AvatarKey =
  | 'gem-arcane'
  | 'gem-gold'
  | 'gem-ember'
  | 'gem-forest'
  | 'gem-midnight'
  | 'card-gold'
  | 'card-blue'
  | 'card-red'
  | 'card-green'
  | 'card-dusk'
  | 'star-spark'
  | 'google'

export const DEFAULT_AVATAR_KEY: AvatarKey = 'gem-arcane'

export type AvatarDef = {
  key: AvatarKey
  label: string
  // Two colour stops that the client-side renderer uses to draw the
  // motif. Google is a special case handled separately.
  from?: string
  to?: string
  kind: 'gem' | 'card' | 'star' | 'google'
}

export const AVATARS: AvatarDef[] = [
  { key: 'gem-arcane',   label: 'Arcane gem',    kind: 'gem',  from: '#7EA9E1', to: '#164889' },
  { key: 'gem-gold',     label: 'Gold gem',      kind: 'gem',  from: '#F5E4B4', to: '#A8681C' },
  { key: 'gem-ember',    label: 'Ember gem',     kind: 'gem',  from: '#F9B79A', to: '#C4441B' },
  { key: 'gem-forest',   label: 'Forest gem',    kind: 'gem',  from: '#B8E1C6', to: '#2A8459' },
  { key: 'gem-midnight', label: 'Midnight gem',  kind: 'gem',  from: '#4A3A55', to: '#0D1B3A' },
  { key: 'card-gold',    label: 'Gold card',     kind: 'card', from: '#F5E4B4', to: '#A8681C' },
  { key: 'card-blue',    label: 'Blue card',     kind: 'card', from: '#7EA9E1', to: '#164889' },
  { key: 'card-red',     label: 'Red card',      kind: 'card', from: '#F27A4E', to: '#C4441B' },
  { key: 'card-green',   label: 'Green card',    kind: 'card', from: '#B8E1C6', to: '#2A8459' },
  { key: 'card-dusk',    label: 'Dusk card',     kind: 'card', from: '#B9A6C9', to: '#4A3A55' },
  { key: 'star-spark',   label: 'Star spark',    kind: 'star', from: '#F5E4B4', to: '#E85A2C' },
  { key: 'google',       label: 'Google photo',  kind: 'google' },
]

export const AVATAR_BY_KEY: Record<string, AvatarDef> = Object.fromEntries(
  AVATARS.map((a) => [a.key, a]),
)

export function resolveAvatar(key: string | null | undefined): AvatarDef {
  if (!key) return AVATAR_BY_KEY[DEFAULT_AVATAR_KEY]
  return AVATAR_BY_KEY[key] ?? AVATAR_BY_KEY[DEFAULT_AVATAR_KEY]
}

/** Only the built-in motifs. The 'google' option is offered separately
 *  because it needs a real photo URL. */
export const SELECTABLE_MOTIFS: AvatarDef[] = AVATARS.filter((a) => a.kind !== 'google')
