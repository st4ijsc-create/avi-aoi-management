/**
 * doc 24 Wave-4 · C5 — UNS-first PackML STATE bridge (PURE).
 *
 * Covers:
 *  (c) a PackML transition builds the expected UNS/Sparkplug message shape (DBIRTH +
 *      DDATA with the PackML/Identity metric set), asserted via a real encode→decode;
 *  (e) a subscriber reconstructs the machine's full PackML state + identity from the
 *      published messages — from the DBIRTH directly, and from a later alias-only DDATA
 *      after resolving aliases via the DBIRTH.
 *
 * No broker / no I/O — the SparkplugNode builds buffers, decodePayload reads them back.
 */
import { describe, it, expect } from "vitest";
import { SparkplugNode } from "./sparkplugNode";
import { decodePayload } from "./sparkplugEncoder";
import {
  buildPackmlStateMetrics,
  buildPackmlStateMessages,
  reconstructPackmlFromMetrics,
  aliasNameMapFromBirth,
  resolveAliasedMetrics,
  packmlStateCode,
  packmlStateFromCode,
  packmlSparkplugDeviceId,
  isUnsPackmlStateEnabled,
  PACKML_METRIC,
} from "./packmlStateBridge";

const IDENTITY = { machineId: 7, machineCode: "OVEN-1", machineType: "AUTOMATION" };

describe("packmlStateBridge — metric set", () => {
  it("encodes state, numeric code, previous, command and identity", () => {
    const { metricDefs } = buildPackmlStateMetrics(
      { state: "Execute", previousState: "Starting", command: "Start", unitMode: "Production" },
      IDENTITY,
    );
    const byName = Object.fromEntries(metricDefs.map((m) => [m.name, m.value]));
    expect(byName[PACKML_METRIC.state]).toBe("Execute");
    expect(byName[PACKML_METRIC.stateCode]).toBe(packmlStateCode("Execute"));
    expect(byName[PACKML_METRIC.previousState]).toBe("Starting");
    expect(byName[PACKML_METRIC.command]).toBe("Start");
    expect(byName[PACKML_METRIC.unitMode]).toBe("Production");
    expect(byName[PACKML_METRIC.machineId]).toBe(7);
    expect(byName[PACKML_METRIC.machineCode]).toBe("OVEN-1");
    expect(byName[PACKML_METRIC.machineType]).toBe("AUTOMATION");
  });

  it("optional fields default to empty/zero (no fabrication)", () => {
    const { metricDefs } = buildPackmlStateMetrics({ state: "Idle" });
    const byName = Object.fromEntries(metricDefs.map((m) => [m.name, m.value]));
    expect(byName[PACKML_METRIC.previousState]).toBe("");
    expect(byName[PACKML_METRIC.command]).toBe("");
    expect(byName[PACKML_METRIC.machineId]).toBe(0);
    expect(byName[PACKML_METRIC.machineCode]).toBe("");
  });

  it("packmlStateCode ↔ packmlStateFromCode round-trip", () => {
    expect(packmlStateFromCode(packmlStateCode("Aborted"))).toBe("Aborted");
    expect(packmlStateFromCode(-1)).toBeNull();
    expect(packmlStateFromCode(999)).toBeNull();
  });

  it("packmlSparkplugDeviceId prefers machineCode, then Machine{id}, then generic", () => {
    expect(packmlSparkplugDeviceId({ machineCode: "OVEN-1", machineId: 7 })).toBe("OVEN-1");
    expect(packmlSparkplugDeviceId({ machineId: 7 })).toBe("Machine7");
    expect(packmlSparkplugDeviceId({})).toBe("Machine");
  });

  it("flag is OFF by default", () => {
    const prev = process.env.UNS_PACKML_STATE_ENABLED;
    delete process.env.UNS_PACKML_STATE_ENABLED;
    expect(isUnsPackmlStateEnabled()).toBe(false);
    if (prev !== undefined) process.env.UNS_PACKML_STATE_ENABLED = prev;
  });
});

