/**
 * W0-1 (doc 69) regression tests — RCA / predictive-alert SQL identifier fix.
 *
 * Root cause: several rootCauseRouter/predictiveAlertRouter mutations built
 * SQL with UNQUOTED camelCase column names (`analysisType`, `machineId`,
 * `aiInsights`, `acknowledgedBy`, ...), but the physical Postgres columns are
 * quoted-camelCase (see drizzle/schema/ai.ts + drizzle/0000_volatile_zaladane.sql
 * — `CREATE TABLE "predictive_alerts" ("acknowledgedBy" integer, ...)`).
 * Postgres folds an UNQUOTED identifier to lowercase, so e.g.
 * `SET acknowledgedBy = ...` tried to write a column literally named
 * `acknowledgedby`, which does not exist → `db.execute()` throws — and the
 * per-call site either had no try/catch (hard failure) or (in
 * aiBatchRcaScheduler) a try/catch that swallowed it, so the feature APPEARED
 * to run while persisting NOTHING.
 *
 * `predictiveAlertRouter.generatePredictions` additionally referenced a
 * non-existent column `i.result` (real: `i."overallResult"`) and joined
 * `factories f ON m.factoryId = f.id` — but `machines` has NO `factoryId`
 * column at all (factory is only reachable via
 * machine→station→line→workshop→factory, the same chain rootCauseRouter.analyze
 * already uses). Quoting alone would not have fixed that query; the join was
 * corrected to the real chain.
 *
 * These tests run against the ISOLATED test DB (vitest.setup.ts rewrites
 * DATABASE_URL to <db>_test) and soft-skip when no DB is reachable in this
 * environment. Every test seeds via the drizzle builder, exercises the
 * (now-fixed) router mutation/query, and RE-SELECTS via drizzle to prove the
 * write actually persisted — not just that a query string was built.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initTRPC } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { predictiveAlerts, rootCauseAnalysis } from "../../drizzle/schema";
import { rootCauseRouter, predictiveAlertRouter } from "./aiRouters";

const TEST_USER_ID = 990_101;
const RUN_TAG = `W0-1-${Date.now()}`;

const t = initTRPC.context<any>().create();
const makeRcaCaller = t.createCallerFactory(rootCauseRouter);
const makeAlertCaller = t.createCallerFactory(predictiveAlertRouter);
const rcaCaller = makeRcaCaller({ user: { id: TEST_USER_ID, name: "W0-1 Tester", role: "admin" } });
const alertCaller = makeAlertCaller({ user: { id: TEST_USER_ID, name: "W0-1 Tester", role: "admin" } });

let db: Awaited<ReturnType<typeof getDb>>;
const alertIds: number[] = [];
const rcaIds: number[] = [];

beforeAll(async () => {
  db = await getDb();
});

afterAll(async () => {
  if (!db) return;
  if (alertIds.length) await db.delete(predictiveAlerts).where(inArray(predictiveAlerts.id, alertIds));
  if (rcaIds.length) await db.delete(rootCauseAnalysis).where(inArray(rootCauseAnalysis.id, rcaIds));
});

async function seedAlert(overrides: Partial<typeof predictiveAlerts.$inferInsert> = {}): Promise<number> {
  const [row] = await db!
    .insert(predictiveAlerts)
    .values({
      alertType: "DEFECT_SPIKE",
      title: `${RUN_TAG}-alert`,
      description: "seed row for W0-1 regression test",
      status: "ACTIVE",
      ...overrides,
    })
    .returning({ id: predictiveAlerts.id });
  alertIds.push(row.id);
  return row.id;
}

async function seedRca(overrides: Partial<typeof rootCauseAnalysis.$inferInsert> = {}): Promise<number> {
  const now = new Date();
  const [row] = await db!
    .insert(rootCauseAnalysis)
    .values({
      analysisType: "DEFECT_ANALYSIS",
      machineCode: `${RUN_TAG}-M1`,
      startDate: now,
      endDate: now,
      dataPointsAnalyzed: 10,
      topFactors: [],
      aiInsights: { summary: "seed", rootCauses: [], recommendations: [], preventiveMeasures: [] },
      status: "COMPLETED",
      requestedBy: TEST_USER_ID,
      requestedByName: "seed",
      ...overrides,
    })
    .returning({ id: rootCauseAnalysis.id });
  rcaIds.push(row.id);
  return row.id;
}

describe("predictiveAlert.acknowledge — W0-1 fix (integration)", () => {
  it("persists status/acknowledgedBy/acknowledgedAt (previously: silent no-op)", async () => {
    if (!db) return; // soft-skip: no DB reachable in this environment
    const id = await seedAlert();

    const res = await alertCaller.acknowledge({ id });
    expect(res).toEqual({ success: true });

    const [row] = await db.select().from(predictiveAlerts).where(eq(predictiveAlerts.id, id));
    expect(row.status).toBe("ACKNOWLEDGED");
    expect(row.acknowledgedBy).toBe(TEST_USER_ID);
    expect(row.acknowledgedAt).toBeInstanceOf(Date);
  });
});

describe("predictiveAlert.resolve — W0-1 fix (integration)", () => {
  it("persists status/resolvedBy/resolvedAt/resolutionNotes (previously: silent no-op)", async () => {
    if (!db) return;
    const id = await seedAlert();

    const res = await alertCaller.resolve({ id, resolutionNotes: "Fixed sensor calibration" });
    expect(res).toEqual({ success: true });

    const [row] = await db.select().from(predictiveAlerts).where(eq(predictiveAlerts.id, id));
    expect(row.status).toBe("RESOLVED");
    expect(row.resolvedBy).toBe(TEST_USER_ID);
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(row.resolutionNotes).toBe("Fixed sensor calibration");
  });
});

describe("predictiveAlert.generatePredictions — W0-1 join/column fix (integration)", () => {
  it("resolves without a SQL error (previously: hard failure — nonexistent m.factoryId / i.result)", async () => {
    if (!db) return;
    await expect(alertCaller.generatePredictions({ daysToAnalyze: 7 })).resolves.toMatchObject({ success: true });
  });
});

describe("rootCause.list — W0-1 quoted WHERE filters (integration)", () => {
  it("filters by analysisType + machineId (previously: unquoted -> column does not exist)", async () => {
    if (!db) return;
    const machineId = 700_000_000 + (Date.now() % 1_000_000);
    const idMatch = await seedRca({ analysisType: "DEFECT_ANALYSIS", machineId });
    const idOther = await seedRca({ analysisType: "YIELD_ANALYSIS", machineId: machineId + 1 });

    const rows = await rcaCaller.list({ analysisType: "DEFECT_ANALYSIS", machineId, limit: 50 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(idMatch);
    expect(ids).not.toContain(idOther);
  });
});

describe("rootCause.update — W0-1 drizzle-builder write + quoted pre-read (integration)", () => {
  it("persists status + merges review fields into aiInsights", async () => {
    if (!db) return;
    const id = await seedRca({
      aiInsights: { summary: "original", rootCauses: [], recommendations: [], preventiveMeasures: [] },
    });

    const res = await rcaCaller.update({
      id,
      status: "IN_PROGRESS",
      confirmedCause: "Excess solder paste",
      correctiveAction: "Reduce stencil aperture",
      notes: "verified on line 2",
    });
    expect(res.success).toBe(true);

    const [row] = await db.select().from(rootCauseAnalysis).where(eq(rootCauseAnalysis.id, id));
    expect(row.status).toBe("IN_PROGRESS");
    const insights = row.aiInsights as any;
    expect(insights.summary).toBe("original"); // preserved, not clobbered
    expect(insights.review.confirmedCause).toBe("Excess solder paste");
    expect(insights.review.correctiveAction).toBe("Reduce stencil aperture");
    expect(insights.review.notes).toBe("verified on line 2");
    expect(insights.review.reviewedBy).toBe(TEST_USER_ID);
  });

  it("missing id → NOT_FOUND (no write attempted)", async () => {
    if (!db) return;
    await expect(rcaCaller.update({ id: 2_000_000_000, notes: "x" })).rejects.toThrow(/not found/i);
  });
});
