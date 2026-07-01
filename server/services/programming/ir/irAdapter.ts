/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) — IR-FLOW ProgrammingAdapter.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The IR programming layer plugs into the EXISTING programmingService pipeline as a new
 * program KIND, "ir-flow": the artifact's `content` (TEXT) holds the IR Flow as JSON.
 * This adapter implements the SAME ProgrammingAdapter contract as the iec61131 / zmotion
 * / robot adapters — so an IR flow gets the identical validate → compile → simulate →
 * (HITL) → gated deploy path. It opens NO new gate.
 *
 *   • validate()  = shape-validate the IR JSON + run the SEMANTIC safety linter. Linter
 *                   errors are surfaced as diagnostics → ok:false (blocks build/deploy).
 *   • compile()   = the HARD GATE: lint, then transpile to the target native (URScript /
 *                   ROS2). Linter errors BLOCK codegen (no code produced). The compiled
 *                   native code + irCommentMap are carried in BuildResult.meta.
 *   • simulate()  = an HONEST structural preview (block timeline). Full PHYSICS simulation
 *                   (collisions / joint limits / cycle time) is T2, NOT this phase — the
 *                   real Simulation Gate seam is programmingService.simulateBuild, which
 *                   hands off to the existing simulator. We do not fake a physics run.
 *   • deploy()    = has NO device path (like the stub). Even if reached it is a no-op
 *                   'simulated'. A real IR deploy still routes through the gated service.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
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
import { parseFlowJson, countBlocks, assignIds, walkBlocks, type Flow, type IrBlock } from "./irModel";
import { lintFlow, type LintDiagnostic } from "./irSafetyLinter";
import { transpileFlow, defaultTargetFor, type TranspileTarget } from "./transpilers/registry";
import { simKinematicEnabled, runGateForFlow, type SimScene, type SimGateResult } from "../sim/kinematicSimGate";
import { EMPTY_SCENE } from "../sim/sceneAdapter";

const IR_CAPS: ProgrammingCapability = {
  canCompile: true,
  canSimulate: true,
  canDownload: false, // no device path in D1 — deploy stays gated + simulated.
  canUpload: false,
  canOnlineMonitor: false,
  canForce: false,
  canTeach: false,
  languages: ["ir-json"],
};

/** Map a linter diagnostic → the shared ProgDiagnostic shape (severity 'warn' → 'warning'). */
function toProgDiagnostic(d: LintDiagnostic): ProgDiagnostic {
  return {
    severity: d.severity === "error" ? "error" : "warning",
    message: `[${d.rule}] block ${d.blockId}: ${d.message}`,
    symbol: d.blockId,
  };
}

export class IrProgrammingAdapter implements ProgrammingAdapter {
  readonly kind = "ir-flow" as const;
  readonly capabilities: ProgrammingCapability = IR_CAPS;

  private parse(src: ProgramSource):
    | { ok: true; flow: Flow }
    | { ok: false; diags: ProgDiagnostic[] } {
    const content = src.content ?? "";
    if (!content.trim()) {
      return { ok: false, diags: [{ severity: "error", message: "Empty IR flow — nothing to build." }] };
    }
    const parsed = parseFlowJson(content);
    if (!parsed.ok) {
      return {
        ok: false,
        diags: parsed.errors.map((e) => ({ severity: "error" as const, message: `IR shape error at "${e.path || "<root>"}": ${e.message}` })),
      };
    }
    return { ok: true, flow: parsed.flow };
  }

  async validate(src: ProgramSource): Promise<Diagnostics> {
    const p = this.parse(src);
    if (!p.ok) return { ok: false, diagnostics: p.diags };
    const lint = lintFlow(p.flow);
    const diagnostics = lint.diagnostics.map(toProgDiagnostic);
    return { ok: lint.ok, diagnostics };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const p = this.parse(src);
    if (!p.ok) {
      return { ok: false, diagnostics: p.diags, bytes: (src.content ?? "").length };
    }
    const flow = p.flow;
    const target = defaultTargetFor(flow.target_device_type);
    // The HARD GATE lives here: transpileFlow lints first; errors block codegen.
    const result = transpileFlow(flow, target);
    const diagnostics = result.diagnostics.map(toProgDiagnostic);
    if (!result.ok) {
      // Linter blocked transpile — a non-ok build, no code emitted.
      return { ok: false, diagnostics, bytes: (src.content ?? "").length, meta: { target, blocked: true } };
    }
    const checksum = createHash("sha256").update(result.code!).digest("hex").slice(0, 16);
    return {
      ok: true,
      diagnostics,
      outputRef: `ir://${target}/${checksum}`,
      bytes: result.code!.length,
      meta: {
        target,
        code: result.code,
        irCommentMap: result.irCommentMap,
        blocks: countBlocks(flow),
        flowId: flow.flow_id,
        // Carry the parsed flow so simulate() can run the kinematic gate (T2b) without
        // re-fetching the artifact. Kept small — it is the same JSON the build was made from.
        flow,
        targetDeviceType: flow.target_device_type,
        checksum,
      },
    };
  }

