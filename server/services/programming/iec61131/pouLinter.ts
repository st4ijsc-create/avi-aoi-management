/**
 * Doc 24 Wave-3 / P4 — SEMANTIC LINTER for the IEC 61131-3 POU model.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A BLOCKING static lint that runs BEFORE codegen — the same discipline as the IR safety
 * linter (irSafetyLinter). Any `error`-severity diagnostic BLOCKS transpile (POU→ST). It is
 * PURE + STATIC (no execution, no device I/O).
 *
 * Rules:
 *   • undefined-variable  — a LAD contact/coil, FBD var source / assign target, or a name
 *                           referenced in an SFC transition / action / ST body that is not
 *                           declared in the POU interface (VAR/VAR_INPUT/…). Fail-closed.
 *   • type-mismatch       — a LAD contact/coil on a non-BOOL var; a logical FBD block fed a
 *                           non-BOOL input; an arithmetic block fed a BOOL/STRING; an FBD
 *                           assignment whose source category differs from the target var.
 *   • unreachable-step    — an SFC step that is neither the initial step nor the target of
 *                           any transition (dead state) → error.
 *   • undefined-step      — an SFC transition from/to a step name that does not exist.
 *   • unsupported-sfc-qualifier — an SFC action with a qualifier the POU→ST lowering does not
 *                           yet implement (any of S/R/P/L/D). Only N (non-stored) is lowered
 *                           correctly; the stored/edge/timed qualifiers need action-control
 *                           state (S/R pairing) or a duration operand the model lacks (L/D).
 *                           BLOCKING so we never deploy silently-wrong logic (fail-closed).
 *
 * Advisory (warn, non-blocking): a duplicate declaration, no/multiple initial SFC steps.
 *
 * SAFETY note (unchanged caveat): this linter never authors or blesses E-stop / SIL logic —
 * that stays on the certified L1 PLC. It only gates the open-runtime POU→ST codegen.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type {
  Pou, PouProject, IecTypeCategory,
  LadElement, FbdBlock, FbdSource, FbdNetwork,
} from "./pouModel";
import { iecTypeCategory } from "./pouModel";

export interface PouLintDiagnostic {
  /** POU the finding belongs to. */
  pou: string;
  /** a stable reference within the POU (rung/network/step name). */
  ref: string;
  severity: "error" | "warn";
  rule: string;
  message: string;
}

export interface PouLintResult {
  ok: boolean; // false if ANY error → transpile MUST NOT proceed.
  diagnostics: PouLintDiagnostic[];
}

// IEC ST reserved words + operators — excluded from the free-identifier scan.
const RESERVED = new Set<string>([
  "IF", "THEN", "ELSE", "ELSIF", "END_IF", "CASE", "OF", "END_CASE",
  "FOR", "TO", "BY", "DO", "END_FOR", "WHILE", "END_WHILE", "REPEAT", "UNTIL", "END_REPEAT",
  "RETURN", "EXIT", "CONTINUE", "TRUE", "FALSE", "AND", "OR", "XOR", "NOT", "MOD", "NULL",
  "VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_GLOBAL", "END_VAR",
]);
const TYPE_NAMES = new Set<string>([
  "BOOL", "BYTE", "WORD", "DWORD", "LWORD", "SINT", "INT", "DINT", "LINT",
  "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL", "TIME", "DATE", "TOD", "DT",
  "STRING", "WSTRING",
]);

/**
 * Extract candidate free variable identifiers from an ST fragment — CONSERVATIVE so it never
 * false-errors: it skips reserved words, type names, member accesses (`x.Q`), and call / type
 * names (identifiers immediately followed by `(`) and time literals (`T#…`).
 */
export function freeIdentifiers(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[0];
    const start = m.index;
    const end = start + name.length;
    // preceding non-space char: member access `.name` → skip.
    let p = start - 1;
    while (p >= 0 && /\s/.test(text[p])) p--;
    if (p >= 0 && text[p] === ".") continue;
    // next non-space char: `(` → call/type name; `#` → typed literal prefix (T#, D#).
    let q = end;
    while (q < text.length && /\s/.test(text[q])) q++;
    const next = text[q];
    if (next === "(" || next === "#") continue;
    const upper = name.toUpperCase();
    if (RESERVED.has(upper) || TYPE_NAMES.has(upper)) continue;
    out.push(name);
  }
  return [...new Set(out)];
}

