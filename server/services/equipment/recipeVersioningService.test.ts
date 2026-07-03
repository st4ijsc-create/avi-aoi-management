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
// W2-6: serialization chain + counter modelling the code-row FOR UPDATE lock in the fake.
let txChain: Promise<unknown> = Promise.resolve();
let txCount = 0;

vi.mock("drizzle-orm", () => ({
  desc: (c: any) => ({ __desc: c?.__c }),
  eq: (col: any, val: any) => ({ __op: "eq", col: col?.__c, val }),
  and: (...ps: any[]) => ({ __and: ps.filter(Boolean) }),
}));

vi.mock("../../../drizzle/schema", () => ({
  machineRecipes: { __table: "machine_recipes", id: { __c: "id" }, code: { __c: "code" }, status: { __c: "status" }, version: { __c: "version" } },
  recipeLoadLog: { __table: "recipe_load_log", recipeCode: { __c: "recipeCode" }, machineId: { __c: "machineId" }, createdAt: { __c: "createdAt" } },
}));

function matches(row: any, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.col] === pred.val;
  return true;
}

// Store-keyed fake so release/rollback (which now hit machine_recipes via `tx` directly)
// AND the mocked machineRecipe helpers observe the SAME `recipes` array.
function makeFakeDb() {
  const arrOf = (t: any): any[] => (t?.__table === "machine_recipes" ? recipes : loadLog);
  const db: any = {
    select: (_cols?: any) => ({
      from: (t: any) => {
        let pred: any = null;
        let order: any = null;
        const q: any = {
          where: (p: any) => { pred = p; return q; },
          orderBy: (o: any) => { order = o; return q; },
          limit: async (n: number) => run().slice(0, n),
          for: (_s?: any, _c?: any) => q, // SELECT … FOR UPDATE (row lock) — no-op, still thenable
          then: (res: any) => res(run()),
        };
        function run(): any[] {
          let rows = arrOf(t).filter((r) => matches(r, pred));
          if (order?.__desc) rows = [...rows].sort((a, b) => (b[order.__desc] ?? 0) - (a[order.__desc] ?? 0));
          return rows;
        }
        return q;
      },
    }),
    insert: (t: any) => ({
      values: (vals: any) => {
        const push = () => { const row = { id: logSeq++, ...vals, createdAt: new Date() }; arrOf(t).push(row); return [row]; };
        return { returning: async () => push(), then: (res: any) => res(push()) };
      },
    }),
    update: (t: any) => ({
      set: (patch: any) => ({
        where: (pred: any) => {
          const apply = () => { const hit = arrOf(t).filter((r) => matches(r, pred)); for (const r of hit) Object.assign(r, patch); return hit; };
          return { returning: async () => apply(), then: (res: any) => res(apply()) };
        },
      }),
    }),
  };
  // release/rollback (W2-6) run inside db.transaction(). The fake SERIALIZES concurrent
  // transactions on one global chain — a faithful model of the code-row FOR UPDATE lock,
  // so two overlapping releases resolve deterministically to a single active/released row.
  db.transaction = (cb: any) => {
    txCount++;
    const run = txChain.then(() => cb(db));
    txChain = run.then(() => undefined, () => undefined);
    return run;
  };
  return db;
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

import * as svc from "./recipeVersioningService";

beforeEach(() => {
  recipes = []; loadLog = []; recipeSeq = 1; logSeq = 1;
  txChain = Promise.resolve(); txCount = 0;
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

// ════════════════════════════════════════════════════════════════════════════
// W2-6 (doc 25 T5) — transaction + row-lock atomicity of release/rollback.
//
// The fake models the code-row FOR UPDATE lock by SERIALIZING transactions; real
// row-locking + rollback-on-crash is enforced by Postgres + migration 0164's partial
// unique index (uq_machine_recipes_active_code) and can only be fully proven there.
// ════════════════════════════════════════════════════════════════════════════
describe("recipeVersioningService — atomic release/rollback (W2-6)", () => {
  it("releaseVersion runs inside exactly one transaction", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    txCount = 0;
    await svc.releaseVersion(v1.id, 1);
    expect(txCount).toBe(1);
  });

  it("two concurrent releases of the same code end with EXACTLY ONE released version", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    const v2 = (await svc.createVersion({ code: "R1", name: "v2", payload: {} })).recipe;
    // Fire both releases "at once" — the serialized transaction (models the row lock)
    // orders them, so they can NEVER both create a released (active) version.
    await Promise.all([svc.releaseVersion(v1.id, 1), svc.releaseVersion(v2.id, 1)]);
    const released = recipes.filter((r) => r.code === "R1" && r.status === "active");
    expect(released).toHaveLength(1);
  });

  it("rollbackToVersion archives the current AND promotes the target atomically (one tx)", async () => {
    const v1 = (await svc.createVersion({ code: "R1", name: "v1", payload: {} })).recipe;
    const v2 = (await svc.createVersion({ code: "R1", name: "v2", payload: {} })).recipe;
    await svc.releaseVersion(v1.id, 1);
    await svc.releaseVersion(v2.id, 1);
    txCount = 0;
    const { recipe } = await svc.rollbackToVersion(v1.id, 1);
    expect(txCount).toBe(1);
    expect(recipe.id).toBe(v1.id);
    // Invariant holds: exactly one released, and it is the rolled-back-to version.
    const released = recipes.filter((r) => r.code === "R1" && r.status === "active");
    expect(released).toHaveLength(1);
    expect(released[0].id).toBe(v1.id);
    expect(recipes.find((r) => r.id === v2.id)!.status).toBe("archived");
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
