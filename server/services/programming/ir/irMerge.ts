/**
 * Doc 24 Wave-4 P5 — 3-WAY IR MERGE (base + ours + theirs → merged flow + conflicts).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Given a common ANCESTOR (base) and two divergent versions (ours, theirs), auto-merge the
 * changes that DON'T overlap, and surface the ones that do as CONFLICTS — never silently
 * pick a side for a true conflict. Built on the same by-id index as irDiff.ts.
 *
 * PER-BLOCK RECONCILIATION (keyed by stable id):
 *   • EXISTENCE — a block added on one side only is taken; added on both with different
 *     params → an ADD/ADD conflict; deleted on one side while UNCHANGED on the other →
 *     the delete applies (a legitimate, uncontested edit — not a silent drop); deleted on
 *     one side while MODIFIED on the other → a MODIFY/DELETE conflict, and the block is
 *     KEPT (never dropped) pending resolution.
 *   • PARAMS — each own field is 3-way merged: if ours & theirs agree, take it; if only one
 *     side changed it from base, take that side; if BOTH changed it differently → a PARAM
 *     conflict (both values preserved; the merged flow provisionally shows OURS).
 *   • POSITION — parent/slot is 3-way merged the same way; a divergent re-parent → a MOVE
 *     conflict (provisionally OURS).
 *
 * NEVER-DROP INVARIANT: a block is removed from the output ONLY by an uncontested delete
 * (or a delete both sides made). Any block touched by a conflict is retained. A structural
 * safety net re-attaches any block that could not be placed under a merged parent (e.g. a
 * rare type/slot conflict), flagging it — so a merge can never make a block disappear.
 *
 * SAFETY: PURE DATA + PURE FUNCTIONS. No I/O, no device path, no eval. Deterministic.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Flow, IrBlock, IrBlockType } from "./irModel";
import {
  indexFlow,
  deepEqual,
  type IndexedBlock,
  type SlotKey,
} from "./irDiff";

export type MergeConflictType =
  | "param" // both sides changed the same param differently
  | "add-add" // both sides added a block with the same id but different params
  | "move" // both sides moved the block to different containers
  | "modify-delete" // one side deleted, the other modified
  | "structural" // could not place a block under a merged parent (type/slot conflict)
  | "meta"; // flow-level scalar changed differently on both sides

export interface MergeConflict {
  type: MergeConflictType;
  /** null for a flow-level (meta) conflict. */
  blockId: string | null;
  /** For param/meta conflicts — the field name. */
  param?: string;
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
  message: string;
}

export interface MergeResult {
  /** The merged flow. Conflicted values default provisionally to OURS and are flagged. */
  merged: Flow;
  conflicts: MergeConflict[];
  clean: boolean;
  stats: { autoMerged: number; conflicted: number; deleted: number; added: number };
}

type PosPair = { parentId: string | null; slot: SlotKey };

function samePosPair(a: PosPair | undefined, b: PosPair | undefined): boolean {
  if (!a || !b) return false;
  return a.parentId === b.parentId && a.slot === b.slot;
}

function posPairOf(ib: IndexedBlock | undefined): PosPair | undefined {
  return ib ? { parentId: ib.position.parentId, slot: ib.position.slot } : undefined;
}

/**
 * 3-way merge a block's own params. Field-by-field: agree → take it; one side == base →
 * take the other; both diverge → conflict (provisional = ours). Absent-on-winning-side
 * fields are skipped so the merged block stays clean.
 */
