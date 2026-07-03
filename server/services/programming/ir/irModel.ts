/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) — Intermediate Representation (IR) CORE MODEL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A portable, device-program-level JSON AST for motion + I/O programs — the layer the
 * design (Khối 6) calls for so an engineer authors a program ONCE as first-class
 * `move_linear` / `grip` / `if_condition` blocks, then transpiles it to a target
 * native language (URScript / ROS2 …) under the SEMANTIC safety linter.
 *
 * Relationship to the FOE workflow IR (orchestration/foe/workflowModel.ts): that IR is
 * at the FACTORY-ORCHESTRATION level (which machine runs which command, sequencing,
 * interlocks). THIS IR is at the DEVICE-PROGRAM level (the motion/IO body that runs ON
 * one device). They are distinct and complementary.
 *
 * SAFETY: this module is PURE DATA + PURE FUNCTIONS. It has NO side-effects, opens NO
 * device path, issues NO command. A Flow becomes runnable only by flowing through the
 * EXISTING programmingService gate (validate → compile/transpile → simulate → HITL →
 * gated deploy). Nothing here reaches hardware.
 *
 * Block types (first-class Motion + IO):
 *   • move_linear   — Cartesian linear move to a target pose (mm/s + accel + blend).
 *   • move_joint    — joint-space move (joint targets + speed %).
 *   • grip          — actuate a gripper/tool (force limit + timeout).
 *   • release       — release the gripper/tool.
 *   • set_output    — set a digital/analog output signal.
 *   • wait          — wait on a signal and/or a duration.
 *   • if_condition  — branch on a signal comparison (true_branch / false_branch).
 *   • loop          — repeat a body a fixed count OR while a condition holds.
 *
 * Doc 24 Wave-2 P3 — richer vocabulary (variables/expressions, timer/counter, analog/PID):
 *   • set_variable  — assign a named variable from a safe typed EXPRESSION (irExpr.ts).
 *   • counter       — increment/reset a named counter handle (a variable specialisation).
 *   • wait_until    — wait until a boolean EXPRESSION holds, bounded by a timeout.
 *   • set_analog    — write an analog channel from a literal OR an expression.
 *   • pid_control   — a first-class PID block (setpoint, Kp/Ki/Kd, bounded output channel).
 * Existing param slots (wait.ms, set_output.value) may now ALSO carry an expression
 * (numericOrExprSchema) — additive + backward-compatible (bare literals parse unchanged).
 *
 * Doc 24 Tier-1c — reusable FUNCTION BLOCKS (POUs, the CODESYS/TIA "reusable POU" idea):
 *   • function_blocks — flow-level DEFINITIONS: a named, parameterized sub-flow (a typed
 *     {name,kind,type} param list + a recursively-IR body) declared ONCE.
 *   • call_block      — a LEAF block that INVOKES a defined function_block by name with
 *     per-parameter argument bindings (literal OR a safe irExpr). Lowered to a URScript
 *     procedure call / a ROS2 method call. Additive + backward-compatible: a flow with no
 *     definitions and no call_block transpiles byte-identically to before.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { exprSchema, numericOrExprSchema, type Expr, type NumericOrExpr } from "./irExpr";

// ── Primitives ────────────────────────────────────────────────────────────────

/** A Cartesian pose (position mm + orientation rad|deg per device convention). */
export const poseSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  rx: z.number(),
  ry: z.number(),
  rz: z.number(),
});
export type Pose = z.infer<typeof poseSchema>;

/** Comparison operators an if/loop-while condition supports. */
export const compareOperatorSchema = z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]);
export type CompareOperator = z.infer<typeof compareOperatorSchema>;

/** A signal comparison leaf (reads a signal, compares to a constant). */
export const signalConditionSchema = z.object({
  signal_ref: z.string().min(1),
  operator: compareOperatorSchema,
  value: z.union([z.number(), z.boolean(), z.string()]),
});
export type SignalCondition = z.infer<typeof signalConditionSchema>;

// ── Blocks ────────────────────────────────────────────────────────────────────
//
// Every block carries an OPTIONAL `id`. `assignIds()` fills any missing id
// deterministically (b1, b2, …) so diagnostics + IR↔source comments can reference a
// stable handle. A recursive z.lazy() union expresses the nesting (branches / loop
// body) without a forward-declaration cycle.

/**
 * W4-19 (audit doc 25): toạ độ node phụ trợ (UI-only) để LƯU vị trí kéo-thả trên canvas
 * graph. OPTIONAL + additive — linter/transpiler bỏ qua; một flow không có `ui` parse +
 * transpile byte-identical như trước. Không phải đường thiết bị, không ảnh hưởng an toàn.
 */
