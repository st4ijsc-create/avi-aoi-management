/**
 * doc 81 Đợt 7 task K3 — CONTRACT: the plugin sidecar driver's connect HANDSHAKE is bound to the session generation
 * (and to the transport it was sent on), the same rule as the Đợt 5 F2 late-disconnect fix (R-5-e).
 *
 *   A handshake (`connect` RPC) that completes LATE — after a disconnect() and a newer connect() started a fresh
 *   session, or after a watchdog restart replaced the transport — must NOT:
 *     • mark the newer session connected before ITS OWN handshake completed (reads/writes would reach a sidecar
 *       whose device connection is not established),
 *     • tear the newer session down when it FAILS (the old connect()'s fail-safe disconnect),
 *     • write lastError over the newer session.
 *   The superseded connect() itself rejects (fail-closed: the caller never believes a dropped session connected).
 *
 * Why it matters: ConnectionSupervisor.resetSession reuses the SAME driver object (disconnect → connect), and a STOP
 * right after a session reset rides that fresh session (re-review Đợt 5 group F, "plugin handshake generation").
 *
 * Harness: the process spawner is faked (no child process); every fake transport's `connect` RPC answers only when the
 * test settles it. Every wait is bounded by an explicit timer, not the vitest timeout.
 */
import { describe, it, expect, vi } from "vitest";
import type { OtDriver, OtConnectionConfig } from "../ot/otDriver";

const PS = vi.hoisted(() => ({
  /** every onSpawn callback handed to a spawner (index = supervisor order) */
  onSpawns: [] as Array<(t: unknown, h: unknown) => void>,
  spawn: null as null | ((onSpawn: (t: unknown, h: unknown) => void) => unknown),
}));
vi.mock("./sidecar/nodeSpawner", () => ({
  createSupervisedTransportSpawner: (onSpawn: (t: unknown, h: unknown) => void) => {
    PS.onSpawns.push(onSpawn);
    return () => PS.spawn!(onSpawn);
  },
}));
import { createPluginDriver } from "./pluginDriverBridge";

function within<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: not settled within ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
const tick = () => new Promise<void>((r) => setImmediate(r));

/** A fake sidecar transport: `connect` RPC is held until the test settles it; every other RPC answers at once. */
type FakeTransport = {
  id: number;
  closeCalls: number;
  connectCalls: number;
  pendingConnect: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>;
  request(method: string): Promise<unknown>;
  close(): void;
};
let seq = 0;
function fakeTransport(): FakeTransport {
  const t: FakeTransport = {
    id: ++seq,
    closeCalls: 0,
    connectCalls: 0,
    pendingConnect: [],
    request(method: string) {
      if (method === "connect") {
        t.connectCalls++;
        return new Promise((resolve, reject) => t.pendingConnect.push({ resolve, reject }));
      }
      if (method === "health") return Promise.resolve({ connected: true, latencyMs: 1 });
      return Promise.resolve({ ok: true });
    },
    close() {
      t.closeCalls++;
    },
  };
  return t;
}
function settleConnect(t: FakeTransport, outcome: "ok" | "fail"): void {
  const p = t.pendingConnect.shift();
  if (!p) throw new Error(`transport #${t.id} has no pending connect RPC`);
  if (outcome === "ok") p.resolve({ ok: true });
  else p.reject(new Error(`transport #${t.id} device connect failed`));
}

function make(): { d: OtDriver; transports: FakeTransport[]; kills: number[]; cfg: OtConnectionConfig } {
  PS.onSpawns.length = 0;
  const transports: FakeTransport[] = [];
  const kills: number[] = [];
  PS.spawn = (onSpawn) => {
    const t = fakeTransport();
    const child = {
      kill() {
        kills.push(t.id);
      },
      onExit() {
        /* the fake child never exits by itself */
      },
    };
    transports.push(t);
    onSpawn(t, child);
    return child;
  };
  const d = createPluginDriver(
    {
      id: "k3-plugin",
      name: "K3 plugin",
      version: "1.0.0",
      apiVersion: "1",
      kind: "device-connector",
      protocols: ["k3-vendor"],
      sidecar: { command: "never-spawned", args: [] },
      signed: { pluginId: "k3-plugin", version: "1.0.0", artifactSha256: "0".repeat(64) },
    } as unknown as Parameters<typeof createPluginDriver>[0],
    { publisherPublicKeyPem: null, requireSignature: false, callTimeoutMs: 3000, rate: { capacity: 100, refillPerSec: 100 } },
  );
  return { d, transports, kills, cfg: { endpoint: "plugin://k3" } };
}
const transportOf = (d: OtDriver) => (d as unknown as { transport: unknown }).transport;
const lastErrorOf = (d: OtDriver) => (d as unknown as { lastError: string | null }).lastError;

