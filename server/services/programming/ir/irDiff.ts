/**
 * Doc 24 Wave-4 P5 — BLOCK-LEVEL IR DIFF (by stable id + structural position).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Program artifacts are stored append-only as immutable versions (drizzle
 * program_artifacts, one JSON `Flow` per branch/version). Until now there was NO way to
 * see WHAT changed between two versions. This module computes a deterministic, structural
 * diff of two IR flows — the layer a version-compare view and the 3-way merge (irMerge.ts)
 * both build on.
 *
 * ALGORITHM (by-id + structural):
 *   1. Every block carries a STABLE id (assignIds fills any missing one deterministically).
 *      We index each flow into a Map<id, IndexedBlock> capturing, per block:
 *        • its own params (all leaf fields EXCEPT id + the child-list slots), and
 *        • its structural POSITION { parentId, slot, index } — where it lives in the tree.
 *   2. A block present in AFTER but not BEFORE → ADDED. Present in BEFORE only → REMOVED.
 *   3. A block present in BOTH:
 *        • MODIFIED — if any own param differs (deep, order-independent compare). We report
 *          exactly WHICH params changed (before/after values).
 *        • MOVED — if it was re-parented / changed slot, OR its order relative to the
 *          blocks common to that container changed (so inserting/removing a sibling does
 *          NOT spuriously flag every following block as moved). A block can be BOTH
 *          modified and moved (two entries), which is honest.
 *   4. Recurses through if_condition branches (true/false) and loop bodies.
 *
 * DETERMINISM: changes are emitted in a fixed order (AFTER depth-first for added/modified/
 * moved, then BEFORE depth-first for removed; modified before moved for the same id) and
 * param lists are key-sorted → identical inputs always produce byte-identical output.
 *
 * SAFETY: PURE DATA + PURE FUNCTIONS. No I/O, no device path, no eval.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { assignIds, type Flow, type IrBlock, type IrBlockType } from "./irModel";

/** Which child list a block sits in (root = a top-level block, not inside a container). */
export type SlotKey = "root" | "true_branch" | "false_branch" | "body";

/** Where a block lives in the tree: its parent block id, the slot, and index within it. */
export interface BlockPosition {
  parentId: string | null;
  slot: SlotKey;
  index: number;
}

/** A block indexed by id with its structural position + own (non-child) params. */
export interface IndexedBlock {
  id: string;
  type: IrBlockType;
  /** Every own field EXCEPT `id` and the child-list slots (true_branch/false_branch/body). */
  ownParams: Record<string, unknown>;
  position: BlockPosition;
  /** Human-readable path (mirrors walkBlocks: e.g. "3.true.0"). */
  path: string;
}

export type IrChangeKind = "added" | "removed" | "modified" | "moved";

/** A single changed param on a MODIFIED block. */
export interface ParamChange {
  param: string;
  before: unknown;
  after: unknown;
}

/** One block-level change. */
export interface IrChange {
  kind: IrChangeKind;
  blockId: string;
  blockType: IrBlockType;
  /** Path in the AFTER flow (or the BEFORE flow for a `removed` change). */
  path: string;
  /** MODIFIED: the params that changed (key-sorted, deterministic). */
  params?: ParamChange[];
  /** MOVED: the block's structural position before/after. */
  from?: BlockPosition;
  to?: BlockPosition;
}

export interface IrDiff {
  changes: IrChange[];
  summary: { added: number; removed: number; modified: number; moved: number };
}

// ── Deterministic deep compare (order-independent for object keys) ────────────

/** Canonical JSON with SORTED object keys and skipped `undefined` — stable across runs. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Deep, order-independent equality via canonical stringify. */
export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

// ── Indexing ───────────────────────────────────────────────────────────────

/** The child-list keys — excluded from a block's "own params". */
const CHILD_SLOTS = new Set(["true_branch", "false_branch", "body"]);

/** Pull a block's own params: every field except `id` and the child-list slots. */
function extractOwnParams(block: IrBlock): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(block)) {
    if (k === "id" || CHILD_SLOTS.has(k)) continue;
    out[k] = val;
  }
  return out;
}

/** A stable container key for a position (identifies one child list). */
export function containerKey(pos: BlockPosition): string {
  return `${pos.parentId ?? "∅"}|${pos.slot}`;
}

/**
 * Index a flow into Map<id, IndexedBlock> in DEPTH-FIRST order (Map preserves insertion
 * order). `assignIds` guarantees every block has a stable id first. Ids are assumed unique
 * (assignIds + the editor's nextId() both guarantee this); on the rare duplicate, the
 * first occurrence wins.
 */
