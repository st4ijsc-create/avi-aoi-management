/**
 * SCADA R1b-2b-2a A2(m) (AN TOÀN) — after a crash and a resume, an FOE PINNED STOP is never refused because its authorisation row was already
 * spent; FOE action ids never truncate. DB half (M1–M3, M5–M8, M10, M10b, M11; M4 moved to A2(m2) — the unit half is foeStopHangMoi.a2m.test.ts).
 *
 * Real product code on the `_test` DB (forced by vitest.setup): the FOE engine (rehydrateInterruptedRuns → autoResumeInterruptedRuns / resumeRun →
 * execStep → execCommand → central store: ai_pending_actions), the OT facade (equipmentRegistry), the dispatcher (gate (1), idempotency (2) with the
 * T6d STOP re-key, write-ahead reservation, intent / result rows of command_log), the REAL S7 driver (nodes7) on `__s7commSim` — the sim's write PDUs
 * are the independent oracle of "the device was written". A second adapter's driver is an in-process counter (no socket).
 *
 * CRASH "after the reservation marked the row executed, before the PDU": the S7 driver is wrapped; with `treo` set its next writeTags never answers
 * and sends NOTHING (the walk is dead there: the reservation's transaction — CAS confirmed→executed + intent rows — is committed). "Restart" = the
 * FOE boot hook (rehydrate: running ⇒ held interrupted) + durable auto-resume (FOE_DURABLE) or a person's Continue (resumeRun).
 *
 * Every DB write is inside the test's own transaction, ROLLED BACK (getDb ⇒ that transaction; outside it getDb is a TRAP that counts and returns
 * null ⇒ nothing is ever committed). WORM table command_log: no explicit ids. Never the owner role, no DELETE / TRUNCATE.
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
    listPlcConfigs: async () => [{ code: "A2M-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});
// the critical-stop alert is RECORDED (M11 counts the calls of the engine's alert; its durable dedup is that function's own, tested there) — never
// an inbox insert for the fixture's non-existent users inside the test transaction
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: Record<string, unknown>) => {
      H.alerts.push(a);
      // A2(n) T7 — the end gate reads baoBen: a mock that never answers holds every latched run (stored, as the real alert answers)
      (a.baoBen as ((b: boolean) => void) | undefined)?.(true);
    },
  };
});

import * as conn from "../../../db/connection";
import { aiPendingActions, commandLog, orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows } from "../../../../drizzle/schema";
import { startS7commSim, type S7commSim } from "../../ot/drivers/__s7commSim";
import { S7Driver } from "../../ot/drivers/s7Driver";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";
import { _setPinReadProbeForTests } from "../../ot/stopPin";
import { HANG_MOI_STOP_GHIM_TU_CHOI } from "../../ot/commandDispatcher";
import { getCapabilitiesForMachine } from "../../equipment/capabilityModel";
import { makeFoeGateRun } from "./__foeGateRunFixture";
import { autoResumeInterruptedRuns, rehydrateInterruptedRuns, resumeRun } from "./foeEngine";
import { ensureOrchestrationAction, findSeparateGateApproval } from "./foeRunStore";
import { buildEquipmentCommand, orchestrationActionId, orchestrationActionIdCu } from "./foeStepClass";
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2M-${Date.now()}`;
const OWNER = 990_915_101;
const APPROVER = 990_915_102;
const KHAC = 990_915_103; // another user who continues the run (M2)
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

let sim: S7commSim;
let s7: S7Driver;
const soPduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;

/**
 * The S7 adapter's driver: the REAL S7 driver, except that (a) with `treo` set the NEXT writeTags never answers and sends nothing (crash before
 * the PDU), (b) with `loiMotLan` set the NEXT write goes out under the sim's `writeError` fault (the PLC answers an error) and the fault is cleared
 * right after (the following write succeeds).
 */
