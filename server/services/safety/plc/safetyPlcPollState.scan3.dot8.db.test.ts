/**
 * doc 81 Đợt 8 task N fix scan 3 (R-8-c) — on the REAL _test DB:
 *   • scan flag 2 (registry fan-out): a heartbeat FORGED in system_settings cannot make safety.sourceHealth report the
 *     poller healthy — health comes only from the dedicated safety_plc_poll_state rows (no router writes them);
 *   • scan flag 3 (absent ⇒ healthy): an ENABLED config the leader never wrote a row for is STALE in the panel;
 *   • the pg store round-trips the durable edge state and its stale-alarm CAS has exactly one winner per episode.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import { pgPollStateStore } from "./safetyPlcPollerHealth";

vi.setConfig({ testTimeout: 60_000 });
const DB_URL = process.env.DATABASE_URL;
const RUN = `s3${Date.now().toString(36)}`;
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let sql: ReturnType<typeof postgres>;
let cfgId = 0;

describe.skipIf(!DB_URL)("fix scan 3 — durable poll state (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { SAFETY_PLC_POLLER_ENABLED: "true", SAFETY_PLC_ADAPTER_ENABLED: "true", SAFETY_AUDIT_ENABLED: "true" });
    const [r] = await sql`INSERT INTO safety_plc_configs (code, name, backend, endpoint, "statusMap", enabled)
      VALUES (${RUN + "-P"}, 'scan3', 'sim', NULL, ${sql.json({ simScript: [] } as never)}, true) RETURNING id`;
    cfgId = Number(r.id);
  });
  afterAll(async () => {
    await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${RUN + "%"}`;
    await sql`DELETE FROM system_settings WHERE "settingKey" = 'safety.plcPoller.heartbeat'`;
    await sql.end();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  async function myPanelRow() {
    const { loadSafetySourceHealth } = await import("../safetySourceHealth");
    const p = (await loadSafetySourceHealth({ userId: undefined, userRole: undefined })).plcPoller;
    return { p, mine: p.configs.find((c) => c.code === `${RUN}-P`) };
  }

  it("★ flag 2: a FORGED fresh heartbeat in system_settings does not make the panel healthy; my config without a row is STALE (flag 3)", async () => {
    // an enabled SIM config: the panel judges it like any other, and it does not change parallel preflight tests (SIM never counts)
    const forged = { v: 1, at: Date.now(), instance: "forged", configs: [{ id: cfgId, code: `${RUN}-P`, factoryId: null, intervalMs: 1000, since: Date.now(), lastAttemptAt: Date.now(), lastOkAt: Date.now(), link: "online" }] };
    await sql`INSERT INTO system_settings ("settingKey", "settingValue") VALUES ('safety.plcPoller.heartbeat', ${JSON.stringify(forged)})
              ON CONFLICT ("settingKey") DO UPDATE SET "settingValue" = EXCLUDED."settingValue"`;
    const { p, mine } = await myPanelRow();
    expect(mine).toBeDefined();
    expect(mine!.stale).toBe(true);
    expect(p.state).toBe("stale");
  });

  it("the pg store round-trips the durable edge; a fresh row makes my config fresh in the panel", async () => {
    const st = pgPollStateStore();
    await st.save({ configId: cfgId, link: "online", flags: { estop: true }, intervalMs: 1000, lastAttemptAt: Date.now(), lastOkAt: Date.now() });
    expect(await st.load(cfgId)).toMatchObject({ configId: cfgId, link: "online", flags: { estop: true }, intervalMs: 1000 });
    expect((await myPanelRow()).mine).toMatchObject({ stale: false, link: "online" });
    await st.save({ configId: cfgId, link: "offline", flags: {}, intervalMs: 500, lastAttemptAt: Date.now(), lastOkAt: null });
    expect(await st.load(cfgId)).toMatchObject({ link: "offline", flags: {}, intervalMs: 500, lastOkAt: null }); // every field is overwritten
    expect((await st.load(cfgId))?.flags).toEqual({}); // toMatchObject({}) would accept stale flags
    await st.save({ configId: cfgId, link: "online", flags: { estop: true }, intervalMs: 1000, lastAttemptAt: Date.now(), lastOkAt: Date.now() });
    await st.save({ configId: cfgId, link: "online", flags: { estop: true }, intervalMs: 1000, lastAttemptAt: Date.now() - 300_000, lastOkAt: Date.now() - 300_000 });
    expect((await myPanelRow()).mine?.stale).toBe(true);
  });

  it("★ stale-alarm CAS: two concurrent claims of one episode ⇒ exactly one winner; a new episode ⇒ claimable", async () => {
    const a = pgPollStateStore();
    const b = pgPollStateStore();
    const r = await Promise.all([a.claimStaleAlarm(cfgId, "e1"), b.claimStaleAlarm(cfgId, "e1")]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await a.claimStaleAlarm(cfgId, "e1")).toBe(false);
    expect(await b.claimStaleAlarm(cfgId, "e2")).toBe(true);
    expect((await a.load(cfgId))?.flags).toEqual({ estop: true }); // a claim never touches the edge state
  });
});
