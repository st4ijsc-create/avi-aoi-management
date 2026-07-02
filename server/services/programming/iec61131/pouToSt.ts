/**
 * Doc 24 Wave-3 / P4 — POU → STRUCTURED TEXT transpiler (the common denominator).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Deterministic lowering of a graphical IEC 61131-3 POU (LAD / FBD / SFC) — or a textual
 * ST body — to Structured Text, the language every IEC target accepts. EVERY lowered body
 * is preceded by an `(* [IEC <lang> <ref>] *)` PROVENANCE MARKER so a reviewer can read the
 * ST and the source graphical body side-by-side (mirrors the IR transpilers' `# [IR ...]`).
 *
 * SAFETY: PURE codegen — produces TEXT, opens no device path. The result reaches a runtime
 * ONLY via the EXISTING programmingService deploy gate (OpenPLC / open runtime; never a
 * certified vendor PLC; E-stop / SIL stays on the certified L1 controller). Output is
 * deterministic (stable ordering/formatting) so a golden-file test catches any drift. No eval.
 *
 * Lowering rules:
 *   • LAD contact→`v`/`NOT v`; series→`(a AND b)`; parallel→`(a OR b)`; coil→`v := <expr>;`
 *     (negated→`NOT`, set→`IF <expr> THEN v := TRUE;`, reset→`IF <expr> THEN v := FALSE;`).
 *   • FBD block DAG inlined to a fully-parenthesised expression (AND/OR/ADD/GT/MOVE/…); an
 *     unknown/FB type renders as a formal-parameter call `TYPE(IN1 := a, IN2 := b)`.
 *   • SFC → a `CASE <state> OF` scan-cycle state machine; N/S actions inline; a synthesised
 *     INT state var is emitted (documented). Other qualifiers inline with a note.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type {
  Pou, PouProject, PouVar, VarSection,
  LadElement, LadRung, LadCoil,
  FbdNetwork, FbdBlock, FbdSource,
  SfcBody, SfcStep,
} from "./pouModel";

export interface TranspilePouResult {
  code: string;
  /** marker string → source ref (POU name / rung id / network id) for UI cross-linking. */
  iecCommentMap: Record<string, string>;
}

/** Build one provenance marker (also recorded in iecCommentMap). */
export function iecComment(lang: string, ref: string): string {
  return `(* [IEC ${lang} #${ref}] *)`;
}

// ── Deterministic literal / identifier rendering ──────────────────────────────
function fmtNum(n: number): string {
  return Number(n.toFixed(6)).toString();
}
function litSt(v: number | boolean | string): string {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return fmtNum(v);
  return `'${v}'`; // ST string literal
}
/** Pass an authored identifier through, sanitised to the IEC identifier charset. */
function ident(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(s) ? s : `_${s}`;
}

// ── Variable declarations ─────────────────────────────────────────────────────
const SECTION_ORDER: VarSection[] = [
  "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_EXTERNAL", "VAR_GLOBAL", "VAR", "VAR_TEMP",
];

function renderVarLine(v: PouVar): string {
  const at = v.address ? ` AT ${v.address}` : "";
  const init = v.initial !== undefined && v.initial !== "" ? ` := ${v.initial}` : "";
  const comment = v.comment ? ` (* ${v.comment} *)` : "";
  return `  ${ident(v.name)}${at} : ${v.type}${init};${comment}`;
}

function renderVarSections(vars: PouVar[], extra: PouVar[] = []): string[] {
  const all = [...vars, ...extra];
  const lines: string[] = [];
  for (const section of SECTION_ORDER) {
    const inSection = all.filter((v) => (v.section ?? "VAR") === section);
    if (inSection.length === 0) continue;
    lines.push(section);
    for (const v of inSection) lines.push(renderVarLine(v));
    lines.push("END_VAR");
  }
  return lines;
}

// ══════════════════════════════════════════════════════════════════════════════
// LAD → ST
// ══════════════════════════════════════════════════════════════════════════════
function renderLadElement(el: LadElement): string {
  switch (el.kind) {
    case "contact":
      return el.negated ? `NOT ${ident(el.variable)}` : ident(el.variable);
    case "series": {
      const parts = el.elements.map(renderLadElement);
      return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
    }
    case "parallel": {
      const parts = el.elements.map(renderLadElement);
      return `(${parts.join(" OR ")})`;
    }
  }
}

