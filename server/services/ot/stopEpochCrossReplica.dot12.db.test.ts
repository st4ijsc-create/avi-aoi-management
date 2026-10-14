/**
 * doc 81 Đợt 12 task P — the per-adapter STOP epoch (R-11-d) ACROSS central replicas, on `_test` with a REAL pg NOTIFY.
 *
 * Two dispatcher "processes" = two module instances (vi.resetModules): each has its own commandDispatcher / otDeviceWrite (its own
 * epoch map) / db connection (its own pool and its own LISTEN connection) / otStopEpochSync. They share the in-memory fake device and
 * the test seams (H), like two replicas sharing one adapter.
 *
 * Scenario (the hole Đợt 11 left, K-fix report "Multi-instance"): replica B dispatches a non-STOP write which is held INSIDE its
 * gates; replica A dispatches a pinned STOP which is SENT; then B's write is released. Per process (HEAD) B's write reached the
 * device AFTER A's STOP (re-energised). With the sync, A's send is broadcast on `ot_stop_epoch`, B bumps its own epoch, B's write is
 * cancelled STOPPED_BEFORE_WRITE right before its device write. Flag OT_CMD_SERIALIZE_ENABLED OFF and ON.
 * Also: own notifications ignored, strict payload validation (and which DB role may NOTIFY), a lost LISTEN connection (alert +
 * reconnect; per-process behaviour meanwhile), and the NOTIFY latency = the remaining window.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fps: new Map<number, string>(),
  hold: null as null | { adapterId: number; tagKey: string; entered: () => void; release: Promise<void> },
}));

vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (id: number) => (H.drivers.has(id) ? H.drivers.get(id) : orig.getActiveDriver(id)) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (id: number) => (H.fps.has(id) ? H.fps.get(id) : orig.getActiveConnectionFingerprint(id)),
  };
});
vi.mock("../interlock/interlockGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../interlock/interlockGate")>();
  return {
    ...orig,
    evaluateInterlockGate: async (a: Parameters<typeof orig.evaluateInterlockGate>[0]) => {
      const h = H.hold;
      if (h && h.adapterId === a.adapterId && a.tagKeys.includes(h.tagKey)) {
        H.hold = null;
        h.entered();
        await h.release;
      }
      return orig.evaluateInterlockGate(a);
    },
  };
});

const DB_URL = process.env.DATABASE_URL;
const DAU = `D12P-${Date.now()}`;
const OWNER = 990_912_301;
const MACHINE = 990_912_310;
const TAG_STOP = "speed_sp"; // pinned stop value 0
const TAG_W = "w1"; // NO pin: an unverified stop-typed command writing it is the only software STOP for it
const HMAC_ENV = { OT_STOP_EPOCH_HMAC_KEY: "dot12-task-p-fix1-test-hmac-key-0123456789" } as NodeJS.ProcessEnv;
const TOOL = "set_machine_param";
const CHANNEL = "ot_stop_epoch";
const ENV = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

type Replica = {
  name: string;
  cd: typeof import("./commandDispatcher");
  dw: typeof import("./otDeviceWrite");
  sync: typeof import("./otStopEpochSync");
  conn: typeof import("../../db/connection");
  stopSync: (() => Promise<void>) | null;
  alerts: Array<Record<string, unknown>>;
};
async function loadReplica(name: string): Promise<Replica> {
  vi.resetModules();
  const cd = await import("./commandDispatcher");
  const dw = await import("./otDeviceWrite");
  const sync = await import("./otStopEpochSync");
  const conn = await import("../../db/connection");
  return { name, cd, dw, sync, conn, stopSync: null, alerts: [] };
}
async function startSync(r: Replica, extra: Record<string, unknown> = {}) {
  r.stopSync = await r.sync.startOtStopEpochSync({ pingMs: 60_000, env: HMAC_ENV, alert: (a: Record<string, unknown>) => void r.alerts.push(a), ...extra } as never);
}
async function stopSync(r: Replica) {
  if (r.stopSync) await r.stopSync();
  r.stopSync = null;
}

let sql: ReturnType<typeof postgres>;
let A: Replica;
let B: Replica;
let adapterId = 0;
/** doc 81 Đợt 12 final fix wave (R-12-e I-1) — a second adapter with NO stop pin at all (only `w1`): the I-2 positive control */
let adapterNoPins = 0;
const device = { regs: new Map<string, unknown>(), log: [] as string[] };
let seq = 0;

