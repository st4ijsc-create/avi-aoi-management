/**
 * doc 81 Đợt 7 task J fix 1 (review #5) — the fingerprint card and its API use the SAME gate: settings_factory canEdit
 * (the stricter of the two the review found: the card was shown on canEdit, the API allowed canView).
 * Static oracle on the two source files (the permission middleware itself is covered by its own tests).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

describe("brokerTls gate — UI and API match", () => {
  it("API mqttClient.brokerTls requires settings_factory canEdit (not canView)", () => {
    const src = readFileSync(resolve(root, "server/routers/mqttOeeRouters.ts"), "utf8");
    const block = src.slice(src.indexOf("  brokerTls: "), src.indexOf("  brokerTls: ") + 400);
    expect(block.length).toBeGreaterThan(50);
    expect(block).toContain('.use(requirePermission("settings_factory", "canEdit"))');
    expect(block).not.toContain('"canView"');
  });

  it("the card is enabled by the canEdit-based gate (admin or settings_factory canEdit)", () => {
    const src = readFileSync(resolve(root, "client/src/pages/MqttClientManagement.tsx"), "utf8");
    expect(src).toContain("<MqttBrokerTlsCard enabled={canBindMachine} />");
    expect(src).toMatch(/const canBindMachine = coTheGanMayMqtt\(user\?\.role, user\?\.role === "admin" \|\| hasPermission\("settings_factory", "canEdit"\)\);/);
  });
});
