/**
 * doc 24 C4 — FANUC RMI driver tests. No real hardware / no lib:
 *   • node:net createConnection is mocked with an auto-responder "controller"
 *     socket that parses each written RMI packet and emits a canned JSON reply.
 *
 * Covers: pure packet builders + CRLF framing/parsing, the Connect→GetStatus
 * handshake, position-register read → pose decode, the DRY-RUN motion gate (build
 * the instruction but open/write NO motion packet unless ROBOT_CONTROL_ENABLED),
 * the live path (FRC_Initialize + instruction), and fail-safe connect/disconnect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── auto-responder mock socket ("controller") ───────────────────────────────
type Responder = (pkt: Record<string, unknown>) => unknown;
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
      let pkt: Record<string, unknown>;
      try { pkt = JSON.parse(String(frame).trim()); } catch { return; }
      const resp = responder(pkt);
      if (resp == null) return;
      const arr = Array.isArray(resp) ? resp : [resp];
      setImmediate(() => { for (const r of arr) c.emit("data", Buffer.from(JSON.stringify(r) + "\r\n", "utf8")); });
    },
    destroy() { c.emit("close"); },
  };
  return c;
}

/** Canonical controller responder covering the packets the driver sends. */
function defaultResponder(pkt: Record<string, unknown>): unknown {
  if (pkt.Communication === "FRC_Connect") {
    return { Communication: "FRC_Connect", ErrorID: 0, PortNumber: 16002, MajorVersion: 1, MinorVersion: 3 };
  }
  if (pkt.Communication === "FRC_Disconnect") return { Communication: "FRC_Disconnect", ErrorID: 0 };
  if (pkt.Command === "FRC_GetStatus") {
    return { Command: "FRC_GetStatus", ErrorID: 0, ServoReady: 1, TPMode: 0, RMIMotionStatus: 0, ProgramStatus: 0, NextSequenceID: 1 };
  }
  if (pkt.Command === "FRC_ReadPositionRegister") {
    return {
      Command: "FRC_ReadPositionRegister", ErrorID: 0, RegisterNumber: pkt.RegisterNumber,
      Configuration: { UToolNumber: 1, UFrameNumber: 1 },
      Position: { X: 100.5, Y: -20, Z: 300, W: 180, P: 0, R: 90 },
    };
  }
  if (pkt.Command === "FRC_Initialize") return { Command: "FRC_Initialize", ErrorID: 0, GroupMask: 1 };
  if (pkt.Command === "FRC_Abort") return { Command: "FRC_Abort", ErrorID: 0 };
  if (typeof pkt.Instruction === "string") return { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: pkt.SequenceID };
  return null;
}

vi.mock("node:net", () => ({
  createConnection: vi.fn(() => {
    connectCalls++;
    const s = nextSocket ?? makeController(defaultResponder);
    // 'connect' fires after the driver has attached its listeners (next tick).
    setImmediate(() => s.emit("connect"));
    return s;
  }),
}));

async function connectedDriver(responder: Responder = defaultResponder) {
  nextSocket = makeController(responder);
  const { FanucDriver } = await import("./fanucDriver");
  const d = new FanucDriver();
  await d.connect({ endpoint: "tcp://192.168.0.20:16001" });
  return { d, sock: nextSocket! };
}

