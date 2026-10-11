/**
 * doc 81 Đợt 9 task U3 — trusted safety events are bound to DURABLE rows and consumed EXACTLY ONCE in the DB (real _test DB,
 * migration 0371). Owner decision 2026-10-12: "bind trust to durable rows, never to instance memory".
 *
 * Shown on the real safetyAuditService + the real rules engine (only the socket emit and the notification sender are seams):
 *   • the device-ingest door writes the trust row in the SAME transaction as the event, bound to its content (digest);
 *   • the first delivery consumes it (safety-critical); a second delivery of the SAME payload — what another instance gets
 *     over the Redis fan-out, or a replayed bus message — is a NORMAL notice;
 *   • a forged payload reusing a trusted id with another robot / type gains nothing and does not burn the trust;
 *   • two "instances" (two separate DB connections) racing for one trust row: exactly one wins;
 *   • the trust survives a wiped process memory (an instance that never saw the event can still consume it ONCE — there is
 *     nothing in memory to wipe), and expires after TRUSTED_SAFETY_TRUST_TTL_MS on the DB clock;
 *   • non-trusted types and plain records get no trust row; the DB refuses re-arming a consumed row.
 * Oracles independent of product code: the rows read back with raw SQL on a separate connection; the notifications captured
 * at the sender seam.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import postgres from "postgres";

const E = vi.hoisted(() => {
  process.env.OAUTH_SERVER_URL ??= "http://127.0.0.1:9/oauth-unused";
  return { emitted: [] as Array<Record<string, unknown>>, calls: [] as Array<{ userId: number; opts: any }> };
});
vi.mock("../../_core/socket", () => ({
  emitSafetyEvent: vi.fn((e: Record<string, unknown>) => {
    E.emitted.push(e);
  }),
}));
vi.mock("../notificationService", () => ({
  sendSystemNotification: vi.fn(async (userId: number, _d: unknown, opts?: unknown) => {
    E.calls.push({ userId, opts });
    return { id: 1 };
  }),
}));
vi.mock("../auditTrailService", () => ({ logCrudOperation: vi.fn(async () => ({ id: 1 })) }));

import { record, recordFromDeviceIngest } from "./safetyAuditService";
import { consumeTrustedSafetyOrigin, pgTrustedEventStore, trustedEventDigest, TRUSTED_SAFETY_TRUST_TTL_MS } from "./trustedSafetyOrigin";
import { startOrchestration, stopOrchestration, consumeSafetyCriticalTrust } from "../orchestration/rulesEngine";
import { eventBus, EventTypes } from "../../_core/eventBus";

vi.setConfig({ testTimeout: 60_000 });
const DB_URL = process.env.DATABASE_URL;
const RUN = `u3-${Date.now().toString(36)}`;
const ENV = ["SAFETY_AUDIT_ENABLED", "ORCHESTRATION_ENABLED", "ORCH_NOTIFY_USER_IDS"] as const;
const saved: Record<string, string | undefined> = {};
let sql: ReturnType<typeof postgres>;
let sql2: ReturnType<typeof postgres>;

async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
}
const trustRow = async (id: number) => (await sql`SELECT origin, "eventType", digest, "consumedAt", "consumedBy" FROM safety_event_trust WHERE "eventId" = ${id}`)[0];

async function trustedEstop(over: Record<string, unknown> = {}) {
  const r = await recordFromDeviceIngest("safety_plc", { eventType: "estop", detectedBy: "plc", handledBy: "advisory", outcome: "logged_only", stationId: 77, lineId: 7, notes: RUN, ...over });
  expect(r.ok).toBe(true);
  return E.emitted[E.emitted.length - 1];
}

describe.skipIf(!DB_URL)("Đợt 9 U3 — durable, exactly-once trust of device-ingest safety events (_test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    sql2 = postgres(DB_URL!, { max: 1, onnotice: () => {} }); // a second "instance"
    const [db] = await sql`SELECT current_database() AS d`;
    expect(String(db.d)).toMatch(/_test$/);
    const [t] = await sql`SELECT to_regclass('public.safety_event_trust') IS NOT NULL AS ok`;
    expect(t.ok, "migration 0371 applied to _test").toBe(true);
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { SAFETY_AUDIT_ENABLED: "true", ORCHESTRATION_ENABLED: "true", ORCH_NOTIFY_USER_IDS: "5,6" });
  });
  afterAll(async () => {
    await sql`DELETE FROM safety_events WHERE notes = ${RUN}`; // trust rows follow (ON DELETE CASCADE)
    const [left] = await sql`SELECT count(*)::int AS n FROM safety_event_trust t JOIN safety_events e ON e.id = t."eventId" WHERE e.notes = ${RUN}`;
    expect(left.n).toBe(0);
    await sql.end();
    await sql2.end();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    E.emitted.length = 0;
    E.calls.length = 0;
    quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
  });
  afterEach(() => {
    stopOrchestration();
    quiet.forEach((q) => q.mockRestore());
  });

  it("★ the trusted door writes ONE trust row with the event, bound to its content; plain records / non-trusted types get none", async () => {
    const p = await trustedEstop();
    const row = await trustRow(p.id as number);
    expect(row).toMatchObject({ origin: "safety_plc", eventType: "estop", consumedAt: null });
    expect(row.digest).toBe(trustedEventDigest(p as never));
    await recordFromDeviceIngest("safety_plc", { eventType: "estop_released", detectedBy: "plc", handledBy: "advisory", stationId: 77, notes: RUN });
    expect(await trustRow(E.emitted[E.emitted.length - 1].id as number)).toBeUndefined();
    await record({ eventType: "estop", detectedBy: "plc", handledBy: "advisory", stationId: 77, notes: RUN });
    const plain = E.emitted[E.emitted.length - 1];
    expect(await trustRow(plain.id as number)).toBeUndefined();
    expect(await consumeSafetyCriticalTrust(plain)).toBe(false);
  });

  it("★ replay: the SAME payload delivered twice (local emit + Redis fan-out / replayed message) ⇒ ONE safety-critical notice set, the other normal", async () => {
    startOrchestration();
    const p = await trustedEstop();
    eventBus.publish(EventTypes.SAFETY_EVENT, p, "socket"); // the originating instance's delivery
    expect(await until(() => E.calls.length === 2, 5000)).toBe(true);
    eventBus.publish(EventTypes.SAFETY_EVENT, JSON.parse(JSON.stringify(p)), "socket"); // what a fan-out receiver / replay sees
    expect(await until(() => E.calls.length === 4, 5000)).toBe(true);
    expect(E.calls.map((c) => c.opts.safetyCritical)).toEqual([true, true, false, false]);
    expect(await trustRow(p.id as number)).toMatchObject({ consumedBy: expect.any(String) });
  });

  it("★ a forged payload reusing a trusted id with another station / type / near-miss gains nothing and does NOT burn the trust", async () => {
    const p = await trustedEstop();
    expect(await consumeSafetyCriticalTrust({ ...p, stationId: 999 })).toBe(false);
    expect(await consumeSafetyCriticalTrust({ ...p, eventType: "zone_intrusion" })).toBe(false);
    expect(await consumeSafetyCriticalTrust({ ...p, robotId: 1 })).toBe(false);
    expect(await consumeSafetyCriticalTrust({ ...p, isNearMiss: true })).toBe(false);
    expect(await consumeSafetyCriticalTrust({ ...p, id: String(p.id) })).toBe(false);
    expect((await trustRow(p.id as number)).consumedAt).toBeNull(); // still unconsumed
    expect(await consumeSafetyCriticalTrust(p)).toBe(true); // the genuine payload, once
    expect(await consumeSafetyCriticalTrust(p)).toBe(false);
    // the second answer is a clean "already consumed" (the WHERE clause), not an error caught on the one-way trigger
    expect(quiet[0].mock.calls.map((c) => String(c[0]))).not.toContainEqual(expect.stringMatching(/consume failed/));
  });

  // doc 81 Đợt 9 U fix 1 (review I1) — the digest and the notice come from ONE normaliser
  it("★ U fix 1 (I1): a replay of a STATION trip with robotId:\"999\" (or any non-integer id) is never safety-critical, consumes nothing, and cannot redirect the bypass notice", async () => {
    startOrchestration();
    const p = await trustedEstop(); // station 77, line 7, robotId null
    for (const forged of [{ robotId: "999" }, { stationId: "77" }, { lineId: 7.5 }, { robotId: {} }, { isNearMiss: "false" }, { eventType: ["estop"] }]) {
      expect(await consumeSafetyCriticalTrust({ ...p, ...forged } as never)).toBe(false);
    }
    expect((await trustRow(p.id as number)).consumedAt).toBeNull();
    eventBus.publish(EventTypes.SAFETY_EVENT, { ...p, robotId: "999" }, "redis-replay"); // the forged copy arrives FIRST
    expect(await until(() => E.calls.length === 2, 5000)).toBe(true);
    eventBus.publish(EventTypes.SAFETY_EVENT, p, "socket"); // then the genuine one
    expect(await until(() => E.calls.length === 4, 5000)).toBe(true);
    expect(E.calls.map((c) => [c.opts.safetyCritical, c.opts.rateKey])).toEqual([
      [false, "safety:estop:robot:999"],
      [false, "safety:estop:robot:999"],
      [true, "safety:estop:station:77"],
      [true, "safety:estop:station:77"],
    ]);
  });

  it("a near-miss recorded through the trusted door is never safety-critical (and its trust is left unconsumed)", async () => {
    const p = await trustedEstop({ isNearMiss: true });
    expect(p.isNearMiss).toBe(true);
    expect(await consumeSafetyCriticalTrust(p)).toBe(false);
    expect((await trustRow(p.id as number)).consumedAt).toBeNull();
  });

  it("★ two instances race for one trust row (two DB connections, 20 concurrent consumes) ⇒ exactly ONE wins", async () => {
    const p = await trustedEstop();
    const digest = trustedEventDigest(p as never)!;
    const viaOther = (n: number) =>
      sql2`UPDATE safety_event_trust SET "consumedAt" = now(), "consumedBy" = ${"other-" + n}
            WHERE "eventId" = ${p.id as number} AND "consumedAt" IS NULL AND digest = ${digest} RETURNING origin`.then((r) => r.length === 1);
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => consumeTrustedSafetyOrigin(p as never).then((r) => r != null)),
      ...Array.from({ length: 10 }, (_, i) => viaOther(i)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("★ nothing lives in instance memory: an instance that never saw the event consumes it ONCE (the store is the DB)", async () => {
    const p = await trustedEstop();
    // a different consumer through the production store, on its own (fresh) call path
    const got = await pgTrustedEventStore.consume(p.id as number, trustedEventDigest(p as never)!, { ttlMs: TRUSTED_SAFETY_TRUST_TTL_MS, consumer: "instance-B" });
    expect(got).toEqual({ origin: "safety_plc", eventType: "estop" });
    expect(await consumeSafetyCriticalTrust(p)).toBe(false); // instance A afterwards: already consumed
    expect((await trustRow(p.id as number)).consumedBy).toBe("instance-B");
  });

  it("★ expiry on the DB clock: a trust row older than the TTL is never consumed", async () => {
    await record({ eventType: "estop", detectedBy: "plc", handledBy: "advisory", stationId: 77, notes: RUN });
    const p = E.emitted[E.emitted.length - 1];
    await sql`INSERT INTO safety_event_trust ("eventId", origin, "eventType", digest, "createdAt")
              VALUES (${p.id as number}, 'safety_plc', 'estop', ${trustedEventDigest(p as never)!}, now() - make_interval(secs => ${TRUSTED_SAFETY_TRUST_TTL_MS / 1000 + 5}))`;
    expect(await consumeSafetyCriticalTrust(p)).toBe(false);
  });

  it("★ the DB refuses re-arming a consumed row and changing its content (one-way trigger)", async () => {
    const p = await trustedEstop();
    expect(await consumeSafetyCriticalTrust(p)).toBe(true);
    await expect(sql`UPDATE safety_event_trust SET "consumedAt" = NULL, "consumedBy" = NULL WHERE "eventId" = ${p.id as number}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE safety_event_trust SET digest = ${"0".repeat(64)} WHERE "eventId" = ${p.id as number}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`DELETE FROM safety_event_trust WHERE "eventId" = ${p.id as number}`).rejects.toMatchObject({ code: "42501" });
  });
});
