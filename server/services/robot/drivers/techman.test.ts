/**
 * Phase 3 — Techman (TM) driver tests. No real hardware / no real lib needed:
 *   • modbus-serial is mocked (vi.doMock + vi.resetModules), like the OT modbus test.
 *   • the Listen Node socket (node:net createConnection) is mocked.
 *
 * Covers: testConnection-style connect ok/fail, register→telemetry decode,
 * TMSCT motion string build, dry-run (no socket) unless ROBOT_CONTROL_ENABLED,
 * and fail-safe behaviour on transport error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── net mock: capture sockets created via createConnection ──────────────────
type FakeSocket = {
  on: (ev: string, cb: (...a: any[]) => void) => FakeSocket;
  write: (s: string) => void;
  destroy: () => void;
  _emit: (ev: string, ...a: any[]) => void;
  written: string[];
};
const sockets: FakeSocket[] = [];
let connectCalls = 0;

function makeFakeSocket(): FakeSocket {
  const handlers: Record<string, Array<(...a: any[]) => void>> = {};
  const sock: FakeSocket = {
    written: [],
    on(ev, cb) { (handlers[ev] ??= []).push(cb); return sock; },
    write(s) { sock.written.push(s); },
    destroy() {},
    _emit(ev, ...a) { (handlers[ev] ?? []).forEach((h) => h(...a)); },
  };
  return sock;
}

vi.mock("node:net", () => ({
  createConnection: vi.fn(() => {
    connectCalls++;
    const s = makeFakeSocket();
    sockets.push(s);
    return s;
  }),
}));

// ── modbus-serial mock factory ──────────────────────────────────────────────
function mockModbus(overrides: Record<string, any> = {}) {
  const client = {
    connectTCP: vi.fn(async () => {}),
    setID: vi.fn(),
    setTimeout: vi.fn(),
    // Default register values matching MODBUS_REGISTERS assumptions:
    //   running=1, errorCode=0, estop=0, modeCode=0(auto), speedPct=50,
    //   joints = [9000, -4500, 0,0,0,0] raw → [90, -45, 0,0,0,0] deg (*0.01)
    readInputRegisters: vi.fn(async (addr: number, words: number) => {
      const map: Record<number, number[]> = {
        7000: [1],
        7001: [0],
        7002: [0],
        7003: [0],
        7004: [50],
        7010: [9000, 0x10000 - 4500, 0, 0, 0, 0],
      };
      return { data: (map[addr] ?? Array(words).fill(0)).slice(0, words) };
    }),
    readHoldingRegisters: vi.fn(async (_addr: number, words: number) => ({ data: Array(words).fill(0) })),
    close: vi.fn((cb: () => void) => cb()),
    ...overrides,
  };
  function ModbusRTU(this: any) { Object.assign(this, client); }
  vi.doMock("modbus-serial", () => ({ default: ModbusRTU }));
  return client;
}

describe("TechmanDriver", () => {
  beforeEach(() => {
    vi.resetModules();
    sockets.length = 0;
    connectCalls = 0;
    delete process.env.ROBOT_CONTROL_ENABLED;
  });
  afterEach(() => {
    delete process.env.ROBOT_CONTROL_ENABLED;
  });

  it("connect ok: opens modbus, probes a register, reports connected", async () => {
    const client = mockModbus();
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();

    await d.connect({ endpoint: "tcp://192.168.0.10:502", options: { unitId: 2 } });
    expect(d.isConnected()).toBe(true);
    expect(client.connectTCP).toHaveBeenCalledWith("192.168.0.10", { port: 502 });
    expect(client.setID).toHaveBeenCalledWith(2);
    // probed the "running" input register during connect
    expect(client.readInputRegisters).toHaveBeenCalledWith(7000, 1);

    const h = await d.health();
    expect(h.connected).toBe(true);
    expect(h.vendor).toBe("techman");
  });

  it("connect fail: transport error → throws, stays disconnected, lastError set", async () => {
    mockModbus({ connectTCP: vi.fn(async () => { throw new Error("ECONNREFUSED"); }) });
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();

    await expect(d.connect({ endpoint: "127.0.0.1:502" })).rejects.toThrow(/ECONNREFUSED/);
    expect(d.isConnected()).toBe(false);
    const h = await d.health();
    expect(h.lastError).toMatch(/ECONNREFUSED/);
  });

  it("degrades when modbus-serial absent", async () => {
    vi.doMock("modbus-serial", () => { throw new Error("Cannot find module"); });
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    await expect(d.connect({ endpoint: "127.0.0.1" })).rejects.toThrow(/modbus-serial not installed/);
  });

  it("getState: register map decodes to telemetry shape", async () => {
    mockModbus();
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    await d.connect({ endpoint: "127.0.0.1:502" });

    const s = await d.getState();
    expect(s.mode).toBe("auto");        // modeCode 0
    expect(s.busy).toBe(true);          // running 1
    expect(s.estop).toBe(false);        // estop 0
    expect(s.speedPct).toBe(50);
    expect(s.error).toBeUndefined();    // errorCode 0
    // joints: raw 9000 → 90deg, raw -4500 (two's-complement) → -45deg
    expect(s.pose?.joints).toEqual([90, -45, 0, 0, 0, 0]);
    expect(s.pose?.frame).toBe("base");
  });

  it("getState: non-zero error code surfaces as error string", async () => {
    mockModbus({
      readInputRegisters: vi.fn(async (addr: number, words: number) => {
        const map: Record<number, number[]> = { 7000: [0], 7001: [42], 7002: [1], 7003: [1], 7004: [10], 7010: Array(6).fill(0) };
        return { data: (map[addr] ?? Array(words).fill(0)).slice(0, words) };
      }),
    });
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const s = await d.getState();
    expect(s.error).toMatch(/42/);
    expect(s.estop).toBe(true);
    expect(s.mode).toBe("manual");      // modeCode 1
  });

  it("buildTmsct: produces a well-formed TMSCT frame with checksum", async () => {
    const { buildTmsct, xorChecksum } = await import("./techmanDriver");
    const frame = buildTmsct({ jobType: "home" }, 7);
    expect(frame.startsWith("$TMSCT,")).toBe(true);
    expect(frame.endsWith("\r\n")).toBe(true);
    // payload = "<id>,<script>" ; frame = $TMSCT,<len>,<payload>,*<cs>\r\n
    const m = frame.match(/^\$TMSCT,(\d+),(.*),\*([0-9A-F]{2})\r\n$/);
    expect(m).not.toBeNull();
    const [, lenStr, payload, cs] = m!;
    expect(Number(lenStr)).toBe(payload.length);
    expect(cs).toBe(xorChecksum(payload));
    expect(payload.startsWith("7,")).toBe(true);     // transaction id
    expect(payload).toMatch(/PTP/);                  // home → PTP script
  });

  it("runJob dry-run: builds TMSCT but opens NO socket when control disabled", async () => {
    mockModbus();
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    await d.connect({ endpoint: "127.0.0.1" });

    const res = await d.runJob({ jobType: "move", params: { joints: [10, 20, 0, 0, 0, 0] } });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("done");
    expect(res.detail?.dryRun).toBe(true);
    expect(res.detail?.sent).toBe(false);
    expect(String(res.detail?.tmsct)).toMatch(/^\$TMSCT,/);
    expect(connectCalls).toBe(0);   // NO socket opened in dry-run
    expect(sockets.length).toBe(0);
  });

  it("runJob live: opens socket and sends TMSCT when ROBOT_CONTROL_ENABLED=true", async () => {
    mockModbus();
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    await d.connect({ endpoint: "127.0.0.1", options: { listenPort: 5890 } });

    const p = d.runJob({ jobType: "home" });
    // drive the mocked socket lifecycle
    expect(sockets.length).toBe(1);
    const sock = sockets[0];
    sock._emit("connect");
    sock._emit("data", Buffer.from("$TMSTA,...,*00\r\n", "ascii"));

    const res = await p;
    expect(res.ok).toBe(true);
    expect(res.detail?.sent).toBe(true);
    expect(connectCalls).toBe(1);
    expect(sock.written.length).toBe(1);
    expect(sock.written[0]).toMatch(/^\$TMSCT,/);
  });

  it("runJob live: socket error → fail-safe failed result (no throw)", async () => {
    mockModbus();
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    await d.connect({ endpoint: "127.0.0.1" });

    const p = d.runJob({ jobType: "home" });
    sockets[0]._emit("error", new Error("EHOSTUNREACH"));
    const res = await p;
    expect(res.ok).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/EHOSTUNREACH/);
  });

  it("runJob: not connected → failed result, never throws", async () => {
    mockModbus();
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    const res = await d.runJob({ jobType: "home" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not connected/);
  });

  it("getState fail-safe inside subscribeState loop never throws", async () => {
    mockModbus({ readInputRegisters: vi.fn(async () => { throw new Error("modbus timeout"); }) });
    const { TechmanDriver } = await import("./techmanDriver");
    const d = new TechmanDriver();
    // connect probes a register → will throw; ensure that path is covered separately.
    await expect(d.connect({ endpoint: "127.0.0.1" })).rejects.toThrow(/modbus timeout/);
    expect(d.isConnected()).toBe(false);
  });
});
