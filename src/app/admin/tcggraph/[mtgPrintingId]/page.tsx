// src/app/admin/tcggraph/[mtgPrintingId]/page.tsx
//
// Admin-only, feature-flagged verification surface for the MTG graded
// read model. Default OFF (env NEXT_PUBLIC_TCGGRAPH_ADMIN=1 to
// enable). Never appears in the sitemap, always noindex, never
// linked from the public site.
//
// Slice 3, Phase I. Purpose: let a human eyeball the live TCGGraph
// payload for a specific mtg_printings.id before we make anything
// public.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTcgBundleForMtgPrinting } from '@/lib/tcggraph/read-model'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'TCGGraph admin verification',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false, noimageindex: true } },
  alternates: { canonical: 'https://mtgprices.io' },
}

type Params = { mtgPrintingId: string }

export default async function TcgGraphAdminPage({ params }: { params: Promise<Params> }) {
  // Feature flag: default OFF.
  const enabled = (process.env.NEXT_PUBLIC_TCGGRAPH_ADMIN ?? '').trim() === '1'
  if (!enabled) notFound()

  const { mtgPrintingId } = await params
  const bundle = await getTcgBundleForMtgPrinting(mtgPrintingId)

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px', fontFamily: 'ui-monospace, monospace' }}>
      <div style={{ marginBottom: 16 }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>TCGGraph admin</div>
        <h1 style={{ margin: '4px 0 0', fontSize: 20 }}>Read-model verification</h1>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          mtg_printings.id = <strong>{mtgPrintingId}</strong>
        </div>
      </div>
      {!bundle ? (
        <NoticeBox title="No TCGGraph mapping for this MTG printing">
          Either the mapping bootstrap has not yet reached this printing, or the printing is intentionally unmapped
          (see docs/network/05-mtg-mapping-report.md). No pricing rows will render.
        </NoticeBox>
      ) : (
        <>
          <IdentityPanel bundle={bundle} />
          <MarketPanel rows={bundle.market} />
          <RawPanel raw={bundle.rawPrice} />
          <GradedPanel rows={bundle.gradedPrices} />
          <DebugPanel bundle={bundle} />
        </>
      )}
    </div>
  )
}

function NoticeBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', marginBottom: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{children}</div>
    </div>
  )
}

function IdentityPanel({ bundle }: { bundle: NonNullable<Awaited<ReturnType<typeof getTcgBundleForMtgPrinting>>> }) {
  return (
    <section style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
      <div className="label-mono">Identity</div>
      <table style={{ marginTop: 8, fontSize: 12, width: '100%' }}>
        <thead><tr>
          <Th>tcg_printings.id</Th><Th>tcggraph_card_id</Th><Th>printing_key</Th><Th>finish</Th><Th>mapping_confidence</Th>
        </tr></thead>
        <tbody>
          {bundle.tcgPrintings.map((p) => (
            <tr key={p.id}>
              <Td mono>{p.id}</Td>
              <Td mono>{p.tcggraph_card_id}</Td>
              <Td>{p.tcggraph_printing_key}</Td>
              <Td>{p.finish ?? '-'}</Td>
              <Td>{p.mapping_confidence}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function MarketPanel({ rows }: { rows: NonNullable<Awaited<ReturnType<typeof getTcgBundleForMtgPrinting>>>['market'] }) {
  if (rows.length === 0) return <NoticeBox title="No current TCGGraph market rows">This printing has no rows in tcg_market_prices_current.</NoticeBox>
  return (
    <section style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
      <div className="label-mono">Market prices via TCGGraph</div>
      <table style={{ marginTop: 8, fontSize: 12, width: '100%' }}>
        <thead><tr><Th>source</Th><Th>list</Th><Th>finish</Th><Th>currency</Th><Th>price</Th><Th>avg30</Th><Th>updated_at</Th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <Td mono>{r.source}</Td>
              <Td>{r.list_type}</Td>
              <Td>{r.finish ?? '-'}</Td>
              <Td>{r.currency}</Td>
              <Td>{fmt(r.price)}</Td>
              <Td>{fmt(r.avg_30d)}</Td>
              <Td mono>{r.updated_at ?? '-'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function RawPanel({ raw }: { raw: NonNullable<Awaited<ReturnType<typeof getTcgBundleForMtgPrinting>>>['rawPrice'] }) {
  if (!raw) return null
  return (
    <section style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
      <div className="label-mono">Raw / ungraded (NOT a slab)</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        {raw.currency} {fmt(raw.price)}{' '}
        <span style={{ color: 'var(--text-muted)' }}>
          &middot; volume {raw.card_sales_volume ?? '-'} &middot; updated {raw.updated_at ?? '-'}
        </span>
      </div>
    </section>
  )
}

function GradedPanel({ rows }: { rows: NonNullable<Awaited<ReturnType<typeof getTcgBundleForMtgPrinting>>>['gradedPrices'] }) {
  if (rows.length === 0) return (
    <NoticeBox title="No slabbed graded quotes">
      TCGGraph does not currently report any PSA / BGS / CGC / SGC / any-graded quote for this printing.
      This is a valid state; missing rows must NOT be rendered as $0 elsewhere.
    </NoticeBox>
  )
  return (
    <section style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
      <div className="label-mono">Graded quotes ({rows.length})</div>
      <table style={{ marginTop: 8, fontSize: 12, width: '100%' }}>
        <thead><tr><Th>grader</Th><Th>grade</Th><Th>currency</Th><Th>price</Th><Th>volume</Th><Th>updated_at</Th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <Td mono>{r.grader}</Td>
              <Td>{r.grade}</Td>
              <Td>{r.currency}</Td>
              <Td>{fmt(r.price)}</Td>
              <Td>{r.card_sales_volume ?? '-'}</Td>
              <Td mono>{r.updated_at ?? '-'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function DebugPanel({ bundle }: { bundle: NonNullable<Awaited<ReturnType<typeof getTcgBundleForMtgPrinting>>> }) {
  return (
    <section style={{ padding: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12 }}>
      <div className="label-mono">Debug</div>
      <div style={{ fontSize: 12, marginTop: 6, color: 'var(--text-muted)' }}>
        Last source update: <strong>{bundle.lastSourceUpdate ?? '-'}</strong> &middot;
        {' '}Latest daily obs: <strong>{bundle.latestObservationDate ?? '-'}</strong> &middot;
        {' '}market rows: {bundle.market.length} &middot;
        {' '}raw: {bundle.rawPrice ? 'yes' : 'no'} &middot;
        {' '}slab quotes: {bundle.gradedPrices.length}
      </div>
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) { return <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>{children}</th> }
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) { return <td style={{ padding: '3px 8px', fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{children}</td> }
function fmt(n: number | null | undefined) { return n == null ? '-' : n.toFixed(2) }
