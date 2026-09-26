/**
 * doc 63 (P5 / P6 FEA-M1) — stateVocabulary: the single grammar that keeps the three
 * distinct state models visually + semantically SEPARATE (AUD-09):
 *   • PackML (17 op-states, ISA-TR88)      — COOL token family (--packml-*)
 *   • SEMI E10 (6 availability states)      — its own palette (--e10-*)
 *   • ISA-18.2 alarm severity (4 levels)    — warm hazard palette (--alarm-*)
 *
 * Each raw state string resolves to a CSS token var (consume via `var()`). Colour comes
 * ONLY from the token; the badge also carries the label + (for transient states) motion,
 * so colour is never the sole channel (ISA-101 / WCAG 1.4.1).
 */

export type StateFamily = "packml" | "e10" | "alarm" | "andon" | "unitmode";

export interface StateToken {
  /** CSS custom property, e.g. "--packml-run". */
  varName: string;
  /** Transient / in-progress states pulse to read "auto-advancing". */
  transient?: boolean;
}

const norm = (s: string) => (s || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** PackML 17 states grouped into 6 tone families. */
const PACKML: Record<string, StateToken> = {
  execute: { varName: "--packml-run" }, producing: { varName: "--packml-run" }, running: { varName: "--packml-run" },
  idle: { varName: "--packml-ready" }, ready: { varName: "--packml-ready" }, complete: { varName: "--packml-ready" }, stopped: { varName: "--packml-ready" }, resetting: { varName: "--packml-ready", transient: true },
  starting: { varName: "--packml-acting", transient: true }, completing: { varName: "--packml-acting", transient: true }, unholding: { varName: "--packml-acting", transient: true }, unsuspending: { varName: "--packml-acting", transient: true }, clearing: { varName: "--packml-acting", transient: true },
  holding: { varName: "--packml-held", transient: true }, held: { varName: "--packml-held" },
  suspending: { varName: "--packml-suspend", transient: true }, suspended: { varName: "--packml-suspend" },
  stopping: { varName: "--packml-abort", transient: true }, aborting: { varName: "--packml-abort", transient: true }, aborted: { varName: "--packml-abort" },
};

const E10: Record<string, string> = {
  pt: "--e10-pt", productive: "--e10-pt",
  sb: "--e10-sb", standby: "--e10-sb",
  et: "--e10-et", engineering: "--e10-et",
  sd: "--e10-sd", scheduled_downtime: "--e10-sd",
  ud: "--e10-ud", unscheduled_downtime: "--e10-ud",
  ns: "--e10-ns", non_scheduled: "--e10-ns", nonscheduled: "--e10-ns",
};

const ALARM: Record<string, string> = {
  critical: "--alarm-critical", crit: "--alarm-critical", p1: "--alarm-critical",
  high: "--alarm-high", p2: "--alarm-high",
  medium: "--alarm-medium", med: "--alarm-medium", warning: "--alarm-medium", p3: "--alarm-medium",
  low: "--alarm-low", info: "--alarm-low", advisory: "--alarm-low", p4: "--alarm-low",
};

// Andon (AUD-09 fix — 'call' now ALWAYS its own level, never conflated with red/yellow):
// green = normal/quiet · yellow = attention · red = stop · call = call-for-help (distinct hue).
const ANDON: Record<string, string> = {
  green: "--e10-pt", ok: "--e10-pt", normal: "--e10-pt",
  yellow: "--alarm-medium", warn: "--alarm-medium",
  red: "--alarm-critical", stop: "--alarm-critical", down: "--alarm-critical",
  call: "--alarm-high", help: "--alarm-high",
};

// PackML unit mode (3): Production (quiet) · Maintenance (attention) · Manual (distinct).
const UNITMODE: Record<string, string> = {
  production: "--packml-ready", auto: "--packml-ready", automatic: "--packml-ready",
  maintenance: "--alarm-medium",
  manual: "--packml-acting", semi_auto: "--packml-acting",
};

/** Resolve a raw state string within a family → its token, or null when unknown (caller
 *  should then fall back to the neutral --isa-graphic-muted, never a guessed colour). */
export function resolveStateToken(family: StateFamily, raw: string): StateToken | null {
  const k = norm(raw);
  switch (family) {
    case "packml": return PACKML[k] ?? null;
    case "e10": return E10[k] ? { varName: E10[k] } : null;
    case "alarm": return ALARM[k] ? { varName: ALARM[k] } : null;
    case "andon": return ANDON[k] ? { varName: ANDON[k] } : null;
    case "unitmode": return UNITMODE[k] ? { varName: UNITMODE[k] } : null;
    default: return null;
  }
}
