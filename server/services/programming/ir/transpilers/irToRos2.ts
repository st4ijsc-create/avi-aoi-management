/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) — IR → ROS2 transpiler (rclpy-style script).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Deterministic codegen from an IR Flow to a ROS2 rclpy-style Python node that issues
 * MoveIt/Action goals for motion and publishes to a digital-IO topic for I/O. EVERY
 * emitted statement group is preceded by a comment linking back to the source IR block,
 * e.g. `# [IR move_linear #b3]`, for side-by-side Code Review.
 *
 * SAFETY: PURE codegen — produces TEXT, opens no device path. The script only reaches a
 * robot via the EXISTING programmingService deploy gate (DPC_DEPLOY_ENABLED + HITL).
 * Output is deterministic so a golden-file regression catches accidental changes.
 *
 * SCOPE NOTE (honest): this emits a READABLE, structurally-faithful rclpy skeleton
 * (self.send_pose_goal / send_joint_goal / self.set_io / self.wait) — it is NOT a bound,
 * runtime-verified ROS2 client. Binding to a concrete MoveIt config + validating on a
 * real controller is deferred (needs hardware / a ROS2 stack → T2 physics-sim territory).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Flow, IrBlock, CompareOperator } from "../irModel";
import { assignIds } from "../irModel";
import { irComment, type TranspileResult } from "./irToUrscript";

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

export function transpileToRos2(flowIn: Flow): TranspileResult {
  const flow = assignIds(flowIn);
  const lines: string[] = [];
  const irCommentMap: Record<string, string> = {};
  const IND = "    "; // 4-space, PEP8

  const comment = (block: IrBlock, indent: string) => {
    const marker = irComment(block);
    if (block.id) irCommentMap[marker] = block.id;
    lines.push(`${indent}${marker}`);
  };

  const emit = (block: IrBlock, indent: string) => {
    comment(block, indent);
    switch (block.type) {
      case "move_linear": {
        const p = block.target_pose;
        lines.push(`${indent}self.send_pose_goal(x=${fmt(p.x)}, y=${fmt(p.y)}, z=${fmt(p.z)}, rx=${fmt(p.rx)}, ry=${fmt(p.ry)}, rz=${fmt(p.rz)}, speed_mms=${fmt(block.speed_mms)}, accel=${fmt(block.acceleration)}, blend=${fmt(block.blend_radius)})`);
        break;
      }
      case "move_joint": {
        const joints = block.joints.map(fmt).join(", ");
        lines.push(`${indent}self.send_joint_goal(positions=[${joints}], speed_pct=${fmt(block.speed_pct)})`);
        break;
      }
      case "grip": {
        lines.push(`${indent}self.grip(tool_id="${block.tool_id}", force_limit_n=${fmt(block.force_limit_n)}, timeout_ms=${block.timeout_ms})`);
        break;
      }
      case "release": {
        lines.push(`${indent}self.release(${block.tool_id ? `tool_id="${block.tool_id}"` : ""})`);
        break;
      }
      case "set_output": {
        lines.push(`${indent}self.set_io("${block.signal}", ${litPy(block.value)})`);
        break;
      }
      case "wait": {
        if (block.signal_ref !== undefined) {
          lines.push(`${indent}self.wait_signal("${block.signal_ref}")`);
        }
        if (block.ms !== undefined) {
          lines.push(`${indent}self.wait_ms(${block.ms})`);
        }
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

  lines.push(`# ROS2 (rclpy) node generated from IR flow "${flow.flow_id}" v${flow.version}`);
  lines.push(`# NOTE: structural skeleton — bind to a concrete MoveIt config before use.`);
  lines.push(`# SAFETY: deploy only via the gated programmingService (DPC_DEPLOY_ENABLED + HITL).`);
  lines.push(`import rclpy`);
  lines.push(`from rclpy.node import Node`);
  lines.push(``);
  lines.push(``);
  lines.push(`class ${className(flow.flow_id)}(Node):`);
  lines.push(`${IND}def __init__(self):`);
  lines.push(`${IND}${IND}super().__init__("${sanitizeName(flow.flow_id)}")`);
  lines.push(``);
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
