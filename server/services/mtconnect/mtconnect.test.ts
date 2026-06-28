/**
 * MTConnect ingestion tests (Sprint — MTConnect additive ingestion).
 *
 * Covers: XML parsing of a representative /current stream → normalized readings
 * (numeric SAMPLE + EVENT + CONDITION), the pure mapper routing readings to the
 * right sink shape (ot_telemetry vs process_results), source parsing, flag-off
 * poller no-op, and fail-safe behavior on malformed XML. Pure/unit — no DB, no net.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseStreamsXml, parseProbeXml } from "./mtconnectClient";
import { mapReadings, parseSources, stateToResult, startMtconnectPoller, stopMtconnectPoller, isMtconnectRunning } from "./mtconnectPoller";

// A representative MTConnect /current (MTConnectStreams) document: one numeric
// SAMPLE (POSITION), one EVENT (EXECUTION), one CONDITION (Fault), one
// UNAVAILABLE sample, across a single DeviceStream.
const CURRENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectStreams xmlns="urn:mtconnect.org:MTConnectStreams:1.4">
  <Header creationTime="2026-06-28T10:00:00Z" sender="agent" />
  <Streams>
    <DeviceStream name="VMC-3Axis" uuid="vmc-001">
      <ComponentStream component="Linear" name="X" componentId="x1">
        <Samples>
          <Position dataItemId="Xact" name="Xabs" subType="ACTUAL" timestamp="2026-06-28T10:00:00.123Z">123.456</Position>
        </Samples>
      </ComponentStream>
      <ComponentStream component="Rotary" name="C" componentId="c1">
        <Samples>
          <SpindleSpeed dataItemId="Sspeed" timestamp="2026-06-28T10:00:00.200Z">UNAVAILABLE</SpindleSpeed>
        </Samples>
      </ComponentStream>
      <ComponentStream component="Controller" componentId="cn1">
        <Events>
          <Execution dataItemId="exec" timestamp="2026-06-28T10:00:00.300Z">ACTIVE</Execution>
        </Events>
        <Condition>
          <Fault dataItemId="system_cond" type="SYSTEM" timestamp="2026-06-28T10:00:00.400Z" nativeCode="E101">Servo overload</Fault>
        </Condition>
      </ComponentStream>
    </DeviceStream>
  </Streams>
</MTConnectStreams>`;

const PROBE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectDevices xmlns="urn:mtconnect.org:MTConnectDevices:1.4">
  <Header creationTime="2026-06-28T10:00:00Z" />
  <Devices>
    <Device id="d1" name="VMC-3Axis" uuid="vmc-001">
      <DataItems>
        <DataItem id="avail" category="EVENT" type="AVAILABILITY" />
      </DataItems>
      <Components>
        <Linear id="x1" name="X">
          <DataItems>
            <DataItem id="Xact" category="SAMPLE" type="POSITION" subType="ACTUAL" units="MILLIMETER" name="Xabs" />
          </DataItems>
        </Linear>
        <Controller id="cn1">
          <DataItems>
            <DataItem id="exec" category="EVENT" type="EXECUTION" />
            <DataItem id="system_cond" category="CONDITION" type="SYSTEM" />
          </DataItems>
        </Controller>
      </Components>
    </Device>
  </Devices>
</MTConnectDevices>`;

describe("parseStreamsXml", () => {
  const readings = parseStreamsXml(CURRENT_XML);

  it("extracts every observation attributed to its device", () => {
    expect(readings.length).toBe(4);
    expect(readings.every((r) => r.deviceName === "VMC-3Axis")).toBe(true);
  });

  it("numeric SAMPLE → numericValue parsed", () => {
    const pos = readings.find((r) => r.dataItemId === "Xact")!;
    expect(pos.category).toBe("SAMPLE");
    expect(pos.type).toBe("POSITION");
    expect(pos.subType).toBe("ACTUAL");
    expect(pos.dataItemName).toBe("Xabs");
    expect(pos.numericValue).toBeCloseTo(123.456);
    expect(pos.timestamp.toISOString()).toBe("2026-06-28T10:00:00.123Z");
  });

  it("UNAVAILABLE sample → numericValue null", () => {
    const s = readings.find((r) => r.dataItemId === "Sspeed")!;
    expect(s.value.toUpperCase()).toBe("UNAVAILABLE");
    expect(s.numericValue).toBeNull();
  });

  it("EVENT → category EVENT, raw text value", () => {
    const e = readings.find((r) => r.dataItemId === "exec")!;
    expect(e.category).toBe("EVENT");
    expect(e.value).toBe("ACTIVE");
    expect(e.numericValue).toBeNull();
  });

  it("CONDITION → category CONDITION with state from element name", () => {
    const c = readings.find((r) => r.dataItemId === "system_cond")!;
    expect(c.category).toBe("CONDITION");
    expect(c.conditionState).toBe("Fault");
    expect(c.value).toBe("Servo overload");
  });
});

describe("parseProbeXml", () => {
  it("counts DataItems across the component tree", () => {
    const probe = parseProbeXml(PROBE_XML);
    expect(probe.devices.length).toBe(1);
    expect(probe.devices[0].name).toBe("VMC-3Axis");
    expect(probe.dataItemCount).toBe(4); // avail + Xact + exec + system_cond
    const xact = probe.devices[0].dataItems.find((d) => d.id === "Xact")!;
    expect(xact.category).toBe("SAMPLE");
    expect(xact.units).toBe("MILLIMETER");
  });
});

describe("parse fail-safe on bad XML", () => {
  it("malformed input never throws, returns []", () => {
    expect(parseStreamsXml("<<<not xml >>> &broken;")).toEqual([]);
    expect(parseStreamsXml("")).toEqual([]);
    const probe = parseProbeXml("garbage <Device");
    expect(probe.dataItemCount).toBe(0);
  });
});

describe("mapReadings — routes readings to the right sink shape", () => {
  const readings = parseStreamsXml(CURRENT_XML);
  const { telemetry, events } = mapReadings(readings, { adapterId: 7, machineId: 42, machineCode: "M1" });

  it("numeric SAMPLE → ot_telemetry row", () => {
    expect(telemetry.length).toBe(1); // only Xact is numeric SAMPLE
    const row = telemetry[0];
    expect(row.adapterId).toBe(7);
    expect(row.machineId).toBe(42);
    expect(row.tagKey).toBe("Xabs");
    expect(row.valueNumeric).toBe("123.456");
    expect(row.valueText).toBeNull();
    expect(row.quality).toBe("good");
  });

  it("EVENT + CONDITION + UNAVAILABLE sample → process_results rows", () => {
    expect(events.length).toBe(3);
    const exec = events.find((e) => e.stepType === "mtconnect:execution")!;
    expect(exec.machineId).toBe(42);
    expect(exec.serialNumber).toBe("mtc:M1");
    expect(exec.result).toBe("pass"); // ACTIVE → pass
    expect((exec.metrics as any).value).toBe("ACTIVE");

    const fault = events.find((e) => e.stepType === "mtconnect:system")!;
    expect(fault.result).toBe("fail"); // Fault → fail
    expect((fault.metrics as any).state).toBe("Fault");
  });
});

describe("stateToResult", () => {
  it("maps condition/event states to process result", () => {
    expect(stateToResult({ conditionState: "Normal" } as any)).toBe("pass");
    expect(stateToResult({ conditionState: "Warning" } as any)).toBe("warn");
    expect(stateToResult({ conditionState: "Fault" } as any)).toBe("fail");
    expect(stateToResult({ value: "UNAVAILABLE" } as any)).toBe("fail");
    expect(stateToResult({ value: "ACTIVE" } as any)).toBe("pass");
    expect(stateToResult({ value: "" } as any)).toBe("skip");
  });
});

describe("parseSources", () => {
  it("parses JSON array", () => {
    const s = parseSources('[{"agentUrl":"http://a/","machineCode":"M1","pollMs":3000}]');
    expect(s).toEqual([{ agentUrl: "http://a/", machineCode: "M1", pollMs: 3000 }]);
  });
  it("parses CSV with pipe fields", () => {
    const s = parseSources("http://a|M1|2000; http://b|M2|7000");
    expect(s.length).toBe(2);
    expect(s[1]).toEqual({ agentUrl: "http://b", machineCode: "M2", pollMs: 7000 });
  });
  it("defaults bad pollMs and skips incomplete entries", () => {
    const s = parseSources('[{"agentUrl":"http://a","machineCode":"M1"},{"machineCode":"only"}]');
    expect(s.length).toBe(1);
    expect(s[0].pollMs).toBe(5000);
  });
  it("empty / undefined → []", () => {
    expect(parseSources(undefined)).toEqual([]);
    expect(parseSources("")).toEqual([]);
    expect(parseSources("not json [")).toEqual([]);
  });
});

describe("poller flag-gating", () => {
  const prev = { ...process.env };
  beforeEach(() => {
    stopMtconnectPoller();
  });
  afterEach(() => {
    stopMtconnectPoller();
    process.env.MTCONNECT_ENABLED = prev.MTCONNECT_ENABLED;
    process.env.MTCONNECT_SOURCES = prev.MTCONNECT_SOURCES;
  });

  it("flag off → no-op (returns false, not running)", async () => {
    process.env.MTCONNECT_ENABLED = "false";
    process.env.MTCONNECT_SOURCES = '[{"agentUrl":"http://x","machineCode":"M1"}]';
    const started = await startMtconnectPoller();
    expect(started).toBe(false);
    expect(isMtconnectRunning()).toBe(false);
  });

  it("flag on but no sources → no-op", async () => {
    process.env.MTCONNECT_ENABLED = "true";
    process.env.MTCONNECT_SOURCES = "";
    const started = await startMtconnectPoller();
    expect(started).toBe(false);
    expect(isMtconnectRunning()).toBe(false);
  });
});
