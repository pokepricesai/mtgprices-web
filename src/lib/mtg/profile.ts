// src/lib/mtg/profile.ts
// Read/write helpers for the MTGPrices-specific user profile row.
// Always goes through the caller's session-scoped Supabase client so
// RLS enforces owner-only access.

import 'server-only'
import { getSupabaseServerClient, getCurrentUser } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { DEFAULT_AVATAR_KEY, resolveAvatar } from './avatars'

export type MtgUserProfile = {
  user_id: string
  display_name: string
  avatar_key: string
  created_at: string
  updated_at: string
}

/** Fetch the caller's profile, or null when not signed in. Ensures a
 *  row exists so callers always get a stable shape. */
export async function getOrCreateMyProfile(): Promise<MtgUserProfile | null> {
  const user = await getCurrentUser()
  if (!user) return null
  const supabase = await getSupabaseServerClient()

  const { data: existing } = await supabase
    .from('mtg_user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing) return existing as MtgUserProfile

  const { data: inserted, error } = await supabase
    .from('mtg_user_profiles')
    .insert({
      user_id: user.id,
      display_name: defaultDisplayName(user),
      avatar_key: DEFAULT_AVATAR_KEY,
    })
    .select('*')
    .single()
  if (error) {
    console.error('getOrCreateMyProfile insert error:', error)
    return null
  }
  return inserted as MtgUserProfile
}

/** Update the caller's profile. `display_name` and `avatar_key` are
 *  the only writable columns. RLS enforces owner-only. */
export async function updateMyProfile(input: { display_name?: string; avatar_key?: string }): Promise<
  { ok: true; profile: MtgUserProfile } | { ok: false; error: string }
> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'unauthenticated' }
  const supabase = await getSupabaseServerClient()

  const patch: Record<string, string> = {}
  if (typeof input.display_name === 'string') {
    const trimmed = input.display_name.trim().slice(0, 60)
    patch.display_name = trimmed
  }
  if (typeof input.avatar_key === 'string') {
    const resolved = resolveAvatar(input.avatar_key)
    patch.avatar_key = resolved.key
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'nothing to update' }

  // Upsert semantics: create-if-missing, otherwise update. This is
  // important because RLS INSERT policy requires auth.uid() = user_id.
  const { data, error } = await supabase
    .from('mtg_user_profiles')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? 'update_failed' }
  return { ok: true, profile: data as MtgUserProfile }
}

/** Extract a best-effort default name from the auth identity. Falls
 *  back to the email prefix so we never show an empty label. */
export function defaultDisplayName(user: { email?: string | null; user_metadata?: any } | null): string {
  if (!user) return ''
  const meta = user.user_metadata ?? {}
  const fromMeta = (meta.full_name ?? meta.name ?? meta.preferred_username ?? '').toString().trim()
  if (fromMeta.length > 0) return fromMeta.slice(0, 60)
  const email = (user.email ?? '').trim()
  if (email.includes('@')) return email.split('@')[0].slice(0, 60)
  return ''
}

/** Google (or other OAuth) photo URL if the provider returned one. */
export function oauthImageUrl(user: { user_metadata?: any } | null): string | null {
  const meta = user?.user_metadata ?? {}
  const url = meta.avatar_url ?? meta.picture ?? null
  if (typeof url === 'string' && /^https:\/\//.test(url)) return url
  return null
}

/** Fetch someone else's profile by user_id via the service client. Used
 *  by AI + public deck rendering; only reads the public-safe fields. */
export async function getProfileForUser(userId: string): Promise<Pick<MtgUserProfile, 'user_id' | 'display_name' | 'avatar_key'> | null> {
  const s = getSupabaseServiceClient()
  const { data } = await s
    .from('mtg_user_profiles')
    .select('user_id, display_name, avatar_key')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as any) ?? null
}
