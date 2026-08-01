/**
 * doc 48 R4 — genealogy hash-chain fork-fix PROOF (A/B concurrency test).
 *
 * Fires N concurrent appends two ways and checks the tamper-evident chain:
 *   A) OLD path  = getLastGenealogyHash() then insertGenealogyChainRow()  — two
 *      unserialised statements → expected to FORK under concurrency (two rows
 *      sharing one prevHash).
 *   B) NEW path  = appendGenealogyChainRow()  — one tx + advisory lock → expected
 *      to stay LINEAR (every prevHash unique, every link resolves).
 *
 * A fork = two rows with the same prevHash (the chain branches, breaking
 * linear verification). Cleans up every test row afterwards (they are the tail,
 * so deletion just truncates back — safe in a quiescent dev DB).
 *
 * Run: npx tsx scripts/verify/genealogy-fork-proof.ts
 *
 * Tests as the REAL runtime DB role (DATABASE_URL from .env → avi_app), which is
 * how the app actually appends genealogy. avi_app has full DML on genealogy_chain
 * (only audit_logs/control_audit_log are WORM-restricted), so cleanup works.
 */
import "dotenv/config"; // load .env before server modules read DATABASE_URL (lazy getDb)
import * as db from "../../server/db";
import { hashEntry, GENESIS_HASH, type GenealogyInput } from "../../server/utils/genealogyChain";
import { getDb } from "../../server/db/connection";
import { genealogyChain } from "../../drizzle/schema";
import { like, sql } from "drizzle-orm";

const N = 40;

function evt(serial: string, i: number): GenealogyInput {
  return {
    serialNumber: serial,
    parentSerial: null,
    eventType: "station",
    stationCode: `S${i}`,
    lotCode: null,
    productModelId: null,
    payload: { kind: "forkproof", i },
    recordedAt: new Date(),
  };
}

/** OLD buggy path: read tail, then insert — race window between the two. */
async function oldAppend(serial: string, i: number) {
  const prevHash = (await db.getLastGenealogyHash()) ?? GENESIS_HASH;
  const eventInput = evt(serial, i);
  const currHash = hashEntry(prevHash, eventInput);
  return db.insertGenealogyChainRow({
    prevHash,
    currHash,
    serialNumber: serial,
    parentSerial: null,
    eventType: "station",
    stationCode: eventInput.stationCode ?? null,
    lotCode: null,
    productModelId: null,
    payload: eventInput.payload as Record<string, any>,
    recordedBy: null,
    recordedAt: eventInput.recordedAt,
  });
}

/** NEW fixed path: atomic tail-read + insert under advisory lock. */
async function newAppend(serial: string, i: number) {
  return db.appendGenealogyChainRow((prevHash) => {
    const eventInput = evt(serial, i);
    return {
      prevHash,
      currHash: hashEntry(prevHash, eventInput),
      serialNumber: serial,
      parentSerial: null,
      eventType: "station",
      stationCode: eventInput.stationCode ?? null,
      lotCode: null,
      productModelId: null,
      payload: eventInput.payload as Record<string, any>,
      recordedBy: null,
      recordedAt: eventInput.recordedAt,
    };
  });
}

async function forksAmong(serialPrefix: string): Promise<{ rows: number; forks: number; dupPrev: string[] }> {
  const d = await getDb();
  if (!d) throw new Error("no db");
  const rows = await d
    .select({ prevHash: genealogyChain.prevHash })
    .from(genealogyChain)
    .where(like(genealogyChain.serialNumber, `${serialPrefix}%`));
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.prevHash as string, (seen.get(r.prevHash as string) ?? 0) + 1);
  const dupPrev = [...seen.entries()].filter(([, c]) => c > 1).map(([h]) => h.slice(0, 12));
  return { rows: rows.length, forks: dupPrev.length, dupPrev };
}

async function cleanup(serialPrefix: string) {
  const d = await getDb();
  if (!d) return;
  await d.delete(genealogyChain).where(like(genealogyChain.serialNumber, `${serialPrefix}%`));
}

async function main() {
  const stamp = process.env.FORKPROOF_STAMP || "manual";
  const OLD = `FORKPROOF-OLD-${stamp}`;
  const NEW = `FORKPROOF-NEW-${stamp}`;

  // Pre-existing fork audit on the REAL chain (honest finding either way).
  const d = await getDb();
  const [{ dup }] = (await d!.execute(
    sql`SELECT count(*)::int AS dup FROM (SELECT "prevHash" FROM genealogy_chain GROUP BY "prevHash" HAVING count(*) > 1) f`,
  )) as unknown as { dup: number }[];
  console.log(`[pre] existing chain rows with a duplicated prevHash (forks in real data): ${dup}`);

  try {
    console.log(`\n[A] OLD path — ${N} concurrent unserialised appends…`);
    await Promise.all(Array.from({ length: N }, (_, i) => oldAppend(OLD, i)));
    const a = await forksAmong(OLD);
    console.log(`    rows=${a.rows} forks(dup prevHash)=${a.forks} ${a.dupPrev.length ? `e.g. ${a.dupPrev.slice(0, 4).join(",")}` : ""}`);

    console.log(`\n[B] NEW path — ${N} concurrent atomic appends…`);
    await Promise.all(Array.from({ length: N }, (_, i) => newAppend(NEW, i)));
    const b = await forksAmong(NEW);
    console.log(`    rows=${b.rows} forks(dup prevHash)=${b.forks} ${b.dupPrev.length ? `e.g. ${b.dupPrev.slice(0, 4).join(",")}` : ""}`);

    console.log(`\n=== VERDICT ===`);
    console.log(`OLD path forked: ${a.forks > 0 ? "YES ✗ (demonstrates the bug)" : "no (race did not trigger this run)"}`);
    console.log(`NEW path forked: ${b.forks > 0 ? "YES ✗ FIX FAILED" : "NO ✓ (chain stayed linear under concurrency)"}`);
    const pass = b.forks === 0 && b.rows === N;
    console.log(`RESULT: ${pass ? "PASS ✓" : "FAIL ✗"}`);
    process.exitCode = pass ? 0 : 1;
  } finally {
    await cleanup(OLD);
    await cleanup(NEW);
    console.log(`\n[cleanup] removed FORKPROOF-*-${stamp} test rows`);
  }
}

main().then(
  () => setTimeout(() => process.exit(process.exitCode ?? 0), 200),
  (e) => {
    console.error("proof error:", e);
    process.exit(2);
  },
);
