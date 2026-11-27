/**
 * T10 (chủ dự án 27/11: "khi boot đã quá hạn: KHÔNG tự gửi STOP — giữ run + URGENT"; HST quyết 1, M7, M8) — DB half of foeBootQuaHan.a2n.test.ts: the store's ONE SELECT
 * (foeRunStore.docTuoiMocChotTrong) answers the age, on the DATABASE clock, of the OLDEST row among the latched steps it is given, of THAT run only; null when no such row. Not measurable on
 * the in-memory stand-in (it runs no SQL).
 *
 * Real product SQL on the `_test` DB (forced by vitest.setup). Every write is inside the test's own transaction, ROLLED BACK (getDb ⇒ that transaction; outside it getDb is a TRAP that
 * counts and returns null). Rows written, all rolled back: orchestration_workflows 2, orchestration_runs 2 (makeFoeGateRun with no gate row ⇒ no step row), orchestration_run_steps 4
 * (run a: main, m2, x; run b: main), "createdAt" set in SQL relative to now(). No UPDATE, no DELETE / TRUNCATE, no DDL, never the owner role, no WORM table.
 */
import { describe, it, expect, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const H = vi.hoisted(() => ({ tx: null as unknown, bay: 0 }));

vi.mock("../../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../db/connection")>();
  return {
    ...real,
    getDb: (async () => {
      if (H.tx) return H.tx;
      H.bay++; // outside the test's transaction: never touches the real DB
      return null;
    }) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});

import * as conn from "../../../db/connection";
import { orchestrationRunSteps } from "../../../../drizzle/schema";
import { makeFoeGateRun } from "./__foeGateRunFixture";
import { centralRunStore } from "./foeRunStore";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T10DB-${Date.now()}`;
const OWNER = 990_939_401;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
const PHUT = 60_000;

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

describe.skipIf(!DB_URL)("T10 — the latch's age on the database clock (real DB, ROLLBACK)", () => {
  it("T10-DB-TUOI the oldest latched row of THIS run, on now() − createdAt: the right step (M7), the oldest of several (M8), another run never, no row ⇒ null; once through the central store (W7)", async () => {
    // the cast: the red-before tree (no such export) compiles too; there the call is undefined and the case is red at its first line
    const { docTuoiMocChotTrong } = (await import("./foeRunStore")) as unknown as { docTuoiMocChotTrong?: (d: Tx, runId: number, stepIds: readonly string[]) => Promise<number | null> };
    await trongGiaoDich(async (tx) => {
      expect(typeof docTuoiMocChotTrong, "the store's read is a function of the module").toBe("function");
      const a = await makeFoeGateRun({ tag: `${DAU}-a`, owner: OWNER, approvedBy: null });
      const b = await makeFoeGateRun({ tag: `${DAU}-b`, owner: OWNER, approvedBy: null });
      const hang = (runId: number, stepId: string, phutTruoc: number) => ({
        runId,
        stepId,
        stepType: "command",
        status: "running" as const,
        error: stepId === "main" ? "FOE_OUTCOME_UNKNOWN: Command \"start\" rejected (timeout)." : null,
        createdAt: sql`now() - (${phutTruoc}::float8 * interval '1 minute')`,
      });
      await tx.insert(orchestrationRunSteps).values([hang(a.runId, "m2", 1), hang(a.runId, "main", 6), hang(a.runId, "x", 0), hang(b.runId, "main", 30)] as never);
      const doc = (runId: number, ids: readonly string[]) => docTuoiMocChotTrong!(tx, runId, ids);

      const t1 = await doc(a.runId, ["main"]);
      expect(t1, "6 minutes old on the DB clock").not.toBeNull();
      expect(t1!).toBeGreaterThanOrEqual(6 * PHUT);
      expect(t1!, "this run's row, not run b's (30 minutes)").toBeLessThan(7 * PHUT);
      const t2 = await doc(a.runId, ["m2", "main"]);
      expect(t2!, "several latched steps, the newer row written first: the OLDEST (M8, A2)").toBeGreaterThanOrEqual(6 * PHUT);
      expect(t2!).toBeLessThan(7 * PHUT);
      const t3 = await doc(a.runId, ["x"]);
      expect(t3!, "only the steps it is given (M7): x is fresh").toBeLessThan(PHUT);
      expect(t3!).toBeGreaterThanOrEqual(0);
      expect(await doc(a.runId, ["khong-co"]), "no such row ⇒ null").toBeNull();
      expect(await doc(a.runId, ["main", "khong-co"]), "one latched step with no row, another with an old one ⇒ null, never the age of the others (R1)").toBeNull();
      expect(await doc(a.runId, ["x", "khong-co"]), "nor the age of a fresh one (R1: the side that sends)").toBeNull();
      expect(await doc(a.runId, []), "no step ⇒ null").toBeNull();

      // the walk's path: the central store's own method (getDb ⇒ this transaction), once — the cast as above
      const quaKho = (centralRunStore as unknown as { docTuoiMocChot?: (runId: number, stepIds: readonly string[]) => Promise<number | null> }).docTuoiMocChot;
      expect(typeof quaKho, "the central store carries the read").toBe("function");
      const t4 = await quaKho!(b.runId, ["main"]);
      expect(t4!, "through the central store: run b's own row, 30 minutes").toBeGreaterThanOrEqual(30 * PHUT);
      expect(t4!).toBeLessThan(31 * PHUT);
    });
    expect(H.bay, "nothing outside the test's transaction").toBe(0);
  });
});
