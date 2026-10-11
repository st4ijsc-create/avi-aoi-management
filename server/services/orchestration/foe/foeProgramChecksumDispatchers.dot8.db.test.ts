/**
 * doc 81 Đợt 8 tasks O2 + O4 — BOTH dispatchers (real code, real `_test` DB) check the controller program checksum of
 * the run they consume an approval of: the OT dispatcher (commandDispatcher.reserveRealWrite) and the robot dispatcher
 * (robotCommandDispatcher.reserveRobotJob) each call foeApprovalDbRefusal inside their reservation transaction, which
 * recomputes the binding digest WITH the program checksum read from the live driver.
 *
 * Device = the REAL simulation driver (StubDriver, simulated program "abc") as the adapter's live driver; its writes are
 * counted by a thin wrapper (independent oracle: how many times the device was written). Robot = an in-process fake
 * counting runJob. Safety-PLC source = the same fake "real PLC reads clean" as the other dispatcher DB suites.
 * Program changed / unreadable after the approval ⇒ NOT_CONFIRMED, 0 device writes / 0 robot jobs, action still
 * 'confirmed' (not consumed).
 * Final wave (review O): M2 — the checksum is read BEFORE the reservation transaction (oracle: while the controller is
 * being read, a separate connection can lock the action row with FOR UPDATE NOWAIT — impossible inside the reservation);
 * M5 — an UNPINNED stop-typed write with a changed program is refused, a PINNED stop on a HUNG supported controller is
 * sent with ZERO checksum reads; M1 — the approver screen's getRun reads no controller for a run the caller cannot see.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import postgres from "postgres";

const h = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  robotId: 990_800_000 + (Date.now() % 9_000),
  runJobCalls: 0,
  checksumReads: 0,
  /** final wave M2 — set ⇒ each checksum read first probes whether the action row is locked (FOR UPDATE NOWAIT). */
  probe: null as null | { actionId: () => string | null; results: string[] },
}));

vi.mock("../../robot/robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));
vi.mock("../../robot/robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === h.robotId
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            runJob: async () => {
              h.runJobCalls++;
              return { ok: true, status: "done", detail: { fake: true } };
            },
            abort: async () => undefined,
            health: async () => ({ vendor: "sim", connected: true }),
          },
        }
      : undefined,
}));
vi.mock("../../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "O8-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
    getActiveDriver: (id: number) => h.drivers.get(id) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (id: number) => h.fingerprints.get(id), // final wave M5 — the pinned stop's connection check
  };
});

import { getDb } from "../../../db/connection";
import { aiPendingActions } from "../../../../drizzle/schema";
import { StubDriver } from "../../ot/drivers/stubDriver";
import { makeFoeGateRun, type FoeGateRunFixture } from "./__foeGateRunFixture";

const DB_URL = process.env.DATABASE_URL;
const DAU = `O8DB-${Date.now()}`;
const OWNER = 990_800_101;
const OTHER = 990_800_102;
const ENV_KEYS = [
  "OT_CONTROL_ENABLED",
  "OT_COMMISSIONING_REQUIRED",
  "OT_SAFETY_PREFLIGHT_ENABLED",
  "OT_READBACK_ENABLED",
  "OT_CMD_SERIALIZE_ENABLED",
  "SEC_PLATFORM",
  "UNS_CMD_ACK_ENABLED",
  "PARAM_GUARDRAIL_ENABLED",
  "ROBOT_CONTROL_ENABLED",
  "ROBOT_COMMISSIONING_REQUIRED",
  "ROBOT_CONTROL_TIMEOUT_MS",
  "FIELD_V2_ENABLED",
  "ROBOT_SAFETY_PREFLIGHT_ENABLED",
] as const;
const saved: Record<string, string | undefined> = {};
const fixtures: FoeGateRunFixture[] = [];
const ids: Record<string, number> = {};
let sql: ReturnType<typeof postgres> | null = null;
let sim: StubDriver;
let writeCalls = 0;
let lastActionId: string | null = null;
let seq = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}
/** The command_log refusal text of an OT result (independent read of the WORM ledger). */
async function otErrorText(res: unknown): Promise<string> {
  const ids = ((res as { detail?: { commandLogIds?: number[] } }).detail?.commandLogIds ?? []).map(Number);
  if (!sql || ids.length === 0) return "";
  const rows = await sql`SELECT "errorText" FROM command_log WHERE id IN ${sql(ids)}`;
  return rows.map((r) => String(r.errorText ?? "")).join(" | ");
}
/** The robot_jobs refusal text of a robot result. */
async function robotErrorText(r: unknown): Promise<string> {
  const jobId = (r as { jobId?: number }).jobId;
  if (!sql || !jobId) return "";
  const rows = await sql`SELECT "errorText" FROM robot_jobs WHERE id = ${jobId}`;
  return String(rows[0]?.errorText ?? "");
}
async function pendingStatus(id: string) {
  const [row] = await (await d()).select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return row?.status;
}
/** A real run (owner OWNER) whose gate OTHER approved via the server path, with an OT step on the sim adapter. */
async function approvedRun(tag: string, steps?: Parameters<typeof makeFoeGateRun>[0]["steps"]) {
  const fx = await makeFoeGateRun({
    tag: `${DAU}-${tag}`,
    owner: OWNER,
    approvedBy: OTHER,
    steps: steps ?? [{ id: "w", type: "command", machineId: ids.machine, command: "set_param", args: { adapterId: ids.adapter, tagKey: "speed_sp", value: 7 } }],
  });
  fixtures.push(fx);
  return fx;
}

