// src/lib/mtg/faces.ts
// Normalizes multi-face MTG cards into a single presentation shape.
//
// Scryfall stores per-face rules text, mana cost, and often images under
// `card_faces`. Layouts that use it (Scryfall vocabulary):
//   split, flip, transform, modal_dfc, adventure, meld, saga variants,
//   double_faced_token, aftermath (older), art_series.
//
// Rendering assumption:
//   - Normalize each face into a `FaceView`.
//   - Root-level fields on the oracle card (name/oracle_text/…) are the
//     "primary" face for layouts where only a single face is normally
//     displayed (leveler, saga, class, case).
//   - For split / flip / transform / modal_dfc / adventure / meld: split
//     into two `FaceView`s.

export type FaceView = {
  index: number
  name: string
  mana_cost: string | null
  type_line: string | null
  oracle_text: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  colors: string[] | null
  image_uri_normal: string | null
}

export type LayoutKind =
  | 'single'
  | 'split'
  | 'flip'
  | 'transform'
  | 'modal_dfc'
  | 'adventure'
  | 'meld'
  | 'saga'
  | 'class'
  | 'case'
  | 'leveler'
  | 'other'

const MULTI_FACE_LAYOUTS = new Set([
  'split', 'flip', 'transform', 'modal_dfc',
  'adventure', 'meld', 'aftermath', 'double_faced_token',
  'reversible_card',
])

/** Coerce Scryfall layout string to our LayoutKind. Unknown/edge
 *  layouts collapse to 'other' so the renderer still shows something. */
export function normaliseLayout(layout: string | null | undefined): LayoutKind {
  if (!layout) return 'single'
  switch (layout) {
    case 'normal': return 'single'
    case 'split': return 'split'
    case 'flip': return 'flip'
    case 'transform': return 'transform'
    case 'modal_dfc': return 'modal_dfc'
    case 'adventure': return 'adventure'
    case 'meld': return 'meld'
    case 'saga': return 'saga'
    case 'class': return 'class'
    case 'case': return 'case'
    case 'leveler': return 'leveler'
    case 'aftermath': return 'split'          // render as split-style
    case 'double_faced_token': return 'transform'
    case 'reversible_card': return 'transform'
    default: return 'other'
  }
}

export type OracleForFaces = {
  name: string
  layout: string | null
  mana_cost: string | null
  type_line: string | null
  oracle_text: string | null
  power: string | null
  toughness: string | null
  loyalty: string | null
  defense: string | null
  colors: string[] | null
  card_faces: unknown
}

/** Extract `FaceView[]` from an oracle card. Always at least one entry. */
export function extractFaces(oracle: OracleForFaces): FaceView[] {
  const faces = oracle.card_faces
  if (
    Array.isArray(faces) &&
    faces.length > 0 &&
    MULTI_FACE_LAYOUTS.has((oracle.layout ?? '').toLowerCase())
  ) {
    return (faces as Record<string, any>[]).map((f, i) => ({
      index: i,
      name: String(f?.name ?? oracle.name),
      mana_cost: (f?.mana_cost ?? null) as string | null,
      type_line: (f?.type_line ?? null) as string | null,
      oracle_text: (f?.oracle_text ?? null) as string | null,
      power: (f?.power ?? null) as string | null,
      toughness: (f?.toughness ?? null) as string | null,
      loyalty: (f?.loyalty ?? null) as string | null,
      defense: (f?.defense ?? null) as string | null,
      colors: Array.isArray(f?.colors) ? (f.colors as string[]) : null,
      image_uri_normal: (f?.image_uris?.normal ?? f?.image_uris?.large ?? null) as string | null,
    }))
  }
  // Single-face fallback.
  return [{
    index: 0,
    name: oracle.name,
    mana_cost: oracle.mana_cost,
    type_line: oracle.type_line,
    oracle_text: oracle.oracle_text,
    power: oracle.power,
    toughness: oracle.toughness,
    loyalty: oracle.loyalty,
    defense: oracle.defense,
    colors: oracle.colors,
    image_uri_normal: null,
  }]
}
