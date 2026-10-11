/**
 * doc 81 Đợt 8 final wave — the pg poll-state store on the REAL _test DB (migration 0368 incl. the final-wave columns):
 *   • N-R5 — times are stored on the DB clock (local time → age → db-now − age) and health is judged on the DB clock, so a
 *     writer whose clock is skewed cannot make a fresh config look stale (or the reverse) on another instance;
 *   • N-R1 — "unrecordedSince" round-trips; a config polled on time but with transitions unrecorded beyond the bound is STALE
 *     in safety.sourceHealth;
 *   • N-R2 — the stale-alarm LEASE: claim → (record) → confirm; a released claim is claimable again; a confirmed episode never.
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

  it("★ NF-1/NF-2: a continuing wait keeps its FIRST stored 'unrecordedSince' across saves (even with a local clock step) ⇒ ONE episode, ONE alarm; a clear then a new wait starts fresh", async () => {
    const { runPollerWatchdogOnce } = await import("./safetyPlcPollerHealth");
    const st = pgPollStateStore();
    const since = Date.now() - 300_000; // the poller's (local) wait start: stuck for 5 min
    const save = async (unrec: number | null) =>
      st.save({ configId: cfgId, link: "online", flags: { estop: true }, intervalMs: 1000, lastAttemptAt: Date.now(), lastOkAt: Date.now(), unrecordedSince: unrec, unrecordedCount: unrec == null ? 0 : 2 });
    const stored = async () => Number((await sql`SELECT "unrecordedSince" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`)[0].unrecordedSince);
    await save(null);
    await save(since);
    const first = await stored();
    const alarms: string[] = [];
    const run = () =>
      runPollerWatchdogOnce({
        store: st,
        listConfigs: async () => [{ id: cfgId, code: `${RUN}-P`, factoryId: null }],
        record: async (i) => (alarms.push(String(i.notes)), { ok: true, enabled: true }),
        now: Date.now,
        enabled: () => true,
        startedAt: 0,
      });
    for (let k = 0; k < 6; k++) {
      await new Promise((r) => setTimeout(r, 7));
      if (k === 3) {
        const step = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 120_000); // the writer's clock steps BACK 2 min
        try {
          await save(since);
        } finally {
          step.mockRestore();
        }
      } else await save(since);
      expect(await stored()).toBe(first); // never re-stored (no drift, no step effect)
      await run();
    }
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatch(/NOT recorded/);
    await save(null); // everything recorded ⇒ cleared
    expect((await sql`SELECT "unrecordedSince" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`)[0].unrecordedSince).toBeNull();
    await save(Date.now() - 1000); // a NEW wait ⇒ a new value
    expect(Math.abs((await dbNowMs()) - (await stored()) - 1000)).toBeLessThan(10_000);
    await save(null);
  });

  it("★ N-R2 lease: claim ⇒ others refused; RELEASE ⇒ claimable again; CONFIRM ⇒ done for good; an expired lease is re-claimable", async () => {
    const a = pgPollStateStore();
    const b = pgPollStateStore();
    const ep = `${RUN}-e1`;
    expect(await a.claimStaleAlarm(cfgId, ep)).toBe(true);
    expect(await b.claimStaleAlarm(cfgId, ep)).toBe(false); // leased
    await a.releaseStaleAlarm(cfgId, ep); // the record failed
    expect(await b.claimStaleAlarm(cfgId, ep)).toBe(true); // retried by another instance
    await b.confirmStaleAlarm(cfgId, ep);
    const [done] = await sql`SELECT "staleAlarmEpisode" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`;
    expect(done.staleAlarmEpisode).toBe(ep);
    expect(await a.claimStaleAlarm(cfgId, ep)).toBe(false); // done
    await a.releaseStaleAlarm(cfgId, ep); // a late release never re-opens a DONE episode
    expect(await a.claimStaleAlarm(cfgId, ep)).toBe(false);
    // expired lease (holder died between claim and confirm) ⇒ re-claimable
    const ep2 = `${RUN}-e2`;
    expect(await a.claimStaleAlarm(cfgId, ep2)).toBe(true);
    await sql`UPDATE safety_plc_poll_state SET "staleAlarmClaimAt" = now() - interval '31 seconds' WHERE "configId" = ${cfgId}`;
    expect(await b.claimStaleAlarm(cfgId, ep2)).toBe(true);
    const [e] = await sql`SELECT link, flags FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`;
    expect(e).toMatchObject({ link: "online", flags: { estop: true } }); // the lease never touches the edge state
  });
});