function categoryOfConst(v: number | boolean | string): IecTypeCategory | "STRING" {
  if (typeof v === "boolean") return "BOOL";
  if (typeof v === "number") return "NUM";
  return "STRING";
}

const LOGICAL_OPS = new Set(["AND", "OR", "XOR", "NOT"]);
const COMPARE_OPS = new Set(["GT", "LT", "GE", "LE", "EQ", "NE"]);
const ARITH_OPS = new Set(["ADD", "SUB", "MUL", "DIV", "MOD"]);

/** Coarse output category of an FBD block by operator type. */
function blockOutCategory(type: string): IecTypeCategory | "ANY" {
  const t = type.toUpperCase();
  if (LOGICAL_OPS.has(t) || COMPARE_OPS.has(t)) return "BOOL";
  if (ARITH_OPS.has(t)) return "NUM";
  return "ANY"; // MOVE / unknown / FB → unknown
}

function sourceCategory(
  src: FbdSource,
  blocks: Map<string, FbdBlock>,
  declared: Map<string, IecTypeCategory>,
): IecTypeCategory | "STRING" | "ANY" {
  switch (src.kind) {
    case "const": return categoryOfConst(src.value);
    case "var": return declared.get(src.name) ?? "ANY";
    case "block": {
      const b = blocks.get(src.blockId);
      if (!b) return "ANY";
      const t = b.type.toUpperCase();
      if (t === "MOVE" && b.inputs[0]) return sourceCategory(b.inputs[0].source, blocks, declared);
      return blockOutCategory(b.type);
    }
  }
}

