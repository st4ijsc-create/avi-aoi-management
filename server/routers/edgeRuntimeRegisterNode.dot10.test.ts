/**
 * doc 81 Đợt 10 task F2 round 3 (R-10-bl, decision D14) — tRPC `edgeRuntime.registerNode` is ADMIN ONLY, like the
 * `edge-node-credential.ts register-node` CLI. machine_control:canCreate alone (an engineer / supervisor with the grant) is
 * refused before the service runs; an admin still needs the grant on top.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const H = vi.hoisted(() => ({ calls: [] as unknown[], deny: false }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null), phaiDoiMatKhau: vi.fn(async () => false), createAuditLog: vi.fn(async () => ({ id: 1 })) }));
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (H.deny) throw new TRPCError({ code: "FORBIDDEN", message: "no grant" });
    return next({ ctx });
  },
}));
vi.mock("../services/edge/edgeCoordinator", async (orig) => ({
  ...(await orig<typeof import("../services/edge/edgeCoordinator")>()),
  registerNode: vi.fn(async (input: unknown) => (H.calls.push(input), { ok: true, data: { id: 1 } })),
  edgeRuntimeEnabled: () => true,
}));

import { edgeRuntimeRouter } from "./edgeRuntimeRouter";

const caller = (role: string) => edgeRuntimeRouter.createCaller({ user: { id: 7, role, name: "U", twoFactorEnabled: true }, req: { ip: "1", headers: {} } } as any);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: TRPCError) => e.code);
beforeEach(() => {
  H.calls = [];
  H.deny = false;
});

describe("D14 — edgeRuntime.registerNode is admin-only", () => {
  for (const role of ["engineer", "supervisor", "operator", "maintenance", "user"]) {
    it(`${role} (even with machine_control:canCreate) ⇒ FORBIDDEN, the service never runs`, async () => {
      expect(await code(caller(role).registerNode({ code: "edge-x", factoryCode: "F1" }))).toBe("FORBIDDEN");
      expect(H.calls).toEqual([]);
    });
  }
  it("admin with the grant ⇒ registered; admin WITHOUT the grant ⇒ FORBIDDEN (never a widening)", async () => {
    expect(await code(caller("admin").registerNode({ code: "edge-x", factoryCode: "F1" }))).toBe("ok");
    expect(H.calls).toHaveLength(1);
    H.deny = true;
    expect(await code(caller("admin").registerNode({ code: "edge-y", factoryCode: "F1" }))).toBe("FORBIDDEN");
    expect(H.calls).toHaveLength(1);
  });
});
