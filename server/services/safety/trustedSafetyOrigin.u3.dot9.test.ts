/**
 * doc 81 Đợt 9 task U3 — the failure directions of the durable trust (no DB: the insert and the trust store are seams).
 *   • migration 0371 missing (42P01 / 42703 on the trust insert, or on its cause) ⇒ the event is STILL recorded, without trust
 *     (a normal notice) — never a lost record; any other trust-insert failure ⇒ nothing recorded, the error reaches the caller
 *     (the poller keeps the transition queued and retries);
 *   • consume undecidable (throws / hangs) ⇒ NOT trusted, bounded by TRUSTED_SAFETY_CONSUME_TIMEOUT_MS;
 *   • a store answering an origin outside the allow-list ⇒ not trusted; an unusable id never reaches the store;
 *   • the store cannot be replaced in production.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

const D = vi.hoisted(() => ({
  nextId: 61_000,
  inserted: [] as Array<Record<string, unknown>>,
  txInserted: [] as Array<Record<string, unknown>>,
  emitted: [] as Array<Record<string, unknown>>,
}));
vi.mock("../../db/connection", () => {
  const plain = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          const row = { id: D.nextId++, createdAt: new Date(), robotId: null, lineId: null, stationId: null, ...v };
          D.inserted.push(row);
          return [row];
        },
      }),
    }),
    // a transaction: inserts are kept only if the callback resolves (rollback otherwise)
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const pending: Array<Record<string, unknown>> = [];
      const tx = {
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            returning: async () => {
              const row = { id: D.nextId++, createdAt: new Date(), robotId: null, lineId: null, stationId: null, ...v };
              pending.push(row);
              return [row];
            },
          }),
        }),
      };
      const out = await fn(tx);
      D.txInserted.push(...pending);
      return out;
    },
  };
  return { getDb: vi.fn(async () => plain) };
});
vi.mock("../../_core/socket", () => ({ emitSafetyEvent: vi.fn((e: Record<string, unknown>) => void D.emitted.push(e)) }));

import { recordFromDeviceIngest } from "./safetyAuditService";
import {
  _setTrustedEventStoreForTests,
  consumeTrustedSafetyOrigin,
  trustedEventDigest,
  isTrustTableMissing,
  TRUSTED_SAFETY_CONSUME_TIMEOUT_MS,
  type TrustedEventStore,
} from "./trustedSafetyOrigin";

const store = (over: Partial<TrustedEventStore>): TrustedEventStore => ({ mark: async () => undefined, consume: async () => null, ...over });
const saved = { audit: process.env.SAFETY_AUDIT_ENABLED, env: process.env.NODE_ENV };
let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  D.inserted.length = 0;
  D.txInserted.length = 0;
  D.emitted.length = 0;
  process.env.SAFETY_AUDIT_ENABLED = "true";
  quiet = [vi.spyOn(console, "error").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
});
afterEach(() => {
  quiet.forEach((q) => q.mockRestore());
  _setTrustedEventStoreForTests(null);
});
afterAll(() => {
  if (saved.audit === undefined) delete process.env.SAFETY_AUDIT_ENABLED;
  else process.env.SAFETY_AUDIT_ENABLED = saved.audit;
});

const EST = { eventType: "estop" as const, detectedBy: "plc" as const, handledBy: "advisory" as const, stationId: 4 };

describe("Đợt 9 U3 — recording a trusted event when the trust cannot be written", () => {
  it("★ trust table missing (42P01) ⇒ the event is still recorded and emitted, WITHOUT trust", async () => {
    _setTrustedEventStoreForTests(store({ mark: async () => Promise.reject(Object.assign(new Error("relation does not exist"), { code: "42P01" })) }));
    const r = await recordFromDeviceIngest("safety_plc", EST);
    expect(r.ok).toBe(true);
    expect(D.txInserted).toHaveLength(0); // the transaction rolled back
    expect(D.inserted).toHaveLength(1); // re-recorded plainly
    expect(D.emitted).toHaveLength(1);
  });

  it("missing column (42703) on the error's CAUSE ⇒ same fallback", async () => {
    _setTrustedEventStoreForTests(store({ mark: async () => Promise.reject(Object.assign(new Error("wrapped"), { cause: { code: "42703" } })) }));
    expect((await recordFromDeviceIngest("safety_plc", EST)).ok).toBe(true);
    expect(D.inserted).toHaveLength(1);
  });

  it("★ any OTHER trust-insert failure ⇒ nothing recorded, nothing emitted, the error reaches the caller (it retries)", async () => {
    _setTrustedEventStoreForTests(store({ mark: async () => Promise.reject(Object.assign(new Error("connection reset"), { code: "08006" })) }));
    await expect(recordFromDeviceIngest("safety_plc", EST)).rejects.toThrow(/connection reset/);
    expect(D.inserted).toHaveLength(0);
    expect(D.txInserted).toHaveLength(0);
    expect(D.emitted).toHaveLength(0);
  });

  it("a type the origin may not make safety-critical ⇒ no transaction, no trust row", async () => {
    const mark = vi.fn(async () => undefined);
    _setTrustedEventStoreForTests(store({ mark }));
    await recordFromDeviceIngest("safety_plc", { ...EST, eventType: "estop_released" });
    expect(mark).not.toHaveBeenCalled();
    expect(D.inserted).toHaveLength(1);
  });

  it("the trusted door marks the row it inserted, with the digest of its content", async () => {
    const mark = vi.fn(async () => undefined);
    _setTrustedEventStoreForTests(store({ mark }));
    await recordFromDeviceIngest("robot_telemetry", { ...EST, robotId: 9 });
    const ev = D.txInserted[0];
    expect(mark).toHaveBeenCalledTimes(1);
    expect((mark.mock.calls[0] as unknown[])[1]).toEqual({ eventId: ev.id, origin: "robot_telemetry", eventType: "estop", digest: trustedEventDigest(ev) });
  });
});

describe("Đợt 9 U3 — consuming: undecidable is never trusted", () => {
  const p = { id: 42, eventType: "estop", stationId: 4, isNearMiss: false };

  it("★ consume throws ⇒ not trusted", async () => {
    _setTrustedEventStoreForTests(store({ consume: async () => Promise.reject(new Error("db down")) }));
    expect(await consumeTrustedSafetyOrigin(p)).toBeNull();
  });

  it("★ consume hangs ⇒ not trusted within the bound", async () => {
    _setTrustedEventStoreForTests(store({ consume: () => new Promise(() => undefined) }));
    const t0 = Date.now();
    expect(await consumeTrustedSafetyOrigin(p)).toBeNull();
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(TRUSTED_SAFETY_CONSUME_TIMEOUT_MS - 50);
    expect(took).toBeLessThan(TRUSTED_SAFETY_CONSUME_TIMEOUT_MS + 1500);
  });

  it("a store answering an origin outside the allow-list ⇒ not trusted", async () => {
    _setTrustedEventStoreForTests(store({ consume: async () => ({ origin: "api", eventType: "estop" }) }));
    expect(await consumeTrustedSafetyOrigin(p)).toBeNull();
  });

  it("the store is asked with the digest of the payload; an unusable id never reaches it", async () => {
    const consume = vi.fn(async () => ({ origin: "safety_plc", eventType: "estop" }));
    _setTrustedEventStoreForTests(store({ consume }));
    expect(await consumeTrustedSafetyOrigin(p)).toEqual({ origin: "safety_plc", eventType: "estop" });
    expect((consume.mock.calls[0] as unknown[]).slice(0, 2)).toEqual([42, trustedEventDigest(p)]);
    for (const id of [0, -1, 1.5, "42", null, undefined, Number.NaN]) expect(await consumeTrustedSafetyOrigin({ ...p, id })).toBeNull();
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("digest binds id, type, robot / station / line and near-miss", () => {
    const base = trustedEventDigest(p);
    for (const v of [{ id: 43 }, { eventType: "zone_intrusion" }, { robotId: 1 }, { stationId: 5 }, { lineId: 2 }, { isNearMiss: true }]) {
      expect(trustedEventDigest({ ...p, ...v })).not.toBe(base);
    }
    expect(trustedEventDigest(JSON.parse(JSON.stringify(p)))).toBe(base); // survives a JSON round trip (Redis fan-out)
  });

  it("U fix 1 (I1): the ONE normaliser refuses any non-integer id / non-string type / non-boolean near-miss; the notice machine comes from it", async () => {
    const { trustedEventIdentity, safetyNoticeMachine } = await import("./trustedSafetyOrigin");
    expect(trustedEventIdentity(p)).toEqual({ id: 42, eventType: "estop", robotId: null, stationId: 4, lineId: null, isNearMiss: false });
    for (const bad of [{ robotId: "999" }, { stationId: "4" }, { lineId: 1.5 }, { robotId: {} }, { eventType: 5 }, { isNearMiss: "true" }, { id: "42" }]) {
      expect(trustedEventIdentity({ ...p, ...bad })).toBeNull();
      expect(trustedEventDigest({ ...p, ...bad })).toBeNull();
      expect(await consumeTrustedSafetyOrigin({ ...p, ...bad })).toBeNull();
    }
    expect(safetyNoticeMachine(trustedEventIdentity(p)!)).toBe("station:4");
    expect(safetyNoticeMachine({ robotId: 3, stationId: 4, lineId: 5 })).toBe("robot:3");
  });

  it("isTrustTableMissing: 42P01 / 42703 on the error or its cause only", () => {
    expect(isTrustTableMissing({ code: "42P01" })).toBe(true);
    expect(isTrustTableMissing({ cause: { code: "42703" } })).toBe(true);
    expect(isTrustTableMissing({ code: "23505" })).toBe(false);
    expect(isTrustTableMissing(null)).toBe(false);
  });

  it("the rules engine never asks the DB for a type no origin may make safety-critical (one consume per trusted-type event)", async () => {
    const { consumeSafetyCriticalTrust } = await import("../orchestration/rulesEngine");
    const consume = vi.fn(async () => ({ origin: "safety_plc", eventType: "estop_released" }));
    _setTrustedEventStoreForTests(store({ consume }));
    for (const t of ["estop_released", "plc_offline", "collision", "muting_active", undefined]) expect(await consumeSafetyCriticalTrust({ ...p, eventType: t })).toBe(false);
    expect(consume).not.toHaveBeenCalled();
    consume.mockResolvedValueOnce({ origin: "safety_plc", eventType: "estop" });
    expect(await consumeSafetyCriticalTrust(p)).toBe(true);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("the trust store is not replaceable in production (ignored, the durable store stays: fail closed)", async () => {
    const consume = vi.fn(async () => ({ origin: "safety_plc", eventType: "estop" }));
    _setTrustedEventStoreForTests(null); // the production (pg) store
    process.env.NODE_ENV = "production";
    try {
      _setTrustedEventStoreForTests(store({ consume }));
    } finally {
      process.env.NODE_ENV = saved.env;
    }
    // the pg store is still in force: here its DB (mocked, no execute) fails ⇒ NOT trusted; the fake was never asked
    expect(await consumeTrustedSafetyOrigin({ id: 42, eventType: "estop", stationId: 4, isNearMiss: false })).toBeNull();
    expect(consume).not.toHaveBeenCalled();
  });
});
