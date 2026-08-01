/**
 * doc 24 Wave-4 · C5 — OPC-UA companion-spec MODELS + capability integration.
 *
 * Covers:
 *  (a) each modelled spec (Machinery / Robotics / Euromap-83) exposes the expected
 *      typed nodes, derived telemetry channels and PackML states;
 *  (b) a machine that DECLARES a companion spec derives the correct capability
 *      {telemetry, states} (additive + backward-compatible with the existing merge).
 *
 * Pure — no OPC-UA server, no broker, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  getCompanionSpec,
  listCompanionSpecIds,
  listCompanionSpecs,
  specTelemetry,
  specVariableNodes,
  deriveCapabilityFromSpecs,
  checkSpecConformance,
  opcuaToCapabilityDataType,
  asCompanionSpecId,
} from "./companionSpecs";
import { getCapabilitiesForMachine, getDefaultCapability } from "./capabilityModel";

// ════════════════════════════════════════════════════════════════════════════
// (a) spec models expose the expected nodes / telemetry / states
// ════════════════════════════════════════════════════════════════════════════
describe("companionSpecs — models", () => {
  it("registers exactly the three headline specs", () => {
    expect(listCompanionSpecIds().sort()).toEqual(["Euromap83", "Machinery", "Robotics"]);
    expect(listCompanionSpecs()).toHaveLength(3);
  });

  it("Machinery: identity + MachineryItemState + operation counters, correct namespace", () => {
    const spec = getCompanionSpec("Machinery")!;
    expect(spec.namespaceUri).toBe("http://opcfoundation.org/UA/Machinery/");
    const browseNames = spec.nodes.map((n) => n.browseName);
    expect(browseNames).toEqual(
      expect.arrayContaining(["Manufacturer", "Model", "SerialNumber", "CurrentState", "OperationDuration"]),
    );
    // the state node is an Enumeration carrying the MachineryItemState symbols
    const state = spec.nodes.find((n) => n.browseName === "CurrentState")!;
    expect(state.enumValues).toEqual(["NotAvailable", "OutOfService", "NotExecuting", "Executing"]);
    // derived telemetry + states
    const telem = specTelemetry(spec).map((t) => t.key);
    expect(telem).toEqual(expect.arrayContaining(["manufacturer", "serial_number", "machinery_item_state"]));
    expect(spec.supportedStates).toEqual(expect.arrayContaining(["Execute", "Idle", "Stopped"]));
  });

  it("Robotics: MotionDevice + axis parameter set + safety states, correct namespace", () => {
    const spec = getCompanionSpec("Robotics")!;
    expect(spec.namespaceUri).toBe("http://opcfoundation.org/UA/Robotics/");
    // an axis ParameterSet ActualPosition node is present with the expected browse-path
    const pos = spec.nodes.find((n) => n.browseName === "ActualPosition")!;
    expect(pos.dataType).toBe("Double");
    expect(pos.browsePath).toEqual(
      expect.arrayContaining(["MotionDeviceSystem", "MotionDevices", "MotionDevice", "Axes"]),
    );
    // MotionDeviceCategory enumerates the kinematic categories
    const cat = spec.nodes.find((n) => n.browseName === "MotionDeviceCategory")!;
    expect(cat.enumValues).toEqual(expect.arrayContaining(["ARTICULATED_ROBOT", "DELTA_ROBOT"]));
    const telem = specTelemetry(spec).map((t) => t.key);
    expect(telem).toEqual(
      expect.arrayContaining(["axis_actual_position", "emergency_stop", "operational_mode", "motion_device_category"]),
    );
    // robot state cube includes the abort/held region
    expect(spec.supportedStates).toEqual(expect.arrayContaining(["Execute", "Held", "Aborted"]));
  });

  it("Euromap83: cycle/shot/mode/mould, cycle_time reuses the platform-canonical key", () => {
    const spec = getCompanionSpec("Euromap83")!;
    const telem = specTelemetry(spec).map((t) => t.key);
    expect(telem).toEqual(expect.arrayContaining(["cycle_time", "shot_counter", "machine_mode", "active_mould"]));
    // MachineMode enum carries the Euromap operating modes
    const mode = spec.nodes.find((n) => n.browseName === "MachineMode")!;
    expect(mode.enumValues).toEqual(expect.arrayContaining(["AUTOMATIC", "SEMI_AUTOMATIC", "MANUAL", "STOPPED"]));
  });

  it("specVariableNodes returns only Variable nodes; Object/Method folders excluded", () => {
    const spec = getCompanionSpec("Machinery")!;
    const vars = specVariableNodes(spec);
    expect(vars.every((n) => n.nodeClass === "Variable")).toBe(true);
    // the "MachineryItemState" Object folder is not a Variable
    expect(vars.map((n) => n.browseName)).not.toContain("MachineryItemState");
  });

  it("opcuaToCapabilityDataType maps OPC-UA types onto the capability contract", () => {
    expect(opcuaToCapabilityDataType("Double")).toBe("float");
    expect(opcuaToCapabilityDataType("UInt64")).toBe("int");
    expect(opcuaToCapabilityDataType("Boolean")).toBe("bool");
    expect(opcuaToCapabilityDataType("Enumeration")).toBe("enum");
    expect(opcuaToCapabilityDataType("LocalizedText")).toBe("string");
  });

  it("asCompanionSpecId narrows safely", () => {
    expect(asCompanionSpecId("Robotics")).toBe("Robotics");
    expect(asCompanionSpecId("nope")).toBeNull();
    expect(asCompanionSpecId(42)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deriveCapabilityFromSpecs — union of telemetry + states, fail-safe on unknowns
// ════════════════════════════════════════════════════════════════════════════
describe("deriveCapabilityFromSpecs", () => {
  it("unions telemetry (de-duped by key) and states across specs", () => {
    const d = deriveCapabilityFromSpecs(["Machinery", "Robotics"]);
    const keys = d.telemetry.map((t) => t.key);
    // shared identity key (manufacturer/model/serial) appears once
    expect(keys.filter((k) => k === "manufacturer")).toHaveLength(1);
    expect(keys).toEqual(expect.arrayContaining(["machinery_item_state", "axis_actual_position"]));
    expect(d.resolvedSpecIds).toEqual(["Machinery", "Robotics"]);
    expect(d.states).toEqual(expect.arrayContaining(["Execute", "Held", "Aborted", "Starting"]));
  });

  it("ignores unknown spec ids (surfaced in unknownSpecIds), never throws", () => {
    const d = deriveCapabilityFromSpecs(["Machinery", "MadeUpSpec"]);
    expect(d.resolvedSpecIds).toEqual(["Machinery"]);
    expect(d.unknownSpecIds).toEqual(["MadeUpSpec"]);
    expect(d.telemetry.length).toBeGreaterThan(0);
  });

  it("empty / null input → empty derivation (backward-compatible no-op)", () => {
    expect(deriveCapabilityFromSpecs([]).telemetry).toHaveLength(0);
    expect(deriveCapabilityFromSpecs(null).states).toHaveLength(0);
    expect(deriveCapabilityFromSpecs(undefined).resolvedSpecIds).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (b) a machine declaring a companion spec derives the correct capability
// ════════════════════════════════════════════════════════════════════════════
describe("capability sourced from a declared companion spec", () => {
  it("Robotics spec augments a ROBOT machine with MotionDevice telemetry (additive)", () => {
    const baseline = getDefaultCapability("ROBOT");
    const cap = getCapabilitiesForMachine({
      machineType: "ROBOT",
      capabilities: { companionSpecs: ["Robotics"] },
    });
    const keys = cap.telemetryTags.map((t) => t.key);
    // spec-derived channels present…
    expect(keys).toEqual(
      expect.arrayContaining(["axis_actual_position", "operational_mode", "motion_device_category"]),
    );
    // …AND the original ROBOT telemetry is preserved (backward-compatible union)
    for (const t of baseline.telemetryTags) expect(keys).toContain(t.key);
    // commands are unchanged by a companion spec (spec derives telemetry+states only)
    expect(cap.supportedCommands.map((c) => c.name)).toEqual(
      baseline.supportedCommands.map((c) => c.name),
    );
  });

  it("Machinery spec augments an AUTOMATION machine's telemetry + adds its state set", () => {
    const cap = getCapabilitiesForMachine({
      machineType: "AUTOMATION",
      capabilities: { companionSpecs: ["Machinery"] },
    });
    const keys = cap.telemetryTags.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(["machinery_item_state", "serial_number", "operation_duration"]));
    // states are unioned (AUTOMATION already has the full cube; still contains these)
    expect(cap.supportedStates).toEqual(expect.arrayContaining(["Execute", "Idle", "Stopped"]));
  });

  it("Euromap83 gives cycle_time to a FEEDER that lacks it by default (union adds the key)", () => {
    const baseline = getDefaultCapability("FEEDER");
    expect(baseline.telemetryTags.map((t) => t.key)).not.toContain("cycle_time");
    const cap = getCapabilitiesForMachine({
      machineType: "FEEDER",
      capabilities: { companionSpecs: ["Euromap83"] },
    });
    const keys = cap.telemetryTags.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(["cycle_time", "shot_counter", "machine_mode"]));
    // FEEDER only had the SIMPLE_STATES; Euromap83 unions in Execute + Held
    expect(cap.supportedStates).toEqual(expect.arrayContaining(["Execute", "Held"]));
  });

  it("NO companionSpecs declared → capability is byte-for-byte the legacy default", () => {
    const withEmpty = getCapabilitiesForMachine({ machineType: "AOI", capabilities: {} });
    const legacy = getDefaultCapability("AOI");
    expect(withEmpty.telemetryTags.map((t) => t.key)).toEqual(legacy.telemetryTags.map((t) => t.key));
    expect(withEmpty.supportedStates).toEqual(legacy.supportedStates);
  });

  it("a resolved capability that declares a spec CONFORMS to that spec's mandatory nodes", () => {
    const spec = getCompanionSpec("Euromap83")!;
    const cap = getCapabilitiesForMachine({
      machineType: "AUTOMATION",
      capabilities: { companionSpecs: ["Euromap83"] },
    });
    const result = checkSpecConformance(
      spec,
      cap.telemetryTags.map((t) => t.key),
      cap.supportedStates,
    );
    expect(result.pass).toBe(true);
    expect(result.missingTelemetry).toEqual([]);
  });
});
