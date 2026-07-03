/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) / Doc 24 Tier-2 — IR → ROS2 MoveIt transpiler.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Deterministic codegen from an IR Flow to a ROS2 Python node that is BOUND to MoveIt via
 * `moveit_commander.MoveGroupCommander`. Motion blocks emit REAL motion-planning +
 * execution calls — `set_pose_target` / `set_joint_value_target` → `plan()` → `execute()`;
 * digital/analog I/O goes over `std_msgs` publishers; `if` / `loop` lower to native Python
 * control flow; reusable `function_blocks` lower to node methods. EVERY emitted statement
 * group is preceded by a comment linking back to the source IR block, e.g.
 * `# [IR move_linear #b3]`, for side-by-side Code Review.
 *
 * WHAT CHANGED (Doc 24 Tier-2): the prior version emitted an honest but UNBOUND skeleton
 * (self.send_pose_goal / send_joint_goal — helper methods that no ROS2 library defines). It
 * is now a BOUND MoveIt program: motion drives a concrete `MoveGroupCommander`, I/O drives
 * concrete `create_publisher(std_msgs/*)`, and every helper the body calls is DEFINED on the
 * node (no phantom methods). The planning group + IO topics are the two integration points
 * a MoveIt config binds.
 *
 * SAFETY: PURE codegen — produces TEXT, opens no device path. The script only reaches a
 * robot via the EXISTING programmingService deploy gate (DPC_DEPLOY_ENABLED + HITL) AFTER
 * the Simulation Gate passes. Output is deterministic so a golden-file regression catches
 * accidental changes.
 *
 * SCOPE NOTE (honest): this emits deterministic GENERATED MoveIt Python SOURCE that binds
 * the real MoveGroupCommander API — it is NOT a live ROS2 runtime and is not executed here.
 * Binding the planning group + IO topics to a concrete MoveIt config and validating on a
 * controller is the integrator's step (and, for URScript targets, the HIL/URSim pre-stage).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Flow, IrBlock, CompareOperator, NumericOrExpr, FunctionBlockDef } from "../irModel";
import { assignIds, walkBlocks } from "../irModel";
import { irComment, type TranspileResult } from "./irToUrscript";
import { isExpr, renderSlot, sanitizeVar } from "../irExpr";

const PY_OPS: Record<CompareOperator, string> = {
  eq: "==",
  neq: "!=",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

function fmt(n: number): string {
  return Number(n.toFixed(6)).toString();
}

function litPy(v: number | boolean | string): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return fmt(v);
  return `"${v}"`;
}

/** Render a value slot (literal or expression) to a Python token. */
function slotPy(v: NumericOrExpr): string {
  return renderSlot(v, fmt, litPy);
}

/**
 * IR speed → a MoveIt velocity-scaling factor in (0, 1]. Cartesian speed is mm/s referenced
 * to a documented nominal of 1000 mm/s = 100%; joint speed is already a percentage. Clamped
 * to [0.01, 1] so a bound program never plans at a zero or >100% scale.
 */
function velLinear(speedMms: number): string {
  return fmt(Math.min(1, Math.max(0.01, speedMms / 1000)));
}
function velJoint(speedPct: number): string {
  return fmt(Math.min(1, Math.max(0.01, speedPct / 100)));
}

/** The BOUND helper method definitions (keyed) the node may emit, in canonical order. */
const HELPER_ORDER = [
  "_plan_and_execute",
  "_gripper",
  "_io_pub",
  "set_io",
  "set_analog",
  "read_io",
  "wait_signal",
  "wait_until",
  "pid_control",
] as const;
type HelperKey = (typeof HELPER_ORDER)[number];

