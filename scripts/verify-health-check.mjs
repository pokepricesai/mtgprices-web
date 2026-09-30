#!/usr/bin/env node
// One-shot local verifier for the pricing-freshness inspector.
// Imports the actual library so we exercise the shipped classifier.
//
//   node --env-file=.env.local scripts/verify-health-check.mjs

import { createClient } from '@supabase/supabase-js';
import { inspectAllSources, overallStatus } from '../src/lib/health/pricing-freshness.ts';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('missing supabase env'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

console.log('\n=== inspectAllSources() ===\n');
const results = await inspectAllSources(sb);
for (const r of results) {
  console.log(
    `  ${r.game_id.padEnd(8)} ${r.source.padEnd(22)}  ` +
    `cat=${r.category.padEnd(15)}  status=${r.status.padEnd(8)}  ` +
    `src_age=${r.source_age_hours ?? '-'}h  ing_age=${r.ingest_age_hours ?? '-'}h  today=${r.today_daily_rows ?? '-'}  ` +
    `pct=${r.pct_changed_today_vs_yday ?? '-'}`,
  );
  if (r.reasons.length > 0) for (const rn of r.reasons) console.log(`      ${rn}`);
}
console.log(`\noverall_status = ${overallStatus(results)}`);

console.log('\n=== orphaned tcg_ingest_runs (>1h, running, finished_at NULL) ===\n');
const cutoff = new Date(Date.now() - 60*60*1000).toISOString();
const { data: orphans } = await sb.from('tcg_ingest_runs').select('id, game_id, resource, started_at').eq('status','running').is('finished_at', null).lt('started_at', cutoff).order('started_at', {ascending:true});
if (!orphans || orphans.length===0) console.log('  (none)');
else for (const r of orphans) {
  const age = Math.round((Date.now() - Date.parse(r.started_at))/3600_000);
  console.log(`  ${r.game_id.padEnd(8)} ${r.resource.padEnd(12)}  age=${age}h  id=${r.id}`);
}

console.log('\n=== health_source_state ===\n');
const { data: state } = await sb.from('health_source_state').select('*').order('game_id').order('source');
if (!state || state.length===0) console.log('  (empty — cron has not fired yet)');
else for (const s of state) console.log(`  ${s.game_id.padEnd(8)} ${s.source.padEnd(22)}  status=${(s.status||'').padEnd(9)}  cat=${(s.category||'').padEnd(15)}  since=${s.since}`);

console.log('\n=== health_alert_log (last 5) ===\n');
const { data: alerts } = await sb.from('health_alert_log').select('*').order('transitioned_at',{ascending:false}).limit(5);
if (!alerts || alerts.length===0) console.log('  (empty)');
else for (const a of alerts) console.log(`  ${a.transitioned_at}  ${a.game_id}/${a.source}  ${a.from_status ?? '(new)'} -> ${a.to_status}  ${a.to_category}`);
