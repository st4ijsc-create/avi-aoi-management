/**
 * Doc 24 Wave-3 / P4 — STRUCTURED IEC 61131-3 POU MODEL (graphical LAD / FBD / SFC).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A portable, Zod-validated JSON model for IEC 61131-3 Program Organisation Units (POUs)
 * — the structured graphical sibling of the textual ST / one-line-LD adapters. It mirrors
 * the IR model's discriminated-union + provenance style so an engineer can author a POU as
 * a first-class LAD rung / FBD network / SFC chart (or textual ST), then LINT → transpile
 * to ST (the common denominator) under the SAME gate discipline, and interchange it as
 * PLCopen TC6 XML (plcopenXml.ts).
 *
 * Three graphical body languages + textual ST:
 *   • LAD — rungs: a series/parallel network of CONTACTS driving one or more COILS.
 *   • FBD — a DAG of function BLOCKS (AND/OR/ADD/GT/MOVE/…) wired var→block→var.
 *   • SFC — STEPS + TRANSITIONS + step ACTIONS (inline ST bodies).
 *   • ST  — a textual Structured Text body (interop passthrough).
 *
 * SAFETY (the hard rule, preserved from iec61131Adapter): a POU is PURE DATA. It compiles
 * to and deploys on an OPEN runtime ONLY (OpenPLC / a PLCopen-XML target); it is NEVER
 * auto-pushed into a certified vendor PLC and NEVER authors E-stop / SIL safety logic —
 * that stays on the certified L1 controller. Nothing here reaches hardware; a POU becomes
 * runnable only through the EXISTING programmingService gate (validate → compile → simulate
 * → HITL → gated deploy).
 *
 * This module is PURE DATA + PURE FUNCTIONS — no side-effects, no device path, no eval.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";

// ── IEC 61131-3 elementary data types (the common subset) ─────────────────────
export const iecTypeSchema = z.enum([
  "BOOL",
  "BYTE", "WORD", "DWORD", "LWORD",
  "SINT", "INT", "DINT", "LINT",
  "USINT", "UINT", "UDINT", "ULINT",
  "REAL", "LREAL",
  "TIME", "DATE", "TOD", "DT",
  "STRING", "WSTRING",
]);
export type IecType = z.infer<typeof iecTypeSchema>;

/** Coarse type category for the type-mismatch linter (BOOL vs numeric vs time vs string). */
export type IecTypeCategory = "BOOL" | "NUM" | "TIME" | "DATETIME" | "STRING";

export function iecTypeCategory(t: IecType): IecTypeCategory {
  switch (t) {
    case "BOOL": return "BOOL";
    case "TIME": return "TIME";
    case "DATE": case "TOD": case "DT": return "DATETIME";
    case "STRING": case "WSTRING": return "STRING";
    default: return "NUM"; // all integer + real families
  }
}

// ── Variable declaration ──────────────────────────────────────────────────────
export const varSectionSchema = z.enum([
  "VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_GLOBAL", "VAR_EXTERNAL",
]);
export type VarSection = z.infer<typeof varSectionSchema>;

/** One IEC variable declaration (name + type + section + optional init/address/comment). */
export const pouVarSchema = z.object({
  name: z.string().min(1),
  type: iecTypeSchema,
  section: varSectionSchema.default("VAR"),
  /** Initial value as a literal token (e.g. "FALSE", "0", "T#500ms"). */
  initial: z.string().optional(),
  /** Direct address (e.g. "%IX0.0", "%QX0.1") — optional. */
  address: z.string().optional(),
  comment: z.string().optional(),
});
export type PouVar = z.infer<typeof pouVarSchema>;

// ══════════════════════════════════════════════════════════════════════════════
// LAD — Ladder Diagram: a series/parallel network of contacts driving coils.
// ══════════════════════════════════════════════════════════════════════════════

