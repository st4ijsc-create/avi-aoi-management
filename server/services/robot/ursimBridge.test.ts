/**
 * doc 40 W5 (MTX-12) — UrsimBridge (UR RobotDriver) tests (vitest, mock UR controller).
 *
 * A LOCAL `net.Server` speaks a minimal UR dashboard + primary/secondary interface so
 * these run WITHOUT URSim/Docker. HW-FAT (a real UR arm) is separate. Covers the
 * dashboard-poll → RobotState mapping, the dry-run self-guard, and the gated send path.
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { UrsimBridgeDriver, jobToUrscript, UR_VENDOR, UrJobRefusedError } from "./ursimBridge";

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
  if (cmd === "stop") return "Stopped"; // literal success reply of the UR Dashboard Server
  return "ok";
}

const HOME_CFG = [0.1, -1.57, 1.57, -1.57, -1.57, 0]; // home pose lưu trong connectionOptions.home (rad)

describe("jobToUrscript", () => {
  // doc 81 Đợt 1B Task 5 (R10b) — home CHỈ lấy từ cấu hình robot (trước đây: params.home của người
  // gọi, mặc định toàn 0 — cả hai đều là đích tuỳ ý chưa kiểm).
  it("home → movej tới home ĐÃ CẤU HÌNH", () => {
    expect(jobToUrscript({ jobType: "home" }, { home: HOME_CFG })).toContain("movej([0.1, -1.57, 1.57, -1.57, -1.57, 0]");
  });
  it("home KHÔNG có cấu hình ⇒ từ chối ur_home_not_configured (không còn movej về toàn 0)", () => {
    expect(() => jobToUrscript({ jobType: "home" })).toThrow(UrJobRefusedError);
    expect(() => jobToUrscript({ jobType: "home" })).toThrow(/ur_home_not_configured/);
  });
  it("params.home của người gọi ⇒ từ chối ur_home_param_forbidden, kể cả khi đã có cấu hình", () => {
    expect(() => jobToUrscript({ jobType: "home", params: { home: [1, 2, 3, 4, 5, 6] } }, { home: HOME_CFG })).toThrow(
      /ur_home_param_forbidden/,
    );
  });
  it("move with joints → movej", () => {
    const s = jobToUrscript({ jobType: "move", params: { joints: [1, 2, 3, 4, 5, 6] } });
    expect(s).toContain("movej([1, 2, 3, 4, 5, 6]");
  });
  it("move with cartesian → movel(p[...])", () => {
    const s = jobToUrscript({ jobType: "move", params: { cartesian: [0.1, 0.2, 0.3, 0, 0, 0] } });
    expect(s).toContain("movel(p[0.1, 0.2, 0.3, 0, 0, 0]");
  });
  it("custom + params.script ⇒ từ chối ur_script_forbidden (không còn chuyển nguyên văn URScript)", () => {
    expect(() => jobToUrscript({ jobType: "custom", params: { script: "def x():\nend" } })).toThrow(/ur_script_forbidden/);
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
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port, home: HOME_CFG } });
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

  // doc 81 Đợt 1C residual round 2 (R-1C-m, lớp b ĐỘC LẬP) — gọi thẳng runJob với mọi chính tả của dừng + params
  // chuyển động/script ⇒ chỉ dashboard `stop`, 0 byte tới cổng script (trước: "stop"/"e_stop"/"ABORT" ⇒ script
  // `# no-op` gửi lên cổng script, và abort mang params.script bị TỪ CHỐI ur_script_forbidden — STOP không tới).
  it.each(["stop", "e_stop", "ABORT"])("CONTROL BẬT: '%s' + joints/script ⇒ dashboard nhận `stop`, cổng script 0 byte", async (jt) => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    const script = await startScriptServer();
    cleanups.push(dash.close); cleanups.push(script.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port, home: HOME_CFG } });
    const res = await d.runJob({ jobType: jt as never, params: { joints: [1, 1, 1, 1, 1, 1], script: "def x():\n  movej([1,1,1,1,1,1])\nend\n" } });
    expect(res.ok).toBe(true);
    expect(dash.received).toContain("stop");
    await new Promise((r) => setTimeout(r, 50));
    expect(script.getReceived()).toBe("");
    await d.disconnect();
  });

  it.each([
    ["custom + params.script", { jobType: "custom" as const, params: { script: "def x():\n  movej([1,1,1,1,1,1])\nend\n" } }, "ur_script_forbidden"],
    ["home + params.home", { jobType: "home" as const, params: { home: [1, 1, 1, 1, 1, 1] } }, "ur_home_param_forbidden"],
  ])("CONTROL BẬT: %s ⇒ failed + reasonCode, 0 byte tới cổng script", async (_label, job, code) => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    const script = await startScriptServer();
    cleanups.push(dash.close); cleanups.push(script.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port, home: HOME_CFG } });
    const res = await d.runJob(job);
    expect(res.ok).toBe(false);
    expect(res.detail?.reasonCode).toBe(code);
    expect(res.detail?.sent).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(script.getReceived()).toBe("");
    await d.disconnect();
  });

  it("CONTROL BẬT: home dùng connectionOptions.home ⇒ gửi movej tới đúng pose đã lưu", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    const script = await startScriptServer();
    cleanups.push(dash.close); cleanups.push(script.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port, home: HOME_CFG } });
    const res = await d.runJob({ jobType: "home" });
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(script.getReceived()).toContain("movej([0.1, -1.57, 1.57, -1.57, -1.57, 0]");
    await d.disconnect();
  });

  it("CONTROL BẬT: home khi cấu hình thiếu/sai (5 phần tử) ⇒ ur_home_not_configured, 0 byte", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    const script = await startScriptServer();
    cleanups.push(dash.close); cleanups.push(script.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port, home: [0, 0, 0, 0, 0] } });
    const res = await d.runJob({ jobType: "home" });
    expect(res.detail?.reasonCode).toBe("ur_home_not_configured");
    await new Promise((r) => setTimeout(r, 50));
    expect(script.getReceived()).toBe("");
    await d.disconnect();
  });

  it("abort() NÊU lỗi khi dừng thất bại (dashboard đã tắt) — không còn nuốt", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: 1 }, timeoutMs: 300 });
    await dash.close();
    await expect(d.abort()).rejects.toThrow(/abort failed/);
    await d.disconnect();
  });

  it("abort() thành công khi dashboard nhận `stop`", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    cleanups.push(dash.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: 1 } });
    await expect(d.abort()).resolves.toBeUndefined();
    expect(dash.received).toContain("stop");
    await d.disconnect();
  });

  // doc 81 Đợt 1B Task 5 fix round 1 (M5) — chỉ literal "Stopped" mới là dừng thành công.
  it("dashboard trả 'Failed to execute: stop' ⇒ runJob abort failed ur_stop_not_confirmed; abort() reject", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer((cmd) => (cmd === "stop" ? "Failed to execute: stop" : defaultReplies(cmd)));
    cleanups.push(dash.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: 1 } });
    const res = await d.runJob({ jobType: "abort" });
    expect(res.ok).toBe(false);
    expect(res.detail?.reasonCode).toBe("ur_stop_not_confirmed");
    await expect(d.abort()).rejects.toThrow(/UR abort failed.*ur_stop_not_confirmed/);
    await d.disconnect();
  });

  // doc 81 Đợt 1B Task 5 fix round 1 — hàng rào abort: job đang ở pha kết nối cổng script khi
  // abort() được gọi ⇒ script KHÔNG BAO GIỜ được ghi; dashboard nhận `stop`.
  it("abort() giữa pha kết nối của một job chuyển động ⇒ 0 byte URScript tới cổng script, dashboard nhận stop", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const dash = await startDashboardServer(defaultReplies);
    const script = await startScriptServer();
    cleanups.push(dash.close); cleanups.push(script.close);
    const d = new UrsimBridgeDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { dashboardPort: dash.port, scriptPort: script.port } });
    const job = d.runJob({ jobType: "move", params: { joints: [0.5, 0, 0, 0, 0, 0] } });
    await d.abort();
    const res = await job;
    expect(res.ok).toBe(false);
    expect(res.detail?.reasonCode).toBe("job_fenced_by_abort");
    await new Promise((r) => setTimeout(r, 100));
    expect(script.getReceived()).toBe("");
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
