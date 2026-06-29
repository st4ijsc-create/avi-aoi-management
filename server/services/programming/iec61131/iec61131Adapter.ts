/**
 * Doc 09 / Phase D5 — Device Programming & Control: NATIVE IEC 61131-3 adapters.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Two ProgrammingAdapters that let an engineer author native PLC logic IN THE PLATFORM:
 *   • "iec61131-st" — Structured Text.
 *   • "iec61131-ld" — a textual LADDER DSL (one rung per line: `OUT := <bool expr>`).
 *
 * SAFETY (the hard rule of doc 09 §4.5): native logic is compiled to and deployed on an
 * OPEN runtime ONLY (OpenPLC / a PLCopen-XML-compatible target). It is NEVER auto-pushed
 * into a certified vendor PLC, and it NEVER authors E-stop / SIL safety logic — that stays
 * on the certified controller. deploy() is an honest framework: without a configured
 * OpenPLC host it returns a clear 'failed', never a fake success.
 *
 * WHAT IS REAL HERE (no hardware):
 *   • ST: validate (VAR/END_VAR + IF/END_IF balance, `:=` assignments), compile (normalise
 *     → openplc://st/<checksum>, a matiec-compatible ST body), simulate (honest preview —
 *     ST is not fully executed; we surface structure, not a fake run).
 *   • LD: validate (each rung `OUT := <bool expr>`; expr parses), compile (transpile rungs
 *     → ST → openplc://ld/<checksum>), simulate (a REAL ONE-SCAN boolean evaluation using
 *     scenario.assumedInputs — genuinely computes outputs, ladder scan order).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { evalBool } from "./boolEval";
import type {
  ProgrammingAdapter,
  ProgrammingCapability,
  ProgramSource,
  Diagnostics,
  ProgDiagnostic,
  BuildResult,
  ProgSimScenario,
  ProgSimResult,
  ProgSimStep,
  ProgDeployOpts,
  ProgDeployResult,
} from "../programmingAdapter";

const OPENPLC_CAPS: ProgrammingCapability = {
  canCompile: true,
  canSimulate: true,
  canDownload: true,   // to an OPEN runtime (OpenPLC) only — gated framework
  canUpload: false,
  canOnlineMonitor: true,
  canForce: true,
  canTeach: false,
  languages: [],
};

function openplcDeployGuard(opts: ProgDeployOpts): ProgDeployResult {
  // Honest: native logic deploys to an OPEN runtime only, and that runtime host is not yet
  // configured/validated. Never claim a fake 'deployed'; never target a closed vendor PLC.
  return {
    ok: false,
    status: "failed",
    simulated: false,
    error:
      `Native IEC 61131-3 deploys to an OPEN runtime only (OpenPLC). No validated OpenPLC ` +
      `host configured for endpoint "${opts.endpoint ?? "?"}". It must NEVER be pushed to a ` +
      `certified vendor PLC.`,
  };
}

// ── Structured Text adapter ──
export class Iec61131StAdapter implements ProgrammingAdapter {
  readonly kind = "iec61131-st" as const;
  readonly capabilities: ProgrammingCapability = { ...OPENPLC_CAPS, languages: ["st"] };

  async validate(src: ProgramSource): Promise<Diagnostics> {
    const diags: ProgDiagnostic[] = [];
    const c = src.content ?? "";
    if (!c.trim()) return { ok: false, diagnostics: [{ severity: "error", message: "Empty ST program." }] };
    const count = (re: RegExp) => (c.match(re) ?? []).length;
    const pairs: Array<[RegExp, RegExp, string]> = [
      [/\bVAR\b/gi, /\bEND_VAR\b/gi, "VAR/END_VAR"],
      [/\bIF\b/gi, /\bEND_IF\b/gi, "IF/END_IF"],
      [/\bFOR\b/gi, /\bEND_FOR\b/gi, "FOR/END_FOR"],
      [/\bWHILE\b/gi, /\bEND_WHILE\b/gi, "WHILE/END_WHILE"],
    ];
    for (const [o, cl, name] of pairs) {
      if (count(o) !== count(cl)) diags.push({ severity: "error", message: `Unbalanced ${name}.` });
    }
    if (!/:=/.test(c)) diags.push({ severity: "warning", message: "No assignment (`:=`) found." });
    return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const v = await this.validate(src);
    const checksum = createHash("sha256").update(src.content).digest("hex").slice(0, 16);
    const assigns = (src.content.match(/:=/g) ?? []).length;
    return {
      ok: v.ok,
      diagnostics: v.diagnostics,
      outputRef: v.ok ? `openplc://st/${checksum}` : undefined,
      bytes: src.content.length,
      meta: { assigns, checksum, target: "openplc" },
    };
  }

  async simulate(build: BuildResult, _scenario: ProgSimScenario): Promise<ProgSimResult> {
    // Honest: we do NOT fully execute ST here. Surface structure as a preview, not a run.
    const assigns = Number((build.meta?.assigns as number) ?? 0);
    const timeline: ProgSimStep[] = Array.from({ length: Math.max(1, assigns) }, (_, i) => ({
      index: i, label: `assignment ${i + 1}`, startMs: i, endMs: i + 1, note: "st-preview",
    }));
    return {
      ok: build.ok,
      timeline,
      warnings: ["ST simulation is a structural preview — full execution needs the OpenPLC runtime."],
      totalDurationMs: Math.max(1, assigns),
    };
  }

  async deploy(_b: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult> {
    return openplcDeployGuard(opts);
  }
}

// ── Ladder DSL adapter (one rung per line: OUT := <bool expr>) ──
interface Rung { lineNo: number; out: string; expr: string }

function parseLadder(content: string): { rungs: Rung[]; diags: ProgDiagnostic[] } {
  const rungs: Rung[] = [];
  const diags: ProgDiagnostic[] = [];
  content.split(/\r?\n/).forEach((raw, i) => {
    const code = raw.replace(/\(\*.*?\*\)/g, "").replace(/\/\/.*$/, "").trim();
    if (!code) return;
    const m = code.match(/^([A-Za-z_]\w*)\s*:?=\s*(.+?)\s*;?$/);
    if (!m) {
      diags.push({ severity: "error", message: `Rung must be "OUT := <bool expr>".`, line: i + 1 });
      return;
    }
    rungs.push({ lineNo: i + 1, out: m[1], expr: m[2] });
  });
  return { rungs, diags };
}

export class Iec61131LdAdapter implements ProgrammingAdapter {
  readonly kind = "iec61131-ld" as const;
  readonly capabilities: ProgrammingCapability = { ...OPENPLC_CAPS, languages: ["ld"] };

  async validate(src: ProgramSource): Promise<Diagnostics> {
    const c = src.content ?? "";
    if (!c.trim()) return { ok: false, diagnostics: [{ severity: "error", message: "Empty ladder program." }] };
    const { rungs, diags } = parseLadder(c);
    // Try to parse each rung expression (syntax check) with an empty env.
    for (const r of rungs) {
      try {
        evalBool(r.expr, {});
      } catch (e) {
        diags.push({ severity: "error", message: `Rung ${r.out}: ${(e as Error).message}`, line: r.lineNo });
      }
    }
    if (rungs.length === 0 && !diags.some((d) => d.severity === "error")) {
      diags.push({ severity: "warning", message: "No rungs parsed." });
    }
    return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const { rungs, diags } = parseLadder(src.content);
    const v = await this.validate(src);
    const ok = v.ok && rungs.length > 0;
    // Transpile rungs → ST body (matiec-compatible) for the OpenPLC target.
    const st = rungs.map((r) => `  ${r.out} := ${r.expr};`).join("\n");
    const checksum = createHash("sha256").update(src.content).digest("hex").slice(0, 16);
    return {
      ok,
      diagnostics: v.diagnostics,
      outputRef: ok ? `openplc://ld/${checksum}` : undefined,
      bytes: src.content.length,
      meta: { rungs: rungs.map((r) => ({ out: r.out, expr: r.expr })), st, checksum, target: "openplc" },
    };
  }

  async simulate(build: BuildResult, scenario: ProgSimScenario): Promise<ProgSimResult> {
    // REAL one-scan evaluation: walk rungs in order, feeding prior outputs forward.
    const rungs = (build.meta?.rungs as Array<{ out: string; expr: string }>) ?? [];
    const env: Record<string, boolean> = {};
    for (const [k, val] of Object.entries(scenario.assumedInputs ?? {})) {
      env[k] = Boolean(val);
    }
    const warnings: string[] = [];
    const timeline: ProgSimStep[] = rungs.map((r, i) => {
      let result = false;
      try {
        const ev = evalBool(r.expr, env);
        result = ev.value;
        if (ev.unknownSymbols.length) warnings.push(`Rung ${r.out}: unknown ${ev.unknownSymbols.join(",")} → false`);
      } catch (e) {
        warnings.push(`Rung ${r.out}: ${(e as Error).message}`);
      }
      env[r.out] = result; // scan-forward
      return { index: i, label: `${r.out} = ${result ? "TRUE" : "FALSE"}`, startMs: i, endMs: i + 1, note: "ladder-scan" };
    });
    return { ok: build.ok, timeline, warnings, totalDurationMs: Math.max(1, rungs.length) };
  }

  async deploy(_b: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult> {
    return openplcDeployGuard(opts);
  }
}