describe("FANUC RMI — pure builders + framing", () => {
  it("frameFanucPacket serializes single-line JSON terminated by CRLF", async () => {
    const { frameFanucPacket } = await import("./fanucDriver");
    const line = frameFanucPacket({ Command: "FRC_GetStatus" });
    expect(line.endsWith("\r\n")).toBe(true);
    expect(line.includes("\n{")).toBe(false);
    expect(JSON.parse(line.trim())).toEqual({ Command: "FRC_GetStatus" });
  });

  it("parseFanucFrames splits complete packets and keeps the partial tail", async () => {
    const { parseFanucFrames } = await import("./fanucDriver");
    const r1 = parseFanucFrames('{"a":1}\r\n{"b":2}\r\n{"c":');
    expect(r1.packets).toEqual([{ a: 1 }, { b: 2 }]);
    expect(r1.rest).toBe('{"c":');
    // the tail completes on the next chunk
    const r2 = parseFanucFrames(r1.rest + '3}\r\n');
    expect(r2.packets).toEqual([{ c: 3 }]);
    expect(r2.rest).toBe("");
  });

  it("buildFanucInstruction → FRC_LinearMotion for cartesian params", async () => {
    const { buildFanucInstruction } = await import("./fanucDriver");
    const pkt = buildFanucInstruction({ jobType: "move", params: { x: 10, y: 20, z: 30, w: 180 } }, 5);
    expect(pkt.Instruction).toBe("FRC_LinearMotion");
    expect(pkt.SequenceID).toBe(5);
    expect(pkt.Position).toMatchObject({ X: 10, Y: 20, Z: 30, W: 180 });
  });

  it("buildFanucInstruction → FRC_JointMotion for joint params + home", async () => {
    const { buildFanucInstruction } = await import("./fanucDriver");
    const j = buildFanucInstruction({ jobType: "move", params: { joints: [1, 2, 3, 4, 5, 6] } }, 2);
    expect(j.Instruction).toBe("FRC_JointMotion");
    expect(j.JointAngle).toMatchObject({ J1: 1, J6: 6 });
    const home = buildFanucInstruction({ jobType: "home" }, 1);
    expect(home.Instruction).toBe("FRC_JointMotion");
  });
});

describe("FanucDriver — session + read path", () => {
  beforeEach(() => {
    vi.resetModules();
    nextSocket = null;
    connectCalls = 0;
    delete process.env.ROBOT_CONTROL_ENABLED;
  });
  afterEach(() => { delete process.env.ROBOT_CONTROL_ENABLED; });

  it("connect: Connect handshake + GetStatus probe → connected", async () => {
    const { d, sock } = await connectedDriver();
    expect(d.isConnected()).toBe(true);
    // sent FRC_Connect then FRC_GetStatus during connect (read-only, NO Initialize)
    const types = sock.written.map((w) => JSON.parse(w.trim())).map((p) => p.Communication ?? p.Command);
    expect(types).toEqual(["FRC_Connect", "FRC_GetStatus"]);
    expect(types).not.toContain("FRC_Initialize");
    const h = await d.health();
    expect(h.connected).toBe(true);
    expect(h.vendor).toBe("fanuc");
  });

  it("connect fail: FRC_Connect ErrorID != 0 → throws, stays disconnected, lastError set", async () => {
    nextSocket = makeController((pkt) =>
      pkt.Communication === "FRC_Connect" ? { Communication: "FRC_Connect", ErrorID: 2 } : defaultResponder(pkt),
    );
    const { FanucDriver } = await import("./fanucDriver");
    const drv = new FanucDriver();
    await expect(drv.connect({ endpoint: "127.0.0.1:16001" })).rejects.toThrow(/ErrorID 2/);
    expect(drv.isConnected()).toBe(false);
    const h = await drv.health();
    expect(h.lastError).toMatch(/ErrorID 2/);
  });

  it("getState: status + position register → telemetry pose (cartesian)", async () => {
    const { d } = await connectedDriver();
    const s = await d.getState();
    expect(s.mode).toBe("auto");            // TPMode 0
    expect(s.busy).toBe(false);             // RMIMotionStatus 0 + ProgramStatus 0
    expect(s.estop).toBeUndefined();        // honest: RMI GetStatus has no e-stop flag
    expect(s.error).toBeUndefined();        // ErrorID 0
    expect(s.pose?.cartesian).toMatchObject({ x: 100.5, y: -20, z: 300, rx: 180, rz: 90 });
    expect(s.pose?.frame).toBe("world");
    expect(s.firmwareVersion).toBe("RMI 1.3");
  });

  it("getState: non-zero ErrorID surfaces as error string", async () => {
    // The 1st GetStatus is the connect-time probe (must be OK); the 2nd is getState().
    let statusCalls = 0;
    const { d } = await connectedDriver((pkt) => {
      if (pkt.Command === "FRC_GetStatus") {
        statusCalls++;
        return statusCalls === 1
          ? { Command: "FRC_GetStatus", ErrorID: 0, TPMode: 0, RMIMotionStatus: 0 }
          : { Command: "FRC_GetStatus", ErrorID: 7, TPMode: 1, RMIMotionStatus: 1 };
      }
      return defaultResponder(pkt);
    });
    const s = await d.getState();
    expect(s.error).toMatch(/7/);
    expect(s.mode).toBe("t1");              // TPMode 1
    expect(s.busy).toBe(true);              // RMIMotionStatus 1
  });
});

