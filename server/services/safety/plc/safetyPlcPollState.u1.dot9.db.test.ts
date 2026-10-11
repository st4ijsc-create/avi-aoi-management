/**
 * doc 81 Đợt 9 U1/U2 — the read mode of each config is DURABLE (safety_plc_poll_state.readMode, migration 0371) and reaches
 * safety.sourceHealth (what the Safety page shows: "polling (short presses may be missed)"), on the real _test DB:
 *   • the pg store writes / reads it; a mode outside the known set is stored as NULL (never invented; the column CHECK
 *     refuses it anyway);
 *   • the panel row of an enabled config carries the mode.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import { pgPollStateStore } from "./safetyPlcPollerHealth";

vi.setConfig({ testTimeout: 60_000 });
const DB_URL = process.env.DATABASE_URL;
const RUN = `u1m${Date.now().toString(36)}`;
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let sql: ReturnType<typeof postgres>;
let cfgId = 0;

describe.skipIf(!DB_URL)("Đợt 9 U1/U2 — durable read mode (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [c] = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'safety_plc_poll_state' AND column_name = 'readMode'`;
    expect(c.n, "apply 0371 to _test first: node scripts/apply-migration-0371.mjs --test-only").toBe(1);
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { SAFETY_PLC_POLLER_ENABLED: "true", SAFETY_PLC_ADAPTER_ENABLED: "true", SAFETY_AUDIT_ENABLED: "true" });
    // a SIM config (enabled): parallel preflight tests read this shared table — a sim row never changes their verdict
    const [r] = await sql`INSERT INTO safety_plc_configs (code, name, backend, endpoint, "statusMap", enabled)
      VALUES (${RUN + "-P"}, 'u1 mode', 'sim', NULL, ${sql.json({ simScript: [] } as never)}, true) RETURNING id`;
    cfgId = Number(r.id);
  });
  afterAll(async () => {
    await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${RUN + "%"}`;
    await sql.end();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const row = (readMode: unknown) => ({ configId: cfgId, link: "online" as const, flags: {}, intervalMs: 1000, lastAttemptAt: Date.now(), lastOkAt: Date.now(), unrecordedSince: null, unrecordedCount: 0, readMode: readMode as string });
  const panel = async () => {
    const { loadSafetySourceHealth } = await import("../safetySourceHealth");
    return (await loadSafetySourceHealth({ userId: undefined, userRole: undefined })).plcPoller.configs.find((c) => c.code === `${RUN}-P`);
  };

  it("★ every known mode round-trips (store ⇒ DB ⇒ listAt ⇒ Safety panel row)", async () => {
    const st = pgPollStateStore();
    for (const m of ["subscription", "poll_fallback", "poll", "poll_latch", "sim"]) {
      await st.save(row(m));
      const [raw] = await sql`SELECT "readMode" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`;
      expect(raw.readMode).toBe(m);
      expect((await st.listAt!()).rows.find((r) => r.configId === cfgId)?.readMode).toBe(m);
      expect(await panel()).toMatchObject({ readMode: m });
    }
  });

  it("an unknown mode is stored as NULL (never invented); the column CHECK refuses it on a raw write", async () => {
    await pgPollStateStore().save(row("magic"));
    const [raw] = await sql`SELECT "readMode" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`;
    expect(raw.readMode).toBeNull();
    expect(await panel()).toMatchObject({ readMode: null });
    await expect(sql`UPDATE safety_plc_poll_state SET "readMode" = 'magic' WHERE "configId" = ${cfgId}`).rejects.toMatchObject({ code: "23514" });
  });
});