function mergeParams(
  id: string,
  B: IndexedBlock | undefined,
  O: IndexedBlock | undefined,
  T: IndexedBlock | undefined,
  conflicts: MergeConflict[],
): { params: Record<string, unknown>; hadConflict: boolean } {
  const source = O ?? T ?? B!;
  const keys = new Set<string>();
  for (const src of [B, O, T]) if (src) for (const k of Object.keys(src.ownParams)) keys.add(k);

  const out: Record<string, unknown> = {};
  let hadConflict = false;

  for (const k of [...keys].sort()) {
    const vb = B?.ownParams[k];
    const vo = O?.ownParams[k];
    const vt = T?.ownParams[k];
    let chosen: unknown;
    if (O && T) {
      if (deepEqual(vo, vt)) chosen = vo;
      else if (deepEqual(vo, vb)) chosen = vt; // ours unchanged → take theirs
      else if (deepEqual(vt, vb)) chosen = vo; // theirs unchanged → take ours
      else {
        conflicts.push({
          type: B ? "param" : "add-add",
          blockId: id,
          param: k,
          base: vb,
          ours: vo,
          theirs: vt,
          message: `Block ${id}: param "${k}" changed differently on both sides.`,
        });
        chosen = vo; // provisional = ours (flagged; never silently resolved)
        hadConflict = true;
      }
    } else if (O) {
      chosen = vo;
    } else {
      chosen = vt;
    }
    if (chosen !== undefined) out[k] = chosen;
  }

  if (out.type === undefined) out.type = source.type;
  return { params: out, hadConflict };
}

/** 3-way merge a block's container (parent + slot). Divergent re-parent → a MOVE conflict. */
function mergePosition(
  id: string,
  B: IndexedBlock | undefined,
  O: IndexedBlock | undefined,
  T: IndexedBlock | undefined,
  conflicts: MergeConflict[],
): PosPair {
  const pb = posPairOf(B);
  const po = posPairOf(O);
  const pt = posPairOf(T);
  if (O && T) {
    if (samePosPair(po, pt)) return po!;
    if (samePosPair(po, pb)) return pt!;
    if (samePosPair(pt, pb)) return po!;
    conflicts.push({
      type: "move",
      blockId: id,
      base: pb,
      ours: po,
      theirs: pt,
      message: `Block ${id} was moved to different containers on both sides.`,
    });
    return po!; // provisional = ours
  }
  return (po ?? pt)!;
}

/** 3-way merge a flow-level scalar. Divergent → a META conflict (provisional = ours). */
function mergeScalar<V>(name: string, b: V, o: V, t: V, conflicts: MergeConflict[]): V {
  if (deepEqual(o, t)) return o;
  if (deepEqual(o, b)) return t;
  if (deepEqual(t, b)) return o;
  conflicts.push({ type: "meta", blockId: null, param: name, base: b, ours: o, theirs: t, message: `Flow field "${name}" changed differently on both sides.` });
  return o;
}

/**
 * 3-way merge two divergent flows against their common ancestor. Returns the merged flow +
 * the list of conflicts (empty ⇒ a clean auto-merge). Pure + deterministic + never drops a
 * block that either side still wants.
 */
