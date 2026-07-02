/**
 * Doc 24 Wave-1 P2 — SHARED client IR tree model + pure helpers.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Extracted from IrEditor.tsx so BOTH the nested-tree view (BlockCard) AND the new
 * node-graph canvas (IrGraphCanvas) operate on the SAME typed IR AST via the SAME pure
 * mutation helpers. This is what guarantees the tree ↔ graph round-trip produces
 * byte-identical IR JSON: they are two renderers over one source of truth, and every
 * edit — from either view — flows through `addChild` / `updateBlock` / `deleteBlock` /
 * `moveBlock` here.
 *
 * These types MIRROR server/services/programming/ir/irModel.ts (the Zod discriminated
 * union). This module is PURE DATA + PURE FUNCTIONS — no React, no side effects, no
 * device path. It does NOT change the IR semantics; it only re-hosts the client helpers.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { TFunction } from "i18next";
import {
  Move, Rotate3d, Hand, HandMetal, ToggleRight, Hourglass, GitBranch, Repeat,
} from "lucide-react";

// ── Local IR types (mirror the server irModel input shape) ────────────────────
export type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
export type CompareOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
export type SignalCondition = { signal_ref: string; operator: CompareOp; value: number | boolean | string };

export type MoveLinearBlock = { id?: string; type: "move_linear"; target_pose: Pose; speed_mms: number; acceleration: number; blend_radius: number };
export type MoveJointBlock = { id?: string; type: "move_joint"; joints: number[]; speed_pct: number };
export type GripBlock = { id?: string; type: "grip"; tool_id: string; force_limit_n: number; timeout_ms: number };
export type ReleaseBlock = { id?: string; type: "release"; tool_id?: string };
export type SetOutputBlock = { id?: string; type: "set_output"; signal: string; value: boolean | number };
export type WaitBlock = { id?: string; type: "wait"; signal_ref?: string; ms?: number };
export type IfConditionBlock = { id?: string; type: "if_condition"; signal_ref: string; operator: CompareOp; value: number | boolean | string; true_branch: IrBlock[]; false_branch: IrBlock[] };
export type LoopBlock = { id?: string; type: "loop"; count?: number; while?: SignalCondition; body: IrBlock[] };

export type IrBlock =
  | MoveLinearBlock | MoveJointBlock | GripBlock | ReleaseBlock
  | SetOutputBlock | WaitBlock | IfConditionBlock | LoopBlock;
export type BlockType = IrBlock["type"];

export type TargetDeviceType = "universal-robots" | "ros2" | "generic";
export type Flow = {
  flow_id: string;
  target_device_type: TargetDeviceType;
  version: number;
  author?: string;
  linked_capability?: string;
  blocks: IrBlock[];
};

// ── Block metadata (icon / label / group) ─────────────────────────────────────
export const BLOCK_ICON: Record<BlockType, typeof Move> = {
  move_linear: Move,
  move_joint: Rotate3d,
  grip: Hand,
  release: HandMetal,
  set_output: ToggleRight,
  wait: Hourglass,
  if_condition: GitBranch,
  loop: Repeat,
};

export const BLOCK_LABEL: Record<BlockType, { key: string; def: string }> = {
  move_linear: { key: "ir.block.move_linear", def: "Move linear" },
  move_joint: { key: "ir.block.move_joint", def: "Move joint" },
  grip: { key: "ir.block.grip", def: "Grip" },
  release: { key: "ir.block.release", def: "Release" },
  set_output: { key: "ir.block.set_output", def: "Set output" },
  wait: { key: "ir.block.wait", def: "Wait" },
  if_condition: { key: "ir.block.if_condition", def: "If condition" },
  loop: { key: "ir.block.loop", def: "Loop" },
};

export const PALETTE_GROUPS: Array<{ label: { key: string; def: string }; types: BlockType[] }> = [
  { label: { key: "ir.group.motion", def: "Motion" }, types: ["move_linear", "move_joint"] },
  { label: { key: "ir.group.io", def: "I/O" }, types: ["grip", "release", "set_output", "wait"] },
  { label: { key: "ir.group.control", def: "Control" }, types: ["if_condition", "loop"] },
];

export const COMPARE_OPS: CompareOp[] = ["eq", "neq", "lt", "lte", "gt", "gte"];
export const TARGET_DEVICE_TYPES: TargetDeviceType[] = ["universal-robots", "ros2", "generic"];

// ── Block factory (sane defaults inside the linter's default AABB / ceilings) ──
let uid = 0;
export function nextId(): string {
  uid += 1;
  return `n${Date.now().toString(36)}${uid}`;
}

export function newBlock(type: BlockType): IrBlock {
  const id = nextId();
  switch (type) {
    case "move_linear":
      return { id, type, target_pose: { x: 0, y: 0, z: 200, rx: 0, ry: 0, rz: 0 }, speed_mms: 100, acceleration: 200, blend_radius: 0 };
    case "move_joint":
      return { id, type, joints: [0, 0, 0, 0, 0, 0], speed_pct: 50 };
    case "grip":
      return { id, type, tool_id: "gripper-1", force_limit_n: 40, timeout_ms: 2000 };
    case "release":
      return { id, type, tool_id: "gripper-1" };
    case "set_output":
      return { id, type, signal: "DO1", value: true };
    case "wait":
      return { id, type, ms: 500 };
    case "if_condition":
      return { id, type, signal_ref: "DI1", operator: "eq", value: true, true_branch: [], false_branch: [] };
    case "loop":
      return { id, type, count: 3, body: [] };
  }
}

// ── Pure tree ops (child-list aware: true_branch / false_branch / body) ────────
export type Slot = "true_branch" | "false_branch" | "body";

export function childSlots(b: IrBlock): Slot[] {
  if (b.type === "if_condition") return ["true_branch", "false_branch"];
  if (b.type === "loop") return ["body"];
  return [];
}
export function getChildren(b: IrBlock, slot: Slot): IrBlock[] {
  return ((b as unknown as Record<Slot, IrBlock[] | undefined>)[slot] ?? []);
}

/** True if this block type can contain children (drop target for add-into-slot). */
export function isContainer(b: IrBlock): boolean {
  return b.type === "if_condition" || b.type === "loop";
}
/** The default slot to append into when a child is dropped onto a container node. */
export function defaultSlot(b: IrBlock): Slot | null {
  if (b.type === "if_condition") return "true_branch";
  if (b.type === "loop") return "body";
  return null;
}

