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
  Variable, Sigma, TimerReset, Gauge, SlidersHorizontal, Boxes,
} from "lucide-react";

// ── Local IR types (mirror the server irModel input shape) ────────────────────
/**
 * W4-19: vị trí node phụ trợ (UI-only) để LƯU toạ độ kéo-thả trên canvas graph.
 * Optional + additive — transpile/lint bỏ qua; một flow không có `ui` round-trip y hệt.
 */
export type NodeUi = { x: number; y: number };
export type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
export type CompareOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
export type SignalCondition = { signal_ref: string; operator: CompareOp; value: number | boolean | string };

// ── P3: safe typed expression AST (mirrors server irExpr.ts) ──────────────────
export type ExprBinOp =
  | "add" | "sub" | "mul" | "div" | "mod"
  | "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
  | "and" | "or";
export type Expr =
  | { kind: "lit"; value: number | boolean }
  | { kind: "var"; name: string }
  | { kind: "binop"; op: ExprBinOp; left: Expr; right: Expr };
/** A value slot: a bare literal (backward-compatible) OR a first-class expression. */
export type NumericOrExpr = number | boolean | Expr;

export const EXPR_BINOPS: ExprBinOp[] = [
  "add", "sub", "mul", "div", "mod", "eq", "neq", "lt", "lte", "gt", "gte", "and", "or",
];
/** Human infix label for a binop (used by the mini expression editor). */
export const EXPR_OP_LABEL: Record<ExprBinOp, string> = {
  add: "+", sub: "-", mul: "*", div: "/", mod: "%",
  eq: "==", neq: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=", and: "and", or: "or",
};

/** Type guard: is this value slot an Expr node (vs a bare literal)? */
export function isExpr(v: unknown): v is Expr {
  return typeof v === "object" && v !== null && "kind" in (v as Record<string, unknown>)
    && (["lit", "var", "binop"] as const).includes((v as { kind: unknown }).kind as never);
}

/** Render an expression / value slot to a compact human string (for summaries). */
export function exprToText(v: NumericOrExpr): string {
  if (!isExpr(v)) return String(v);
  switch (v.kind) {
    case "lit": return String(v.value);
    case "var": return v.name;
    case "binop": return `(${exprToText(v.left)} ${EXPR_OP_LABEL[v.op]} ${exprToText(v.right)})`;
  }
}

export type MoveLinearBlock = { id?: string; ui?: NodeUi; type: "move_linear"; target_pose: Pose; speed_mms: number; acceleration: number; blend_radius: number };
export type MoveJointBlock = { id?: string; ui?: NodeUi; type: "move_joint"; joints: number[]; speed_pct: number };
export type GripBlock = { id?: string; ui?: NodeUi; type: "grip"; tool_id: string; force_limit_n: number; timeout_ms: number };
export type ReleaseBlock = { id?: string; ui?: NodeUi; type: "release"; tool_id?: string };
export type SetOutputBlock = { id?: string; ui?: NodeUi; type: "set_output"; signal: string; value: NumericOrExpr };
export type WaitBlock = { id?: string; ui?: NodeUi; type: "wait"; signal_ref?: string; ms?: number | Expr };
export type IfConditionBlock = { id?: string; ui?: NodeUi; type: "if_condition"; signal_ref: string; operator: CompareOp; value: number | boolean | string; true_branch: IrBlock[]; false_branch: IrBlock[] };
export type LoopBlock = { id?: string; ui?: NodeUi; type: "loop"; count?: number; while?: SignalCondition; body: IrBlock[] };
// P3 additions (all leaf blocks)
export type SetVariableBlock = { id?: string; ui?: NodeUi; type: "set_variable"; name: string; expr: Expr };
export type CounterBlock = { id?: string; ui?: NodeUi; type: "counter"; name: string; op: "increment" | "reset"; amount: number };
export type WaitUntilBlock = { id?: string; ui?: NodeUi; type: "wait_until"; condition: Expr; timeout_ms: number; poll_ms: number };
export type SetAnalogBlock = { id?: string; ui?: NodeUi; type: "set_analog"; channel: string; value: NumericOrExpr; unit?: string };
export type PidControlBlock = { id?: string; ui?: NodeUi; type: "pid_control"; output_channel: string; input_channel: string; setpoint: NumericOrExpr; kp: number; ki: number; kd: number; output_min: number; output_max: number };
// Tier-1c: reusable function-block (POU) CALL site — a leaf block.
export type CallArg = { name: string; value: NumericOrExpr };
export type CallBlock = { id?: string; ui?: NodeUi; type: "call_block"; fb_name: string; args: CallArg[] };