function renderCoil(coil: LadCoil, expr: string, indent: string): string[] {
  const v = ident(coil.variable);
  switch (coil.kind) {
    case "coil":
      return [`${indent}${v} := ${expr};`];
    case "negated":
      return [`${indent}${v} := NOT (${expr});`];
    case "set":
      return [`${indent}IF ${expr} THEN ${v} := TRUE; END_IF;`];
    case "reset":
      return [`${indent}IF ${expr} THEN ${v} := FALSE; END_IF;`];
  }
}

function lowerLadRung(rung: LadRung, ref: string, indent: string, map: Record<string, string>): string[] {
  const marker = iecComment("LD", ref);
  map[marker] = ref;
  const lines: string[] = [`${indent}${marker}`];
  if (rung.comment) lines.push(`${indent}(* ${rung.comment} *)`);
  const expr = renderLadElement(rung.logic);
  for (const coil of rung.coils) lines.push(...renderCoil(coil, expr, indent));
  return lines;
}

// ══════════════════════════════════════════════════════════════════════════════
// FBD → ST  (inline the block DAG into a fully-parenthesised expression)
// ══════════════════════════════════════════════════════════════════════════════
const INFIX_OP: Record<string, string> = {
  AND: "AND", OR: "OR", XOR: "XOR",
  ADD: "+", SUB: "-", MUL: "*", DIV: "/", MOD: "MOD",
  GT: ">", LT: "<", GE: ">=", LE: "<=", EQ: "=", NE: "<>",
};
const ASSOCIATIVE = new Set(["AND", "OR", "XOR", "ADD", "MUL"]);

function renderFbdSource(src: FbdSource, blocks: Map<string, FbdBlock>, seen: Set<string>): string {
  switch (src.kind) {
    case "var":
      return ident(src.name);
    case "const":
      return litSt(src.value);
    case "block": {
      const b = blocks.get(src.blockId);
      if (!b) return `(* missing block ${src.blockId} *) FALSE`;
      return renderFbdBlock(b, blocks, seen);
    }
  }
}

function renderFbdBlock(block: FbdBlock, blocks: Map<string, FbdBlock>, seen: Set<string>): string {
  if (seen.has(block.id)) return `(* cycle at ${block.id} *) FALSE`;
  const nextSeen = new Set(seen);
  nextSeen.add(block.id);
  const type = block.type.toUpperCase();
  const args = block.inputs.map((i) => renderFbdSource(i.source, blocks, nextSeen));
  const infix = INFIX_OP[type];

  if (type === "NOT") {
    return `NOT (${args[0] ?? "FALSE"})`;
  }
  if (type === "MOVE") {
    // MOVE is a pass-through of its single input.
    return `${args[0] ?? "0"}`;
  }
  if (infix) {
    if (ASSOCIATIVE.has(type) && args.length >= 2) {
      return `(${args.join(` ${infix} `)})`;
    }
    if (args.length === 2) return `(${args[0]} ${infix} ${args[1]})`;
    // Wrong arity for a binary op — degrade to a call form (still deterministic).
  }
  // Unknown operator / function block → formal-parameter call.
  const call = block.inputs
    .map((i) => `${i.name} := ${renderFbdSource(i.source, blocks, nextSeen)}`)
    .join(", ");
  return `${type}(${call})`;
}

function lowerFbdNetwork(net: FbdNetwork, ref: string, indent: string, map: Record<string, string>): string[] {
  const marker = iecComment("FBD", ref);
  map[marker] = ref;
  const lines: string[] = [`${indent}${marker}`];
  if (net.comment) lines.push(`${indent}(* ${net.comment} *)`);
  const blocks = new Map(net.blocks.map((b) => [b.id, b]));
  for (const out of net.outputs) {
    const rhs = renderFbdSource(out.source, blocks, new Set());
    lines.push(`${indent}${ident(out.variable)} := ${rhs};`);
  }
  return lines;
}

// ══════════════════════════════════════════════════════════════════════════════
// SFC → ST  (a CASE-of-state scan-cycle state machine)
// ══════════════════════════════════════════════════════════════════════════════
function sfcStateVar(pouName: string): string {
  return `sfc_${ident(pouName)}_step`;
}

