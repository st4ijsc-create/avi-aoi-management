/**
 * doc 81 Đợt 5 task G4 (item 12) — two (or more) users pin the SAME stop tag at the same time.
 *
 * `datStopPin` locks the tag row (`SELECT … FOR UPDATE`) before reading the current pin, so concurrent writers are
 * serialised: no write is lost, and the audit "before" of every change is the pin that was REALLY there just before
 * it. This file measures that BEHAVIOUR (not the lock mechanism), so it must hold with the current row lock and with
 * any extra lock added in the same area later (Đợt 5 F7 adds an advisory lock).
 *
 * Contention is FORCED, not hoped for: a separate connection holds `FOR UPDATE` on the tag row while the writers are
 * started, so every writer is inside its transaction and waiting when the holder releases. Bounded waits only.
 *
 * Oracles (independent of product code): rows read back with raw SQL from `device_tags`, `control_audit_log` and
 * `audit_logs` of the `_test` DB. The audit trail must form ONE chain:
 *   audit[0].before = initial pin, audit[i].before = audit[i-1].after, final DB pin = audit[last].after,
 *   and the set of `after` values = exactly the values the writers sent (none lost, none duplicated).
 * ⚠ `audit_logs` is WORM (no DELETE for avi_app): each run leaves its audit_logs rows, like stopPin.dot1d.db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// G fix 1 (review finding 6) — pristine output: the held lock makes every writer's SELECT … FOR UPDATE "slow" by design
// (queryMonitor would print one [SLOW QUERY] line per writer), and the db/redis modules log on import. Installed before
// the imports (vi.hoisted), restored afterAll; console.error is left alone so real failures still show.
const quiet = vi.hoisted(() => {
  const saved = process.env.QUERY_MONITOR_ENABLED;
  process.env.QUERY_MONITOR_ENABLED = "false";
  const orig = { log: console.log, info: console.info, warn: console.warn };
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  return { saved, orig };
});

import postgres from "postgres";
import { datStopPin, goMoiStopPinCuaAdapterTx } from "./stopPin";

const DB_URL = process.env.DATABASE_URL;
const RUN = `G4SP${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
let adapterId = 0;
let tagId = 0;
let startAuditId = 0;
let startAuditLogId = 0;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pinNow = async () => (await sql<{ v: unknown }[]>`SELECT stop_value AS v FROM device_tags WHERE id = ${tagId}`)[0].v ?? null;

type Link = { before: unknown; after: unknown };
async function controlChain(): Promise<Link[]> {
  const rows = await sql<{ beforeJson: any; afterJson: any }[]>`
    SELECT "beforeJson", "afterJson" FROM control_audit_log
     WHERE "entityType" = 'device_tag_stop_pin' AND "entityId" = ${String(tagId)} AND id > ${startAuditId}
     ORDER BY id`;
  const j = (x: any) => (typeof x === "string" ? JSON.parse(x) : x);
  return rows.map((r) => ({ before: j(r.beforeJson)?.stopValue ?? null, after: j(r.afterJson)?.stopValue ?? null }));
}
async function auditLogChain(): Promise<Link[]> {
  const rows = await sql<{ details: string }[]>`
    SELECT details FROM audit_logs
     WHERE action = 'deviceTag.setStopPin' AND "entityType" = 'device_tag' AND "entityId" = ${tagId} AND id > ${startAuditLogId}
     ORDER BY id`;
  return rows.map((r) => {
    const d = JSON.parse(r.details);
    return { before: d.before?.stopValue ?? null, after: d.after?.stopValue ?? null };
  });
}

/** The chain property: starts at `initial`, each before = previous after, ends at the DB pin. */
function expectOneChain(chain: Link[], initial: unknown, finalPin: unknown, label: string) {
  expect(chain.length, `${label}: chain length`).toBeGreaterThan(0);
  expect(chain[0].before, `${label}: first before`).toEqual(initial);
  for (let i = 1; i < chain.length; i++) {
    expect(chain[i].before, `${label}: link ${i} before = previous after (lost update otherwise)`).toEqual(chain[i - 1].after);
  }
  expect(chain[chain.length - 1].after, `${label}: last after = DB pin`).toEqual(finalPin);
}

/**
 * Backends of this database that are BLOCKED, directly or through a queue of other waiters, by `holderPid`
 * (pg_blocking_pids + transitive closure: later FOR UPDATE waiters queue behind the first one, and any extra lock a
 * writer takes after the row lock — e.g. F7's advisory lock — still leaves it in this chain).
 */
