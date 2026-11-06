/**
 * SCADA R1b-2b-2a A2(m2) (AN TOÀN, L-7) — a run the server stopped while it was COMPENSATING: the compensation in flight is never dropped
 * silently. Exactly ONE top-level compensation in flight ⇒ the run is HELD (compensationHeld: a Continue re-sends ONLY it) + URGENT; and when
 * it is a PINNED STOP that passes b1–b3 (inside D on the DB clock, central-owned, same owner epoch, no later command), the boot re-sends it
 * ONCE through the dispatcher (b4) + URGENT also on success (b5) + an audit row with the evidence. Two or more / nested ⇒ 'failed' + URGENT.
 *
 * Real product code on the `_test` DB (forced by vitest.setup): the FOE boot hook (rehydrateInterruptedRuns), the engine's compensation path
 * (runCompensation → execCommand → central store: ai_pending_actions), the OT facade (equipmentRegistry), the dispatcher (gate (1), idempotency,
 * reservation, command_log), the REAL S7 driver (nodes7) on `__s7commSim` — the sim's write PDUs are the independent oracle of "the device was
 * written". A second adapter's driver is an in-process counter (no socket).
 *
 * Two ways to reach "interrupted while compensating": (1) a REAL walk whose forward step fails at its device and whose STOP compensation dies in
 * the S7 driver after the reservation, before the PDU (Q1, Q6 — the A2(m) crash harness); (2) the same state written as rows (run
 * 'compensating', the step 'failed', its compensation 'running' — a crash right after the compensation's running row; Q2–Q5, Q7).
 *
 * Fix round 1 (review-a2m2-result.md + coordinator C-1..C-3): Q8 no intent row ⇒ held + URGENT; Q9 the boot waits for the adapter's session
 * (I-1); Q10 the deadline aborts the walk and late answers never rewrite the row (I-2); Q11 a claim error ⇒ held + URGENT (I-3); Q12 the REAL
 * durable alert dedup per interruption (I-4); Q13 a live attempt of another instance is never wiped (I-5a); Q14 a non-UTC session zone (m-1);
 * Q15 a renamed step ⇒ failed + URGENT (m-3); Q16 the re-check before the hand-over (m-5 / I-2); Q17 the b3 query's edges + the interlock gate (m-9).
 * Within one test transaction now() is fixed, so the time left of D is set by moving the intent row's createdAt (DB time).
 *
 * Every DB write is inside the test's own transaction, ROLLED BACK (getDb ⇒ that transaction; outside it getDb is a TRAP that counts and returns
 * null ⇒ nothing is ever committed). WORM tables (command_log, device_owner_changes via the owner trigger, audit_logs): rows inserted inside the
 * rolled-back transaction, never an explicit id. Never the owner role, no DELETE / TRUNCATE.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const H = vi.hoisted(() => ({
  tx: null as unknown,
  bay: 0,
  bayStack: [] as string[],
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  alerts: [] as Array<Record<string, unknown>>,
  thatAlert: false,
  /** called (once, then cleared) on the first driver lookup — the boot's connection wait is the first caller after the decision */
  khiLayDriver: null as null | ((adapterId: number) => void),
}));

vi.mock("../../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../db/connection")>();
  return {
    ...real,
    getDb: (async () => {
      if (H.tx) return H.tx;
      H.bay++; // outside the test's transaction: never touches the real DB (nothing is committed)
      H.bayStack.push(String(new Error("getDb outside the test transaction").stack).split("\n").slice(1, 9).join("\n"));
      return null;
    }) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});
vi.mock("../../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "A2M2-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});
vi.mock("../../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => {
      const f = H.khiLayDriver;
      if (f) {
        H.khiLayDriver = null;
        f(adapterId);
      }
      return H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>;
    },
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});
// the critical-stop alert is RECORDED (its durable dedup is that function's own, tested there) — never an inbox insert for the fixture's
// non-existent users inside the test transaction
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: Record<string, unknown>) => {
      H.alerts.push(a);
      // I-4 — the REAL alert (its durable dedup on the notifications table, inside the test transaction) when a case asks for it
      // (to the run owner only: the dedup is per recipient; every admin / supervisor of `_test` would outlast the transaction)
      if (H.thatAlert) await orig.raiseCriticalStopAlert({ ...(a as object), recipients: [990_915_201] } as never);
    },
  };
});

