/**
 * doc 48 R4 — ingest COPY unblock PROOF (live, real DB, via ingestTelemetry —
 * the same persist path the /api/ot/ingest route uses).
 *
 * Proves the decisive win: the parameterised INSERT path CANNOT persist a batch
 * ≥ ~5957 rows (11 cols × N > 65534 bind-param ceiling) — it throws and the batch
 * lands 0 rows; the COPY path streams the same 8000-row batch in one statement and
 * persists all of it, while preserving ON CONFLICT dedup on the real hypertable.
 *
 * Cleans up its COPYTEST-* rows. Run: npx tsx scripts/verify/ingest-copy-proof.ts
 */
import "dotenv/config";
import { ingestTelemetry, type CanonicalSample } from "../../server/services/telemetryBus";
import { getDb } from "../../server/db/connection";
import { sql } from "drizzle-orm";

// 7000 DENSE rows (all 11 columns set → 11 bind-params/row → 77,000 > the 65,534
// ceiling) so the parameterised INSERT genuinely overflows, isolating the COPY win.
const N = 7000;
const BASE = Date.parse("2026-07-13T09:00:00.000Z");

function batch(tag: string): CanonicalSample[] {
  const out: CanonicalSample[] = [];
  for (let i = 0; i < N; i++) {
    out.push({
      ts: new Date(BASE + i),
      machineId: null,
      deviceId: `COPYTEST-${tag}-${i}`,
      protocol: "opcua",
      metric: "m",
      value: i,
      unit: "u",
      quality: "good",
      meta: { i, bench: true }, // ensures the meta column is bound (dense row)
    });
  }
  return out;
}

async function count(db: any, tag: string): Promise<number> {
  const like = `COPYTEST-${tag}-%`;
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM ot_telemetry WHERE "deviceId" LIKE ${like}`);
  return (r as unknown as any[])[0]?.n ?? 0;
}

let pass = true;
const c = (n: string, ok: boolean) => { if (!ok) pass = false; console.log(`  ${ok ? "✓" : "✗ FAIL"} ${n}`); };

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.execute(sql`DELETE FROM ot_telemetry WHERE "deviceId" LIKE 'COPYTEST-%'`);

  try {
    console.log(`=== INSERT path (COPY OFF): ${N} dense rows — expected to exceed the param ceiling ===`);
    delete process.env.OT_INGEST_COPY_ENABLED;
    process.env.OT_STORE_FORWARD_ENABLED = "false"; // isolate: no buffer/backfill cross-talk
    await ingestTelemetry(batch("INS"));
    const insertPersisted = await count(db, "INS");
    console.log(`    rows persisted by INSERT path: ${insertPersisted} / ${N}`);
    c(`INSERT path cannot persist ${N} dense rows (0 landed)`, insertPersisted === 0);

    console.log(`\n=== COPY path (COPY ON): ${N} dense rows (distinct tag) — expected to persist all ===`);
    process.env.OT_INGEST_COPY_ENABLED = "true";
    process.env.OT_INGEST_COPY_MIN_ROWS = "200";
    await ingestTelemetry(batch("CPY"));
    const copyPersisted = await count(db, "CPY");
    console.log(`    rows persisted by COPY path: ${copyPersisted} / ${N}`);
    c(`COPY path persists all ${N} rows`, copyPersisted === N);

    console.log(`\n=== dedup on real hypertable: re-ingest the COPY batch → 0 new ===`);
    await ingestTelemetry(batch("CPY"));
    const afterDup = await count(db, "CPY");
    console.log(`    COPY-tag rows after duplicate re-ingest: ${afterDup} (want ${N})`);
    c("COPY path dedups a full replay (ON CONFLICT DO NOTHING)", afterDup === N);

    console.log(`\nRESULT: ${pass ? "PASS ✓ — COPY unblocks >5957-row batches the INSERT path cannot; dedup preserved" : "FAIL ✗"}`);
  } finally {
    await db.execute(sql`DELETE FROM ot_telemetry WHERE "deviceId" LIKE 'COPYTEST-%'`);
    console.log("[cleanup] removed COPYTEST-* rows");
  }
  setTimeout(() => process.exit(pass ? 0 : 1), 200);
}

main().catch((e) => { console.error("proof error:", e); process.exit(2); });
