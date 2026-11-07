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

const { otDispatchMock, robotDispatchMock, ghimMock, alerts, audits, HX } = vi.hoisted(() => ({
  /** T2 — alertBen: what the alert reports through baoBen, null ⇔ it says nothing; alertNem: it throws. I-2 — this step-row write throws (a DB error on the unknown path); I-C — it never answers; m-6 — the audit row is not written; M-5 — the run's context write throws */
  HX: { rowThrows: null as null | ((r: Record<string, any>) => boolean), rowHangs: null as null | ((r: Record<string, any>) => boolean), rowSlowMs: null as null | ((r: Record<string, any>) => number), auditFails: false, contextThrows: false, alertBen: true as boolean | null, alertNem: false },
  otDispatchMock: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] }) as Record<string, unknown>),
  robotDispatchMock: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true, status: "done", jobId: 7 }) as Record<string, unknown>),
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
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: Record<string, any>) => {
      alerts.push(a);
      if (HX.alertNem) throw new Error("alert down (test)");
      if (HX.alertBen !== null) a.baoBen?.(HX.alertBen);
    },
  };
});
vi.mock("../../auditTrailService", () => ({
  createAuditContext: (x: { user?: { id: number } }) => ({ userId: x.user?.id }),
  logCrudOperation: vi.fn(async (ctx: Record<string, unknown>, e: Record<string, unknown>) => {
    if (HX.auditFails) return { id: -1 }; // what logCrudOperation answers when it swallowed a failure
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
        for (const row of pending) if (HX.rowThrows?.(row)) return Promise.reject(new Error("step row write failed (test)"));
        for (const row of pending) if (HX.rowHangs?.(row)) return new Promise(() => undefined);
        const apply = () => {
          for (const row of pending) {
            const existing = list.find((r) => r.runId === row.runId && r.stepId === row.stepId);
            if (existing) Object.assign(existing, opts.set);
            else list.push(row);
          }
        };
        const cham = Math.max(0, ...pending.map((row) => HX.rowSlowMs?.(row) ?? 0));
        if (cham > 0) return new Promise<void>((r) => setTimeout(() => (apply(), r()), cham));
        apply();
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
        if (HX.contextThrows && tableName === "orchestration_runs" && patch.status === undefined && patch.contextJson !== undefined) throw new Error("context write failed (test)");
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
import { abortRun, autoResumeInterruptedRuns, deployWorkflow, FOE_NOT_SENT_RUN_LATCHED, FOE_OUTCOME_UNKNOWN, getRun, resumeRun, startRun } from "./foeEngine";
import { baoCaoHopLe, baoCaoKhongRoTuHang, chuBuTruTrongDinhNghia, dauKhongRoTuBaoCao, duongToiBuoc, edgeResumeStateOf, loiKhongGuiChot, themBuocHongKhiTiepTuc, toTienCua } from "./foeRunStore";
import {
  KHONG_RO_DANG_BAY_AUDIT_OP,
  buTruBiChanKhongRo,
  chotTuHang,
  CANH_BAO_KHONG_RO_KIND,
  KET_CUC_KHONG_RO_AUDIT_ACTION,
  KET_CUC_KHONG_RO_CHOT_CTX_KEY,
  KET_CUC_KHONG_RO_CTX_KEY,
  KHONG_RO_DUYET_CTX_KEY,
  KHONG_RO_EDGE_ANOMALY,
  MA_KET_CUC_KHONG_RO,
  chiTietAnomalyKhongRo,
  dauKetCucKhongRoCua,
  docAnomalyKhongRo,
  loiLaKetCucKhongRo,
  maKetCucKhongRoCua,
  noiDungCanhBaoKhongRo,
  KHONG_RO_KHONG_NGUOI_NHAN_AUDIT_OP,
  canhBaoKetCucKhongRo,
  canhBaoTuAnomalyEdge,
  canhBaoTuBaoCaoEdge,
  ganBaoCaoKhongRoEdge,
  KHONG_CO_BU_TRU,
  tachBaoCaoKhongRoEdge,
  nhanBuocSauChot,
  type BangChungBuoc,
  type NhanSauChot,
} from "./foeKetCucKhongRo";
import { goiYRunDangGiu } from "../../../routers/oversightRouter";
import { createEdgeRunStore } from "../../edge/edgeRunStore";
import { EDGE_HELD_REASONS, type EdgeRunPackage } from "../../edge/edgeProtocol";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";

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
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  store.set("device_adapters", [
    { id: 501, machineId: 1, isEnabled: true },
    { id: 503, machineId: 3, isEnabled: true },
  ]);
  store.set("robots", [{ id: 2, code: "R2", vendor: "sim", endpoint: "tcp://10.0.0.2:1", connectionOptions: { port: 1 }, isEnabled: true, status: "online" }]);
}

beforeEach(() => {
  seed();
  otDispatchMock.mockReset();
  otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : ACKED));
  robotDispatchMock.mockClear();
  HX.rowThrows = null;
  HX.rowHangs = null;
  HX.rowSlowMs = null;
  HX.auditFails = false;
  HX.contextThrows = false;
  HX.alertBen = true;
  HX.alertNem = false;
  ghimMock.mockReset();
  ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop", loiDocGhim: null }));
  alerts.length = 0;
  audits.length = 0;
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_DURABLE;
});

const OK = { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [1] } as Record<string, unknown>;
const ACKED = { ok: true, simulated: false, status: "acked", results: [], commandLogIds: [1] } as Record<string, unknown>;
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
    await new Promise((r) => setTimeout(r, 50)); // a second alert would be in flight
    expect(alertsOf("noCompensation")).toHaveLength(0); // the STOP's URGENT said it (R-4 is for nothing due)
    const a = alertsOf("stopSent")[0]!;
    expect(a.title).toBe(`Run ${runId}: command "main" outcome unknown — machine state unknown — STOP compensation sent ("undo")`);
    expect(String(a.message)).not.toContain("simulated");
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
    expect(String(a.message)).toContain("could not be confirmed as a STOP"); // m-2 — never "not a STOP" when the pins may be unreadable
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

  it("K1 a first STOP pass never takes a command's own compensation: pinned when classified, not at its dispatch, its failed branch slow: the split holds it, the run ends held", async () => {
    let n = 0;
    ghimMock.mockImplementation(async (_d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (++n === 1) return { pinnedStop: true, loiDocGhim: null };
      await new Promise((r) => setTimeout(r, 40));
      return { pinnedStop: false, loiDocGhim: null };
    });
    HX.rowSlowMs = (r) => (r.stepId === "main" && r.status === "failed" ? 30 : 0);
    const { runId } = await giuKhongRo([main(stopComp())]);
    expect(sent("stop")).toHaveLength(0);
    expect(await step(runId, "undo")).toMatchObject({ status: "held" });
  });

  // K2: a pass holds a container's STOP compensation while the container's failure arrives (ms = 30: in flight), or after it answered (ms = 90), or the failure first (ms = 0)
  const denK2 = (dang: "khongGhim" | "docLoi", ms: number, ghimDung: () => boolean = () => false) => {
    let n = 0;
    ghimMock.mockImplementation(async (_d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      if (ghimDung() || ++n === 1) return { pinnedStop: true, loiDocGhim: null };
      await new Promise((r) => setTimeout(r, 40));
      return dang === "khongGhim" ? { pinnedStop: false, loiDocGhim: null } : { pinnedStop: false, loiDocGhim: "pin read timed out (test)" };
    });
    HX.rowSlowMs = (r) => (r.stepId === "main" && r.status === "failed" ? ms : 0);
    return chay([seq("box", [main()], stopComp())]);
  };
  for (const dang of ["khongGhim", "docLoi"] as const) {
    it(`K2 ${dang}, both orders, 10 laps: the compensation's held row holds the run: a late failure never ends it`, async () => {
      const dem = new Map<string, number>();
      for (const ms of [0, 30, 90]) {
        for (let lap = 0; lap < 10; lap++) {
          alerts.length = 0;
          otDispatchMock.mockClear();
          const { runId } = await denK2(dang, ms);
          await new Promise((r) => setTimeout(r, 60));
          const k = `run=${runRow(runId).status} stop=${sent("stop").length} undo=${(await step(runId, "undo"))?.status}`;
          dem.set(k, (dem.get(k) ?? 0) + 1);
        }
      }
      console.log(`[PROBE K2-dua ${dang}]`, JSON.stringify([...dem]));
      expect([...dem]).toEqual([["run=held stop=0 undo=held", 30]]);
    });
    {
      it(`K2 ${dang}, Continue: the URGENT names it: the read recovered, it works, the STOP goes once, no 'not resumable', no 'already terminal'`, async () => {
        let hoi = false;
        const { runId } = await denK2(dang, 30, () => hoi);
        await new Promise((r) => setTimeout(r, 60));
        expect(runRow(runId).status).toBe("held");
        expect(alertsOf("held").length).toBeGreaterThan(0);
        hoi = true;
        HX.rowSlowMs = null;
        otDispatchMock.mockClear();
        grant(APPROVER);
        const r = await resumeRun(runId, { approved: true, note: "checked on site" }, APPROVER);
        expect(String(r.message ?? "")).not.toMatch(/not resumable|already terminal/);
        await vi.waitFor(() => expect(sent("stop")).toHaveLength(1));
        await new Promise((r2) => setTimeout(r2, 30));
        expect(sent("stop")).toHaveLength(1);
      });
    }
  }
  it("K2 đối chứng: pinned at both reads: the STOP goes, the run ends failed, not held", async () => {
    const { runId } = await denK2("khongGhim", 30, () => true);
    await new Promise((r) => setTimeout(r, 60));
    expect(sent("stop")).toHaveLength(1);
    expect(runRow(runId).status).toBe("failed");
  });
  it("K2-DOC-T5 pins unreadable at the dispatch of a split STOP on a latched run: it goes to the dispatcher on the marked row, it is not held (foeEngine chiStopGhimIds check; T5)", async () => {
    const { runId } = await denK2("docLoi", 30);
    await new Promise((r) => setTimeout(r, 60));
    expect(sent("stop")).toHaveLength(1);
    expect(runRow(runId).status).toBe("failed");
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
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? REJECTED : ACKED));
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

  it("N9 edge mirror: the held reason is in the protocol; the edge store's STOP answer = the package's VERIFIED stops; its report = an anomaly + held(outcomeUnknown)", async () => {
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
    expect(await s.buTruLaStopGhim({} as never, cmd("robotStop"))).toBe(true); // R-2
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
    // S-1 — two callers of the one gate; runCompensation's callers are the gate, the STOP send and the boot re-send (a pinned STOP or nothing)
    expect(src.split("await congBuTru(rc, step, step.compensation,").length - 1).toBe(2);
    expect(src.split("runCompensation(rc,").length - 1).toBe(5); // congBuTru ×3, guiStopKhongRo, the boot re-send
    expect(src).toContain("const khongRoLoi = loiKhongRoRun(rc, step, failedOutcome);");
    expect(src).toContain('if (rc.chiStopGhimIds?.has(step.id) && rc.store.kind === "central" && !robotKind && auth.stopGhim !== true) {');
    expect(src).toContain("if (buTruKhongRoCho(ctx).length > 0) continue;"); // extension (2): a latched run with no hold is walked (the forward sink), the marker skips
    // the automatic STOP goes through the engine's own compensation path (runCompensation → execCommand → dispatcher), no shortcut
    const body = src.slice(src.indexOf("async function guiStopKhongRo("), src.indexOf("function loaiGuiStop("));
    expect(body).toContain("c = await runCompensation(rc, step, loi);");
    expect(body).not.toMatch(/sendCommand|dispatch\(|getAdapter/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) fix round 1 — review C-1, C-2, I-1..I-5, rulings R-1..R-4, minors", () => {
  const pause = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "pause", ...extra }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", steps, ...extra }) as WorkflowStep;
  const gate = (id: string): WorkflowStep => ({ id, type: "hitl_gate", prompt: "x" }) as WorkflowStep;
  const robotComp = (id: string, command: string, args: Record<string, unknown>): WorkflowStep => ({ id, type: "command", machineId: 2, command, args: { robotId: 2, ...args } }) as WorkflowStep;
  const tiep = (runId: number, u: { id: number; role: string; name: string }, note?: string) => resumeRun(runId, { approved: true, note }, u, {}, { scope: null });

  it("C-1 a held child never blocks an ancestor's STOP: seq(box){main{reset}} + STOP on box ⇒ 1 STOP now, 0 reset, run stays held, URGENT; Continue ⇒ the reset once, the STOP NOT re-sent", async () => {
    const { runId } = await giuKhongRo([seq("box", [main(resetComp("undo"))], stopComp("boxStop"))]);
    expect(sent("stop")).toHaveLength(1); // ★ without a person
    expect(sent("reset")).toHaveLength(0);
    expect(runRow(runId).status).toBe("held");
    expect((await step(runId, "boxStop"))?.status).toBe("compensated");
    await waitAlerts(2);
    expect(alertsOf("stopSent").map((a) => a.dedupKey)).toEqual([expect.stringContaining(`:${runId}:box:boxStop:`)]);
    expect(alertsOf("held").map((a) => a.dedupKey)).toEqual([expect.stringContaining(`:${runId}:main:undo:`)]);
    otDispatchMock.mockClear();
    const r = await tiep(runId, ADMIN, "checked: the reset is safe");
    expect(r.status).toBe("failed");
    expect(sent()).toEqual(["reset"]); // ★ the STOP is not sent again, hours later, over a machine someone restarted
  });

  it("C-1 the same behind a PARALLEL with a compensation; a NON-STOP ancestor stays due (not sent at the hold)", async () => {
    const a = await giuKhongRo([par("p", [main(resetComp("undo"))], { failFast: true, compensation: stopComp("pStop") })]);
    expect(sent("stop")).toHaveLength(1);
    expect(runRow(a.runId).status).toBe("held");
    otDispatchMock.mockClear();
    await giuKhongRo([seq("box", [main(resetComp("undo"))], resetComp("boxUndo"))]);
    expect(sent("reset")).toHaveLength(0);
  });

  it("C-2 (a) a gate in a SIBLING branch: the run is HELD (not awaiting_confirm), the approval needs the n3 check — role and reason — and nothing is written before", async () => {
    const { runId } = await chay([par("p", [main(resetComp("undo")), gate("g2")], { failFast: true })]);
    expect(runRow(runId).status).toBe("held");
    otDispatchMock.mockClear();
    await expect(tiep(runId, OPERATOR, "x")).rejects.toThrow(/machine-control rights/);
    await expect(tiep(runId, ADMIN)).rejects.toThrow(/reason is required/);
    await expect(tiep(runId, SYSTEM, "x")).rejects.toThrow(/machine-control rights/);
    expect(sent()).toHaveLength(0);
  });

  it("C-2 the check keys on the RESUME STATE, whatever the status and with no marker: awaiting_confirm + a pending held compensation ⇒ refused without person + reason", async () => {
    const { runId } = await giuKhongRo();
    const r = runRow(runId);
    const { [KET_CUC_KHONG_RO_CTX_KEY]: _sin, ...ctx } = r.contextJson;
    r.contextJson = ctx;
    r.status = "awaiting_confirm";
    r.currentStepId = "gate0";
    otDispatchMock.mockClear();
    await expect(tiep(runId, ADMIN)).rejects.toThrow(/reason is required/);
    await expect(tiep(runId, SYSTEM, "x")).rejects.toThrow(/machine-control rights/);
    expect(sent()).toHaveLength(0);
  });

  it("I-1 a STOP-typed forward step whose outcome stays unknown (every attempt timed out) ⇒ its NON-STOP compensation is held too (0 reset), URGENT, the row carries the code", async () => {
    otDispatchMock.mockImplementation(async () => TIMEOUT);
    const { runId, res } = await chay([{ id: "main", type: "command", machineId: 1, command: "stop", maxAttempts: 2, compensation: resetComp() } as WorkflowStep]);
    expect(res.status).toBe("held");
    expect(sent("stop")).toHaveLength(3); // it keeps its retries (L-7)
    expect(sent("reset")).toHaveLength(0);
    expect((await step(runId, "main"))?.error).toMatch(/^FOE_OUTCOME_UNKNOWN: /);
    await waitAlerts(1);
    expect(alertsOf("held")).toHaveLength(1);
  });

  it("I-2 a thrown FAILED row write keeps the flag: the ancestor's reset is held, not sent as a known failure, URGENT", async () => {
    HX.rowThrows = (r) => r.stepId === "main" && r.status === "failed";
    const { runId, res } = await chay([seq("box", [main()], resetComp("boxUndo"))]);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
    await waitAlerts(1);
    expect(alertsOf("held").map((a) => a.dedupKey)).toEqual([expect.stringContaining(`:${runId}:box:boxUndo:`)]);
  });

  it("I-2 a thrown HELD row write of the compensation: the run still ends held, the URGENT went; a thrown RESULT row of the unknown dispatch: not retried, still the class", async () => {
    HX.rowThrows = (r) => r.stepId === "undo";
    const a = await chay([main(resetComp())]);
    expect(a.res.status).toBe("held");
    expect(runRow(a.runId).contextJson.foeResumeState.main.state).toBe("compensationHeld");
    await waitAlerts(1);
    HX.rowThrows = (r) => r.stepId === "main" && r.status === "running" && r.resultJson != null;
    otDispatchMock.mockClear();
    const b = await chay([main(resetComp(), { maxAttempts: 2 })]);
    expect(b.res.status).toBe("held");
    expect(sent("start")).toHaveLength(1);
    expect(sent("reset")).toHaveLength(0);
  });

  it("I-3 + m-1 the URGENT says what really happened: simulated ⇒ 'simulated — NOT sent' (never 'sent'); refused by the device ⇒ not confirmed; never handed over ⇒ 'NOT sent'", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : OK)); // OT control off: simulated
    const a = await chay([main(stopComp())]);
    await waitAlerts(1);
    expect(alertsOf("stopSent")).toHaveLength(0);
    expect(alertsOf("stopSimulated")).toHaveLength(1);
    expect(alertsOf("stopSimulated")[0]!.title).toBe(`Run ${a.runId}: command "main" outcome unknown — machine state unknown — STOP compensation "undo" simulated — NOT sent (OT control off)`);
    alerts.length = 0;
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : REJECTED));
    await chay([main(stopComp())]);
    await waitAlerts(1);
    expect(alertsOf("stopNotConfirmed")).toHaveLength(1);
    alerts.length = 0;
    expect(noiDungCanhBaoKhongRo({ loai: "stopNotHanded", runId: 9, stepId: "X", compId: "Y", error: "e", lan: "L" }).message).not.toContain("handed to the dispatcher but");
  });

  it("m-1 an abort landing between the classification and the dispatch: nothing handed over ⇒ the URGENT says NOT sent, never 'handed to the dispatcher'", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : ACKED));
    ghimMock.mockImplementation(async (_d, i) => {
      if (i.commandType === "stop") {
        const id = rows("orchestration_runs").at(-1)!.id as number;
        await abortRun(id, ADMIN, "abort meanwhile", { scope: null });
      }
      return { pinnedStop: i.commandType === "stop", loiDocGhim: null };
    });
    const { runId } = await chay([main(stopComp())]);
    await waitAlerts(1);
    expect(alertsOf("stopNotHanded").map((a) => a.dedupKey)).toEqual([expect.stringContaining(`:${runId}:main:undo:`)]);
    expect(alertsOf("stopNotConfirmed")).toHaveLength(0);
  });

  it("m-4 the raw step error (a driver's host:port) is never in the URGENT, whatever its words", () => {
    for (const loai of Object.keys(CANH_BAO_KHONG_RO_KIND) as Array<keyof typeof CANH_BAO_KHONG_RO_KIND>) {
      expect(JSON.stringify(noiDungCanhBaoKhongRo({ loai, runId: 9, stepId: "X", compId: "Y", error: "FOE_OUTCOME_UNKNOWN: connect 10.9.8.7:5020", lan: "L" })), loai).not.toContain("10.9.8.7");
    }
  });

  it("I-4 a non-failFast parallel never swallows an unknown outcome: Continue sends the held compensation and NOTHING forward; the run fails, never 'completed'", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : ACKED));
    const { runId } = await giuKhongRo([par("p", [main(resetComp("undo")), pause("other")]), pause("nextForward")]);
    expect(sent("pause")).toHaveLength(1); // the sibling ran; the step after the parallel did not
    otDispatchMock.mockClear();
    const r = await tiep(runId, ADMIN, "checked");
    expect(r.status).toBe("failed");
    expect(sent()).toEqual(["reset"]);
    expect(await step(runId, "nextForward")).toBeUndefined();
    // the same with no hold: an unknown branch with no compensation never lets the walk go forward (and the run does not read completed)
    otDispatchMock.mockClear();
    const b = await chay([par("p", [main(), pause("other")]), pause("nextForward")]);
    expect(b.res.status).toBe("failed");
    expect(await step(b.runId, "nextForward")).toBeUndefined();
  });

  it("I-4 Continue never re-walks a failed sibling forward (doneFailed) — a known failure's step is not sent again", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "pause" ? REJECTED : ACKED));
    const { runId } = await giuKhongRo([par("p", [main(resetComp("undo")), pause("b")], { failFast: true })]);
    otDispatchMock.mockClear();
    otDispatchMock.mockImplementation(async () => ACKED); // the refusal has cleared: a re-walk WOULD write
    await tiep(runId, ADMIN, "checked");
    expect(sent()).toEqual(["reset"]);
    expect(runRow(runId).contextJson.foeResumeState.b).toMatchObject({ state: "doneFailed" });
  });

  it("I-5 central: the URGENT reaches a person (owner + active admins / supervisors), code only (m-4), retried until persisted (m-5)", async () => {
    store.set("users", [{ id: 501, role: "admin", isActive: true }]);
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? { ...TIMEOUT, error: "connect ETIMEDOUT 10.9.8.7:5020" } : ACKED));
    await giuKhongRo();
    await waitAlerts(1);
    const a = alerts[0]!;
    expect(a.recipients).toEqual(expect.arrayContaining([USER.id, 501]));
    expect(a.retryUntilPersisted).toEqual({ everyMs: 30_000, attempts: 20 });
    expect(JSON.stringify(a)).not.toContain("10.9.8.7");
    expect(String(a.message)).toContain("FOE_OUTCOME_UNKNOWN");
  });

  it("I-5 edge route: an anomaly of a run THIS node is assigned raises the same alert (owner, dedup by claim); foreign / unreadable ⇒ nothing; the branch is wired", async () => {
    const detail = chiTietAnomalyKhongRo({ loai: "held", stepId: "m", compId: "c", error: "EDGE_OUTCOME_UNKNOWN: host 10.1.1.1", claimSeq: 4 });
    expect(detail).not.toContain("10.1.1.1");
    const ok = async () => ({ owner: 7 });
    expect(await canhBaoTuAnomalyEdge({ code: "X", runId: 9, detail }, true, ok)).toBe(false);
    expect(await canhBaoTuAnomalyEdge({ code: KHONG_RO_EDGE_ANOMALY, runId: 9, detail }, false, ok)).toBe(false);
    expect(await canhBaoTuAnomalyEdge({ code: KHONG_RO_EDGE_ANOMALY, runId: 9, detail: "{" }, true, ok)).toBe(false);
    expect(await canhBaoTuAnomalyEdge({ code: KHONG_RO_EDGE_ANOMALY, runId: 9, detail }, true, async () => null)).toBe(false); // m-H — not valid
    expect(await canhBaoTuAnomalyEdge({ code: KHONG_RO_EDGE_ANOMALY, runId: 9, detail }, true, ok)).toBe(true);
    await waitAlerts(1);
    expect(alerts[0]).toMatchObject({ kind: CANH_BAO_KHONG_RO_KIND.held, dedupKey: "foe_outcome_unknown_compensation_held:9:m:c:claim4", recipients: [7] });
    const src = readFileSync(resolve(__dirname, "../../edge/edgeReportsCentral.ts"), "utf8");
    expect(src).toContain('await canhBaoTuAnomalyEdge(rec, entity.type === "orchestration_run", async (x) => {');
    expect(src).toContain("x.claimSeq > Number(a.claimSeq ?? 0) || !baoCaoHopLe(def, x)");
  });

  it("I-5 (condition 3) NOBODY to send it to ⇒ still visible: the alert is raised (log + alert stream), an error line, a durable audit row", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await canhBaoKetCucKhongRo({ loai: "held", runId: 77, stepId: "m", compId: "c", error: "e", lan: "L", owner: null });
    await vi.waitFor(() => expect(audits.filter((a) => a.details?.operation === KHONG_RO_KHONG_NGUOI_NHAN_AUDIT_OP)).toHaveLength(1));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.recipients).toEqual([]);
    expect(audits[0]).toMatchObject({ action: KET_CUC_KHONG_RO_AUDIT_ACTION, entityId: 77, status: "failure", details: { metadata: { stepId: "m", compId: "c" } } });
    expect(err.mock.calls.some((c) => /NO recipient/.test(String(c[0])))).toBe(true);
    err.mockRestore();
  });

  it("I-5 the end of a segment carries the reports: survives a full journal, is stripped before the run's error; too long ⇒ the text is never cut mid-JSON", () => {
    const bao = [{ loai: "held" as const, stepId: "s", compId: "c", ma: "EDGE_OUTCOME_UNKNOWN" as const, claimSeq: 3 }];
    const e = ganBaoCaoKhongRoEdge("the text", bao, 4_000);
    expect(tachBaoCaoKhongRoEdge(e)).toEqual({ error: "the text", bao });
    expect(tachBaoCaoKhongRoEdge("plain")).toEqual({ error: "plain", bao: [] });
    expect(tachBaoCaoKhongRoEdge(undefined)).toEqual({ error: undefined, bao: [] });
    const lon = ganBaoCaoKhongRoEdge("x".repeat(5000), bao, 4_000)!;
    expect(lon.length).toBeLessThanOrEqual(4_000);
    expect(tachBaoCaoKhongRoEdge(lon).bao).toEqual(bao);
    expect(ganBaoCaoKhongRoEdge("t", bao, 10)).toBe("t");
  });

  it("R-2 a robot STOP compensation is a STOP (the robot dispatcher's own rule): sent by itself via the dispatcher + URGENT; a robot MOTION compensation is held", async () => {
    const a = await chay([main(robotComp("undo", "abort", {}))]);
    expect(a.res.status).toBe("failed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
    expect((await step(a.runId, "undo"))?.status).toBe("compensated");
    await waitAlerts(1);
    expect(alertsOf("stopSent")).toHaveLength(1);
    robotDispatchMock.mockClear();
    const b = await giuKhongRo([main(robotComp("undo", "run_job", { jobType: "move", params: { x: 1 } }))]);
    expect(robotDispatchMock).not.toHaveBeenCalled();
    expect((await step(b.runId, "undo"))?.status).toBe("held");
  });

  it("R-4 an unknown outcome with NO compensation due anywhere ⇒ URGENT (same key shape); a known failure ⇒ none; a resumed unknown ⇒ not told twice", async () => {
    const { runId, res } = await chay([main()]);
    expect(res.status).toBe("failed");
    await waitAlerts(1);
    expect(alertsOf("noCompensation").map((a) => a.dedupKey)).toEqual([expect.stringMatching(new RegExp(`^foe_outcome_unknown_no_compensation:${runId}:main:-:`))]);
    alerts.length = 0;
    otDispatchMock.mockImplementation(async () => REJECTED);
    await chay([main()]);
    await new Promise((r) => setTimeout(r, 30));
    expect(alerts.filter((a) => String(a.kind).startsWith("foe_outcome_unknown"))).toHaveLength(0);
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : ACKED));
    const h = await giuKhongRo();
    await waitAlerts(1);
    alerts.length = 0;
    expect((await tiep(h.runId, ADMIN, "checked")).status).toBe("failed");
    await new Promise((r) => setTimeout(r, 30));
    expect(alertsOf("noCompensation")).toHaveLength(0);
  });

  it("m-3 two parallel holds: the marker lists both, one Continue sends both, ONE audit row per compensation", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : ACKED));
    const { runId } = await giuKhongRo([par("p", [main(resetComp("u1")), { ...main(resetComp("u2", 1)), id: "main2" } as WorkflowStep], { failFast: true })]);
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY].ds).toEqual(expect.arrayContaining([{ stepId: "main", compId: "u1" }, { stepId: "main2", compId: "u2" }]));
    otDispatchMock.mockClear();
    await tiep(runId, ADMIN, "checked both");
    expect(sent()).toEqual(["reset", "reset"]);
    expect(audits.filter((a) => a.details?.operation === "foe_outcome_unknown_continue").map((a) => a.details.metadata.compId).sort()).toEqual(["u1", "u2"]);
  });

  it("m-6 the Continue's audit row cannot be written ⇒ NO write, the run stays held (not fail-open); an Abort is not refused for it", async () => {
    const { runId } = await giuKhongRo();
    otDispatchMock.mockClear();
    HX.auditFails = true;
    await expect(tiep(runId, ADMIN, "checked")).rejects.toThrow(/audit row of this Continue could not be written/);
    expect(runRow(runId).status).toBe("held");
    expect(sent()).toHaveLength(0);
    await abortRun(runId, ADMIN, undefined, { scope: null });
    expect(runRow(runId).status).toBe("aborted");
  });

  it("m-9 a second interruption of the SAME (step, compensation) — the crash before the context persisted, then a re-walk — ⇒ a second URGENT: only the EVENT tells them apart", async () => {
    const { runId } = await giuKhongRo();
    await waitAlerts(1);
    const r = runRow(runId);
    r.contextJson = {};
    otDispatchMock.mockClear();
    expect((await resumeRun(runId, { approved: true, note: "system re-walk" }, SYSTEM, {}, { scope: null })).status).toBe("held");
    await waitAlerts(2);
    const keys = alertsOf("held").map((a) => String(a.dedupKey));
    expect(keys).toHaveLength(2);
    expect(keys[0]!.split(":").slice(0, 4)).toEqual(keys[1]!.split(":").slice(0, 4));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("m-10 the oversight hint says WHY", () => {
    expect(goiYRunDangGiu({ status: "held", currentStepId: null, khongRo: "FOE_OUTCOME_UNKNOWN" })).toBe("held · outcome unknown (FOE_OUTCOME_UNKNOWN) — compensation waiting for a person");
    expect(goiYRunDangGiu({ status: "awaiting_confirm", currentStepId: "g1", khongRo: null })).toBe("awaiting_confirm · g1");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) fix round 2 — the unknown flag outranks every sibling state; a Continue walks the held compensations only", () => {
  const pause = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "pause", ...extra }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as WorkflowStep;
  const gate = (id: string): WorkflowStep => ({ id, type: "hitl_gate", prompt: "x" }) as WorkflowStep;
  const tiep = (runId: number, note = "checked") => resumeRun(runId, { approved: true, note }, ADMIN, {}, { scope: null });
  // true at the first read, false once a person changed the machine (a param the test flips is read by the condition)
  const dk = (extra: Record<string, unknown> = {}) => ({ precondition: { source: "param", key: "ok", op: "eq", value: true }, ...extra });
  const seedParam = (runId: number, ok: boolean) => void (runRow(runId).paramsJson = { ...(runRow(runId).paramsJson ?? {}), ok });
  const chayCuoi = (id: string) => step(rows("orchestration_runs").at(-1)!.id as number, id);

  it("C-A (a) a gate beside the unknown branch: the container's STOP goes before any approval, URGENT, the run waits at the gate; approving it never re-sends the STOP or the unknown command", async () => {
    const { runId, res } = await chay([par("box", [main(), gate("g2")], { compensation: stopComp("boxStop") })]);
    expect(res.status).toBe("awaiting_confirm");
    expect(sent("stop")).toHaveLength(1); // ★ no person
    await waitAlerts(1);
    expect(alertsOf("stopSent")).toHaveLength(1);
    otDispatchMock.mockClear();
    const view = (await getRun(runId, { bindingDigest: true }))!;
    await resumeRun(runId, { approved: true, expectedStepId: "g2", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest ?? undefined }, APPROVER, {}, { scope: null });
    expect(sent()).toEqual([]);
  });

  it("C-A (a) with no compensation anywhere: paused, and the R-4 URGENT still goes", async () => {
    const { runId, res } = await chay([par("box", [main(), gate("g2")])]);
    expect(res.status).toBe("awaiting_confirm");
    await waitAlerts(1);
    expect(alertsOf("noCompensation").map((a) => a.dedupKey)).toEqual([expect.stringContaining(`:${runId}:main:-:`)]);
  });

  it("C-A (b) a precondition-abort sibling never turns the unknown failure into an automatic write: 0 reset, held, URGENT; a STOP compensation goes + URGENT", async () => {
    const abortB = pause("b", { precondition: { source: "param", key: "never", op: "eq", value: true }, onPreconditionFail: "abort" });
    const a = await chay([par("box", [main(), abortB], { compensation: resetComp("boxUndo") })]);
    expect(sent("reset")).toHaveLength(0); // ★ the one automatic write the review found
    expect(a.res.status).toBe("held");
    await waitAlerts(1);
    expect(alertsOf("held")).toHaveLength(1);
    alerts.length = 0;
    otDispatchMock.mockClear();
    await chay([par("box", [main(), abortB], { compensation: stopComp("boxStop") })]);
    expect(sent("stop")).toHaveLength(1);
    await waitAlerts(1);
    expect(alertsOf("stopSent")).toHaveLength(1);
  });

  it("I-E central: a gate approval re-walks and never re-issues the unknown command (its resume state is doneFailed)", async () => {
    const { runId } = await chay([par("p", [main(), gate("g2")])]);
    expect(runRow(runId).contextJson.foeResumeState.main).toMatchObject({ state: "doneFailed", khongRo: true });
  });

  it("I-A (a) a precondition 'skip' on the container is NOT re-read by a Continue: the held compensation is sent, the next forward step is not, the run is not 'completed'", async () => {
    const r = await chay([{ ...seq("box", [main(resetComp("undo"))]), ...dk({ onPreconditionFail: "skip" }) } as WorkflowStep, pause("next")], (id) => seedParam(id, true));
    expect(r.res.status).toBe("held"); // the precondition held at the first walk
    otDispatchMock.mockClear();
    seedParam(r.runId, false); // the person changed the machine: a re-read would skip the box and go forward
    const c = await tiep(r.runId);
    expect(sent()).toEqual(["reset"]);
    expect(c.status).toBe("failed");
    expect(await step(r.runId, "next")).toBeUndefined();
  });

  it("I-A (c) a sibling whose precondition held its row is not sent by the Continue", async () => {
    const { runId } = await giuKhongRo([par("p", [main(resetComp("undo")), pause("b", dk())])]);
    expect(await step(runId, "b")).toMatchObject({ status: "held" }); // its precondition failed: a row 'held', not 'failed'
    otDispatchMock.mockClear();
    seedParam(runId, true); // the precondition would hold now: a re-read would send it forward
    await tiep(runId);
    expect(sent()).toEqual(["reset"]);
  });

  it("I-A a compensation-only walk lets no other compensation go by itself: a known-failure container's compensation already ran, it does not run again", async () => {
    // the unknown answer comes last: the sibling's known failure and its compensation are over before the run is latched
    const treTimeout = async (ms: number) => (await new Promise((r) => setTimeout(r, ms)), TIMEOUT);
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? treTimeout(60) : i.commandType === "pause" ? REJECTED : ACKED));
    const { runId } = await giuKhongRo([par("p", [main(resetComp("undo")), seq("k", [pause("b")], resetComp("kUndo", 1))])]);
    expect(sent("reset")).toHaveLength(1); // kUndo: a known failure, as before
    otDispatchMock.mockClear();
    await tiep(runId);
    expect(sent()).toEqual(["reset"]); // undo only
    // … and when the container IS walked (a failed STOP inside it is re-sent, I-B) and fails again as a known failure: its compensation stays settled
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? treTimeout(1_100) : i.commandType === "stop" ? REJECTED : ACKED));
    otDispatchMock.mockClear();
    const b = await giuKhongRo([par("p", [main(resetComp("undo")), seq("k", [{ id: "stopX", type: "command", machineId: 1, command: "stop" } as WorkflowStep], resetComp("kUndo", 1))])]);
    expect(sent("reset")).toHaveLength(1);
    otDispatchMock.mockClear();
    await tiep(b.runId);
    expect(sent("reset")).toHaveLength(1); // undo; kUndo not a second time
    expect(sent("stop").length).toBeGreaterThan(0); // the STOP re-sent, with its default of attempts
  });

  it("I-A a Continue that finds nothing to walk (an unreadable marker, no state) never reads 'completed': the run fails, nothing is sent", async () => {
    const { runId } = await giuKhongRo();
    runRow(runId).contextJson = { [KET_CUC_KHONG_RO_CTX_KEY]: { bad: 1 } };
    rows("orchestration_run_steps").filter((x) => x.runId === runId && (x.stepId === "main" || x.stepId === "undo")).forEach((x) => (x.status = "skipped"));
    otDispatchMock.mockClear();
    const c = await tiep(runId);
    expect(c.status).toBe("failed");
    expect(sent()).toEqual([]);
  });

  it("I-A the approval is spent with its walk: not in the row after a Continue, and a stale one never makes a later gate walk compensation-only", async () => {
    const a = await giuKhongRo([seq("box", [main(resetComp("undo"))], resetComp("boxUndo"))]);
    await tiep(a.runId);
    expect(runRow(a.runId).status).toBe("held");
    expect(runRow(a.runId).contextJson[KHONG_RO_DUYET_CTX_KEY]).toBeUndefined();
    otDispatchMock.mockImplementation(async () => ACKED);
    const b = await chay([gate("g2"), pause("after")]);
    runRow(b.runId).contextJson = { ...(runRow(b.runId).contextJson ?? {}), [KHONG_RO_DUYET_CTX_KEY]: { stepIds: ["nothing"] } };
    otDispatchMock.mockClear();
    const view = (await getRun(b.runId, { bindingDigest: true }))!;
    await resumeRun(b.runId, { approved: true, expectedStepId: "g2", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest ?? undefined }, APPROVER, {}, { scope: null });
    expect(sent()).toEqual(["pause"]);
    const src = readFileSync(resolve(__dirname, "../../edge/edgeExecutionAgent.ts"), "utf8");
    expect(src).toContain('o.outcome === "aborted" || o.outcome === "paused") && o.error'); // C-A — the paused end carries its reports to central
  });

  it("I-A a thrown running row of a re-walked container stays on the unknown path", async () => {
    const { runId } = await giuKhongRo([seq("box", [main(resetComp("undo"))], resetComp("boxUndo"))]);
    otDispatchMock.mockClear();
    HX.rowThrows = (r) => r.stepId === "box" && r.status === "running";
    const c = await tiep(runId);
    expect(c.status).toBe("held"); // the container's reset is held, never run as a known failure
    expect(sent()).toEqual(["reset"]);
  });

  it("I-B a failed STOP inside a failed container is re-sent by the Continue (L-7): the container is not hidden by doneFailed; its non-STOP sibling is", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" || i.commandType === "pause" ? REJECTED : ACKED));
    const { runId } = await giuKhongRo([par("p", [seq("s1", [{ id: "stopX", type: "command", machineId: 1, command: "stop" } as WorkflowStep], undefined), main(resetComp("undo"))])]);
    otDispatchMock.mockClear();
    otDispatchMock.mockImplementation(async () => ACKED);
    await tiep(runId);
    expect(sent().sort()).toEqual(["reset", "stop"]);
  });

  it("I-C a HUNG row write in front of an ancestor's STOP: the STOP goes within its bound, URGENT", async () => {
    HX.rowHangs = (r) => (r.stepId === "main" && r.status === "failed") || r.stepId === "undo";
    const t0 = Date.now();
    const { res } = await chay([seq("box", [main(resetComp("undo"))], stopComp("boxStop"))]);
    expect(res.status).toBe("held");
    expect(sent("stop")).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(9_000);
    await waitAlerts(2);
  }, 20_000);

  it("M-3 a STOP-typed step: an unknown attempt, then a known one: the flag sticks, the reset is held", async () => {
    let n = 0;
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "stop" ? (++n === 1 ? TIMEOUT : REJECTED) : ACKED));
    const { res } = await chay([{ id: "main", type: "command", machineId: 1, command: "stop", maxAttempts: 1, compensation: resetComp() } as WorkflowStep]);
    expect(n).toBe(2);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
    expect((await chayCuoi("main"))?.error).toMatch(/^FOE_OUTCOME_UNKNOWN: /); // the flag stuck: the row says the class
  });

  it("C-A (b) a precondition-abort sibling and no compensation anywhere: the aborted end still tells a person", async () => {
    const abortB = pause("b", { precondition: { source: "param", key: "never", op: "eq", value: true }, onPreconditionFail: "abort" });
    await chay([par("box", [main(), abortB])]);
    await waitAlerts(1);
    expect(alertsOf("noCompensation")).toHaveLength(1);
  });

  it("M-5 a thrown context write never turns a held run 'failed' after the URGENT said Continue", async () => {
    const { runId, res } = await chay([main(resetComp())], () => void (HX.contextThrows = true));
    expect(res.status).toBe("held");
    expect(runRow(runId).status).toBe("held");
  });

  it("M-1, I-E, I-B pure rules of the resume state", () => {
    const d = { ref: "x", name: "x", steps: [main(resetComp()), { id: "free", type: "command", machineId: 1, command: "start" } as WorkflowStep] } as WorkflowDefinition;
    const r = (stepId: string, status: string, error: string | null = null) => ({ stepId, status, resultJson: null, error });
    // M-1 running + compensation row, no text
    expect(edgeResumeStateOf(d, [r("main", "running"), r("undo", "held")], new Set()).state.main).toMatchObject({ state: "compensationHeld", khongRo: true });
    expect(edgeResumeStateOf(d, [r("main", "running"), r("undo", "compensated")], new Set()).state.main).toMatchObject({ state: "doneFailed", khongRo: true });
    // I-E failed with the code, no compensation
    expect(edgeResumeStateOf(d, [r("free", "failed", "FOE_OUTCOME_UNKNOWN: x")], new Set()).state.free).toEqual({ state: "doneFailed", error: "FOE_OUTCOME_UNKNOWN: x", khongRo: true });
    expect(edgeResumeStateOf(d, [r("free", "failed", "device refused")], new Set()).state.free).toBeUndefined();
    expect(edgeResumeStateOf(d, [r("free", "failed", "FOE_OUTCOME_UNKNOWN: x")], new Set(), [], new Set(["free"])).state.free).toBeUndefined(); // a STOP is re-sent
    // I-B
    const c = { ref: "y", name: "y", steps: [seq("s1", [{ id: "stopX", type: "command", machineId: 1, command: "stop" } as WorkflowStep])] } as WorkflowDefinition;
    expect(themBuocHongKhiTiepTuc(c, [r("s1", "failed"), r("stopX", "failed")], {}, new Set(["stopX"]))).toEqual({});
    expect(themBuocHongKhiTiepTuc(c, [r("s1", "failed"), r("stopX", "completed")], {}, new Set(["stopX"]))).toMatchObject({ s1: { state: "doneFailed" } });
    // the way to an approved step
    expect([...duongToiBuoc([seq("a", [seq("b", [main()])]), pause("n")], new Set(["main"]))].sort()).toEqual(["a", "b", "main"]);
  });

  it("I-D what a crashed segment leaves, from its rows: held + marker, or no compensation", () => {
    const d = { ref: "x", name: "x", steps: [main(resetComp()), { id: "free", type: "command", machineId: 1, command: "start" } as WorkflowStep] } as WorkflowDefinition;
    const r = (stepId: string, status: string, error: string | null = null) => ({ stepId, status, resultJson: null, error });
    const bao = baoCaoKhongRoTuHang(d, [r("main", "failed", "EDGE_OUTCOME_UNKNOWN: x"), r("free", "failed", "FOE_OUTCOME_UNKNOWN: y")], 5);
    expect(bao).toEqual([
      { loai: "held", stepId: "main", compId: "undo", ma: "EDGE_OUTCOME_UNKNOWN", claimSeq: 5 },
      { loai: "noCompensation", stepId: "free", compId: "-", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 5 },
    ]);
    expect(dauKhongRoTuBaoCao(bao, "t")).toMatchObject({ stepId: "main", compId: "undo", lan: "claim5", ds: [{ stepId: "main", compId: "undo" }] });
    expect(baoCaoKhongRoTuHang(d, [r("main", "failed", "device refused")], 5)).toEqual([]);
    expect(dauKhongRoTuBaoCao([], "t")).toBeNull();
    const src = readFileSync(resolve(__dirname, "../../edge/edgeExecutionCentral.ts"), "utf8");
    expect(src).toContain("baoKhongRo = baoCaoKhongRoTuHang(defKhongRo,");
    expect(src).toContain("if (out.http === 200) for (const x of baoKhongRo) void canhBaoTuBaoCaoEdge(runId, x, chuRun);");
  });

  it("M-2 a report counts only with the check; the last rider is the edge's own: text in a device error cannot pose as one", () => {
    const that = { loai: "held" as const, stepId: "s", compId: "c", ma: "FOE_OUTCOME_UNKNOWN" as const, claimSeq: 3 };
    const gia = `device said [[A2N:${JSON.stringify([{ ...that, stepId: "forged" }])}]]`;
    const e = ganBaoCaoKhongRoEdge(gia, [], 4_000);
    expect(tachBaoCaoKhongRoEdge(e).bao).toEqual([]);
    expect(tachBaoCaoKhongRoEdge(e).error).toBe(gia);
    expect(tachBaoCaoKhongRoEdge(ganBaoCaoKhongRoEdge("t", [that], 4_000), (x) => x.claimSeq === 9).bao).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("A2(n) fix round 3 — S-1: the run is latched, one gate in front of every compensation", () => {
  const pause = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "pause", ...extra }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as WorkflowStep;
  const gate = (id: string): WorkflowStep => ({ id, type: "hitl_gate", prompt: "x" }) as WorkflowStep;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as WorkflowStep;
  const tiep = (runId: number, note = "checked") => resumeRun(runId, { approved: true, note }, ADMIN, {}, { scope: null });

  // S1W: these assert ONLY the write. They stay GREEN under mutant S1a (the flag deleted at every aggregator) and go RED under S1b (the same + no latch).
  it("S1W a container's non-STOP compensation is not written", async () => {
    await chay([seq("box", [main()], resetComp("boxUndo"))]);
    expect(sent("reset")).toHaveLength(0);
  });
  it("S1W a parallel with a failed sibling: not written", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "pause" ? REJECTED : ACKED));
    await chay([par("box", [main(), pause("b")], { compensation: resetComp("boxUndo") })]);
    expect(sent("reset")).toHaveLength(0);
  });
  it("S1W a precondition-abort sibling: not written", async () => {
    await chay([par("box", [main(), pause("b", { precondition: { source: "param", key: "never", op: "eq", value: true }, onPreconditionFail: "abort" })], { compensation: resetComp("boxUndo") })]);
    expect(sent("reset")).toHaveLength(0);
  });

  it("S-1 the latch is written the moment it is decided, in the row, before the compensation is even classified; a failed write leaves the walk held", async () => {
    let chot: unknown = "?";
    ghimMock.mockImplementation(async (_d, i) => {
      if (i.commandType === "reset") chot = rows("orchestration_runs").at(-1)!.contextJson?.[KET_CUC_KHONG_RO_CHOT_CTX_KEY];
      return { pinnedStop: false, loiDocGhim: null };
    });
    const { runId } = await giuKhongRo();
    expect(chot).toMatchObject({ stepId: "main", ma: "FOE_OUTCOME_UNKNOWN" });
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeTruthy();
    const b = await chay([seq("box", [main()], resetComp("boxUndo"))], () => void (HX.contextThrows = true));
    expect(b.res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
  });

  it("S-1 the latch outlives the walk: a KNOWN failure later on the same run is held too, and a re-walk with the marker and the resume state gone still writes nothing", async () => {
    const { runId } = await giuKhongRo();
    const chot = runRow(runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY];
    runRow(runId).contextJson = { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: chot };
    otDispatchMock.mockClear();
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? REJECTED : ACKED));
    const c = await resumeRun(runId, { approved: true, note: "system" }, SYSTEM, {}, { scope: null });
    expect(c.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
  });

  it("S-1 an approval covers exactly THAT compensation: another compensation of the same run is split, not sent", async () => {
    const { runId } = await giuKhongRo([seq("box", [main(resetComp("undo"))], resetComp("boxUndo"))]);
    otDispatchMock.mockClear();
    const c = await tiep(runId);
    expect(c.status).toBe("held");
    expect(sent()).toEqual(["reset"]);
    expect(await step(runId, "boxUndo")).toMatchObject({ status: "held" });
  });

  it("S-1 a compensation whose OWN outcome is unknown latches the run: the container above it is held", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? REJECTED : i.commandType === "reset" ? TIMEOUT : ACKED));
    const { res } = await chay([seq("box", [main(resetComp("undo", 1))], resetComp("boxUndo"))]);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(1);
  });

  it("C-B a container with a retry budget: the STOP-typed child goes unknown, a second pass would answer known: NOT walked again, its reset held", async () => {
    let n = 0;
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "stop" ? (++n === 1 ? TIMEOUT : REJECTED) : ACKED));
    const { res } = await chay([{ ...seq("box", [{ id: "st", type: "command", machineId: 1, command: "stop", maxAttempts: 0 } as WorkflowStep], resetComp("boxUndo")), maxAttempts: 1 } as WorkflowStep]);
    expect(n).toBe(1); // ★ one pass
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
  });

  it("I-F the container's STOP goes at once, not behind a slow sibling", async () => {
    const t0 = Date.now();
    void chay([par("box", [main(), delay("slow", 4_000)], { compensation: stopComp("boxStop") })]);
    await vi.waitFor(() => expect(sent("stop")).toHaveLength(1), { timeout: 2_000 });
    expect(Date.now() - t0).toBeLessThan(2_000);
    await waitAlerts(1);
    expect(alertsOf("stopSent")).toHaveLength(1);
  });

  it("I-F a sibling's HUNG row write does not hold the STOP or its URGENT", async () => {
    HX.rowHangs = (r) => r.stepId === "slow" && r.status === "completed";
    void chay([par("box", [main(), pause("slow")], { compensation: stopComp("boxStop") })]);
    await vi.waitFor(() => expect(sent("stop")).toHaveLength(1), { timeout: 3_000 });
    await waitAlerts(1);
  });

  it("I-F two branches reaching the same container: the STOP goes once", async () => {
    await chay([par("box", [main(), { ...main(), id: "main2" } as WorkflowStep], { compensation: stopComp("boxStop") })]);
    expect(sent("stop")).toHaveLength(1);
  });

  it("G-1 a gate inside the held compensation is ASKED: the Continue pauses at it, nothing after it goes; approving it sends the compensation", async () => {
    const { runId } = await giuKhongRo([main(seq("cmp", [gate("gc"), resetComp("rz")]))]);
    otDispatchMock.mockClear();
    const c = await tiep(runId);
    expect(c.status).toBe("awaiting_confirm");
    expect(runRow(runId).currentStepId).toBe("gc");
    expect(await step(runId, "gc")).toMatchObject({ status: "awaiting_confirm" });
    expect(sent()).toEqual([]);
    expect((await tiep(runId, "the gate: yes")).status).toBe("failed");
    expect(sent()).toEqual(["reset"]);
  });

  it("G-2 the audit names the sibling gate a Continue does not ask", async () => {
    const { runId } = await giuKhongRo([par("p", [main(resetComp("undo")), gate("g2")])]);
    await tiep(runId);
    expect(audits.find((a) => a.details?.operation === "foe_outcome_unknown_continue")?.details.metadata.gatesSkipped).toEqual(["gate g2 skipped because the run failed"]);
    expect(runRow(runId).status).toBe("failed");
  });

  it("m-F an approved compensation that is refused raises the URGENT", async () => {
    const { runId } = await giuKhongRo();
    otDispatchMock.mockImplementation(async () => REJECTED);
    alerts.length = 0;
    await tiep(runId);
    await waitAlerts(1);
    expect(alertsOf("approvedNotConfirmed").map((a) => a.dedupKey)).toEqual([expect.stringContaining(`:${runId}:main:undo:`)]);
  });

  it("m-A m-C m-E the words: no false 'no compensation due'; a failed run never says HELD; a Continue that sent nothing does not say it ran", async () => {
    const n = noiDungCanhBaoKhongRo({ loai: "noCompensation", runId: 9, stepId: "X", compId: "-", error: "e", lan: "L" });
    expect(n.title).not.toContain("no compensation due");
    expect(n.message).toContain("may still be due");
    const f = noiDungCanhBaoKhongRo({ loai: "failedNotSent", runId: 9, stepId: "X", compId: "Y", error: "e", lan: "L" });
    expect(f.message).toContain("FAILED");
    expect(f.message).not.toMatch(/HELD|Continue/);
    const src = readFileSync(resolve(__dirname, "../../edge/edgeExecutionCentral.ts"), "utf8");
    expect(src).toContain('x.loai === "held" ? { ...x, loai: "failedNotSent" as const } : x');
    const { runId } = await giuKhongRo();
    runRow(runId).contextJson = { [KET_CUC_KHONG_RO_CTX_KEY]: { bad: 1 } };
    rows("orchestration_run_steps").filter((x) => x.runId === runId && (x.stepId === "main" || x.stepId === "undo")).forEach((x) => (x.status = "skipped"));
    await tiep(runId);
    expect(String(runRow(runId).error)).toContain("found no held compensation");
  });

  it("I-G the node died while the command was out: authorised, a running row, no result ⇒ a person is called; a STOP is not unknown", () => {
    const d = { ref: "x", name: "x", steps: [main(resetComp()), { id: "free", type: "command", machineId: 1, command: "start" } as WorkflowStep, { id: "st", type: "command", machineId: 1, command: "stop" } as WorkflowStep] } as WorkflowDefinition;
    const r = (stepId: string, status: string) => ({ stepId, status, resultJson: null, error: null });
    const bao = baoCaoKhongRoTuHang(d, [r("main", "running"), r("free", "running"), r("st", "running")], 5, new Set(["main", "free", "st"]), new Set(["st"]));
    expect(bao.map((x) => [x.loai, x.stepId, x.compId])).toEqual([["held", "main", "undo"], ["noCompensation", "free", "-"]]);
    expect(baoCaoKhongRoTuHang(d, [r("main", "running")], 5)).toEqual([]); // no result and no authorisation: never sent
    const src = readFileSync(resolve(__dirname, "../../edge/edgeExecutionCentral.ts"), "utf8");
    expect(src).toContain("tx.select().from(edgeStepAuthorizations)");
  });

  it("m-B a STOP whose final row was lost does not hide in a failed container; m-H a report is paired; the containers around a step, innermost first", () => {
    const stopX = { id: "stopX", type: "command", machineId: 1, command: "stop" } as WorkflowStep;
    const c = { ref: "y", name: "y", steps: [seq("s1", [stopX])] } as WorkflowDefinition;
    const r = (stepId: string, status: string) => ({ stepId, status, resultJson: null, error: null });
    expect(themBuocHongKhiTiepTuc(c, [r("s1", "failed"), r("stopX", "running")], {}, new Set(["stopX"]))).toEqual({});
    const d = { ref: "z", name: "z", steps: [seq("a", [seq("b", [main(resetComp())])])] } as WorkflowDefinition;
    expect(baoCaoHopLe(d, { stepId: "main", compId: "undo" })).toBe(true);
    expect(baoCaoHopLe(d, { stepId: "main", compId: "-" })).toBe(true);
    expect(baoCaoHopLe(d, { stepId: "b", compId: "undo" })).toBe(false); // not ITS compensation
    expect(baoCaoHopLe(d, { stepId: "forged", compId: "-" })).toBe(false);
    expect(toTienCua(d.steps, "main").map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("A2(n) fix round 4 — THE sink at the dispatch, the durable fact, the trace of what cannot be recalled, the interlock", () => {
  const pause = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "pause", ...extra }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as WorkflowStep;
  const gate = (id: string): WorkflowStep => ({ id, type: "hitl_gate", prompt: "x" }) as WorkflowStep;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as WorkflowStep;
  const tiep = (runId: number, note = "checked") => resumeRun(runId, { approved: true, note }, ADMIN, {}, { scope: null });
  const treTimeout = async (ms: number) => (await new Promise((r) => setTimeout(r, ms)), TIMEOUT);
  /** the sibling b is refused at once, main goes unknown `ms` later: b's compensation is admitted BEFORE the latch */
  const biTruocChot = (ms = 60) =>
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") return treTimeout(ms);
      return i.commandType === "pause" ? REJECTED : ACKED;
    });
  const dk = { precondition: { source: "param", key: "doorClosed", op: "eq", value: true }, onPreconditionFail: "hold" };

  // ── (a) C-D ──
  it("★ C-D (U1) a multi-step compensation admitted BEFORE the latch: its write after the latch is NOT handed over, held + URGENT; Continue sends it once", async () => {
    biTruocChot();
    const { runId, res } = await chay([par("box", [pause("b", { compensation: seq("uSeq", [delay("w", 200), resetComp("rz")]) }), main()])]);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
    expect(runRow(runId).contextJson.foeResumeState.b).toMatchObject({ state: "compensationHeld", khongRo: true });
    expect((runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY] as { ds: unknown[] }).ds).toEqual([{ stepId: "b", compId: "uSeq" }]);
    await vi.waitFor(() => expect(alertsOf("held").some((a) => a.dedupKey.includes(":b:uSeq:"))).toBe(true));
    otDispatchMock.mockClear();
    expect((await tiep(runId)).status).toBe("failed");
    expect(sent()).toEqual(["reset"]);
  });

  it("★ C-D (U2) a single command, the latch falls between the door and the dispatch (a slow running row): NOT handed over, held + URGENT", async () => {
    biTruocChot();
    HX.rowSlowMs = (r) => (r.stepId === "uu" && r.status === "running" ? 150 : 0);
    const { runId, res } = await chay([par("box", [pause("b", { compensation: resetComp("uu") }), main()])]);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
    expect(await step(runId, "uu")).toMatchObject({ status: "held" });
    await vi.waitFor(() => expect(alertsOf("held").length).toBeGreaterThan(0));
  });

  it("(a) the same with a pinned STOP inside the body: it goes at the dispatch + URGENT 'STOP compensation sent', no person", async () => {
    biTruocChot();
    const { res } = await chay([par("box", [pause("b", { compensation: seq("uSeq", [delay("w", 200), stopComp("st")]) }), main()])]);
    expect(sent("stop")).toHaveLength(1);
    expect(res.status).toBe("failed");
    await vi.waitFor(() => expect(alertsOf("stopSent").some((a) => a.dedupKey.includes(":b:st:"))).toBe(true));
  });

  it("(a) an UNPINNED stop inside the body is not a STOP at the sink (the dispatch's own verdict): not handed over, held", async () => {
    biTruocChot();
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
    const { res } = await chay([par("box", [pause("b", { compensation: seq("uSeq", [delay("w", 200), stopComp("st")]) }), main()])]);
    expect(sent("stop")).toHaveLength(0);
    expect(res.status).toBe("held");
  });

  it("(a) a parallel inside a compensation reaches the sink twice: nothing sent, one hold, one marker entry", async () => {
    biTruocChot();
    const body = par("uPar", [seq("s1", [delay("w1", 150), resetComp("r1")]), seq("s2", [delay("w2", 150), resetComp("r2")])]);
    const { runId, res } = await chay([par("box", [pause("b", { compensation: body }), main()])]);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
    expect((runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY] as { ds: unknown[] }).ds).toEqual([{ stepId: "b", compId: "uPar" }]);
  });

  it("(a, C-1) a child held AT THE SINK in a container that does not hold the unknown step: that container's STOP still goes", async () => {
    biTruocChot();
    const { res } = await chay([par("p", [seq("box", [pause("b", { compensation: seq("uSeq", [delay("w", 200), resetComp("rz")]) })], stopComp("bs")), main()])]);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
    expect(sent("stop")).toHaveLength(1);
  });

  it("(a) n6: an UNLATCHED multi-step compensation walks exactly as before", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "pause" ? REJECTED : ACKED));
    const { res } = await chay([pause("b", { compensation: seq("uSeq", [delay("w", 5), resetComp("rz")]) })]);
    expect(res.status).toBe("failed");
    expect(sent("reset")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(alerts.filter((a) => String(a.kind).startsWith("foe_outcome_unknown"))).toHaveLength(0);
  });

  // S1W: GREEN under S1a (the flag deleted at every aggregator), RED under S1b. The S1a gap of round 3: the flag readers read the latch too
  it("S1W C-A (a) the container's STOP goes before the gate", async () => {
    await chay([par("box", [main(), gate("g2")], { compensation: stopComp("bs") })]);
    expect(sent("stop")).toHaveLength(1);
  });
  it("S1W R-4 the URGENT fires with no compensation anywhere", async () => {
    await chay([par("p", [main(), gate("g2")])]);
    await vi.waitFor(() => expect(alertsOf("noCompensation")).toHaveLength(1));
  });
  it("(a) the latch reader answers only for a step that holds the unknown one: a sibling container that did not fail keeps its STOP", async () => {
    const { res } = await chay([par("p", [main(), seq("ok", [gate("g2")], stopComp("bs"))])]);
    expect(res.status).toBe("awaiting_confirm");
    expect(sent("stop")).toHaveLength(0);
  });

  // ── (c) ──
  it("★ (c) a write in flight at latch time cannot be recalled: an URGENT names it and an audit row records it", async () => {
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") return treTimeout(60);
      if (i.commandType === "pause") return REJECTED;
      if (i.commandType === "reset") {
        await new Promise((r) => setTimeout(r, 200));
        return ACKED;
      }
      return ACKED;
    });
    const { runId } = await chay([par("box", [pause("b", { compensation: resetComp("uu") }), main()])]);
    expect(sent("reset")).toHaveLength(1);
    await vi.waitFor(() => expect(alertsOf("inFlight")).toHaveLength(1));
    const a = alertsOf("inFlight")[0]!;
    expect(a.dedupKey).toContain(`:${runId}:main:uu:`);
    expect(a.title).toMatch(/"uu" in flight at latch time/);
    expect(a.message).toMatch(/cannot be recalled/);
    await vi.waitFor(() => expect(audits.some((x) => x.details?.operation === KHONG_RO_DANG_BAY_AUDIT_OP && x.details?.metadata?.compId === "uu")).toBe(true));
  });
  it("(c) nothing in flight ⇒ no such trace; a STOP in flight is not a doubt about a write", async () => {
    await giuKhongRo();
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") return treTimeout(60);
      if (i.commandType === "stop") {
        await new Promise((r) => setTimeout(r, 150));
        return ACKED;
      }
      return ACKED;
    });
    await chay([par("box", [{ id: "s0", type: "command", machineId: 1, command: "stop" } as WorkflowStep, main()])]);
    await new Promise((r) => setTimeout(r, 30));
    expect(alertsOf("inFlight")).toHaveLength(0);
  });

  // ── (b) ──
  it("★ (b) central: a crash lost the context's latch, the rows keep the code: a re-walk writes nothing", async () => {
    const { runId } = await giuKhongRo();
    runRow(runId).contextJson = {};
    expect(rows("orchestration_run_steps").filter((r) => r.runId === runId && r.stepId === "main")[0]!.error).toMatch(/FOE_OUTCOME_UNKNOWN/);
    otDispatchMock.mockClear();
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? REJECTED : ACKED)); // the re-walk answers KNOWN: only the rows say unknown
    const c = await resumeRun(runId, { approved: true, note: "system" }, SYSTEM, {}, { scope: null });
    expect(c.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
  });
  it("(b) every unknown row carries the code, with or without a compensation (a STOP-typed step, a compensation's own)", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "pause" ? REJECTED : TIMEOUT));
    const { runId } = await chay([pause("x", { compensation: resetComp("u") })]);
    expect((await step(runId, "u"))!.error).toMatch(/^FOE_OUTCOME_UNKNOWN/);
    const b = await chay([seq("s", [stopComp("st")])]);
    expect((await step(b.runId, "st"))!.error).toMatch(/^FOE_OUTCOME_UNKNOWN/);
  });

  // ── (d) I-K ──
  it("★ (d, I-K) an interlock INSIDE an approved compensation is enforced: nothing sent, the run fails, a person told; the same as the known path", async () => {
    const cmp = (id: string) => seq(id, [{ ...resetComp(`${id}rz`), ...dk } as WorkflowStep]);
    const { runId } = await giuKhongRo([main(cmp("a"))]);
    otDispatchMock.mockClear();
    expect((await tiep(runId)).status).toBe("failed");
    expect(sent("reset")).toHaveLength(0);
    await vi.waitFor(() => expect(alertsOf("approvedNotSent")).toHaveLength(1));
    otDispatchMock.mockReset();
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "pause" ? REJECTED : ACKED));
    await chay([pause("x", { compensation: cmp("k") })]);
    expect(sent("reset")).toHaveLength(0);
  });
  it("(d) the interlock of the approved compensation itself (top level) too; when it holds, it is sent", async () => {
    const { runId } = await giuKhongRo([main({ ...resetComp("c1"), ...dk } as WorkflowStep)]);
    otDispatchMock.mockClear();
    expect((await tiep(runId)).status).toBe("failed");
    expect(sent("reset")).toHaveLength(0);
    await vi.waitFor(() => expect(alertsOf("approvedNotSent")).toHaveLength(1));
    const ok = await chay([main({ ...resetComp("c2"), ...dk } as WorkflowStep)], (id) => void (runRow(id).paramsJson = { doorClosed: true }));
    otDispatchMock.mockClear();
    await tiep(ok.runId);
    expect(sent("reset")).toHaveLength(1);
  });

  // ── I-I, I-J, I-L ──
  it("★ I-I (U3) a compensation's own unknown with nothing above it: failed, latched, URGENT", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "pause" ? REJECTED : i.commandType === "reset" ? TIMEOUT : ACKED));
    const { runId, res } = await chay([pause("x", { compensation: resetComp("u") })]);
    expect(res.status).toBe("failed");
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toBeTruthy();
    await vi.waitFor(() => expect(alertsOf("compensationUnknown")).toHaveLength(1));
    expect(alertsOf("compensationUnknown")[0]!.dedupKey).toContain(":x:u:");
  });
  it("★ I-J (U4) a compensation's own unknown fires the container's STOP at once, not behind a sibling", async () => {
    let tU = 0;
    let tS = 0;
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "pause") return REJECTED;
      if (i.commandType === "reset") {
        tU = Date.now();
        return TIMEOUT;
      }
      if (i.commandType === "stop") tS = Date.now();
      return ACKED;
    });
    await chay([par("box", [pause("x", { compensation: resetComp("u") }), delay("slow", 600)], { compensation: stopComp("boxStop") })]);
    expect(tS).toBeGreaterThan(0);
    expect(tS - tU).toBeLessThan(300);
  });
  it("★ I-L (U8) the noCompensation URGENT goes at once, not at the walk's end (a hung sibling row never delays it)", async () => {
    HX.rowHangs = (r) => r.stepId === "slow" && r.status === "completed";
    void chay([par("p", [main(), delay("slow", 5)])]);
    await vi.waitFor(() => expect(alertsOf("noCompensation")).toHaveLength(1), { timeout: 1_000 });
  });
  it("R-4 an unknown known only from an earlier segment (no fresh decision, so no I-L): the end of the walk tells", async () => {
    await chay([main()], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeOutcomeUnknown: ["main"] };
    });
    expect(sent("start")).toHaveLength(0);
    await vi.waitFor(() => expect(alertsOf("noCompensation")).toHaveLength(1));
  });

  it("I-L told once, the end of the walk says nothing more; a compensation inside a body is not 'no compensation'", async () => {
    await chay([main()]);
    await vi.waitFor(() => expect(alertsOf("noCompensation")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(alertsOf("noCompensation")).toHaveLength(1);
    alerts.length = 0;
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "pause" ? REJECTED : i.commandType === "reset" ? TIMEOUT : ACKED));
    await chay([pause("x", { compensation: seq("c", [resetComp("rz")]) })]);
    await vi.waitFor(() => expect(alertsOf("compensationUnknown")).toHaveLength(1));
    expect(alertsOf("noCompensation")).toHaveLength(0);
  });

  // ── minors ──
  it("m-J a re-walk: the container's unsent STOP goes from the resumed branch, not behind a slow sibling", async () => {
    let tS = 0;
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "stop") tS = Date.now();
      return ACKED;
    });
    const t0 = Date.now();
    await chay([par("box", [main(), delay("slow", 500)], { compensation: stopComp("bs") })], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeResumeState: { main: { state: "doneFailed", error: "FOE_OUTCOME_UNKNOWN: x", khongRo: true } } };
    });
    expect(tS).toBeGreaterThan(0);
    expect(tS - t0).toBeLessThan(400);
  });
  it("m-K a KNOWN failure held on a latched run says so: not 'its outcome is unknown'", async () => {
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") return TIMEOUT;
      if (i.commandType === "pause") return (await new Promise((r) => setTimeout(r, 60)), REJECTED);
      return ACKED;
    });
    const { runId, res } = await chay([par("box", [pause("x", { compensation: resetComp("u") }), main()])]);
    expect(res.status).toBe("held");
    expect((await step(runId, "u"))!.error).toMatch(/^FOE_OUTCOME_UNKNOWN: step "x" failed; another command's outcome is unknown/);
    await vi.waitFor(() => expect(alertsOf("held").length).toBeGreaterThan(0));
    const a = alertsOf("held").find((x) => x.dedupKey.includes(":x:u:"))!;
    expect(a.title).toMatch(/step "x" failed; another command's outcome is unknown/);
    expect(a.title).not.toMatch(/command "x" outcome unknown/);
    expect(a.message).not.toMatch(/The outcome of command step "x"/);
  });
  it("m-N a thrown context write at a gate inside a compensation leaves the run waiting, never 'failed' with the compensation due", async () => {
    const { runId } = await giuKhongRo([main(seq("c", [gate("gc"), resetComp("rz")]))]);
    HX.contextThrows = true;
    const c = await tiep(runId);
    HX.contextThrows = false;
    expect(c.status).toBe("awaiting_confirm");
    expect(runRow(runId).status).toBe("awaiting_confirm");
    expect(sent("reset")).toHaveLength(0);
  });
  it("m-O a pinned STOP inside a multi-step compensation is not held for a person: it goes + URGENT, the rest is held", async () => {
    const { runId, res } = await chay([main(seq("c", [resetComp("rz"), stopComp("st")]))]);
    expect(res.status).toBe("held");
    expect(sent("reset")).toHaveLength(0);
    expect(sent("stop")).toHaveLength(1);
    await vi.waitFor(() => expect(alertsOf("stopSent").some((a) => a.dedupKey.includes(":main:st:"))).toBe(true));
    await vi.waitFor(() => expect(alertsOf("held").some((a) => a.dedupKey.includes(":main:c:"))).toBe(true));
    expect(runRow(runId).contextJson.foeResumeState.main).toMatchObject({ state: "compensationHeld" });
  });
  it("m-O the same at the sink: a body held at its first write still sends its STOP; and behind a held child (a container's body)", async () => {
    biTruocChot();
    await chay([par("box", [pause("b", { compensation: seq("uSeq", [delay("w", 150), resetComp("rz"), stopComp("st")]) }), main()])]);
    expect(sent("reset")).toHaveLength(0);
    expect(sent("stop")).toHaveLength(1);
    otDispatchMock.mockClear();
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : ACKED));
    await chay([seq("box", [main(resetComp("undo"))], seq("bc", [resetComp("rz2"), stopComp("st2")]))]);
    expect(sent("reset")).toHaveLength(0);
    expect(sent("stop")).toHaveLength(1);
  });
  it("m-P a compensation already unknown, not a STOP: not sent again, and a person is told", async () => {
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? REJECTED : ACKED));
    await chay([main(resetComp("c9"))], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeOutcomeUnknown: ["c9"] };
      // extension — main failed on a walk before the latch: its compensation is due, the sink lets nothing forward go now
      rows("orchestration_run_steps").push({ id: 99_001, runId: id, stepId: "main", stepType: "command", status: "failed", error: "rejected", attempt: 1, resultJson: null, startedAt: null, finishedAt: null });
    });
    expect(sent("start")).toHaveLength(0);
    expect(sent("reset")).toHaveLength(0);
    await vi.waitFor(() => expect(alertsOf("compensationUnknown").some((a) => a.dedupKey.includes(":main:c9:"))).toBe(true));
  });

  it("the pure parts: chotTuHang, buTruBiChanKhongRo, chuBuTruTrongDinhNghia, baoCaoHopLe, a compensation row's code in the resume state", () => {
    const r = (stepId: string, status: string, error: string | null = null) => ({ stepId, status, resultJson: null, error });
    expect(chotTuHang([r("a", "failed", "x")])).toBeNull();
    expect(chotTuHang([r("abort:a", "failed", "FOE_OUTCOME_UNKNOWN: x")])).toBeNull(); // the sweep's row is not a command's outcome
    expect(chotTuHang([r("u", "failed", "EDGE_OUTCOME_UNKNOWN: x")])).toMatchObject({ stepId: "u", ma: "EDGE_OUTCOME_UNKNOWN" });
    expect(chotTuHang([], { c: { state: "outcomeUnknown", error: "x" } })).toMatchObject({ stepId: "c" });
    expect(chotTuHang([], { c: { state: "doneFailed", error: "x" } })).toBeNull();
    const coMa = [r("u", "failed", "FOE_OUTCOME_UNKNOWN: x")];
    expect(buTruBiChanKhongRo({}, [], "s", "c")).toBe(false);
    expect(buTruBiChanKhongRo({}, coMa, "s", "c")).toBe(true);
    expect(buTruBiChanKhongRo({ foeKetCucKhongRoChot: { stepId: "u" } }, [], "s", "c")).toBe(true);
    expect(buTruBiChanKhongRo({ foeKetCucKhongRoDuyet: { buTru: [{ stepId: "s", compId: "c" }] } }, coMa, "s", "c")).toBe(false);
    expect(buTruBiChanKhongRo({ foeKetCucKhongRoDuyet: { buTru: [{ stepId: "s", compId: "other" }] } }, coMa, "s", "c")).toBe(true);
    const body = seq("c", [delay("w", 1), resetComp("rz")]);
    const d = { ref: "p", name: "p", steps: [seq("box", [main(body)])] } as WorkflowDefinition;
    expect(chuBuTruTrongDinhNghia(d.steps, "rz")).toMatchObject({ step: { id: "main" }, comp: { id: "c" } });
    expect(chuBuTruTrongDinhNghia(d.steps, "c")).toMatchObject({ step: { id: "main" } });
    expect(chuBuTruTrongDinhNghia(d.steps, "main")).toBeNull();
    expect(baoCaoHopLe(d, { stepId: "main", compId: "rz" })).toBe(true);
    expect(baoCaoHopLe(d, { stepId: "box", compId: "rz" })).toBe(false);
    expect(baoCaoHopLe(d, { stepId: "box", compId: "rz", loai: "inFlight" })).toBe(true);
    expect(baoCaoHopLe(d, { stepId: "box", compId: "w", loai: "inFlight" })).toBe(false);
    const e = { ref: "q", name: "q", steps: [pause("x", { compensation: resetComp("u") })] } as WorkflowDefinition;
    expect(edgeResumeStateOf(e, [r("x", "failed", "known"), r("u", "failed", "FOE_OUTCOME_UNKNOWN: y")], new Set()).state.x).toMatchObject({ state: "doneFailed", khongRo: true });
    expect(edgeResumeStateOf(e, [r("x", "failed", "known"), r("u", "held", "FOE_OUTCOME_UNKNOWN: y")], new Set()).state.x).toMatchObject({ state: "compensationHeld", khongRo: true });
    expect(edgeResumeStateOf(e, [r("x", "failed", "known"), r("u", "held", "EDGE_HELD(journalFull): y")], new Set()).state.x?.khongRo).toBeUndefined();
  });

  it("source pins: the sink is read in the tick of the hand-over; /authorize reads the latch after 'not a STOP', before any approval", () => {
    const src = readFileSync(resolve(__dirname, "foeEngine.ts"), "utf8");
    const i = src.indexOf("const cong = xetCongBuTru(rc, step.id, laStopGiao);");
    const j = src.indexOf("rc.dispatched.add(step.id);", i);
    const k = src.indexOf("result = await adapter.sendCommand(cmd)", j);
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
    const giua = src.slice(src.indexOf("\n", i), k).replace(/if \(cong\?\.kind === "giu"\) return giuTaiCong\(rc, cong\.chu, step\.id\);/, "");
    expect(giua).not.toMatch(/\bawait\b/);
    // m-L — the boot re-send latches (nothing returns before the flag), its row says so
    const chot = src.slice(src.indexOf("async function chotKhongRo("), src.indexOf("function baoDangBay("));
    expect(chot.indexOf("rc.khongRoChot = true;")).toBeGreaterThan(0);
    expect(chot.indexOf("rc.khongRoChot = true;")).toBeLessThan(chot.indexOf("rc.chiGuiStopGhim"));
    const au = readFileSync(resolve(__dirname, "../../edge/edgeAuthorizeCentral.ts"), "utf8");
    expect(au.indexOf("── 5. a verified STOP")).toBeLessThan(au.indexOf("buTruBiChanKhongRo(run.contextJson"));
    expect(au.indexOf("buTruBiChanKhongRo(run.contextJson")).toBeLessThan(au.indexOf("── 6. identity"));
  });
});

