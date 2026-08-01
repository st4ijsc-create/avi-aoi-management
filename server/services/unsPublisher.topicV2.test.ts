/**
 * doc 44 W2-A1 / G2.1+G1.5 — unsPublisher v2 dual-publish tests.
 *
 * Proves the flag-gated (UNS_TOPIC_V2_ENABLED, default OFF) dual-publish onto
 * the spec tree syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}:
 *
 *  - flag OFF → ZERO v2 publishes (legacy behaviour byte-for-byte)
 *  - errors → .../events (QoS1, canonical event wrap w/ event_id/asset_id)
 *  - status → .../state (retained QoS1, publish on CHANGE only)
 *  - heartbeat → .../health (retained QoS1, online + last_seen)
 *  - adapter tag sample → .../telemetry (canonical {asset_id,ts,seq,metrics[]},
 *    seq monotonic per topic)
 *  - Sparkplug DDATA → v2 telemetry via adapter-code→machine resolution
 *  - cmd_ack → v2 machine-addressed topic IN ADDITION to the legacy
 *    adapter-addressed placeholder (compat preserved)
 *  - unresolvable machine → v2 skipped (legacy untouched, honest warn)
 *  - health sweep: online adapters publish retained health; adapters without
 *    machineId or never-seen offline adapters are honestly skipped
 *
 * mqtt / DB / resolver / OT manager are mocked — no broker, no DB.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── hoisted fakes ─────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...a: any[]) => void>>();
  const fakeClient = {
    on: vi.fn((ev: string, cb: (...a: any[]) => void) => {
      const list = handlers.get(ev) ?? [];
      list.push(cb);
      handlers.set(ev, list);
    }),
    publish: vi.fn(),
    subscribe: vi.fn(),
    removeListener: vi.fn(),
    end: vi.fn((_f: any, _o: any, cb: () => void) => cb()),
  };
  return {
    handlers,
    fakeClient,
    fire(ev: string, ...args: any[]) {
      for (const cb of handlers.get(ev) ?? []) cb(...args);
    },
    otAdapters: [] as any[],
  };
});

const r = vi.hoisted(() => ({
  resolveIsa95Path: vi.fn(),
  resolveIsa95PathByStation: vi.fn(),
  resolveMachineIdByAdapterId: vi.fn(),
  resolveMachineIdByAdapterCode: vi.fn(),
}));

vi.mock("mqtt", () => ({ default: { connect: vi.fn(() => h.fakeClient) } }));
// Real unsBridge (parseAviTopic needed) with the bridge flag forced ON.
vi.mock("./unsBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./unsBridge")>();
  return { ...actual, isUnsBridgeEnabled: () => true };
});
vi.mock("./uns/isa95Resolver", () => r);
// Deterministic Sparkplug node (no protobuf encode needed here).
vi.mock("./uns/sparkplugNode", () => ({
  SparkplugNode: class {
    state = { isDeviceBirthed: () => true };
    buildNdeath() {
      return { topic: "spBv1.0/g/NDEATH/e", buffer: Buffer.alloc(0) };
    }
    buildNbirth() {
      return { topic: "spBv1.0/g/NBIRTH/e", buffer: Buffer.alloc(0) };
    }
    buildDbirth() {
      return { topic: "spBv1.0/g/DBIRTH/e/d", buffer: Buffer.alloc(0) };
    }
    buildDdata() {
      return { topic: "spBv1.0/g/DDATA/e/d", buffer: Buffer.alloc(0) };
    }
    buildDdeath() {
      return { topic: "spBv1.0/g/DDEATH/e/d", buffer: Buffer.alloc(0) };
    }
    buildRebirth() {
      return [];
    }
  },
}));
// Cut heavy chains — never exercised here.
vi.mock("./ot/commandDispatcher", () => ({ dispatch: vi.fn() }));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../drizzle/schema", () => ({ machines: {}, deviceAdapters: {} }));
vi.mock("./uns/unsAggregates", () => ({
  startUnsAggregates: vi.fn(),
  stopUnsAggregates: vi.fn(),
}));
vi.mock("./ot/otManager", () => ({ listActiveAdapters: () => h.otAdapters }));

import {
  initUnsPublisher,
  publishNormalized,
  publishSparkplugDData,
  publishCmdAck,
  runV2HealthSweepOnce,
  resetUnsV2StateForTests,
  getUnsV2Stats,
  type CmdAckMessage,
} from "./unsPublisher";

// ── helpers ───────────────────────────────────────────────────────────────────
async function until(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("condition not met in time");
    await new Promise((res) => setTimeout(res, 5));
  }
}

/** All publishes on the v2 tree (mock resolver roots at syn/hanoi/...). */
function v2Calls(substr = "syn/hanoi/"): any[][] {
  return h.fakeClient.publish.mock.calls.filter((c: any[]) => String(c[0]).includes(substr));
}