describe("FanucDriver — motion gate + fail-safe", () => {
  beforeEach(() => {
    vi.resetModules();
    nextSocket = null;
    connectCalls = 0;
    delete process.env.ROBOT_CONTROL_ENABLED;
  });
  afterEach(() => { delete process.env.ROBOT_CONTROL_ENABLED; });

  it("runJob dry-run: builds instruction but writes NO motion packet (gate honored)", async () => {
    const { d, sock } = await connectedDriver();
    const before = sock.written.length;                 // FRC_Connect + FRC_GetStatus
    const res = await d.runJob({ jobType: "move", params: { x: 1, y: 2, z: 3 } });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("done");
    expect(res.detail?.dryRun).toBe(true);
    expect(res.detail?.sent).toBe(false);
    expect((res.detail?.packet as any)?.Instruction).toBe("FRC_LinearMotion");
    // The driver did NOT self-authorize: no new bytes on the wire, no Initialize.
    expect(sock.written.length).toBe(before);
    const allTypes = sock.written.map((w) => JSON.parse(w.trim())).map((p) => p.Command ?? p.Instruction);
    expect(allTypes).not.toContain("FRC_Initialize");
    expect(allTypes).not.toContain("FRC_LinearMotion");
  });

  it("runJob live: ROBOT_CONTROL_ENABLED=true → FRC_Initialize then the instruction", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { d, sock } = await connectedDriver();
    const res = await d.runJob({ jobType: "move", params: { joints: [10, 0, 0, 0, 0, 0] } });
    expect(res.ok).toBe(true);
    expect(res.detail?.sent).toBe(true);
    const types = sock.written.map((w) => JSON.parse(w.trim())).map((p) => p.Command ?? p.Instruction);
    expect(types).toContain("FRC_Initialize");
    expect(types).toContain("FRC_JointMotion");
    // Initialize is sent BEFORE the motion instruction.
    expect(types.indexOf("FRC_Initialize")).toBeLessThan(types.indexOf("FRC_JointMotion"));
  });

  it("runJob live: instruction ErrorID != 0 → failed result (no throw)", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { d } = await connectedDriver((pkt) => {
      if (typeof pkt.Instruction === "string") return { Instruction: pkt.Instruction, ErrorID: 5, SequenceID: pkt.SequenceID };
      return defaultResponder(pkt);
    });
    const res = await d.runJob({ jobType: "move", params: { x: 1, y: 1, z: 1 } });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/ErrorID 5/);
  });

  it("runJob: not connected → failed result, never throws", async () => {
    const { FanucDriver } = await import("./fanucDriver");
    const d = new FanucDriver();
    const res = await d.runJob({ jobType: "home" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not connected/);
  });

  it("disconnect + health handled without throwing (connected and never-connected)", async () => {
    const { d } = await connectedDriver();
    await expect(d.disconnect()).resolves.toBeUndefined();
    expect(d.isConnected()).toBe(false);

    const { FanucDriver } = await import("./fanucDriver");
    const fresh = new FanucDriver();
    await expect(fresh.disconnect()).resolves.toBeUndefined();
    const h = await fresh.health();
    expect(h.connected).toBe(false);
    expect(h.vendor).toBe("fanuc");
  });
});
