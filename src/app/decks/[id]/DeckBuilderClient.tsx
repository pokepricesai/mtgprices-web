'use client'
// The main Deck Builder shell. Three columns on desktop:
//   Left  — deck list grouped by zone/type
//   Right — card search + quick capability filters
//   Top   — deck header (name, format, count, save state, actions)
//
// Mobile collapses into stacked sections rather than trying to
// miniaturise the desktop grid.
//
// All writes are optimistic against local state; server persistence
// happens via the browser Supabase client (RLS enforces ownership).
// The page reloads from the server after most writes so the summary
// tiles + validation stay honest.

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import type { DeckContext, DeckCardContext } from '@/lib/mtg/deck-context'
import type { DeckZone } from '@/lib/mtg/deck-rules'
import { getFormatRule } from '@/lib/mtg/format-rules'
import { CAPABILITY_LABELS } from '@/lib/mtg/capabilities'
import { currencySymbol } from '@/lib/mtg/valuation.data'
import DeckSearchPanel from './DeckSearchPanel'
import DeckStatsPanel from './DeckStatsPanel'
import DeckValidationPanel from './DeckValidationPanel'
import DeckCardRow from './DeckCardRow'

const ZONE_TITLES: Record<DeckZone, string> = {
  commander: 'Commander',
  main: 'Main deck',
  sideboard: 'Sideboard',
  companion: 'Companion',
  maybeboard: 'Maybeboard',
}

type Props = { initialContext: DeckContext }

