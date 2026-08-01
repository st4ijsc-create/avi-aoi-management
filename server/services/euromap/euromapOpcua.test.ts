/**
 * I3b-2 — Euromap 77 OPC-UA read-path tests (doc 20 §3/§5).
 *
 * Validates the Euromap OPC-UA reader against a MOCK OpcuaDriver (mocks connect/
 * readTags/disconnect) loaded with a Euromap-77-shaped node set:
 *   • buildTagAddresses maps the node-map → OtTagAddress list (correct data types),
 *   • samplesToReadout assembles GOOD samples → native readout (bad/absent → undefined),
 *   • EuromapAdapter.pollOverOpcua → UEM (recipe/cycle/production/utilization) + routes
 *     the active alarm through the normalizer → Andon (flag-gated), unknown code passes
 *     through, and an unreachable endpoint / empty node-map throws an HONEST error.
 * PURE — no real OPC-UA server, no DB. A real run points at an OPC-UA sim (doc 20 §7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OtDriver, OtSample, OtTagAddress } from "../ot/otDriver";
import {
  buildTagAddresses,
  samplesToReadout,
  readEuromapOverOpcua,
  parseNodeMap,
  type EuromapNodeMap,
} from "./euromapOpcuaReader";
import { EuromapAdapter, mapEuromapToUem } from "./euromapAdapter";

// Mock the Andon sink so the alarm path never touches the DB.
const raiseAndonMock = vi.fn(async (input: any) => ({ id: 321, ...input }));
vi.mock("../andon/andonService", () => ({
  raiseAndon: (...args: any[]) => raiseAndonMock(...args),
}));

const NODE_MAP: EuromapNodeMap = {
  activeMould: "ns=4;s=ActiveMould",
  actualCycleTime: "ns=4;s=ActualCycleTime",
  shotCounter: "ns=4;s=ShotCounter",
  goodPartsCounter: "ns=4;s=GoodPartsCounter",
  targetCycleTime: "ns=4;s=TargetCycleTime",
  machineMode: "ns=4;s=MachineMode",
  alarmNodes: [
    { nodeId: "ns=4;s=Alarm.HotRunner", code: "E77-1200", message: "Hot runner over-temp" },
    { nodeId: "ns=4;s=Alarm.Door", code: "E77-0900", message: "Safety door open" },
  ],
};

/** Build a mock OtDriver whose readTags returns the given samples for the requested tags. */
function mockDriver(values: Record<string, { value: OtSample["value"]; quality?: OtSample["quality"] }>): {
  driver: OtDriver;
  connect: ReturnType<typeof vi.fn>;
  readTags: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  writeTags: ReturnType<typeof vi.fn>;
} {
  const connect = vi.fn(async () => undefined);
  const disconnect = vi.fn(async () => undefined);
  const writeTags = vi.fn(async () => []);
  const readTags = vi.fn(async (tags: OtTagAddress[]): Promise<OtSample[]> =>
    tags.map((t) => {
      const v = values[t.tagKey];
      return {
        tagKey: t.tagKey,
        raw: v?.value ?? null,
        value: v ? v.value : null,
        quality: v?.quality ?? (v ? "good" : "bad"),
        timestamp: new Date(),
      };
    }),
  );
  const driver = {
    protocol: "opcua",
    connect,
    disconnect,
    isConnected: () => true,
    readTags,
    subscribe: vi.fn(),
    writeTags,
    health: vi.fn(async () => ({ protocol: "opcua" as const, connected: true })),
  } as unknown as OtDriver;
  return { driver, connect, readTags, disconnect, writeTags };
}

beforeEach(() => {
  raiseAndonMock.mockClear();
  delete process.env.EQ_INTEG_ENABLED;
});
afterEach(() => {
  delete process.env.EQ_INTEG_ENABLED;
});

