/**
 * Doc 20 §3/§5 (I3a-1) — URSim deploy + validation client (Universal Robots).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A pure-Node (`net.Socket`, no dep) client for a Universal Robots controller — REAL
 * (in URSim) or physical. It speaks the three UR text interfaces:
 *
 *   • PRIMARY   30001 / SECONDARY 30002 — send a URScript program (the exact TEXT the
 *     D1 irToUrscript transpiler emits). The controller compiles + runs it. We write the
 *     script (newline-terminated) to the socket; the controller streams back a binary
 *     state feed we do NOT parse here (RTDE 30004 is the proper state channel) — sending
 *     over primary/secondary is the standard "run this script now" path.
 *   • DASHBOARD 29999 — a LINE-based text protocol: `load <prog>`, `play`, `stop`,
 *     `power on/off`, `brake release`, `robotmode`, `programState`, `running`. Each
 *     command gets one text reply line. This is how we drive + poll a loaded program.
 *   • RTDE      30004 — binary real-time state (optional; NOT implemented here — the
 *     dashboard `robotmode`/`programState`/`running` queries give us enough for the
 *     validation harness without a binary protocol implementation).
 *
 * HONESTY / NO-FAKE: every method opens a real TCP socket. URSim must be running
 * (`docker run … universalrobots/ursim_e-series`, see doc 20 §7 runbook). When the
 * endpoint is unreachable the connect promise REJECTS with a clear error and the
 * validation harness returns { accepted:false, error } — it NEVER fabricates a
 * connected/accepted/running state. This opens NO new control gate on its own; the
 * programmingService deploy gate (DPC_DEPLOY_ENABLED + HITL) governs whether a deploy
 * to a URSim endpoint is real or recorded 'simulated' (see ursimDeployAdapter).
 * ════════════════════════════════════════════════════════════════════════════
 */
import net from "node:net";

/** UR interface default ports. */
export const UR_PORTS = {
  primary: 30001,
  secondary: 30002,
  dashboard: 29999,
  rtde: 30004,
} as const;

export interface UrsimEndpoint {
  host: string;
  /** Script port — primary (30001, default) or secondary (30002). */
  scriptPort?: number;
  /** Dashboard port (29999 default). */
  dashboardPort?: number;
  /** Connect/read timeout per socket op (ms). Default 5000. */
  timeoutMs?: number;
}

function resolve(ep: UrsimEndpoint) {
  return {
    host: ep.host,
    scriptPort: ep.scriptPort ?? UR_PORTS.primary,
    dashboardPort: ep.dashboardPort ?? UR_PORTS.dashboard,
    timeoutMs: Math.max(500, ep.timeoutMs ?? 5000),
  };
}

/**
 * Open a TCP socket to host:port under a timeout. Rejects with a clear, honest error
 * when the endpoint is unreachable (ECONNREFUSED / ETIMEDOUT / ENOTFOUND) — never
 * resolves a fake connection.
 */
function openSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const sock = new net.Socket();
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* ignore */ }
      reject(new Error(`URSim ${host}:${port} unreachable: ${err.message}`));
    };
    sock.setTimeout(timeoutMs);
    sock.once("timeout", () => fail(new Error("connect timeout")));
    sock.once("error", fail);
    sock.connect(port, host, () => {
      if (settled) return;
      settled = true;
      sock.setTimeout(0);
      // Replace the connect-time rejecter with a swallow-listener: after a successful
      // connect, a late ECONNRESET during teardown (peer still writing when we destroy)
      // must NOT become an unhandled process exception.
      sock.removeListener("error", fail);
      sock.on("error", () => { /* post-connect socket error — swallowed (teardown/reset) */ });
      resolve(sock);
    });
  });
}

/**
 * Send one line to the dashboard server and read the single text reply line.
 * The dashboard is strictly one-request→one-line-reply.
 */
