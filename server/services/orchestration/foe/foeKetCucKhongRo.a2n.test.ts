/**
 * SCADA R1b-2b-2a A2(n) (AN TOÀN, L-7) — unit half (no DB): an UNKNOWN command outcome never triggers a device write from a non-STOP
 * compensation. The REAL engine walks (startRun / resumeRun / abortRun / autoResumeInterruptedRuns) on an in-memory drizzle stand-in (the
 * T2B harness, foeKhongGuiLaiKhiKhongRo.r1b2b2.test.ts); only the dispatchers, the pinned-STOP predicate (phanLoaiStopGhimChoFoe — the
 * A2(h) shared predicate, its answer scripted here), the URGENT alert and the audit trail are recorded. The device oracle is the OT
 * dispatcher mock: every write that would leave the engine passes through it. The DB half (real dispatcher, S7 sim PDUs):
 * foeKetCucKhongRo.a2n.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { otDispatchMock, robotDispatchMock, ghimMock, alerts, audits } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] }) as Record<string, unknown>),
  robotDispatchMock: vi.fn(async () => ({ ok: true, status: "simulated" as const, jobId: 7 })),
  /** the A2(h) predicate's verdict per call (adapterId, commandType) — scripted per test */
  ghimMock: vi.fn(async (_d: unknown, _i: { adapterId: number; commandType: string }) => ({ pinnedStop: false, loiDocGhim: null as string | null })),
  alerts: [] as Array<Record<string, any>>,
  audits: [] as Array<Record<string, any>>,
}));
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, dispatch: otDispatchMock, phanLoaiStopGhimChoFoe: ghimMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return { ...orig, raiseCriticalStopAlert: async (a: Record<string, unknown>) => void alerts.push(a) };
});
vi.mock("../../auditTrailService", () => ({
  createAuditContext: (x: { user?: { id: number } }) => ({ userId: x.user?.id }),
  logCrudOperation: vi.fn(async (ctx: Record<string, unknown>, e: Record<string, unknown>) => {
    audits.push({ ...e, userId: ctx.userId });
    return { id: audits.length };
  }),
}));

// ── tiny in-memory drizzle stand-in (only the chains the engine uses) ──
import { getTableName } from "drizzle-orm";

type Row = Record<string, any>;
const store = new Map<string, Row[]>();
const seqs = new Map<string, number>();

function tbl(t: any): string {
  return getTableName(t);
}
function nextId(name: string): number {
  const n = (seqs.get(name) ?? 0) + 1;
  seqs.set(name, n);
  return n;
}
function rows(name: string): Row[] {
  let r = store.get(name);
  if (!r) {
    r = [];
    store.set(name, r);
  }
  return r;
}

// `eq`/`desc` are mocked to capture {col,val}; WHERE is applied as JS.
vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    desc: (col: any) => ({ __op: "desc", col }),
    // doc 80 ORC-01/02 — engine dùng UPDATE có điều kiện (and/ne/inArray/notInArray) + returning().
    and: (...conds: any[]) => ({ __op: "and", conds }),
    ne: (col: any, val: unknown) => ({ __op: "ne", col, val }),
    inArray: (col: any, vals: unknown[]) => ({ __op: "in", col, vals }),
    notInArray: (col: any, vals: unknown[]) => ({ __op: "notIn", col, vals }),
  };
});

function colName(col: any): string {
  return col?.name ?? col?.config?.name ?? String(col);
}
function matchCond(r: Row, cond: any): boolean {
  if (!cond) return true;
  switch (cond.__op) {
    case "eq": return r[colName(cond.col)] === cond.val;
    case "ne": return r[colName(cond.col)] !== cond.val;
    case "in": return cond.vals.includes(r[colName(cond.col)]);
    case "notIn": return !cond.vals.includes(r[colName(cond.col)]);
    case "and": return cond.conds.every((c: any) => matchCond(r, c));
    default: return true;
  }
}
function applyWhere(list: Row[], cond: any): Row[] {
  if (!cond) return list;
  return list.filter((r) => matchCond(r, cond));
}

