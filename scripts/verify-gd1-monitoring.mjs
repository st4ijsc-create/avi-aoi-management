// scripts/verify-gd1-monitoring.mjs — Doc 54 §11 GĐ1 live verification (read-only).
//
// Proves the "kết nối → monitoring → cảnh báo" chain has live data, WITHOUT mutating
// anything. Run after seeding + enabling the Full-Sim telemetry emitter + presence.
//
//   node scripts/verify-gd1-monitoring.mjs
//
// Checks (each prints a ✓/✗ + the number that backs it):
//   1. Alert rules enabled           (mqtt_alert_rules where isEnabled)
//   2. Fresh OT telemetry            (ot_telemetry in last 10 min)   ← emitter/adapters
//   3. Machines marked online        (machine_status_logs recent)    ← presence sweep
//   4. Today's daily_statistics      (rollup / sim writer)
//   5. Recent OEE metrics            (oee_metrics last 2h)
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const out = [];
const check = (ok, label, detail) => { out.push({ ok, label, detail }); };

// tolerant COUNT: a missing table/column must not abort the whole report
async function safeCount(label, run) {
  try { return await run(); }
  catch (e) { check(false, label, `query error: ${e?.message || e}`); return null; }
}

async function main() {
  const r1 = await safeCount('Alert rules enabled', () =>
    sql`SELECT COUNT(*)::int AS n FROM mqtt_alert_rules WHERE "isEnabled" = true`);
  if (r1) check(r1[0].n > 0, 'Alert rules enabled', `${r1[0].n} rule(s) armed`);

  const r2 = await safeCount('Fresh OT telemetry (10m)', () =>
    sql`SELECT COUNT(*)::int AS n, COUNT(DISTINCT "machineId")::int AS m
        FROM ot_telemetry WHERE "ingestedAt" >= now() - interval '10 minutes'`);
  if (r2) check(r2[0].n > 0, 'Fresh OT telemetry (10m)',
    `${r2[0].n} row(s) from ${r2[0].m} machine(s) — 0 = emitter/adapters OFF or no data yet`);

  const r3 = await safeCount('Machines online (presence)', () =>
    sql`SELECT COUNT(*)::int AS n FROM machine_status_logs
        WHERE "timestamp" >= now() - interval '15 minutes' AND status = 'online'`);
  if (r3) check(r3[0].n > 0, 'Machines online (presence)',
    `${r3[0].n} recent online status log(s) — presence sweep result`);

  const r4 = await safeCount("Today's daily_statistics", () =>
    sql`SELECT COUNT(*)::int AS n, COALESCE(SUM("totalCount"),0)::int AS units
        FROM daily_statistics WHERE date = CURRENT_DATE`);
  if (r4) check(r4[0].n > 0, "Today's daily_statistics",
    `${r4[0].n} machine-row(s), ${r4[0].units} unit(s) counted today`);

  const r5 = await safeCount('Recent OEE metrics (2h)', () =>
    sql`SELECT COUNT(*)::int AS n FROM oee_metrics WHERE "createdAt" >= now() - interval '2 hours'`);
  if (r5) check(r5[0].n > 0, 'Recent OEE metrics (2h)', `${r5[0].n} metric row(s)`);

  console.log('\n=== GĐ1 monitoring live-verification ===');
  for (const c of out) console.log(`  ${c.ok ? '✓' : '✗'}  ${c.label.padEnd(30)} ${c.detail}`);
  const pass = out.filter((c) => c.ok).length;
  console.log(`\n  ${pass}/${out.length} checks green.\n`);
  if (pass < out.length) process.exitCode = 2; // non-fatal signal for CI
}

main()
  .catch((e) => { console.error('[verify-gd1] FAILED:', e?.message || e); process.exitCode = 1; })
  .finally(() => sql.end());
