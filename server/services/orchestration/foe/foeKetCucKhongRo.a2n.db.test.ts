/**
 * SCADA R1b-2b-2a A2(n) (AN TOÀN, L-7) — DB half: an UNKNOWN command outcome never triggers a device write from a non-STOP compensation; a
 * PINNED STOP compensation still goes out by itself. (Unit half + edge mirror: foeKetCucKhongRo.a2n.test.ts, foeRunStoreParity.dot10.test.ts.)
 *
 * Real product code on the `_test` DB (forced by vitest.setup): the FOE engine (rehydrateInterruptedRuns → autoResumeInterruptedRuns → resumeRun
 * → execStep → execCommand → central store: ai_pending_actions, the A2(h) pin predicate over device_tags.stop_value), the OT facade
 * (equipmentRegistry), the dispatcher (gate (1), idempotency (2), write-ahead reservation, intent / result rows of command_log), the REAL S7
 * driver (nodes7) on `__s7commSim`. The FORWARD step writes through a second adapter whose driver is an in-process counter; every
 * COMPENSATION writes through the S7 adapter ⇒ the sim's write PDUs are the independent oracle of "the compensation reached the device".
 *
 * The UNKNOWN outcome is made the way it happens after a crash + rebuild (T3F, foeDuplicateInFlight.r1b2b2.db.test.ts case 4): the forward key
 * `run<R>-main-a1` already has a write-ahead INTENT row and no result row ⇒ the dispatcher refuses DUPLICATE_IN_FLIGHT ⇒ FOE_OUTCOME_UNKNOWN
 * (no device write). Also FOE_ROW_SPENT_FOR_KEY (A2(k) K1 shape) and EDGE_OUTCOME_UNKNOWN (the run context names the step).
 *
 * Every DB write is inside the test's own transaction, ROLLED BACK (getDb ⇒ that transaction; outside it getDb is a TRAP that counts and returns
 * null ⇒ nothing is ever committed). WORM table command_log: no explicit ids. Never the owner role, no DELETE / TRUNCATE. The URGENT alert is
 * RECORDED (the critical-stop alert's durable dedup is its own, tested there): its kind, title, dedup key and recipients are the oracle.
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
    listPlcConfigs: async () => [{ code: "A2N-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async (a: Record<string, unknown>) => void H.alerts.push(a) };
});

import * as conn from "../../../db/connection";
import { aiPendingActions, auditLogs, commandLog, orchestrationRunSteps, orchestrationRuns } from "../../../../drizzle/schema";
import { startS7commSim, type S7commSim } from "../../ot/drivers/__s7commSim";
import { S7Driver } from "../../ot/drivers/s7Driver";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";
import { _setPinReadProbeForTests } from "../../ot/stopPin";
import { bamLenhOt, perWriteKey } from "../../ot/commandDispatcher";
import { fetchOrchestrationHeld } from "../../../routers/oversightRouter";
import { makeFoeGateRun } from "./__foeGateRunFixture";
import { abortRun, autoResumeInterruptedRuns, FOE_OUTCOME_UNKNOWN, rehydrateInterruptedRuns, resumeRun } from "./foeEngine";
import { ensureOrchestrationAction } from "./foeRunStore";
import { buildEquipmentCommand, orchestrationActionId } from "./foeStepClass";
import { CANH_BAO_KHONG_RO_KIND, KET_CUC_KHONG_RO_AUDIT_ACTION, KET_CUC_KHONG_RO_CTX_KEY } from "./foeKetCucKhongRo";
import type { WorkflowStep } from "./workflowModel";

const DB_URL = process.env.DATABASE_URL;
const DAU = `A2N-${Date.now()}`;
const OWNER = 990_917_101;
const APPROVER = 990_917_102;
const ADMIN = { id: 990_917_103, role: "admin", name: "a2n admin" };
const ENGINEER = { id: 990_917_104, role: "engineer", name: "a2n engineer (no machine_control row)" };
const OPERATOR = { id: 990_917_105, role: "operator", name: "a2n operator" };
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

let sim: S7commSim;
let s7: S7Driver;
const soPduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;
/** the FORWARD adapter's driver: counts only (no socket) */
let ghiChinh = 0;
const driverChinh = {
  isConnected: () => true,
  async writeTags(writes: Array<{ tagKey: string }>) {
    ghiChinh++;
    return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
  },
  async readTags() {
    return [];
  },
};

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
        await new Promise((r) => setTimeout(r, 300)); // late background writes of the walk (run events, alerts, audits) still land in the transaction
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
 * Machine M1 = the S7 adapter on the sim: tag `a` PINNED (stop_value 0), tag `u` NOT pinned (the compensations write here) — and machine M2 =
 * the counting adapter, tag `c` (the FORWARD step). INSIDE the transaction. The S7 running connection matches its row (fingerprint).
 */