function makeSelect(tableName: string) {
  let current = [...rows(tableName)];
  const chain: any = {
    from() {
      current = [...rows(tableName)];
      return chain;
    },
    where(cond: any) {
      current = applyWhere(current, cond);
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit(n: number) {
      return Promise.resolve(current.slice(0, n));
    },
    then(res: any, rej: any) {
      return Promise.resolve(current).then(res, rej);
    },
  };
  return chain;
}

const fakeDb = {
  select() {
    let tableName = "";
    const c: any = {
      from(t: any) {
        tableName = tbl(t);
        return makeSelect(tableName).from();
      },
    };
    return c;
  },
  insert(t: any) {
    const tableName = tbl(t);
    let pending: Row[] = [];
    const ins: any = {
      values(v: Row | Row[]) {
        const arr = Array.isArray(v) ? v : [v];
        pending = arr.map((row) => ({ id: nextId(tableName), ...row }));
        return ins;
      },
      returning() {
        rows(tableName).push(...pending);
        return Promise.resolve(pending);
      },
      onConflictDoUpdate(opts: any) {
        // upsert on (runId, stepId) for run_steps
        const list = rows(tableName);
        for (const row of pending) {
          const existing = list.find((r) => r.runId === row.runId && r.stepId === row.stepId);
          if (existing) Object.assign(existing, opts.set);
          else list.push(row);
        }
        return Promise.resolve();
      },
      then(res: any, rej: any) {
        rows(tableName).push(...pending);
        return Promise.resolve(pending).then(res, rej);
      },
    };
    return ins;
  },
  update(t: any) {
    const tableName = tbl(t);
    let patch: Row = {};
    const upd: any = {
      set(p: Row) {
        patch = p;
        return upd;
      },
      where(cond: any) {
        const matched = applyWhere(rows(tableName), cond);
        for (const r of matched) Object.assign(r, patch);
        const result = matched.map((r) => ({ ...r }));
        return {
          returning: () => Promise.resolve(result),
          then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
        };
      },
    };
    return upd;
  },
  // doc 81 Đợt 9 final wave F4 — the edge hand-back of an approval is one transaction; this in-memory fake runs the callback on
  // itself (no rollback modelled — the atomicity is measured on the real DB: edgeExecution.fw.dot9fw.db.test.ts).
  transaction(fn: (tx: unknown) => unknown) {
    return Promise.resolve().then(() => fn(fakeDb));
  },
};


vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb),
}));

import { permissions } from "../../../../drizzle/schema";
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";
import { abortRun, autoResumeInterruptedRuns, deployWorkflow, FOE_OUTCOME_UNKNOWN, getRun, resumeRun, startRun } from "./foeEngine";
import { edgeResumeStateOf } from "./foeRunStore";
import {
  CANH_BAO_KHONG_RO_KIND,
  KET_CUC_KHONG_RO_AUDIT_ACTION,
  KET_CUC_KHONG_RO_CTX_KEY,
  KHONG_RO_EDGE_ANOMALY,
  MA_KET_CUC_KHONG_RO,
  chiTietAnomalyKhongRo,
  dauKetCucKhongRoCua,
  docAnomalyKhongRo,
  loiLaKetCucKhongRo,
  maKetCucKhongRoCua,
  noiDungCanhBaoKhongRo,
} from "./foeKetCucKhongRo";
import { createEdgeRunStore } from "../../edge/edgeRunStore";
import { EDGE_HELD_REASONS, type EdgeRunPackage } from "../../edge/edgeProtocol";

const USER = { id: 42, role: "admin", name: "owner" };
const APPROVER = { id: 77, role: "admin", name: "approver" };
const ADMIN = { id: 78, role: "admin", name: "admin-on-site" };
const ENGINEER = { id: 79, role: "engineer", name: "engineer" };
const OPERATOR = { id: 80, role: "operator", name: "operator" };
const SYSTEM = { id: 0, role: "system", name: "system" };

function seed() {
  store.clear();
  seqs.clear();
  store.set("machines", [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 3, machineType: "AUTOMATION", capabilities: null, code: "M3", name: "Auto-3", operationStatus: "stopped", stationId: 1 },
  ]);
  store.set("device_adapters", [
    { id: 501, machineId: 1, isEnabled: true },
    { id: 503, machineId: 3, isEnabled: true },
  ]);
}

beforeEach(() => {
  seed();
  otDispatchMock.mockReset();
  otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : OK));
  ghimMock.mockReset();
  ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop", loiDocGhim: null }));
  alerts.length = 0;
  audits.length = 0;
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_DURABLE;
});

