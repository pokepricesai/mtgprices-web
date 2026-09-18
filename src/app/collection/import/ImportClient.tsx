'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import type { ImportPreview } from '@/lib/mtg/csv-import'

export default function ImportClient() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function doPreview() {
    setError(null)
    setResult(null)
    setPreviewing(true)
    const res = await fetch('/api/collection/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: text }),
    })
    setPreviewing(false)
    if (!res.ok) { setError(`Preview failed: ${res.status}`); return }
    const data = await res.json()
    setPreview(data.preview)
  }

  async function doImport() {
    if (!preview) return
    setImporting(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setImporting(false); setError('Not signed in.'); return }

    let imported = 0
    for (const row of preview.resolved) {
      const { data: existing } = await supabase.from('mtg_collection_items')
        .select('id, quantity')
        .eq('printing_finish_id', row.printing_finish_id)
        .eq('condition', row.condition)
        .maybeSingle()
      if (existing) {
        await supabase.from('mtg_collection_items').update({
          quantity: existing.quantity + row.quantity,
        }).eq('id', existing.id)
      } else {
        await supabase.from('mtg_collection_items').insert({
          user_id: user.id,
          printing_finish_id: row.printing_finish_id,
          condition: row.condition,
          quantity: row.quantity,
          acquired_price_cents: row.acquired_price_cents,
          acquired_currency: row.acquired_currency,
        })
      }
      imported++
    }

    // Audit-trail record.
    await supabase.from('mtg_collection_imports').insert({
      user_id: user.id,
      source: preview.source,
      total_rows: preview.totalRows,
      imported_rows: imported,
      ambiguous_rows: preview.ambiguous.length,
      unresolved_rows: preview.unresolved.length,
      summary: {
        source: preview.source,
        unresolved_sample: preview.unresolved.slice(0, 20),
        ambiguous_sample: preview.ambiguous.slice(0, 20),
      },
    })

    setImporting(false)
    setResult({ imported, skipped: preview.ambiguous.length + preview.unresolved.length })
    setPreview(null)
    setText('')
    router.refresh()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const buf = await file.text()
    setText(buf)
  }

  return (
    <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ fontSize: 13 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>or paste below</span>
      </div>
      <textarea
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="name,set,collector_number,quantity,condition,finish"
        style={{
          padding: 12, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text)',
          borderRadius: 10, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          outline: 'none', resize: 'vertical', minHeight: 160,
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={doPreview}
          disabled={!text.trim() || previewing}
          style={{
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >{previewing ? 'Previewing…' : 'Preview'}</button>
        {preview && preview.resolved.length > 0 && (
          <button
            type="button"
            onClick={doImport}
            disabled={importing}
            style={{
              background: 'var(--primary)', color: '#fff', border: 'none',
              padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >{importing ? 'Importing…' : `Import ${preview.resolved.length} rows`}</button>
        )}
      </div>

      {error && <div style={{ padding: 10, background: 'rgba(180,65,70,0.10)', border: '1px solid rgba(180,65,70,0.28)', borderRadius: 10, color: 'var(--red)', fontSize: 13 }}>{error}</div>}
      {result && (
        <div style={{ padding: 12, background: 'rgba(43,134,89,0.10)', border: '1px solid rgba(43,134,89,0.28)', borderRadius: 10, color: 'var(--green)', fontSize: 13 }}>
          Imported {result.imported} rows. {result.skipped > 0 ? `${result.skipped} skipped (ambiguous or unresolved).` : ''}
        </div>
      )}

      {preview && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Source detected: <strong style={{ color: 'var(--text)' }}>{preview.source}</strong>{' '}·{' '}
            {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'}
          </div>
          <PreviewBlock title="Resolved" tone="ok" count={preview.resolved.length}>
            {preview.resolved.slice(0, 20).map((r) => (
              <li key={r.index}>
                <strong>{r.name}</strong> ({r.setCode?.toUpperCase() ?? '?'}
                {r.collectorNumber ? ` #${r.collectorNumber}` : ''}, {r.finish}, ×{r.quantity})
                <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>via {r.matched_on.replace(/_/g, ' ')}</span>
              </li>
            ))}
            {preview.resolved.length > 20 && <li style={{ color: 'var(--text-muted)' }}>… and {preview.resolved.length - 20} more.</li>}
          </PreviewBlock>
          {preview.ambiguous.length > 0 && (
            <PreviewBlock title="Ambiguous (skipped)" tone="warn" count={preview.ambiguous.length}>
              {preview.ambiguous.map((r) => (
                <li key={r.index}><strong>{r.name}</strong>: {r.reason}. Candidates: {r.candidates.length}</li>
              ))}
            </PreviewBlock>
          )}
          {preview.unresolved.length > 0 && (
            <PreviewBlock title="Unresolved (skipped)" tone="err" count={preview.unresolved.length}>
              {preview.unresolved.map((r) => (
                <li key={r.index}><strong>{r.name}</strong>: {r.reason}</li>
              ))}
            </PreviewBlock>
          )}
        </div>
      )}
    </div>
  )
}

function PreviewBlock({ title, tone, count, children }: { title: string; tone: 'ok' | 'warn' | 'err'; count: number; children: React.ReactNode }) {
  const color =
    tone === 'ok' ? 'var(--green)' :
    tone === 'warn' ? 'var(--amber)' :
    'var(--red)'
  return (
    <details style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700 }}>
        <span style={{ color }}>{title}</span>
        <span style={{ color: 'var(--text-muted)' }}>{count}</span>
      </summary>
      <ul style={{ marginTop: 10, marginBottom: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.6 }}>
        {children}
      </ul>
    </details>
  )
}
