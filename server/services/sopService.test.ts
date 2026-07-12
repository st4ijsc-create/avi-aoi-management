/**
 * doc 44 W6-1 (G5.14) — sopService tests (CRUD + execution confirm-gate) over a
 * table-aware in-memory fake DB (same approach as andonService.test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── drizzle-orm operator mocks → plain predicate descriptors ─────────────────
vi.mock("drizzle-orm", () => {
  const c = (x: any) => (x && x.__col ? x.__col : x);
  const sql: any = (..._a: any[]) => ({ __sql: true });
  return {
    eq: (col: any, v: any) => ({ op: "eq", col: c(col), v }),
    ne: (col: any, v: any) => ({ op: "ne", col: c(col), v }),
    and: (...a: any[]) => ({ op: "and", a }),
    gte: (col: any, v: any) => ({ op: "gte", col: c(col), v }),
    asc: (col: any) => ({ op: "asc", col: c(col) }),
    desc: (col: any) => ({ op: "desc", col: c(col) }),
    inArray: (col: any, arr: any[]) => ({ op: "inArray", col: c(col), arr }),
    sql,
  };
});

vi.mock("../../drizzle/schema", () => {
  const col = (name: string) => ({ __col: name });
  const mk = (name: string, cols: string[]) => ({
    __name: name,
    ...Object.fromEntries(cols.map((x) => [x, col(x)])),
  });
  return {
    sops: mk("sops", ["id", "code", "title", "description", "productModelId", "stationId", "version", "status", "createdBy", "createdAt", "updatedAt"]),
    sopSteps: mk("sop_steps", ["id", "sopId", "stepNo", "text", "mediaRef", "requiresConfirm", "expectedInput", "createdAt"]),
    sopExecutions: mk("sop_executions", ["id", "sopId", "unitSerial", "lineId", "stationId", "operatorId", "status", "stepConfirmations", "startedAt", "finishedAt", "createdAt"]),
  };
});

type Row = Record<string, any>;
const stores: Record<string, Row[]> = { sops: [], sop_steps: [], sop_executions: [] };
const seq: Record<string, number> = { sops: 1, sop_steps: 1, sop_executions: 1 };

function matches(pred: any, row: Row): boolean {
  if (!pred) return true;
  switch (pred.op) {
    case "and": return pred.a.every((p: any) => matches(p, row));
    case "eq": return row[pred.col] === pred.v;
    case "ne": return row[pred.col] !== pred.v;
    case "gte": return new Date(row[pred.col]).getTime() >= new Date(pred.v).getTime();
    case "inArray": return pred.arr.includes(row[pred.col]);
    default: return true;
  }
}

function applyOrder(rows: Row[], order: any): Row[] {
  if (!order) return rows;
  const { col, op } = order;
  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    const cmp = av > bv ? 1 : av < bv ? -1 : 0;
    return op === "desc" ? -cmp : cmp;
  });
}

function project(rows: Row[], proj: any): Row[] {
  if (!proj) return rows.map((r) => ({ ...r }));
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries<any>(proj)) out[k] = v && v.__col ? r[v.__col] : undefined;
    return out;
  });
}

function selectBuilder(proj: any) {
  let table = "";
  let pred: any = null;
  let order: any = null;
  const run = () => {
    const rows = stores[table].filter((r) => matches(pred, r));
    const ordered = applyOrder(rows, order);
    return project(ordered, proj);
  };
  const builder: any = {
    from: (t: any) => { table = t.__name; return builder; },
    where: (p: any) => { pred = p; return builder; },
    orderBy: (o: any) => { order = o; return builder; },
    groupBy: () => builder,
    limit: async (n: number) => run().slice(0, n),
    then: (res: any, rej?: any) => Promise.resolve(run()).then(res, rej),
  };
  return builder;
}

function fakeDb() {
  return {
    select: (proj?: any) => selectBuilder(proj),
    insert: (t: any) => ({
      values: (vals: any) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        const inserted = arr.map((v) => {
          const row = { id: seq[t.__name]++, createdAt: new Date(), updatedAt: new Date(), ...v };
          stores[t.__name].push(row);
          return row;
        });
        return {
          returning: async () => inserted,
          then: (res: any, rej?: any) => Promise.resolve(inserted).then(res, rej),
        };
      },
    }),
    update: (t: any) => ({
      set: (patch: any) => ({
        where: (pred: any) => {
          const updated: Row[] = [];
          for (const r of stores[t.__name]) if (matches(pred, r)) { Object.assign(r, patch); updated.push(r); }
          return {
            returning: async () => updated,
            then: (res: any, rej?: any) => Promise.resolve(updated).then(res, rej),
          };
        },
      }),
    }),
    delete: (t: any) => ({
      where: (pred: any) => {
        stores[t.__name] = stores[t.__name].filter((r) => !matches(pred, r));
        return { then: (res: any, rej?: any) => Promise.resolve([]).then(res, rej) };
      },
    }),
  };
}

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fakeDb()) }));

import {
  createSop,
  getSop,
  updateSop,
  setSopStatus,
  deleteSop,
  startExecution,
  confirmStep,
  finishExecution,
} from "./sopService";

beforeEach(() => {
  stores.sops = [];
  stores.sop_steps = [];
  stores.sop_executions = [];
  seq.sops = 1;
  seq.sop_steps = 1;
  seq.sop_executions = 1;
});

async function seedSop(status: "draft" | "active" = "active") {
  return createSop({
    code: "SOP-CO-X",
    title: "Changeover X",
    version: 1,
    status,
    productModelId: 10,
    stationId: 5,
    steps: [
      { stepNo: 1, text: "Prep", requiresConfirm: false },
      { stepNo: 2, text: "Check jig", requiresConfirm: true },
      { stepNo: 3, text: "Scan reel", requiresConfirm: true, expectedInput: "JIG-X" },
    ],
  });
}

describe("sopService CRUD", () => {
  it("create → get returns sop with ordered steps", async () => {
    const created = await seedSop("draft");
    expect(created.code).toBe("SOP-CO-X");
    expect(created.steps).toHaveLength(3);
    const full = await getSop(created.id);
    expect(full?.steps.map((s) => s.stepNo)).toEqual([1, 2, 3]);
    expect(full?.steps[2].expectedInput).toBe("JIG-X");
  });

  it("update replaces steps + metadata", async () => {
    const s = await seedSop("draft");
    const upd = await updateSop({ id: s.id, title: "Changeover X v2", steps: [{ stepNo: 1, text: "Only step", requiresConfirm: true }] });
    expect(upd?.title).toBe("Changeover X v2");
    expect(upd?.steps).toHaveLength(1);
    expect(upd?.steps[0].requiresConfirm).toBe(true);
  });

  it("activating one version retires other active versions of same code", async () => {
    const a = await createSop({ code: "SOP-A", title: "A v1", version: 1, status: "active" });
    const b = await createSop({ code: "SOP-A", title: "A v2", version: 2, status: "draft" });
    await setSopStatus(b.id, "active");
    const aAfter = await getSop(a.id);
    const bAfter = await getSop(b.id);
    expect(aAfter?.status).toBe("retired");
    expect(bAfter?.status).toBe("active");
  });

  it("delete refuses non-draft and refuses drafts with executions", async () => {
    const active = await seedSop("active");
    expect((await deleteSop(active.id)).code).toBe("NOT_DRAFT");

    const draft = await createSop({ code: "SOP-D", title: "D", version: 1, status: "draft", steps: [{ stepNo: 1, text: "x", requiresConfirm: false }] });
    await startExecution({ sopId: draft.id, operatorId: 1 });
    expect((await deleteSop(draft.id)).code).toBe("HAS_EXECUTIONS");
  });

  it("delete removes a clean draft", async () => {
    const draft = await createSop({ code: "SOP-E", title: "E", version: 1, status: "draft", steps: [] });
    expect((await deleteSop(draft.id)).ok).toBe(true);
    expect(await getSop(draft.id)).toBeNull();
  });
});

describe("sopService execution confirm-gate", () => {
  it("cannot finish until all required steps confirmed; wrong scan is rejected", async () => {
    const sop = await seedSop("active");
    const exec = await startExecution({ sopId: sop.id, operatorId: 7 });
    expect(exec.status).toBe("in_progress");

    // finish blocked at start (2 required steps pending)
    const f0 = await finishExecution(exec.id);
    expect(f0.ok).toBe(false);
    expect(f0.code).toBe("INCOMPLETE");

    // confirm step 2 (no expected input)
    const c2 = await confirmStep(exec.id, 2, null, 7);
    expect(c2.ok).toBe(true);
    expect(c2.progress?.satisfiedRequired).toBe(1);

    // wrong scan on step 3 → INPUT_MISMATCH, not recorded as satisfied
    const bad = await confirmStep(exec.id, 3, "WRONG", 7);
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("INPUT_MISMATCH");
    expect((await finishExecution(exec.id)).code).toBe("INCOMPLETE");

    // correct scan (case/space-insensitive) → satisfied → finish OK
    const good = await confirmStep(exec.id, 3, " jig-x ", 7);
    expect(good.ok).toBe(true);
    expect(good.progress?.complete).toBe(true);

    const done = await finishExecution(exec.id);
    expect(done.ok).toBe(true);
    expect(done.execution?.status).toBe("completed");
    expect(done.execution?.finishedAt).toBeTruthy();
  });

  it("confirmStep on a finished execution is refused", async () => {
    const sop = await createSop({ code: "SOP-N", title: "N", version: 1, status: "active", steps: [{ stepNo: 1, text: "info", requiresConfirm: false }] });
    const exec = await startExecution({ sopId: sop.id, operatorId: 1 });
    const done = await finishExecution(exec.id); // no required steps → completes immediately
    expect(done.ok).toBe(true);
    const late = await confirmStep(exec.id, 1, null, 1);
    expect(late.ok).toBe(false);
    expect(late.code).toBe("NOT_IN_PROGRESS");
  });
});
