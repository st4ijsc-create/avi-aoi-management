/**
 * Edition descriptor tests — SYNAPSE §4 / ADR-007 (doc 33 F1).
 *
 * Lives under server/ so it is picked up by vitest (config includes server/**, not shared/**).
 * Proves the edition layer BOUNDS but never GRANTS beyond the license, and that the
 * default (`site`) is fully backward-compatible.
 */
import { describe, it, expect } from "vitest";

import {
  EDITIONS,
  EDITION_CODES,
  DEFAULT_EDITION,
  getEdition,
  listEditions,
  isEditionCode,
  isModuleAllowedInEdition,
  resolveEditionModules,
  clampQuota,
} from "@shared/editions";
import { CORE_MODULE_CODES, ALL_MODULE_CODES, OPTIONAL_MODULE_CODES } from "@shared/module-registry";

describe("editions — descriptors", () => {
  it("has exactly machine/line/site in upgrade order", () => {
    expect(EDITION_CODES).toEqual(["machine", "line", "site"]);
    expect(listEditions().map((e) => e.code)).toEqual(["machine", "line", "site"]);
  });

  it("every ceiling code (non-'*') is a real optional module code", () => {
    for (const ed of listEditions()) {
      if (ed.moduleCeiling === "*") continue;
      for (const code of ed.moduleCeiling) {
        expect(ALL_MODULE_CODES).toContain(code);
        expect(OPTIONAL_MODULE_CODES).toContain(code);
      }
    }
  });

  it("quota ceilings clamp monotonically machine ≤ line", () => {
    const m = EDITIONS.machine.quotaCeilings;
    const l = EDITIONS.line.quotaCeilings;
    for (const k of Object.keys(m)) {
      if (l[k] !== undefined) expect(m[k]).toBeLessThanOrEqual(l[k]);
    }
  });
});

describe("editions — resolution semantics", () => {
  it("default edition is site (full, backward-compatible)", () => {
    expect(DEFAULT_EDITION).toBe("site");
    expect(getEdition(undefined).code).toBe("site");
    expect(getEdition("nonsense").code).toBe("site");
    expect(getEdition(null).code).toBe("site");
  });

  it("isEditionCode guards correctly", () => {
    expect(isEditionCode("machine")).toBe(true);
    expect(isEditionCode("site")).toBe(true);
    expect(isEditionCode("SITE")).toBe(false);
    expect(isEditionCode(undefined)).toBe(false);
  });

  it("core modules are allowed in every edition", () => {
    for (const code of CORE_MODULE_CODES) {
      expect(isModuleAllowedInEdition("machine", code)).toBe(true);
      expect(isModuleAllowedInEdition("line", code)).toBe(true);
      expect(isModuleAllowedInEdition("site", code)).toBe(true);
    }
  });

  it("site ('*') allows every module; machine restricts federation", () => {
    for (const code of ALL_MODULE_CODES) {
      expect(isModuleAllowedInEdition("site", code)).toBe(true);
    }
    expect(isModuleAllowedInEdition("machine", "MOD_FEDERATION")).toBe(false);
    expect(isModuleAllowedInEdition("machine", "MOD_MONITORING")).toBe(true);
  });

  it("resolveEditionModules = (licensed ∪ core) ∩ ceiling, never granting beyond license", () => {
    const resolved = resolveEditionModules("machine", ["MOD_FEDERATION", "MOD_MONITORING"]);
    expect(resolved).toContain("MOD_MONITORING");
    expect(resolved).not.toContain("MOD_FEDERATION"); // forbidden by machine ceiling
    for (const c of CORE_MODULE_CODES) expect(resolved).toContain(c); // core always present
    expect(new Set(resolved).size).toBe(resolved.length); // no duplicates
  });

  it("site never drops a licensed module", () => {
    const resolved = resolveEditionModules("site", OPTIONAL_MODULE_CODES);
    for (const c of OPTIONAL_MODULE_CODES) expect(resolved).toContain(c);
  });

  it("an unlicensed optional module is NOT added by the edition", () => {
    const resolved = resolveEditionModules("machine", ["MOD_MONITORING"]);
    expect(resolved).not.toContain("MOD_AI"); // in ceiling but not licensed
  });
});

describe("editions — quota clamping", () => {
  it("clamps down to the edition ceiling but never up", () => {
    expect(clampQuota("machine", "MAX_DEVICE_ADAPTERS", 500)).toBe(16);
    expect(clampQuota("machine", "MAX_DEVICE_ADAPTERS", 4)).toBe(4);
  });

  it("returns the value unchanged when the edition sets no ceiling (site) or unknown feature", () => {
    expect(clampQuota("site", "MAX_DEVICE_ADAPTERS", 500)).toBe(500);
    expect(clampQuota("machine", "MAX_UNKNOWN_FEATURE", 999)).toBe(999);
  });
});