export function indexFlow(input: Flow): Map<string, IndexedBlock> {
  const flow = assignIds(input);
  const map = new Map<string, IndexedBlock>();
  const visit = (blocks: IrBlock[], parentId: string | null, slot: SlotKey, prefix: string): void => {
    blocks.forEach((block, i) => {
      const id = block.id as string;
      const path = prefix ? `${prefix}.${i}` : String(i);
      if (!map.has(id)) {
        map.set(id, { id, type: block.type, ownParams: extractOwnParams(block), position: { parentId, slot, index: i }, path });
      }
      if (block.type === "if_condition") {
        visit(block.true_branch, id, "true_branch", `${path}.true`);
        visit(block.false_branch, id, "false_branch", `${path}.false`);
      } else if (block.type === "loop") {
        visit(block.body, id, "body", `${path}.body`);
      }
    });
  };
  visit(flow.blocks, null, "root", "");
  return map;
}

// ── Diff ──────────────────────────────────────────────────────────────────

/** Group an index by container key → the ordered list of ids in that child list. */
function groupByContainer(idx: Map<string, IndexedBlock>): Map<string, string[]> {
  const g = new Map<string, Array<{ id: string; index: number }>>();
  for (const [id, ib] of idx) {
    const k = containerKey(ib.position);
    let arr = g.get(k);
    if (!arr) { arr = []; g.set(k, arr); }
    arr.push({ id, index: ib.position.index });
  }
  const out = new Map<string, string[]>();
  for (const [k, arr] of g) out.set(k, arr.sort((x, y) => x.index - y.index).map((e) => e.id));
  return out;
}

/** The list of params that changed between two own-param maps (key-sorted, deterministic). */
function paramChanges(before: Record<string, unknown>, after: Record<string, unknown>): ParamChange[] {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: ParamChange[] = [];
  for (const k of [...keys].sort()) {
    if (before[k] === undefined && after[k] === undefined) continue;
    if (!deepEqual(before[k], after[k])) out.push({ param: k, before: before[k], after: after[k] });
  }
  return out;
}

/**
 * A block moved iff it changed container (re-parent / slot), OR — within the SAME
 * container — its order relative to the blocks COMMON to that container in both flows
 * changed. Restricting to common blocks means inserting/removing a sibling does not flag
 * the survivors as moved; a genuine reorder (e.g. swapping two existing blocks) does.
 */
function isMoved(
  id: string,
  b: IndexedBlock,
  a: IndexedBlock,
  bi: Map<string, IndexedBlock>,
  ai: Map<string, IndexedBlock>,
  beforeByContainer: Map<string, string[]>,
  afterByContainer: Map<string, string[]>,
): boolean {
  if (b.position.parentId !== a.position.parentId || b.position.slot !== a.position.slot) return true;
  const ckey = containerKey(a.position);
  const commonInC = (id2: string): boolean => {
    const bb = bi.get(id2);
    const aa = ai.get(id2);
    return !!bb && !!aa && containerKey(bb.position) === ckey && containerKey(aa.position) === ckey;
  };
  const beforeOrder = (beforeByContainer.get(ckey) ?? []).filter(commonInC);
  const afterOrder = (afterByContainer.get(ckey) ?? []).filter(commonInC);
  return beforeOrder.indexOf(id) !== afterOrder.indexOf(id);
}

/**
 * Compute the block-level diff of two flows. Deterministic + pure. `before`/`after` may be
 * any two `Flow` versions (e.g. two program_artifacts of the same project).
 */
export function diffFlows(before: Flow, after: Flow): IrDiff {
  const bi = indexFlow(before);
  const ai = indexFlow(after);
  const beforeByContainer = groupByContainer(bi);
  const afterByContainer = groupByContainer(ai);

  const changes: IrChange[] = [];

  // ADDED / MODIFIED / MOVED — walk AFTER in depth-first order.
  for (const [id, a] of ai) {
    const b = bi.get(id);
    if (!b) {
      changes.push({ kind: "added", blockId: id, blockType: a.type, path: a.path });
      continue;
    }
    const params = paramChanges(b.ownParams, a.ownParams);
    if (params.length > 0) {
      changes.push({ kind: "modified", blockId: id, blockType: a.type, path: a.path, params });
    }
    if (isMoved(id, b, a, bi, ai, beforeByContainer, afterByContainer)) {
      changes.push({ kind: "moved", blockId: id, blockType: a.type, path: a.path, from: b.position, to: a.position });
    }
  }

  // REMOVED — walk BEFORE in depth-first order.
  for (const [id, b] of bi) {
    if (!ai.has(id)) {
      changes.push({ kind: "removed", blockId: id, blockType: b.type, path: b.path });
    }
  }

  const summary = { added: 0, removed: 0, modified: 0, moved: 0 };
  for (const c of changes) summary[c.kind] += 1;
  return { changes, summary };
}
