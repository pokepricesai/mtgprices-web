// tests/mtg/rules-queue.test.ts
//
// Phase 4B.3 — job queue + coverage + RLS tests. Uses the LIVE
// production Supabase (service role) to exercise the atomic claim
// RPC, lease recovery, max_attempts, and RLS from a non-owner.
// Cleans up its own rows.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Shim server-only + load .env.local so this runs under tsx.
const req = createRequire(import.meta.url)
try {
  const p = req.resolve('server-only')
  ;(req as any).cache[p] = { id: p, filename: p, loaded: true, exports: {}, children: [], paths: [], parent: null, path: p, isPreloading: false, require: req } as any
} catch { /* ok */ }
;(() => {
  try {
    const fs = req('fs') as typeof import('fs')
    const raw = fs.readFileSync('.env.local', 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  } catch { /* .env.local optional */ }
})()

const { createClient } = req('@supabase/supabase-js')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function makeUser(tag: string) {
  const email = `mtg-4b3-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const { data } = await s.auth.admin.createUser({ email, password: 'DontUse1234!', email_confirm: true })
  return { id: data.user.id, email }
}

async function insertQueued(userId: string, tag = 'test') {
  const { data, error } = await s.from('mtg_simulation_jobs').insert({
    user_id: userId,
    deck_a_snapshot: { id: '00000000-0000-0000-0000-000000000000', name: `A-${tag}`, format: 'modern', commanders: [], main: [] },
    deck_b_snapshot: { id: '00000000-0000-0000-0000-000000000000', name: `B-${tag}`, format: 'modern', commanders: [], main: [] },
    format: 'modern',
    engine: 'forge',
    engine_version: 'forge-2.0.14',
    seed: 42,
    requested_iterations: 1,
    timeout_sec: 60,
    max_attempts: 2,
    status: 'queued',
  }).select().single()
  if (error) throw new Error(error.message)
  return data as any
}

async function claim(workerId: string, leaseSec = 300) {
  const { data, error } = await s.rpc('mtg_simulation_claim_next', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSec,
  })
  if (error) throw new Error(error.message)
  return data as any
}

// ── Tests ──────────────────────────────────────────────────────────

test('forge-coverage: known card + unknown card + Æ normalisation', async () => {
  const { knownToForge, findUnsupportedCards } = await import('../../src/lib/mtg/simulation/forge-coverage')
  assert.strictEqual(knownToForge('Lightning Bolt'), true)
  assert.strictEqual(knownToForge('Krenko, Mob Boss'), true)
  assert.strictEqual(knownToForge('Æther Vial'), true, 'Æ normalisation should match "aether vial"')
  assert.strictEqual(knownToForge('Not A Real MTG Card XYZZY'), false)
  const bad = findUnsupportedCards([
    { oracle_card_id: 'a', name: 'Lightning Bolt' },
    { oracle_card_id: 'b', name: 'Definitely Not A Card 9999' },
  ])
  assert.strictEqual(bad.length, 1)
  assert.strictEqual(bad[0].oracle_card_id, 'b')
})

test('atomic claim: two workers cannot claim the same job', async () => {
  const user = await makeUser('claim')
  const job = await insertQueued(user.id, 'claim')
  try {
    // Fire two concurrent claims. Postgres FOR UPDATE SKIP LOCKED
    // guarantees at most one succeeds.
    const [a, b] = await Promise.all([claim('worker-A'), claim('worker-B')])
    const winners = [a, b].filter((r) => r != null && r.id === job.id)
    const losers = [a, b].filter((r) => r == null || r.id !== job.id)
    assert.strictEqual(winners.length, 1, `expected exactly one claim to win the target job, got ${winners.length}`)
    // The losing call may either have returned null OR claimed
    // another queued row (from a previous test). Both are fine.
    for (const l of losers) {
      if (l != null && l.id === job.id) assert.fail('same job claimed twice')
    }
    const { data: after } = await s.from('mtg_simulation_jobs').select('status, worker_id, attempts').eq('id', job.id).single()
    assert.strictEqual(after.status, 'running')
    assert.strictEqual(after.attempts, 1)
  } finally {
    await s.from('mtg_simulation_jobs').delete().eq('id', job.id)
    await s.auth.admin.deleteUser(user.id)
  }
})

test('heartbeat: extends lease and only the owning worker can heartbeat', async () => {
  const user = await makeUser('hb')
  const job = await insertQueued(user.id, 'hb')
  try {
    await claim('worker-owner', 60)
    const beforeHb = await s.from('mtg_simulation_jobs').select('lease_expires_at').eq('id', job.id).single()
    await new Promise((r) => setTimeout(r, 1100))
    const { data: ok } = await s.rpc('mtg_simulation_heartbeat', { p_job_id: job.id, p_worker_id: 'worker-owner', p_lease_seconds: 120 })
    assert.strictEqual(ok, true)
    const afterHb = await s.from('mtg_simulation_jobs').select('lease_expires_at').eq('id', job.id).single()
    assert.ok(new Date(afterHb.data.lease_expires_at).getTime() > new Date(beforeHb.data.lease_expires_at).getTime(),
      'lease_expires_at must increase after heartbeat')

    const { data: reject } = await s.rpc('mtg_simulation_heartbeat', { p_job_id: job.id, p_worker_id: 'not-owner', p_lease_seconds: 120 })
    assert.strictEqual(reject, false, 'non-owner heartbeat must be rejected')
  } finally {
    await s.from('mtg_simulation_jobs').delete().eq('id', job.id)
    await s.auth.admin.deleteUser(user.id)
  }
})

test('fail: on first failure re-queues; on max_attempts exceeded → status=failed', async () => {
  const user = await makeUser('fail')
  const job = await insertQueued(user.id, 'fail')
  try {
    await claim('w1', 60)
    const { data: firstFail } = await s.rpc('mtg_simulation_fail', {
      p_job_id: job.id, p_worker_id: 'w1', p_error: 'transient', p_diag_tail: 'diag-1',
    })
    assert.strictEqual(firstFail, true)
    const after1 = await s.from('mtg_simulation_jobs').select('status, attempts, worker_id, diagnostic_tail').eq('id', job.id).single()
    assert.strictEqual(after1.data.status, 'queued', 'first failure should re-queue (attempts < max_attempts)')
    assert.strictEqual(after1.data.attempts, 1)
    assert.strictEqual(after1.data.worker_id, null)
    assert.strictEqual(after1.data.diagnostic_tail, 'diag-1')

    // Claim again — attempts now hits 2 which equals max_attempts.
    await claim('w2', 60)
    const { data: secondFail } = await s.rpc('mtg_simulation_fail', {
      p_job_id: job.id, p_worker_id: 'w2', p_error: 'permanent', p_diag_tail: 'diag-2',
    })
    assert.strictEqual(secondFail, true)
    const after2 = await s.from('mtg_simulation_jobs').select('status, attempts, error').eq('id', job.id).single()
    assert.strictEqual(after2.data.status, 'failed')
    assert.strictEqual(after2.data.attempts, 2)
    assert.strictEqual(after2.data.error, 'permanent')
  } finally {
    await s.from('mtg_simulation_jobs').delete().eq('id', job.id)
    await s.auth.admin.deleteUser(user.id)
  }
})

test('complete: rejects the wrong worker + accepts the right one', async () => {
  const user = await makeUser('done')
  const job = await insertQueued(user.id, 'done')
  try {
    await claim('right-worker', 60)
    const { data: rejected } = await s.rpc('mtg_simulation_complete', { p_job_id: job.id, p_worker_id: 'wrong-worker', p_result: { hi: 1 } })
    assert.strictEqual(rejected, false)
    const { data: ok } = await s.rpc('mtg_simulation_complete', { p_job_id: job.id, p_worker_id: 'right-worker', p_result: { games: [] } })
    assert.strictEqual(ok, true)
    const after = await s.from('mtg_simulation_jobs').select('status, result').eq('id', job.id).single()
    assert.strictEqual(after.data.status, 'done')
    assert.ok(after.data.result)
  } finally {
    await s.from('mtg_simulation_jobs').delete().eq('id', job.id)
    await s.auth.admin.deleteUser(user.id)
  }
})

test('lease recovery: a job whose lease has expired can be reclaimed by another worker', async () => {
  const user = await makeUser('lease')
  const job = await insertQueued(user.id, 'lease')
  try {
    // Claim with a 1-second lease.
    await claim('dead-worker', 1)
    await new Promise((r) => setTimeout(r, 1500))
    const reclaimed = await claim('live-worker', 60)
    assert.ok(reclaimed, 'reclaim should return a payload')
    assert.strictEqual(reclaimed.id, job.id, 'the reclaimed job should be the same one')
    assert.strictEqual(reclaimed.attempts, 2, 'attempts should have incremented')
    assert.strictEqual(reclaimed.worker_id, 'live-worker')
  } finally {
    await s.from('mtg_simulation_jobs').delete().eq('id', job.id)
    await s.auth.admin.deleteUser(user.id)
  }
})

test('queue RLS: non-owner cannot SELECT another user\'s job', async () => {
  const userA = await makeUser('rls-a')
  const userB = await makeUser('rls-b')
  const jobA = await insertQueued(userA.id, 'rls')
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const B = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const password = 'DontUse1234!'
  await B.auth.signInWithPassword({ email: userB.email, password })
  try {
    const { data } = await B.from('mtg_simulation_jobs').select('id').eq('id', jobA.id).maybeSingle()
    assert.strictEqual(data, null, `User B must not see User A's job (got ${JSON.stringify(data)})`)
  } finally {
    await s.from('mtg_simulation_jobs').delete().eq('id', jobA.id)
    await s.auth.admin.deleteUser(userA.id)
    await s.auth.admin.deleteUser(userB.id)
  }
})
