/**
 * Doc 69 / Giai đoạn 5 · Wave 4 · C4 — SEMANTIC SAFETY LINTER (structural, cross-vendor).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The platform already has TWO safety mechanisms:
 *   1. `SAFETY_RE` in aiProgrammingCopilot.ts — a KEYWORD/regex REFUSE guard that stops the
 *      copilot from AUTHORING safety-function logic (E-stop / interlock / SIL / …) when the
 *      user's REQUEST mentions it.
 *   2. Per-vendor `validate()` in each ProgrammingAdapter — SYNTAX/shape checks (balanced
 *      blocks, known verbs, declared points/vars).
 *
 * Neither catches a program that is STRUCTURALLY unsafe but mentions no safety keyword at
 * all — e.g. a `WHILE TRUE` motion loop with no exit, a move with a wildly out-of-range
 * speed/position literal, or a bare actuation command with no guarding conditional anywhere
 * upstream. THIS module is that missing SEMANTIC pass: three heuristic, language-aware
 * checks that look at the STRUCTURE of the code, not its vocabulary:
 *
 *   • unbounded-loop      — a condition-driven loop (`WHILE TRUE`/`WHILE 1`, …) with no
 *                            reachable escape (`EXIT`/`RETURN`/…) inside its body, OR an
 *                            unconditional label/GOTO back-edge (no `IF` guarding the jump).
 *   • motion-envelope     — a motion command's numeric speed/position argument exceeds a
 *                            conservative, configurable ceiling (env-tunable; see
 *                            `resolveSafetyLimits`).
 *   • missing-interlock   — a motion/actuation command with NO guarding conditional anywhere
 *                            upstream in its block (a bare, unconditional move/output).
 *
 * HONESTY (non-negotiable): every finding is severity **warning** — ADVISORY, not a build
 * gate, and NOT a safety certification. The certified controller + a qualified engineer own
 * real safety verification; this only prevents a structurally-obvious hazard from passing
 * silently with zero signal. It COMPLEMENTS `SAFETY_RE` (which polices AUTHORING INTENT) —
 * this module never blocks authoring and never duplicates the keyword regex; it looks at the
 * program's STRUCTURE, so it fires even when the source contains no "safety" word at all.
 *
 * FAIL-SAFE (non-negotiable): a heuristic MUST NOT brick codegen. `lintProgramSafety()` never
 * throws — malformed input, an unrecognised language, or an internal regex edge case all
 * degrade to "no findings", never a crash and never an error-severity diagnostic.
 *
 * LANGUAGE SCOPE: each vendor gets its own small, hand-written profile (regex patterns tuned
 * to that vendor's real motion/loop/conditional syntax) — see `PROFILES` below. An
 * unrecognised `kind`/`lang` returns [] (honest: we do not guess-heuristic a language we have
 * not modelled, rather than risk false positives on an unknown grammar). A profile only
 * defines the checks that make sense for that vendor's grammar (e.g. Techman TMscript job-
 * lists have no conditional statement in this platform's DSL, so `interlock` is omitted for
 * `robot-tm` — enabling it would false-positive on every existing golden example, since a
 * bare unconditional MOVE is simply how this language is authored today).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { ProgDiagnostic } from "./programmingAdapter";

export type SafetyLintCategory = "unbounded-loop" | "motion-envelope" | "missing-interlock";

export interface SafetyLintFinding {
  category: SafetyLintCategory;
  /** 1-indexed source line, when known. */
  line?: number;
  message: string;
}

export interface SafetyLimits {
  /** Conservative ceiling for a Cartesian/linear motion speed (mm/s). */
  maxSpeedMms: number;
  /** Conservative ceiling for a percentage-style speed/override (0-100). */
  maxSpeedPct: number;
  /** Conservative ceiling for a single-axis position magnitude (mm, ± from origin). */
  maxPositionMm: number;
}

