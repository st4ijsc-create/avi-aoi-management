/**
 * W8-A (doc 27 M13 / doc 29 §4) — pure unit tests for the capabilities
 * validator (2-tier soft gate) and the drift-report builder:
 *   • machineType → deviceType resolution via mappedMachineTypes (+fallbacks)
 *   • dataType checks (bool/int/float/string/enum/json)
 *   • unknown keys listed, NEVER blocking (vendor-extension philosophy)
 *   • required attributes → blockingErrors (the only tier-2 reject set)
 *   • NULL/empty capabilities → honest skip (legacy machines don't light up red)
 *   • drift-report over an in-memory machine slice (incl. unmapped machineTypes)
 */
import { describe, it, expect } from "vitest";
import {
  validateCapabilities,
  resolveDeviceTypeForMachineType,
  buildDriftReport,
  toStamp,
} from "./capabilitiesValidation";
import type { DeviceTypeNode } from "./deviceTypeRegistry";

const NODES: DeviceTypeNode[] = [
  {
    typeKey: "Equipment", parentTypeKey: null, version: "1.0.0", status: "published",
    attributesSchema: [
      { name: "vendor", dataType: "string" },
      { name: "utilization_rate", dataType: "float", unit: "%" },
    ],
    supportedCommands: [], supportedStates: [], extensionFields: {}, mappedMachineTypes: [],
  },
  {
    typeKey: "Inspection", parentTypeKey: "Equipment", version: "1.0.0", status: "published",
    attributesSchema: [
      { name: "camera_count", dataType: "int", required: true },
      { name: "lighting_mode", dataType: "enum", options: ["ring", "dome", "coaxial"] },
      { name: "roi_config", dataType: "json" },
      { name: "supports_3d", dataType: "bool" },
    ],
    supportedCommands: [], supportedStates: [], extensionFields: {},
    mappedMachineTypes: ["AOI", "AVI"],
  },
];

describe("resolveDeviceTypeForMachineType", () => {
  it("resolves via mappedMachineTypes and merges the inheritance chain", () => {
    const r = resolveDeviceTypeForMachineType("AOI", NODES);
    expect(r?.typeKey).toBe("Inspection");
    // parent attributes merged in
    expect(r?.attributesSchema.map((a) => a.name)).toContain("vendor");
    expect(r?.attributesSchema.map((a) => a.name)).toContain("camera_count");
  });

  it("falls back to typeKey === machineType, then to Equipment", () => {
    expect(resolveDeviceTypeForMachineType("Inspection", NODES)?.typeKey).toBe("Inspection");
    expect(resolveDeviceTypeForMachineType("TOTALLY_UNKNOWN", NODES)?.typeKey).toBe("Equipment");
  });
});

describe("validateCapabilities", () => {
  it("passes a well-typed payload (unknown keys listed, not failing)", () => {
    const r = validateCapabilities("AOI", {
      camera_count: 4,
      lighting_mode: "dome",
      supports_3d: true,
      vendor: "Omron",
      vendor_special_flag: "xyz", // outside the contract
    }, NODES);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.blockingErrors).toEqual([]);
    expect(r.unknownKeys).toEqual(["vendor_special_flag"]);
    expect(r.deviceTypeKey).toBe("Inspection");
  });

  it("flags type mismatches with expected/got, only required ones blocking", () => {
    const r = validateCapabilities("AOI", {
      camera_count: "four",      // required int → BLOCKING
      lighting_mode: "strobe",   // enum violation → warning
      supports_3d: "yes",        // bool violation → warning
      utilization_rate: "high",  // float from parent → warning
    }, NODES);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(4);
    expect(r.blockingErrors).toHaveLength(1);
    expect(r.blockingErrors[0]).toMatchObject({ path: "camera_count", got: "string", required: true });
    const enumErr = r.errors.find((e) => e.path === "lighting_mode");
    expect(enumErr?.expected).toContain("ring");
  });

  it("flags a MISSING required attribute as blocking", () => {
    const r = validateCapabilities("AOI", { lighting_mode: "ring" }, NODES);
    expect(r.ok).toBe(false);
    expect(r.blockingErrors).toEqual([
      expect.objectContaining({ path: "camera_count", got: "missing", required: true }),
    ]);
  });

  it("honestly SKIPS null/empty capabilities (no fake pass, no noise)", () => {
    for (const caps of [null, undefined, {}]) {
      const r = validateCapabilities("AOI", caps, NODES);
      expect(r.skipped).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    }
  });

  it("int accepts integers only; float accepts any finite number; json accepts objects/arrays", () => {
    const ok = validateCapabilities("AOI", { camera_count: 2, utilization_rate: 87.5, roi_config: { zones: [] } }, NODES);
    expect(ok.ok).toBe(true);
    const bad = validateCapabilities("AOI", { camera_count: 2.5, roi_config: "not-json" }, NODES);
    expect(bad.errors.map((e) => e.path).sort()).toEqual(["camera_count", "roi_config"]);
  });

  it("falls back to the real capabilityModel seed when no nodes given (never throws)", () => {
    const r = validateCapabilities("AOI", { some_key: 1 });
    expect(r.deviceTypeKey).toBeTruthy();
    expect(Array.isArray(r.unknownKeys)).toBe(true);
  });

  it("toStamp strips blockingErrors and stamps the source", () => {
    const r = validateCapabilities("AOI", { camera_count: 1 }, NODES);
    const stamp = toStamp(r, "save");
    expect((stamp as Record<string, unknown>).blockingErrors).toBeUndefined();
    expect(stamp.source).toBe("save");
    expect(stamp.deviceTypeKey).toBe("Inspection");
  });
});

describe("buildDriftReport", () => {
  const machine = (id: number, machineType: string, capabilities: Record<string, unknown> | null) => ({
    id, code: `M-${id}`, name: `Machine ${id}`, machineType: machineType as never, capabilities: capabilities as never,
  });

  it("reports only machines whose DECLARED capabilities drift; skipped rows never drift", () => {
    const { withCapabilities, drifted, stamps } = buildDriftReport([
      machine(1, "AOI", { camera_count: 4 }),                 // ok
      machine(2, "AOI", { camera_count: "x" }),               // drift (blocking type error)
      machine(3, "AOI", null),                                // skipped
      machine(4, "AOI", { camera_count: 2, weird_key: 1 }),   // drift (unknown vendor key — reported, not an error)
    ], NODES);
    expect(withCapabilities).toBe(3);
    expect(drifted.map((d) => d.machineId).sort()).toEqual([2, 4]);
    expect(stamps.has(3)).toBe(false);
    expect(stamps.get(2)?.ok).toBe(false);
    expect(stamps.get(4)?.ok).toBe(true); // unknown keys alone don't fail ok
    expect(stamps.get(1)?.source).toBe("drift-scan");
  });

  it("surfaces machineTypes with no device-type mapping (doc 29 §4.2(4) orphan case)", () => {
    const { unmappedMachineTypes } = buildDriftReport([
      machine(1, "AOI", null),
      machine(2, "MYSTERY_TYPE", null),
    ], NODES);
    expect(unmappedMachineTypes).toEqual(["MYSTERY_TYPE"]);
  });
});