async function dungThietBi(tx: Tx, opts: { cWritable?: boolean } = {}) {
  const t = Math.random().toString(36).slice(2, 8);
  const factory = await motId(tx, sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}-${t}`}, 'A2N factory', true) RETURNING id`);
  const workshop = await motId(tx, sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factory}, ${`W-${DAU}-${t}`}, 'A2N ws') RETURNING id`);
  const line = await motId(tx, sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshop}, ${`L-${DAU}-${t}`}, 'A2N line') RETURNING id`);
  const station = await motId(tx, sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`S-${DAU}-${t}`}, 'A2N st') RETURNING id`);
  const m1 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M1-${DAU}-${t}`}, 'A2N m1', 'AUTOMATION', true) RETURNING id`);
  const m2 = await motId(tx, sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${station}, ${`M2-${DAU}-${t}`}, 'A2N m2', 'AUTOMATION', true) RETURNING id`);
  const endpoint = `127.0.0.1:${sim.port}`;
  const a1 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A1-${DAU}-${t}`}, 'A2N s7', 's7', ${endpoint}, true, ${m1}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value) VALUES (${a1}, 'a', 'DB1,INT0', 'int', true, '0'::jsonb)`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a1}, 'u', 'DB1,INT2', 'int', true)`);
  const a2 = await motId(tx, sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId") VALUES (${`A2-${DAU}-${t}`}, 'A2N dem', 'stub', 'stub://a2n', true, ${m2}) RETURNING id`);
  await tx.execute(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${a2}, 'c', 'D100', 'int', ${opts.cWritable ?? true})`);
  H.drivers.set(a1, s7);
  H.fingerprints.set(a1, adapterTargetFingerprint({ protocol: "s7", endpoint, machineId: m1, connectionOptions: null }));
  H.drivers.set(a2, driverChinh);
  return { m1, m2, a1, a2 };
}

/** the forward step (on M2) and the compensation shapes (on M1, the S7 adapter) */
const buocChinh = (m2: number, comp?: WorkflowStep): WorkflowStep => ({ id: "main", type: "command", machineId: m2, command: "start", args: { tagKey: "c", value: 5 }, maxAttempts: 2, ...(comp ? { compensation: comp } : {}) }) as WorkflowStep;
const buTruStop = (m1: number, id = "undo"): WorkflowStep => ({ id, type: "command", machineId: m1, command: "stop", args: { tagKey: "a", value: 0 } }) as WorkflowStep;
const buTruReset = (m1: number, id = "undo"): WorkflowStep => ({ id, type: "command", machineId: m1, command: "reset", args: { tagKey: "u", value: 1 } }) as WorkflowStep;
const hop = (id: string, steps: WorkflowStep[], comp: WorkflowStep): WorkflowStep => ({ id, type: "sequence", steps, compensation: comp }) as WorkflowStep;

async function dungRun(steps: WorkflowStep[]) {
  const fx = await makeFoeGateRun({ tag: `${DAU}-${Math.random().toString(36).slice(2, 8)}`, owner: OWNER, approvedBy: APPROVER, steps });
  return fx.runId;
}
/** "Process boot": the FOE boot hook + durable continue of ONLY the test's run (the product functions). */
async function khoiDong(runId: number) {
  await rehydrateInterruptedRuns();
  return autoResumeInterruptedRuns([runId]);
}
/** T3F — the forward key already has a write-ahead INTENT row (same command, a previous process), no result row ⇒ DUPLICATE_IN_FLIGHT */
async function yDinhTruoc(tx: Tx, o: { a2: number; m2: number; runId: number }) {
  await tx.insert(commandLog).values({
    actionId: null,
    adapterId: o.a2,
    machineId: o.m2,
    tagKey: "c",
    address: "D100",
    commandType: "start",
    requestedValue: 5 as never,
    requestedBy: OWNER,
    confirmedBy: APPROVER,
    status: "sent",
    ackValue: { ledger: "intent", bam: bamLenhOt({ commandType: "start", writes: [{ tagKey: "c", value: 5 }] }) } as never,
    idempotencyKey: `intent:${perWriteKey(`run${o.runId}-main-a1`, "c", 0)}`,
    sentAt: new Date(),
  });
}
/** A2(k) K1 shape — the authorisation row minted for the forward key, spent elsewhere, no intent under the key ⇒ FOE_ROW_SPENT_FOR_KEY */
async function hangDaTieu(tx: Tx, o: { a2: number; m2: number; runId: number }) {
  const key = `run${o.runId}-main-a1`;
  const approval = { runId: o.runId, runOwner: OWNER, approvedBy: APPROVER, gateStepId: "g0" };
  const desc = { name: "start", label: "start", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
  const args = { adapterId: o.a2, tagKey: "c", value: 5 };
  const cmd = buildEquipmentCommand(desc, { adapterKind: "ot-stub" } as never, o.m2, args, key, { id: OWNER, role: "engineer" }, approval);
  expect(await ensureOrchestrationAction({ id: OWNER, role: "engineer" }, key, { id: "main", type: "command" } as never, args, cmd, approval)).toBe(orchestrationActionId(key));
  await tx.update(aiPendingActions).set({ status: "executed", executedAt: new Date(Date.now() - 1_000) }).where(eq(aiPendingActions.id, orchestrationActionId(key)));
}

const buoc = async (tx: Tx, runId: number, stepId: string) =>
  (await tx.select().from(orchestrationRunSteps).where(and(eq(orchestrationRunSteps.runId, runId), eq(orchestrationRunSteps.stepId, stepId))).limit(1))[0];
const runCua = async (tx: Tx, runId: number) => (await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)))[0]!;
const ctxCua = async (tx: Tx, runId: number) => ((await runCua(tx, runId)).contextJson ?? {}) as Record<string, any>;
const soCuaKhoa = (tx: Tx, prefix: string) => tx.select().from(commandLog).where(like(commandLog.idempotencyKey, `v2:%:${prefix}%`));
const uyQuyenCua = (tx: Tx, prefix: string) => tx.select().from(aiPendingActions).where(like(aiPendingActions.id, `${prefix}%`));
const auditCua = (tx: Tx, runId: number) => tx.select().from(auditLogs).where(and(eq(auditLogs.action, KET_CUC_KHONG_RO_AUDIT_ACTION), eq(auditLogs.entityId, runId)));
const canhBao = (loai: keyof typeof CANH_BAO_KHONG_RO_KIND, runId: number) => H.alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[loai] && a.entityId === runId);
async function choCanhBao(loai: keyof typeof CANH_BAO_KHONG_RO_KIND, runId: number, n: number) {
  await vi.waitFor(() => expect(canhBao(loai, runId)).toHaveLength(n), { timeout: 10_000 });
}

/** The held case (N2 shape): forward unknown (DUPLICATE_IN_FLIGHT), `comp` on M1; returns once the boot walk ended. */
async function giuSauKhongRo(tx: Tx, mk: (d: Awaited<ReturnType<typeof dungThietBi>>) => WorkflowStep[]) {
  const d = await dungThietBi(tx);
  const runId = await dungRun(mk(d));
  await yDinhTruoc(tx, { ...d, runId });
  await khoiDong(runId);
  return { ...d, runId };
}

const ENV_KEYS = ["FOE_ENABLED", "FOE_DURABLE", "OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED", "RBAC_SCOPED_ADMIN"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("A2(n) — an unknown outcome: a pinned STOP compensation goes out by itself, any other one is HELD for a person (FOE + dispatcher + real DB, ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // fuse: never on the dev DB
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("../../ot/adapterFacade");
    await import("../../ot/safetyTarget");
    await import("../../safety/plc/safetyPlcAdapter");
    await import("../../robot/criticalStopAlert"); // the mock, once: concurrent first imports race its factory and one gets the REAL alert
    sim = await startS7commSim();
    sim.setFault(null);
    s7 = new S7Driver();
    await s7.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1500 });
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
    for (const k of ENV_KEYS.slice(4)) delete process.env[k];
    _setPinReadProbeForTests(null);
    H.bay = 0;
    H.bayStack.length = 0;
    H.alerts.length = 0;
    ghiChinh = 0;
  });

  it("★ N1 unknown outcome (DUPLICATE_IN_FLIGHT) + PINNED STOP compensation ⇒ EXACTLY 1 STOP PDU through the dispatcher, run failed, URGENT 'STOP compensation sent'", async () => {
    await trongGiaoDich(async (tx) => {
      const pdu0 = soPduGhi();
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [buocChinh(m2, buTruStop(m1))]);
      expect(soPduGhi() - pdu0).toBe(1); // ★ the STOP went out, once
      expect(ghiChinh).toBe(0); // the forward command was never re-sent
      const run = await runCua(tx, runId);
      expect(run.status).toBe("failed"); // as before: its step failed, the STOP compensation ran
      expect(String((await buoc(tx, runId, "main"))?.error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: DUPLICATE_IN_FLIGHT: `));
      expect((await buoc(tx, runId, "undo"))?.status).toBe("compensated");
      // through the dispatcher: a FRESH pinned-STOP authorisation row (A2(m)) and an acked result row under the compensation's key
      expect((await uyQuyenCua(tx, `foe-run${runId}-undo-a1#stop-`)).length).toBe(1);
      expect((await soCuaKhoa(tx, `run${runId}-undo-a1`)).map((x) => x.status)).toEqual(["acked"]);
      await choCanhBao("stopSent", runId, 1);
      const a = canhBao("stopSent", runId)[0]!;
      expect(a.title).toBe(`Run ${runId}: command "main" outcome unknown — machine state unknown — STOP compensation sent ("undo")`);
      expect(String(a.message)).not.toContain("simulated");
      expect(String(a.dedupKey)).toMatch(new RegExp(`^foe_outcome_unknown_stop_compensation_sent:${runId}:main:undo:`));
      expect(a.recipients).toContain(OWNER);
      expect(canhBao("held", runId)).toHaveLength(0);
      expect((await ctxCua(tx, runId))[KET_CUC_KHONG_RO_CTX_KEY]).toBeUndefined();
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N2 unknown outcome + NON-STOP compensation (reset on ANOTHER machine) ⇒ 0 PDU, run HELD + compensationHeld, URGENT 'waiting for a person'", async () => {
    await trongGiaoDich(async (tx) => {
      const pdu0 = soPduGhi();
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [buocChinh(m2, buTruReset(m1))]);
      expect(soPduGhi() - pdu0).toBe(0); // ★ nothing written to the device whose state is unknown
      expect(ghiChinh).toBe(0);
      const run = await runCua(tx, runId);
      expect(run.status).toBe("held");
      expect(String(run.error)).toMatch(/^FOE_OUTCOME_UNKNOWN: command "main" outcome unknown — machine state unknown — compensation "undo" waiting for a person/);
      const ctx = await ctxCua(tx, runId);
      expect(ctx.foeResumeState).toEqual({ main: { state: "compensationHeld", error: expect.stringMatching(/^FOE_OUTCOME_UNKNOWN: DUPLICATE_IN_FLIGHT: /), khongRo: true } });
      expect(ctx[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ stepId: "main", compId: "undo", ma: "FOE_OUTCOME_UNKNOWN" });
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held");
      // never even authorised: no authorisation row, no ledger row under the compensation's key
      expect(await uyQuyenCua(tx, `foe-run${runId}-undo-`)).toEqual([]);
      expect(await soCuaKhoa(tx, `run${runId}-undo-`)).toEqual([]);
      await choCanhBao("held", runId, 1);
      expect(canhBao("held", runId)[0]!.title).toBe(`Run ${runId}: command "main" outcome unknown — machine state unknown — compensation "undo" waiting for a person`);
      expect(canhBao("stopSent", runId)).toHaveLength(0);
      // m-10 — the oversight hint says WHY (the real SQL over the marker)
      const o = await fetchOrchestrationHeld(tx as never, [runId]);
      expect(o.samples?.[0]?.hint).toBe("held · outcome unknown (FOE_OUTCOME_UNKNOWN) — compensation waiting for a person");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N3 the pins of the STOP compensation's adapter cannot be read ⇒ treated as NOT a pinned STOP ⇒ held, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const d = await dungThietBi(tx);
      _setPinReadProbeForTests(async (adapterId) => {
        if (adapterId === d.a1) throw new Error("pin read down (test)");
      });
      const runId = await dungRun([buocChinh(d.m2, buTruStop(d.m1))]);
      await yDinhTruoc(tx, { ...d, runId });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await runCua(tx, runId)).status).toBe("held");
      expect((await ctxCua(tx, runId)).foeResumeState.main.state).toBe("compensationHeld");
      expect(await uyQuyenCua(tx, `foe-run${runId}-undo-`)).toEqual([]); // decided before any authorisation
      await choCanhBao("held", runId, 1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N4 ANCESTOR container: a non-STOP container compensation ⇒ held (0 PDU); a pinned-STOP one ⇒ runs (1 PDU)", async () => {
    await trongGiaoDich(async (tx) => {
      let pdu0 = soPduGhi();
      const a = await giuSauKhongRo(tx, ({ m1, m2 }) => [hop("box", [buocChinh(m2)], buTruReset(m1, "boxUndo"))]);
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await runCua(tx, a.runId)).status).toBe("held");
      expect((await ctxCua(tx, a.runId)).foeResumeState).toMatchObject({ box: { state: "compensationHeld", khongRo: true } });
      expect((await buoc(tx, a.runId, "boxUndo"))?.status).toBe("held");

      pdu0 = soPduGhi();
      const b = await giuSauKhongRo(tx, ({ m1, m2 }) => [hop("box", [buocChinh(m2)], buTruStop(m1, "boxStop"))]);
      expect(soPduGhi() - pdu0).toBe(1);
      expect((await runCua(tx, b.runId)).status).toBe("failed");
      expect((await buoc(tx, b.runId, "boxStop"))?.status).toBe("compensated");
      await choCanhBao("stopSent", b.runId, 1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ C-1 a held child never blocks the container's pinned STOP: 1 STOP PDU now, 0 reset, run held; Continue ⇒ the reset once, the STOP NOT re-sent", async () => {
    await trongGiaoDich(async (tx) => {
      const pdu0 = soPduGhi();
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [hop("box", [buocChinh(m2, buTruReset(m1, "undo"))], buTruStop(m1, "boxStop"))]);
      expect(soPduGhi() - pdu0).toBe(1); // ★ the STOP, no person
      expect((await runCua(tx, runId)).status).toBe("held");
      expect((await buoc(tx, runId, "boxStop"))?.status).toBe("compensated");
      expect((await buoc(tx, runId, "undo"))?.status).toBe("held");
      await choCanhBao("stopSent", runId, 1);
      await choCanhBao("held", runId, 1);
      const r = await resumeRun(runId, { approved: true, note: "checked: the reset is safe" }, ADMIN, {}, { scope: null });
      expect(r.status).toBe("failed");
      expect(soPduGhi() - pdu0).toBe(2); // the reset; the STOP is not re-sent
      expect((await soCuaKhoa(tx, `run${runId}-boxStop-`)).filter((x) => x.status === "acked")).toHaveLength(1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ C-2 (a) a gate in a sibling branch: the run is HELD, not awaiting_confirm; no resume without person + reason; 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const pdu0 = soPduGhi();
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [{ id: "p", type: "parallel", failFast: true, steps: [buocChinh(m2, buTruReset(m1)), { id: "g2", type: "hitl_gate", prompt: "other" } as WorkflowStep] } as WorkflowStep]);
      // the first DB run saw awaiting_confirm here: the message says whether `main` really failed on an unknown outcome (see the next case)
      const main = await buoc(tx, runId, "main");
      expect((await runCua(tx, runId)).status, `main: ${main?.status} attempt ${main?.attempt}: ${main?.error}`).toBe("held");
      await expect(resumeRun(runId, { approved: true }, ADMIN, {}, { scope: null })).rejects.toThrow(/reason is required/);
      await expect(resumeRun(runId, { approved: true, note: "x" }, OPERATOR, {}, { scope: null })).rejects.toThrow(/machine-control rights/);
      expect(soPduGhi() - pdu0).toBe(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ C-2 (a) the same on the aggregation alone: the unknown outcome comes from the run context, no dispatcher, no statement shares the test's one connection with a gate write ⇒ HELD", async () => {
    await trongGiaoDich(async (tx) => {
      const d = await dungThietBi(tx);
      const runId = await dungRun([{ id: "p", type: "parallel", failFast: true, steps: [buocChinh(d.m2, buTruReset(d.m1)), { id: "g2", type: "hitl_gate", prompt: "other" } as WorkflowStep] } as WorkflowStep]);
      await tx.update(orchestrationRuns).set({ contextJson: { foeOutcomeUnknown: ["main"] } }).where(eq(orchestrationRuns.id, runId));
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      const main = await buoc(tx, runId, "main");
      expect((await runCua(tx, runId)).status, `main: ${main?.status}: ${main?.error}`).toBe("held");
      expect(soPduGhi() - pdu0).toBe(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ C-A (a) a gate beside a failed unknown branch: the container's pinned STOP goes before any approval (1 PDU), the run waits at the gate, URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const d = await dungThietBi(tx);
      const runId = await dungRun([{ id: "p", type: "parallel", failFast: true, compensation: buTruStop(d.m1, "boxStop"), steps: [buocChinh(d.m2), { id: "w", type: "sequence", steps: [{ id: "d0", type: "delay", ms: 400 } as WorkflowStep, { id: "g2", type: "hitl_gate", prompt: "other" } as WorkflowStep] } as WorkflowStep] } as WorkflowStep]);
      await yDinhTruoc(tx, { ...d, runId });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      const main = await buoc(tx, runId, "main");
      expect(soPduGhi() - pdu0, `main: ${main?.status}: ${main?.error}`).toBe(1);
      expect((await runCua(tx, runId)).status).toBe("awaiting_confirm");
      await choCanhBao("stopSent", runId, 1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ C-A (b) a precondition-abort sibling: the container's reset is NOT written, held, URGENT", async () => {
    await trongGiaoDich(async (tx) => {
      const d = await dungThietBi(tx);
      const abortB = { id: "b", type: "command", machineId: d.m1, command: "reset", args: { tagKey: "u", value: 2 }, precondition: { source: "param", key: "never", op: "eq", value: true }, onPreconditionFail: "abort" } as unknown as WorkflowStep;
      const runId = await dungRun([{ id: "p", type: "parallel", failFast: true, compensation: buTruReset(d.m1, "boxUndo"), steps: [buocChinh(d.m2), abortB] } as WorkflowStep]);
      await yDinhTruoc(tx, { ...d, runId });
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await runCua(tx, runId)).status).toBe("held");
      await choCanhBao("held", runId, 1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ I-A (a) a Continue does not re-read a container's 'skip' precondition: the held compensation goes (1 PDU), the next forward step does not", async () => {
    await trongGiaoDich(async (tx) => {
      const d = await dungThietBi(tx);
      const next = { id: "next", type: "command", machineId: d.m1, command: "reset", args: { tagKey: "u", value: 9 } } as WorkflowStep;
      const runId = await dungRun([{ id: "box", type: "sequence", steps: [buocChinh(d.m2, buTruReset(d.m1))], precondition: { source: "context", key: "allow", op: "eq", value: true }, onPreconditionFail: "skip" } as unknown as WorkflowStep, next]);
      await tx.update(orchestrationRuns).set({ contextJson: { allow: true } }).where(eq(orchestrationRuns.id, runId));
      await yDinhTruoc(tx, { ...d, runId });
      await khoiDong(runId);
      expect((await runCua(tx, runId)).status).toBe("held");
      await tx.update(orchestrationRuns).set({ contextJson: { ...(await ctxCua(tx, runId)), allow: false } }).where(eq(orchestrationRuns.id, runId));
      const pdu0 = soPduGhi();
      expect((await resumeRun(runId, { approved: true, note: "checked" }, ADMIN, {}, { scope: null })).status).toBe("failed");
      expect(soPduGhi() - pdu0).toBe(1);
      expect(await buoc(tx, runId, "next")).toBeUndefined();
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ I-4 Continue on a hold in a non-failFast parallel writes EXACTLY the held compensation: the run fails, nothing forward", async () => {
    await trongGiaoDich(async (tx) => {
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [{ id: "p", type: "parallel", steps: [buocChinh(m2, buTruReset(m1))] } as WorkflowStep, { id: "next", type: "command", machineId: m1, command: "reset", args: { tagKey: "u", value: 9 } } as WorkflowStep]);
      const pdu0 = soPduGhi();
      const r = await resumeRun(runId, { approved: true, note: "checked" }, ADMIN, {}, { scope: null });
      expect(r.status).toBe("failed");
      expect(soPduGhi() - pdu0).toBe(1);
      expect(await buoc(tx, runId, "next")).toBeUndefined();
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ I-3 OT control OFF: a pinned STOP compensation is only SIMULATED ⇒ the URGENT says so, never 'sent'; 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      process.env.OT_CONTROL_ENABLED = "false";
      const pdu0 = soPduGhi();
      const d = await dungThietBi(tx);
      const runId = await dungRun([buocChinh(d.m2, buTruStop(d.m1))]);
      await tx.update(orchestrationRuns).set({ contextJson: { foeOutcomeUnknown: ["main"] } }).where(eq(orchestrationRuns.id, runId)); // no dispatcher involved in the unknown
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(0);
      await choCanhBao("stopSimulated", runId, 1);
      expect(canhBao("stopSent", runId)).toHaveLength(0);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ R-4 an unknown outcome with no compensation due anywhere ⇒ URGENT, run failed, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      const pdu0 = soPduGhi();
      const { runId } = await giuSauKhongRo(tx, ({ m2 }) => [buocChinh(m2)]);
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await runCua(tx, runId)).status).toBe("failed");
      await choCanhBao("noCompensation", runId, 1);
      expect(String(canhBao("noCompensation", runId)[0]!.dedupKey)).toMatch(new RegExp(`^foe_outcome_unknown_no_compensation:${runId}:main:-:`));
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ m-9 a second interruption of the SAME (step, compensation) — the context lost before it persisted, a later re-walk — ⇒ a second URGENT: only the event differs", async () => {
    await trongGiaoDich(async (tx) => {
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [buocChinh(m2, buTruReset(m1))]);
      await choCanhBao("held", runId, 1);
      await tx.update(orchestrationRuns).set({ contextJson: {} }).where(eq(orchestrationRuns.id, runId));
      await resumeRun(runId, { approved: true, note: "re-walk" }, { id: 0, role: "system", name: "a2n" } as never, {}, { scope: null });
      await choCanhBao("held", runId, 2);
      const keys = canhBao("held", runId).map((a) => String(a.dedupKey));
      expect(keys[0]!.split(":").slice(0, 4)).toEqual(keys[1]!.split(":").slice(0, 4));
      expect(keys[0]).not.toBe(keys[1]);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N5 the other unknown codes take the same split: FOE_ROW_SPENT_FOR_KEY (A2(k)) and EDGE_OUTCOME_UNKNOWN ⇒ held, 0 PDU", async () => {
    await trongGiaoDich(async (tx) => {
      // FOE_ROW_SPENT_FOR_KEY
      const d = await dungThietBi(tx);
      const r1 = await dungRun([buocChinh(d.m2, buTruReset(d.m1))]);
      await hangDaTieu(tx, { ...d, runId: r1 });
      let pdu0 = soPduGhi();
      await khoiDong(r1);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(ghiChinh).toBe(0);
      expect((await runCua(tx, r1)).status).toBe("held");
      expect(String((await buoc(tx, r1, "main"))?.error)).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: FOE_ROW_SPENT_FOR_KEY: `));
      // EDGE_OUTCOME_UNKNOWN — the run context names `main` as sent with no recorded result: never sent, split
      const r2 = await dungRun([buocChinh(d.m2, buTruReset(d.m1))]);
      await tx.update(orchestrationRuns).set({ contextJson: { foeOutcomeUnknown: ["main"] } }).where(eq(orchestrationRuns.id, r2));
      pdu0 = soPduGhi();
      await khoiDong(r2);
      expect(soPduGhi() - pdu0).toBe(0);
      expect(ghiChinh).toBe(0);
      const run2 = await runCua(tx, r2);
      expect(run2.status).toBe("held");
      expect(String(run2.error)).toMatch(/^EDGE_OUTCOME_UNKNOWN: command "main" outcome unknown/);
      expect((await ctxCua(tx, r2))[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ ma: "EDGE_OUTCOME_UNKNOWN" });
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N6 resume: operator / engineer without machine_control / no reason ⇒ refused, out of scope ⇒ not found; admin + reason ⇒ the compensation runs ONCE (1 PDU), audit row", async () => {
    await trongGiaoDich(async (tx) => {
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [buocChinh(m2, buTruReset(m1))]);
      const pdu0 = soPduGhi();
      const tiep = (u: { id: number; role: string; name: string }, note?: string, scope: unknown = null) => resumeRun(runId, { approved: true, note }, u, {}, { scope: scope as never });
      await expect(tiep(OPERATOR, "checked")).rejects.toThrow(/only a person with machine-control rights/);
      await expect(tiep(ENGINEER, "checked")).rejects.toThrow(/only a person with machine-control rights/);
      await expect(tiep(ADMIN)).rejects.toThrow(/reason is required/);
      expect(await tiep(ADMIN, "checked", { tenantScope: {} })).toMatchObject({ ok: false, message: `Run ${runId} not found.` });
      expect((await runCua(tx, runId)).status).toBe("held");
      expect(soPduGhi() - pdu0).toBe(0);
      expect(await auditCua(tx, runId)).toEqual([]);

      const r = await tiep(ADMIN, "checked on site: the start was not applied");
      expect(r.status).toBe("failed");
      expect(soPduGhi() - pdu0).toBe(1); // ★ the held compensation, once
      expect(ghiChinh).toBe(0); // the forward step never re-run
      expect((await buoc(tx, runId, "undo"))?.status).toBe("compensated");
      expect((await soCuaKhoa(tx, `run${runId}-undo-a1`)).map((x) => x.status)).toEqual(["acked"]);
      const au = await auditCua(tx, runId);
      expect(au).toHaveLength(1);
      expect(au[0]!.userId).toBe(ADMIN.id);
      expect(JSON.parse(String(au[0]!.details))).toMatchObject({ operation: "foe_outcome_unknown_continue", metadata: { runId, stepId: "main", compId: "undo", reason: "checked on site: the start was not applied", role: "admin" } });
      expect((await ctxCua(tx, runId))[KET_CUC_KHONG_RO_CTX_KEY]).toBeUndefined();
      // a second Continue cannot happen (the run is terminal) — nothing more is written
      expect(soPduGhi() - pdu0).toBe(1);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N6 Abort of such a held run ⇒ NO write of the held compensation (0 PDU), aborted, audited with the reason", async () => {
    await trongGiaoDich(async (tx) => {
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [buocChinh(m2, buTruReset(m1))]);
      const pdu0 = soPduGhi();
      await abortRun(runId, ADMIN, "not safe to continue", { scope: null });
      expect((await runCua(tx, runId)).status).toBe("aborted");
      expect(soPduGhi() - pdu0).toBe(0);
      expect(await soCuaKhoa(tx, `run${runId}-undo-`)).toEqual([]);
      await vi.waitFor(async () => expect(await auditCua(tx, runId)).toHaveLength(1), { timeout: 10_000 });
      expect(JSON.parse(String((await auditCua(tx, runId))[0]!.details))).toMatchObject({ operation: "foe_outcome_unknown_abort", metadata: { via: "abort", reason: "not safe to continue" } });
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N7 one URGENT per interruption; a second interruption of the same run (the container's compensation, after a Continue) ⇒ a second URGENT, its own key", async () => {
    await trongGiaoDich(async (tx) => {
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [hop("box", [buocChinh(m2, buTruReset(m1, "undo"))], buTruReset(m1, "boxUndo"))]);
      await choCanhBao("held", runId, 1);
      const pdu0 = soPduGhi();
      const r = await resumeRun(runId, { approved: true, note: "checked: undo is safe" }, ADMIN, {}, { scope: null });
      expect(r.status).toBe("held"); // undo sent; the container's own compensation is held in its turn
      expect(soPduGhi() - pdu0).toBe(1);
      await choCanhBao("held", runId, 2);
      const keys = canhBao("held", runId).map((a) => String(a.dedupKey));
      expect(keys[0]).toContain(`:${runId}:main:undo:`);
      expect(keys[1]).toContain(`:${runId}:box:boxUndo:`);
      expect(new Set(keys).size).toBe(2);
      expect((await ctxCua(tx, runId))[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ stepId: "box", compId: "boxUndo" });
      // the second Continue sends ONLY the container's compensation
      const r2 = await resumeRun(runId, { approved: true, note: "checked: boxUndo is safe" }, ADMIN, {}, { scope: null });
      expect(r2.status).toBe("failed");
      expect(soPduGhi() - pdu0).toBe(2);
      expect(await auditCua(tx, runId)).toHaveLength(2);
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("★ N10 (n6) a KNOWN failure (TAG_NOT_WRITABLE, retried) ⇒ its non-STOP compensation runs exactly as before: 1 PDU, run failed, no A2(n) alert", async () => {
    await trongGiaoDich(async (tx) => {
      const d = await dungThietBi(tx, { cWritable: false });
      const runId = await dungRun([buocChinh(d.m2, buTruReset(d.m1))]);
      const pdu0 = soPduGhi();
      await khoiDong(runId);
      expect(soPduGhi() - pdu0).toBe(1);
      expect((await runCua(tx, runId)).status).toBe("failed");
      expect((await buoc(tx, runId, "main"))?.attempt).toBe(3);
      expect(String((await buoc(tx, runId, "main"))?.error)).not.toContain(FOE_OUTCOME_UNKNOWN);
      expect((await buoc(tx, runId, "undo"))?.status).toBe("compensated");
      await new Promise((r) => setTimeout(r, 200));
      expect(H.alerts.filter((a) => String(a.kind).startsWith("foe_outcome_unknown") && a.entityId === runId)).toEqual([]);
      expect((await ctxCua(tx, runId))[KET_CUC_KHONG_RO_CTX_KEY]).toBeUndefined();
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });

  it("no automatic expiry into a write: a later boot (rehydrate + FOE_DURABLE auto-resume) never continues the held run", async () => {
    await trongGiaoDich(async (tx) => {
      const { runId } = await giuSauKhongRo(tx, ({ m1, m2 }) => [buocChinh(m2, buTruReset(m1))]);
      await tx.update(orchestrationRuns).set({ contextJson: { ...(await ctxCua(tx, runId)), interrupted: true } }).where(eq(orchestrationRuns.id, runId));
      const pdu0 = soPduGhi();
      const out = await khoiDong(runId);
      expect(out.runIds).toEqual([]);
      expect(soPduGhi() - pdu0).toBe(0);
      expect((await runCua(tx, runId)).status).toBe("held");
    });
    expect(H.bay, H.bayStack.join("\n---\n")).toBe(0);
  });
});