export function mergeFlows(baseInput: Flow, oursInput: Flow, theirsInput: Flow): MergeResult {
  const bi = indexFlow(baseInput);
  const oi = indexFlow(oursInput);
  const ti = indexFlow(theirsInput);

  const conflicts: MergeConflict[] = [];
  const stats = { autoMerged: 0, conflicted: 0, deleted: 0, added: 0 };

  const allIds = new Set<string>([...bi.keys(), ...oi.keys(), ...ti.keys()]);

  const kept = new Set<string>();
  const mergedParams = new Map<string, Record<string, unknown>>();
  const mergedPos = new Map<string, PosPair>();
  const orderIndex = new Map<string, number>();
  const orderRank = new Map<string, number>(); // 0 base · 1 ours · 2 theirs

  for (const id of allIds) {
    const B = bi.get(id);
    const O = oi.get(id);
    const T = ti.get(id);

    // ── Existence resolution ──
    if (O && T) {
      kept.add(id);
    } else if (O && !T) {
      if (B) {
        const oursChanged = !deepEqual(O.ownParams, B.ownParams) || !samePosPair(posPairOf(O), posPairOf(B));
        if (oursChanged) {
          conflicts.push({ type: "modify-delete", blockId: id, message: `Block ${id} was modified by ours but deleted by theirs — kept for resolution.` });
          kept.add(id);
        } else {
          stats.deleted += 1; // uncontested delete by theirs
          continue;
        }
      } else {
        kept.add(id);
        stats.added += 1;
      }
    } else if (!O && T) {
      if (B) {
        const theirsChanged = !deepEqual(T.ownParams, B.ownParams) || !samePosPair(posPairOf(T), posPairOf(B));
        if (theirsChanged) {
          conflicts.push({ type: "modify-delete", blockId: id, message: `Block ${id} was modified by theirs but deleted by ours — kept for resolution.` });
          kept.add(id);
        } else {
          stats.deleted += 1; // uncontested delete by ours
          continue;
        }
      } else {
        kept.add(id);
        stats.added += 1;
      }
    } else {
      // In neither ours nor theirs.
      if (B) stats.deleted += 1; // both deleted (agree)
      continue;
    }

    // ── Params + position 3-way merge (for kept ids) ──
    const before = conflicts.length;
    const { params } = mergeParams(id, B, O, T, conflicts);
    mergedParams.set(id, params);
    mergedPos.set(id, mergePosition(id, B, O, T, conflicts));
    if (conflicts.length === before && O && T) stats.autoMerged += 1;

    // ── Ordering source (prefer ours, then theirs, then base) ──
    if (O) { orderIndex.set(id, O.position.index); orderRank.set(id, 1); }
    else if (T) { orderIndex.set(id, T.position.index); orderRank.set(id, 2); }
    else if (B) { orderIndex.set(id, B.position.index); orderRank.set(id, 0); }
  }

  // ── Rebuild the merged tree from merged positions ──
  const orderCmp = (x: string, y: string): number => {
    const ix = orderIndex.get(x) ?? 0;
    const iy = orderIndex.get(y) ?? 0;
    if (ix !== iy) return ix - iy;
    const rx = orderRank.get(x) ?? 0;
    const ry = orderRank.get(y) ?? 0;
    if (rx !== ry) return rx - ry;
    return x < y ? -1 : x > y ? 1 : 0;
  };

  const emitted = new Set<string>();
  const buildBlock = (id: string): IrBlock => {
    emitted.add(id);
    const params: Record<string, unknown> = { ...mergedParams.get(id)!, id };
    const type = params.type as IrBlockType;
    if (type === "if_condition") {
      params.true_branch = build(id, "true_branch");
      params.false_branch = build(id, "false_branch");
    } else if (type === "loop") {
      params.body = build(id, "body");
    }
    return params as unknown as IrBlock;
  };
  function build(parentId: string | null, slot: SlotKey): IrBlock[] {
    const members: string[] = [];
    for (const id of kept) {
      const p = mergedPos.get(id)!;
      if (p.parentId === parentId && p.slot === slot) members.push(id);
    }
    members.sort(orderCmp);
    return members.map(buildBlock);
  }

  const blocks = build(null, "root");

  // ── Structural safety net — re-attach any un-placed block so nothing is dropped ──
  for (const id of kept) {
    if (!emitted.has(id)) {
      blocks.push(buildBlock(id));
      conflicts.push({ type: "structural", blockId: id, message: `Block ${id} could not be placed under its merged parent (type/slot conflict) — appended at top level for review.` });
    }
  }

  // ── Flow-level scalars ──
  const merged: Flow = {
    flow_id: mergeScalar("flow_id", baseInput.flow_id, oursInput.flow_id, theirsInput.flow_id, conflicts),
    target_device_type: mergeScalar("target_device_type", baseInput.target_device_type, oursInput.target_device_type, theirsInput.target_device_type, conflicts),
    version: mergeScalar("version", baseInput.version, oursInput.version, theirsInput.version, conflicts),
    blocks,
  };
  const mergedAuthor = mergeScalar("author", baseInput.author, oursInput.author, theirsInput.author, conflicts);
  if (mergedAuthor !== undefined) merged.author = mergedAuthor;
  const mergedCap = mergeScalar("linked_capability", baseInput.linked_capability, oursInput.linked_capability, theirsInput.linked_capability, conflicts);
  if (mergedCap !== undefined) merged.linked_capability = mergedCap;

  stats.conflicted = conflicts.length;
  return { merged, conflicts, clean: conflicts.length === 0, stats };
}
