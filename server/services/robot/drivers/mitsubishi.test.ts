/**
 * doc 24 Tier-2 — Mitsubishi MELFA (R3 command channel) driver tests. No real
 * hardware / no lib: node:net createConnection is mocked with an auto-responder
 * "controller" socket that parses each written `<robotNo>;<slotNo>;<cmd>\r` line and
 * emits a canned `Qok…`/`Qe…` reply.
 *
 * Covers: pure framing/parse + motion/state/pose decoders, the OPEN→STATE connect
 * handshake, STATE+PPOSF read → telemetry, the DRY-RUN motion gate (build the
 * command but write NO bytes and NEVER CNTLON/SRVON unless ROBOT_CONTROL_ENABLED),
 * the live path (CNTLON → SRVON → EXEC…), and fail-safe connect/runJob.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── auto-responder mock socket ("controller") ───────────────────────────────
type Responder = (cmd: string, robotNo: string, slotNo: string) => string | null;
type Controller = {
  on: (ev: string, cb: (...a: any[]) => void) => Controller;
  emit: (ev: string, ...a: any[]) => void;
  write: (frame: string) => void;
  destroy: () => void;
  written: string[];
};

let nextSocket: Controller | null = null;
let connectCalls = 0;

function makeController(responder: Responder): Controller {
  const handlers: Record<string, Array<(...a: any[]) => void>> = {};
  const c: Controller = {
    written: [],
    on(ev, cb) { (handlers[ev] ??= []).push(cb); return c; },
    emit(ev, ...a) { (handlers[ev] ?? []).forEach((h) => h(...a)); },
    write(frame) {
      c.written.push(frame);
      const [robotNo, slotNo, ...rest] = String(frame).replace(/\r$/, "").split(";");
      const cmd = rest.join(";");
      const resp = responder(cmd, robotNo, slotNo);
      if (resp == null) return;
      setImmediate(() => c.emit("data", Buffer.from(resp + "\r", "utf8")));
    },
    destroy() { c.emit("close"); },
  };
  return c;
}

/** Canonical MELFA controller responder. */
function defaultResponder(cmd: string): string | null {
  if (cmd.startsWith("OPEN=")) return "Qok";
  if (cmd === "STATE") return "Qok1;0;0";              // running=1, mode=auto, err=0
  if (cmd === "PPOSF") return "QokX;100.5;Y;-20;Z;300;A;180;B;0;C;90";
  if (cmd === "JPOSF") return "QokJ1;10;J2;20;J3;0;J4;0;J5;0;J6;0";
  if (cmd === "CNTLON" || cmd === "SRVON") return "Qok";
  if (cmd === "CLOSE") return "Qok";
  if (cmd.startsWith("EXEC") || cmd === "STOP") return "Qok";
  return "Qok";
}

vi.mock("node:net", () => ({
  createConnection: vi.fn(() => {
    connectCalls++;
    const s = nextSocket ?? makeController(defaultResponder);
    setImmediate(() => s.emit("connect")); // fires after driver attaches listeners
    return s;
  }),
}));

async function connectedDriver(responder: Responder = defaultResponder) {
  nextSocket = makeController(responder);
  const { MitsubishiDriver } = await import("./mitsubishiRobotDriver");
  const d = new MitsubishiDriver();
  await d.connect({ endpoint: "tcp://192.168.0.30:10001" });
  return { d, sock: nextSocket! };
}

const parseType = (frame: string) => String(frame).replace(/\r$/, "").split(";").slice(2).join(";");

