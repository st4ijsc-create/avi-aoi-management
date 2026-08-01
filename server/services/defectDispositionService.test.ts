/**
 * W5-B (doc 27 §5 gap F2) — defect disposition lifecycle, REAL-DB integration test.
 *
 * Runs against the isolated test DB (vitest.setup.ts forces DATABASE_URL to
 * <db>_test). Covers:
 *   1. create → open + serialNumber denormalised + audit row
 *   2. full legal lifecycle open → in_repair → repaired → re_inspect_pending →
 *      closed, each step audit-logged with from/to
 *   3. illegal transitions → DispositionError CONFLICT (incl. closed = terminal)
 *   4. soft-ref validation (unknown inspection / WO / measurement result)
 *   5. re-inspect linkage: 2–3 inspections with the SAME serial → the LATEST
 *      later one is returned; the newest inspection reports found=false
 *
 * Honest skip: when the test DB is unreachable, migration 0183 has not been
 * applied, or no machine exists to hang inspections on (product_inspections
 * has a REAL FK to machines), the suite is skipped — not silently green.
 */
import { describe, it, expect, afterAll } from "vitest";
import { sql, eq, like } from "drizzle-orm";
import { getDb } from "../db/connection";
import {
  createDisposition,
  updateDispositionStatus,
  listDispositionsByInspection,
  countOpenDispositions,
  getReInspectStatus,
  listRepairQueue,
  listDispositionsBySerial,
  getRepairStats,
  computeRepairDurationsMs,
  DispositionError,
  LEGAL_TRANSITIONS,
  type DispositionTransitionEvent,
} from "./defectDispositionService";
// W8-C: the repair-bench router surface is tested HERE (same file) deliberately —
// tests within one file run sequentially, so the global-delta assertions below
// never race with the disposition writes of the router tests (vitest runs FILES
// in parallel workers; this file is the single writer of defect_dispositions).
import { defectDispositionRouter } from "../routers/defectDispositionRouter";
import {
  defectDispositions,
  productInspections,
  auditLogs,
  machines,
} from "../../drizzle/schema";

const PREFIX = `W5B-F2-${Date.now()}`;
const ACTOR = { id: 1, name: "W5B test actor" };

function asRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