/** Helper bodies — 4-space class indent (IND), bodies at 8 spaces (IND+IND). */
const HELPER_BODIES: Record<HelperKey, string[]> = {
  _plan_and_execute: [
    "    def _plan_and_execute(self):",
    "        # BOUND MoveIt plan -> execute. On ROS2 plan() returns (ok, traj, time, err).",
    "        success, plan, _planning_time, _err = self.move_group.plan()",
    "        if success:",
    "            self.move_group.execute(plan, wait=True)",
    "        self.move_group.stop()",
    "        self.move_group.clear_pose_targets()",
    "        return success",
  ],
  _gripper: [
    "    def _gripper(self, close, tool_id, force_limit_n=0.0, timeout_ms=0):",
    "        # Gripper command over a Bool topic — bind to your gripper action/driver.",
    "        msg = Bool()",
    "        msg.data = bool(close)",
    '        self._io_pub("gripper/" + str(tool_id), Bool).publish(msg)',
  ],
  _io_pub: [
    "    def _io_pub(self, name, msg_type):",
    "        pub = self._io_pubs.get(name)",
    "        if pub is None:",
    '            pub = self.create_publisher(msg_type, "io/" + str(name), 10)',
    "            self._io_pubs[name] = pub",
    "        return pub",
  ],
  set_io: [
    "    def set_io(self, signal, value):",
    "        msg = Bool()",
    "        msg.data = bool(value)",
    "        self._io_pub(signal, Bool).publish(msg)",
  ],
  set_analog: [
    "    def set_analog(self, channel, value):",
    "        msg = Float64()",
    "        msg.data = float(value)",
    "        self._io_pub(channel, Float64).publish(msg)",
  ],
  read_io: [
    "    def read_io(self, signal):",
    "        # Latest value cached from an input subscription (bind a subscriber to populate).",
    "        return self._io_state.get(str(signal), False)",
  ],
  wait_signal: [
    "    def wait_signal(self, signal):",
    "        while not self.read_io(signal):",
    "            rclpy.spin_once(self, timeout_sec=0.05)",
  ],
  wait_until: [
    "    def wait_until(self, predicate, timeout_ms, poll_ms):",
    "        deadline = time.time() + timeout_ms / 1000.0",
    "        while not predicate():",
    "            if time.time() >= deadline:",
    "                break",
    "            rclpy.spin_once(self, timeout_sec=poll_ms / 1000.0)",
  ],
  pid_control: [
    "    def pid_control(self, output_channel, input_channel, setpoint, kp, ki, kd, output_min, output_max):",
    "        pv = self._io_state.get(str(input_channel), 0.0)",
    "        err = setpoint - pv",
    '        self._pid_i = getattr(self, "_pid_i", 0.0) + err',
    '        deriv = err - getattr(self, "_pid_prev", 0.0)',
    "        out = kp * err + ki * self._pid_i + kd * deriv",
    "        out = max(output_min, min(output_max, out))",
    "        self.set_analog(output_channel, out)",
    "        self._pid_prev = err",
    "        return out",
  ],
};

/** Static analysis of a flow → which bound helpers / imports the emitted node needs. */
interface FlowNeeds {
  hasMotion: boolean;
  needTime: boolean;
  helpers: Set<HelperKey>;
  needsIoPubs: boolean;
  needsIoState: boolean;
}

function analyseNeeds(flow: Flow): FlowNeeds {
  const used = new Set<string>();
  let needWaitSignal = false;
  let needReadIo = false;
  let needTime = false;
  const scan = (blocks: IrBlock[]) =>
    walkBlocks(blocks, (b: IrBlock) => {
      used.add(b.type);
      if (b.type === "wait") {
        if (b.signal_ref !== undefined) needWaitSignal = true;
        if (b.ms !== undefined) needTime = true;
      }
      if (b.type === "wait_until") needTime = true; // helper uses time.time()
      if (b.type === "if_condition") needReadIo = true;
      if (b.type === "loop" && b.while !== undefined) needReadIo = true;
    });
  scan(flow.blocks);
  for (const fb of flow.function_blocks ?? []) scan(fb.body);

  const helpers = new Set<HelperKey>();
  if (used.has("move_linear") || used.has("move_joint")) helpers.add("_plan_and_execute");
  if (used.has("grip") || used.has("release")) {
    helpers.add("_gripper");
    helpers.add("_io_pub");
  }
  if (used.has("set_output")) {
    helpers.add("set_io");
    helpers.add("_io_pub");
  }
  if (used.has("set_analog") || used.has("pid_control")) {
    helpers.add("set_analog");
    helpers.add("_io_pub");
  }
  if (used.has("pid_control")) helpers.add("pid_control");
  if (needReadIo || needWaitSignal) helpers.add("read_io");
  if (needWaitSignal) helpers.add("wait_signal");
  if (used.has("wait_until")) helpers.add("wait_until");

  return {
    hasMotion: used.has("move_linear") || used.has("move_joint"),
    needTime,
    helpers,
    needsIoPubs: helpers.has("_io_pub"),
    needsIoState: helpers.has("read_io") || used.has("pid_control"),
  };
}

