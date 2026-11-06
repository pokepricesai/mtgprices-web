// CN-IDENTITY-02 · network-wide entitlement helpers for mtgprices-web.
//
// Ported from @collector-network/auth (collector-network monorepo).
// Thin server-side wrappers over the shared Supabase project's
// collector_memberships + collector_discord_links tables so that
// linking Discord on MTGPrices attaches the identity to the same
// Collector Network user that signs in on YGO / OnePiece / Lorcana
// / Pokemon.
//
// Keep in sync with packages/auth/src/entitlements.ts in the
// collector-network monorepo. If you change one, update both.

import type { SupabaseClient, User } from '@supabase/supabase-js'

export type MembershipTier   = 'free' | 'premium'
export type MembershipStatus = 'active' | 'cancelled' | 'expired' | 'suspended'

export interface MembershipSummary {
  tier: MembershipTier
  status: MembershipStatus
  activated_at: string
  expires_at: string | null
  discord_linked: boolean
}

export interface DiscordLink {
  discord_user_id: string
  discord_username: string | null
  discord_avatar: string | null
  linked_at: string
  disconnected_at: string | null
}

export async function getUserMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<MembershipSummary | null> {
  const { data, error } = await supabase
    .from('collector_user_membership_view')
    .select('tier, status, activated_at, expires_at, discord_linked')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('[entitlements] getUserMembership error:', error.message)
    return null
  }
  if (!data) return null
  return data as MembershipSummary
}

export async function getUserDiscordLink(
  supabase: SupabaseClient,
  userId: string,
): Promise<DiscordLink | null> {
  const { data, error } = await supabase
    .from('collector_discord_links')
    .select('discord_user_id, discord_username, discord_avatar, linked_at, disconnected_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[entitlements] getUserDiscordLink error:', error.message)
    }
    return null
  }
  if (!data) return null
  const link = data as DiscordLink
  if (link.disconnected_at) return null
  return link
}

export type LinkResult =
  | { ok: true; link: DiscordLink }
  | { ok: false; code: 'already_linked' | 'no_discord_identity' | 'db_error'; message: string }

export async function linkDiscordFromAuthIdentity(
  supabase: SupabaseClient,
  _userId: string,
): Promise<LinkResult> {
  void _userId
  const { data: userResp, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userResp?.user) {
    return { ok: false, code: 'db_error', message: userErr?.message ?? 'no auth user' }
  }
  const identities = (userResp.user.identities ?? []) as Array<{
    provider: string
    provider_id?: string
    identity_data?: { sub?: string; username?: string; name?: string; avatar_url?: string; email?: string }
  }>
  const discord = identities.find((i) => i.provider === 'discord')
  if (!discord) {
    return { ok: false, code: 'no_discord_identity', message: 'auth.identities has no discord provider' }
  }
  const discordUserId = discord.provider_id ?? discord.identity_data?.sub
  if (!discordUserId) {
    return { ok: false, code: 'no_discord_identity', message: 'discord identity missing provider_id / sub' }
  }
  const { data: rpcData, error: rpcErr } = await supabase.rpc('collector_link_discord', {
    p_discord_user_id: discordUserId,
    p_username:        discord.identity_data?.username ?? discord.identity_data?.name ?? null,
    p_avatar:          discord.identity_data?.avatar_url ?? null,
    p_email:           discord.identity_data?.email ?? null,
  })
  if (rpcErr) {
    if (/discord_already_linked/i.test(rpcErr.message)) {
      return { ok: false, code: 'already_linked', message: 'This Discord account is already linked to another Collector Network account.' }
    }
    return { ok: false, code: 'db_error', message: rpcErr.message }
  }
  return { ok: true, link: rpcData as DiscordLink }
}

export type UnlinkResult =
  | { ok: true }
  | { ok: false; code: 'not_authenticated' | 'identity_removal_failed' | 'db_error'; message: string }

export async function unlinkDiscord(
  supabase: SupabaseClient,
  _userId: string,
): Promise<UnlinkResult> {
  void _userId
  try {
    const { data: idents, error: identErr } = await supabase.auth.getUserIdentities()
    if (identErr) {
      return { ok: false, code: 'identity_removal_failed', message: identErr.message }
    }
    const discord = (idents?.identities ?? []).find((i) => i.provider === 'discord')
    if (discord) {
      const { error: unlinkErr } = await supabase.auth.unlinkIdentity(discord)
      if (unlinkErr) {
        return { ok: false, code: 'identity_removal_failed', message: unlinkErr.message }
      }
    }
  } catch (e) {
    return { ok: false, code: 'identity_removal_failed', message: (e as Error)?.message ?? String(e) }
  }
  const { error: rpcErr } = await supabase.rpc('collector_unlink_discord')
  if (rpcErr) {
    if (/not_authenticated/i.test(rpcErr.message)) {
      return { ok: false, code: 'not_authenticated', message: rpcErr.message }
    }
    return { ok: false, code: 'db_error', message: rpcErr.message }
  }
  return { ok: true }
}

// requireFeature helper omitted — not used on the account surface.
// Add it back if MTG grows a server gate on stock-alerts / ebay-deals.
export type Feature =
  | 'stock_alerts_free'
  | 'stock_alerts_premium'
  | 'ebay_deals_free'
  | 'ebay_deals_premium'

export async function userHasFeature(
  supabase: SupabaseClient,
  userId: string | null,
  feature: Feature,
): Promise<boolean> {
  if (!userId) return false
  const { data, error } = await supabase.rpc('collector_user_has_feature', {
    p_user_id: userId,
    p_feature: feature,
  })
  if (error) {
    console.error('[entitlements] userHasFeature error:', error.message)
    return false
  }
  return data === true
}

export async function requireFeature(
  supabase: SupabaseClient,
  user: User | null,
  feature: Feature,
): Promise<User | null> {
  if (!user) return null
  const ok = await userHasFeature(supabase, user.id, feature)
  return ok ? user : null
}
