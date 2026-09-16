'use client'

// Public deck page renderer. Consumes ONLY a PublicDeckPayload — the
// projection function has already stripped owner-specific fields.
// Never fetches or references the owner's collection, private notes,
// or acquired prices.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { PublicDeckPayload, PublicDeckCard } from '@/lib/mtg/public-deck'
import { CAPABILITY_LABELS, type CardCapability } from '@/lib/mtg/capabilities'
import { getFormatRule } from '@/lib/mtg/format-rules'
import { buildCardSlug } from '@/lib/mtg/slug'
import ManaCost from '@/components/mtg/ManaCost'

type Props = { payload: PublicDeckPayload }

const ZONE_ORDER: Array<{ key: keyof PublicDeckPayload; label: string }> = [
  { key: 'commanders', label: 'Commander' },
  { key: 'main', label: 'Main' },
  { key: 'sideboard', label: 'Sideboard' },
  { key: 'companion', label: 'Companion' },
  { key: 'maybeboard', label: 'Maybeboard' },
]

export default function PublicDeckClient({ payload }: Props) {
  const [copied, setCopied] = useState<'url' | 'list' | null>(null)
  const rule = getFormatRule(payload.deck.format)
  const shareUrl = typeof window !== 'undefined' ? window.location.href : `https://mtgprices.io/decks/public/${payload.deck.slug}`

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied('url'); setTimeout(() => setCopied(null), 1400)
    } catch { /* ignore */ }
  }
  async function copyList() {
    try {
      const text = decklistToText(payload)
      await navigator.clipboard.writeText(text)
      setCopied('list'); setTimeout(() => setCopied(null), 1400)
    } catch { /* ignore */ }
  }

  const typeEntries = Object.entries(payload.typeBreakdown).filter(([, v]) => v > 0)
  const capEntries = Object.entries(payload.capabilityBreakdown).filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 8)
  const maxCurve = Math.max(1, ...payload.curve)

  const commanderPrimary = payload.commanders[0]

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 80px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ flex: '1 1 380px', minWidth: 260 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
            {rule?.label ?? payload.deck.format} deck · MTGPrices
          </div>
          <h1 style={{ margin: 0, fontFamily: 'Outfit, ui-sans-serif, system-ui, sans-serif', fontSize: 32, lineHeight: 1.1, color: 'var(--text)' }}>{payload.deck.name}</h1>
          {commanderPrimary && (
            <div style={{ marginTop: 6, fontSize: 14, color: 'var(--text-muted)' }}>
              Commander: <b style={{ color: 'var(--text)' }}>{commanderPrimary.name}</b>
              {payload.commanders.length > 1 && <> & <b style={{ color: 'var(--text)' }}>{payload.commanders[1].name}</b></>}
            </div>
          )}
          {payload.deck.description && (
            <p style={{ marginTop: 12, fontSize: 14, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{payload.deck.description}</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" onClick={copyUrl} style={btnPrimary}>
              {copied === 'url' ? 'Copied ✓' : 'Copy link'}
            </button>
            <button type="button" onClick={copyList} style={btnSecondary}>
              {copied === 'list' ? 'Copied ✓' : 'Copy decklist'}
            </button>
          </div>
        </div>

        {/* Right column: at-a-glance card + commander thumbnail */}
        <aside style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {commanderPrimary?.preferredPrinting?.image_uri_small && (
            <img
              src={commanderPrimary.preferredPrinting.image_uri_small}
              alt={commanderPrimary.name}
              style={{ width: '100%', borderRadius: 12, boxShadow: '0 6px 20px rgba(23,32,58,0.16)' }}
            />
          )}
          <div style={statsCard}>
            <StatRow label="Format" value={rule?.label ?? payload.deck.format} />
            <StatRow label="Cards (main)" value={String(payload.totals.main)} />
            {payload.totals.commander > 0 && <StatRow label="Commander(s)" value={String(payload.totals.commander)} />}
            {payload.totals.sideboard > 0 && <StatRow label="Sideboard" value={String(payload.totals.sideboard)} />}
            <StatRow label="Colour identity" value={payload.colorIdentity.join('') || 'C'} />
            <StatRow
              label={`Deck value (${payload.pricing.basis.provider}, ${payload.pricing.basis.currency})`}
              value={payload.pricing.deckValue > 0 ? `${currencyPrefix(payload.pricing.basis.currency)}${payload.pricing.deckValue.toFixed(2)}` : '—'}
              subValue={payload.pricing.entriesWithoutPrice > 0 ? `${payload.pricing.entriesWithoutPrice} without price` : undefined}
            />
            <StatRow
              label="Legality"
              value={payload.validation.ok ? 'Legal' : `${payload.validation.issues.length} issue${payload.validation.issues.length === 1 ? '' : 's'}`}
              valueColor={payload.validation.ok ? 'var(--green)' : 'var(--amber)'}
            />
          </div>
        </aside>
      </div>

      {/* Curve + capabilities + types */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 24 }}>
        {maxCurve > 0 && (
          <section style={panel}>
            <div style={panelLabel}>Mana curve (main)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, alignItems: 'end' }}>
              {payload.curve.map((n, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <div style={{
                    width: '100%', height: 4 + Math.round((n / maxCurve) * 60),
                    background: 'var(--primary)', borderRadius: 4, opacity: n > 0 ? 1 : 0.15,
                  }} />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{i === 7 ? '7+' : i}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{n}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {typeEntries.length > 0 && (
          <section style={panel}>
            <div style={panelLabel}>Types</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {typeEntries.map(([t, v]) => (
                <span key={t} style={chip}>{t[0].toUpperCase() + t.slice(1)} <b style={{ marginLeft: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{v}</b></span>
              ))}
            </div>
          </section>
        )}
        {capEntries.length > 0 && (
          <section style={panel}>
            <div style={panelLabel}>Capabilities</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {capEntries.map(([cap, n]) => (
                <span key={cap} style={{ ...chip, background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid rgba(104,65,230,0.25)' }}>
                  {CAPABILITY_LABELS[cap as CardCapability] ?? cap} <b style={{ marginLeft: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{n}</b>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Zone lists */}
      {ZONE_ORDER.map(({ key, label }) => {
        const list = (payload as any)[key] as PublicDeckCard[]
        if (!list || list.length === 0) return null
        const totalQty = list.reduce((n, c) => n + c.quantity, 0)
        return (
          <section key={key} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'Outfit, ui-sans-serif, system-ui, sans-serif' }}>{label}</h2>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{totalQty}</span>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              {list.map((c) => (
                <PublicDeckRow key={`${c.zone}-${c.oracle_card_id}`} card={c} basisCurrency={payload.pricing.basis.currency} />
              ))}
            </div>
          </section>
        )
      })}

      <footer style={{ marginTop: 40, borderTop: '1px solid var(--border)', paddingTop: 14, fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span>Prices from {payload.pricing.basis.provider} · {payload.pricing.basis.currency} · {payload.pricing.basis.market} · {payload.pricing.basis.price_type}</span>
        <Link href="/" style={{ color: 'var(--primary)', textDecoration: 'none' }}>MTGPrices.io</Link>
      </footer>
    </div>
  )
}

function PublicDeckRow({ card, basisCurrency }: { card: PublicDeckCard; basisCurrency: string }) {
  const cardHref = card.preferredPrinting?.set_code && card.preferredPrinting?.collector_number
    ? `/set/${card.preferredPrinting.set_code}/card/${buildCardSlug(card.preferredPrinting.collector_number, card.name)}`
    : null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
      <span style={{ minWidth: 22, textAlign: 'center', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, fontSize: 14, color: 'var(--text-muted)' }}>{card.quantity}</span>
      <div style={{ minWidth: 0 }}>
        {cardHref ? (
          <Link href={cardHref} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>{card.name}</Link>
        ) : (
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{card.name}</span>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {card.mana_cost && <ManaCost cost={card.mana_cost} size={12} />}
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{card.type_line}</span>
          {card.preferredPrinting && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {card.preferredPrinting.set_code.toUpperCase()} · #{card.preferredPrinting.collector_number} · {card.preferredPrinting.finish}
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 90 }}>
        {card.publicPrice ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              {currencyPrefix(basisCurrency)}{(card.publicPrice.price * card.quantity).toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{card.publicPrice.provider}</div>
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>no price</span>
        )}
      </div>
    </div>
  )
}

function decklistToText(payload: PublicDeckPayload): string {
  const lines: string[] = []
  if (payload.commanders.length > 0) {
    lines.push('// Commander')
    for (const c of payload.commanders) lines.push(`${c.quantity} ${c.name}`)
    lines.push('')
  }
  if (payload.main.length > 0) {
    lines.push('// Deck')
    for (const c of payload.main) lines.push(`${c.quantity} ${c.name}`)
    lines.push('')
  }
  if (payload.sideboard.length > 0) {
    lines.push('// Sideboard')
    for (const c of payload.sideboard) lines.push(`${c.quantity} ${c.name}`)
    lines.push('')
  }
  if (payload.companion.length > 0) {
    lines.push('// Companion')
    for (const c of payload.companion) lines.push(`${c.quantity} ${c.name}`)
  }
  return lines.join('\n').trim()
}

function currencyPrefix(currency: string) {
  return currency === 'EUR' ? '€' : currency === 'USD' ? '$' : ''
}

function StatRow({ label, value, subValue, valueColor }: { label: string; value: string; subValue?: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: valueColor ?? 'var(--text)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{value}</span>
        {subValue && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{subValue}</span>}
      </span>
    </div>
  )
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10,
}
const btnSecondary: React.CSSProperties = {
  padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  background: 'transparent', color: 'var(--primary)', border: '1px solid var(--primary)', borderRadius: 10,
}
const statsCard: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 12px',
}
const panel: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14,
}
const panelLabel: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8,
}
const chip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999,
  background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11,
  border: '1px solid var(--border)',
}

// silence unused warning from useMemo import (we may reuse later)
void useMemo
