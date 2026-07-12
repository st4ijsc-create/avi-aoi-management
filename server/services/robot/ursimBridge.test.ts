/**
 * doc 40 W5 (MTX-12) — UrsimBridge (UR RobotDriver) tests (vitest, mock UR controller).
 *
 * A LOCAL `net.Server` speaks a minimal UR dashboard + primary/secondary interface so
 * these run WITHOUT URSim/Docker. HW-FAT (a real UR arm) is separate. Covers the
 * dashboard-poll → RobotState mapping, the dry-run self-guard, and the gated send path.
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { UrsimBridgeDriver, jobToUrscript, UR_VENDOR } from "./ursimBridge";

function startDashboardServer(replies: (cmd: string) => string): Promise<{ port: number; received: string[]; close: () => Promise<void> }> {
  const received: string[] = [];
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* teardown reset — ignore in mock */ });
      sock.write("Connected: Universal Robots Dashboard Server\n");
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const cmd = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (cmd) { received.push(cmd); sock.write(replies(cmd) + "\n"); }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, received, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function startScriptServer(): Promise<{ port: number; getReceived: () => string; close: () => Promise<void> }> {
  let received = "";
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.on("error", () => { /* teardown reset — ignore in mock */ });
      sock.on("data", (chunk) => { received += chunk.toString("utf8"); });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, getReceived: () => received, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  delete process.env.ROBOT_CONTROL_ENABLED;
});

function defaultReplies(cmd: string): string {
  if (cmd === "robotmode") return "Robotmode: RUNNING";
  if (cmd === "running") return "Program running: true";
  if (cmd === "safetystatus") return "Safetystatus: NORMAL";
  if (cmd === "programState") return "PLAYING prog.urp";
  return "ok";
}

describe("jobToUrscript", () => {
  it("home → movej to zeros", () => {
    expect(jobToUrscript({ jobType: "home" })).toContain("movej([0, 0, 0, 0, 0, 0]");
  });
  it("move with joints → movej", () => {
    const s = jobToUrscript({ jobType: "move", params: { joints: [1, 2, 3, 4, 5, 6] } });
    expect(s).toContain("movej([1, 2, 3, 4, 5, 6]");
  });
  it("move with cartesian → movel(p[...])", () => {
    const s = jobToUrscript({ jobType: "move", params: { cartesian: [0.1, 0.2, 0.3, 0, 0, 0] } });
    expect(s).toContain("movel(p[0.1, 0.2, 0.3, 0, 0, 0]");
  });
  it("custom passes raw URScript through", () => {
    expect(jobToUrscript({ jobType: "custom", params: { script: "def x():\nend" } })).toBe("def x():\nend");
  });
});

describe("UrsimBridgeDriver", () => {
  it("vendor key is 'ur'", () => {
    expect(UR_VENDOR).toBe("ur");
    expect(new UrsimBridgeDriver().vendor).toBe("ur");
  });

  it("connect throws (honest) when the dashboard is unreachable", async () => {
    const d = new UrsimBridgeDriver();
    await expect(
      d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: 1, scriptPort: 1 }, timeoutMs: 500 }),
    ).rejects.toThrow(/unreachable|UrsimBridge/i);
    expect(d.isConnected()).toBe(false);
  });

  it("connect probes the dashboard, getState maps robotmode/running/safety", async () => {
    const dash = await startDashboardServer(defaultReplies);
    cleanups.push(dash.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: 1 } });
    expect(d.isConnected()).toBe(true);
    const s = await d.getState();
    expect(s.mode).toBe("auto");   // RUNNING → auto
    expect(s.busy).toBe(true);     // running: true
    expect(s.estop).toBe(false);   // NORMAL
    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("getState flags estop on a protective/emergency stop", async () => {
    const dash = await startDashboardServer((cmd) =>
      cmd === "safetystatus" ? "Safetystatus: PROTECTIVE_STOP" : defaultReplies(cmd),
    );
    cleanups.push(dash.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: 1 } });
    const s = await d.getState();
    expect(s.estop).toBe(true);
    await d.disconnect();
  });

  it("runJob is DRY-RUN by default: returns URScript intent, sends nothing", async () => {
    const dash = await startDashboardServer(defaultReplies);
    const script = await startScriptServer();
    cleanups.push(dash.close); cleanups.push(script.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port } });
    const res = await d.runJob({ jobType: "home" });
    expect(res.ok).toBe(true);
    expect(res.detail?.dryRun).toBe(true);
    expect(res.detail?.sent).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(script.getReceived()).toBe(""); // nothing sent while control disabled
    await d.disconnect();
  });

  it("runJob sends URScript over the secondary interface when control is ENABLED", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    const script = await startScriptServer();
    cleanups.push(dash.close); cleanups.push(script.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port } });
    const res = await d.runJob({ jobType: "move", params: { joints: [0.5, 0, 0, 0, 0, 0] } });
    expect(res.ok).toBe(true);
    expect(res.detail?.sent).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(script.getReceived()).toContain("movej([0.5,");
    await d.disconnect();
  });

  it("runJob abort routes through the dashboard `stop` when control is enabled", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    cleanups.push(dash.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: 1 } });
    const res = await d.runJob({ jobType: "abort" });
    expect(res.ok).toBe(true);
    expect(dash.received).toContain("stop");
    await d.disconnect();
  });

  it("runJob returns failed when not connected", async () => {
    const d = new UrsimBridgeDriver();
    const res = await d.runJob({ jobType: "home" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not connected/);
  });
});
