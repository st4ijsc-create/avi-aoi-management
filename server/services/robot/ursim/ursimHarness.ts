/**
 * Doc 20 §3/§5 (I3a-1) — URSim end-to-end VALIDATION HARNESS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * `validateUrscriptOnUrsim(urscript, endpoint)` is the strongest end-to-end proof for
 * Khối 6: it takes the EXACT URScript the D1 transpiler produced (IR → lint → transpile
 * → simulation-gate → this text) and deploys it to a REAL (virtual) UR controller in
 * URSim, then polls the controller for whether it accepted + is running the program.
 *
 *   IR flow ──lint──▶ transpileToUrscript ──▶ URScript TEXT ──▶ validateUrscriptOnUrsim
 *                                                                      │
 *                                              net → primary 30001 (send program)
 *                                              net → dashboard 29999 (play + poll state)
 *
 * The returned { sent, accepted, running, robotMode, programState, error? } closes the
 * loop: `sent` proves the transport worked, `accepted`+`running` prove the controller
 * COMPILED and STARTED our transpiled code (a syntactically-broken transpile would be
 * rejected by the real UR runtime and `running` would stay false) — validating the whole
 * chain on a real controller without a physical arm.
 *
 * HONEST: no URSim running → connect rejects → { sent:false, accepted:false, running:false,
 * error } with the clear reason. Never a fabricated success.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { UrsimClient, type UrsimEndpoint } from "./ursimClient";

export interface UrsimValidationResult {
  /** The URScript reached the controller over the primary/secondary socket. */
  sent: boolean;
  /** The controller powered on + started (robotmode RUNNING / program PLAYING). */
  accepted: boolean;
  /** A program is currently executing on the controller. */
  running: boolean;
  robotMode?: string;
  programState?: string;
  /** Present ⇔ something failed (unreachable / power / send). Honest, never faked. */
  error?: string;
  /** How long the harness spent (ms). */
  elapsedMs: number;
}

export interface UrsimValidationOptions {
  /** Power the arm on + release brakes before sending (URSim starts POWER_OFF). Default true. */
  powerOn?: boolean;
  /** Poll interval (ms) for programState after send. Default 300. */
  pollIntervalMs?: number;
  /** Max time (ms) to wait for the program to reach a running state. Default 3000. */
  runWaitMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms).unref?.());
}

/**
 * Deploy `urscript` to a URSim controller and report execution state. Pure validation —
 * this is the harness the tRPC mutation + the deploy adapter both use. Never throws:
 * any failure is captured in `error` with sent/accepted/running honest booleans.
 */
export async function validateUrscriptOnUrsim(
  urscript: string,
  endpoint: UrsimEndpoint,
  opts: UrsimValidationOptions = {},
): Promise<UrsimValidationResult> {
  const t0 = Date.now();
  const powerOn = opts.powerOn ?? true;
  const pollIntervalMs = Math.max(50, opts.pollIntervalMs ?? 300);
  const runWaitMs = Math.max(pollIntervalMs, opts.runWaitMs ?? 3000);
  const client = new UrsimClient(endpoint);

  const done = (r: Omit<UrsimValidationResult, "elapsedMs">): UrsimValidationResult => ({
    ...r,
    elapsedMs: Date.now() - t0,
  });

  // 0) Honest reachability probe up front — a clear error beats a mysterious socket throw.
  const probe = await client.ping();
  if (!probe.reachable) {
    return done({ sent: false, accepted: false, running: false, error: probe.error ?? "URSim unreachable" });
  }

  try {
    // 1) Power the (virtual) arm on so a sent program can actually run.
    if (powerOn) {
      try {
        await client.powerOn();
      } catch (err) {
        return done({ sent: false, accepted: false, running: false, error: `power on failed: ${(err as Error)?.message ?? err}` });
      }
    }

    // 2) Send the transpiled URScript over the primary/secondary socket.
    let sent = false;
    try {
      const res = await client.sendScript(urscript);
      sent = res.sent;
    } catch (err) {
      return done({ sent: false, accepted: false, running: false, error: `sendScript failed: ${(err as Error)?.message ?? err}` });
    }

    // 3) Poll robotmode + programState until running or the wait budget elapses. A real UR
    //    controller that REJECTED our script (bad transpile) never enters PLAYING/RUNNING.
    let robotMode: string | undefined;
    let programState: string | undefined;
    let running = false;
    const deadline = Date.now() + runWaitMs;
    do {
      try {
        robotMode = await client.robotMode();
        programState = await client.programState();
        running = await client.isProgramRunning();
      } catch (err) {
        return done({ sent, accepted: false, running: false, robotMode, programState, error: `state poll failed: ${(err as Error)?.message ?? err}` });
      }
      if (running) break;
      if (Date.now() >= deadline) break;
      await sleep(pollIntervalMs);
    } while (Date.now() < deadline);

    const accepted = running || /RUNNING/i.test(robotMode ?? "") || /PLAYING/i.test(programState ?? "");
    return done({ sent, accepted, running, robotMode, programState });
  } catch (err) {
    return done({ sent: false, accepted: false, running: false, error: (err as Error)?.message ?? String(err) });
  }
}

/** Flag read at runtime (default OFF). */
export function ursimEnabled(): boolean {
  return process.env.URSIM_ENABLED === "true" || process.env.URSIM_ENABLED === "1";
}

/** Resolve the configured default URSim endpoint from env (host/ports). */
export function ursimEndpointFromEnv(): UrsimEndpoint | null {
  const host = process.env.URSIM_HOST?.trim();
  if (!host) return null;
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    host,
    scriptPort: num(process.env.URSIM_PRIMARY_PORT, 30001),
    dashboardPort: num(process.env.URSIM_DASHBOARD_PORT, 29999),
    timeoutMs: num(process.env.URSIM_TIMEOUT_MS, 5000),
  };
}
