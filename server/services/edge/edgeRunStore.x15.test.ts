/**
 * X-15 (hàng X-15, chu-du-an-HST 2026-11-17/18) — the NODE's two sweep sources say "skipped, never tried" (`boQua`) the way central's do, with the
 * protocol unchanged: the package / sweep picture carries `completed` (completed OR skipped rows) and `attempted` (never a skipped row), so
 * `completed ∖ attempted` is exactly "skipped, never tried". The assumption is locked here on `edgePriorPictureOf` itself (HST 18/11, (c)):
 * whoever changes that function makes these cases red. What the sweep does with `boQua` (foeEngine planAbortSweep) is held by
 * foeAbortStops.dot6.test.ts "X-15 —" — the same planner runs on the node.
 */
import { describe, it, expect } from "vitest";
import { createEdgeRunStore, createEdgeSweepStore } from "./edgeRunStore";
import { edgePriorPictureOf, priorStepsOf } from "../orchestration/foe/foeRunStore";

/** step rows of an earlier segment: `stop` skipped by its precondition, `move` completed, `x` failed, `y` skipped but handed over (a routedTo result) */
const HANG = [
  { id: 1, stepId: "move", status: "completed", resultJson: { accepted: true }, startedAt: new Date(1_000) },
  { id: 2, stepId: "stop", status: "skipped", resultJson: null, startedAt: null },
  { id: 3, stepId: "x", status: "failed", resultJson: null, startedAt: new Date(2_000) },
  { id: 4, stepId: "y", status: "skipped", resultJson: { routedTo: "edge" }, startedAt: null },
];
const anh = edgePriorPictureOf(HANG);
const DINH_NGHIA = { ref: "x15", name: "x15", steps: [] };

describe("X-15 — the node's sweep sources: skipped, never tried (boQua)", () => {
  it("X15-ANH-GIA-DINH (c) edgePriorPictureOf: a skipped row is in `completed`, never in `attempted`; a completed one is in both", () => {
    expect(anh.completed).toEqual(expect.arrayContaining(["move", "stop", "y"]));
    expect(anh.completed).not.toContain("x");
    expect(anh.attempted).toContain("move");
    expect(anh.attempted).not.toContain("stop"); // ★ the assumption completed ∖ attempted = skipped, never tried rests on this
    expect(anh.attempted).toContain("y"); // a routedTo result: handed over, so tried
  });

  it.fails("X15-PRIOR-BOQUA central's reading of the same rows (priorStepsOf, the stored and live sources) agrees: skipped ∖ attempted", () => {
    expect([...(priorStepsOf(HANG).boQua ?? [])]).toEqual(["stop"]);
    expect(priorStepsOf(HANG).settled.has("stop")).toBe(true); // still settled for a walk
  });

  it.fails("X15-NUT-ANH (the node's signed sweep picture) boQua is exactly the skipped, never tried step", async () => {
    const store = createEdgeSweepStore({ definition: DINH_NGHIA, machines: [], verifiedStops: [], stopsUnsure: [], prior: anh } as never, { abortStop: () => undefined });
    const src = (await store.sweepSource())!;
    expect(["move", "stop", "x", "y", "nope"].filter((id) => src.boQua?.(id))).toEqual(["stop"]);
    expect(src.settled("stop")).toBe(true); // still settled for a walk: a Continue never runs it again
  });

  it.fails("X15-NUT-SONG (the node's live walker) boQua = what this walk skipped (its memory) + the package's skipped, never tried", async () => {
    const pkg = { runId: 7, claimSeq: 2, definition: DINH_NGHIA, machines: [], verifiedStops: [], stopsUnsure: [], resolvedAdapters: [], prior: anh, context: {} };
    const store = createEdgeRunStore(pkg as never, { runId: 7, claimSeq: 2 } as never);
    const rc = {
      def: DINH_NGHIA,
      machineById: new Map(),
      completed: new Set<string>(),
      settled: new Set(["s2"]),
      dispatched: new Set<string>(),
      attempted: new Set<string>(),
      startOrder: [],
      context: {},
      prior: { settled: new Set(anh.settled), startOrder: [], branches: new Map(), attempted: new Set(anh.attempted), unknown: false },
      boQua: new Set(["s2"]),
    };
    const src = (await store.sweepSource({ live: rc as never }))!;
    expect(["move", "stop", "x", "y", "s2", "nope"].filter((id) => src.boQua?.(id))).toEqual(["stop", "s2"]);
  });
});