export default function DeckBuilderClient({ initialContext }: Props) {
  const router = useRouter()
  const [ctx, setCtx] = useState<DeckContext>(initialContext)
  const [pending, startTransition] = useTransition()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [nameDraft, setNameDraft] = useState(initialContext.deck.name)
  const rule = getFormatRule(ctx.deck.format)

  function reload() {
    startTransition(() => router.refresh())
  }

  async function updateDeckMeta(patch: { name?: string; description?: string }) {
    setSaveState('saving')
    const s = getSupabaseBrowserClient()
    const { error } = await s.from('mtg_decks').update(patch).eq('id', ctx.deck.id)
    setSaveState(error ? 'error' : 'saved')
    setTimeout(() => setSaveState('idle'), 1200)
    reload()
  }

  async function addOracle(oracleId: string, zone: DeckZone = 'main') {
    setSaveState('saving')
    const s = getSupabaseBrowserClient()
    const existing = ctx.commanders.concat(ctx.main, ctx.sideboard, ctx.companion, ctx.maybeboard)
      .find((c) => c.oracle_card_id === oracleId && c.zone === zone)
    if (existing) {
      await s.from('mtg_deck_cards').update({ quantity: existing.quantity + 1 }).eq('id', existing.deck_card_id)
    } else {
      await s.from('mtg_deck_cards').insert({
        deck_id: ctx.deck.id,
        oracle_card_id: oracleId,
        quantity: 1,
        zone,
      })
    }
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 800)
    reload()
  }

  async function changeQty(deckCardId: string, delta: number) {
    setSaveState('saving')
    const s = getSupabaseBrowserClient()
    const target = allCards.find((c) => c.deck_card_id === deckCardId)
    if (!target) return
    const nextQty = target.quantity + delta
    if (nextQty <= 0) {
      await s.from('mtg_deck_cards').delete().eq('id', deckCardId)
    } else {
      await s.from('mtg_deck_cards').update({ quantity: nextQty }).eq('id', deckCardId)
    }
    setSaveState('saved')
    setTimeout(() => setSaveState('idle'), 800)
    reload()
  }

  async function moveZone(deckCardId: string, zone: DeckZone) {
    setSaveState('saving')
    const s = getSupabaseBrowserClient()
    // If a row with the same (deck, oracle, target zone) exists, merge.
    const target = allCards.find((c) => c.deck_card_id === deckCardId)
    if (!target) return
    const collision = allCards.find((c) => c.oracle_card_id === target.oracle_card_id && c.zone === zone && c.deck_card_id !== deckCardId)
    if (collision) {
      await s.from('mtg_deck_cards').update({ quantity: collision.quantity + target.quantity }).eq('id', collision.deck_card_id)
      await s.from('mtg_deck_cards').delete().eq('id', deckCardId)
    } else {
      await s.from('mtg_deck_cards').update({ zone }).eq('id', deckCardId)
    }
    setSaveState('saved'); setTimeout(() => setSaveState('idle'), 800); reload()
  }

  async function setPreferredFinish(deckCardId: string, printingFinishId: string | null) {
    setSaveState('saving')
    const s = getSupabaseBrowserClient()
    await s.from('mtg_deck_cards').update({ printing_finish_id: printingFinishId }).eq('id', deckCardId)
    setSaveState('saved'); setTimeout(() => setSaveState('idle'), 800); reload()
  }

  async function removeCard(deckCardId: string) {
    setSaveState('saving')
    const s = getSupabaseBrowserClient()
    await s.from('mtg_deck_cards').delete().eq('id', deckCardId)
    setSaveState('saved'); setTimeout(() => setSaveState('idle'), 800); reload()
  }

  const allCards = useMemo(() => (
    ctx.commanders.concat(ctx.main, ctx.sideboard, ctx.companion, ctx.maybeboard)
  ), [ctx])

  const commanderColorIdentity = ctx.commanders.length > 0
    ? Array.from(new Set(ctx.commanders.flatMap((c) => c.color_identity)))
    : null

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '18px 20px 80px' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <nav aria-label="Breadcrumb" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          <Link href="/decks" style={{ color: 'inherit' }}>My decks</Link>
          <span style={{ margin: '0 6px', opacity: 0.5 }}>›</span>
          <span style={{ color: 'var(--text)' }}>{ctx.deck.name}</span>
        </nav>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => nameDraft.trim() && nameDraft !== ctx.deck.name && updateDeckMeta({ name: nameDraft.trim() })}
            style={{
              fontSize: 26, fontWeight: 800, fontFamily: 'Outfit, sans-serif',
              border: 'none', background: 'transparent', color: 'var(--text)',
              outline: 'none', padding: 0, minWidth: 240, flex: 1,
            }}
          />
          <span style={{
            padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
            background: 'var(--bg-light)', color: 'var(--text-muted)', textTransform: 'uppercase',
          }}>{rule?.label ?? ctx.deck.format}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && 'Saved'}
            {saveState === 'error' && 'Save failed'}
            {saveState === 'idle' && `updated ${ctx.deck.updatedAt.slice(0, 10)}`}
          </span>
        </div>
      </div>

      {/* Layout: deck list + search side by side on desktop */}
      <div className="deck-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 380px',
        gap: 20,
        alignItems: 'flex-start',
      }}>
        <div>
          {/* Validation + Stats */}
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr', marginBottom: 16 }} className="deck-topcards">
            <DeckValidationPanel validation={ctx.validation} totals={ctx.totals} pricing={ctx.pricing} rule={rule} />
            <DeckStatsPanel ctx={ctx} />
          </div>

          {/* Zone list */}
          {(['commander', 'main', 'sideboard', 'companion', 'maybeboard'] as DeckZone[]).map((zone) => {
            const list = ctx[zone] ?? []
            if (list.length === 0 && zone !== 'commander' && zone !== 'main') return null
            if (list.length === 0 && zone === 'main') {
              return (
                <ZoneShell key={zone} title={ZONE_TITLES[zone]} count={0}>
                  <div style={{ padding: 20, background: 'var(--bg-light)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                    Nothing here yet. Search on the right or paste a text list below.
                  </div>
                </ZoneShell>
              )
            }
            if (list.length === 0 && zone === 'commander') {
              if (!rule?.hasCommander) return null
              return (
                <ZoneShell key={zone} title={ZONE_TITLES[zone]} count={0}>
                  <div style={{ padding: 12, background: 'var(--bg-light)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                    Search a legendary creature on the right and click "Set as commander" to fill the command zone.
                  </div>
                </ZoneShell>
              )
            }
            return (
              <ZoneShell key={zone} title={ZONE_TITLES[zone]} count={list.reduce((n, c) => n + c.quantity, 0)}>
                {groupCards(list).map(([bucket, entries]) => (
                  <div key={bucket} style={{ marginBottom: 10 }}>
                    <div className="label-mono" style={{ marginBottom: 4 }}>{bucket}</div>
                    {entries.map((e) => (
                      <DeckCardRow
                        key={e.deck_card_id}
                        card={e}
                        pricingBasis={ctx.pricing.basis}
                        onIncrement={() => changeQty(e.deck_card_id, +1)}
                        onDecrement={() => changeQty(e.deck_card_id, -1)}
                        onRemove={() => removeCard(e.deck_card_id)}
                        onMoveZone={(z) => moveZone(e.deck_card_id, z)}
                        onSetPreferredFinish={(pf) => setPreferredFinish(e.deck_card_id, pf)}
                        currentZone={zone}
                        format={ctx.deck.format}
                      />
                    ))}
                  </div>
                ))}
              </ZoneShell>
            )
          })}

          <TextImportBlock deckId={ctx.deck.id} onImported={reload} />
        </div>

        {/* Right column: search */}
        <div className="deck-search-col">
          <DeckSearchPanel
            deckFormat={ctx.deck.format}
            commanderColorIdentity={commanderColorIdentity}
            onAdd={(oracleId, zone) => addOracle(oracleId, zone)}
          />
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 960px) {
              .deck-grid { grid-template-columns: 1fr !important; }
              .deck-topcards { grid-template-columns: 1fr !important; }
              .deck-search-col { order: -1; }
            }
          `,
        }}
      />
    </div>
  )
}

function ZoneShell({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section style={{
      marginBottom: 16, padding: 14,
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{count}</span>
      </div>
      {children}
    </section>
  )
}

/** Group main-deck cards by primary type for readability. */
function groupCards(entries: DeckCardContext[]): Array<[string, DeckCardContext[]]> {
  const buckets: Record<string, DeckCardContext[]> = {}
  const ordered = ['Creature', 'Planeswalker', 'Battle', 'Enchantment', 'Artifact', 'Instant', 'Sorcery', 'Land', 'Other']
  for (const c of entries) {
    const primary = ['creature', 'planeswalker', 'battle', 'enchantment', 'artifact', 'instant', 'sorcery', 'land'].find((t) => c.types.includes(t))
    const label = primary ? primary[0].toUpperCase() + primary.slice(1) : 'Other'
    const arr = buckets[label] ?? []
    arr.push(c)
    buckets[label] = arr
  }
  return ordered
    .filter((k) => buckets[k] && buckets[k].length > 0)
    .map((k) => [k, buckets[k].sort((a, b) => (a.mana_value ?? 999) - (b.mana_value ?? 999) || a.name.localeCompare(b.name))] as [string, DeckCardContext[]])
}

function TextImportBlock({ deckId, onImported }: { deckId: string; onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ imported: number; skipped: number; details?: string[] } | null>(null)

  async function submit() {
    setBusy(true)
    setReport(null)
    const res = await fetch(`/api/decks/${deckId}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    setBusy(false)
    if (!res.ok) { setReport({ imported: 0, skipped: 0, details: [`Import failed: ${res.status}`] }); return }
    const data = await res.json()
    setReport({ imported: data.imported, skipped: data.skipped, details: data.unresolved })
    setText('')
    onImported()
  }

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 4,
    }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', fontSize: 14, fontWeight: 700 }}>
        {open ? '– ' : '+ '}Import a text list
      </summary>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
        Paste a decklist ("4 Lightning Bolt" one per line). Unresolved names are surfaced, never silently added.
      </p>
      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="4 Lightning Bolt&#10;2 Counterspell"
        style={{
          width: '100%', padding: 10, marginTop: 8,
          background: 'var(--bg-light)', border: '1px solid var(--border)',
          borderRadius: 10, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          outline: 'none', resize: 'vertical', boxSizing: 'border-box',
        }}
      />
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" onClick={submit} disabled={busy || !text.trim()} style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '9px 16px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
        }}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
      {report && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <span style={{ color: 'var(--green)' }}>Imported {report.imported}</span>
          {report.skipped > 0 && <> · <span style={{ color: 'var(--amber)' }}>{report.skipped} skipped</span></>}
          {report.details && report.details.length > 0 && (
            <ul style={{ marginTop: 6, paddingLeft: 18, color: 'var(--text-muted)' }}>
              {report.details.slice(0, 20).map((d, i) => <li key={i}>{d}</li>)}
              {report.details.length > 20 && <li>… and {report.details.length - 20} more.</li>}
            </ul>
          )}
        </div>
      )}
    </details>
  )
}