function lowerSfc(body: SfcBody, pouName: string, indent: string, map: Record<string, string>):
  { lines: string[]; stateVar: PouVar } {
  const stateName = sfcStateVar(pouName);
  const stepIndex = new Map<string, number>();
  body.steps.forEach((s, i) => stepIndex.set(s.name, i));
  const initialIdx = Math.max(0, body.steps.findIndex((s) => s.initial));
  const marker = iecComment("SFC", pouName);
  map[marker] = pouName;

  const lines: string[] = [`${indent}${marker}`];
  lines.push(`${indent}CASE ${stateName} OF`);
  body.steps.forEach((step: SfcStep, idx) => {
    lines.push(`${indent}  ${idx}: (* step ${step.name}${step.initial ? " [initial]" : ""} *)`);
    // Step actions (N/S inline; other qualifiers inline with a note).
    for (const action of step.actions ?? []) {
      if (action.qualifier !== "N" && action.qualifier !== "S") {
        lines.push(`${indent}    (* action qualifier ${action.qualifier} — bind the IEC action-control FB on the target *)`);
      }
      for (const raw of action.actionText.split(/\r?\n/)) {
        const line = raw.trim();
        if (line) lines.push(`${indent}    ${line}`);
      }
    }
    // Outgoing transitions (priority = array order → IF / ELSIF chain).
    const outgoing = body.transitions.filter((tr) => tr.from === step.name);
    outgoing.forEach((tr, k) => {
      const target = stepIndex.get(tr.to) ?? 0;
      const kw = k === 0 ? "IF" : "ELSIF";
      lines.push(`${indent}    ${kw} (${tr.condition}) THEN ${stateName} := ${target};`);
    });
    if (outgoing.length > 0) lines.push(`${indent}    END_IF;`);
  });
  lines.push(`${indent}END_CASE;`);

  const stateVar: PouVar = {
    name: stateName,
    type: "INT",
    section: "VAR",
    initial: String(initialIdx),
    comment: "synthesised SFC state (POU→ST lowering)",
  };
  return { lines, stateVar };
}

// ══════════════════════════════════════════════════════════════════════════════
// POU + PROJECT
// ══════════════════════════════════════════════════════════════════════════════
function pouKeywords(pou: Pou): { open: string; close: string } {
  switch (pou.pouType) {
    case "program":
      return { open: `PROGRAM ${ident(pou.name)}`, close: "END_PROGRAM" };
    case "functionBlock":
      return { open: `FUNCTION_BLOCK ${ident(pou.name)}`, close: "END_FUNCTION_BLOCK" };
    case "function":
      return { open: `FUNCTION ${ident(pou.name)} : ${pou.returnType ?? "BOOL"}`, close: "END_FUNCTION" };
  }
}

function lowerPou(pou: Pou, map: Record<string, string>): string[] {
  const { open, close } = pouKeywords(pou);
  const lines: string[] = [];
  if (pou.comment) lines.push(`(* ${pou.comment} *)`);
  lines.push(open);

  const bodyLines: string[] = [];
  const extraVars: PouVar[] = [];
  const body = pou.body;
  const IND = "  ";
  switch (body.language) {
    case "LD": {
      body.networks.forEach((rung, i) => {
        bodyLines.push(...lowerLadRung(rung, rung.id ?? `rung${i + 1}`, IND, map));
      });
      break;
    }
    case "FBD": {
      body.networks.forEach((net, i) => {
        bodyLines.push(...lowerFbdNetwork(net, net.id ?? `net${i + 1}`, IND, map));
      });
      break;
    }
    case "SFC": {
      const { lines: sfcLines, stateVar } = lowerSfc(body, pou.name, IND, map);
      extraVars.push(stateVar);
      bodyLines.push(...sfcLines);
      break;
    }
    case "ST": {
      const marker = iecComment("ST", pou.name);
      map[marker] = pou.name;
      bodyLines.push(`${IND}${marker}`);
      for (const raw of body.text.split(/\r?\n/)) bodyLines.push(raw ? `${IND}${raw}` : "");
      break;
    }
  }

  lines.push(...renderVarSections(pou.vars, extraVars));
  lines.push(...bodyLines);
  lines.push(close);
  return lines;
}

/**
 * Transpile a whole POU project → Structured Text (deterministic). Each POU is emitted in
 * order, separated by a blank line, under a shared provenance header.
 */
export function transpilePouProject(project: PouProject): TranspilePouResult {
  const map: Record<string, string> = {};
  const lines: string[] = [];
  lines.push(`(* Structured Text generated from IEC 61131-3 POU project "${project.name}". *)`);
  lines.push(`(* SAFETY: deploy only to an OPEN runtime (OpenPLC) via the gated programmingService. *)`);
  lines.push(`(* E-stop / SIL safety stays on the certified L1 PLC — never authored here. *)`);
  project.pous.forEach((pou, i) => {
    if (i > 0) lines.push("");
    lines.push(...lowerPou(pou, map));
  });
  return { code: lines.join("\n") + "\n", iecCommentMap: map };
}
