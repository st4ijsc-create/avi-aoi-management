/**
 * inspection.bulkAcknowledge — doc 27 gap F1 integration tests.
 *
 * Runs against the ISOLATED test DB (vitest.setup.ts rewrites DATABASE_URL to
 * <db>_test — provision once with `npm run test:db:setup`). Tests soft-skip
 * when no DB is reachable.
 *
 * Verifies:
 *  - stamps acknowledgedBy/acknowledgedAt for unacknowledged rows, honest counts
 *  - idempotent: already-acknowledged rows are NOT re-stamped (first acknowledger wins)
 *  - mixed batches report acknowledged / alreadyAcknowledged / notFound separately
 *  - an audit_logs row is written (action inspection.bulkAcknowledge)
 *  - input validation: empty batch and >500 ids rejected; unauthenticated → UNAUTHORIZED
 *  - legacy measurementResult.batchAcknowledge (string ids, used by QualityHome)
 *    delegates to the same idempotent path
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTRPC } from "@trpc/server";
import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../db/connection";
import { productInspections, auditLogs } from "../../drizzle/schema";
import { inspectionRouter, measurementResultRouter } from "./inspectionRouters";

const TEST_USER_ID = 990_001;
const OTHER_USER_ID = 990_002;
const SERIAL_PREFIX = `F1-ACK-${Date.now()}`;

const t = initTRPC.context<any>().create();
const makeInspectionCaller = t.createCallerFactory(inspectionRouter);
const makeMeasurementCaller = t.createCallerFactory(measurementResultRouter);

const caller = makeInspectionCaller({ user: { id: TEST_USER_ID, name: "F1 Tester", role: "admin" } });
const otherCaller = makeInspectionCaller({ user: { id: OTHER_USER_ID, name: "F1 Other", role: "admin" } });
const legacyCaller = makeMeasurementCaller({ user: { id: TEST_USER_ID, name: "F1 Tester", role: "admin" } });
const anonCaller = makeInspectionCaller({ user: null });

let db: Awaited<ReturnType<typeof getDb>>;

async function insertInspection(suffix: string): Promise<number> {
  const [row] = await db!
    .insert(productInspections)
    .values({
      machineId: 1,
      serialNumber: `${SERIAL_PREFIX}-${suffix}`,
      overallResult: "NG",
      originalResult: "NG",
      inspectionTime: new Date(),
    })
    .returning({ id: productInspections.id });
  return row.id;
}

async function fetchRows(ids: number[]) {
  return db!
    .select({
      id: productInspections.id,
      acknowledgedBy: productInspections.acknowledgedBy,
      acknowledgedAt: productInspections.acknowledgedAt,
    })
    .from(productInspections)
    .where(inArray(productInspections.id, ids));
}

beforeAll(async () => {
  db = await getDb();
});

afterAll(async () => {
  if (!db) return;
  await db.delete(productInspections).where(like(productInspections.serialNumber, `${SERIAL_PREFIX}%`));
  await db
    .delete(auditLogs)
    .where(and(eq(auditLogs.action, "inspection.bulkAcknowledge"), inArray(auditLogs.userId, [TEST_USER_ID, OTHER_USER_ID])));
});

describe("inspection.bulkAcknowledge (integration, isolated test DB)", () => {
  it("stamps acknowledgedBy/acknowledgedAt and returns honest counts", async () => {
    if (!db) return; // no DB in this environment — soft skip
    const ids = [await insertInspection("a1"), await insertInspection("a2"), await insertInspection("a3")];

    const res = await caller.bulkAcknowledge({ ids });
    expect(res).toMatchObject({
      success: true,
      acknowledgedCount: 3,
      alreadyAcknowledgedCount: 0,
      notFoundCount: 0,
    });

    const rows = await fetchRows(ids);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.acknowledgedBy).toBe(TEST_USER_ID);
      expect(r.acknowledgedAt).toBeInstanceOf(Date);
    }
  });

  it("is idempotent — a second acknowledge does NOT re-stamp (first acknowledger wins)", async () => {
    if (!db) return;
    const id = await insertInspection("b1");

    await caller.bulkAcknowledge({ ids: [id] });
    const [first] = await fetchRows([id]);

    const res2 = await otherCaller.bulkAcknowledge({ ids: [id] });
    expect(res2.acknowledgedCount).toBe(0);
    expect(res2.alreadyAcknowledgedCount).toBe(1);

    const [second] = await fetchRows([id]);
    expect(second.acknowledgedBy).toBe(TEST_USER_ID); // NOT overwritten by OTHER_USER_ID
    expect(second.acknowledgedAt?.getTime()).toBe(first.acknowledgedAt?.getTime());
  });

  it("mixed batch: new + already-acknowledged + nonexistent id are counted separately", async () => {
    if (!db) return;
    const ackedId = await insertInspection("c1");
    await caller.bulkAcknowledge({ ids: [ackedId] });
    const freshId = await insertInspection("c2");
    const missingId = 2_000_000_000; // int4-safe, guaranteed absent

    const res = await caller.bulkAcknowledge({ ids: [freshId, ackedId, missingId] });
    expect(res.acknowledgedCount).toBe(1);
    expect(res.alreadyAcknowledgedCount).toBe(1);
    expect(res.notFoundCount).toBe(1);
  });

  it("writes an audit_logs entry with the acknowledge counts", async () => {
    if (!db) return;
    const id = await insertInspection("d1");
    await caller.bulkAcknowledge({ ids: [id] });

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "inspection.bulkAcknowledge"), eq(auditLogs.userId, TEST_USER_ID)));
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const withThisId = logs
      .map((l) => (l.details ? JSON.parse(l.details) : null))
      .filter((d) => d && Array.isArray(d.acknowledgedIds) && d.acknowledgedIds.includes(id));
    expect(withThisId).toHaveLength(1);
    expect(withThisId[0].acknowledgedCount).toBe(1);
  });

  it("rejects an empty batch and a batch over the 500 cap", async () => {
    if (!db) return;
    await expect(caller.bulkAcknowledge({ ids: [] })).rejects.toThrow();
    const tooMany = Array.from({ length: 501 }, (_, i) => i + 1);
    await expect(caller.bulkAcknowledge({ ids: tooMany })).rejects.toThrow();
  });

  it("rejects unauthenticated callers", async () => {
    if (!db) return;
    await expect(anonCaller.bulkAcknowledge({ ids: [1] })).rejects.toThrow(/login|UNAUTHORIZED/i);
  });
});

describe("measurementResult.batchAcknowledge (legacy string-id path, used by QualityHome)", () => {
  it("delegates to the same idempotent path and returns the real updated count", async () => {
    if (!db) return;
    const id = await insertInspection("e1");

    const res = await legacyCaller.batchAcknowledge({ ids: [String(id)] });
    expect(res).toEqual({ success: true, count: 1 });

    const [row] = await fetchRows([id]);
    expect(row.acknowledgedBy).toBe(TEST_USER_ID);

    // Second call: already acknowledged → count 0, row untouched.
    const res2 = await legacyCaller.batchAcknowledge({ ids: [String(id)] });
    expect(res2.count).toBe(0);
  });

  it("rejects non-numeric ids", async () => {
    if (!db) return;
    await expect(legacyCaller.batchAcknowledge({ ids: ["abc"] })).rejects.toThrow();
  });
});