describe("buildTagAddresses — node-map → OtTagAddress list", () => {
  it("maps numeric/string/alarm nodes with the right data types", () => {
    const tags = buildTagAddresses(NODE_MAP);
    const byKey = new Map(tags.map((t) => [t.tagKey, t]));
    expect(byKey.get("uem:actualCycleTime")?.dataType).toBe("float");
    expect(byKey.get("uem:activeMould")?.dataType).toBe("string");
    expect(byKey.get("uem:machineMode")?.dataType).toBe("string");
    expect(byKey.get("alarm:0")?.dataType).toBe("bool");
    expect(byKey.get("alarm:0")?.address).toBe("ns=4;s=Alarm.HotRunner");
    expect(tags).toHaveLength(8); // 4 numeric + 2 string + 2 alarm
  });

  it("empty node-map → no tags", () => {
    expect(buildTagAddresses({})).toHaveLength(0);
  });
});

describe("samplesToReadout — GOOD samples → native readout, absent → undefined", () => {
  it("assembles a full readout and flags the active alarm only", () => {
    const { driver } = mockDriver({});
    void driver;
    const samples: OtSample[] = [
      { tagKey: "uem:activeMould", raw: "MOLD-9", value: "MOLD-9", quality: "good", timestamp: new Date() },
      { tagKey: "uem:actualCycleTime", raw: 25, value: 25, quality: "good", timestamp: new Date() },
      { tagKey: "uem:shotCounter", raw: 5000, value: 5000, quality: "good", timestamp: new Date() },
      { tagKey: "uem:goodPartsCounter", raw: 4900, value: 4900, quality: "good", timestamp: new Date() },
      { tagKey: "uem:targetCycleTime", raw: 20, value: 20, quality: "good", timestamp: new Date() },
      { tagKey: "uem:machineMode", raw: "AUTOMATIC", value: "AUTOMATIC", quality: "good", timestamp: new Date() },
      { tagKey: "alarm:0", raw: true, value: true, quality: "good", timestamp: new Date() },
      { tagKey: "alarm:1", raw: false, value: false, quality: "good", timestamp: new Date() },
    ];
    const readout = samplesToReadout(samples, NODE_MAP, { transport: "euromap77", vendor: "euromap" });
    expect(readout.activeMoldId).toBe("MOLD-9");
    expect(readout.shotCounter).toBe(5000);
    expect(readout.goodPartsCounter).toBe(4900);
    expect(readout.actualCycleTimeSec).toBe(25);
    expect(readout.machineMode).toBe("AUTOMATIC");
    expect(readout.alarms).toHaveLength(1); // only alarm:0 is active
    expect(readout.alarms![0].code).toBe("E77-1200");
  });

  it("bad-quality sample → field undefined (never fabricated)", () => {
    const samples: OtSample[] = [
      { tagKey: "uem:shotCounter", raw: null, value: null, quality: "bad", timestamp: new Date() },
    ];
    const readout = samplesToReadout(samples, NODE_MAP);
    expect(readout.shotCounter).toBeUndefined();
    expect(readout.alarms).toBeUndefined();
  });
});

describe("readEuromapOverOpcua — reuses driver, read-only", () => {
  it("connect → readTags → disconnect, never writes", async () => {
    const { driver, connect, readTags, disconnect, writeTags } = mockDriver({
      "uem:shotCounter": { value: 12 },
      "uem:machineMode": { value: "AUTOMATIC" },
    });
    const readout = await readEuromapOverOpcua(driver, {
      endpoint: "opc.tcp://127.0.0.1:4840",
      nodeMap: NODE_MAP,
    });
    expect(connect).toHaveBeenCalledOnce();
    expect(readTags).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(writeTags).not.toHaveBeenCalled();
    expect(readout.shotCounter).toBe(12);
  });

  it("no endpoint → honest error (no fabrication)", async () => {
    const { driver } = mockDriver({});
    await expect(readEuromapOverOpcua(driver, { endpoint: "", nodeMap: NODE_MAP })).rejects.toThrow(/no endpoint/i);
  });

  it("empty node-map → honest error", async () => {
    const { driver } = mockDriver({});
    await expect(
      readEuromapOverOpcua(driver, { endpoint: "opc.tcp://x", nodeMap: {} }),
    ).rejects.toThrow(/empty node-map/i);
  });

  it("unreachable server → the driver's connect error propagates (cache untouched)", async () => {
    const { driver } = mockDriver({});
    (driver.connect as any) = vi.fn(async () => {
      throw new Error("opcua connect timeout after 5000ms");
    });
    await expect(
      readEuromapOverOpcua(driver, { endpoint: "opc.tcp://dead", nodeMap: NODE_MAP }),
    ).rejects.toThrow(/timeout/i);
  });
});

