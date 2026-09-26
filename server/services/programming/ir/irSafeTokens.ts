/**
 * Doc 80 Đợt 0 — Task 5 (Phụ lục C §3 IR-01): the SINGLE whitelist for every IR string
 * field that reaches generated native code (URScript / ROS2 Python).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The audit measured string fields inserted VERBATIM into code (`signal`, `signal_ref`,
 * `tool_id`, if-values …) with the schema only enforcing `min(1)` ⇒ a lint-clean flow could
 * smuggle `movel(p[…], a=40, v=3)` into URScript or `os.system("id")` into ROS2.
 *
 * Three layers, all driven by the validators below (one source of truth):
 *   1. LINT  — irSafetyLinter reports an ERROR (io-ref-invalid / invalid-identifier /
 *              unsafe-string) ⇒ the gated transpile emits no code.
 *   2. EMIT  — the transpilers call `emit*()` which THROW IrUnsafeTokenError for anything
 *              outside the whitelist (so a caller that skips lint still cannot inject).
 *   3. ESCAPE — string literals / comments are additionally escaped for the target language
 *              (`pyStr`, `commentText`) so even a whitelisted value can never break a line.
 *
 * Contexts (strict per context, as the brief allows):
 *   • identifier  `^[A-Za-z_][A-Za-z0-9_]{0,63}$` minus keywords / codegen-reserved names —
 *                 variable, counter, function-block, parameter and argument names.
 *   • IO ref      a channel number `^[0-9]{1,5}$` OR an identifier — signal / signal_ref /
 *                 analog channel / PID channels.
 *   • label       `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$` — tool ids, block / fb ids, string
 *                 values compared in if / loop-while. Never needs escaping.
 *   • unit        `^[A-Za-z0-9%/._°µΩ-]{1,16}$` — the set_analog unit label (comment only).
 *   • flow id     letters / digits / marks / `_ . -` / space, first char letter|digit|`_`,
 *                 ≤128 — free text in the editor (it is SANITISED for def/class names and
 *                 ESCAPED for header comments).
 *
 * PURE: no I/O. Imported by the linter and both transpilers.
 * ════════════════════════════════════════════════════════════════════════════
 */

export type IrTokenRule = "io-ref-invalid" | "invalid-identifier" | "unsafe-string";

/** Thrown by an emitter that receives a value outside its whitelist (defence layer 2). */
export class IrUnsafeTokenError extends Error {
  readonly rule: IrTokenRule;
  readonly field: string;
  constructor(rule: IrTokenRule, field: string, value: string) {
    super(`Refusing to emit ${field} ${JSON.stringify(value)}: not allowed by the IR whitelist (${rule}).`);
    this.name = "IrUnsafeTokenError";
    this.rule = rule;
    this.field = field;
  }
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const CHANNEL_NO_RE = /^[0-9]{1,5}$/;
const LABEL_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const UNIT_RE = /^[A-Za-z0-9%/._°µΩ-]{1,16}$/;
const FLOW_ID_RE = /^[\p{L}\p{N}_][\p{L}\p{N}\p{M}_. -]{0,127}$/u;

/**
 * Names an author may NOT use as an identifier: Python + URScript keywords, the builtins /
 * helpers / temporaries the transpilers emit, and codegen-reserved prefixes (`ir_` loop
 * counters, `pid_i_`/`pid_prev_` PID state, dunder names). Using one would shadow generated
 * code or break the parse — not an injection, but the same "author text becomes code" class.
 */
const RESERVED = new Set<string>([
  // Python keywords (+ soft/builtin constants)
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
  "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
  "with", "yield",
  // URScript keywords
  "end", "thread", "run", "halt", "local", "xor",
  // URScript builtins the transpiler emits
  "movel", "movej", "sleep", "sync", "set_standard_digital_out", "set_tool_digital_out",
  "get_digital_in", "set_analog_out", "get_standard_analog_in",
  // ROS2 node surface the transpiler emits
  "self", "time", "rclpy", "Node", "Bool", "Float64", "moveit_commander", "PLANNING_GROUP",
  "set_io", "set_analog", "read_io", "wait_signal", "wait_until", "pid_control",
  // generated temporaries
  "wu_elapsed", "pid_sp", "pid_pv", "pid_err", "pid_out",
]);
const RESERVED_PREFIX = /^(?:ir_|pid_i_|pid_prev_|__)/;

export function isSafeIdent(s: unknown): s is string {
  return typeof s === "string" && IDENT_RE.test(s) && !RESERVED.has(s) && !RESERVED_PREFIX.test(s);
}
export function isSafeIoRef(s: unknown): s is string {
  return typeof s === "string" && (CHANNEL_NO_RE.test(s) || isSafeIdent(s));
}
export function isSafeLabel(s: unknown): s is string {
  return typeof s === "string" && LABEL_RE.test(s);
}
export function isSafeUnit(s: unknown): s is string {
  return typeof s === "string" && UNIT_RE.test(s);
}
export function isSafeFlowId(s: unknown): s is string {
  return typeof s === "string" && FLOW_ID_RE.test(s);
}

// ── Emit helpers (THROW on anything outside the whitelist — layer 2) ──────────────────

export function emitIdent(s: string, field: string): string {
  if (!isSafeIdent(s)) throw new IrUnsafeTokenError("invalid-identifier", field, s);
  return s;
}
export function emitIoRef(s: string, field: string): string {
  if (!isSafeIoRef(s)) throw new IrUnsafeTokenError("io-ref-invalid", field, s);
  return s;
}
export function emitLabel(s: string, field: string): string {
  if (!isSafeLabel(s)) throw new IrUnsafeTokenError("unsafe-string", field, s);
  return s;
}
export function emitUnit(s: string, field: string): string {
  if (!isSafeUnit(s)) throw new IrUnsafeTokenError("unsafe-string", field, s);
  return s;
}
export function emitFlowId(s: string, field = "flow_id"): string {
  if (!isSafeFlowId(s)) throw new IrUnsafeTokenError("unsafe-string", field, s);
  return s;
}

// ── Target-language escaping (layer 3) ──────────────────────────────────────────────

/**
 * Text placed inside a `#` comment: printable ASCII passes, anything else (line breaks,
 * non-ASCII, controls) becomes a visible `\uXXXX` escape ⇒ a comment can never end early.
 */
export function commentText(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else out += cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\U${cp.toString(16).padStart(8, "0")}`;
  }
  return out;
}

/** A Python (ROS2) double-quoted string literal with every non-printable/non-ASCII escaped. */
export function pyStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += `\\U${cp.toString(16).padStart(8, "0")}`;
  }
  return out + '"';
}

/**
 * A URScript string literal. URScript's escape support is not something we rely on, so the
 * value must already be a whitelisted LABEL (no quote, backslash, space or line break) —
 * quoting is then trivially safe.
 */
export function urStr(s: string, field: string): string {
  return `"${emitLabel(s, field)}"`;
}