describe("packmlStateBridge — Sparkplug message shape (c)", () => {
  it("first transition emits DBIRTH (named metrics) + DDATA on the device topic", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", []); // node online

    const msgs = buildPackmlStateMessages(
      node,
      "grp",
      "edge",
      "OVEN-1",
      { state: "Execute", previousState: "Starting", command: "Start" },
      IDENTITY,
    );
    // DBIRTH first (device unseen) then DDATA
    expect(msgs).toHaveLength(2);
    expect(msgs[0].topic).toBe("spBv1.0/grp/DBIRTH/edge/OVEN-1");
    expect(msgs[1].topic).toBe("spBv1.0/grp/DDATA/edge/OVEN-1");

    const birth = decodePayload(msgs[0].buffer);
    const byName = Object.fromEntries(birth.metrics.map((m) => [m.name, m]));
    expect(String(byName[PACKML_METRIC.state].value)).toBe("Execute");
    expect(byName[PACKML_METRIC.machineCode].value).toBe("OVEN-1");
    // every PackML/Identity metric carries a stable alias in the birth
    expect(typeof byName[PACKML_METRIC.state].alias).toBe("number");
  });

  it("a SECOND transition on the same device emits DDATA only (device already birthed)", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", []);
    buildPackmlStateMessages(node, "grp", "edge", "OVEN-1", { state: "Execute" }, IDENTITY);
    const second = buildPackmlStateMessages(node, "grp", "edge", "OVEN-1", { state: "Holding", command: "Hold" }, IDENTITY);
    expect(second).toHaveLength(1);
    expect(second[0].topic).toBe("spBv1.0/grp/DDATA/edge/OVEN-1");
  });
});

describe("packmlStateBridge — subscriber reconstruction (e)", () => {
  it("reconstructs state + identity directly from a decoded DBIRTH", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", []);
    const [dbirth] = buildPackmlStateMessages(
      node,
      "grp",
      "edge",
      "OVEN-1",
      { state: "Execute", previousState: "Starting", command: "Start", unitMode: "Production" },
      IDENTITY,
    );
    const decoded = decodePayload(dbirth.buffer);
    const recon = reconstructPackmlFromMetrics(decoded.metrics);
    expect(recon.state).toBe("Execute");
    expect(recon.previousState).toBe("Starting");
    expect(recon.command).toBe("Start");
    expect(recon.unitMode).toBe("Production");
    expect(recon.identity).toEqual({ machineId: 7, machineCode: "OVEN-1", machineType: "AUTOMATION" });
  });

  it("reconstructs a later alias-only DDATA after resolving aliases via the DBIRTH", () => {
    const node = new SparkplugNode();
    node.buildNbirth("grp", "edge", []);
    // 1) first transition → DBIRTH carries names+aliases
    const first = buildPackmlStateMessages(node, "grp", "edge", "OVEN-1", { state: "Execute", command: "Start" }, IDENTITY);
    const birth = decodePayload(first[0].buffer);
    const aliasToName = aliasNameMapFromBirth(birth.metrics);

    // 2) second transition → DDATA is alias-only (no names)
    const second = buildPackmlStateMessages(node, "grp", "edge", "OVEN-1", { state: "Holding", previousState: "Execute", command: "Hold" }, IDENTITY);
    const ddata = decodePayload(second[0].buffer);
    expect(ddata.metrics.every((m) => m.name == null)).toBe(true); // alias-only

    // 3) subscriber resolves aliases → names, then reconstructs
    const named = resolveAliasedMetrics(ddata.metrics, aliasToName);
    const recon = reconstructPackmlFromMetrics(named);
    expect(recon.state).toBe("Holding");
    expect(recon.previousState).toBe("Execute");
    expect(recon.command).toBe("Hold");
    expect(recon.identity.machineCode).toBe("OVEN-1");
  });

  it("reconstructs state from the numeric StateCode when the state name is absent", () => {
    const code = packmlStateCode("Suspended");
    const recon = reconstructPackmlFromMetrics([{ name: PACKML_METRIC.stateCode, value: code }]);
    expect(recon.state).toBe("Suspended");
  });
});