const S7 = { treo: false, daTreo: null as null | (() => void), loiMotLan: false };
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
/** the second adapter's driver: counts only (no socket); `hong` = how many of the next writes the device refuses */
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
        await new Promise((r) => setTimeout(r, 300)); // late background writes of the walk (run events …) still land in the transaction
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
  const factory = await motId(tx, sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}-${t}`}, 'A2M factory', true) RETURNING id`);
  const workshop = await motId(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factory}, ${`W-${DAU}-${t}`}, 'A2M ws') RETURNING id`);
  const line = await motId(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshop}, ${`L-${DAU}-${t}`}, 'A2M line') RETURNING id`);
  const station = await motId(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`S-${DAU}-${t}`}, 'A2M st') RETURNING id`);
  const m1 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M1-${DAU}-${t}`}, 'A2M m1', 'AUTOMATION', true) RETURNING id`);
  const m2 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M2-${DAU}-${t}`}, 'A2M m2', 'AUTOMATION', true) RETURNING id`);
  const endpoint = `127.0.0.1:${sim.port}`;
  const a1 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A1-${DAU}-${t}`}, 'A2M s7', 's7', ${endpoint}, true, ${m1}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value) VALUES (${a1}, 'a', 'DB1,INT0', 'int', true, '0'::jsonb)`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a1}, 'u', 'DB1,INT2', 'int', true)`);
  const a2 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A2-${DAU}-${t}`}, 'A2M dem', 'stub', 'stub://a2m', true, ${m2}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a2}, 'c', 'D100', 'int', true)`);
  H.drivers.set(a1, s7Boc);
  H.fingerprints.set(a1, adapterTargetFingerprint({ protocol: "s7", endpoint, machineId: m1, connectionOptions: null }));
  H.drivers.set(a2, driverBuTru);
  return { m1, m2, a1, a2 };
}

/** A REAL run (owner OWNER; gate g0 approved by `approvedBy`: APPROVER = a counting approval, OWNER = a gate passed that does NOT count). */
async function dungRun(steps: WorkflowStep[], approvedBy: number = APPROVER) {
  return makeFoeGateRun({ tag: `${DAU}-${Math.random().toString(36).slice(2, 8)}`, owner: OWNER, approvedBy, steps });
}

/** "Process boot": the FOE boot hook + durable continue of ONLY the test's run (the product functions). */
async function khoiDong(runId: number) {
  await rehydrateInterruptedRuns();
  return autoResumeInterruptedRuns([runId]);
}

/** Walk 1: up to the S7 write of the first STOP, which never answers and sends nothing (the crash). Returns once the cut is reached. */
async function sapTruocGoi(runId: number) {
  const daToi = new Promise<void>((r) => (S7.daTreo = r));
  S7.treo = true;
  void khoiDong(runId);
  await Promise.race([daToi, new Promise((_, rej) => setTimeout(() => rej(new Error("crash point not reached in 60 s")), 60_000))]);
  S7.daTreo = null;
}

/** T6d — the v2 ledger keys of a base prefix (`intent:v2:<len>:<base>…` / `v2:<len>:<base>…`). */
const soCuaKhoa = (tx: Tx, prefix: string) =>
  tx.select().from(commandLog).where(like(commandLog.idempotencyKey, prefix.startsWith("intent:") ? `intent:v2:%:${prefix.slice("intent:".length)}%` : `v2:%:${prefix}%`));
const buoc = async (tx: Tx, runId: number, stepId: string) =>
  (await tx.select().from(orchestrationRunSteps).where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, stepId))).limit(1))[0];
const trangThaiRun = async (tx: Tx, runId: number) => (await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)))[0]!;
const hangUyQuyen = (tx: Tx, prefix: string) => tx.select().from(aiPendingActions).where(like(aiPendingActions.id, `${prefix}%`));
const tuChoiCua = (tx: Tx, actionId: string) => tx.select().from(commandLog).where(and(eq(commandLog.actionId, actionId), eq(commandLog.status, "rejected")));

