/**
 * doc 81 Đợt 12 task P (+ fix 1) — otStopEpochSync without a database: an in-memory LISTEN/NOTIFY bus stands in for the postgres
 * client (the real NOTIFY path is stopEpochCrossReplica.dot12.db.test.ts; the listener liveness is pgChannelListener.dot12.test.ts).
 * Covers: the broadcast never on the STOP's path; R-12-c — HMAC (key from HKDF of SECRET_ENCRYPTION_KEY or OT_STOP_EPOCH_HMAC_KEY,
 * fail closed without one, never printed), strict shape, own replica ignored, freshness, replay WINDOW (reordering accepted),
 * one alert per rejection episode; I-3 overflow alert; the edge role; stop().
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { bumpAdapterStopEpoch, adapterStopEpoch, setStopEpochBroadcaster } from "./otDeviceWrite";
import { cachedStopPinPresence, rememberStopPinPresence, stopPinChanged, stopPinReadToken } from "./stopPinPresence";
import {
  startOtStopEpochSync,
  otStopEpochSyncStatus,
  parseStopEpochPayload,
  parseHelloPayload,
  resolveStopEpochKey,
  signStopEpochMessage,
  signHelloMessage,
  macOf,
  otStopEpochSyncSeesPeers,
  parsePinChangePayload,
  signPinChangeMessage,
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
/**
 * R-12-e M-1 — an in-memory "notifications" store: the key episode's PERSISTED state (rows survive a "restart" = a fresh module
 * instance through vi.resetModules); two active admins by default.
 */