async function sendOt(
  fx: FoeGateRunFixture,
  cmdName = "set_param",
  args: Record<string, unknown> = { adapterId: ids.adapter, tagKey: "speed_sp", value: 7 },
  beforeSend?: (key: string) => Promise<void>,
) {
  const { buildEquipmentCommand, ensureOrchestrationAction } = await import("./foeEngine");
  const { equipmentRegistry } = await import("../../equipment/equipmentAdapter");
  const user = { id: OWNER, role: "engineer" } as never;
  const key = `${DAU}-ot${++seq}-s1-a1`;
  const descriptor = { name: cmdName, label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
  const cap = { adapterKind: "ot-stub" } as never;
  const approval = { runId: fx.runId, runOwner: OWNER, approvedBy: OTHER, gateStepId: "g0" };
  const cmd = buildEquipmentCommand(descriptor, cap, ids.machine, args, key, user, approval);
  await ensureOrchestrationAction(user, key, { id: `s${seq}`, type: "command" } as never, args, cmd, approval);
  lastActionId = cmd.hitl!.actionId;
  if (beforeSend) await beforeSend(key);
  const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
  return { res, actionId: cmd.hitl!.actionId };
}

async function sendRobot(fx: FoeGateRunFixture) {
  const { ensureOrchestrationAction } = await import("./foeEngine");
  const { toRobotJob } = await import("../../equipment/robotJobMapping");
  const { dispatchRobotJob } = await import("../../robot/robotCommandDispatcher");
  const key = `${DAU}-rb${++seq}`;
  const cmd = { name: "home", robotId: h.robotId, machineId: null, idempotencyKey: key, hitl: { actionId: "x", requestedBy: OWNER, confirmedBy: OTHER } };
  const approval = { runId: fx.runId, runOwner: OWNER, approvedBy: OTHER, gateStepId: "g0" };
  await ensureOrchestrationAction({ id: OWNER, role: "engineer", name: "t" }, key, { id: `s-${key}`, type: "command" } as never, {}, cmd as never, approval);
  const actionId = `foe-${key}`.slice(0, 64);
  const r = await dispatchRobotJob({ robotId: h.robotId, job: toRobotJob(cmd as never), triggerKind: "hitl", actionId, requestedBy: OWNER, confirmedBy: OTHER, idempotencyKey: key });
  return { r, actionId };
}

describe.skipIf(!DB_URL)("doc 81 Đợt 8 O2/O4 — both dispatchers check the controller program checksum (CSDL _test, sim driver)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    // warm the dynamic imports the dispatchers make inside their 5 s preflight deadline (as the other dispatcher suites do)
    await import("../../ot/adapterFacade");
    await import("../../ot/safetyTarget");
    await import("../../safety/plc/safetyPlcAdapter");
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + DAU}, 'O8 factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + DAU}, 'O8 ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + DAU}, 'O8 line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + DAU}, 'O8 st') RETURNING id`);
    ids.machine = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"M-" + DAU}, 'O8 m', 'AOI', true) RETURNING id`);
    ids.adapter = await one(
      sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId", "connectionOptions") VALUES (${"A-" + DAU}, 'O8 sim adapter', 'stub', 'stub://o8', true, ${ids.machine}, ${sql.json({ simProgram: "abc" })}) RETURNING id`,
    );
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${ids.adapter}, 'speed_sp', 'D100', 'int', true)`;
    // final wave M5 — a PINNED stop tag (energy-reducing value pinned by an engineer) + the running connection's fingerprint
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value, stop_pinned_by, stop_pinned_at)
              VALUES (${ids.adapter}, 'stop_cmd', 'M0', 'bool', true, ${sql.json(true)}, ${String(OWNER)}, now())`;
    const { adapterTargetFingerprint } = await import("../../ot/adapterTarget");
    h.fingerprints.set(ids.adapter, adapterTargetFingerprint({ protocol: "stub", endpoint: "stub://o8", machineId: ids.machine, connectionOptions: { simProgram: "abc" } }));
  }, 60_000);

  afterAll(async () => {
    h.drivers.clear();
    for (const f of fixtures.splice(0)) await f.cleanup();
    const x = await d();
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `foe-${DAU}%`));
    await x.delete(aiPendingActions).where(and(eq(aiPendingActions.userId, OTHER), like(aiPendingActions.summary, "FOE orchestration:%")));
    if (sql) {
      await sql`DELETE FROM robot_jobs WHERE "robotId" = ${h.robotId}`.catch(() => undefined);
      if (ids.adapter) {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.adapter}`;
        await sql`DELETE FROM device_adapters WHERE id = ${ids.adapter}`;
      }
      if (ids.machine) await sql`DELETE FROM machines WHERE id = ${ids.machine}`;
      if (ids.station) await sql`DELETE FROM stations WHERE id = ${ids.station}`;
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
      await sql.end();
    }
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }, 60_000);

  beforeEach(async () => {
    sim = new StubDriver();
    await sim.connect({ endpoint: "stub://o8", options: { simProgram: "abc" } });
    writeCalls = 0;
    h.runJobCalls = 0;
    h.checksumReads = 0;
    h.probe = null;
    // the adapter's live driver: the sim's checksum, writes counted (the sim's own writeTags is disabled by design)
    h.drivers.set(ids.adapter, {
      protocol: "stub",
      isConnected: () => true,
      readProgramChecksum: async (o?: { signal?: AbortSignal }) => {
        h.checksumReads++;
        if (h.probe && sql) {
          const id = h.probe.actionId();
          const r = await sql
            .begin(async (tx) => {
              await tx`SELECT id FROM ai_pending_actions WHERE id = ${id ?? ""} FOR UPDATE NOWAIT`;
            })
            .then(
              () => "free",
              (e: { code?: string }) => String(e?.code ?? "error"),
            );
          h.probe.results.push(r);
        }
        return sim.readProgramChecksum(o);
      },
      async writeTags(writes: Array<{ tagKey: string }>) {
        writeCalls++;
        return writes.map((w) => ({ tagKey: w.tagKey, ok: true }));
      },
      async readTags() {
        return [];
      },
    });
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.OT_READBACK_ENABLED;
    delete process.env.OT_CMD_SERIALIZE_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.UNS_CMD_ACK_ENABLED;
    delete process.env.PARAM_GUARDRAIL_ENABLED;
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    delete process.env.FIELD_V2_ENABLED;
    delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  });

  it("★ O4 wiring: the production loader (loadEnabledAdapters) hands this adapter's connectionOptions to the REGISTERED sim driver ⇒ it reports the program checksum the approval binds", async () => {
    await import("../../ot/index"); // registers the built-in drivers ("stub" ⇒ StubDriver)
    const { loadEnabledAdapters } = await import("../../ot/deviceAdapter");
    const { readAdapterProgramCheck } = await import("../../ot/programChecksum");
    const mine = (await loadEnabledAdapters()).find((a) => a.adapterId === ids.adapter);
    expect(mine?.protocol).toBe("stub");
    await mine!.driver.connect(mine!.connection); // in-process sim: no socket, no port
    try {
      const check = await readAdapterProgramCheck({ id: ids.adapter, code: mine!.code, protocol: "stub", connectionOptions: mine!.connection.options }, { driverOf: () => mine!.driver });
      expect(check).toMatchObject({ status: "verified", checksum: "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" }); // FIPS 180-2 "abc"
    } finally {
      await mine!.driver.disconnect();
    }
  });

  it("control: program unchanged ⇒ OT dispatcher writes once; robot dispatcher runs once", async () => {
    const fx = await approvedRun("c0");
    const ot = await sendOt(fx);
    expect(ot.res.ok).toBe(true);
    expect(writeCalls).toBe(1);
    expect(await pendingStatus(ot.actionId)).toBe("executed");
    const rb = await sendRobot(fx);
    expect(rb.r.status).toBe("done");
    expect(h.runJobCalls).toBe(1);
  });

  it("★ O4 OT dispatcher: the PLC program changed after the approval ⇒ NOT_CONFIRMED (staleApproval), 0 writes, action not consumed", async () => {
    const fx = await approvedRun("otchg");
    sim.simLoadProgram("abc (edited on the controller)");
    const ot = await sendOt(fx);
    expect(ot.res.ok).toBe(false);
    expect(JSON.stringify(ot.res)).toMatch(/NOT_CONFIRMED/);
    expect(await otErrorText(ot.res)).toMatch(/^NOT_CONFIRMED: .*FOE_GATE_REQUIRED staleApproval/);
    expect(writeCalls).toBe(0);
    expect(await pendingStatus(ot.actionId)).toBe("confirmed");
  });

  it("★ O4 robot dispatcher: the same run's PLC program changed ⇒ NOT_CONFIRMED, 0 robot jobs, action not consumed", async () => {
    const fx = await approvedRun("rbchg");
    sim.simLoadProgram("another program");
    const rb = await sendRobot(fx);
    expect(rb.r).toMatchObject({ status: "rejected", error: "NOT_CONFIRMED" });
    expect(await robotErrorText(rb.r)).toMatch(/staleApproval/);
    expect(h.runJobCalls).toBe(0);
    expect(await pendingStatus(rb.actionId)).toBe("confirmed");
  });

  it("★ final wave M2: the program checksum is read BEFORE the reservation transaction — the action row is NOT locked during the read", async () => {
    const fx = await approvedRun("m2");
    h.checksumReads = 0;
    h.probe = { actionId: () => lastActionId, results: [] };
    const ot = await sendOt(fx);
    expect(ot.res.ok).toBe(true);
    expect(writeCalls).toBe(1);
    expect(h.probe.results.length).toBeGreaterThanOrEqual(1);
    expect(h.probe.results.every((r) => r === "free")).toBe(true); // inside the reservation it would be 55P03 (locked)
    expect(h.checksumReads).toBe(1); // ONE read, reused inside the transaction (not read again under the lock)
  });

  it("★ final wave NF-4: an IN-FLIGHT DUPLICATE (intent row of the key, no result) is refused WITHOUT any controller checksum read", async () => {
    const fx = await approvedRun("nf4");
    h.checksumReads = 0;
    const ot = await sendOt(fx, "set_param", { adapterId: ids.adapter, tagKey: "speed_sp", value: 7 }, async (key) => {
      // the write-ahead intent another call left for this key (WORM ledger row; key format = commandDispatcher intentKeyFor)
      await sql!`INSERT INTO command_log ("adapterId", "requestedBy", "confirmedBy", status, "tagKey", "idempotencyKey", "commandType")
                 VALUES (${ids.adapter}, ${OWNER}, ${OTHER}, 'sent', 'speed_sp', ${`intent:${key}:speed_sp:0`}, 'set_param')`;
    });
    expect(ot.res.ok).toBe(false);
    expect(JSON.stringify(ot.res)).toMatch(/DUPLICATE_IN_FLIGHT/);
    expect(writeCalls).toBe(0);
    expect(h.checksumReads).toBe(0); // a duplicate costs nothing
  });

  it("★ final wave M5 (a): an UNPINNED stop-typed write with the program changed after the approval ⇒ refused, 0 writes", async () => {
    const stopArgs = { adapterId: ids.adapter, writes: [{ tagKey: "speed_sp", value: 0 }] };
    const fx = await approvedRun("m5a", [{ id: "w", type: "command", machineId: ids.machine, command: "stop", args: stopArgs }]);
    sim.simLoadProgram("abc (edited on the controller)");
    const ot = await sendOt(fx, "stop", stopArgs);
    expect(ot.res.ok).toBe(false);
    expect(await otErrorText(ot.res)).toMatch(/FOE_GATE_REQUIRED staleApproval/);
    expect(writeCalls).toBe(0);
    expect(h.checksumReads).toBeGreaterThanOrEqual(1); // re-checked live (R-4-x: not a verified stop)
  });

  it("final wave M5 (a) control: the same unpinned stop with the program UNCHANGED is written", async () => {
    const stopArgs = { adapterId: ids.adapter, writes: [{ tagKey: "speed_sp", value: 0 }] };
    const fx = await approvedRun("m5c", [{ id: "w", type: "command", machineId: ids.machine, command: "stop", args: stopArgs }]);
    const ot = await sendOt(fx, "stop", stopArgs);
    expect(ot.res.ok).toBe(true);
    expect(writeCalls).toBe(1);
  });

  it("★ final wave M5 (b): a PINNED stop on a HUNG supported controller is SENT with ZERO checksum reads and no delay", async () => {
    const stopArgs = { adapterId: ids.adapter, writes: [{ tagKey: "stop_cmd", value: true }] };
    const fx = await approvedRun("m5b", [{ id: "w", type: "command", machineId: ids.machine, command: "stop", args: stopArgs }]);
    sim.simSetProgramReadFault("hang");
    h.checksumReads = 0;
    const t0 = Date.now();
    const ot = await sendOt(fx, "stop", stopArgs);
    expect(ot.res.ok).toBe(true);
    expect(writeCalls).toBe(1);
    expect(h.checksumReads).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000); // never waits on the 1 s checksum deadline
  });

  it("★ final wave M1: the approver screen's getRun reads NO controller for a run the caller cannot see (scope first); visible ⇒ read", async () => {
    const fx = await approvedRun("m1");
    await sql!`UPDATE orchestration_runs SET status = 'awaiting_confirm' WHERE id = ${fx.runId}`;
    const { getRun } = await import("./foeEngine");
    h.checksumReads = 0;
    expect(await getRun(fx.runId, { bindingDigest: true, visibleTo: async () => false })).toBeNull();
    expect(h.checksumReads).toBe(0);
    const v = await getRun(fx.runId, { bindingDigest: true, visibleTo: async () => true });
    expect(v?.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(h.checksumReads).toBe(1);
    expect(v?.programChecks?.find((c) => c.target === "adapter")).toMatchObject({ status: "verified", source: "sim" }); // M3
  });

  for (const [what, breakIt] of [
    ["read error", () => sim.simSetProgramReadFault("error")],
    ["no answer (hang)", () => sim.simSetProgramReadFault("hang")],
  ] as const) {
    it(`★ O4 FAIL CLOSED (${what}) on the supported adapter ⇒ both dispatchers refuse, bounded, nothing sent`, async () => {
      const fx = await approvedRun(`rf${what.length}`);
      breakIt();
      const t0 = Date.now();
      const ot = await sendOt(fx);
      expect(ot.res.ok).toBe(false);
      expect(await otErrorText(ot.res)).toMatch(/FOE_GATE_REQUIRED programUnreadable/);
      expect(writeCalls).toBe(0);
      expect(await pendingStatus(ot.actionId)).toBe("confirmed");
      const rb = await sendRobot(fx);
      expect(rb.r).toMatchObject({ status: "rejected", error: "NOT_CONFIRMED" });
      expect(await robotErrorText(rb.r)).toMatch(/programUnreadable/);
      expect(h.runJobCalls).toBe(0);
      expect(Date.now() - t0).toBeLessThan(10_000); // two reads, each ≤ 1000 ms, inside each reservation
    });
  }
});
