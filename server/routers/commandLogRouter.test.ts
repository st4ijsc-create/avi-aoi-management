/**
 * Sprint G2.2a — commandLogRouter tests (READ-ONLY audit).
 *
 * Covers: filter by triggerKind/status/machineId, get by id, canView gate, and the
 * SAFETY invariant that this router does NOT import commandDispatcher.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeDb, makeEq, makeAnd, makeGte, makeDesc, resetSeq } from "./__otFakeDb";
import { commandLog } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, gte: makeGte, desc: makeDesc };
});
vi.mock("../db", () => ({ getDb: vi.fn(async () => fake) }));

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

import { commandLogRouter } from "./commandLogRouter";

const ctx = { user: { id: 3, role: "supervisor", name: "Sup" } } as any;
const caller = commandLogRouter.createCaller(ctx);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  fake.seed(commandLog, [
    { id: 1, adapterId: 1, machineId: 100, status: "simulated", triggerKind: "hitl", createdAt: new Date(10) },
    { id: 2, adapterId: 1, machineId: 100, status: "acked", triggerKind: "interlock", createdAt: new Date(20) },
    { id: 3, adapterId: 2, machineId: 200, status: "rejected", triggerKind: "hitl", createdAt: new Date(30) },
  ]);
});

describe("list filters", () => {
  it("filters by triggerKind", async () => {
    const rows = await caller.list({ triggerKind: "interlock" });
    expect(rows.map((r) => r.id)).toEqual([2]);
  });
  it("filters by status", async () => {
    const rows = await caller.list({ status: "rejected" });
    expect(rows.map((r) => r.id)).toEqual([3]);
  });
  it("filters by machineId and orders newest first", async () => {
    const rows = await caller.list({ machineId: 100 });
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
  });
  it("no filter returns all newest-first", async () => {
    const rows = await caller.list();
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe("get", () => {
  it("returns a row by id", async () => {
    const row = await caller.get({ id: 2 });
    expect(row.status).toBe("acked");
  });
  it("throws NOT_FOUND for missing id", async () => {
    await expect(caller.get({ id: 999 })).rejects.toThrow(/không tồn tại/);
  });
});

describe("RBAC canView gate", () => {
  it("denies list when caller lacks machine_control", async () => {
    perm.allow = false;
    await expect(caller.list()).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });
});

describe("SAFETY invariant", () => {
  it("router source does NOT import commandDispatcher / writeTags", () => {
    const src = readFileSync(join(__dirname, "commandLogRouter.ts"), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(importLines).not.toMatch(/commandDispatcher/);
    expect(importLines).not.toMatch(/writeTags/);
  });
});
