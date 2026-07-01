/**
 * Doc 09 / Phase D0 — Device Programming & Control (DPC): the ProgrammingAdapter contract.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The LOGIC-tier sibling of EquipmentAdapter (which owns telemetry + scalar commands).
 * A ProgrammingAdapter knows how to validate / compile / simulate / deploy / upload a
 * device PROGRAM for one target class (Zmotion BASIC, G-code, native IEC 61131-3, robot
 * job-list, vendor engineering).
 *
 * SAFETY (non-negotiable):
 *   • validate()/compile()/simulate()/upload() are ALWAYS safe — no device write.
 *   • deploy() is the ONLY method that can reach a device, and even then the GATE lives
 *     in programmingService: the adapter's real deploy path is invoked ONLY when
 *     DPC_DEPLOY_ENABLED is on AND a human signed off (HITL). Otherwise the service
 *     records 'simulated' and never calls the adapter's hardware path.
 *   • An adapter NEVER authors or deploys safety logic (E-stop/interlock/SIL) — that
 *     stays on the certified PLC. Native IEC 61131-3 targets an OPEN runtime only.
 *
 * D0 ships ONLY the "stub" adapter (full pipeline, zero hardware). Real adapters land in
 * D2+ (zmotion-basic, mitsubishi-engineering, robot-tm, iec61131-*). Fail-safe: an unknown
 * kind → clear Error; a not-yet-implemented kind → a typed "unsupported" Error.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { ZmotionBasicAdapter } from "./zmotion/zmotionBasicAdapter";
import { MitsubishiEngineeringAdapter } from "./mitsubishi/mitsubishiEngineeringAdapter";
import { RobotTmAdapter } from "./robot/robotTmAdapter";
import { Iec61131StAdapter, Iec61131LdAdapter } from "./iec61131/iec61131Adapter";
import { IrProgrammingAdapter } from "./ir/irAdapter";

/** Target classes the DPC tier can address (1:1 onto programmingKindEnum). */
export type ProgrammingKind =
  | "stub"
  | "zmotion-basic"
  | "gcode"
  | "mitsubishi-engineering"
  | "robot-tm"
  | "iec61131-st"
  | "iec61131-ld"
  | "ir-flow";

/**
 * All target classes (1:1 onto programmingKindEnum). U4b: DERIVED from the registry
 * seed below so the array stays in lock-step with what is registered. `gcode` has NO
 * factory registered (it is a planned kind) yet is still an addressable enum value —
 * hence it is listed here explicitly alongside the registered kinds.
 */
export const PROGRAMMING_KINDS: ProgrammingKind[] = [
  "stub",
  "zmotion-basic",
  "gcode",
  "mitsubishi-engineering",
  "robot-tm",
  "iec61131-st",
  "iec61131-ld",
  "ir-flow",
];

/** What an adapter can do (drives UI affordances + service guards). */
export interface ProgrammingCapability {
  canCompile: boolean;
  canSimulate: boolean;
  canDownload: boolean;     // push a build to the device
  canUpload: boolean;       // read a program back from the device
  canOnlineMonitor: boolean;
  canForce: boolean;        // override a symbol value while online (heavily gated)
  canTeach: boolean;        // robot teach/jog
  languages: string[];      // concrete language tokens this adapter accepts
}

/** One diagnostic from validate()/compile(). */
export interface ProgDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  col?: number;
  symbol?: string;
}

export interface Diagnostics {
  ok: boolean;              // false if any severity === 'error'
  diagnostics: ProgDiagnostic[];
}

/** The source a project/artifact carries into an adapter. */
export interface ProgramSource {
  kind: ProgrammingKind;
  language: string;
  content: string;
  /** Optional declared symbols (variable/tag table). */
  symbols?: Array<{ name: string; address?: string; dataType?: string }>;
}

/** Result of compile() — a transferable output + diagnostics (NO device I/O). */
export interface BuildResult {
  ok: boolean;
  diagnostics: ProgDiagnostic[];
  /** Ref/path to the compiled output (bytecode/PLCopen-XML/job-list), if any. */
  outputRef?: string;
  bytes?: number;
  meta?: Record<string, unknown>;
}

/** A what-if scenario for simulate() (assumed inputs/duration overrides). */
export interface ProgSimScenario {
  assumedInputs?: Record<string, unknown>;
  durationMsOverride?: number;
  [k: string]: unknown;
}

export interface ProgSimStep {
  index: number;
  label: string;
  startMs: number;
  endMs: number;
  note?: string;
}

