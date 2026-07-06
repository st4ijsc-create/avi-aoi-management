/**
 * Doc 09 / Phase D4 — Device Programming & Control: ROBOT (Techman) job-list adapter.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A ProgrammingAdapter for Techman TMflow robots (kind "robot-tm"). It lets an engineer
 * TEACH points + author a JOB-LIST (a portable sequence of motion verbs) in the platform,
 * validate/compile/simulate it, then (gated) push it to the robot.
 *
 * WHAT IS REAL HERE (works with no hardware):
 *   • validate() — parses POINT definitions + job steps (MOVE/MOVEL/PICK/PLACE/HOME/WAIT/
 *     GRIP/RELEASE) and checks every referenced point is defined + verbs are known.
 *   • compile()  — builds a portable job descriptor (steps + points) + checksum.
 *   • simulate() — a motion timeline (per-step duration; pick/place/grip dwell).
 *
 * WHAT IS WIRED (T-2 doc 38), STILL HW-GATED:
 *   • deploy() — routes the job to the TMflow Listen Node THROUGH the EXISTING
 *     robotCommandDispatcher (its own HITL + ROBOT_CONTROL_ENABLED + interlock gates). With
 *     the mode gate off (default) or the robot absent it records 'simulated'/'rejected'
 *     HONESTLY — never a fake success. The real TMSCT program-download verb still needs
 *     validation on a live TM controller. Fanuc/MELFA/Delta reuse this shape.
 *
 * SAFETY: authors MOTION jobs only. Collision/safety zones + E-stop stay on the robot
 * controller; this never authors safety logic.
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

// Job verbs and their default dwell/move durations (ms) for simulation.
const VERB_MS: Record<string, number> = {
  MOVE: 600, MOVEL: 700, HOME: 800, PICK: 500, PLACE: 500, GRIP: 300, RELEASE: 300, WAIT: 0,
};
const MOVE_VERBS = new Set(["MOVE", "MOVEL", "HOME"]);

interface JobStep {
  lineNo: number;
  verb: string;
  point?: string;
  waitMs?: number;
}

function parseJob(content: string): { points: Set<string>; steps: JobStep[]; diags: ProgDiagnostic[] } {
  const points = new Set<string>();
  const steps: JobStep[] = [];
  const diags: ProgDiagnostic[] = [];
  const lines = content.split(/\r?\n/);

  // First pass: collect POINT defs.  POINT P1 = (x,y,z,rx,ry,rz)
  lines.forEach((raw, i) => {
    const code = raw.replace(/'.*$/, "").trim();
    if (!code) return;
    const pm = code.match(/^POINT\s+([A-Za-z_]\w*)\s*=/i);
    if (pm) points.add(pm[1].toUpperCase());
  });

  // Second pass: parse job steps.
  lines.forEach((raw, i) => {
    const code = raw.replace(/'.*$/, "").trim();
    if (!code || /^POINT\b/i.test(code)) return;
    const vm = code.match(/^([A-Za-z]+)/);
    if (!vm) return;
    const verb = vm[1].toUpperCase();
    if (!(verb in VERB_MS)) {
      diags.push({ severity: "error", message: `Unknown job verb "${verb}".`, line: i + 1 });
      return;
    }
    const step: JobStep = { lineNo: i + 1, verb };
    if (MOVE_VERBS.has(verb) && verb !== "HOME") {
      const ptm = code.match(/\b([A-Za-z_]\w*)\b\s*$/) || code.match(/\b(P\w+)\b/i);
      const pt = ptm ? ptm[1].toUpperCase() : undefined;
      if (!pt || !points.has(pt)) {
        diags.push({ severity: "error", message: `${verb} references undefined point "${pt ?? "?"}".`, line: i + 1, symbol: pt });
      }
      step.point = pt;
    }
    if (verb === "WAIT") {
      const wm = code.match(/t\s*=\s*(\d+)/i);
      step.waitMs = wm ? Number(wm[1]) : 0;
    }
    steps.push(step);
  });

  if (steps.length === 0 && !diags.some((d) => d.severity === "error")) {
    diags.push({ severity: "warning", message: "No job steps found." });
  }
  return { points, steps, diags };
}

export class RobotTmAdapter implements ProgrammingAdapter {
  readonly kind = "robot-tm" as const;
  readonly capabilities: ProgrammingCapability = {
    canCompile: true,
    canSimulate: true,
    canDownload: true,   // via robotCommandDispatcher (gated; needs HW validation)
    canUpload: false,
    canOnlineMonitor: true,
    canForce: false,
    canTeach: true,
    languages: ["tmscript"],
  };

  async validate(src: ProgramSource): Promise<Diagnostics> {
    if (!src.content || src.content.trim().length === 0) {
      return { ok: false, diagnostics: [{ severity: "error", message: "Empty robot job." }] };
    }
    const { diags } = parseJob(src.content);
    return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const { points, steps, diags } = parseJob(src.content);
    const ok = !diags.some((d) => d.severity === "error") && steps.length > 0;
    const checksum = createHash("sha256").update(src.content).digest("hex").slice(0, 16);
    return {
      ok,
      diagnostics: diags,
      outputRef: ok ? `tm://job/${checksum}` : undefined,
      bytes: src.content.length,
      meta: { steps: steps.length, points: points.size, checksum, stepList: steps },
    };
  }

  async simulate(build: BuildResult, scenario: ProgSimScenario): Promise<ProgSimResult> {
    const steps = (build.meta?.stepList as JobStep[]) ?? [];
    const timeline: ProgSimStep[] = [];
    let t = 0;
    steps.forEach((s, i) => {
      const dur = s.verb === "WAIT" ? (s.waitMs ?? 0) : (scenario.durationMsOverride ?? VERB_MS[s.verb] ?? 400);
      timeline.push({
        index: i,
        label: `${s.verb}${s.point ? " " + s.point : ""}`,
        startMs: t,
        endMs: t + dur,
        note: MOVE_VERBS.has(s.verb) ? "motion" : s.verb.toLowerCase(),
      });
      t += dur;
    });
    return {
      ok: build.ok,
      timeline,
      warnings: steps.length === 0 ? ["No job steps to simulate."] : [],
      totalDurationMs: t,
    };
  }

  async deploy(build: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult> {
    // T-2 (doc 38) — ROUTE the job-list download through the EXISTING robotCommandDispatcher
    // (TMflow Listen-Node push). Reached ONLY after programmingService opened its gate
    // (DPC_DEPLOY_ENABLED + HITL sign-off); the dispatcher then applies its OWN symmetric
    // gates (idempotency → HITL re-verify → active/connected driver → ROBOT_CONTROL_ENABLED
    // mode gate → interlock). With ROBOT_CONTROL_ENABLED off (default) or the robot absent it
    // records 'simulated'/'rejected' HONESTLY — never a fake 'deployed'. HW validation of the
    // real TMSCT program-download verb on a TM controller is the remaining owner step.
    const robotId = opts.deviceId;
    if (!robotId) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        error: "No robotId (deviceId) bound to this project — cannot route the TMflow job download.",
      };
    }

    const { dispatchRobotJob } = await import("../../robot/robotCommandDispatcher");
    const res = await dispatchRobotJob({
      robotId,
      // The compiled job-list is pushed as a 'custom' TMflow job (Listen-Node program download).
      job: {
        jobType: "custom",
        params: {
          op: "tmflow_program_download",
          stage: opts.stage,
          outputRef: build.outputRef,
          checksum: build.meta?.checksum,
          stepList: build.meta?.stepList,
        },
      },
      triggerKind: "hitl",
      actionId: opts.hitl.actionId,
      requestedBy: opts.hitl.requestedBy,
      confirmedBy: opts.hitl.confirmedBy,
      idempotencyKey: opts.idempotencyKey,
    });

    // Map RobotDispatchResult → ProgDeployResult (honest, 1:1 with the dispatcher outcome).
    if (res.status === "simulated") {
      return {
        ok: true,
        status: "simulated",
        simulated: true,
        detail: { via: "robotCommandDispatcher", robotJobId: res.jobId, reason: "ROBOT_CONTROL_ENABLED off — dry-run (no robot write)." },
      };
    }
    if (res.status === "done") {
      return { ok: true, status: "deployed", simulated: false, detail: { via: "robotCommandDispatcher", robotJobId: res.jobId } };
    }
    // rejected (gate/no-device) → no write happened; failed → attempted but errored.
    return {
      ok: false,
      status: res.status === "rejected" ? "rejected" : "failed",
      simulated: res.status === "rejected",
      detail: { via: "robotCommandDispatcher", robotJobId: res.jobId },
      error: res.error ?? `Robot job download ${res.status}.`,
    };
  }
}
