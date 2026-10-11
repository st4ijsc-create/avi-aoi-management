/**
 * doc 81 Đợt 9 task U2 — END TO END: e-stop LATCH bit on an in-process Modbus TCP PLC (modbus-serial ServerTCP, 127.0.0.1,
 * OS-assigned port), production read path: defaultBackendFor ⇒ OtReadSafetyPlcBackend("modbus") ⇒ the registry's real
 * ModbusDriver. Only the record doors, the durable store and the leader gate are seams.
 * The TEST plays the PLC program: on a press it sets the e-stop coil AND the latch coil; the release clears only the e-stop
 * coil; the operator's reset clears the latch coil. Oracles independent of product code: the server's own coil store, a
 * per-address READ counter and a WRITE counter (L-7: the server never writes — in particular it never clears the latch).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused"; // quiet the [OAuth] import-time stderr (no call is made)
});
import * as ModbusSerialNs from "modbus-serial";
import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import type { RecordSafetyEventInput } from "../safetyAuditService";
import type { PollStateRow, PollStateStore } from "./safetyPlcPollerHealth";
import "../../ot"; // registers the real modbus / opcua drivers (production side effect)
import { SafetyPlcPoller } from "./safetyPlcPoller";
import { OtReadSafetyPlcBackend } from "./safetyPlcAdapter";

vi.setConfig({ testTimeout: 60_000 });
const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

const PLC = { coils: new Map<number, boolean>(), discretes: new Map<number, boolean>(), holding: new Map<number, number>(), reads: new Map<number, number>(), writes: 0, port: 0 };
let srv: any;
const saved = process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS;

beforeAll(async () => {
  process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = "3000";
  srv = new ServerTCP(
    {
      getCoil: (addr: number) => {
        PLC.reads.set(addr, (PLC.reads.get(addr) ?? 0) + 1);
        return PLC.coils.get(addr) ?? false;
      },
      getDiscreteInput: (addr: number) => PLC.discretes.get(addr) ?? false, // U fix 1 — read-only latch (function code 02)
      getHoldingRegister: (addr: number) => PLC.holding.get(addr) ?? 0, // U fix 1 — PLC heartbeat counter
      getInputRegister: () => 0,
      setCoil: () => {
        PLC.writes += 1;
      },
      setRegister: () => {
        PLC.writes += 1;
      },
    },
    // modbus-serial does `options.port || 502` ⇒ the string "0" asks the OS for a free port (numeric 0 would bind 502)
    { host: "127.0.0.1", port: "0", unitID: 1 },
  );
  await new Promise<void>((resolve, reject) => {
    srv.once("initialized", () => resolve());
    srv.once("serverError", reject);
  });
  PLC.port = srv._server.address().port;
  expect(PLC.port).toBeGreaterThan(0);
  expect(PLC.port).not.toBe(502);
});
afterAll(async () => {
  await new Promise<void>((resolve) => {
    for (const s of srv?.socks?.keys?.() ?? []) (s as { destroy: () => void }).destroy();
    srv ? srv.close(() => resolve()) : resolve();
  });
  if (saved === undefined) delete process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS;
  else process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS = saved;
});

// coil:N is 1-based ⇒ server address N-1: estop = 0, guard = 1, latch = 2
const ESTOP = 0;
const LATCH = 2;
function cfg(): SafetyPlcConfig {
  return {
    id: 92, code: "U2-MB", name: "u2 modbus", vendor: "pilz", backend: "modbus", endpoint: `tcp://127.0.0.1:${PLC.port}`,
    statusMap: { estop: { address: "coil:1" }, zoneOccupied: { address: "coil:2" }, estopLatch: { address: "coil:3" }, pollIntervalMs: 1000 },
    robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2,
    createdAt: new Date(), updatedAt: new Date(),
  } as SafetyPlcConfig;
}
function memStore(): PollStateStore & { rows: Map<number, PollStateRow> } {
  const rows = new Map<number, PollStateRow>();
  return { rows, load: async (id) => rows.get(id) ?? null, save: async (r) => void rows.set(r.configId, JSON.parse(JSON.stringify(r))), list: async () => [...rows.values()], claimStaleAlarm: async () => false };
}

describe("Đợt 9 U2 — e-stop latch on a real (in-process) Modbus PLC", () => {
  it("★ a press + release between two polls is recorded via the latch; the operator clears the latch; the server never writes", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const recs: Array<{ door: string; input: RecordSafetyEventInput }> = [];
    const store = memStore();
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [cfg()],
      recordPlain: async (i) => (recs.push({ door: "plain", input: i }), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push({ door: "trusted", input: i }), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: store,
    });
    try {
      PLC.coils.clear();
      await p.refreshConfigs();
      await p.pollNow(92); // all clear ⇒ online silently
      expect(recs).toEqual([]);
      expect(PLC.reads.get(LATCH) ?? 0).toBeGreaterThan(0); // the latch coil IS read by the poller

      // the PLC program: press ⇒ e-stop coil + latch coil; the release (before the next poll) clears only the e-stop coil
      PLC.coils.set(ESTOP, true);
      PLC.coils.set(LATCH, true);
      PLC.coils.set(ESTOP, false);
      await p.pollNow(92);
      expect(recs.map((r) => [r.door, r.input.eventType, (r.input.humanPosition as Record<string, unknown>).transition])).toEqual([
        ["trusted", "estop", "latched"],
        ["trusted", "estop_released", "released"],
      ]);
      expect(String(recs[0].input.notes)).not.toContain("127.0.0.1");
      expect(PLC.coils.get(LATCH)).toBe(true); // still set: the server did not clear it

      await p.pollNow(92); // latch still set ⇒ nothing new
      expect(recs).toHaveLength(2);
      PLC.coils.set(LATCH, false); // the operator's reset (PLC-side)
      await p.pollNow(92);
      expect(recs).toHaveLength(2);
      expect(store.rows.get(92)).toMatchObject({ link: "online", flags: { estop: false, estopLatch: false } });
      expect(PLC.writes, "L-7: the server never writes (never clears the latch)").toBe(0);
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });

  it("★ the actuation preflight's read (readChecked without options) does NOT read the latch coil (it judges the live tags only)", async () => {
    const before = PLC.reads.get(LATCH) ?? 0;
    const beforeEstop = PLC.reads.get(ESTOP) ?? 0;
    const b = new OtReadSafetyPlcBackend("modbus", cfg().endpoint!, cfg().statusMap as never, 3000);
    const r = await b.readChecked();
    expect(r.latch).toBeUndefined();
    expect(PLC.reads.get(ESTOP) ?? 0).toBeGreaterThan(beforeEstop);
    expect(PLC.reads.get(LATCH) ?? 0).toBe(before);
    const withLatch = await b.readChecked({ withLatch: true });
    expect(withLatch.latch).toEqual({ estopLatch: false, unreadable: false });
    expect(PLC.writes).toBe(0);
  });
});

describe("Đợt 9 U fix 1 — read-only latch on a DISCRETE input + PLC heartbeat register (real Modbus PLC)", () => {
  it("★ latch on discrete:3 ⇒ the latched press is recorded and 'set since' persisted; a frozen heartbeat ⇒ 'plc_offline'; counting again ⇒ online; 0 writes", async () => {
    const quiet = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
    const c = {
      ...cfg(),
      id: 93,
      statusMap: { estop: { address: "coil:1" }, estopLatch: { address: "discrete:3" }, heartbeat: { address: "holding:40010", maxSilentMs: 1000 }, pollIntervalMs: 250 },
    } as SafetyPlcConfig;
    const recs: Array<{ input: RecordSafetyEventInput }> = [];
    const store = memStore();
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [c],
      recordPlain: async (i) => (recs.push({ input: i }), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push({ input: i }), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: store,
    });
    const types = () => recs.map((r) => r.input.eventType);
    try {
      PLC.coils.clear();
      PLC.discretes.clear();
      PLC.holding.set(9, 1); // holding:40010 ⇒ register 9
      await p.refreshConfigs();
      await p.pollNow(93);
      expect(recs).toEqual([]);
      PLC.discretes.set(2, true); // the PLC program latched a short press (discrete:3 ⇒ input 2)
      PLC.holding.set(9, 2);
      await p.pollNow(93);
      expect(types()).toEqual(["estop", "estop_released"]);
      expect(store.rows.get(93)?.latchSetAt).toEqual(expect.any(Number));
      await new Promise((r) => setTimeout(r, 1200)); // the heartbeat stays at 2 for > 1 s
      await p.pollNow(93);
      expect(types()).toEqual(["estop", "estop_released", "plc_offline"]);
      expect(String(recs[2].input.notes)).toMatch(/PLC heartbeat tag unchanged/);
      for (const v of [3, 4]) {
        PLC.holding.set(9, v);
        await p.pollNow(93);
      }
      expect(types()).toEqual(["estop", "estop_released", "plc_offline", "plc_online"]);
      expect(PLC.writes, "L-7: the server never writes").toBe(0);
    } finally {
      await p.stop();
      quiet.forEach((q) => q.mockRestore());
    }
  });
});