/** Lint one POU. */
function lintPou(pou: Pou, diags: PouLintDiagnostic[]): void {
  const declaredCat = new Map<string, IecTypeCategory>();
  const seenNames = new Set<string>();
  for (const v of pou.vars) {
    if (seenNames.has(v.name)) {
      diags.push({ pou: pou.name, ref: v.name, severity: "warn", rule: "duplicate-declaration", message: `Variable "${v.name}" is declared more than once.` });
    }
    seenNames.add(v.name);
    declaredCat.set(v.name, iecTypeCategory(v.type));
  }
  const declared = (name: string) => declaredCat.has(name);
  const err = (ref: string, rule: string, message: string) =>
    diags.push({ pou: pou.name, ref, severity: "error", rule, message });

  const body = pou.body;
  switch (body.language) {
    case "LD": {
      body.networks.forEach((rung, i) => {
        const ref = rung.id ?? `rung${i + 1}`;
        // contacts — must be declared + BOOL.
        const visit = (el: LadElement) => {
          if (el.kind === "contact") {
            if (!declared(el.variable)) {
              err(ref, "undefined-variable", `contact reads "${el.variable}" which is not declared in the POU interface.`);
            } else if (declaredCat.get(el.variable) !== "BOOL") {
              err(ref, "type-mismatch", `contact "${el.variable}" is ${categoryLabel(declaredCat.get(el.variable))}, but a contact requires BOOL.`);
            }
          } else {
            el.elements.forEach(visit);
          }
        };
        visit(rung.logic);
        // coils — must be declared + BOOL.
        for (const coil of rung.coils) {
          if (!declared(coil.variable)) {
            err(ref, "undefined-variable", `coil drives "${coil.variable}" which is not declared in the POU interface.`);
          } else if (declaredCat.get(coil.variable) !== "BOOL") {
            err(ref, "type-mismatch", `coil "${coil.variable}" is ${categoryLabel(declaredCat.get(coil.variable))}, but a coil requires BOOL.`);
          }
        }
      });
      break;
    }
    case "FBD": {
      body.networks.forEach((net: FbdNetwork, i) => {
        const ref = net.id ?? `net${i + 1}`;
        const blocks = new Map(net.blocks.map((b) => [b.id, b]));
        // Each block: var sources must be declared; typed operators require a matching input category.
        for (const b of net.blocks) {
          const t = b.type.toUpperCase();
          for (const input of b.inputs) {
            if (input.source.kind === "var" && !declared(input.source.name)) {
              err(ref, "undefined-variable", `block ${b.id} (${b.type}) input "${input.name}" reads undeclared "${input.source.name}".`);
            }
            const cat = sourceCategory(input.source, blocks, declaredCat);
            if (LOGICAL_OPS.has(t) && cat !== "ANY" && cat !== "BOOL") {
              err(ref, "type-mismatch", `logical block ${b.id} (${b.type}) input "${input.name}" is ${categoryLabel(cat)}, expected BOOL.`);
            } else if (ARITH_OPS.has(t) && cat !== "ANY" && cat !== "NUM") {
              err(ref, "type-mismatch", `arithmetic block ${b.id} (${b.type}) input "${input.name}" is ${categoryLabel(cat)}, expected a numeric type.`);
            }
          }
        }
        // Output assignments: target declared + category compatible.
        for (const out of net.outputs) {
          if (!declared(out.variable)) {
            err(ref, "undefined-variable", `output assigns "${out.variable}" which is not declared in the POU interface.`);
            continue;
          }
          if (out.source.kind === "var" && !declared(out.source.name)) {
            err(ref, "undefined-variable", `output "${out.variable}" reads undeclared "${out.source.name}".`);
          }
          const srcCat = sourceCategory(out.source, blocks, declaredCat);
          const tgtCat = declaredCat.get(out.variable)!;
          if (srcCat !== "ANY" && srcCat !== "STRING" && tgtCat !== srcCat) {
            err(ref, "type-mismatch", `output "${out.variable}" (${categoryLabel(tgtCat)}) is assigned a ${categoryLabel(srcCat)} value.`);
          }
        }
      });
      break;
    }
    case "SFC": {
      const stepNames = new Set(body.steps.map((s) => s.name));
      const initialCount = body.steps.filter((s) => s.initial).length;
      if (initialCount === 0) {
        diags.push({ pou: pou.name, ref: "SFC", severity: "warn", rule: "no-initial-step", message: "SFC has no initial step (step 0 will be assumed)." });
      } else if (initialCount > 1) {
        diags.push({ pou: pou.name, ref: "SFC", severity: "warn", rule: "multiple-initial-steps", message: `SFC declares ${initialCount} initial steps (only one is expected).` });
      }
      // transitions: from/to must exist; scan condition identifiers.
      const incoming = new Set<string>();
      for (const tr of body.transitions) {
        const ref = tr.id ?? `${tr.from}->${tr.to}`;
        if (!stepNames.has(tr.from)) err(ref, "undefined-step", `transition source step "${tr.from}" does not exist.`);
        if (!stepNames.has(tr.to)) err(ref, "undefined-step", `transition target step "${tr.to}" does not exist.`);
        else incoming.add(tr.to);
        for (const id of freeIdentifiers(tr.condition)) {
          if (!declared(id)) err(ref, "undefined-variable", `transition condition references undeclared "${id}".`);
        }
      }
      // unreachable: a non-initial step with no incoming transition.
      for (const step of body.steps) {
        if (!step.initial && !incoming.has(step.name)) {
          err(step.name, "unreachable-step", `step "${step.name}" is not initial and no transition targets it (unreachable).`);
        }
        // action bodies — scan identifiers + BLOCK any qualifier the lowering can't honour.
        for (const action of step.actions ?? []) {
          if ((action.qualifier ?? "N") !== "N") {
            err(step.name, "unsupported-sfc-qualifier", `action in step "${step.name}" uses qualifier "${action.qualifier}", which the POU→ST lowering does not implement (only N is supported). Use N, or model the stored/timed behaviour explicitly (e.g. an SR/TON FB in an FBD network).`);
          }
          for (const id of freeIdentifiers(action.actionText)) {
            if (!declared(id)) err(step.name, "undefined-variable", `action in step "${step.name}" references undeclared "${id}".`);
          }
        }
      }
      break;
    }
    case "ST": {
      for (const id of freeIdentifiers(body.text)) {
        if (!declared(id)) err(pou.name, "undefined-variable", `ST body references undeclared "${id}".`);
      }
      break;
    }
  }
}

function categoryLabel(c: IecTypeCategory | "STRING" | "ANY" | undefined): string {
  return c ?? "unknown";
}

/** Lint every POU in a project. Any error → ok:false (blocks transpile). Pure. */
export function lintPouProject(project: PouProject): PouLintResult {
  const diags: PouLintDiagnostic[] = [];
  for (const pou of project.pous) lintPou(pou, diags);
  return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
}
