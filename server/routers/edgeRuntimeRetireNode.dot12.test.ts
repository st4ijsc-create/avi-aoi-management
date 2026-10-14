/**
 * doc 81 Đợt 12 task O — tRPC `edgeRuntime.retireNode` is ADMIN ONLY (like `edge-node-credential.ts retire-node`): any other role
 * is refused before the service runs; an admin still needs machine_control:canDelete on top (never a widening). The actor is the
 * SESSION user (never an id from the input); the service's refusals surface as coded app errors (i18n), naming what blocks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const H = vi.hoisted(() => ({ calls: [] as unknown[], deny: false, fail: null as null | { code: string; message: string } }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null), phaiDoiMatKhau: vi.fn(async () => false), createAuditLog: vi.fn(async () => ({ id: 1 })) }));
vi.mock("../_core/accessControl", () => ({
  requirePermission: (_m: string, action: string) => async ({ ctx, next }: any) => {
    if (H.deny || action !== "canDelete") throw new TRPCError({ code: "FORBIDDEN", message: `no grant ${action}` });
    return next({ ctx });
  },
}));
vi.mock("../services/edge/edgeNodeCredentials", async (orig) => {
  const real = await orig<typeof import("../services/edge/edgeNodeCredentials")>();
  return {
    ...real,
    retireEdgeNode: vi.fn(async (input: unknown) => {
      H.calls.push(input);
      if (H.fail) throw new real.EdgeCredentialError(H.fail.code as never, H.fail.message, H.fail.code === "retireBlocked" ? "it owns robot(s) 12" : undefined);
      return { nodeId: 9, revokedCredentialIds: [4], retiredAt: new Date(0) };
    }),
  };
});

import { edgeRuntimeRouter } from "./edgeRuntimeRouter";
import { readAppErrorMeta } from "../_core/appError";

const caller = (role: string, id = 7) => edgeRuntimeRouter.createCaller({ user: { id, role, name: "U", twoFactorEnabled: true }, req: { ip: "1", headers: {} } } as any);
const outcome = (p: Promise<unknown>) => p.then(() => "ok", (e: TRPCError) => e.code);
beforeEach(() => {
  H.calls = [];
  H.deny = false;
  H.fail = null;
});

describe("Đợt 12 O — edgeRuntime.retireNode is admin-only, audited by the service, actor = session user", () => {
  for (const role of ["engineer", "supervisor", "operator", "maintenance", "user"]) {
    it(`${role} ⇒ FORBIDDEN, the service never runs`, async () => {
      expect(await outcome(caller(role).retireNode({ code: "edge-x", reason: "decommission" }))).toBe("FORBIDDEN");
      expect(H.calls).toEqual([]);
    });
  }
  it("admin with machine_control:canDelete ⇒ retired, actor = ctx.user.id; without the grant ⇒ FORBIDDEN", async () => {
    const r = await caller("admin", 42).retireNode({ code: "edge-x", reason: "decommission" });
    expect(r).toMatchObject({ ok: true, nodeId: 9, revokedCredentialIds: [4] });
    expect(H.calls).toEqual([{ nodeCode: "edge-x", actorUserId: 42, reason: "decommission" }]);
    H.deny = true;
    expect(await outcome(caller("admin").retireNode({ code: "edge-y", reason: "decommission" }))).toBe("FORBIDDEN");
    expect(H.calls).toHaveLength(1);
  });
  it("input: the reason is required (≥ 3 chars); no actor id is accepted from the input", async () => {
    expect(await outcome(caller("admin").retireNode({ code: "edge-x", reason: "x" }))).toBe("BAD_REQUEST");
    expect(await outcome(caller("admin").retireNode({ code: "edge-x", reason: "decommission", actorUserId: 1 } as any))).toBe("BAD_REQUEST");
    expect(H.calls).toEqual([]);
  });
  it("refusals are coded: blocked ⇒ PRECONDITION_FAILED OPERATION_FAILED naming the blocker; unknown ⇒ NOT_FOUND; already retired ⇒ CONFLICT", async () => {
    const err = async (code: string, message: string) => {
      H.fail = { code, message };
      try {
        await caller("admin").retireNode({ code: "edge-x", reason: "decommission" });
        return null;
      } catch (e) {
        return { trpc: (e as TRPCError).code, meta: readAppErrorMeta(e) };
      }
    };
    const blocked = await err("retireBlocked", "Edge node \"edge-x\" cannot be retired: it owns robot(s) 12.");
    expect(blocked?.trpc).toBe("PRECONDITION_FAILED");
    expect(blocked?.meta).toMatchObject({ appCode: "OPERATION_FAILED", appParams: { operation: "retireEdgeNode", reason: "edgeNodeRetireBlocked", blockers: "it owns robot(s) 12" } });
    expect((await err("nodeNotFound", "nope"))?.meta).toMatchObject({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "edgeNode" } });
    expect((await err("nodeNotFound", "nope"))?.trpc).toBe("NOT_FOUND");
    expect((await err("nodeRetired", "already"))?.trpc).toBe("CONFLICT");
    expect((await err("nodeRetired", "already"))?.meta).toMatchObject({ appParams: { reason: "edgeNodeAlreadyRetired" } });
    expect((await err("notAdmin", "no"))?.trpc).toBe("FORBIDDEN");
  });
});
