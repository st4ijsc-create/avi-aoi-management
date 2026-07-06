/**
 * Developer Portal tests — SYNAPSE R3 (doc 33 P6).
 */
import { describe, it, expect } from "vitest";

import { buildPortalIndex, sandboxCheck, newPluginManifest, conformanceChecklist } from "./devPortal";
import { EXTENSION_POINTS } from "./pluginTemplate";
import { validateManifest } from "@shared/plugin/manifest";

describe("developer portal", () => {
  it("index publishes spec counts, extension points, and the KPI", () => {
    const idx = buildPortalIndex();
    expect(idx.pluginApiVersion).toBeTruthy();
    expect(idx.extensionPoints).toHaveLength(6);
    expect(idx.specs.openapiPaths).toBeGreaterThan(0);
    expect(idx.specs.asyncapiChannels).toBeGreaterThan(0);
    expect(idx.kpi.timeToFirstPluginTargetDays).toBe(1);
  });

  it("newPluginManifest scaffolds a VALID manifest (device-connector gets a config form)", () => {
    const m = newPluginManifest("vendor-acme-x", "device-connector");
    expect(validateManifest(m, { requireSignature: false }).ok).toBe(true);
    expect(m.configSchema).toBeTruthy();
    expect(m.permissions).toBeTruthy();
  });

  it("conformanceChecklist adds kind-specific items", () => {
    const dc = conformanceChecklist("device-connector");
    expect(dc.some((s) => /store-and-forward/i.test(s))).toBe(true);
    const ra = conformanceChecklist("robot-adapter");
    expect(ra.some((s) => /dock\/undock/i.test(s))).toBe(true);
  });

  it("sandboxCheck validates + reports config-form + conformance", () => {
    const good = sandboxCheck(newPluginManifest("vendor-ok", "device-connector"));
    expect(good.ok).toBe(true);
    expect(good.hasConfigForm).toBe(true);
    expect(good.conformance.length).toBeGreaterThan(0);
    // an incompatible apiVersion is rejected
    const bad = sandboxCheck({ id: "bad", name: "Bad", version: "1.0.0", kind: "skill", apiVersion: ">=9.0 <10.0" });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/incompatible/);
  });

  it("every extension point has a contract", () => {
    for (const ep of EXTENSION_POINTS) expect(ep.contract.length).toBeGreaterThan(0);
  });
});