  async simulate(build: BuildResult, scenario: ProgSimScenario): Promise<ProgSimResult> {
    const flowId = String(build.meta?.flowId ?? "");
    const total = Number(build.meta?.blocks ?? 0);

    // ── T2b KINEMATIC SIMULATION GATE (flag-gated) ────────────────────────────
    // When SIM_KINEMATIC_ENABLED is on AND the build carries the parsed flow, run the
    // REAL kinematic gate (FK + collision + joint-limit + workspace + safety-zone +
    // cycle-time). When off — or the flow/model is unavailable — fall back to the honest
    // structural preview below. Deploy stays gated separately (unchanged).
    if (simKinematicEnabled() && build.meta?.flow) {
      const flow = build.meta.flow as Flow;
      // Scenario may supply a scene (obstacles + safety zones from the T1 scene graph via
      // sceneFromGraph). Absent → EMPTY_SCENE (still checks joint-limit + workspace).
      const scene = ((scenario as { scene?: SimScene }).scene) ?? EMPTY_SCENE;
      const gate: SimGateResult = runGateForFlow(flow, scene, {
        selfCollision: (scenario as { selfCollision?: boolean }).selfCollision,
      });
      return this.gateToSimResult(build, flowId, gate);
    }

    // HONEST structural preview — a per-block timeline, NOT a physics run. This is the
    // fallback when the kinematic gate is OFF (default) — today's D1 behavior, unchanged.
    const timeline: ProgSimStep[] = Array.from({ length: Math.max(1, total) }, (_, i) => ({
      index: i,
      label: `block ${i + 1}`,
      startMs: i,
      endMs: i + 1,
      note: "ir-structural-preview",
    }));
    return {
      ok: build.ok,
      timeline,
      warnings: [
        `IR simulation for "${flowId}" is a STRUCTURAL preview (block order). ` +
          `Full physics simulation (collision / joint-limit / cycle-time) is the T2 Simulation Gate ` +
          `(SIM_KINEMATIC_ENABLED, off by default).`,
      ],
      totalDurationMs: Math.max(1, total),
    };
  }

  /**
   * Map the T2b SimGateResult onto the shared ProgSimResult shape. The gate is the source
   * of `ok`: a program that collides / exceeds a joint limit / intrudes a safety zone is
   * NOT ok (it FAILS the gate → cannot proceed). The full gate contract is carried in
   * warnings + a machine-readable field on the timeline note for callers that want it.
   */
  private gateToSimResult(build: BuildResult, flowId: string, gate: SimGateResult): ProgSimResult {
    const cycleMs = Math.round(gate.cycle_time_actual * 1000);
    const timeline: ProgSimStep[] = [
      { index: 0, label: `kinematic sim (${gate.waypointsChecked} waypoints)`, startMs: 0, endMs: Math.max(1, cycleMs), note: "ir-kinematic-simgate" },
    ];
    const warnings: string[] = [];
    if (!gate.pass) {
      if (gate.collision_events.length) warnings.push(`COLLISION: ${gate.collision_events.length} event(s) — e.g. ${gate.collision_events[0].linkA} vs ${gate.collision_events[0].linkB} (sep ${gate.collision_events[0].distance.toFixed(1)}mm).`);
      if (gate.joint_limit_violations.length) warnings.push(`JOINT-LIMIT: ${gate.joint_limit_violations.length} violation(s) — e.g. ${gate.joint_limit_violations[0].joint}.`);
      if (gate.safety_zone_violations.length) warnings.push(`SAFETY-ZONE: ${gate.safety_zone_violations.length} intrusion(s) — e.g. link ${gate.safety_zone_violations[0].link} in ${gate.safety_zone_violations[0].zoneId}.`);
    }
    if (gate.note) warnings.push(gate.note);
    return {
      ok: build.ok && gate.pass,
      timeline,
      warnings,
      totalDurationMs: Math.max(1, cycleMs),
      // Attach the exact Simulation-Gate contract for callers/persistence (extra field —
      // ProgSimResult is structurally typed; consumers that don't read it are unaffected).
      ...( { simGate: gate } as Record<string, unknown> ),
    };
  }

  async deploy(_build: BuildResult, _opts: ProgDeployOpts): Promise<ProgDeployResult> {
    // No device path in D1 (like the stub). The gated service records 'simulated'.
    return {
      ok: true,
      status: "simulated",
      simulated: true,
      detail: { note: "IR adapter (D1) has no device path; deploy is always simulated. Real push routes through the gated service in a later phase." },
    };
  }
}

/**
 * PREVIEW helper for the router's transpile-preview procedure: lint + (if clean)
 * transpile a Flow to a chosen target, returning code + diagnostics + irCommentMap. PURE
 * — no persistence, no device I/O.
 */
export function previewTranspile(flow: Flow, target?: TranspileTarget): {
  ok: boolean;
  target: TranspileTarget;
  code: string | null;
  diagnostics: LintDiagnostic[];
  irCommentMap: Record<string, string>;
} {
  const res = transpileFlow(flow, target);
  return {
    ok: res.ok,
    target: res.target,
    code: res.code ?? null,
    diagnostics: res.diagnostics,
    irCommentMap: res.irCommentMap ?? {},
  };
}

/** Summarise a flow for a list view (block count + types) without shipping the whole AST. */
export function summariseFlow(flow: Flow): { flowId: string; targetDeviceType: string; version: number; blockCount: number; blockTypes: string[] } {
  const idFlow = assignIds(flow);
  const types = new Set<string>();
  walkBlocks(idFlow.blocks, (b: IrBlock) => types.add(b.type));
  return {
    flowId: idFlow.flow_id,
    targetDeviceType: idFlow.target_device_type,
    version: idFlow.version,
    blockCount: countBlocks(idFlow),
    blockTypes: [...types].sort(),
  };
}