// ── env tunables (read at call time; conservative-default, override per cell/vendor) ──
function num(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve the conservative envelope ceilings. These are DELIBERATELY generic defaults (not
 * derived from any real robot's certified limits) — a real cell's actual envelope is
 * machine-specific and lives on the certified controller. Override per env/const when a
 * tighter or looser conservative default is known for a deployment.
 */
export function resolveSafetyLimits(override?: Partial<SafetyLimits>): SafetyLimits {
  const base: SafetyLimits = {
    maxSpeedMms: num("DPC_SAFETY_LINT_MAX_SPEED_MMS", 250),
    maxSpeedPct: num("DPC_SAFETY_LINT_MAX_SPEED_PCT", 100),
    maxPositionMm: num("DPC_SAFETY_LINT_MAX_POSITION_MM", 1000),
  };
  if (!override) return base;
  return {
    maxSpeedMms: override.maxSpeedMms ?? base.maxSpeedMms,
    maxSpeedPct: override.maxSpeedPct ?? base.maxSpeedPct,
    maxPositionMm: override.maxPositionMm ?? base.maxPositionMm,
  };
}

const ADVISORY =
  "ADVISORY finding requiring engineer review — a structural heuristic, NOT a safety " +
  "certification (the certified controller + a qualified engineer own real safety verification).";

type MotionSampleKind = "speed_mms" | "speed_pct" | "position_mm";
interface MotionSample {
  line: number;
  kind: MotionSampleKind;
  value: number;
}

interface LangProfile {
  /** Strip a whole-file block comment style (e.g. IEC ST `(* ... *)`) before line-splitting. */
  stripBlockComments?: (content: string) => string;
  /** Strip a line/tail comment (e.g. `'…`, `!…`, `//…`) per line before checks run. */
  lineCommentRe?: RegExp;
  loop?: {
    /** Opens a condition-driven "infinite" loop (e.g. `WHILE TRUE DO`). */
    openRe?: RegExp;
    /** Closes the block opened by `openRe` (searched forward from the open line). */
    closeRe?: RegExp;
    /** An escape token recognised anywhere inside the loop body. */
    escapeRe?: RegExp;
    /** Defines a label; capture group 1 = label id. */
    labelDefRe?: RegExp;
    /** References a label as a jump target; capture group 1 = label id. */
    jumpRe?: RegExp;
    /** If this matches the SAME line as a jump, the jump is conditional (not a bare back-edge). */
    conditionalHintRe?: RegExp;
  };
  motion?: {
    extract(lines: string[]): MotionSample[];
  };
  interlock?: {
    /** A motion/actuation command considered "must be guarded". */
    actuationRe: RegExp;
    /** Opens a conditional block (block-form only, e.g. a line ending in `THEN`). */
    guardOpenRe: RegExp;
    /** Closes the conditional block opened by `guardOpenRe`. */
    guardCloseRe: RegExp;
  };
}

// ── per-vendor profiles ────────────────────────────────────────────────────────
// Numeric literal helper shared by extractors below.
const NUM = "-?\\d+(?:\\.\\d+)?";

const PROFILES: Record<string, LangProfile> = {
  // IEC 61131-3 Structured Text — PLC process logic, no native motion verb in this platform.
  "iec61131-st": {
    stripBlockComments: (c) => c.replace(/\(\*[\s\S]*?\*\)/g, ""),
    loop: {
      openRe: /\bWHILE\s+(?:TRUE|1)\s+DO\b/i,
      closeRe: /\bEND_WHILE\b/i,
      escapeRe: /\b(EXIT|RETURN)\b/i,
    },
  },
  // Techman TMflow job-list — linear step sequence; this DSL has no conditional statement,
  // so `interlock` is intentionally omitted (would false-positive on every job-list).
  "robot-tm": {
    lineCommentRe: /'.*/,
    motion: {
      extract(lines) {
        const out: MotionSample[] = [];
        lines.forEach((raw, i) => {
          const m = raw.match(/^\s*POINT\s+[A-Za-z_]\w*\s*=\s*\(([^)]*)\)/i);
          if (!m) return;
          const nums = m[1].split(",").map((s) => Number(s.trim()));
          const [x, y, z] = nums;
          for (const v of [x, y, z]) {
            if (Number.isFinite(v)) out.push({ line: i + 1, kind: "position_mm", value: v });
          }
        });
        return out;
      },
    },
  },
  // Zmotion ZBasic/RTBasic — SPEED=<n> sets the demand speed (user units/sec ~ mm/s).
  "zmotion-basic": {
    lineCommentRe: /'.*/,
    motion: {
      extract(lines) {
        const out: MotionSample[] = [];
        lines.forEach((raw, i) => {
          const m = raw.match(new RegExp(`\\bSPEED\\s*=\\s*(${NUM})`, "i"));
          if (m) out.push({ line: i + 1, kind: "speed_mms", value: Number(m[1]) });
        });
        return out;
      },
    },
  },
  // Fanuc KAREL/TP — teach-pendant listing: `L/J P[n] <speed> CNT##|FINE`, `LBL[n]` / `JMP LBL[n]`.
  karel: {
    lineCommentRe: /(?:!|\/\/).*/,
    loop: {
      labelDefRe: /^\s*\d+\s*:\s*LBL\[(\d+)\]\s*$/,
      jumpRe: /\bJMP\s+LBL\[(\d+)\]/i,
      conditionalHintRe: /\bIF\b/i,
    },
    motion: {
      extract(lines) {
        const out: MotionSample[] = [];
        lines.forEach((raw, i) => {
          const mm = raw.match(new RegExp(`\\b[LC]\\s+P\\[\\d+\\]\\s+(${NUM})\\s*mm\\s*/\\s*sec`, "i"));
          if (mm) out.push({ line: i + 1, kind: "speed_mms", value: Number(mm[1]) });
          const pct = raw.match(new RegExp(`\\bJ\\s+P\\[\\d+\\]\\s+(${NUM})\\s*%`, "i"));
          if (pct) out.push({ line: i + 1, kind: "speed_pct", value: Number(pct[1]) });
        });
        return out;
      },
    },
  },
  // ABB RAPID — `MoveL/MoveJ/MoveC <robtarget>, v<NNN>, <zonedata>, <tool>;`; `WHILE ... DO`.
  rapid: {
    lineCommentRe: /!.*/,
    loop: {
      openRe: /\bWHILE\s+TRUE\s+DO\b/i,
      closeRe: /\bENDWHILE\b/i,
      escapeRe: /\b(RETURN|GOTO|ExitCycle)\b/i,
    },
    motion: {
      extract(lines) {
        const out: MotionSample[] = [];
        lines.forEach((raw, i) => {
          const m = raw.match(new RegExp(`\\bMove[LJC]\\s+[^,]+,\\s*v(${NUM})\\s*,`, "i"));
          if (m) out.push({ line: i + 1, kind: "speed_mms", value: Number(m[1]) });
        });
        return out;
      },
    },
  },
  // Mitsubishi MELFA-BASIC V/VI — `MOV`/`MVS` motion, `M_OUT(n)=`, `SPD <n>`, `IF … THEN`/`ENDIF`.
  melfa: {
    lineCommentRe: /'.*/,
    loop: {
      openRe: /\bWHILE\s*\(?\s*1\s*\)?\s*$/i,
      closeRe: /\bWEND\b/i,
      escapeRe: /\bGOTO\b/i,
    },
    motion: {
      extract(lines) {
        const out: MotionSample[] = [];
        lines.forEach((raw, i) => {
          const m = raw.match(new RegExp(`\\bSPD\\s+(${NUM})`, "i"));
          if (m) out.push({ line: i + 1, kind: "speed_mms", value: Number(m[1]) });
        });
        return out;
      },
    },
    interlock: {
      actuationRe: /\b(MOV|MVS)\b|\bM_OUT\s*\(\s*\d+\s*\)\s*=/i,
      guardOpenRe: /\bIF\b.*\bTHEN\s*$/i,
      guardCloseRe: /\bEND\s*IF\b/i,
    },
  },
  // Delta robot (DRAS/DIAStudio) — `MOVJ`/`MOVL` motion, `DO(n)=`, `SPEED <pct>`, `IF…THEN`/`END IF`.
  "delta-robot": {
    lineCommentRe: /'.*/,
    loop: {
      openRe: /\bWHILE\s*\(?\s*1\s*\)?\s*$/i,
      closeRe: /\bWEND\b/i,
      escapeRe: /\bGOTO\b/i,
    },
    motion: {
      extract(lines) {
        const out: MotionSample[] = [];
        lines.forEach((raw, i) => {
          const m = raw.match(new RegExp(`\\bSPEED\\s+(${NUM})`, "i"));
          if (m) out.push({ line: i + 1, kind: "speed_pct", value: Number(m[1]) });
        });
        return out;
      },
    },
    interlock: {
      actuationRe: /\b(MOVJ|MOVL|MOVC)\b|\bDO\s*\(\s*\d+\s*\)\s*=/i,
      guardOpenRe: /\bIF\b.*\bTHEN\s*$/i,
      guardCloseRe: /\bEND\s*IF\b/i,
    },
  },
};

function profileFor(kind: string): LangProfile | undefined {
  return PROFILES[String(kind ?? "").trim().toLowerCase()];
}

function toLines(profile: LangProfile, content: string): string[] {
  const stripped = profile.stripBlockComments ? profile.stripBlockComments(content) : content;
  const raw = stripped.split(/\r?\n/);
  if (!profile.lineCommentRe) return raw;
  return raw.map((l) => l.replace(profile.lineCommentRe!, ""));
}

// ── check 1: unbounded loop ─────────────────────────────────────────────────
function checkUnboundedLoop(lines: string[], profile: LangProfile): SafetyLintFinding[] {
  const loop = profile.loop;
  if (!loop) return [];
  const out: SafetyLintFinding[] = [];

  // (a) condition-driven infinite loop with no escape token in its body.
  if (loop.openRe && loop.closeRe) {
    lines.forEach((line, i) => {
      if (!loop.openRe!.test(line)) return;
      let closeIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (loop.closeRe!.test(lines[j])) { closeIdx = j; break; }
      }
      if (closeIdx === -1) return; // unmatched — do not guess-heuristic a malformed snippet.
      const body = lines.slice(i + 1, closeIdx);
      const hasEscape = loop.escapeRe ? body.some((l) => loop.escapeRe!.test(l)) : false;
      if (!hasEscape) {
        out.push({
          category: "unbounded-loop",
          line: i + 1,
          message:
            `Loop condition never becomes false and the body has no BREAK/EXIT/RETURN — an ` +
            `unbounded loop driving motion or I/O is a hazard. ${ADVISORY}`,
        });
      }
    });
  }

  // (b) unconditional label/GOTO back-edge (a jump to an earlier label with no IF guarding it).
  if (loop.labelDefRe && loop.jumpRe) {
    const labelLine = new Map<string, number>();
    lines.forEach((line, i) => {
      const m = line.match(loop.labelDefRe!);
      if (m) labelLine.set(m[1], i);
    });
    lines.forEach((line, i) => {
      const m = line.match(loop.jumpRe!);
      if (!m) return;
      const target = labelLine.get(m[1]);
      if (target === undefined || target >= i) return; // forward jump / unknown label → not a back-edge.
      if (loop.conditionalHintRe && loop.conditionalHintRe.test(line)) return; // guarded jump — bounded.
      out.push({
        category: "unbounded-loop",
        line: i + 1,
        message:
          `Unconditional jump back to an earlier label with no guarding condition — the loop has ` +
          `no reachable exit. ${ADVISORY}`,
      });
    });
  }

  return out;
}

