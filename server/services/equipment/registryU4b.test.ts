/**
 * U4b (doc 21 §6 / G-8) — data-driven adapter/capability registry regression + proof.
 *
 * Proves the register-and-go refactor is BEHAVIOUR-PRESERVING:
 *   • every EXISTING equipment kind resolves through the registry IDENTICALLY
 *     (same kind + delegatesTo as the historical hard-coded switch);
 *   • every EXISTING equipment class resolves its default capability profile;
 *   • a NEWLY registered test kind / profile resolves WITHOUT any core edit;
 *   • an unknown kind still errors honestly.
 *
 * These assertions do NOT touch the dispatchers (mocked in equipment.test.ts) — they
 * only exercise construction/lookup, so no HITL routing is triggered.
 */
import { describe, it, expect, afterEach } from "vitest";

import {
  equipmentRegistry,
  registerEquipmentAdapter,
  ADAPTER_KINDS,
  type EquipmentAdapter,
  type DelegateRegistry,
} from "./equipmentAdapter";
import type { AdapterKind } from "./capabilityModel";
import {
  getDefaultCapability,
  listDefaultProfiles,
  listCapabilityClasses,
  registerCapabilityProfile,
  type EquipmentCapability,
} from "./capabilityModel";

// The canonical historical kind → delegate mapping (the OLD switch, verbatim). This is
// the parity oracle: after the registry refactor, resolution MUST match this table.
const HISTORICAL_DELEGATES: Record<string, DelegateRegistry> = {
  "ot-opcua": "ot",
  "ot-modbus": "ot",
  "ot-s7": "ot",
  "ot-mitsubishi-mc": "ot",
  "ot-ethernet-ip": "ot",
  "ot-stub": "ot",
  vision: "vision",
  robot: "robot",
  mtconnect: "mtconnect",
  secsgem: "secsgem",
  vda5050: "vda5050",
  focas: "focas",
  euromap: "euromap",
};

describe("U4b — equipment adapter registry (parity)", () => {
  afterEach(() => equipmentRegistry._clear());

  it("every existing kind is registered + resolves to the SAME delegate as the old switch", () => {
    // ADAPTER_KINDS is derived from the registry and equals the historical set.
    expect([...ADAPTER_KINDS].sort()).toEqual(Object.keys(HISTORICAL_DELEGATES).sort());
    for (const kind of ADAPTER_KINDS) {
      const a = equipmentRegistry.getAdapter(kind);
      expect(a.kind).toBe(kind);
      expect(a.delegatesTo).toBe(HISTORICAL_DELEGATES[kind]);
    }
  });

  it("listAdapters() mirrors the registry (kind + delegatesTo) for every kind", () => {
    const listed = equipmentRegistry.listAdapters();
    expect(listed.map((x) => x.kind).sort()).toEqual([...ADAPTER_KINDS].sort());
    for (const { kind, delegatesTo } of listed) {
      expect(delegatesTo).toBe(HISTORICAL_DELEGATES[kind]);
    }
  });

  it("getAdapter memoises (same instance) across calls", () => {
    expect(equipmentRegistry.getAdapter("ot-modbus")).toBe(equipmentRegistry.getAdapter("ot-modbus"));
  });

  it("unknown kind still errors honestly", () => {
    expect(() => equipmentRegistry.getAdapter("does-not-exist" as AdapterKind)).toThrowError(
      /Unknown equipment adapter/,
    );
  });

  it("register-and-go: a NEW kind resolves WITHOUT editing core (no switch edit)", () => {
    const NEW_KIND = "test-vendor-x" as AdapterKind;
    const built: EquipmentAdapter = {
      kind: NEW_KIND,
      delegatesTo: "vision",
      async testConnection() {
        return { ok: true };
      },
      async readTelemetry() {
        return [];
      },
      async sendCommand() {
        return { ok: false, status: "rejected", routedTo: "ot-dispatcher" as const, error: "test kind" };
      },
    };
    registerEquipmentAdapter(NEW_KIND, () => built);
    const resolved = equipmentRegistry.getAdapter(NEW_KIND);
    expect(resolved).toBe(built);
    expect(resolved.kind).toBe(NEW_KIND);
    // The register-and-go view reflects the new kind live.
    expect(equipmentRegistry.listKinds()).toContain(NEW_KIND);
  });
});

describe("U4b — capability profile registry (parity)", () => {
  it("every existing equipment class resolves its default profile through the registry", () => {
    const classes = listCapabilityClasses();
    // The seeded set covers the 17 modelled classes.
    expect(classes.length).toBeGreaterThanOrEqual(17);
    for (const cls of classes) {
      const cap = getDefaultCapability(cls);
      expect(cap.equipmentClass).toBe(cls);
      expect(cap.supportedCommands.length).toBeGreaterThan(0);
    }
  });

  it("listDefaultProfiles() returns every registered class (deep-cloned)", () => {
    const profiles = listDefaultProfiles();
    expect(profiles.map((p) => p.equipmentClass).sort()).toEqual([...listCapabilityClasses()].sort());
    // mutation of a returned profile does not leak into the registry
    profiles[0].supportedCommands = [];
    expect(getDefaultCapability(profiles[0].equipmentClass).supportedCommands.length).toBeGreaterThan(0);
  });

  it("known-class parity spot-checks (AOI/ROBOT/AUTOMATION identical to the table)", () => {
    expect(getDefaultCapability("AOI").adapterKind).toBe("vision");
    expect(getDefaultCapability("ROBOT").adapterKind).toBe("robot");
    expect(getDefaultCapability("AUTOMATION").adapterKind).toBe("ot-opcua");
    expect(getDefaultCapability("MADE_UP").adapterKind).toBe("ot-stub"); // fail-safe unchanged
  });

  it("register-and-go: a NEW class resolves WITHOUT editing DEFAULT_PROFILES", () => {
    const profile: EquipmentCapability = {
      equipmentClass: "TEST_LASER" as EquipmentCapability["equipmentClass"],
      adapterKind: "ot-opcua",
      supportedCommands: [
        { name: "start", label: "Start", paramsSchema: [], riskLevel: "high", requiredPermission: "machine_control/canCreate" },
      ],
      telemetryTags: [{ key: "state", label: "State", dataType: "string" }],
      supportedStates: ["Idle", "Execute", "Stopped"],
    };
    registerCapabilityProfile("TEST_LASER", profile);
    const resolved = getDefaultCapability("TEST_LASER");
    expect(resolved.equipmentClass).toBe("TEST_LASER");
    expect(resolved.adapterKind).toBe("ot-opcua");
    expect(resolved.supportedCommands.map((c) => c.name)).toEqual(["start"]);
    expect(listCapabilityClasses()).toContain("TEST_LASER");
  });
});