import * as conn from "../../../db/connection";
import { aiPendingActions, auditLogs, commandLog, orchestrationRunSteps, orchestrationRuns } from "../../../../drizzle/schema";
import { startS7commSim, type S7commSim } from "../../ot/drivers/__s7commSim";
import { S7Driver } from "../../ot/drivers/s7Driver";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";
import { _setPinReadProbeForTests } from "../../ot/stopPin";
import { makeFoeGateRun } from "./__foeGateRunFixture";
import { autoResumeInterruptedRuns, rehydrateInterruptedRuns, resumeRun } from "./foeEngine";
import { _setBuTruBiNgatProbeForTests, STOP_BU_TRU_KHOI_DONG_HAN_MS } from "./foeBuTruBiNgat";
import { __quenBoNhoKhuTrungChoTest } from "../../robot/criticalStopAlert";
import { interlockRules } from "../../../../drizzle/schema";
import type { WorkflowStep } from "./workflowModel";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2M2-${Date.now()}`;
const OWNER = 990_915_201;
const APPROVER = 990_915_202;
const KHAC = 990_915_203; // a person who continues the held run (Q6)
const AUDIT_OP = "foe_compensation_interrupted_boot";
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

let sim: S7commSim;
let s7: S7Driver;
const soPduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;

/**
 * The S7 adapter's driver: the REAL S7 driver, except that (a) with `treo` set the NEXT writeTags never answers and sends nothing (crash before
 * the PDU), (b) with `loiMotLan` set the NEXT write goes out under the sim's `writeError` fault (the PLC answers an error) and the fault is cleared
 * right after (a following write would succeed).
 */
const S7 = { treo: false, daTreo: null as null | (() => void), loiMotLan: false, treMs: 0 };
let s7Boc: unknown;
function bocS7(): unknown {
  return new Proxy(s7, {
    get(target, p, recv) {
      if (p === "writeTags") {
        return async (ws: never) => {
          if (S7.treo) {
            S7.treo = false;
            S7.daTreo?.();
            return new Promise<never>(() => undefined); // the process "dies" here: this walk never continues
          }
          if (S7.treMs > 0) {
            const ms = S7.treMs;
            S7.treMs = 0;
            await new Promise((r) => setTimeout(r, ms)); // the write lands LATE (I-2)
            return target.writeTags(ws);
          }
          if (S7.loiMotLan) {
            S7.loiMotLan = false;
            sim.setFault("writeError");
            try {
              return await target.writeTags(ws);
            } finally {
              sim.setFault(null);
            }
          }
          return target.writeTags(ws);
        };
      }
      const v = Reflect.get(target, p, recv) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
/** the second adapter's driver (the FORWARD step's machine): counts only (no socket); `hong` = how many of the next writes the device refuses */
const BT = { ghi: 0, hong: 0 };
const driverBuTru = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string }>) {
    BT.ghi++;
    if (BT.hong > 0) {
      BT.hong--;
      return writes.map((w) => ({ tagKey: w.tagKey, ok: false, error: "device refused (test)" }));
    }
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
};

/** Run `fn` in a transaction of the test, then ROLL BACK (nothing stays in `_test`). */
async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
        await new Promise((r) => setTimeout(r, 300)); // late background writes (run events …) still land in the transaction
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

const motId = async (tx: Tx, q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as unknown as Array<{ id: number | string }>)[0]!.id);

/**
 * Factory → … → machine M1 (S7 adapter on the sim: tag `a` PINNED (stopValue 0), tag `u` NOT pinned) + machine M2 (counting adapter, tag `c`) —
 * INSIDE the transaction. The S7 adapter's running connection matches its row (fingerprint) ⇒ a pinned STOP is pinned for the dispatcher too.
 */
async function dungThietBi(tx: Tx) {
  const t = Math.random().toString(36).slice(2, 8);
  const factory = await motId(tx, sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}-${t}`}, 'A2M2 factory', true) RETURNING id`);
  const workshop = await motId(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factory}, ${`W-${DAU}-${t}`}, 'A2M2 ws') RETURNING id`);
  const line = await motId(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshop}, ${`L-${DAU}-${t}`}, 'A2M2 line') RETURNING id`);
  const station = await motId(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`S-${DAU}-${t}`}, 'A2M2 st') RETURNING id`);
  const m1 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M1-${DAU}-${t}`}, 'A2M2 m1', 'AUTOMATION', true) RETURNING id`);
  const m2 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M2-${DAU}-${t}`}, 'A2M2 m2', 'AUTOMATION', true) RETURNING id`);
  const endpoint = `127.0.0.1:${sim.port}`;
  const a1 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A1-${DAU}-${t}`}, 'A2M2 s7', 's7', ${endpoint}, true, ${m1}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value) VALUES (${a1}, 'a', 'DB1,INT0', 'int', true, '0'::jsonb)`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a1}, 'u', 'DB1,INT2', 'int', true)`);
  const a2 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A2-${DAU}-${t}`}, 'A2M2 dem', 'stub', 'stub://a2m2', true, ${m2}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a2}, 'c', 'D100', 'int', true)`);
  H.drivers.set(a1, s7Boc);
  H.fingerprints.set(a1, adapterTargetFingerprint({ protocol: "s7", endpoint, machineId: m1, connectionOptions: null }));
  H.drivers.set(a2, driverBuTru);
  return { m1, m2, a1, a2 };
}

/** A REAL run (owner OWNER; gate g0 approved by APPROVER = a counting approval) whose definition is `steps` after g0. */
async function dungRun(steps: WorkflowStep[]) {
  return makeFoeGateRun({ tag: `${DAU}-${Math.random().toString(36).slice(2, 8)}`, owner: OWNER, approvedBy: APPROVER, steps });
}

// ── the compensations ──
const buStopGhim = (m1: number, id = "undo"): WorkflowStep => ({ id, type: "command", machineId: m1, command: "stop", args: { tagKey: "a", value: 0 } }) as WorkflowStep;
/** a CONTENT stop: an ordinary command type writing the pinned value (A2(h): never a pinned STOP) */
const buStopNoiDung = (m1: number): WorkflowStep => ({ id: "undo", type: "command", machineId: m1, command: "start", args: { tagKey: "a", value: 0 } }) as WorkflowStep;
/** a stop-typed command on a tag WITHOUT a pin (not a pinned STOP) */
const buStopKhongGhim = (m1: number): WorkflowStep => ({ id: "undo", type: "command", machineId: m1, command: "stop", args: { tagKey: "u", value: 0 } }) as WorkflowStep;
/** an ordinary (motion) compensation on the forward step's machine */
const buThuong = (m2: number): WorkflowStep => ({ id: "undo", type: "command", machineId: m2, command: "start", args: { tagKey: "c", value: 0 } }) as WorkflowStep;
/** the forward step (on M2, counting driver) with its compensation */
const buocChinh = (m2: number, comp: WorkflowStep, id = "main"): WorkflowStep => ({ id, type: "command", machineId: m2, command: "start", args: { tagKey: "c", value: 1 }, compensation: comp }) as WorkflowStep;

/** The interrupted state written as rows: run 'compensating', each [stepId, status] row (a crash right after the compensation's running row). */
async function ngatGiaLap(tx: Tx, runId: number, rows: Array<[string, string]>, ctxThem: Record<string, unknown> = {}) {
  await tx.update(orchestrationRuns).set({ status: "compensating", contextJson: { ...ctxThem } }).where(eq(orchestrationRuns.id, runId));
  for (const [stepId, status] of rows) {
    await tx.insert(orchestrationRunSteps).values({ runId, stepId, stepType: "command", status: status as never, attempt: 1, error: status === "failed" ? "device refused (test)" : null, startedAt: new Date() });
  }
}

/** Walk 1 (REAL): the forward step fails at its device ⇒ compensating ⇒ the STOP compensation dies in the S7 driver after its reservation. */
async function sapKhiDangBuTru(runId: number) {
  BT.hong = 1;
  const daToi = new Promise<void>((r) => (S7.daTreo = r));
  S7.treo = true;
  void (async () => {
    process.env.FOE_DURABLE = "false";
    await rehydrateInterruptedRuns(); // the fixture's 'running' run ⇒ held (interrupted)
    process.env.FOE_DURABLE = "true";
    await autoResumeInterruptedRuns([runId]);
  })();
  await Promise.race([daToi, new Promise((_, rej) => setTimeout(() => rej(new Error("crash point not reached in 60 s")), 60_000))]);
  S7.daTreo = null;
}

/**
 * "Process boot": the FOE boot hook (FOE_DURABLE off for the scan, so the leftover runs of `_test` are not walked) and then the durable
 * auto-resume of the test's run (FOE_DURABLE on) — which must NEVER continue a run held for an interrupted compensation.
 */
async function khoiDongLai(runId: number) {
  process.env.FOE_DURABLE = "false";
  const r = await rehydrateInterruptedRuns();
  process.env.FOE_DURABLE = "true";
  await autoResumeInterruptedRuns([runId]);
  return { r, mine: (r.compensations ?? []).filter((c) => c.runId === runId) };
}

const buoc = async (tx: Tx, runId: number, stepId: string) =>
  (await tx.select().from(orchestrationRunSteps).where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, stepId))).limit(1))[0];
const trangThaiRun = async (tx: Tx, runId: number) => (await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)))[0]!;
const hangUyQuyen = (tx: Tx, prefix: string) => tx.select().from(aiPendingActions).where(like(aiPendingActions.id, `${prefix}%`));
const canhBaoCua = (runId: number) => H.alerts.filter((a) => a.entityId === runId);
async function auditCua(tx: Tx, runId: number) {
  const rows = await tx.select().from(auditLogs).where(and(eq(auditLogs.entityType, "orchestration_run"), eq(auditLogs.entityId, runId)));
  return rows
    .map((r) => {
      const det = typeof r.details === "string" ? (JSON.parse(r.details) as Record<string, any>) : ((r.details ?? {}) as Record<string, any>);
      return { status: r.status, action: r.action, det };
    })
    .filter((x) => x.det?.operation === AUDIT_OP);
}
const dau = (run: { contextJson: unknown }) => ((run.contextJson ?? {}) as Record<string, any>).foeBuTruBiNgat as Record<string, any> | undefined;

/** The common assertions of "held, NOT re-sent, URGENT": 0 PDU since `pdu0`, nothing dispatched under the boot key, one held alert + audit. */
async function kiemGiuKhongGui(tx: Tx, runId: number, pdu0: number, lyDo: string, mine: Array<{ outcome: string; reason?: string }>) {
  expect(soPduGhi() - pdu0, lyDo).toBe(0);
  const run = await trangThaiRun(tx, runId);
  expect(run.status, lyDo).toBe("held"); // not 'failed': its compensation is still due
  const ctx = (run.contextJson ?? {}) as Record<string, any>;
  expect(ctx.foeResumeState?.main?.state, lyDo).toBe("compensationHeld");
  expect(dau(run)?.compId, lyDo).toBe("undo");
  expect(dau(run)?.daThuGuiLai, lyDo).toBeUndefined(); // nothing attempted
  expect(mine, lyDo).toEqual([{ runId, compId: "undo", outcome: "held", reason: lyDo }]);
  expect((await hangUyQuyen(tx, `foe-run${runId}-undo-a2`)).length, lyDo).toBe(0); // no dispatch at all under the boot key
  const a = canhBaoCua(runId).filter((x) => x.kind !== "foe_stop_compensation_pending_at_boot");
  expect(a.map((x) => x.kind), lyDo).toEqual(["foe_compensation_interrupted_held"]);
  expect(a[0]!.khuTrungBenVung, lyDo).toEqual({});
  expect(String(a[0]!.dedupKey), lyDo).toMatch(new RegExp(`^foe_compensation_interrupted_held:${runId}:undo:\\d+$`)); // I-4: + the interruption
  expect((a[0]!.recipients as number[]).includes(OWNER), lyDo).toBe(true);
  const au = await auditCua(tx, runId);
  expect(au.map((x) => [x.status, x.action, x.det.metadata?.outcome, x.det.metadata?.reason]), lyDo).toEqual([["failure", "foe_stop_compensation_boot", "held", lyDo]]);
}

/** Move the DB time of the intent: the compensation row was written `truocMs` before the DB's now() (within the transaction now() is fixed). */
async function yDinhTruoc(tx: Tx, runId: number, truocMs: number) {
  await tx.execute(sql`UPDATE orchestration_run_steps SET "createdAt" = now() - (${truocMs}::float8 * interval '1 millisecond') WHERE "runId" = ${runId} AND "stepId" = 'undo'`);
}
/** Leave `conMs` of the window D (DB clock). */
const conLaiCuaSo = (tx: Tx, runId: number, conMs: number) => yDinhTruoc(tx, runId, STOP_BU_TRU_KHOI_DONG_HAN_MS - conMs);
/** The adapter's session is not up yet (as on a real boot before startOt); `sauMs` later it comes up (the real fingerprint), or never. */
function ketNoiSau(a1: number, sauMs: number | null) {
  const mocSan: { daSan: boolean; pduLucSan: number | null } = { daSan: false, pduLucSan: null }; // the moment the fake session came up: how many STOP PDUs were already written
  const drv = H.drivers.get(a1);
  const fp = H.fingerprints.get(a1);
  H.drivers.delete(a1);
  H.fingerprints.delete(a1);
  if (sauMs !== null) {
    setTimeout(() => {
      H.drivers.set(a1, drv);
      H.fingerprints.set(a1, fp!);
      mocSan.daSan = true;
      mocSan.pduLucSan = soPduGhi();
    }, sauMs);
  }
  return mocSan;
}
const soThongBao = async (tx: Tx, runId: number, kind: string) =>
  Number(((await tx.execute(sql`SELECT count(*)::int AS n FROM notifications WHERE "userId" = ${OWNER} AND metadata->>'dedupKey' LIKE ${`${kind}:${runId}:%`}`)) as unknown as Array<{ n: number }>)[0]!.n);

const ENV_KEYS = ["FOE_ENABLED", "FOE_DURABLE", "OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED", "OT_CONTROL_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(m2) — a run interrupted while compensating: held + URGENT; a pinned STOP compensation re-sent ONCE at boot under b1–b4 (FOE + dispatcher + real DB, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // fuse: never on the dev DB
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("../../ot/adapterFacade");
    await import("../../ot/safetyTarget");
    await import("../../safety/plc/safetyPlcAdapter");
    sim = await startS7commSim();
    sim.setFault(null);
    s7 = new S7Driver();
    await s7.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1500 });
    s7Boc = bocS7();
  }, 60_000);

  afterAll(async () => {
    _setPinReadProbeForTests(null);
    _setBuTruBiNgatProbeForTests(null);
    vi.restoreAllMocks();
    H.drivers.clear();
    await s7?.disconnect().catch(() => undefined);
    await sim?.close().catch(() => undefined);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  beforeEach(() => {
    process.env.FOE_ENABLED = "true";
    process.env.FOE_DURABLE = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.AI_OT_CONTROL_ENABLED;
    delete process.env.PARAM_GUARDRAIL_ENABLED;
    delete process.env.INTERLOCK_AUTO_BLOCK_ENABLED;
    // a crashed walk (sapKhiDangBuTru) must STAY dead for the whole file: with a short write timeout the dispatcher would answer it "timeout"
    // and that walk would resume inside a LATER case. 600 s outlives this file; every case here is answered (or refused) long before.
    process.env.OT_CONTROL_TIMEOUT_MS = "600000";
    H.bay = 0;
    H.bayStack.length = 0;
    H.alerts.length = 0;
    BT.ghi = 0;
    BT.hong = 0;
    S7.treo = false;
    S7.loiMotLan = false;
    S7.treMs = 0;
    H.thatAlert = false;
    H.khiLayDriver = null;
    sim.setFault(null);
    _setPinReadProbeForTests(null);
    _setBuTruBiNgatProbeForTests(null);
    vi.restoreAllMocks();
  });

  it("★ Q1 — a REAL crash while sending a pinned STOP compensation (after its reservation, before the PDU) ⇒ boot ⇒ EXACTLY 1 STOP PDU (fresh key -a2, fresh row), run 'failed' as its step, URGENT 'resent', audit evidence", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      const pdu0 = soPduGhi();
      await sapKhiDangBuTru(runId); // walk 1: main fails ⇒ compensating ⇒ the STOP compensation dies before its PDU
      expect(soPduGhi() - pdu0).toBe(0);
      expect(BT.ghi).toBe(1);
      expect((await trangThaiRun(tx, runId)).status).toBe("compensating");
      expect((await buoc(tx, runId, "undo"))?.status).toBe("running");
      const lan1 = await hangUyQuyen(tx, `foe-run${runId}-undo-a1`);
      expect(lan1.map((r) => r.status)).toEqual(["executed"]); // its reservation spent the row

      H.alerts.length = 0;
      const pdu1 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu1).toBe(1); // ★ the STOP went out again, exactly once (main 25a9de749: 0 — the run is failed, nothing re-sent)
      expect(BT.ghi).toBe(1); // the forward step was NOT re-run
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("failed"); // as its step did — the compensation completed
      expect(run.error).toContain("RE-SENT ONCE at boot");
      expect(dau(run)).toMatchObject({ stepId: "main", compId: "undo", daThuGuiLai: true, ketQuaGuiLai: "sent" });
      expect(dau(run)?.dangGuiLai).toBeUndefined();
      expect((await buoc(tx, runId, "undo"))?.status).toBe("compensated");
      expect((await buoc(tx, runId, "main"))?.status).toBe("failed");
      // b4 — ONE attempt on a FRESH key (-a2) and a FRESH authorisation row; the spent row of walk 1 untouched
      const lan2 = await hangUyQuyen(tx, `foe-run${runId}-undo-a2`);
      expect(lan2).toHaveLength(1);
      expect(lan2[0]!.id.startsWith(`foe-run${runId}-undo-a2#stop-a2-`)).toBe(true);
      expect(lan2[0]!.status).toBe("executed");
      expect((await hangUyQuyen(tx, `foe-run${runId}-undo-a1`)).map((r) => [r.id, r.status])).toEqual(lan1.map((r) => [r.id, "executed"]));
      const ghi = await tx.select().from(commandLog).where(eq(commandLog.actionId, lan2[0]!.id));
      expect(ghi.some((r) => String(r.status).startsWith("acked"))).toBe(true); // the dispatcher's ledger (never a bypass)
      expect(ghi.every((r) => String(r.idempotencyKey ?? "").includes(`run${runId}-undo-a2`))).toBe(true);
      // b5 — URGENT also on success (deduped), and the audit row with the evidence of b1–b3
      const a = canhBaoCua(runId);
      expect(a.map((x) => x.kind)).toEqual(["foe_stop_compensation_resent_at_boot"]);
      expect(String(a[0]!.dedupKey)).toMatch(new RegExp(`^foe_stop_compensation_resent_at_boot:${runId}:undo:\\d+$`));
      expect(String(a[0]!.title)).toContain("STOP re-sent at boot — check the machine state on site"); // C-3 (c)
      expect(String(a[0]!.message)).toContain("STOP re-sent at boot — check the machine state on site");
      expect(String(a[0]!.message)).toMatch(/\[interruption of \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\]$/); // m-1 (fix round 2): an ISO time, not raw ms
      expect(a[0]!.khuTrungBenVung).toEqual({});
      expect((a[0]!.recipients as number[]).includes(OWNER)).toBe(true);
      const au = await auditCua(tx, runId);
      expect(au).toHaveLength(1);
      expect(au[0]!.status).toBe("success");
      expect(au[0]!.action).toBe("foe_stop_compensation_boot"); // m-8
      const md = au[0]!.det.metadata as Record<string, any>;
      expect(md).toMatchObject({ runId, stepId: "main", compId: "undo", outcome: "sent", reason: "allChecksPassed" });
      expect(md.evidence.b1).toMatchObject({ pinnedStop: true, loiDocGhim: null, commandType: "stop" });
      expect(md.evidence.b2.intentAt).toEqual(expect.any(String));
      expect(md.evidence.b2.hanMs).toBe(300_000);
      expect(md.evidence.b2.conLaiMs).toBeGreaterThan(0);
      expect(md.evidence.b3).toMatchObject({ adapterTonTai: true, edgeNodeId: null, doiChuSoHuu: 0, lenhSau: [] });
      expect(md.dispatch).toMatchObject({ outcome: "ok", row: "compensated", accepted: true });
      // the durable auto-resume (FOE_DURABLE) never walks it again; a second boot sends nothing (the run is terminal)
      const pdu2 = soPduGhi();
      await khoiDongLai(runId);
      expect(soPduGhi() - pdu2).toBe(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q2a — b1: a CONTENT stop compensation (ordinary type writing the pin) ⇒ held + URGENT, nothing dispatched", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopNoiDung(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "khongPhaiStopGhim", mine);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q2b — b1: a NON-STOP (motion) compensation ⇒ held + URGENT, nothing sent — the durable auto-resume does not walk it either", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      void m1;
      const { runId } = await dungRun([buocChinh(m2, buThuong(m2))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "khongPhaiStopGhim", mine);
      expect(BT.ghi).toBe(0); // the motion compensation was not re-sent by anything
      expect((await hangUyQuyen(tx, `foe-run${runId}-undo-a`)).length).toBe(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q2c — b1: a stop-typed compensation on a tag WITHOUT a pin ⇒ held + URGENT, nothing dispatched", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopKhongGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "khongPhaiStopGhim", mine);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q2d — TWO compensations in flight (both pinned STOPs) ⇒ never a guess: 'failed' + URGENT, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1, "undo1"), "main1"), buocChinh(m2, buStopGhim(m1, "undo2"), "main2")]);
      await ngatGiaLap(tx, runId, [["main1", "failed"], ["undo1", "running"], ["main2", "failed"], ["undo2", "running"]]);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("2 compensations (undo1, undo2) were in flight");
      expect(mine).toEqual([{ runId, compId: "undo1,undo2", outcome: "failed", reason: "several" }]);
      const a = canhBaoCua(runId);
      expect(a.map((x) => x.kind)).toEqual(["foe_compensation_interrupted_failed"]);
      expect(String(a[0]!.dedupKey)).toMatch(new RegExp(`^foe_compensation_interrupted_failed:${runId}:undo1,undo2:\\d+$`));
      expect((await hangUyQuyen(tx, `foe-run${runId}-undo`)).length).toBe(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q2e — ONE compensation in flight but of a NESTED step (inside a parallel) ⇒ 'failed' + URGENT, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([{ id: "par", type: "parallel", steps: [buocChinh(m2, buStopGhim(m1))] } as WorkflowStep]);
      await ngatGiaLap(tx, runId, [["par", "running"], ["main", "failed"], ["undo", "running"]]);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await trangThaiRun(tx, runId)).status).toBe("failed");
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "failed", reason: "nested" }]);
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_failed"]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q3a — b2: the STOP intent (DB clock) is older than D ⇒ held + URGENT, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      // move the DB time of the intent: the compensation row was written 6 minutes ago (D = 5 min)
      await tx.execute(sql`UPDATE orchestration_run_steps SET "createdAt" = now() - interval '6 minutes' WHERE "runId" = ${runId} AND "stepId" = 'undo'`);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "quaHan", mine);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.evidence.b2.tuoiMs).toBeGreaterThanOrEqual(360_000);
      expect(md.evidence.b2.conLaiMs).toBeLessThanOrEqual(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q3b — b2: the DB clock decides, never the process clock: a fresh intent while the PROCESS clock runs 2 h ahead ⇒ still sent (1 PDU)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const pdu0 = soPduGhi();
      const that = Date.now.bind(Date);
      const spy = vi.spyOn(Date, "now").mockImplementation(() => that() + 2 * 3_600_000);
      let mine: Awaited<ReturnType<typeof khoiDongLai>>["mine"];
      try {
        ({ mine } = await khoiDongLai(runId));
      } finally {
        spy.mockRestore();
      }
      expect(soPduGhi() - pdu0).toBe(1);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      expect((await trangThaiRun(tx, runId)).status).toBe("failed");
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_stop_compensation_resent_at_boot"]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q3c — b2: never beyond the ORIGINAL STOP's own deadline: its authorisation row already expired (intent still inside D) ⇒ held + URGENT, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      // the original STOP's authorisation row (what the crashed dispatch minted), its deadline already passed on the DB clock
      const id = `foe-run${runId}-undo-a1#stop-a1-${Math.random().toString(16).slice(2, 10)}`;
      await tx.execute(sql`INSERT INTO ai_pending_actions (id, tool, "argsJson", "userId", "userRole", summary, status, "idempotencyKey", "expiresAt")
                           VALUES (${id}, 'foe.engine', '{}'::json, ${APPROVER}, 'foe_gate_approver', 'FOE orchestration: step undo', 'executed', ${id}, now() - interval '1 second')`);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "quaHan", mine);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.evidence.b2.authExpiresAt).toEqual(expect.any(String));
      expect(md.evidence.b2.tuoiMs).toBeLessThan(300_000);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q4a — b3: the device is owned by an EDGE node now ⇒ held + URGENT, nothing dispatched", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const node = await motId(tx, sql`INSERT INTO edge_nodes (code, name) VALUES (${`E-${DAU}-${Math.random().toString(36).slice(2, 8)}`}, 'A2M2 edge') RETURNING id`);
      await tx.execute(sql`UPDATE device_adapters SET "edgeNodeId" = ${node} WHERE id = ${a1}`);
      // that ownership change is OLDER than the run (only "edge-owned NOW" is under test here)
      await tx.execute(sql`UPDATE orchestration_runs SET "createdAt" = now() + interval '1 second' WHERE id = ${runId}`);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "thietBiThuocEdge", mine);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.evidence.b3).toMatchObject({ edgeNodeId: node, doiChuSoHuu: 0, lenhSau: [] });
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q4b — b3: the device's owner epoch CHANGED since the run (to an edge and back: central-owned now) ⇒ held + URGENT, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const node = await motId(tx, sql`INSERT INTO edge_nodes (code, name) VALUES (${`E-${DAU}-${Math.random().toString(36).slice(2, 8)}`}, 'A2M2 edge') RETURNING id`);
      await tx.execute(sql`UPDATE device_adapters SET "edgeNodeId" = ${node} WHERE id = ${a1}`);
      await tx.execute(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${a1}`);
      const [ep] = (await tx.execute(sql`SELECT "ownerEpoch" FROM device_adapters WHERE id = ${a1}`)) as unknown as Array<{ ownerEpoch: number | string }>;
      expect(Number(ep!.ownerEpoch)).toBe(3); // the trigger bumped it twice
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "chuSoHuuDaDoi", mine);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.evidence.b3).toMatchObject({ edgeNodeId: null, doiChuSoHuu: 2 });
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q4c — b3: ANOTHER command reached that device after the interruption (command_log) ⇒ held + URGENT, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      // someone else acted on the device (an operator's write through the dispatcher — its ledger row; no explicit id)
      await tx.execute(sql`INSERT INTO command_log ("adapterId", "machineId", "tagKey", "commandType", "requestedBy", "confirmedBy", status) VALUES (${a1}, ${m1}, 'a', 'start', ${KHAC}, ${KHAC}, 'acked')`);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "coLenhSau", mine);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.evidence.b3.lenhSau).toHaveLength(1);
      expect(md.evidence.b3.lenhSau[0]).toMatchObject({ status: "acked", actionId: null });
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q4d — b3: a lookup ERROR of the checks ⇒ fail-closed: held + URGENT, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      _setBuTruBiNgatProbeForTests((stage) => {
        if (stage === "b3") throw new Error("command_log unreadable (test)");
      });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "loiTraCuu", mine);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.lookupError).toContain("command_log unreadable (test)");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q5a — b4: OT control OFF ⇒ the dispatcher writes nothing (simulated) ⇒ 0 PDU, the compensation row back to 'held', run held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      process.env.OT_CONTROL_ENABLED = "false";
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "moPhong" }]);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("held");
      expect(dau(run)).toMatchObject({ daThuGuiLai: true, ketQuaGuiLai: "moPhong" }); // attempted once ⇒ never again at boot
      expect(dau(run)?.dangGuiLai).toBeUndefined();
      expect(((run.contextJson ?? {}) as Record<string, any>).foeResumeState?.main?.state).toBe("compensationHeld");
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held"); // still DUE (never left 'compensated' by a dry run)
      const lan = await hangUyQuyen(tx, `foe-run${runId}-undo-a2`);
      expect(lan).toHaveLength(1); // it went to the dispatcher (no shortcut) …
      const ghi = await tx.select().from(commandLog).where(eq(commandLog.actionId, lan[0]!.id));
      expect(ghi.map((r) => r.status)).toEqual(["simulated"]); // … which simulated it
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      expect((await auditCua(tx, runId)).map((x) => [x.status, x.det.metadata?.reason])).toEqual([["failure", "moPhong"]]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q5b — b4: a dispatcher GATE refuses (the pins change after the engine minted its fresh row: the dispatcher no longer counts it a pinned STOP) ⇒ 0 PDU, ONE refused attempt, held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      let doi = false;
      _setPinReadProbeForTests(async (adapterId) => {
        if (doi || adapterId !== a1) return;
        const moi = (await tx.execute(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id LIKE ${`foe-run${runId}-undo-a2#stop-%`}`)) as unknown as Array<{ n: number }>;
        if (moi[0]!.n > 0) {
          doi = true; // the engine read the pins and minted its fresh row; the pins change before the dispatcher reads them
          await tx.execute(sql`UPDATE device_tags SET stop_value = NULL WHERE "adapterId" = ${a1} AND "tagKey" = 'a'`);
        }
      });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(doi).toBe(true);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "guiLoi" }]);
      expect((await trangThaiRun(tx, runId)).status).toBe("held");
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held");
      const lan = await hangUyQuyen(tx, `foe-run${runId}-undo-a`);
      expect(lan).toHaveLength(1); // exactly ONE attempt (one fresh row)
      const ghi = await tx.select().from(commandLog).where(eq(commandLog.actionId, lan[0]!.id));
      expect(ghi.map((r) => r.status)).toEqual(["rejected"]);
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      // m-2 (fix round 3) — refused by the dispatcher: "not sent", never "may have gone out"
      const al = canhBaoCua(runId)[0]!;
      expect(String(al.title)).toContain("(refused by the dispatcher — not sent)");
      expect(String(al.title) + String(al.message)).not.toContain("MAY HAVE GONE OUT");
      const run = await trangThaiRun(tx, runId);
      expect(run.error).toContain("was refused by the dispatcher — not sent");
      expect(run.error).not.toContain("MAY HAVE GONE OUT");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q5c — b4: the send FAILS at the device ⇒ exactly ONE attempt (1 PDU, no retry), held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      S7.loiMotLan = true; // the PLC answers an error to the next write (a retry would succeed)
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(1); // the refused write — and NO second attempt
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "guiLoi" }]);
      expect((await trangThaiRun(tx, runId)).status).toBe("held");
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held");
      expect(await hangUyQuyen(tx, `foe-run${runId}-undo-a`)).toHaveLength(1);
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      expect(String(canhBaoCua(runId)[0]!.title)).toContain("MAY HAVE GONE OUT"); // m-2: handed over, the device answered — not "refused"
      // and the next boot never tries again (once)
      const pdu1 = soPduGhi();
      await tx.update(orchestrationRuns).set({ status: "compensating" }).where(eq(orchestrationRuns.id, runId)); // as if it crashed again
      const lan2 = await khoiDongLai(runId);
      expect(soPduGhi() - pdu1).toBe(0);
      expect(lan2.mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "daGuiLaiMotLan" }]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q6 — a person's Continue of the held run re-sends ONLY the compensation (fresh row, 1 PDU); the forward step is never re-run", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await sapKhiDangBuTru(runId); // REAL crash during the STOP compensation (after its reservation)
      expect(BT.ghi).toBe(1);
      await tx.execute(sql`UPDATE orchestration_run_steps SET "createdAt" = now() - interval '10 minutes' WHERE "runId" = ${runId} AND "stepId" = 'undo'`); // past D ⇒ held
      const { mine } = await khoiDongLai(runId);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "quaHan" }]);
      expect((await trangThaiRun(tx, runId)).status).toBe("held");
      const lan1 = await hangUyQuyen(tx, `foe-run${runId}-undo-a`);
      expect(lan1.map((r) => r.status)).toEqual(["executed"]);

      const pdu1 = soPduGhi();
      const res = await resumeRun(runId, { approved: true, note: "A2(m2) Q6" }, { id: KHAC, role: "admin", name: "other" }, {}, { scope: null });
      expect(soPduGhi() - pdu1).toBe(1); // ★ only the STOP compensation went out
      expect(BT.ghi).toBe(1); // the forward step was NOT re-run
      expect(res.status).toBe("failed"); // the run still ends failed (its step failed)
      expect((await buoc(tx, runId, "undo"))?.status).toBe("compensated");
      const lan2 = await hangUyQuyen(tx, `foe-run${runId}-undo-a`);
      expect(lan2).toHaveLength(2); // a FRESH row for the Continue's dispatch …
      expect(lan2.find((r) => r.id === lan1[0]!.id)?.status).toBe("executed"); // … the spent one untouched
      expect(lan2.every((r) => r.status === "executed" && r.id.startsWith(`foe-run${runId}-undo-a1#stop-a1-`))).toBe(true);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q7 — ONCE: a run whose boot re-send was already attempted (the write-ahead marker — e.g. a crash during it) ⇒ never sent again, held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]], { foeBuTruBiNgat: { stepId: "main", compId: "undo", at: new Date().toISOString(), daThuGuiLai: true, dangGuiLai: "dead-attempt" } });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "luotTruocDungGiua" }]); // fix round 2: its attempt never wrote an outcome
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("held");
      expect(dau(run)).toMatchObject({ daThuGuiLai: true, ketQuaGuiLai: "luotTruocDungGiua" });
      expect(dau(run)?.dangGuiLai).toBeUndefined();
      expect(await hangUyQuyen(tx, `foe-run${runId}-undo-a2`)).toHaveLength(0);
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      // the DECISION stopped it (the once check), not the claim's compare-and-set further on: no wait, no re-check, no claim attempted
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.claimLost).toBeUndefined();
      expect(md.recheck).toBeUndefined();
      expect(md.staleAttempt).toBe("dead-attempt");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  // ═══════════════════════════════════════ fix round 1 (review review-a2m2-result.md + coordinator C-1..C-3) ═══════════════════════════════════════

  it("★ Q8 (C-2) — the compensation row was never written (crash before it): no intent time ⇒ held + URGENT, never silent, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"]]); // no "undo" row at all
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "khongCoThoiDiemYDinh", mine);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q9a (I-1) — on boot the adapter's session is NOT up yet (OT drivers start after rehydrate); it comes up 2 s later ⇒ the boot waits, then EXACTLY 1 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const moc = ketNoiSau(a1, 2000);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(moc.daSan).toBe(true); // the boot returned only after the session came up
      expect(moc.pduLucSan! - pdu0, "no STOP PDU before the session was ready").toBe(0);
      expect(soPduGhi() - pdu0).toBe(1);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      const al = canhBaoCua(runId);
      expect(al.map((x) => x.kind)).toEqual(["foe_stop_compensation_pending_at_boot", "foe_stop_compensation_resent_at_boot"]); // m-2: ONE early URGENT while it waits
      expect(String(al[0]!.title)).toContain("STOP compensation pending at boot — waiting for the device connection");
      expect(String(al[0]!.dedupKey)).toMatch(new RegExp(`^foe_stop_compensation_pending_at_boot:${runId}:undo:\\d+$`));
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.waitedMs).toBeGreaterThan(0); // it waited (load-independent: the ordering vs the ready moment is asserted above)
      expect(md.recheck.cuaSo.conLaiMs).toBeGreaterThan(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q9b (I-1) — the adapter's session never comes up within what is left of D ⇒ 0 PDU, held + URGENT, the single try NOT consumed", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await conLaiCuaSo(tx, runId, 2000); // 2 s of D left (DB clock)
      ketNoiSau(a1, null);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "ketNoiChuaSan", mine); // incl. daThuGuiLai unset, no -a2 row
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_stop_compensation_pending_at_boot", "foe_compensation_interrupted_held"]); // m-2: early, then the outcome
      expect(((await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>).waitedMs).toBeGreaterThan(0); // the audit metadata carries no window-end field, only waitedMs; wall-clock ms are load-dependent
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q10a (I-2) — the dispatch hangs past the window: the run is held + URGENT at the deadline, and the LATE answer never rewrites the compensation row ('held' stays)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await conLaiCuaSo(tx, runId, 3000);
      S7.treMs = 5000; // handed over, the device answers after 5 s
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "khongXacNhan" }]);
      expect((await trangThaiRun(tx, runId)).status).toBe("held");
      await new Promise((r) => setTimeout(r, 4500)); // the late answer lands
      expect(soPduGhi() - pdu0).toBe(1); // it was handed over before the deadline (the dispatcher's own bound applies)
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held"); // ★ never 'compensated' after the run was held
      expect((await trangThaiRun(tx, runId)).status).toBe("held");
      expect(dau(await trangThaiRun(tx, runId))?.dangGuiLai).toBeUndefined();
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      // m-3 (fix round 2) — it WAS handed to the device: the texts say it may have gone out, never "did NOT go out"
      const al = canhBaoCua(runId)[0]!;
      expect(String(al.title)).toContain("MAY HAVE GONE OUT");
      expect(String(al.message)).not.toContain("NOT re-sent");
      const run = await trangThaiRun(tx, runId);
      expect(run.error).toContain("MAY HAVE GONE OUT");
      expect(run.error).not.toContain("did NOT go out");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q10b (I-2) — the window closes BEFORE the hand-over (the engine's authorisation is slow): the walk is ABORTED ⇒ 0 PDU, held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await conLaiCuaSo(tx, runId, 800);
      let cham = false;
      _setPinReadProbeForTests(async (adapterId) => {
        if (cham || adapterId !== a1) return;
        const r = (await tx.execute(sql`SELECT "contextJson"->'foeBuTruBiNgat'->>'dangGuiLai' AS n FROM orchestration_runs WHERE id = ${runId}`)) as unknown as Array<{ n: string | null }>;
        if (r[0]?.n) {
          cham = true; // the attempt was claimed: its central-store pin read is slow (inside the read's own 1 s bound), past the 800 ms left —
          // so the deadline fires before the hand-over whether the abort lands before this read or during it
          await new Promise((res) => setTimeout(res, 900));
        }
      });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await new Promise((r) => setTimeout(r, 1500)); // the aborted walk finishes
      expect(soPduGhi() - pdu0).toBe(0); // ★ never handed over after the deadline
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "khongXacNhan" }]);
      expect((await trangThaiRun(tx, runId)).status).toBe("held");
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q11 (I-3) — the claim UPDATE throws ⇒ held + URGENT + audit (never 'claimed elsewhere' silence), 0 PDU, the try not consumed", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      _setBuTruBiNgatProbeForTests((stage) => {
        if (stage === "claim") throw new Error("statement timeout (test)");
      });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "loiGhiNhan", mine);
      expect(((await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>).claimError).toContain("statement timeout (test)");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q11b (fix round 2, C-1) — the claim COMMITTED but its reply was lost: re-read, it is ours ⇒ the attempt goes on (1 PDU, URGENT 'resent'), never silent", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      _setBuTruBiNgatProbeForTests((stage) => {
        if (stage === "claimSau") throw new Error("connection reset after commit (test)");
      });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(1);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_stop_compensation_resent_at_boot"]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q10c (fix round 2, I-1) — the deadline fires while the attempt is still BEFORE its run context (slow walk start): aborted ⇒ 0 PDU, held + URGENT 'did NOT go out' (true)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await conLaiCuaSo(tx, runId, 800);
      _setBuTruBiNgatProbeForTests(async (stage) => {
        if (stage === "truocDiBo") await new Promise((r) => setTimeout(r, 1200)); // after the run read, before the run context — past the 800 ms left
      });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await new Promise((r) => setTimeout(r, 2500)); // the late walk would have sent by now
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "khongXacNhan" }]);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("held");
      expect(run.error).toContain("did NOT go out"); // m-3: nothing was handed over — the text is true
      expect(await hangUyQuyen(tx, `foe-run${runId}-undo-a2`)).toHaveLength(0);
      const al = canhBaoCua(runId);
      expect(String(al[0]!.title)).toContain("NOT re-sent");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q12 (I-4) — the REAL durable dedup: the same interruption seen by two boots ⇒ ONE URGENT; a second interruption of the same run ⇒ a second URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      H.thatAlert = true;
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await yDinhTruoc(tx, runId, 6 * 60_000); // past D ⇒ held at every boot
      const [u0] = (await tx.execute(sql`SELECT "updatedAt"::text AS u FROM orchestration_runs WHERE id = ${runId}`)) as unknown as Array<{ u: string }>;
      __quenBoNhoKhuTrungChoTest();
      await khoiDongLai(runId); // boot 1
      expect(await soThongBao(tx, runId, "foe_compensation_interrupted_held")).toBe(1);
      // the SAME interruption seen again (boot 1's held write lost, its alert delivered): the run row as the crash left it
      await tx.execute(sql`UPDATE orchestration_runs SET status = 'compensating', "updatedAt" = ${u0!.u}::timestamp WHERE id = ${runId}`);
      __quenBoNhoKhuTrungChoTest(); // a restart: only the durable dedup remains
      await khoiDongLai(runId); // boot 2
      expect(await soThongBao(tx, runId, "foe_compensation_interrupted_held")).toBe(1); // ★ no second row
      // a SECOND interruption: a person's Continue walks the compensation again and the process dies again during it
      const daToi = new Promise<void>((r) => (S7.daTreo = r));
      S7.treo = true;
      void resumeRun(runId, { approved: true, note: "A2(m2) Q12" }, { id: KHAC, role: "admin", name: "other" }, {}, { scope: null });
      await Promise.race([daToi, new Promise((_, rej) => setTimeout(() => rej(new Error("crash point not reached")), 60_000))]);
      S7.daTreo = null;
      expect((await trangThaiRun(tx, runId)).status).toBe("compensating");
      __quenBoNhoKhuTrungChoTest();
      await khoiDongLai(runId); // boot 3
      expect(await soThongBao(tx, runId, "foe_compensation_interrupted_held")).toBe(2); // ★ the new interruption alerts again
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q13 (fix round 2, C-1) — a LIVE-looking lease of ANOTHER boot (a previous boot claimed, then stopped): never silent ⇒ held + URGENT + audit 'a previous boot claimed …', 0 PDU, no second send", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      const [n] = (await tx.execute(sql`SELECT FLOOR(EXTRACT(EPOCH FROM now()) * 1000)::bigint AS ms`)) as unknown as Array<{ ms: string | number }>;
      const dauCu = { stepId: "main", compId: "undo", at: new Date().toISOString(), daThuGuiLai: true, dangGuiLai: "boot1-attempt", bootLuot: "previous-boot", hanLuotGuiMs: Number(n!.ms) + 60_000 };
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]], { foeBuTruBiNgat: dauCu });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "luotTruocDungGiua" }]);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("held"); // never stuck 'compensating'
      expect(dau(run)).toMatchObject({ daThuGuiLai: true, ketQuaGuiLai: "luotTruocDungGiua" }); // the try stays spent
      expect(dau(run)?.dangGuiLai).toBeUndefined();
      expect(await hangUyQuyen(tx, `foe-run${runId}-undo-a2`)).toHaveLength(0); // no second send
      const al = canhBaoCua(runId);
      expect(al.map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      expect(String(al[0]!.message)).toContain("a previous boot claimed the STOP re-send and then stopped: the STOP may or may not have reached the device — check the machine on site");
      const au = await auditCua(tx, runId);
      expect(au.map((x) => [x.det.metadata?.outcome, x.det.metadata?.reason, x.det.metadata?.staleAttempt])).toEqual([["held", "luotTruocDungGiua", "boot1-attempt"]]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q13b (fix round 2, C-1) — a lease of a walker LIVE IN THIS PROCESS: a second scan leaves it to that walker (silent); the walker then reports (one URGENT)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      S7.treMs = 2500; // the first boot's STOP is in flight while the second scan runs
      const p1 = khoiDongLai(runId);
      let dang: string | null = null;
      for (let i = 0; i < 100 && !dang; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const [x] = (await tx.execute(sql`SELECT "contextJson"->'foeBuTruBiNgat'->>'dangGuiLai' AS n FROM orchestration_runs WHERE id = ${runId}`)) as unknown as Array<{ n: string | null }>;
        dang = x?.n ?? null;
      }
      expect(dang).not.toBeNull(); // the first attempt claimed
      const r2 = await rehydrateInterruptedRuns(); // a second scan in the same process
      expect((r2.compensations ?? []).filter((c) => c.runId === runId)).toEqual([{ runId, compId: "undo", outcome: "held", reason: "notOurs" }]);
      const { mine } = await p1;
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_stop_compensation_resent_at_boot"]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q18a (fix round 3, I-1) — a previous boot claimed, its attempt wrote the compensation row 'failed' and the process died before the outcome write: never the silent 'nothing in flight' ⇒ held + URGENT + audit, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      const dauCu = { stepId: "main", compId: "undo", at: new Date().toISOString(), daThuGuiLai: true, dangGuiLai: "boot1-attempt", bootLuot: "previous-boot", hanLuotGuiMs: 1 };
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "failed"]], { foeBuTruBiNgat: dauCu });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "luotTruocKhongXong" }]);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("held"); // not failed silently
      expect(run.error).toContain("a previous boot's STOP re-send did not complete — the STOP may not have reached the device — check on site");
      expect(dau(run)).toMatchObject({ daThuGuiLai: true, ketQuaGuiLai: "luotTruocKhongXong" });
      expect(await hangUyQuyen(tx, `foe-run${runId}-undo-a2`)).toHaveLength(0); // no second send
      const al = canhBaoCua(runId);
      expect(al.map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      expect(String(al[0]!.title)).toContain("A previous boot's STOP re-send did not complete");
      expect(String(al[0]!.message)).toContain("a previous boot's STOP re-send did not complete — the STOP may not have reached the device — check on site");
      const au = await auditCua(tx, runId);
      expect(au.map((x) => [x.det.metadata?.reason, x.det.metadata?.staleAttempt, x.det.metadata?.decisionReason])).toEqual([["luotTruocKhongXong", "boot1-attempt", "daGuiLaiMotLan"]]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q18b (fix round 3, I-1) — same, but the attempt wrote 'compensated' (the STOP went out, the outcome was never recorded): held + URGENT 'the STOP was re-sent at a previous boot … check the machine on site' (b5 kept), 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      const dauCu = { stepId: "main", compId: "undo", at: new Date().toISOString(), daThuGuiLai: true, dangGuiLai: "boot1-attempt", bootLuot: "previous-boot", hanLuotGuiMs: 1 };
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "compensated"]], { foeBuTruBiNgat: dauCu });
      await tx.execute(sql`UPDATE orchestration_run_steps SET "resultJson" = '{"routedTo":"ot","status":"acked","accepted":true}'::jsonb WHERE "runId" = ${runId} AND "stepId" = 'undo'`);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "luotTruocDaGui" }]);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("held");
      expect(run.error).toContain("the STOP was re-sent at a previous boot (the outcome was not recorded) — check the machine on site");
      expect(await hangUyQuyen(tx, `foe-run${runId}-undo-a2`)).toHaveLength(0);
      const al = canhBaoCua(runId);
      expect(al.map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      expect(String(al[0]!.title)).toContain("STOP re-sent at a previous boot (outcome not recorded)");
      expect(String(al[0]!.message)).toContain("the STOP was re-sent at a previous boot (the outcome was not recorded) — check the machine on site");
      expect((await auditCua(tx, runId)).map((x) => x.det.metadata?.reason)).toEqual(["luotTruocDaGui"]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q18c (polish m-1) — the previous boot's 'compensated' row came from a SIMULATED (dry-run) dispatch: never 'the STOP was re-sent' ⇒ 'may not have reached the device — check on site', held + URGENT, 0 PDU", async () => {
    for (const [ten, ketQua] of [
      ["simulated", '{"routedTo":"ot","status":"simulated","accepted":true,"simulated":true}'],
      ["not accepted", '{"routedTo":"ot","status":"failed","accepted":false}'],
    ] as const) {
      await trongGiaoDich(async (tx) => {
        const { m1, m2 } = await dungThietBi(tx);
        const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
        const dauCu = { stepId: "main", compId: "undo", at: new Date().toISOString(), daThuGuiLai: true, dangGuiLai: "boot1-attempt", bootLuot: "previous-boot", hanLuotGuiMs: 1 };
        await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "compensated"]], { foeBuTruBiNgat: dauCu });
        await tx.execute(sql`UPDATE orchestration_run_steps SET "resultJson" = ${ketQua}::jsonb WHERE "runId" = ${runId} AND "stepId" = 'undo'`);
        const pdu0 = soPduGhi();
        const { mine } = await khoiDongLai(runId);
        expect(soPduGhi() - pdu0, ten).toBe(0);
        expect(mine, ten).toEqual([{ runId, compId: "undo", outcome: "held", reason: "luotTruocKhongXong" }]);
        const run = await trangThaiRun(tx, runId);
        expect(run.status, ten).toBe("held");
        expect(run.error, ten).toContain("the STOP may not have reached the device — check on site");
        expect(run.error, ten).not.toContain("the STOP was re-sent");
        const al = canhBaoCua(runId);
        expect(String(al[0]!.title), ten).not.toContain("STOP re-sent at a previous boot");
        expect(String(al[0]!.message), ten).toContain("may not have reached the device — check on site");
      });
    }
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q20 (polish m-3) — a claim marker that does not name its step / compensation: never held under a placeholder (a Continue would re-walk the failed step) ⇒ failed + URGENT + audit, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      const dauThieu = { at: new Date().toISOString(), daThuGuiLai: true, dangGuiLai: "boot1-attempt", bootLuot: "previous-boot" };
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "compensated"]], { foeBuTruBiNgat: dauThieu });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: null, outcome: "failed", reason: "markerIncomplete" }]);
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("failed");
      expect(run.error).toContain("its record does not name the step / compensation");
      expect(((run.contextJson ?? {}) as Record<string, any>).foeResumeState?.["?"]).toBeUndefined();
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_failed"]);
      expect((await auditCua(tx, runId)).map((x) => [x.det.metadata?.outcome, x.det.metadata?.reason, x.det.metadata?.staleAttempt])).toEqual([["failed", "markerIncomplete", "boot1-attempt"]]);
      expect(await hangUyQuyen(tx, `foe-run${runId}-`)).toHaveLength(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q19 (fix round 3, m-1) — a previous boot claimed and boot 2's lookups FAIL: the texts still say what is known ('may or may not have reached the device'), title and message agree", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      const dauCu = { stepId: "main", compId: "undo", at: new Date().toISOString(), daThuGuiLai: true, dangGuiLai: "boot1-attempt", bootLuot: "previous-boot", hanLuotGuiMs: 1 };
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]], { foeBuTruBiNgat: dauCu });
      _setBuTruBiNgatProbeForTests((stage) => {
        if (stage === "b1") throw new Error("lookup failed (test)");
      });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "luotTruocDungGiua" }]); // not "loiTraCuu"
      const al = canhBaoCua(runId)[0]!;
      expect(String(al.message)).toContain("the STOP may or may not have reached the device");
      expect(String(al.title)).toContain("MAY OR MAY NOT have reached the device");
      expect(String(al.title)).not.toContain("NOT re-sent");
      const run = await trangThaiRun(tx, runId);
      expect(run.error).toContain("may or may not have reached the device");
      expect(run.error).not.toContain("NOT re-sent at boot");
      expect((await auditCua(tx, runId)).map((x) => [x.det.metadata?.reason, x.det.metadata?.decisionReason])).toEqual([["luotTruocDungGiua", "loiTraCuu"]]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  // ═══════════════════════════════════════ kiem-dinh test round (mutation review @ b551ab751) — TEST-ONLY ═══════════════════════════════════════

  it("★ KD-e1 — ONE try: a second contender claims while this boot waits for the connection ⇒ this boot's claim CAS loses (claimed = false) ⇒ 0 PDU, held + URGENT + audit (never silent)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      ketNoiSau(a1, 1500);
      // while this boot waits (after its decision, before its claim) another contender writes ITS claim on the run
      H.khiLayDriver = () => {
        void (async () =>
          await tx.execute(
            sql`UPDATE orchestration_runs SET "contextJson" = jsonb_set("contextJson", '{foeBuTruBiNgat}', '{"stepId":"main","compId":"undo","daThuGuiLai":true,"dangGuiLai":"contender","bootLuot":"other-instance"}'::jsonb) WHERE id = ${runId}`,
          ))();
      };
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0); // ★ never a second STOP
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "held", reason: "luotTruocDungGiua" }]);
      expect(await hangUyQuyen(tx, `foe-run${runId}-undo-a2`)).toHaveLength(0); // this boot never dispatched
      const run = await trangThaiRun(tx, runId);
      expect(run.status).toBe("held");
      expect(canhBaoCua(runId).filter((x) => x.kind !== "foe_stop_compensation_pending_at_boot").map((x) => x.kind)).toEqual(["foe_compensation_interrupted_held"]);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md).toMatchObject({ claimLost: true, staleAttempt: "contender", decisionReason: "daGuiLaiMotLan" });
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ KD-e2 — the boot re-send acts as the SYSTEM (id 0, role system), never a person / admin: its fresh authorisation row and the dispatcher's ledger say so", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      // the gate g0 passed by the owner: no counting approval ⇒ the fresh row is self-confirmed by the walking subject
      const { runId } = await makeFoeGateRun({ tag: `${DAU}-${Math.random().toString(36).slice(2, 8)}`, owner: OWNER, approvedBy: OWNER, steps: [buocChinh(m2, buStopGhim(m1))] });
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(1);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      const lan = await hangUyQuyen(tx, `foe-run${runId}-undo-a2`);
      expect(lan.map((r) => [r.userId, r.userRole])).toEqual([[0, "system"]]);
      const ghi = await tx.select().from(commandLog).where(eq(commandLog.actionId, lan[0]!.id));
      expect(ghi.length).toBeGreaterThan(0);
      expect(ghi.every((r) => r.requestedBy === 0 && r.confirmedBy === 0)).toBe(true);
      const au = await auditCua(tx, runId);
      expect(au.map((x) => x.det.metadata?.outcome)).toEqual(["sent"]);
      const [auRow] = await tx.select().from(auditLogs).where(and(eq(auditLogs.entityType, "orchestration_run"), eq(auditLogs.entityId, runId)));
      expect(auRow!.userId).toBe(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ KD-w3 — a driver exists but its running connection does NOT match the adapter row (stale fingerprint) ⇒ never ready within D ⇒ held + URGENT, the single try NOT taken (no claim, no dispatch)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await conLaiCuaSo(tx, runId, 2000);
      H.fingerprints.set(a1, "stale-connection (test)"); // the driver is there (H.drivers), but talks to another target
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "ketNoiChuaSan", mine); // incl. daThuGuiLai unset, no -a2 row
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ KD-w4 — the adapter has a recorded connection fingerprint but NO connected driver ⇒ not ready within D ⇒ held + URGENT, the single try NOT taken", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await conLaiCuaSo(tx, runId, 2000);
      H.drivers.delete(a1); // the fingerprint of the row's own target stays (registered, not connected)
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "ketNoiChuaSan", mine);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ KD-o3 — the owner-change lookup answers a row WITHOUT its count ⇒ a lookup error (never 'no change') ⇒ 0 PDU, held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      // the product's DB handle answers the device_owner_changes count with a row that has no "n" (an unexpected result shape)
      const that = tx as unknown as { execute: (q: unknown) => Promise<unknown> };
      H.tx = new Proxy(that, {
        get(target, prop, recv) {
          if (prop === "execute") {
            return (q: { queryChunks?: unknown }) => {
              let van = "";
              try {
                van = JSON.stringify(q?.queryChunks ?? "");
              } catch {
                /* not inspectable ⇒ the real query */
              }
              return van.includes("device_owner_changes") ? Promise.resolve([{}]) : target.execute(q);
            };
          }
          const v = Reflect.get(target, prop, recv) as unknown;
          return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(target) : v;
        },
      });
      const pdu0 = soPduGhi();
      let mine: Awaited<ReturnType<typeof khoiDongLai>>["mine"];
      try {
        ({ mine } = await khoiDongLai(runId));
      } finally {
        H.tx = tx;
      }
      await kiemGiuKhongGui(tx, runId, pdu0, "loiTraCuu", mine);
      expect(((await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>).lookupError).toContain("owner-change count unreadable");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ KD-l5 — another command matching only the ADAPTER (no machine on its ledger row) counts as a later command ⇒ 0 PDU, held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await tx.execute(sql`INSERT INTO command_log ("adapterId", "machineId", "tagKey", "commandType", "requestedBy", "confirmedBy", status) VALUES (${a1}, NULL, 'a', 'start', ${KHAC}, ${KHAC}, 'acked')`);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "coLenhSau", mine);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q14 (m-1) — a NON-UTC session time zone (Asia/Ho_Chi_Minh): the window and the original authorisation's expiry are compared as instants ⇒ still sent (not 'always expired')", async () => {
    await trongGiaoDich(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh'`); // before every row (DEFAULT now() of this session ⇒ local wall time)
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      // the original STOP's authorisation row as the engine writes it (drizzle: a JS Date ⇒ the UTC wall time), valid for its hour
      const id = `foe-run${runId}-undo-a1#stop-a1-${Math.random().toString(16).slice(2, 10)}`;
      await tx.insert(aiPendingActions).values({ id, tool: "foe.engine", argsJson: {}, userId: APPROVER, userRole: "foe_gate_approver", summary: "FOE orchestration: step undo", status: "executed", idempotencyKey: id, expiresAt: new Date(Date.now() + 3_600_000) });
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      expect(soPduGhi() - pdu0).toBe(1);
      const md = (await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>;
      expect(md.evidence.b2.conLaiMs).toBeGreaterThan(290_000); // D (5 min), not the cap shifted by +7 h
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q15 (m-3) — redeployed with the step renamed during the outage: a not-final row names no step of the definition ⇒ 'failed' + URGENT (never silent)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["mainOld", "failed"], ["undoOld", "running"]]);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(mine).toEqual([{ runId, compId: "undoOld", outcome: "failed", reason: "definitionChanged" }]);
      expect((await trangThaiRun(tx, runId)).status).toBe("failed");
      expect(canhBaoCua(runId).map((x) => x.kind)).toEqual(["foe_compensation_interrupted_failed"]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q16a (m-5) — another command reaches the device WHILE the boot waits for the connection ⇒ the re-check before the hand-over sees it: 0 PDU, held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      ketNoiSau(a1, 1500);
      H.khiLayDriver = () => {
        void (async () => await tx.execute(sql`INSERT INTO command_log ("adapterId", "machineId", "tagKey", "commandType", "requestedBy", "confirmedBy", status) VALUES (${a1}, ${m1}, 'a', 'start', ${KHAC}, ${KHAC}, 'acked')`))(); // (drizzle builds lazily: awaited inside)
      };
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "coLenhSau", mine);
      expect(((await auditCua(tx, runId))[0]!.det.metadata as Record<string, any>).evidence.b3.lenhSau).toEqual([]); // the decision did not see it
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q16b (I-2) — the window closes (DB time) WHILE the boot waits for the connection ⇒ the re-check before the hand-over: 0 PDU, held + URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      ketNoiSau(a1, 1500);
      H.khiLayDriver = () => void yDinhTruoc(tx, runId, 6 * 60_000); // while the boot waits (after its decision)
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      await kiemGiuKhongGui(tx, runId, pdu0, "quaHan", mine);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q17 (m-9) — 'another command' covers: the MACHINE via another adapter; another run's FOE command; run R0 (prefix collision) — each ⇒ 0 PDU, held + URGENT", async () => {
    for (const ten of ["machine via another adapter", "another run's FOE command", "run-id prefix collision"] as const) {
      await trongGiaoDich(async (tx) => {
        const { m1, m2, a1, a2 } = await dungThietBi(tx);
        const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
        await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
        const [adapter, actionId] =
          ten === "machine via another adapter" ? [a2, null] : ten === "another run's FOE command" ? [a1, `foe-run${runId + 7}-main-a1`] : [a1, `foe-run${runId}0-main-a1`];
        await tx.execute(sql`INSERT INTO command_log ("actionId", "adapterId", "machineId", "tagKey", "commandType", "requestedBy", "confirmedBy", status) VALUES (${actionId}, ${adapter}, ${m1}, 'a', 'start', ${KHAC}, ${KHAC}, 'acked')`);
        const pdu0 = soPduGhi();
        const { mine } = await khoiDongLai(runId);
        await kiemGiuKhongGui(tx, runId, pdu0, "coLenhSau", mine);
      });
    }
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ Q17d (m-9) — an ACTIVE interlock rule on the machine: the boot goes through the interlock gate, which never blocks a pinned STOP (R-1D-c) ⇒ sent, the override recorded", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocChinh(m2, buStopGhim(m1))]);
      await ngatGiaLap(tx, runId, [["main", "failed"], ["undo", "running"]]);
      await tx.insert(interlockRules).values({
        name: `${DAU} rule machine ${m1}`,
        scope: "machine",
        machineId: m1,
        sourceType: "spc_violation",
        comparisonOperator: "gte",
        threshold: "0",
        action: "stop_line",
        targetMachineId: m1,
        targetAdapterId: null,
        commandTag: null,
        requiresHumanConfirm: true,
        enabled: true,
        approvedBy: OWNER,
        approvedAt: new Date(),
      } as never);
      const pdu0 = soPduGhi();
      const { mine } = await khoiDongLai(runId);
      expect(mine).toEqual([{ runId, compId: "undo", outcome: "sent" }]);
      expect(soPduGhi() - pdu0).toBe(1);
      await new Promise((r) => setTimeout(r, 800)); // the override audit is a bounded background write
      const ov = (await tx.execute(sql`SELECT count(*)::int AS n FROM control_audit_log WHERE action = 'stop_interlock_override' AND "afterJson"->>'machineId' = ${String(m1)}`)) as unknown as Array<{ n: number }>;
      expect(ov[0]!.n).toBe(1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });
});
