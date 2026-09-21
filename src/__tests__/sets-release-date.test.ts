// sets-release-date.test.ts
// Pins the "future set" boundary logic so a spoiler-only Scryfall
// entry never gets labelled as if it already exists.
//
// The homepage passes `releasedBy = today` to listSets(); the browse
// tile flips the label to "Releases X" when the date is strictly in
// the future.

import { describe, it, expect } from 'vitest'

/** Local copy of the browse tile's guard so we can exercise it
 *  without importing a client-only module. If the source drifts,
 *  update both. */
function isFutureDate(iso: string, today = new Date().toISOString().slice(0, 10)): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return false
  return iso.slice(0, 10) > today
}

describe('set release date boundary', () => {
  it('a set whose release date is in the future is "future"', () => {
    expect(isFutureDate('2099-01-01')).toBe(true)
  })

  it('a set whose release date is today is NOT future', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(isFutureDate(today, today)).toBe(false)
  })

  it('a set whose release date is in the past is NOT future', () => {
    expect(isFutureDate('1993-08-05')).toBe(false)
  })

  it('malformed dates default to not-future (safe fallback)', () => {
    expect(isFutureDate('')).toBe(false)
    expect(isFutureDate('coming-soon')).toBe(false)
    expect(isFutureDate('2026')).toBe(false)
  })

  it('lexicographic yyyy-mm-dd comparison handles all reasonable dates', () => {
    // The comparison relies on yyyy-mm-dd sorting lexicographically
    // the same as chronologically. A regression that used
    // Date.parse() and lost tz info would flip on daylight savings
    // boundaries. Guard the well-known cases.
    const today = '2026-09-21'
    expect(isFutureDate('2026-09-22', today)).toBe(true)
    expect(isFutureDate('2026-09-21', today)).toBe(false)
    expect(isFutureDate('2026-09-20', today)).toBe(false)
    expect(isFutureDate('2027-01-01', today)).toBe(true)
    expect(isFutureDate('2025-12-31', today)).toBe(false)
  })
})
