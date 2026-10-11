/**
 * doc 81 Đợt 8 task N fix scan 2 (R-8-b) — the REAL heartbeat store on the _test DB and the safety.sourceHealth panel:
 *   • claimAlarm is a cluster-wide compare-and-set (two claims of one episode ⇒ exactly one true; a new episode ⇒ true);
 *   • the heartbeat round-trips; an OLD heartbeat makes sourceHealth.plcPoller "stale" (never "ok"); fresh ⇒ "ok";
 *   • configs of other factories are only counted (scope), no endpoint is ever part of the panel.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import { pgPollerHealthStore, SAFETY_PLC_HEARTBEAT_KEY, SAFETY_PLC_STALE_ALARM_KEY_PREFIX, SAFETY_PLC_HEARTBEAT_STALE_MS, type PollerHeartbeat } from "./safetyPlcPollerHealth";

vi.setConfig({ testTimeout: 60_000 });
const DB_URL = process.env.DATABASE_URL;
const RUN = `s2${Date.now().toString(36)}`;
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let sql: ReturnType<typeof postgres>;

describe.skipIf(!DB_URL)("fix scan 2 — real heartbeat store + sourceHealth.plcPoller (_test)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { SAFETY_PLC_POLLER_ENABLED: "true", SAFETY_PLC_ADAPTER_ENABLED: "true", SAFETY_AUDIT_ENABLED: "true" });
  });
  afterAll(async () => {
    await sql`DELETE FROM system_settings WHERE "settingKey" = ${SAFETY_PLC_HEARTBEAT_KEY} OR "settingKey" LIKE ${SAFETY_PLC_STALE_ALARM_KEY_PREFIX + RUN + "%"}`;
    await sql.end();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("★ claimAlarm: one winner per (scope, episode), cluster-wide; a new episode is claimable again", async () => {
    const a = pgPollerHealthStore();
    const b = pgPollerHealthStore();
    const scope = `${RUN}:global`;
    const r = await Promise.all([a.claimAlarm(scope, "hb:1"), b.claimAlarm(scope, "hb:1")]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await a.claimAlarm(scope, "hb:1")).toBe(false);
    expect(await b.claimAlarm(scope, "hb:2")).toBe(true);
  });

  async function panel() {
    const { loadSafetySourceHealth } = await import("../safetySourceHealth");
    return (await loadSafetySourceHealth({ userId: undefined, userRole: undefined })).plcPoller;
  }
  const hb = (at: number, factoryId: number | null = null): PollerHeartbeat => ({
    v: 1, at, instance: "t",
    configs: [{ id: 999_001, code: `${RUN}-C`, factoryId, intervalMs: 1000, since: at - 10_000, lastAttemptAt: at - 500, lastOkAt: at - 500, link: "online" }],
  });

  it("★ heartbeat round-trip; FRESH ⇒ 'ok'; OLD ⇒ 'stale' (never 'ok'); no endpoint anywhere in the panel", async () => {
    const st = pgPollerHealthStore();
    await st.writeHeartbeat(hb(Date.now()));
    expect((await st.readHeartbeat()) as PollerHeartbeat).toMatchObject({ v: 1, configs: [expect.objectContaining({ code: `${RUN}-C` })] });
    const ok = await panel();
    expect(ok).toMatchObject({ state: "ok", leaderAlive: true, staleConfigs: 0 });
    expect(ok.configs.map((c) => c.code)).toContain(`${RUN}-C`);
    await st.writeHeartbeat(hb(Date.now() - SAFETY_PLC_HEARTBEAT_STALE_MS - 5_000));
    const stale = await panel();
    expect(stale.state).toBe("stale");
    expect(stale.leaderAlive).toBe(false);
    expect(stale.configs.find((c) => c.code === `${RUN}-C`)?.stale).toBe(true);
    expect(JSON.stringify(stale)).not.toMatch(/tcp:\/\/|opc\.tcp|\d+\.\d+\.\d+\.\d+/);
  });

  it("no heartbeat row ⇒ 'stale' (no instance polls); poller flag off ⇒ 'off'", async () => {
    await sql`DELETE FROM system_settings WHERE "settingKey" = ${SAFETY_PLC_HEARTBEAT_KEY}`;
    expect((await panel()).state).toBe("stale");
    process.env.SAFETY_PLC_POLLER_ENABLED = "false";
    expect((await panel()).state).toBe("off");
    process.env.SAFETY_PLC_POLLER_ENABLED = "true";
  });

  it("a garbled heartbeat ⇒ 'unknown' (undecidable is never 'ok')", async () => {
    await sql`INSERT INTO system_settings ("settingKey", "settingValue") VALUES (${SAFETY_PLC_HEARTBEAT_KEY}, '{not json')
              ON CONFLICT ("settingKey") DO UPDATE SET "settingValue" = EXCLUDED."settingValue"`;
    expect((await panel()).state).toBe("unknown");
    expect(await pgPollerHealthStore().readHeartbeat()).toBe("error"); // the store itself says "cannot read", not "none"
  });
});