describe("A2(n) extension (owner's ruling) — central: a forward write never leaves a latched run; a step that may have gone out never reads 'not sent'; the auto-resume walks a latched run", () => {
  const pause = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "pause", ...extra }) as WorkflowStep;
  const stopFwd = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", ...extra }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as WorkflowStep;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as WorkflowStep;
  const sau = (id: string, s: WorkflowStep, ms = 60): WorkflowStep => seq(id, [delay(`${id}w`, ms), s]);
  const tiep = (runId: number, note = "checked") => resumeRun(runId, { approved: true, note }, ADMIN, {}, { scope: null });
  const khongGui = new RegExp(`^${FOE_NOT_SENT_RUN_LATCHED}: not sent: run latched`);
  const auditBuoc = () => audits.filter((a) => (a.details as { operation?: string })?.operation === "notSentRunLatched");

  it("★ (1) a forward step behind a delay, failFast true and false: not handed over, failed with the code, an audit row, the run never 'completed'", async () => {
    for (const failFast of [true, false]) {
      alerts.length = 0;
      audits.length = 0;
      otDispatchMock.mockClear();
      const { runId, res } = await chay([par("p", [main(), sau("b", pause("r3"))], { failFast })]);
      expect(res.status).toBe("failed");
      expect(sent("pause")).toHaveLength(0);
      expect(await step(runId, "r3")).toMatchObject({ status: "failed" });
      expect((await step(runId, "r3"))!.error).toMatch(khongGui);
      await vi.waitFor(() => expect(auditBuoc()).toHaveLength(1));
      expect((auditBuoc()[0]!.details as { metadata: Record<string, unknown> }).metadata).toMatchObject({ stepId: "r3", attempt: 1 });
    }
  });
  it("★ (1) a parallel with failFast false whose ONLY failure is the refusal does not swallow it: the run ends failed, never 'completed'", async () => {
    const { runId, res } = await chay([par("p", [sau("b", pause("r3")), delay("d2", 5)], { failFast: false })], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeKetCucKhongRoChot: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: "t" } };
    });
    expect(res.status).toBe("failed");
    expect(sent()).toHaveLength(0);
    expect(await step(runId, "r3")).toBeUndefined(); // latched before the container began: stopped at the door, whole
    await vi.waitFor(() => expect(alertsOf("forwardNotSent")).toHaveLength(1));
  });
  it("★ (1) maxAttempts: 3 ⇒ exactly 0 hand-overs and no second attempt; a container's retry is not walked again either", async () => {
    const { runId } = await chay([par("p", [main(), sau("b", pause("r3", { maxAttempts: 3 }))], { failFast: false })]);
    expect(sent("pause")).toHaveLength(0);
    expect(await step(runId, "r3")).toMatchObject({ attempt: 1 });
    const n = rows("ai_pending_actions").filter((a) => /-r3-a/.test(String(a.id))).length;
    expect(n).toBeLessThanOrEqual(1); // no `-a2` authorisation
    expect(rows("ai_pending_actions").some((a) => /-r3-a2/.test(String(a.id)))).toBe(false);
  });
  it("★ (1) a container with a retry budget, whose only failure is the refusal: not walked again (no second attempt of its child)", async () => {
    await chay([par("p2", [seq("b2", [delay("w2", 5), pause("r5")])], { failFast: false, maxAttempts: 2 })], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeKetCucKhongRoChot: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: "t" } };
    });
    await vi.waitFor(() => expect(alertsOf("forwardNotSent")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(auditBuoc()).toHaveLength(0); // latched before it began: the door stopped the container, whole, once
    expect(sent()).toHaveLength(0);
  });
  it("★ (1) a forward PINNED STOP after the latch IS sent (auth.stopGhim is set at that line), retried as a STOP; nothing waits", async () => {
    const { runId } = await chay([par("p", [main(), sau("b", stopFwd("st"))], { failFast: false })]);
    expect(sent("stop")).toHaveLength(1);
    expect((await step(runId, "st"))!.error ?? "").not.toMatch(/not sent/);
  });
  it("★ (1) a forward STOP-typed step whose pins do not pin it: not sent, the code", async () => {
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
    const { runId } = await chay([par("p", [main(), sau("b", stopFwd("st"))], { failFast: false })]);
    expect(sent("stop")).toHaveLength(0);
    expect((await step(runId, "st"))!.error).toMatch(khongGui);
  });
  it("★ (1) the refused step's own compensation is not due, not even a STOP: it was never sent; the container's still takes the split (STOP at once, non-STOP held)", async () => {
    const a = await chay([par("p", [main(), seq("b", [delay("w", 60), pause("r3", { compensation: resetComp("c3") })], stopComp("bs"))], { failFast: false })]);
    expect(sent("reset")).toHaveLength(0);
    expect(await step(a.runId, "c3")).toBeUndefined();
    expect(sent("stop")).toHaveLength(1); // the container's
    expect(a.res.status).toBe("failed");
    otDispatchMock.mockClear();
    const b = await chay([par("p", [main(), seq("b", [delay("w", 60), pause("r4", { compensation: stopComp("c4") })], resetComp("bu"))], { failFast: false })]);
    expect(sent("stop")).toHaveLength(0); // r4's own STOP: nothing to undo
    expect(sent("reset")).toHaveLength(0);
    expect(b.res.status).toBe("held");
    expect(await step(b.runId, "bu")).toMatchObject({ status: "held" });
  });
  it("(1) a step really handed over earlier in this walk, then refused on its retry: its compensation IS still due (the split), the row says only this attempt", async () => {
    let n = 0;
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "pause") return (n++, await new Promise((r) => setTimeout(r, 80)), REJECTED);
      if (i.commandType === "start") return (await new Promise((r) => setTimeout(r, 30)), TIMEOUT);
      return ACKED;
    });
    const { runId, res } = await chay([par("p", [main(), pause("r6", { maxAttempts: 2, compensation: resetComp("c6") })], { failFast: false })]);
    expect(n).toBe(1); // attempt 1 was handed over; attempt 2 met the latch
    expect((await step(runId, "r6"))!.error).toMatch(khongGui);
    expect(res.status).toBe("held");
    expect(await step(runId, "c6")).toMatchObject({ status: "held" });
  });
  it("(1) a refused step is not looked at again on a later walk: its compensation is not held, a Continue-free gate approval sends nothing forward", async () => {
    const { runId, res } = await chay([par("p", [main(), { id: "g2", type: "hitl_gate", prompt: "x" } as WorkflowStep, sau("b", pause("r3", { compensation: resetComp("c3") }))], { failFast: false })]);
    expect(res.status).toBe("awaiting_confirm");
    expect(runRow(runId).contextJson.foeResumeState.r3).toMatchObject({ state: "doneFailed" });
    otDispatchMock.mockClear();
    const r = await resumeRun(runId, { approved: true }, APPROVER);
    expect(r.status).toBe("failed");
    expect(sent()).toHaveLength(0);
    expect(await step(runId, "c3")).toBeUndefined();
  });

  it("(1) a refusal read back from the resume state stays final: a parallel with failFast false does not read it as a walk that went on", async () => {
    const { runId, res } = await chay([par("p", [pause("r3"), delay("d2", 5)], { failFast: false })], (id) => {
      runRow(id).contextJson = {
        ...(runRow(id).contextJson ?? {}),
        foeKetCucKhongRoChot: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: "t" },
        foeResumeState: { r3: { state: "doneFailed", error: `${FOE_NOT_SENT_RUN_LATCHED}: not sent: run latched` } },
      };
    });
    expect(res.status).toBe("failed");
    expect(runRow(runId).status).toBe("failed");
    expect(sent()).toHaveLength(0);
  });

  it("★ not stuck: after a refusal a held run is ended by a Continue (n3): compensation only, the forward work dropped, 'failed'", async () => {
    const { runId, res } = await chay([par("p", [main(resetComp("u")), sau("b", pause("r3"))], { failFast: false })]);
    expect(res.status).toBe("held");
    otDispatchMock.mockClear();
    expect((await tiep(runId)).status).toBe("failed");
    expect(sent()).toEqual(["reset"]);
    expect(runRow(runId).status).toBe("failed");
  });
  it("★ not stuck: the same run is ended by an Abort, nothing written", async () => {
    const { runId, res } = await chay([par("p", [main(resetComp("u")), sau("b", pause("r3"))], { failFast: false })]);
    expect(res.status).toBe("held");
    otDispatchMock.mockClear();
    await abortRun(runId, ADMIN, "checked", { scope: null } as never);
    expect(runRow(runId).status).toBe("aborted");
    expect(sent("reset")).toHaveLength(0);
    expect(sent("pause")).toHaveLength(0);
  });

  // ── the truthfulness trap ──
  /** a crash the moment the latch landed: what the walk really left of it, the rest of its writes undone (the real path is on the DB: Latch-then-crash) */
  async function chetSauChot(steps: WorkflowStep[], sua?: (runId: number) => void) {
    process.env.FOE_DURABLE = "true";
    const { runId } = await chay(steps);
    const chot = runRow(runId).contextJson[KET_CUC_KHONG_RO_CHOT_CTX_KEY];
    expect(chot).toMatchObject({ stepId: "main" });
    store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== runId || r.stepId === "gate0" || r.stepId === "main"));
    Object.assign(rows("orchestration_run_steps").find((r) => r.runId === runId && r.stepId === "main")!, { status: "running", error: null, finishedAt: null });
    Object.assign(runRow(runId), { status: "held", finishedAt: null, error: null, contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: chot, interrupted: true } });
    sua?.(runId);
    otDispatchMock.mockClear();
    alerts.length = 0;
    return runId;
  }
  const kiemKhongRo = async (runId: number, id = "main") => {
    const e = String((await step(runId, id))!.error);
    expect(e).toMatch(/^FOE_OUTCOME_UNKNOWN/);
    expect(e).not.toMatch(/not sent: run latched/);
    expect(e).not.toContain(FOE_NOT_SENT_RUN_LATCHED);
  };

  // m-M reversed (extension (2)): "resumed" counts an ok end, so a run walked to 'failed' is not counted; what it did is the oracle
  it("★ the trap, m-M reversed: a latch and a crash before the split, STOP compensation: IS auto-resumed, 0 non-STOP writes, the STOP once + URGENT, main stays unknown", async () => {
    const runId = await chetSauChot([main(stopComp())]);
    await autoResumeInterruptedRuns([runId]);
    expect(sent()).toEqual(["stop"]);
    await kiemKhongRo(runId);
    await vi.waitFor(() => expect(alertsOf("stopSent")).toHaveLength(1));
    expect(runRow(runId).status).toBe("failed");
  });
  it("★ the trap: the same with a non-STOP compensation: held + URGENT + marker, 0 writes; a second boot finds the marker and skips (no loop); the system never approved anything", async () => {
    const runId = await chetSauChot([main(resetComp())]);
    expect(await autoResumeInterruptedRuns([runId])).toMatchObject({ resumed: 1 });
    expect(sent()).toHaveLength(0);
    await kiemKhongRo(runId);
    expect(runRow(runId).status).toBe("held");
    expect(runRow(runId).contextJson[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ stepId: "main", compId: "undo" });
    expect(runRow(runId).contextJson[KHONG_RO_DUYET_CTX_KEY]).toBeUndefined();
    await vi.waitFor(() => expect(alertsOf("held")).toHaveLength(1));
    runRow(runId).contextJson = { ...runRow(runId).contextJson, interrupted: true };
    expect(await autoResumeInterruptedRuns([runId])).toMatchObject({ resumed: 0 });
    expect(sent()).toHaveLength(0);
  });
  it("★ the trap: the same with no compensation: R-4 URGENT at once, the run ends failed, 0 writes", async () => {
    const runId = await chetSauChot([main()]);
    await autoResumeInterruptedRuns([runId]);
    expect(sent()).toHaveLength(0);
    await kiemKhongRo(runId);
    await vi.waitFor(() => expect(alertsOf("noCompensation")).toHaveLength(1));
    expect(runRow(runId).status).toBe("failed");
  });
  it("★ the trap: a sibling left running by the crash (it may have gone out, the latch names another step): never 'not sent', unknown, not sent again", async () => {
    const runId = await chetSauChot([par("p", [main(), pause("y")], { failFast: false })], (id) => {
      // its dispatch result is on the row: handed over for certain, no last word
      rows("orchestration_run_steps").push({ id: 99_002, runId: id, stepId: "y", stepType: "command", status: "running", error: null, attempt: 1, resultJson: { routedTo: "ot-dispatcher" }, startedAt: new Date(), finishedAt: null });
    });
    await autoResumeInterruptedRuns([runId]);
    expect(sent("pause")).toHaveLength(0);
    await kiemKhongRo(runId, "y");
    await kiemKhongRo(runId);
  });
  it("★ the trap: only the latch names the step (its row was lost with the crash): stays unknown", async () => {
    const runId = await chetSauChot([main()], (id) => store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((r) => r.runId !== id || r.stepId !== "main")));
    await autoResumeInterruptedRuns([runId]);
    expect(sent()).toHaveLength(0);
    await kiemKhongRo(runId);
  });
  it("★ the trap: central's list names a STOP-typed step that is not pinned (execStep lets a stop candidate through): stays unknown at the sink", async () => {
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
    const { runId } = await chay([stopFwd("st")], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeOutcomeUnknown: ["st"] };
    });
    expect(sent()).toHaveLength(0);
    await kiemKhongRo(runId, "st");
  });
  it("★ the trap: a code on a row the latch does not name, the row's status 'failed': stays unknown", async () => {
    const runId = await chetSauChot([par("p", [main(), pause("y")], { failFast: false })], (id) => {
      rows("orchestration_run_steps").push({ id: 99_003, runId: id, stepId: "y", stepType: "command", status: "failed", error: "FOE_OUTCOME_UNKNOWN: an earlier walk", attempt: 1, resultJson: null, startedAt: new Date(), finishedAt: null });
    });
    await autoResumeInterruptedRuns([runId]);
    expect(sent("pause")).toHaveLength(0);
    await kiemKhongRo(runId, "y");
  });
  it("★ the trap: a STOP-typed step, not pinned, whose attempt went unknown: its next attempt is not sent and it stays unknown in the SAME walk", async () => {
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
    otDispatchMock.mockImplementation(async () => TIMEOUT);
    const { runId } = await chay([stopFwd("st", { maxAttempts: 2 })]);
    expect(sent("stop")).toHaveLength(1);
    await kiemKhongRo(runId, "st");
    await vi.waitFor(() => expect(alertsOf("noCompensation")).toHaveLength(1));
  });
  it("★ a finding: a pinned STOP unknown on one attempt, confirmed on the next: nothing split, nobody told yet; forward work dropped ⇒ a person IS told, the run never ends silent", async () => {
    let n = 0;
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "stop" ? (n++ === 0 ? TIMEOUT : ACKED) : ACKED));
    const { runId, res } = await chay([stopFwd("st"), pause("r3")]);
    expect(n).toBe(2);
    expect(res.status).toBe("failed");
    expect(sent("pause")).toHaveLength(0);
    expect((await step(runId, "r3"))!.error).toMatch(khongGui);
    await vi.waitFor(() => expect(alertsOf("forwardNotSent")).toHaveLength(1));
    expect(alerts).toHaveLength(1); // the only one: without it this run ends told to nobody
    const a = alertsOf("forwardNotSent")[0]!;
    expect(a.dedupKey).toContain(":r3:-:");
    expect(a.title).toMatch(/NOT sent/);
  });
  it("(decision 3: forward work dropped is said in its own words, one URGENT, beside the walk's other URGENT)", async () => {
    const { runId } = await chay([par("p", [main(), sau("b", pause("r3"))], { failFast: false })]);
    expect((await step(runId, "r3"))!.error).toMatch(khongGui);
    await vi.waitFor(() => expect(alertsOf("noCompensation")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(alertsOf("forwardNotSent")).toHaveLength(1);
  });
  it("(a known failure of an earlier walk is not 'may have gone out': the code, and it is not an unknown)", async () => {
    const { runId } = await chay([par("p", [pause("y")], { failFast: false })], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeKetCucKhongRoChot: { stepId: "zz", ma: "FOE_OUTCOME_UNKNOWN", at: "t" } };
      rows("orchestration_run_steps").push({ id: 99_004, runId: id, stepId: "y", stepType: "command", status: "failed", error: "rejected", attempt: 1, resultJson: null, startedAt: new Date(), finishedAt: null });
    });
    expect(sent("pause")).toHaveLength(0);
    expect((await step(runId, "y"))!.error).toMatch(khongGui);
  });

  it("(4) pure: the URGENT of a compensation unknown never says an earlier segment DID send it; a known code is known to the code filter's constant", () => {
    const n = noiDungCanhBaoKhongRo({ loai: "compensationUnknown", runId: 1, stepId: "s", compId: "c", error: "FOE_OUTCOME_UNKNOWN: x", lan: "l" });
    expect(n.message).toContain("may have sent it");
    expect(n.message).not.toMatch(/an earlier segment sent it/);
    expect(loiLaKetCucKhongRo(`${FOE_NOT_SENT_RUN_LATCHED}: not sent: run latched`)).toBe(false);
    expect(chotTuHang([{ stepId: "a", status: "failed", resultJson: null, error: `${FOE_NOT_SENT_RUN_LATCHED}: x` }] as never)).toBeNull();
  });
});