// ── check 2: motion envelope ────────────────────────────────────────────────
function checkMotionEnvelope(lines: string[], profile: LangProfile, limits: SafetyLimits): SafetyLintFinding[] {
  if (!profile.motion) return [];
  const out: SafetyLintFinding[] = [];
  for (const s of profile.motion.extract(lines)) {
    if (s.kind === "speed_mms" && (s.value > limits.maxSpeedMms || s.value < 0)) {
      out.push({
        category: "motion-envelope",
        line: s.line,
        message:
          `Motion speed ${s.value} mm/s is ${s.value < 0 ? "negative (invalid)" : `above the conservative ceiling ${limits.maxSpeedMms} mm/s`} — verify against the certified controller's real motion limits. ${ADVISORY}`,
      });
    } else if (s.kind === "speed_pct" && (s.value > limits.maxSpeedPct || s.value < 0)) {
      out.push({
        category: "motion-envelope",
        line: s.line,
        message:
          `Motion speed override ${s.value}% is ${s.value < 0 ? "negative (invalid)" : `above ${limits.maxSpeedPct}%`} — verify against the certified controller's real motion limits. ${ADVISORY}`,
      });
    } else if (s.kind === "position_mm" && Math.abs(s.value) > limits.maxPositionMm) {
      out.push({
        category: "motion-envelope",
        line: s.line,
        message:
          `Target position ${s.value} mm on this axis exceeds the conservative workspace ceiling ` +
          `±${limits.maxPositionMm} mm — verify against the certified controller's real workspace envelope. ${ADVISORY}`,
      });
    }
  }
  return out;
}

