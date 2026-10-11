/**
 * doc 81 Đợt 9 task U2 — the maker-checker approval digest COVERS the e-stop latch tag (real _test DB, migrations 0368 + 0371):
 *   • a config WITHOUT a latch keeps exactly the Đợt 8 digest (existing approvals stay valid) — oracle: the v1 material
 *     written out here by hand, hashed with node:crypto;
 *   • adding / changing / removing the latch changes the digest ⇒ the approval in force no longer matches ⇒ not trusted
 *     until a second person approves again (through the real audited save path, which also clears the approval);
 *   • the approver's review list shows the latch tag (admins only).
 * Rows are this run's own (code prefix RUN); configs are DISABLED (the shared table is read by parallel preflight tests).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { createHash } from "node:crypto";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });
process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";

import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import { plcTrustDigest, savePlcConfig, decidePlcConfigTrust, isPlcConfigTrustApproved, listPlcTrust } from "./safetyPlcTrust";

const DB_URL = process.env.DATABASE_URL;
const RUN = `u2t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const A = 962_101; // maker
const B = 962_102; // checker
let sql: ReturnType<typeof postgres>;

const BASE_MAP = { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2", activeWhen: "falsy" as const } };
const REAL = (over: Record<string, unknown> = {}) => ({
  code: `${RUN}-${Math.random().toString(36).slice(2, 7)}`,
  name: "U2 latch digest",
  vendor: "pilz" as const,
  backend: "modbus" as const,
  endpoint: "tcp://192.0.2.20:502",
  statusMap: BASE_MAP,
  robotId: 5,
  enabled: false,
  ...over,
});
async function cfgRow(id: number): Promise<SafetyPlcConfig> {
  const { getDb } = await import("../../../db/connection");
  const { safetyPlcConfigs } = await import("../../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [r] = await (await getDb())!.select().from(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, id));
  return r;
}

describe.skipIf(!DB_URL)("Đợt 9 U2 — the approval digest covers the e-stop latch tag (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [t] = await sql`SELECT to_regclass('public.safety_plc_config_trust') IS NOT NULL AS ok`;
    expect(t.ok).toBe(true);
  });
  afterAll(async () => {
    await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${RUN + "%"}`;
    await sql.end();
  });

  it("★ no latch ⇒ the Đợt 8 (v1) digest, byte for byte (existing approvals keep matching)", () => {
    const cfg = { backend: "modbus", endpoint: "tcp://192.0.2.20:502", statusMap: BASE_MAP, robotId: 5, stationId: null, lineId: null, factoryId: null, scope: null, corporateCode: null, enabled: false } as never;
    const v1 = [
      "plc-trust-v1", "modbus", "tcp://192.0.2.20:502",
      [["estop", "coil:1", "bool", "truthy"], ["zoneOccupied", "coil:2", "bool", "falsy"], ["resetRequired", null, null, null], ["muting", null, null, null]],
      5, null, null, null, null, null, false,
    ];
    expect(plcTrustDigest(cfg)).toBe(createHash("sha256").update(JSON.stringify(v1)).digest("hex"));
  });

  it("★ latch added / changed / removed ⇒ a different digest each time", () => {
    const base = { backend: "modbus", endpoint: "e", statusMap: BASE_MAP, robotId: 5, stationId: null, lineId: null, factoryId: null, scope: null, corporateCode: null, enabled: true } as never as SafetyPlcConfig;
    const d0 = plcTrustDigest(base);
    const withLatch = (l: Record<string, unknown>) => plcTrustDigest({ ...base, statusMap: { ...BASE_MAP, estopLatch: l } } as never);
    const d1 = withLatch({ address: "coil:3" });
    const d2 = withLatch({ address: "coil:4" });
    const d3 = withLatch({ address: "coil:3", activeWhen: "falsy" });
    const d4 = withLatch({ address: "coil:3", dataType: "int" });
    expect(new Set([d0, d1, d2, d3, d4]).size).toBe(5);
    expect(withLatch({})).toBe(d0); // an empty latch ref (no address) = no latch
  });

  it("★ approved config + a latch added through the audited save path ⇒ approval cleared, not trusted; the checker sees the latch tag and approves again", async () => {
    const created = await savePlcConfig(REAL() as never, A, null);
    if (created.kind !== "ok") throw new Error("create failed");
    const id = created.value.config.id;
    const ok1 = await decidePlcConfigTrust({ id, decision: "approve", expectedDigest: plcTrustDigest(await cfgRow(id)) }, B, null);
    expect(ok1.kind).toBe("ok");
    expect(await isPlcConfigTrustApproved(await cfgRow(id))).toBe(true);

    const upd = await savePlcConfig({ ...REAL(), id, code: created.value.config.code, statusMap: { ...BASE_MAP, estopLatch: { address: "coil:3" } } } as never, A, null);
    expect(upd.kind).toBe("ok");
    const row = await cfgRow(id);
    expect((row.statusMap as Record<string, unknown>).estopLatch).toEqual({ address: "coil:3" });
    expect(await isPlcConfigTrustApproved(row)).toBe(false);

    const list = await listPlcTrust(null, { id: B, isAdmin: true });
    const mine = list.find((r) => r.id === id)!;
    expect(mine.tags).toContainEqual({ flag: "estopLatch", address: "coil:3", dataType: "bool", activeWhen: "truthy" });
    expect(mine.digest).toBe(plcTrustDigest(row));
    const ok2 = await decidePlcConfigTrust({ id, decision: "approve", expectedDigest: mine.digest }, B, null);
    expect(ok2.kind).toBe("ok");
    expect(await isPlcConfigTrustApproved(await cfgRow(id))).toBe(true);

    // a raw-SQL change of ONLY the latch address (outside the router) breaks the match ⇒ not trusted
    await sql`UPDATE safety_plc_configs SET "statusMap" = jsonb_set("statusMap", '{estopLatch,address}', '"coil:9"') WHERE id = ${id}`;
    expect(await isPlcConfigTrustApproved(await cfgRow(id))).toBe(false);
  });
});