function episodeStore(admins: number[] = [1, 2]) {
  const rows: Array<{ uid: number; problem: "no_key" | "key_restored" }> = [];
  const io = {
    rows,
    admins,
    failRead: false,
    recipients: async () => [...io.admins],
    latest: async () => {
      if (io.failRead) throw new Error("db down");
      const m = new Map<number, "no_key" | "key_restored">();
      for (const r of rows) m.set(r.uid, r.problem); // later rows win (newest per admin)
      return m;
    },
    write: async (uids: number[], problem: "no_key" | "key_restored") => void uids.forEach((uid) => rows.push({ uid, problem })),
  };
  return io;
}
async function start(c: ReturnType<typeof bus>, alerts: StopEpochSyncAlert[], o: Record<string, unknown> = {}) {
  stopFn = await startOtStopEpochSync({ listenClient: () => c, notifyClient: () => c, env: ENV, pingMs: 60_000, alert: (a: StopEpochSyncAlert) => void alerts.push(a), keyEpisodeIo: episodeStore(), ...o } as never);
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

  it("★ R-12-e M-1: no key ⇒ the sync is DISABLED: no LISTEN, nothing sent, nothing accepted; status 'disabled' (no_hmac_key, env names only); ONE no_key alert", async () => {
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts, { env: {} as NodeJS.ProcessEnv });
    expect(await until(() => alerts.length > 0)).toBe(true);
    expect(alerts.map((a) => a.kind)).toEqual(["no_key"]);
    expect(c.listenCalls).toBe(0); // disabled: not even listening
    bumpAdapterStopEpoch(990_100, null);
    await tick();
    expect(c.notified).toEqual([]); // no stop, no hello
    expect(otStopEpochSyncStatus().unsignedNotSent).toBeGreaterThan(0);
    c.deliver(signed(990_101));
    expect(adapterStopEpoch(990_101)).toBe(0);
    const st = otStopEpochSyncStatus();
    expect(st).toMatchObject({ state: "disabled", disabled: "no_hmac_key", keySource: null });
    expect(st.keyProblem).toMatch(/OT_STOP_EPOCH_HMAC_KEY/);
  });

  it("★ R-12-e M-1: ONE alert per key-missing EPISODE, persisted across boots — a restart without a key is silent; a boot WITH a key closes the episode; the next boot without one alerts again", async () => {
    const io = episodeStore([1, 2]);
    const boot = async (env: NodeJS.ProcessEnv) => {
      vi.resetModules(); // a "restart": no in-process memory survives, only the store's rows
      const sync = await import("./otStopEpochSync");
      const c = bus();
      const alerts: StopEpochSyncAlert[] = [];
      const stop = await sync.startOtStopEpochSync({ listenClient: () => c, notifyClient: () => c, env, pingMs: 60_000, alert: (a: StopEpochSyncAlert) => void alerts.push(a), keyEpisodeIo: io } as never);
      await until(() => (sync.otStopEpochSyncStatus() as { keyEpisode?: string | null }).keyEpisode != null);
      await stop();
      return { alerts: alerts.filter((a) => a.kind === "no_key"), episode: (sync.otStopEpochSyncStatus() as { keyEpisode?: string | null }).keyEpisode };
    };
    expect(await boot({} as NodeJS.ProcessEnv)).toEqual({ alerts: [expect.objectContaining({ kind: "no_key" })], episode: "new_episode" });
    expect(io.rows).toEqual([{ uid: 1, problem: "no_key" }, { uid: 2, problem: "no_key" }]);
    expect(await boot({} as NodeJS.ProcessEnv)).toEqual({ alerts: [], episode: "episode_continues" }); // restart: not repeated
    expect(await boot({} as NodeJS.ProcessEnv)).toEqual({ alerts: [], episode: "episode_continues" });
    expect(io.rows).toHaveLength(2);
    io.admins.push(3); // an admin added meanwhile gets the row, the alert is not repeated
    expect(await boot({} as NodeJS.ProcessEnv)).toEqual({ alerts: [], episode: "episode_continues" });
    expect(io.rows.filter((r) => r.uid === 3)).toEqual([{ uid: 3, problem: "no_key" }]);
    expect(await boot(ENV)).toEqual({ alerts: [], episode: "episode_closed" }); // a key: the episode ends (one key_restored row each)
    expect(io.rows.filter((r) => r.problem === "key_restored").map((r) => r.uid).sort()).toEqual([1, 2, 3]);
    expect(await boot(ENV)).toEqual({ alerts: [], episode: "nothing" });
    expect(await boot({} as NodeJS.ProcessEnv)).toMatchObject({ alerts: [expect.objectContaining({ kind: "no_key" })], episode: "new_episode" }); // a NEW episode
    io.failRead = true; // the episode cannot be read ⇒ alert (fail toward telling)
    expect((await boot({} as NodeJS.ProcessEnv)).alerts).toHaveLength(1);
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
    await tick();
    const before = c.notified.length; // the start's hello (R-12-e M-2)
    bumpAdapterStopEpoch(990_001, { idempotencyKey: "k" });
    expect(c.notified.length).toBe(before);
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

describe("R-12-e M-2 — a signed HELLO at start proves the key before the first real STOP", () => {
  it("★ start sends ONE signed hello; a hello from a peer with the SAME key is verified (status lists it, no alert) and answered once; a hello signed with ANOTHER key ⇒ ONE key_mismatch alert (rate-limited), counted; a hello never moves an epoch", async () => {
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts);
    const s0 = otStopEpochSyncStatus();
    const hellos = () => c.notified.filter((p) => p.includes('"kind":"hello"'));
    expect(await until(() => hellos().length > 0)).toBe(true);
    const mine = parseHelloPayload(hellos()[0]);
    expect(mine).toMatchObject({ v: 2, kind: "hello", replicaId: OT_STOP_EPOCH_REPLICA_ID });
    expect(mine!.mac).toBe(signHelloMessage(KEY, { replicaId: mine!.replicaId, seq: mine!.seq, issuedAt: mine!.issuedAt }).mac);
    await sleep(20);
    const sent0 = hellos().length;
    expect(sent0).toBe(1); // its own hello came back: ignored, not answered
    // a peer with the same key
    c.deliver(JSON.stringify(signHelloMessage(KEY, { replicaId: "good-peer-0001", seq: 1, issuedAt: Date.now() })));
    expect(await until(() => hellos().length === sent0 + 1)).toBe(true); // answered once
    c.deliver(JSON.stringify(signHelloMessage(KEY, { replicaId: "good-peer-0001", seq: 2, issuedAt: Date.now() })));
    await sleep(20);
    expect(hellos().length).toBe(sent0 + 1); // not answered twice
    let st = otStopEpochSyncStatus();
    expect(st.hello).toMatchObject({ verifiedPeers: 1, mismatches: 0 });
    expect(alerts.filter((a) => a.kind === "key_mismatch")).toEqual([]);
    // peers with ANOTHER key: alert once, counted every time
    const other = Buffer.alloc(32, 3);
    for (let i = 1; i <= 3; i++) c.deliver(JSON.stringify(signHelloMessage(other, { replicaId: "bad-peer-000" + i, seq: i, issuedAt: Date.now() })));
    st = otStopEpochSyncStatus();
    expect(st.hello).toMatchObject({ verifiedPeers: 1, mismatches: 3 });
    expect(alerts.filter((a) => a.kind === "key_mismatch")).toHaveLength(1);
    expect(alerts.find((a) => a.kind === "key_mismatch")!.reason).toMatch(/another key/);
    expect(JSON.stringify(alerts) + JSON.stringify(st)).not.toContain(KEY.toString("hex"));
    expect(st.peerStops).toBe(s0.peerStops); // a hello is not a STOP
    expect(st.rejectedBy.malformed).toBe(s0.rejectedBy.malformed); // and is not "malformed"
  });

  it("R-12-f: otStopEpochSyncSeesPeers — false while not running / disabled / alone; true once a peer's hello verified", async () => {
    expect(otStopEpochSyncSeesPeers()).toBe(false); // not running
    const c = bus();
    await start(c, []);
    await sleep(20); // its own hello came back: still alone
    expect(otStopEpochSyncSeesPeers()).toBe(false);
    c.deliver(JSON.stringify(signHelloMessage(Buffer.alloc(32, 4), { replicaId: "other-key-peer-1", seq: 1, issuedAt: Date.now() })));
    expect(otStopEpochSyncSeesPeers()).toBe(false); // an unverifiable hello is not a peer
    c.deliver(JSON.stringify(signHelloMessage(KEY, { replicaId: "seen-peer-0001", seq: 1, issuedAt: Date.now() })));
    expect(otStopEpochSyncSeesPeers()).toBe(true);
    await stopFn!();
    stopFn = null;
    expect(otStopEpochSyncSeesPeers()).toBe(false);
  });

  it("parseHelloPayload is strict: exact keys, v2, kind hello", () => {
    const ok = signHelloMessage(KEY, { replicaId: PEER, seq: 3, issuedAt: 1_700_000_000_000 });
    expect(parseHelloPayload(JSON.stringify(ok))).toEqual(ok);
    expect(parseHelloPayload(JSON.stringify({ ...ok, adapterId: 5 }))).toBeNull();
    expect(parseHelloPayload(JSON.stringify({ ...ok, kind: "stop" }))).toBeNull();
    expect(parseHelloPayload(JSON.stringify({ ...ok, v: 1 }))).toBeNull();
    expect(parseHelloPayload(JSON.stringify({ ...ok, replicaId: "x" }))).toBeNull();
    expect(parseStopEpochPayload(JSON.stringify({ ...ok, kind: "stop", adapterId: 1 }))).not.toBeNull(); // shape only …
    // the kind is inside the MAC: the same fields signed as a "stop" give another MAC
    expect(macOf(KEY, { v: 2, kind: "stop", replicaId: PEER, seq: 3, issuedAt: 1_700_000_000_000, adapterId: 0 })).not.toBe(ok.mac);
    const asStop = parseStopEpochPayload(JSON.stringify({ ...ok, kind: "stop", adapterId: 1 }))!;
    expect(asStop.mac).not.toBe(signStopEpochMessage(KEY, { replicaId: PEER, seq: 3, issuedAt: 1_700_000_000_000, adapterId: 1 }).mac); // … a hello MAC never verifies as a STOP
  });
});

describe("R-12-g — stop-pin changes are broadcast signed and invalidate every replica's cached pin presence", () => {
  it("★ a local pin change is NOTIFYed signed (kind pins); a peer's signed one invalidates the cached presence here; a forged one is rejected; its own is ignored", async () => {
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts);
    await tick();
    const before = c.notified.length;
    stopPinChanged(990_300);
    await tick();
    await tick();
    const sent = c.notified.slice(before).map((p) => parsePinChangePayload(p)).filter(Boolean);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ v: 2, kind: "pins", replicaId: OT_STOP_EPOCH_REPLICA_ID, adapterId: 990_300 });
    expect(sent[0]!.mac).toBe(signPinChangeMessage(KEY, { replicaId: sent[0]!.replicaId, seq: sent[0]!.seq, issuedAt: sent[0]!.issuedAt, adapterId: 990_300 }).mac);
    expect(parseStopEpochPayload(JSON.stringify(sent[0]))).toBeNull(); // never a STOP
    // a peer's signed pin change: the cached "none" here is gone
    rememberStopPinPresence(990_301, false, stopPinReadToken(990_301));
    expect(cachedStopPinPresence(990_301)).toBe("none");
    c.deliver(JSON.stringify(signPinChangeMessage(KEY, { replicaId: PEER, seq: 1, issuedAt: Date.now(), adapterId: 990_301 })));
    expect(cachedStopPinPresence(990_301)).toBeNull();
    expect(otStopEpochSyncSeesPeers()).toBe(true);
    // forged (another key) ⇒ rejected, nothing forgotten
    rememberStopPinPresence(990_302, false, stopPinReadToken(990_302));
    const r0 = otStopEpochSyncStatus().rejectedBy.bad_mac;
    c.deliver(JSON.stringify(signPinChangeMessage(Buffer.alloc(32, 6), { replicaId: PEER, seq: 2, issuedAt: Date.now(), adapterId: 990_302 })));
    expect(cachedStopPinPresence(990_302)).toBe("none");
    expect(otStopEpochSyncStatus().rejectedBy.bad_mac).toBe(r0 + 1);
    // its own message (delivered back by the bus) is ignored — counted neither received nor rejected
    expect(otStopEpochSyncStatus().pinChanges).toMatchObject({ sent: 1, received: 1 });
  });

  it("★ the broadcast cannot be sent ⇒ the SENDER alerts (once per 30 min, every failure counted)", async () => {
    const c = bus();
    c.notifyImpl = async (p: string) => {
      if (p.includes('"pins"')) throw new Error("notify down");
      return [];
    };
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts);
    const n0 = otStopEpochSyncStatus().pinChanges.notSent;
    stopPinChanged(990_310);
    stopPinChanged(990_311);
    expect(await until(() => otStopEpochSyncStatus().pinChanges.notSent >= n0 + 2)).toBe(true);
    expect(alerts.filter((a) => a.kind === "pin_broadcast_failed")).toHaveLength(1);
    expect(alerts.find((a) => a.kind === "pin_broadcast_failed")!.reason).toMatch(/990310/);
  });

  it("without a key (sync disabled) a pin change is only forgotten locally — nothing sent", async () => {
    const c = bus();
    await start(c, [], { env: {} as NodeJS.ProcessEnv });
    rememberStopPinPresence(990_320, false, stopPinReadToken(990_320));
    stopPinChanged(990_320);
    await tick();
    expect(cachedStopPinPresence(990_320)).toBeNull();
    expect(c.notified).toEqual([]);
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
