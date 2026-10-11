/**
 * doc 81 Đợt 8 final wave — maker-checker of real safety-PLC configs on the REAL `_test` DB:
 *   • N-R7 — the FIRST approver may REJECT (a rejection only removes trust); the second APPROVAL still needs another admin;
 *     an editor still cannot decide at all;
 *   • F2 — the trust list carries the whole TARGET the digest covers (robot / station / line / factory / scope / corporate);
 *   • F5 — the list's separation-of-duties audit lookup is BATCHED: a constant number of queries per viewer, whatever the
 *     number of configs, with the same verdicts as the per-config lookup.
 * Rows are this run's own (code prefix RUN); `safety_plc_configs` is shared with files running in parallel (configs are
 * created DISABLED so parallel preflight tests are not affected).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });
process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";

import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import { plcTrustDigest, savePlcConfig, decidePlcConfigTrust, listPlcTrust, isPlcConfigTrustApproved, PLC_CONFIG_AUDIT_ENTITY } from "./safetyPlcTrust";

const DB_URL = process.env.DATABASE_URL;
const RUN = `fwt${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const A = 962_101;
const B = 962_102;
const C = 962_103;
let sql: ReturnType<typeof postgres>;
let factory = 0;

const REAL = (over: Record<string, unknown> = {}) => ({
  code: `${RUN}-${Math.random().toString(36).slice(2, 7)}`,
  name: "final wave real PLC",
  vendor: "pilz" as const,
  backend: "modbus" as const,
  endpoint: "tcp://192.0.2.30:502",
  statusMap: { estop: { address: "coil:1" } },
  robotId: 5,
  enabled: false,
  ...over,
});
async function createAs(actor: number, over: Record<string, unknown> = {}): Promise<SafetyPlcConfig> {
  const r = await savePlcConfig(REAL({ factoryId: factory, ...over }) as never, actor, null);
  if (r.kind !== "ok") throw new Error(`create failed: ${r.kind}`);
  return r.value.config;
}
async function legacyInsert(): Promise<SafetyPlcConfig> {
  const code = `${RUN}-L${Math.random().toString(36).slice(2, 7)}`;
  const [r] = await sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", "robotId", enabled, "factoryId")
    VALUES (${code}, 'legacy', 'pilz', 'modbus', 'tcp://192.0.2.31:502', ${sql.json({ estop: { address: "coil:1" } } as never)}, 5, false, ${factory}) RETURNING id`;
  const { getDb } = await import("../../../db/connection");
  const { safetyPlcConfigs } = await import("../../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const [c] = await (await getDb())!.select().from(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, Number(r.id)));
  return c;
}
const rowFor = async (viewer: number, id: number) => (await listPlcTrust(null, { id: viewer, isAdmin: true })).find((x) => x.id === id)!;

describe.skipIf(!DB_URL)("doc 81 Đợt 8 final wave — maker-checker (real _test DB)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [f] = await sql`SELECT id FROM factories ORDER BY id LIMIT 1`;
    factory = Number(f?.id ?? 1);
  });
  afterAll(async () => {
    await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${RUN + "%"}`;
    await sql.end();
  });

  it("★ N-R7: the FIRST approver is offered Reject (not Approve) and may reject; the first approval is cleared, nothing trusted", async () => {
    const c = await legacyInsert();
    const dg = plcTrustDigest(c);
    expect((await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: dg }, B, null)).kind).toBe("first");
    expect(await rowFor(B, c.id)).toMatchObject({ state: "awaiting_second", mayDecide: false, mayReject: true, blockedBy: "first_approver" });
    expect(await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: dg }, B, null)).toEqual({ kind: "first_approver" });
    expect(await decidePlcConfigTrust({ id: c.id, decision: "reject", expectedDigest: dg, reason: "second look: wrong tag" }, B, null)).toEqual({ kind: "ok", digest: dg, decision: "reject" });
    const [t] = await sql`SELECT "firstApprovedBy", "approvedBy", "rejectedBy", "rejectedDigest" FROM safety_plc_config_trust WHERE "configId" = ${c.id}`;
    expect(t).toMatchObject({ firstApprovedBy: null, approvedBy: null, rejectedBy: B, rejectedDigest: dg });
    expect(await isPlcConfigTrustApproved(c)).toBe(false);
    expect((await rowFor(C, c.id)).state).toBe("rejected");
    const acts = await sql`SELECT action, "actorId" FROM control_audit_log WHERE "entityType" = ${PLC_CONFIG_AUDIT_ENTITY} AND "entityId" = ${String(c.id)} ORDER BY id`;
    expect(acts.map((a) => [a.action, Number(a.actorId)])).toEqual([["approve_first", B], ["reject", B]]);
  });

  it("N-R7: an EDITOR still can neither approve nor reject (self)", async () => {
    const c = await createAs(A);
    expect(await rowFor(A, c.id)).toMatchObject({ mayDecide: false, mayReject: false, blockedBy: "self" });
    expect(await decidePlcConfigTrust({ id: c.id, decision: "reject", expectedDigest: plcTrustDigest(c), reason: "mine" }, A, null)).toEqual({ kind: "self" });
  });

  it("★ F2: the list row carries the whole target (robot / station / line / factory / scope / corporate / enabled)", async () => {
    const c = await createAs(A, { stationId: null, lineId: null, scope: "factory", corporateCode: "CORP-FW" });
    expect(await rowFor(B, c.id)).toMatchObject({ robotId: 5, stationId: null, lineId: null, factoryId: factory, scope: "factory", corporateCode: "CORP-FW", enabled: false, trustUnavailable: null });
  });

  it("★ F5: verdicts across many configs match the audit trail, with a CONSTANT number of queries per viewer", async () => {
    const c1 = await createAs(A);
    const c2 = await createAs(A);
    const c3 = await createAs(C);
    // c1: approved by B after A's create, then edited by C ⇒ A is no longer an author since the last approval, C is
    expect((await decidePlcConfigTrust({ id: c1.id, decision: "approve", expectedDigest: plcTrustDigest(c1) }, B, null)).kind).toBe("ok");
    const e1 = await savePlcConfig({ ...REAL({ factoryId: factory }), code: c1.code, name: "edited by C", id: c1.id } as never, C, null);
    expect(e1.kind).toBe("ok");
    const { getDb } = await import("../../../db/connection");
    const d = (await getDb())!;
    const spy = vi.spyOn(d, "select");
    try {
      const forA = await listPlcTrust(null, { id: A, isAdmin: true });
      const n = spy.mock.calls.length;
      expect(n).toBeLessThanOrEqual(4); // configs + trust rows + 2 grouped audit queries — not 2 per config
      const by = (id: number) => forA.find((x) => x.id === id)!;
      expect(by(c1.id)).toMatchObject({ mayDecide: true, blockedBy: null });
      expect(by(c2.id)).toMatchObject({ mayDecide: false, blockedBy: "self" });
      expect(by(c3.id)).toMatchObject({ mayDecide: true, blockedBy: null });
      spy.mockClear();
      const forC = await listPlcTrust(null, { id: C, isAdmin: true });
      expect(spy.mock.calls.length).toBe(n);
      expect(forC.find((x) => x.id === c1.id)).toMatchObject({ mayDecide: false, blockedBy: "self" });
      expect(forC.find((x) => x.id === c3.id)).toMatchObject({ mayDecide: false, blockedBy: "self" });
      expect(forC.find((x) => x.id === c2.id)).toMatchObject({ mayDecide: true, blockedBy: null });
    } finally {
      spy.mockRestore();
    }
  });
});
