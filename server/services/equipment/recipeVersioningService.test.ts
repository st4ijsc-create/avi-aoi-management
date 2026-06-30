/**
 * I1-b (doc 16 Khối 1B / §6) — recipeVersioningService tests.
 *
 * In-memory: the existing machine_recipe DB layer + the recipe_load_log insert are
 * mocked so the genealogy + flag-gating + status flow are unit-testable with no real DB.
 *   • create → draft + a 'create' genealogy event
 *   • release → active + archives prior released + 'release' event
 *   • rollback → re-releases a prior version + 'rollback' event
 *   • record-load → 'load' event (+ optional deploy ledger)
 *   • flag OFF → every mutation throws (no-op); reads still allowed
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── in-memory recipe catalog (machine_recipes) ────────────────────────────────
interface Rec { id: number; code: string; name: string; version: number; status: string; checksum: string; machineId: number | null }
let recipes: Rec[] = [];
let recipeSeq = 1;

vi.mock("../../db/machineRecipe", () => ({
  createRecipe: vi.fn(async (input: any) => {
    const version = recipes.filter((r) => r.code === input.code).reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const row: Rec = { id: recipeSeq++, code: input.code, name: input.name, version, status: input.status ?? "draft", checksum: "sum" + version, machineId: input.machineId ?? null };
    recipes.push(row);
    return row;
  }),
  getRecipeById: vi.fn(async (id: number) => recipes.find((r) => r.id === id)),
  getActiveRecipe: vi.fn(async (opts: any) => recipes.find((r) => r.code === opts.code && r.status === "active")),
  archiveRecipe: vi.fn(async (id: number) => { const r = recipes.find((x) => x.id === id); if (r) r.status = "archived"; }),
  listRecipeVersions: vi.fn(async (code: string) => recipes.filter((r) => r.code === code).sort((a, b) => b.version - a.version)),
  deployRecipe: vi.fn(async (_input: any) => ({ id: 999 })),
}));

// ── in-memory recipe_load_log ─────────────────────────────────────────────────
let loadLog: any[] = [];
let logSeq = 1;

vi.mock("drizzle-orm", () => ({
  desc: (c: any) => c,
  eq: (col: any, val: any) => ({ col: col?.__c, val }),
}));

vi.mock("../../../drizzle/schema", () => ({
  machineRecipes: { id: { __c: "id" } },
  recipeLoadLog: { recipeCode: { __c: "recipeCode" }, machineId: { __c: "machineId" }, createdAt: { __c: "createdAt" } },
}));

function fakeDb() {
  return {
    insert: () => ({ values: (vals: any) => ({ returning: async () => { const row = { id: logSeq++, ...vals, createdAt: new Date() }; loadLog.push(row); return [row]; } }) }),
    // update machine_recipes status (release/rollback)
    update: () => ({ set: (patch: any) => ({ where: (pred: any) => ({ returning: async () => {
      const r = recipes.find((x) => x.id === pred.val); if (r) Object.assign(r, patch); return r ? [r] : [];
    } }) }) }),
    select: () => ({ from: () => { let preds: any[] = []; const b: any = {
      where: (p: any) => { preds.push(p); return b; }, orderBy: () => b,
      limit: async () => loadLog.filter((r) => preds.every((p) => r[p.col] === p.val)),
      then: (res: any, rej?: any) => Promise.resolve(loadLog.filter((r) => preds.every((p) => r[p.col] === p.val))).then(res, rej),
    }; return b; } }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb()) }));

import * as svc from "./recipeVersioningService";

beforeEach(() => {
  recipes = []; loadLog = []; recipeSeq = 1; logSeq = 1;
  process.env.EQ_INTEG_ENABLED = "true";
});
afterEach(() => { delete process.env.EQ_INTEG_ENABLED; vi.clearAllMocks(); });

describe("recipeVersioningService — create/release/rollback + genealogy", () => {
  it("create → draft + a 'create' event", async () => {
    const { recipe, event } = await svc.createVersion({ code: "R1", name: "Recipe 1", payload: { a: 1 } });
    expect(recipe.version).toBe(1);
    expect(recipe.status).toBe("draft");
    expect(event.action).toBe("create");
    expect(event.recipeCode).toBe("R1");
    expect(loadLog).toHaveLength(1);
  });

  it("create twice bumps the version (immutable new row)", async () => {
    await svc.createVersion({ code: "R1", name: "v1", payload: {} });
    const { recipe } = await svc.createVersion({ code: "R1", name: "v2", payload: {} });
    expect(recipe.version).toBe(2);
    expect(recipes).toHaveLength(2);
  });

  it("release → active + 'release' event, archiving the prior released version", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    const v2 = (await svc.createVersion({ code: "R1", name: "v2", payload: {} })).recipe;
    await svc.releaseVersion(v1.id, 42);
    const { recipe, event } = await svc.releaseVersion(v2.id, 42);
    expect(recipe.status).toBe("active");
    expect(recipes.find((r) => r.id === v1.id)!.status).toBe("archived"); // prior released archived
    expect(event.action).toBe("release");
    expect(event.status).toBe("released"); // design vocabulary in the log
    expect(event.fromVersion).toBe(1);
    expect(event.performedBy).toBe(42);
  });

  it("rollback → re-releases the prior version + 'rollback' event", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    const v2 = (await svc.createVersion({ code: "R1", name: "v2", payload: {} })).recipe;
    await svc.releaseVersion(v1.id, 1);
    await svc.releaseVersion(v2.id, 1);
    const { recipe, event } = await svc.rollbackToVersion(v1.id, 1);
    expect(recipe.id).toBe(v1.id);
    expect(recipe.status).toBe("active");
    expect(recipes.find((r) => r.id === v2.id)!.status).toBe("archived");
    expect(event.action).toBe("rollback");
    expect(event.fromVersion).toBe(2);
  });

  it("rollback throws when the target is already released", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    await svc.releaseVersion(v1.id, 1);
    await expect(svc.rollbackToVersion(v1.id, 1)).rejects.toThrow(/already the released/i);
  });

  it("record-load → a 'load' genealogy event (+ optional deploy ledger)", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    const { event, deploymentId } = await svc.recordLoad({ recipeId: v1.id, machineId: 8, performedBy: 3, deploy: true });
    expect(event.action).toBe("load");
    expect(event.machineId).toBe(8);
    expect(event.performedBy).toBe(3);
    expect(deploymentId).toBe(999);
  });

  it("listLoadHistory returns the genealogy for a machine", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    await svc.recordLoad({ recipeId: v1.id, machineId: 8, performedBy: 3 });
    const hist = await svc.listLoadHistory(8);
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[0].machineId).toBe(8);
  });
});

describe("recipeVersioningService — flag OFF no-op", () => {
  beforeEach(() => { delete process.env.EQ_INTEG_ENABLED; });

  it("mutations throw when EQ_INTEG_ENABLED is off", async () => {
    await expect(svc.createVersion({ code: "R1", name: "v1", payload: {} })).rejects.toThrow(/disabled/i);
    await expect(svc.releaseVersion(1, 1)).rejects.toThrow(/disabled/i);
    await expect(svc.archiveVersion(1, 1)).rejects.toThrow(/disabled/i);
    await expect(svc.rollbackToVersion(1, 1)).rejects.toThrow(/disabled/i);
    await expect(svc.recordLoad({ recipeId: 1, machineId: 1, performedBy: 1 })).rejects.toThrow(/disabled/i);
  });

  it("reads are still allowed when the flag is off", async () => {
    // listVersions hits the (mocked) machineRecipe layer, not the flag.
    const versions = await svc.listVersions("R1");
    expect(Array.isArray(versions)).toBe(true);
  });
});
