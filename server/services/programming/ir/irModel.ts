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
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";

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

const baseBlockFields = { id: z.string().optional() };

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
  value: z.union([z.boolean(), z.number()]),
});

export const waitBlockSchema = z
  .object({
    ...baseBlockFields,
    type: z.literal("wait"),
    signal_ref: z.string().min(1).optional(),
    ms: z.number().int().nonnegative().optional(),
  })
  .refine((b) => b.signal_ref !== undefined || b.ms !== undefined, {
    message: "wait needs at least one of { signal_ref, ms }",
  });

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
  ]),
);

// ── Static TS types (inferred where non-recursive; hand-written for the recursive) ──
export type MoveLinearBlock = z.infer<typeof moveLinearBlockSchema>;
export type MoveJointBlock = z.infer<typeof moveJointBlockSchema>;
export type GripBlock = z.infer<typeof gripBlockSchema>;
export type ReleaseBlock = z.infer<typeof releaseBlockSchema>;
export type SetOutputBlock = z.infer<typeof setOutputBlockSchema>;
export type WaitBlock = z.infer<typeof waitBlockSchema>;
export interface IfConditionBlock {
  id?: string;
  type: "if_condition";
  signal_ref: string;
  operator: CompareOperator;
  value: number | boolean | string;
  true_branch: IrBlock[];
  false_branch: IrBlock[];
}
export interface LoopBlock {
  id?: string;
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
  | LoopBlock;

export type IrBlockType = IrBlock["type"];

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
  return { ...flow, blocks: flow.blocks.map(withId) };
}

/** Total block count (including nested). */
export function countBlocks(flow: Flow): number {
  let n = 0;
  walkBlocks(flow.blocks, () => {
    n += 1;
  });
  return n;
}
