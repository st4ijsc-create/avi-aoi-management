/**
 * doc 81 Đợt 8 final wave F3 / N-R4 — BEFORE migration 0368 (the maker-checker table does not exist): config writes and
 * approvals answer a clear "migration 0368 missing" refusal (PRECONDITION_FAILED, appCode OPERATION_FAILED, reason
 * plcTrustMigrationMissing — never a 500) and the trust list offers NO decision (every real config not trusted).
 * The DB is faked: every query on the trust table fails the way postgres-js + drizzle report a missing relation (42P01 on
 * the error's cause). A trust-table read failing for ANY other reason ⇒ "trust_unreadable" (still no decision).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
});

const F = vi.hoisted(() => ({ code: "42P01" as string | undefined, cfgs: [] as Array<Record<string, unknown>>, trustOk: false }));
function dbError() {
  const cause = Object.assign(new Error('relation "safety_plc_config_trust" does not exist'), F.code ? { code: F.code } : {});
  return Object.assign(new Error("Failed query: insert into safety_plc_config_trust ..."), { cause });
}
vi.mock("../../../db/connection", () => ({
  getDb: async () => ({
    transaction: async () => {
      throw dbError();
    },
    select: () => ({
      from: (t: Record<symbol, unknown>) => ({
        orderBy: async () => F.cfgs,
        // only the maker-checker table is missing; any other table (e.g. licenses for moduleGate) answers empty
        where: () => {
          const name = t?.[Symbol.for("drizzle:Name")];
          if (name === "safety_plc_config_trust" && !F.trustOk) return Promise.reject(dbError());
          // F5 batch audit lookup (grouped): fails here when the trust rows are readable (undecidable SoD)
          if (name === "control_audit_log") return Object.assign(Promise.resolve([]), { groupBy: () => Promise.reject(new Error("audit read timeout")) });
          return Promise.resolve([]);
        },
      }),
    }),
  }),
}));

import { savePlcConfig, decidePlcConfigTrust, listPlcTrust, isPlcTrustMigrationMissing } from "./safetyPlcTrust";

const REAL = { id: 4, code: "R4", name: "real", vendor: "pilz", backend: "modbus", endpoint: "tcp://192.0.2.4:502", statusMap: { estop: { address: "coil:1" } }, robotId: 2, stationId: null, lineId: null, factoryId: 1, scope: null, corporateCode: null, enabled: false };
const SIM = { ...REAL, id: 5, code: "S5", backend: "sim", endpoint: null };

beforeEach(() => {
  F.trustOk = false;
  F.code = "42P01";
  F.cfgs = [REAL, SIM];
});

describe("final wave F3 / N-R4 — before migration 0368", () => {
  it("classifier: 42P01 / 42703 on the error or its cause ⇒ missing; any other error ⇒ not", () => {
    expect(isPlcTrustMigrationMissing(Object.assign(new Error("x"), { code: "42P01" }))).toBe(true);
    expect(isPlcTrustMigrationMissing(new Error("x", { cause: Object.assign(new Error("y"), { code: "42703" }) }))).toBe(true);
    expect(isPlcTrustMigrationMissing(Object.assign(new Error("x"), { code: "57014" }))).toBe(false);
    expect(isPlcTrustMigrationMissing(new Error("relation does not exist"))).toBe(false); // text alone is not trusted
    expect(isPlcTrustMigrationMissing(null)).toBe(false);
  });

  it("★ savePlcConfig / decidePlcConfigTrust ⇒ { kind: 'migration_missing' } (no throw ⇒ no 500)", async () => {
    expect(await savePlcConfig({ code: "x", name: "x", backend: "modbus" } as never, 7, null)).toEqual({ kind: "migration_missing" });
    expect(await decidePlcConfigTrust({ id: 4, decision: "approve", expectedDigest: "0".repeat(64) }, 7, null)).toEqual({ kind: "migration_missing" });
    expect(await decidePlcConfigTrust({ id: 4, decision: "reject", expectedDigest: "0".repeat(64), reason: "r" }, 7, null)).toEqual({ kind: "migration_missing" });
  });

  it("any OTHER database error still throws (not disguised as a missing migration)", async () => {
    F.code = "57014";
    await expect(savePlcConfig({ code: "x", name: "x" } as never, 7, null)).rejects.toThrow(/Failed query/);
  });

  it("★ trust list: real config NOT trusted, NO decision offered, the reason is said; sim unchanged", async () => {
    const rows = await listPlcTrust(null, { id: 7, isAdmin: true });
    const real = rows.find((r) => r.id === 4)!;
    expect(real).toMatchObject({ state: "pending", mayDecide: false, mayReject: false, blockedBy: "migration_missing", trustUnavailable: "migration_missing" });
    expect(rows.find((r) => r.id === 5)).toMatchObject({ state: "sim", mayDecide: false, blockedBy: "sim", trustUnavailable: null });
  });

  it("trust rows unreadable for another reason ⇒ 'trust_unreadable' (still no decision)", async () => {
    F.code = "57014";
    const real = (await listPlcTrust(null, { id: 7, isAdmin: true })).find((r) => r.id === 4)!;
    expect(real).toMatchObject({ state: "pending", mayDecide: false, mayReject: false, blockedBy: "trust_unreadable", trustUnavailable: "trust_unreadable" });
  });

  it("F5: trust rows readable but the batched audit lookup fails ⇒ every real config blocked ('self'), no decision (fail closed)", async () => {
    F.trustOk = true;
    const real = (await listPlcTrust(null, { id: 7, isAdmin: true })).find((r) => r.id === 4)!;
    expect(real).toMatchObject({ mayDecide: false, mayReject: false, blockedBy: "self", trustUnavailable: null });
  });

  it("★ router: upsert / approve / reject answer PRECONDITION_FAILED with the migration reason (not INTERNAL_SERVER_ERROR)", async () => {
    const saved = process.env.SAFETY_PLC_ADAPTER_ENABLED;
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    try {
      const { safetyRouter } = await import("../../../routers/safetyRouter");
      const caller = safetyRouter.createCaller({ user: { id: 7, role: "admin", name: "a", twoFactorEnabled: true } } as never);
      const want = { code: "PRECONDITION_FAILED", cause: expect.objectContaining({ appCode: "OPERATION_FAILED", appParams: expect.objectContaining({ reason: "plcTrustMigrationMissing" }) }) };
      await expect(caller.upsertSafetyPlcConfig({ code: "x", name: "x", backend: "modbus", endpoint: "tcp://192.0.2.4:502" } as never)).rejects.toMatchObject(want);
      await expect(caller.approveSafetyPlcConfig({ id: 4, expectedDigest: "0".repeat(64) })).rejects.toMatchObject(want);
      await expect(caller.rejectSafetyPlcConfig({ id: 4, expectedDigest: "0".repeat(64), reason: "wrong" })).rejects.toMatchObject(want);
    } finally {
      if (saved === undefined) delete process.env.SAFETY_PLC_ADAPTER_ENABLED;
      else process.env.SAFETY_PLC_ADAPTER_ENABLED = saved;
    }
  });
});
