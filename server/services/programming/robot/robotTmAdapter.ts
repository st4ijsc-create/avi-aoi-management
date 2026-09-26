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
 * WHAT IS NOT SUPPORTED (doc 81 Đợt 1B Task 4):
 *   • deploy() — there is NO TMflow program-download verb. The earlier T-2 (doc 38) wiring
 *     sent a script-less `custom` job through robotCommandDispatcher, which the Techman
 *     driver turned into `ScriptExit()`, and recorded `deployed` (BE2 §L3, T1-F). deploy()
 *     now returns `failed` + reasonCode `techman_program_download_unsupported` and sends
 *     NOTHING to the robot, until a real download path is implemented and FAT-validated.
 *
 * SAFETY: authors MOTION jobs only. Collision/safety zones + E-stop stay on the robot
 * controller; this never authors safety logic.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { safetyLintDiagnostics } from "../safetyLinter";
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

/** doc 81 Đợt 1B Task 4 — reason code recorded when a robot-tm deploy is refused (no download verb). */
export const TECHMAN_PROGRAM_DOWNLOAD_UNSUPPORTED = "techman_program_download_unsupported" as const;

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
    canDownload: false,  // doc 81 Đợt 1B Task 4 — no TMflow program-download verb (deploy ⇒ failed)
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
    // C4 (doc 69 Wave-4) — SEMANTIC safety-linter pass: structural checks (unbounded loop /
    // motion envelope / missing interlock) that fire even with no "safety" keyword present.
    // Always WARNING severity (advisory) — never affects `ok`, never blocks codegen.
    diags.push(...safetyLintDiagnostics("robot-tm", src.content));
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

  async deploy(_build: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult> {
    // doc 81 Đợt 1B Task 4 (BE2 §L3 robot-tm, T1-F) — this adapter has NO program-download
    // verb. The previous T-2 wiring pushed a `custom` job with no script through
    // robotCommandDispatcher; TechmanDriver turned that into `ScriptExit()`, the Listen Node
    // ACKed it, and the deploy was recorded `deployed` although no program ever reached the
    // robot. Until a real TMflow project-download path exists (and is FAT-validated), deploy
    // is refused HONESTLY: an EXISTING failure status (`failed`) with a stable reason code,
    // and NOTHING is sent to the robot (no dispatcher call, no socket).
    return {
      ok: false,
      status: "failed",
      simulated: false,
      detail: {
        reasonCode: TECHMAN_PROGRAM_DOWNLOAD_UNSUPPORTED,
        deviceId: opts.deviceId ?? null,
        sentToRobot: false,
      },
      error:
        `${TECHMAN_PROGRAM_DOWNLOAD_UNSUPPORTED}: Techman (robot-tm) program download is not supported — ` +
        "no TMflow program-download verb is implemented, so nothing was sent to the robot.",
    };
  }
}
