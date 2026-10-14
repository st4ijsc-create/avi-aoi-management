/**
 * doc 81 Đợt 12 task P (+ fix 1) — otStopEpochSync without a database: an in-memory LISTEN/NOTIFY bus stands in for the postgres
 * client (the real NOTIFY path is stopEpochCrossReplica.dot12.db.test.ts; the listener liveness is pgChannelListener.dot12.test.ts).
 * Covers: the broadcast never on the STOP's path; R-12-c — HMAC (key from HKDF of SECRET_ENCRYPTION_KEY or OT_STOP_EPOCH_HMAC_KEY,
 * fail closed without one, never printed), strict shape, own replica ignored, freshness, replay WINDOW (reordering accepted),
 * one alert per rejection episode; I-3 overflow alert; the edge role; stop().
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { bumpAdapterStopEpoch, adapterStopEpoch, setStopEpochBroadcaster } from "./otDeviceWrite";
import {
  startOtStopEpochSync,
  otStopEpochSyncStatus,
  parseStopEpochPayload,
  resolveStopEpochKey,
  signStopEpochMessage,
  OT_STOP_EPOCH_REPLICA_ID,
  OT_STOP_EPOCH_CHANNEL,
  OT_STOP_EPOCH_MAX_AGE_MS,
  type StopEpochSyncAlert,
} from "./otStopEpochSync";

const SECRET = "test-secret-encryption-key-0123456789abcdef";
const ENV = { SECRET_ENCRYPTION_KEY: SECRET } as NodeJS.ProcessEnv;
const KEY = (resolveStopEpochKey(ENV) as { key: Buffer }).key;

type Sub = { fn: (p: string) => void; onlisten?: () => void; active: boolean };
function bus() {
  const subs: Sub[] = [];
  const c = {
    subs,
    listenCalls: 0,
    notified: [] as string[],
    notifyImpl: null as null | ((p: string) => Promise<unknown>),
    async listen(ch: string, fn: (p: string) => void, onlisten?: () => void) {
      expect(ch).toBe(OT_STOP_EPOCH_CHANNEL);
      c.listenCalls += 1;
      const s: Sub = { fn, onlisten, active: true };
      subs.push(s);
      onlisten?.();
      return { unlisten: async () => void (s.active = false) };
    },
    async notify(ch: string, payload: string) {
      expect(ch).toBe(OT_STOP_EPOCH_CHANNEL);
      c.notified.push(payload);
      if (c.notifyImpl) return c.notifyImpl(payload);
      setTimeout(() => c.deliver(payload), 1);
      return [];
    },
    deliver(p: string) {
      for (const s of subs) if (s.active) s.fn(p);
    },
  };
  return c;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(2);
  }
  return true;
}
let peerSeq = 0;
const PEER = "peer-replica-0001";
const signed = (adapterId: number, over: Partial<{ replicaId: string; seq: number; issuedAt: number; key: Buffer }> = {}) =>
  JSON.stringify(signStopEpochMessage(over.key ?? KEY, { replicaId: over.replicaId ?? PEER, seq: over.seq ?? ++peerSeq + 1_000, issuedAt: over.issuedAt ?? Date.now(), adapterId }));

let stopFn: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (stopFn) await stopFn();
  stopFn = null;
  delete process.env.AVI_PROCESS_ROLE;
  setStopEpochBroadcaster(null);
  vi.restoreAllMocks();
});
async function start(c: ReturnType<typeof bus>, alerts: StopEpochSyncAlert[], o: Record<string, unknown> = {}) {
  stopFn = await startOtStopEpochSync({ listenClient: () => c, notifyClient: () => c, env: ENV, pingMs: 60_000, alert: (a) => void alerts.push(a), ...o });
  return stopFn;
}

describe("key (R-12-c): HKDF subkey, optional override, fail closed", () => {
  it("derives a 32-byte subkey from SECRET_ENCRYPTION_KEY (never the raw secret); OT_STOP_EPOCH_HMAC_KEY overrides; neither ⇒ null", () => {
    const a = resolveStopEpochKey({ SECRET_ENCRYPTION_KEY: SECRET } as NodeJS.ProcessEnv);
    expect(a.source).toBe("SECRET_ENCRYPTION_KEY");
    expect(a.key?.length).toBe(32);
    expect(a.key?.toString("utf8")).not.toContain(SECRET.slice(0, 16));
    const b = resolveStopEpochKey({ SECRET_ENCRYPTION_KEY: SECRET, OT_STOP_EPOCH_HMAC_KEY: "x".repeat(40) } as NodeJS.ProcessEnv);
    expect(b.source).toBe("OT_STOP_EPOCH_HMAC_KEY");
    expect(b.key?.equals(a.key!)).toBe(false);
    expect(resolveStopEpochKey({ JWT_SECRET: "a".repeat(64), SESSION_SECRET: "b".repeat(64) } as NodeJS.ProcessEnv).key).toBeNull(); // no JWT fallback
    expect(resolveStopEpochKey({ OT_STOP_EPOCH_HMAC_KEY: "short", SECRET_ENCRYPTION_KEY: SECRET } as NodeJS.ProcessEnv).key).toBeNull(); // weak override: fail closed
  });

  it("★ no key: nothing is sent, nothing is accepted, ONE no_key alert — and the key never appears in status, alerts or the console", async () => {
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts, { env: {} as NodeJS.ProcessEnv });
    expect(alerts.map((a) => a.kind)).toEqual(["no_key"]);
    bumpAdapterStopEpoch(990_100, null);
    await tick();
    expect(c.notified.filter((p) => p.includes('"kind":"stop"'))).toEqual([]);
    expect(otStopEpochSyncStatus().unsignedNotSent).toBeGreaterThan(0);
    c.deliver(signed(990_101));
    expect(adapterStopEpoch(990_101)).toBe(0);
    expect(otStopEpochSyncStatus().state).toBe("degraded");
  });

  it("the key material never reaches the status, an alert or the console", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts);
    c.deliver(signed(990_102, { key: Buffer.alloc(32, 7) })); // bad MAC ⇒ rejection alert
    c.deliver("garbage");
    const everything = JSON.stringify(otStopEpochSyncStatus()) + JSON.stringify(alerts) + logs.join("\n");
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(KEY.toString("hex"));
    expect(everything).not.toContain(KEY.toString("base64"));
  });
});

describe("send side — never on the STOP's path (L-7), signed", () => {
  it("the bump is synchronous; the signed NOTIFY starts only on the next macrotask and verifies", async () => {
    const c = bus();
    await start(c, []);
    const at0 = Date.now();
    bumpAdapterStopEpoch(990_001, { idempotencyKey: "k" });
    expect(c.notified.length).toBe(0);
    await tick();
    await tick();
    const m = parseStopEpochPayload(c.notified.find((p) => p.includes('"kind":"stop"')));
    expect(m).toMatchObject({ v: 2, kind: "stop", replicaId: OT_STOP_EPOCH_REPLICA_ID, adapterId: 990_001 });
    expect(m!.issuedAt).toBeGreaterThanOrEqual(at0);
    expect(m!.mac).toBe(signStopEpochMessage(KEY, { replicaId: m!.replicaId, seq: m!.seq, issuedAt: m!.issuedAt, adapterId: m!.adapterId }).mac);
  });

  it("a NOTIFY that never answers: the bump still returns at once; the send gives up after its deadline (counted)", async () => {
    const c = bus();
    c.notifyImpl = () => new Promise(() => undefined);
    await start(c, [], { notifyDeadlineMs: 30 });
    const failed0 = otStopEpochSyncStatus().notifyFailed;
    const t0 = performance.now();
    bumpAdapterStopEpoch(990_002, null);
    expect(performance.now() - t0).toBeLessThan(5);
    expect(await until(() => otStopEpochSyncStatus().notifyFailed > failed0, 1_000)).toBe(true);
  });

  it("the broadcaster itself is never called inside the bump; a throwing one never reaches the caller", async () => {
    const calls: unknown[] = [];
    setStopEpochBroadcaster((m) => void calls.push(m));
    const e = bumpAdapterStopEpoch(990_004, null);
    await Promise.resolve();
    expect(calls).toEqual([]);
    await tick();
    expect(calls).toEqual([{ adapterId: 990_004, epoch: e, at: expect.any(Number) }]);
    setStopEpochBroadcaster(() => {
      throw new Error("boom");
    });
    expect(() => bumpAdapterStopEpoch(990_003, null)).not.toThrow();
    await tick();
  });
});

describe("receive side (R-12-c)", () => {
  it("a signed peer STOP moves this process's epoch once; its own (signed) STOP is ignored", async () => {
    const c = bus();
    await start(c, []);
    const s0 = otStopEpochSyncStatus();
    c.deliver(signed(990_010));
    expect(adapterStopEpoch(990_010)).toBeGreaterThan(0);
    expect(otStopEpochSyncStatus().peerStops).toBe(s0.peerStops + 1);
    const e = bumpAdapterStopEpoch(990_011, null);
    expect(await until(() => otStopEpochSyncStatus().ignoredOwn > s0.ignoredOwn)).toBe(true);
    expect(adapterStopEpoch(990_011)).toBe(e);
  });

  it("★ rejected and counted, nothing moves: unsigned v1, bad MAC, tampered adapterId, stale, future-dated, replayed", async () => {
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts);
    const r0 = otStopEpochSyncStatus().rejectedBy;
    c.deliver(JSON.stringify({ v: 1, kind: "stop", origin: PEER, adapterId: 990_020, epoch: 7, at: Date.now() })); // the old unsigned shape
    c.deliver(signed(990_021, { key: Buffer.alloc(32, 9) }));
    const t = JSON.parse(signed(990_022));
    c.deliver(JSON.stringify({ ...t, adapterId: 990_023 })); // tampered
    c.deliver(signed(990_024, { issuedAt: Date.now() - OT_STOP_EPOCH_MAX_AGE_MS - 1_000 }));
    c.deliver(signed(990_025, { issuedAt: Date.now() + OT_STOP_EPOCH_MAX_AGE_MS + 1_000 }));
    const once = signed(990_026, { seq: 77 });
    c.deliver(once);
    const e26 = adapterStopEpoch(990_026);
    expect(e26).toBeGreaterThan(0);
    c.deliver(once); // replay
    for (const a of [990_020, 990_021, 990_022, 990_023, 990_024, 990_025]) expect(adapterStopEpoch(a)).toBe(0);
    expect(adapterStopEpoch(990_026)).toBe(e26);
    const r = otStopEpochSyncStatus().rejectedBy;
    expect(r.malformed - r0.malformed).toBe(1);
    expect(r.bad_mac - r0.bad_mac).toBe(2);
    expect(r.stale - r0.stale).toBe(2);
    expect(r.replay - r0.replay).toBe(1);
    expect(alerts.filter((a) => a.kind === "rejected")).toHaveLength(1); // ONE alert for the episode
  });

  it("★ replay WINDOW, not strict seq: messages reordered by the pool are all accepted (seq 5 after seq 9)", async () => {
    const c = bus();
    await start(c, []);
    const R = "reorder-replica-01";
    c.deliver(signed(990_030, { replicaId: R, seq: 9 }));
    c.deliver(signed(990_031, { replicaId: R, seq: 5 }));
    c.deliver(signed(990_032, { replicaId: R, seq: 7 }));
    expect([990_030, 990_031, 990_032].every((a) => adapterStopEpoch(a) > 0)).toBe(true);
  });

  it("I-3: the peer map overflow raises ONE peer_overflow alert (and every signed STOP still lands)", async () => {
    vi.resetModules();
    const dw = await import("./otDeviceWrite");
    const sync = await import("./otStopEpochSync");
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    const stop = await sync.startOtStopEpochSync({ listenClient: () => c, notifyClient: () => c, env: ENV, pingMs: 60_000, alert: (a) => void alerts.push(a) });
    try {
      for (let i = 1; i <= dw.OT_STOP_EPOCH_PEER_ADAPTERS_MAX; i++) dw.bumpAdapterStopEpochFromPeer(i, { peer: true });
      const key = (sync.resolveStopEpochKey(ENV) as { key: Buffer }).key;
      for (const [n, a] of [[1, 3_000_000_001], [2, 3_000_000_002]] as const) c.deliver(JSON.stringify(sync.signStopEpochMessage(key, { replicaId: PEER, seq: n, issuedAt: Date.now(), adapterId: a - 1_000_000_000 })));
      expect(dw.adapterStopEpoch(2_000_000_001)).toBeGreaterThan(0);
      expect(dw.adapterStopEpoch(2_000_000_002)).toBeGreaterThan(0);
      expect(alerts.filter((a) => a.kind === "peer_overflow")).toHaveLength(1);
      expect(sync.otStopEpochSyncStatus().peerEvictions).toBe(2);
    } finally {
      await stop();
    }
  });

  it("the EDGE role: nothing starts (no LISTEN, no broadcast)", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    const c = bus();
    await start(c, []);
    bumpAdapterStopEpoch(990_050, null);
    await tick();
    expect(c.listenCalls).toBe(0);
    expect(c.notified.length).toBe(0);
  });

  it("stop(): broadcaster removed, LISTEN removed; a second start while running returns the same instance", async () => {
    const c = bus();
    const s1 = await start(c, []);
    const s2 = await startOtStopEpochSync({ listenClient: () => c, notifyClient: () => c, env: ENV });
    expect(s2).toBe(s1);
    expect(c.listenCalls).toBe(1);
    await s1();
    stopFn = null;
    const sent = c.notified.length;
    bumpAdapterStopEpoch(990_040, null);
    await sleep(20);
    expect(c.notified.length).toBe(sent);
    expect(c.subs.every((s) => !s.active)).toBe(true);
    expect(otStopEpochSyncStatus().state).toBe("off");
  });
});

describe("parseStopEpochPayload — strict v2", () => {
  const ok = signStopEpochMessage(KEY, { replicaId: PEER, seq: 3, issuedAt: 1_700_000_000_000, adapterId: 5 });
  it("accepts exactly a v2 stop", () => expect(parseStopEpochPayload(JSON.stringify(ok))).toEqual(ok));
  const bad: Array<[string, unknown]> = [
    ["not a string", 5],
    ["not JSON", "{"],
    ["array", JSON.stringify([ok])],
    ["extra key", JSON.stringify({ ...ok, x: 1 })],
    ["v 1", JSON.stringify({ ...ok, v: 1 })],
    ["kind ping", JSON.stringify({ ...ok, kind: "ping" })],
    ["adapterId string", JSON.stringify({ ...ok, adapterId: "5" })],
    ["adapterId > int4", JSON.stringify({ ...ok, adapterId: 2_147_483_648 })],
    ["seq 0", JSON.stringify({ ...ok, seq: 0 })],
    ["issuedAt float", JSON.stringify({ ...ok, issuedAt: 1.5 })],
    ["replicaId bad chars", JSON.stringify({ ...ok, replicaId: "peer replica 01" })],
    ["mac short", JSON.stringify({ ...ok, mac: "ab" })],
    ["mac upper", JSON.stringify({ ...ok, mac: ok.mac.toUpperCase() })],
    ["too long", JSON.stringify(ok) + " ".repeat(600)],
  ];
  for (const [name, raw] of bad) it(`rejects: ${name}`, () => expect(parseStopEpochPayload(raw)).toBeNull());
});
