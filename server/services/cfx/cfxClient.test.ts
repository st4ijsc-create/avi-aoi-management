/**
 * IPC-CFX (IPC-2591) telemetry client — unit tests.
 *
 * Covers:
 *   - CFX envelope parsing (in-body name, AMQP subject/app-property hints, malformed → null),
 *   - message → CanonicalSample mapping (UnitsProcessed / StationStateChanged /
 *     FaultOccurred → alarm-shaped sample / ToolChanged / unknown → []),
 *   - endpoint config parsing (JSON + CSV + invalid),
 *   - the CfxClient wired to a FAKE AMQP container (no broker): messages drive
 *     ingest, faults become quality:'bad' samples, disconnect updates stats,
 *   - flag-off no-op.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

import {
  parseCfxEnvelope,
  mapCfxToSamples,
  parseAndMapCfx,
  shortMessageName,
  isMappedCfxMessage,
  parseTimespanSeconds,
} from "./cfxMessages";
import {
  CfxClient,
  parseEndpoints,
  type AmqpContainerLike,
  type AmqpConnectionLike,
  type CfxEndpoint,
} from "./cfxClient";
import type { CanonicalSample } from "../telemetryBus";

// ─── Message samples ──────────────────────────────────────────────────────────

const unitsProcessed = {
  MessageName: "CFX.Production.UnitsProcessed",
  Source: "SMTLine1.Placer1",
  TimeStamp: "2026-07-10T08:00:00.000Z",
  MessageBody: {
    TransactionId: "tx-1",
    Lane: 1,
    UnitProcessData: [
      { UnitIdentifier: "U1", OverallResult: "Passed" },
      { UnitIdentifier: "U2", OverallResult: "Failed" },
      { UnitIdentifier: "U3", OverallResult: "Passed" },
    ],
  },
};

const stationStateChanged = {
  MessageName: "CFX.ResourcePerformance.StationStateChanged",
  Source: "SMTLine1.Reflow1",
  TimeStamp: "2026-07-10T08:01:00.000Z",
  MessageBody: {
    OldState: "ReadyProcessingActive",
    OldStateDuration: "00:05:30",
    NewState: "Setup",
  },
};

const faultOccurred = {
  MessageName: "CFX.ResourcePerformance.FaultOccurred",
  Source: "SMTLine1.Printer1",
  TimeStamp: "2026-07-10T08:02:00.000Z",
  MessageBody: {
    Fault: {
      Cause: "MechanicalFailure",
      Severity: "Error",
      FaultCode: "ERR-42",
      FaultOccurrenceId: "occ-9",
      Lane: 2,
      Description: "Squeegee jam",
    },
  },
};

// ─── Envelope parsing ─────────────────────────────────────────────────────────

describe("parseCfxEnvelope", () => {
  it("parses a full JSON-object envelope and strips the namespace", () => {
    const env = parseCfxEnvelope(unitsProcessed);
    expect(env).not.toBeNull();
    expect(env!.messageName).toBe("UnitsProcessed");
    expect(env!.fullMessageName).toBe("CFX.Production.UnitsProcessed");
    expect(env!.source).toBe("SMTLine1.Placer1");
    expect(env!.timeStamp).toBe("2026-07-10T08:00:00.000Z");
    expect(Array.isArray((env!.body as any).UnitProcessData)).toBe(true);
  });

  it("parses a JSON STRING body", () => {
    const env = parseCfxEnvelope(JSON.stringify(stationStateChanged));
    expect(env?.messageName).toBe("StationStateChanged");
    expect((env!.body as any).NewState).toBe("Setup");
  });

  it("parses a Buffer body", () => {
    const env = parseCfxEnvelope(Buffer.from(JSON.stringify(faultOccurred), "utf8"));
    expect(env?.messageName).toBe("FaultOccurred");
  });

  it("takes the message name from the AMQP subject when the body omits it", () => {
    const body = { Source: "L1.P1", MessageBody: { NewState: "Idle" } };
    const env = parseCfxEnvelope(body, { subject: "CFX.ResourcePerformance.StationStateChanged" });
    expect(env?.messageName).toBe("StationStateChanged");
    expect(env?.source).toBe("L1.P1");
  });

  it("takes name + source from application_properties as a last resort", () => {
    const env = parseCfxEnvelope(
      { MessageBody: { NewState: "Idle" } },
      { applicationProperties: { MessageName: "CFX.ResourcePerformance.StationStateChanged", Source: "L9.X" } },
    );
    expect(env?.messageName).toBe("StationStateChanged");
    expect(env?.source).toBe("L9.X");
  });

  it("returns null (no throw) for malformed JSON / non-object / missing name", () => {
    expect(parseCfxEnvelope("{not json")).toBeNull();
    expect(parseCfxEnvelope(42)).toBeNull();
    expect(parseCfxEnvelope(null)).toBeNull();
    expect(parseCfxEnvelope({ MessageBody: {} })).toBeNull(); // no MessageName
  });
});

describe("shortMessageName / parseTimespanSeconds", () => {
  it("strips namespace", () => {
    expect(shortMessageName("CFX.Production.UnitsProcessed")).toBe("UnitsProcessed");
    expect(shortMessageName("UnitsProcessed")).toBe("UnitsProcessed");
  });
  it("parses .NET timespans", () => {
    expect(parseTimespanSeconds("00:05:30")).toBe(330);
    expect(parseTimespanSeconds("01:00:00")).toBe(3600);
    expect(parseTimespanSeconds("1.00:00:01")).toBe(86401);
    expect(parseTimespanSeconds("00:00:01.5")).toBe(1.5);
    expect(parseTimespanSeconds(12)).toBe(12);
    expect(parseTimespanSeconds("garbage")).toBeNull();
  });
});

// ─── Mapping ──────────────────────────────────────────────────────────────────

describe("mapCfxToSamples — UnitsProcessed", () => {
  it("maps to processed/passed/failed count telemetry", () => {
    const env = parseCfxEnvelope(unitsProcessed)!;
    const samples = mapCfxToSamples(env);
    const byMetric = Object.fromEntries(samples.map((s) => [s.metric, s]));
    expect(byMetric.units_processed.value).toBe(3);
    expect(byMetric.units_passed.value).toBe(2);
    expect(byMetric.units_failed.value).toBe(1);
    // deviceId defaults to Source; protocol is 'other' with meta.cfx trace.
    expect(byMetric.units_processed.deviceId).toBe("SMTLine1.Placer1");
    expect(byMetric.units_processed.protocol).toBe("other");
    expect((byMetric.units_processed.meta as any).cfx).toBe("UnitsProcessed");
    // ts comes from the envelope timestamp.
    expect(byMetric.units_processed.ts?.toISOString()).toBe("2026-07-10T08:00:00.000Z");
  });

  it("honours a machineCode override for deviceId", () => {
    const env = parseCfxEnvelope(unitsProcessed)!;
    const samples = mapCfxToSamples(env, { machineCode: "MOUNTER-01" });
    expect(samples[0].deviceId).toBe("MOUNTER-01");
  });

  it("falls back to a scalar UnitCount when no per-unit array is present", () => {
    const env = parseCfxEnvelope({
      MessageName: "CFX.Production.UnitsProcessed",
      Source: "L1.P1",
      MessageBody: { UnitCount: 5 },
    })!;
    const samples = mapCfxToSamples(env);
    expect(samples).toHaveLength(1);
    expect(samples[0].metric).toBe("units_processed");
    expect(samples[0].value).toBe(5);
  });
});

describe("mapCfxToSamples — StationStateChanged", () => {
  it("maps to a state string + duration seconds", () => {
    const env = parseCfxEnvelope(stationStateChanged)!;
    const samples = mapCfxToSamples(env);
    const byMetric = Object.fromEntries(samples.map((s) => [s.metric, s]));
    expect(byMetric.station_state.value).toBe("Setup");
    expect(byMetric.station_state.deviceId).toBe("SMTLine1.Reflow1");
    expect(byMetric.station_state_duration_s.value).toBe(330);
    expect(byMetric.station_state_duration_s.unit).toBe("s");
    expect((byMetric.station_state.meta as any).oldState).toBe("ReadyProcessingActive");
  });
});

describe("mapCfxToSamples — FaultOccurred (alarm)", () => {
  it("maps a nested Fault into a quality:'bad' alarm-shaped sample", () => {
    const env = parseCfxEnvelope(faultOccurred)!;
    const samples = mapCfxToSamples(env);
    expect(samples).toHaveLength(1);
    const s = samples[0];
    expect(s.metric).toBe("fault");
    expect(s.value).toBe("ERR-42");
    expect(s.quality).toBe("bad");
    expect(s.deviceId).toBe("SMTLine1.Printer1");
    const meta = s.meta as any;
    expect(meta.faultCode).toBe("ERR-42");
    expect(meta.severity).toBe("Error");
    expect(meta.cause).toBe("MechanicalFailure");
    expect(meta.faultOccurrenceId).toBe("occ-9");
  });

  it("treats 'Information' severity as uncertain, not bad", () => {
    const env = parseCfxEnvelope({
      MessageName: "CFX.ResourcePerformance.FaultOccurred",
      Source: "L1.P1",
      MessageBody: { Fault: { FaultCode: "INFO-1", Severity: "Information" } },
    })!;
    const [s] = mapCfxToSamples(env);
    expect(s.quality).toBe("uncertain");
  });
});

describe("mapCfxToSamples — ToolChanged + unknown", () => {
  it("maps ToolChanged to a change-event sample", () => {
    const env = parseCfxEnvelope({
      MessageName: "CFX.Production.Application.ToolChanged",
      Source: "L1.P1",
      MessageBody: { NewTool: { UniqueIdentifier: "TOOL-9" }, OldTool: { UniqueIdentifier: "TOOL-8" } },
    })!;
    const [s] = mapCfxToSamples(env);
    expect(s.metric).toBe("tool_changed");
    expect(s.value).toBe("TOOL-9");
    expect((s.meta as any).oldTool).toBe("TOOL-8");
  });

  it("returns [] for an unmapped message name (no throw)", () => {
    const env = parseCfxEnvelope({
      MessageName: "CFX.InformationSystem.Query.GetWorkOrdersRequest",
      Source: "L1",
      MessageBody: {},
    })!;
    expect(mapCfxToSamples(env)).toEqual([]);
  });

  it("parseAndMapCfx returns [] for garbage input", () => {
    expect(parseAndMapCfx("nope")).toEqual([]);
    expect(parseAndMapCfx({ MessageName: "CFX.Foo.Bar", MessageBody: {} })).toEqual([]);
  });

  it("isMappedCfxMessage reflects the mapper table", () => {
    expect(isMappedCfxMessage("UnitsProcessed")).toBe(true);
    expect(isMappedCfxMessage("Nope")).toBe(false);
  });
});

// ─── Endpoint config parsing ──────────────────────────────────────────────────

describe("parseEndpoints", () => {
  it("parses a JSON array", () => {
    const eps = parseEndpoints(
      JSON.stringify([{ host: "broker", port: 5672, address: "q1", machineCode: "M1" }]),
    );
    expect(eps).toEqual([{ host: "broker", port: 5672, address: "q1", machineCode: "M1" }]);
  });

  it("parses a CSV with host|port|address|machineCode", () => {
    const eps = parseEndpoints("broker|5672|q1|M1; broker2|5673|q2");
    expect(eps).toHaveLength(2);
    expect(eps[0]).toEqual({ host: "broker", port: 5672, address: "q1", machineCode: "M1" });
    expect(eps[1]).toEqual({ host: "broker2", port: 5673, address: "q2" });
  });

  it("defaults a bad port to 5672 and skips items missing host/address", () => {
    const eps = parseEndpoints("broker|notaport|q1; |9|q2; broker3|5674|");
    expect(eps).toEqual([{ host: "broker", port: 5672, address: "q1" }]);
  });

  it("returns [] for empty / whitespace", () => {
    expect(parseEndpoints(undefined)).toEqual([]);
    expect(parseEndpoints("   ")).toEqual([]);
  });
});

// ─── CfxClient with a FAKE AMQP container (no broker) ─────────────────────────

/** A fake rhea connection: an EventEmitter with open_receiver/close/on. */
class FakeConnection extends EventEmitter implements AmqpConnectionLike {
  openedAddresses: unknown[] = [];
  closed = false;
  open_receiver(options: unknown): unknown {
    this.openedAddresses.push(options);
    return {};
  }
  close(): void {
    this.closed = true;
  }
  // `on` inherited from EventEmitter satisfies the interface.
}

