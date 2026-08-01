/**
 * Doc 24 Wave-2 P3 — SAFE, typed EXPRESSION model for the device-program IR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The P3 slice adds variables + expressions to the IR. To keep the IR the single source
 * of truth AND stay safe, an expression is a SMALL TYPED AST — NOT a string that anything
 * `eval`s. There are exactly three node kinds:
 *
 *   • { kind: "lit",   value }              — a number | boolean literal.
 *   • { kind: "var",   name }               — a reference to a `set_variable` handle.
 *   • { kind: "binop", op, left, right }    — a binary op over two sub-expressions.
 *
 * WHY THIS IS SAFE (no eval, fail-closed):
 *   1. There is NO `eval`, no `Function(...)`, no template-string interpolation into any
 *      runtime. Codegen emits a fixed, whitelisted operator set; nothing author-supplied
 *      is ever executed as code.
 *   2. `op` is a Zod enum — an author can only pick from a whitelist ({+ - * / and or not
 *      == != < <= > >=}). Anything else fails shape validation before it reaches lint or
 *      codegen.
 *   3. `evalExpr` is PURE + FAIL-CLOSED, mirroring the FOE workflowModel.evaluateCondition
 *      contract: any error (unknown var, non-finite, div-by-zero, bad type) → a SAFE
 *      default (0 / false), never a throw. A program can never crash the linter/preview.
 *   4. The linter walks the expression's `var` leaves against the declared-variable scope
 *      and reports UNDEFINED-VARIABLE use as an error → blocks transpile.
 *
 * This module is PURE DATA + PURE FUNCTIONS — no side-effects, no device path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";

// ── Operators (whitelist) ─────────────────────────────────────────────────────
/** Binary operators an expression supports. Arithmetic + comparison + boolean. */
export const exprBinOpSchema = z.enum([
  "add", "sub", "mul", "div", "mod", // arithmetic
  "eq", "neq", "lt", "lte", "gt", "gte", // comparison
  "and", "or", // boolean
]);
export type ExprBinOp = z.infer<typeof exprBinOpSchema>;

// ── Expression AST (recursive discriminated union via z.lazy) ─────────────────
export interface ExprLit {
  kind: "lit";
  value: number | boolean;
}
export interface ExprVar {
  kind: "var";
  name: string;
}
export interface ExprBinOpNode {
  kind: "binop";
  op: ExprBinOp;
  left: Expr;
  right: Expr;
}
export type Expr = ExprLit | ExprVar | ExprBinOpNode;

export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("lit"), value: z.union([z.number(), z.boolean()]) }),
    z.object({ kind: z.literal("var"), name: z.string().min(1) }),
    z.object({ kind: z.literal("binop"), op: exprBinOpSchema, left: exprSchema, right: exprSchema }),
  ]),
);

/**
 * A value slot that is EITHER a plain literal (backward-compatible with the pre-P3 shape)
 * OR a first-class expression object. Existing flows use bare `number|boolean` here, so
 * they parse unchanged; new flows may supply `{ kind: ... }`.
 */
export const numericOrExprSchema = z.union([z.number(), z.boolean(), exprSchema]);
export type NumericOrExpr = number | boolean | Expr;

/** Type guard: is this value slot an Expr node (vs a bare literal)? */
export function isExpr(v: unknown): v is Expr {
  return typeof v === "object" && v !== null && "kind" in (v as Record<string, unknown>)
    && (["lit", "var", "binop"] as const).includes((v as { kind: unknown }).kind as never);
}

// ── Free variables (for scope/linting) ────────────────────────────────────────
/** Collect the names of every `var` leaf referenced by an expression. */
export function exprFreeVars(e: Expr): string[] {
  switch (e.kind) {
    case "lit": return [];
    case "var": return [e.name];
    case "binop": return [...exprFreeVars(e.left), ...exprFreeVars(e.right)];
  }
}

/** Free variables of a value slot (literal → none; expr → its var leaves). */
export function slotFreeVars(v: NumericOrExpr): string[] {
  return isExpr(v) ? exprFreeVars(v) : [];
}

// ── Pure, fail-closed evaluation (for previews / documentation — NEVER a device path) ──
type Scope = Record<string, number | boolean>;

function toNum(v: number | boolean): number {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

/**
 * Evaluate an expression against a variable scope. PURE + FAIL-CLOSED: any unknown var,
 * non-finite result, or bad shape yields a SAFE default (0), never a throw — the same
 * discipline as FOE workflowModel.evaluateCondition. This is used ONLY for structural
 * previews/tests; it never touches hardware.
 */
export function evalExpr(e: Expr, scope: Scope = {}): number | boolean {
  try {
    switch (e.kind) {
      case "lit":
        return e.value;
      case "var": {
        const v = scope[e.name];
        return v === undefined ? 0 : v; // unknown var → fail-closed 0
      }
      case "binop": {
        const l = evalExpr(e.left, scope);
        const r = evalExpr(e.right, scope);
        switch (e.op) {
          case "add": return safeNum(toNum(l) + toNum(r));
          case "sub": return safeNum(toNum(l) - toNum(r));
          case "mul": return safeNum(toNum(l) * toNum(r));
          case "div": return toNum(r) === 0 ? 0 : safeNum(toNum(l) / toNum(r));
          case "mod": return toNum(r) === 0 ? 0 : safeNum(toNum(l) % toNum(r));
          case "eq": return toNum(l) === toNum(r);
          case "neq": return toNum(l) !== toNum(r);
          case "lt": return toNum(l) < toNum(r);
          case "lte": return toNum(l) <= toNum(r);
          case "gt": return toNum(l) > toNum(r);
          case "gte": return toNum(l) >= toNum(r);
          case "and": return Boolean(l) && Boolean(r);
          case "or": return Boolean(l) || Boolean(r);
        }
      }
    }
  } catch {
    return 0; // fail-closed
  }
}

function safeNum(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

// ── Deterministic codegen (native-language rendering) ─────────────────────────
/** Render a binary op to a target's infix operator. Whitelisted → deterministic. */
const OP_INFIX: Record<ExprBinOp, string> = {
  add: "+", sub: "-", mul: "*", div: "/", mod: "%",
  eq: "==", neq: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=",
  and: "and", or: "or",
};

/**
 * Render an expression to a target-native infix string (Python-like, shared by URScript +
 * ROS2 codegen). Numeric literals are formatted deterministically via `fmtNum`. Variable
 * refs pass through as identifiers; binops are fully parenthesised so precedence is never
 * ambiguous. Booleans render as `True`/`False` (Python-ish, matching the existing litUr).
 */
export function renderExpr(e: Expr, fmtNum: (n: number) => string): string {
  switch (e.kind) {
    case "lit":
      return typeof e.value === "boolean" ? (e.value ? "True" : "False") : fmtNum(e.value);
    case "var":
      return sanitizeVar(e.name);
    case "binop":
      return `(${renderExpr(e.left, fmtNum)} ${OP_INFIX[e.op]} ${renderExpr(e.right, fmtNum)})`;
  }
}

/** Render a value slot (literal or expr) to native text. */
export function renderSlot(
  v: NumericOrExpr,
  fmtNum: (n: number) => string,
  litFallback: (x: number | boolean) => string,
): string {
  return isExpr(v) ? renderExpr(v, fmtNum) : litFallback(v);
}

/** Sanitise a variable name to a safe identifier for codegen (whitelisted charset). */
export function sanitizeVar(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : `v_${s}`;
}
