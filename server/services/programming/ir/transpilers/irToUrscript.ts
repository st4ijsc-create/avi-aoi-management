/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) — IR → URScript transpiler (Universal Robots).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Deterministic codegen from an IR Flow to URScript (Universal Robots' Python-like
 * language): movel / movej / set_digital_out / if / while. EVERY emitted line group is
 * preceded by a comment linking back to the source IR block, e.g. `# [IR move_linear #b3]`,
 * so a reviewer can read the native code and the IR side-by-side (Code Review 2-eyes).
 *
 * SAFETY: this is PURE codegen — it produces TEXT, opens no device path. The generated
 * script only reaches a robot via the EXISTING programmingService deploy gate
 * (DPC_DEPLOY_ENABLED + HITL). Output is deterministic (stable formatting/ordering) so a
 * golden-file regression test catches any accidental change.
 *
 * URScript notes (units): movel takes pose in METRES + radians; the IR pose is mm +
 * whatever the author's rx/ry/rz convention is. We convert mm→m for x/y/z and pass
 * rx/ry/rz through (documented in the header comment of the generated script). Speed is
 * mm/s → m/s.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Flow, IrBlock, CompareOperator, NumericOrExpr } from "../irModel";
import { assignIds } from "../irModel";
import { isExpr, renderSlot, sanitizeVar } from "../irExpr";

/** The IR↔source comment marker for one block (also surfaced in the irCommentMap). */
export function irComment(block: IrBlock): string {
  return `# [IR ${block.type} #${block.id ?? "?"}]`;
}

/** Result of a transpile: the code, plus a map from generated marker → block id. */
export interface TranspileResult {
  code: string;
  /** marker string → blockId (lets the UI map a code line back to a block). */
  irCommentMap: Record<string, string>;
}

const UR_OPS: Record<CompareOperator, string> = {
  eq: "==",
  neq: "!=",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
};

function fmt(n: number): string {
  // Deterministic numeric formatting — trim to at most 6 dp, drop trailing zeros.
  return Number(n.toFixed(6)).toString();
}

function litUr(v: number | boolean | string): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return fmt(v);
  return `"${v}"`;
}

/** Render a value slot (literal or expression) to a URScript token. */
function slotUr(v: NumericOrExpr): string {
  return renderSlot(v, fmt, litUr);
}

/** Emit a min/max saturation of `expr` to a bounded output (safety clamp). */
function clampUr(expr: string, min: number, max: number): string {
  // URScript has no min/max builtins we can rely on — expand to a deterministic ternary-free
  // clamp used inline: max(min, ...) then min(max, ...). Emitted as nested if via helper
  // math so it stays a single expression the reviewer can read.
  return `${fmt(min)} if (${expr} < ${fmt(min)}) else (${fmt(max)} if (${expr} > ${fmt(max)}) else ${expr})`;
}