export type IrBlock =
  | MoveLinearBlock | MoveJointBlock | GripBlock | ReleaseBlock
  | SetOutputBlock | WaitBlock | IfConditionBlock | LoopBlock
  | SetVariableBlock | CounterBlock | WaitUntilBlock | SetAnalogBlock | PidControlBlock
  | CallBlock;
export type BlockType = IrBlock["type"];

// ── Tier-1c: reusable function-block (POU) DEFINITION (mirrors server irModel) ──
export type FbParamKind = "input" | "output" | "inout";
export type FbParamType = "number" | "bool" | "signal";
export type FbParam = { name: string; kind: FbParamKind; type: FbParamType };
export type FunctionBlockDef = { id?: string; name: string; params: FbParam[]; body: IrBlock[] };
export const FB_PARAM_KINDS: FbParamKind[] = ["input", "output", "inout"];
export const FB_PARAM_TYPES: FbParamType[] = ["number", "bool", "signal"];

export type TargetDeviceType = "universal-robots" | "ros2" | "generic";
export type Flow = {
  flow_id: string;
  target_device_type: TargetDeviceType;
  version: number;
  author?: string;
  linked_capability?: string;
  /** Tier-1c: reusable function-block definitions, callable via a call_block. */
  function_blocks?: FunctionBlockDef[];
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
  // P3
  set_variable: Variable,
  counter: Sigma,
  wait_until: TimerReset,
  set_analog: Gauge,
  pid_control: SlidersHorizontal,
  // Tier-1c
  call_block: Boxes,
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
  // P3
  set_variable: { key: "ir.block.set_variable", def: "Set variable" },
  counter: { key: "ir.block.counter", def: "Counter" },
  wait_until: { key: "ir.block.wait_until", def: "Wait until" },
  set_analog: { key: "ir.block.set_analog", def: "Set analog" },
  pid_control: { key: "ir.block.pid_control", def: "PID control" },
  // Tier-1c
  call_block: { key: "ir.block.call_block", def: "Call function block" },
};

export const PALETTE_GROUPS: Array<{ label: { key: string; def: string }; types: BlockType[] }> = [
  { label: { key: "ir.group.motion", def: "Motion" }, types: ["move_linear", "move_joint"] },
  { label: { key: "ir.group.io", def: "I/O" }, types: ["grip", "release", "set_output", "set_analog", "wait"] },
  { label: { key: "ir.group.data", def: "Data & timing" }, types: ["set_variable", "counter", "wait_until"] },
  { label: { key: "ir.group.control", def: "Control" }, types: ["if_condition", "loop", "pid_control"] },
  { label: { key: "ir.group.subroutines", def: "Subroutines" }, types: ["call_block"] },
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
    // P3 defaults — all lint-clean under the default ceilings.
    case "set_variable":
      return { id, type, name: "x", expr: { kind: "lit", value: 0 } };
    case "counter":
      return { id, type, name: "counter", op: "increment", amount: 1 };
    case "wait_until":
      return { id, type, condition: { kind: "lit", value: true }, timeout_ms: 5000, poll_ms: 50 };
    case "set_analog":
      return { id, type, channel: "AO1", value: 0, unit: "V" };
    case "pid_control":
      return { id, type, output_channel: "AO1", input_channel: "AI1", setpoint: 0, kp: 1, ki: 0, kd: 0, output_min: 0, output_max: 10 };
    // Tier-1c — an unbound call (the inspector picks the function block + fills args).
    case "call_block":
      return { id, type, fb_name: "", args: [] };
  }
}

