/**
 * doc 81 Đợt 9 final wave — the DISPLAY reason of an offline link ("heartbeat_stale", 0371 extended) round-trips on the real
 * _test DB: the pg store writes it with an OFFLINE row, never with an online one (stored NULL), refuses an unknown value (NULL —
 * and the column CHECK refuses it anyway), and the Safety panel row carries it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});
import { pgPollStateStore } from "./safetyPlcPollerHealth";

vi.setConfig({ testTimeout: 60_000 });
const DB_URL = process.env.DATABASE_URL;
const RUN = `fwbr${Date.now().toString(36)}`;
const ENV = ["SAFETY_PLC_POLLER_ENABLED", "SAFETY_PLC_ADAPTER_ENABLED", "SAFETY_AUDIT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let sql: ReturnType<typeof postgres>;
let cfgId = 0;

describe.skipIf(!DB_URL)("final wave — durable 'heartbeat stale' display reason (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [c] = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'safety_plc_poll_state' AND column_name = 'blindReason'`;
    expect(c.n, "apply 0371 to _test first: node scripts/apply-migration-0371.mjs --test-only").toBe(1);
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { SAFETY_PLC_POLLER_ENABLED: "true", SAFETY_PLC_ADAPTER_ENABLED: "true", SAFETY_AUDIT_ENABLED: "true" });
    // a SIM config (enabled): parallel preflight tests read this shared table — a sim row never changes their verdict
    const [r] = await sql`INSERT INTO safety_plc_configs (code, name, backend, endpoint, "statusMap", enabled)
      VALUES (${RUN + "-P"}, 'fw blind', 'sim', NULL, ${sql.json({ simScript: [] } as never)}, true) RETURNING id`;
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
  const row = (link: "online" | "offline", blindReason: unknown) => ({ configId: cfgId, link, flags: {}, intervalMs: 1000, lastAttemptAt: Date.now(), lastOkAt: Date.now(), unrecordedSince: null, unrecordedCount: 0, readMode: "sim", blindReason: blindReason as "heartbeat_stale" });
  const raw = async () => (await sql`SELECT "blindReason" FROM safety_plc_poll_state WHERE "configId" = ${cfgId}`)[0].blindReason;
  const panel = async () => {
    const { loadSafetySourceHealth } = await import("../safetySourceHealth");
    return (await loadSafetySourceHealth({ userId: undefined, userRole: undefined })).plcPoller.configs.find((c) => c.code === `${RUN}-P`);
  };

  it("★ offline + heartbeat_stale ⇒ stored, listed, on the panel row; back online ⇒ NULL; an unknown value ⇒ NULL", async () => {
    const st = pgPollStateStore();
    await st.save(row("offline", "heartbeat_stale"));
    expect(await raw()).toBe("heartbeat_stale");
    expect((await st.listAt!()).rows.find((r) => r.configId === cfgId)?.blindReason).toBe("heartbeat_stale");
    expect(await panel()).toMatchObject({ link: "offline", blindReason: "heartbeat_stale" });
    await st.save(row("online", "heartbeat_stale")); // a leftover reason on an online row is never stored
    expect(await raw()).toBeNull();
    expect(await panel()).toMatchObject({ link: "online", blindReason: null });
    await st.save(row("offline", "magic"));
    expect(await raw()).toBeNull();
  });

  it("the column CHECK refuses an unknown reason (23514)", async () => {
    const code = await sql`UPDATE safety_plc_poll_state SET "blindReason" = 'magic' WHERE "configId" = ${cfgId}`.then(
      () => null,
      (e: { code?: string }) => e?.code ?? "?",
    );
    expect(code).toBe("23514");
  });
});
