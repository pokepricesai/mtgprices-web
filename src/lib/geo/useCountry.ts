'use client'

// src/lib/geo/useCountry.ts
// Small client hook that resolves the visitor country from the
// existing /api/geo route once per session, caches the result in
// sessionStorage, and returns null until it lands so callers can fall
// back to their configured default marketplace.

import { useEffect, useState } from 'react'

const KEY = 'mtgp:country:v1'
let inflight: Promise<string | null> | null = null

async function fetchCountry(): Promise<string | null> {
  if (inflight) return inflight
  inflight = fetch('/api/geo', { headers: { accept: 'application/json' } })
    .then((r) => r.ok ? r.json() : null)
    .then((json) => {
      const c = json && typeof json.country === 'string' ? json.country.toUpperCase() : null
      return c
    })
    .catch(() => null)
    .finally(() => { setTimeout(() => { inflight = null }, 200) })
  return inflight
}

export function useCountry(): string | null {
  const [country, setCountry] = useState<string | null>(null)

  useEffect(() => {
    // Session cache: don't re-hit /api/geo on every route change.
    if (typeof window === 'undefined') return
    try {
      const cached = window.sessionStorage.getItem(KEY)
      if (cached) {
        setCountry(cached === 'null' ? null : cached)
        return
      }
    } catch { /* sessionStorage may be blocked */ }

    let cancelled = false
    fetchCountry().then((c) => {
      if (cancelled) return
      try { window.sessionStorage.setItem(KEY, c ?? 'null') } catch {}
      setCountry(c)
    })
    return () => { cancelled = true }
  }, [])

  return country
}