async function settle(ms = 40): Promise<void> {
  await new Promise((res) => setTimeout(res, ms));
}

const NG_PAYLOAD = {
  machine: { id: 5, name: "AOI 01", code: "AOI-01" },
  severity: "high",
  error: { code: "E42", description: "solder bridge" },
  inspectionId: 777,
  totalNG: 3,
  product: { serialNumber: "SN-1" },
  timestamp: "2026-07-12T01:00:00.000Z",
};

beforeAll(() => {
  process.env.UNS_SPARKPLUG_ENABLED = "true"; // so init creates the (mock) node
  initUnsPublisher();
  h.fire("connect"); // connected = true
});

beforeEach(() => {
  delete process.env.UNS_TOPIC_V2_ENABLED;
  delete process.env.UNS_CMD_ACK_ENABLED;
  process.env.UNS_SPARKPLUG_ENABLED = "true";
  resetUnsV2StateForTests();
  h.fakeClient.publish.mockClear();
  h.otAdapters.length = 0;

  r.resolveIsa95Path.mockReset().mockImplementation(async (id: number) => ({
    site: "hanoi",
    area: "assy",
    line: "line1",
    cell: "cell3",
    equipment: `m${id}`,
  }));
  r.resolveIsa95PathByStation.mockReset().mockImplementation(async (sid: number) => ({
    site: "hanoi",
    area: "assy",
    line: "line1",
    cell: `st${sid}`,
    equipment: "aoi-01",
  }));
  r.resolveMachineIdByAdapterId.mockReset().mockResolvedValue(5);
  r.resolveMachineIdByAdapterCode.mockReset().mockResolvedValue(9);
});

describe("G1.5 — dual-publish gate (default OFF)", () => {
  it("flag OFF → publishNormalized emits ZERO v2 publishes", async () => {
    publishNormalized("avi/factory/1/workshop/2/station/3/errors", NG_PAYLOAD);
    await settle();
    expect(v2Calls()).toHaveLength(0);
    expect(r.resolveIsa95Path).not.toHaveBeenCalled();
    expect(r.resolveIsa95PathByStation).not.toHaveBeenCalled();
  });

  it("flag OFF → publishSparkplugDData emits ZERO v2 publishes", async () => {
    publishSparkplugDData("ADP1", [{ name: "temp", type: "Double", value: 1, timestamp: 1 }]);
    await settle();
    expect(v2Calls()).toHaveLength(0);
    expect(r.resolveMachineIdByAdapterCode).not.toHaveBeenCalled();
  });
});