describe("EuromapAdapter.pollOverOpcua — UEM + alarm→Andon (flag-gated)", () => {
  it("FLAG OFF → UEM produced, Andon NOT raised (no-op)", async () => {
    process.env.EQ_INTEG_ENABLED = "false";
    const { driver } = mockDriver({
      "uem:activeMould": { value: "MOLD-9" },
      "uem:shotCounter": { value: 5000 },
      "uem:goodPartsCounter": { value: 4900 },
      "uem:actualCycleTime": { value: 25 },
      "uem:targetCycleTime": { value: 20 },
      "uem:machineMode": { value: "AUTOMATIC" },
      "alarm:0": { value: true },
    });
    const adapter = new EuromapAdapter("IMM-01", undefined, 7);
    const uem = await adapter.pollOverOpcua(driver, { endpoint: "opc.tcp://x", nodeMap: NODE_MAP });
    expect(uem.recipeId).toBe("MOLD-9");
    expect(uem.cycleCount).toBe(5000);
    expect(uem.productionCounter).toBe(4900);
    expect(uem.utilizationRate).toBeCloseTo(0.8, 5);
    expect(uem.alarmCode).toBe("E77-1200");
    expect(raiseAndonMock).not.toHaveBeenCalled(); // flag off → no Andon
    // The local cache is now populated.
    expect(adapter.getCached()?.uem.cycleCount).toBe(5000);
  });

  it("FLAG ON → active alarm routed through the normalizer → Andon with vendor", async () => {
    process.env.EQ_INTEG_ENABLED = "true";
    const { driver } = mockDriver({
      "uem:shotCounter": { value: 100 },
      "uem:machineMode": { value: "AUTOMATIC" },
      "alarm:0": { value: true },
    });
    const adapter = new EuromapAdapter("IMM-01", undefined, 7);
    await adapter.pollOverOpcua(driver, { endpoint: "opc.tcp://x", nodeMap: NODE_MAP, vendor: "euromap" });
    expect(raiseAndonMock).toHaveBeenCalledOnce();
    const call = raiseAndonMock.mock.calls[0][0];
    expect(call.machineId).toBe(7);
    // Unknown 'euromap' code → fail-safe unmapped Andon (still raised, yellow advisory).
    expect(call.title).toContain("euromap:E77-1200");
  });

  it("FLAG ON + per-vendor taxonomy entry resolves the alarm", async () => {
    process.env.EQ_INTEG_ENABLED = "true";
    // mapEuromapToUem with a supplied entry resolves the standard code.
    const uem = mapEuromapToUem(
      { alarms: [{ code: "E77-1200", active: true }], vendor: "euromap" },
      [{ vendor: "euromap", nativeCode: "E77-1200", standardCode: "OVERTEMP", severity: "high" }],
    );
    expect(uem.normalizedAlarm!.mapped).toBe(true);
    expect(uem.normalizedAlarm!.standardCode).toBe("OVERTEMP");
  });
});

describe("parseNodeMap — env parsing, fail-safe", () => {
  it("parses a JSON node-map", () => {
    const m = parseNodeMap('{"shotCounter":"ns=4;s=ShotCounter"}');
    expect(m?.shotCounter).toBe("ns=4;s=ShotCounter");
  });
  it("empty / garbage → null", () => {
    expect(parseNodeMap(undefined)).toBeNull();
    expect(parseNodeMap("")).toBeNull();
    expect(parseNodeMap("not json {")).toBeNull();
  });
});
