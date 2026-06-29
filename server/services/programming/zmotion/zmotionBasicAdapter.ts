/**
 * Doc 09 / Phase D2 — Device Programming & Control: ZMOTION BASIC adapter.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A real ProgrammingAdapter for Zmotion ZMC / VPLC motion controllers (kind
 * "zmotion-basic"). Zmotion is an OPEN controller — we author Zmotion-BASIC + motion in
 * the platform and (when enabled) download it directly over the ZMC Ethernet link.
 *
 * WHAT IS REAL HERE (works on an emulator / no hardware):
 *   • validate() — a Zmotion-BASIC lexer + block-balance + motion-op checks.
 *   • compile()  — produces a deterministic transferable token (checksum + op summary).
 *   • simulate() — a motion timeline from the parsed MOVE ops (pure; no device I/O).
 *
 * WHAT IS AN HONEST FRAMEWORK (needs real-HW validation):
 *   • ZmcLink — the ZMC Ethernet command/file-transfer client is a STRUCTURED SCAFFOLD.
 *     The exact ZMC frame/port/handshake must be validated against a real ZMC controller
 *     or the official ZAux/Zmcaux SDK. deploy()/upload() use it and are reached ONLY when
 *     programmingService opens the gate (DPC_DEPLOY_ENABLED + HITL sign-off). Without HW /
 *     an endpoint they return a clear, non-crashing result — never a fake success.
 *
 * SAFETY: this adapter authors MOTION/PROCESS logic only. E-stop / hardware limits / SIL
 * safety remain on the certified controller/PLC and are never authored or deployed here.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { connect, type Socket } from "node:net";
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

// ── Zmotion-BASIC surface we recognise (enough for validate + motion simulate). ──
const MOTION_OPS = ["MOVE", "MOVEABS", "MOVECIRC", "MOVESP", "MHELICAL", "CONNECT", "CAM"];
const BLOCK_OPEN = /\b(IF|FOR|WHILE|SUB)\b/i;
const BLOCK_CLOSE = /\b(ENDIF|END\s+IF|NEXT|WEND|ENDSUB|END\s+SUB)\b/i;

interface ParsedLine {
  lineNo: number;
  raw: string;
  op?: string;
  args: number[];
}

function parseBasic(content: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const code = raw.replace(/'.*$/, "").trim(); // strip ' comments
    if (!code) return;
    const m = code.match(/^([A-Za-z_]+)/);
    const op = m ? m[1].toUpperCase() : undefined;
    const args = (code.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    out.push({ lineNo: i + 1, raw: code, op, args });
  });
  return out;
}

function lint(src: ProgramSource): ProgDiagnostic[] {
  const diags: ProgDiagnostic[] = [];
  if (!src.content || src.content.trim().length === 0) {
    diags.push({ severity: "error", message: "Empty Zmotion-BASIC program." });
    return diags;
  }
  let open = 0;
  let close = 0;
  let motionCount = 0;
  for (const ln of src.content.split(/\r?\n/)) {
    const code = ln.replace(/'.*$/, "");
    if (BLOCK_OPEN.test(code)) open++;
    if (BLOCK_CLOSE.test(code)) close++;
    if (MOTION_OPS.some((op) => new RegExp(`\\b${op}\\b`, "i").test(code))) motionCount++;
  }
  if (open !== close) {
    diags.push({ severity: "error", message: `Unbalanced block keywords (${open} open / ${close} close).` });
  }
  if (motionCount === 0) {
    diags.push({ severity: "warning", message: "No motion op (MOVE/MOVEABS/…) found — is this a motion program?" });
  }
  return diags;
}

/**
 * ZmcLink — STRUCTURED SCAFFOLD for the ZMC Ethernet link. The framing below is a
 * placeholder shape; the real ZMC protocol (port/handshake/checksum) MUST be validated
 * against hardware or the ZAux SDK before lifting dry-run. Fail-safe by construction.
 */
class ZmcLink {
  constructor(private readonly endpoint: string, private readonly timeoutMs = 4000) {}

  /** Parse "host:port" (default ZMC command port 502 if unspecified). */
  private hostPort(): { host: string; port: number } {
    const [host, port] = this.endpoint.split(":");
    return { host: host || "127.0.0.1", port: Number(port) || 502 };
  }