describe("G2.1 — legacy avi message → v2 aspects", () => {
  it("errors → syn/.../events QoS1 with canonical event wrap (machine.id resolution)", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    publishNormalized("avi/factory/1/workshop/2/station/3/errors", NG_PAYLOAD);
    await until(() => v2Calls().length >= 1);

    const [topic, buf, opts] = v2Calls()[0];
    expect(topic).toBe("syn/hanoi/assy/line1/cell3/m5/events");
    expect(opts).toEqual({ qos: 1, retain: false });
    const ev = JSON.parse(String(buf));
    expect(ev.event_id).toMatch(/[0-9a-f-]{36}/);
    expect(ev.asset_id).toBe("urn:syn:asset:hanoi:line1:cell3:m5");
    expect(ev.type).toBe("fault");
    expect(ev.severity).toBe("error"); // "high" normalized
    expect(ev.ts).toBe("2026-07-12T01:00:00.000Z");
    expect(ev.cause).toBe("E42: solder bridge");
    expect(ev.payload).toEqual({ inspectionId: 777, totalNG: 3, serialNumber: "SN-1" });
    expect(r.resolveIsa95Path).toHaveBeenCalledWith(5); // machine hint wins over station
  });

  it("status → syn/.../state retained QoS1, published on CHANGE only", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    publishNormalized("avi/factory/1/workshop/2/station/3/status", { status: "running" });
    await until(() => v2Calls().length >= 1);
    publishNormalized("avi/factory/1/workshop/2/station/3/status", { status: "running" }); // same → dedup
    await settle();
    publishNormalized("avi/factory/1/workshop/2/station/3/status", { status: "stopped" }); // change
    await until(() => v2Calls().length >= 2);

    const calls = v2Calls();
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("syn/hanoi/assy/line1/st3/aoi-01/state");
    expect(calls[0][2]).toEqual({ qos: 1, retain: true });
    const s1 = JSON.parse(String(calls[0][1]));
    expect(s1.path).toBe("hanoi/assy/line1/st3/aoi-01");
    expect(s1.state).toBe("EXECUTE");
    expect(typeof s1.ts).toBe("string");
    const s2 = JSON.parse(String(calls[1][1]));
    expect(s2.state).toBe("STOPPED");
    // no machineId in payload → resolved via the numeric station id from topic
    expect(r.resolveIsa95PathByStation).toHaveBeenCalledWith(3);
  });

  it("heartbeat → syn/.../health retained QoS1 (online + last_seen)", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    publishNormalized("avi/factory/1/workshop/2/station/3/heartbeat", {
      timestamp: "2026-07-12T02:00:00.000Z",
    });
    await until(() => v2Calls().length >= 1);
    const [topic, buf, opts] = v2Calls()[0];
    expect(topic).toBe("syn/hanoi/assy/line1/st3/aoi-01/health");
    expect(opts).toEqual({ qos: 1, retain: true });
    const hp = JSON.parse(String(buf));
    expect(hp.asset_id).toBe("urn:syn:asset:hanoi:line1:st3:aoi-01");
    expect(hp.status).toBe("online");
    expect(hp.last_seen).toBe("2026-07-12T02:00:00.000Z");
  });

  it("adapter tag sample → syn/.../telemetry (canonical shape, seq monotonic)", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    const sample = (v: number) => ({
      adapterId: 4,
      machineId: 9,
      tagKey: "temp",
      value: v,
      quality: "good",
      timestamp: "2026-07-12T03:00:00.000Z",
    });
    publishNormalized("avi/0/workshop/ot/station/ADP1/temp", sample(23.5));
    await until(() => v2Calls().length >= 1);
    publishNormalized("avi/0/workshop/ot/station/ADP1/temp", sample(24.0));
    await until(() => v2Calls().length >= 2);

    const calls = v2Calls();
    expect(calls[0][0]).toBe("syn/hanoi/assy/line1/cell3/m9/telemetry");
    expect(calls[0][2]).toEqual({ qos: 0, retain: false });
    const t1 = JSON.parse(String(calls[0][1]));
    expect(t1.asset_id).toBe("urn:syn:asset:hanoi:line1:cell3:m9");
    expect(t1.ts).toBe("2026-07-12T03:00:00.000Z");
    expect(t1.seq).toBe(1);
    expect(t1.metrics).toEqual([
      { name: "temp", value: 23.5, quality: "good", ts: "2026-07-12T03:00:00.000Z" },
    ]);
    const t2 = JSON.parse(String(calls[1][1]));
    expect(t2.seq).toBe(2); // monotonic per topic
    expect(r.resolveIsa95Path).toHaveBeenCalledWith(9); // payload machineId used
  });

  it("unresolvable path → v2 skipped with honest warn (legacy untouched)", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.resolveIsa95PathByStation.mockResolvedValue(null);
    const before = getUnsV2Stats();
    publishNormalized("avi/factory/1/workshop/2/station/44/status", { status: "running" });
    await until(() => getUnsV2Stats().skipped > before.skipped);
    expect(v2Calls()).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("G2.1 — Sparkplug DDATA → v2 telemetry", () => {
  it("resolves adapter code → machine → publishes canonical telemetry", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    publishSparkplugDData("ADP1", [
      { name: "temp", type: "Double", value: 21.7, timestamp: 1752285600000 },
    ]);
    await until(() => v2Calls().length >= 1);
    const [topic, buf, opts] = v2Calls()[0];
    expect(topic).toBe("syn/hanoi/assy/line1/cell3/m9/telemetry");
    expect(opts).toEqual({ qos: 0, retain: false });
    const t = JSON.parse(String(buf));
    expect(t.metrics).toEqual([
      { name: "temp", value: 21.7, ts: new Date(1752285600000).toISOString() },
    ]);
    expect(r.resolveMachineIdByAdapterCode).toHaveBeenCalledWith("ADP1");
  });

  it("unknown adapter code → skipped honestly (no v2 publish)", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.resolveMachineIdByAdapterCode.mockResolvedValue(null);
    const before = getUnsV2Stats();
    publishSparkplugDData("GHOST", [{ name: "x", type: "Double", value: 1, timestamp: 1 }]);
    await until(() => getUnsV2Stats().skipped > before.skipped);
    expect(v2Calls()).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("G1.5 — cmd_ack dual-publish (machine-addressed v2 + legacy compat)", () => {
  const ack: CmdAckMessage = {
    command_id: "key-1",
    correlation_id: "corr-1",
    status: "acked",
    reason: null,
    ts: "2026-07-12T04:00:00.000Z",
    result: [{ tagKey: "cmd_start", ok: true }],
  };

  it("v2 ON → legacy adapter topic AND syn/.../cmd_ack both published", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    expect(publishCmdAck(ack, { adapterId: 10, machineId: 5 })).toBe(true);
    await until(() => v2Calls().length >= 1);

    // legacy placeholder topic kept for compatibility
    const legacy = h.fakeClient.publish.mock.calls.find((c: any[]) =>
      String(c[0]).includes("/cmd_ack/adapter/10"),
    );
    expect(legacy).toBeTruthy();

    const [topic, buf, opts] = v2Calls()[0];
    expect(topic).toBe("syn/hanoi/assy/line1/cell3/m5/cmd_ack");
    expect(opts).toEqual({ qos: 1, retain: false });
    expect(JSON.parse(String(buf))).toEqual(ack as any);
  });

  it("machineId absent → resolved via adapterId", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    publishCmdAck(ack, { adapterId: 10 });
    await until(() => v2Calls().length >= 1);
    expect(r.resolveMachineIdByAdapterId).toHaveBeenCalledWith(10);
    expect(v2Calls()[0][0]).toBe("syn/hanoi/assy/line1/cell3/m5/cmd_ack");
  });

  it("unresolvable machine → legacy only, v2 skipped (honest warn)", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.resolveMachineIdByAdapterId.mockResolvedValue(null);
    const before = getUnsV2Stats();
    expect(publishCmdAck(ack, { adapterId: 77 })).toBe(true); // legacy still works
    await until(() => getUnsV2Stats().skipped > before.skipped);
    expect(v2Calls()).toHaveLength(0);
    warn.mockRestore();
  });

  it("v2 OFF → legacy topic only (regression guard)", async () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    expect(publishCmdAck(ack, { adapterId: 10, machineId: 5 })).toBe(true);
    await settle();
    expect(v2Calls()).toHaveLength(0);
    expect(h.fakeClient.publish).toHaveBeenCalledTimes(1);
  });
});