class FakeContainer implements AmqpContainerLike {
  connections: FakeConnection[] = [];
  connect(_options: unknown): AmqpConnectionLike {
    const c = new FakeConnection();
    this.connections.push(c);
    return c;
  }
}

function emitMessage(conn: FakeConnection, body: unknown, extra?: Record<string, unknown>): void {
  conn.emit("message", { message: { body, ...(extra ?? {}) } });
}

describe("CfxClient (injected fake container)", () => {
  const endpoints: CfxEndpoint[] = [{ host: "broker", port: 5672, address: "cfx-q" }];

  it("subscribes, ingests mapped samples, and tracks stats", async () => {
    const captured: CanonicalSample[] = [];
    const container = new FakeContainer();
    const client = new CfxClient({
      container,
      endpoints,
      ingest: (s) => {
        captured.push(...s);
        return s.length;
      },
    });

    const started = await client.start();
    expect(started).toBe(true);
    expect(container.connections).toHaveLength(1);
    const conn = container.connections[0];
    expect(conn.openedAddresses).toEqual(["cfx-q"]);

    // Simulate the broker coming up + a UnitsProcessed + a FaultOccurred message.
    conn.emit("connection_open", {});
    conn.emit("receiver_open", {});
    emitMessage(conn, unitsProcessed);
    emitMessage(conn, faultOccurred);

    // Mapped: 3 (units) + 1 (fault) = 4 samples.
    expect(captured).toHaveLength(4);
    const fault = captured.find((s) => s.metric === "fault");
    expect(fault?.quality).toBe("bad");
    expect(fault?.value).toBe("ERR-42");

    const stats = client.getStats().endpoints[0];
    expect(stats.connected).toBe(true);
    expect(stats.receiverOpen).toBe(true);
    expect(stats.messagesReceived).toBe(2);
    expect(stats.samplesEmitted).toBe(4);
    expect(stats.lastError).toBeNull();

    client.stop();
    expect(conn.closed).toBe(true);
    expect(client.isRunning()).toBe(false);
  });

  it("counts an unmapped / malformed message as ignored, not a sample", async () => {
    const captured: CanonicalSample[] = [];
    const container = new FakeContainer();
    const client = new CfxClient({
      container,
      endpoints,
      ingest: (s) => void captured.push(...s),
    });
    await client.start();
    const conn = container.connections[0];

    emitMessage(conn, { MessageName: "CFX.Foo.Unknown", MessageBody: {} }); // unmapped
    emitMessage(conn, "{broken json"); // malformed

    expect(captured).toHaveLength(0);
    const stats = client.getStats().endpoints[0];
    expect(stats.messagesReceived).toBe(2);
    expect(stats.messagesIgnored).toBe(2);
    client.stop();
  });

  it("reflects link-loss honestly on 'disconnected'", async () => {
    const container = new FakeContainer();
    const client = new CfxClient({ container, endpoints, ingest: () => 0 });
    await client.start();
    const conn = container.connections[0];

    conn.emit("connection_open", {});
    expect(client.getStats().endpoints[0].connected).toBe(true);

    conn.emit("disconnected", { reconnecting: true, error: new Error("ECONNRESET") });
    const stats = client.getStats().endpoints[0];
    expect(stats.connected).toBe(false);
    expect(stats.receiverOpen).toBe(false);
    expect(stats.lastError).toBe("ECONNRESET");
    client.stop();
  });

  it("is a no-op when CFX_ENABLED is off and no endpoints are injected", async () => {
    const prev = process.env.CFX_ENABLED;
    delete process.env.CFX_ENABLED;
    try {
      const client = new CfxClient({ container: new FakeContainer() });
      const started = await client.start();
      expect(started).toBe(false);
      expect(client.isRunning()).toBe(false);
    } finally {
      if (prev !== undefined) process.env.CFX_ENABLED = prev;
    }
  });
});