// Top-level guard: DB reachable + 0183 applied + a machine to attach inspections to.
const db = await getDb();
let ready = false;
let machineId = 0;
if (db) {
  try {
    const res = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'defect_dispositions'
    `);
    if (asRows(res).length > 0) {
      const [m] = await db.select({ id: machines.id }).from(machines).limit(1);
      if (m) {
        machineId = m.id;
        ready = true;
      }
    }
  } catch {
    ready = false;
  }
}
if (!ready) {
  // eslint-disable-next-line no-console
  console.warn("[defectDispositionService.test] SKIP — test DB unreachable, 0183 not applied, or no machine present.");
}

async function seedInspection(serial: string, time: Date, result: "OK" | "NG" | "NTF" = "NG") {
  const [row] = await db!
    .insert(productInspections)
    .values({
      machineId,
      serialNumber: serial,
      overallResult: result,
      originalResult: result === "NTF" ? "NG" : result,
      inspectionTime: time,
    })
    .returning();
  return row;
}

async function auditRowsFor(action: string, entityId: number) {
  return db!
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, action))
    .then((rows) => rows.filter((r) => r.entityId === entityId));
}

describe.skipIf(!ready)("defectDispositionService — repair loop (0183, real DB)", () => {
  afterAll(async () => {
    if (!db) return;
    await db.delete(defectDispositions).where(like(defectDispositions.serialNumber, `${PREFIX}%`));
    await db.delete(auditLogs).where(like(auditLogs.entityName, `${PREFIX}%`));
    await db.delete(productInspections).where(like(productInspections.serialNumber, `${PREFIX}%`));
  });

  it("create: validates the inspection, denormalises serial, opens at 'open', audit-logs", async () => {
    const insp = await seedInspection(`${PREFIX}-create`, new Date());
    const before = await countOpenDispositions();

    const row = await createDisposition(
      { inspectionId: insp.id, disposition: "rework", note: "bridge on U12", assignee: null },
      ACTOR,
    );
    expect(row.status).toBe("open");
    expect(row.disposition).toBe("rework");
    expect(row.serialNumber).toBe(`${PREFIX}-create`);
    expect(row.createdBy).toBe(ACTOR.id);

    const audits = await auditRowsFor("defectDisposition.create", row.id);
    expect(audits.length).toBe(1);
    const details = JSON.parse(audits[0].details ?? "{}");
    expect(details.inspectionId).toBe(insp.id);
    expect(details.disposition).toBe("rework");

    expect(await countOpenDispositions()).toBe(before + 1);

    const listed = await listDispositionsByInspection(insp.id);
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(row.id);
  });

  it("walks the FULL legal lifecycle, audit-logging every transition with from/to", async () => {
    const insp = await seedInspection(`${PREFIX}-lifecycle`, new Date());
    const row = await createDisposition({ inspectionId: insp.id, disposition: "repair" }, ACTOR);

    const path = ["in_repair", "repaired", "re_inspect_pending", "closed"] as const;
    let current = row;
    for (const status of path) {
      current = await updateDispositionStatus({ id: row.id, status }, ACTOR);
      expect(current.status).toBe(status);
    }

    const audits = await auditRowsFor("defectDisposition.updateStatus", row.id);
    expect(audits.length).toBe(path.length);
    const hops = audits
      .map((a) => JSON.parse(a.details ?? "{}"))
      .map((d) => `${d.from}->${d.to}`)
      .sort();
    expect(hops).toEqual(
      ["open->in_repair", "in_repair->repaired", "repaired->re_inspect_pending", "re_inspect_pending->closed"].sort(),
    );
  });

  it("rejects ILLEGAL transitions with CONFLICT (incl. closed = terminal)", async () => {
    const insp = await seedInspection(`${PREFIX}-illegal`, new Date());
    const row = await createDisposition({ inspectionId: insp.id, disposition: "scrap" }, ACTOR);

    // open → repaired skips in_repair — illegal.
    await expect(updateDispositionStatus({ id: row.id, status: "repaired" }, ACTOR))
      .rejects.toMatchObject({ name: "DispositionError", code: "CONFLICT" });

    // scrap-style direct close IS legal (open → closed)…
    const closed = await updateDispositionStatus({ id: row.id, status: "closed" }, ACTOR);
    expect(closed.status).toBe("closed");

    // …and closed is terminal: any way out is CONFLICT.
    for (const status of ["open", "in_repair", "re_inspect_pending"] as const) {
      await expect(updateDispositionStatus({ id: row.id, status }, ACTOR))
        .rejects.toMatchObject({ name: "DispositionError", code: "CONFLICT" });
    }

    // Sanity: the transition table itself declares closed terminal.
    expect(LEGAL_TRANSITIONS.closed).toEqual([]);
  });

  it("re_inspect_pending → in_repair (re-inspection failed) is legal", async () => {
    const insp = await seedInspection(`${PREFIX}-backloop`, new Date());
    const row = await createDisposition({ inspectionId: insp.id, disposition: "rework" }, ACTOR);
    await updateDispositionStatus({ id: row.id, status: "in_repair" }, ACTOR);
    await updateDispositionStatus({ id: row.id, status: "repaired" }, ACTOR);
    await updateDispositionStatus({ id: row.id, status: "re_inspect_pending" }, ACTOR);
    const back = await updateDispositionStatus({ id: row.id, status: "in_repair" }, ACTOR);
    expect(back.status).toBe("in_repair");
  });

  it("validates soft references honestly (unknown inspection / WO / measurement result)", async () => {
    // Unknown inspection.
    await expect(createDisposition({ inspectionId: 2147480000, disposition: "rework" }, ACTOR))
      .rejects.toMatchObject({ name: "DispositionError", code: "NOT_FOUND" });

    const insp = await seedInspection(`${PREFIX}-refs`, new Date());

    // Unknown work order (LINK-ONLY soft ref must still exist).
    await expect(createDisposition(
      { inspectionId: insp.id, disposition: "repair", workOrderId: 2147480000 },
      ACTOR,
    )).rejects.toMatchObject({ name: "DispositionError", code: "NOT_FOUND" });

    // Unknown measurement result.
    await expect(createDisposition(
      { inspectionId: insp.id, disposition: "repair", measurementResultId: 2147480000 },
      ACTOR,
    )).rejects.toMatchObject({ name: "DispositionError", code: "NOT_FOUND" });

    // DispositionError is a real Error subclass (router maps its code).
    try {
      await createDisposition({ inspectionId: 2147480000, disposition: "rework" }, ACTOR);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DispositionError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("re-inspect linkage: LATEST later same-serial inspection wins; newest reports found=false", async () => {
    const serial = `${PREFIX}-reinspect`;
    const t0 = new Date(Date.now() - 3 * 3600_000);
    const first = await seedInspection(serial, t0, "NG");
    const second = await seedInspection(serial, new Date(t0.getTime() + 3600_000), "NG");
    const third = await seedInspection(serial, new Date(t0.getTime() + 2 * 3600_000), "OK");

    const fromFirst = await getReInspectStatus(first.id);
    expect(fromFirst.found).toBe(true);
    expect(fromFirst.laterCount).toBe(2);
    expect(fromFirst.latest?.id).toBe(third.id);
    expect(fromFirst.latest?.overallResult).toBe("OK");

    const fromSecond = await getReInspectStatus(second.id);
    expect(fromSecond.found).toBe(true);
    expect(fromSecond.laterCount).toBe(1);
    expect(fromSecond.latest?.id).toBe(third.id);

    const fromThird = await getReInspectStatus(third.id);
    expect(fromThird.found).toBe(false);
    expect(fromThird.laterCount).toBe(0);
  });

  it("countOpen drops when a disposition closes; listByInspection is newest-first", async () => {
    const insp = await seedInspection(`${PREFIX}-count`, new Date());
    const a = await createDisposition({ inspectionId: insp.id, disposition: "rework", note: "first" }, ACTOR);
    const b = await createDisposition({ inspectionId: insp.id, disposition: "repair", note: "second" }, ACTOR);

    const listed = await listDispositionsByInspection(insp.id);
    expect(listed.map((r) => r.id)).toEqual([b.id, a.id]); // newest first

    const before = await countOpenDispositions();
    await updateDispositionStatus({ id: a.id, status: "closed" }, ACTOR);
    expect(await countOpenDispositions()).toBe(before - 1);

    // Closed rows stay in the per-inspection history (ledger, not a queue).
    const after = await listDispositionsByInspection(insp.id);
    expect(after.length).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// W8-C (doc 27 §9 V10 / §13 item 8) — repair-station additions.
// Same file as the W5-B suite ON PURPOSE: this keeps every writer of
// defect_dispositions sequential (vitest parallelises FILES), so the global
// delta assertions above stay deterministic. No migration involved — stats
// derive from the audit ledger already written on every transition (0193 NOT
// needed, verified).
// ════════════════════════════════════════════════════════════════════════════

// ── Pure math (no DB) ─────────────────────────────────────────────────────────

function ev(entityId: number, to: string, atMs: number, from = ""): DispositionTransitionEvent {
  return { entityId, from, to, at: new Date(atMs) };
}

describe("computeRepairDurationsMs (pure, W8-C)", () => {
  it("pairs in_repair → repaired and returns the duration", () => {
    expect(computeRepairDurationsMs([ev(1, "in_repair", 1_000), ev(1, "repaired", 61_000)]))
      .toEqual([60_000]);
  });

  it("counts each re-loop (re_inspect fail → in_repair → repaired) as its own pair", () => {
    const durations = computeRepairDurationsMs([
      ev(1, "in_repair", 0),
      ev(1, "repaired", 10 * 60_000),          // 10 min
      ev(1, "re_inspect_pending", 11 * 60_000),
      ev(1, "in_repair", 20 * 60_000),          // re-inspect NG → back to repair
      ev(1, "repaired", 25 * 60_000),           // 5 min
    ]);
    expect(durations).toEqual([10 * 60_000, 5 * 60_000]);
  });

  it("ignores unpaired events — still-in-repair and orphan repaired produce nothing", () => {
    expect(computeRepairDurationsMs([ev(1, "in_repair", 0)])).toEqual([]);
    expect(computeRepairDurationsMs([ev(2, "repaired", 0)])).toEqual([]);
    expect(computeRepairDurationsMs([ev(3, "closed", 0)])).toEqual([]);
  });

  it("sorts per entity — out-of-order input still pairs correctly", () => {
    expect(computeRepairDurationsMs([ev(1, "repaired", 30_000), ev(1, "in_repair", 10_000)]))
      .toEqual([20_000]);
  });

  it("keeps entities isolated — pairs never cross disposition ids", () => {
    const durations = computeRepairDurationsMs([
      ev(1, "in_repair", 0),
      ev(2, "repaired", 5_000),
      ev(2, "in_repair", 1_000),
      ev(1, "repaired", 60_000),
    ]);
    expect(durations.sort((a, b) => a - b)).toEqual([4_000, 60_000]);
  });

  it("empty input → empty output (no fabricated durations)", () => {
    expect(computeRepairDurationsMs([])).toEqual([]);
  });
});

// ── Real-DB: queue / serial / stats (same guard + machine as the suite above) ─

const PREFIX8 = `W8C-V10-${Date.now()}`;

describe.skipIf(!ready)("repair-station service additions (real DB, W8-C)", () => {
  afterAll(async () => {
    if (!db) return;
    await db.delete(defectDispositions).where(like(defectDispositions.serialNumber, `${PREFIX8}%`));
    await db.delete(auditLogs).where(like(auditLogs.entityName, `${PREFIX8}%`));
    await db.delete(productInspections).where(like(productInspections.serialNumber, `${PREFIX8}%`));
  });

  async function seed8(serial: string, time = new Date()) {
    return seedInspection(serial, time);
  }

  it("listRepairQueue: oldest first, enriched with machine context, filterable", async () => {
    const older = await seed8(`${PREFIX8}-Q1`, new Date(Date.now() - 3600_000));
    const newer = await seed8(`${PREFIX8}-Q2`);
    const a = await createDisposition({ inspectionId: older.id, disposition: "repair" }, ACTOR);
    const b = await createDisposition({ inspectionId: newer.id, disposition: "rework" }, ACTOR);

    const queue = await listRepairQueue({ machineId, limit: 500 });
    const mine = queue.filter((r) => r.serialNumber?.startsWith(PREFIX8));
    expect(mine.map((r) => r.id)).toEqual([a.id, b.id]); // FIFO — a was created first

    // Machine context is joined in (soft ref → LEFT joins).
    expect(mine[0].machineId).toBe(machineId);
    expect(mine[0].machineName).toBeTruthy();

    // Type filter applies server-side.
    const reworkOnly = await listRepairQueue({ machineId, disposition: "rework", limit: 500 });
    expect(reworkOnly.filter((r) => r.serialNumber?.startsWith(PREFIX8)).map((r) => r.id)).toEqual([b.id]);

    // Closed rows leave the queue.
    await updateDispositionStatus({ id: b.id, status: "closed" }, ACTOR);
    const after = await listRepairQueue({ machineId, limit: 500 });
    expect(after.filter((r) => r.serialNumber?.startsWith(PREFIX8)).map((r) => r.id)).toEqual([a.id]);
  });

  it("listDispositionsBySerial: exact serial match, newest first, includes closed history", async () => {
    const serial = `${PREFIX8}-SCAN`;
    const insp = await seed8(serial);
    const first = await createDisposition({ inspectionId: insp.id, disposition: "scrap" }, ACTOR);
    await updateDispositionStatus({ id: first.id, status: "closed" }, ACTOR);
    const second = await createDisposition({ inspectionId: insp.id, disposition: "repair" }, ACTOR);

    const rows = await listDispositionsBySerial(serial);
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id]); // newest first
    expect(rows[1].status).toBe("closed"); // history stays visible

    expect(await listDispositionsBySerial(`${PREFIX8}-NO-SUCH-SERIAL`)).toEqual([]);
    expect(await listDispositionsBySerial("   ")).toEqual([]);
  });

  it("getRepairStats: repaired/closed today, pair count and lanes move by the expected deltas", async () => {
    const before = await getRepairStats();

    const insp = await seed8(`${PREFIX8}-STATS`);
    const d = await createDisposition({ inspectionId: insp.id, disposition: "repair" }, ACTOR);

    const afterCreate = await getRepairStats();
    expect(afterCreate.openByLane.open).toBe(before.openByLane.open + 1);

    await updateDispositionStatus({ id: d.id, status: "in_repair" }, ACTOR);
    await updateDispositionStatus({ id: d.id, status: "repaired" }, ACTOR);

    const afterRepair = await getRepairStats();
    expect(afterRepair.repairedToday).toBe(before.repairedToday + 1);
    expect(afterRepair.repairPairCount).toBe(before.repairPairCount + 1);
    expect(afterRepair.openByLane.repaired).toBe(before.openByLane.repaired + 1);
    expect(afterRepair.openByLane.open).toBe(before.openByLane.open);
    // A completed pair exists → the average is a number (may round to 0.0 min in-test).
    expect(afterRepair.avgRepairMinutes).not.toBeNull();
    expect(afterRepair.oldestOpenMinutes).not.toBeNull();
    expect(afterRepair.windowDays).toBe(7);

    await updateDispositionStatus({ id: d.id, status: "closed" }, ACTOR);
    const afterClose = await getRepairStats();
    expect(afterClose.closedToday).toBe(before.closedToday + 1);
    expect(afterClose.openByLane.repaired).toBe(before.openByLane.repaired);
  });
});

// ── Real-DB: router repair-bench surface (transition RBAC + reads) ────────────

const maintenanceCtx = { user: { id: 11, role: "maintenance", name: "Bench Tech" } } as any;
const operatorCtx = { user: { id: 12, role: "operator", name: "Line Op" } } as any;
const viewerCtx = { user: { id: 13, role: "viewer", name: "Viewer" } } as any;
const adminNo2faCtx = { user: { id: 14, role: "admin", name: "Admin", twoFactorEnabled: false } } as any;
const qualityCtx = { user: { id: 15, role: "quality_inspector", name: "QC", twoFactorEnabled: true } } as any;

describe.skipIf(!ready)("defectDisposition.transition router (repair-bench RBAC, W8-C)", () => {
  const PREFIX_RT = `W8C-RT-${Date.now()}`;

  afterAll(async () => {
    if (!db) return;
    await db.delete(defectDispositions).where(like(defectDispositions.serialNumber, `${PREFIX_RT}%`));
    await db.delete(auditLogs).where(like(auditLogs.entityName, `${PREFIX_RT}%`));
    await db.delete(productInspections).where(like(productInspections.serialNumber, `${PREFIX_RT}%`));
  });

  async function seedRouterDisposition(suffix: string) {
    const insp = await seedInspection(`${PREFIX_RT}-${suffix}`, new Date());
    const qc = defectDispositionRouter.createCaller(qualityCtx);
    return qc.create({ inspectionId: insp.id, disposition: "repair" });
  }

  it("maintenance walks the repair path; operator can continue it", async () => {
    const d = await seedRouterDisposition("walk");

    const bench = defectDispositionRouter.createCaller(maintenanceCtx);
    const started = await bench.transition({ id: d.id, status: "in_repair", note: "bench 3" });
    expect(started.status).toBe("in_repair");

    const op = defectDispositionRouter.createCaller(operatorCtx);
    const repaired = await op.transition({ id: d.id, status: "repaired" });
    expect(repaired.status).toBe("repaired");

    const sent = await bench.transition({ id: d.id, status: "re_inspect_pending" });
    expect(sent.status).toBe("re_inspect_pending");
  });

  it("viewer is FORBIDDEN; admin without 2FA is FORBIDDEN (require2FA mirror)", async () => {
    const d = await seedRouterDisposition("rbac");

    await expect(
      defectDispositionRouter.createCaller(viewerCtx).transition({ id: d.id, status: "in_repair" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      defectDispositionRouter.createCaller(adminNo2faCtx).transition({ id: d.id, status: "in_repair" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("illegal transition → CONFLICT; 'closed' is not an accepted target (schema)", async () => {
    const d = await seedRouterDisposition("conflict");
    const bench = defectDispositionRouter.createCaller(maintenanceCtx);

    // open → repaired skips in_repair → service CONFLICT surfaces through the router.
    await expect(bench.transition({ id: d.id, status: "repaired" }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    // "closed" is not in the transition enum — zod BAD_REQUEST; closing stays quality-only (updateStatus).
    await expect(bench.transition({ id: d.id, status: "closed" as never }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("repairQueue / listBySerial / repairStats are readable by the bench roles", async () => {
    const d = await seedRouterDisposition("reads");
    const bench = defectDispositionRouter.createCaller(maintenanceCtx);

    const queue = await bench.repairQueue({ machineId, limit: 500 });
    expect(queue.some((r) => r.id === d.id)).toBe(true);

    const bySerial = await bench.listBySerial({ serial: d.serialNumber! });
    expect(bySerial.map((r) => r.id)).toContain(d.id);

    const stats = await bench.repairStats();
    expect(stats.openByLane.open).toBeGreaterThanOrEqual(1);
    expect(stats.windowDays).toBe(7);
  });
});