describe("G2.1 — v2 health sweep (adapter/supervisor source)", () => {
  it("connected adapter → retained online health; no machineId / never-seen offline → skipped", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.otAdapters.push(
      { adapterId: 1, code: "ADP-ON", machineId: 9, driver: { isConnected: () => true } },
      { adapterId: 2, code: "ADP-NOMACHINE", machineId: null, driver: { isConnected: () => true } },
      { adapterId: 3, code: "ADP-NEVERSEEN", machineId: 11, driver: { isConnected: () => false } },
    );
    await runV2HealthSweepOnce();

    const calls = v2Calls();
    expect(calls).toHaveLength(1); // only the connected, machine-mapped adapter
    const [topic, buf, opts] = calls[0];
    expect(topic).toBe("syn/hanoi/assy/line1/cell3/m9/health");
    expect(opts).toEqual({ qos: 1, retain: true });
    const hp = JSON.parse(String(buf));
    expect(hp.status).toBe("online");
    expect(typeof hp.last_seen).toBe("string");
    expect(warn).toHaveBeenCalled(); // honest warn for the unmapped adapter
    warn.mockRestore();
  });

  it("adapter observed online then disconnected → offline with LAST OBSERVED last_seen", async () => {
    process.env.UNS_TOPIC_V2_ENABLED = "true";
    let connectedNow = true;
    h.otAdapters.push({
      adapterId: 1,
      code: "ADP-FLAP",
      machineId: 9,
      driver: { isConnected: () => connectedNow },
    });
    await runV2HealthSweepOnce(); // online
    const onlineCall = v2Calls().at(-1)!;
    const onlineSeen = JSON.parse(String(onlineCall[1])).last_seen;

    connectedNow = false;
    await runV2HealthSweepOnce(); // offline transition (status change → publish)
    const calls = v2Calls();
    expect(calls).toHaveLength(2);
    const off = JSON.parse(String(calls[1][1]));
    expect(off.status).toBe("offline");
    expect(off.last_seen).toBe(onlineSeen); // never fabricated forward
  });

  it("flag OFF → sweep is a complete no-op", async () => {
    h.otAdapters.push({ adapterId: 1, code: "A", machineId: 9, driver: { isConnected: () => true } });
    await runV2HealthSweepOnce();
    expect(v2Calls()).toHaveLength(0);
  });
});
