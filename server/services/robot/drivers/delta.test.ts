/**
 * doc 24 Tier-2 — Delta (ASCII/TCP command channel) driver tests. No real hardware
 * / no lib: node:net createConnection is mocked with an auto-responder "controller"
 * socket that parses each written `@<seq>,<CMD>[,args]*<cs>\r\n` frame and emits a
 * canned `@<seq>,<CMD>,OK|ERR,…*<cs>\r\n` reply.
 *
 * Covers: pure framing/checksum/parse + motion/state/pose decoders, the RDSTS
 * connect probe, RDSTS+RDPOS read → telemetry, the DRY-RUN motion gate (build the
 * command but write NO bytes and NEVER SERVO,1 unless ROBOT_CONTROL_ENABLED), the
 * live path (SERVO,1 → MOVL/MOVJ), and fail-safe connect/runJob.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── auto-responder mock socket ("controller") ───────────────────────────────
type Responder = (cmd: string, seq: string, args: string[]) => string | null;
type Controller = {
  on: (ev: string, cb: (...a: any[]) => void) => Controller;
  emit: (ev: string, ...a: any[]) => void;
  write: (frame: string) => void;
  destroy: () => void;
  written: string[];
};

let nextSocket: Controller | null = null;
let connectCalls = 0;

function parseFrame(frame: string): { seq: string; cmd: string; args: string[] } {
  let t = String(frame).trim();
  if (t.startsWith("@")) t = t.slice(1);
  const star = t.lastIndexOf("*");
  if (star >= 0) t = t.slice(0, star);
  const toks = t.split(",");
  return { seq: toks[0], cmd: toks[1], args: toks.slice(2) };
}

function makeController(responder: Responder): Controller {
  const handlers: Record<string, Array<(...a: any[]) => void>> = {};
  const c: Controller = {
    written: [],
    on(ev, cb) { (handlers[ev] ??= []).push(cb); return c; },
    emit(ev, ...a) { (handlers[ev] ?? []).forEach((h) => h(...a)); },
    write(frame) {
      c.written.push(frame);
      const { seq, cmd, args } = parseFrame(frame);
      const body = responder(cmd, seq, args);       // e.g. "OK,1,0,0,0" or "ERR,3"
      if (body == null) return;
      const line = `@${seq},${cmd},${body}*00\r\n`;
      setImmediate(() => c.emit("data", Buffer.from(line, "utf8")));
    },
    destroy() { c.emit("close"); },
  };
  return c;
}

/** Canonical Delta controller responder. */
function defaultResponder(cmd: string): string | null {
  if (cmd === "RDSTS") return "OK,1,0,0,0";            // running=1, auto, err=0, estop=0
  if (cmd === "RDPOS") return "OK,100.5,-20,300,90";   // x,y,z,c
  if (cmd === "SERVO") return "OK";
  if (cmd === "MOVL" || cmd === "MOVJ" || cmd === "STOP") return "OK";
  return "OK";
}

vi.mock("node:net", () => ({
  createConnection: vi.fn(() => {
    connectCalls++;
    const s = nextSocket ?? makeController(defaultResponder);
    setImmediate(() => s.emit("connect"));
    return s;
  }),
}));

async function connectedDriver(responder: Responder = defaultResponder) {
  nextSocket = makeController(responder);
  const { DeltaDriver } = await import("./deltaRobotDriver");
  const d = new DeltaDriver();
  await d.connect({ endpoint: "tcp://192.168.0.40:5000" });
  return { d, sock: nextSocket! };
}

const cmdOf = (frame: string) => parseFrame(frame).cmd;

