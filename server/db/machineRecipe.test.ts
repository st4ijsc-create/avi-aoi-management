/**
 * Sprint F4a — machineRecipe DB layer tests.
 *   - createRecipe bumps version (1,2,3…) and computes a stable checksum
 *   - deployRecipe sets target active + archives the previous active version
 *   - rollbackRecipe re-deploys previousRecipeId and marks prior rolled_back
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const recipes: Row[] = [];
const deployments: Row[] = [];
let rSeq = 1;
let dSeq = 1;

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps }),
  desc: (col: any) => ({ __desc: col.__name }),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  return true;
}

function tableArr(t: any): Row[] {
  return t.__table === "machine_recipes" ? recipes : deployments;
}

function makeFakeDb() {
  const builder = (t: any) => {
    let pred: any = null;
    let order: any = null;
    const q: any = {
      where: (p: any) => { pred = p; return q; },
      orderBy: (o: any) => { order = o; return q; },
      limit: async (_n: number) => run().slice(0, _n),
      then: undefined,
    };
    function run(): Row[] {
      let rows = tableArr(t).filter((r) => matches(r, pred));
      if (order?.__desc) rows = [...rows].sort((a, b) => (b[order.__desc] ?? 0) - (a[order.__desc] ?? 0));
      return rows;
    }
    // Make q awaitable (for queries without limit, e.g. listRecipeVersions).
    q.then = (resolve: any) => resolve(run());
    return q;
  };
  return {
    select: () => ({ from: (t: any) => builder(t) }),
    insert: (t: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          if (t.__table === "machine_recipes") {
            const row = { id: rSeq++, ...vals };
            recipes.push(row);
            return [row];
          }
          const row = { id: dSeq++, deployedAt: new Date(Date.now() + dSeq), ...vals };
          deployments.push(row);
          return [row];
        },
      }),
    }),
    update: (t: any) => ({
      set: (patch: Row) => ({
        where: async (pred: any) => {
          for (const r of tableArr(t)) if (matches(r, pred)) Object.assign(r, patch);
        },
      }),
    }),
  };
}

vi.mock("./connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../drizzle/schema", () => ({
  machineRecipes: {
    __table: "machine_recipes",
    id: { __name: "id" }, code: { __name: "code" }, status: { __name: "status" },
    machineId: { __name: "machineId" }, version: { __name: "version" },
  },
  recipeDeployments: {
    __table: "recipe_deployments",
    id: { __name: "id" }, machineId: { __name: "machineId" }, deployedAt: { __name: "deployedAt" },
  },
}));

import { createRecipe, deployRecipe, rollbackRecipe, computeChecksum, listRecipeVersions, getActiveRecipe } from "./machineRecipe";

beforeEach(() => {
  recipes.length = 0;
  deployments.length = 0;
  rSeq = 1;
  dSeq = 1;
  vi.clearAllMocks();
});

describe("machineRecipe", () => {
  it("computeChecksum is stable regardless of key order", () => {
    expect(computeChecksum({ a: 1, b: 2 })).toBe(computeChecksum({ b: 2, a: 1 }));
    expect(computeChecksum({ a: 1 })).not.toBe(computeChecksum({ a: 2 }));
  });

  it("createRecipe bumps version 1,2,3 for the same code", async () => {
    const r1 = await createRecipe({ code: "R1", name: "v1", payload: { speed: 10 } });
    const r2 = await createRecipe({ code: "R1", name: "v2", payload: { speed: 20 } });
    const r3 = await createRecipe({ code: "R1", name: "v3", payload: { speed: 30 } });
    expect([r1.version, r2.version, r3.version]).toEqual([1, 2, 3]);
    expect(r1.checksum).toBeTruthy();
    const versions = await listRecipeVersions("R1");
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]); // newest first
  });

  it("deploy → active/archive previous; rollback → re-deploy previous", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 } });
    const v2 = await createRecipe({ code: "R1", name: "v2", payload: { s: 2 } });

    // Deploy v1 → active.
    const d1 = await deployRecipe({ recipeId: v1.id, machineId: 5, deployedBy: 1 });
    expect(d1.status).toBe("deployed");
    expect((await getActiveRecipe({ code: "R1" }))!.id).toBe(v1.id);

    // Deploy v2 → v2 active, v1 archived, previousRecipeId = v1.
    const d2 = await deployRecipe({ recipeId: v2.id, machineId: 5, deployedBy: 1 });
    expect(d2.previousRecipeId).toBe(v1.id);
    expect((await getActiveRecipe({ code: "R1" }))!.id).toBe(v2.id);
    expect(recipes.find((r) => r.id === v1.id)!.status).toBe("archived");

    // Rollback → re-deploy v1; the rolled-back-from deployment (d2) marked rolled_back.
    const d3 = await rollbackRecipe({ machineId: 5, deployedBy: 1 });
    expect(d3.recipeId).toBe(v1.id);
    expect((await getActiveRecipe({ code: "R1" }))!.id).toBe(v1.id);
    expect(deployments.find((d) => d.id === d2.id)!.status).toBe("rolled_back");
  });
});
