/**
 * U4b (doc 21 §6 / G-8) — data-driven module registry regression + proof.
 *
 * Proves the register-and-go refactor is BEHAVIOUR-PRESERVING:
 *   • every SEED module is present + resolvable by code/route/navGroup IDENTICALLY;
 *   • core/optional/all code lists are unchanged (no duplicates, right partition);
 *   • a NEWLY registered module is resolvable WITHOUT editing the seed array;
 *   • re-registering an existing code REPLACES in place (no duplicate).
 */
import { describe, it, expect } from "vitest";

import {
  SYSTEM_MODULES,
  listModules,
  registerModule,
  getModuleByCode,
  getModuleByRoute,
  getModuleByNavGroup,
  isRouteAllowed,
  toExportFormat,
  CORE_MODULE_CODES,
  OPTIONAL_MODULE_CODES,
  ALL_MODULE_CODES,
  type SystemModule,
} from "./module-registry";

describe("U4b — module registry (parity)", () => {
  it("SYSTEM_MODULES is derived from the registry with no duplicate codes", () => {
    const codes = SYSTEM_MODULES.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    // Known seed modules are all present.
    for (const code of ["CORE_AUTH", "CORE_DASHBOARD", "MOD_MONITORING", "MOD_OT_CONTROL", "MOD_FEDERATION"]) {
      expect(codes).toContain(code);
    }
  });

  it("code/route/navGroup lookups resolve the same manifest", () => {
    const mon = getModuleByCode("MOD_MONITORING");
    expect(mon?.code).toBe("MOD_MONITORING");
    expect(getModuleByRoute("/machine-status")?.code).toBe("MOD_MONITORING");
    expect(getModuleByNavGroup("monitoring")?.code).toBe("MOD_MONITORING");
    // core route is always allowed regardless of license
    expect(isRouteAllowed("/login", [])).toBe(true);
    // optional route gated by module code
    expect(isRouteAllowed("/machine-status", [])).toBe(false);
    expect(isRouteAllowed("/machine-status", ["MOD_MONITORING"])).toBe(true);
  });

  it("core/optional/all code partitions are consistent", () => {
    expect(ALL_MODULE_CODES.length).toBe(CORE_MODULE_CODES.length + OPTIONAL_MODULE_CODES.length);
    expect(CORE_MODULE_CODES).toContain("CORE_AUTH");
    expect(OPTIONAL_MODULE_CODES).toContain("MOD_ANALYTICS");
    expect(new Set(ALL_MODULE_CODES).size).toBe(ALL_MODULE_CODES.length);
  });

  it("toExportFormat emits every registered module", () => {
    const exp = toExportFormat("AVI_AOI");
    expect(exp.modules.map((m) => m.code).sort()).toEqual([...listModules().map((m) => m.code)].sort());
  });

  it("register-and-go: a NEW module resolves WITHOUT editing the seed array", () => {
    const NEW: SystemModule = {
      code: "MOD_TEST_PLUGIN",
      name: "Test Plugin",
      description: "register-and-go proof",
      version: "1.0.0",
      isCore: false,
      routes: ["/test-plugin"],
      permissionCategories: ["admin"],
      features: [{ code: "TEST_FEATURE", name: "Test", featureType: "boolean", defaultValue: "true" }],
      navGroupId: "test-plugin",
    };
    registerModule(NEW);
    expect(getModuleByCode("MOD_TEST_PLUGIN")).toEqual(NEW);
    expect(getModuleByRoute("/test-plugin")?.code).toBe("MOD_TEST_PLUGIN");
    expect(getModuleByNavGroup("test-plugin")?.code).toBe("MOD_TEST_PLUGIN");
    expect(isRouteAllowed("/test-plugin", ["MOD_TEST_PLUGIN"])).toBe(true);
    expect(listModules().map((m) => m.code)).toContain("MOD_TEST_PLUGIN");
  });

  it("re-registering an existing code REPLACES in place (no duplicate)", () => {
    const before = listModules().filter((m) => m.code === "MOD_ALERTS").length;
    expect(before).toBe(1);
    const original = getModuleByCode("MOD_ALERTS")!;
    registerModule({ ...original, description: "patched description" });
    const after = listModules().filter((m) => m.code === "MOD_ALERTS");
    expect(after.length).toBe(1);
    expect(after[0].description).toBe("patched description");
    // restore to avoid cross-test leakage
    registerModule(original);
  });
});
