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
// W2-6: serialization chain + counter modelling the FOR UPDATE row lock in the fake.
let txChain: Promise<unknown> = Promise.resolve();
let txCount = 0;

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __k: col.__name, __v: val, __op: "eq" }),
  and: (...ps: any[]) => ({ __and: ps }),
  desc: (col: any) => ({ __desc: col.__name }),
  // listRecipeVersions left-joins users cho createdByName — trả chính bảng làm "cột".
  getTableColumns: (t: any) => t,
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
      // listRecipeVersions left-joins users for createdByName — no-op trong fake.
      leftJoin: (_t: any, _on: any) => q,
      limit: async (_n: number) => run().slice(0, _n),
      // SELECT … FOR UPDATE (row lock) — no-op in the fake, still chainable + thenable.
      for: (_s?: any, _c?: any) => q,
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
  const db: any = {
    select: (_cols?: any) => ({ from: (t: any) => builder(t) }),
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
        // where() is awaitable (existing callers) AND supports .returning() (approveRecipe, W2-9).
        where: (pred: any) => {
          const apply = () => {
            const changed: Row[] = [];
            for (const r of tableArr(t)) if (matches(r, pred)) { Object.assign(r, patch); changed.push(r); }
            return changed;
          };
          return {
            returning: async () => apply(),
            then: (resolve: any, reject: any) => Promise.resolve().then(apply).then(resolve, reject),
          };
        },
      }),
    }),
  };
  // deploy/rollback (W2-6) run inside db.transaction(). The fake SERIALIZES concurrent
  // transactions on one global chain — a faithful model of the code-row FOR UPDATE lock,
  // which forces concurrent promoters of the same code to run one-at-a-time. This lets a
  // race test (two overlapping deploys) resolve deterministically to a single active row.
  db.transaction = (cb: any) => {
    txCount++;
    const run = txChain.then(() => cb(db));
    txChain = run.then(() => undefined, () => undefined);
    return run;
  };
  return db;
}

vi.mock("./connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../drizzle/schema", () => ({
  machineRecipes: {
    __table: "machine_recipes",
    id: { __name: "id" }, code: { __name: "code" }, status: { __name: "status" },
    machineId: { __name: "machineId" }, version: { __name: "version" }, createdBy: { __name: "createdBy" },
  },
  recipeDeployments: {
    __table: "recipe_deployments",
    id: { __name: "id" }, machineId: { __name: "machineId" }, deployedAt: { __name: "deployedAt" },
  },
  users: { __table: "users", id: { __name: "id" }, name: { __name: "name" } },
}));

import { createRecipe, approveRecipe, deployRecipe, rollbackRecipe, computeChecksum, listRecipeVersions, getActiveRecipe, setGoldenRecipe } from "./machineRecipe";

