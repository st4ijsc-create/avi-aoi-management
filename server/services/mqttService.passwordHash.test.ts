/**
 * Doc 27 Đợt 2 / W2-C — MQTT device password HASH-AT-REST tests (gap R12).
 *
 * verifyMqttDevicePassword: bcrypt verification against passwordHash, legacy
 * plaintext constant-time match with transparent upgrade-hash-in-place, and the
 * "no credential configured → not enforced" compatibility rule.
 */
import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { verifyMqttDevicePassword, getInboundDbRetryStatus, _resetInboundDbRetry } from "./mqttService";

describe("verifyMqttDevicePassword (R12 — hash at rest)", () => {
  it("verifies against a stored bcrypt hash (no upgrade needed)", async () => {
    const passwordHash = await bcrypt.hash("s3cret-device-pw", 10);
    const ok = await verifyMqttDevicePassword({ passwordHash }, "s3cret-device-pw");
    expect(ok.ok).toBe(true);
    expect(ok.upgradeHash).toBeUndefined();

    const bad = await verifyMqttDevicePassword({ passwordHash }, "wrong");
    expect(bad.ok).toBe(false);
  });

  it("legacy plaintext match → ok + upgradeHash (transparent upgrade-in-place)", async () => {
    const verdict = await verifyMqttDevicePassword({ password: "legacy-pw" }, "legacy-pw");
    expect(verdict.ok).toBe(true);
    expect(verdict.upgradeHash).toBeTruthy();
    // the upgrade hash actually verifies the same secret (what the broker
    // persists into passwordHash while clearing the plaintext column)
    expect(await bcrypt.compare("legacy-pw", verdict.upgradeHash!)).toBe(true);
    // …and a subsequent connect verifies via the hash path
    const next = await verifyMqttDevicePassword({ passwordHash: verdict.upgradeHash }, "legacy-pw");
    expect(next.ok).toBe(true);
    expect(next.upgradeHash).toBeUndefined();
  });

  it("legacy plaintext mismatch → rejected, NO upgrade hash leaked", async () => {
    const verdict = await verifyMqttDevicePassword({ password: "legacy-pw" }, "nope");
    expect(verdict.ok).toBe(false);
    expect(verdict.upgradeHash).toBeUndefined();
  });

  it("hash takes precedence over a lingering plaintext column", async () => {
    const passwordHash = await bcrypt.hash("hashed-pw", 10);
    // plaintext says something else — the hash is authoritative
    const verdict = await verifyMqttDevicePassword({ passwordHash, password: "stale-plaintext" }, "hashed-pw");
    expect(verdict.ok).toBe(true);
    const stale = await verifyMqttDevicePassword({ passwordHash, password: "stale-plaintext" }, "stale-plaintext");
    expect(stale.ok).toBe(false);
  });

  it("no credential configured → not enforced (never locks out existing devices)", async () => {
    expect((await verifyMqttDevicePassword({}, "anything")).ok).toBe(true);
    expect((await verifyMqttDevicePassword({ password: null, passwordHash: null }, "")).ok).toBe(true);
  });
});

describe("inbound DB-retry buffer (C5) — observability surface", () => {
  it("starts empty and resets cleanly", () => {
    _resetInboundDbRetry();
    expect(getInboundDbRetryStatus()).toEqual({ queued: 0, dropped: 0 });
  });
});