describe("A2(n) F10 — a refused step's own bookkeeping never holds a walk longer than D", () => {
  const pause = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "pause", ...extra }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[], extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "parallel", failFast: true, steps, ...extra }) as WorkflowStep;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as WorkflowStep;
  const trong = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => "ended"), new Promise((r) => setTimeout(() => r("blocked"), ms))]);

  it("★ F10 (Q6) the refused step's failed row hangs: the walk ends and the container's STOP compensation goes", async () => {
    HX.rowHangs = (r) => r.stepId === "r3" && r.status === "failed";
    const p = chay([par("p", [main(), seq("b", [delay("w", 60), pause("r3")], stopComp("bs"))], { failFast: false })]);
    expect(await trong(p, 3 * STOP_DB_STEP_DEADLINE_MS), "the walk stood on the row of a refused step").toBe("ended");
    expect(sent("pause")).toHaveLength(0);
    expect(sent("stop")).toHaveLength(1);
  });
});

// bang-ca-f12.md, row by row: the number in each case's name is the table's. Rows that are no label of this function, and gaps, are it.todo naming the task that closes them.
describe("A2(n) T1 — nhanBuocSauChot, the F12 table by row shape", () => {
  const bang = (x: Partial<BangChungBuoc>): BangChungBuoc => ({ status: null, routedTo: false, khongRo: false, daGiao: false, uyQuyenSong: false, ...x });
  const MA = "FOE_OUTCOME_UNKNOWN: dispatch timed out";
  const KHONG_GUI = loiKhongGuiChot("s"); // the writer's own text: a change of the code cannot leave this table behind
  const TRUONG_HOP: Array<[string, Partial<BangChungBuoc>, NhanSauChot]> = [
    // A. forward step
    ["F12-1 no row, no trace", {}, "chuaDen"],
    ["F12-2 no row, dispatched", { daGiao: true }, "coTheDaGui"],
    ["F12-3 no row, a live authorisation", { uyQuyenSong: true }, "coTheDaGui"],
    ["F12-4 running, no routedTo, no trace", { status: "running" }, "coTheDaGui"],
    ["F12-5 running + routedTo", { status: "running", routedTo: true }, "coTheDaGui"],
    ["F12-6 running with the code", { status: "running", error: MA }, "coTheDaGui"],
    ["F12-6b running with FOE_NOT_SENT: running proves nothing, never 'not sent'", { status: "running", error: KHONG_GUI }, "coTheDaGui"],
    ["F12-7 failed FOE_OUTCOME_UNKNOWN", { status: "failed", error: MA }, "coTheDaGui"],
    ["F12-8 failed FOE_OUTCOME_PARTIAL, routedTo", { status: "failed", error: "FOE_OUTCOME_PARTIAL: 1 of 2", routedTo: true }, "giuNguyen"],
    ["F12-9 failed with a device's error, routedTo", { status: "failed", error: 'Command "pause" rejected', routedTo: true }, "giuNguyen"],
    ["F12-10 failed, refused before the hand-over (FOE_GATE_REQUIRED)", { status: "failed", error: "FOE_GATE_REQUIRED: no approval" }, "giuNguyen"],
    ["F12-11 failed FOE_NOT_SENT, no trace at all", { status: "failed", error: KHONG_GUI }, "chuaGui"],
    ["F12-12 failed FOE_NOT_SENT with routedTo", { status: "failed", error: KHONG_GUI, routedTo: true }, "coTheDaGui"],
    ["F12-13 failed FOE_NOT_SENT, dispatched", { status: "failed", error: KHONG_GUI, daGiao: true }, "coTheDaGui"],
    ["F12-14 completed, routedTo", { status: "completed", routedTo: true }, "xong"],
    ["F12-15 skipped", { status: "skipped" }, "xong"],
    ["F12-16 held, no trace", { status: "held" }, "chuaGui"],
    ["F12-17 held, a live authorisation", { status: "held", uyQuyenSong: true }, "giuNguyen"],
    ["F12-17b pending", { status: "pending" }, "coTheDaGui"],
    ["F12-17b queued", { status: "queued" }, "coTheDaGui"],
    ["F12-17b awaiting_confirm", { status: "awaiting_confirm" }, "coTheDaGui"],
    ["F12-17c skipped + khongRo: reviewed at T1, unknown wins over a skip written by an old walk", { status: "skipped", khongRo: true }, "coTheDaGui"],
    ["F12-17c skipped with the code on the row", { status: "skipped", error: MA }, "coTheDaGui"],
    // B. STOP
    ["F12-18 verified STOP, no row", {}, "chuaDen"],
    ["F12-19 verified STOP, failed on an earlier walk, not confirmed", { status: "failed", error: "device said no", routedTo: true }, "giuNguyen"],
    ["F12-21 verified STOP, running, no result", { status: "running" }, "coTheDaGui"],
    ["F12-22 verified STOP, completed, confirmed before", { status: "completed", routedTo: true, khongRo: true }, "xong"],
    ["F12-23 verified STOP, completed, not confirmed", { status: "completed", routedTo: true, khongRo: true }, "xong"],
    ["F12-26 stop-typed, pins read, not pinned, not reached", {}, "chuaDen"],
    ["F12-27 stop-typed, handed over, running + routedTo", { status: "running", routedTo: true }, "coTheDaGui"],
    ["F12-28 stop-typed, handed over, failed with the code", { status: "failed", error: MA, routedTo: true }, "coTheDaGui"],
    ["F12-29 stop-typed, row lost, dispatched", { daGiao: true }, "coTheDaGui"],
    ["F12-30 stop-typed, row lost, a live authorisation", { uyQuyenSong: true }, "coTheDaGui"],
    ["F12-30a verified STOP, running + routedTo, a result of an earlier attempt", { status: "running", routedTo: true }, "coTheDaGui"],
    // C. compensation: the row's label; what the walk does with it is its own task
    ["F12-31 compensation running, no result", { status: "running" }, "coTheDaGui"],
    ["F12-32 compensation running + routedTo", { status: "running", routedTo: true }, "coTheDaGui"],
    ["F12-33 no row, it is the latch step itself", { khongRo: true }, "coTheDaGui"],
    ["F12-34 compensation held, nothing handed over", { status: "held" }, "chuaGui"],
    ["F12-35 compensated", { status: "compensated" }, "xong"],
    ["F12-36 compensation failed with the code", { status: "failed", error: MA }, "coTheDaGui"],
  ];
  it.each(TRUONG_HOP)("%s", (_ten, x, nhan) => {
    expect(nhanBuocSauChot(bang(x))).toBe(nhan);
  });

  // the gaps of the table, closed by the task named
  it.todo("F12-16 gap edge: the central picture has no held row (parity 2314) — T11");
  it.todo("F12-17a gap: completed in the current edge segment must read xong, the edge reads coTheDaGui (C-5, S3, B7-edge) — T11, gopHangCucBo");
  it.todo("F12-27 gap: the row stays running at the end of an edge segment — T11");
  it.todo("F12-30a gap Q-5: hong counts running with or without routedTo, S-R — T10");
  it.todo("F12-31 gap: Continue hands over again under -a1 (M2), F8-DUP — T6, DB at T15");
  it.todo("F12-30b gap C-3: adapter unresolved, state C, B12, F4-C3 — T5");
  it.todo("F12-39 gap C-2: a refused step's STOP compensation with unreadable pins, B11, F4-COMP, F4-COMP-C — T5");
  // rows of the table with no label of this function
  it.todo("F12-24 unverifiable forward step goes to the dispatcher (F4), B-unverified, F2a — T5");
  it.todo("F12-25 unverifiable compensation follows laBuTruStop, F2c, a2n N3 — T5");
  it.todo("F12-30c pins unreadable by FOE and dispatcher, no approval: state C, F4-C2, F4-C2b — T5");
  // D. the same rows at each moment: the fixtures that build rows for the real walk, central and edge
  it.todo("F12-D walking: memory + rows — T13");
  it.todo("F12-D boot: rows + context, no memory — T10, T13");
  it.todo("F12-D Continue: rows + context + approval — T6, T13");
  it.todo("F12-D edge segment: the prior picture, no held, no running + routedTo (rows 16, 27) — T11");
});