/** A single contact — normally-open (`--| |--`) or normally-closed (`--|/|--`). */
export interface LadContact {
  kind: "contact";
  /** the boolean variable this contact reads. */
  variable: string;
  /** normally-closed (negated) contact when true. */
  negated?: boolean;
}
/** A horizontal chain of elements — logical AND. */
export interface LadSeries {
  kind: "series";
  elements: LadElement[];
}
/** A vertical branch group — logical OR. */
export interface LadParallel {
  kind: "parallel";
  elements: LadElement[];
}
export type LadElement = LadContact | LadSeries | LadParallel;

export const ladElementSchema: z.ZodType<LadElement> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("contact"), variable: z.string().min(1), negated: z.boolean().optional() }),
    z.object({ kind: z.literal("series"), elements: z.array(ladElementSchema).min(1) }),
    z.object({ kind: z.literal("parallel"), elements: z.array(ladElementSchema).min(2) }),
  ]),
);

/** A coil (output). Normal / negated / set(latch) / reset(unlatch). */
export const ladCoilSchema = z.object({
  variable: z.string().min(1),
  kind: z.enum(["coil", "negated", "set", "reset"]).default("coil"),
});
export type LadCoil = z.infer<typeof ladCoilSchema>;

/** One rung (network): a rung-logic network driving one or more coils. */
export const ladRungSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  comment: z.string().optional(),
  logic: ladElementSchema,
  coils: z.array(ladCoilSchema).min(1),
});
export type LadRung = z.infer<typeof ladRungSchema>;

export const ladBodySchema = z.object({
  language: z.literal("LD"),
  networks: z.array(ladRungSchema),
});
export type LadBody = z.infer<typeof ladBodySchema>;

// ══════════════════════════════════════════════════════════════════════════════
// FBD — Function Block Diagram: a DAG of blocks wired var/const → block → var.
// ══════════════════════════════════════════════════════════════════════════════

/** Where a block input / output-assignment reads its value from. */
export const fbdSourceSchema = z.union([
  z.object({ kind: z.literal("var"), name: z.string().min(1) }),
  z.object({ kind: z.literal("const"), value: z.union([z.number(), z.boolean(), z.string()]) }),
  z.object({ kind: z.literal("block"), blockId: z.string().min(1), pin: z.string().optional() }),
]);
export type FbdSource = z.infer<typeof fbdSourceSchema>;

/** A block instance: a typed operator/FB call with named inputs and one primary output. */
export const fbdBlockSchema = z.object({
  id: z.string().min(1),
  /** Operator / FB type name: AND OR XOR NOT ADD SUB MUL DIV GT LT GE LE EQ NE MOVE, or an FB. */
  type: z.string().min(1),
  inputs: z.array(z.object({ name: z.string().min(1), source: fbdSourceSchema })),
  /** primary output pin name (defaults to OUT / ENO per type at codegen). */
  outputPin: z.string().optional(),
  comment: z.string().optional(),
});
export type FbdBlock = z.infer<typeof fbdBlockSchema>;

/** An output connection: assign a variable from a source (var/const/block output). */
export const fbdAssignSchema = z.object({
  variable: z.string().min(1),
  source: fbdSourceSchema,
});
export type FbdAssign = z.infer<typeof fbdAssignSchema>;

export const fbdNetworkSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  comment: z.string().optional(),
  blocks: z.array(fbdBlockSchema),
  outputs: z.array(fbdAssignSchema),
});
export type FbdNetwork = z.infer<typeof fbdNetworkSchema>;

export const fbdBodySchema = z.object({
  language: z.literal("FBD"),
  networks: z.array(fbdNetworkSchema),
});
export type FbdBody = z.infer<typeof fbdBodySchema>;

// ══════════════════════════════════════════════════════════════════════════════
// SFC — Sequential Function Chart: steps + transitions + step actions.
// ══════════════════════════════════════════════════════════════════════════════

/** Action qualifier (subset): N non-stored, S set, R reset, P pulse, L time-limited, D delayed. */
export const sfcQualifierSchema = z.enum(["N", "S", "R", "P", "L", "D"]);
export type SfcQualifier = z.infer<typeof sfcQualifierSchema>;

/** A step action — an inline ST body executed per the qualifier while the step is active. */
export const sfcActionSchema = z.object({
  qualifier: sfcQualifierSchema.default("N"),
  /** inline Structured Text executed by this action. */
  actionText: z.string(),
  /** optional action name (for PLCopen actionBlock reference). */
  name: z.string().optional(),
});
export type SfcAction = z.infer<typeof sfcActionSchema>;

