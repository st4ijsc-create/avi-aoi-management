/**
 * X-39 (STOPCHUARA-LOC-THIEU-COMPENSATED, sửa PHÍA GHI; giấy tam/x39-ghi-buoc1-1.md + hàng X-39) — DB half of foeStopChuaRaGhi.a2n.test.ts: the store's ONE UPDATE
 * (foeRunStore.xoaStopChuaRaDaLuuTrong) drops exactly `id` from the stored context's state-C list (foeStopChuaRa), drops the key with its last element, keeps every other key
 * of that context as stored, and touches no other run. Not measurable on the in-memory stand-in (it runs no SQL).
 *
 * Real product SQL on the `_test` DB (forced by vitest.setup). Every write is inside the test's own transaction, ROLLED BACK (getDb ⇒ that transaction; outside it getDb is a
 * TRAP that counts and returns null). Rows written, all rolled back: orchestration_workflows 3, orchestration_runs 3 (makeFoeGateRun with no gate row ⇒ no step row), then 3
 * UPDATEs of those runs' contextJson and the store's UPDATEs. No DELETE / TRUNCATE, no DDL, never the owner role, no WORM table.
 */
import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";

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
import { orchestrationRuns } from "../../../../drizzle/schema";
import { makeFoeGateRun } from "./__foeGateRunFixture";
import { centralRunStore } from "./foeRunStore";

const DB_URL = process.env.DATABASE_URL;
const DAU = `X39G-${Date.now()}`;
const OWNER = 990_939_301;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

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

describe.skipIf(!DB_URL)("X-39 — the store's UPDATE of the stored state-C list (real DB, ROLLBACK)", () => {
  it("X39-GHI-SQL-MOT-KHOA one UPDATE: `id` leaves foeStopChuaRa, the key goes with its last element, every other key and every other run stay as stored", async () => {
    // the cast: the red-before tree (no such export) compiles too; there the call is undefined and the case is red at its first line
    const { xoaStopChuaRaDaLuuTrong } = (await import("./foeRunStore")) as unknown as { xoaStopChuaRaDaLuuTrong?: (d: Tx, runId: number, id: string) => Promise<void> };
    await trongGiaoDich(async (tx) => {
      expect(typeof xoaStopChuaRaDaLuuTrong, "the store's write is a function of the module").toBe("function");
      const a = await makeFoeGateRun({ tag: `${DAU}-a`, owner: OWNER, approvedBy: null });
      const b = await makeFoeGateRun({ tag: `${DAU}-b`, owner: OWNER, approvedBy: null });
      const c = await makeFoeGateRun({ tag: `${DAU}-c`, owner: OWNER, approvedBy: null });
      const khac = { foeKetCucKhongRoChot: { stepId: "main", ma: "FOE_OUTCOME_UNKNOWN", at: "2026-11-27T00:00:00.000Z" }, foeKetCucKhongRoDuyet: { stepIds: ["main"] }, telemetry: { t: 1 } };
      await tx.update(orchestrationRuns).set({ contextJson: { ...khac, foeStopChuaRa: ["cs1", "cs2"] } }).where(eq(orchestrationRuns.id, a.runId));
      await tx.update(orchestrationRuns).set({ contextJson: { foeStopChuaRa: ["cs1"], x: 1 } }).where(eq(orchestrationRuns.id, b.runId));
      await tx.update(orchestrationRuns).set({ contextJson: { foeStopChuaRa: "cs1", x: 2 } }).where(eq(orchestrationRuns.id, c.runId));
      const ctx = async (id: number) => ((await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, id)))[0]?.contextJson ?? null) as Record<string, unknown> | null;

      await xoaStopChuaRaDaLuuTrong!(tx, a.runId, "cs1");
      expect(await ctx(a.runId), "cs1 leaves, cs2 and every other key stay").toEqual({ ...khac, foeStopChuaRa: ["cs2"] });
      expect(await ctx(b.runId), "another run naming cs1 is not touched").toEqual({ foeStopChuaRa: ["cs1"], x: 1 });

      await xoaStopChuaRaDaLuuTrong!(tx, a.runId, "cs2");
      expect(await ctx(a.runId), "the last element: the key goes, every other key stays").toEqual(khac);

      await xoaStopChuaRaDaLuuTrong!(tx, b.runId, "zz");
      expect(await ctx(b.runId), "an id the list does not name: nothing changes").toEqual({ foeStopChuaRa: ["cs1"], x: 1 });
      await xoaStopChuaRaDaLuuTrong!(tx, c.runId, "cs1");
      expect(await ctx(c.runId), "a key that is no list: nothing changes, nothing throws").toEqual({ foeStopChuaRa: "cs1", x: 2 });

      // the walk's path: the central store's own method (getDb ⇒ this transaction), once — the cast as above
      const quaKho = (centralRunStore as { xoaStopChuaRaDaLuu?: (runId: number, id: string) => Promise<void> }).xoaStopChuaRaDaLuu;
      expect(typeof quaKho, "the central store carries the write").toBe("function");
      await quaKho!(b.runId, "cs1");
      expect(await ctx(b.runId), "through the central store: the last element, the key goes, x stays").toEqual({ x: 1 });
    });
    expect(H.bay, "nothing outside the test's transaction").toBe(0);
  });
});