describe("A2(n) T2 — canhBaoKetCucKhongRo answers: is the URGENT stored?", () => {
  const a = { loai: "held", runId: 9, stepId: "m", compId: "c", error: "FOE_OUTCOME_UNKNOWN", lan: "L", owner: 7 } as const;

  it("the alert says stored: true", async () => {
    expect(await canhBaoKetCucKhongRo(a)).toBe(true);
  });

  it("the alert says not stored: false", async () => {
    HX.alertBen = false;
    expect(await canhBaoKetCucKhongRo(a)).toBe(false);
  });

  it("the alert says nothing: false, never assumed stored", async () => {
    HX.alertBen = null;
    expect(await canhBaoKetCucKhongRo(a)).toBe(false);
  });

  it("the alert throws: false, and it does not throw", async () => {
    HX.alertNem = true;
    await expect(canhBaoKetCucKhongRo(a)).resolves.toBe(false);
  });

  it("M4 recipients=0: false even when the alert says stored, the audit row still goes", async () => {
    expect(await canhBaoKetCucKhongRo({ ...a, owner: null })).toBe(false);
    expect(alerts[0]!.recipients).toEqual([]);
    expect(audits.map((x) => x.details.operation)).toEqual([KHONG_RO_KHONG_NGUOI_NHAN_AUDIT_OP]);
  });

  it("no owner, an active admin to tell: true", async () => {
    store.set("users", [{ id: 501, role: "admin", isActive: true }]);
    expect(await canhBaoKetCucKhongRo({ ...a, owner: null })).toBe(true);
    expect(alerts[0]!.recipients).toEqual([501]);
  });

  it("the edge route answers the same", async () => {
    const x = { loai: "held", stepId: "m", compId: "c", ma: "EDGE_OUTCOME_UNKNOWN", claimSeq: 4 } as const;
    expect(await canhBaoTuBaoCaoEdge(9, x, 7)).toBe(true);
    HX.alertBen = false;
    expect(await canhBaoTuBaoCaoEdge(9, x, 7)).toBe(false);
  });
});