export function transpileToRos2(flowIn: Flow): TranspileResult {
  const flow = assignIds(flowIn);
  const lines: string[] = [];
  const irCommentMap: Record<string, string> = {};
  const IND = "    "; // 4-space, PEP8
  // Tier-1c: name → definition, so a call_block can order its by-name args positionally.
  const fbByName = new Map<string, FunctionBlockDef>((flow.function_blocks ?? []).map((fb) => [fb.name, fb]));
  const needs = analyseNeeds(flow);

  const comment = (block: IrBlock, indent: string) => {
    const marker = irComment(block);
    if (block.id) irCommentMap[marker] = block.id;
    lines.push(`${indent}${marker}`);
  };

  const emit = (block: IrBlock, indent: string) => {
    comment(block, indent);
    switch (block.type) {
      case "move_linear": {
        // BOUND MoveIt: position mm→m; rx/ry/rz passed through (rad); speed→velocity scale.
        // MoveGroupCommander.set_pose_target accepts a 6-list [x, y, z, roll, pitch, yaw].
        const p = block.target_pose;
        lines.push(`${indent}self.move_group.set_max_velocity_scaling_factor(${velLinear(block.speed_mms)})`);
        lines.push(
          `${indent}self.move_group.set_pose_target([${fmt(p.x / 1000)}, ${fmt(p.y / 1000)}, ${fmt(p.z / 1000)}, ${fmt(p.rx)}, ${fmt(p.ry)}, ${fmt(p.rz)}])`,
        );
        lines.push(`${indent}self._plan_and_execute()`);
        break;
      }
      case "move_joint": {
        const joints = block.joints.map(fmt).join(", ");
        lines.push(`${indent}self.move_group.set_max_velocity_scaling_factor(${velJoint(block.speed_pct)})`);
        lines.push(`${indent}self.move_group.set_joint_value_target([${joints}])`);
        lines.push(`${indent}self._plan_and_execute()`);
        break;
      }
      case "grip": {
        lines.push(
          `${indent}self._gripper(True, "${block.tool_id}", force_limit_n=${fmt(block.force_limit_n)}, timeout_ms=${block.timeout_ms})`,
        );
        break;
      }
      case "release": {
        lines.push(`${indent}self._gripper(False, ${block.tool_id ? `"${block.tool_id}"` : `""`})`);
        break;
      }
      case "set_output": {
        lines.push(`${indent}self.set_io("${block.signal}", ${slotPy(block.value)})`);
        break;
      }
      case "wait": {
        if (block.signal_ref !== undefined) {
          lines.push(`${indent}self.wait_signal("${block.signal_ref}")`);
        }
        if (block.ms !== undefined) {
          if (isExpr(block.ms)) {
            lines.push(`${indent}time.sleep((${renderSlot(block.ms, fmt, litPy)}) / 1000.0)`);
          } else {
            lines.push(`${indent}time.sleep(${fmt(block.ms / 1000)})`);
          }
        }
        break;
      }
      case "set_variable": {
        lines.push(`${indent}${sanitizeVar(block.name)} = ${slotPy(block.expr)}`);
        break;
      }
      case "counter": {
        const v = sanitizeVar(block.name);
        if (block.op === "reset") {
          lines.push(`${indent}${v} = ${fmt(block.amount ?? 0)}`);
        } else {
          lines.push(`${indent}${v} = ${v} + ${fmt(block.amount ?? 1)}`);
        }
        break;
      }
      case "wait_until": {
        lines.push(`${indent}self.wait_until(lambda: ${slotPy(block.condition)}, timeout_ms=${block.timeout_ms}, poll_ms=${block.poll_ms})`);
        break;
      }
      case "set_analog": {
        const unit = block.unit ? `  # unit=${block.unit}` : "";
        lines.push(`${indent}self.set_analog("${block.channel}", ${slotPy(block.value)})${unit}`);
        break;
      }
      case "call_block": {
        // Invoke the method emitted for the definition (see the class body). IR args are by
        // NAME; the generated method is positional → order the args by the param list.
        const def = fbByName.get(block.fb_name);
        const argByName = new Map(block.args.map((a) => [a.name, a.value] as const));
        const ordered = def
          ? def.params.map((p) => slotPy(argByName.get(p.name) ?? 0))
          : block.args.map((a) => slotPy(a.value));
        lines.push(`${indent}self.${sanitizeName(block.fb_name)}(${ordered.join(", ")})`);
        break;
      }
      case "pid_control": {
        // BOUND discrete-PID helper on the node (setpoint + gains + output clamp), writing
        // the bounded result to the analog output channel via the std_msgs publisher.
        lines.push(
          `${indent}self.pid_control(output_channel="${block.output_channel}", input_channel="${block.input_channel}", setpoint=${slotPy(block.setpoint)}, kp=${fmt(block.kp)}, ki=${fmt(block.ki)}, kd=${fmt(block.kd)}, output_min=${fmt(block.output_min)}, output_max=${fmt(block.output_max)})`,
        );
        break;
      }
      case "if_condition": {
        lines.push(`${indent}if self.read_io("${block.signal_ref}") ${PY_OPS[block.operator]} ${litPy(block.value)}:`);
        if (block.true_branch.length === 0) lines.push(`${indent}${IND}pass`);
        for (const child of block.true_branch) emit(child, indent + IND);
        lines.push(`${indent}else:`);
        if (block.false_branch.length === 0) lines.push(`${indent}${IND}pass`);
        for (const child of block.false_branch) emit(child, indent + IND);
        break;
      }
      case "loop": {
        if (block.count !== undefined) {
          lines.push(`${indent}for _ in range(${block.count}):`);
          if (block.body.length === 0) lines.push(`${indent}${IND}pass`);
          for (const child of block.body) emit(child, indent + IND);
        } else if (block.while !== undefined) {
          const w = block.while;
          lines.push(`${indent}while self.read_io("${w.signal_ref}") ${PY_OPS[w.operator]} ${litPy(w.value)}:`);
          if (block.body.length === 0) lines.push(`${indent}${IND}pass`);
          for (const child of block.body) emit(child, indent + IND);
        }
        break;
      }
      default:
        break;
    }
  };

  // ── Header (honest provenance + scope) ──────────────────────────────────────────
  lines.push(`# ROS2 MoveIt program generated from IR flow "${flow.flow_id}" v${flow.version}`);
  lines.push(`# BOUND to MoveIt: motion (if any) emits real set_pose_target / set_joint_value_target`);
  lines.push(`#   -> plan() -> execute() on a MoveGroupCommander; I/O via std_msgs publishers;`);
  lines.push(`#   if/loop -> Python control flow. Each group carries its "# [IR ...]" marker.`);
  lines.push(`# HONEST: deterministic GENERATED MoveIt Python source (not a live ROS2 runtime) —`);
  lines.push(`#   bind the planning group + IO topics to your MoveIt config and validate before use.`);
  lines.push(`# SAFETY: deploy only via the gated programmingService (DPC_DEPLOY_ENABLED + HITL + sim-gate).`);

  // ── Imports (conditional so an IO-only flow does not import MoveIt, etc.) ────────
  lines.push(`import rclpy`);
  lines.push(`from rclpy.node import Node`);
  if (needs.needTime) lines.push(`import time`);
  if (needs.needsIoPubs) lines.push(`from std_msgs.msg import Bool, Float64`);
  if (needs.hasMotion) lines.push(`import moveit_commander`);
  lines.push(``);
  if (needs.hasMotion) {
    lines.push(`# The MoveIt planning group this flow drives (override to match your SRDF).`);
    lines.push(`PLANNING_GROUP = "manipulator"`);
    lines.push(``);
  }
  lines.push(``);

  // ── Node class ──────────────────────────────────────────────────────────────────
  lines.push(`class ${className(flow.flow_id)}(Node):`);
  lines.push(`${IND}def __init__(self):`);
  lines.push(`${IND}${IND}super().__init__("${sanitizeName(flow.flow_id)}")`);
  if (needs.hasMotion) {
    lines.push(`${IND}${IND}moveit_commander.roscpp_initialize([])`);
    lines.push(`${IND}${IND}self.robot = moveit_commander.RobotCommander()`);
    lines.push(`${IND}${IND}self.scene = moveit_commander.PlanningSceneInterface()`);
    lines.push(`${IND}${IND}self.move_group = moveit_commander.MoveGroupCommander(PLANNING_GROUP)`);
  }
  if (needs.needsIoPubs) lines.push(`${IND}${IND}self._io_pubs = {}`);
  if (needs.needsIoState) lines.push(`${IND}${IND}self._io_state = {}`);
  lines.push(``);

  // ── Bound helper methods (only those the flow actually uses) ─────────────────────
  for (const key of HELPER_ORDER) {
    if (!needs.helpers.has(key)) continue;
    for (const l of HELPER_BODIES[key]) lines.push(l);
    lines.push(``);
  }

  // Tier-1c: reusable function-block DEFINITIONS → one node METHOD each, emitted before run().
  for (const fb of flow.function_blocks ?? []) {
    lines.push(`${IND}# [IR function_block #${fb.id ?? "?"}] ${fb.name}`);
    const params = fb.params.map((p) => sanitizeVar(p.name)).join(", ");
    lines.push(`${IND}def ${sanitizeName(fb.name)}(self${params ? `, ${params}` : ""}):`);
    if (fb.body.length === 0) lines.push(`${IND}${IND}pass`);
    for (const b of fb.body) emit(b, IND + IND);
    lines.push(``);
  }

  lines.push(`${IND}def run(self):`);
  if (flow.blocks.length === 0) lines.push(`${IND}${IND}pass`);
  for (const block of flow.blocks) emit(block, IND + IND);

  return { code: lines.join("\n") + "\n", irCommentMap };
}

function sanitizeName(id: string): string {
  const s = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : `flow_${s}`;
}
function className(id: string): string {
  return sanitizeName(id)
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") + "Node";
}
