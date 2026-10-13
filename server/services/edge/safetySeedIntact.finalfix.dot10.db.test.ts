/**
 * doc 81 Đợt 10 final fix wave — I-6 (ruling R-10-br) on the REAL `_test` DB:
 *   • the F1 harness no longer disables EVERY untargeted safety-PLC row (it disabled other suites' fixture rows — measured:
 *     safetySimOnly.dot1c ×5 red); it touches exactly the seed SIM-SAFETY-PLC-1, through the seed guard;
 *   • the guard: a fixture's untargeted row stays enabled; two harnesses overlap ⇒ the seed is re-enabled only by the LAST one;
 *     the marker is gone afterwards;
 *   • CENSUS — when no harness is running (the exclusive seed lock is free) the seed is ENABLED and no marker is left behind
 *     (a crash between disable and restore would show here).
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { SEED_LOCK_KEY, SIM_SAFETY_SEED_CODE, acquireSeedGuard, seedMarkerFile } from "./__edgeSeedGuard.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const sql = onTest ? postgres(DB_URL, { max: 2, onnotice: () => {} }) : (null as never);
afterAll(async () => {
  if (onTest) await sql.end({ timeout: 5 });
});

describe("final fix wave I-6 — the harness never touches other suites' safety rows", () => {
  it("★ structural: the harness has no broad 'disable every untargeted row' UPDATE any more and goes through the seed guard", () => {
    const src = readFileSync(path.join(process.cwd(), "server/services/edge/__edgeE2eHarness.dot10.ts"), "utf8");
    expect(src).not.toMatch(/UPDATE safety_plc_configs SET enabled = false WHERE enabled AND "robotId" IS NULL/);
    expect(src).toMatch(/acquireSeedGuard\(DB_URL\)/);
    expect(src).toMatch(/seedGuard\.release\(\)/);
  });
});

describe.skipIf(!onTest)("final fix wave I-6 — the seed guard on _test", () => {
  it("★ a fixture's untargeted row stays enabled; overlapping guards re-enable the seed only at the LAST release; no marker left", async () => {
    const [seed] = await sql`SELECT id, enabled FROM safety_plc_configs WHERE code = ${SIM_SAFETY_SEED_CODE}`;
    if (!seed) return; // a DB without the seed: nothing to guard
    const [fx] = await sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, enabled, scope) VALUES (${`FFI6-${Date.now()}`}, 'I-6 fixture', 'generic', 'sim', true, 'sim') RETURNING id`;
    try {
      const a = await acquireSeedGuard(DB_URL);
      const b = await acquireSeedGuard(DB_URL);
      const state = async () => Object.fromEntries((await sql`SELECT id, enabled FROM safety_plc_configs WHERE id IN ${sql([seed.id, fx.id])}`).map((r) => [Number(r.id), r.enabled]));
      expect(await state()).toEqual({ [Number(seed.id)]: false, [Number(fx.id)]: true }); // only the seed
      expect(a.disabledIds).toContain(Number(seed.id));
      await a.release();
      expect((await state())[Number(seed.id)]).toBe(false); // b still running
      await b.release();
      expect((await state())[Number(seed.id)]).toBe(seed.enabled); // back to what it was
      expect(existsSync(seedMarkerFile(DB_URL))).toBe(false);
    } finally {
      await sql`DELETE FROM safety_plc_configs WHERE id = ${fx.id}`;
    }
  }, 60_000);

  it("★ CENSUS: no harness running ⇒ the seed is enabled and no marker is left behind", async () => {
    const conn = await sql.reserve();
    try {
      const [r] = await conn`SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS ok`;
      if (!r.ok) return; // an E2E harness is running right now — measured by its own teardown
      try {
        const rows = await conn`SELECT enabled FROM safety_plc_configs WHERE code = ${SIM_SAFETY_SEED_CODE}`;
        expect(existsSync(seedMarkerFile(DB_URL)), `leftover seed marker ${seedMarkerFile(DB_URL)} — a harness crashed between disable and restore`).toBe(false);
        for (const row of rows) expect(row.enabled, "SIM-SAFETY-PLC-1 left DISABLED on _test").toBe(true);
      } finally {
        await conn`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`;
      }
    } finally {
      conn.release();
    }
  });
});