describe("A2(n) T2 — runEnd and the words of H2", () => {
  const x = { runId: 9, stepId: "m", error: "FOE_OUTCOME_UNKNOWN", owner: 7 };

  it("runEnd: the fixed key foe_outcome_unknown_run_end:<run>:<latch step>:-:chot", () => {
    const n = noiDungCanhBaoKhongRo({ ...x, loai: "runEnd", compId: KHONG_CO_BU_TRU, lan: "chot" });
    expect(n.kind).toBe("foe_outcome_unknown_run_end");
    expect(n.dedupKey).toBe("foe_outcome_unknown_run_end:9:m:-:chot");
  });

  it("H2 runEnd says check on site, promises no Abort, and does not say the run ended: a held run raises it too", () => {
    const n = noiDungCanhBaoKhongRo({ ...x, loai: "runEnd", compId: KHONG_CO_BU_TRU, lan: "chot" });
    expect(n.message).toContain("A STOP this run sent, if any, could not be confirmed: check the machine on site");
    expect(`${n.title} ${n.message}`).not.toMatch(/abort|continue/i);
    expect(n.title).not.toMatch(/run ended/i);
  });

  it("H2 stopNotConfirmed: handed over, not confirmed, check on site; no 'sent' in the title, no Abort", () => {
    const n = noiDungCanhBaoKhongRo({ ...x, loai: "stopNotConfirmed", compId: "undo", lan: "L" });
    expect(n.message).toContain("handed to the dispatcher but could not be confirmed: check the machine on site");
    expect(n.title).not.toMatch(/\bsent\b/i);
    expect(n.title).toMatch(/NOT confirmed/);
    expect(`${n.title} ${n.message}`).not.toMatch(/abort|continue/i);
  });

  it("the kinds that must not change: a dedup key already in the inbox stays the same", () => {
    expect(noiDungCanhBaoKhongRo({ ...x, loai: "stopNotConfirmed", compId: "undo", lan: "L" }).dedupKey).toBe("foe_outcome_unknown_stop_compensation_unconfirmed:9:m:undo:L");
  });
});
