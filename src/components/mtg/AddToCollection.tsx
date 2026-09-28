'use client'
// src/components/mtg/AddToCollection.tsx
// Small "Add to Collection" trigger + inline form. Works on card pages,
// Card Finder results, catalogue search and the collection page itself.
//
// Not signed in → clicking the trigger takes the user to /login with the
// current page preserved in `next`, so they land back where they were
// after auth.
//
// Signed in → an inline modal opens with finish/condition/quantity plus
// optional acquired price/date/notes. Uses the browser Supabase client
// so RLS enforces owner-only writes.

import { useEffect, useMemo, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { CONDITIONS_ORDERED, CONDITION_LABEL, CONDITION_SHORT, type CardCondition } from '@/lib/mtg/collection.data'

// Slab graders MTGPrices records against the collection. Same allowlist
// as the check constraint added in the 2026-09-28 migration. When a
// user picks "Graded" they must supply BOTH grader and grade.
const GRADERS = ['PSA', 'BGS', 'CGC', 'SGC'] as const
type SlabGrader = typeof GRADERS[number]

// Grade tiers each grader actually issues. Full tenth-point scale from
// 1 to 10; the constraint in the migration accepts all of them.
const GRADES = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1'] as const

type FinishOption = { id: string; finish: 'nonfoil' | 'foil' | 'etched' }

type Props = {
  /** Available finishes for this printing. */
  finishes: FinishOption[]
  /** Human-friendly card name (used in status messages only). */
  cardName: string
  /** Compact button styling for grids/rows. */
  compact?: boolean
}

export default function AddToCollection({ finishes, cardName, compact = false }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [finishId, setFinishId] = useState(finishes[0]?.id ?? '')
  const [condition, setCondition] = useState<CardCondition>('near_mint')
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState('')
  const [priceCurrency, setPriceCurrency] = useState<'USD' | 'EUR'>('USD')
  const [acquiredAt, setAcquiredAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  // Graded track. Raw is the default because most collectors record
  // ungraded stock; slabs are the deliberate exception.
  const [isGraded, setIsGraded] = useState(false)
  const [grader, setGrader] = useState<SlabGrader>('PSA')
  const [grade, setGrade] = useState<string>('10')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = getSupabaseBrowserClient()
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      setSignedIn(Boolean(data.user))
      setAuthChecked(true)
    })()
    return () => { cancelled = true }
  }, [])

  function triggerClick() {
    if (!authChecked) return
    if (!signedIn) {
      const next = encodeURIComponent(pathname ?? '/')
      router.push(`/login?next=${next}`)
      return
    }
    setOpen((v) => !v)
    setStatus(null)
  }

  async function save() {
    if (!finishId) { setStatus({ kind: 'err', msg: 'Pick a finish first.' }); return }
    if (!Number.isFinite(qty) || qty < 1) { setStatus({ kind: 'err', msg: 'Quantity must be at least 1.' }); return }
    if (isGraded && (!grader || !grade)) {
      setStatus({ kind: 'err', msg: 'Graded copies need both a grader and a grade.' })
      return
    }
    setSaving(true)
    setStatus(null)

    const supabase = getSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setSaving(false)
      setStatus({ kind: 'err', msg: 'Session expired. Refresh and sign in again.' })
      return
    }

    // Look up existing row. Raw and graded are separately keyed:
    //   raw    → (user, finish, condition), grader IS NULL
    //   graded → (user, finish, grader, grade)
    // Matches the partial-unique indexes in the 2026-09-28 migration.
    let existingQuery = supabase
      .from('mtg_collection_items')
      .select('id, quantity, acquired_price_cents, acquired_currency, acquired_at, notes')
      .eq('printing_finish_id', finishId)
    if (isGraded) {
      existingQuery = existingQuery.eq('grader', grader).eq('grade', grade)
    } else {
      existingQuery = existingQuery.eq('condition', condition).is('grader', null)
    }
    const { data: existing } = await existingQuery.maybeSingle()

    const priceCents = price ? Math.round(parseFloat(price) * 100) : null

    let error: any = null
    if (existing) {
      const { error: e } = await supabase.from('mtg_collection_items')
        .update({
          quantity: existing.quantity + qty,
          acquired_price_cents: priceCents ?? existing.acquired_price_cents ?? null,
          acquired_currency: (priceCents != null ? priceCurrency : existing.acquired_currency) ?? null,
          acquired_at: acquiredAt || existing.acquired_at || null,
          notes: notes || existing.notes || null,
        })
        .eq('id', existing.id)
      error = e
    } else {
      const { error: e } = await supabase.from('mtg_collection_items').insert({
        user_id: user.id,
        printing_finish_id: finishId,
        condition,
        quantity: qty,
        acquired_price_cents: priceCents,
        acquired_currency: priceCents != null ? priceCurrency : null,
        acquired_at: acquiredAt || null,
        notes: notes || null,
        grader: isGraded ? grader : null,
        grade:  isGraded ? grade  : null,
      })
      error = e
    }

    setSaving(false)
    if (error) { setStatus({ kind: 'err', msg: error.message ?? 'Save failed.' }); return }
    const suffix = isGraded ? `${grader} ${grade}` : CONDITION_SHORT[condition]
    setStatus({ kind: 'ok', msg: `Added ${qty} × ${cardName} (${suffix}).` })
    setQty(1); setPrice(''); setAcquiredAt(''); setNotes('')
    router.refresh()
  }

  const disabled = !authChecked
  const label = signedIn === false ? 'Sign in to save' : '+ Collection'

  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); triggerClick() }}
          disabled={disabled}
          style={{
            padding: '4px 8px', fontSize: 11, fontWeight: 700,
            border: '1px solid var(--border)', borderRadius: 999,
            background: 'var(--surface)', color: 'var(--primary)',
            cursor: disabled ? 'wait' : 'pointer',
          }}
        >{label}</button>
        {open && signedIn && (
          <Modal onClose={() => setOpen(false)}>
            <FormBody
              finishes={finishes} finishId={finishId} setFinishId={setFinishId}
              condition={condition} setCondition={setCondition}
              qty={qty} setQty={setQty}
              price={price} setPrice={setPrice}
              priceCurrency={priceCurrency} setPriceCurrency={setPriceCurrency}
              acquiredAt={acquiredAt} setAcquiredAt={setAcquiredAt}
              notes={notes} setNotes={setNotes}
              isGraded={isGraded} setIsGraded={setIsGraded}
              grader={grader} setGrader={setGrader}
              grade={grade} setGrade={setGrade}
              saving={saving} save={save} status={status}
              cardName={cardName}
            />
          </Modal>
        )}
      </>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={triggerClick}
        disabled={disabled}
        style={{
          background: 'var(--primary)', color: '#fff', border: 'none',
          padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700,
          cursor: disabled ? 'wait' : 'pointer', width: '100%',
        }}
      >{label}</button>
      {open && signedIn && (
        <div style={{
          marginTop: 12, padding: 14, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 10,
        }}>
          <FormBody
            finishes={finishes} finishId={finishId} setFinishId={setFinishId}
            condition={condition} setCondition={setCondition}
            qty={qty} setQty={setQty}
            price={price} setPrice={setPrice}
            priceCurrency={priceCurrency} setPriceCurrency={setPriceCurrency}
            acquiredAt={acquiredAt} setAcquiredAt={setAcquiredAt}
            notes={notes} setNotes={setNotes}
            isGraded={isGraded} setIsGraded={setIsGraded}
            grader={grader} setGrader={setGrader}
            grade={grade} setGrade={setGrade}
            saving={saving} save={save} status={status}
            cardName={cardName}
          />
        </div>
      )}
    </div>
  )
}

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(23,32,58,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 14, padding: 18,
          maxWidth: 420, width: '100%', boxShadow: '0 24px 60px rgba(23,32,58,0.18)',
          border: '1px solid var(--border)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function FormBody(props: {
  finishes: FinishOption[]
  finishId: string; setFinishId: (v: string) => void
  condition: CardCondition; setCondition: (v: CardCondition) => void
  qty: number; setQty: (v: number) => void
  price: string; setPrice: (v: string) => void
  priceCurrency: 'USD' | 'EUR'; setPriceCurrency: (v: 'USD' | 'EUR') => void
  acquiredAt: string; setAcquiredAt: (v: string) => void
  notes: string; setNotes: (v: string) => void
  isGraded: boolean; setIsGraded: (v: boolean) => void
  grader: SlabGrader; setGrader: (v: SlabGrader) => void
  grade: string; setGrade: (v: string) => void
  saving: boolean; save: () => void
  status: { kind: 'ok' | 'err'; msg: string } | null
  cardName: string
}) {
  const p = props
  const [showOptional, setShowOptional] = useState(false)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>Add {p.cardName}</div>

      {/* Raw / Graded track. Graded rows are stored separately so a PSA 10
          coexists with a raw NM copy for the same printing. */}
      <div role="tablist" aria-label="Copy type" style={{ display: 'flex', gap: 6, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 999, padding: 4 }}>
        <TrackButton active={!p.isGraded} onClick={() => p.setIsGraded(false)}>Raw</TrackButton>
        <TrackButton active={p.isGraded} onClick={() => p.setIsGraded(true)}>Graded</TrackButton>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: p.isGraded ? '1fr 1fr 1fr' : '1fr 1fr 1fr' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label-mono">Finish</span>
          <select value={p.finishId} onChange={(e) => p.setFinishId(e.target.value)} style={inputStyle}>
            {p.finishes.map((f) => <option key={f.id} value={f.id}>{f.finish}</option>)}
          </select>
        </label>
        {p.isGraded ? (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="label-mono">Grader</span>
              <select value={p.grader} onChange={(e) => p.setGrader(e.target.value as SlabGrader)} style={inputStyle}>
                {GRADERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="label-mono">Grade</span>
              <select value={p.grade} onChange={(e) => p.setGrade(e.target.value)} style={inputStyle}>
                {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          </>
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label-mono">Condition</span>
            <select value={p.condition} onChange={(e) => p.setCondition(e.target.value as CardCondition)} style={inputStyle}>
              {CONDITIONS_ORDERED.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
            </select>
          </label>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label-mono">Qty</span>
          <input type="number" min="1" max="9999" value={p.qty} onChange={(e) => p.setQty(parseInt(e.target.value, 10) || 1)} style={inputStyle} />
        </label>
      </div>

      <button type="button" onClick={() => setShowOptional((v) => !v)} style={{
        background: 'transparent', border: 'none', textAlign: 'left',
        color: 'var(--primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
      }}>
        {showOptional ? '– Hide acquired price / date / notes' : '+ Acquired price / date / notes'}
      </button>

      {showOptional && (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label-mono">Acquired price (per copy)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={p.priceCurrency} onChange={(e) => p.setPriceCurrency(e.target.value as any)} style={{ ...inputStyle, flex: '0 0 74px' }}>
                <option value="USD">USD $</option>
                <option value="EUR">EUR €</option>
              </select>
              <input type="number" min="0" step="0.01" value={p.price} onChange={(e) => p.setPrice(e.target.value)} placeholder="e.g. 4.99" style={{ ...inputStyle, flex: 1 }} />
            </div>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label-mono">Acquired date</span>
            <input type="date" value={p.acquiredAt} onChange={(e) => p.setAcquiredAt(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label-mono">Notes</span>
            <input type="text" value={p.notes} onChange={(e) => p.setNotes(e.target.value)} placeholder="grade, purchase notes…" style={inputStyle} />
          </label>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={p.save}
          disabled={p.saving}
          style={{
            background: 'var(--primary)', color: '#fff', border: 'none',
            padding: '10px 16px', borderRadius: 10, fontWeight: 700, fontSize: 14,
            cursor: p.saving ? 'wait' : 'pointer', flex: 1,
          }}
        >{p.saving ? 'Saving…' : `Add ${p.qty}`}</button>
      </div>

      {p.status && (
        <div style={{
          padding: 10, borderRadius: 8, fontSize: 12,
          background: p.status.kind === 'ok' ? 'rgba(43,134,89,0.12)' : 'rgba(180,65,70,0.12)',
          color: p.status.kind === 'ok' ? 'var(--green)' : 'var(--red)',
          border: `1px solid ${p.status.kind === 'ok' ? 'rgba(43,134,89,0.28)' : 'rgba(180,65,70,0.28)'}`,
        }}>{p.status.msg}</div>
      )}
    </div>
  )
}

function TrackButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flex: 1,
        padding: '6px 10px', borderRadius: 999,
        border: 'none',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? '0 1px 3px rgba(20,33,61,0.10)' : 'none',
        color: active ? 'var(--text-strong)' : 'var(--text-muted)',
        fontWeight: 700, fontSize: 12,
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{children}</button>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  border: '1px solid var(--border)',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  borderRadius: 10,
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
