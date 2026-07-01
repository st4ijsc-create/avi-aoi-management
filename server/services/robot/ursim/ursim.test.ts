/**
 * I3a-1 — URSim client + validation harness tests (vitest).
 *
 * Mock-backed: spins up a LOCAL `net.Server` that speaks a minimal UR dashboard + primary
 * interface, so these run WITHOUT URSim/Docker. Covers:
 *   1. sendScript writes the URScript over the primary socket (bytes received by the mock).
 *   2. dashboard command round-trip (greeting consumed, reply parsed).
 *   3. validateUrscriptOnUrsim happy-path → { sent, accepted, running } against a mock
 *      that reports RUNNING/PLAYING.
 *   4. validateUrscriptOnUrsim unreachable → HONEST { sent:false, error } (no fabrication).
 *   5. ursimEnabled / ursimEndpointFromEnv flag + env behaviour.
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { UrsimClient } from "./ursimClient";
import { validateUrscriptOnUrsim, ursimEnabled, ursimEndpointFromEnv } from "./ursimHarness";

/**
 * A tiny mock UR controller.
 *   - `mode` server: dashboard-only (single port). Emits the greeting line on connect,
 *     then answers each command line with a canned reply.
 *   - `script` server: captures whatever bytes are written (the URScript).
 * For the harness we run BOTH on the same host but different ports.
 */
function startDashboardServer(replies: (cmd: string) => string): Promise<{ port: number; close: () => Promise<void>; received: string[] }> {
  const received: string[] = [];
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* client teardown reset — ignore in mock */ });
      sock.write("Connected: Universal Robots Dashboard Server\n");
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const cmd = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (cmd) {
            received.push(cmd);
            sock.write(replies(cmd) + "\n");
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        received,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function startScriptServer(): Promise<{ port: number; close: () => Promise<void>; getReceived: () => string }> {
  let received = "";
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* client teardown reset — ignore in mock */ });
      sock.on("data", (chunk) => { received += chunk.toString("utf8"); });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        getReceived: () => received,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  delete process.env.URSIM_ENABLED;
  delete process.env.URSIM_HOST;
});

describe("UrsimClient", () => {
  it("sends a URScript over the primary socket", async () => {
    const script = await startScriptServer();
    cleanups.push(script.close);
    const client = new UrsimClient({ host: "127.0.0.1", scriptPort: script.port, dashboardPort: 1 });
    const res = await client.sendScript("def prog():\n  movel(p[0,0,0,0,0,0])\nend");
    expect(res.sent).toBe(true);
    expect(res.bytes).toBeGreaterThan(0);
    // Allow the socket write to land on the server.
    await new Promise((r) => setTimeout(r, 50));
    expect(script.getReceived()).toContain("movel(");
    expect(script.getReceived().endsWith("\n")).toBe(true);
  });

  it("round-trips a dashboard command (greeting consumed)", async () => {
    const dash = await startDashboardServer((cmd) => (cmd === "robotmode" ? "Robotmode: RUNNING" : "ok"));
    cleanups.push(dash.close);
    const client = new UrsimClient({ host: "127.0.0.1", dashboardPort: dash.port, scriptPort: 1 });
    const mode = await client.robotMode();
    expect(mode).toBe("Robotmode: RUNNING");
    expect(dash.received).toContain("robotmode");
  });

  it("ping reports reachable when the dashboard port answers", async () => {
    const dash = await startDashboardServer(() => "ok");
    cleanups.push(dash.close);
    const client = new UrsimClient({ host: "127.0.0.1", dashboardPort: dash.port, scriptPort: 1 });
    const p = await client.ping();
    expect(p.reachable).toBe(true);
  });
});

describe("validateUrscriptOnUrsim", () => {
  it("happy path: sent + accepted + running against a RUNNING mock controller", async () => {
    // One combined mock: same port serves dashboard replies; a separate port captures script.
    const dash = await startDashboardServer((cmd) => {
      if (cmd === "robotmode") return "Robotmode: RUNNING";
      if (cmd === "programState") return "PLAYING prog.urp";
      if (cmd === "running") return "Program running: true";
      return "ok"; // power on / brake release
    });
    const script = await startScriptServer();
    cleanups.push(dash.close);
    cleanups.push(script.close);

    const result = await validateUrscriptOnUrsim(
      "def prog():\n  movel(p[0,0,0,0,0,0])\nend",
      { host: "127.0.0.1", dashboardPort: dash.port, scriptPort: script.port, timeoutMs: 2000 },
      { pollIntervalMs: 50, runWaitMs: 500 },
    );
    expect(result.error).toBeUndefined();
    expect(result.sent).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.running).toBe(true);
    expect(result.robotMode).toMatch(/RUNNING/);
  });

  it("HONEST: unreachable endpoint → sent:false + clear error, never fabricated success", async () => {
    // Port 1 on localhost is (essentially always) closed → connection refused.
    const result = await validateUrscriptOnUrsim(
      "def prog():\nend",
      { host: "127.0.0.1", dashboardPort: 1, scriptPort: 1, timeoutMs: 500 },
      { runWaitMs: 200 },
    );
    expect(result.sent).toBe(false);
    expect(result.accepted).toBe(false);
    expect(result.running).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/unreachable|refused|ECONN|timeout/i);
  });
});

describe("URSim flags/env", () => {
  it("ursimEnabled reflects URSIM_ENABLED", () => {
    delete process.env.URSIM_ENABLED;
    expect(ursimEnabled()).toBe(false);
    process.env.URSIM_ENABLED = "true";
    expect(ursimEnabled()).toBe(true);
  });

  it("ursimEndpointFromEnv is null without URSIM_HOST, populated with it", () => {
    delete process.env.URSIM_HOST;
    expect(ursimEndpointFromEnv()).toBeNull();
    process.env.URSIM_HOST = "10.0.0.5";
    const ep = ursimEndpointFromEnv();
    expect(ep?.host).toBe("10.0.0.5");
    expect(ep?.dashboardPort).toBe(29999);
    expect(ep?.scriptPort).toBe(30001);
  });
});