async function prep(commandType: string, writes: Array<{ tagKey: string; value: unknown }>, onAdapter: number = adapterId) {
  const id = `${DAU}-a-${++seq}`;
  const { aiPendingActions } = await import("../../../drizzle/schema");
  const { otPayloadHash, withOtPayloadHash } = await import("./otActionBinding");
  const db = await A.conn.getDb();
  await db!.insert(aiPendingActions).values({
    id,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} cross-replica stop epoch`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId: onAdapter, machineId: MACHINE, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { adapterId: onAdapter, machineId: MACHINE, commandType, writes, triggeredBy: { kind: "hitl" as const, actionId: id, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER }, idempotencyKey: `${DAU}-k-${++seq}` };
}
function holdGatesOf(tagKey: string, onAdapter: number = adapterId): { entered: Promise<void>; release: () => void } {
  let entered!: () => void;
  let release!: () => void;
  const e = new Promise<void>((r) => (entered = r));
  const rel = new Promise<void>((r) => (release = r));
  H.hold = { adapterId: onAdapter, tagKey, entered, release: rel };
  return { entered: e, release };
}
function setEnv(flag: boolean) {
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
  process.env.OT_READBACK_ENABLED = "false";
  process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
  delete process.env.SEC_PLATFORM;
  delete process.env.UNS_CMD_ACK_ENABLED;
}
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 2));
  }
  return true;
}
const status = (r: Replica) => r.sync.otStopEpochSyncStatus() as Record<string, any>;

describe.skipIf(!DB_URL)("Đợt 12 task P — a verified STOP sent by replica A cancels a write in replica B's gates (real pg NOTIFY, _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV) saved[k] = process.env[k];
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    A = await loadReplica("A");
    B = await loadReplica("B");
    expect(A.dw).not.toBe(B.dw); // two module instances = two epoch maps
    const { deviceAdapters, deviceTags } = await import("../../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { adapterTargetFingerprint } = await import("./adapterTarget");
    const x = (await A.conn.getDb())!;
    const [row] = await x.insert(deviceAdapters).values({ code: `${DAU}-A`, name: `${DAU} A`, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", isEnabled: true, machineId: MACHINE }).returning();
    adapterId = row!.id;
    await x.insert(deviceTags).values([
      { adapterId, tagKey: TAG_STOP, address: "holding:40020", dataType: "int", writable: true },
      { adapterId, tagKey: TAG_W, address: "holding:40001", dataType: "int", writable: true },
    ]);
    await sql`UPDATE device_tags SET stop_value = ${sql.json(0)}, stop_pinned_by = ${String(OWNER)}, stop_pinned_at = now() WHERE "adapterId" = ${adapterId} AND "tagKey" = ${TAG_STOP}`;
    const [rowNp] = await x.insert(deviceAdapters).values({ code: `${DAU}-NP`, name: `${DAU} no pins`, protocol: "modbus", endpoint: "tcp://127.0.0.1:2", isEnabled: true, machineId: MACHINE }).returning();
    adapterNoPins = rowNp!.id;
    await x.insert(deviceTags).values([{ adapterId: adapterNoPins, tagKey: TAG_W, address: "holding:40001", dataType: "int", writable: true }]);
    for (const id of [adapterId, adapterNoPins]) {
      H.drivers.set(id, {
        isConnected: () => true,
        writeTags: async (w: Array<{ tagKey: string; value: unknown }>) => {
          for (const v of w) device.log.push(`${id === adapterNoPins ? "np:" : ""}${v.tagKey}=${String(v.value)}`);
          for (const v of w) device.regs.set(v.tagKey, v.value);
          return w.map((v) => ({ tagKey: v.tagKey, ok: true }));
        },
        readTags: async () => [],
      });
      const [fresh] = await x.select().from(deviceAdapters).where(eq(deviceAdapters.id, id));
      H.fps.set(id, adapterTargetFingerprint(fresh!));
    }
    await startSync(A);
    await startSync(B);
  });

  afterAll(async () => {
    for (const r of [A, B]) if (r) await stopSync(r).catch(() => undefined);
    H.drivers.clear();
    H.fps.clear();
    if (sql) {
      await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${DAU + "%"}`;
      for (const id of [adapterId, adapterNoPins].filter((v) => v > 0)) {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${id}`;
        await sql`DELETE FROM device_adapters WHERE id = ${id}`.catch(() => undefined); // command_log rows (WORM) may pin it
      }
      await sql.end();
    }
    for (const r of [A, B]) {
      const db = r ? ((await r.conn.getDb()) as unknown as { $client?: { end: (o: { timeout: number }) => Promise<void> } } | null) : null;
      await db?.$client?.end({ timeout: 1 }).catch(() => undefined);
      const n = r ? ((r.conn as unknown as { getNotifyClient?: () => { end: (o: { timeout: number }) => Promise<void> } | null }).getNotifyClient?.() ?? null) : null;
      await n?.end({ timeout: 1 }).catch(() => undefined);
    }
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    A?.cd._resetAdapterCommandQueuesForTests();
    B?.cd._resetAdapterCommandQueuesForTests();
    device.regs.clear();
    device.log.length = 0;
    H.hold = null;
  });

  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] ★ a write held in replica B's gates when replica A SENDS a pinned STOP is cancelled STOPPED_BEFORE_WRITE — nothing written after the STOP`, async () => {
      setEnv(flag);
      const write = await prep("set", [{ tagKey: TAG_STOP, value: 77 }]);
      const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
      const h = holdGatesOf(TAG_STOP);
      const pWrite = B.cd.dispatch(write); // B: gates begin now, held inside the interlock gate
      await h.entered;
      const epochB0 = B.dw.adapterStopEpoch(adapterId);
      const rStop = await A.cd.dispatch(stop); // A: the STOP is sent
      expect(rStop).toMatchObject({ ok: true, pinnedStop: true });
      // the remaining window: B learns of A's STOP after the NOTIFY latency (bounded wait; HEAD never learns)
      const learnt = await until(() => B.dw.adapterStopEpoch(adapterId) !== epochB0, 3_000);
      h.release();
      const rWrite = await pWrite;
      expect(device.log).toEqual([`${TAG_STOP}=0`]); // L-7: B's write never reached the device after A's STOP
      expect(rWrite).toMatchObject({ ok: false, status: "rejected", reason: "STOPPED_BEFORE_WRITE" });
      expect(learnt).toBe(true);
      expect(device.regs.get(TAG_STOP)).toBe(0);
      const rows = await sql<{ status: string; errorText: string | null; ackValue: Record<string, any> | null }[]>`
        SELECT status, "errorText", "ackValue" FROM command_log WHERE id IN ${sql(rWrite.commandLogIds)} ORDER BY id`;
      const result = rows.find((r) => r.status === "rejected");
      expect(result?.errorText).toMatch(/^STOPPED_BEFORE_WRITE: /);
      expect(result?.ackValue?.stoppedBeforeWrite?.stop).toMatchObject({ peer: true, origin: status(A).origin });
    });
  }

  it("control (degraded = per process, the Đợt 11 behaviour): with B's LISTEN stopped, the same interleave writes B's value AFTER A's STOP", async () => {
    setEnv(false);
    await stopSync(B);
    try {
      const write = await prep("set", [{ tagKey: TAG_STOP, value: 77 }]);
      const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
      const h = holdGatesOf(TAG_STOP);
      const pWrite = B.cd.dispatch(write);
      await h.entered;
      expect((await A.cd.dispatch(stop)).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 300)); // well past the NOTIFY latency
      h.release();
      expect((await pWrite).ok).toBe(true);
      expect(device.log).toEqual([`${TAG_STOP}=0`, `${TAG_STOP}=77`]);
    } finally {
      await startSync(B);
    }
  });

  it("A ignores its OWN notification (one bump per send), B applies it (one bump)", async () => {
    const dummy = 1_900_000_000 + (Date.now() % 1_000_000);
    const ownBefore = status(A).ignoredOwn as number;
    const peerBefore = status(B).peerStops as number;
    const e = A.dw.bumpAdapterStopEpoch(dummy, { idempotencyKey: "own-test" });
    expect(await until(() => (status(A).ignoredOwn as number) > ownBefore && (status(B).peerStops as number) > peerBefore, 3_000)).toBe(true);
    expect(A.dw.adapterStopEpoch(dummy)).toBe(e);
    const eB = B.dw.adapterStopEpoch(dummy);
    expect(eB).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(A.dw.adapterStopEpoch(dummy)).toBe(e);
    expect(B.dw.adapterStopEpoch(dummy)).toBe(eB);
  });

  it("★ R-12-c: unsigned / badly signed / stale / replayed notifications move nothing (counted); a SIGNED one bumps — and ANY role can NOTIFY (why the MAC)", async () => {
    const base = 1_910_000_000 + (Date.now() % 1_000_000);
    const now = Date.now();
    const key = (B.sync.resolveStopEpochKey(HMAC_ENV) as { key: Buffer }).key;
    const sign = (adapterId: number, o: { seq: number; issuedAt?: number; key?: Buffer }) =>
      JSON.stringify(B.sync.signStopEpochMessage(o.key ?? key, { replicaId: "forger-replica-01", seq: o.seq, issuedAt: o.issuedAt ?? now, adapterId }));
    const replayed = sign(base + 7, { seq: 900 });
    const bad: Array<[number, string]> = [
      [base + 1, "not json"],
      [base + 2, JSON.stringify({ v: 1, kind: "stop", origin: "forged-origin-1", adapterId: base + 2, epoch: 1, at: now })], // the round-1 unsigned shape
      [base + 3, sign(base + 3, { seq: 901, key: Buffer.alloc(32, 1) })], // wrong key
      [base + 4, JSON.stringify({ ...JSON.parse(sign(base + 99, { seq: 902 })), adapterId: base + 4 })], // tampered
      [base + 5, sign(base + 5, { seq: 903, issuedAt: now - 60_000 })], // stale
      [base + 6, sign(base + 6, { seq: 904, issuedAt: now + 60_000 })], // future-dated
    ];
    const rejBefore = status(B).rejected as number;
    for (const [, p] of bad) await sql`SELECT pg_notify(${CHANNEL}, ${p})`;
    await sql`SELECT pg_notify(${CHANNEL}, ${replayed})`;
    expect(await until(() => B.dw.adapterStopEpoch(base + 7) > 0, 3_000)).toBe(true);
    const e7 = B.dw.adapterStopEpoch(base + 7);
    await sql`SELECT pg_notify(${CHANNEL}, ${replayed})`; // replay
    // ANY role may NOTIFY on any channel (PostgreSQL has no privilege for it) — the test role is the app role
    const who = await sql<{ su: boolean; u: string; cr: boolean }[]>`SELECT rolsuper AS su, rolcreaterole AS cr, current_user AS u FROM pg_roles WHERE rolname = current_user`;
    const good = base + 9;
    await sql`SELECT pg_notify(${CHANNEL}, ${sign(good, { seq: 905, issuedAt: Date.now() })})`;
    expect(await until(() => B.dw.adapterStopEpoch(good) > 0, 3_000)).toBe(true);
    for (const [id] of bad) expect(B.dw.adapterStopEpoch(id)).toBe(0);
    expect(B.dw.adapterStopEpoch(base + 7)).toBe(e7);
    expect((status(B).rejected as number) - rejBefore).toBe(bad.length + 1);
    console.log(`[task P] NOTIFY by role ${who[0]?.u} (superuser ${who[0]?.su}, createrole ${who[0]?.cr}) delivered; only the signed one applied`);
  });

  for (const flag of [false, true]) {
    it(`[flag ${flag ? "ON" : "OFF"}] ★ I-2 (L-7) positive control (R-12-e I-1): a forged / peer NOTIFY cannot deny a STOP on an adapter WITHOUT pins — the unverified stop in B's gates is written`, async () => {
      setEnv(flag);
      const stop = await prep("stop", [{ tagKey: TAG_W, value: 0 }], adapterNoPins); // stop-typed, the adapter has NO pin ⇒ unverified: the only STOP there is
      const h = holdGatesOf(TAG_W, adapterNoPins);
      const pStop = B.cd.dispatch(stop);
      await h.entered;
      const e0 = B.dw.adapterStopEpoch(adapterNoPins);
      // a forger: the round-1 unsigned shape, and a correctly SIGNED message (a forger holding the key, or a pin-edit race on a peer)
      await sql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify({ v: 1, kind: "stop", origin: "forged-origin-1", adapterId: adapterNoPins, epoch: 1, at: Date.now() })})`;
      const key = (B.sync.resolveStopEpochKey(HMAC_ENV) as { key: Buffer }).key;
      await sql`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(B.sync.signStopEpochMessage(key, { replicaId: `forger-replica-0${flag ? 3 : 2}`, seq: 1, issuedAt: Date.now(), adapterId: adapterNoPins }))})`;
      expect(await until(() => B.dw.adapterStopEpoch(adapterNoPins) !== e0, 3_000)).toBe(true); // the signed peer move DID land
      h.release();
      const r = await pStop;
      expect(device.log).toEqual([`np:${TAG_W}=0`]); // the STOP reached the device
      expect(r.reason).not.toBe("SUPERSEDED_BY_STOP");
      expect(r.ok).toBe(true);
    });
  }

  // doc 81 Đợt 12 final fix wave (R-12-e I-1, scan #113) — the three rows of the final review's table, through the REAL dispatcher of
  // both replicas: on an adapter that HAS pins, a stop-LABELLED command that is not a verified STOP (an unpinned tag, the pin value
  // plus an unpinned tag, a non-pin value) is SUPERSEDED by a peer's verified STOP exactly as by a local one. At 05f3be445 the first
  // two rows were exempt (overridesStopPin === false) and were written AFTER A's STOP.
  const rows113: Array<[string, Array<{ tagKey: string; value: unknown }>]> = [
    ["{w1:1} (an unpinned tag only)", [{ tagKey: TAG_W, value: 1 }]],
    ["{speed_sp:0, w1:1} (the pin value plus an unpinned tag)", [{ tagKey: TAG_STOP, value: 0 }, { tagKey: TAG_W, value: 1 }]],
    ["{speed_sp:77} (a non-pin value to the pinned tag)", [{ tagKey: TAG_STOP, value: 77 }]],
  ];
  for (const flag of [false, true]) {
    for (const [label, writes] of rows113) {
      it(`[flag ${flag ? "ON" : "OFF"}] ★ I-1 (scan #113): stop-labelled ${label} on a PINNED adapter, in B's gates, is SUPERSEDED by A's verified STOP — nothing written after it`, async () => {
        setEnv(flag);
        const fake = await prep("stop", writes);
        const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
        const h = holdGatesOf(writes[writes.length - 1]!.tagKey);
        const pFake = B.cd.dispatch(fake);
        await h.entered;
        const e0 = B.dw.adapterStopEpoch(adapterId);
        expect(await A.cd.dispatch(stop)).toMatchObject({ ok: true, pinnedStop: true });
        expect(await until(() => B.dw.adapterStopEpoch(adapterId) !== e0, 3_000)).toBe(true);
        h.release();
        const r = await pFake;
        expect(device.log).toEqual([`${TAG_STOP}=0`]); // L-7: nothing written after A's STOP
        expect(r).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
      });
    }
  }

  it("control: a write whose gates begin AFTER B learned of A's STOP is written (the newer intent)", async () => {
    setEnv(false);
    const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
    const e0 = B.dw.adapterStopEpoch(adapterId);
    expect((await A.cd.dispatch(stop)).ok).toBe(true);
    expect(await until(() => B.dw.adapterStopEpoch(adapterId) !== e0, 3_000)).toBe(true);
    const write = await prep("set", [{ tagKey: TAG_STOP, value: 42 }]);
    const r = await B.cd.dispatch(write);
    expect(r.ok).toBe(true);
    expect(device.log).toEqual([`${TAG_STOP}=0`, `${TAG_STOP}=42`]);
  });

  it("★ a LOST LISTEN connection: alert, back to per-process meanwhile, reconnect — then A's STOPs reach B again", async () => {
    const lostBefore = B.alerts.filter((a) => a.kind === "lost").length;
    const killed = await sql<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND query ILIKE ${'listen "' + CHANNEL + '"%'}`;
    expect(killed.length).toBeGreaterThanOrEqual(2); // A's and B's LISTEN connections
    for (const k of killed) await sql`SELECT pg_terminate_backend(${k.pid})`;
    expect(await until(() => B.alerts.filter((a) => a.kind === "lost").length > lostBefore, 15_000)).toBe(true);
    expect(await until(() => status(B).state === "ok", 15_000)).toBe(true);
    expect(status(B).reconnects).toBeGreaterThanOrEqual(1);
    const dummy = 1_920_000_000 + (Date.now() % 1_000_000);
    A.dw.bumpAdapterStopEpoch(dummy, { idempotencyKey: "after-reconnect" });
    expect(await until(() => B.dw.adapterStopEpoch(dummy) > 0, 5_000)).toBe(true);
  });

  it("measure: NOTIFY latency A send → B bump (the remaining window), 200 sends", async () => {
    const base = 1_930_000_000 + (Date.now() % 1_000_000);
    const before = status(B).peerStops as number;
    B.sync._resetLatencyStatsForTests?.();
    for (let i = 0; i < 200; i++) {
      A.dw.bumpAdapterStopEpoch(base + (i % 7), { idempotencyKey: `lat-${i}` });
      await new Promise((r) => setTimeout(r, 3));
    }
    expect(await until(() => (status(B).peerStops as number) - before >= 200, 10_000)).toBe(true);
    const lat = status(B).peerLatencyMs as { count: number; p50: number; p95: number; p99: number; max: number };
    console.log(`[task P] NOTIFY latency send→peer bump over ${lat.count}: p50 ${lat.p50} ms, p95 ${lat.p95} ms, p99 ${lat.p99} ms, max ${lat.max} ms`);
    expect(lat.count).toBeGreaterThanOrEqual(200);
    expect(lat.p99).toBeLessThan(1_000);
  });

  it("★ measure: replica A's app pool SATURATED — the broadcast (dedicated connection) is not delayed by it", async () => {
    const client = ((await A.conn.getDb()) as unknown as { $client: ReturnType<typeof postgres> }).$client;
    const max = A.conn.resolvePoolMax();
    const busy = Promise.all(Array.from({ length: max }, () => client`SELECT pg_sleep(0.3)`));
    await new Promise((r) => setTimeout(r, 30));
    B.sync._resetLatencyStatsForTests();
    const dummy = 1_940_000_000 + (Date.now() % 1_000_000);
    const t0 = Date.now();
    A.dw.bumpAdapterStopEpoch(dummy, { idempotencyKey: "saturated" });
    const bumpCallMs = Date.now() - t0;
    expect(await until(() => B.dw.adapterStopEpoch(dummy) > 0, 5_000)).toBe(true);
    await busy;
    const lat = status(B).peerLatencyMs as { max: number };
    console.log(`[task P] saturated pool (${max} × pg_sleep 300 ms): bump call ${bumpCallMs} ms, NOTIFY latency ${lat.max} ms`);
    expect(bumpCallMs).toBeLessThan(5); // the STOP's side never waits for the pool
    expect(lat.max).toBeLessThan(150); // fix 1 M-1: the broadcast goes through the DEDICATED notify connection, not behind the pool (was ~270 ms)
  });
});
