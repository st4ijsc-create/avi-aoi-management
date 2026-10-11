/**
 * doc 81 Đợt 8 final wave — the pg poll-state store on the REAL _test DB (migration 0368 incl. the final-wave columns):
 *   • N-R5 — times are stored on the DB clock (local time → age → db-now − age) and health is judged on the DB clock, so a
 *     writer whose clock is skewed cannot make a fresh config look stale (or the reverse) on another instance;
 *   • N-R1 — "unrecordedSince" round-trips; a config polled on time but with transitions unrecorded beyond the bound is STALE
 *     in safety.sourceHealth.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import { pgPollStateStore } from "./safetyPlcPollerHealth";

vi.setConfig({ testTimeout: 60_000 });
const DB_URL = process.env.DATABASE_URL;
const RUN = `fw${Date.now().toString(36)}`;
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let sql: ReturnType<typeof postgres>;
let cfgId = 0;

describe.skipIf(!DB_URL)("final wave — pg poll-state store (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { SAFETY_PLC_POLLER_ENABLED: "true", SAFETY_PLC_ADAPTER_ENABLED: "true", SAFETY_AUDIT_ENABLED: "true" });
    const [r] = await sql`INSERT INTO safety_plc_configs (code, name, backend, endpoint, "statusMap", enabled)
      VALUES (${RUN + "-P"}, 'finalwave', 'sim', NULL, ${sql.json({ simScript: [] } as never)}, true) RETURNING id`;
    cfgId = Number(r.id);
  });
  afterAll(async () => {
    await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${RUN + "%"}`;
    await sql.end();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
  });
  async function mine() {
    const { loadSafetySourceHealth } = await import("../safetySourceHealth");
    return (await loadSafetySourceHealth({ userId: undefined, userRole: undefined })).plcPoller.configs.find((c) => c.code === `${RUN}-P`);
  }
  async function dbNowMs() {
    const [r] = await sql`SELECT (extract(epoch from clock_timestamp()) * 1000)::bigint AS t`;
    return Number(r.t);
  }

  it("★ N-R5: a writer clock 1 h BEHIND writes 'just now' ⇒ stored on the DB clock ⇒ fresh in the panel (not stale)", async () => {
    const st = pgPollStateStore();
    const real = Date.now();
    const skewed = real - 3_600_000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(skewed);
    try {
      await st.save({ configId: cfgId, link: "online", flags: {}, intervalMs: 1000, lastAttemptAt: skewed, lastOkAt: skewed, unrecordedSince: null, unrecordedCount: 0 });
    } finally {
      spy.mockRestore();
    }
    const [row] = await sql`SELECT "lastAttemptAt" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`;
    expect(Math.abs(Number(row.lastAttemptAt) - (await dbNowMs()))).toBeLessThan(10_000);
    expect(await mine()).toMatchObject({ stale: false });
    // a READER whose clock is 1 h ahead still judges on the DB clock ⇒ fresh
    const ahead = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
    try {
      expect(await mine()).toMatchObject({ stale: false });
    } finally {
      ahead.mockRestore();
    }
  });

  it("N-R5: listAt returns the DB clock and the rows (same query)", async () => {
    const { rows, nowMs } = await pgPollStateStore().listAt!();
    expect(Math.abs(nowMs - (await dbNowMs()))).toBeLessThan(10_000);
    expect(rows.find((r) => r.configId === cfgId)).toBeDefined();
  });

  it("★ N-R1: polled on time but transitions unrecorded for 5 min ⇒ STALE in safety.sourceHealth; recorded ⇒ fresh again", async () => {
    const st = pgPollStateStore();
    const now = Date.now();
    await st.save({ configId: cfgId, link: "online", flags: { estop: true }, intervalMs: 1000, lastAttemptAt: now, lastOkAt: now, unrecordedSince: now - 300_000, unrecordedCount: 4 });
    const r = await st.load(cfgId);
    expect(r).toBeDefined();
    const [raw] = await sql`SELECT "unrecordedSince", "unrecordedCount" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`;
    expect(Number(raw.unrecordedCount)).toBe(4);
    expect(Math.abs((await dbNowMs()) - Number(raw.unrecordedSince) - 300_000)).toBeLessThan(10_000);
    expect(await mine()).toMatchObject({ stale: true });
    await st.save({ configId: cfgId, link: "online", flags: { estop: true }, intervalMs: 1000, lastAttemptAt: Date.now(), lastOkAt: Date.now(), unrecordedSince: null, unrecordedCount: 0 });
    expect(await mine()).toMatchObject({ stale: false });
  });
});
