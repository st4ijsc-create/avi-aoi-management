/**
 * Doc 24 Wave-4 P5 — block-level DIFF + 3-way MERGE tests (PURE / in-memory only).
 *
 * Covers:
 *   • diff detects ADD / REMOVE / param-MODIFY / MOVE at top level AND inside branches.
 *   • diff reports WHICH params changed; identical flows → an EMPTY diff.
 *   • diff is STABLE / deterministic (same inputs → byte-identical output).
 *   • 3-way merge AUTO-RESOLVES disjoint changes (ours adds a block · theirs modifies
 *     another → BOTH present in the result, no conflict).
 *   • a TRUE conflict (both modify the same block's param differently) is FLAGGED with
 *     both sides preserved — never silently resolved.
 *   • the NEVER-DROP invariant: a modify/delete conflict KEEPS the block; a clean merge
 *     retains every block either side still wants.
 */
import { describe, it, expect } from "vitest";
import { assignIds, countBlocks, walkBlocks, type Flow } from "./irModel";
import { diffFlows } from "./irDiff";
import { mergeFlows } from "./irMerge";

// ── Fixtures ───────────────────────────────────────────────────────────────

/** A base flow with a top-level move, a grip, and an if_condition nesting a wait. */
function baseFlow(): Flow {
  return {
    flow_id: "f",
    target_device_type: "generic",
    version: 1,
    blocks: [
      { id: "m1", type: "move_linear", target_pose: { x: 0, y: 0, z: 200, rx: 0, ry: 0, rz: 0 }, speed_mms: 100, acceleration: 200, blend_radius: 0 },
      { id: "g1", type: "grip", tool_id: "tool-a", force_limit_n: 40, timeout_ms: 2000 },
      {
        id: "if1", type: "if_condition", signal_ref: "DI1", operator: "eq", value: true,
        true_branch: [{ id: "w1", type: "wait", ms: 500 }],
        false_branch: [],
      },
    ],
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── DIFF ─────────────────────────────────────────────────────────────────

describe("P5 block-level diff (irDiff)", () => {
  it("identical flows → an EMPTY diff", () => {
    const d = diffFlows(baseFlow(), baseFlow());
    expect(d.changes).toHaveLength(0);
    expect(d.summary).toEqual({ added: 0, removed: 0, modified: 0, moved: 0 });
  });

  it("detects an ADDED block at the top level", () => {
    const after = baseFlow();
    after.blocks.push({ id: "r1", type: "release", tool_id: "tool-a" });
    const d = diffFlows(baseFlow(), after);
    expect(d.summary.added).toBe(1);
    expect(d.changes.some((c) => c.kind === "added" && c.blockId === "r1" && c.blockType === "release")).toBe(true);
  });

  it("detects a REMOVED block", () => {
    const after = baseFlow();
    after.blocks = after.blocks.filter((b) => b.id !== "g1");
    const d = diffFlows(baseFlow(), after);
    expect(d.summary.removed).toBe(1);
    expect(d.changes.some((c) => c.kind === "removed" && c.blockId === "g1")).toBe(true);
  });

  it("detects a param MODIFY and reports WHICH params changed", () => {
    const after = baseFlow();
    (after.blocks[0] as { speed_mms: number }).speed_mms = 250;
    const d = diffFlows(baseFlow(), after);
    const mod = d.changes.find((c) => c.kind === "modified" && c.blockId === "m1");
    expect(mod).toBeDefined();
    expect(mod!.params?.map((p) => p.param)).toEqual(["speed_mms"]);
    expect(mod!.params?.[0]).toMatchObject({ param: "speed_mms", before: 100, after: 250 });
  });

  it("detects a param MODIFY INSIDE a branch (nested block)", () => {
    const after = baseFlow();
    const ifb = after.blocks[2] as { true_branch: Array<{ id: string; ms: number }> };
    ifb.true_branch[0].ms = 999;
    const d = diffFlows(baseFlow(), after);
    const mod = d.changes.find((c) => c.kind === "modified" && c.blockId === "w1");
    expect(mod).toBeDefined();
    expect(mod!.params?.[0]).toMatchObject({ param: "ms", before: 500, after: 999 });
    expect(mod!.path).toContain("true");
  });

  it("detects an ADD inside a branch", () => {
    const after = baseFlow();
    const ifb = after.blocks[2] as { false_branch: unknown[] };
    ifb.false_branch.push({ id: "w2", type: "wait", ms: 100 });
    const d = diffFlows(baseFlow(), after);
    expect(d.changes.some((c) => c.kind === "added" && c.blockId === "w2")).toBe(true);
  });

  it("detects a MOVE (reorder of two existing top-level blocks)", () => {
    const after = baseFlow();
    // swap m1 and g1 → both reorder relative to each other.
    [after.blocks[0], after.blocks[1]] = [after.blocks[1], after.blocks[0]];
    const d = diffFlows(baseFlow(), after);
    expect(d.summary.moved).toBeGreaterThanOrEqual(1);
    expect(d.changes.some((c) => c.kind === "moved" && (c.blockId === "m1" || c.blockId === "g1"))).toBe(true);
  });

  it("detects a MOVE across containers (re-parent into a branch)", () => {
    const after = baseFlow();
    // pull g1 out of top-level and into if1's true_branch.
    after.blocks = after.blocks.filter((b) => b.id !== "g1");
    const ifb = after.blocks.find((b) => b.id === "if1") as { true_branch: unknown[] };
    ifb.true_branch.push({ id: "g1", type: "grip", tool_id: "tool-a", force_limit_n: 40, timeout_ms: 2000 });
    const d = diffFlows(baseFlow(), after);
    const moved = d.changes.find((c) => c.kind === "moved" && c.blockId === "g1");
    expect(moved).toBeDefined();
    expect(moved!.from).toMatchObject({ parentId: null, slot: "root" });
    expect(moved!.to).toMatchObject({ parentId: "if1", slot: "true_branch" });
  });

  it("inserting a sibling does NOT spuriously flag survivors as moved", () => {
    const after = baseFlow();
    after.blocks.unshift({ id: "m0", type: "move_joint", joints: [0, 0, 0, 0, 0, 0], speed_pct: 50 });
    const d = diffFlows(baseFlow(), after);
    expect(d.summary.added).toBe(1);
    expect(d.summary.moved).toBe(0); // m1/g1/if1 kept their relative order
  });

  it("is STABLE / deterministic — same inputs → byte-identical output", () => {
    const before = baseFlow();
    const after = baseFlow();
    (after.blocks[0] as { speed_mms: number }).speed_mms = 175;
    after.blocks.push({ id: "r9", type: "release", tool_id: "tool-a" });
    const a = JSON.stringify(diffFlows(before, after));
    const b = JSON.stringify(diffFlows(before, after));
    expect(a).toBe(b);
  });

  it("assigns missing ids deterministically before diffing (fallback path)", () => {
    const before: Flow = { flow_id: "x", target_device_type: "generic", version: 1, blocks: [{ type: "wait", ms: 10 }] };
    const after: Flow = { flow_id: "x", target_device_type: "generic", version: 1, blocks: [{ type: "wait", ms: 20 }] };
    const d = diffFlows(before, after);
    // both blocks get id "b1" → matched → reported as a param modify, not add+remove.
    expect(d.summary).toMatchObject({ added: 0, removed: 0, modified: 1 });
  });
});

// ── 3-WAY MERGE ─────────────────────────────────────────────────────────────

/** Collect every block id in a flow (nested). */
function idsOf(flow: Flow): Set<string> {
  const ids = new Set<string>();
  walkBlocks(assignIds(flow).blocks, (b) => ids.add(b.id!));
  return ids;
}

describe("P5 3-way merge (irMerge)", () => {
  it("AUTO-RESOLVES disjoint changes: ours adds a block, theirs modifies another → both in result, no conflict", () => {
    const base = baseFlow();

    const ours = clone(base);
    ours.blocks.push({ id: "r1", type: "release", tool_id: "tool-a" }); // ours adds

    const theirs = clone(base);
    (theirs.blocks[1] as { force_limit_n: number }).force_limit_n = 20; // theirs modifies g1

    const res = mergeFlows(base, ours, theirs);
    expect(res.clean).toBe(true);
    expect(res.conflicts).toHaveLength(0);

    const ids = idsOf(res.merged);
    expect(ids.has("r1")).toBe(true); // ours' addition survived
    const g1 = res.merged.blocks.find((b) => b.id === "g1") as { force_limit_n: number };
    expect(g1.force_limit_n).toBe(20); // theirs' modification applied
  });

  it("auto-merges DISJOINT param edits on the SAME block (ours changes speed, theirs changes accel)", () => {
    const base = baseFlow();
    const ours = clone(base);
    (ours.blocks[0] as { speed_mms: number }).speed_mms = 150;
    const theirs = clone(base);
    (theirs.blocks[0] as { acceleration: number }).acceleration = 300;

    const res = mergeFlows(base, ours, theirs);
    expect(res.clean).toBe(true);
    const m1 = res.merged.blocks[0] as { speed_mms: number; acceleration: number };
    expect(m1.speed_mms).toBe(150);
    expect(m1.acceleration).toBe(300);
  });

  it("FLAGS a true conflict (both modify the SAME param differently) — never silently resolved", () => {
    const base = baseFlow();
    const ours = clone(base);
    (ours.blocks[0] as { speed_mms: number }).speed_mms = 150;
    const theirs = clone(base);
    (theirs.blocks[0] as { speed_mms: number }).speed_mms = 200;

    const res = mergeFlows(base, ours, theirs);
    expect(res.clean).toBe(false);
    const conflict = res.conflicts.find((c) => c.type === "param" && c.blockId === "m1" && c.param === "speed_mms");
    expect(conflict).toBeDefined();
    // BOTH sides preserved for resolution.
    expect(conflict!.base).toBe(100);
    expect(conflict!.ours).toBe(150);
    expect(conflict!.theirs).toBe(200);
    // the block is retained (never dropped); provisional value = ours.
    expect(idsOf(res.merged).has("m1")).toBe(true);
    expect((res.merged.blocks[0] as { speed_mms: number }).speed_mms).toBe(150);
  });

  it("NEVER DROPS a block: modify-on-one-side / delete-on-the-other → conflict + block kept", () => {
    const base = baseFlow();
    const ours = clone(base);
    (ours.blocks[1] as { force_limit_n: number }).force_limit_n = 10; // ours modifies g1
    const theirs = clone(base);
    theirs.blocks = theirs.blocks.filter((b) => b.id !== "g1"); // theirs deletes g1

    const res = mergeFlows(base, ours, theirs);
    expect(res.clean).toBe(false);
    expect(res.conflicts.some((c) => c.type === "modify-delete" && c.blockId === "g1")).toBe(true);
    expect(idsOf(res.merged).has("g1")).toBe(true); // KEPT, not dropped
  });

  it("applies an UNCONTESTED delete (theirs deletes, ours untouched)", () => {
    const base = baseFlow();
    const ours = clone(base);
    const theirs = clone(base);
    theirs.blocks = theirs.blocks.filter((b) => b.id !== "g1");

    const res = mergeFlows(base, ours, theirs);
    expect(res.clean).toBe(true);
    expect(idsOf(res.merged).has("g1")).toBe(false); // uncontested delete applied
    expect(res.stats.deleted).toBe(1);
  });

  it("flags an ADD/ADD conflict (same id added on both sides with different params)", () => {
    const base = baseFlow();
    const ours = clone(base);
    ours.blocks.push({ id: "new", type: "wait", ms: 100 });
    const theirs = clone(base);
    theirs.blocks.push({ id: "new", type: "wait", ms: 250 });

    const res = mergeFlows(base, ours, theirs);
    expect(res.conflicts.some((c) => c.type === "add-add" && c.blockId === "new")).toBe(true);
    expect(idsOf(res.merged).has("new")).toBe(true);
  });

  it("merges disjoint edits INSIDE a branch (ours edits the nested wait, theirs adds to the other branch)", () => {
    const base = baseFlow();
    const ours = clone(base);
    ((ours.blocks[2] as { true_branch: Array<{ ms: number }> }).true_branch[0]).ms = 111;
    const theirs = clone(base);
    (theirs.blocks[2] as { false_branch: unknown[] }).false_branch.push({ id: "w2", type: "wait", ms: 42 });

    const res = mergeFlows(base, ours, theirs);
    expect(res.clean).toBe(true);
    const ifb = res.merged.blocks.find((b) => b.id === "if1") as { true_branch: Array<{ ms: number }>; false_branch: Array<{ id: string }> };
    expect(ifb.true_branch[0].ms).toBe(111);
    expect(ifb.false_branch.some((b) => b.id === "w2")).toBe(true);
  });

  it("identical ours & theirs → clean merge equal to that flow (no conflicts)", () => {
    const base = baseFlow();
    const same = clone(base);
    (same.blocks[0] as { speed_mms: number }).speed_mms = 123;
    const res = mergeFlows(base, clone(same), clone(same));
    expect(res.clean).toBe(true);
    expect((res.merged.blocks[0] as { speed_mms: number }).speed_mms).toBe(123);
    expect(countBlocks(res.merged)).toBe(countBlocks(base));
  });

  it("merge output is deterministic (same inputs → byte-identical)", () => {
    const base = baseFlow();
    const ours = clone(base);
    ours.blocks.push({ id: "r1", type: "release", tool_id: "tool-a" });
    const theirs = clone(base);
    (theirs.blocks[1] as { force_limit_n: number }).force_limit_n = 20;
    const a = JSON.stringify(mergeFlows(base, clone(ours), clone(theirs)));
    const b = JSON.stringify(mergeFlows(base, clone(ours), clone(theirs)));
    expect(a).toBe(b);
  });
});