export function transpileToUrscript(flowIn: Flow): TranspileResult {
  const flow = assignIds(flowIn);
  const lines: string[] = [];
  const irCommentMap: Record<string, string> = {};
  const IND = "  ";

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
        // mm → m for position; rx/ry/rz passed through; speed mm/s → m/s.
        const pose = `p[${fmt(p.x / 1000)}, ${fmt(p.y / 1000)}, ${fmt(p.z / 1000)}, ${fmt(p.rx)}, ${fmt(p.ry)}, ${fmt(p.rz)}]`;
        lines.push(`${indent}movel(${pose}, a=${fmt(block.acceleration)}, v=${fmt(block.speed_mms / 1000)}, r=${fmt(block.blend_radius / 1000)})`);
        break;
      }
      case "move_joint": {
        const joints = block.joints.map(fmt).join(", ");
        // speed_pct → a fraction of a nominal max joint speed (documented, deterministic).
        lines.push(`${indent}movej([${joints}], a=1.4, v=${fmt((block.speed_pct / 100) * 3.14)})`);
        break;
      }
      case "grip": {
        lines.push(`${indent}# tool "${block.tool_id}" close, force<=${fmt(block.force_limit_n)}N, timeout=${block.timeout_ms}ms`);
        lines.push(`${indent}set_tool_digital_out(0, True)`);
        break;
      }
      case "release": {
        lines.push(`${indent}set_tool_digital_out(0, False)`);
        break;
      }
      case "set_output": {
        // value may be a literal (backward-compatible) or a safe expression.
        const val = slotUr(block.value);
        lines.push(`${indent}set_digital_out(${block.signal}, ${val})`);
        break;
      }
      case "wait": {
        if (block.signal_ref !== undefined) {
          lines.push(`${indent}while (get_digital_in(${block.signal_ref}) == False):`);
          lines.push(`${indent}${IND}sync()`);
          lines.push(`${indent}end`);
        }
        if (block.ms !== undefined) {
          // Literal ms → sleep(seconds); an expression yields ms → divide by 1000 in-script.
          if (isExpr(block.ms)) {
            lines.push(`${indent}sleep((${renderSlot(block.ms, fmt, litUr)}) / 1000.0)`);
          } else {
            lines.push(`${indent}sleep(${fmt(block.ms / 1000)})`);
          }
        }
        break;
      }
      case "set_variable": {
        lines.push(`${indent}${sanitizeVar(block.name)} = ${renderSlot(block.expr, fmt, litUr)}`);
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
        // Bounded busy-wait: poll the condition, sync each poll, give up at the timeout.
        const cond = renderSlot(block.condition, fmt, litUr);
        const pollS = fmt(block.poll_ms / 1000);
        lines.push(`${indent}wu_elapsed = 0.0`);
        lines.push(`${indent}while (not (${cond})) and (wu_elapsed < ${fmt(block.timeout_ms / 1000)}):`);
        lines.push(`${indent}${IND}sleep(${pollS})`);
        lines.push(`${indent}${IND}wu_elapsed = wu_elapsed + ${pollS}`);
        lines.push(`${indent}end`);
        break;
      }
      case "set_analog": {
        const val = slotUr(block.value);
        const unit = block.unit ? ` # unit=${block.unit}` : "";
        lines.push(`${indent}set_analog_out(${block.channel}, ${val})${unit}`);
        break;
      }
      case "pid_control": {
        // URScript has no native PID primitive — emit a clearly-marked, deterministic
        // skeleton discrete-PID step (still under the # [IR pid_control #id] provenance
        // marker) that saturates to the safety-bounded output. A concrete controller binds
        // this on the target; the block stays first-class + reviewable.
        const sp = slotUr(block.setpoint);
        lines.push(`${indent}# PID skeleton (URScript has no native PID) — bounded, deterministic step.`);
        lines.push(`${indent}pid_sp = ${sp}`);
        lines.push(`${indent}pid_pv = get_standard_analog_in(${block.input_channel})`);
        lines.push(`${indent}pid_err = pid_sp - pid_pv`);
        lines.push(`${indent}pid_out = ${fmt(block.kp)} * pid_err + ${fmt(block.ki)} * pid_i_${sanitizeVar(block.output_channel)} + ${fmt(block.kd)} * (pid_err - pid_prev_${sanitizeVar(block.output_channel)})`);
        lines.push(`${indent}pid_out = ${clampUr("pid_out", block.output_min, block.output_max)}`);
        lines.push(`${indent}set_analog_out(${block.output_channel}, pid_out)`);
        lines.push(`${indent}pid_i_${sanitizeVar(block.output_channel)} = pid_i_${sanitizeVar(block.output_channel)} + pid_err`);
        lines.push(`${indent}pid_prev_${sanitizeVar(block.output_channel)} = pid_err`);
        break;
      }
      case "if_condition": {
        lines.push(`${indent}if (get_digital_in(${block.signal_ref}) ${UR_OPS[block.operator]} ${litUr(block.value)}):`);
        for (const child of block.true_branch) emit(child, indent + IND);
        if (block.false_branch.length > 0) {
          lines.push(`${indent}else:`);
          for (const child of block.false_branch) emit(child, indent + IND);
        }
        lines.push(`${indent}end`);
        break;
      }
      case "loop": {
        if (block.count !== undefined) {
          lines.push(`${indent}i = 0`);
          lines.push(`${indent}while (i < ${block.count}):`);
          for (const child of block.body) emit(child, indent + IND);
          lines.push(`${indent}${IND}i = i + 1`);
          lines.push(`${indent}end`);
        } else if (block.while !== undefined) {
          const w = block.while;
          lines.push(`${indent}while (get_digital_in(${w.signal_ref}) ${UR_OPS[w.operator]} ${litUr(w.value)}):`);
          for (const child of block.body) emit(child, indent + IND);
          lines.push(`${indent}end`);
        }
        break;
      }
      default:
        break;
    }
  };

  lines.push(`# URScript generated from IR flow "${flow.flow_id}" v${flow.version}`);
  lines.push(`# Units: position mm->m, speed mm/s->m/s, angles rx/ry/rz passed through.`);
  lines.push(`# SAFETY: deploy only via the gated programmingService (DPC_DEPLOY_ENABLED + HITL).`);
  lines.push(`def ${sanitizeName(flow.flow_id)}():`);
  for (const block of flow.blocks) emit(block, IND);
  lines.push(`end`);

  return { code: lines.join("\n") + "\n", irCommentMap };
}

function sanitizeName(id: string): string {
  const s = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : `flow_${s}`;
}
