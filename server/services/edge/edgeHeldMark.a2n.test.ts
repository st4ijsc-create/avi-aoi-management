/**
 * Đĩa edge treo (a2n) round C — the string contract between an edge and central. Central branches on two marks inside the `error` of a held segment end, so they are an implicit
 * contract, additive: `EDGE_HELD(<reason>): <MARK>: <text>`, the mark first thing after the prefix, so that no cut of the text (500 at central, 4 000 on the wire) can lose it.
 * The strings below are LITERALS on purpose: this file pins the receiving side and the values; the sending side is pinned, literally too, in robotEdgeDiskStall.a2n.test.
 *   an old edge sends no mark: central answers with the old safe wording, nothing fails;
 *   a new edge's mark is recognised at the head only, however long the text;
 *   a mark further on in free text is not a mark.
 * The other direction, a new edge on an old central, cannot live here: it is measured against the old function rebuilt from git (round C report, section Bàn giao).
 * No database: FakeDb; applyEdgeSegmentEnd is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  type R = Record<string, unknown>;
  return {
    ...actual,
    eq: (c: { name: string }, v: unknown) => (r: R) => r[c.name] === v,
    inArray: (c: { name: string }, vs: unknown[]) => (r: R) => vs.includes(r[c.name]),
    notInArray: (c: { name: string }, vs: unknown[]) => (r: R) => !vs.includes(r[c.name]),
    and: (...cs: unknown[]) => (r: R) => cs.every((x) => typeof x !== "function" || (x as (q: R) => boolean)(r)),
  };
});
vi.mock("../../db/connection", () => ({ getDb: async () => null, isEdgeProcessRole: () => false }));

import { FakeDb } from "../../routers/__otFakeDb";
import { applyEdgeSegmentEnd } from "../orchestration/foe/foeRunStore";
import { EDGE_HOLD_CONSUME_OVERRUN, EDGE_HOLD_UNUSED_NOT_REPORTED, edgeHoldMarkOf } from "./edgeProgramReportRule";

const CU = " — nothing further was sent; Continue to resume it.";
const CHU_C = " A compensation may already have run. For a STOP still due use Abort: Continue may end the run without sending it.";
const CHU_B5 = " Central counts that step as possibly sent. Continue fails that step and does not send the STOPs behind it. Use Abort to send them.";

let d: FakeDb;
beforeEach(() => {
  d = new FakeDb();
  d.store.set("orchestration_runs", [{ id: 9, status: "running", contextJson: null }]);
});
const giu = async (heldReason: string, error: string | undefined) => {
  const r = await applyEdgeSegmentEnd(d as never, 9, { outcome: "held", heldReason, error, nodeCode: "edge-a", claimSeq: 1, def: { steps: [] } as never });
  const run = (d.store.get("orchestration_runs") as Array<Record<string, unknown>>)[0];
  return { r, status: run.status, loi: String(run.error) };
};

describe("a2n round C — the two marks", () => {
  it("★ the values, word for word: a change on one side is a change of the contract", () => {
    expect(EDGE_HOLD_CONSUME_OVERRUN).toBe("EDGE_CONSUME_OVERRUN");
    expect(EDGE_HOLD_UNUSED_NOT_REPORTED).toBe("EDGE_UNUSED_NOT_REPORTED");
  });

  it("★ the form: read at the head only", () => {
    expect(edgeHoldMarkOf("EDGE_HELD(journalFull): EDGE_CONSUME_OVERRUN: text")).toBe("EDGE_CONSUME_OVERRUN");
    expect(edgeHoldMarkOf("EDGE_HELD(configStale): EDGE_UNUSED_NOT_REPORTED: text")).toBe("EDGE_UNUSED_NOT_REPORTED");
    expect(edgeHoldMarkOf("EDGE_HELD(journalFull): the journal refused a record (full): nothing")).toBeNull();
    expect(edgeHoldMarkOf("text EDGE_HELD(journalFull): EDGE_CONSUME_OVERRUN: text")).toBeNull();
    expect(edgeHoldMarkOf(undefined)).toBeNull();
    expect(edgeHoldMarkOf("")).toBeNull();
  });
});

describe("a2n round C — central, new; the edge, old: no mark, the old wording, nothing fails", () => {
  it("★ journalFull: the texts an old edge sends end as they always did", async () => {
    for (const loi of ["EDGE_HELD(journalFull): the journal refused a record (full) — nothing further was sent; the run is held.", 'EDGE_HELD(journalFull): command step "m1" was not sent — no authorisation could be obtained from central; the run is held (Continue it once the edge is reachable again).', "EDGE_OUTCOME_UNKNOWN(m1): sent, but the result could not be recorded (journal: full) — never sent again; the run is held."]) {
      d.store.set("orchestration_runs", [{ id: 9, status: "running", contextJson: null }]);
      const { r, status, loi: chu } = await giu("journalFull", loi);
      expect(r).toMatchObject({ ok: true, status: "held", changed: true });
      expect(status).toBe("held");
      expect(chu.endsWith(CU)).toBe(true);
      expect(chu).not.toContain("use Abort");
    }
  });

  it("★ configStale: B5 from an old edge, no mark: the old wording, not the Abort one (central cannot know it is B5)", async () => {
    const { r, status, loi } = await giu("configStale", 'EDGE_HELD(configStale): command step "m1" was not sent — the edge\'s config is older than the one central announced; its authorisation could NOT be reported unused (a Continue treats the step as possibly sent); the run is held (Continue it once the edge has its new config).');
    expect(r).toMatchObject({ ok: true, status: "held", changed: true });
    expect(status).toBe("held");
    expect(loi.endsWith(CU)).toBe(true);
    expect(loi).not.toContain("Use Abort");
  });

  it("★ no error at all: the old wording", async () => {
    const { loi } = await giu("centralUnreachable", undefined);
    expect(loi).toBe(`Edge node edge-a held run 9 (centralUnreachable)${CU}`);
  });
});

describe("a2n round C — central, new; the edge, new: read at the head, whatever the length", () => {
  it("★ consume overrun: the advice replaces the old ending", async () => {
    const { r, loi } = await giu("journalFull", "EDGE_HELD(journalFull): EDGE_CONSUME_OVERRUN: a step's authorisation could not be recorded in time.");
    expect(r).toMatchObject({ ok: true, status: "held" });
    expect(loi.endsWith(CHU_C)).toBe(true);
    expect(loi).not.toContain("nothing further was sent");
  });

  it("★ B5: the advice replaces the old ending", async () => {
    const { loi } = await giu("configStale", "EDGE_HELD(configStale): EDGE_UNUSED_NOT_REPORTED: command step m1 was not sent.");
    expect(loi.endsWith(CHU_B5)).toBe(true);
    expect(loi).not.toContain("Continue to resume it");
  });

  it("★ a text far past central's 500 and the wire's 4 000: the mark is still read, still in the cut text, the advice is whole", async () => {
    for (const [ly, dau, chu] of [
      ["journalFull", "EDGE_CONSUME_OVERRUN", CHU_C],
      ["configStale", "EDGE_UNUSED_NOT_REPORTED", CHU_B5],
    ]) {
      d.store.set("orchestration_runs", [{ id: 9, status: "running", contextJson: null }]);
      const nguyen = `EDGE_HELD(${ly}): ${dau}: ${"x".repeat(6_000)}`;
      const { loi } = await giu(ly, nguyen.slice(0, 4_000)); // the wire's cut (edgeExecutionAgent, zText(4_000))
      expect(loi).toContain(`EDGE_HELD(${ly}): ${dau}: `);
      expect(loi.endsWith(chu)).toBe(true);
      expect(loi.length).toBeLessThan(800);
    }
  });

  it("★ a mark further on is free text, not a mark: a device's words cannot change the advice", async () => {
    const { loi } = await giu("journalFull", `EDGE_HELD(journalFull): the device said ${"y".repeat(600)} EDGE_CONSUME_OVERRUN: and more`);
    expect(loi.endsWith(CU)).toBe(true);
    d.store.set("orchestration_runs", [{ id: 9, status: "running", contextJson: null }]);
    const b = await giu("journalFull", "the device said EDGE_HELD(journalFull): EDGE_UNUSED_NOT_REPORTED: and more");
    expect(b.loi.endsWith(CU)).toBe(true);
  });
});