export const nodeUiSchema = z.object({ x: z.number(), y: z.number() });
export type NodeUi = z.infer<typeof nodeUiSchema>;

const baseBlockFields = { id: z.string().optional(), ui: nodeUiSchema.optional() };

export const moveLinearBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("move_linear"),
  target_pose: poseSchema,
  speed_mms: z.number().nonnegative(),
  acceleration: z.number().nonnegative(),
  blend_radius: z.number().nonnegative().default(0),
});

export const moveJointBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("move_joint"),
  joints: z.array(z.number()).min(1),
  speed_pct: z.number().min(0).max(100),
});

export const gripBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("grip"),
  tool_id: z.string().min(1),
  force_limit_n: z.number().nonnegative(),
  timeout_ms: z.number().int().nonnegative(),
});

export const releaseBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("release"),
  tool_id: z.string().min(1).optional(),
});

export const setOutputBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("set_output"),
  signal: z.string().min(1),
  // P3: a bare boolean|number literal (backward-compatible) OR a safe typed expression.
  value: numericOrExprSchema,
});

export const waitBlockSchema = z
  .object({
    ...baseBlockFields,
    type: z.literal("wait"),
    signal_ref: z.string().min(1).optional(),
    // P3: duration may be a plain integer (backward-compatible) OR an expression yielding ms.
    ms: z.union([z.number().int().nonnegative(), exprSchema]).optional(),
  })
  .refine((b) => b.signal_ref !== undefined || b.ms !== undefined, {
    message: "wait needs at least one of { signal_ref, ms }",
  });

// ── P3: Variables / expressions ───────────────────────────────────────────────

/** Assign a named variable from a safe typed expression (declares the var into scope). */
export const setVariableBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("set_variable"),
  name: z.string().min(1),
  expr: exprSchema,
});

/** Increment or reset a named counter handle (a specialised numeric variable). */
export const counterBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("counter"),
  name: z.string().min(1),
  op: z.enum(["increment", "reset"]),
  /** amount to add on increment (default 1) / value to reset to (default 0). */
  amount: z.number().default(1),
});

// ── P3: Timer-style wait_until (condition + bounded timeout) ───────────────────

/** Wait until a boolean expression holds, bounded by a timeout (fail-safe on timeout). */
export const waitUntilBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("wait_until"),
  condition: exprSchema,
  timeout_ms: z.number().int().positive(),
  /** poll interval used by the emitted busy-wait loop (ms). */
  poll_ms: z.number().int().positive().default(50),
});

// ── P3: Analog output ──────────────────────────────────────────────────────────

/** Write an analog channel from a literal OR an expression. */
export const setAnalogBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("set_analog"),
  channel: z.string().min(1),
  value: numericOrExprSchema,
  /** optional physical unit label for provenance (e.g. "V", "mA", "%"). */
  unit: z.string().min(1).optional(),
});

// ── P3: PID control (first-class, bounded output) ──────────────────────────────

/** A first-class PID control block. Gains must be sane; output is bounded (safety). */
export const pidControlBlockSchema = z
  .object({
    ...baseBlockFields,
    type: z.literal("pid_control"),
    /** channel the loop writes its bounded output to. */
    output_channel: z.string().min(1),
    /** process-variable input channel (the measured value). */
    input_channel: z.string().min(1),
    /** target the loop drives the process value toward (literal or expression). */
    setpoint: numericOrExprSchema,
    kp: z.number(),
    ki: z.number(),
    kd: z.number(),
    /** hard output clamp (safety — the emitted loop saturates here). */
    output_min: z.number(),
    output_max: z.number(),
  })
  .refine((b) => b.output_min < b.output_max, {
    message: "pid_control output_min must be < output_max",
  });

// ── Tier-1c: reusable Function Blocks (POUs) — the CALL site ────────────────────

/** One argument binding for a call_block: a declared parameter name → a literal|expression. */
export const callArgSchema = z.object({
  name: z.string().min(1),
  value: numericOrExprSchema,
});
export type CallArg = z.infer<typeof callArgSchema>;

/**
 * Invoke a defined function_block by name with argument bindings. A LEAF block (no child
 * slots — the callee's body lives in its definition, not inline). Undefined-fb / arg
 * mismatch / recursion are caught by the semantic linter, not the shape.
 */
export const callBlockSchema = z.object({
  ...baseBlockFields,
  type: z.literal("call_block"),
  /** name of the function_block being invoked (must match a flow-level definition). */
  fb_name: z.string().min(1),
  args: z.array(callArgSchema).default([]),
});
export type CallBlock = z.infer<typeof callBlockSchema>;

