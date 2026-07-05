/**
 * Deployment-profile resolver tests — SYNAPSE ADR-007 (doc 33 F1).
 * Non-breaking default = site + whatever infra env configures.
 */
import { describe, it, expect } from "vitest";

import { resolveDeploymentProfile, describeDeployment } from "./deploymentProfile";

describe("resolveDeploymentProfile", () => {
  it("defaults to site edition when EDITION unset (backward-compatible)", () => {
    const p = resolveDeploymentProfile({});
    expect(p.edition).toBe("site");
    expect(p.topology).toBe("site-ha");
    expect(p.infraProfile).toBe("external"); // site default
    expect(p.profileEnforced).toBe(false);
  });

  it("machine edition defaults to embedded infra", () => {
    const p = resolveDeploymentProfile({ EDITION: "machine" });
    expect(p.edition).toBe("machine");
    expect(p.topology).toBe("single-node");
    expect(p.infraProfile).toBe("embedded");
  });

  it("INFRA_PROFILE overrides the edition default", () => {
    const p = resolveDeploymentProfile({ EDITION: "machine", INFRA_PROFILE: "external" });
    expect(p.infraProfile).toBe("external");
  });

  it("detects external broker from UNS_BROKER_URL / EXTERNAL_MQTT_ENABLED", () => {
    expect(resolveDeploymentProfile({}).broker).toBe("embedded-aedes");
    expect(resolveDeploymentProfile({ UNS_BROKER_URL: "mqtt://emqx:1883" }).broker).toBe(
      "external-emqx",
    );
    expect(resolveDeploymentProfile({ EXTERNAL_MQTT_ENABLED: "true" }).broker).toBe("external-emqx");
  });

  it("detects dedicated time-series from TSDB_URL, else main-db", () => {
    expect(resolveDeploymentProfile({}).timeseries).toBe("main-db");
    expect(
      resolveDeploymentProfile({ TSDB_URL: "postgres://tsdb:tsdb@ts:5432/ts" }).timeseries,
    ).toBe("dedicated-timescale");
  });

  it("invalid EDITION falls back to site", () => {
    expect(resolveDeploymentProfile({ EDITION: "bogus" }).edition).toBe("site");
    expect(resolveDeploymentProfile({ EDITION: "MACHINE" }).edition).toBe("machine"); // case-insensitive
  });

  it("EDITION_PROFILE flag toggles profileEnforced", () => {
    expect(resolveDeploymentProfile({ EDITION_PROFILE: "true" }).profileEnforced).toBe(true);
  });

  it("describeDeployment yields a readable one-liner", () => {
    const s = describeDeployment(resolveDeploymentProfile({ EDITION: "machine" }));
    expect(s).toContain("Machine Edition");
    expect(s).toContain("infra=embedded");
  });
});