describe("Delta — pure framing + decoders", () => {
  it("frameDeltaCommand builds @<seq>,<CMD>,args*<cs> with valid checksum", async () => {
    const { frameDeltaCommand, deltaChecksum } = await import("./deltaRobotDriver");
    const frame = frameDeltaCommand(7, "MOVL", [1, 2, 3, 0, 50]);
    expect(frame.startsWith("@7,MOVL,1,2,3,0,50*")).toBe(true);
    expect(frame.endsWith("\r\n")).toBe(true);
    const m = frame.trim().match(/^@(.*)\*([0-9A-F]{2})$/);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(deltaChecksum(m![1]));
  });

  it("parseDeltaResponse splits OK payload and ERR error code", async () => {
    const { parseDeltaResponse } = await import("./deltaRobotDriver");
    const ok = parseDeltaResponse("@7,RDSTS,OK,1,0,0,0*00");
    expect(ok.ok).toBe(true);
    expect(ok.fields).toEqual(["1", "0", "0", "0"]);
    const err = parseDeltaResponse("@7,MOVL,ERR,3*00");
    expect(err.ok).toBe(false);
    expect(err.errorCode).toBe(3);
  });

  it("decodeDeltaStatus reads running/mode/error/estop positionally", async () => {
    const { decodeDeltaStatus } = await import("./deltaRobotDriver");
    expect(decodeDeltaStatus(["1", "0", "0", "0"])).toEqual({ running: true, mode: "auto", errorCode: 0, estop: false });
    expect(decodeDeltaStatus(["0", "1", "42", "1"])).toEqual({ running: false, mode: "manual", errorCode: 42, estop: true });
  });

  it("decodeDeltaPosition maps [X,Y,Z,C] → cartesian", async () => {
    const { decodeDeltaPosition } = await import("./deltaRobotDriver");
    const pose = decodeDeltaPosition(["100.5", "-20", "300", "90"]);
    expect(pose?.cartesian).toMatchObject({ x: 100.5, y: -20, z: 300, rz: 90 });
    expect(pose?.frame).toBe("world");
  });

  it("buildDeltaMotion → MOVL for cartesian, MOVJ for joints", async () => {
    const { buildDeltaMotion } = await import("./deltaRobotDriver");
    expect(buildDeltaMotion({ jobType: "move", params: { x: 1, y: 2, z: 3, velPct: 40 } }))
      .toEqual({ cmd: "MOVL", args: [1, 2, 3, 0, 40] });
    expect(buildDeltaMotion({ jobType: "move", params: { joints: [10, 20], velPct: 30 } }))
      .toEqual({ cmd: "MOVJ", args: [10, 20, 30] });
  });
});

describe("DeltaDriver — session + read path", () => {
  beforeEach(() => {
    vi.resetModules();
    nextSocket = null;
    connectCalls = 0;
    delete process.env.ROBOT_CONTROL_ENABLED;
  });
  afterEach(() => { delete process.env.ROBOT_CONTROL_ENABLED; });

  it("connect: single RDSTS probe → connected (NO SERVO)", async () => {
    const { d, sock } = await connectedDriver();
    expect(d.isConnected()).toBe(true);
    const types = sock.written.map(cmdOf);
    expect(types).toEqual(["RDSTS"]);
    expect(types).not.toContain("SERVO");
    const h = await d.health();
    expect(h.connected).toBe(true);
    expect(h.vendor).toBe("delta");
  });

  it("connect fail: RDSTS ERR reply → throws, stays disconnected, lastError set", async () => {
    nextSocket = makeController((cmd) => (cmd === "RDSTS" ? "ERR,3" : defaultResponder(cmd, "1", [])));
    const { DeltaDriver } = await import("./deltaRobotDriver");
    const drv = new DeltaDriver();
    await expect(drv.connect({ endpoint: "127.0.0.1:5000" })).rejects.toThrow(/error 3/);
    expect(drv.isConnected()).toBe(false);
    const h = await drv.health();
    expect(h.lastError).toMatch(/error 3/);
  });

  it("getState: RDSTS + RDPOS → telemetry pose (estop present)", async () => {
    const { d } = await connectedDriver();
    const s = await d.getState();
    expect(s.mode).toBe("auto");
    expect(s.busy).toBe(true);
    expect(s.estop).toBe(false);            // Delta status frame carries an estop flag
    expect(s.error).toBeUndefined();
    expect(s.pose?.cartesian).toMatchObject({ x: 100.5, y: -20, z: 300, rz: 90 });
  });

  it("getState: non-zero RDSTS error surfaces as error string", async () => {
    let statusCalls = 0;
    const { d } = await connectedDriver((cmd) => {
      if (cmd === "RDSTS") {
        statusCalls++;
        return statusCalls === 1 ? "OK,1,0,0,0" : "OK,0,1,9,1";  // 2nd = getState → error 9, estop
      }
      return defaultResponder(cmd, "1", []);
    });
    const s = await d.getState();
    expect(s.error).toMatch(/9/);
    expect(s.mode).toBe("manual");
    expect(s.estop).toBe(true);
  });
});