// if_condition + loop nest a body of blocks → recursive union via z.lazy.
export const ifConditionBlockSchema: z.ZodType<IfConditionBlock> = z.lazy(() =>
  z.object({
    ...baseBlockFields,
    type: z.literal("if_condition"),
    signal_ref: z.string().min(1),
    operator: compareOperatorSchema,
    value: z.union([z.number(), z.boolean(), z.string()]),
    true_branch: z.array(irBlockSchema),
    false_branch: z.array(irBlockSchema),
  }),
);

export const loopBlockSchema: z.ZodType<LoopBlock> = z.lazy(() =>
  z
    .object({
      ...baseBlockFields,
      type: z.literal("loop"),
      count: z.number().int().positive().optional(),
      while: signalConditionSchema.optional(),
      body: z.array(irBlockSchema),
    })
    .refine((b) => b.count !== undefined || b.while !== undefined, {
      message: "loop needs either a `count` or a `while` condition",
    }),
);

/** The discriminated union of every block type. */
export const irBlockSchema: z.ZodType<IrBlock> = z.lazy(() =>
  z.union([
    moveLinearBlockSchema,
    moveJointBlockSchema,
    gripBlockSchema,
    releaseBlockSchema,
    setOutputBlockSchema,
    waitBlockSchema,
    ifConditionBlockSchema,
    loopBlockSchema,
    // P3 additions
    setVariableBlockSchema,
    counterBlockSchema,
    waitUntilBlockSchema,
    setAnalogBlockSchema,
    pidControlBlockSchema,
    // Tier-1c: reusable function-block call site (a leaf)
    callBlockSchema,
  ]),
);

// ── Static TS types (inferred where non-recursive; hand-written for the recursive) ──
export type MoveLinearBlock = z.infer<typeof moveLinearBlockSchema>;
export type MoveJointBlock = z.infer<typeof moveJointBlockSchema>;
export type GripBlock = z.infer<typeof gripBlockSchema>;
export type ReleaseBlock = z.infer<typeof releaseBlockSchema>;
export type SetOutputBlock = z.infer<typeof setOutputBlockSchema>;
export type WaitBlock = z.infer<typeof waitBlockSchema>;
export type SetVariableBlock = z.infer<typeof setVariableBlockSchema>;
export type CounterBlock = z.infer<typeof counterBlockSchema>;
export type WaitUntilBlock = z.infer<typeof waitUntilBlockSchema>;
export type SetAnalogBlock = z.infer<typeof setAnalogBlockSchema>;
export type PidControlBlock = z.infer<typeof pidControlBlockSchema>;
export interface IfConditionBlock {
  id?: string;
  ui?: NodeUi;
  type: "if_condition";
  signal_ref: string;
  operator: CompareOperator;
  value: number | boolean | string;
  true_branch: IrBlock[];
  false_branch: IrBlock[];
}
export interface LoopBlock {
  id?: string;
  ui?: NodeUi;
  type: "loop";
  count?: number;
  while?: SignalCondition;
  body: IrBlock[];
}
export type IrBlock =
  | MoveLinearBlock
  | MoveJointBlock
  | GripBlock
  | ReleaseBlock
  | SetOutputBlock
  | WaitBlock
  | IfConditionBlock
  | LoopBlock
  // P3 additions (all leaf blocks — no child slots)
  | SetVariableBlock
  | CounterBlock
  | WaitUntilBlock
  | SetAnalogBlock
  | PidControlBlock
  // Tier-1c: reusable function-block call site (a leaf)
  | CallBlock;

export type IrBlockType = IrBlock["type"];

// Re-export the expression types so consumers import them from the IR model surface.
export type { Expr, NumericOrExpr } from "./irExpr";

// ── Tier-1c: reusable Function Blocks (POUs) — the DEFINITION ───────────────────

/** IEC-ish parameter direction of a function-block parameter. */
export const fbParamKindSchema = z.enum(["input", "output", "inout"]);
export type FbParamKind = z.infer<typeof fbParamKindSchema>;

/** A simple static type tag for a function-block parameter (drives light arg checks). */
export const fbParamTypeSchema = z.enum(["number", "bool", "signal"]);
export type FbParamType = z.infer<typeof fbParamTypeSchema>;

/** One typed parameter of a function-block definition (IEC-ish {name,kind,type}). */
export const fbParamSchema = z.object({
  name: z.string().min(1),
  kind: fbParamKindSchema.default("input"),
  type: fbParamTypeSchema.default("number"),
});
export type FbParam = z.infer<typeof fbParamSchema>;

/**
 * A reusable function-block DEFINITION (a named, parameterized sub-flow / POU). The body is
 * recursively the same IR block list, so a definition can itself contain motion / IO /
 * control / (non-recursive) call_block blocks. Declared ONCE at the flow level, invoked by
 * a `call_block`. Hand-written interface (its `body` is the recursive IrBlock union).
 */
