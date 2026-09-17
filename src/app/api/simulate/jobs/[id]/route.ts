// app/api/simulate/jobs/[id]/route.ts
// Owner-only job status polling.

import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/supabase/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  const { id } = await params
  const s = getSupabaseServiceClient()
  const { data: job } = await s.from('mtg_simulation_jobs').select('*').eq('id', id).maybeSingle()
  if (!job || job.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ job })
}