describe("DeltaDriver — motion gate + fail-safe", () => {
  beforeEach(() => {
    vi.resetModules();
    nextSocket = null;
    connectCalls = 0;
    delete process.env.ROBOT_CONTROL_ENABLED;
  });
  afterEach(() => { delete process.env.ROBOT_CONTROL_ENABLED; });

  it("runJob dry-run: builds command but writes NO bytes, no SERVO/MOVL", async () => {
    const { d, sock } = await connectedDriver();
    const before = sock.written.length;                       // RDSTS probe
    const res = await d.runJob({ jobType: "move", params: { x: 1, y: 2, z: 3 } });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("done");
    expect(res.detail?.dryRun).toBe(true);
    expect(res.detail?.sent).toBe(false);
    expect(String(res.detail?.command).startsWith("@2,MOVL,1,2,3,0,50*")).toBe(true);
    expect(sock.written.length).toBe(before);                 // no new bytes on the wire
    const types = sock.written.map(cmdOf);
    expect(types).not.toContain("SERVO");
    expect(types).not.toContain("MOVL");
  });

  it("runJob live: ROBOT_CONTROL_ENABLED=true → SERVO,1 then MOVJ", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { d, sock } = await connectedDriver();
    const res = await d.runJob({ jobType: "move", params: { joints: [10, 0, 0, 0, 0, 0] } });
    expect(res.ok).toBe(true);
    expect(res.detail?.sent).toBe(true);
    const types = sock.written.map(cmdOf);
    expect(types).toContain("SERVO");
    expect(types).toContain("MOVJ");
    expect(types.indexOf("SERVO")).toBeLessThan(types.indexOf("MOVJ"));
    // SERVO carried its enable arg
    const servoFrame = sock.written.find((w) => cmdOf(w) === "SERVO")!;
    expect(parseFrame(servoFrame).args).toEqual(["1"]);
  });

  it("runJob live: MOV error reply → failed result (no throw)", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { d } = await connectedDriver((cmd) => (cmd === "MOVL" ? "ERR,5" : defaultResponder(cmd, "1", [])));
    const res = await d.runJob({ jobType: "move", params: { x: 1, y: 1, z: 1 } });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/error 5/);
  });

  it("runJob: not connected → failed result, never throws", async () => {
    const { DeltaDriver } = await import("./deltaRobotDriver");
    const d = new DeltaDriver();
    const res = await d.runJob({ jobType: "home" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not connected/);
  });

  it("disconnect + health handled without throwing (connected and never-connected)", async () => {
    const { d } = await connectedDriver();
    await expect(d.disconnect()).resolves.toBeUndefined();
    expect(d.isConnected()).toBe(false);

    const { DeltaDriver } = await import("./deltaRobotDriver");
    const fresh = new DeltaDriver();
    await expect(fresh.disconnect()).resolves.toBeUndefined();
    const h = await fresh.health();
    expect(h.connected).toBe(false);
    expect(h.vendor).toBe("delta");
  });
});
