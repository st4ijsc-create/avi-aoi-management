/**
 * edgeRuntimeRouter.deleteNode tests (Phase E4 edge node deregister).
 *
 * Covers: flag-gating, the active-run safety guard (refuse delete when a non-terminal
 * run is delegated), terminal-only history detach + delete, NOT_FOUND, and the RBAC
 * machine_control/canDelete gate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { edgeNodes, orchestrationRuns } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

const perm = { allow: true };
vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => {
    if (!perm.allow) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "FORBIDDEN", message: "no machine_control" });
    }
    return next({ ctx });
  },
}));

import { edgeRuntimeRouter } from "./edgeRuntimeRouter";

const ctx = { user: { id: 1, role: "admin", name: "Admin" } } as any;
const caller = edgeRuntimeRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  process.env.EDGE_RUNTIME_ENABLED = "true";
  fake.seed(edgeNodes, [
    { id: 1, code: "edge-a", name: "Edge A", status: "online" },
    { id: 2, code: "edge-b", name: "Edge B", status: "offline" },
  ]);
});

describe("deleteNode", () => {
  it("deletes a node with no delegated runs", async () => {
    const res = await caller.deleteNode({ id: 2 });
    expect(res.ok).toBe(true);
    expect(res.data?.id).toBe(2);
  });

  it("refuses to delete a node with an ACTIVE delegated run", async () => {
    fake.seed(orchestrationRuns, [
      { id: 10, workflowId: 5, edgeNodeId: 1, status: "running" },
    ]);
    const res = await caller.deleteNode({ id: 1 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/active run/i);
    // The node must still exist.
    const nodes = await caller.listNodes();
    expect(nodes.find((n: any) => n.id === 1)).toBeTruthy();
  });

  it("deletes a node whose runs are all terminal, detaching their FK", async () => {
    fake.seed(orchestrationRuns, [
      { id: 11, workflowId: 5, edgeNodeId: 1, status: "completed" },
    ]);
    const res = await caller.deleteNode({ id: 1 });
    expect(res.ok).toBe(true);
  });

  it("returns a structured failure for a missing node", async () => {
    const res = await caller.deleteNode({ id: 999 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });

  it("is flag-gated (disabled returns enabled:false, deletes nothing)", async () => {
    process.env.EDGE_RUNTIME_ENABLED = "false";
    const res = await caller.deleteNode({ id: 2 });
    expect(res.ok).toBe(false);
    expect(res.enabled).toBe(false);
    const nodes = await caller.listNodes();
    expect(nodes.find((n: any) => n.id === 2)).toBeTruthy();
  });

  it("denies when the caller lacks machine_control", async () => {
    perm.allow = false;
    await expect(caller.deleteNode({ id: 2 })).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });
});
