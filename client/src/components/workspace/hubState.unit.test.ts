// doc 59 P0 — pure TabbedHub URL helpers (node-env unit test).
import { describe, it, expect } from "vitest";
import { resolveActiveTab, buildTabHref } from "./hubState";

const TABS = ["fleet", "health", "oee", "field"] as const;

describe("resolveActiveTab", () => {
  it("returns the ?tab= value when valid", () => {
    expect(resolveActiveTab("?tab=health", TABS, "fleet")).toBe("health");
    expect(resolveActiveTab("tab=oee", TABS, "fleet")).toBe("oee");
  });
  it("falls back when the tab is missing or invalid", () => {
    expect(resolveActiveTab("", TABS, "fleet")).toBe("fleet");
    expect(resolveActiveTab("?tab=nope", TABS, "fleet")).toBe("fleet");
    expect(resolveActiveTab("?other=1", TABS, "field")).toBe("field");
  });
  it("ignores other params when reading the tab", () => {
    expect(resolveActiveTab("?machine=243&tab=oee", TABS, "fleet")).toBe("oee");
  });
});

describe("buildTabHref", () => {
  it("sets ?tab= on a clean base", () => {
    expect(buildTabHref("/device-monitor", "", "health")).toBe("/device-monitor?tab=health");
  });
  it("PRESERVES other query params (master-detail ?machine=)", () => {
    const href = buildTabHref("/device-monitor", "?machine=243&tab=fleet", "config");
    const qs = new URLSearchParams(href.split("?")[1]);
    expect(qs.get("machine")).toBe("243");
    expect(qs.get("tab")).toBe("config");
  });
  it("replaces an existing tab rather than duplicating it", () => {
    const href = buildTabHref("/device-monitor", "?tab=fleet", "oee");
    expect(href).toBe("/device-monitor?tab=oee");
    expect((href.match(/tab=/g) || []).length).toBe(1);
  });
});
