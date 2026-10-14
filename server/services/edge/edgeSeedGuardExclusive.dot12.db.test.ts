/**
 * doc 81 Đợt 12 final fix wave (ruling R-12-e open item b) — the shared `_test` seed SIM-SAFETY-PLC-1 and a suite that reads EVERY
 * enabled safety-PLC config (safetySimOnly.dot1c): while an F1 E2E harness runs (another session, the serial project) it disables
 * the seed and inserts a real, factory-scoped SPLC-* row, so the suite's "only SIM" cases saw no SIM row or the foreign real row and
 * changed verdict (×5 red in broad runs, never alone).
 *   • such a suite takes the seed lock EXCLUSIVELY (acquireSeedExclusive, bounded wait): no harness runs while it holds it — a harness
 *     holds the lock SHARED for its whole life, so the exclusive holder waits for it and a new harness waits for the holder;
 *   • the harness inserts its SPLC row only AFTER it holds the guard, so an exclusive holder never sees the foreign row.
 * `_test` only; the seed row itself is never touched here (the "harness" is a bare shared lock).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { SEED_LOCK_KEY, acquireSeedExclusive } from "./__edgeSeedGuard.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";

describe("R-12-e open item b — the harness inserts its safety-PLC row only after it holds the seed guard", () => {
  it("in __edgeE2eHarness.dot10.ts the INSERT INTO safety_plc_configs comes AFTER acquireSeedGuard(", () => {
    const src = readFileSync(path.join(__dirname, "__edgeE2eHarness.dot10.ts"), "utf8");
    const guard = src.indexOf("await acquireSeedGuard(");
    const insert = src.indexOf("INSERT INTO safety_plc_configs");
    expect(guard).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(guard);
  });
  it("★ R-12-f item 2: at teardown the harness deletes its own safety-PLC row(s) BEFORE it releases the seed lock (an exclusive holder that wins the lock next never sees them)", () => {
    const src = readFileSync(path.join(__dirname, "__edgeE2eHarness.dot10.ts"), "utf8");
    const t = src.indexOf("async teardown()");
    expect(t).toBeGreaterThan(0);
    const body = src.slice(t);
    const del = body.search(/removeHarnessPlcRows\(|DELETE FROM safety_plc_configs/);
    const rel = body.indexOf("seedGuard.release(");
    expect(del).toBeGreaterThan(0);
    expect(rel).toBeGreaterThan(0);
    expect(del).toBeLessThan(rel);
  });

  it("★ R-12-f item 3: safetySimOnly.dot1c waits for the seed lock for LESS than its hook timeout, and a lock won late (after the hook gave up) is released (abort + await the pending acquisition in afterAll)", () => {
    const src = readFileSync(path.join(__dirname, "../ot/safetySimOnly.dot1c.db.test.ts"), "utf8");
    const hook = Number(/hookTimeout:\s*([\d_]+)/.exec(src)?.[1]?.replace(/_/g, ""));
    const wait = Number(/const SEED_WAIT_MS\s*=\s*([\d_]+)/.exec(src)?.[1]?.replace(/_/g, ""));
    expect(hook).toBeGreaterThan(0);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(hook / 2); // the rest of beforeAll still fits
    expect(src).toMatch(/acquireSeedExclusive\(DB_URL!?, \{ waitMs: SEED_WAIT_MS, signal: seedAbort\.signal \}\)/);
    expect(src).toMatch(/seedAbort\.abort\(\)/);
    expect(src).toMatch(/await pendingSeed/);
  });

  it("safetySimOnly.dot1c takes the seed lock exclusively in beforeAll and releases it in afterAll", () => {
    const src = readFileSync(path.join(__dirname, "../ot/safetySimOnly.dot1c.db.test.ts"), "utf8");
    expect(src).toMatch(/acquireSeedExclusive\(/);
    expect(src).toMatch(/(seedExclusive|late)\??\.release\(\)/);
    expect(src).not.toMatch(/seed SIM-SAFETY-PLC-1 sạch luôn có mặt/); // the header no longer assumes the seed is always there
  });
});

describe.skipIf(!/_test\b/.test(DB_URL))("R-12-e open item b — acquireSeedExclusive on _test", () => {
  it("★ waits (bounded) while a harness holds the lock SHARED and is refused with a clear message; acquired once the harness ends; a harness then waits for it", async () => {
    const harness = postgres(DB_URL, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const other = postgres(DB_URL, { max: 1, connect_timeout: 30, onnotice: () => {} });
    try {
      await harness`SELECT pg_advisory_lock_shared(${SEED_LOCK_KEY})`;
      const t0 = Date.now();
      const refused = await acquireSeedExclusive(DB_URL, { waitMs: 300 }).then(
        () => null,
        (e: Error) => e,
      );
      expect(refused?.message).toMatch(/E2E harness|seed lock/i);
      expect(Date.now() - t0).toBeLessThan(10_000); // bounded
      // the harness ends while we wait: acquired
      const pending = acquireSeedExclusive(DB_URL, { waitMs: 10_000 });
      await new Promise((r) => setTimeout(r, 200));
      await harness`SELECT pg_advisory_unlock_shared(${SEED_LOCK_KEY})`;
      const g = await pending;
      // while it is held, a harness cannot take its shared lock
      const [x] = await other`SELECT pg_try_advisory_lock_shared(${SEED_LOCK_KEY}) AS ok`;
      expect(x.ok).toBe(false);
      await g.release();
      const [y] = await other`SELECT pg_try_advisory_lock_shared(${SEED_LOCK_KEY}) AS ok`;
      expect(y.ok).toBe(true);
      await other`SELECT pg_advisory_unlock_shared(${SEED_LOCK_KEY})`;
    } finally {
      await harness.end({ timeout: 5 });
      await other.end({ timeout: 5 });
    }
  }, 60_000);

  it("★ R-12-f item 3: an ABORTED acquisition stops waiting at once (code aborted), holds nothing; an already-aborted one never takes the lock even when it is free", async () => {
    const harness = postgres(DB_URL, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const other = postgres(DB_URL, { max: 1, connect_timeout: 30, onnotice: () => {} });
    try {
      await harness`SELECT pg_advisory_lock_shared(${SEED_LOCK_KEY})`;
      const ac = new AbortController();
      const t0 = Date.now();
      const p = acquireSeedExclusive(DB_URL, { waitMs: 20_000, signal: ac.signal }).then(
        () => null,
        (e: { code?: string }) => e,
      );
      await new Promise((r) => setTimeout(r, 300));
      ac.abort();
      const e = await p;
      expect(e?.code).toBe("aborted");
      expect(Date.now() - t0).toBeLessThan(3_000); // not the 20 s wait
      await harness`SELECT pg_advisory_unlock_shared(${SEED_LOCK_KEY})`;
      // the lock is free now: an already-aborted acquisition still takes nothing
      const pre = new AbortController();
      pre.abort();
      const e2 = await acquireSeedExclusive(DB_URL, { waitMs: 1_000, signal: pre.signal }).then(
        () => null,
        (x: { code?: string }) => x,
      );
      expect(e2?.code).toBe("aborted");
      const [x] = await other`SELECT pg_try_advisory_lock(${SEED_LOCK_KEY}) AS ok`; // nobody holds it
      expect(x.ok).toBe(true);
      await other`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`;
    } finally {
      await harness.end({ timeout: 5 });
      await other.end({ timeout: 5 });
    }
  }, 60_000);

  it("refuses outside a _test DB (never touches another database)", async () => {
    await expect(acquireSeedExclusive("postgres://u:p@127.0.0.1:1/aoi_management", { waitMs: 10 })).rejects.toThrow(/_test/);
  });
});