export function cloneBlocks(blocks: IrBlock[]): IrBlock[] {
  return blocks.map((b) => {
    if (b.type === "if_condition") return { ...b, true_branch: cloneBlocks(b.true_branch), false_branch: cloneBlocks(b.false_branch) };
    if (b.type === "loop") return { ...b, body: cloneBlocks(b.body) };
    return { ...b };
  });
}

export function findBlock(blocks: IrBlock[], id: string): IrBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    for (const slot of childSlots(b)) {
      const hit = findBlock(getChildren(b, slot), id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Apply a patch to the block with `id`, on a fresh clone (immutable). */
export function updateBlock(blocks: IrBlock[], id: string, patch: Partial<IrBlock>): IrBlock[] {
  return blocks.map((b) => {
    if (b.id === id) return { ...b, ...patch } as IrBlock;
    if (b.type === "if_condition") return { ...b, true_branch: updateBlock(b.true_branch, id, patch), false_branch: updateBlock(b.false_branch, id, patch) };
    if (b.type === "loop") return { ...b, body: updateBlock(b.body, id, patch) };
    return b;
  });
}

export function deleteBlock(blocks: IrBlock[], id: string): IrBlock[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) => {
      if (b.type === "if_condition") return { ...b, true_branch: deleteBlock(b.true_branch, id), false_branch: deleteBlock(b.false_branch, id) };
      if (b.type === "loop") return { ...b, body: deleteBlock(b.body, id) };
      return b;
    });
}