const buocStop = (m1: number, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({ id: "main", type: "command", machineId: m1, command: "stop", args: { tagKey: "a", value: 0 }, ...extra }) as WorkflowStep;

const ENV_KEYS = ["FOE_ENABLED", "FOE_DURABLE", "OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED", "OT_CONTROL_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(m) — an FOE pinned STOP gets a FRESH authorisation row per dispatch; ids never truncate (FOE + dispatcher + real DB, ROLLBACK)", () => {
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
    // the crashed walk (sapTruocGoi) must STAY dead: with the default 5 s write timeout the dispatcher would answer it "timeout" and that walk
    // would resume inside a LATER case (late writes outside its transaction, even a retried STOP). 120 s outlives this file; every case here is
    // answered by the device (or refused) long before.
    process.env.OT_CONTROL_TIMEOUT_MS = "120000";
    H.bay = 0;
    H.bayStack.length = 0;
    H.alerts.length = 0;
    BT.ghi = 0;
    BT.hong = 0;
    S7.treo = false;
    S7.loiMotLan = false;
    sim.setFault(null);
    _setPinReadProbeForTests(null);
  });

  it("★ M1 — the 5-step trace, maxAttempts UNSET: crash after the reservation spent the row, before the PDU ⇒ resume ⇒ EXACTLY 1 STOP PDU; a fresh row per dispatch, the spent one untouched", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1)]);
      const khoa = `run${runId}-main-a1`;

      const pdu0 = soPduGhi();
      await sapTruocGoi(runId); // (1) reservation: row confirmed→executed + intent rows committed; (2) the process dies before the PDU
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await soCuaKhoa(tx, `intent:${khoa}`)).length).toBe(1);
      const lan1 = await hangUyQuyen(tx, `foe-run${runId}-main-a`);
      const executedAt1 = lan1[0]?.executedAt?.getTime();

      // (3) resume (same attempt key) ⇒ (4) step 2 sees the key in flight ⇒ STOP re-keyed ⇒ (5) the reservation consumes THIS dispatch's row
      const pdu1 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu1).toBe(1); // ★ the STOP went out, exactly once (base ddc0e2bdb: 0 — refused NOT_CONFIRMED on the spent row)
      expect(lan1.map((r) => r.status)).toEqual(["executed"]); // walk 1 spent its row …
      expect(lan1[0]!.id.startsWith(`${orchestrationActionId(khoa)}#stop-a1-`)).toBe(true); // … a fresh-per-dispatch row already
      expect((await trangThaiRun(tx, runId)).status).toBe("completed");
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("completed");
      expect(main?.attempt).toBe(1);
      const lan2 = await hangUyQuyen(tx, `foe-run${runId}-main-a`);
      expect(lan2).toHaveLength(2);
      expect(lan2.every((r) => r.status === "executed" && r.id.startsWith(`${orchestrationActionId(khoa)}#stop-a1-`))).toBe(true);
      expect(lan2.find((r) => r.id === lan1[0]!.id)?.executedAt?.getTime()).toBe(executedAt1); // the spent row is not touched again
      expect(await hangUyQuyen(tx, orchestrationActionId(khoa)).then((x) => x.filter((r) => r.id === orchestrationActionId(khoa)))).toHaveLength(0); // never the deterministic row
      const ketQua = (await soCuaKhoa(tx, `${khoa}#stop-`)).filter((r) => r.status === "acked");
      expect(ketQua).toHaveLength(1);
      expect(ketQua[0]!.actionId).toBe(lan2.find((r) => r.id !== lan1[0]!.id)!.id); // written under the NEW row
      expect(await tx.select().from(commandLog).where(and(like(commandLog.actionId, `foe-run${runId}-main-a%`), eq(commandLog.status, "rejected")))).toHaveLength(0); // no NOT_CONFIRMED
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ M2 — resume by ANOTHER user of a STOP-only run without a counting gate approval ⇒ the STOP goes out (fresh row owned by that user)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1)], OWNER); // g0 passed by the owner: no counting approval ⇒ self-confirmed rows
      await sapTruocGoi(runId); // walk 1 under the auto-resume user (id 0)
      const lan1 = await hangUyQuyen(tx, `foe-run${runId}-main-a`);

      process.env.FOE_DURABLE = "false"; // the restart leaves the run held; a PERSON continues it
      await rehydrateInterruptedRuns();
      expect((await trangThaiRun(tx, runId)).status).toBe("held");
      const pdu1 = soPduGhi();
      const res = await resumeRun(runId, { approved: true, note: "A2(m) M2" }, { id: KHAC, role: "admin", name: "other" }, {}, { scope: null });
      expect(soPduGhi() - pdu1).toBe(1);
      expect(res.ok).toBe(true);
      expect(lan1.map((r) => [r.userId, r.status])).toEqual([[0, "executed"]]); // walk 1 (auto-resume user 0) spent its row
      expect((await trangThaiRun(tx, runId)).status).toBe("completed");
      const lan2 = await hangUyQuyen(tx, `foe-run${runId}-main-a`);
      expect(lan2.map((r) => r.userId).sort()).toEqual([0, KHAC]);
      expect(await tx.select().from(commandLog).where(and(like(commandLog.actionId, `foe-run${runId}-main-a%`), eq(commandLog.status, "rejected")))).toHaveLength(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ M3 — the spent row is older than 1 h when the run is continued ⇒ the STOP goes out (fresh row)", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1)]);
      await sapTruocGoi(runId);
      await tx.execute(sql`UPDATE ai_pending_actions SET "expiresAt" = now() - interval '2 hours', "createdAt" = now() - interval '3 hours' WHERE id LIKE ${`foe-run${runId}-main-a%`}`);
      const pdu1 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu1).toBe(1);
      expect((await trangThaiRun(tx, runId)).status).toBe("completed");
      // fix round 1 (DB mutant 2 survived here): the STOP goes out on the resumed attempt 1 itself — never a NOT_CONFIRMED on the old row
      // rescued only by the STOP default of attempts (attempt 2's new key)
      expect((await buoc(tx, runId, "main"))?.attempt).toBe(1);
      expect(await tx.select().from(commandLog).where(and(like(commandLog.actionId, `foe-run${runId}-main-a%`), eq(commandLog.status, "rejected")))).toHaveLength(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  for (const [ma, ten, step] of [
    ["M5a", "unpinned stop-typed", (m1: number) => ({ id: "main", type: "command", machineId: m1, command: "stop", args: { tagKey: "u", value: 0 } })],
    ["M5b", "content stop (ordinary type writing the pin)", (m1: number) => ({ id: "main", type: "command", machineId: m1, command: "start", args: { tagKey: "a", value: 0 } })],
  ] as const) {
    it(`★ ${ma} — a NON-pinned command on the same path (${ten}) ⇒ no new row: the deterministic row reused, still NOT_CONFIRMED on the spent row, 0 PDU`, async () => {
      await trongGiaoDich(async (tx) => {
        const { m1 } = await dungThietBi(tx);
        const { runId } = await dungRun([step(m1) as WorkflowStep]); // counting approval: the row is the approver's
        const khoa = `run${runId}-main-a1`;
        await sapTruocGoi(runId);
        expect((await hangUyQuyen(tx, `foe-run${runId}-main-a`)).map((r) => [r.id, r.status]), ten).toEqual([[orchestrationActionId(khoa), "executed"]]);
        const pdu1 = soPduGhi();
        await khoiDong(runId);
        expect(soPduGhi() - pdu1, ten).toBe(0);
        expect((await hangUyQuyen(tx, `foe-run${runId}-main-a`)).map((r) => r.id), ten).toEqual([orchestrationActionId(khoa)]); // ★ no new row
        const tuChoi = await tuChoiCua(tx, orchestrationActionId(khoa));
        expect(tuChoi.length, ten).toBeGreaterThan(0);
        expect(tuChoi.every((x) => String(x.errorText).startsWith("NOT_CONFIRMED")), ten).toBe(true);
        expect((await buoc(tx, runId, "main"))?.status, ten).toBe("failed");
        expect((await buoc(tx, runId, "main"))?.attempt, ten).toBe(1); // not pinned ⇒ no STOP default of attempts
      });
      expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
    });
  }

  it("★ M6 — default 3 attempts: attempt 1 of a pinned STOP fails at the device ⇒ attempt 2 sends it (fresh row); explicit maxAttempts 0 keeps ONE attempt", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1)]);
      S7.loiMotLan = true;
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(2); // the refused write + the retry
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("completed");
      expect(main?.attempt).toBe(2);
      const rows = await hangUyQuyen(tx, `foe-run${runId}-main-a`);
      expect(rows.map((r) => r.id.slice(0, `foe-run${runId}-main-a1#stop-a1-`.length)).sort()).toEqual([`foe-run${runId}-main-a1#stop-a1-`, `foe-run${runId}-main-a2#stop-a2-`]);
    });
    await trongGiaoDich(async (tx) => {
      const { m1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1, { maxAttempts: 0 })]);
      S7.loiMotLan = true;
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(1);
      const main = await buoc(tx, runId, "main");
      expect(main?.status).toBe("failed");
      expect(main?.attempt).toBe(1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ M7 — ids: two step ids sharing the first ~50 characters ⇒ two rows, both written; a long step id, attempt 2 ⇒ NOT attempt 1's row", async () => {
    const chung = `buoc-dai-${"x".repeat(44)}`; // 53 characters shared
    await trongGiaoDich(async (tx) => {
      const { m2 } = await dungThietBi(tx);
      const { runId } = await dungRun([
        { id: `${chung}-1`, type: "command", machineId: m2, command: "start", args: { tagKey: "c", value: 1 } } as WorkflowStep,
        { id: `${chung}-2`, type: "command", machineId: m2, command: "start", args: { tagKey: "c", value: 1 } } as WorkflowStep,
      ]);
      const k1 = `run${runId}-${chung}-1-a1`;
      const k2 = `run${runId}-${chung}-2-a1`;
      expect(orchestrationActionIdCu(k1)).toBe(orchestrationActionIdCu(k2)); // the old truncation: ONE row for both
      await khoiDong(runId);
      expect(BT.ghi).toBe(2);
      expect((await trangThaiRun(tx, runId)).status).toBe("completed");
      const rows = await hangUyQuyen(tx, `foe-run${runId}-buoc-dai-`);
      expect(rows.map((r) => r.id).sort()).toEqual([orchestrationActionId(k1), orchestrationActionId(k2)].sort());
      expect(rows.every((r) => r.status === "executed" && r.id.length <= 64)).toBe(true);
    });
    await trongGiaoDich(async (tx) => {
      const { m2 } = await dungThietBi(tx);
      BT.ghi = 0; // the counter is per process: this run counts from 0 (the block above wrote twice)
      BT.hong = 1;
      const { runId } = await dungRun([{ id: `${chung}-r`, type: "command", machineId: m2, command: "start", args: { tagKey: "c", value: 1 }, maxAttempts: 1 } as WorkflowStep]);
      await khoiDong(runId);
      expect(BT.ghi).toBe(2); // attempt 2 was WRITTEN (its own row), not refused on attempt 1's spent row
      expect((await buoc(tx, runId, `${chung}-r`))?.status).toBe("completed");
      const ids = (await hangUyQuyen(tx, `foe-run${runId}-buoc-dai-`)).map((r) => r.id).sort();
      expect(ids).toEqual([orchestrationActionId(`run${runId}-${chung}-r-a1`), orchestrationActionId(`run${runId}-${chung}-r-a2`)].sort());
      expect(ids[0]).not.toBe(ids[1]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  /** The row the engine would write for a long non-STOP step, then moved to the LEGACY id (a run mid-flight across the upgrade). */
  async function hangCu(tx: Tx, fx: { runId: number; workflowId: number }, step: WorkflowStep, m2: number, a2: number, status: "confirmed" | "executed") {
    const key = `run${fx.runId}-${step.id}-a1`;
    const [wf] = await tx.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, fx.workflowId));
    const def = wf!.definitionJson as WorkflowDefinition;
    const found = await findSeparateGateApproval({ runId: fx.runId, def, startedViaApi: false });
    if (!("approval" in found)) throw new Error(`no approval: ${found.reason}`);
    const cap = getCapabilitiesForMachine({ machineType: "AUTOMATION", capabilities: null } as never);
    const desc = cap.supportedCommands.find((c) => c.name === "start")!;
    const args = { tagKey: "c", value: 1, adapterId: a2 };
    const user = { id: 0, role: "system" };
    const cmd = buildEquipmentCommand(desc, cap, m2, args, key, user, found.approval);
    expect(await ensureOrchestrationAction(user, key, step, args, cmd, found.approval)).toBe(orchestrationActionId(key));
    const cu = orchestrationActionIdCu(key);
    expect(cu).not.toBe(orchestrationActionId(key));
    await tx.update(aiPendingActions).set({ id: cu, idempotencyKey: cu, ...(status === "executed" ? { status, executedAt: new Date() } : {}) }).where(eq(aiPendingActions.id, orchestrationActionId(key)));
    return { key, cu };
  }

  it("★ M8 — compatibility: a mid-flight non-STOP step whose row exists ONLY under the legacy truncated id ⇒ found and used: pending ⇒ written ONCE on it; spent ⇒ refused, no second write", async () => {
    const id = `buoc-cu-${"y".repeat(56)}`;
    for (const status of ["confirmed", "executed"] as const) {
      await trongGiaoDich(async (tx) => {
        const { m2, a2 } = await dungThietBi(tx);
        BT.ghi = 0; // per iteration (the counter is per process)
        const step = { id, type: "command", machineId: m2, command: "start", args: { tagKey: "c", value: 1 } } as WorkflowStep;
        const fx = await dungRun([step]);
        const { key, cu } = await hangCu(tx, fx, step, m2, a2, status);
        await khoiDong(fx.runId);
        expect(BT.ghi, status).toBe(status === "confirmed" ? 1 : 0);
        const rows = await hangUyQuyen(tx, `foe-run${fx.runId}-buoc-cu-`);
        expect(rows.map((r) => [r.id, r.status]), status).toEqual([[cu, "executed"]]); // ★ nothing minted under the new id
        if (status === "confirmed") {
          expect((await soCuaKhoa(tx, key)).filter((r) => r.status === "acked").map((r) => r.actionId)).toEqual([cu]);
        } else {
          const tuChoi = await tuChoiCua(tx, cu);
          expect(tuChoi.length).toBeGreaterThan(0);
          expect(tuChoi.every((x) => String(x.errorText).startsWith("NOT_CONFIRMED"))).toBe(true);
        }
      });
    }
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ M10 (AMENDMENT 1) — the pins change between the engine minting the fresh self-confirmed row and the dispatcher's check ⇒ REFUSED (self-approval, not pinned), 0 PDU — the dispatcher's own verdict is final", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1)], OWNER); // no counting approval ⇒ only a PINNED stop passes a self-confirmed row
      let doi = false;
      _setPinReadProbeForTests(async (adapterId) => {
        if (doi || adapterId !== a1) return;
        const moi = (await tx.execute(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id LIKE ${`foe-run${runId}-main-a1#stop-%`}`)) as unknown as Array<{ n: number }>;
        if (moi[0]!.n > 0) {
          doi = true; // the engine read the pins and minted its fresh row; now the pins change before the dispatcher reads them
          await tx.execute(sql`UPDATE device_tags SET stop_value = NULL WHERE "adapterId" = ${a1} AND "tagKey" = 'a'`);
        }
      });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(doi).toBe(true);
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await buoc(tx, runId, "main"))?.status).toBe("failed");
      const fresh = (await hangUyQuyen(tx, `foe-run${runId}-main-a1#stop-`))[0]!;
      expect(fresh.status).toBe("confirmed"); // never consumed
      const tuChoi = await tuChoiCua(tx, fresh.id);
      expect(tuChoi.length).toBeGreaterThan(0);
      expect(tuChoi.every((x) => String(x.errorText).startsWith("NOT_CONFIRMED") && /separate gate approval/.test(String(x.errorText)))).toBe(true);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ M10b (AMENDMENT 2) — a STOP step WITH a real gate approval: the engine classifies pinned (fresh MARKED row), the dispatcher does not (stale running connection) ⇒ the reservation REFUSES the marked row, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1)]); // counting approval by APPROVER: the fresh row is the approver's, with the approval attached
      H.fingerprints.set(a1, "stale-connection (test)"); // the driver talks to another target ⇒ step 3: not a pinned stop (adapter_connection_stale)
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(0); // ★ never written (without the mark check the approval would let it through)
      expect((await buoc(tx, runId, "main"))?.status).toBe("failed");
      const fresh = await hangUyQuyen(tx, `foe-run${runId}-main-a1#stop-`);
      expect(fresh.length).toBeGreaterThan(0); // the engine DID mint its fresh row(s) …
      for (const r of fresh) {
        expect(r.status).toBe("confirmed"); // … never consumed
        expect(r.userId).toBe(APPROVER);
        expect((r.previewJson as Record<string, unknown>).hangMoiStopGhim).toBe(true);
        const tuChoi = await tuChoiCua(tx, r.id);
        expect(tuChoi.length).toBeGreaterThan(0);
        expect(tuChoi.every((x) => String(x.errorText).startsWith(`NOT_CONFIRMED: ${HANG_MOI_STOP_GHIM_TU_CHOI}`))).toBe(true);
      }
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ M11 (AMENDMENT 1) — the pin read FAILS while the engine classifies a STOP step ⇒ old path (deterministic row, no fresh row) + EXACTLY ONE urgent alert naming run / step / adapter", async () => {
    await trongGiaoDich(async (tx) => {
      const { m1, a1 } = await dungThietBi(tx);
      const { runId } = await dungRun([buocStop(m1)], OWNER);
      let nem = false;
      _setPinReadProbeForTests(async (adapterId) => {
        if (nem || adapterId !== a1) return;
        nem = true; // the FIRST pin read of the walk (the engine's) fails; the dispatcher's own reads succeed
        throw new Error("pin read down (test)");
      });
      await khoiDong(runId);
      expect(nem).toBe(true);
      const rows = await hangUyQuyen(tx, `foe-run${runId}-main-a`);
      expect(rows.map((r) => r.id)).toEqual([orchestrationActionId(`run${runId}-main-a1`)]); // ★ no fresh row
      await vi.waitFor(() => expect(H.alerts.filter((a) => a.kind === "foe_stop_pin_unverified")).toHaveLength(1), { timeout: 5_000 });
      const a = H.alerts.find((x) => x.kind === "foe_stop_pin_unverified")!;
      expect(String(a.message)).toMatch(new RegExp(`^STOP pin could not be verified — the STOP may not be re-sendable \\(run ${runId}, step "main", adapter ${a1}\\): pin read down \\(test\\)`));
      expect(a.dedupKey).toBe(`foe_stop_pin_unverified:${runId}:main:${a1}`);
      expect(a.recipients).toEqual([OWNER]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });
});
