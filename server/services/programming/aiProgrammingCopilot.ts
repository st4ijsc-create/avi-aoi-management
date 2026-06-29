/**
 * Doc 09 / Phase D7 — Device Programming & Control: AI ENGINEERING COPILOT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The AI side of the workspace: given an intent + a target kind, it PROPOSES a skeleton
 * device program, which is immediately VALIDATED (and optionally simulated) through the
 * SAME ProgrammingAdapter the human uses — so a suggestion is never shown unvalidated.
 *
 * HITL ABSOLUTE (purity, mirrors aiOrchestrationAdvisor): this module ONLY proposes a
 * source string + diagnostics. It opens NO device path, calls NO deploy/dispatch, and it
 * REFUSES any safety intent (E-stop / interlock / SIL / guard) — safety logic is authored
 * by certified engineers on the certified PLC, never by the copilot.
 *
 * FAIL-SAFE: flag off → available:false. Generation is DETERMINISTIC templates (works with
 * no GPU/model); a model can later enrich them behind the same validation gate. Never throws.
 * Flag: AI_PROGRAMMING_COPILOT_ENABLED (default OFF).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { programmingRegistry, type ProgrammingKind, type ProgDiagnostic } from "./programmingAdapter";

export type CopilotLang = "vi" | "en" | "zh";

export interface SuggestInput {
  kind: ProgrammingKind;
  intent: string;
  lang?: CopilotLang;
}

export interface SuggestResult {
  available: boolean;
  refused: boolean;
  reason?: string;
  kind?: ProgrammingKind;
  language?: string;
  source?: string;
  diagnostics?: ProgDiagnostic[];
  valid?: boolean;
}

export function copilotEnabled(): boolean {
  return (
    process.env.AI_PROGRAMMING_COPILOT_ENABLED === "true" ||
    process.env.AI_PROGRAMMING_COPILOT_ENABLED === "1"
  );
}

// HARD REFUSAL — the copilot must never author safety logic. Matched on the intent.
const SAFETY_RE = /\b(e-?stop|emergency|interlock|safety|sil|guard|light\s*curtain|two-hand|安全|急停)\b/i;

const LANG_OF: Record<ProgrammingKind, string> = {
  stub: "text",
  "zmotion-basic": "basic",
  gcode: "gcode",
  "mitsubishi-engineering": "device",
  "robot-tm": "tmscript",
  "iec61131-st": "st",
  "iec61131-ld": "ld",
};

/** Deterministic skeleton per kind. A model can enrich behind the same validation gate. */
function skeleton(kind: ProgrammingKind, intent: string): string {
  const c = `' ${intent.replace(/\r?\n/g, " ").slice(0, 80)}`;
  switch (kind) {
    case "zmotion-basic":
      return [c, "BASE(0,1)", "ATYPE = 1,1", "UNITS = 100,100", "SPEED = 200,200", "MOVEABS(0,0)", "WAIT IDLE", 'PRINT "done"'].join("\n");
    case "mitsubishi-engineering":
      return [c, "D100 = 0   ' set point", "D101 = 100 ' limit", "M0 := TRUE"].join("\n");
    case "robot-tm":
      return [c, "POINT P1 = (100,0,200,180,0,0)", "POINT P2 = (100,50,80,180,0,0)", "HOME", "MOVE P1", "GRIP", "MOVEL P2", "RELEASE", "HOME"].join("\n");
    case "iec61131-st":
      return [`(* ${intent.slice(0, 80)} *)`, "VAR", "  run : BOOL;", "END_VAR", "run := TRUE;"].join("\n");
    case "iec61131-ld":
      return [`// ${intent.slice(0, 80)}`, "Y0 := X0 AND NOT X1", "Y1 := Y0 OR X2"].join("\n");
    case "gcode":
      return ["; " + intent.slice(0, 80), "G21", "G90", "G0 X0 Y0", "M30"].join("\n");
    default:
      return c;
  }
}

/**
 * Propose a validated skeleton program. Advisory only — the human reviews + saves it as a
 * version in the workspace, then validates/builds/deploys through the gated router.
 */
export async function suggestProgram(input: SuggestInput): Promise<SuggestResult> {
  if (!copilotEnabled()) return { available: false, refused: false, reason: "AI_PROGRAMMING_COPILOT_ENABLED is off." };

  if (SAFETY_RE.test(input.intent)) {
    return {
      available: true,
      refused: true,
      reason:
        "The copilot does not author safety logic (E-stop / interlock / SIL / guards). " +
        "That must be implemented by a certified engineer on the certified PLC.",
    };
  }

  // Unknown/unimplemented kind → honest unavailable (no fake source).
  if (!programmingRegistry.isImplemented(input.kind)) {
    return { available: true, refused: false, reason: `No adapter for "${input.kind}" yet.`, kind: input.kind };
  }

  const language = LANG_OF[input.kind] ?? "text";
  const source = skeleton(input.kind, input.intent);

  // Validate through the SAME adapter the human uses — never propose unvalidated source.
  let diagnostics: ProgDiagnostic[] = [];
  let valid = false;
  try {
    const adapter = programmingRegistry.getAdapter(input.kind);
    const v = await adapter.validate({ kind: input.kind, language, content: source });
    diagnostics = v.diagnostics;
    valid = v.ok;
  } catch (e) {
    diagnostics = [{ severity: "warning", message: `Validation unavailable: ${(e as Error).message}` }];
  }

  return { available: true, refused: false, kind: input.kind, language, source, diagnostics, valid };
}

export interface ExplainResult {
  available: boolean;
  summary: string;
  metrics: Record<string, number>;
}

/** Deterministic structural explanation of a program (no model required). */
export function explainProgram(kind: ProgrammingKind, source: string): ExplainResult {
  if (!copilotEnabled()) return { available: false, summary: "AI_PROGRAMMING_COPILOT_ENABLED is off.", metrics: {} };
  const lines = source.split(/\r?\n/).filter((l) => l.trim() && !/^\s*('|;|\/\/|\(\*)/.test(l));
  const moves = (source.match(/\b(MOVE|MOVEABS|MOVEL|MOVECIRC|G0|G1)\b/gi) ?? []).length;
  const assigns = (source.match(/:?=/g) ?? []).length;
  return {
    available: true,
    summary: `${kind}: ${lines.length} effective line(s), ${moves} motion op(s), ${assigns} assignment(s).`,
    metrics: { lines: lines.length, moves, assigns },
  };
}
