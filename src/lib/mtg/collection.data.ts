// src/lib/mtg/collection.data.ts
// Pure data + types for MTG collection. NO server-only guard ,
// client components import from here for form controls.

export type CardCondition =
  | 'near_mint'
  | 'lightly_played'
  | 'moderately_played'
  | 'heavily_played'
  | 'damaged'

export const CONDITION_LABEL: Record<CardCondition, string> = {
  near_mint: 'Near Mint',
  lightly_played: 'Lightly Played',
  moderately_played: 'Moderately Played',
  heavily_played: 'Heavily Played',
  damaged: 'Damaged',
}

export const CONDITION_SHORT: Record<CardCondition, string> = {
  near_mint: 'NM',
  lightly_played: 'LP',
  moderately_played: 'MP',
  heavily_played: 'HP',
  damaged: 'DMG',
}

export const CONDITIONS_ORDERED: CardCondition[] = [
  'near_mint',
  'lightly_played',
  'moderately_played',
  'heavily_played',
  'damaged',
]
