/**
 * I3b-1 — MTConnect field-map tests (doc 20 §3/§5).
 *
 * Validates the DataItem → Unified Equipment Model field-map against a REAL-shaped
 * MTConnect /current fixture (public sample doc shape): Execution → exec state +
 * utilization, PartCount → production_counter/cycle_count, Program → recipe_id,
 * ControllerMode gates utilization, CONDITION Fault/Warning → alarms carrying the
 * Condition's own nativeCode/nativeSeverity → normalized Andon alarm; an unknown alarm
 * code passes through as the fail-safe default; unreachable/parse-error → honest empty
 * (no fabrication). PURE — no DB, no net.
 */
import { describe, it, expect } from "vitest";
import { parseStreamsXml } from "./mtconnectClient";
import {
  mapMtconnectToUem,
  toExecState,
  utilizationFromExecution,
  extractConditionAlarms,
} from "./mtconnectFieldMap";

// A representative MTConnect /current (MTConnectStreams) document with the DataItems a
// CNC exposes: PROGRAM, EXECUTION, CONTROLLER_MODE, PART_COUNT (total + good),
// PATH_FEEDRATE (moving), and a CONDITION Fault carrying nativeCode + nativeSeverity.
const CURRENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MTConnectStreams xmlns="urn:mtconnect.org:MTConnectStreams:1.4">
  <Header creationTime="2026-07-01T10:00:00Z" sender="agent" />
  <Streams>
    <DeviceStream name="VMC-3Axis" uuid="vmc-001">
      <ComponentStream component="Controller" componentId="cn1">
        <Events>
          <Program dataItemId="pgm" timestamp="2026-07-01T10:00:00.100Z">O5678.PART-A</Program>
          <Execution dataItemId="exec" timestamp="2026-07-01T10:00:00.110Z">ACTIVE</Execution>
          <ControllerMode dataItemId="cmode" timestamp="2026-07-01T10:00:00.120Z">AUTOMATIC</ControllerMode>
        </Events>
      </ComponentStream>
      <ComponentStream component="Path" componentId="p1">
        <Samples>
          <PathFeedrate dataItemId="feed" subType="ACTUAL" timestamp="2026-07-01T10:00:00.130Z">1200</PathFeedrate>
        </Samples>
        <Events>
          <PartCount dataItemId="pc_all" subType="ALL" timestamp="2026-07-01T10:00:00.140Z">1042</PartCount>
          <PartCount dataItemId="pc_good" subType="GOOD" timestamp="2026-07-01T10:00:00.150Z">1030</PartCount>
        </Events>
        <Condition>
          <Fault dataItemId="system_cond" type="SYSTEM" nativeCode="SV0401" nativeSeverity="2" timestamp="2026-07-01T10:00:00.160Z">Excess error servo</Fault>
        </Condition>
      </ComponentStream>
    </DeviceStream>
  </Streams>
</MTConnectStreams>`;

describe("toExecState + utilizationFromExecution", () => {
  it("normalizes Execution values", () => {
    expect(toExecState("ACTIVE")).toBe("ACTIVE");
    expect(toExecState("ready")).toBe("READY");
    expect(toExecState("UNAVAILABLE")).toBe("UNAVAILABLE");
    expect(toExecState("bogus")).toBeNull();
    expect(toExecState(undefined)).toBeNull();
  });

  it("derives a read-only utilization proxy", () => {
    expect(utilizationFromExecution("ACTIVE", { moving: true })).toBe(1);
    expect(utilizationFromExecution("ACTIVE", { automatic: true })).toBe(1);
    expect(utilizationFromExecution("ACTIVE", {})).toBe(0.9);
    expect(utilizationFromExecution("READY")).toBe(0.5);
    expect(utilizationFromExecution("STOPPED")).toBe(0);
    expect(utilizationFromExecution(null)).toBeNull();
  });
});

describe("mapMtconnectToUem — DataItem → Unified Equipment Model", () => {
  const readings = parseStreamsXml(CURRENT_XML);
  const uem = mapMtconnectToUem(readings);

  it("Program → recipe_id", () => {
    expect(uem.recipeId).toBe("O5678.PART-A");
  });

  it("Execution → exec state + ControllerMode captured", () => {
    expect(uem.execState).toBe("ACTIVE");
    expect(uem.controllerMode).toBe("AUTOMATIC");
  });

  it("PartCount ALL → cycle_count, GOOD → production_counter", () => {
    expect(uem.cycleCount).toBe(1042);
    expect(uem.productionCounter).toBe(1030); // GOOD preferred
  });

  it("ACTIVE + feed moving + AUTOMATIC → utilization 1", () => {
    expect(uem.utilizationRate).toBe(1);
  });

  it("CONDITION Fault → alarmCode from the Condition's own nativeCode", () => {
    expect(uem.alarmCode).toBe("SV0401");
    expect(uem.alarms).toHaveLength(1);
    expect(uem.alarms[0].level).toBe("fault");
    expect(uem.alarms[0].nativeSeverity).toBe("2");
  });

  it("unknown vendor code → normalized alarm is the fail-safe default (passthrough)", () => {
    // 'mtconnect' vendor has no seed row for SV0401 → UNKNOWN_ALARM, mapped:false.
    expect(uem.normalizedAlarm).not.toBeNull();
    expect(uem.normalizedAlarm!.mapped).toBe(false);
    expect(uem.normalizedAlarm!.standardCode).toBe("UNKNOWN_ALARM");
    expect(uem.normalizedAlarm!.nativeCode).toBe("SV0401");
  });

  it("a per-vendor taxonomy entry resolves the alarm (vendor threaded)", () => {
    const uem2 = mapMtconnectToUem(readings, {
      vendor: "fanuc",
      entries: [
        { vendor: "fanuc", nativeCode: "SV0401", standardCode: "SERVO_ERROR", severity: "high" },
      ],
    });
    expect(uem2.normalizedAlarm!.mapped).toBe(true);
    expect(uem2.normalizedAlarm!.standardCode).toBe("SERVO_ERROR");
  });
});

describe("extractConditionAlarms — only Fault/Warning, carries native code/severity", () => {
  const readings = parseStreamsXml(CURRENT_XML);
  const alarms = extractConditionAlarms(readings);

  it("lifts the fault with its native code + severity", () => {
    expect(alarms).toHaveLength(1);
    expect(alarms[0].nativeCode).toBe("SV0401");
    expect(alarms[0].nativeSeverity).toBe("2");
    expect(alarms[0].level).toBe("fault");
  });

  it("NORMAL / no-condition streams yield no alarms", () => {
    const normalXml = `<MTConnectStreams><Streams><DeviceStream name="d">
      <ComponentStream><Condition>
        <Normal dataItemId="c" timestamp="2026-07-01T10:00:00Z"/>
      </Condition></ComponentStream>
    </DeviceStream></Streams></MTConnectStreams>`;
    expect(extractConditionAlarms(parseStreamsXml(normalXml))).toHaveLength(0);
  });
});

describe("honesty — parse error / empty stream → no fabricated UEM", () => {
  it("malformed XML → empty readings → all-null UEM (never invents values)", () => {
    const uem = mapMtconnectToUem(parseStreamsXml("<<<not xml"));
    expect(uem.recipeId).toBeNull();
    expect(uem.cycleCount).toBeNull();
    expect(uem.productionCounter).toBeNull();
    expect(uem.utilizationRate).toBeNull();
    expect(uem.alarmCode).toBeNull();
    expect(uem.normalizedAlarm).toBeNull();
    expect(uem.alarms).toHaveLength(0);
  });
});