// ── Tier-1c: function-block (POU) factories + flow-level pure helpers ───────────

/** A new empty function-block definition with a unique default name. */
export function newFunctionBlock(existing: FunctionBlockDef[] = []): FunctionBlockDef {
  let n = existing.length + 1;
  const taken = new Set(existing.map((f) => f.name));
  while (taken.has(`block_${n}`)) n += 1;
  return { id: nextId(), name: `block_${n}`, params: [], body: [] };
}

/** A new function-block parameter (default input:number). */
export function newFbParam(existing: FbParam[] = []): FbParam {
  let n = existing.length + 1;
  const taken = new Set(existing.map((p) => p.name));
  while (taken.has(`p${n}`)) n += 1;
  return { name: `p${n}`, kind: "input", type: "number" };
}

/** Append a function-block definition (immutable). */
export function addFunctionBlock(flow: Flow, def: FunctionBlockDef): Flow {
  return { ...flow, function_blocks: [...(flow.function_blocks ?? []), def] };
}

/** Patch a function-block definition by id (immutable). */
export function updateFunctionBlock(flow: Flow, fbId: string, patch: Partial<FunctionBlockDef>): Flow {
  return {
    ...flow,
    function_blocks: (flow.function_blocks ?? []).map((fb) => (fb.id === fbId ? { ...fb, ...patch } : fb)),
  };
}

/** Delete a function-block definition by id (immutable). */
export function deleteFunctionBlock(flow: Flow, fbId: string): Flow {
  return { ...flow, function_blocks: (flow.function_blocks ?? []).filter((fb) => fb.id !== fbId) };
}

/**
 * Build the DEFAULT argument bindings for a call to `def`: one entry per input/inout
 * parameter, seeded with a type-appropriate literal. Outputs are omitted (they are results).
 */
export function defaultArgsFor(def: FunctionBlockDef): CallArg[] {
  return def.params
    .filter((p) => p.kind !== "output")
    .map((p) => ({ name: p.name, value: (p.type === "bool" ? false : 0) as NumericOrExpr }));
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
      return `${b.signal} = ${exprToText(b.value)}`;
    case "wait":
      return [b.signal_ref ? `signal ${b.signal_ref}` : null, b.ms != null ? `${exprToText(b.ms)} ms` : null].filter(Boolean).join(" · ") || "—";
    case "if_condition":
      return `${b.signal_ref} ${b.operator} ${String(b.value)}`;
    case "loop":
      return b.count != null ? `${t("ir.sum.count", "count")} ${b.count}` : t("ir.sum.while", "while condition");
    // P3
    case "set_variable":
      return `${b.name} = ${exprToText(b.expr)}`;
    case "counter":
      return b.op === "reset" ? `${b.name} := ${b.amount}` : `${b.name} += ${b.amount}`;
    case "wait_until":
      return `until ${exprToText(b.condition)} · ≤${b.timeout_ms} ms`;
    case "set_analog":
      return `${b.channel} = ${exprToText(b.value)}${b.unit ? ` ${b.unit}` : ""}`;
    case "pid_control":
      return `PID ${b.output_channel} · Kp ${b.kp} Ki ${b.ki} Kd ${b.kd} · [${b.output_min}, ${b.output_max}]`;
    case "call_block": {
      const args = b.args.map((a) => `${a.name}=${exprToText(a.value)}`).join(", ");
      return `${b.fb_name || t("ir.call.unbound", "(pick a block)")}(${args})`;
    }
  }
}
