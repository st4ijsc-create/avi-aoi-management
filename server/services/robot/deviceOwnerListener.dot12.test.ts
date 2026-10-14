/**
 * doc 81 Đợt 12 task P fix 1 — ruling R-12-b: the `device_owner_changed` listener (Đợt 10 D) gets the same heartbeat / alert /
 * reconnect as `ot_stop_epoch` (the shared pgChannelListener). Before: a LISTEN that stopped delivering (a failed postgres.js
 * automatic re-LISTEN drops the channel silently) went unnoticed — no alert, no re-LISTEN; only the 30 s reconcile.
 * Fake DB (no connection); the LISTEN / NOTIFY clients are an in-memory bus.
 */
import { describe, it, expect, vi } from "vitest";

const H = vi.hoisted(() => ({ executes: 0 }));
vi.mock("../../db/connection", () => ({
  isEdgeProcessRole: () => false,
  getDb: async () => ({ execute: async () => (H.executes++, []), select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }),
  getNotifyClient: () => null,
}));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => undefined,
  activeRobotIds: () => [],
  isCentralRobotGatewayOn: () => true,
  robotTriedAtStart: () => true,
  attachRobot: async () => true,
  detachRobot: async () => true,
}));
vi.mock("../ot/otManager", () => ({ isOtGatewayOn: () => false, getActiveAdapter: () => undefined, otAdapterTriedAtStart: () => true, onOtGatewayStarted: () => () => undefined }));

import { startDeviceOwnershipSync, deviceOwnerListenerStatus, DEVICE_OWNER_CHANNEL } from "./deviceOwnershipService";

type Sub = { fn: (p: string) => void; onlisten?: () => void; active: boolean };
function bus() {
  const subs: Sub[] = [];
  const c = {
    subs,
    listenCalls: 0,
    loopback: true,
    async listen(ch: string, fn: (p: string) => void, onlisten?: () => void) {
      expect(ch).toBe(DEVICE_OWNER_CHANNEL);
      c.listenCalls += 1;
      const s: Sub = { fn, onlisten, active: true };
      subs.push(s);
      onlisten?.();
      return { unlisten: async () => void (s.active = false) };
    },
    async notify(_ch: string, payload: string) {
      if (c.loopback) setTimeout(() => c.deliver(payload), 1);
      return [];
    },
    deliver(p: string) {
      for (const s of subs) if (s.active) s.fn(p);
    },
    reconnect() {
      for (const s of subs) if (s.active) s.onlisten?.();
    },
  };
  return c;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(2);
  }
  return true;
}

describe("R-12-b — device_owner_changed: heartbeat, alert, reconnect", () => {
  it("★ the LISTEN stops delivering: a lost alert, a fresh LISTEN, recovered once the heartbeat returns", async () => {
    const c = bus();
    const alerts: Array<{ kind: string; channel: string; reason: string }> = [];
    const stop = await startDeviceOwnershipSync({
      listenClient: async () => c,
      notifyClient: async () => c,
      pingMs: 15,
      pingDeadlineMs: 30,
      listenRetryMs: 20,
      listenAlert: (a: { kind: string; channel: string; reason: string }) => void alerts.push(a),
    } as never);
    try {
      expect(await until(() => (deviceOwnerListenerStatus()?.lastPingRttMs ?? null) !== null)).toBe(true);
      c.loopback = false; // the subscription goes silent (e.g. a failed automatic re-LISTEN)
      expect(await until(() => alerts.some((a) => a.kind === "lost"))).toBe(true);
      expect(alerts[0]).toMatchObject({ channel: DEVICE_OWNER_CHANNEL, reason: "heartbeat not received" });
      expect(await until(() => c.listenCalls >= 2)).toBe(true);
      c.loopback = true;
      expect(await until(() => alerts.some((a) => a.kind === "recovered"))).toBe(true);
      expect(deviceOwnerListenerStatus()?.state).toBe("ok");
    } finally {
      await stop();
    }
  });

  it("★ postgres re-LISTENed after a dropped connection: the gap is alerted (lost + recovered)", async () => {
    const c = bus();
    const alerts: Array<{ kind: string }> = [];
    const stop = await startDeviceOwnershipSync({ listenClient: async () => c, notifyClient: async () => c, pingMs: 60_000, listenAlert: (a: { kind: string; channel: string; reason: string }) => void alerts.push(a) } as never);
    try {
      c.reconnect();
      expect(alerts.map((a) => a.kind)).toEqual(["lost", "recovered"]);
      expect(deviceOwnerListenerStatus()?.reconnects).toBe(1);
    } finally {
      await stop();
    }
  });

  it("heartbeats on the channel (any replica's) never trigger a reconcile; an unknown payload still does (control)", async () => {
    const c = bus();
    const stop = await startDeviceOwnershipSync({ listenClient: async () => c, notifyClient: async () => c, pingMs: 60_000, reconcileMs: 600_000, sweepMs: 600_000 } as never);
    try {
      await sleep(100); // the boot reconcile + sweep settle
      const n0 = H.executes;
      c.deliver(JSON.stringify({ hb: 1, listener: "other-replica-01", nonce: "nonce-000001" }));
      await sleep(50);
      expect(H.executes).toBe(n0);
      c.deliver(JSON.stringify({ kind: "unknown", id: 1 }));
      expect(await until(() => H.executes > n0)).toBe(true);
    } finally {
      await stop();
    }
  });
});