/** Result of simulate() — a predicted timeline (pure; no device I/O). */
export interface ProgSimResult {
  ok: boolean;
  timeline: ProgSimStep[];
  warnings: string[];
  totalDurationMs: number;
}

/** HITL provenance for a deploy (the human who confirmed). */
export interface ProgHitl {
  actionId: string;
  requestedBy: number;
  confirmedBy?: number;
}

export interface ProgDeployOpts {
  stage: "staging" | "production";
  idempotencyKey: string;
  hitl: ProgHitl;
  deviceId?: number;
  endpoint?: string;
}

/** Result of a deploy attempt (whether simulated or real). */
export interface ProgDeployResult {
  ok: boolean;
  status: "simulated" | "deployed" | "verified" | "failed" | "rejected";
  simulated: boolean;
  detail?: Record<string, unknown>;
  error?: string;
}

/** The UNIFIED programming contract. Every target class implements this. */
export interface ProgrammingAdapter {
  readonly kind: ProgrammingKind;
  readonly capabilities: ProgrammingCapability;
  /** Lint/parse the source. NEVER touches hardware. */
  validate(src: ProgramSource): Promise<Diagnostics>;
  /** Compile to a transferable output. NEVER touches hardware. */
  compile(src: ProgramSource): Promise<BuildResult>;
  /** Predict execution on a twin/emulator. NEVER touches hardware. */
  simulate?(build: BuildResult, scenario: ProgSimScenario): Promise<ProgSimResult>;
  /**
   * Real device deploy. SAFETY: programmingService calls this ONLY when
   * DPC_DEPLOY_ENABLED is on AND a human signed off; otherwise the service records
   * 'simulated' and never reaches this method.
   */
  deploy(build: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult>;
  /** Read a program back from the device (optional). */
  upload?(target: { deviceId?: number; endpoint?: string }): Promise<ProgramSource>;
}

// ── A simple, safe heuristic validator/compiler shared by D0's stub adapter. ──
function lint(src: ProgramSource): ProgDiagnostic[] {
  const diags: ProgDiagnostic[] = [];
  if (!src.content || src.content.trim().length === 0) {
    diags.push({ severity: "error", message: "Empty program — nothing to build." });
  }
  // Cheap balance check that generalises across line-based languages.
  const opens = (src.content.match(/\b(IF|FOR|WHILE|SUB|FUNCTION)\b/gi) ?? []).length;
  const closes = (src.content.match(/\b(ENDIF|END IF|NEXT|WEND|ENDSUB|END SUB|ENDFUNCTION|END FUNCTION)\b/gi) ?? []).length;
  if (opens > 0 && closes > 0 && opens !== closes) {
    diags.push({ severity: "warning", message: `Block keywords look unbalanced (${opens} open / ${closes} close).` });
  }
  return diags;
}

/**
 * The D0 "stub" adapter — a fully working pipeline with ZERO hardware. It validates
 * with a cheap heuristic, "compiles" to a content-addressed pseudo-output, simulates a
 * line-by-line timeline, and ALWAYS reports deploy as 'simulated' (it has no device
 * path at all). It is the safe default that lets the whole service + UI be built and
 * tested before any real adapter exists.
 */
export class StubProgrammingAdapter implements ProgrammingAdapter {
  readonly kind: ProgrammingKind = "stub";
  readonly capabilities: ProgrammingCapability = {
    canCompile: true,
    canSimulate: true,
    canDownload: false,
    canUpload: false,
    canOnlineMonitor: false,
    canForce: false,
    canTeach: false,
    languages: ["text", "basic", "st", "gcode"],
  };

  async validate(src: ProgramSource): Promise<Diagnostics> {
    const diagnostics = lint(src);
    return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const diagnostics = lint(src);
    const ok = !diagnostics.some((d) => d.severity === "error");
    const lines = src.content ? src.content.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0;
    return {
      ok,
      diagnostics,
      outputRef: ok ? `stub://build/${lines}-lines` : undefined,
      bytes: src.content ? src.content.length : 0,
      meta: { lines, language: src.language },
    };
  }

  async simulate(build: BuildResult, scenario: ProgSimScenario): Promise<ProgSimResult> {
    const lines = Number((build.meta?.lines as number) ?? 0);
    const per = scenario.durationMsOverride ?? 100;
    const timeline: ProgSimStep[] = [];
    for (let i = 0; i < Math.max(1, lines); i++) {
      timeline.push({ index: i, label: `line ${i + 1}`, startMs: i * per, endMs: (i + 1) * per });
    }
    return {
      ok: build.ok,
      timeline,
      warnings: build.ok ? [] : ["Build was not ok — simulation is best-effort."],
      totalDurationMs: Math.max(1, lines) * per,
    };
  }

