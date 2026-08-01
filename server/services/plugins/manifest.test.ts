/**
 * Plugin manifest + registry + conformance tests — SYNAPSE ADR-008 (doc 33 F2).
 * Proves the apiVersion gate REJECTS incompatible plugins and the first-party seed
 * manifests all pass conformance (valid + apiVersion-compatible + config-form-able).
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  satisfiesApiVersion,
  validateManifest,
  parseVersion,
  PLUGIN_API_VERSION,
  type PluginManifest,
} from "@shared/plugin/manifest";
import {
  registerPlugin,
  tryRegisterPlugin,
  listPlugins,
  getPlugin,
  _clearPluginRegistry,
  PluginRejectedError,
} from "./pluginRegistry";
import { buildOtConnectorManifests } from "./otConnectorManifests";
import { zodToConfigForm } from "./configForm";
import { z } from "zod";

const good: PluginManifest = {
  id: "vendor-acme-screwdriver",
  name: "ACME Screwdriver",
  version: "1.4.2",
  apiVersion: "^1.0",
  kind: "device-connector",
  protocols: ["modbus-tcp"],
  signaturePresent: true,
};

describe("satisfiesApiVersion (current = 1.0)", () => {
  it("exact / caret / wildcard / range all resolve correctly", () => {
    expect(satisfiesApiVersion("1.0")).toBe(true);
    expect(satisfiesApiVersion("^1.0")).toBe(true);
    expect(satisfiesApiVersion("1.x")).toBe(true);
    expect(satisfiesApiVersion(">=1.0 <2.0")).toBe(true);
    // incompatible
    expect(satisfiesApiVersion("^2.0")).toBe(false);
    expect(satisfiesApiVersion(">=2.0 <3.0")).toBe(false);
    expect(satisfiesApiVersion("2.x")).toBe(false);
    expect(satisfiesApiVersion("0.9")).toBe(false);
  });
  it("fails closed on garbage ranges", () => {
    expect(satisfiesApiVersion("not-a-version")).toBe(false);
    expect(satisfiesApiVersion("")).toBe(false);
  });
  it("parseVersion handles major/minor/patch", () => {
    expect(parseVersion("1.4.2")).toEqual({ major: 1, minor: 4 });
    expect(parseVersion("2")).toEqual({ major: 2, minor: 0 });
    expect(parseVersion("x")).toBeNull();
  });
});

describe("validateManifest", () => {
  it("accepts a well-formed compatible manifest", () => {
    expect(validateManifest(good).ok).toBe(true);
  });
  it("rejects bad id / version / kind / apiVersion", () => {
    expect(validateManifest({ ...good, id: "BadID" }).ok).toBe(false);
    expect(validateManifest({ ...good, version: "not-semver" }).ok).toBe(false);
    expect(validateManifest({ ...good, kind: "nope" as never }).ok).toBe(false);
    const incompat = validateManifest({ ...good, apiVersion: ">=2.0 <3.0" });
    expect(incompat.ok).toBe(false);
    expect(incompat.errors.join(" ")).toMatch(/incompatible/);
  });
  it("requires signature only when asked (production)", () => {
    const unsigned = { ...good, signaturePresent: false };
    expect(validateManifest(unsigned, { requireSignature: false }).ok).toBe(true);
    expect(validateManifest(unsigned, { requireSignature: true }).ok).toBe(false);
  });
});

describe("pluginRegistry apiVersion gate", () => {
  beforeEach(() => _clearPluginRegistry());

  it("registerPlugin REJECTS an incompatible manifest (Hub refuses to load)", () => {
    expect(() => registerPlugin({ ...good, apiVersion: "^2.0" }, { requireSignature: false })).toThrow(
      PluginRejectedError,
    );
    expect(listPlugins()).toHaveLength(0);
  });
  it("registers + retrieves a compatible manifest", () => {
    registerPlugin(good, { requireSignature: false });
    expect(getPlugin(good.id)?.name).toBe("ACME Screwdriver");
  });
  it("tryRegisterPlugin returns errors instead of throwing", () => {
    const res = tryRegisterPlugin({ ...good, apiVersion: "9.9" }, { requireSignature: false });
    expect(res.ok).toBe(false);
    expect(listPlugins()).toHaveLength(0);
  });
});

describe("first-party OT connector seed manifests — conformance", () => {
  it("all 5 seeds are valid, compatible, signed, and have an auto-form config schema", () => {
    const seeds = buildOtConnectorManifests();
    expect(seeds).toHaveLength(5);
    for (const m of seeds) {
      const res = validateManifest(m, { requireSignature: true });
      expect(res.ok, `${m.id}: ${res.errors.join("; ")}`).toBe(true);
      expect(satisfiesApiVersion(m.apiVersion, PLUGIN_API_VERSION)).toBe(true);
      expect(m.configSchema).toBeTruthy();
      // config schema is a real JSON-Schema object
      expect((m.configSchema as Record<string, unknown>).type).toBe("object");
    }
  });
});

describe("zodToConfigForm", () => {
  it("produces a JSON-Schema object from a zod schema", () => {
    const form = zodToConfigForm(z.object({ host: z.string(), port: z.number() }));
    expect(form.type).toBe("object");
    expect((form as { properties?: Record<string, unknown> }).properties).toHaveProperty("host");
  });
});
