/**
 * Phase E0 — Factory Control Plane: equipment layer unit tests.
 *
 * Covers: PackML transitions, capability resolution (defaults + jsonb override
 * merge), the equipmentRegistry facade, and (mocked) HITL routing of sendCommand
 * to the EXISTING dispatchers in dry-run — never a direct driver execute.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock the EXISTING dispatchers so we can assert sendCommand ROUTES to them ──
// (vi.hoisted so the mock fns exist when the hoisted vi.mock factories run).
const { otDispatchMock, robotDispatchMock } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async () => ({
    ok: true,
    simulated: true,
    status: "simulated" as const,
    results: [],
    commandLogIds: [1],
  })),
  robotDispatchMock: vi.fn(async () => ({
    ok: true,
    status: "simulated" as const,
    jobId: 7,
  })),
}));

vi.mock("../ot/commandDispatcher", () => ({
  dispatch: otDispatchMock,
}));
vi.mock("../robot/robotCommandDispatcher", () => ({
  dispatchRobotJob: robotDispatchMock,
}));

import {
  canTransition,
  nextOnCommand,
  allowedCommands,
  settleState,
  PackmlStateMachine,
  PACKML_STATES,
  asPackmlCommand,
  asPackmlState,
} from "./packml";
import {
  getDefaultCapability,
  getCapabilitiesForMachine,
  mergeCapability,
  listDefaultProfiles,
} from "./capabilityModel";
import { equipmentRegistry, ADAPTER_KINDS } from "./equipmentAdapter";

// ════════════════════════════════════════════════════════════════════════════
// PackML state model
// ════════════════════════════════════════════════════════════════════════════
describe("packml", () => {
  it("has exactly the 17 ISA-TR88 states", () => {
    expect(PACKML_STATES).toHaveLength(17);
    expect(PACKML_STATES).toContain("Execute");
    expect(PACKML_STATES).toContain("Aborted");
  });

  it("canTransition: valid command → true, invalid → false", () => {
    expect(canTransition("Idle", "Start")).toBe(true);
    expect(canTransition("Execute", "Hold")).toBe(true);
    expect(canTransition("Aborted", "Clear")).toBe(true);
    // illegal pairs
    expect(canTransition("Idle", "Hold")).toBe(false);
    expect(canTransition("Stopped", "Start")).toBe(false); // must Reset → Idle first
    expect(canTransition("Aborted", "Start")).toBe(false);
  });

  it("nextOnCommand returns the right next state, or null when illegal", () => {
    expect(nextOnCommand("Idle", "Start")).toBe("Starting");
    expect(nextOnCommand("Execute", "Hold")).toBe("Holding");
    expect(nextOnCommand("Held", "Unhold")).toBe("Unholding");
    expect(nextOnCommand("Complete", "Reset")).toBe("Resetting");
    expect(nextOnCommand("Aborted", "Clear")).toBe("Clearing");
    // Stop allowed from every running state
    expect(nextOnCommand("Execute", "Stop")).toBe("Stopping");
    // Abort allowed everywhere except Aborted/Aborting
    expect(nextOnCommand("Execute", "Abort")).toBe("Aborting");
    expect(nextOnCommand("Aborted", "Abort")).toBeNull();
    // illegal
    expect(nextOnCommand("Idle", "Unhold")).toBeNull();
  });

  it("allowedCommands lists every legal command from a state", () => {
    expect(allowedCommands("Idle").sort()).toEqual(["Abort", "Start", "Stop"]);
    expect(allowedCommands("Aborted")).toEqual(["Clear"]);
    expect(allowedCommands("Aborting")).toEqual([]);
  });

  it("settleState follows the auto State-Complete edge", () => {
    expect(settleState("Starting")).toBe("Execute");
    expect(settleState("Stopping")).toBe("Stopped");
    expect(settleState("Aborting")).toBe("Aborted");
    expect(settleState("Idle")).toBeNull(); // resting
  });

  it("PackmlStateMachine drives a full Start→Execute→Stop→Reset cycle", () => {
    const sm = new PackmlStateMachine("Idle");
    expect(sm.apply("Start")).toBe("Starting");
    expect(sm.settle()).toBe("Execute");
    expect(sm.apply("Stop")).toBe("Stopping");
    expect(sm.settle()).toBe("Stopped");
    expect(sm.apply("Reset")).toBe("Resetting");
    expect(sm.settle()).toBe("Idle");
    // illegal command is a no-op
    expect(sm.apply("Unhold")).toBeNull();
    expect(sm.state).toBe("Idle");
  });

  it("asPackmlState / asPackmlCommand narrow safely", () => {
    expect(asPackmlState("Execute")).toBe("Execute");
    expect(asPackmlState("nope")).toBeNull();
    expect(asPackmlCommand("Start")).toBe("Start");
    expect(asPackmlCommand("nope")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Capability model — defaults + override merge
// ════════════════════════════════════════════════════════════════════════════
describe("capabilityModel", () => {
  it("AOI default: vision adapter + recipe select + yield/ng telemetry", () => {
    const cap = getDefaultCapability("AOI");
    expect(cap.adapterKind).toBe("vision");
    expect(cap.supportedCommands.map((c) => c.name)).toContain("select_recipe");
    expect(cap.telemetryTags.map((t) => t.key)).toEqual(expect.arrayContaining(["yield", "ng_count"]));
  });

  it("ROBOT default: robot adapter + run_job/abort + pose/mode telemetry", () => {
    const cap = getDefaultCapability("ROBOT");
    expect(cap.adapterKind).toBe("robot");
    expect(cap.supportedCommands.map((c) => c.name)).toEqual(expect.arrayContaining(["run_job", "abort"]));
    expect(cap.telemetryTags.map((t) => t.key)).toEqual(expect.arrayContaining(["pose", "mode"]));
  });

  it("AUTOMATION default: OPC-UA + read_tag/write_tag", () => {
    const cap = getDefaultCapability("AUTOMATION");
    expect(cap.adapterKind).toBe("ot-opcua");
    expect(cap.supportedCommands.map((c) => c.name)).toEqual(expect.arrayContaining(["read_tag", "write_tag"]));
  });

  it("high-risk commands carry the machine_control HITL permission", () => {
    const start = getDefaultCapability("ICT").supportedCommands.find((c) => c.name === "start");
    expect(start?.riskLevel).toBe("high");
    expect(start?.requiredPermission).toBe("machine_control/canCreate");
  });

  it("unknown machineType → fail-safe minimal read-only profile", () => {
    const cap = getDefaultCapability("MADE_UP_TYPE");
    expect(cap.adapterKind).toBe("ot-stub");
    expect(cap.supportedCommands.map((c) => c.name)).toEqual(["read_tag"]);
  });

  it("mergeCapability: jsonb flags ADD telemetry + adapterKind override wins", () => {
    const base = getDefaultCapability("ICT");
    const merged = mergeCapability(base, {
      canMeasureTorque: true,
      adapterKind: "ot-modbus",
      extraCommands: [
        { name: "calibrate", label: "Calibrate", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" },
      ],
    });
    expect(merged.adapterKind).toBe("ot-modbus");
    expect(merged.telemetryTags.map((t) => t.key)).toContain("torque");
    expect(merged.supportedCommands.map((c) => c.name)).toContain("calibrate");
    // base table is NOT mutated
    expect(base.adapterKind).toBe("ot-opcua");
    expect(base.telemetryTags.map((t) => t.key)).not.toContain("torque");
  });

  it("mergeCapability: disabledCommands removes a default command", () => {
    const base = getDefaultCapability("AOI");
    const merged = mergeCapability(base, { disabledCommands: ["select_recipe"] });
    expect(merged.supportedCommands.map((c) => c.name)).not.toContain("select_recipe");
  });

  it("getCapabilitiesForMachine resolves machineType default ⊕ override", () => {
    const cap = getCapabilitiesForMachine({
      machineType: "FEEDER",
      capabilities: { hasRecipe: true },
    });
    expect(cap.equipmentClass).toBe("FEEDER");
    expect(cap.supportedCommands.map((c) => c.name)).toContain("select_recipe"); // added by hasRecipe
  });

  it("getCapabilitiesForMachine is fail-safe for null/garbage", () => {
    expect(getCapabilitiesForMachine(null).supportedCommands.length).toBeGreaterThan(0);
    expect(getCapabilitiesForMachine("ROBOT").adapterKind).toBe("robot");
  });

  it("listDefaultProfiles covers every machineType", () => {
    const profiles = listDefaultProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(17);
    expect(profiles.every((p) => p.supportedCommands.length > 0)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// equipmentRegistry facade
// ════════════════════════════════════════════════════════════════════════════
describe("equipmentRegistry facade", () => {
  beforeEach(() => {
    equipmentRegistry._clear();
    otDispatchMock.mockClear();
    robotDispatchMock.mockClear();
  });

  it("listAdapters maps every kind to its delegate registry", () => {
    const adapters = equipmentRegistry.listAdapters();
    expect(adapters.map((a) => a.kind).sort()).toEqual([...ADAPTER_KINDS].sort());
    expect(adapters.find((a) => a.kind === "ot-opcua")?.delegatesTo).toBe("ot");
    expect(adapters.find((a) => a.kind === "robot")?.delegatesTo).toBe("robot");
    expect(adapters.find((a) => a.kind === "vda5050")?.delegatesTo).toBe("vda5050");
    expect(adapters.find((a) => a.kind === "vision")?.delegatesTo).toBe("vision");
  });

  it("getAdapter returns the right kind + throws for unknown", () => {
    expect(equipmentRegistry.getAdapter("ot-modbus").kind).toBe("ot-modbus");
    // memoised — same instance
    expect(equipmentRegistry.getAdapter("ot-modbus")).toBe(equipmentRegistry.getAdapter("ot-modbus"));
    // @ts-expect-error unknown kind
    expect(() => equipmentRegistry.getAdapter("nope")).toThrowError(/Unknown equipment adapter/);
  });

  it("OT sendCommand ROUTES to the existing commandDispatcher (dry-run, no driver execute)", async () => {
    const adapter = equipmentRegistry.getAdapter("ot-opcua");
    const res = await adapter.sendCommand({
      name: "start",
      adapterId: 42,
      machineId: 3,
      writes: [{ tagKey: "cmd_start", value: true }],
      idempotencyKey: "k1",
      hitl: { actionId: "act-1", requestedBy: 9, confirmedBy: 9 },
    });
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(robotDispatchMock).not.toHaveBeenCalled();
    const arg = otDispatchMock.mock.calls[0][0] as { triggeredBy: { kind: string }; commandType: string };
    expect(arg.triggeredBy.kind).toBe("hitl"); // HITL preserved
    expect(arg.commandType).toBe("start");
    expect(res.routedTo).toBe("ot-dispatcher");
    expect(res.status).toBe("simulated"); // dry-run — nothing written
    expect(res.ok).toBe(true);
  });

  it("OT sendCommand rejects without an adapterId (never routes a malformed command)", async () => {
    const adapter = equipmentRegistry.getAdapter("ot-opcua");
    const res = await adapter.sendCommand({
      name: "start",
      idempotencyKey: "k2",
      hitl: { actionId: "act-2", requestedBy: 9 },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe("rejected");
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("robot sendCommand ROUTES to robotCommandDispatcher (dry-run) with HITL trigger", async () => {
    const adapter = equipmentRegistry.getAdapter("robot");
    const res = await adapter.sendCommand({
      name: "run_job",
      robotId: 5,
      job: { jobType: "home" },
      idempotencyKey: "k3",
      hitl: { actionId: "act-3", requestedBy: 1, confirmedBy: 1 },
    });
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect(otDispatchMock).not.toHaveBeenCalled();
    const arg = robotDispatchMock.mock.calls[0][0] as { triggerKind: string; robotId: number };
    expect(arg.triggerKind).toBe("hitl");
    expect(arg.robotId).toBe(5);
    expect(res.routedTo).toBe("robot-dispatcher");
    expect(res.status).toBe("simulated");
  });

  it("telemetry-only kinds (vision/mtconnect/secsgem) reject sendCommand (no control path)", async () => {
    for (const kind of ["vision", "mtconnect", "secsgem"] as const) {
      const res = await equipmentRegistry.getAdapter(kind).sendCommand({
        name: "start",
        idempotencyKey: `k-${kind}`,
        hitl: { actionId: "a", requestedBy: 1 },
      });
      expect(res.ok).toBe(false);
      expect(res.status).toBe("rejected");
    }
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(robotDispatchMock).not.toHaveBeenCalled();
  });
});
