/**
 * doc 81 Đợt 9 tasks R1/R2/R4 (owner decision 2026-10-12, option A) — on the REAL `_test` DB (mig 0369: api_keys."holderUserId",
 * the trigger-written api_key_holder_changes, the write-once orchestration_runs."startedViaApiKeyId") and the REAL code of:
 *   • BOTH dispatchers (commandDispatcher.reserveRealWrite / robotCommandDispatcher.reserveRobotJob → foeApprovalDbRefusal
 *     inside their reservation transaction): the approval of an API-started run counts only when its approver is none of
 *     {starter, holder now, earlier holder, creator} — holder / creator / starter / earlier holder ⇒ NOT_CONFIRMED, nothing
 *     written, no robot job; a different user ⇒ written once / one job; a PINNED stop is sent whatever the approval (L-7);
 *   • the API v1 route POST /orchestration/runs + the real startRun: the run records the authenticated key (write-once) and
 *     its owner is the key's holder;
 *   • apiKeyRouter: list shows "issued to", create defaults it to the creator, setHolder is ADMIN-only, refuses an inactive
 *     user and is recorded (trigger history with the acting admin + reason, and audit_logs).
 * Device = the REAL simulation driver as the adapter's live driver (writes counted); robot = an in-process counting fake.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq, like } from "drizzle-orm";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";

const h = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  robotId: 990_900_000 + (Date.now() % 9_000),
  runJobCalls: 0,
  principal: null as null | Record<string, unknown>,
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
    listPlcConfigs: async () => [{ code: "R9-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
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
    getActiveConnectionFingerprint: (id: number) => h.fingerprints.get(id),
  };
});
// the HTTP route test: only the principal (requireScope) is replaced — the route handler, the engine and the DB are real
vi.mock("../../../api/v1/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../../api/v1/auth")>();
  return {
    ...orig,
    requireScope: () => (req: any, _res: any, next: any) => {
      req.apiPrincipal = h.principal;
      next();
    },
  };
});

import { getDb } from "../../../db/connection";
import { aiPendingActions, orchestrationRuns, orchestrationRunSteps, orchestrationWorkflows } from "../../../../drizzle/schema";
import { StubDriver } from "../../ot/drivers/stubDriver";
import { makeFoeGateRun, type FoeGateRunFixture } from "./__foeGateRunFixture";
import { FOE_API_RUN_PARAM } from "./foeGateApproval";

const DB_URL = process.env.DATABASE_URL;
const DAU = `R9DB-${Date.now()}`;
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
  "FOE_ENABLED",
  "FOE_SIM_GATE_REQUIRED",
] as const;
const saved: Record<string, string | undefined> = {};
const fixtures: FoeGateRunFixture[] = [];
const ids: Record<string, number> = {};
const u: Record<"creator" | "earlier" | "starter" | "holder" | "other" | "admin" | "eng" | "off", number> = {
  creator: 0, earlier: 0, starter: 0, holder: 0, other: 0, admin: 0, eng: 0, off: 0,
};
const keyIds: number[] = [];
let sql: ReturnType<typeof postgres> | null = null;
let sim: StubDriver;
let writeCalls = 0;
let seq = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}
async function otErrorText(res: unknown): Promise<string> {
  const ids2 = ((res as { detail?: { commandLogIds?: number[] } }).detail?.commandLogIds ?? []).map(Number);
  if (!sql || ids2.length === 0) return "";
  const rows = await sql`SELECT "errorText" FROM command_log WHERE id IN ${sql(ids2)}`;
  return rows.map((r) => String(r.errorText ?? "")).join(" | ");
}
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
/** A key created by `creator`, issued to `earlier`, then `starter` (the run starts), then re-issued to `holder` — by the TRIGGER. */
async function makeKey(tag: string, holderAtStart = u.starter): Promise<number> {
  const [k] = await sql!`INSERT INTO api_keys (name, "keyHash", "keyPrefix", scopes, "createdBy", "holderUserId")
                         VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}-hash`}, 'ak_r9', ${sql!.json(["orchestration:write"])}, ${u.creator}, ${u.earlier}) RETURNING id`;
  keyIds.push(Number(k.id));
  await sql!`UPDATE api_keys SET "holderUserId" = ${holderAtStart} WHERE id = ${k.id}`;
  return Number(k.id);
}
async function reissue(keyId: number, to: number) {
  await sql!.begin(async (tx) => {
    await tx`SELECT set_config('aoi.actor_user_id', ${String(u.admin)}, true)`;
    await tx`UPDATE api_keys SET "holderUserId" = ${to} WHERE id = ${keyId}`;
  });
}
/** A real run started (owner = holder at start) through `keyId`, whose gate `approvedBy` approved via the server path. */
async function apiRun(tag: string, keyId: number | null, approvedBy: number, steps?: Parameters<typeof makeFoeGateRun>[0]["steps"]) {
  // R fix 1 (#4) — the key is written IN THE INSERT (0369 refuses any later update of the column)
  const fx = await makeFoeGateRun({
    tag: `${DAU}-${tag}`,
    owner: u.starter,
    approvedBy,
    steps: steps ?? [{ id: "w", type: "command", machineId: ids.machine, command: "set_param", args: { adapterId: ids.adapter, tagKey: "speed_sp", value: 7 } }],
    api: { keyId },
  });
  fixtures.push(fx);
  return fx;
}
async function sendOt(fx: FoeGateRunFixture, approvedBy: number, cmdName = "set_param", args: Record<string, unknown> = { adapterId: ids.adapter, tagKey: "speed_sp", value: 7 }) {
  const { buildEquipmentCommand, ensureOrchestrationAction } = await import("./foeEngine");
  const { equipmentRegistry } = await import("../../equipment/equipmentAdapter");
  const user = { id: u.starter, role: "engineer" } as never;
  const key = `${DAU}-ot${++seq}-s1-a1`;
  const descriptor = { name: cmdName, label: "p", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
  const cap = { adapterKind: "ot-stub" } as never;
  const approval = { runId: fx.runId, runOwner: u.starter, approvedBy, gateStepId: "g0" };
  const cmd = buildEquipmentCommand(descriptor, cap, ids.machine, args, key, user, approval);
  await ensureOrchestrationAction(user, key, { id: `s${seq}`, type: "command" } as never, args, cmd, approval);
  const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
  return { res, actionId: cmd.hitl!.actionId };
}
async function sendRobot(fx: FoeGateRunFixture, approvedBy: number) {
  const { ensureOrchestrationAction } = await import("./foeEngine");
  const { toRobotJob } = await import("../../equipment/robotJobMapping");
  const { dispatchRobotJob } = await import("../../robot/robotCommandDispatcher");
  const key = `${DAU}-rb${++seq}`;
  const cmd = { name: "home", robotId: h.robotId, machineId: null, idempotencyKey: key, hitl: { actionId: "x", requestedBy: u.starter, confirmedBy: approvedBy } };
  const approval = { runId: fx.runId, runOwner: u.starter, approvedBy, gateStepId: "g0" };
  await ensureOrchestrationAction({ id: u.starter, role: "engineer", name: "t" }, key, { id: `s-${key}`, type: "command" } as never, {}, cmd as never, approval);
  const actionId = `foe-${key}`.slice(0, 64);
  const r = await dispatchRobotJob({ robotId: h.robotId, job: toRobotJob(cmd as never), triggerKind: "hitl", actionId, requestedBy: u.starter, confirmedBy: approvedBy, idempotencyKey: key });
  return { r, actionId };
}

describe.skipIf(!DB_URL)("doc 81 Đợt 9 R — API-key holder identity on the real dispatchers / route / router (CSDL _test, mig 0369)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await import("../../ot/adapterFacade");
    await import("../../ot/safetyTarget");
    await import("../../safety/plc/safetyPlcAdapter");
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    for (const [k, role, active] of [["creator", "engineer", true], ["earlier", "engineer", true], ["starter", "engineer", true], ["holder", "supervisor", true], ["other", "supervisor", true], ["admin", "admin", true], ["eng", "engineer", true], ["off", "engineer", false]] as const) {
      u[k] = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${k}`}, ${`${DAU}-${k}`}, ${`R9 ${k}`}, ${role}, ${active}) RETURNING id`);
    }
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + DAU}, 'R9 factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + DAU}, 'R9 ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + DAU}, 'R9 line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + DAU}, 'R9 st') RETURNING id`);
    ids.machine = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.station}, ${"M-" + DAU}, 'R9 m', 'AOI', true) RETURNING id`);
    ids.adapter = await one(
      sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId", "connectionOptions") VALUES (${"A-" + DAU}, 'R9 sim adapter', 'stub', 'stub://r9', true, ${ids.machine}, ${sql.json({ simProgram: "abc" })}) RETURNING id`,
    );
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${ids.adapter}, 'speed_sp', 'D100', 'int', true)`;
    await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, stop_value, stop_pinned_by, stop_pinned_at)
              VALUES (${ids.adapter}, 'stop_cmd', 'M0', 'bool', true, ${sql.json(true)}, ${String(u.starter)}, now())`;
    const { adapterTargetFingerprint } = await import("../../ot/adapterTarget");
    h.fingerprints.set(ids.adapter, adapterTargetFingerprint({ protocol: "stub", endpoint: "stub://r9", machineId: ids.machine, connectionOptions: { simProgram: "abc" } }));
  }, 60_000);

  afterAll(async () => {
    h.drivers.clear();
    for (const f of fixtures.splice(0)) await f.cleanup();
    const x = await d();
    await x.delete(aiPendingActions).where(like(aiPendingActions.id, `foe-${DAU}%`));
    await x.delete(aiPendingActions).where(and(eq(aiPendingActions.userId, u.other), like(aiPendingActions.summary, "FOE orchestration:%")));
    if (sql) {
      await sql`DELETE FROM robot_jobs WHERE "robotId" = ${h.robotId}`.catch(() => undefined);
      // runs / workflows started through the HTTP route (target-free workflow of this suite)
      const wfs = await sql`SELECT id FROM orchestration_workflows WHERE ref LIKE ${DAU + "%"}`;
      for (const w of wfs) {
        await x.delete(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, -1)); // no-op keeps the import honest
        const runs = await sql`SELECT id FROM orchestration_runs WHERE "workflowId" = ${w.id}`;
        for (const r of runs) {
          await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${r.id}`;
          await sql`DELETE FROM orchestration_runs WHERE id = ${r.id}`;
        }
        await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" = ${w.id}`.catch(() => undefined);
        await x.delete(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, Number(w.id)));
      }
      if (keyIds.length) await sql`DELETE FROM api_keys WHERE id IN ${sql(keyIds)}`; // history rows stay (WORM, documented)
      await sql`DELETE FROM api_keys WHERE name LIKE ${DAU + "%"}`;
      if (ids.adapter) {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.adapter}`;
        await sql`DELETE FROM device_adapters WHERE id = ${ids.adapter}`;
      }
      if (ids.machine) await sql`DELETE FROM machines WHERE id = ${ids.machine}`;
      if (ids.station) await sql`DELETE FROM stations WHERE id = ${ids.station}`;
      if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
      if (ids.workshop) await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
      const uids = Object.values(u).filter(Boolean);
      if (uids.length) await sql`DELETE FROM users WHERE id IN ${sql(uids)}`.catch(() => undefined); // audit_logs may reference (WORM)
      await sql.end();
    }
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }, 60_000);

  beforeEach(async () => {
    sim = new StubDriver();
    await sim.connect({ endpoint: "stub://r9", options: { simProgram: "abc" } });
    writeCalls = 0;
    h.runJobCalls = 0;
    h.drivers.set(ids.adapter, {
      protocol: "stub",
      isConnected: () => true,
      readProgramChecksum: async (o?: { signal?: AbortSignal }) => sim.readProgramChecksum(o),
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

  it("★ R1 schema: the TRIGGER records every holder of the key; the run's key is write-once for the application role", async () => {
    const k = await makeKey("schema");
    await reissue(k, u.holder);
    const hist = await sql!`SELECT "fromUserId", "toUserId", "changedBy" FROM api_key_holder_changes WHERE "apiKeyId" = ${k} ORDER BY id`;
    expect(hist.map((r) => [r.fromUserId, r.toUserId])).toEqual([
      [null, u.earlier],
      [u.earlier, u.starter],
      [u.starter, u.holder],
    ]);
    expect(hist[2].changedBy).toBe(u.admin);
    const fx = await apiRun("wo", k, u.other);
    const err = await sql!`UPDATE orchestration_runs SET "startedViaApiKeyId" = ${k + 1} WHERE id = ${fx.runId}`.then(
      () => null,
      (e: { code?: string }) => e?.code,
    );
    expect(err).toBe("23514");
    // R fix 1 (#4) — a LATE FIRST write (unidentified run ⇒ identified) is refused too
    const unident = await apiRun("wo2", null, u.other);
    const late = await sql!`UPDATE orchestration_runs SET "startedViaApiKeyId" = ${k} WHERE id = ${unident.runId}`.then(
      () => null,
      (e: { code?: string }) => e?.code,
    );
    expect(late).toBe("23514");
    const [still] = await sql!`SELECT "startedViaApiKeyId" AS v FROM orchestration_runs WHERE id = ${unident.runId}`;
    expect(still.v).toBeNull();
  });

  for (const who of ["starter", "holder", "earlier", "creator"] as const) {
    it(`★ R2 BOTH dispatchers: an API run whose gate the key's ${who.toUpperCase()} approved ⇒ NOT_CONFIRMED, 0 writes, 0 robot jobs, action not consumed`, async () => {
      const k = await makeKey(`p-${who}`);
      await reissue(k, u.holder);
      const fx = await apiRun(`p-${who}`, k, u[who]);
      const ot = await sendOt(fx, u[who]);
      expect(ot.res.ok).toBe(false);
      expect(await otErrorText(ot.res)).toMatch(who === "starter" ? /^NOT_CONFIRMED: .*run owner/ : /^NOT_CONFIRMED: .*approvedByKeyHolder/);
      expect(writeCalls).toBe(0);
      expect(await pendingStatus(ot.actionId)).toBe("confirmed");
      const rb = await sendRobot(fx, u[who]);
      expect(rb.r).toMatchObject({ status: "rejected", error: "NOT_CONFIRMED" });
      expect(await robotErrorText(rb.r)).toMatch(who === "starter" ? /run owner/ : /approvedByKeyHolder/);
      expect(h.runJobCalls).toBe(0);
    });
  }

  it("★ R2 BOTH dispatchers: a DIFFERENT user approved ⇒ the OT write goes out once and the robot job runs once", async () => {
    const k = await makeKey("ok");
    await reissue(k, u.holder);
    const fx = await apiRun("ok", k, u.other);
    const ot = await sendOt(fx, u.other);
    expect(ot.res.ok).toBe(true);
    expect(writeCalls).toBe(1);
    expect(await pendingStatus(ot.actionId)).toBe("executed");
    const rb = await sendRobot(fx, u.other);
    expect(rb.r.status).toBe("done");
    expect(h.runJobCalls).toBe(1);
  });

  it("★ R2 re-derived at dispatch time: the key re-issued to the approver AFTER the approval ⇒ refused by both dispatchers", async () => {
    const k = await makeKey("late");
    const fx = await apiRun("late", k, u.other);
    await reissue(k, u.other);
    const ot = await sendOt(fx, u.other);
    expect(ot.res.ok).toBe(false);
    expect(await otErrorText(ot.res)).toMatch(/approvedByKeyHolder/);
    const rb = await sendRobot(fx, u.other);
    expect(rb.r).toMatchObject({ status: "rejected", error: "NOT_CONFIRMED" });
    expect(writeCalls + h.runJobCalls).toBe(0);
  });

  it("★ R2 fail-closed: an API run with NO recorded key, or whose key was deleted ⇒ refused (apiRun) by both dispatchers", async () => {
    const none = await apiRun("nokey", null, u.other);
    expect(await otErrorText((await sendOt(none, u.other)).res)).toMatch(/apiRun/);
    const k = await makeKey("deleted");
    const gone = await apiRun("deleted", k, u.other);
    await sql!`DELETE FROM api_keys WHERE id = ${k}`;
    expect(await otErrorText((await sendOt(gone, u.other)).res)).toMatch(/apiRun/);
    expect(await robotErrorText((await sendRobot(gone, u.other)).r)).toMatch(/apiRun/);
    expect(writeCalls + h.runJobCalls).toBe(0);
  });

  it("★ L-7: a PINNED stop of an API run whose gate only the HOLDER approved is SENT (never gated by the approval rule)", async () => {
    const k = await makeKey("stop");
    await reissue(k, u.holder);
    const fx = await apiRun("stop", k, u.holder, [{ id: "s", type: "command", machineId: ids.machine, command: "stop", args: { adapterId: ids.adapter, writes: [{ tagKey: "stop_cmd", value: true }] } }]);
    const { buildEquipmentCommand, ensureOrchestrationAction } = await import("./foeEngine");
    const { equipmentRegistry } = await import("../../equipment/equipmentAdapter");
    const user = { id: u.holder, role: "supervisor" } as never;
    const key = `${DAU}-stop${++seq}`;
    const args = { adapterId: ids.adapter, writes: [{ tagKey: "stop_cmd", value: true }] };
    const descriptor = { name: "stop", label: "stop", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
    const cmd = buildEquipmentCommand(descriptor, { adapterKind: "ot-stub" } as never, ids.machine, args, key, user); // no approval: what the engine sends
    await ensureOrchestrationAction(user, key, { id: "s", type: "command" } as never, args, cmd);
    const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(writeCalls).toBe(1);
    void fx;
  });

  it("★ R1 HTTP + real startRun: POST /api/v1/orchestration/runs records the AUTHENTICATED key (write-once) and the holder as owner", async () => {
    process.env.FOE_ENABLED = "true";
    delete process.env.FOE_SIM_GATE_REQUIRED;
    const { deployWorkflow } = await import("./foeEngine");
    const ref = `${DAU}-route`.slice(0, 120);
    const dep = await deployWorkflow({ ref, name: "R9 route", steps: [{ id: "g", type: "hitl_gate", prompt: "p" }] }, { id: u.admin, role: "admin", name: "R9 admin" });
    expect(dep.ok, JSON.stringify(dep)).toBe(true);
    const k = await makeKey("route");
    await reissue(k, u.holder);
    const { createV1Router } = await import("../../../api/v1/router");
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createV1Router());
    const server: Server = await new Promise((resolve) => {
      const srv = createServer(app).listen(0, "127.0.0.1", () => resolve(srv));
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      h.principal = { kind: "api-key", name: "r9", scopes: ["orchestration:write"], apiKeyId: k, tenantScope: { mode: "global" } };
      const res = await fetch(`${base}/api/v1/orchestration/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflowRef: ref, params: { startedViaApiKeyId: k + 1, apiKeyId: k + 1 } }),
      });
      expect(res.status).toBe(202);
      const runId = ((await res.json()) as { data?: { runId?: number } }).data?.runId;
      expect(typeof runId).toBe("number");
      const [row] = await sql!`SELECT "startedBy", "startedViaApiKeyId" FROM orchestration_runs WHERE id = ${runId!}`;
      expect(row).toEqual({ startedBy: u.holder, startedViaApiKeyId: k });
      const [drow] = await (await d()).select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId!)).limit(1);
      expect((drow.paramsJson as Record<string, unknown>)[FOE_API_RUN_PARAM]).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("★ R1 apiKeyRouter: create ⇒ issued to the creator; list shows 'issued to'; setHolder is ADMIN-only, refuses an inactive user, and is recorded (history with actor + reason, audit_logs)", async () => {
    const { apiKeyRouter } = await import("../../../routers/apiKeyRouter");
    const ctx = (id: number, role: string) => ({ user: { id, role, name: `R9 ${role}`, twoFactorEnabled: true } }) as never;
    const admin = apiKeyRouter.createCaller(ctx(u.admin, "admin"));
    const created = await admin.create({ name: `${DAU}-minted`, scopes: ["orchestration:write"], dataScopeMode: "global" } as never);
    keyIds.push(created.id);
    expect(created).toMatchObject({ holderUserId: u.admin, holderRecorded: true, holderName: "R9 admin" });
    expect(JSON.stringify(created)).not.toMatch(/keyHash/);
    await expect(apiKeyRouter.createCaller(ctx(u.eng, "engineer")).setHolder({ id: created.id, holderUserId: u.eng, reason: "take it" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(admin.setHolder({ id: created.id, holderUserId: u.off, reason: "inactive" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const changed = await admin.setHolder({ id: created.id, holderUserId: u.holder, reason: "handed to the line team" });
    expect(changed).toMatchObject({ id: created.id, holderUserId: u.holder, holderName: "R9 holder" });
    const hist = await sql!`SELECT "fromUserId", "toUserId", "changedBy", reason FROM api_key_holder_changes WHERE "apiKeyId" = ${created.id} ORDER BY id`;
    expect(hist).toEqual([
      { fromUserId: null, toUserId: u.admin, changedBy: u.admin, reason: "default = creator" },
      { fromUserId: u.admin, toUserId: u.holder, changedBy: u.admin, reason: "handed to the line team" },
    ]);
    const audits = await sql!`SELECT details FROM audit_logs WHERE "entityType" = 'api_key' AND "entityId" = ${created.id} AND "userId" = ${u.admin}`;
    expect(audits.some((a) => JSON.stringify(a.details).includes("API_KEY_HOLDER_CHANGE") && JSON.stringify(a.details).includes("handed to the line team"))).toBe(true);
    const listed = (await admin.list()).find((r) => r.id === created.id);
    expect(listed).toMatchObject({ holderUserId: u.holder, holderName: "R9 holder", holderRecorded: true });
  });

  // ── doc 81 Đợt 9 R fix 1 — R-9-c on BOTH real dispatchers ──
  it("★ R-9-c BOTH dispatchers: the key REVOKED after the approval ⇒ NOT_CONFIRMED (apiKeyInactive), nothing sent; RE-ACTIVATED ⇒ sent", async () => {
    const k = await makeKey("revoked");
    const fx = await apiRun("revoked", k, u.other);
    await sql!`UPDATE api_keys SET "isActive" = false, "revokedAt" = now() WHERE id = ${k}`;
    const ot = await sendOt(fx, u.other);
    expect(ot.res.ok).toBe(false);
    expect(await otErrorText(ot.res)).toMatch(/^NOT_CONFIRMED: .*revoked \/ disabled now \(FOE_GATE_REQUIRED apiKeyInactive\)/);
    const rb = await sendRobot(fx, u.other);
    expect(rb.r).toMatchObject({ status: "rejected", error: "NOT_CONFIRMED" });
    expect(await robotErrorText(rb.r)).toMatch(/apiKeyInactive/);
    expect(writeCalls + h.runJobCalls).toBe(0);
    await sql!`UPDATE api_keys SET "isActive" = true, "revokedAt" = NULL WHERE id = ${k}`; // an admin re-activates it
    expect((await sendOt(fx, u.other)).res.ok).toBe(true);
    expect((await sendRobot(fx, u.other)).r.status).toBe("done");
    expect(writeCalls).toBe(1);
    expect(h.runJobCalls).toBe(1);
  });

  it("★ R-9-c BOTH dispatchers: the key EXPIRED ⇒ refused; extended ⇒ sent", async () => {
    const k = await makeKey("expired");
    const fx = await apiRun("expired", k, u.other);
    await sql!`UPDATE api_keys SET "expiresAt" = now() - interval '1 minute' WHERE id = ${k}`;
    expect(await otErrorText((await sendOt(fx, u.other)).res)).toMatch(/expired now \(FOE_GATE_REQUIRED apiKeyInactive\)/);
    expect(await robotErrorText((await sendRobot(fx, u.other)).r)).toMatch(/apiKeyInactive/);
    expect(writeCalls + h.runJobCalls).toBe(0);
    await sql!`UPDATE api_keys SET "expiresAt" = now() + interval '1 hour' WHERE id = ${k}`;
    expect((await sendOt(fx, u.other)).res.ok).toBe(true);
    expect(writeCalls).toBe(1);
  });

  it("★ L-7: a PINNED stop of a run whose key is revoked is still SENT", async () => {
    const k = await makeKey("stoprevoked");
    const fx = await apiRun("stoprevoked", k, u.other, [{ id: "s", type: "command", machineId: ids.machine, command: "stop", args: { adapterId: ids.adapter, writes: [{ tagKey: "stop_cmd", value: true }] } }]);
    await sql!`UPDATE api_keys SET "isActive" = false WHERE id = ${k}`;
    const { buildEquipmentCommand, ensureOrchestrationAction } = await import("./foeEngine");
    const { equipmentRegistry } = await import("../../equipment/equipmentAdapter");
    const user = { id: u.starter, role: "engineer" } as never;
    const key = `${DAU}-stop${++seq}`;
    const args = { adapterId: ids.adapter, writes: [{ tagKey: "stop_cmd", value: true }] };
    const descriptor = { name: "stop", label: "stop", paramsSchema: [], riskLevel: "low", requiredPermission: "machine_control/canEdit" } as never;
    const cmd = buildEquipmentCommand(descriptor, { adapterKind: "ot-stub" } as never, ids.machine, args, key, user);
    await ensureOrchestrationAction(user, key, { id: "s", type: "command" } as never, args, cmd);
    const res = await equipmentRegistry.getAdapter("ot-stub").sendCommand(cmd);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(writeCalls).toBe(1);
    void fx;
  });
});
