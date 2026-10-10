/**
 * doc 81 Đợt 5 task E2 (item 26, owner decision 2026-10-10) — orchestration gets a FACTORY SCOPE. CSDL THẬT `_test`:
 * two real factories (A, B) with workshop → line → station → machine, robots by line, adapters by machine; users assigned
 * through user_factory_assignments; the REAL shared resolver (idsTrongPhamVi / resolveTenantFactoryScope).
 *
 * Rule (foeScope.ts header): deploy / rollback / delete ⇒ EVERY target in scope (STOPs included); start / approve / every
 * read ⇒ the NON-STOP targets in scope, outside ⇒ answered EXACTLY like "not found"; a target reached only by STOP steps
 * is allowed at start / approval (L-7) and audited. API keys: dataScopeMode NULL ⇒ 403, `factory` ⇒ its factory,
 * `global` ⇒ unrestricted. Non-user principals with no explicit scope (QT template loader) ⇒ empty scope.
 *
 * No device command is ever executed here: the commands sit in a branch that is never taken (params.go absent), so the
 * targets are real while the run only walks gates and delays.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// E fix 1 (review #18) — the app modules this suite boots announce themselves (DB / Redis / OAuth / SMTP / SLO / presence);
// those lines are boot noise for THIS suite, filtered here only (everything else, and every error, still prints).
vi.hoisted(() => {
  const BOOT = /^\[(Database|Redis|Presence|OAuth|Email Service|api\/v1 state)\]/;
  for (const k of ["log", "info", "warn", "error"] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => {
      if (typeof a[0] === "string" && BOOT.test(a[0])) return;
      orig(...a);
    };
  }
});

const audit = vi.hoisted(() => ({ calls: [] as Array<Record<string, any>> }));
vi.mock("../services/auditTrailService", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/auditTrailService")>();
  return {
    ...orig,
    logCrudOperation: vi.fn(async (_ctx: unknown, entry: Record<string, any>) => {
      audit.calls.push(entry);
      return { id: 1 };
    }),
  };
});
// API v1: only the principal is replaced (requireScope); requireDeclaredTenantScope + the routes are real.
const h = vi.hoisted(() => ({ principal: null as null | Record<string, unknown> }));
vi.mock("../api/v1/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/v1/auth")>();
  return {
    ...orig,
    requireScope: () => (req: any, _res: any, next: any) => {
      req.apiPrincipal = h.principal;
      next();
    },
  };
});

const DB_URL = process.env.DATABASE_URL;
const RUN = `d5e2${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
let sql: ReturnType<typeof postgres>;
const saved = { FOE_ENABLED: process.env.FOE_ENABLED };

type Fac = { code: string; factoryId: number; workshopId: number; lineId: number; stationId: number; machineId: number; robotMachineId: number; robotId: number; adapterId: number };
const fx = { A: null as Fac | null, B: null as Fac | null, orphanRobot: 0, edgeNode: 0, users: {} as Record<string, number> };
const refs: string[] = [];
const ref = (tag: string) => {
  const r = `${RUN}-${tag}`;
  refs.push(r);
  return r;
};

async function makeFactory(tag: string): Promise<Fac> {
  const code = `${RUN}-${tag}`;
  const one = async (q: Promise<any[]>) => Number((await q)[0].id);
  const factoryId = await one(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
  const workshopId = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factoryId}, ${`${code}-W`}, ${`${code}-W`}) RETURNING id`);
  const lineId = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshopId}, ${`${code}-L`}, ${`${code}-L`}) RETURNING id`);
  const stationId = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${lineId}, ${`${code}-S`}, ${`${code}-S`}) RETURNING id`);
  const machineId = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${stationId}, ${`${code}-M`}, ${`${code}-M`}, 'AUTOMATION') RETURNING id`);
  const robotMachineId = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${stationId}, ${`${code}-RM`}, ${`${code}-RM`}, 'ROBOT') RETURNING id`);
  const robotId = await one(sql`INSERT INTO robots (code, name, vendor, kind, endpoint, "lineId", "isEnabled") VALUES (${`${code}-R`}, ${`${code}-R`}, 'sim', 'arm', 'tcp://127.0.0.1:1', ${lineId}, true) RETURNING id`);
  const adapterId = await one(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled") VALUES (${machineId}, ${`${code}-AD`}, ${`${code}-AD`}, 'modbus', 'tcp://127.0.0.1:1', true) RETURNING id`);
  // E fix 1 (R-5-j) — a PINNED stop tag (stop_value) and an ordinary writable tag on the adapter.
  await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", stop_value, stop_pinned_by)
    VALUES (${adapterId}, 'estop', '1', 'bool', true, true, 'true'::jsonb, 'test'), (${adapterId}, 'run', '2', 'bool', true, true, NULL, NULL)`;
  return { code, factoryId, workshopId, lineId, stationId, machineId, robotMachineId, robotId, adapterId };
}

const ctxOf = (key: string, role = "engineer") => ({ user: { id: fx.users[key], role, name: key, twoFactorEnabled: true } }) as never;
const userOf = (key: string, role = "engineer") => ({ id: fx.users[key], role, name: key });

/** gate → branch(params.go) { commands } — the commands are TARGETS but are never executed. */
const defOf = (r: string, inner: any[], extra: any[] = []) => ({
  ref: r,
  name: r,
  steps: [
    { id: "g", type: "hitl_gate", prompt: "approve" },
    { id: "br", type: "branch", condition: { source: "param", key: "go", op: "eq", value: true }, then: inner },
    { id: "d", type: "delay", ms: 1 },
    ...extra,
  ],
}) as any;
const otStart = (id: string, f: () => Fac, args?: Record<string, unknown>) => ({ id, type: "command", machineId: f().machineId, command: "start", ...(args ? { args } : {}) });
/** E fix 1 (R-5-j) — a VERIFIED stop: writes exactly the adapter's pinned stop tag/value. */
const otStop = (id: string, f: () => Fac) => ({ id, type: "command", machineId: f().machineId, command: "stop", args: { adapterId: f().adapterId, writes: [{ tagKey: "estop", value: true }] } });
/** A stop-TYPED step that writes an UNPINNED tag (may energise anything — R-4-x): a NON-stop target for scope. */
const otStopUnpinned = (id: string, f: () => Fac) => ({ id, type: "command", machineId: f().machineId, command: "stop", args: { adapterId: f().adapterId, writes: [{ tagKey: "run", value: true }] } });
const rbMove = (id: string, f: () => Fac, robotId?: number) => ({ id, type: "command", machineId: f().robotMachineId, command: "start", args: { robotId: robotId ?? f().robotId } });
const A = () => fx.A!;
const B = () => fx.B!;
const ADMIN = { id: 0, role: "admin", name: "admin" };