describe("MELFA — pure framing + decoders", () => {
  it("frameMelfaCommand builds <robotNo>;<slotNo>;<cmd>\\r", async () => {
    const { frameMelfaCommand } = await import("./mitsubishiRobotDriver");
    expect(frameMelfaCommand("STATE")).toBe("1;1;STATE\r");
    expect(frameMelfaCommand("SRVON", 2, 3)).toBe("2;3;SRVON\r");
  });

  it("parseMelfaResponse distinguishes Qok payload from Qe error", async () => {
    const { parseMelfaResponse } = await import("./mitsubishiRobotDriver");
    expect(parseMelfaResponse("Qok1;0;0")).toEqual({ ok: true, payload: "1;0;0" });
    const err = parseMelfaResponse("QeR7");
    expect(err.ok).toBe(false);
    expect(err.errorNo).toBe(7);
  });

  it("decodeMelfaState reads running/mode/error positionally", async () => {
    const { decodeMelfaState } = await import("./mitsubishiRobotDriver");
    expect(decodeMelfaState("1;0;0")).toEqual({ running: true, mode: "auto", errorNo: 0 });
    expect(decodeMelfaState("0;1;42")).toEqual({ running: false, mode: "manual", errorNo: 42 });
  });

  it("decodeMelfaPosition parses name;value pairs → cartesian", async () => {
    const { decodeMelfaPosition } = await import("./mitsubishiRobotDriver");
    const pose = decodeMelfaPosition("X;100.5;Y;-20;Z;300;A;180;B;0;C;90");
    expect(pose?.cartesian).toMatchObject({ x: 100.5, y: -20, z: 300, rx: 180, rz: 90 });
    expect(pose?.frame).toBe("world");
  });

  it("buildMelfaMotion → EXECMVS for cartesian, EXECMOV J= for joints + home", async () => {
    const { buildMelfaMotion } = await import("./mitsubishiRobotDriver");
    expect(buildMelfaMotion({ jobType: "move", params: { x: 10, y: 20, z: 30, a: 180 } }))
      .toBe("EXECMVS (10,20,30,180,0,0)(7,0)");
    expect(buildMelfaMotion({ jobType: "move", params: { joints: [1, 2, 3, 4, 5, 6] } }))
      .toBe("EXECMOV J=(1,2,3,4,5,6)");
    expect(buildMelfaMotion({ jobType: "home" })).toBe("EXECMOV J=(0,0,0,0,0,0)");
  });
});

describe("MitsubishiDriver — session + read path", () => {
  beforeEach(() => {
    vi.resetModules();
    nextSocket = null;
    connectCalls = 0;
    delete process.env.ROBOT_CONTROL_ENABLED;
  });
  afterEach(() => { delete process.env.ROBOT_CONTROL_ENABLED; });

  it("connect: OPEN + STATE probe → connected (NO CNTLON/SRVON)", async () => {
    const { d, sock } = await connectedDriver();
    expect(d.isConnected()).toBe(true);
    const types = sock.written.map(parseType);
    expect(types[0]).toMatch(/^OPEN=/);
    expect(types[1]).toBe("STATE");
    expect(types).not.toContain("CNTLON");
    expect(types).not.toContain("SRVON");
    const h = await d.health();
    expect(h.connected).toBe(true);
    expect(h.vendor).toBe("mitsubishi");
  });

  it("connect fail: OPEN error reply → throws, stays disconnected, lastError set", async () => {
    nextSocket = makeController((cmd) => (cmd.startsWith("OPEN=") ? "QeR2" : defaultResponder(cmd, "1", "1")));
    const { MitsubishiDriver } = await import("./mitsubishiRobotDriver");
    const drv = new MitsubishiDriver();
    await expect(drv.connect({ endpoint: "127.0.0.1:10001" })).rejects.toThrow(/error 2/);
    expect(drv.isConnected()).toBe(false);
    const h = await drv.health();
    expect(h.lastError).toMatch(/error 2/);
  });

  it("getState: STATE + PPOSF → telemetry pose (estop honest undefined)", async () => {
    const { d } = await connectedDriver();
    const s = await d.getState();
    expect(s.mode).toBe("auto");
    expect(s.busy).toBe(true);              // STATE running=1
    expect(s.estop).toBeUndefined();        // MELFA STATE has no e-stop field
    expect(s.error).toBeUndefined();
    expect(s.pose?.cartesian).toMatchObject({ x: 100.5, y: -20, z: 300, rx: 180, rz: 90 });
  });

  it("getState: non-zero STATE error surfaces as error string", async () => {
    let statusCalls = 0;
    const { d } = await connectedDriver((cmd) => {
      if (cmd === "STATE") {
        statusCalls++;
        return statusCalls === 1 ? "Qok1;0;0" : "Qok0;1;9";  // 2nd = getState → error 9
      }
      return defaultResponder(cmd, "1", "1");
    });
    const s = await d.getState();
    expect(s.error).toMatch(/9/);
    expect(s.mode).toBe("manual");
    expect(s.busy).toBe(false);
  });
});

