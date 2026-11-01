/**
 * A2 test (R1b-2b-2a) item 1 — the F1 harness start-up sweep (__edgeE2eSweep.dot10.ts), on the REAL `_test` DB, every case in ONE
 * transaction that is always ROLLED BACK (nothing committed, no DELETE). The seeded rows use a test-only harness prefix (passed as
 * `prefixes`) so the cases never touch a real leftover; the default prefix list is pinned to the suites by the census case below.
 *
 * Seeds (old = DAU older than the horizon, recent = younger; dead port = closed just before; live port = a listening server):
 *   SPLC old+dead ⇒ enabled=false · SPLCB old+dead ⇒ enabled=false · SPLC recent+dead ⇒ untouched · SPLC old+LIVE port ⇒ untouched
 *   AA old ⇒ isEnabled=false · RA old ⇒ isEnabled=false · RB old WITH an unacked STOP ⇒ untouched + reported by id · RC recent ⇒ untouched
 *   users <DAU>-owner old ⇒ isActive=false, recent ⇒ untouched · workflow <DAU>-wf old ⇒ archived, recent ⇒ untouched
 *   rows WITHOUT the marker (old timestamp, wrong shape) ⇒ untouched.
 * Fail-closed: another current_database() / the owner `aoi` ⇒ nothing swept.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { sweepHarnessLeftovers, harnessPatterns, endpointHostPort, isLoopbackHost, tcpPortListens, HARNESS_PREFIXES, SWEEP_HORIZON_MS, type SweepDeps, type SweepReport } from "./__edgeE2eSweep.dot10";
import { pendingStopsOf } from "./__edgeE2eStopClose.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const TP = `ZS${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e6).toString(36).toUpperCase()}`;
const NOW = Date.now();
const OLD = NOW - SWEEP_HORIZON_MS - 3_600_000;
const RECENT = NOW - 60_000;
const ROLLBACK = Symbol("rollback");

let pg: ReturnType<typeof postgres>;
let live: net.Server;
let livePort = 0;
let deadPort = 0;

async function freePortClosed(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

beforeAll(async () => {
  expect(new URL(DB_URL).pathname).toBe("/aoi_management_test");
  pg = postgres(DB_URL, { max: 2, onnotice: () => {} });
  live = net.createServer((sock) => sock.destroy());
  await new Promise<void>((r) => live.listen(0, "127.0.0.1", () => r()));
  livePort = (live.address() as net.AddressInfo).port;
  deadPort = await freePortClosed();
});
afterAll(async () => {
  await new Promise<void>((r) => live.close(() => r()));
  await pg.end();
});

type Tx = postgres.TransactionSql;
/** Seeds, sweeps and reads back INSIDE one transaction, then throws ROLLBACK (always). */
async function inRolledBackTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await pg
    .begin(async (tx) => {
      out = await fn(tx);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  return out as T;
}

interface Seeded {
  ids: Record<string, number>;
  stopId: number;
}
async function seed(tx: Tx): Promise<Seeded> {
  const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
  const ids: Record<string, number> = {};
  const plc = (code: string, port: number) =>
    one(tx`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled) VALUES (${code}, 'A2 sweep', 'pilz', 'modbus', ${`tcp://127.0.0.1:${port}`}, ${tx.json({ estop: { address: "coil:1" } })}, true) RETURNING id`);
  ids.plcOldDead = await plc(`SPLC-${TP}-${OLD}`, deadPort);
  ids.plcBOldDead = await plc(`SPLCB-${TP}-${OLD}`, deadPort);
  ids.plcRecentDead = await plc(`SPLC-${TP}-${RECENT}`, deadPort);
  ids.plcOldLive = await plc(`SPLC-${TP}-${OLD + 1}`, livePort);
  ids.plcNoMarker = await plc(`SPLC-${TP}-${OLD}-x`, deadPort);
  // fix round 1 (R2): an old marker row whose endpoint is NOT loopback (TEST-NET-1) ⇒ never probed, kept, logged
  ids.plcOldRemote = await one(tx`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled) VALUES (${`SPLC-${TP}-${OLD + 2}`}, 'A2 sweep', 'pilz', 'modbus', 'tcp://192.0.2.1:502', ${tx.json({ estop: { address: "coil:1" } })}, true) RETURNING id`);
  ids.adOld = await one(tx`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled") VALUES (${`AA-${TP}-${OLD}`}, 'A2 sweep', 'stub', 'stub://a2', true) RETURNING id`);
  ids.adNoMarker = await one(tx`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled") VALUES (${`AZ-${TP}-${OLD}`}, 'A2 sweep', 'stub', 'stub://a2', true) RETURNING id`);
  const node = await one(tx`INSERT INTO edge_nodes (code, name, status) VALUES (${`N-${TP}-a2sweep`}, 'A2 sweep node', 'offline') RETURNING id`);
  const robot = (code: string, edgeNodeId: number | null) =>
    one(tx`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "edgeNodeId") VALUES (${code}, 'A2 sweep', 'sim', 'sim://a2', true, ${edgeNodeId}) RETURNING id`);
  ids.rOld = await robot(`RA-${TP}-${OLD}`, null);
  ids.rOldStop = await robot(`RB-${TP}-${OLD}`, node);
  ids.rRecent = await robot(`RC-${TP}-${RECENT}`, null);
  ids.rNoMarker = await robot(`RZ-${TP}-${OLD}`, null);
  ids.uOld = await one(tx`INSERT INTO users ("openId", name, role, "isActive") VALUES (${`${TP}-${OLD}-owner`}, 'A2 sweep', 'admin', true) RETURNING id`);
  ids.uRecent = await one(tx`INSERT INTO users ("openId", name, role, "isActive") VALUES (${`${TP}-${RECENT}-admin`}, 'A2 sweep', 'admin', true) RETURNING id`);
  ids.uNoMarker = await one(tx`INSERT INTO users ("openId", name, role, "isActive") VALUES (${`${TP}-${OLD}-guest`}, 'A2 sweep', 'admin', true) RETURNING id`);
  const wf = (ref: string) => one(tx`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey") VALUES (${ref}, ${ref}, ${tx.json({ ref, name: ref, steps: [] })}, 'active', 'global') RETURNING id`);
  ids.wfOld = await wf(`${TP}-${OLD}-wf`);
  ids.wfRecent = await wf(`${TP}-${RECENT}-wf`);
  ids.wfNoMarker = await wf(`x${TP}-${OLD}-wf`);
  const [ep] = await tx`SELECT "ownerEpoch" FROM robots WHERE id = ${ids.rOldStop}`;
  const stopId = await one(
    tx`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt") VALUES (${ids.rOldStop}, ${node}, ${Number(ep.ownerEpoch)}, 'stop', 'A2 sweep: a dead run left this STOP', ${ids.uOld}, now() + interval '1 hour') RETURNING id`,
  );
  return { ids, stopId };
}

interface State {
  plc: Record<number, boolean>;
  ad: Record<number, boolean>;
  rb: Record<number, boolean>;
  us: Record<number, boolean>;
  wf: Record<number, string>;
  stopPending: boolean;
}
async function readState(tx: Tx, s: Seeded): Promise<State> {
  const v = Object.values(s.ids);
  const map = <T>(rows: Array<Record<string, unknown>>, k: string) => Object.fromEntries(rows.map((r) => [Number(r.id), r[k] as T]));
  const [q] = await tx`SELECT "ackedAt", "resolvedAt" FROM robot_motion_lock_requests WHERE id = ${s.stopId}`;
  return {
    plc: map<boolean>(await tx`SELECT id, enabled FROM safety_plc_configs WHERE id IN ${tx(v)}`, "enabled"),
    ad: map<boolean>(await tx`SELECT id, "isEnabled" FROM device_adapters WHERE id IN ${tx(v)}`, "isEnabled"),
    rb: map<boolean>(await tx`SELECT id, "isEnabled" FROM robots WHERE id IN ${tx(v)}`, "isEnabled"),
    us: map<boolean>(await tx`SELECT id, "isActive" FROM users WHERE id IN ${tx(v)}`, "isActive"),
    wf: map<string>(await tx`SELECT id, status::text AS status FROM orchestration_workflows WHERE id IN ${tx(v)}`, "status"),
    stopPending: q.ackedAt === null && q.resolvedAt === null,
  };
}

async function runCase(deps: Partial<SweepDeps> = {}): Promise<{ s: Seeded; rep: SweepReport; st: State; logs: string[] }> {
  return inRolledBackTx(async (tx) => {
    const s = await seed(tx);
    const logs: string[] = [];
    const rep = await sweepHarnessLeftovers(tx, { now: () => NOW, prefixes: [TP], log: (l) => logs.push(l), ...deps });
    return { s, rep, st: await readState(tx, s), logs };
  });
}

describe("A2 test — F1 harness start-up sweep (real _test DB, ROLLBACK)", () => {
  it("★ old DAU + dead port ⇒ inert; recent ⇒ untouched; live port ⇒ SPLC untouched; pending STOP ⇒ robot untouched + reported; no marker ⇒ untouched", async () => {
    const probed: string[] = [];
    const { s, rep, st, logs } = await runCase({ portListens: (h, p) => (probed.push(`${h}:${p}`), tcpPortListens(h, p)) });
    const i = s.ids;
    expect(rep.skipped).toBeUndefined();
    // made inert
    expect(st.plc[i.plcOldDead]).toBe(false);
    expect(st.plc[i.plcBOldDead]).toBe(false);
    expect(st.ad[i.adOld]).toBe(false);
    expect(st.rb[i.rOld]).toBe(false);
    expect(st.us[i.uOld]).toBe(false);
    expect(st.wf[i.wfOld]).toBe("archived");
    // age horizon: a recent DAU is a live run ⇒ untouched
    expect(st.plc[i.plcRecentDead]).toBe(true);
    expect(st.rb[i.rRecent]).toBe(true);
    expect(st.us[i.uRecent]).toBe(true);
    expect(st.wf[i.wfRecent]).toBe("active");
    // port check: a listening port ⇒ the SPLC stays enabled, reported
    expect(st.plc[i.plcOldLive]).toBe(true);
    expect(rep.keptPortListening.map((r) => r.id)).toEqual([i.plcOldLive]);
    // fix round 1 (R2): a non-loopback endpoint is NEVER probed — kept, logged "not loopback"
    expect(st.plc[i.plcOldRemote]).toBe(true);
    expect(probed.some((x) => x.startsWith("192.0.2.1"))).toBe(false);
    expect(probed.every((x) => x.startsWith("127.0.0.1:"))).toBe(true);
    expect(rep.keptEndpointUnknown.map((r) => [r.id, r.reason])).toEqual([[i.plcOldRemote, "endpoint not checkable (not loopback): 192.0.2.1:502"]]);
    expect(logs.filter((l) => l.includes(`kept safety_plc_configs #${i.plcOldRemote} `) && l.includes("not loopback"))).toHaveLength(1);
    // pending STOP: the robot stays as it is, the STOP is not touched, reported by id
    expect(st.rb[i.rOldStop]).toBe(true);
    expect(st.stopPending).toBe(true);
    expect(rep.keptPendingStop.map((r) => [r.table, r.id])).toEqual([["robots", i.rOldStop]]);
    expect(rep.keptPendingStop[0].reason).toContain(`#${s.stopId}`);
    // no marker ⇒ untouched, however old
    expect(st.plc[i.plcNoMarker]).toBe(true);
    expect(st.ad[i.adNoMarker]).toBe(true);
    expect(st.rb[i.rNoMarker]).toBe(true);
    expect(st.us[i.uNoMarker]).toBe(true);
    expect(st.wf[i.wfNoMarker]).toBe("active");
    // exactly the six rows, one log line each (table + id + reason), plus one line per kept row
    expect(rep.inert.map((r) => `${r.table}#${r.id}`).sort()).toEqual(
      [`safety_plc_configs#${i.plcOldDead}`, `safety_plc_configs#${i.plcBOldDead}`, `device_adapters#${i.adOld}`, `robots#${i.rOld}`, `users#${i.uOld}`, `orchestration_workflows#${i.wfOld}`].sort(),
    );
    for (const r of rep.inert) expect(logs.filter((l) => l.startsWith(`[F1 sweep] inert ${r.table} #${r.id} `) && l.includes("dead run"))).toHaveLength(1);
    expect(logs.filter((l) => l.includes(`kept robots #${i.rOldStop} `) && l.includes(`#${s.stopId}`))).toHaveLength(1);
    expect(logs.filter((l) => l.includes(`kept safety_plc_configs #${i.plcOldLive} `))).toHaveLength(1);
  });

  it("★ a second sweep changes nothing more (idempotent: every UPDATE re-checks marker + active state)", async () => {
    const out = await inRolledBackTx(async (tx) => {
      await seed(tx);
      const d = { now: () => NOW, prefixes: [TP], log: () => undefined };
      const a = await sweepHarnessLeftovers(tx, d);
      const b = await sweepHarnessLeftovers(tx, d);
      return { a: a.inert.length, b: b.inert.length, kept: b.keptPendingStop.length };
    });
    expect(out).toEqual({ a: 6, b: 0, kept: 1 });
  });

  it.each([
    ["another database", { db: "aoi_management", user: "avi_app" }],
    ["the owner aoi on _test", { db: "aoi_management_test", user: "aoi" }],
  ])("★ fail-closed DB identity: %s ⇒ NOTHING swept", async (_t, who) => {
    const { s, rep, st, logs } = await runCase({ readDbIdentity: async () => who });
    expect(rep.skipped).toMatch(/runs only on aoi_management_test and never as the owner aoi/);
    expect(rep.inert).toEqual([]);
    expect(st.plc[s.ids.plcOldDead]).toBe(true);
    expect(st.rb[s.ids.rOld]).toBe(true);
    expect(st.us[s.ids.uOld]).toBe(true);
    expect(st.wf[s.ids.wfOld]).toBe("active");
    expect(logs.filter((l) => l.startsWith("[F1 sweep] NOT swept"))).toHaveLength(1);
  });
});

describe("A2 test kd — endpoint without host:port, carried STOP (real _test DB, ROLLBACK)", () => {
  const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

  it("★ kd s8: an old SPLC whose endpoint is sim:// or garbage ⇒ keptEndpointUnknown, nothing throws, later stale rows of the SAME sweep still made inert", async () => {
    const out = await inRolledBackTx(async (tx) => {
      // inserted FIRST (lower ids ⇒ visited before every other stale row of the sweep)
      const plcAt = (code: string, endpoint: string) =>
        one(tx`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled) VALUES (${code}, 'A2 kd', 'pilz', 'modbus', ${endpoint}, ${tx.json({ estop: { address: "coil:1" } })}, true) RETURNING id`);
      const a = await plcAt(`SPLC-${TP}-${OLD + 3}`, "sim://x");
      const b = await plcAt(`SPLC-${TP}-${OLD + 4}`, "garbage :: not-an-endpoint");
      const s = await seed(tx);
      const logs: string[] = [];
      const rep = await sweepHarnessLeftovers(tx, { now: () => NOW, prefixes: [TP], log: (l) => logs.push(l) });
      const st = await readState(tx, { ...s, ids: { ...s.ids, a, b } });
      return { s, rep, st, a, b, logs };
    });
    const { s, rep, st } = out;
    expect(rep.keptEndpointUnknown.map((r) => r.id)).toEqual(expect.arrayContaining([out.a, out.b]));
    expect(rep.keptEndpointUnknown.find((r) => r.id === out.a)?.reason).toMatch(/not tcp:\/\/host:port/);
    expect(rep.keptEndpointUnknown.find((r) => r.id === out.b)?.reason).toMatch(/not tcp:\/\/host:port/);
    expect(st.plc[out.a]).toBe(true);
    expect(st.plc[out.b]).toBe(true);
    // the sweep went on past them: later stale rows (SPLC, robot, user, workflow) are still made inert
    expect(st.plc[s.ids.plcOldDead]).toBe(false);
    expect(st.rb[s.ids.rOld]).toBe(false);
    expect(st.us[s.ids.uOld]).toBe(false);
    expect(st.wf[s.ids.wfOld]).toBe("archived");
    expect(out.logs.filter((l) => l.startsWith("[F1 sweep] done:"))).toHaveLength(1);
  });

  it("★ kd s16 / c12: an unacked STOP that was CARRIED on (carriedToId set, its head acked) is NOT pending — the sweep makes the robot inert, pendingStopsOf does not count it (mig 0374 device_keep_pending_stop)", async () => {
    const out = await inRolledBackTx(async (tx) => {
      const [usr] = await tx`SELECT id FROM users WHERE role = 'admin' AND "isActive" = true ORDER BY id LIMIT 1`;
      const n1 = await one(tx`INSERT INTO edge_nodes (code, name, status) VALUES (${`N1-${TP}-kd`}, 'A2 kd 1', 'offline') RETURNING id`);
      const n2 = await one(tx`INSERT INTO edge_nodes (code, name, status) VALUES (${`N2-${TP}-kd`}, 'A2 kd 2', 'offline') RETURNING id`);
      const robot = await one(tx`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "edgeNodeId") VALUES (${`RA-${TP}-${OLD + 5}`}, 'A2 kd', 'sim', 'sim://kd', true, ${n1}) RETURNING id`);
      const [ep] = await tx`SELECT "ownerEpoch" FROM robots WHERE id = ${robot}`;
      const q1 = await one(
        tx`INSERT INTO robot_motion_lock_requests ("robotId", "edgeNodeId", "ownerEpoch", kind, reason, "requestedBy", "expiresAt") VALUES (${robot}, ${n1}, ${Number(ep.ownerEpoch)}, 'stop', 'A2 kd carried', ${Number(usr.id)}, now() + interval '1 hour') RETURNING id`,
      );
      // the product's carry (mig 0374 device_owner_stop_carry): an owner change edge → edge moves the unacked STOP head to the new owner
      await tx`SELECT set_config('avi.actor', 'A2 kd test', true)`;
      await tx`UPDATE robots SET "edgeNodeId" = ${n2} WHERE id = ${robot}`;
      const [c1] = await tx`SELECT "carriedToId", "ackedAt" FROM robot_motion_lock_requests WHERE id = ${q1}`;
      const q2 = Number(c1.carriedToId);
      // the new head is executed + acked by central the product's way (owner → central, execution recorded, edge_stop_ack_central)
      await tx`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${robot}`;
      const [ex] = await tx`SELECT public.edge_stop_record_central_execution('robot', ${robot}, true, 'A2 kd test') AS id`;
      await tx`SELECT public.edge_stop_ack_central(${q2}, 'done', ${ex.id}::bigint)`;
      const rows = await tx`SELECT id, "ackedAt", "carriedToId", outcome FROM robot_motion_lock_requests WHERE "robotId" = ${robot} ORDER BY id`;
      const pending = await pendingStopsOf(tx, [robot], []);
      const rep = await sweepHarnessLeftovers(tx, { now: () => NOW, prefixes: [TP], log: () => undefined });
      const [r] = await tx`SELECT "isEnabled" FROM robots WHERE id = ${robot}`;
      return { robot, q1, q2, c1, rows, pending, rep, enabledAfter: r.isEnabled };
    });
    // the fixture really is "unacked + carried on, head acked"
    expect(out.q2).toBeGreaterThan(out.q1);
    expect(out.c1.ackedAt).toBeNull();
    expect(out.rows.map((x) => [Number(x.id), x.ackedAt === null, x.carriedToId === null ? null : Number(x.carriedToId), x.outcome])).toEqual([
      [out.q1, true, out.q2, null],
      [out.q2, false, null, "done"],
    ]);
    expect(out.pending).toEqual([]);
    expect(out.rep.keptPendingStop.map((x) => x.id)).not.toContain(out.robot);
    expect(out.rep.inert.map((x) => `${x.table}#${x.id}`)).toContain(`robots#${out.robot}`);
    expect(out.enabledAfter).toBe(false);
  });
});

describe("A2 test — sweep patterns / endpoint / prefix registry (no DB)", () => {
  it("patterns: own markers only (anchored), 13-digit ms, registered prefixes only", () => {
    const p = harnessPatterns(["F1X"])!;
    const m = (re: string, s: string) => new RegExp(re).test(s);
    expect(m(p.plc, "SPLC-F1X-1793541269940")).toBe(true);
    expect(m(p.plc, "SPLCB-F1X-1793541269940")).toBe(true);
    expect(m(p.plc, "SIM-SAFETY-PLC-1")).toBe(false);
    expect(m(p.plc, "SPLC-F1E-1793541269940")).toBe(false);
    expect(m(p.plc, "SPLC-F1X-179354126994")).toBe(false);
    expect(m(p.robot, "RA-F1X-1793541269940")).toBe(true);
    expect(m(p.robot, "RA-B10REP-1793404887556")).toBe(false);
    expect(m(p.robot, "xRA-F1X-1793541269940")).toBe(false);
    expect(m(p.user, "F1X-1793541269940-engineer")).toBe(true);
    expect(m(p.user, "F1X-1793541269940-guest")).toBe(false);
    expect(m(p.workflow, "F1X-1793541269940-run-a")).toBe(true);
    expect(m(p.workflow, "T3HITL-1793541269940-act-1")).toBe(false);
    expect(harnessPatterns(["bad prefix;--"])).toBeNull();
  });
  it("endpointHostPort: tcp://host:port only", () => {
    expect(endpointHostPort("tcp://127.0.0.1:50504")).toEqual({ host: "127.0.0.1", port: 50504 });
    expect(endpointHostPort("sim://x")).toBeNull();
    expect(endpointHostPort("tcp://127.0.0.1:0")).toBeNull();
    expect(endpointHostPort(null)).toBeNull();
    expect(endpointHostPort("tcp://[::1]:502")).toEqual({ host: "::1", port: 502 });
  });
  it("★ fix round 1 (R2): only loopback hosts are probed", () => {
    for (const h of ["127.0.0.1", "::1", "localhost", "LOCALHOST"]) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ["192.0.2.1", "10.0.0.5", "127.0.0.2", "plc.factory.local", "0.0.0.0", "::"]) expect(isLoopbackHost(h), h).toBe(false);
  });
  it("★ census: every setupCentral(prefix) of a test file is in HARNESS_PREFIXES, and every registered prefix is used", () => {
    const dir = path.resolve(__dirname);
    const used = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((x) => /\.test\.ts$/.test(x))) {
      for (const mm of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/setupCentral\(\s*"([^"]+)"/g)) used.add(mm[1]);
    }
    expect([...used].sort()).toEqual([...HARNESS_PREFIXES].sort());
  });
});