  async deploy(_build: BuildResult, _opts: ProgDeployOpts): Promise<ProgDeployResult> {
    // The stub has NO device path. Even if invoked, it is always a no-op simulation.
    return {
      ok: true,
      status: "simulated",
      simulated: true,
      detail: { note: "stub adapter has no device path; nothing was written" },
    };
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * U4b (doc 21 §6 / G-8) — DATA-DRIVEN programming-adapter registry (mirrors
 * ot/driverRegistry + equipmentRegistry). A `Map<kind, factory>` +
 * `registerProgrammingAdapter(kind, factory)` replaces the `build()` switch. Every
 * IMPLEMENTED kind seeds itself at module load (below), so resolution is IDENTICAL —
 * behaviour-preserving. A planned kind (e.g. `gcode`) stays in `PROGRAMMING_KINDS`
 * with NO factory registered → resolves to the same honest "not yet implemented"
 * error as before. A new kind is now ONE `registerProgrammingAdapter(...)` call.
 *
 * The `ProgrammingKind` union is retained for compile-time exhaustiveness.
 * ════════════════════════════════════════════════════════════════════════════
 */
export type ProgrammingAdapterFactory = () => ProgrammingAdapter;

const adapterFactories = new Map<ProgrammingKind, ProgrammingAdapterFactory>();
const adapterCache = new Map<ProgrammingKind, ProgrammingAdapter>();

/**
 * Register (or override) the factory for a programming kind. Register-and-go: a new
 * target class needs only this call (+ the `programmingKindEnum` DB value). Overriding
 * clears the memoised instance so the next `getAdapter` rebuilds.
 */
export function registerProgrammingAdapter(kind: ProgrammingKind, factory: ProgrammingAdapterFactory): void {
  adapterFactories.set(kind, factory);
  adapterCache.delete(kind);
}

// ── Seed every IMPLEMENTED kind (parity with the old switch). `gcode` is a PLANNED
//    kind — intentionally NOT registered, so it resolves to "not yet implemented". ──
registerProgrammingAdapter("stub", () => new StubProgrammingAdapter());
registerProgrammingAdapter("zmotion-basic", () => new ZmotionBasicAdapter());
registerProgrammingAdapter("mitsubishi-engineering", () => new MitsubishiEngineeringAdapter());
registerProgrammingAdapter("robot-tm", () => new RobotTmAdapter());
registerProgrammingAdapter("iec61131-st", () => new Iec61131StAdapter());
registerProgrammingAdapter("iec61131-ld", () => new Iec61131LdAdapter());
registerProgrammingAdapter("ir-flow", () => new IrProgrammingAdapter());

export const programmingRegistry = {
  /** Resolve (memoised) the adapter for a kind. Throws for unknown/unsupported kinds. */
  getAdapter(kind: ProgrammingKind): ProgrammingAdapter {
    // A kind is addressable if it is registered (register-and-go) OR a known enum
    // value in PROGRAMMING_KINDS (a planned kind → "not yet implemented"). Anything
    // else is genuinely unknown.
    if (!adapterFactories.has(kind) && !PROGRAMMING_KINDS.includes(kind)) {
      throw new Error(`Unknown programming adapter kind "${kind}".`);
    }
    let a = adapterCache.get(kind);
    if (!a) {
      const factory = adapterFactories.get(kind);
      if (!factory) {
        // A known enum value with no registered factory = a planned kind (e.g. gcode).
        throw new Error(`Programming adapter "${kind}" is not yet implemented (lands in a later DPC phase).`);
      }
      a = factory();
      adapterCache.set(kind, a);
    }
    return a;
  },

  /** Whether a kind has a working adapter today (vs. a planned one). */
  isImplemented(kind: ProgrammingKind): boolean {
    try {
      this.getAdapter(kind);
      return true;
    } catch {
      return false;
    }
  },

  /** List every kind + its capabilities (implemented ones only carry real caps). */
  listAdapters(): Array<{ kind: ProgrammingKind; implemented: boolean; capabilities?: ProgrammingCapability }> {
    return PROGRAMMING_KINDS.map((kind) => {
      try {
        const a = this.getAdapter(kind);
        return { kind, implemented: true, capabilities: a.capabilities };
      } catch {
        return { kind, implemented: false };
      }
    });
  },

  /** Every kind with a registered factory (register-and-go view). */
  listRegisteredKinds(): ProgrammingKind[] {
    return [...adapterFactories.keys()];
  },

  /** Test-only: clear the memoised adapters (registrations survive). */
  _clear(): void {
    adapterCache.clear();
  },
};