describe("doc 81 Đợt 7 K3 — plugin handshake carries the session generation", () => {
  it("control: a handshake that completes in its own session marks the driver connected", async () => {
    const { d, transports, cfg } = make();
    const c = d.connect(cfg);
    await tick();
    expect(d.isConnected()).toBe(false); // not usable before the handshake answers
    settleConnect(transports[0]!, "ok");
    await within(c, 3000, "connect");
    expect(d.isConnected()).toBe(true);
    await within(d.disconnect(), 3000, "cleanup");
  });

  it("a LATE successful handshake of connect#1 (after disconnect → connect#2) does not mark session #2 connected", async () => {
    const { d, transports, cfg } = make();
    const c1 = d.connect(cfg);
    const c1Settled = c1.then(
      () => "resolved",
      (e: Error) => `rejected: ${e.message}`,
    );
    await tick();
    await within(d.disconnect(), 3000, "disconnect");
    const c2 = d.connect(cfg); // fresh supervisor + transport #2, its handshake still pending
    await tick();
    expect(transports).toHaveLength(2);
    expect(transportOf(d)).toBe(transports[1]);

    settleConnect(transports[0]!, "ok"); // session #1's handshake answers LATE
    const r1 = await within(c1Settled, 3000, "late connect#1");
    expect(r1).toMatch(/^rejected: .*superseded/); // fail-closed: the dropped session never "connected"
    await tick();
    expect(d.isConnected()).toBe(false); // ★ session #2 has NOT completed its own handshake
    expect(transportOf(d)).toBe(transports[1]);

    settleConnect(transports[1]!, "ok");
    await within(c2, 3000, "connect#2");
    expect(d.isConnected()).toBe(true);
    await within(d.disconnect(), 3000, "cleanup");
  });

  it("a LATE FAILED handshake of connect#1 never tears down the newer, connected session #2", async () => {
    const { d, transports, kills, cfg } = make();
    const c1 = d.connect(cfg);
    const c1Settled = c1.then(
      () => "resolved",
      (e: Error) => `rejected: ${e.message}`,
    );
    await tick();
    await within(d.disconnect(), 3000, "disconnect");
    const c2 = d.connect(cfg);
    await tick();
    settleConnect(transports[1]!, "ok");
    await within(c2, 3000, "connect#2");
    expect(d.isConnected()).toBe(true);
    const killsBefore = kills.length;

    settleConnect(transports[0]!, "fail"); // session #1's handshake FAILS late → its fail-safe teardown must be scoped
    const r1 = await within(c1Settled, 3000, "late failed connect#1");
    expect(r1).toMatch(/^rejected:/);
    await tick();
    expect(d.isConnected()).toBe(true); // ★ session #2 intact
    expect(transportOf(d)).toBe(transports[1]);
    expect(transports[1]!.closeCalls).toBe(0);
    expect(kills.slice(killsBefore)).not.toContain(transports[1]!.id);
    expect(lastErrorOf(d)).toBeNull(); // the old session's error is not written over the new one
    await within(d.disconnect(), 3000, "cleanup");
  });

  it("watchdog restarts: a re-handshake on an OLDER restart transport never marks the newer transport connected", async () => {
    const { d, transports, cfg } = make();
    const c = d.connect(cfg);
    await tick();
    settleConnect(transports[0]!, "ok");
    await within(c, 3000, "connect");
    expect(d.isConnected()).toBe(true);

    // The SAME supervisor restarts its crashed child twice; each fresh transport re-handshakes automatically.
    const r2 = fakeTransport();
    PS.onSpawns[0]!(r2, { kill() {}, onExit() {} });
    expect(r2.connectCalls).toBe(1);
    const r3 = fakeTransport();
    PS.onSpawns[0]!(r3, { kill() {}, onExit() {} });
    expect(r3.connectCalls).toBe(1);
    expect(transportOf(d)).toBe(r3);
    expect(d.isConnected()).toBe(false);

    settleConnect(r2, "ok"); // the restart #1 handshake answers after restart #2 replaced its transport
    await tick();
    await tick();
    expect(d.isConnected()).toBe(false); // ★ r3 has not completed its own handshake
    settleConnect(r3, "ok");
    await tick();
    await tick();
    expect(d.isConnected()).toBe(true);
    await within(d.disconnect(), 3000, "cleanup");
  });

  it("a late failed re-handshake on an older restart transport does not write lastError", async () => {
    const { d, transports, cfg } = make();
    const c = d.connect(cfg);
    await tick();
    settleConnect(transports[0]!, "ok");
    await within(c, 3000, "connect");
    const r2 = fakeTransport();
    PS.onSpawns[0]!(r2, { kill() {}, onExit() {} });
    const r3 = fakeTransport();
    PS.onSpawns[0]!(r3, { kill() {}, onExit() {} });
    settleConnect(r3, "ok");
    await tick();
    await tick();
    expect(d.isConnected()).toBe(true);
    settleConnect(r2, "fail");
    await tick();
    await tick();
    expect(lastErrorOf(d)).toBeNull();
    expect(d.isConnected()).toBe(true);
    await within(d.disconnect(), 3000, "cleanup");
  });
});