describe.skipIf(!DB_URL)("doc 81 Đợt 5 task E2 — orchestration factory scope (CSDL _test, resolver THẬT)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    process.env.FOE_ENABLED = "true";
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    fx.A = await makeFactory("A");
    fx.B = await makeFactory("B");
    fx.orphanRobot = Number((await sql`INSERT INTO robots (code, name, vendor, kind, endpoint, "isEnabled") VALUES (${`${RUN}-ORPH`}, ${`${RUN}-ORPH`}, 'sim', 'arm', 'tcp://127.0.0.1:1', true) RETURNING id`)[0].id);
    for (const [key, role, fac] of [["ua", "engineer", "A"], ["ua2", "supervisor", "A"], ["ub", "engineer", "B"], ["adm", "admin", null]] as const) {
      const [u] = await sql`INSERT INTO users ("openId", username, name, role, "isActive", two_factor_enabled)
        VALUES (${`${RUN}-${key}`}, ${`${RUN}-${key}`}, ${`${RUN}-${key}`}, ${role}, true, true) RETURNING id`;
      fx.users[key] = Number(u.id);
      if (fac) await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${fx.users[key]}, ${fx[fac]!.code})`;
      for (const [category, module] of [["machine_control", "machine_control"], ["machine_monitoring", "machine_status"]]) {
        await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete")
          VALUES (${fx.users[key]}, ${category}, ${module}, true, true, true, true)`;
      }
    }
    ADMIN.id = fx.users.adm;
  });

  afterAll(async () => {
    if (sql) {
      const wfs = refs.length ? await sql`SELECT id FROM orchestration_workflows WHERE ref IN ${sql(refs)}` : [];
      const wfIds = wfs.map((w) => Number(w.id));
      if (wfIds.length) {
        const runs = await sql`SELECT id FROM orchestration_runs WHERE "workflowId" IN ${sql(wfIds)}`;
        const runIds = runs.map((r) => Number(r.id));
        if (runIds.length) {
          await sql`DELETE FROM orchestration_run_steps WHERE "runId" IN ${sql(runIds)}`;
          await sql`DELETE FROM orchestration_runs WHERE id IN ${sql(runIds)}`;
        }
        await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" IN ${sql(wfIds)}`;
        await sql`DELETE FROM orchestration_workflows WHERE id IN ${sql(wfIds)}`;
      }
      const uids = Object.values(fx.users);
      if (uids.length) {
        await sql`DELETE FROM permissions WHERE "userId" IN ${sql(uids)}`;
        await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(uids)}`;
        await sql`DELETE FROM users WHERE id IN ${sql(uids)}`;
      }
      for (const f of [fx.A, fx.B].filter(Boolean) as Fac[]) {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${f.adapterId}`;
        await sql`DELETE FROM device_adapters WHERE id = ${f.adapterId}`;
        await sql`DELETE FROM robots WHERE id = ${f.robotId}`;
        await sql`DELETE FROM machines WHERE id IN ${sql([f.machineId, f.robotMachineId])}`;
        await sql`DELETE FROM stations WHERE id = ${f.stationId}`;
        await sql`DELETE FROM production_lines WHERE id = ${f.lineId}`;
        await sql`DELETE FROM workshops WHERE id = ${f.workshopId}`;
        await sql`DELETE FROM factories WHERE id = ${f.factoryId}`;
      }
      if (fx.orphanRobot) await sql`DELETE FROM robots WHERE id = ${fx.orphanRobot}`;
      if (fx.edgeNode) await sql`DELETE FROM edge_nodes WHERE id = ${fx.edgeNode}`;
      await sql.end();
    }
    if (saved.FOE_ENABLED === undefined) delete process.env.FOE_ENABLED;
    else process.env.FOE_ENABLED = saved.FOE_ENABLED;
  });

  const engine = () => import("../services/orchestration/foe/foeEngine");
  const router = async (ctx: never) => (await import("./orchestrationRouter")).orchestrationRouter.createCaller(ctx);
  const wfRow = async (r: string) => (await sql`SELECT * FROM orchestration_workflows WHERE ref = ${r}`)[0];
  const runsOf = async (r: string) => sql`SELECT * FROM orchestration_runs WHERE "workflowRef" = ${r} ORDER BY id`;

  it("fixtures are real: A's user resolves to factory A only (the positive case is measurable)", async () => {
    const { idsTrongPhamVi } = await import("../db/hierarchy");
    const ids = await idsTrongPhamVi("machine", { userId: fx.users.ua, userRole: "engineer" });
    expect(ids).toContain(A().machineId);
    expect(ids).not.toContain(B().machineId);
  });

  it("★ deploy: every target in the deployer's scope — machine, robot, explicit adapter, orphan robot and a STOP of B are all refused; A-only deploys", async () => {
    const { deployWorkflow } = await engine();
    const ua = userOf("ua");
    expect((await deployWorkflow(defOf(ref("dep-a"), [otStart("a", A), rbMove("ra", A)]), ua)).ok).toBe(true);
    for (const [tag, inner, step] of [
      ["dep-mb", [otStart("a", A), otStart("b", B)], "b"],
      ["dep-stopb", [otStart("a", A), otStop("sb", B)], "sb"], // a STOP of B: deploy covers every step
      ["dep-adb", [otStart("x", A, { adapterId: B().adapterId })], "x"], // A's machine, but B's adapter
      ["dep-rb", [rbMove("r", A, B().robotId)], "r"],
      ["dep-orph", [rbMove("r", A, fx.orphanRobot)], "r"],
    ] as const) {
      const res = await deployWorkflow(defOf(ref(tag), inner as any), ua);
      expect(res, tag).toMatchObject({ ok: false, reason: "outOfScope", stepIds: [step] });
      expect(await wfRow(`${RUN}-${tag}`), `${tag} not persisted`).toBeUndefined();
    }
    // a telemetry precondition reading B is a target too
    const pre = await deployWorkflow(
      { ref: ref("dep-pre"), name: "pre", steps: [{ id: "d", type: "delay", ms: 1, precondition: { source: "telemetry", machineId: B().machineId, key: "x", op: "exists" } }] } as any,
      ua,
    );
    expect(pre).toMatchObject({ ok: false, reason: "outOfScope", stepIds: ["d"] });
    // admin: unchanged (unrestricted)
    expect((await deployWorkflow(defOf(ref("dep-adm"), [otStart("a", A), otStart("b", B)]), ADMIN)).ok).toBe(true);
  });

  it("★ deploy over an EXISTING ref of another factory is refused (refOutOfScope) — B's definition stays", async () => {
    const { deployWorkflow } = await engine();
    const r = ref("hijack");
    expect((await deployWorkflow(defOf(r, [otStart("b", B)]), userOf("ub"))).ok).toBe(true);
    const before = await wfRow(r);
    const res = await deployWorkflow(defOf(r, [otStart("a", A)]), userOf("ua"));
    expect(res).toMatchObject({ ok: false, reason: "refOutOfScope" });
    const after = await wfRow(r);
    expect(after.version).toBe(before.version);
    expect(JSON.stringify(after.definitionJson)).toBe(JSON.stringify(before.definitionJson));
  });

  it("★ start: a workflow with a NON-STOP target outside the starter's scope is 'not found' (identical to a missing ref), no run; STOP-only out of scope ⇒ starts + audited", async () => {
    const { deployWorkflow, startRun } = await engine();
    const rB = ref("start-b");
    const rStop = ref("start-stopb");
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    expect((await deployWorkflow(defOf(rStop, [otStart("a", A), otStop("sb", B)]), ADMIN)).ok).toBe(true);
    const missing = await startRun(`${RUN}-nope`, {}, userOf("ua"));
    const out = await startRun(rB, {}, userOf("ua"));
    expect(out).toEqual({ ...missing, message: missing.message!.replace(`${RUN}-nope`, rB) });
    expect(await runsOf(rB)).toHaveLength(0);
    // ⚠ the shape: { ok:false, enabled:true, message } — no reason / workflowStatus / stepIds that would tell it apart
    expect(Object.keys(out).sort()).toEqual(["enabled", "message", "ok"]);
    audit.calls.length = 0;
    const ok = await startRun(rStop, {}, userOf("ua"));
    expect(ok.status).toBe("awaiting_confirm");
    await vi.waitFor(() => expect(audit.calls.some((c) => c.details?.operation === "foe_stop_target_out_of_scope")).toBe(true));
    const entry = audit.calls.find((c) => c.details?.operation === "foe_stop_target_out_of_scope")!;
    expect(entry.details.metadata).toMatchObject({ stage: "start", runId: ok.runId, outOfScope: { machines: [B().machineId], adapters: [B().adapterId], robots: [] } });
    // the B user can start the B workflow
    expect((await startRun(rB, {}, userOf("ub"))).status).toBe("awaiting_confirm");
  });

  it("★ approval: an approver outside the run's scope gets the SAME answer as a missing run and changes nothing; an in-scope approver proceeds; a STOP-only target is audited", async () => {
    const { deployWorkflow, startRun, resumeRun } = await engine();
    const r = ref("approve");
    expect((await deployWorkflow(defOf(r, [otStart("a", A), otStop("sb", B)]), ADMIN)).ok).toBe(true);
    const started = await startRun(r, {}, userOf("ua"));
    expect(started.status).toBe("awaiting_confirm");
    const missing = await resumeRun(2_000_000_000, { approved: true }, userOf("ub"));
    const res = await resumeRun(started.runId!, { approved: true }, userOf("ub"));
    expect(res).toEqual({ ...missing, message: missing.message!.replace("2000000000", String(started.runId)) });
    const [row] = await sql`SELECT status, "currentStepId" FROM orchestration_runs WHERE id = ${started.runId!}`;
    expect(row).toMatchObject({ status: "awaiting_confirm", currentStepId: "g" });
    audit.calls.length = 0;
    const ok = await resumeRun(started.runId!, { approved: true }, userOf("ua2"));
    expect(ok.status).toBe("completed");
    await vi.waitFor(() => expect(audit.calls.some((c) => c.details?.metadata?.stage === "approve")).toBe(true));
  });

  it("★ reads: out-of-scope rows are exactly 'not found' (getRun, getWorkflow, getVersion, simulate, duplicate, delete) or absent (listRuns, listWorkflows, listVersions)", async () => {
    const { deployWorkflow, startRun } = await engine();
    const rB = ref("read-b");
    const rA = ref("read-a");
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    expect((await deployWorkflow(defOf(rA, [otStart("a", A)]), ADMIN)).ok).toBe(true);
    const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
    const runA = (await startRun(rA, {}, userOf("ua"))).runId!;
    const wfB = await wfRow(rB);
    const wfA = await wfRow(rA);
    const [verB] = await sql`SELECT id FROM orchestration_workflow_versions WHERE "workflowId" = ${wfB.id}`;
    const ua = await router(ctxOf("ua"));
    const err = async (p: () => Promise<unknown>) => {
      try {
        await p();
        return null;
      } catch (e: any) {
        return { code: e.code, message: String(e.message) };
      }
    };
    const same = async (outP: () => Promise<unknown>, missP: () => Promise<unknown>, outId: string, missId: string) => {
      const out = await err(outP);
      const miss = await err(missP);
      expect(out, "refused").not.toBeNull();
      expect({ ...out!, message: out!.message.replace(outId, "ID") }).toEqual({ ...miss!, message: miss!.message.replace(missId, "ID") });
    };
    const N = 2_000_000_000;
    await same(() => ua.getRun({ runId: runB }), () => ua.getRun({ runId: N }), String(runB), String(N));
    await same(() => ua.getWorkflow({ id: wfB.id }), () => ua.getWorkflow({ id: N }), String(wfB.id), String(N));
    await same(() => ua.getVersion({ id: Number(verB.id) }), () => ua.getVersion({ id: N }), String(verB.id), String(N));
    await same(() => ua.simulate({ workflowRef: rB, params: {} } as any), () => ua.simulate({ workflowRef: `${RUN}-zz`, params: {} } as any), rB, `${RUN}-zz`);
    await same(() => ua.duplicateWorkflow({ id: wfB.id, newRef: `${RUN}-dup` }), () => ua.duplicateWorkflow({ id: N, newRef: `${RUN}-dup` }), "", "");
    await same(() => ua.deleteWorkflow({ id: wfB.id }), () => ua.deleteWorkflow({ id: N }), "", "");
    expect(await wfRow(rB)).toBeDefined();
    const runs = (await ua.listRuns({ limit: 500 })) as Array<{ id: number }>;
    expect(runs.map((x) => x.id)).toContain(runA);
    expect(runs.map((x) => x.id)).not.toContain(runB);
    const wfs = (await ua.listWorkflows({ limit: 500 })) as Array<{ ref: string }>;
    expect(wfs.map((w) => w.ref)).toContain(rA);
    expect(wfs.map((w) => w.ref)).not.toContain(rB);
    expect(await ua.listVersions({ workflowId: wfB.id })).toEqual([]);
    expect((await ua.listVersions({ workflowId: wfA.id })).length).toBeGreaterThan(0);
    expect((await ua.getRun({ runId: runA })).run.id).toBe(runA);
    // admin: unchanged
    const adm = await router(ctxOf("adm", "admin"));
    expect((await adm.getRun({ runId: runB })).run.id).toBe(runB);
  });

  it("★ rollback of a workflow outside the actor's scope ⇒ identical to a missing snapshot; delete of a visible workflow with a B STOP ⇒ CONFLICT (deploy rule)", async () => {
    const { deployWorkflow, rollbackWorkflow } = await engine();
    const rB = ref("rb-b");
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    const wfB = await wfRow(rB);
    const out = await rollbackWorkflow(wfB.id, 1, userOf("ua"), "because");
    const miss = await rollbackWorkflow(wfB.id, 999, userOf("ub"), "because");
    expect(out).toEqual({ ...miss, message: miss.message!.replace("999", "1") });
    expect((await wfRow(rB)).version).toBe(wfB.version);
    const rS = ref("del-stopb");
    expect((await deployWorkflow(defOf(rS, [otStart("a", A), otStop("sb", B)]), ADMIN)).ok).toBe(true);
    const ua = await router(ctxOf("ua"));
    await expect(ua.deleteWorkflow({ ref: rS })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await wfRow(rS)).toBeDefined();
  });

  it("★ QT registration / system principals: no explicit scope ⇒ EMPTY scope — only target-free definitions deploy; every QT template is target-free", async () => {
    const { deployWorkflow } = await engine();
    const sys = { id: 0, role: "system", name: "qt-template-loader" };
    expect((await deployWorkflow({ ref: ref("sys-free"), name: "f", steps: [{ id: "g", type: "hitl_gate", prompt: "p" }] } as any, sys)).ok).toBe(true);
    expect(await deployWorkflow(defOf(ref("sys-a"), [otStart("a", A)]), sys)).toMatchObject({ ok: false, reason: "outOfScope" });
    const { listQtTemplates } = await import("../services/orchestration/templates/qtTemplates");
    const { collectTargets } = await import("../services/orchestration/foe/foeScope");
    for (const def of listQtTemplates()) {
      const t = collectTargets(def, new Map(), new Set());
      expect([t.machines.size, t.robots.size, t.adapters.size], def.ref).toEqual([0, 0, 0]);
    }
  });

  // ── doc 81 Đợt 5 task E2 fix (ruling R-5-d) — the sibling paths: abort, reject, edge assign / sync / nodeStatus. ──
  it("★ R-5-d abort + reject: a run of another factory ⇒ the SAME answer as a missing run (engine AND router), the run is untouched; the owners still abort / reject", async () => {
    const { deployWorkflow, startRun, resumeRun, abortRun } = await engine();
    const rB = ref("abort-b");
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
    const N = 2_000_000_000;
    const fix = (r: unknown, from: string) => JSON.stringify(r).split(from).join("ID");
    expect(fix(await abortRun(runB, userOf("ua"), "x"), String(runB))).toEqual(fix(await abortRun(N, userOf("ua"), "x"), String(N)));
    expect(fix(await resumeRun(runB, { approved: false, note: "no" }, userOf("ua")), String(runB))).toEqual(
      fix(await resumeRun(N, { approved: false, note: "no" }, userOf("ua")), String(N)),
    );
    const ua = await router(ctxOf("ua"));
    expect(fix(await ua.abortRun({ runId: runB, reason: "x" }), String(runB))).toEqual(fix(await ua.abortRun({ runId: N, reason: "x" }), String(N)));
    expect(fix(await ua.resumeRun({ runId: runB, approved: false, expectedStepId: "g" }), String(runB))).toEqual(
      fix(await ua.resumeRun({ runId: N, approved: false, expectedStepId: "g" }), String(N)),
    );
    const [row] = await sql`SELECT status FROM orchestration_runs WHERE id = ${runB}`;
    expect(row.status).toBe("awaiting_confirm");
    // the owner of the equipment (factory B) rejects / aborts as before
    expect((await resumeRun(runB, { approved: false, note: "no" }, userOf("ub"))).status).toBe("aborted");
    const runB2 = (await startRun(rB, {}, userOf("ub"))).runId!;
    expect((await abortRun(runB2, userOf("ub"), "stop")).status).toBe("aborted");
  });

  it("★ R-5-d edge: assignRun / syncRunResult on another factory's run ⇒ the coordinator's own 'not found' and NOTHING written; nodeStatus lists only visible runs", async () => {
    const saved = process.env.EDGE_RUNTIME_ENABLED;
    process.env.EDGE_RUNTIME_ENABLED = "true";
    try {
      const { deployWorkflow, startRun } = await engine();
      const rB = ref("edge-b");
      const rA = ref("edge-a");
      expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
      expect((await deployWorkflow(defOf(rA, [otStart("a", A)]), ADMIN)).ok).toBe(true);
      const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
      const runA = (await startRun(rA, {}, userOf("ua"))).runId!;
      fx.edgeNode = Number((await sql`INSERT INTO edge_nodes (code, name) VALUES (${`${RUN}-EN`}, ${`${RUN}-EN`}) RETURNING id`)[0].id);
      await sql`UPDATE orchestration_runs SET "edgeNodeId" = ${fx.edgeNode} WHERE id IN ${sql([runA, runB])}`;
      const edge = (await import("./edgeRuntimeRouter")).edgeRuntimeRouter.createCaller(ctxOf("ua"));
      const N = 2_000_000_000;
      const fix = (r: unknown, from: string) => JSON.stringify(r).split(from).join("ID");
      expect(fix(await edge.assignRun({ runId: runB, edgeNodeId: fx.edgeNode }), String(runB))).toEqual(fix(await edge.assignRun({ runId: N, edgeNodeId: fx.edgeNode }), String(N)));
      const sync = (runId: number) => edge.syncRunResult({ edgeNodeCode: `${RUN}-EN`, runId, status: "completed", steps: [{ stepId: "g", stepType: "hitl_gate", status: "completed", result: { approved: true } }] } as never);
      expect(fix(await sync(runB), String(runB))).toEqual(fix(await sync(N), String(N)));
      const [row] = await sql`SELECT status FROM orchestration_runs WHERE id = ${runB}`;
      expect(row.status).toBe("awaiting_confirm"); // the sync did not land
      const st = await edge.nodeStatus({ code: `${RUN}-EN` });
      expect((st.runs as Array<{ id: number }>).map((r) => r.id)).toEqual([runA]);
      // in scope: the sync lands
      expect((await sync(runA)).ok).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.EDGE_RUNTIME_ENABLED;
      else process.env.EDGE_RUNTIME_ENABLED = saved;
    }
  });

  // ── doc 81 Đợt 5 task E fix 1 ─────────────────────────────────────────────────────────────────────────────────────
  it("★ R-5-j: two users of factory A cannot drive an UNPINNED stop-typed write to factory B — refused at START (not found); a PINNED stop of B starts (audited) and A's other user can approve it", async () => {
    const { deployWorkflow, startRun, resumeRun } = await engine();
    const rU = ref("unpinned-b");
    const rP = ref("pinned-b");
    expect((await deployWorkflow(defOf(rU, [otStart("a", A), otStopUnpinned("ub", B)]), ADMIN)).ok).toBe(true);
    expect((await deployWorkflow(defOf(rP, [otStart("a", A), otStop("pb", B)]), ADMIN)).ok).toBe(true);
    const missing = await startRun(`${RUN}-nope2`, {}, userOf("ua"));
    const refused = await startRun(rU, {}, userOf("ua"));
    expect(refused).toEqual({ ...missing, message: missing.message!.replace(`${RUN}-nope2`, rU) });
    expect(await runsOf(rU)).toHaveLength(0);
    const ok = await startRun(rP, {}, userOf("ua"));
    expect(ok.status).toBe("awaiting_confirm");
    expect((await resumeRun(ok.runId!, { approved: true }, userOf("ua2"))).status).toBe("completed");
  });

  it("★ review #8: lists are filtered in SQL BEFORE the limit — limit 1 returns A's newest visible row even when B's row is newer", async () => {
    const { deployWorkflow, startRun } = await engine();
    const rA = ref("lim-a");
    const rB = ref("lim-b");
    expect((await deployWorkflow(defOf(rA, [otStart("a", A)]), ADMIN)).ok).toBe(true);
    const runA = (await startRun(rA, {}, userOf("ua"))).runId!;
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
    await sql`UPDATE orchestration_runs SET "createdAt" = now() + interval '2 day' WHERE id = ${runA}`;
    await sql`UPDATE orchestration_runs SET "createdAt" = now() + interval '3 day' WHERE id = ${runB}`;
    await sql`UPDATE orchestration_workflows SET "updatedAt" = now() + interval '2 day' WHERE ref = ${rA}`;
    await sql`UPDATE orchestration_workflows SET "updatedAt" = now() + interval '3 day' WHERE ref = ${rB}`;
    const ua = await router(ctxOf("ua"));
    expect(((await ua.listRuns({ limit: 1 })) as Array<{ id: number }>).map((r) => r.id)).toEqual([runA]);
    expect(((await ua.listWorkflows({ limit: 1 })) as Array<{ ref: string }>).map((w) => w.ref)).toEqual([rA]);
  });

  it("★ R-5-d gov: runEvents / replayRun of another factory's run ⇒ the SAME answer as a missing run; the owner reads them", async () => {
    const saved = process.env.FOE_DURABLE;
    process.env.FOE_DURABLE = "true";
    try {
      const { deployWorkflow, startRun } = await engine();
      const rB = ref("gov-b");
      expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
      const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
      const gov = async (key: string, role = "engineer") => (await import("./orchestrationGovRouter")).orchestrationGovRouter.createCaller(ctxOf(key, role));
      const N = 2_000_000_000;
      const ua = await gov("ua");
      expect(await ua.runEvents({ runId: runB })).toEqual(await ua.runEvents({ runId: N }));
      expect(JSON.stringify(await ua.replayRun({ runId: runB })).split(String(runB)).join("ID")).toBe(JSON.stringify(await ua.replayRun({ runId: N })).split(String(N)).join("ID"));
      await vi.waitFor(async () => expect((await (await gov("ub")).runEvents({ runId: runB })).length).toBeGreaterThan(0));
    } finally {
      if (saved === undefined) delete process.env.FOE_DURABLE;
      else process.env.FOE_DURABLE = saved;
    }
  });

  it("★ R-5-d oversight hub + 'mine': another factory's pending run is neither counted nor sampled for A; B's own user sees it", async () => {
    const { deployWorkflow, startRun, visibleWorkflowIds } = await engine();
    const rB = ref("hub-b");
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
    await sql`UPDATE orchestration_runs SET "updatedAt" = now() + interval '1 day' WHERE id = ${runB}`; // the newest sample
    const [ep] = await sql`SELECT ("pending_epoch")::text || ':' || coalesce("currentStepId", '') AS e FROM orchestration_runs WHERE id = ${runB}`;
    await sql`INSERT INTO engineering_assignments (entity_type, entity_id, assignee_user_id, assigned_by, pending_episode, active)
      VALUES ('orchestration_run', ${runB}, ${fx.users.ua}, ${fx.users.adm}, ${ep.e}, true), ('orchestration_run', ${runB}, ${fx.users.ub}, ${fx.users.adm}, ${ep.e}, false)`;
    try {
      const hub = async (key: string, role = "engineer") => (await import("./oversightRouter")).oversightRouter.createCaller(ctxOf(key, role)).pendingSummary();
      const sA = await hub("ua");
      expect(sA.orchestration.samples.map((x: { id: number }) => x.id)).not.toContain(runB);
      expect(sA.mine.orchestration.count).toBe(0); // assigned to A's user, but out of A's scope
      // the count is the caller's count: equal to an independent SQL count over A's visible workflows
      const ids = (await visibleWorkflowIds({ userId: fx.users.ua, userRole: "engineer" }))!;
      const [{ c }] = await sql`SELECT count(*)::int AS c FROM orchestration_runs WHERE status IN ('held','awaiting_confirm') AND "workflowId" = ANY(${sql.array(ids.length ? ids : [-1])}::int[])`;
      expect(sA.orchestration.count).toBe(c);
      const sAdm = await hub("adm", "admin");
      expect(sAdm.orchestration.samples.map((x: { id: number }) => x.id)).toContain(runB);
      expect(sAdm.orchestration.count).toBeGreaterThan(sA.orchestration.count);
    } finally {
      // engineering_assignments: avi_app may not DELETE (same as engineeringAssignment.db.test) ⇒ deactivate
      await sql`UPDATE engineering_assignments SET active = false WHERE entity_type = 'orchestration_run' AND entity_id = ${runB} AND active`;
    }
  });

  it("★ R-5-d assignment: assigning / unassigning / reading assignments of another factory's run ⇒ the SAME refusal as a missing run; an assignee who cannot see the run is refused", async () => {
    const { deployWorkflow, startRun } = await engine();
    const rB = ref("asg-b");
    const rA = ref("asg-a");
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    expect((await deployWorkflow(defOf(rA, [otStart("a", A)]), ADMIN)).ok).toBe(true);
    const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
    const runA = (await startRun(rA, {}, userOf("ua"))).runId!;
    try {
      const eng = async (key: string, role = "engineer") => (await import("./engineeringAssignmentRouter")).engineeringAssignmentRouter.createCaller(ctxOf(key, role));
      const ua = await eng("ua");
      const N = 2_000_000_000;
      const err = async (f: () => Promise<unknown>) => {
        try {
          await f();
          return null;
        } catch (e: any) {
          return { code: e.code, message: String(e.message) };
        }
      };
      const asg = (id: number) => () => ua.assign({ entityType: "orchestration_run", entityId: id, assigneeUserId: fx.users.ua2, expectedAssigneeUserId: null });
      const out = await err(asg(runB));
      const miss = await err(asg(N));
      expect(out?.code).toBe("NOT_FOUND");
      expect({ ...out!, message: out!.message.replace(String(runB), "ID") }).toEqual({ ...miss!, message: miss!.message.replace(String(N), "ID") });
      // the ASSIGNER's scope decides even when the assignee could see the run (admin assignee)
      const viaAdmin = await err(() => ua.assign({ entityType: "orchestration_run", entityId: runB, assigneeUserId: fx.users.adm, expectedAssigneeUserId: null }));
      expect(viaAdmin?.code).toBe("NOT_FOUND");
      const un = (id: number) => () => ua.unassign({ entityType: "orchestration_run", entityId: id, expectedAssigneeUserId: fx.users.ua2 });
      expect(await err(un(runB))).toEqual(await err(un(N)));
      // a LIVE assignment of B's run (made by an admin) is not listed for A's user
      const adm = await eng("adm", "admin");
      expect((await adm.assign({ entityType: "orchestration_run", entityId: runB, assigneeUserId: fx.users.ub, expectedAssigneeUserId: null })).entityId).toBe(runB);
      expect((await adm.assignments({ entityType: "orchestration_run", entityIds: [runB] })).map((r: { entityId: number }) => r.entityId)).toEqual([runB]);
      expect(await ua.assignments({ entityType: "orchestration_run", entityIds: [runB] })).toEqual([]);
      // an assignee who cannot see the run (B's user for A's run) ⇒ the generic invalid-assignee refusal
      const bad = await err(() => ua.assign({ entityType: "orchestration_run", entityId: runA, assigneeUserId: fx.users.ub, expectedAssigneeUserId: null }));
      expect(bad?.code).toBe("BAD_REQUEST");
      // in scope: works
      expect((await ua.assign({ entityType: "orchestration_run", entityId: runA, assigneeUserId: fx.users.ua2, expectedAssigneeUserId: null })).entityId).toBe(runA);
      expect((await ua.assignments({ entityType: "orchestration_run", entityIds: [runA] })).map((r: { entityId: number }) => r.entityId)).toEqual([runA]);
      const rowsB = await sql`SELECT assignee_user_id FROM engineering_assignments WHERE entity_type = 'orchestration_run' AND entity_id = ${runB}`;
      expect(rowsB.map((r) => Number(r.assignee_user_id))).toEqual([fx.users.ub]); // only the admin's assignment
    } finally {
      await sql`UPDATE engineering_assignments SET active = false WHERE entity_type = 'orchestration_run' AND entity_id IN ${sql([runA, runB])} AND active`;
      await sql`DELETE FROM notifications WHERE "userId" IN ${sql([fx.users.ua2])} AND "entityType" = 'engineering_orchestration_run'`.catch(() => undefined);
    }
  });

  it("★ API v1: dataScopeMode NULL ⇒ 403 on every orchestration route; a factory-A key cannot deploy B targets, sees a B run as 404 (same body as missing), starts a B workflow like a missing ref; a global key is unrestricted", async () => {
    const { deployWorkflow, startRun } = await engine();
    const rB = ref("api-b");
    expect((await deployWorkflow(defOf(rB, [otStart("b", B)]), ADMIN)).ok).toBe(true);
    const runB = (await startRun(rB, {}, userOf("ub"))).runId!;
    const { createV1Router } = await import("../api/v1/router");
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createV1Router());
    const server: Server = await new Promise((resolve) => {
      const srv = createServer(app).listen(0, "127.0.0.1", () => resolve(srv));
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const call = async (method: string, path: string, body?: unknown) => {
        const r = await fetch(`${base}/api/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: r.status, body: (await r.json()) as any };
      };
      const key = (tenantScope: Record<string, unknown>) => ({ kind: "api-key", name: "k", scopes: ["orchestration:write", "orchestration:read"], apiKeyId: 0, tenantScope });
      h.principal = key({ mode: null, corporateCode: null, factoryCode: null });
      for (const [m, p, b] of [
        ["POST", "/orchestration/workflows", defOf(`${RUN}-x`, [])],
        ["POST", "/orchestration/runs", { workflowRef: rB }],
        ["GET", `/orchestration/runs/${runB}`, undefined],
        ["POST", "/orchestration/simulate", { workflowRef: rB }],
        ["POST", "/edge/sync", { runId: runB, status: "completed" }], // E2 fix (R-5-d)
      ] as const) {
        const r = await call(m, p, b);
        expect(r.status, p).toBe(403);
        expect(r.body.error?.code ?? r.body.code ?? JSON.stringify(r.body), p).toContain("tenant_scope_undeclared");
        // E fix 1 (review #15) — the sentence names what the key cannot do HERE (not the BI "read any figures")
        expect(JSON.stringify(r.body), p).toContain("deploy, start, read or sync orchestration runs");
        expect(JSON.stringify(r.body), p).not.toContain("read any figures");
      }
      h.principal = key({ mode: "factory", corporateCode: null, factoryCode: A().code });
      const dep = await call("POST", "/orchestration/workflows", defOf(ref("api-dep-b"), [otStart("b", B)]));
      expect(dep.status).toBe(400);
      expect(JSON.stringify(dep.body)).toContain("outOfScope");
      expect(await wfRow(`${RUN}-api-dep-b`)).toBeUndefined();
      const got = await call("GET", `/orchestration/runs/${runB}`);
      const miss = await call("GET", `/orchestration/runs/2000000000`);
      expect(got.status).toBe(404);
      expect(JSON.stringify(got.body).replace(String(runB), "ID")).toBe(JSON.stringify(miss.body).replace("2000000000", "ID"));
      const runs0 = (await runsOf(rB)).length;
      const st = await call("POST", "/orchestration/runs", { workflowRef: rB });
      const stMiss = await call("POST", "/orchestration/runs", { workflowRef: `${RUN}-none` });
      expect(st.status).toBe(stMiss.status);
      expect(st.body.data).toEqual(stMiss.body.data);
      expect((await runsOf(rB)).length).toBe(runs0);
      const sim = await call("POST", "/orchestration/simulate", { workflowRef: rB });
      expect(sim.status).toBe(404);
      // E2 fix (R-5-d) — an edge sync of B's run with A's key ⇒ the same refusal as a missing run, nothing written
      const prevEdge = process.env.EDGE_RUNTIME_ENABLED;
      process.env.EDGE_RUNTIME_ENABLED = "true";
      try {
        const syncB = await call("POST", "/edge/sync", { runId: runB, status: "completed" });
        const syncMiss = await call("POST", "/edge/sync", { runId: 2000000000, status: "completed" });
        expect(syncB.status).toBe(syncMiss.status);
        expect(JSON.stringify(syncB.body).replace(String(runB), "ID")).toBe(JSON.stringify(syncMiss.body).replace("2000000000", "ID"));
        expect((await sql`SELECT status FROM orchestration_runs WHERE id = ${runB}`)[0].status).toBe("awaiting_confirm");
      } finally {
        if (prevEdge === undefined) delete process.env.EDGE_RUNTIME_ENABLED;
        else process.env.EDGE_RUNTIME_ENABLED = prevEdge;
      }
      h.principal = key({ mode: "global", corporateCode: null, factoryCode: null });
      expect((await call("GET", `/orchestration/runs/${runB}`)).status).toBe(200);
      expect((await call("POST", "/orchestration/workflows", defOf(ref("api-glob"), [otStart("b", B)]))).status).toBe(201);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