async function dashboardCommand(host: string, port: number, timeoutMs: number, command: string): Promise<string> {
  const sock = await openSocket(host, port, timeoutMs);
  try {
    return await new Promise<string>((resolve, reject) => {
      let buf = "";
      let greeted = false;
      const to = setTimeout(() => reject(new Error(`dashboard "${command}" timeout`)), timeoutMs);
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        // The dashboard emits a greeting line on connect ("Connected: Universal Robots
        // Dashboard Server"), THEN our command's reply. Consume the greeting first.
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        if (!greeted) {
          greeted = true;
          buf = buf.slice(nl + 1);
          // Send the actual command now that we have consumed the greeting.
          sock.write(command + "\n");
          return;
        }
        const nl2 = buf.indexOf("\n");
        if (nl2 === -1) return;
        clearTimeout(to);
        resolve(buf.slice(0, nl2).trim());
      });
      sock.once("error", (err) => { clearTimeout(to); reject(err); });
    });
  } finally {
    // Graceful FIN (no immediate destroy → avoids sending an RST the peer reads as reset).
    try { sock.end(); } catch { /* ignore */ }
  }
}

export interface DashboardReply {
  command: string;
  reply: string;
}

export class UrsimClient {
  private ep: ReturnType<typeof resolve>;
  constructor(endpoint: UrsimEndpoint) {
    this.ep = resolve(endpoint);
  }

  /** True if the dashboard port answers (cheap reachability probe). Never throws. */
  async ping(): Promise<{ reachable: boolean; error?: string }> {
    try {
      const sock = await openSocket(this.ep.host, this.ep.dashboardPort, this.ep.timeoutMs);
      try { sock.end(); } catch { /* ignore */ }
      return { reachable: true };
    } catch (err) {
      return { reachable: false, error: (err as Error)?.message ?? String(err) };
    }
  }

  /**
   * Send a URScript program to the controller over the primary/secondary interface.
   * The controller compiles + runs it immediately. Returns after the bytes are flushed;
   * the controller does NOT ack over this channel (state is read via the dashboard).
   * Throws (honest) when the endpoint is unreachable.
   */
  async sendScript(urscript: string): Promise<{ sent: boolean; bytes: number }> {
    const sock = await openSocket(this.ep.host, this.ep.scriptPort, this.ep.timeoutMs);
    try {
      const payload = urscript.endsWith("\n") ? urscript : urscript + "\n";
      await new Promise<void>((resolve, reject) => {
        sock.write(payload, "utf8", (err) => (err ? reject(err) : resolve()));
      });
      return { sent: true, bytes: Buffer.byteLength(payload, "utf8") };
    } finally {
      try { sock.end(); } catch { /* ignore */ }
    }
  }

  /** Raw dashboard command → reply line. Throws (honest) when unreachable. */
  async dashboard(command: string): Promise<string> {
    return dashboardCommand(this.ep.host, this.ep.dashboardPort, this.ep.timeoutMs, command);
  }

  /** `robotmode` → e.g. "Robotmode: RUNNING" / "POWER_OFF" / "IDLE". */
  async robotMode(): Promise<string> {
    return this.dashboard("robotmode");
  }

  /** `programState` → e.g. "STOPPED default.urp" / "PLAYING". */
  async programState(): Promise<string> {
    return this.dashboard("programState");
  }

  /** `running` → "Program running: true" / "false". */
  async isProgramRunning(): Promise<boolean> {
    const reply = await this.dashboard("running");
    return /true/i.test(reply);
  }

  /** Power the arm on and release brakes (dashboard). */
  async powerOn(): Promise<DashboardReply[]> {
    const power = await this.dashboard("power on");
    const brake = await this.dashboard("brake release");
    return [
      { command: "power on", reply: power },
      { command: "brake release", reply: brake },
    ];
  }

  async powerOff(): Promise<string> {
    return this.dashboard("power off");
  }

  /** Load a stored .urp program (dashboard). */
  async load(program: string): Promise<string> {
    return this.dashboard(`load ${program}`);
  }

  async play(): Promise<string> {
    return this.dashboard("play");
  }

  async stop(): Promise<string> {
    return this.dashboard("stop");
  }
}
