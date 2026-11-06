// CN-IDENTITY-02 · Discord disconnect endpoint for mtgprices-web.
//
// POST only. The Account page's Disconnect button submits a form
// here; we remove the Supabase Auth Discord identity FIRST (so no
// Discord sign-in path remains attached) and only then flip the
// collector_discord_links row to disconnected. The user keeps the
// rest of their session + membership.

import { NextResponse } from 'next/server'
import { getCurrentUser, getSupabaseServerClient } from '@/lib/supabase/server'
import { unlinkDiscord } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mtgprices.io'

export async function POST(): Promise<NextResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/account', SITE_URL).toString(), { status: 303 })
  }
  const supabase = await getSupabaseServerClient()
  const result = await unlinkDiscord(supabase, user.id)
  let flag: string
  if (result.ok) {
    flag = 'disconnected'
  } else {
    // Discriminated-union narrowing doesn't apply under strict:false —
    // read the error code off a cast.
    const err = result as { ok: false; code: string }
    if (err.code === 'identity_removal_failed') {
      flag = 'identity_removal_failed'
    } else if (err.code === 'not_authenticated') {
      flag = 'no_session'
    } else {
      flag = 'disconnect_failed'
    }
  }
  return NextResponse.redirect(new URL(`/account?discord=${flag}`, SITE_URL).toString(), { status: 303 })
}
