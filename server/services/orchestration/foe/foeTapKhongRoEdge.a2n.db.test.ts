/**
 * T9 lượt sửa 3e — DB half of tapKhongRoEdge (kiem-dinh 14/11): central's end of an edge segment (foeRunStore.applyEdgeSegmentEnd, called inside the complete
 * route's transaction, edgeExecutionCentral.ts:1196) reads the authorisation ledger (0372) in THAT transaction. On PostgreSQL a failed statement aborts the
 * whole transaction: a ledger read that fails must not take the end with it (25P02 on the next write ⇒ the complete fails ⇒ the run never held). The read
 * fails here for real, deterministically, touching no real object: drizzle names the table with no schema (pgTable("edge_step_authorizations"),
 * edgeControlSchema.ts:30), pg_temp is searched before public, so a TEMP table of that name created in this transaction (ON COMMIT DROP; the app role
 * has TEMP) takes the ledger read, which fails with 42703 (no such column). 42703 is not what the field shows (42P01: the table missing; 42501: no
 * privilege), but all three share what matters here: a failed statement aborts a PostgreSQL transaction. (A real 42501 by SET LOCAL ROLE needs a role
 * with no SELECT on the table: none is created here.)
 *
 * Real product code on the `_test` DB (forced by vitest.setup). Every write is inside the test's own transaction, ROLLED BACK (getDb ⇒ that transaction;
 * outside it getDb is a TRAP that counts and returns null). No DDL on a real table (the TEMP table goes with the rollback), no DELETE / TRUNCATE, never
 * the owner role, no explicit id in a WORM table.
 */
import { describe, it, expect, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

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
// the URGENTs this end may raise are recorded, never sent (the critical-stop alert's own dedup is tested there)
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async (a: { baoBen?: (b: boolean) => void }) => a.baoBen?.(true) };
});

import * as conn from "../../../db/connection";
import { orchestrationRunSteps, orchestrationRuns } from "../../../../drizzle/schema";
import { makeFoeGateRun } from "./__foeGateRunFixture";
import { applyEdgeSegmentEnd } from "./foeRunStore";
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T9F3E-${Date.now()}`;
const OWNER = 990_917_301;
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

describe.skipIf(!DB_URL)("T9 lượt sửa 3e — the ledger read at an edge segment's end cannot take the end with it (real DB, ROLLBACK)", () => {
  it("T9F3E-SO-LOI-PG the ledger read fails inside the complete's transaction (42703, a TEMP table of its name): the run is still HELD, its context names the command that may have gone (fail-closed), the transaction usable", async () => {
    const m0: WorkflowStep = { id: "m0", type: "command", machineId: 1, command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } } } as never;
    {
      await trongGiaoDich(async (tx) => {
        const fx = await makeFoeGateRun({ tag: `${DAU}-sl`, owner: OWNER, approvedBy: OWNER, steps: [m0] });
        await tx.insert(orchestrationRunSteps).values({ runId: fx.runId, stepId: "m0", stepType: "command", status: "running", attempt: 1, startedAt: new Date() });
        await tx.execute(sql`CREATE TEMP TABLE edge_step_authorizations (x int) ON COMMIT DROP`);
        const def: WorkflowDefinition = { ref: `${DAU}-sl-wf`, name: DAU, steps: [{ id: "g0", type: "hitl_gate", prompt: "fixture" } as never, m0] } as never;
        const r = await applyEdgeSegmentEnd(tx as never, fx.runId, {
          outcome: "held",
          heldReason: "journalFull",
          error: "EDGE_OUTCOME_UNKNOWN(m0): sent, but the result could not be recorded (journal: journal_full) — never sent again; the run is held. [[A2N:[]]]",
          nodeCode: "EDGE-T",
          claimSeq: 1,
          def,
        });
        expect(r).toMatchObject({ ok: true, status: "held", changed: true });
        const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, fx.runId));
        expect(run?.status).toBe("held");
        expect((run?.contextJson as Record<string, unknown> | null)?.foeOutcomeUnknown, "fail-closed: the command whose row is not final").toEqual(["m0"]);
      });
    }
    expect(H.bay, "nothing outside the test's transaction").toBe(0);
  });
});