async function backendsBlockedBy(holderPid: number): Promise<Array<{ pid: number; waitEventType: string | null }>> {
  const rows = await sql<{ pid: number; blockers: number[]; wait_event_type: string | null }[]>`
    SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type
      FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()`;
  const reaches = new Map<number, boolean>();
  const byPid = new Map(rows.map((r) => [r.pid, r] as const));
  const visit = (pid: number, seen: Set<number>): boolean => {
    if (reaches.has(pid)) return reaches.get(pid)!;
    if (seen.has(pid)) return false;
    seen.add(pid);
    const r = byPid.get(pid);
    const ok = !!r && r.blockers.some((b) => b === holderPid || visit(b, seen));
    reaches.set(pid, ok);
    return ok;
  };
  return rows.filter((r) => r.pid !== holderPid && visit(r.pid, new Set())).map((r) => ({ pid: r.pid, waitEventType: r.wait_event_type }));
}

/**
 * Hold FOR UPDATE on the tag row from another connection, start `writers` while it is held, PROVE from the server
 * (pg_stat_activity / pg_blocking_pids) that every writer is blocked on a lock behind the holder — not merely slow or
 * waiting for a pool slot — and that nothing was written, then release and wait (bounded) for every writer.
 */
async function underHeldLock<T>(writers: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let locked!: (pid: number) => void;
  const isLocked = new Promise<number>((r) => (locked = r));
  const holder = sql.begin(async (h) => {
    const [{ pid }] = await h<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await h`SELECT id FROM device_tags WHERE id = ${tagId} FOR UPDATE`;
    locked(pid);
    await released;
  });
  const holderPid = await withTimeout(isLocked, 5000, "holder lock");
  const before = await pinNow();
  let settled = 0;
  const running = writers.map((w) => w().finally(() => { settled++; }));
  // Bounded poll (5 s) until the server shows EVERY writer blocked behind the holder.
  let blocked: Array<{ pid: number; waitEventType: string | null }> = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    blocked = await backendsBlockedBy(holderPid);
    if (blocked.length >= writers.length) break;
    await sleep(25);
  }
  expect(blocked.length, `writers blocked behind the holder (pid ${holderPid})`).toBe(writers.length);
  expect(blocked.every((b) => b.waitEventType === "Lock"), JSON.stringify(blocked)).toBe(true);
  expect(settled, "a writer finished while the tag row was locked by another transaction").toBe(0);
  expect(await pinNow()).toEqual(before);
  release();
  await withTimeout(holder, 5000, "holder release");
  return withTimeout(Promise.allSettled(running), 20_000, "writers");
}

