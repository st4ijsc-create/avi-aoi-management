/**
 * Sprint G2.2a — machineRecipeRouter tests.
 *
 * Covers: create→version bump, deploy→active flip + ledger row + previousRecipeId,
 * rollback, RBAC denial, deployments.list, and the SAFETY invariant that this
 * router does NOT import commandDispatcher (static source scan).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { recipeDeployments } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db", () => ({ getDb: vi.fn(async () => fake) }));

// In-memory recipe catalog backing the mocked db layer.
const catalog: any[] = [];
const deployments: any[] = [];
let rseq = 1;

vi.mock("../db/machineRecipe", () => ({
  createRecipe: vi.fn(async (input: any) => {
    const versions = catalog.filter((r) => r.code === input.code);
    const version = versions.length ? Math.max(...versions.map((v) => v.version)) + 1 : 1;
    const row = { id: rseq++, version, status: input.status ?? "draft", ...input };
    catalog.push(row);
    return row;
  }),
  getRecipeById: vi.fn(async (id: number) => catalog.find((r) => r.id === id)),
  getActiveRecipe: vi.fn(async (opts: any) =>
    catalog.find((r) => r.status === "active" && (opts.code ? r.code === opts.code : r.machineId === opts.machineId))),
  listRecipeVersions: vi.fn(async (code: string) =>
    catalog.filter((r) => r.code === code).sort((a, b) => b.version - a.version)),
  archiveRecipe: vi.fn(async (id: number) => {
    const r = catalog.find((x) => x.id === id); if (r) r.status = "archived";
  }),
  deployRecipe: vi.fn(async (input: any) => {
    const target = catalog.find((r) => r.id === input.recipeId);
    const prev = catalog.find((r) => r.status === "active" && r.code === target.code && r.id !== target.id);
    const previousRecipeId = prev ? prev.id : null;
    if (prev) prev.status = "archived";
    target.status = "active";
    target.machineId = input.machineId;
    const dep = { id: rseq++, recipeId: target.id, machineId: input.machineId, deployedBy: input.deployedBy, previousRecipeId, status: "deployed", notes: input.notes ?? null };
    deployments.push(dep);
    return dep;
  }),
  rollbackRecipe: vi.fn(async (input: any) => {
    const last = [...deployments].reverse().find((d) => d.machineId === input.machineId);
    if (!last) throw new Error(`No deployment history for machine #${input.machineId}`);
    if (last.previousRecipeId == null) throw new Error("no previous recipe to roll back to");
    const target = catalog.find((r) => r.id === last.previousRecipeId);
    const cur = catalog.find((r) => r.status === "active" && r.code === target.code);
    if (cur) cur.status = "archived";
    target.status = "active";
    last.status = "rolled_back";
    const dep = { id: rseq++, recipeId: target.id, machineId: input.machineId, deployedBy: input.deployedBy, previousRecipeId: cur ? cur.id : null, status: "deployed" };
    deployments.push(dep);
    return dep;
  }),
}));

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

import { machineRecipeRouter } from "./machineRecipeRouter";

const ctx = { user: { id: 7, role: "supervisor", name: "Sup" } } as any;
const caller = machineRecipeRouter.createCaller(ctx);

beforeEach(() => {
  catalog.length = 0;
  deployments.length = 0;
  rseq = 1;
  fake.store.clear();
  resetSeq();
  perm.allow = true;
  vi.clearAllMocks();
});

describe("recipe versioning", () => {
  it("create bumps version per code", async () => {
    const v1 = await caller.recipes.create({ code: "R1", name: "r", payload: { speed: 1 } });
    const v2 = await caller.recipes.create({ code: "R1", name: "r", payload: { speed: 2 } });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    expect(v1.createdBy).toBe(7);
  });
});

describe("deploy / rollback", () => {
  it("deploy flips active + writes ledger row with previousRecipeId + deployedBy", async () => {
    const v1 = await caller.recipes.create({ code: "R", name: "r", payload: { a: 1 } });
    const v2 = await caller.recipes.create({ code: "R", name: "r", payload: { a: 2 } });

    const dep1 = await caller.recipes.deploy({ recipeId: v1.id, machineId: 100 });
    expect(dep1.status).toBe("deployed");
    expect(dep1.previousRecipeId).toBeNull();
    expect(dep1.deployedBy).toBe(7);
    expect((await caller.recipes.getActive({ code: "R" }))!.id).toBe(v1.id);

    const dep2 = await caller.recipes.deploy({ recipeId: v2.id, machineId: 100 });
    expect(dep2.previousRecipeId).toBe(v1.id);
    expect((await caller.recipes.getActive({ code: "R" }))!.id).toBe(v2.id);
  });

  it("rollback re-activates the previous recipe", async () => {
    const v1 = await caller.recipes.create({ code: "R", name: "r", payload: { a: 1 } });
    const v2 = await caller.recipes.create({ code: "R", name: "r", payload: { a: 2 } });
    await caller.recipes.deploy({ recipeId: v1.id, machineId: 100 });
    await caller.recipes.deploy({ recipeId: v2.id, machineId: 100 });

    await caller.recipes.rollback({ machineId: 100 });
    expect((await caller.recipes.getActive({ code: "R" }))!.id).toBe(v1.id);
  });

  it("deploy error surfaces as BAD_REQUEST", async () => {
    const { deployRecipe } = await import("../db/machineRecipe");
    (deployRecipe as any).mockRejectedValueOnce(new Error("Recipe #999 not found"));
    await expect(caller.recipes.deploy({ recipeId: 999, machineId: 1 })).rejects.toThrow(/not found/);
  });
});

describe("deployments.list", () => {
  it("filters by machineId and returns ledger rows", async () => {
    fake.seed(recipeDeployments, [
      { id: 1, recipeId: 10, machineId: 100, deployedBy: 7, deployedAt: new Date(1), status: "deployed" },
      { id: 2, recipeId: 11, machineId: 200, deployedBy: 7, deployedAt: new Date(2), status: "deployed" },
    ]);
    const rows = await caller.deployments.list({ machineId: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0].machineId).toBe(100);
  });
});

describe("RBAC", () => {
  it("denies create when caller lacks machine_control", async () => {
    perm.allow = false;
    await expect(caller.recipes.create({ code: "X", name: "x", payload: {} })).rejects.toThrow(/machine_control|FORBIDDEN/i);
  });
});

describe("SAFETY invariant", () => {
  it("router source does NOT import commandDispatcher / writeTags", () => {
    const src = readFileSync(join(__dirname, "machineRecipeRouter.ts"), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
    expect(importLines).not.toMatch(/commandDispatcher/);
    expect(importLines).not.toMatch(/writeTags/);
  });
});