export const sfcStepSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  initial: z.boolean().optional(),
  actions: z.array(sfcActionSchema).default([]),
});
export type SfcStep = z.infer<typeof sfcStepSchema>;

export const sfcTransitionSchema = z.object({
  id: z.string().optional(),
  /** source step name. */
  from: z.string().min(1),
  /** target step name. */
  to: z.string().min(1),
  /** transition condition — an ST boolean expression. */
  condition: z.string().min(1),
});
export type SfcTransition = z.infer<typeof sfcTransitionSchema>;

export const sfcBodySchema = z.object({
  language: z.literal("SFC"),
  steps: z.array(sfcStepSchema).min(1),
  transitions: z.array(sfcTransitionSchema),
});
export type SfcBody = z.infer<typeof sfcBodySchema>;

// ── Textual ST body (interop passthrough) ─────────────────────────────────────
export const stBodySchema = z.object({
  language: z.literal("ST"),
  text: z.string(),
});
export type StBody = z.infer<typeof stBodySchema>;

// ── POU body = one of the four languages (discriminated by `language`) ────────
export const pouBodySchema = z.discriminatedUnion("language", [
  ladBodySchema,
  fbdBodySchema,
  sfcBodySchema,
  stBodySchema,
]);
export type PouBody = z.infer<typeof pouBodySchema>;
export type PouBodyLanguage = PouBody["language"];

// ── POU ────────────────────────────────────────────────────────────────────────
export const pouTypeSchema = z.enum(["program", "functionBlock", "function"]);
export type PouType = z.infer<typeof pouTypeSchema>;

export const pouSchema = z.object({
  name: z.string().min(1),
  pouType: pouTypeSchema,
  /** return type for a FUNCTION (ignored for program / functionBlock). */
  returnType: iecTypeSchema.optional(),
  vars: z.array(pouVarSchema),
  body: pouBodySchema,
  comment: z.string().optional(),
});
export type Pou = z.infer<typeof pouSchema>;

/** A PLCopen-style project: a named container of one or more POUs. */
export const pouProjectSchema = z.object({
  name: z.string().min(1).default("Project"),
  pous: z.array(pouSchema).min(1),
  /** optional file-header provenance (round-tripped through PLCopen XML). */
  fileHeader: z
    .object({
      companyName: z.string().optional(),
      productName: z.string().optional(),
      productVersion: z.string().optional(),
    })
    .optional(),
});
export type PouProject = z.infer<typeof pouProjectSchema>;

// ── Pure parse helpers (mirror irModel.parseFlow / parseFlowJson) ─────────────
export function parsePouProject(input: unknown):
  | { ok: true; project: PouProject }
  | { ok: false; errors: Array<{ path: string; message: string }> } {
  const res = pouProjectSchema.safeParse(input);
  if (res.success) return { ok: true, project: res.data };
  return {
    ok: false,
    errors: res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

export function parsePouProjectJson(json: string):
  | { ok: true; project: PouProject }
  | { ok: false; errors: Array<{ path: string; message: string }> } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [{ path: "", message: `Invalid JSON: ${(e as Error).message}` }] };
  }
  return parsePouProject(value);
}

// ── Structural helpers ────────────────────────────────────────────────────────

/** Collect the boolean variables read by a LAD element (contacts), depth-first, in order. */
export function ladElementContacts(el: LadElement): LadContact[] {
  switch (el.kind) {
    case "contact":
      return [el];
    case "series":
    case "parallel":
      return el.elements.flatMap(ladElementContacts);
  }
}

/** Sum of POUs / networks (a coarse size metric for previews). */
export function countNetworks(project: PouProject): number {
  let n = 0;
  for (const pou of project.pous) {
    const b = pou.body;
    if (b.language === "LD") n += b.networks.length;
    else if (b.language === "FBD") n += b.networks.length;
    else if (b.language === "SFC") n += b.steps.length;
    else n += 1;
  }
  return n;
}