export interface FunctionBlockDef {
  id?: string;
  name: string;
  params: FbParam[];
  body: IrBlock[];
}
export const functionBlockDefSchema: z.ZodType<FunctionBlockDef> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    params: z.array(fbParamSchema),
    body: z.array(irBlockSchema),
  }),
);

// ── Flow (the top-level program) ────────────────────────────────────────────────

/** Target device families a Flow can be authored for (drives the transpiler registry). */
export const targetDeviceTypeSchema = z.enum(["universal-robots", "ros2", "generic"]);
export type TargetDeviceType = z.infer<typeof targetDeviceTypeSchema>;

export const flowSchema = z.object({
  flow_id: z.string().min(1),
  target_device_type: targetDeviceTypeSchema,
  version: z.number().int().positive().default(1),
  author: z.string().min(1).optional(),
  /** Optional link to the equipment CommandDescriptor / capability this flow drives. */
  linked_capability: z.string().min(1).optional(),
  /**
   * Tier-1c: reusable function-block DEFINITIONS (POUs), each callable from `blocks` (or
   * another definition's body) via a `call_block`. OPTIONAL + additive — a pre-Tier-1c flow
   * omits this key entirely and round-trips / transpiles byte-identically.
   */
  function_blocks: z.array(functionBlockDefSchema).optional(),
  blocks: z.array(irBlockSchema),
});
export type Flow = z.infer<typeof flowSchema>;

// ── Pure helpers ────────────────────────────────────────────────────────────────

/** Parse + shape-validate an unknown value into a Flow. Returns a typed result. */
export function parseFlow(input: unknown):
  | { ok: true; flow: Flow }
  | { ok: false; errors: Array<{ path: string; message: string }> } {
  const res = flowSchema.safeParse(input);
  if (res.success) return { ok: true, flow: res.data };
  return {
    ok: false,
    errors: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Parse IR JSON text (the artifact.content) into a Flow. */
export function parseFlowJson(json: string):
  | { ok: true; flow: Flow }
  | { ok: false; errors: Array<{ path: string; message: string }> } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [{ path: "", message: `Invalid JSON: ${(e as Error).message}` }] };
  }
  return parseFlow(value);
}

/** Depth-first walk of every block (parent before children). `path` is human-readable. */
export function walkBlocks(
  blocks: IrBlock[],
  visit: (block: IrBlock, path: string) => void,
  prefix = "",
): void {
  blocks.forEach((block, i) => {
    const path = prefix ? `${prefix}.${i}` : String(i);
    visit(block, path);
    if (block.type === "if_condition") {
      walkBlocks(block.true_branch, visit, `${path}.true`);
      walkBlocks(block.false_branch, visit, `${path}.false`);
    } else if (block.type === "loop") {
      walkBlocks(block.body, visit, `${path}.body`);
    }
  });
}

/**
 * Assign a stable deterministic id (b1, b2, …) to EVERY block that lacks one, in
 * depth-first order. Returns a NEW Flow (does not mutate the input). Idempotent for a
 * flow that is already fully id'd.
 *
 * Function-block bodies are id'd with the SAME running `b` counter AFTER the main blocks
 * (still unique + deterministic); definitions themselves get `fb1, fb2, …`. A flow with no
 * `function_blocks` key takes the early-return path → byte-identical to the pre-Tier-1c
 * behaviour (no injected empty array).
 */
export function assignIds(flow: Flow): Flow {
  let counter = 0;
  const withId = (block: IrBlock): IrBlock => {
    counter += 1;
    const id = block.id ?? `b${counter}`;
    if (block.type === "if_condition") {
      return { ...block, id, true_branch: block.true_branch.map(withId), false_branch: block.false_branch.map(withId) };
    }
    if (block.type === "loop") {
      return { ...block, id, body: block.body.map(withId) };
    }
    return { ...block, id };
  };
  const blocks = flow.blocks.map(withId);
  if (!flow.function_blocks || flow.function_blocks.length === 0) {
    return { ...flow, blocks };
  }
  let fbCounter = 0;
  const function_blocks: FunctionBlockDef[] = flow.function_blocks.map((fb) => {
    fbCounter += 1;
    return { ...fb, id: fb.id ?? `fb${fbCounter}`, body: fb.body.map(withId) };
  });
  return { ...flow, blocks, function_blocks };
}

/** Total block count (main blocks + every function-block body, all nested). */
export function countBlocks(flow: Flow): number {
  let n = 0;
  const tally = () => { n += 1; };
  walkBlocks(flow.blocks, tally);
  for (const fb of flow.function_blocks ?? []) walkBlocks(fb.body, tally);
  return n;
}
