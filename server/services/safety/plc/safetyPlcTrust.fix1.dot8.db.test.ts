/**
 * doc 81 Đợt 8 task N fix 1 (owner decision I1) — MAKER-CHECKER of real safety-PLC configs, on the REAL `_test` DB
 * (migration 0368 applied with --test-only):
 *   • the digest covers exactly the trust-relevant content;
 *   • create / update / delete / approve / reject are audited (control_audit_log, same transaction);
 *   • a second person approves the digest they were shown; never the last editor / an author since the last approval;
 *   • any edit clears trust; an edit by another path (raw SQL) breaks the digest match;
 *   • by-id writes are scope-checked with NOT_FOUND parity (service + router);
 *   • approve / reject are admin-only.
 * Rows are this run's own (code prefix RUN); `safety_plc_configs` is shared with files running in parallel.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });
process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused"; // quiet sdk import (no call is made)

import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import {
  plcTrustDigest,
  savePlcConfig,
  deletePlcConfig,
  decidePlcConfigTrust,
  isPlcConfigTrustApproved,
  listPlcTrust,
  PLC_CONFIG_AUDIT_ENTITY,
} from "./safetyPlcTrust";

const DB_URL = process.env.DATABASE_URL;
const RUN = `n1x${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const A = 961_101; // maker
const B = 961_102; // second person
const C = 961_103; // another editor
let sql: ReturnType<typeof postgres>;
let factory = 0;
let otherFactory = 0;

const REAL = (over: Record<string, unknown> = {}) => ({
  code: `${RUN}-${Math.random().toString(36).slice(2, 7)}`,
  name: "N fix1 real PLC",
  vendor: "pilz" as const,
  backend: "modbus" as const,
  endpoint: "tcp://192.0.2.10:502",
  statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2", activeWhen: "falsy" as const } },
  robotId: 5,
  enabled: true,
  ...over,
});

async function audits(id: number) {
  return sql<Array<{ action: string; actorId: number | null; reason: string | null }>>`
    SELECT action, "actorId", reason FROM control_audit_log WHERE "entityType" = ${PLC_CONFIG_AUDIT_ENTITY} AND "entityId" = ${String(id)} ORDER BY id`;
}
async function cfgRow(id: number): Promise<SafetyPlcConfig> {
  const { getDb } = await import("../../../db/connection");
  const { safetyPlcConfigs } = await import("../../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const d = (await getDb())!;
  const [r] = await d.select().from(safetyPlcConfigs).where(eq(safetyPlcConfigs.id, id));
  return r;
}
async function createAs(actor: number, over: Record<string, unknown> = {}) {
  const r = await savePlcConfig(REAL({ factoryId: factory, ...over }) as never, actor, null);
  if (r.kind !== "ok") throw new Error("create failed");
  return r.value.config;
}

describe.skipIf(!DB_URL)("doc 81 Đợt 8 N fix 1 — safety-PLC config maker-checker (real _test DB)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [t] = await sql`SELECT to_regclass('public.safety_plc_config_trust') IS NOT NULL AS ok`;
    expect(t.ok, "apply 0368 to _test first: node scripts/apply-migration-0368.mjs --test-only").toBe(true);
    const [f] = await sql`SELECT id FROM factories ORDER BY id LIMIT 2`;
    const fs2 = await sql`SELECT id FROM factories ORDER BY id LIMIT 2`;
    factory = Number(f?.id ?? 1);
    otherFactory = Number(fs2[1]?.id ?? factory + 100000);
  });
  afterAll(async () => {
    await sql`DELETE FROM safety_plc_configs WHERE code LIKE ${RUN + "%"}`;
    await sql.end();
  });

  it("digest: changes with every trust-relevant field, not with name / notes / poll interval / sim script; defaults normalised", () => {
    const base = { ...REAL(), id: 1, robotId: 5, stationId: null, lineId: null, factoryId: 3, scope: null, corporateCode: null } as unknown as SafetyPlcConfig;
    const d0 = plcTrustDigest(base);
    expect(d0).toMatch(/^[0-9a-f]{64}$/);
    const same: Array<Partial<SafetyPlcConfig>> = [
      { name: "other" },
      { notes: "x" } as never,
      { code: "other" },
      { statusMap: { ...(base.statusMap as object), pollIntervalMs: 999, simScript: [{ estop: true }] } as never },
      { statusMap: { estop: { address: "coil:1", dataType: "bool", activeWhen: "truthy" }, zoneOccupied: { address: "coil:2", activeWhen: "falsy" } } as never },
    ];
    for (const o of same) expect(plcTrustDigest({ ...base, ...o } as SafetyPlcConfig), JSON.stringify(o)).toBe(d0);
    const diff: Array<Partial<SafetyPlcConfig>> = [
      { backend: "opcua" },
      { endpoint: "tcp://192.0.2.11:502" },
      { statusMap: { estop: { address: "coil:9" }, zoneOccupied: { address: "coil:2", activeWhen: "falsy" } } as never },
      { statusMap: { estop: { address: "coil:1", activeWhen: "falsy" }, zoneOccupied: { address: "coil:2", activeWhen: "falsy" } } as never },
      { statusMap: { estop: { address: "coil:1", dataType: "int" }, zoneOccupied: { address: "coil:2", activeWhen: "falsy" } } as never },
      { statusMap: { estop: { address: "coil:1" } } as never },
      { robotId: 6 },
      { stationId: 7 },
      { lineId: 8 },
      { factoryId: 4 },
      { scope: "factory" },
      { corporateCode: "C2" },
      { enabled: false },
    ];
    for (const o of diff) expect(plcTrustDigest({ ...base, ...o } as SafetyPlcConfig), JSON.stringify(o)).not.toBe(d0);
  });

  it("create is audited and leaves the config NOT approved (maker = creator)", async () => {
    const c = await createAs(A);
    expect((await audits(c.id)).map((a) => [a.action, a.actorId])).toEqual([["create", A]]);
    const [t] = await sql`SELECT "lastEditedBy", "approvedDigest" FROM safety_plc_config_trust WHERE "configId" = ${c.id}`;
    expect(t).toMatchObject({ lastEditedBy: A, approvedDigest: null });
    expect(await isPlcConfigTrustApproved(c)).toBe(false);
  });

  it("★ the maker cannot approve; a second person approves the digest shown; a wrong digest is 'stale'", async () => {
    const c = await createAs(A);
    const dg = plcTrustDigest(c);
    expect(await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: dg }, A, null)).toEqual({ kind: "self" });
    expect(await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: "0".repeat(64) }, B, null)).toEqual({ kind: "stale" });
    expect(await isPlcConfigTrustApproved(c)).toBe(false);
    expect(await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: dg }, B, null)).toEqual({ kind: "ok", digest: dg, decision: "approve" });
    expect(await isPlcConfigTrustApproved(await cfgRow(c.id))).toBe(true);
    expect((await audits(c.id)).map((a) => [a.action, a.actorId])).toEqual([["create", A], ["approve", B]]);
  });

  it("★ ANY edit clears trust (even one that keeps the digest); the editor then cannot approve; earlier authors can", async () => {
    const c = await createAs(A);
    await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(c) }, B, null);
    const r = await savePlcConfig({ ...REAL({ factoryId: factory }), id: c.id, code: c.code, name: "renamed only" } as never, C, null);
    expect(r.kind).toBe("ok");
    const after = await cfgRow(c.id);
    expect(plcTrustDigest(after)).toBe(plcTrustDigest(c)); // same trust content …
    expect(await isPlcConfigTrustApproved(after)).toBe(false); // … but the edit cleared the approval
    expect(await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(after) }, C, null)).toEqual({ kind: "self" });
    // A authored BEFORE the last approval ⇒ may approve C's edit
    expect((await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(after) }, A, null)).kind).toBe("ok");
    expect((await audits(c.id)).map((a) => a.action)).toEqual(["create", "approve", "update", "approve"]);
  });

  it("an author since the last approval (not the LAST editor) still cannot approve (SoD on the audit trail)", async () => {
    const c = await createAs(A);
    await savePlcConfig({ ...REAL({ factoryId: factory }), id: c.id, code: c.code, endpoint: "tcp://192.0.2.12:502" } as never, C, null);
    const cur = await cfgRow(c.id);
    expect(await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(cur) }, A, null)).toEqual({ kind: "self" });
    expect((await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(cur) }, B, null)).kind).toBe("ok");
  });

  it("an edit by another path (raw SQL) ⇒ the approved digest no longer matches ⇒ not trusted", async () => {
    const c = await createAs(A);
    await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(c) }, B, null);
    expect(await isPlcConfigTrustApproved(await cfgRow(c.id))).toBe(true);
    await sql`UPDATE safety_plc_configs SET endpoint = 'tcp://203.0.113.9:502' WHERE id = ${c.id}`;
    expect(await isPlcConfigTrustApproved(await cfgRow(c.id))).toBe(false);
  });

  it("reject: audited with its reason, state 'rejected', not trusted; the DB itself refuses approver = last editor", async () => {
    const c = await createAs(A);
    const r = await decidePlcConfigTrust({ id: c.id, decision: "reject", expectedDigest: plcTrustDigest(c), reason: "endpoint is not the PNOZ" }, B, null);
    expect(r.kind).toBe("ok");
    expect((await audits(c.id)).at(-1)).toMatchObject({ action: "reject", actorId: B, reason: "endpoint is not the PNOZ" });
    expect(await isPlcConfigTrustApproved(c)).toBe(false);
    const rows = await listPlcTrust(null, { id: B, isAdmin: true });
    expect(rows.find((x) => x.id === c.id)?.state).toBe("rejected");
    const err = await sql`UPDATE safety_plc_config_trust SET "approvedBy" = ${A}, "approvedDigest" = 'x' WHERE "configId" = ${c.id}`.catch((e) => e);
    expect(err?.code).toBe("23514");
  });

  it("the approval lookup failing (here: an id the DB rejects) ⇒ NOT approved (fail closed for trust)", async () => {
    const c = await createAs(A);
    await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(c) }, B, null);
    expect(await isPlcConfigTrustApproved(c)).toBe(true);
    expect(await isPlcConfigTrustApproved({ ...c, id: Number.NaN })).toBe(false);
  });

  it("a sim config can never be approved", async () => {
    const c = await createAs(A, { backend: "sim", endpoint: null, statusMap: { simScript: [{ estop: true }] } });
    expect(await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(c) }, B, null)).toEqual({ kind: "sim" });
    expect((await listPlcTrust(null, { id: B, isAdmin: true })).find((x) => x.id === c.id)).toMatchObject({ state: "sim", mayDecide: false, blockedBy: "sim" });
  });

  it("★ scope: out of scope and nonexistent give the SAME not_found for update / delete / decide; create cannot land outside", async () => {
    const c = await createAs(A); // factory
    const noFactory = await createAs(A, { factoryId: null });
    const scoped = [otherFactory];
    const missing = 2_000_000_000;
    for (const id of [c.id, noFactory.id, missing]) {
      expect(await savePlcConfig({ ...REAL({ factoryId: otherFactory }), id, code: `${RUN}-x` } as never, C, scoped)).toEqual({ kind: "not_found" });
      expect(await deletePlcConfig(id, C, scoped)).toEqual({ kind: "not_found" });
      expect(await decidePlcConfigTrust({ id, decision: "approve", expectedDigest: "0".repeat(64) }, B, scoped)).toEqual({ kind: "not_found" });
    }
    // an in-scope row cannot be moved out of scope
    const mine = await createAs(A, { factoryId: otherFactory });
    expect(await savePlcConfig({ ...REAL({ factoryId: factory }), id: mine.id, code: mine.code } as never, C, scoped)).toEqual({ kind: "not_found" });
    expect(await savePlcConfig(REAL({ factoryId: factory }) as never, C, scoped)).toEqual({ kind: "not_found" });
    expect(await savePlcConfig(REAL({ factoryId: null }) as never, C, scoped)).toEqual({ kind: "not_found" });
    expect(await savePlcConfig(REAL({ factoryId: null }) as never, C, [])).toEqual({ kind: "not_found" });
    // and nothing was written / audited for the refused ids
    expect((await audits(c.id)).map((a) => a.action)).toEqual(["create"]);
    expect((await listPlcTrust(scoped, { id: C, isAdmin: false })).map((x) => x.id)).toEqual(expect.not.arrayContaining([c.id, noFactory.id]));
  });

  it("delete is audited (before snapshot + reason) and the approval row goes with the config", async () => {
    const c = await createAs(A);
    await decidePlcConfigTrust({ id: c.id, decision: "approve", expectedDigest: plcTrustDigest(c) }, B, null);
    expect((await deletePlcConfig(c.id, C, null, "decommissioned")).kind).toBe("ok");
    expect((await audits(c.id)).at(-1)).toMatchObject({ action: "delete", actorId: C, reason: "decommissioned" });
    const [n] = await sql`SELECT count(*)::int AS n FROM safety_plc_config_trust WHERE "configId" = ${c.id}`;
    expect(n.n).toBe(0);
  });

  it("listPlcTrust: endpoint / tag map only for admins; mayDecide false for the maker", async () => {
    const c = await createAs(A);
    const asMaker = (await listPlcTrust(null, { id: A, isAdmin: true })).find((x) => x.id === c.id)!;
    expect(asMaker).toMatchObject({ state: "pending", mayDecide: false, blockedBy: "self", endpoint: "tcp://192.0.2.10:502", digest: plcTrustDigest(c) });
    expect(asMaker.tags?.find((t) => t.flag === "zoneOccupied")).toEqual({ flag: "zoneOccupied", address: "coil:2", dataType: "bool", activeWhen: "falsy" });
    expect((await listPlcTrust(null, { id: B, isAdmin: true })).find((x) => x.id === c.id)).toMatchObject({ mayDecide: true, blockedBy: null });
    const viewer = (await listPlcTrust(null, { id: B, isAdmin: false })).find((x) => x.id === c.id)!;
    expect(viewer).toMatchObject({ mayDecide: false, endpoint: null, tags: null });
  });

  describe("router", () => {
    const admin = (id: number) => ({ user: { id, role: "admin", name: `u${id}`, twoFactorEnabled: true } }) as never;
    const caller = async (ctx: never) => (await import("../../../routers/safetyRouter")).safetyRouter.createCaller(ctx);
    const saved = process.env.SAFETY_PLC_ADAPTER_ENABLED;
    beforeAll(() => {
      process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    });
    afterAll(() => {
      if (saved === undefined) delete process.env.SAFETY_PLC_ADAPTER_ENABLED;
      else process.env.SAFETY_PLC_ADAPTER_ENABLED = saved;
    });

    it("upsert (audited, maker = caller) → approve by the SAME admin refused → approve by another admin ok; non-admin cannot approve", async () => {
      const r = (await (await caller(admin(A))).upsertSafetyPlcConfig(REAL({ factoryId: factory }) as never)) as { config: SafetyPlcConfig };
      const id = r.config.id;
      const dg = plcTrustDigest(r.config);
      await expect((await caller(admin(A))).approveSafetyPlcConfig({ id, expectedDigest: dg })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const op = { user: { id: B, role: "operator", name: "op", twoFactorEnabled: true } } as never;
      await expect((await caller(op)).approveSafetyPlcConfig({ id, expectedDigest: dg })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect((await caller(admin(B))).approveSafetyPlcConfig({ id, expectedDigest: "f".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await (await caller(admin(B))).approveSafetyPlcConfig({ id, expectedDigest: dg })).toEqual({ ok: true, digest: dg, decision: "approve" });
      expect((await audits(id)).map((a) => [a.action, a.actorId])).toEqual([["create", A], ["approve", B]]);
      const list = await (await caller(admin(C))).plcTrustList();
      expect(list.find((x) => x.id === id)).toMatchObject({ state: "approved", approvedBy: B });
    });

    it("reject needs a reason; delete is audited", async () => {
      const r = (await (await caller(admin(A))).upsertSafetyPlcConfig(REAL({ factoryId: factory }) as never)) as { config: SafetyPlcConfig };
      await expect((await caller(admin(B))).rejectSafetyPlcConfig({ id: r.config.id, expectedDigest: plcTrustDigest(r.config), reason: "" })).rejects.toBeTruthy();
      expect((await (await caller(admin(B))).rejectSafetyPlcConfig({ id: r.config.id, expectedDigest: plcTrustDigest(r.config), reason: "wrong PLC" })).decision).toBe("reject");
      expect(await (await caller(admin(C))).deleteSafetyPlcConfig({ id: r.config.id, reason: "test" })).toEqual({ ok: true, id: r.config.id });
      expect((await audits(r.config.id)).map((a) => a.action)).toEqual(["create", "reject", "delete"]);
    });

    it("★ NOT_FOUND parity (router): an EXISTING config outside a scoped user's factories answers exactly like a missing id", async () => {
      const { resolvePermissionModule } = await import("@shared/permissions");
      const U = 961_109; // operator, machine_control rights, NO factory assignment ⇒ scope []
      await sql`DELETE FROM permissions WHERE "userId" = ${U}`;
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete")
                VALUES (${U}, 'machine_control', ${resolvePermissionModule("machine_control")}, true, true, true, true)`;
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView")
                VALUES (${U}, 'machine_monitoring', ${resolvePermissionModule("machine_monitoring")}, true)`;
      try {
        const existing = await createAs(A);
        const op = await caller({ user: { id: U, role: "operator", name: "op" } } as never);
        const ask = async (fn: () => Promise<unknown>) => {
          const e = (await fn().catch((x) => x)) as { code?: string; message?: string };
          return JSON.stringify([e?.code, e?.message]);
        };
        const missing = 2_000_000_001;
        for (const id of [existing.id, missing]) {
          expect(await ask(() => op.deleteSafetyPlcConfig({ id })), `delete ${id}`).toBe(JSON.stringify(["NOT_FOUND", "Safety-PLC config not found"]));
          expect(await ask(() => op.upsertSafetyPlcConfig({ ...REAL(), id } as never)), `update ${id}`).toBe(JSON.stringify(["NOT_FOUND", "Safety-PLC config not found"]));
          expect(await ask(() => op.readSafetyPlc({ configId: id })), `read ${id}`).toBe(JSON.stringify(["NOT_FOUND", "Safety-PLC config not found"]));
        }
        expect((await op.listSafetyPlcConfigs()).map((c: { id: number }) => c.id)).not.toContain(existing.id);
        expect((await audits(existing.id)).map((a) => a.action)).toEqual(["create"]);
        const a = await caller(admin(B));
        expect(await ask(() => a.approveSafetyPlcConfig({ id: missing, expectedDigest: "0".repeat(64) }))).toBe(JSON.stringify(["NOT_FOUND", "Safety-PLC config not found"]));
      } finally {
        await sql`DELETE FROM permissions WHERE "userId" = ${U}`;
      }
    });
  });
});