const nguoiSua = (n: number) => ({ id: null, name: `G4 writer ${n}` });

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("doc 81 Đợt 5 G4 — concurrent stop-pin writes (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 4, connect_timeout: 30, onnotice: () => {} }); // holder + monitor + reads
    const [a] = await sql<{ id: number }[]>`
      INSERT INTO device_adapters (code, name, protocol, endpoint, "connectionOptions", "machineId", "isEnabled")
      VALUES (${`${RUN}-A`}, 'G4 contention', 'stub', 'stub://g4', ${sql.json({ unitId: 1 })}, NULL, false) RETURNING id`;
    adapterId = a.id;
    const [t] = await sql<{ id: number }[]>`
      INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${adapterId}, 'stop_sp', 'DB1.stop_sp', 'float', true, true) RETURNING id`;
    tagId = t.id;
  }, 60_000);

  beforeEach(async () => {
    await sql`UPDATE device_tags SET stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL WHERE id = ${tagId}`;
    startAuditId = (await sql<{ m: number | null }[]>`SELECT max(id) AS m FROM control_audit_log`)[0].m ?? 0;
    startAuditLogId = (await sql<{ m: number | null }[]>`SELECT max(id) AS m FROM audit_logs`)[0].m ?? 0;
  });

  afterAll(async () => {
    Object.assign(console, quiet.orig);
    if (quiet.saved === undefined) delete process.env.QUERY_MONITOR_ENABLED;
    else process.env.QUERY_MONITOR_ENABLED = quiet.saved;
    if (!sql) return;
    await sql`DELETE FROM commissioning_records WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
    await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("6 users set 6 different pins at once ⇒ all 6 applied in SOME order, none lost, every audit 'before' is the real prior pin", async () => {
    const values = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
    const results = await underHeldLock(
      values.map((v, i) => () =>
        datStopPin({ adapterId, tagKey: "stop_sp", stopValue: v, reason: `G4 writer ${i}`, nguoiSua: nguoiSua(i), phamViMay: null }),
      ),
    );
    for (const r of results) {
      expect(r.status, r.status === "rejected" ? String((r as PromiseRejectedResult).reason) : "").toBe("fulfilled");
      expect((r as PromiseFulfilledResult<{ changed: boolean }>).value.changed).toBe(true);
    }
    const finalPin = await pinNow();
    for (const [label, chain] of [["control_audit_log", await controlChain()], ["audit_logs", await auditLogChain()]] as const) {
      expect(chain, label).toHaveLength(values.length);
      expectOneChain(chain, null, finalPin, label);
      expect(chain.map((l) => l.after).sort(), `${label}: every sent value applied exactly once`).toEqual([...values].sort());
    }
  }, 60_000);

  it("set vs clear at the same moment (pin 1 ⇒ {set 9, clear}) ⇒ either order, both audited against the real prior pin", async () => {
    await datStopPin({ adapterId, tagKey: "stop_sp", stopValue: 1, reason: "G4 seed pin", nguoiSua: nguoiSua(0), phamViMay: null });
    startAuditId = (await sql<{ m: number | null }[]>`SELECT max(id) AS m FROM control_audit_log`)[0].m ?? 0;
    startAuditLogId = (await sql<{ m: number | null }[]>`SELECT max(id) AS m FROM audit_logs`)[0].m ?? 0;

    const results = await underHeldLock<unknown>([
      () => datStopPin({ adapterId, tagKey: "stop_sp", stopValue: 9, reason: "G4 set 9", nguoiSua: nguoiSua(1), phamViMay: null }),
      () => datStopPin({ adapterId, tagKey: "stop_sp", stopValue: null, reason: "G4 clear", nguoiSua: nguoiSua(2), phamViMay: null }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const finalPin = await pinNow();
    for (const [label, chain] of [["control_audit_log", await controlChain()], ["audit_logs", await auditLogChain()]] as const) {
      expect(chain, label).toHaveLength(2);
      expectOneChain(chain, 1, finalPin, label);
      // exactly the two legal serial orders
      const order = JSON.stringify(chain);
      expect([JSON.stringify([{ before: 1, after: 9 }, { before: 9, after: null }]), JSON.stringify([{ before: 1, after: null }, { before: null, after: 9 }])]).toContain(order);
    }
  }, 60_000);

  it("manual pin vs adapter re-point auto-clear (goMoiStopPinCuaAdapterTx) at once, both start orders ×3 ⇒ one chain, nothing lost", async () => {
    const { getDb } = await import("../../db");
    const db = (await getDb())!;
    for (const order of ["pin-first", "clear-first", "pin-first", "clear-first", "pin-first", "clear-first"] as const) {
      await datStopPin({ adapterId, tagKey: "stop_sp", stopValue: 2, reason: "G4 seed pin", nguoiSua: nguoiSua(0), phamViMay: null });
      startAuditId = (await sql<{ m: number | null }[]>`SELECT max(id) AS m FROM control_audit_log`)[0].m ?? 0;
      startAuditLogId = (await sql<{ m: number | null }[]>`SELECT max(id) AS m FROM audit_logs`)[0].m ?? 0;
      const pin = () => datStopPin({ adapterId, tagKey: "stop_sp", stopValue: 7, reason: "G4 set 7", nguoiSua: nguoiSua(1), phamViMay: null });
      const clear = () =>
        db.transaction((tx) =>
          goMoiStopPinCuaAdapterTx(tx, { adapterId, nguon: "adapter_redefined", nguoiSua: nguoiSua(2), thaoTac: "G4 re-point" }),
        );
      const results = await underHeldLock<unknown>(order === "pin-first" ? [pin, clear] : [clear, pin]);
      expect(results.map((r) => r.status), order).toEqual(["fulfilled", "fulfilled"]);
      const finalPin = await pinNow();
      for (const [label, chain] of [["control_audit_log", await controlChain()], ["audit_logs", await auditLogChain()]] as const) {
        expect(chain, `${order} ${label}`).toHaveLength(2);
        expectOneChain(chain, 2, finalPin, `${order} ${label}`);
      }
    }
  }, 120_000);

  it("20 rounds of 2 un-orchestrated writers (natural interleaving) ⇒ always one chain", async () => {
    let prev: unknown = null;
    for (let round = 0; round < 20; round++) {
      const a = round * 2 + 10;
      const b = round * 2 + 11;
      const res = await withTimeout(
        Promise.allSettled([
          datStopPin({ adapterId, tagKey: "stop_sp", stopValue: a, reason: `G4 r${round}a`, nguoiSua: nguoiSua(1), phamViMay: null }),
          datStopPin({ adapterId, tagKey: "stop_sp", stopValue: b, reason: `G4 r${round}b`, nguoiSua: nguoiSua(2), phamViMay: null }),
        ]),
        20_000,
        `round ${round}`,
      );
      expect(res.map((r) => r.status), `round ${round}`).toEqual(["fulfilled", "fulfilled"]);
      prev = await pinNow();
    }
    const chain = await controlChain();
    expect(chain).toHaveLength(40);
    expectOneChain(chain, null, prev, "control_audit_log (20 rounds)");
  }, 120_000);
});