function moveInList(list: IrBlock[], id: string, dir: -1 | 1): IrBlock[] {
  const i = list.findIndex((b) => b.id === id);
  if (i < 0) return list;
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
/** Move a block up/down within whatever list contains it (top-level or a slot). */
export function moveBlock(blocks: IrBlock[], id: string, dir: -1 | 1): IrBlock[] {
  if (blocks.some((b) => b.id === id)) return moveInList(blocks, id, dir);
  return blocks.map((b) => {
    if (b.type === "if_condition") return { ...b, true_branch: moveBlock(b.true_branch, id, dir), false_branch: moveBlock(b.false_branch, id, dir) };
    if (b.type === "loop") return { ...b, body: moveBlock(b.body, id, dir) };
    return b;
  });
}

/**
 * Reorder `sourceId` to sit immediately AFTER `targetId` when they share the same list
 * (top-level or a slot). No-op if they are not siblings (cross-list re-parenting is out
 * of scope — this keeps the round-trip lossless and avoids ambiguous slot moves). Pure /
 * immutable. Used by the graph canvas when a user reconnects a `next` edge.
 */
export function reorderRelativeToSibling(blocks: IrBlock[], sourceId: string, targetId: string): IrBlock[] {
  const reorderList = (list: IrBlock[]): IrBlock[] => {
    const si = list.findIndex((b) => b.id === sourceId);
    const ti = list.findIndex((b) => b.id === targetId);
    if (si >= 0 && ti >= 0 && si !== ti) {
      const next = list.filter((b) => b.id !== sourceId);
      const insertAt = next.findIndex((b) => b.id === targetId) + 1;
      next.splice(insertAt, 0, list[si]);
      return next;
    }
    return list;
  };
  // Only ONE list can contain both siblings; recurse to find it and reorder there.
  const walk = (list: IrBlock[]): IrBlock[] => {
    const bothHere = list.some((b) => b.id === sourceId) && list.some((b) => b.id === targetId);
    const reordered = bothHere ? reorderList(list) : list;
    return reordered.map((b) => {
      if (b.type === "if_condition") return { ...b, true_branch: walk(b.true_branch), false_branch: walk(b.false_branch) };
      if (b.type === "loop") return { ...b, body: walk(b.body) };
      return b;
    });
  };
  return walk(blocks);
}

/** Append a child block into a container's slot. */
export function addChild(blocks: IrBlock[], parentId: string, slot: Slot, child: IrBlock): IrBlock[] {
  return blocks.map((b) => {
    if (b.id === parentId) {
      if (b.type === "if_condition" && (slot === "true_branch" || slot === "false_branch")) {
        return { ...b, [slot]: [...b[slot], child] } as IrBlock;
      }
      if (b.type === "loop" && slot === "body") {
        return { ...b, body: [...b.body, child] };
      }
      return b;
    }
    if (b.type === "if_condition") return { ...b, true_branch: addChild(b.true_branch, parentId, slot, child), false_branch: addChild(b.false_branch, parentId, slot, child) };
    if (b.type === "loop") return { ...b, body: addChild(b.body, parentId, slot, child) };
    return b;
  });
}

// ── Human-readable one-line summary per block (for the canvas card) ───────────
export function summarize(b: IrBlock, t: TFunction): string {
  switch (b.type) {
    case "move_linear": {
      const p = b.target_pose;
      return `→ (${p.x}, ${p.y}, ${p.z}) · ${b.speed_mms} mm/s`;
    }
    case "move_joint":
      return `[${b.joints.join(", ")}] · ${b.speed_pct}%`;
    case "grip":
      return `${b.tool_id} · ${b.force_limit_n} N · ${b.timeout_ms} ms`;
    case "release":
      return b.tool_id ?? t("ir.sum.releaseAny", "release tool");
    case "set_output":
      return `${b.signal} = ${String(b.value)}`;
    case "wait":
      return [b.signal_ref ? `signal ${b.signal_ref}` : null, b.ms != null ? `${b.ms} ms` : null].filter(Boolean).join(" · ") || "—";
    case "if_condition":
      return `${b.signal_ref} ${b.operator} ${String(b.value)}`;
    case "loop":
      return b.count != null ? `${t("ir.sum.count", "count")} ${b.count}` : t("ir.sum.while", "while condition");
  }
}