const OK = { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [1] } as Record<string, unknown>;
const TIMEOUT = { ok: false, simulated: false, status: "timeout", results: [], commandLogIds: [] } as Record<string, unknown>;
const REJECTED = { ok: false, simulated: false, status: "rejected", results: [], commandLogIds: [] } as Record<string, unknown>;

const main = (comp?: WorkflowStep, extra: Record<string, unknown> = {}): WorkflowStep => ({ id: "main", type: "command", machineId: 1, command: "start", ...(comp ? { compensation: comp } : {}), ...extra }) as WorkflowStep;
const stopComp = (id = "undo", machineId = 1): WorkflowStep => ({ id, type: "command", machineId, command: "stop" }) as WorkflowStep;
const resetComp = (id = "undo", machineId = 3): WorkflowStep => ({ id, type: "command", machineId, command: "reset" }) as WorkflowStep;
const seq = (id: string, steps: WorkflowStep[], comp?: WorkflowStep): WorkflowStep => ({ id, type: "sequence", steps, ...(comp ? { compensation: comp } : {}) }) as WorkflowStep;

let refN = 0;
/** deploy (gate0 first, approved by APPROVER ≠ owner), start as USER, approve the gate ⇒ the walk runs past it */
async function chay(steps: WorkflowStep[], before?: (runId: number) => void) {
  const ref = `a2n-${++refN}`;
  const d: WorkflowDefinition = { ref, name: ref, steps: [{ id: "gate0", type: "hitl_gate", prompt: "approve" } as WorkflowStep, ...steps] };
  expect((await deployWorkflow(d, USER)).ok).toBe(true);
  const r = await startRun(ref, {}, USER);
  expect(r.status).toBe("awaiting_confirm");
  before?.(r.runId!);
  const res = await resumeRun(r.runId!, { approved: true }, APPROVER);
  return { runId: r.runId!, res };
}
const runRow = (id: number) => rows("orchestration_runs").find((r) => r.id === id)!;
const step = async (runId: number, id: string) => (await getRun(runId))!.steps.find((s) => s.stepId === id);
const sent = (type?: string) => otDispatchMock.mock.calls.map((c) => String((c[0] as { commandType: unknown }).commandType)).filter((t) => !type || t === type);
const alertsOf = (loai: keyof typeof CANH_BAO_KHONG_RO_KIND) => alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND[loai]);
async function waitAlerts(n: number) {
  await vi.waitFor(() => expect(alerts.length).toBeGreaterThanOrEqual(n), { timeout: 3_000 });
}
function grant(user: { id: number }) {
  rows("permissions").push({ id: 900 + user.id, userId: user.id, category: "machine", moduleName: "machine_control", canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false, expiresAt: null });
}
async function giuKhongRo(steps: WorkflowStep[] = [main(resetComp())]) {
  const r = await chay(steps);
  expect(r.res.status).toBe("held");
  return r;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) n1 — the split by energy direction (outcome unknown × compensation kind)", () => {
  it("N1 unknown outcome + PINNED STOP compensation ⇒ sent automatically ONCE through the dispatcher, run failed as before, URGENT 'STOP compensation sent'", async () => {
    const { runId, res } = await chay([main(stopComp())]);
    expect(res.status).toBe("failed");
    expect(sent("start")).toHaveLength(1); // never re-sent
    expect(sent("stop")).toHaveLength(1); // the STOP compensation, once
    expect((await step(runId, "main"))?.error).toMatch(new RegExp(`^${FOE_OUTCOME_UNKNOWN}: `));
    expect((await step(runId, "undo"))?.status).toBe("compensated");
    await waitAlerts(1);
    expect(alertsOf("stopSent")).toHaveLength(1);
    expect(alertsOf("held")).toHaveLength(0);
    const a = alertsOf("stopSent")[0]!;
    expect(a.title).toBe(`Run ${runId}: command "main" outcome unknown — machine state unknown — STOP compensation sent ("undo")`);
    expect(a.dedupKey).toMatch(new RegExp(`^foe_outcome_unknown_stop_compensation_sent:${runId}:main:undo:`));
    expect(a.recipients).toContain(USER.id);
    expect(a.khuTrungBenVung).toEqual({});
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toBeUndefined(); // not held
  });

  it("N1b the pinned STOP compensation is sent but NOT confirmed ⇒ run failed (as before) + URGENT 'not confirmed'", async () => {
    otDispatchMock.mockImplementation(async () => TIMEOUT);
    const { runId, res } = await chay([main(stopComp())]);
    expect(res.status).toBe("failed");
    expect(sent("stop")).toHaveLength(1);
    expect((await step(runId, "undo"))?.status).toBe("failed");
    await waitAlerts(1);
    expect(alertsOf("stopNotConfirmed")).toHaveLength(1);
    expect(alertsOf("stopSent")).toHaveLength(0);
  });

  it("N2 unknown outcome + NON-STOP compensation (reset on ANOTHER machine) ⇒ 0 writes of it, run HELD + compensationHeld, URGENT 'waiting for a person'", async () => {
    const { runId, res } = await giuKhongRo();
    expect(sent("reset")).toHaveLength(0); // ★ nothing written to the device
    expect(sent("start")).toHaveLength(1);
    expect(ghimMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ adapterId: 503, commandType: "reset" }));
    const run = runRow(runId);
    expect(run.status).toBe("held");
    expect(String(run.error)).toMatch(/^FOE_OUTCOME_UNKNOWN: command "main" outcome unknown — machine state unknown — compensation "undo" waiting for a person/);
    expect(run.contextJson.foeResumeState).toEqual({ main: { state: "compensationHeld", error: expect.stringMatching(/^FOE_OUTCOME_UNKNOWN: /), khongRo: true } });
    expect(run.contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ stepId: "main", compId: "undo", ma: "FOE_OUTCOME_UNKNOWN" });
    expect((await step(runId, "main"))?.status).toBe("failed");
    expect(await step(runId, "undo")).toMatchObject({ status: "held", error: expect.stringMatching(/waiting for a person/) });
    await waitAlerts(1);
    expect(alertsOf("held")).toHaveLength(1);
    const a = alertsOf("held")[0]!;
    expect(a.title).toBe(`Run ${runId}: command "main" outcome unknown — machine state unknown — compensation "undo" waiting for a person`);
    expect(String(a.message)).toContain("NOT sent: the run is HELD");
    void res;
  });

  it("N3 pins UNREADABLE (predicate error / throws) ⇒ treated as non-STOP ⇒ held, 0 writes of the STOP compensation", async () => {
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: "pin read down (test)" }));
    const a = await giuKhongRo([main(stopComp())]);
    expect(sent("stop")).toHaveLength(0);
    expect(runRow(a.runId).contextJson.foeResumeState.main.state).toBe("compensationHeld");
    // decided BEFORE any authorisation: no authorisation row was ever minted for the held compensation
    expect(rows("ai_pending_actions").filter((r) => String(r.id).startsWith(`foe-run${a.runId}-undo-`))).toEqual([]);
    ghimMock.mockImplementation(async () => {
      throw new Error("db down (test)");
    });
    const b = await giuKhongRo([main(stopComp())]);
    expect(sent("stop")).toHaveLength(0);
    expect(runRow(b.runId).status).toBe("held");
    expect(rows("ai_pending_actions").filter((r) => String(r.id).startsWith(`foe-run${b.runId}-undo-`))).toEqual([]);
    // a stop-typed write the predicate says is NOT pinned (no pins on the tag) ⇒ held too
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
    await giuKhongRo([main(stopComp())]);
    expect(sent("stop")).toHaveLength(0);
  });

  it("N3b classified pinned, but the dispatch-time authorisation does NOT see a pinned STOP (pins changed) ⇒ never handed over, held", async () => {
    let n = 0;
    ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop" && ++n === 1, loiDocGhim: null })); // 1st = the split, 2nd = the store's
    const { runId } = await giuKhongRo([main(stopComp())]);
    expect(n).toBe(2);
    expect(sent("stop")).toHaveLength(0);
    expect(await step(runId, "undo")).toMatchObject({ status: "held" });
    await waitAlerts(1);
    expect(alertsOf("held")).toHaveLength(1);
    expect(alertsOf("stopSent")).toHaveLength(0);
  });

  it("N4 ANCESTOR container: non-STOP compensation ⇒ held; pinned-STOP one ⇒ runs; child STOP sent AND ancestor non-STOP held", async () => {
    const a = await giuKhongRo([seq("box", [main()], resetComp("boxUndo"))]);
    expect(sent("reset")).toHaveLength(0);
    expect(runRow(a.runId).contextJson.foeResumeState).toMatchObject({ box: { state: "compensationHeld", khongRo: true } });
    expect(runRow(a.runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ stepId: "box", compId: "boxUndo" });

    otDispatchMock.mockClear();
    const b = await chay([seq("box", [main()], stopComp("boxStop"))]);
    expect(b.res.status).toBe("failed");
    expect(sent("stop")).toHaveLength(1);

    otDispatchMock.mockClear();
    alerts.length = 0;
    const c = await giuKhongRo([seq("box", [main(stopComp("undo"))], resetComp("boxUndo"))]);
    expect(sent("stop")).toHaveLength(1); // the child's pinned STOP compensation went out by itself …
    expect(sent("reset")).toHaveLength(0); // … the ancestor's reset did not
    expect(await step(c.runId, "boxUndo")).toMatchObject({ status: "held" });
    await waitAlerts(2);
    expect(alertsOf("stopSent").map((x) => x.dedupKey)).toEqual([expect.stringContaining(`:${c.runId}:main:undo:`)]);
    expect(alertsOf("held").map((x) => x.dedupKey)).toEqual([expect.stringContaining(`:${c.runId}:box:boxUndo:`)]);

    // a PARALLEL (failFast) whose branch failed on an unknown outcome carries the flag to the parallel's own compensation
    otDispatchMock.mockClear();
    const d = await giuKhongRo([{ id: "par", type: "parallel", failFast: true, steps: [main()], compensation: resetComp("parUndo") } as WorkflowStep]);
    expect(sent("reset")).toHaveLength(0);
    expect(runRow(d.runId).contextJson.foeResumeState).toMatchObject({ par: { state: "compensationHeld", khongRo: true } });
  });

  it("N5 each unknown code takes the split: dispatch timeout, DUPLICATE_IN_FLIGHT, FOE_ROW_SPENT_FOR_KEY (FOE_OUTCOME_UNKNOWN) and EDGE_OUTCOME_UNKNOWN", async () => {
    for (const reason of ["DUPLICATE_IN_FLIGHT", "FOE_ROW_SPENT_FOR_KEY"]) {
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? { ...REJECTED, reason } : OK));
      otDispatchMock.mockClear();
      const { runId } = await giuKhongRo();
      expect(sent("reset"), reason).toHaveLength(0);
      expect(String((await step(runId, "main"))?.error), reason).toMatch(new RegExp(`^FOE_OUTCOME_UNKNOWN: ${reason}: `));
    }
    // EDGE_OUTCOME_UNKNOWN — central's walk of a run whose context names `main` sent-with-unknown-result (outcomeUnknownOf): never sent, split
    otDispatchMock.mockImplementation(async () => OK);
    otDispatchMock.mockClear();
    const { runId, res } = await chay([main(resetComp())], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeOutcomeUnknown: ["main"] };
    });
    expect(res.status).toBe("held");
    expect(sent()).toHaveLength(0);
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ ma: "EDGE_OUTCOME_UNKNOWN" });
    expect(String(runRow(runId).error)).toMatch(/^EDGE_OUTCOME_UNKNOWN: command "main" outcome unknown/);
  });

  it("N10 (n6) a KNOWN failure ⇒ its non-STOP compensation runs exactly as before (once), run failed, no A2(n) alert, no marker", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? REJECTED : OK));
    const { runId, res } = await chay([main(resetComp(), { maxAttempts: 1 })]);
    expect(res.status).toBe("failed");
    expect(sent("start")).toHaveLength(2); // retried as before
    expect(sent("reset")).toHaveLength(1);
    expect((await step(runId, "undo"))?.status).toBe("compensated");
    await new Promise((r) => setTimeout(r, 50));
    expect(alerts.filter((a) => String(a.kind).startsWith("foe_outcome_unknown"))).toHaveLength(0);
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toBeUndefined();
    // a known failure inside a container: the container's compensation runs as before too
    otDispatchMock.mockClear();
    const b = await chay([seq("box", [main()], resetComp("boxUndo"))]);
    expect(b.res.status).toBe("failed");
    expect(sent("reset")).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) n3 — resume v1 of a held run: Continue (person + machine-control rights + reason, audited) / Abort (no write)", () => {
  it("N6 refused — operator, engineer without machine_control, admin without a reason, the system user — nothing changes, nothing sent", async () => {
    const { runId } = await giuKhongRo();
    otDispatchMock.mockClear();
    const tiep = (u: { id: number; role: string; name: string }, note?: string) => resumeRun(runId, { approved: true, note }, u, {}, { scope: null });
    await expect(tiep(OPERATOR, "checked")).rejects.toThrow(/only a person with machine-control rights/);
    await expect(tiep(ENGINEER, "checked")).rejects.toThrow(/only a person with machine-control rights/);
    await expect(tiep(SYSTEM, "checked")).rejects.toThrow(/only a person with machine-control rights/);
    await expect(tiep(ADMIN)).rejects.toThrow(/reason is required/);
    await expect(tiep(ADMIN, "   ")).rejects.toThrow(/reason is required/);
    expect(runRow(runId).status).toBe("held");
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toBeTruthy();
    expect(sent()).toHaveLength(0);
    expect(audits.filter((a) => a.action === KET_CUC_KHONG_RO_AUDIT_ACTION)).toHaveLength(0);
  });

  it("N6 out of the decider's scope ⇒ 'not found' (the same answer as a missing run), before any role / reason check", async () => {
    const { runId } = await giuKhongRo();
    const r = await resumeRun(runId, { approved: true }, OPERATOR, {}, { scope: { tenantScope: {} } as never });
    expect(r).toMatchObject({ ok: false, message: `Run ${runId} not found.` });
    expect(runRow(runId).status).toBe("held");
  });

  it("N6 Continue by an engineer WITH machine_control + a reason ⇒ the held compensation runs ONCE, never the forward step; audited; marker cleared", async () => {
    const { runId } = await giuKhongRo();
    otDispatchMock.mockClear();
    grant(ENGINEER);
    const r = await resumeRun(runId, { approved: true, note: "checked on site: main was not applied" }, ENGINEER, {}, { scope: null });
    expect(r.status).toBe("failed");
    expect(sent()).toEqual(["reset"]); // ★ only the compensation; `start` never again
    expect((await step(runId, "undo"))?.status).toBe("compensated");
    const au = audits.filter((a) => a.action === KET_CUC_KHONG_RO_AUDIT_ACTION);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ entityType: "orchestration_run", entityId: runId, userId: ENGINEER.id, details: { operation: "foe_outcome_unknown_continue", metadata: { runId, stepId: "main", compId: "undo", reason: "checked on site: main was not applied", role: "engineer" } } });
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toBeUndefined();
    expect(runRow(runId).contextJson.foeResumeState.main).toMatchObject({ state: "doneFailed", khongRo: true });
  });

  it("N6 Abort ⇒ no write of the held compensation (only STOPs are swept), audited with the reason; a rejection the same", async () => {
    const a = await giuKhongRo();
    otDispatchMock.mockClear();
    const r = await abortRun(a.runId, ADMIN, "operator decided to stop", { scope: null });
    expect(runRow(a.runId).status).toBe("aborted");
    expect(sent("reset")).toHaveLength(0);
    void r;
    await vi.waitFor(() => expect(audits.filter((x) => x.action === KET_CUC_KHONG_RO_AUDIT_ACTION)).toHaveLength(1));
    expect(audits.find((x) => x.action === KET_CUC_KHONG_RO_AUDIT_ACTION)).toMatchObject({ details: { operation: "foe_outcome_unknown_abort", metadata: { via: "abort", reason: "operator decided to stop" } } });

    const b = await giuKhongRo();
    otDispatchMock.mockClear();
    await resumeRun(b.runId, { approved: false, note: "not safe" }, ADMIN, {}, { scope: null });
    expect(runRow(b.runId).status).toBe("aborted");
    expect(sent("reset")).toHaveLength(0);
    await vi.waitFor(() => expect(audits.filter((x) => x.action === KET_CUC_KHONG_RO_AUDIT_ACTION && x.details.metadata.via === "reject")).toHaveLength(1));
  });

  it("no automatic expiry into a write: the FOE_DURABLE auto-resume never continues such a run (even marked interrupted)", async () => {
    const { runId } = await giuKhongRo();
    runRow(runId).contextJson = { ...runRow(runId).contextJson, interrupted: true };
    process.env.FOE_DURABLE = "true";
    otDispatchMock.mockClear();
    const out = await autoResumeInterruptedRuns([runId]);
    expect(out.runIds).toEqual([]);
    expect(runRow(runId).status).toBe("held");
    expect(sent()).toHaveLength(0);
  });

  it("N7 a second interruption of the same run (the ancestor's compensation, after a Continue) ⇒ a second URGENT with its own key", async () => {
    const { runId } = await giuKhongRo([seq("box", [main(resetComp("undo"))], resetComp("boxUndo"))]);
    await waitAlerts(1);
    expect(alertsOf("held").map((a) => a.dedupKey)).toEqual([expect.stringContaining(`:${runId}:main:undo:`)]);
    grant(ENGINEER);
    otDispatchMock.mockClear();
    const r = await resumeRun(runId, { approved: true, note: "checked" }, ENGINEER, {}, { scope: null });
    expect(r.status).toBe("held"); // undo sent; the container's reset is held in its turn
    expect(sent()).toEqual(["reset"]);
    await waitAlerts(2);
    const keys = alertsOf("held").map((a) => a.dedupKey);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toContain(`:${runId}:box:boxUndo:`);
    expect(new Set(keys).size).toBe(2);
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ stepId: "box", compId: "boxUndo" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) — pure parts, the edge mirror (n5) and source pins", () => {
  it("the codes of the class = the engine's constant + the edge's; recognised as a word only", () => {
    expect(MA_KET_CUC_KHONG_RO).toEqual([FOE_OUTCOME_UNKNOWN, "EDGE_OUTCOME_UNKNOWN"]);
    expect(loiLaKetCucKhongRo("FOE_OUTCOME_UNKNOWN: DUPLICATE_IN_FLIGHT: …")).toBe(true);
    expect(loiLaKetCucKhongRo("Parallel branch failed: EDGE_OUTCOME_UNKNOWN: command …")).toBe(true);
    expect(loiLaKetCucKhongRo("XFOE_OUTCOME_UNKNOWN_Y")).toBe(false);
    expect(loiLaKetCucKhongRo("FOE_OUTCOME_PARTIAL: …")).toBe(false);
    expect(loiLaKetCucKhongRo(null)).toBe(false);
    expect(maKetCucKhongRoCua("x EDGE_OUTCOME_UNKNOWN: y")).toBe("EDGE_OUTCOME_UNKNOWN");
    expect(dauKetCucKhongRoCua({ [KET_CUC_KHONG_RO_CTX_KEY]: "garbage" })).toBeNull();
    expect(dauKetCucKhongRoCua({ [KET_CUC_KHONG_RO_CTX_KEY]: { bad: 1 } })).toMatchObject({ stepId: "?" }); // unreadable ⇒ still marked
  });

  it("n2 texts + dedup key per (run, step, compensation, event); the event is in the text too", () => {
    const n = noiDungCanhBaoKhongRo({ loai: "held", runId: 9, stepId: "X", compId: "Y", error: "FOE_OUTCOME_UNKNOWN: boom", lan: "L1" });
    expect(n.title).toBe('Run 9: command "X" outcome unknown — machine state unknown — compensation "Y" waiting for a person');
    expect(n.dedupKey).toBe("foe_outcome_unknown_compensation_held:9:X:Y:L1");
    expect(n.message).toMatch(/\[event L1\]$/);
    expect(noiDungCanhBaoKhongRo({ loai: "stopSent", runId: 9, stepId: "X", compId: "Y", error: "e", lan: "L1" }).title).toContain("STOP compensation sent");
    expect(noiDungCanhBaoKhongRo({ loai: "held", runId: 9, stepId: "X", compId: "Y", error: "e", lan: "L2" }).dedupKey).not.toBe(n.dedupKey);
  });

  it("the edge anomaly detail round-trips (bounded); garbage ⇒ null", () => {
    const d = chiTietAnomalyKhongRo({ loai: "held", stepId: "s", compId: "c", error: "x".repeat(5000), claimSeq: 4 });
    expect(d.length).toBeLessThanOrEqual(1000);
    expect(docAnomalyKhongRo(d)).toMatchObject({ loai: "held", stepId: "s", compId: "c", claimSeq: 4 });
    expect(docAnomalyKhongRo("{")).toBeNull();
    expect(docAnomalyKhongRo(JSON.stringify({ loai: "other", stepId: "s", compId: "c", claimSeq: 1 }))).toBeNull();
    expect(KHONG_RO_EDGE_ANOMALY).toMatch(/^[A-Z_]{1,64}$/);
  });

  it("N9 edge mirror: the held reason is in the protocol; the edge store's pinned-STOP answer = the package's VERIFIED OT stops only; its report = an anomaly + held(outcomeUnknown)", async () => {
    expect(EDGE_HELD_REASONS).toContain("outcomeUnknown");
    const events: Array<Record<string, any>> = [];
    const pkg = {
      runId: 5,
      claimSeq: 2,
      verifiedStops: [
        { kind: "ot", stepId: "otStop", adapterId: 501, pins: [] },
        { kind: "robot", stepId: "robotStop", robotId: 2 },
      ],
      stopsUnsure: ["unsure"],
      resolvedAdapters: [],
      prior: { abortSentBefore: [] },
      definition: { steps: [] },
      machines: [],
    } as unknown as EdgeRunPackage;
    const s = createEdgeRunStore(pkg, { runId: 5, claimSeq: 2, claimToken: "t", sink: { run: async () => ({ seq: 1 }), event: async (r) => (events.push(r as never), { seq: 1 }) }, authorize: { authorize: async () => ({ ok: false, verdict: "unavailable", code: null }) } });
    const cmd = (id: string) => ({ id, type: "command", machineId: 1, command: "stop" }) as WorkflowStep;
    expect(await s.buTruLaStopGhim({} as never, cmd("otStop"))).toBe(true);
    expect(await s.buTruLaStopGhim({} as never, cmd("robotStop"))).toBe(false);
    expect(await s.buTruLaStopGhim({} as never, cmd("unsure"))).toBe(false);
    expect(await s.buTruLaStopGhim({} as never, cmd("other"))).toBe(false);
    s.ketCucKhongRo({} as never, { loai: "held", stepId: "m", compId: "c", error: "FOE_OUTCOME_UNKNOWN: x", lan: "ignored" });
    await s.setStatusUnlessAborted(5, "held", { error: "e" });
    expect(s.segmentEnd()).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "anomaly", code: KHONG_RO_EDGE_ANOMALY, runId: 5 });
    expect(docAnomalyKhongRo(events[0]!.detail)).toMatchObject({ loai: "held", stepId: "m", compId: "c", claimSeq: 2 });
  });

  it("N8/N9 central's resume state from an EDGE run's rows carries the unknown flag (by the code in the step error) — a known failure does not", () => {
    const d = { ref: "x", name: "x", steps: [main(resetComp())] } as WorkflowDefinition;
    const r = (stepId: string, status: string, error: string | null = null) => ({ stepId, status, resultJson: null, error });
    expect(edgeResumeStateOf(d, [r("main", "failed", "EDGE_OUTCOME_UNKNOWN: command …"), r("undo", "held")], new Set()).state).toEqual({ main: { state: "compensationHeld", error: "EDGE_OUTCOME_UNKNOWN: command …", khongRo: true } });
    expect(edgeResumeStateOf(d, [r("main", "failed", "FOE_OUTCOME_UNKNOWN: x")], new Set()).state.main).toMatchObject({ state: "compensationHeld", khongRo: true });
    expect(edgeResumeStateOf(d, [r("main", "failed", "FOE_OUTCOME_UNKNOWN: x"), r("undo", "compensated")], new Set()).state.main).toMatchObject({ state: "doneFailed", khongRo: true });
    expect(edgeResumeStateOf(d, [r("main", "failed", "device refused")], new Set()).state.main).toEqual({ state: "compensationHeld", error: "device refused" });
  });

  it("source pins: one split point (execStep's failed branch); the known path untouched; the pinned-only hand-over check in execCommand", () => {
    const src = readFileSync(resolve(__dirname, "./foeEngine.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(src.split("buTruSauKetCucKhongRo(rc, step, step.compensation, loi)").length - 1).toBe(1);
    expect(src).toContain('if (failedOutcome.kind === "failed" && failedOutcome.khongRo === true) {');
    expect(src).toContain('if (rc.chiStopGhimIds?.has(step.id) && rc.store.kind === "central" && auth.stopGhim !== true) {');
    expect(src).toContain("if (KET_CUC_KHONG_RO_CTX_KEY in ctx) continue;");
    // the automatic STOP goes through the engine's own compensation path (runCompensation → execCommand → dispatcher), no shortcut
    const body = src.slice(src.indexOf("async function buTruSauKetCucKhongRo("), src.indexOf("async function giuBuTruKhongRo("));
    expect(body).toContain("c = await runCompensation(rc, step, loi);");
    expect(body).not.toMatch(/sendCommand|dispatch\(|getAdapter/);
  });
});
