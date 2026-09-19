'use client'

// src/app/settings/ProfileEditor.tsx
// Client editor for display name + avatar selection. Writes to
// mtg_user_profiles via the session-scoped Supabase browser client so
// RLS enforces owner-only updates. Navbar picks up changes on the
// next auth-state event; we also router.refresh() so the current page
// reflects the new state immediately.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import Avatar from '@/components/mtg/Avatar'
import { AVATARS, SELECTABLE_MOTIFS, resolveAvatar, type AvatarKey } from '@/lib/mtg/avatars'

type Props = {
  initialDisplayName: string
  initialAvatarKey: string
  googleImageUrl: string | null
}

export default function ProfileEditor({ initialDisplayName, initialAvatarKey, googleImageUrl }: Props) {
  const router = useRouter()
  const [name, setName] = useState(initialDisplayName)
  const [avatarKey, setAvatarKey] = useState<AvatarKey>(resolveAvatar(initialAvatarKey).key)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function save() {
    setSaving(true)
    setStatus(null)
    const supabase = getSupabaseBrowserClient()
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData.user?.id
    if (!uid) { setSaving(false); setStatus({ kind: 'err', msg: 'Session expired.' }); return }
    const trimmed = name.trim().slice(0, 60)
    const { error } = await supabase.from('mtg_user_profiles').upsert({
      user_id: uid,
      display_name: trimmed,
      avatar_key: avatarKey,
    }, { onConflict: 'user_id' })
    setSaving(false)
    if (error) {
      setStatus({ kind: 'err', msg: error.message })
      return
    }
    setStatus({ kind: 'ok', msg: 'Saved.' })
    router.refresh()
  }

  const googleAvailable = Boolean(googleImageUrl)

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Display name */}
      <div>
        <label htmlFor="display-name" style={{
          display: 'block', fontSize: 12, fontWeight: 700,
          color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6,
        }}>Display name</label>
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="What should we call you?"
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--bg-light)',
            color: 'var(--text)', fontSize: 15, fontFamily: 'inherit',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Up to 60 characters. Leave blank to fall back to your account name.
        </div>
      </div>

      {/* Avatar picker */}
      <div>
        <div style={{
          fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
        }}>Avatar</div>
        <div style={{
          display: 'grid', gap: 8,
          gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
        }}>
          {googleAvailable && (
            <AvatarButton
              def={AVATARS.find((a) => a.key === 'google')!}
              selected={avatarKey === 'google'}
              onClick={() => setAvatarKey('google')}
              googleImageUrl={googleImageUrl}
            />
          )}
          {SELECTABLE_MOTIFS.map((def) => (
            <AvatarButton
              key={def.key}
              def={def}
              selected={avatarKey === def.key}
              onClick={() => setAvatarKey(def.key)}
              googleImageUrl={null}
            />
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          All motifs are original MTGPrices artwork.
          {googleAvailable ? ' Google shows the photo attached to your Google sign in.' : ''}
        </div>
      </div>

      {/* Preview + save */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        padding: 12, background: 'var(--bg-light)', borderRadius: 10, border: '1px solid var(--border)',
      }}>
        <Avatar avatarKey={avatarKey} googleImageUrl={googleImageUrl} size={48} />
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Preview</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
            {name.trim() || '(no name set)'}
          </div>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn btn-gold btn-sm"
        >{saving ? 'Saving…' : 'Save profile'}</button>
        {status && (
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: status.kind === 'ok' ? 'var(--green)' : 'var(--red)',
          }}>{status.msg}</span>
        )}
      </div>
    </div>
  )
}

function AvatarButton({
  def, selected, onClick, googleImageUrl,
}: {
  def: { key: string; label: string }
  selected: boolean
  onClick: () => void
  googleImageUrl: string | null
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={def.label}
      aria-pressed={selected}
      title={def.label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        padding: 8, borderRadius: 12, cursor: 'pointer',
        background: selected ? 'var(--accent-soft)' : 'transparent',
        border: `2px solid ${selected ? 'var(--gold-400)' : 'transparent'}`,
        fontFamily: 'inherit',
      }}
    >
      <Avatar avatarKey={def.key} googleImageUrl={googleImageUrl} size={44} />
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{def.label}</span>
    </button>
  )
}