// ── check 3: missing interlock ──────────────────────────────────────────────
function checkMissingInterlock(lines: string[], profile: LangProfile): SafetyLintFinding[] {
  const interlock = profile.interlock;
  if (!interlock) return [];
  const out: SafetyLintFinding[] = [];
  let depth = 0;
  lines.forEach((line, i) => {
    if (interlock.guardCloseRe.test(line)) depth = Math.max(0, depth - 1);
    if (depth === 0 && interlock.actuationRe.test(line)) {
      out.push({
        category: "missing-interlock",
        line: i + 1,
        message:
          `Motion/actuation command has no guarding conditional found upstream in its block — ` +
          `confirm an interlock/guard/area-clear/enable signal is present on the certified ` +
          `controller. ${ADVISORY}`,
      });
    }
    if (interlock.guardOpenRe.test(line)) depth += 1;
  });
  return out;
}

/**
 * Run the three structural safety checks for `kind` over `content`. FAIL-SAFE: an
 * unrecognised kind, malformed content, or any internal error yields `[]` — this NEVER
 * throws and NEVER blocks codegen (callers treat every finding as an advisory warning).
 */
export function lintProgramSafety(
  kind: string,
  content: string,
  limitsOverride?: Partial<SafetyLimits>,
): SafetyLintFinding[] {
  try {
    if (typeof content !== "string" || content.trim().length === 0) return [];
    const profile = profileFor(kind);
    if (!profile) return [];
    const lines = toLines(profile, content);
    const limits = resolveSafetyLimits(limitsOverride);
    return [
      ...checkUnboundedLoop(lines, profile),
      ...checkMotionEnvelope(lines, profile, limits),
      ...checkMissingInterlock(lines, profile),
    ];
  } catch {
    return []; // heuristic bug → no findings, never a crash, never a false hard-fail.
  }
}

/** Map findings to the adapter's diagnostic shape — ALWAYS "warning" (advisory, non-blocking). */
export function safetyFindingsToDiagnostics(findings: SafetyLintFinding[]): ProgDiagnostic[] {
  return findings.map((f) => ({
    severity: "warning",
    message: `[safety-lint:${f.category}] ${f.message}`,
    line: f.line,
  }));
}

/** Convenience one-shot: lint + map, ready to concat onto an adapter's own diagnostics. */
export function safetyLintDiagnostics(
  kind: string,
  content: string,
  limitsOverride?: Partial<SafetyLimits>,
): ProgDiagnostic[] {
  return safetyFindingsToDiagnostics(lintProgramSafety(kind, content, limitsOverride));
}

/** Which vendor languages carry a safety-lint profile today (test/introspection helper). */
export function safetyLintSupportedLangs(): string[] {
  return Object.keys(PROFILES);
}
