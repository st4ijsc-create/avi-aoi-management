/**
 * doc 81 Đợt 10 task F2 — the tRPC wall of R-10-af / R-10-ax (edgeResolution.*): role floor (admin / supervisor + 2FA) and
 * machine_control/canEdit on both writes, canView on the list, the caller's factory scope (STRICT — unreadable ⇒ refused, the
 * service never called), the reason's minimum, and every service refusal mapped to its coded error (i18n keys exist in vi /
 * en / zh — appErrorParamsCoverage). The service itself is measured on _test in edgeResolution.dot10.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const H = vi.hoisted(() => ({
  perms: [] as string[],
  deny: null as null | string,
  scope: [3] as number[] | null,
  scopeThrows: false,
  calls: [] as Array<{ fn: string; arg: any }>,
  result: { ok: true, id: 1, deviceKind: "robot", deviceId: 9 } as any,
}));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null), phaiDoiMatKhau: vi.fn(async () => false), createAuditLog: vi.fn(async () => ({ id: 1 })) }));
vi.mock("../_core/accessControl", () => ({
  requirePermission: (m: string, a: string) => async ({ ctx, next }: any) => {
    H.perms.push(`${m}/${a}`);
    if (H.deny === `${m}/${a}`) throw new TRPCError({ code: "FORBIDDEN", message: "denied" });
    return next({ ctx });
  },
}));
vi.mock("../db/reportAggregators", () => ({
  resolveTenantFactoryScope: vi.fn(async () => {
    if (H.scopeThrows) throw new Error("tenant scope unavailable");
    return { factoryIds: H.scope, labels: {} };
  }),
}));
vi.mock("../services/edge/edgeResolutionService", () => ({
  listEdgeResolutionItems: vi.fn(async (scope: unknown, filter: unknown) => (H.calls.push({ fn: "list", arg: { scope, filter } }), { available: true, stops: [], intents: [], stopTotal: 0, intentTotal: 0, intentMinAgeMinutes: 10 })),
  resolvePendingStop: vi.fn(async (a: unknown) => (H.calls.push({ fn: "resolveStop", arg: a }), H.result)),
  resolveOrphanedIntent: vi.fn(async (a: unknown) => (H.calls.push({ fn: "resolveIntent", arg: a }), H.result)),
}));

import { edgeResolutionRouter } from "./edgeResolutionRouter";

const caller = (role: string, twoFactorEnabled = true) => edgeResolutionRouter.createCaller({ user: { id: 7, role, name: "U", twoFactorEnabled }, req: { ip: "10.0.0.1", headers: { "user-agent": "t" } } } as any);
const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: TRPCError) => e.code);
const appCodeOf = async (p: Promise<unknown>) => p.then(() => null, (e: TRPCError) => ({ code: e.code, cause: (e.cause as any)?.appCode, params: (e.cause as any)?.appParams }));

beforeEach(() => {
  H.perms = [];
  H.deny = null;
  H.scope = [3];
  H.scopeThrows = false;
  H.calls = [];
  H.result = { ok: true, id: 1, deviceKind: "robot", deviceId: 9 };
});

describe("edgeResolution — who may do what", () => {
  it("list: any role with machine_control/canView, scoped, optional device filter", async () => {
    expect(await codeOf(caller("engineer").list({ robotId: 9 }))).toBe("ok");
    expect(H.perms).toEqual(["machine_control/canView"]);
    expect(H.calls).toEqual([{ fn: "list", arg: { scope: [3], filter: { robotId: 9, adapterId: undefined } } }]);
  });
  for (const role of ["engineer", "operator", "maintenance", "viewer", "user", "quality_inspector"]) {
    it(`${role} ⇒ FORBIDDEN on both writes (role floor admin / supervisor), service never called`, async () => {
      expect(await codeOf(caller(role).resolveStop({ requestId: 1, resolution: "checked" }))).toBe("FORBIDDEN");
      expect(await codeOf(caller(role).resolveIntent({ intentId: 1, reason: "checked" }))).toBe("FORBIDDEN");
      expect(H.calls).toEqual([]);
    });
  }
  it("supervisor + 2FA + canEdit ⇒ the service gets the PROVEN actor and the caller's scope", async () => {
    expect(await codeOf(caller("supervisor").resolveStop({ requestId: 11, resolution: "  stopped by hand  " }))).toBe("ok");
    expect(await codeOf(caller("admin").resolveIntent({ intentId: 12, reason: "gateway crashed" }))).toBe("ok");
    expect(H.perms).toEqual(["machine_control/canEdit", "machine_control/canEdit"]);
    expect(H.calls).toEqual([
      { fn: "resolveStop", arg: { requestId: 11, resolution: "stopped by hand", actor: { id: 7, name: "U", ip: "10.0.0.1", userAgent: "t" }, scope: [3] } },
      { fn: "resolveIntent", arg: { intentId: 12, reason: "gateway crashed", actor: { id: 7, name: "U", ip: "10.0.0.1", userAgent: "t" }, scope: [3] } },
    ]);
  });
  it("supervisor WITHOUT 2FA ⇒ refused before the service", async () => {
    expect(await codeOf(caller("supervisor", false).resolveStop({ requestId: 11, resolution: "checked" }))).not.toBe("ok");
    expect(H.calls).toEqual([]);
  });
  it("machine_control/canEdit denied ⇒ FORBIDDEN, service never called", async () => {
    H.deny = "machine_control/canEdit";
    expect(await codeOf(caller("supervisor").resolveIntent({ intentId: 1, reason: "checked" }))).toBe("FORBIDDEN");
    expect(H.calls).toEqual([]);
  });
  it("reason / resolution shorter than 3 ⇒ BAD_REQUEST", async () => {
    expect(await codeOf(caller("admin").resolveStop({ requestId: 1, resolution: " a " }))).toBe("BAD_REQUEST");
    expect(await codeOf(caller("admin").resolveIntent({ intentId: 1, reason: "" }))).toBe("BAD_REQUEST");
    expect(H.calls).toEqual([]);
  });
  it("factory scope unreadable ⇒ SERVICE_UNAVAILABLE (fail-closed, never widened), service never called", async () => {
    H.scopeThrows = true;
    expect(await appCodeOf(caller("admin").resolveStop({ requestId: 1, resolution: "checked" }))).toEqual({ code: "SERVICE_UNAVAILABLE", cause: "OPERATION_FAILED", params: { operation: "resolveEdgeStop", reason: "factoryScopeUnavailable" } });
    expect(await appCodeOf(caller("engineer").list())).toMatchObject({ code: "SERVICE_UNAVAILABLE", params: { operation: "listEdgeResolution", reason: "factoryScopeUnavailable" } });
    expect(H.calls).toEqual([]);
  });
});

describe("edgeResolution — service refusals become coded errors", () => {
  const cases: Array<[string, string, unknown]> = [
    ["notFound", "NOT_FOUND", { entity: "edgePendingStop" }],
    ["notResolvable", "PRECONDITION_FAILED", { operation: "resolveEdgeStop", reason: "stopNotResolvable" }],
    ["alreadyResolved", "CONFLICT", { operation: "resolveEdgeStop", reason: "alreadyResolved" }],
    ["unavailable", "SERVICE_UNAVAILABLE", { operation: "resolveEdgeStop", reason: "edgeControlUnavailable" }],
  ];
  for (const [reason, code, params] of cases) {
    it(`resolveStop ${reason} ⇒ ${code}`, async () => {
      H.result = { ok: false, reason, detail: "x" };
      expect(await appCodeOf(caller("admin").resolveStop({ requestId: 1, resolution: "checked" }))).toMatchObject({ code, params });
    });
  }
  it("resolveIntent tooRecent ⇒ PRECONDITION_FAILED writeIntentTooRecent; notFound ⇒ entity orphanedWriteIntent", async () => {
    H.result = { ok: false, reason: "tooRecent", detail: "x" };
    expect(await appCodeOf(caller("admin").resolveIntent({ intentId: 1, reason: "checked" }))).toMatchObject({ code: "PRECONDITION_FAILED", params: { operation: "resolveWriteIntent", reason: "writeIntentTooRecent" } });
    H.result = { ok: false, reason: "notFound", detail: "x" };
    expect(await appCodeOf(caller("admin").resolveIntent({ intentId: 1, reason: "checked" }))).toMatchObject({ code: "NOT_FOUND", params: { entity: "orphanedWriteIntent" } });
  });
});
