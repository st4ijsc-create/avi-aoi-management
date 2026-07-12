/**
 * Join Wizard seam — doc 44 §9 / ADR-007. Pure tests (no broker, no multicast).
 *
 * Locks the HONEST posture: when the mDNS library is absent (it is not installed here),
 * discoverPeers returns MDNS_NOT_AVAILABLE rather than pretending — while the bridge config +
 * static-peer path + topic-filter plan keep working. Mirrors samlProvider's honest-seam tests.
 */
import { describe, it, expect } from "vitest";

import {
  isJoinWizardEnabled,
  mdnsAvailable,
  discoverPeers,
  planBridgeTopicFilters,
  getJoinBridgeConfig,
  parseStaticPeers,
  buildSelfAdvertisement,
  startJoinBridge,
  JOIN_DEFAULT_BROKER_PORT,
} from "./joinWizardService";

const ON = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ JOIN_WIZARD_ENABLED: "true", ...extra });

describe("joinWizard — flag", () => {
  it("default OFF; true/1 enable", () => {
    expect(isJoinWizardEnabled({})).toBe(false);
    expect(isJoinWizardEnabled({ JOIN_WIZARD_ENABLED: "true" })).toBe(true);
    expect(isJoinWizardEnabled({ JOIN_WIZARD_ENABLED: "1" })).toBe(true);
  });
});

describe("joinWizard — mDNS honest posture", () => {
  it("mdnsAvailable() is false in this environment (bonjour-service not installed)", async () => {
    expect(await mdnsAvailable()).toBe(false);
  });

  it("discoverPeers returns MDNS_NOT_AVAILABLE (no fabricated scan) when enabled but no lib", async () => {
    const res = await discoverPeers({ env: ON() });
    expect(res.available).toBe(false);
    expect(res.peers).toEqual([]);
    expect(res.reason).toContain("MDNS_NOT_AVAILABLE");
  });

  it("discoverPeers is a no-op with JOIN_WIZARD_DISABLED reason when the flag is off", async () => {
    const res = await discoverPeers({ env: {} });
    expect(res.available).toBe(false);
    expect(res.reason).toBe("JOIN_WIZARD_DISABLED");
  });

  it("static peers keep the wizard usable with NO mDNS library (multicast-free sites)", async () => {
    const res = await discoverPeers({ env: ON({ JOIN_STATIC_PEERS: "10.0.0.5:1883:mach-a, 10.0.0.6" }) });
    expect(res.available).toBe(true); // static peers satisfy the caller
    expect(res.peers.map((p) => p.nodeId)).toEqual(["mach-a", "10.0.0.6"]);
    expect(res.peers[0]).toMatchObject({ host: "10.0.0.5", port: 1883, source: "static" });
    expect(res.peers[1]).toMatchObject({ host: "10.0.0.6", port: JOIN_DEFAULT_BROKER_PORT });
  });
});

describe("joinWizard — bridge config + filters (usable now)", () => {
  it("bridges the synapse tree, plus legacy avi/# until cutover", () => {
    expect(planBridgeTopicFilters({})).toEqual(["synapse/#", "avi/#"]);
    expect(planBridgeTopicFilters({ MQTT_TOPIC_LEGACY_DISABLE: "true" })).toEqual(["synapse/#"]);
  });

  it("resolves the site broker from JOIN_SITE_BROKER_URL, falling back to UNS_BROKER_URL", () => {
    expect(getJoinBridgeConfig(ON({ JOIN_SITE_BROKER_URL: "mqtt://site:1883" })).siteBrokerUrl).toBe("mqtt://site:1883");
    expect(getJoinBridgeConfig(ON({ UNS_BROKER_URL: "mqtt://emqx:1883" })).siteBrokerUrl).toBe("mqtt://emqx:1883");
    expect(getJoinBridgeConfig(ON()).siteBrokerUrl).toBeNull();
  });

  it("startJoinBridge returns null (graceful) when disabled or no site broker", async () => {
    expect(await startJoinBridge({})).toBeNull(); // disabled
    expect(await startJoinBridge(ON())).toBeNull(); // enabled but no site broker
  });

  it("parseStaticPeers tolerates blanks and missing ports", () => {
    expect(parseStaticPeers({ JOIN_STATIC_PEERS: "" })).toEqual([]);
    expect(parseStaticPeers({ JOIN_STATIC_PEERS: "h1:1884, , h2" })).toHaveLength(2);
  });

  it("self advertisement reports the resolved edition", () => {
    const adv = buildSelfAdvertisement({ EDITION: "machine", EDGE_NODE_ID: "ipc-1" });
    expect(adv).toMatchObject({ nodeId: "ipc-1", edition: "machine", source: "mdns" });
  });
});