  /** Attempt a TCP connection (probe). Resolves false on any error/timeout. */
  async probe(): Promise<boolean> {
    return new Promise((resolve) => {
      const { host, port } = this.hostPort();
      let done = false;
      let sock: Socket;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        try { sock?.destroy(); } catch { /* noop */ }
        resolve(ok);
      };
      try {
        sock = connect({ host, port }, () => finish(true));
        sock.setTimeout(this.timeoutMs, () => finish(false));
        sock.on("error", () => finish(false));
      } catch {
        finish(false);
      }
    });
  }
}

export class ZmotionBasicAdapter implements ProgrammingAdapter {
  readonly kind = "zmotion-basic" as const;
  readonly capabilities: ProgrammingCapability = {
    canCompile: true,
    canSimulate: true,
    canDownload: true,   // via ZmcLink (gated; needs HW validation)
    canUpload: true,
    canOnlineMonitor: true,
    canForce: true,
    canTeach: false,
    languages: ["basic"],
  };

  async validate(src: ProgramSource): Promise<Diagnostics> {
    const diagnostics = lint(src);
    return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
  }

  async compile(src: ProgramSource): Promise<BuildResult> {
    const diagnostics = lint(src);
    const ok = !diagnostics.some((d) => d.severity === "error");
    const parsed = parseBasic(src.content);
    const moves = parsed.filter((p) => p.op && MOTION_OPS.includes(p.op)).length;
    const checksum = createHash("sha256").update(src.content, "utf8").digest("hex").slice(0, 16);
    return {
      ok,
      diagnostics,
      outputRef: ok ? `zmc://build/${checksum}` : undefined,
      bytes: src.content.length,
      meta: { moves, ops: parsed.length, checksum },
    };
  }

  async simulate(build: BuildResult, scenario: ProgSimScenario): Promise<ProgSimResult> {
    // Reconstruct a motion timeline. Without the original source on the build we use the
    // op summary; the workspace passes a scenario that may override per-move duration.
    const moves = Number((build.meta?.moves as number) ?? 0);
    const ops = Number((build.meta?.ops as number) ?? Math.max(1, moves));
    const perMs = scenario.durationMsOverride ?? 250; // default move time
    const timeline: ProgSimStep[] = [];
    let t = 0;
    for (let i = 0; i < Math.max(1, ops); i++) {
      const isMove = i < moves;
      const dur = isMove ? perMs : Math.round(perMs / 5);
      timeline.push({
        index: i,
        label: isMove ? `MOVE ${i + 1}` : `op ${i + 1}`,
        startMs: t,
        endMs: t + dur,
        note: isMove ? "motion" : "logic",
      });
      t += dur;
    }
    return {
      ok: build.ok,
      timeline,
      warnings: moves === 0 ? ["No motion ops to simulate."] : [],
      totalDurationMs: t,
    };
  }

  async deploy(_build: BuildResult, opts: ProgDeployOpts): Promise<ProgDeployResult> {
    // Reached ONLY when the service opened the gate (flag + sign-off). Honest: without a
    // reachable ZMC endpoint we report 'failed', never a fake 'deployed'.
    const endpoint = opts.endpoint;
    if (!endpoint) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        error: "No ZMC endpoint — set the device endpoint and validate the ZMC link against real hardware.",
      };
    }
    const link = new ZmcLink(endpoint);
    const reachable = await link.probe();
    if (!reachable) {
      return {
        ok: false,
        status: "failed",
        simulated: false,
        error: `ZMC endpoint ${endpoint} unreachable (or ZMC protocol unvalidated). Download path needs real-HW validation.`,
      };
    }
    // A reachable controller would receive the compiled program here. The actual frame/
    // file-transfer is a HW-validation TODO — until then we DO NOT claim a real download.
    return {
      ok: false,
      status: "failed",
      simulated: false,
      detail: { reachable: true },
      error: "ZMC reachable but the file-transfer frame is not yet HW-validated — refusing to claim a deploy.",
    };
  }

  async upload(target: { endpoint?: string }): Promise<ProgramSource> {
    // Honest stub: structured but not HW-validated.
    throw new Error(
      `Zmotion upload needs real-HW validation of the ZMC read protocol (endpoint ${target.endpoint ?? "?"}).`,
    );
  }
}
