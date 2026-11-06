// CN-IDENTITY-02 · Discord link OAuth callback for mtgprices-web.
//
// Mirrors the OnePiece route of the same path. The browser-side
// supabase.auth.linkIdentity({ provider: 'discord' }) kicks off the
// OAuth round trip; Supabase returns here with ?code. We finalise
// the exchange (which attaches the new Discord identity to the
// existing auth.users row) and then mirror the identity into
// collector_discord_links so the UI + feature gates can see it.
//
// Error paths return to /account?discord=<code> so the account page
// can surface a friendly message.

import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { linkDiscordFromAuthIdentity } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(new URL('/account?discord=denied', url.origin))
  }
  if (!code) {
    return NextResponse.redirect(new URL('/account?discord=invalid', url.origin))
  }

  const supabase = await getSupabaseServerClient()
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeErr) {
    return NextResponse.redirect(new URL('/account?discord=exchange_failed', url.origin))
  }

  const { data: userResp, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userResp?.user) {
    return NextResponse.redirect(new URL('/account?discord=no_session', url.origin))
  }

  const result = await linkDiscordFromAuthIdentity(supabase, userResp.user.id)
  if (result.ok) {
    return NextResponse.redirect(new URL('/account?discord=connected', url.origin))
  }
  // Discriminated-union narrowing doesn't apply here because this
  // repo's tsconfig has strict:false — cast to the error variant.
  const err = result as { ok: false; code: string }
  const flag = err.code === 'already_linked'
    ? 'already_linked'
    : err.code === 'no_discord_identity'
    ? 'no_discord_identity'
    : 'link_failed'
  return NextResponse.redirect(new URL(`/account?discord=${flag}`, url.origin))
}