describe("MitsubishiDriver — motion gate + fail-safe", () => {
  beforeEach(() => {
    vi.resetModules();
    nextSocket = null;
    connectCalls = 0;
    delete process.env.ROBOT_CONTROL_ENABLED;
  });
  afterEach(() => { delete process.env.ROBOT_CONTROL_ENABLED; });

  it("runJob dry-run: builds command but writes NO bytes, no CNTLON/SRVON/EXEC", async () => {
    const { d, sock } = await connectedDriver();
    const before = sock.written.length;                       // OPEN + STATE
    const res = await d.runJob({ jobType: "move", params: { x: 1, y: 2, z: 3 } });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("done");
    expect(res.detail?.dryRun).toBe(true);
    expect(res.detail?.sent).toBe(false);
    expect(String(res.detail?.command)).toBe("1;1;EXECMVS (1,2,3,0,0,0)(7,0)\r");
    expect(sock.written.length).toBe(before);                 // no new bytes on the wire
    const types = sock.written.map(parseType);
    expect(types).not.toContain("CNTLON");
    expect(types).not.toContain("SRVON");
    expect(types.some((t) => t.startsWith("EXEC"))).toBe(false);
  });

  it("runJob live: ROBOT_CONTROL_ENABLED=true → CNTLON then SRVON then EXEC…", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { d, sock } = await connectedDriver();
    const res = await d.runJob({ jobType: "move", params: { joints: [10, 0, 0, 0, 0, 0] } });
    expect(res.ok).toBe(true);
    expect(res.detail?.sent).toBe(true);
    const types = sock.written.map(parseType);
    expect(types).toContain("CNTLON");
    expect(types).toContain("SRVON");
    expect(types).toContain("EXECMOV J=(10,0,0,0,0,0)");
    expect(types.indexOf("CNTLON")).toBeLessThan(types.indexOf("SRVON"));
    expect(types.indexOf("SRVON")).toBeLessThan(types.indexOf("EXECMOV J=(10,0,0,0,0,0)"));
  });

  it("runJob live: EXEC error reply → failed result (no throw)", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { d } = await connectedDriver((cmd) => (cmd.startsWith("EXEC") ? "QeR5" : defaultResponder(cmd, "1", "1")));
    const res = await d.runJob({ jobType: "move", params: { x: 1, y: 1, z: 1 } });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/error 5/);
  });

  it("runJob: not connected → failed result, never throws", async () => {
    const { MitsubishiDriver } = await import("./mitsubishiRobotDriver");
    const d = new MitsubishiDriver();
    const res = await d.runJob({ jobType: "home" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not connected/);
  });

  it("disconnect + health handled without throwing (connected and never-connected)", async () => {
    const { d } = await connectedDriver();
    await expect(d.disconnect()).resolves.toBeUndefined();
    expect(d.isConnected()).toBe(false);

    const { MitsubishiDriver } = await import("./mitsubishiRobotDriver");
    const fresh = new MitsubishiDriver();
    await expect(fresh.disconnect()).resolves.toBeUndefined();
    const h = await fresh.health();
    expect(h.connected).toBe(false);
    expect(h.vendor).toBe("mitsubishi");
  });
});
