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
 * mm/s → m/s. Acceleration is IR mm/s² (the same mm-based unit system; the kinematic sim
 * gate already reads it as mm/s²) → m/s² (doc 80 IR-03 — it used to pass through, so the
 * editor default 200 became a=200 m/s²).
 *
 * Doc 80 IR-01: every author string that lands in the script goes through irSafeTokens
 * (`emitIoRef` / `emitIdent` / `urStr` / `commentText`), which THROW on anything outside the
 * whitelist — the linter rejects the same values first, this is defence layer 2.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Flow, IrBlock, CompareOperator, NumericOrExpr, FunctionBlockDef } from "../irModel";
import { assignIds } from "../irModel";
import { isExpr, renderSlot } from "../irExpr";
import { commentText, emitFlowId, emitIdent, emitIoRef, emitLabel, emitUnit, urStr } from "../irSafeTokens";

/** The IR↔source comment marker for one block (also surfaced in the irCommentMap). */
export function irComment(block: IrBlock): string {
  return `# [IR ${block.type} #${block.id === undefined ? "?" : emitLabel(block.id, "block id")}]`;
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
  return urStr(v, "string literal");
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
  // Tier-1c: name → definition, so a call_block can order its by-name args positionally.
  const fbByName = new Map<string, FunctionBlockDef>((flow.function_blocks ?? []).map((fb) => [fb.name, fb]));

  const comment = (block: IrBlock, indent: string) => {
    const marker = irComment(block);
    if (block.id) irCommentMap[marker] = block.id;
    lines.push(`${indent}${marker}`);
  };

  // `loopDepth` = number of enclosing count-loops (doc 80 IR-04): each nesting level gets its
  // OWN counter `ir_i_<depth>` (the `ir_` prefix is reserved — authors cannot name a var so).
  const emit = (block: IrBlock, indent: string, loopDepth: number) => {
    comment(block, indent);
    switch (block.type) {
      case "move_linear": {
        const p = block.target_pose;
        // mm → m for position; rx/ry/rz passed through; speed mm/s → m/s; accel mm/s² → m/s².
        const pose = `p[${fmt(p.x / 1000)}, ${fmt(p.y / 1000)}, ${fmt(p.z / 1000)}, ${fmt(p.rx)}, ${fmt(p.ry)}, ${fmt(p.rz)}]`;
        lines.push(`${indent}movel(${pose}, a=${fmt(block.acceleration / 1000)}, v=${fmt(block.speed_mms / 1000)}, r=${fmt(block.blend_radius / 1000)})`);
        break;
      }
      case "move_joint": {
        const joints = block.joints.map(fmt).join(", ");
        // speed_pct → a fraction of a nominal max joint speed (documented, deterministic).
        lines.push(`${indent}movej([${joints}], a=1.4, v=${fmt((block.speed_pct / 100) * 3.14)})`);
        break;
      }
      case "grip": {
        lines.push(`${indent}# tool "${emitLabel(block.tool_id, "grip tool_id")}" close, force<=${fmt(block.force_limit_n)}N, timeout=${block.timeout_ms}ms`);
        lines.push(`${indent}set_tool_digital_out(0, True)`);
        break;
      }
      case "release": {
        // tool_id is not emitted in URScript, but it is still whitelisted (same flow → ROS2).
        if (block.tool_id !== undefined) emitLabel(block.tool_id, "release tool_id");
        lines.push(`${indent}set_tool_digital_out(0, False)`);
        break;
      }
      case "set_output": {
        // value may be a literal (backward-compatible) or a safe expression.
        const val = slotUr(block.value);
        // doc 37 M3: set_digital_out is DEPRECATED (URScript §17.1.44) — use the
        // standard-digital-out replacement.
        lines.push(`${indent}set_standard_digital_out(${emitIoRef(block.signal, "set_output signal")}, ${val})`);
        break;
      }
      case "wait": {
        if (block.signal_ref !== undefined) {
          lines.push(`${indent}while (get_digital_in(${emitIoRef(block.signal_ref, "wait signal_ref")}) == False):`);
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
        lines.push(`${indent}${emitIdent(block.name, "set_variable name")} = ${renderSlot(block.expr, fmt, litUr)}`);
        break;
      }
      case "counter": {
        const v = emitIdent(block.name, "counter name");
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
        const unit = block.unit ? ` # unit=${commentText(emitUnit(block.unit, "set_analog unit"))}` : "";
        lines.push(`${indent}set_analog_out(${emitIoRef(block.channel, "set_analog channel")}, ${val})${unit}`);
        break;
      }
      case "call_block": {
        // Invoke the URScript procedure emitted for the definition. IR args are by NAME;
        // URScript procs are POSITIONAL → order the args by the definition's param list.
        const def = fbByName.get(block.fb_name);
        const argByName = new Map(block.args.map((a) => [a.name, a.value] as const));
        for (const a of block.args) emitIdent(a.name, "call_block arg name");
        const ordered = def
          ? def.params.map((p) => slotUr(argByName.get(p.name) ?? 0))
          : block.args.map((a) => slotUr(a.value));
        lines.push(`${indent}${emitIdent(block.fb_name, "call_block fb_name")}(${ordered.join(", ")})`);
        break;
      }
      case "pid_control": {
        // URScript has no native PID primitive — emit a clearly-marked, deterministic
        // skeleton discrete-PID step (still under the # [IR pid_control #id] provenance
        // marker) that saturates to the safety-bounded output. A concrete controller binds
        // this on the target; the block stays first-class + reviewable.
        const sp = slotUr(block.setpoint);
        const inCh = emitIoRef(block.input_channel, "pid_control input_channel");
        const outCh = emitIoRef(block.output_channel, "pid_control output_channel");
        lines.push(`${indent}# PID skeleton (URScript has no native PID) — bounded, deterministic step.`);
        lines.push(`${indent}pid_sp = ${sp}`);
        lines.push(`${indent}pid_pv = get_standard_analog_in(${inCh})`);
        lines.push(`${indent}pid_err = pid_sp - pid_pv`);
        lines.push(`${indent}pid_out = ${fmt(block.kp)} * pid_err + ${fmt(block.ki)} * pid_i_${outCh} + ${fmt(block.kd)} * (pid_err - pid_prev_${outCh})`);
        lines.push(`${indent}pid_out = ${clampUr("pid_out", block.output_min, block.output_max)}`);
        lines.push(`${indent}set_analog_out(${outCh}, pid_out)`);
        lines.push(`${indent}pid_i_${outCh} = pid_i_${outCh} + pid_err`);
        lines.push(`${indent}pid_prev_${outCh} = pid_err`);
        break;
      }
      case "if_condition": {
        lines.push(`${indent}if (get_digital_in(${emitIoRef(block.signal_ref, "if_condition signal_ref")}) ${UR_OPS[block.operator]} ${litUr(block.value)}):`);
        for (const child of block.true_branch) emit(child, indent + IND, loopDepth);
        if (block.false_branch.length > 0) {
          lines.push(`${indent}else:`);
          for (const child of block.false_branch) emit(child, indent + IND, loopDepth);
        }
        lines.push(`${indent}end`);
        break;
      }
      case "loop": {
        if (block.count !== undefined) {
          const depth = loopDepth + 1;
          const ctr = `ir_i_${depth}`;
          lines.push(`${indent}${ctr} = 0`);
          lines.push(`${indent}while (${ctr} < ${block.count}):`);
          for (const child of block.body) emit(child, indent + IND, depth);
          lines.push(`${indent}${IND}${ctr} = ${ctr} + 1`);
          lines.push(`${indent}end`);
        } else if (block.while !== undefined) {
          const w = block.while;
          lines.push(`${indent}while (get_digital_in(${emitIoRef(w.signal_ref, "loop while signal_ref")}) ${UR_OPS[w.operator]} ${litUr(w.value)}):`);
          // a while-loop has no counter of its own → children keep the enclosing depth.
          for (const child of block.body) emit(child, indent + IND, loopDepth);
          lines.push(`${indent}end`);
        }
        break;
      }
      default:
        break;
    }
  };

  lines.push(`# URScript generated from IR flow "${commentText(emitFlowId(flow.flow_id))}" v${flow.version}`);
  lines.push(`# Units: position mm->m, speed mm/s->m/s, accel mm/s^2->m/s^2, angles rx/ry/rz passed through.`);
  lines.push(`# SAFETY: deploy only via the gated programmingService (DPC_DEPLOY_ENABLED + HITL).`);
  // Tier-1c: reusable function-block DEFINITIONS → URScript procedures, emitted ONCE before
  // the main routine. A flow with none emits nothing here → byte-identical to pre-Tier-1c.
  for (const fb of flow.function_blocks ?? []) {
    const fbName = emitIdent(fb.name, "function_block name");
    lines.push(`# [IR function_block #${fb.id === undefined ? "?" : emitLabel(fb.id, "function_block id")}] ${fbName}`);
    lines.push(`def ${fbName}(${fb.params.map((p) => emitIdent(p.name, "function_block param")).join(", ")}):`);
    for (const b of fb.body) emit(b, IND, 0);
    lines.push(`end`);
    lines.push(``);
  }
  lines.push(`def ${sanitizeName(flow.flow_id)}():`);
  for (const block of flow.blocks) emit(block, IND, 0);
  lines.push(`end`);

  return { code: lines.join("\n") + "\n", irCommentMap };
}

/** flow_id is free text (already whitelisted by emitFlowId) → a safe def name. */
function sanitizeName(id: string): string {
  const s = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : `flow_${s}`;
}
