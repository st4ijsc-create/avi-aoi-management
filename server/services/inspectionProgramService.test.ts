/**
 * W3-C (doc 27 §2 M9) — inspectionProgramService tests (fake in-memory DB, same
 * technique as server/db/machineRecipe.test.ts):
 *   - createRelease snapshots live points, bumps version 1,2,3…, stable checksum
 *   - SoD: creator approving their OWN release → rejected ("Segregation of duties")
 *   - reject flow: requires reason, only from pending_approval, records rejecter
 *   - release is atomic + supersedes the previously released version of the scope
 *     (exactly ONE released row, previousReleaseId genealogy) — incl. a 2-way race
 *   - diffProgramSnapshots correctness (added/removed/modified, volatile ignored)
 *   - every workflow action writes an audit row (createAuditLog spy)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const products: Row[] = [];
const points: Row[] = [];
const releases: Row[] = [];
const userRows: Row[] = [];
let relSeq = 1;
// Serialization chain modelling the FOR UPDATE lock (see machineRecipe.test.ts).
let txChain: Promise<unknown> = Promise.resolve();
let txCount = 0;

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", __k: col.__name, __v: val }),
  and: (...ps: any[]) => ({ __and: ps }),
  desc: (col: any) => ({ __desc: col.__name }),
  isNull: (col: any) => ({ __op: "null", __k: col.__name }),
  inArray: (col: any, vals: any[]) => ({ __op: "in", __k: col.__name, __vs: vals }),
}));

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__and) return pred.__and.every((p: any) => matches(row, p));
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "null") return row[pred.__k] == null;
  if (pred.__op === "in") return pred.__vs.includes(row[pred.__k]);
  return true;
}

function tableArr(t: any): Row[] {
  switch (t.__table) {
    case "product_models": return products;
    case "measurement_point_defs": return points;
    case "inspection_program_releases": return releases;
    case "users": return userRows;
    default: throw new Error(`unknown fake table ${t?.__table}`);
  }
}

function project(row: Row, cols: any | undefined): Row {
  if (!cols) return row;
  const out: Row = {};
  for (const [k, c] of Object.entries<any>(cols)) out[k] = row[c.__name];
  return out;
}

function makeFakeDb() {
  const builder = (t: any, cols?: any) => {
    let pred: any = null;
    let order: any = null;
    const q: any = {
      where: (p: any) => { pred = p; return q; },
      orderBy: (o: any) => { order = o; return q; },
      limit: async (n: number) => run().slice(0, n),
      for: (_mode?: any) => q, // SELECT … FOR UPDATE — chainable + thenable
      then: undefined as any,
    };
    function run(): Row[] {
      let rows = tableArr(t).filter((r) => matches(r, pred));
      if (order?.__desc) rows = [...rows].sort((a, b) => (b[order.__desc] ?? 0) - (a[order.__desc] ?? 0));
      return rows.map((r) => project(r, cols));
    }
    q.then = (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject);
    return q;
  };
  const db: any = {
    select: (cols?: any) => ({ from: (t: any) => builder(t, cols) }),
    insert: (t: any) => ({
      values: (vals: Row) => ({
        returning: async () => {
          const row = { id: relSeq++, createdAt: new Date(), updatedAt: new Date(), ...vals };
          tableArr(t).push(row);
          return [row];
        },
      }),
    }),
    update: (t: any) => ({
      set: (patch: Row) => ({
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
  // Transactions serialize on one global chain — a faithful model of the
  // per-product FOR UPDATE row lock (concurrent releasers run one-at-a-time).
  db.transaction = (cb: any) => {
    txCount++;
    const run = txChain.then(() => cb(db));
    txChain = run.then(() => undefined, () => undefined);
    return run;
  };
  return db;
}

const auditSpy = vi.fn(async (_: any) => ({ id: 1 }));
// OP7 (doc 31) — createRelease pulls active+approved golden provenance from here.
// Default: none (keeps every other test's snapshot exactly as before). Individual
// tests override with mockResolvedValueOnce to assert goldenRefs make it in.
const goldenRefsSpy = vi.fn(async (_: any) => [] as any[]);

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../db/system", () => ({ createAuditLog: (...args: any[]) => auditSpy(...args) }));
vi.mock("../db/goldenSample", () => ({ listReleaseGoldenRefs: (...args: any[]) => goldenRefsSpy(...args) }));
vi.mock("../../drizzle/schema", () => ({
  productModels: {
    __table: "product_models",
    id: { __name: "id" }, code: { __name: "code" }, pointsConfigVersion: { __name: "pointsConfigVersion" },
  },
  measurementPointDefs: {
    __table: "measurement_point_defs",
    id: { __name: "id" }, productModelId: { __name: "productModelId" },
    machineId: { __name: "machineId" }, deletedAt: { __name: "deletedAt" }, code: { __name: "code" },
  },
  inspectionProgramReleases: {
    __table: "inspection_program_releases",
    id: { __name: "id" }, productModelId: { __name: "productModelId" },
    machineId: { __name: "machineId" }, version: { __name: "version" }, status: { __name: "status" },
  },
  users: { __table: "users", id: { __name: "id" }, name: { __name: "name" } },
}));

import {
  createRelease,
  submitForApproval,
  approveRelease,
  rejectRelease,
  releaseProgram,
  getActiveRelease,
  listReleases,
  compareReleases,
  diffProgramSnapshots,
  computeProgramChecksum,
} from "./inspectionProgramService";

function seedProductWithPoints(productModelId = 10, opts?: { machinePointMachineId?: number }) {
  products.push({ id: productModelId, code: `P-${productModelId}`, pointsConfigVersion: 3 });
  points.push(
    { id: 1, productModelId, machineId: null, deletedAt: null, code: "MP-001", name: "Điểm 1", upperLimit: "5", lowerLimit: "1" },
    { id: 2, productModelId, machineId: null, deletedAt: null, code: "MP-002", name: "Điểm 2", upperLimit: "9", lowerLimit: "2" },
    { id: 3, productModelId, machineId: null, deletedAt: new Date(), code: "MP-DEL", name: "Đã xóa" },
  );
  if (opts?.machinePointMachineId != null) {
    points.push({ id: 4, productModelId, machineId: opts.machinePointMachineId, deletedAt: null, code: "MP-M01", name: "Điểm máy" });
  }
}

beforeEach(() => {
  products.length = 0;
  points.length = 0;
  releases.length = 0;
  userRows.length = 0;
  relSeq = 1;
  txChain = Promise.resolve();
  txCount = 0;
  auditSpy.mockClear();
  goldenRefsSpy.mockClear();
});

describe("inspectionProgramService — createRelease", () => {
  it("snapshots live points (deleted excluded), bumps version 1,2,3", async () => {
    seedProductWithPoints();
    const r1 = await createRelease({ productModelId: 10, createdBy: 1 });
    expect(r1.version).toBe(1);
    expect(r1.status).toBe("draft");
    expect(r1.pointCount).toBe(2); // MP-DEL excluded
    expect((r1.snapshot as any).points.map((p: any) => p.code)).toEqual(["MP-001", "MP-002"]);
    expect(r1.checksum).toHaveLength(64);

    const r2 = await createRelease({ productModelId: 10, createdBy: 1 });
    const r3 = await createRelease({ productModelId: 10, createdBy: 1 });
    expect([r2.version, r3.version]).toEqual([2, 3]);
    // Same point-set → identical checksum (dedup/no-change signal).
    expect(r2.checksum).toBe(r1.checksum);
  });

  it("machine scope: excludes points pinned to OTHER machines; keeps shared + own", async () => {
    seedProductWithPoints(10, { machinePointMachineId: 77 });
    const forMachine = await createRelease({ productModelId: 10, machineId: 77, createdBy: 1 });
    expect((forMachine.snapshot as any).points.map((p: any) => p.code)).toEqual(["MP-001", "MP-002", "MP-M01"]);
    const forOther = await createRelease({ productModelId: 10, machineId: 88, createdBy: 1 });
    expect((forOther.snapshot as any).points.map((p: any) => p.code)).toEqual(["MP-001", "MP-002"]);
  });

  it("refuses an empty program and a missing product", async () => {
    products.push({ id: 20, code: "P-20" }); // no points
    await expect(createRelease({ productModelId: 20, createdBy: 1 })).rejects.toThrow(/điểm đo/);
    await expect(createRelease({ productModelId: 999, createdBy: 1 })).rejects.toThrow(/not found/);
  });
});

describe("inspectionProgramService — OP7 golden-ref provenance in snapshot", () => {
  it("records the product's active+approved golden refs (audit-only; NOT in checksum)", async () => {
    seedProductWithPoints();
    const refs = [
      { id: 7, version: 2, productModelId: 10, productCode: "P-10", recipeCode: null, stationCode: null, roiKey: "MP-001", status: "approved" },
      { id: 9, version: 1, productModelId: 10, productCode: "P-10", recipeCode: null, stationCode: null, roiKey: "MP-002", status: "approved" },
    ];
    goldenRefsSpy.mockResolvedValueOnce(refs);

    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    // Golden fetch was keyed by BOTH productModelId (FK) and productCode (legacy).
    expect(goldenRefsSpy).toHaveBeenCalledWith({ productModelId: 10, productCode: "P-10" });
    expect((r.snapshot as any).goldenRefs).toEqual(refs);

    // A release with NO golden refs (default) has the SAME checksum → goldenRefs are
    // provenance metadata, deliberately excluded from the program identity.
    const r2 = await createRelease({ productModelId: 10, createdBy: 1 });
    expect((r2.snapshot as any).goldenRefs).toEqual([]);
    expect(r2.checksum).toBe(r.checksum);
  });

  it("fail-soft: a golden-fetch error still produces a release with goldenRefs=[]", async () => {
    seedProductWithPoints();
    goldenRefsSpy.mockRejectedValueOnce(new Error("boom"));
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    expect(r.status).toBe("draft");
    expect((r.snapshot as any).goldenRefs).toEqual([]);
  });
});

describe("inspectionProgramService — SoD + workflow guards", () => {
  it("creator approving their OWN release → FORBIDDEN (Segregation of duties)", async () => {
    seedProductWithPoints();
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    await submitForApproval({ releaseId: r.id, userId: 1 });
    await expect(approveRelease({ releaseId: r.id, approvedBy: 1 })).rejects.toThrow(/Segregation of duties/);
  });

  it("a DIFFERENT person approves; approver + note recorded", async () => {
    seedProductWithPoints();
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    await submitForApproval({ releaseId: r.id, userId: 1 });
    const approved = await approveRelease({ releaseId: r.id, approvedBy: 2, note: "OK theo IPC" });
    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe(2);
    expect(approved.approvalNote).toBe("OK theo IPC");
  });

  it("state guards: submit only from draft; approve/reject only from pending", async () => {
    seedProductWithPoints();
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    await expect(approveRelease({ releaseId: r.id, approvedBy: 2 })).rejects.toThrow(/chờ duyệt/);
    await submitForApproval({ releaseId: r.id, userId: 1 });
    await expect(submitForApproval({ releaseId: r.id, userId: 1 })).rejects.toThrow(/nháp/);
  });

  it("reject flow: reason REQUIRED, records rejecter, blocks later approve", async () => {
    seedProductWithPoints();
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    await submitForApproval({ releaseId: r.id, userId: 1 });
    await expect(rejectRelease({ releaseId: r.id, rejectedBy: 2, reason: "  " })).rejects.toThrow(/lý do/);
    const rejected = await rejectRelease({ releaseId: r.id, rejectedBy: 2, reason: "Thiếu điểm đo BGA" });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectedBy).toBe(2);
    expect(rejected.rejectReason).toBe("Thiếu điểm đo BGA");
    await expect(approveRelease({ releaseId: r.id, approvedBy: 2 })).rejects.toThrow(/chờ duyệt/);
  });

  it("release refuses an un-approved (draft/pending) release", async () => {
    seedProductWithPoints();
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    await expect(releaseProgram({ releaseId: r.id, releasedBy: 2 })).rejects.toThrow(/đã duyệt/);
  });
});

describe("inspectionProgramService — atomic release/supersede", () => {
  async function approvedRelease(productModelId = 10): Promise<number> {
    const r = await createRelease({ productModelId, createdBy: 1 });
    await submitForApproval({ releaseId: r.id, userId: 1 });
    await approveRelease({ releaseId: r.id, approvedBy: 2 });
    return r.id;
  }

  it("release supersedes the previously released version (genealogy kept)", async () => {
    seedProductWithPoints();
    const v1 = await approvedRelease();
    const first = await releaseProgram({ releaseId: v1, releasedBy: 2 });
    expect(first.status).toBe("released");
    expect(first.previousReleaseId).toBeNull();

    const v2 = await approvedRelease();
    const second = await releaseProgram({ releaseId: v2, releasedBy: 2 });
    expect(second.status).toBe("released");
    expect(second.previousReleaseId).toBe(v1);

    const releasedRows = releases.filter((r) => r.status === "released");
    expect(releasedRows).toHaveLength(1);
    expect(releasedRows[0].id).toBe(v2);
    const superseded = releases.find((r) => r.id === v1);
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.supersededAt).toBeInstanceOf(Date);
    expect(txCount).toBeGreaterThanOrEqual(2); // both releases ran in a tx
  });

  it("two CONCURRENT releases of the same product end with exactly ONE released", async () => {
    seedProductWithPoints();
    const a = await approvedRelease();
    const b = await approvedRelease();
    await Promise.all([
      releaseProgram({ releaseId: a, releasedBy: 2 }),
      releaseProgram({ releaseId: b, releasedBy: 3 }),
    ]);
    const releasedRows = releases.filter((r) => r.status === "released");
    expect(releasedRows).toHaveLength(1); // serialized under the code lock
  });

  it("machine-specific and product-level scopes do NOT supersede each other", async () => {
    seedProductWithPoints(10, { machinePointMachineId: 77 });
    const productLevel = await approvedRelease();
    await releaseProgram({ releaseId: productLevel, releasedBy: 2 });

    const rm = await createRelease({ productModelId: 10, machineId: 77, createdBy: 1 });
    await submitForApproval({ releaseId: rm.id, userId: 1 });
    await approveRelease({ releaseId: rm.id, approvedBy: 2 });
    await releaseProgram({ releaseId: rm.id, releasedBy: 2 });

    const releasedRows = releases.filter((r) => r.status === "released");
    expect(releasedRows).toHaveLength(2); // one per scope

    // getActiveRelease resolves exact machine scope first, falls back to product.
    const forMachine = await getActiveRelease({ productModelId: 10, machineId: 77 });
    expect(forMachine?.id).toBe(rm.id);
    const fallback = await getActiveRelease({ productModelId: 10, machineId: 999 });
    expect(fallback?.id).toBe(productLevel);
  });
});

describe("inspectionProgramService — diff", () => {
  const snap = (points: Row[]) => ({ points });

  it("detects added/removed/modified and ignores volatile fields", () => {
    const a = snap([
      { code: "MP-001", name: "A", upperLimit: "5", id: 1, updatedAt: "x", lastModifiedAt: "x" },
      { code: "MP-002", name: "B", upperLimit: "9" },
      { code: "MP-003", name: "C" },
    ]);
    const b = snap([
      { code: "MP-001", name: "A", upperLimit: "6", id: 99, updatedAt: "y", lastModifiedAt: "y" },
      { code: "MP-002", name: "B", upperLimit: "9" },
      { code: "MP-004", name: "D" },
    ]);
    const d = diffProgramSnapshots(a, b);
    expect(d.added.map((p) => p.code)).toEqual(["MP-004"]);
    expect(d.removed.map((p) => p.code)).toEqual(["MP-003"]);
    expect(d.modified).toHaveLength(1);
    expect(d.modified[0].code).toBe("MP-001");
    expect(d.modified[0].changes).toEqual([{ field: "upperLimit", before: "5", after: "6" }]);
    expect(d.unchangedCount).toBe(1);
    expect(d.identical).toBe(false);
  });

  it("identical snapshots (incl. key order) → identical=true; checksum stable", () => {
    const a = snap([{ code: "MP-001", upperLimit: "5", lowerLimit: "1" }]);
    const b = snap([{ lowerLimit: "1", code: "MP-001", upperLimit: "5" }]);
    expect(diffProgramSnapshots(a, b).identical).toBe(true);
    expect(computeProgramChecksum((a as any).points)).toBe(computeProgramChecksum((b as any).points));
  });

  it("compareReleases refuses cross-product compare, diffs same-product", async () => {
    seedProductWithPoints(10);
    seedProductWithPoints(11);
    const r10 = await createRelease({ productModelId: 10, createdBy: 1 });
    const r11 = await createRelease({ productModelId: 11, createdBy: 1 });
    await expect(compareReleases(r10.id, r11.id)).rejects.toThrow(/cùng một sản phẩm/);

    points.find((p) => p.code === "MP-002" && p.productModelId === 10)!.upperLimit = "12";
    const r10b = await createRelease({ productModelId: 10, createdBy: 1 });
    const cmp = await compareReleases(r10.id, r10b.id);
    expect(cmp.diff.modified.map((m) => m.code)).toEqual(["MP-002"]);
    expect(cmp.a.version).toBe(1);
    expect(cmp.b.version).toBe(2);
  });
});

describe("inspectionProgramService — audit + list", () => {
  it("every workflow action writes an audit row with the right action name", async () => {
    seedProductWithPoints();
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    await submitForApproval({ releaseId: r.id, userId: 1 });
    await approveRelease({ releaseId: r.id, approvedBy: 2 });
    await releaseProgram({ releaseId: r.id, releasedBy: 2 });

    const actions = auditSpy.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual([
      "inspection_program.release.create",
      "inspection_program.release.submit",
      "inspection_program.release.approve",
      "inspection_program.release.release",
    ]);
    for (const call of auditSpy.mock.calls) {
      expect(call[0].entityType).toBe("inspection_program_release");
      expect(call[0].entityId).toBe(r.id);
    }
  });

  it("audit failure is fail-soft (op still succeeds)", async () => {
    seedProductWithPoints();
    auditSpy.mockRejectedValueOnce(new Error("audit db down"));
    const r = await createRelease({ productModelId: 10, createdBy: 1 });
    expect(r.status).toBe("draft"); // create survived the audit failure
  });

  it("listReleases resolves actor names and orders newest version first", async () => {
    seedProductWithPoints();
    userRows.push({ id: 1, name: "Người tạo" }, { id: 2, name: "Người duyệt" });
    const r1 = await createRelease({ productModelId: 10, createdBy: 1 });
    await submitForApproval({ releaseId: r1.id, userId: 1 });
    await approveRelease({ releaseId: r1.id, approvedBy: 2 });
    await createRelease({ productModelId: 10, createdBy: 1 });

    const rows = await listReleases(10);
    expect(rows.map((r) => r.version)).toEqual([2, 1]);
    expect(rows[1].createdByName).toBe("Người tạo");
    expect(rows[1].approvedByName).toBe("Người duyệt");
    expect(rows[0].approvedByName).toBeNull();
  });
});
