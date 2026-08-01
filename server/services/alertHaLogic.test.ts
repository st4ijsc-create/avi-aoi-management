/**
 * doc 54 P2.3 (Realtime HA) — focused PURE-logic unit tests.
 *
 * Covers the two pieces of load-bearing logic added this wave, WITHOUT any Redis/DB/socket I/O:
 *   1. Broker-disconnect / client-offline duration math (mqttService.compute*Minutes).
 *   2. The Redis-vs-memory cooldown fallback decision (alertEvaluationService.decideCooldown).
 */
import { describe, it, expect } from "vitest";
import {
  computeBrokerDisconnectMinutes,
  computeClientOfflineMinutes,
} from "./mqttService";
import { decideCooldown } from "./alertEvaluationService";

describe("computeBrokerDisconnectMinutes", () => {
  it("returns 0 when the external-broker feature is disabled", () => {
    // Even with a stale disconnect marker, a disabled feature must not raise BROKER_DISCONNECT.
    expect(
      computeBrokerDisconnectMinutes(
        { enabled: false, connected: false, disconnectedSince: 1_000 },
        1_000 + 10 * 60_000,
      ),
    ).toBe(0);
  });

  it("returns 0 while connected", () => {
    expect(
      computeBrokerDisconnectMinutes({ enabled: true, connected: true, disconnectedSince: null }, 999_999),
    ).toBe(0);
  });

  it("returns 0 when enabled+down but no recorded down-start", () => {
    expect(
      computeBrokerDisconnectMinutes({ enabled: true, connected: false, disconnectedSince: null }, 5_000),
    ).toBe(0);
  });

  it("returns REAL minutes since the disconnect started", () => {
    const since = 1_000_000;
    const now = since + 5 * 60_000; // 5 minutes later
    expect(
      computeBrokerDisconnectMinutes({ enabled: true, connected: false, disconnectedSince: since }, now),
    ).toBe(5);
  });

  it("never goes negative on clock skew", () => {
    expect(
      computeBrokerDisconnectMinutes({ enabled: true, connected: false, disconnectedSince: 2_000 }, 1_000),
    ).toBe(0);
  });
});

describe("computeClientOfflineMinutes", () => {
  it("returns 0 while at least one client is connected", () => {
    expect(computeClientOfflineMinutes({ connectedClients: 3, lastSeenAt: 1_000 }, 10_000_000)).toBe(0);
  });

  it("returns 0 when a client was never seen (no baseline)", () => {
    expect(computeClientOfflineMinutes({ connectedClients: 0, lastSeenAt: null }, 10_000_000)).toBe(0);
  });

  it("returns REAL minutes since last seen when all clients are offline", () => {
    const seen = 2_000_000;
    const now = seen + 12 * 60_000; // 12 minutes later
    expect(computeClientOfflineMinutes({ connectedClients: 0, lastSeenAt: seen }, now)).toBe(12);
  });

  it("never goes negative on clock skew", () => {
    expect(computeClientOfflineMinutes({ connectedClients: 0, lastSeenAt: 5_000 }, 1_000)).toBe(0);
  });
});

describe("decideCooldown (Redis-vs-memory fallback)", () => {
  const cooldownMs = 5 * 60_000;

  it("proceeds + stamps memory when Redis atomically claims the slot", () => {
    expect(decideCooldown({ redisClaim: true, lastMemoryTs: undefined, cooldownMs, now: 1_000 })).toEqual({
      proceed: true,
      nextMemoryTs: 1_000,
    });
  });

  it("skips (cluster dedup) when Redis reports the key already held", () => {
    const d = decideCooldown({ redisClaim: false, lastMemoryTs: undefined, cooldownMs, now: 1_000 });
    expect(d.proceed).toBe(false);
    expect(d.nextMemoryTs).toBeUndefined(); // do NOT touch memory when another instance owns it
  });

  it("falls back to memory when Redis unavailable — within cooldown → skip", () => {
    const now = 1_000_000;
    expect(
      decideCooldown({ redisClaim: null, lastMemoryTs: now - 60_000, cooldownMs, now }).proceed,
    ).toBe(false);
  });

  it("falls back to memory when Redis unavailable — cooldown expired → proceed", () => {
    const now = 1_000_000;
    const d = decideCooldown({ redisClaim: null, lastMemoryTs: now - 6 * 60_000, cooldownMs, now });
    expect(d.proceed).toBe(true);
    expect(d.nextMemoryTs).toBe(now);
  });

  it("falls back to memory when Redis unavailable — no prior trigger → proceed", () => {
    expect(decideCooldown({ redisClaim: null, lastMemoryTs: undefined, cooldownMs, now: 42 })).toEqual({
      proceed: true,
      nextMemoryTs: 42,
    });
  });

  it("cooldown <= 0 always fires (legacy single-node behaviour), regardless of Redis/memory", () => {
    expect(decideCooldown({ redisClaim: false, lastMemoryTs: 999, cooldownMs: 0, now: 1_000 })).toEqual({
      proceed: true,
      nextMemoryTs: 1_000,
    });
  });
});