beforeEach(() => {
  recipes.length = 0;
  deployments.length = 0;
  rSeq = 1;
  dSeq = 1;
  txChain = Promise.resolve();
  txCount = 0;
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
    // W2-9 — recipe phải được duyệt trước khi deploy.
    await approveRecipe({ recipeId: v1.id, approvedBy: 9 });
    await approveRecipe({ recipeId: v2.id, approvedBy: 9 });

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

// ════════════════════════════════════════════════════════════════════════════
// W5-22 (doc 25 (a)) — Golden/master flag.
// ════════════════════════════════════════════════════════════════════════════
describe("machineRecipe — golden flag (W5-22a)", () => {
  it("setGoldenRecipe marks then unmarks isGolden and returns the row", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 } });
    expect(recipes.find((r) => r.id === v1.id)!.isGolden ?? false).toBeFalsy();
    const marked = await setGoldenRecipe(v1.id, true);
    expect(marked.isGolden).toBe(true);
    expect(recipes.find((r) => r.id === v1.id)!.isGolden).toBe(true);
    const unmarked = await setGoldenRecipe(v1.id, false);
    expect(unmarked.isGolden).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W2-6 (doc 25 T5) — transaction + row-lock atomicity of the promote steps.
//
// The fake models the code-row FOR UPDATE lock by SERIALIZING transactions; real
// row-locking + rollback-on-crash is enforced by Postgres + migration 0164's partial
// unique index (uq_machine_recipes_active_code) and can only be fully proven there.
// ════════════════════════════════════════════════════════════════════════════
describe("machineRecipe — atomic promote (W2-6)", () => {
  it("deployRecipe runs inside a transaction and takes the code FOR UPDATE lock", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 } });
    await approveRecipe({ recipeId: v1.id, approvedBy: 9 }); // W2-9 — approve trước deploy
    txCount = 0;
    await deployRecipe({ recipeId: v1.id, machineId: 5, deployedBy: 1 });
    expect(txCount).toBe(1); // wrapped in exactly one transaction
  });

  it("two concurrent deploys of the same code end with EXACTLY ONE active version", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 } });
    const v2 = await createRecipe({ code: "R1", name: "v2", payload: { s: 2 } });
    await approveRecipe({ recipeId: v1.id, approvedBy: 9 });
    await approveRecipe({ recipeId: v2.id, approvedBy: 9 });

    // Fire both deploys "at once" — the serialized transaction (models the row lock)
    // orders them, so they can NEVER both create an active version.
    await Promise.all([
      deployRecipe({ recipeId: v1.id, machineId: 5, deployedBy: 1 }),
      deployRecipe({ recipeId: v2.id, machineId: 5, deployedBy: 1 }),
    ]);

    const active = recipes.filter((r) => r.code === "R1" && r.status === "active");
    expect(active).toHaveLength(1); // invariant: one active per code
  });

  it("rollback is atomic: re-deploys previous AND marks the prior deployment in ONE tx", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 } });
    const v2 = await createRecipe({ code: "R1", name: "v2", payload: { s: 2 } });
    await approveRecipe({ recipeId: v1.id, approvedBy: 9 });
    await approveRecipe({ recipeId: v2.id, approvedBy: 9 });
    await deployRecipe({ recipeId: v1.id, machineId: 5, deployedBy: 1 });
    const d2 = await deployRecipe({ recipeId: v2.id, machineId: 5, deployedBy: 1 });

    txCount = 0;
    const d3 = await rollbackRecipe({ machineId: 5, deployedBy: 1 });
    expect(txCount).toBe(1); // whole rollback in a single transaction (no nested 2nd tx)
    // Both effects present together: v1 re-active AND d2 marked rolled_back.
    expect(d3.recipeId).toBe(v1.id);
    expect(recipes.filter((r) => r.code === "R1" && r.status === "active")).toHaveLength(1);
    expect((await getActiveRecipe({ code: "R1" }))!.id).toBe(v1.id);
    expect(deployments.find((d) => d.id === d2.id)!.status).toBe("rolled_back");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W2-9 (doc 25 T6) — second-approver (segregation of duties).
// ════════════════════════════════════════════════════════════════════════════
describe("machineRecipe — second-approver (W2-9)", () => {
  it("approveRecipe rejects self-approval (creator === approver)", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 }, createdBy: 7 });
    await expect(approveRecipe({ recipeId: v1.id, approvedBy: 7 })).rejects.toThrow(/[Ss]egregation of duties/);
    // Không đánh dấu approved khi bị chặn.
    expect(recipes.find((r) => r.id === v1.id)!.approvedBy ?? null).toBeNull();
  });

  it("approveRecipe allows a DIFFERENT person and records approver + note", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 }, createdBy: 7 });
    const approved = await approveRecipe({ recipeId: v1.id, approvedBy: 8, note: "OK" });
    expect(approved.approvedBy).toBe(8);
    expect(approved.approvalNote).toBe("OK");
    expect(approved.approvedAt).toBeInstanceOf(Date);
  });

  it("deployRecipe refuses an UN-approved recipe", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 }, createdBy: 7 });
    await expect(deployRecipe({ recipeId: v1.id, machineId: 5, deployedBy: 1 })).rejects.toThrow(/trình duyệt/);
    // Không có active version nào được tạo.
    expect(recipes.filter((r) => r.status === "active")).toHaveLength(0);
  });

  it("deployRecipe proceeds once approved by a different person", async () => {
    const v1 = await createRecipe({ code: "R1", name: "v1", payload: { s: 1 }, createdBy: 7 });
    await approveRecipe({ recipeId: v1.id, approvedBy: 8 });
    const d1 = await deployRecipe({ recipeId: v1.id, machineId: 5, deployedBy: 1 });
    expect(d1.status).toBe("deployed");
    expect((await getActiveRecipe({ code: "R1" }))!.id).toBe(v1.id);
  });
});
