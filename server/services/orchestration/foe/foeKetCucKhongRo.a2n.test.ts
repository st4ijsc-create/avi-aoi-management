/**
 * SCADA R1b-2b-2a A2(n) (AN TOÀN, L-7) — unit half (no DB): an UNKNOWN command outcome never triggers a device write from a non-STOP
 * compensation. The REAL engine walks (startRun / resumeRun / abortRun / autoResumeInterruptedRuns) on an in-memory drizzle stand-in (the
 * T2B harness, foeKhongGuiLaiKhiKhongRo.r1b2b2.test.ts); only the dispatchers, the pinned-STOP predicate (phanLoaiStopGhimChoFoe — the
 * A2(h) shared predicate, its answer scripted here), the URGENT alert and the audit trail are recorded. The device oracle is the OT
 * dispatcher mock: every write that would leave the engine passes through it. The DB half (real dispatcher, S7 sim PDUs):
 * foeKetCucKhongRo.a2n.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { banSaoHang } from "../../../routers/__otFakeDb"; // A2(n) T7b-1d lượt sửa 1 — one definition of what a database hands back
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript"; // A2(n) T8 — the sweeper census reads the sources

const { otDispatchMock, robotDispatchMock, ghimMock, alerts, audits, HX } = vi.hoisted(() => ({
  /** T2 — alertBen: what the alert reports through baoBen, null ⇔ it says nothing; alertNem: it throws. I-2 — this step-row write throws (a DB error on the unknown path); I-C — it never answers; m-6 — the audit row is not written; M-5 — the run's context write throws */
  HX: { rowThrows: null as null | ((r: Record<string, any>) => boolean), rowHangs: null as null | ((r: Record<string, any>) => boolean), rowSlowMs: null as null | ((r: Record<string, any>) => number), auditFails: false, contextThrows: false, alertBen: true as boolean | null, alertNem: false, alertNemKhi: null as null | ((a: Record<string, any>) => boolean) },
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
      if (HX.alertNem || HX.alertNemKhi?.(a)) throw new Error("alert down (test)");
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
      return Promise.resolve(current.slice(0, n).map(banSaoHang));
    },
    then(res: any, rej: any) {
      return Promise.resolve(current.map(banSaoHang)).then(res, rej);
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
        pending = arr.map((row) => banSaoHang({ id: nextId(tableName), ...row }));
        return ins;
      },
      returning() {
        rows(tableName).push(...pending);
        return Promise.resolve(pending.map(banSaoHang));
      },
      onConflictDoUpdate(opts: any) {
        // upsert on (runId, stepId) for run_steps
        const list = rows(tableName);
        for (const row of pending) if (HX.rowThrows?.(row)) return Promise.reject(new Error("step row write failed (test)"));
        for (const row of pending) if (HX.rowHangs?.(row)) return new Promise(() => undefined);
        const apply = () => {
          for (const row of pending) {
            const existing = list.find((r) => r.runId === row.runId && r.stepId === row.stepId);
            if (existing) Object.assign(existing, banSaoHang(opts.set));
            else list.push(banSaoHang(row));
          }
        };
        const cham = Math.max(0, ...pending.map((row) => HX.rowSlowMs?.(row) ?? 0));
        if (cham > 0) return new Promise<void>((r) => setTimeout(() => (apply(), r()), cham));
        apply();
        return Promise.resolve();
      },
      then(res: any, rej: any) {
        rows(tableName).push(...pending);
        return Promise.resolve(pending.map(banSaoHang)).then(res, rej);
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
        for (const r of matched) Object.assign(r, banSaoHang(patch));
        const result = matched.map((r) => banSaoHang(r));
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
import { abortRowId, abortRun, autoResumeInterruptedRuns, deployWorkflow, FOE_NOT_SENT_RUN_LATCHED, FOE_OUTCOME_UNKNOWN, getRun, goGiuDaDi, resumeRun, startRun } from "./foeEngine";
import { baoCaoHopLe, baoCaoKhongRoTuHang, chuBuTruTrongDinhNghia, dauKhongRoTuBaoCao, duongToiBuoc, edgeResumeStateOf, loiKhongGuiChot, themBuocHongKhiTiepTuc, toTienCua } from "./foeRunStore";
import { FOE_STOP_NOT_SENT, MA_CHUA_GHI, loiChuaRaStop, loiGiuChuaRa, maTuChoiCua, nguonCuaKetQua, viChuaRaCuaLoi,
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
  chuLuotStopHongBuTru,
  chuStopChuaGiaoBuTru,
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
  HX.alertNemKhi = null;
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

  it("N3 pins UNREADABLE (predicate error / throws) ⇒ T5 (decisions 2, A): not 'not a STOP': the marked fresh row, its dispatcher decides", async () => {
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: "pin read down (test)" }));
    const a = await chay([main(stopComp())]);
    expect(sent("stop")).toHaveLength(1);
    expect(a.res.status).toBe("failed");
    expect(rows("ai_pending_actions").filter((r) => JSON.stringify(r.previewJson ?? {}).includes("hangMoiStopGhim"))).toHaveLength(1);
    ghimMock.mockImplementation(async () => {
      throw new Error("db down (test)");
    });
    otDispatchMock.mockClear();
    const b = await chay([main(stopComp())]);
    expect(sent("stop")).toHaveLength(1);
    expect(runRow(b.runId).status).toBe("failed");
    // a stop-typed write the predicate says is NOT pinned (no pins on the tag) ⇒ held
    ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
    otDispatchMock.mockClear();
    await giuKhongRo([main(stopComp())]);
    expect(sent("stop")).toHaveLength(0);
  });

  it("N3b classified pinned, but the dispatch-time authorisation does NOT see a pinned STOP (pins changed) ⇒ never handed over, held", async () => {
    let n = 0;
    ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop" && ++n === 1, loiDocGhim: null })); // 1st = the split, 2nd = the authorisation at dispatch, 3rd = the final STOP pass (not pinned: nothing sent)
    const { runId } = await giuKhongRo([main(stopComp())]);
    // X-24 (N2, measured 19/11 12:51): a 3rd pin read is the final STOP pass re-classifying the held `undo` (duongKetThuc → guiStopSauChot → stopToTienSauGiu → laBuTruStop), it sends nothing; so this case rests on the consequences below, not on a count of reads
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
          const k = `run=${runRow(runId).status} stop=${sent("stop").length} undo=${(await step(runId, "undo"))?.status} ds=${dauKetCucKhongRoCua(runRow(runId).contextJson)?.ds?.length}`;
          dem.set(k, (dem.get(k) ?? 0) + 1);
        }
      }
      console.log(`[PROBE K2-dua ${dang}]`, JSON.stringify([...dem]));
      // ds: one hold, whichever way it came. T5 — a read that failed takes the marked route: it goes, nothing is held
      expect([...dem]).toEqual([[dang === "khongGhim" ? "run=held stop=0 undo=held ds=1" : "run=failed stop=1 undo=compensated ds=undefined", 30]]);
    });
    if (dang === "khongGhim") {
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
  it("K2-ds a compensation held by the walk, classified pinned again at the last pass, not pinned at that dispatch either: one hold, one entry for a Continue", async () => {
    let n = 0;
    ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop" && ++n % 2 === 1, loiDocGhim: null }));
    const { runId } = await giuKhongRo([main(stopComp())]);
    expect(sent("stop")).toHaveLength(0);
    expect(dauKetCucKhongRoCua(runRow(runId).contextJson)?.ds).toHaveLength(1);
  });
  it("K2a-cham the door's refused step, its failed row slow: the pass holds its compensation first; the row's late 'not looked at again' does not bury that hold: Continue sends the STOP", async () => {
    let n = 0;
    let hoi = false;
    ghimMock.mockImplementation(async (_d, i) => {
      if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
      return { pinnedStop: hoi || ++n === 1, loiDocGhim: null };
    });
    HX.rowSlowMs = (r) => (r.stepId === "r3" && r.status === "failed" ? 60 : 0);
    const r3 = { id: "r3", type: "command", machineId: 1, command: "pause", compensation: stopComp() } as WorkflowStep;
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? (await new Promise((r) => setTimeout(r, 10)), TIMEOUT) : ACKED));
    const { runId } = await chay([{ id: "p", type: "parallel", failFast: false, steps: [main(), seq("b", [{ id: "w", type: "delay", ms: 40 } as WorkflowStep, r3])] } as WorkflowStep]);
    await new Promise((r) => setTimeout(r, 40));
    expect(runRow(runId).status).toBe("held");
    expect(runRow(runId).contextJson.foeResumeState.r3).toMatchObject({ state: "compensationHeld" });
    hoi = true;
    HX.rowSlowMs = null;
    otDispatchMock.mockClear();
    grant(APPROVER);
    await resumeRun(runId, { approved: true, note: "checked on site" }, APPROVER);
    await vi.waitFor(() => expect(sent("stop")).toHaveLength(1));
  });
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
    expect(await s.buTruLaStopGhim({} as never, cmd("otStop"))).toBe("stop");
    expect(await s.buTruLaStopGhim({} as never, cmd("robotStop"))).toBe("stop"); // R-2
    expect(await s.buTruLaStopGhim({} as never, cmd("unsure"))).toBe("chuaDoc"); // A2(n) T5 — not "khong": central could not read its pins
    expect(await s.buTruLaStopGhim({} as never, cmd("other"))).toBe("khong");
    s.ketCucKhongRo({} as never, { loai: "held", stepId: "m", compId: "c", error: "FOE_OUTCOME_UNKNOWN: x", lan: "ignored" });
    await s.setStatusUnlessAborted(5, "held", { error: "e" });
    expect(s.segmentEnd()).toMatchObject({ outcome: "held", heldReason: "outcomeUnknown" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "anomaly", code: KHONG_RO_EDGE_ANOMALY, runId: 5 });
    expect(docAnomalyKhongRo(events[0]!.detail)).toMatchObject({ loai: "held", stepId: "m", compId: "c", claimSeq: 2 });
  });

  // T4 bước 3, bổ sung B (MOI-29, HST 14/11): edgeRunStore.sweepSource đọc `attempted` của hàng cục bộ (priorStepsOf). Hướng rơi khi mất phần đọc đó: "STOP không gửi"
  // (mayHaveActuated sai ⇒ runHasActuated sai ⇒ R-6-b: run "chưa bao giờ tác động" không gửi STOP nào). Ca chỉ test; đỏ dưới đột biến "bỏ phần đọc attempted".
  it("T4-B3-MOI-29 the edge store's abort picture: the walker's own `attempted` and its prior picture EMPTY, a command row of this segment handed over ⇒ that command may have actuated (its STOPs are sent); a step with no row may not", async () => {
    const pkg = { runId: 5, claimSeq: 2, verifiedStops: [{ kind: "ot", stepId: "nt", adapterId: 501, pins: [] }], stopsUnsure: [], resolvedAdapters: [], prior: { abortSentBefore: [] }, definition: { steps: [] }, machines: [] } as unknown as EdgeRunPackage;
    const s = createEdgeRunStore(pkg, { runId: 5, claimSeq: 2, claimToken: "t", sink: { run: async () => ({ seq: 1 }), event: async () => ({ seq: 1 }) }, authorize: { authorize: async () => ({ ok: false, verdict: "unavailable", code: null }) } });
    await s.upsertStep(5, "x", "command", { status: "running", attempt: 1, result: { routedTo: "robot-dispatcher" }, error: null, startedAt: new Date(0) });
    const rc = {
      def: { ref: "m29", name: "m29", steps: [] },
      machineById: new Map(),
      context: {},
      completed: new Set<string>(),
      settled: new Set<string>(),
      dispatched: new Set<string>(),
      attempted: new Set<string>(),
      startOrder: [] as string[],
      prior: { settled: new Set<string>(), branches: new Map(), startOrder: [] as string[], attempted: new Set<string>(), unknown: false },
    };
    const src = await s.sweepSource({ live: rc as never });
    expect(src, "a live walker: a picture").not.toBeNull();
    expect(src!.mayHaveActuated("x"), "the row of this segment says x was handed over: it may have actuated").toBe(true);
    expect(src!.mayHaveActuated("y"), "no row, nothing in memory: not").toBe(false);
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
    expect(src).toContain('if (rc.chiStopGhimIds?.has(step.id) && rc.store.kind === "central" && !robotKind && auth.stopGhim !== true && auth.stopChuaDocGhim !== true) {');
    expect(src).toContain("if (buTruKhongRoCho(ctx).length > 0) continue;"); // extension (2): a latched run with no hold is walked (the forward sink), the marker skips
    // the automatic STOP goes through the engine's own compensation path (runCompensation → execCommand → dispatcher), no shortcut
    const body = src.slice(src.indexOf("async function guiStopKhongRo("), src.indexOf("function loaiGuiStop("));
    expect(body).toContain("c = await runCompensation(rc, step, loi, { attempt: thu });");
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

  it("I-3 + m-1 the URGENT says what really happened: simulated ⇒ 'simulated — NOT sent' (never 'sent'); refused ⇒ state C, 'did NOT go out' (T5, H1); never handed over ⇒ 'NOT sent'", async () => {
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
    expect(alertsOf("stopNotSent")).toHaveLength(1);
    expect(alertsOf("stopNotConfirmed")).toHaveLength(0);
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
    // C7-XNb (chủ dự án 19/11 "1.chặn", C7-XN P1): stopX is refused again at the Continue's first pass, a STOP known not handed over ⇒ no compensation that is not a STOP goes
    const cb = await tiep(b.runId);
    expect(String(cb.status)).toBe("held"); // positive anchor: resumeRun returns once the walk ended
    expect(sent("reset")).toEqual([]); // C7-XNb: neither undo nor kUndo (was: undo once) — the behaviour first
    expect(String(runRow(b.runId).error ?? "").endsWith(` ${chuStopChuaGiaoBuTru(b.runId)}`)).toBe(true); // it was the C7-XN gate that held it
    expect(sent("stop").length).toBeGreaterThan(0); // the STOP re-sent, with its default of attempts
  });

  it("I-A-UNDO-MOT-LAN (C7-XNb) the same container, stopX refused in walk 1 and ACCEPTED at the Continue: no STOP known not handed over, undo goes once, kUndo not a second time", async () => {
    const treTimeout = async (ms: number) => (await new Promise((r) => setTimeout(r, ms)), TIMEOUT);
    let luot = 1;
    otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? treTimeout(1_100) : i.commandType === "stop" ? (luot === 1 ? REJECTED : ACKED) : ACKED));
    const b = await giuKhongRo([par("p", [main(resetComp("undo")), seq("k", [{ id: "stopX", type: "command", machineId: 1, command: "stop" } as WorkflowStep], resetComp("kUndo", 1))])]);
    expect(sent("reset")).toHaveLength(1); // kUndo: a known failure, as before
    otDispatchMock.mockClear();
    luot = 2;
    await tiep(b.runId);
    expect(sent("reset")).toHaveLength(1); // undo; kUndo not a second time
    expect(sent("stop").length).toBeGreaterThan(0); // the STOP re-sent, accepted
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
  // T4 bước 3 (chủ dự án 14/11, R2 (a)) — ĐO chuẩn TRUNG TÂM cho parity :1896 (đỏ :1964 ở 3c85d0bad): URGENT nào, cho bước nào, lúc giữ và sau MỘT lần duyệt
  it("T4-B3-URGENT-TT the latched run holds at the compensation of the unknown step, a forward step behind it: which URGENTs fire at the hold and after the ONE approved Continue", async () => {
    const { runId } = await giuKhongRo([main(resetComp("c1")), { id: "r2", type: "command", machineId: 3, command: "reset" } as WorkflowStep]);
    await vi.waitFor(() => expect(alertsOf("held")).toHaveLength(1));
    const khoa = (a: Record<string, unknown>) => `${String(a.kind)}|${String(a.dedupKey).split(":").slice(2, 4).join(":")}`;
    const luc = alerts.map(khoa).sort();
    expect(luc, "at the hold").toEqual([`${CANH_BAO_KHONG_RO_KIND.forwardNotSent}|r2:-`, `${CANH_BAO_KHONG_RO_KIND.held}|main:c1`].sort());
    const n = alerts.length;
    otDispatchMock.mockClear();
    expect((await tiep(runId)).status).toBe("failed");
    expect(sent("reset")).toEqual(["reset"]); // c1 once; r2 never
    await new Promise((r) => setTimeout(r, 50));
    expect(alerts.slice(n).map(khoa).sort(), "after the ONE approved Continue").toEqual([]);
  });
  // T4 bước 3 (chủ dự án 14/11, R2 (a)) — ĐO chuẩn TRUNG TÂM trước khi viết ca edge: duyệt có người + lý do nhưng interlock chặn; rồi interlock mở lại
  it("T4-B3-INTERLOCK-TT an approved compensation whose interlock BLOCKS: not sent, its row failed, the run fails, a person told; the interlock opening again sends NOTHING (a failed run is not continued: no second approval)", async () => {
    const { runId } = await giuKhongRo([main({ ...resetComp("c1"), ...dk } as WorkflowStep)]);
    otDispatchMock.mockClear();
    expect((await tiep(runId)).status).toBe("failed");
    expect(sent("reset")).toHaveLength(0);
    await vi.waitFor(() => expect(alertsOf("approvedNotSent")).toHaveLength(1));
    expect(rows("orchestration_run_steps").find((r) => r.runId === runId && r.stepId === "c1")).toMatchObject({ status: "failed" });
    runRow(runId).paramsJson = { ...((runRow(runId).paramsJson as Record<string, unknown> | null) ?? {}), doorClosed: true }; // the interlock opens again
    await resumeRun(runId, { approved: true, note: "door closed now" }, ADMIN, {}, { scope: null }).catch((err: unknown) => err);
    expect(runRow(runId).status).toBe("failed");
    expect(sent("reset")).toHaveLength(0);
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
      expect((auditBuoc()[0]!.details as { metadata: Record<string, unknown> }).metadata).toMatchObject({ stepId: "r3", attempt: 0 }); // X-24: the door audits attempt 0 (foeEngine.ts:1576)
      // X-25 (5) — the door's cut is named at the walk's end, one URGENT per step dropped (foeEngine.ts:1728-1735 baoBuocTienBiBo)
      await vi.waitFor(() => expect(alertsOf("forwardNotSent").filter((x) => String(x.dedupKey).split(":")[2] === "r3")).toHaveLength(1));
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
    expect(await step(runId, "r3")).toMatchObject({ attempt: 0 }); // X-24: the door's row carries no attempt (foeEngine.ts:1577) ⇒ the store's default (foeRunStore.ts:1172)
    const n = rows("ai_pending_actions").filter((a) => /-r3-a/.test(String(a.id))).length;
    expect(n).toBe(0); // X-24: the door stands before any authorisation — no `-a1`, no `-a2`
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
  it("★ (1) the refused step's own compensation: a non-STOP one is not due (it was never sent); a STOP one goes at once (F11); the container's still takes the split (STOP at once, non-STOP held)", async () => {
    const a = await chay([par("p", [main(), seq("b", [delay("w", 60), pause("r3", { compensation: resetComp("c3") })], stopComp("bs"))], { failFast: false })]);
    expect(sent("reset")).toHaveLength(0);
    expect(await step(a.runId, "c3")).toBeUndefined();
    expect(sent("stop")).toHaveLength(1); // the container's
    expect(a.res.status).toBe("failed");
    otDispatchMock.mockClear();
    const b = await chay([par("p", [main(), seq("b", [delay("w", 60), pause("r4", { compensation: stopComp("c4") })], resetComp("bu"))], { failFast: false })]);
    expect(sent("stop")).toEqual(["stop"]); // X-24 (F11, owner's decision 1, 07/11): r4's own STOP compensation c4 goes at the door (datStopCuaBuoc → stopToTienSauGiu)
    expect(await step(b.runId, "c4")).toMatchObject({ status: "compensated" });
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
    expect((await step(runId, "r6"))!.error).toBe('Command "pause" rejected (rejected).'); // X-24 (C5, HST 18/11): no attempt 2 on a latched run (foeEngine.ts:1158); the row keeps attempt 1's words (foeEngine.ts:2312)
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
  it("(a known failure of an earlier walk is not 'may have gone out': its row keeps the device's own word (F12-9), and it is not an unknown)", async () => {
    const { runId } = await chay([par("p", [pause("y")], { failFast: false })], (id) => {
      runRow(id).contextJson = { ...(runRow(id).contextJson ?? {}), foeKetCucKhongRoChot: { stepId: "zz", ma: "FOE_OUTCOME_UNKNOWN", at: "t" } };
      rows("orchestration_run_steps").push({ id: 99_004, runId: id, stepId: "y", stepType: "command", status: "failed", error: "rejected", attempt: 1, resultJson: null, startedAt: new Date(), finishedAt: null });
    });
    expect(sent("pause")).toHaveLength(0);
    expect(await step(runId, "y")).toMatchObject({ status: "failed", error: "rejected", attempt: 1 }); // X-24 (F12-9, HST 18/11): settled by the earlier walk (foeRunStore.ts:329) ⇒ the door writes nothing (foeEngine.ts:1572)
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
  // rows of the table with no label of this function
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

describe("A2(n) T5 — state C, the pure parts", () => {
  it("maTuChoiCua: the dispatcher's reason, else the code a text opens with, else the status; never a driver's text", () => {
    expect(maTuChoiCua({ error: "socket hang up 10.1.2.3", status: "failed", detail: { reason: "DRIVER_ERROR" } })).toBe("DRIVER_ERROR");
    expect(maTuChoiCua({ error: "INTERLOCK_NOT_MET: rule 7 at 10.1.2.3", status: "rejected" })).toBe("INTERLOCK_NOT_MET");
    expect(maTuChoiCua({ error: "EDGE_DEVICE_REFUSED(x): step", status: "rejected" })).toBe("EDGE_DEVICE_REFUSED");
    expect(maTuChoiCua({ error: "socket hang up 10.1.2.3", status: "failed" })).toBe("FAILED");
    expect(maTuChoiCua({ error: "a sentence", detail: { reason: "not a code 10.1.2.3" } })).toBe("REFUSED");
  });
  it("nguonCuaKetQua (H11): rejected never reached a driver; an OT failed only in the list; a robot's failed always did", () => {
    expect(nguonCuaKetQua("rejected", "BUSY", false)).toBe("tuChoi");
    expect(nguonCuaKetQua("rejected", "ROBOT_REFUSED", true)).toBe("tuChoi");
    for (const ma of MA_CHUA_GHI) {
      expect(nguonCuaKetQua("failed", ma, false)).toBe("tuChoi");
      expect(nguonCuaKetQua("failed", ma, true)).toBe("driverLoi");
    }
    expect(nguonCuaKetQua("failed", "MOT_PHAN", false)).toBe("driverLoi");
    expect(nguonCuaKetQua("failed", "DRIVER_WRITE_FAILED", false)).toBe("driverLoi");
  });
  it("the row and its source: read back the same, for every source, under the known code", () => {
    for (const vi of [{ nguon: "doc", ma: "ADAPTER_UNRESOLVED" }, { nguon: "tuChoi", ma: "BUSY" }, { nguon: "driverLoi", ma: "DRIVER_ERROR" }] as const) {
      const loi = loiChuaRaStop("st", 2, vi);
      expect(loi.startsWith(`${FOE_STOP_NOT_SENT}: STOP "st"`)).toBe(true);
      expect(viChuaRaCuaLoi(loi)).toEqual(vi);
      expect(loiLaKetCucKhongRo(loi), "state C is not an unknown outcome").toBe(false);
    }
    expect(viChuaRaCuaLoi("Command rejected")).toBeUndefined();
    expect(viChuaRaCuaLoi(null)).toBeUndefined();
  });
  it("the URGENT and the hold say what is true of the source", () => {
    const t = (vi?: { nguon: "doc" | "tuChoi" | "driverLoi"; ma: string }) => noiDungCanhBaoKhongRo({ loai: "stopNotSent", runId: 9, stepId: "st", compId: KHONG_CO_BU_TRU, error: "FOE_OUTCOME_UNKNOWN", lan: "chot", biet: true, ...(vi ? { vi } : {}) });
    expect(t({ nguon: "driverLoi", ma: "X_Y" }).title).toContain('STOP "st" NOT confirmed out');
    expect(t({ nguon: "driverLoi", ma: "X_Y" }).message).not.toContain("did NOT go out");
    expect(t({ nguon: "driverLoi", ma: "X_Y" }).message).not.toContain("read recovers");
    expect(t({ nguon: "tuChoi", ma: "X_Y" }).message).toContain("did NOT go out");
    expect(t({ nguon: "tuChoi", ma: "X_Y" }).message).toContain("X_Y");
    expect(t({ nguon: "tuChoi", ma: "X_Y" }).message).not.toContain("read recovers");
    expect(t({ nguon: "doc", ma: "X_Y" }).message).toContain("once the read recovers");
    expect(t().message).toContain("once the read recovers");
    expect(t({ nguon: "tuChoi", ma: "X_Y" }).dedupKey).toBe("foe_outcome_unknown_stop_not_sent:9:st:-:chot");
    const c = noiDungCanhBaoKhongRo({ loai: "stopNotSent", runId: 9, stepId: "x", compId: "cs", error: "FOE_OUTCOME_UNKNOWN", lan: "chot", vi: { nguon: "tuChoi", ma: "X_Y" } });
    expect(c.message).toContain('STOP "cs" did NOT go out');
    expect(loiGiuChuaRa("st", { nguon: "driverLoi", ma: "X_Y" })).not.toContain("did NOT go out");
    expect(loiGiuChuaRa("st", { nguon: "tuChoi", ma: "X_Y" })).toContain("Abort sends it again");
    expect(loiGiuChuaRa("st", undefined)).toContain("once the read recovers");
    for (const vi of [undefined, { nguon: "tuChoi", ma: "X" }, { nguon: "driverLoi", ma: "X" }, { nguon: "doc", ma: "X" }] as const) expect(loiGiuChuaRa("st", vi)).not.toContain("Continue");
  });
  it("the edge's report carries the source; what is not a code does not cross", () => {
    const d = chiTietAnomalyKhongRo({ loai: "stopNotSent", stepId: "st", compId: KHONG_CO_BU_TRU, error: "FOE_OUTCOME_UNKNOWN", claimSeq: 2, biet: true, vi: { nguon: "tuChoi", ma: "BUSY" } });
    expect(docAnomalyKhongRo(d)).toMatchObject({ loai: "stopNotSent", vi: { nguon: "tuChoi", ma: "BUSY" }, biet: true });
    const lau = JSON.stringify({ loai: "stopNotSent", stepId: "st", compId: "-", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 2, vi: { nguon: "tuChoi", ma: "socket 10.1.2.3 closed" } });
    expect(docAnomalyKhongRo(lau)?.vi).toBeUndefined();
    const nguon = JSON.stringify({ loai: "stopNotSent", stepId: "st", compId: "-", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 2, vi: { nguon: "khac", ma: "BUSY" } });
    expect(docAnomalyKhongRo(nguon)?.vi).toBeUndefined();
  });
});

// ═══ ĐOẠN 2 → server/services/orchestration/foe/foeKetCucKhongRo.a2n.test.ts, mức trên cùng, chèn NGAY TRƯỚC dòng chú thích `// A2(n) T7b-3 (H36, chu du an 10/11) — the words of
// ═══        a STOP a run that acted, never latc…` (dòng 2272, đứng trước `describe("A2(n) T7b-3 — the words of a pinned STOP a run ended with, unswept (H36)"` ở dòng 2273).
// ═══        Dùng import có sẵn: noiDungCanhBaoKhongRo (dòng 233), KHONG_CO_BU_TRU (dòng 239), describe / it / expect (dòng 9). Không import mới.
// X13-CHU — DO-70 / lô X-13 commit 1 (chỉ test). Số quyết định: chủ dự án 17/11, X-13 phương án (C) + G1' (HST 17/11 vòng 10); HST 17/11 duyệt tên ca. Chữ HST duyệt 17/11 bản 2:
// tam/x13-chu-de-nghi.md (sha16 06e9d8bf83734949), chép NGUYÊN VĂN, MỘT chỗ khai cho chữ URGENT (câu trả lời khai ở foeRunStoreParity.dot10.test.ts, khối X-13). Không gọi hàm nào để dựng kỳ vọng.
// Thứ tự bản duyệt (HST 17/11 (1)): hành động trước, điều kiện sau — câu "… did NOT send …" rồi câu "Check the machine on site … direct STOP / E-STOP." đứng đầu thân.
/** x13-chu-de-nghi.md §2: tiêu đề (không tiền tố "Run N: " mà noiDungCanhBaoKhongRo đặt) và thân, nguyên văn; `id` là id IN RA (≤ 14 ký tự thì nguyên) */
const X13_URGENT = {
  chuaKhoaKhongXacMinh: {
    tieuDe: (id: string) => `step "${id}" NOT sent: its pins could not be read`,
    hai: (run: number, id: string) => `Central's Abort of run ${run} did NOT send step "${id}": its pins could not be read, so it was not verified as a pinned STOP and nothing was written to the device for it. Check the machine on site and use its direct STOP / E-STOP.`,
    than: (run: number, id: string) =>
      `Central's Abort of run ${run} did NOT send step "${id}": its pins could not be read, so it was not verified as a pinned STOP and nothing was written to the device for it. Check the machine on site and use its direct STOP / E-STOP. A further press of Abort can send it only if its pins are then read as a pinned STOP (on an edge node's adapter: queued for or left to that node, or sent as central's fallback STOP), within 15 minutes from when the run was aborted, or with no time limit once the run records a command whose outcome is unknown, while it stays owed. Otherwise no press sends it.`,
  },
  chuaKhoaKetNoi: {
    tieuDe: (id: string) => `STOP "${id}" NOT sent: central could not confirm the connection to its adapter`,
    hai: (run: number, id: string) => `Central's Abort of run ${run} did NOT send STOP "${id}": its pins were read, but central could not confirm the running connection to its adapter, so it was not verified and nothing was written to the device for it. Check the machine on site and use its direct STOP / E-STOP.`,
    than: (run: number, id: string) =>
      `Central's Abort of run ${run} did NOT send STOP "${id}": its pins were read, but central could not confirm the running connection to its adapter, so it was not verified and nothing was written to the device for it. Check the machine on site and use its direct STOP / E-STOP. A further press of Abort can send it only if its pins are then read as a pinned STOP and that connection is then confirmed (on an edge node's adapter: queued for or left to that node, or sent as central's fallback STOP), within 15 minutes from when the run was aborted, or with no time limit once the run records a command whose outcome is unknown, while it stays owed. Otherwise no press sends it; central does not send it on its own when the connection comes back.`,
  },
  chuaKhoaKhongBen: {
    tieuDe: (id: string) => `step "${id}" NOT sent: its record could not be written`,
    hai: (run: number, id: string) => `Central's Abort of run ${run} did NOT send step "${id}", and the record of it could not be written, so a further press may not reach it. The STOP was not sent: check the machine on site and use its direct STOP / E-STOP.`,
    than: (run: number, id: string) => `Central's Abort of run ${run} did NOT send step "${id}", and the record of it could not be written, so a further press may not reach it. The STOP was not sent: check the machine on site and use its direct STOP / E-STOP.`,
  },
} as const;
type ChuX13 = keyof typeof X13_URGENT;
/** the URGENT of the press on a run not latched, as the engine raises it (lan `xm`, chuAbort of X-13); the new values read through a wide type: tsc stays clean before the fix */
const urgentX13 = (chu: ChuX13, runId: number, stepId: string) =>
  noiDungCanhBaoKhongRo({ loai: "abortStopNotSent", runId, stepId, compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "xm", biet: true, vi: { nguon: "doc", ma: "NOT_CONFIRMED" }, chuAbort: chu, tuTrungTam: true } as never);
describe("X-13 — the URGENT of a STOP an Abort did not send on a run not latched (G1, G1', khongBen): the approved words", () => {
  // CHU-TRUNG-DUYET — chữ trong mã trùng tệp duyệt TỪNG KÝ TỰ (cách X-11 khoá x11-chu-duyet.md: KD-k1, P:3578-3583), cả ba biến thể
  it("T4-B3-LO2A-CHU-TRUNG-DUYET (X-13, chữ duyệt 06e9d8bf83734949) the three URGENTs of X-13 (G1, G1', khongBen): title and body exactly the approved words, the event tag after", () => {
    for (const chu of Object.keys(X13_URGENT) as ChuX13[]) {
      const n = urgentX13(chu, 7, "s9");
      expect(n.title, `${chu}: the approved title`).toBe(`Run 7: ${X13_URGENT[chu].tieuDe("s9")}`);
      expect(n.message, `${chu}: the approved body, the event tag after`).toBe(`${X13_URGENT[chu].than(7, "s9")} [event xm]`);
      expect(n.dedupKey, `${chu}: the key of the press on a run not latched`).toBe(`${n.kind}:7:s9:-:xm`);
    }
  });
  // A8 — G1 and khongBen: the order of the approved words (action, then condition), ≤ 800 with a long id, no opening of an unknown outcome (khongChot)
  it("T4-B3-LO2A-THUAN-CHU (X-13 A8: chuaKhoaKhongXacMinh, chuaKhoaKhongBen) the first two sentences open the body; title and body ≤ 800 with a 200-character id; never the words of an unknown outcome", () => {
    const dai = "s".repeat(200);
    for (const chu of ["chuaKhoaKhongXacMinh", "chuaKhoaKhongBen"] as const) {
      const n = urgentX13(chu, 2_147_483_647, "s9");
      expect(n.message.startsWith(X13_URGENT[chu].hai(2_147_483_647, "s9")), `${chu}: '… did NOT send …' then 'Check the machine on site … direct STOP / E-STOP.' first`).toBe(true);
      expect(`${n.title} ${n.message}`, `${chu}: no unknown outcome (khongChot)`).not.toMatch(/unknown outcome|outcome unknown|UNKNOWN/);
      const d = urgentX13(chu, 2_147_483_647, dai);
      expect(d.title.length, `${chu}: title ≤ 800`).toBeLessThanOrEqual(800);
      expect(d.message.length, `${chu}: message ≤ 800`).toBeLessThanOrEqual(800);
      expect(d.message, `${chu}: the action first, whatever the id`).toMatch(/^Central's Abort of run 2147483647 did NOT send step "[^"]+"/);
      expect(d.message, `${chu}: the safe act whole`).toMatch(/[Cc]heck the machine on site and use its direct STOP \/ E-STOP\./);
      expect(d.dedupKey, `${chu}: the key keeps the whole id`).toBe(`${d.kind}:2147483647:${dai}:-:xm`);
    }
  });
  // A19 — G1' (HST 17/11 vòng 10): the same for chuaKhoaKetNoi
  it("T4-B3-LO2A-THUAN-CHU-G1P (X-13 A19: chuaKhoaKetNoi) the first two sentences open the body; title and body ≤ 800 with a 200-character id; never 'pins could not be read', never an unknown outcome", () => {
    const n = urgentX13("chuaKhoaKetNoi", 2_147_483_647, "s9");
    expect(n.message.startsWith(X13_URGENT.chuaKhoaKetNoi.hai(2_147_483_647, "s9")), "'… did NOT send STOP …' then 'Check the machine on site … direct STOP / E-STOP.' first").toBe(true);
    expect(`${n.title} ${n.message}`).not.toMatch(/pins could not be read/);
    expect(`${n.title} ${n.message}`).not.toMatch(/unknown outcome|outcome unknown|UNKNOWN/);
    const d = urgentX13("chuaKhoaKetNoi", 2_147_483_647, "s".repeat(200));
    expect(d.title.length, "title ≤ 800").toBeLessThanOrEqual(800);
    expect(d.message.length, "message ≤ 800").toBeLessThanOrEqual(800);
    expect(d.message).toMatch(/^Central's Abort of run 2147483647 did NOT send STOP "[^"]+": its pins were read/);
    expect(d.message).toContain("Check the machine on site and use its direct STOP / E-STOP.");
  });
});
// A2(n) T7b-3 (H36, chu du an 10/11) — the words of a STOP a run that acted, never latched, ended with and no sweep sent: pure
describe("A2(n) T7b-3 — the words of a pinned STOP a run ended with, unswept (H36)", () => {
  const n = (ketThuc: "aborted" | "failed" | "completed", extra: Record<string, unknown> = {}) =>
    noiDungCanhBaoKhongRo({ loai: "stopEndedUnswept", runId: 9, stepId: "s", compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "ket", ketThuc, ...extra } as never);
  const hua = /press(?:ing)? Abort again|Abort (?:sends|will send|can send)|\ba (?:later |further )?press (?:sends|will send)/i;
  it("T7B3-CHU each end: the STOP by name, NOT sent, the machine on site; the window only on an aborted run, from when it was aborted; nothing unknown, no promise; one key", () => {
    for (const ket of ["aborted", "failed", "completed"] as const) {
      const x = n(ket);
      const t = `${x.title} ${x.message}`;
      expect(x.kind).toBe("foe_outcome_unknown_stop_ended_unswept");
      expect(x.dedupKey).toBe("foe_outcome_unknown_stop_ended_unswept:9:s:-:ket");
      expect(t).toContain(`"s"`);
      expect(String(x.message), "the message names it too, not only the title").toContain(`"s"`);
      expect(t).toContain("NOT sent");
      expect(t).toContain(`ended ${ket}`);
      expect(t).toMatch(/check the machine on site/i);
      expect(t).toContain("E-STOP");
      expect(t, ket).not.toMatch(hua);
      expect(t, ket).not.toMatch(/UNKNOWN|outcome/);
      if (ket === "aborted") expect(t).toContain("within 15 minutes of when the run was aborted");
      else {
        expect(t, ket).not.toMatch(/\d+ minutes/);
        expect(t, ket).toContain("already terminal");
      }
    }
  });
  it("T7B3-CHU-CHUA-DOC a step whose pins could not be read: not verified as a pinned STOP, never called a STOP that went; the records unread: no step named", () => {
    const x = n("failed", { stopKhongXacMinh: true });
    expect(`${x.title} ${x.message}`).toContain(`step "s" could not be verified as a pinned STOP`);
    const k = noiDungCanhBaoKhongRo({ loai: "stopEndedUnswept", runId: 9, stepId: "?", compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "ket", ketThuc: "aborted" } as never);
    expect(`${k.title} ${k.message}`).toContain("could not be read");
    expect(`${k.title} ${k.message}`).not.toContain(`"?"`);
    expect(`${k.title} ${k.message}`).toContain("within 15 minutes of when the run was aborted");
  });
  it("T7B3-NGUON the edge end's URGENT is raised after its transaction has committed, never inside it (the FakeDb has no real transaction: a source pin)", () => {
    const src = readFileSync(resolve(__dirname, "../../edge/edgeExecutionCentral.ts"), "utf8").replace(/\r\n/g, "\n");
    const ham = src.slice(src.indexOf("export async function completeForNodeV2("), src.indexOf("export async function releaseForNodeV2("));
    const tx0 = ham.indexOf("await d.transaction(async (tx) => {");
    const tx1 = ham.indexOf("\n    });\n", tx0);
    expect(tx0, "the transaction").toBeGreaterThan(0);
    expect(tx1, "its end").toBeGreaterThan(tx0);
    expect(ham.slice(tx0, tx1), "nothing of H36 inside the transaction").not.toMatch(/baoKetThucKhongQuet|canhBaoKetCucKhongRo/);
    const goi = ham.indexOf("m.baoKetThucKhongQuetSauDoanEdge(runId, ket)");
    expect(goi, "the call, after the commit").toBeGreaterThan(tx1);
    expect(ham.split("baoKetThucKhongQuetSauDoanEdge").length - 1, "one call").toBe(1);
  });
});

// A2(n) T7b-3 (H37, chu du an 11/11; H37-b 11/11: no mark of a debt) — the words of a run's edge report stream wedged by a refused batch: pure
describe("A2(n) T7b-3 H37 — the words of a stuck edge report stream", () => {
  it("T7B3-H37-CHU the run, the stream, the refusal, what may be owed by name when the batch named a STOP, the machine on site; one key per (run, stream, refusal); no promise", async () => {
    const { noiDungCanhBaoKhongRo: n, KHONG_CO_BU_TRU: K } = await import("./foeKetCucKhongRo");
    const a = n({ loai: "edgeStreamStuck", runId: 9, stepId: "unauthorised_actuation", compId: K, error: "FOE_STOP_NOT_SENT", lan: "run:9:2", stopTrongLo: ["s", "nt"] } as never);
    expect(a.kind).toBe("foe_outcome_unknown_edge_stream_stuck");
    expect(a.dedupKey).toBe("foe_outcome_unknown_edge_stream_stuck:9:unauthorised_actuation:-:run:9:2");
    expect(a.message).toContain("run 9");
    expect(a.message).toContain("stream run:9:2");
    expect(a.message).toContain(`STOP steps in the refused batch: "s", "nt".`);
    expect(a.message).toMatch(/may still owe a STOP/);
    expect(a.message).toMatch(/Check the machine on site and use its direct STOP \/ E-STOP/);
    expect(`${a.title} ${a.message}`).not.toMatch(/press(?:ing)? Abort|Abort (?:sends|will send|can send)|UNKNOWN|outcome/);
    const b = n({ loai: "edgeStreamStuck", runId: 9, stepId: "replayed", compId: K, error: "FOE_STOP_NOT_SENT", lan: "run:9:2" } as never);
    expect(b.message).not.toContain("refused batch:");
    expect(b.dedupKey).not.toBe(a.dedupKey);
    const c = n({ loai: "edgeStreamStuck", runId: 9, stepId: "unauthorised_actuation", compId: K, error: "FOE_STOP_NOT_SENT", lan: "run:9:3" } as never);
    expect(c.dedupKey, "another stream, the same code: another row").not.toBe(a.dedupKey);
  });
});

// A2(n) T8 (plan point 4, dieu-phoi 11/11) — CENSUS (AST): the URGENT obligation sweeper only raises. Every function it reaches, followed through foeRunStore.ts and foeKetCucKhongRo.ts (the modules of its
// raises), calls no walk, no engine, no dispatcher, no status write. lượt sửa 1 (rà T8 M12, M13): a call by a computed name (`o["dis" + "patch"](…)`) is refused outright, an update's `.set(…)` takes an
// object literal only (no variable, no spread), and every name called that is not a function of the two files is in the list CHO_PHEP below: a new one is red until it is read and listed.
// lượt sửa 2 (rà T8 fix1 RV-D1..D3): no `import()` in what it reaches; a bare name called is a function of the two files, a local function of that body, an import, a global or a Promise's `resolve`,
// never a name bound otherwise in that body (an alias: `const { dispatch: t } = …`); `.set(…)` on an `update(…)` is checked whatever its arguments and casts; `update(…)` of `orchestrationRuns`
// only, no `insert(…)`, no `delete(…)` of a table (a step row is never written).
// lượt sửa 3 (rà T8 fix2 RV2-C4, C5, C7): a forbidden name (CAM) or a loader of a dispatcher / the engine / the equipment adapter is not named at all in what it reaches, in any form (a call, an
// argument, a property, a destructured key, a string); `resolve` is a Promise executor's parameter only.
// The census is a second net; parity is the first (scada-master ruling 11/11). What it does NOT see (it needs data flow): an update builder held in a variable and its `.set(…)` later
// (`const u = tx.update(orchestrationRuns); u.set(vao, 0)`, rà RV2-C6): parity cases URGENT-EDGE-CHET-T8, G13, CHAN1-TIEN-QUET-T8, CHAN3-SONG-DELAY-T8, DAU-GOP-T8, RV2-D1-T8 catch a status written there (measured, lượt sửa 3: RV2-C6 red in those 6)
describe("A2(n) T8 — CENSUS: quetUrgentChuaBen reaches no command and writes no status", () => {
  const TEP = ["foeRunStore.ts", "foeKetCucKhongRo.ts"];
  const CAM = new Set(["execStep", "dispatch", "sendCommand", "dispatchRobotJob", "getAdapter", "abortRun", "abortStopSweep", "runAbortStopSweep", "resumeRun", "startRun", "driveRun", "driveRunFromResume", "guiStopSauChot", "resendAbortStops", "setRunStatus", "setRunStatusUnlessAborted", "setRunStatusUnlessAbortedOn", "upsertStep", "upsertStepOn", "recordEdgeStepRows", "applyEdgeSegmentEnd"]);
  /** the names it may call that are no function of the two files: the database's reads and the mark's write, the bound, the alert, the log, the language's own */
  const CHO_PHEP = new Set<string>(["Number", "String", "add", "allStepsOf", "and", "catch", "clear", "createAuditContext", "delete", "entries", "eq", "error", "exec", "filter", "find", "flatMap", "for", "from", "fromEntries", "get", "getDb", "getTime", "has", "inArray", "isArray", "isFinite", "isSafeInteger", "join", "keys", "limit", "logCrudOperation", "map", "max", "napAudit", "napCanhBao", "next", "now", "push", "raiseCriticalStopAlert", "readEdgeAssignment", "resolve", "round", "select", "set", "soNguoiNhan", "some", "sort", "startsWith", "t", "test", "then", "toISOString", "transaction", "trim", "update", "walkerSong", "warn", "where", "withDeadline", "xong", /* T9 (XAC_NHAN, xacNhanHetChot: the gate's and the sweep's one reading): the array's own, and the caller's pure predicate of commands (the sweep passes none) */ "every", "laLenh", /* T9 lượt sửa 3b (mục 4, rutGonGiua: the words' variable parts cut in the middle): the string's own pure cut */ "slice", /* T9 lượt sửa 3e (A1-31, idGonCua): node:crypto's one-shot hash("sha256", id, "hex") of a printed step id — pure, writes nothing */ "hash"]);
  /** the lazy loaders of the two files (napMotLan of ONE module each) and the names a body may take from what they load: a name destructured from anything else is an alias */
  const NAP: Record<string, { module: string; ten: readonly string[] }> = { napCanhBao: { module: "../../robot/criticalStopAlert", ten: ["raiseCriticalStopAlert"] }, napAudit: { module: "../../auditTrailService", ten: ["logCrudOperation", "createAuditContext"] } };
  /** a bare name called that is bound by nothing of the body: the language's own, and a Promise's resolve */
  const TOAN_CUC = new Set(["Number", "String", "Boolean", "Array", "Object", "Promise", "Date", "JSON", "Error", "Set", "Map", "isFinite"]);
  const nguon = new Map(TEP.map((t) => [t, ts.createSourceFile(t, readFileSync(resolve(__dirname, t), "utf8"), ts.ScriptTarget.Latest, true)] as const));
  /** every top-level function of the two files, by name (a declaration, or a const holding an arrow / function) */
  const ham = new Map<string, ts.Node>();
  /** the names the two files import as code (a type import is no code) */
  const nhap = new Set<string>();
  /** the tables the two files import from the schema */
  const bang = new Set<string>();
  /** lượt sửa 3 — the lazy loaders of the two files that load a dispatcher, the engine or the equipment adapter: never named in what the sweep reaches */
  const napCam = new Set<string>();
  for (const sf of nguon.values()) {
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name && st.body) ham.set(st.name.text, st.body);
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) ham.set(d.name.text, d.initializer.body);
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && /import\("[^"]*(commandDispatcher|robotCommandDispatcher|foeEngine|equipmentAdapter)"\)/.test(d.initializer.getText())) napCam.add(d.name.text);
      if (ts.isImportDeclaration(st) && st.importClause && !st.importClause.isTypeOnly) {
        const m = (st.moduleSpecifier as ts.StringLiteral).text;
        const ten: string[] = [];
        if (st.importClause.name) ten.push(st.importClause.name.text);
        const nb = st.importClause.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) if (!e.isTypeOnly) ten.push(e.name.text);
        if (nb && ts.isNamespaceImport(nb)) ten.push(nb.name.text);
        for (const t of ten) nhap.add(t);
        if (/drizzle\/schema|edgeExecutionSchema|edgeControlSchema/.test(m)) for (const t of ten) bang.add(t);
      }
    }
  }
  /** what one body does: the names it calls, and what the rules refuse in it */
  const goiTrong = (n: ts.Node) => {
    const goi: string[] = [];
    const tenTinh: string[] = [];
    const ghiTrangThai: string[] = [];
    const ghiBang: string[] = [];
    const biDanh: string[] = [];
    const nhacCam: string[] = [];
    const hamCucBo = new Set<string>();
    const thamPromise = new Set<string>();
    const tenKhac = new Set<string>();
    const ganTen = (b: ts.BindingName) => {
      if (ts.isIdentifier(b)) tenKhac.add(b.text);
      else for (const e of b.elements) if (!ts.isOmittedExpression(e)) ganTen(e.name);
    };
    const thao = (e: ts.Expression): ts.Expression => {
      while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
      return e;
    };
    const khaiBao = (x: ts.Node) => {
      if (ts.isVariableDeclaration(x)) {
        const nap = x.initializer && ts.isAwaitExpression(thao(x.initializer)) ? thao((thao(x.initializer) as ts.AwaitExpression).expression) : null;
        const tuNap = nap && ts.isCallExpression(nap) && nap.arguments.length === 0 && ts.isIdentifier(nap.expression) ? NAP[nap.expression.text] : undefined;
        if (ts.isIdentifier(x.name) && x.initializer && (ts.isArrowFunction(thao(x.initializer)) || ts.isFunctionExpression(thao(x.initializer)))) hamCucBo.add(x.name.text);
        else if (tuNap && ts.isObjectBindingPattern(x.name) && x.name.elements.every((el) => !el.propertyName && ts.isIdentifier(el.name) && tuNap.ten.includes(el.name.text))) for (const el of x.name.elements) hamCucBo.add((el.name as ts.Identifier).text);
        else ganTen(x.name);
      } else if (ts.isFunctionDeclaration(x) && x.name && x !== n) hamCucBo.add(x.name.text);
      else if (ts.isParameter(x)) {
        // a Promise executor's parameter (`new Promise((resolve) => …)`): its resolve, nothing else
        const ham0 = x.parent;
        const laExecutor = (ts.isArrowFunction(ham0) || ts.isFunctionExpression(ham0)) && ts.isNewExpression(ham0.parent) && ham0.parent.expression.getText() === "Promise" && ham0.parent.arguments?.[0] === ham0;
        if (laExecutor && ts.isIdentifier(x.name)) thamPromise.add(x.name.text);
        else ganTen(x.name);
      }
      ts.forEachChild(x, khaiBao);
    };
    khaiBao(n);
    const di = (x: ts.Node) => {
      // lượt sửa 3 — a forbidden name in any form: an identifier, a property, a destructured key, a string
      const tenNut = ts.isIdentifier(x) || ts.isPrivateIdentifier(x) ? x.text : ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text : null;
      if (tenNut !== null && (CAM.has(tenNut) || napCam.has(tenNut))) nhacCam.push(`${tenNut}: ${x.parent.getText().slice(0, 70)}`);
      if (ts.isCallExpression(x)) {
        const e = thao(x.expression);
        if (x.expression.kind === ts.SyntaxKind.ImportKeyword) tenTinh.push(`import(): ${x.getText().slice(0, 70)}`);
        const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
        if (ten) goi.push(ten);
        else if (ts.isElementAccessExpression(e)) tenTinh.push(x.getText().slice(0, 80));
        if (ts.isIdentifier(e) && !TOAN_CUC.has(e.text) && !((hamCucBo.has(e.text) || ham.has(e.text) || nhap.has(e.text) || e.text in NAP || thamPromise.has(e.text)) && !tenKhac.has(e.text))) biDanh.push(e.text);
        if (ts.isIdentifier(e) && TOAN_CUC.has(e.text) && tenKhac.has(e.text)) biDanh.push(`${e.text} (bound in the body)`);
        // an update's .set: whatever its arguments, its casts; a one-argument .set anywhere (a Map's takes two)
        const nhanUpdate = ts.isPropertyAccessExpression(e) && ts.isCallExpression(thao(e.expression)) && (() => {
          const c = thao((thao(e.expression) as ts.CallExpression).expression);
          return ts.isPropertyAccessExpression(c) && c.name.text === "update";
        })();
        if (ten === "set" && (nhanUpdate || x.arguments.length === 1))
          for (const a0 of x.arguments.slice(0, 1)) {
            const a = thao(a0);
            if (!ts.isObjectLiteralExpression(a) || a.properties.some((p) => ts.isSpreadAssignment(p) || (p.name !== undefined && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === "status") || (p.name !== undefined && ts.isComputedPropertyName(p.name)))) ghiTrangThai.push(a0.getText().slice(0, 80));
          }
        if (ten === "update" && ts.isPropertyAccessExpression(e) && !(x.arguments.length === 1 && ts.isIdentifier(thao(x.arguments[0]!)) && (thao(x.arguments[0]!) as ts.Identifier).text === "orchestrationRuns")) ghiBang.push(x.getText().slice(0, 80));
        if (ten === "insert" && ts.isPropertyAccessExpression(e)) ghiBang.push(x.getText().slice(0, 80));
        if (ten === "delete" && ts.isPropertyAccessExpression(e) && x.arguments.some((a) => ts.isIdentifier(thao(a)) && bang.has((thao(a) as ts.Identifier).text))) ghiBang.push(x.getText().slice(0, 80));
      }
      ts.forEachChild(x, di);
    };
    di(n);
    return { goi, tenTinh, ghiTrangThai, ghiBang, biDanh, nhacCam };
  };
  const tamVoi = () => {
    const thay = new Set<string>();
    const cho = ["quetUrgentChuaBen"];
    const goi = new Set<string>();
    const tenTinh: string[] = [];
    const ghiTrangThai: string[] = [];
    const ghiBang: string[] = [];
    const biDanh: string[] = [];
    const nhacCam: string[] = [];
    while (cho.length) {
      const t = cho.pop()!;
      if (thay.has(t)) continue;
      thay.add(t);
      const than = ham.get(t);
      if (!than) continue;
      const g = goiTrong(than);
      tenTinh.push(...g.tenTinh);
      ghiTrangThai.push(...g.ghiTrangThai);
      ghiBang.push(...g.ghiBang);
      biDanh.push(...g.biDanh.map((b) => `${t}: ${b}`));
      nhacCam.push(...g.nhacCam.map((b) => `${t}: ${b}`));
      for (const x of g.goi) {
        goi.add(x);
        if (ham.has(x)) cho.push(x);
      }
    }
    return { thay, goi, tenTinh, ghiTrangThai, ghiBang, biDanh, nhacCam };
  };
  it("the sweeper is there, and what it reaches: its raises (baoKhongXacNhan, canhBaoKetCucKhongRo), the bound, the reads, its own mark's write", () => {
    const { thay } = tamVoi();
    for (const t of ["quetUrgentChuaBen", "quetMotRun", "ghiDaBaoQuet", "docDaBaoQuet", "baoKhongXacNhan", "canhBaoKetCucKhongRo", "motBen"]) expect([...thay], t).toContain(t);
  });
  it("no walk, no engine, no dispatcher, no step-row write: none of them is called by anything it reaches", () => {
    const { goi } = tamVoi();
    expect([...goi].filter((x) => CAM.has(x))).toEqual([]);
  });
  it("no call by a computed name (M12), no import() (an alias's source, rà fix1 RV-D1): a name the census cannot read is refused", () => {
    expect(tamVoi().tenTinh).toEqual([]);
  });
  it("no forbidden name in any form (rà fix2 RV2-C4 a callback, RV2-C5 a property, RV2-C7 a destructured key): CAM and the loaders of a dispatcher / the engine / the adapter are not named in what it reaches", () => {
    expect(tamVoi().nhacCam).toEqual([]);
    expect([...napCam].sort(), "the loaders the census knows").toEqual(["napDispatcher"]);
  });
  it("no alias (rà fix1 RV-D1): a bare name called is a function of the two files, a local function of its body, an import, a global, or a listed name of a listed loader (NAP), and nothing else of that body bears the name", () => {
    expect(tamVoi().biDanh).toEqual([]);
    // the loaders are what NAP says: napMotLan of exactly that module
    const sf = nguon.get("foeKetCucKhongRo.ts")!;
    for (const [ten, x] of Object.entries(NAP)) {
      const st = sf.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText() === ten));
      expect(st?.getText(), ten).toBe(`const ${ten} = napMotLan(() => import("${x.module}"));`);
    }
  });
  it("every name it calls outside the two files is listed (CHO_PHEP): nothing new reaches it unread", () => {
    const { goi } = tamVoi();
    expect([...goi].filter((x) => !ham.has(x) && !CHO_PHEP.has(x)).sort()).toEqual([]);
  });
  it("no status write: an update's .set(...) takes an object literal only, whatever its arguments or casts: no variable, no spread, no computed key, no status (M13, rà fix1 RV-D2); its mark is a context write", () => {
    expect(tamVoi().ghiTrangThai).toEqual([]);
  });
  it("no other table written: update(...) of orchestrationRuns only, no insert(...), no delete(...) of a table (rà fix1 RV-D3: no step row)", () => {
    expect(tamVoi().ghiBang).toEqual([]);
  });
  it("no static import of a dispatcher, the equipment adapter or the engine in the two files (a type import is no code)", () => {
    for (const [t, sf] of nguon) {
      const imp = sf.statements.filter(ts.isImportDeclaration).filter((d) => !d.importClause?.isTypeOnly).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
      expect(imp.filter((m) => /commandDispatcher|robotCommandDispatcher|foeEngine|equipmentAdapter$/.test(m)), t).toEqual([]);
    }
  });
  // lượt sửa 1 (CHAN-1, kế hoạch mục 13 "Bài học": census of the readers of a mark) — who reads DA_BAO, who reads the sweep's own mark
  // lượt sửa 2 (rà fix1 RV-A2, RV-A3): every statement of the two files that names the sweep's mark, whatever its form (a function, an arrow, a const), and the key's name in any form anywhere
  it("CHAN1-DOC-DA_BAO the readers of DA_BAO and of the sweep's mark DA_BAO_QUET: the sweep alone reads its own mark (no helper, no arrow); abortStopSweep reads DA_BAO only; the raw keys only at their constants", () => {
    const GOC = resolve(__dirname, "../../..");
    const tep = (dir: string, out: string[] = []): string[] => {
      for (const ten of readdirSync(dir)) {
        const p = resolve(dir, ten);
        if (statSync(p).isDirectory()) tep(p, out);
        else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.startsWith("__")) out.push(p);
      }
      return out;
    };
    const ten = (p: string) => p.slice(GOC.length + 1).replace(/\\/g, "/");
    const ds = tep(GOC);
    const co = (re: RegExp) => ds.filter((p) => re.test(readFileSync(p, "utf8"))).map(ten).sort();
    expect(co(/KET_CUC_KHONG_RO_DA_BAO_CTX_KEY\b/), "DA_BAO").toEqual(["services/orchestration/foe/foeEngine.ts", "services/orchestration/foe/foeKetCucKhongRo.ts", "services/orchestration/foe/foeRunStore.ts"]);
    expect(co(/KET_CUC_KHONG_RO_DA_BAO_QUET_CTX_KEY\b/), "DA_BAO_QUET").toEqual(["services/orchestration/foe/foeKetCucKhongRo.ts", "services/orchestration/foe/foeRunStore.ts"]);
    expect(co(/foeKetCucKhongRoDaBao/), "the raw keys, in any form").toEqual(["services/orchestration/foe/foeKetCucKhongRo.ts"]);
    // lượt sửa 3 (rà fix2 RV2-D1): a key built from pieces (`"foeKetCucKhongRo" + "DaBaoQuet"`): no string piece of it elsewhere. A split this does not match is the parity case RV2-D1-T8's
    expect(co(/["'`][^"'`\n]*(DaBaoQuet|KhongRoDaBao|DaBao["'`])/), "a piece of the keys in a string").toEqual(["services/orchestration/foe/foeKetCucKhongRo.ts"]);
    const nguoiNoi = (sf: ts.SourceFile) => {
      const ra: string[] = [];
      for (const st of sf.statements) {
        if (ts.isImportDeclaration(st) || !st.getText().includes("KET_CUC_KHONG_RO_DA_BAO_QUET_CTX_KEY")) continue;
        const tenSt = ts.isFunctionDeclaration(st) && st.name ? st.name.text : ts.isVariableStatement(st) ? st.declarationList.declarations.map((d) => d.name.getText()).join(",") : ts.SyntaxKind[st.kind];
        ra.push(tenSt);
      }
      return ra.sort();
    };
    expect(nguoiNoi(nguon.get("foeRunStore.ts")!), "foeRunStore: the sweep's own functions only").toEqual(["ghiDaBaoQuet", "quetMotRun"]);
    expect(nguoiNoi(nguon.get("foeKetCucKhongRo.ts")!), "foeKetCucKhongRo: the constant only").toEqual(["KET_CUC_KHONG_RO_DA_BAO_QUET_CTX_KEY"]);
    const e = readFileSync(resolve(__dirname, "foeEngine.ts"), "utf8");
    const tien = e.split(/\r?\n/).filter((l) => /const tien = /.test(l));
    expect(tien, "abortStopSweep: the walker's word (DA_BAO), never the sweep's mark").toHaveLength(1);
    expect(tien[0]).toMatch(/const tien = live !== null \|\| ctxRun\[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY\] == null; /);
    const daBen = e.split(/\r?\n/).filter((l) => /const daBen = /.test(l));
    expect(daBen, "the Abort's end duty: the walker's word only").toEqual(["    const daBen = ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] != null;"]);
  });
});

// ── X-26 (G46, AGENTS-ngoai-le.md X-26, chu-du-an-HST 19/11) — a STOP pass of a latched run that throws: every forward stop-typed step never handed over is NAMED in a durable URGENT
// (forwardNotSent, `luotStopHong`), its name read from the definition and the walk's memory only; nothing more is sent and the run's end is unchanged ((a) not decided).
// The store is wrapped for these cases only (a global flag; off ⇒ the real functions): "nem" — verifyStops throws (the measured R1K-nem shape); "settled" — the sweep source's
// `settled` throws at every call, i.e. the throw is INSIDE planAbortSweep (a deterministic fault of the planning part).
vi.mock("./foeRunStore", async (importOriginal) => {
  const o = await importOriginal<typeof import("./foeRunStore")>();
  const s = o.centralRunStore;
  const co = () => (globalThis as { __x26?: "nem" | "settled" | "unv" | "khongDef" | "auditNem" | null }).__x26 ?? null;
  return {
    ...o,
    centralRunStore: {
      ...s,
      sweepSource: async (...a: Parameters<typeof s.sweepSource>) => {
        const r = await s.sweepSource(...a);
        if (co() === "khongDef" && r) return { ...r, def: null } as typeof r;
        if (co() !== "settled" || !r) return r;
        return {
          ...r,
          settled: (): boolean => {
            throw new Error("settled down (X-26 K2)");
          },
        };
      },
      bindAbortStop: (): void => {
        if (co() === "auditNem") throw new Error("bind down (X-28 A10)");
      },
      auditAbort: (...a: Parameters<typeof s.auditAbort>) => {
        if (co() === "auditNem" && a[2] === "abortStopFailed") throw new Error("audit down (X-28 A10)");
        return s.auditAbort(...a);
      },
      verifyStops: async (...a: Parameters<typeof s.verifyStops>) => {
        if (co() === "nem") throw new Error("verifyStops down (X-26 K1)");
        if (co() === "unv") {
          const r = await s.verifyStops(...a);
          return { ...r, ids: new Set([...r.ids].filter((x) => x !== "xs")), unsure: new Set([...r.unsure, "xs"]), failed: true };
        }
        return s.verifyStops(...a);
      },
    },
  };
});
// X-26 K8 — `laStopTheoBuoc` throws for ONE step id while a global flag names it (off ⇒ the real function): the walk-end naming reads an unreadable classification as a STOP
vi.mock("./foeStepClass", async (importOriginal) => {
  const o = await importOriginal<typeof import("./foeStepClass")>();
  return {
    ...o,
    laStopTheoBuoc: async (...a: Parameters<typeof o.laStopTheoBuoc>) => {
      const g = globalThis as { __x26ls?: string | null; __x28treo?: string | null; __x28stack?: string[]; __x23ls?: string | null };
      // X-27b (Z1b) — throws for ONE step id only when called from congBuTru (foeEngine, the G39 site): the STOP pass's own reads stay real (a synchronous frame, as __x28treo)
      if (g.__x23ls === a[0].id && /congBuTru/.test(String(new Error().stack))) throw new Error("laStopTheoBuoc down (X-23 Z1b)");
      const g3 = globalThis as { __c7dem?: { id: string; n: number } | null }; // C7-XN lượt 2 (s1/s2): the send / unverified counter
      if (g3.__c7dem && g3.__c7dem.id === a[0].id && /^at guiStopSauChot /.test((String(new Error().stack).split("\n")[2] ?? "").trim())) g3.__c7dem.n++;
      if (g.__x26ls === a[0].id) {
        const loi = new Error("laStopTheoBuoc down (X-26 K8)");
        (g.__x28stack ??= []).push(String(loi.stack));
        throw loi;
      }
      if (g.__x28treo === a[0].id && /tenStopTienChuaGiao/.test(String(new Error().stack))) return new Promise<boolean>(() => undefined);
      return o.laStopTheoBuoc(...a);
    },
  };
});
describe("X-26 a STOP pass that throws names the forward STOP never handed over", () => {
  const datX26 = (v: "nem" | "settled" | null) => void ((globalThis as { __x26?: unknown }).__x26 = v);
  const tiepX26 = (runId: number) => resumeRun(runId, { approved: true, note: "checked" }, ADMIN, {}, { scope: null });
  const stopX = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop" }) as WorkflowStep;
  const KIND_TIEN = CANH_BAO_KHONG_RO_KIND.forwardNotSent;
  const TIEU_DE = (runId: number, id: string) => `Run ${runId}: another command's outcome is unknown — machine state unknown — STOP-typed step "${id}" NOT sent: the STOP pass of this run failed`;
  const THAN = (id: string) => `Step "${id}" is a STOP-typed command and it was NOT sent: the STOP pass of this run failed, so the system cannot be relied on to send it. Stop the machine at the machine now with its direct STOP / E-STOP, and check it on site.`;
  const luotHong = () => alerts.filter((a) => a.kind === KIND_TIEN && String(a.title).includes("the STOP pass of this run failed"));
  /** the fault starts with the `start` that latches the run: what went before it (the STOP of K5) met a healthy store */
  const batKhiStart = (dang: "nem" | "settled") =>
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") {
        datX26(dang);
        return TIMEOUT;
      }
      return ACKED;
    });

  for (const [ten, dang] of [
    ["K1 verifyStops throws at every pass (R1K-nem)", "nem"],
    ["K2 the planner throws at every pass (settled, inside planAbortSweep)", "settled"],
  ] as const) {
    it(`${ten}: one URGENT naming xs per walk, nothing sent, the run's end unchanged`, async () => {
      const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        batKhiStart(dang);
        const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]);
        await new Promise((x) => setTimeout(x, 150));
        // the fault is where the case says: in the STOP pass, not elsewhere
        expect(err.mock.calls.some((c) => /STOP work after the latch failed: (verifyStops|settled) down \(X-26 K[12]\)/.test(String(c[0])))).toBe(true);
        expect(r.res.status).toBe("held");
        expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs")]);
        expect(String(luotHong()[0]!.message)).toContain(THAN("xs"));
        expect(String(luotHong()[0]!.dedupKey)).toMatch(new RegExp(`^${KIND_TIEN}:${r.runId}:xs:-:`));
        expect(String(luotHong()[0]!.dedupKey).endsWith(":chot")).toBe(false);
        const c = await tiepX26(r.runId);
        await new Promise((x) => setTimeout(x, 150));
        expect(luotHong()).toHaveLength(2); // the Continue's walk: its own event
        expect(new Set(luotHong().map((a) => a.dedupKey)).size).toBe(2);
        expect(sent("stop")).toEqual([]); // no new send path
        // X-27 (1) / X-27b (chủ dự án 19/11 "1.chặn"): the Continue's first STOP pass threw ⇒ nothing of the tree, no compensation sent, the run held
        expect(c.status).toBe("held");
        expect(runRow(r.runId).status).toBe("held");
      } finally {
        datX26(null);
        err.mockRestore();
      }
    });
  }

  it("K3 control: a healthy STOP pass raises no URGENT of this kind (green before and after)", async () => {
    try {
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]);
      await new Promise((x) => setTimeout(x, 150));
      expect(sent("stop")).toEqual(["stop"]);
      expect(alerts.map((a) => String(a.kind))).toEqual(["foe_outcome_unknown_compensation_held"]);
      expect(luotHong()).toEqual([]);
      expect(r.res.status).toBe("held");
    } finally {
      datX26(null);
    }
  });

  it("K4 the words: about this step and the STOP pass only; ≤ 800 / ≤ 200 with a 200-character step id and run 2 147 483 647; the act never cut", () => {
    const n = noiDungCanhBaoKhongRo({ loai: "forwardNotSent", runId: 9, stepId: "xs", compId: KHONG_CO_BU_TRU, error: loiKhongGuiChot("xs"), lan: "L1", biet: true, luotStopHong: true } as Parameters<typeof noiDungCanhBaoKhongRo>[0]);
    expect(n.kind).toBe(KIND_TIEN);
    expect(n.title).toBe(TIEU_DE(9, "xs"));
    expect(n.message).toContain(THAN("xs"));
    expect(n.message).not.toMatch(/no STOP of this run|every STOP|all STOP|Abort (sends|can)|press Abort/i);
    const dai = "s".repeat(200);
    const m = noiDungCanhBaoKhongRo({ loai: "forwardNotSent", runId: 2_147_483_647, stepId: dai, compId: KHONG_CO_BU_TRU, error: loiKhongGuiChot(dai), lan: "L1", biet: true, luotStopHong: true } as Parameters<typeof noiDungCanhBaoKhongRo>[0]);
    expect(m.title.length).toBeLessThanOrEqual(200);
    expect(m.message.length).toBeLessThanOrEqual(800);
    expect(m.title).toContain("NOT sent: the STOP pass of this run failed");
    expect(m.message).toContain("Stop the machine at the machine now with its direct STOP / E-STOP, and check it on site.");
    expect(m.dedupKey).toBe(`${KIND_TIEN}:2147483647:${dai}:${KHONG_CO_BU_TRU}:L1`);
  });

  it("K5 a STOP that went before the latch is never named, and the words do not say more than this step", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      batKhiStart("nem");
      const r = await chay([seq("box", [stopX("xa"), main(resetComp("undo")), stopX("xs")])]);
      await new Promise((x) => setTimeout(x, 150));
      expect((await step(r.runId, "xa"))?.status).toBe("completed");
      expect(sent("stop")).toEqual(["stop"]); // xa's own
      expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs")]);
      expect(alerts.filter((a) => /"xa"/.test(String(a.title)) || /"xa"/.test(String(a.message)))).toEqual([]);
      expect(String(luotHong()[0]!.message)).not.toMatch(/no STOP of this run|every STOP|all STOP/i);
    } finally {
      datX26(null);
      err.mockRestore();
    }
  });

  it("K6 a pass that throws ONCE, then a healthy Continue sends xs: one URGENT at the first walk, none at the Continue, one STOP (intended, HST 10:02 point 3)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      batKhiStart("nem");
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]).finally(() => datX26(null));
      await new Promise((x) => setTimeout(x, 150));
      expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs")]);
      expect(sent("stop")).toEqual([]);
      await tiepX26(r.runId);
      await new Promise((x) => setTimeout(x, 150));
      expect(luotHong()).toHaveLength(1);
      expect(sent("stop")).toEqual(["stop"]);
      expect((await step(r.runId, "xs"))?.status).toBe("completed");
    } finally {
      datX26(null);
      err.mockRestore();
    }
  });

  it("K7 over-naming, INTENDED (HST 10:22 point 2): a STOP in a branch arm never taken is named too when the pass threw (the safe side; a healthy pass lists it, untakenBranch)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      batKhiStart("nem");
      const br = { id: "br", type: "branch", condition: { source: "const", key: "x", op: "eq", value: "x" }, then: [main(resetComp("undo"))], else: [stopX("xe")] } as unknown as WorkflowStep;
      const r = await chay([seq("box", [br, stopX("xs")])]);
      await new Promise((x) => setTimeout(x, 150));
      expect(r.res.status).toBe("held");
      expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xe"), TIEU_DE(r.runId, "xs")]);
      expect(sent("stop")).toEqual([]);
    } finally {
      datX26(null);
      err.mockRestore();
    }
  });

  it("K8 an unreadable classification reads as a STOP: the Continue's walk-end names xs while laStopTheoBuoc throws for it (kills `.catch(() => true)` → false)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      batKhiStart("nem");
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]);
      await new Promise((x) => setTimeout(x, 150));
      expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs")]);
      // the Continue's walk: its pass throws too (flag still "nem"), its buocTienBiBo names nothing (a compensation-only walk), the naming reads xs with the classifier down
      (globalThis as { __x26ls?: string | null }).__x26ls = "xs";
      await tiepX26(r.runId).catch(() => undefined);
      await new Promise((x) => setTimeout(x, 150));
      expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs"), TIEU_DE(r.runId, "xs")]);
      expect(new Set(luotHong().map((a) => a.dedupKey)).size).toBe(2);
      expect(sent("stop")).toEqual([]);
    } finally {
      (globalThis as { __x26ls?: string | null }).__x26ls = null;
      datX26(null);
      err.mockRestore();
    }
  });
});

describe("X-28 an Abort whose STOP planning throws names the forward STOP never handed over", () => {
  const g = globalThis as { __x26?: unknown; __x26ls?: string | null; __x28treo?: string | null; __x28stack?: string[] };
  const dat = (v: "nem" | "settled" | "unv" | "khongDef" | "auditNem" | null) => void (g.__x26 = v);
  const stopX = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop" }) as WorkflowStep;
  const KIND_TIEN = CANH_BAO_KHONG_RO_KIND.forwardNotSent;
  const KIND_HOI = CANH_BAO_KHONG_RO_KIND.abortDefUnread;
  // X-26 words, unchanged (foeKetCucKhongRo.ts:821-823)
  const TIEU_DE = (runId: number, id: string) => `Run ${runId}: another command's outcome is unknown — machine state unknown — STOP-typed step "${id}" NOT sent: the STOP pass of this run failed`;
  const THAN = (id: string) => `Step "${id}" is a STOP-typed command and it was NOT sent: the STOP pass of this run failed, so the system cannot be relied on to send it. Stop the machine at the machine now with its direct STOP / E-STOP, and check it on site.`;
  // X-28 words (brief x28 section 2), the prefix of a latched run's URGENT (foeKetCucKhongRo.ts:784, 788, 842)
  const TIEU_DE_HOI = (runId: number) => `Run ${runId}: another command's outcome is unknown — machine state unknown — planning of the STOP sweep failed, a STOP may still not be out`;
  const THAN_HOI = (runId: number) =>
    `The STOP sweep of run ${runId} read its definition but failed while planning which STOP steps to send, so this press sent none of them. Where the system could work them out, STOP-typed steps never handed over are named in alerts of their own; that list may be incomplete or empty, and no STOP compensation is named. Stop the machine at the machine now with its direct STOP / E-STOP, and check it on site.`;
  const tenAbort = () => alerts.filter((a) => a.kind === KIND_TIEN && String(a.dedupKey).endsWith(":abort"));
  const hoi = () => alerts.filter((a) => a.kind === KIND_HOI);
  const cho = () => new Promise((x) => setTimeout(x, 150));
  /** a latched run held, its STOP pass throwing at every pass (verifyStops, as X-26 K1): `xs` is never handed over */
  async function giuChuaGui() {
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") {
        dat("nem");
        return TIMEOUT;
      }
      return ACKED;
    });
    const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]);
    await cho();
    expect(r.res.status).toBe("held");
    expect(sent("stop")).toEqual([]);
    alerts.length = 0;
    return r.runId;
  }
  const bam = (runId: number) => abortRun(runId, ADMIN, "checked", { scope: null } as never) as Promise<{ message?: unknown }>;

  it("A1 the planner throws at an Abort of a latched run: one URGENT naming xs (key :abort), the '?' URGENT and the answer say planning failed, nothing sent, the run aborted", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      dat("settled");
      const a = await bam(runId);
      await cho();
      expect(runRow(runId).status).toBe("aborted");
      expect(sent("stop")).toEqual([]);
      expect(tenAbort().map((x) => x.title)).toEqual([TIEU_DE(runId, "xs")]);
      expect(String(tenAbort()[0]!.message)).toContain(THAN("xs"));
      expect(String(tenAbort()[0]!.dedupKey)).toBe(`${KIND_TIEN}:${runId}:xs:-:abort`);
      expect(hoi().map((x) => x.title)).toEqual([TIEU_DE_HOI(runId)]);
      expect(String(hoi()[0]!.message)).toContain(THAN_HOI(runId));
      expect(String(hoi()[0]!.message)).not.toContain("could not read the definition");
      expect(String(a.message)).toContain(THAN_HOI(runId));
      expect(String(a.message)).not.toContain("could not read the definition");
    } finally {
      dat(null);
      err.mockRestore();
    }
  });

  it("A2 a second press: the same planning throws again: the URGENT naming xs carries the SAME key (the durable dedup drops it, foeKetCucKhongRo.ts:872-879), the answer says planning failed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      dat("settled");
      await bam(runId);
      await cho();
      const khoa = tenAbort().map((x) => String(x.dedupKey));
      expect(khoa).toEqual([`${KIND_TIEN}:${runId}:xs:-:abort`]);
      alerts.length = 0;
      const b = await bam(runId);
      await cho();
      expect(tenAbort().map((x) => String(x.dedupKey))).toEqual(khoa);
      expect(String(b.message)).toContain(THAN_HOI(runId));
      expect(String(b.message)).not.toContain("Its records could not be read");
      expect(sent("stop")).toEqual([]);
    } finally {
      dat(null);
      err.mockRestore();
    }
  });

  it("A3 a STOP an earlier Abort left a trace of (abort:xs) and never handed over is still named (HST 13:04)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      rows("orchestration_run_steps").push({ id: 99_028, runId, stepId: abortRowId("xs"), stepType: "command", status: "failed", error: null, attempt: 0, resultJson: { abortStop: "failed", stepId: "xs" }, startedAt: new Date(), finishedAt: new Date() });
      dat("settled");
      await bam(runId);
      await cho();
      expect(tenAbort().map((x) => x.title)).toEqual([TIEU_DE(runId, "xs")]);
      expect(sent("stop")).toEqual([]);
    } finally {
      dat(null);
      err.mockRestore();
    }
  });

  it("A11 a throw AFTER the planner returned, before any send (laStopTheoBuoc of an unverified STOP, foeEngine.ts:6978): the new words and the name", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const han = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    try {
      const runId = await giuChuaGui();
      dat("unv");
      g.__x26ls = "xs";
      g.__x28stack = [];
      const a = await bam(runId);
      await cho();
      // the throw is where the case says: after the planner, inside the sweep (not inside lapKeHoachStop, not the naming's own read)
      expect((g.__x28stack ?? []).some((st) => /runAbortStopSweep/.test(st) && !/lapKeHoachStop/.test(st) && !/tenStopTienChuaGiao/.test(st))).toBe(true);
      expect(tenAbort().map((x) => x.title)).toEqual([TIEU_DE(runId, "xs")]);
      expect(hoi().map((x) => x.title)).toEqual([TIEU_DE_HOI(runId)]);
      expect(String(a.message)).toContain(THAN_HOI(runId));
      expect(sent("stop")).toEqual([]);
    } finally {
      Error.stackTraceLimit = han;
      g.__x26ls = null;
      g.__x28stack = [];
      dat(null);
      err.mockRestore();
    }
  });
  it("A4 the URGENTs naming the STOPs fail to land: the '?' URGENT still goes with the planning's words, the answer is the same, the Abort does not throw", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      HX.alertNemKhi = (a) => a.kind === KIND_TIEN;
      dat("settled");
      const a = await bam(runId);
      await cho();
      expect(runRow(runId).status).toBe("aborted");
      expect(hoi().map((x) => x.title)).toEqual([TIEU_DE_HOI(runId)]);
      expect(String(hoi()[0]!.message)).toContain(THAN_HOI(runId));
      expect(String(a.message)).toContain(THAN_HOI(runId));
      expect(sent("stop")).toEqual([]);
    } finally {
      HX.alertNemKhi = null;
      dat(null);
      err.mockRestore();
    }
  });

  it("A5 the naming never answers (laStopTheoBuoc of xs hangs, inside the naming only): bounded (3·D, foeEngine catch of runAbortStopSweep): the '?' URGENT and the answer as A1, no name, within the answer's ceiling", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      g.__x28treo = "xs";
      dat("settled");
      const t0 = Date.now();
      const a = await bam(runId);
      const t = Date.now() - t0;
      await cho();
      expect(t, "the answer's ceiling (15·D + 1·D)").toBeLessThan(16 * STOP_DB_STEP_DEADLINE_MS);
      expect(hoi().map((x) => x.title)).toEqual([TIEU_DE_HOI(runId)]);
      expect(String(a.message)).toContain(THAN_HOI(runId));
      expect(tenAbort()).toEqual([]);
      expect(runRow(runId).status).toBe("aborted");
    } finally {
      g.__x28treo = null;
      dat(null);
      err.mockRestore();
    }
  }, 20_000);

  it("A6 control (words, green before and after): a sweep not finished keeps chuQuetChuaXong word for word; the path itself is RP T7B1D-P2 (quetChuaXong, foeRunStoreParity.dot10.test.ts:15464)", () => {
    const n = noiDungCanhBaoKhongRo({ loai: "abortSweepUnfinished", runId: 7, stepId: "?", compId: "-", error: "FOE_OUTCOME_UNKNOWN", lan: "chot" });
    expect(n.message).toContain(
      "The STOP sweep of run 7 has not finished and is still running: STOP steps of this run may have gone out or may still go, which ones is not known, and nothing confirms them yet. Check the machine on site and use its direct STOP / E-STOP if needed. Abort can be pressed again.",
    );
    const cu = noiDungCanhBaoKhongRo({ loai: "abortDefUnread", runId: 7, stepId: "?", compId: "-", error: "FOE_STOP_NOT_SENT", lan: "chot" });
    expect(cu.title).toBe("Run 7: another command's outcome is unknown — machine state unknown — definition of the run unread, a STOP may still not be out");
    expect(cu.message).toContain("The system could not read the definition of run 7");
  });

  it("A7 control: the definition really unread (foeEngine: !src.def) keeps the old words, names nobody", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      dat("khongDef");
      const a = await bam(runId);
      await cho();
      expect(hoi().map((x) => x.title)).toEqual([`Run ${runId}: another command's outcome is unknown — machine state unknown — definition of the run unread, a STOP may still not be out`]);
      expect(String(a.message)).toContain(`could not read the definition of run ${runId}`);
      expect(String(a.message)).not.toContain(THAN_HOI(runId));
      expect(tenAbort()).toEqual([]);
    } finally {
      dat(null);
      err.mockRestore();
    }
  });

  it("A8 control: a healthy Abort of the same run raises neither the '?' URGENT nor a name", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      dat(null);
      await bam(runId);
      await cho();
      expect(runRow(runId).status).toBe("aborted");
      expect(hoi()).toEqual([]);
      expect(tenAbort()).toEqual([]);
    } finally {
      dat(null);
      err.mockRestore();
    }
  });

  it("A9 a throw BEFORE the run's picture (verifyStops, before nhinLoi is set): the old words, no name (a named limit)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      dat("nem");
      const a = await bam(runId);
      await cho();
      expect(String(a.message)).toContain(`could not read the definition of run ${runId}`);
      expect(String(a.message)).not.toContain(THAN_HOI(runId));
      expect(tenAbort()).toEqual([]);
    } finally {
      dat(null);
      err.mockRestore();
    }
  });

  it("A10 a throw AFTER the point where nhinLoi is cleared (the send block: a failed prepare's audit throws): the old words, no name (a named limit)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await giuChuaGui();
      dat("auditNem");
      const a = await bam(runId);
      await cho();
      expect(err.mock.calls.some((c) => /STOP sweep error — audit down \(X-28 A10\)/.test(String(c[0]))), "the throw is the one of the send block").toBe(true);
      expect(String(a.message)).toContain(`could not read the definition of run ${runId}`);
      expect(String(a.message)).not.toContain(THAN_HOI(runId));
      expect(tenAbort()).toEqual([]);
    } finally {
      dat(null);
      err.mockRestore();
    }
  });
});


describe("X-29 the walk-end naming of X-26 and the door of a latched run (F11): one case per surviving mutation", () => {
  const g = globalThis as { __x26?: unknown; __x26ls?: string | null };
  const KIND_TIEN = CANH_BAO_KHONG_RO_KIND.forwardNotSent;
  // X-26 words, unchanged (foeKetCucKhongRo.ts, the luotStopHong title)
  const TIEU_DE = (runId: number, id: string) => `Run ${runId}: another command's outcome is unknown — machine state unknown — STOP-typed step "${id}" NOT sent: the STOP pass of this run failed`;
  const LUOT_HONG = "the STOP pass of this run failed";
  const stopX = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop" }) as WorkflowStep;
  const cmd = (id: string, command: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command, ...extra }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as WorkflowStep;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as WorkflowStep;
  const tiep = (runId: number) => resumeRun(runId, { approved: true, note: "checked" }, ADMIN, {}, { scope: null });
  /** every X-26 URGENT (forwardNotSent with the words of a failed STOP pass) */
  const luotHong = () => alerts.filter((a) => a.kind === KIND_TIEN && String(a.title).includes(LUOT_HONG));
  /** the alerts naming one step, by the step slot of the key */
  const ve = (id: string) => alerts.filter((a) => String(a.dedupKey ?? "").split(":")[2] === id);
  /** a positive anchor before any "NOT named": wait for what the same walk must have told */
  const doi = (f: () => void | Promise<void>) => vi.waitFor(f, { timeout: 3_000 });
  const REJECTED = { ok: false, simulated: false, status: "rejected", results: [], commandLogIds: [] } as Record<string, unknown>;
  /** the fault starts with the `start` that latches the run: every STOP pass after it throws (the store lever of X-26 K1) */
  const nemTuStart = (khac: (i: Record<string, unknown>) => Record<string, unknown> = () => ACKED) =>
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") {
        g.__x26 = "nem";
        return TIMEOUT;
      }
      return khac(i);
    });
  /** the first STOP pass after the latch throws ONCE, the later ones go to `sau` (the real verifier when absent) */
  async function nemMotLan<T>(than: () => Promise<T>, sau?: (r: { ids: Set<string>; unsure: Set<string> }) => unknown): Promise<T> {
    const m = (await import("./foeRunStore")) as unknown as { centralRunStore: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const st = m.centralRunStore;
    const goc = st.verifyStops!;
    let chot = false;
    let nem = 0;
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") {
        chot = true;
        return TIMEOUT;
      }
      return ACKED;
    });
    st.verifyStops = async (...a: unknown[]) => {
      if (chot && nem === 0) {
        nem++;
        throw new Error("verifyStops down once (X-29)");
      }
      const r = (await goc(...a)) as { ids: Set<string>; unsure: Set<string> };
      return sau ? sau(r) : r;
    };
    try {
      const out = await than();
      expect(nem, "the first STOP pass after the latch threw").toBe(1);
      return out;
    } finally {
      st.verifyStops = goc;
    }
  }

  it("P-f7 (laStopTheoBuoc) a forward command that is NOT stop-typed and never went is not named: only the STOP xs", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      nemTuStart();
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs"), cmd("xp", "pause")])]);
      await doi(() => expect(luotHong().map((a) => a.title)).toContain(TIEU_DE(r.runId, "xs"))); // positive anchor: the same naming has told xs
      expect(r.res.status).toBe("held");
      expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs")]);
      expect(ve("xp").filter((a) => String(a.title).includes(LUOT_HONG))).toEqual([]); // X-26 words only: xp's plain forward-dropped URGENT is H13's (baoBuocTienBiBo), not this rule's
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("P-f6 (type === command) a gate never walked is not named, even when its classification throws (read as a STOP)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      nemTuStart();
      g.__x26ls = "gx";
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs"), { id: "gx", type: "hitl_gate", prompt: "x" } as WorkflowStep])]);
      await doi(() => expect(luotHong().map((a) => a.title)).toContain(TIEU_DE(r.runId, "xs"))); // positive anchor
      expect(luotHong().map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs")]);
      expect(ve("gx").filter((a) => String(a.title).includes(LUOT_HONG))).toEqual([]);
    } finally {
      g.__x26ls = null;
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("P-f4 (diStop) a STOP the healthy last pass took (unverified ⇒ diStopTien) is told by that pass, never in the words of a failed pass", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      ghimMock.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
      const r = await nemMotLan(() => chay([seq("box", [main(resetComp("undo")), stopX("xs")])]));
      await doi(() => expect(ve("xs").filter((a) => a.kind === KIND_TIEN)).toHaveLength(1)); // positive anchor: the last pass told xs in its own words
      expect(luotHong()).toEqual([]);
      expect(r.res.status).toBe("held");
    } finally {
      err.mockRestore();
    }
  });

  it("P-f3 (prior.attempted) a STOP handed to its dispatcher in walk 1 (refused) is not named at the Continue whose every pass throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      nemTuStart((i) => (i.commandType === "stop" ? REJECTED : ACKED));
      const r = await chay([par("p", [stopX("xs"), seq("b", [delay("w", 50), main(resetComp("undo"))])])]);
      expect(r.res.status).toBe("held");
      await doi(async () => expect((await step(r.runId, "xs"))?.status).toBe("failed")); // positive anchor of walk 1 // handed over and refused: prior.attempted at the next walk (priorStepsOf: failed)
      expect(sent("reset")).toEqual([]);
      await tiep(r.runId).catch(() => undefined);
      // positive anchor (X-27b): the Continue's walk ended held; its words: the state C of xs (name, REJECTED) first, then X-27 (1)'s sentence (foeEngine duongKetThuc)
      await doi(() => {
        expect(String(runRow(r.runId).status)).toBe("held");
        expect(String(runRow(r.runId).error ?? "")).toMatch(/STOP "xs" did NOT go out[\s\S]*REJECTED[\s\S]*sent no approved compensation that is not a STOP/);
      });
      expect(sent("reset")).toEqual([]);
      expect(luotHong().filter((a) => String(a.dedupKey).split(":")[2] === "xs")).toEqual([]);
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("P-t1 (order of the words) a STOP the last pass reads not pinned while its dispatcher says pinned, after a pass that threw: the X-26 words come first", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await nemMotLan(
        () => chay([seq("box", [main(resetComp("undo")), stopX("xs")])]),
        (v) => ({ ...v, ids: new Set([...v.ids].filter((x) => x !== "xs")), unsure: new Set([...v.unsure].filter((x) => x !== "xs")) }),
      );
      await doi(() => expect(ve("xs").filter((a) => a.kind === KIND_TIEN).map((a) => a.title)).toEqual([TIEU_DE(r.runId, "xs")]));
      expect(sent("stop")).toEqual([]);
    } finally {
      err.mockRestore();
    }
  });

  it("P-d3 (F11) the STOP compensation of a step the door cuts goes AT the door, while a sibling is still out (its dispatch held by the test)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let nha: () => void = () => undefined;
    const giu = new Promise<void>((x) => (nha = x));
    try {
      otDispatchMock.mockImplementation(async (i) => {
        if (i.commandType === "start") return TIMEOUT;
        if (i.commandType === "reset") {
          await giu;
          return ACKED;
        }
        return ACKED;
      });
      const di = chay([par("p", [main(), seq("b", [delay("w", 60), cmd("r4", "pause", { compensation: stopComp("c4") })]), cmd("lau", "reset", { machineId: 3 })])]);
      await vi.waitFor(() => expect(sent("stop")).toEqual(["stop"]), { timeout: 3_000 });
      await vi.waitFor(async () => expect((await step(runIdCua(), "c4"))?.status).toBe("compensated"), { timeout: 3_000 });
      expect(sent("reset")).toEqual(["reset"]); // the sibling is still out: the walk has not ended
      nha();
      await di;
    } finally {
      nha();
      err.mockRestore();
    }
  });
  /** the run of the case: the newest run row */
  const runIdCua = () => Math.max(...rows("orchestration_runs").map((x) => Number(x.id)));

  it("P-f5 (chuaRaStop) a STOP refused before the latch carries its own debt: not named in the words of a failed pass", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = (await import("./foeRunStore")) as unknown as { centralRunStore: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const st = m.centralRunStore;
    const gocUq = st.authorizeCommand!;
    let tuChoi = 0;
    try {
      st.authorizeCommand = async (...a: unknown[]) => {
        if ((a[1] as { id?: string } | undefined)?.id === "xs") {
          tuChoi++;
          return { ok: false, verdict: "refused", error: "FOE_GATE_REQUIRED(x29)" };
        }
        return gocUq(...a);
      };
      nemTuStart();
      const r = await chay([par("p", [stopX("xs"), seq("b", [delay("w", 50), main(resetComp("undo"))])])]);
      expect(tuChoi).toBeGreaterThanOrEqual(1);
      expect(r.res.status).toBe("held");
      await doi(() => expect(ve("xs").map((a) => String(a.kind))).toContain(CANH_BAO_KHONG_RO_KIND.stopNotSent)); // positive anchor: its own debt told
      expect(luotHong()).toEqual([]);
    } finally {
      st.authorizeCommand = gocUq;
      g.__x26 = null;
      err.mockRestore();
    }
  });
});


describe("X-23 a STOP skipped by its precondition is told as one (G39, G40)", () => {
  const BO_QUA = { precondition: { source: "param", key: "never", op: "eq", value: true }, onPreconditionFail: "skip" };
  /** an OLD definition (X-15 (4) refuses a precondition on a STOP at deploy now): deployed without it, then the stored row carries it */
  async function chayCu(steps: WorkflowStep[], cu: WorkflowStep[]) {
    const ref = `x23-${++refN}`;
    const g = { id: "gate0", type: "hitl_gate", prompt: "approve" } as WorkflowStep;
    expect((await deployWorkflow({ ref, name: ref, steps: [g, ...steps] } as WorkflowDefinition, USER)).ok).toBe(true);
    rows("orchestration_workflows").find((w) => w.ref === ref)!.definitionJson = { ref, name: ref, steps: [g, ...cu], version: 1 };
    const r = await startRun(ref, {}, USER);
    const res = await resumeRun(r.runId!, { approved: true }, APPROVER);
    return { runId: r.runId!, res };
  }
  const tiepX23 = (runId: number) => resumeRun(runId, { approved: true, note: "checked" }, ADMIN, {}, { scope: null });

  it("Z1 (G39) an approved STOP-typed compensation skipped by its precondition: its URGENT says it is a STOP, skipped by its precondition, sent by no path, the machine's direct STOP", async () => {
    let n = 0;
    ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop" && ++n === 1, loiDocGhim: null })); // N3b: the split sees a pinned STOP, the dispatch does not ⇒ held
    const cs = { id: "cs", type: "command", machineId: 1, command: "stop" } as WorkflowStep;
    const { runId, res } = await chayCu([main(cs)], [main({ ...cs, ...BO_QUA } as WorkflowStep)]);
    expect(res.status).toBe("held");
    alerts.length = 0;
    otDispatchMock.mockClear();
    await tiepX23(runId);
    await vi.waitFor(() => expect(alertsOf("approvedNotSent")).toHaveLength(1));
    const a = alertsOf("approvedNotSent")[0]!;
    expect(String(a.title)).toContain("STOP-typed compensation \"cs\" NOT sent: skipped by its precondition");
    expect(String(a.message)).toContain("is a STOP-typed command and was NOT sent: its precondition skipped it, and it could not be verified as a pinned STOP. No path of this run sends it. Check the machine on site and use its direct STOP / E-STOP.");
    expect(String(a.dedupKey).startsWith(`${CANH_BAO_KHONG_RO_KIND.approvedNotSent}:${runId}:main:cs:`)).toBe(true);
    expect(sent("stop")).toEqual([]);
    expect(await step(runId, "cs")).toMatchObject({ status: "skipped" });
  });

  it("Z1b (G39, an unreadable classification) laStopTheoBuoc throws for the compensation at the Continue: read as a STOP (catch ⇒ true), the G39 words, one URGENT", async () => {
    const g = globalThis as { __x23ls?: string | null };
    let n = 0;
    ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop" && ++n === 1, loiDocGhim: null }));
    const cs = { id: "cs", type: "command", machineId: 1, command: "stop" } as WorkflowStep;
    try {
      const { runId, res } = await chayCu([main(cs)], [main({ ...cs, ...BO_QUA } as WorkflowStep)]);
      expect(res.status).toBe("held");
      alerts.length = 0;
      otDispatchMock.mockClear();
      g.__x23ls = "cs"; // from the Continue on, at congBuTru only: the classifier of cs throws (X-27b: the STOP pass does not)
      await tiepX23(runId);
      await vi.waitFor(() => expect(alertsOf("approvedNotSent")).toHaveLength(1));
      // the shape: the Continue's STOP pass did NOT throw (no X-26 words), and cs went the compensation's way to its precondition
      expect(alerts.filter((x) => String(x.title).includes("the STOP pass of this run failed"))).toEqual([]);
      expect(await step(runId, "cs")).toMatchObject({ status: "skipped" });
      const a = alertsOf("approvedNotSent")[0]!;
      expect(String(a.title)).toContain("STOP-typed compensation \"cs\" NOT sent: skipped by its precondition");
      expect(String(a.message)).toContain("is a STOP-typed command and was NOT sent: its precondition skipped it, and it could not be verified as a pinned STOP. No path of this run sends it. Check the machine on site and use its direct STOP / E-STOP.");
      expect(String(a.dedupKey).startsWith(`${CANH_BAO_KHONG_RO_KIND.approvedNotSent}:${runId}:main:cs:`)).toBe(true);
      expect(sent("stop")).toEqual([]);
    } finally {
      g.__x23ls = null;
    }
  });

  it("Z4 (G39 control) an approved compensation that is NOT stop-typed, skipped by its precondition: the old words stand", async () => {
    const { runId } = await giuKhongRo([main({ ...resetComp("cz"), ...BO_QUA } as WorkflowStep)]);
    alerts.length = 0;
    await tiepX23(runId);
    await vi.waitFor(() => expect(alertsOf("approvedNotSent")).toHaveLength(1));
    const a = alertsOf("approvedNotSent")[0]!;
    expect(String(a.title)).toContain('compensation "cz" NOT sent');
    expect(String(a.message)).toContain('Its compensation "cz", approved by a Continue, was NOT sent: its interlock does not hold, or it was refused before the dispatcher.');
    expect(String(a.title) + String(a.message)).not.toContain("STOP-typed");
  });

  it("Z5 (words) the longest ids: both new words within 800 / 200, the action not cut, the keys whole", () => {
    const id = "s".repeat(200);
    const c = "c".repeat(200);
    const g39 = noiDungCanhBaoKhongRo({ loai: "approvedNotSent", runId: 2_147_483_647, stepId: id, compId: c, error: "FOE_OUTCOME_UNKNOWN: x", lan: "l", boQuaDieuKien: true } as never);
    expect(g39.title.length).toBeLessThanOrEqual(200);
    expect(g39.message.length).toBeLessThanOrEqual(800);
    expect(g39.message).toContain("STOP-typed command and was NOT sent: its precondition skipped it");
    expect(g39.message).toContain("Check the machine on site and use its direct STOP / E-STOP.");
    expect(g39.dedupKey).toBe(`${CANH_BAO_KHONG_RO_KIND.approvedNotSent}:2147483647:${id}:${c}:l`);
    const g40 = noiDungCanhBaoKhongRo({ loai: "stopEndedUnswept", runId: 2_147_483_647, stepId: id, compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "ket", ketThuc: "failed", boQuaDieuKien: true } as never);
    expect(g40.title.length).toBeLessThanOrEqual(200);
    expect(g40.message.length).toBeLessThanOrEqual(800);
    expect(g40.message).toContain("It was skipped by its precondition and never tried.");
    expect(g40.message).toContain("Check the machine on site and use its direct STOP / E-STOP.");
    expect(g40.dedupKey).toBe(`foe_outcome_unknown_stop_ended_unswept:2147483647:${id}:-:ket`);
  });

  it("Z3b (G40 control, words) an end with no sweep of a STOP NOT skipped keeps the old words", () => {
    const k = noiDungCanhBaoKhongRo({ loai: "stopEndedUnswept", runId: 9, stepId: "s", compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "ket", ketThuc: "failed" } as never);
    expect(k.message).toContain('its STOP "s" was NOT sent. Check the machine on site and use its direct STOP / E-STOP.');
    expect(k.message).not.toContain("skipped by its precondition");
  });
});


describe("X-27 M1 + M2 the planning's words name no compensation; a STOP skipped in an earlier walk is named when a STOP pass throws (F1-BOQUA)", () => {
  const g = globalThis as { __x26?: unknown };
  const KIND_TIEN = CANH_BAO_KHONG_RO_KIND.forwardNotSent;
  const LUOT_HONG = "the STOP pass of this run failed";
  const stopX = (id: string, extra: Record<string, unknown> = {}): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", ...extra }) as WorkflowStep;
  const gateT = (id: string): WorkflowStep => ({ id, type: "hitl_gate", prompt: "x" }) as WorkflowStep;
  const DK = { precondition: { source: "param", key: "never", op: "eq", value: true }, onPreconditionFail: "skip" };
  const doi = (f: () => void | Promise<void>) => vi.waitFor(f, { timeout: 3_000 });
  /** X-26's words naming one step (any walk's key) */
  const luotHongVe = (id: string) => alerts.filter((a) => a.kind === KIND_TIEN && String(a.title).includes(LUOT_HONG) && String(a.dedupKey ?? "").split(":")[2] === id);
  /** X-28's naming at an Abort whose planning threw (key :abort) */
  const abortVe = (id: string) => alerts.filter((a) => a.kind === KIND_TIEN && String(a.dedupKey ?? "") .split(":")[2] === id && String(a.dedupKey ?? "").endsWith(":abort"));
  /** the fault starts with the `start` that latches the run: every STOP pass after it throws (X-26 K1's lever) */
  const nemTuStart = () =>
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") {
        g.__x26 = "nem";
        return TIMEOUT;
      }
      return ACKED;
    });
  /** an OLD definition (X-15 (4) refuses a precondition on a STOP at deploy now): deployed without it, then the stored row carries it; gate0 approved ⇒ walk 1 */
  async function chayCu(steps: WorkflowStep[], cu: WorkflowStep[]) {
    const ref = `x27-${++refN}`;
    const g0 = { id: "gate0", type: "hitl_gate", prompt: "approve" } as WorkflowStep;
    expect((await deployWorkflow({ ref, name: ref, steps: [g0, ...steps] } as WorkflowDefinition, USER)).ok).toBe(true);
    rows("orchestration_workflows").find((w) => w.ref === ref)!.definitionJson = { ref, name: ref, steps: [g0, ...cu], version: 1 };
    const r = await startRun(ref, {}, USER);
    const res = await resumeRun(r.runId!, { approved: true }, APPROVER);
    return { runId: r.runId!, res };
  }
  /** F1's shape (thăm dò X-29 bản b): xs skipped in walk 1; g1 approved ⇒ walk 2 latches, every pass throws */
  async function hinhF1() {
    nemTuStart();
    const sau = [gateT("g1"), main(resetComp("undo"))];
    const { runId, res } = await chayCu([stopX("xs"), ...sau], [stopX("xs", DK), ...sau]);
    expect(res.status).toBe("awaiting_confirm");
    expect(await step(runId, "xs")).toMatchObject({ status: "skipped" });
    await resumeRun(runId, { approved: true }, APPROVER);
    return runId;
  }

  it("M1-MOI the words of a planning that threw name no STOP compensation (no 'already finished'); ≤ 800 with run 2 147 483 647", () => {
    const n = noiDungCanhBaoKhongRo({ loai: "abortDefUnread", runId: 2_147_483_647, stepId: "?", compId: KHONG_CO_BU_TRU, error: "FOE_STOP_NOT_SENT", lan: "abort", keHoachLoi: true } as Parameters<typeof noiDungCanhBaoKhongRo>[0]);
    expect(n.message).toContain("no STOP compensation is named");
    expect(n.message).not.toContain("already finished");
    expect(n.message.length).toBeLessThanOrEqual(800);
  });

  it("M2-DO (F1-BOQUA) a STOP skipped by its precondition in walk 1 is named in X-26's words when walk 2's STOP pass throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await hinhF1();
      await doi(() => expect(luotHongVe("xs")).toHaveLength(1));
      expect(sent("stop")).toEqual([]);
      expect(await step(runId, "xs")).toMatchObject({ status: "skipped" });
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("M2-NGUOC-TT a STOP sent and done in walk 1 (row completed) is never named at walk 2's thrown pass; a STOP never reached is", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      nemTuStart();
      const r = await chay([stopX("xs"), gateT("g1"), seq("box", [main(resetComp("undo")), stopX("xt")])]);
      expect(r.res.status).toBe("awaiting_confirm");
      expect(await step(r.runId, "xs")).toMatchObject({ status: "completed" });
      await resumeRun(r.runId, { approved: true }, APPROVER);
      await doi(() => expect(luotHongVe("xt")).toHaveLength(1)); // positive anchor: the same naming has told the STOP never reached
      expect(luotHongVe("xs")).toEqual([]);
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("M2-NGUOC-AB the same run, an Abort whose planning throws (X-28): the STOP done in walk 1 is not named, the one never reached is", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      nemTuStart();
      const r = await chay([stopX("xs"), gateT("g1"), seq("box", [main(resetComp("undo")), stopX("xt")])]);
      await resumeRun(r.runId, { approved: true }, APPROVER);
      await doi(() => expect(luotHongVe("xt")).toHaveLength(1));
      g.__x26 = "settled"; // X-28's lever: the planning throws at the Abort, after the run's picture
      await abortRun(r.runId, ADMIN, "checked", { scope: null } as never);
      await doi(() => expect(abortVe("xt")).toHaveLength(1)); // positive anchor
      expect(abortVe("xs")).toEqual([]);
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("M2-CUNGLUOT skipped and latched in the SAME walk: named (rc.completed is read at the start of a walk)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      nemTuStart();
      const box = seq("box", [main(resetComp("undo"))]);
      await chayCu([stopX("xs"), box], [stopX("xs", DK), box]);
      await doi(() => expect(luotHongVe("xs")).toHaveLength(1));
      expect(sent("stop")).toEqual([]);
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("M2-ABORT the F1 run held, an Abort whose planning throws: the skipped STOP is named (the rows' picture holds no skipped row as completed)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runId = await hinhF1();
      await doi(() => expect(String(runRow(runId).status)).toBe("held"));
      g.__x26 = "settled";
      await abortRun(runId, ADMIN, "checked", { scope: null } as never);
      await doi(() => expect(abortVe("xs")).toHaveLength(1));
      expect(sent("stop")).toEqual([]);
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });
});


describe("X-27 (1) a Continue of a latched run whose first STOP pass throws sends no compensation: held, the approval spent (chủ dự án 19/11 \"1.chặn\")", () => {
  const g = globalThis as { __x26?: unknown };
  const LUOT_HONG = "the STOP pass of this run failed";
  const stopX = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop" }) as WorkflowStep;
  const doi = (f: () => void | Promise<void>) => vi.waitFor(f, { timeout: 3_000 });
  const tiep = (runId: number) => resumeRun(runId, { approved: true, note: "checked on site" }, ADMIN, {}, { scope: null });
  const luotHongVe = (id: string) => alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.forwardNotSent && String(a.title).includes(LUOT_HONG) && String(a.dedupKey ?? "").split(":")[2] === id);
  const batKhiStart = () =>
    otDispatchMock.mockImplementation(async (i) => {
      if (i.commandType === "start") {
        g.__x26 = "nem";
        return TIMEOUT;
      }
      return ACKED;
    });

  it("P1-DO (R1K-nem) every STOP pass throws: the Continue sends no reset, the run held in its words, xs named, the approval spent; a second Continue sends none either", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      batKhiStart();
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]);
      expect(r.res.status).toBe("held");
      await tiep(r.runId).catch(() => undefined);
      await doi(() => {
        expect(String(runRow(r.runId).status)).toBe("held");
        expect(String(runRow(r.runId).error ?? "")).toContain("sent no approved compensation that is not a STOP");
      });
      expect(String(runRow(r.runId).error ?? "")).toBe(chuLuotStopHongBuTru(r.runId)); // no state C half: the sentence alone
      expect(sent("reset")).toEqual([]);
      expect(sent("stop")).toEqual([]);
      expect(luotHongVe("xs").length).toBeGreaterThanOrEqual(2); // walk 1 and the Continue's walk, each its own event (X-26)
      expect(runRow(r.runId).contextJson[KHONG_RO_DUYET_CTX_KEY]).toBeUndefined(); // the approval is spent with its walk (foeEngine finishWalk)
      await tiep(r.runId).catch(() => undefined);
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      expect(sent("reset")).toEqual([]);
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("P1-NGUOC the pass threw once in walk 1, the Continue's pass is healthy: the reset goes as before (X-26 K6's shape)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      batKhiStart();
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]).finally(() => (g.__x26 = null));
      expect(r.res.status).toBe("held");
      await tiep(r.runId);
      await doi(() => expect(sent("reset")).toEqual(["reset"]));
      expect(String(runRow(r.runId).error ?? "")).not.toContain("sent no approved compensation that is not a STOP");
    } finally {
      g.__x26 = null;
      err.mockRestore();
    }
  });

  it("P1-CHAM (a named limit) the Continue's first pass answers after D, then throws: C-7 as before, the reset goes (X27DUONG, measured 18:11)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = (await import("./foeRunStore")) as unknown as { centralRunStore: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const st = m.centralRunStore;
    const goc = st.verifyStops!;
    let cheDo: "lanh" | "nem" | "cham" = "lanh";
    try {
      otDispatchMock.mockImplementation(async (i) => {
        if (i.commandType === "start") {
          cheDo = "nem";
          return TIMEOUT;
        }
        return ACKED;
      });
      st.verifyStops = async (...a: unknown[]) => {
        if (cheDo === "nem") throw new Error("verifyStops down (X-27 P1-CHAM)");
        if (cheDo === "cham") {
          await new Promise((x) => setTimeout(x, 2_000)); // > D (1 s) by 1 s: the wait of C-7 is over before it throws (a slow timer can only make the case red, never green)
          throw new Error("verifyStops slow then down (X-27 P1-CHAM)");
        }
        return goc(...a);
      };
      const r = await chay([seq("box", [main(resetComp("undo")), stopX("xs")])]);
      expect(r.res.status).toBe("held");
      cheDo = "cham";
      await tiep(r.runId).catch(() => undefined);
      await vi.waitFor(() => expect(sent("reset")).toEqual(["reset"]), { timeout: 5_000 });
    } finally {
      st.verifyStops = goc;
      err.mockRestore();
    }
  }, 15_000);

  it("P1-CHU the words: the approval spent, no STOP compensation named, nothing promised; ≤ 800 with run 2 147 483 647", () => {
    const t = chuLuotStopHongBuTru(2_147_483_647);
    expect(t.length).toBeLessThanOrEqual(800);
    expect(t).toContain("sent no approved compensation that is not a STOP");
    expect(t).toContain("An approved compensation that is a STOP may or may not have been sent by that pass."); // X-27c: neither way asserted
    expect(t).toContain("its STOP pass failed, so the system cannot say the STOP steps of this run are out"); // kiem-dinh w5: why nothing that is not a STOP went, word for word
    expect(t).toContain("sends the compensations that are not STOPs only if its STOP pass does not fail"); // kiem-dinh w4: a later Continue's promise, only those that are not STOPs
    expect(t).not.toContain("NONE");
    expect(t).toContain("That approval is spent: a later Continue needs a new approval");
    expect(t).toContain("no STOP compensation is named");
    expect(t).toContain("Abort sends STOP steps only."); // kiem-dinh c1: the one promise about Abort, word for word
    expect(t).not.toContain("is still running");
    expect(t).not.toContain("Abort can send");
  });
});


describe("X-27c the words of X-27 (1) when the STOP pass threw AFTER it had started an approved STOP compensation", () => {
  const g = globalThis as { __x26ls?: string | null };
  const stopX3 = (id: string): WorkflowStep => ({ id, type: "command", machineId: 3, command: "stop" }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as WorkflowStep;
  const doi = (f: () => void | Promise<void>) => vi.waitFor(f, { timeout: 3_000 });
  const tiep = (runId: number) => resumeRun(runId, { approved: true, note: "checked on site" }, ADMIN, {}, { scope: null });
  const adapterCua = (i: Record<string, unknown>) => (i as { adapterId?: unknown }).adapterId;
  const stopTren = (adapterId: number) => otDispatchMock.mock.calls.filter((c) => (c[0] as { commandType: unknown }).commandType === "stop" && adapterCua(c[0] as Record<string, unknown>) === adapterId).length;

  it("X27C-DADI the Continue's pass sends the approved STOP compensation undo (its pins read: plan.send), then throws on xv's classification: held in X-27 (1)'s words, which say a STOP compensation may or may not have gone", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = (await import("./foeRunStore")) as unknown as { centralRunStore: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const st = m.centralRunStore;
    const goc = st.verifyStops!;
    let n = 0;
    let hoi = false;
    let nhan = false;
    try {
      // KRT-STOP-OT-KHONGCHAC: this file's dispatcher mock has no classifyOtStop, so its verifier calls every OT STOP unsure (foeStepClass verified). At the Continue the verifier here
      // accepts undo's pins, as the real one does once they read again: undo goes in plan.send, started at once (foeEngine guiStopSauChot `viec`), before the loop that throws (X27C-KE KE-B, 04:05)
      st.verifyStops = async (...a: unknown[]) => {
        const v = (await goc(...a)) as { ids: Set<string>; unsure: Set<string> } & Record<string, unknown>;
        if (!nhan || !JSON.stringify(a[1] ?? null).includes('"undo"')) return v;
        const ids = new Set(v.ids);
        ids.add("undo");
        const unsure = new Set(v.unsure);
        unsure.delete("undo");
        return { ...v, ids, unsure };
      };
      // undo (machine 1, adapter 501): pinned at the first read, not pinned after (K2 khongGhim: walk 1 holds it), pinned again at the Continue (hoi)
      // xv (machine 3, adapter 503): its pins never read (the marked route), its stop refused (state C): due again at the Continue, in plan.unverified
      ghimMock.mockImplementation(async (_d, i) => {
        if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
        if (i.adapterId === 503) return { pinnedStop: false, loiDocGhim: "pin read timed out (X27C-DADI)" };
        if (hoi || ++n === 1) return { pinnedStop: true, loiDocGhim: null };
        await new Promise((x) => setTimeout(x, 40));
        return { pinnedStop: false, loiDocGhim: null };
      });
      HX.rowSlowMs = (row) => (row.stepId === "main" && row.status === "failed" ? 30 : 0);
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" && adapterCua(i) === 503 ? REJECTED : ACKED));
      const r = await chay([par("p", [stopX3("xv"), seq("box", [main()], stopComp())])]);
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      // the shape (else a named limit): undo held by walk 1, never sent
      expect(await step(r.runId, "undo")).toMatchObject({ status: "held" });
      const truoc = stopTren(501);
      hoi = true;
      nhan = true;
      HX.rowSlowMs = null;
      g.__x26ls = "xv"; // from the Continue on: xv's classification throws in the pass's loop over plan.unverified (foeEngine guiStopSauChot), after `viec` started
      await tiep(r.runId).catch(() => undefined);
      await doi(() => expect(stopTren(501)).toBe(truoc + 1)); // the shape: the approved STOP compensation went in the pass that threw
      // positive anchor: held in X-27 (1)'s words (the function, whichever its words)
      await doi(() => {
        expect(String(runRow(r.runId).status)).toBe("held");
        expect(String(runRow(r.runId).error ?? "")).toContain(chuLuotStopHongBuTru(r.runId));
      });
      expect(String(runRow(r.runId).error ?? "")).toContain("may or may not have been sent"); // X-27c: never "NONE" here
      expect(String(runRow(r.runId).error ?? "")).not.toContain("NONE");
    } finally {
      st.verifyStops = goc;
      g.__x26ls = null;
      HX.rowSlowMs = null;
      err.mockRestore();
    }
  });
});


describe("C7-XN (P1) a Continue of a latched run whose healthy first STOP pass leaves a STOP known not handed over sends no compensation that is not a STOP: held, the approval spent (chủ dự án 19/11 \"1.chặn\")", () => {
  const g = globalThis as { __x26?: unknown };
  const LUOT_HONG = "the STOP pass of this run failed";
  const C7_MAU = "is known not handed over";
  const XS_CHU = 'STOP "xs" did NOT go out';
  const stopX = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop" }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as WorkflowStep;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as WorkflowStep;
  const doi = (f: () => void | Promise<void>, timeout = 3_000) => vi.waitFor(f, { timeout });
  const tiep = (runId: number) => resumeRun(runId, { approved: true, note: "checked on site" }, ADMIN, {}, { scope: null });
  const loi = (runId: number) => String(runRow(runId).error ?? "");
  const veXs = () => alerts.filter((a) => a.kind === CANH_BAO_KHONG_RO_KIND.stopNotSent && String(a.dedupKey ?? "").split(":")[2] === "xs");
  const hongX26 = () => alerts.filter((a) => String(a.title).includes(LUOT_HONG));
  // the C7XN shape (measured 19:08 at 3223554e3): xs a pinned STOP of machine 1 beside a sequence whose `main` start (compensation: reset machine 3) times out and latches the run
  const hinhA = () => chay([par("p", [stopX("xs"), seq("b", [delay("w", 50), main(resetComp("undo"))])])]);
  const adapterCua = (i: Record<string, unknown>) => (i as { adapterId?: unknown }).adapterId;

  it("C7-A (C7XN shape A) xs refused at every send, the Continue's STOP pass healthy: no reset, held, the state C words of xs first and C7-XN's sentence last, the approval spent; a second Continue sends none either", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" ? REJECTED : ACKED));
      const r = await hinhA();
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      const dem = { id: "xs", n: 0 };
      (globalThis as { __c7dem?: { id: string; n: number } | null }).__c7dem = dem; // C7-XN lượt 2 (s1/s2): which path xs takes at the Continue
      // positive anchor: resumeRun returns once the Continue's walk has ended (it awaits driveRunFromResume, foeEngine.ts:4994): whatever it sent, it has sent
      const c = await tiep(r.runId);
      (globalThis as { __c7dem?: unknown }).__c7dem = null;
      expect(String(c.status)).toBe("held");
      expect(dem.n).toBeGreaterThanOrEqual(1); // the shape: xs went by the loop over plan.unverified (guiStopSauChot), not by plan.send
      expect(sent("reset")).toEqual([]); // HST 03:42: the behaviour first (the original code SENDS it: C7XN A, 19:08)
      expect(String(runRow(r.runId).status)).toBe("held");
      expect(loi(r.runId).endsWith(` ${chuStopChuaGiaoBuTru(r.runId)}`)).toBe(true);
      const e = loi(r.runId);
      expect(e.indexOf(XS_CHU)).toBeGreaterThanOrEqual(0);
      expect(e.indexOf(XS_CHU)).toBeLessThan(e.indexOf(chuStopChuaGiaoBuTru(r.runId))); // HST 03:27: "(named above)" holds only in this order
      expect(runRow(r.runId).contextJson[KHONG_RO_DUYET_CTX_KEY]).toBeUndefined(); // the approval is spent with its walk (foeEngine finishWalk)
      expect(veXs().length).toBeGreaterThanOrEqual(1); // xs named in its own state C URGENT
      expect(hongX26()).toEqual([]); // the shape: no STOP pass threw (X-27 (1) is not what held it)
      const c2 = await tiep(r.runId); // the second Continue: a new approval, the same refusal
      expect(String(c2.status)).toBe("held");
      expect(sent("reset")).toEqual([]);
      expect(loi(r.runId).endsWith(` ${chuStopChuaGiaoBuTru(r.runId)}`)).toBe(true);
    } finally {
      err.mockRestore();
    }
  });

  it("C7-A-SEND (C7XN shape A, the verifier accepting xs's pins at the Continue: xs in plan.send, not unverified) xs refused at its send: no reset, held in C7-XN's words", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = (await import("./foeRunStore")) as unknown as { centralRunStore: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const st = m.centralRunStore;
    const goc = st.verifyStops!;
    let nhan = false;
    try {
      // KRT-STOP-OT-KHONGCHAC: this file's verifier calls every OT STOP unsure; here, from the Continue on, it accepts xs's pins (as X27C-DADI does for undo): xs goes in plan.send
      st.verifyStops = async (...a: unknown[]) => {
        const v = (await goc(...a)) as { ids: Set<string>; unsure: Set<string> } & Record<string, unknown>;
        if (!nhan || !JSON.stringify(a[1] ?? null).includes('"xs"')) return v;
        const ids = new Set(v.ids);
        ids.add("xs");
        const unsure = new Set(v.unsure);
        unsure.delete("xs");
        return { ...v, ids, unsure };
      };
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" ? REJECTED : ACKED));
      const r = await hinhA();
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      nhan = true;
      const truoc = sent("stop").length;
      const dem = { id: "xs", n: 0 };
      (globalThis as { __c7dem?: { id: string; n: number } | null }).__c7dem = dem; // C7-XN lượt 2 (s1/s2)
      // positive anchor: resumeRun returns once the Continue's walk has ended (foeEngine.ts:4994)
      const c = await tiep(r.runId);
      (globalThis as { __c7dem?: unknown }).__c7dem = null;
      expect(String(c.status)).toBe("held");
      expect(dem.n).toBe(0); // the shape: xs never went by the loop over plan.unverified ⇒ it was in plan.send (with C7-A's ≥ 1: the wrapper is what moves it)
      expect(sent("stop").length).toBeGreaterThan(truoc); // the shape first (HST 04:50): xs was sent at the Continue (and refused)
      expect(sent("reset")).toEqual([]); // then the behaviour (the original code sends it)
      expect(loi(r.runId).endsWith(` ${chuStopChuaGiaoBuTru(r.runId)}`)).toBe(true);
      expect(hongX26()).toEqual([]);
    } finally {
      st.verifyStops = goc;
      err.mockRestore();
    }
  });

  it("C7-B (C7XN shape B) xs refused in walk 1 only, accepted at the Continue: the reset goes, no C7-XN words", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let luot = 1;
    try {
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" ? (luot === 1 ? REJECTED : ACKED) : ACKED));
      const r = await hinhA();
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      luot = 2;
      await tiep(r.runId);
      await doi(() => expect(sent("reset")).toEqual(["reset"]));
      expect(loi(r.runId)).not.toContain(C7_MAU);
    } finally {
      err.mockRestore();
    }
  });

  it("C7-DRIVERLOI xs refused in walk 1, its send THROWS at the Continue (state C from the driver: it may have gone out): not known, the reset goes", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let luot = 1;
    try {
      otDispatchMock.mockImplementation(async (i) => {
        if (i.commandType === "start") return TIMEOUT;
        if (i.commandType === "stop") {
          if (luot === 2) throw new Error("driver lost mid-write (C7-XN P1-DRIVERLOI)");
          return REJECTED;
        }
        return ACKED;
      });
      const r = await hinhA();
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      luot = 2;
      await tiep(r.runId).catch(() => undefined);
      await doi(() => expect(sent("reset")).toEqual(["reset"]));
      expect(hongX26()).toEqual([]); // the shape: the throw stayed inside the send (execCommand), the pass did not throw
      expect(loi(r.runId)).not.toContain(C7_MAU);
    } finally {
      err.mockRestore();
    }
  });

  it("C7-KHONGGHIM xs stop-typed but read NOT pinned (R-5-j), refused: never state C, the reset goes", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      ghimMock.mockImplementation(async (_d, i) => ({ pinnedStop: i.commandType === "stop" && i.adapterId !== 501, loiDocGhim: null }));
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" ? REJECTED : ACKED));
      const r = await hinhA();
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      await tiep(r.runId).catch(() => undefined);
      await doi(() => expect(sent("reset")).toEqual(["reset"]));
      expect(loi(r.runId)).not.toContain(C7_MAU);
    } finally {
      err.mockRestore();
    }
  });

  it("C7-CHAM (a named limit) xs refused, the refusal at the Continue answering after D: C-7 as before, the reset goes", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let luot = 1;
    try {
      otDispatchMock.mockImplementation(async (i) => {
        if (i.commandType === "start") return TIMEOUT;
        if (i.commandType === "stop") {
          if (luot === 2) await new Promise((x) => setTimeout(x, 2_000)); // > D (1 s) by 1 s: a slow timer can only make the case red, never green
          return REJECTED;
        }
        return ACKED;
      });
      const r = await hinhA();
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      luot = 2;
      await tiep(r.runId).catch(() => undefined);
      await vi.waitFor(() => expect(sent("reset")).toEqual(["reset"]), { timeout: 5_000 });
    } finally {
      err.mockRestore();
    }
  }, 15_000);

  it("C7-GOGIU the approved STOP compensation u3 goes in the Continue's healthy first pass, xs is refused: the gate's hold is not lifted, held in C7-XN's words", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let n = 0;
    let hoi = false;
    try {
      // u3 (machine 3, adapter 503): pinned at the first read, not pinned after (K2 khongGhim: the pass holds it); pinned again at the Continue (hoi)
      ghimMock.mockImplementation(async (_d, i) => {
        if (i.commandType !== "stop") return { pinnedStop: false, loiDocGhim: null };
        if (i.adapterId !== 503) return { pinnedStop: true, loiDocGhim: null };
        if (hoi || ++n === 1) return { pinnedStop: true, loiDocGhim: null };
        await new Promise((x) => setTimeout(x, 40));
        return { pinnedStop: false, loiDocGhim: null };
      });
      HX.rowSlowMs = (row) => (row.stepId === "main" && row.status === "failed" ? 30 : 0);
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" && adapterCua(i) === 501 ? REJECTED : ACKED));
      const r = await chay([par("p", [stopX("xs"), seq("box", [main()], stopComp("u3", 3))])]);
      await doi(() => expect(String(runRow(r.runId).status)).toBe("held"));
      // the shape (else a named limit): u3 held by walk 1, never sent; xs refused
      expect(await step(r.runId, "u3")).toMatchObject({ status: "held" });
      const stop503 = () => otDispatchMock.mock.calls.filter((c) => (c[0] as { commandType: unknown }).commandType === "stop" && adapterCua(c[0] as Record<string, unknown>) === 503).length;
      expect(stop503()).toBe(0);
      hoi = true;
      HX.rowSlowMs = null;
      await tiep(r.runId).catch(() => undefined);
      await doi(() => expect(stop503()).toBe(1)); // the shape: u3 went in the Continue's first pass
      await doi(() => {
        expect(String(runRow(r.runId).status)).toBe("held");
        expect(loi(r.runId).endsWith(` ${chuStopChuaGiaoBuTru(r.runId)}`)).toBe(true);
      });
      expect(loi(r.runId).indexOf(XS_CHU)).toBeGreaterThanOrEqual(0);
    } finally {
      HX.rowSlowMs = null;
      err.mockRestore();
    }
  });

  it("C7-CHU the words: no compensation that is not a STOP sent, a STOP compensation may have gone, the approval spent, never NONE; ≤ 800 with run 2 147 483 647", () => {
    const t = chuStopChuaGiaoBuTru(2_147_483_647);
    expect(t.length).toBeLessThanOrEqual(800);
    // C7-XN lượt 2 (w1, w2, w5): each sentence word for word; w1 is the one the owner heard about the downside
    expect(t).toContain("sent no approved compensation that is not a STOP: a STOP of this run is known not handed over (named above).");
    expect(t).toContain("An approved compensation that is a STOP may have been sent by this Continue's STOP pass.");
    expect(t).toContain("That approval is spent: a later Continue needs a new approval, and sends the compensations that are not STOPs only once its STOP pass leaves no STOP known not handed over.");
    expect(t).toContain("A compensation may be the move that makes another machine safe: it is not sent either.");
    expect(t).toContain("Stop the machine at the machine now with its direct STOP / E-STOP and check it on site; Abort sends STOP steps only.");
    expect(t).toContain("sent no approved compensation that is not a STOP");
    expect(t).toContain(C7_MAU);
    expect(t).toContain("An approved compensation that is a STOP may have been sent by this Continue's STOP pass."); // C7-XN bản 3 (HST 03:40): said straight
    expect(t).toContain("That approval is spent: a later Continue needs a new approval");
    expect(t).toContain("Abort sends STOP steps only.");
    expect(t).not.toContain("NONE");
    expect(t).not.toContain("is still running");
  });
});


describe("C7-XN lượt 2 — the cases of the surviving mutants (kiem-dinh 28 = 12 + 16, HST 10:02)", () => {
  const stopX = (id: string, machineId = 1): WorkflowStep => ({ id, type: "command", machineId, command: "stop" }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as WorkflowStep;
  const delay = (id: string, ms: number): WorkflowStep => ({ id, type: "delay", ms }) as WorkflowStep;
  const tiep = (runId: number) => resumeRun(runId, { approved: true, note: "checked on site" }, ADMIN, {}, { scope: null });
  const loi = (runId: number) => String(runRow(runId).error ?? "");
  it("C7-GOGIU-HAM (g6) goGiuDaDi called directly: a gate's hold (chanBuTru) whose step id IS in `go` stays as it is; without the flag the same hold is lifted (the control)", async () => {
    // a check at FUNCTION level: the real shape (a nested compensation, the gate's step id in `go`) could not be built (probe L2-KE, 20/11), so the flag is checked here
    // a hand-built context with only what goGiuDaDi reads (foeEngine goGiuDaDi, chuBuTruCua): "u" is no compensation of any step, it is held by this walk and went
    const lam = () =>
      ({
        runId: 1,
        def: { ref: "c7-gogiu-ham", name: "c7-gogiu-ham", steps: [{ id: "u", type: "command", machineId: 1, command: "stop" }] },
        buTruDaGiu: new Set(["u"]),
        buTruDaDi: new Map([["u", Promise.resolve(true)]]),
        giuCon: new Map(),
        context: {}, // kiem-dinh 10:22: loiCuaChot (E:1439-1442) reads rc.context on the lifting branch (E:1916)
      }) as never;
    const giu = { kind: "held", stepId: "u", reason: "outcomeUnknown", error: "the gate's words", chanBuTru: true } as never;
    const ra = await goGiuDaDi(lam(), giu);
    expect(ra).toBe(giu); // the gate's hold stands, the same object (the flag)
    const khongCo = { kind: "held", stepId: "u", reason: "outcomeUnknown", error: "a hold of the walk" } as never;
    const ra2 = (await goGiuDaDi(lam(), khongCo)) as { kind: string };
    expect(ra2.kind).toBe("failed"); // the control: the same hold without the flag is lifted, so the context reaches the branch that lifts
  });

  it("C7-DOC (g4) shape A, xs's adapter gone before the Continue: its first pass reads source doc (ADAPTER_UNRESOLVED), a STOP known not handed over: held in C7-XN's words", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" ? REJECTED : ACKED));
      const r = await chay([par("p", [stopX("xs"), seq("b", [delay("w", 50), main(resetComp("undo"))])])]);
      await vi.waitFor(() => expect(String(runRow(r.runId).status)).toBe("held"), { timeout: 3_000 });
      store.set("device_adapters", (store.get("device_adapters") as Array<{ id: number }>).filter((a) => a.id !== 501)); // xs (machine 1): no adapter now; reset (machine 3) keeps 503
      otDispatchMock.mockClear();
      const c = await tiep(r.runId);
      expect(String(c.status)).toBe("held"); // positive anchor
      expect(loi(r.runId)).toContain('STOP "xs" did NOT go out: nobody could read its pins'); // the shape: source doc (L2-KE g4-DOC, both bases)
      expect(sent()).toEqual([]); // nothing sent at the Continue (measured the same at ed55a6c5d)
      // C7-DOC-CHI-CHU (a named limit): the original code sends nothing in this shape either (why: not read), so this case does NOT show "reset blocked by source doc",
      // only the words and the held end below
      expect(loi(r.runId).endsWith(` ${chuStopChuaGiaoBuTru(r.runId)}`)).toBe(true); // doc counts as known not handed over (HST 03:27)
    } finally {
      err.mockRestore();
    }
  });

  it("C7-NGUOC-KHONGBUTRU (g7) a Continue of a latched run with NO held compensation, xs refused: not C7-XN's (as measured at ed55a6c5d)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : i.commandType === "stop" ? REJECTED : ACKED));
      const r = await chay([par("p", [stopX("xs"), seq("b", [delay("w", 50), main()])])]);
      await vi.waitFor(() => expect(String(runRow(r.runId).status)).toBe("held"), { timeout: 3_000 });
      otDispatchMock.mockClear();
      const c = await tiep(r.runId);
      expect(String(c.status)).toBe("held"); // positive anchor
      expect(sent()).toEqual(["stop", "stop", "stop"]); // xs re-sent with its attempts (L2-KE g7-NGUOC: the same at both bases)
      expect(loi(r.runId)).toContain('STOP "xs" did NOT go out: it was refused before it reached a driver (REJECTED)');
      expect(loi(r.runId)).not.toContain("is known not handed over");
    } finally {
      err.mockRestore();
    }
  });
});

// ═══ X-32 (T12-P4, AGENTS-ngoai-le.md dòng 45) — the words of an edge report refused because it carries a latch of its own (foeKetCucKhongRo edgeSyncRefused) ═══
describe("X-32 the URGENT of a refused edge report: the edge's word, one key per (run, reason), no promise", () => {
  const MA = ["payloadHangKhongRo", "payloadStopChuaRa", "payloadChot"] as const;
  const chu = (ma: string, buoc: string) =>
    noiDungCanhBaoKhongRo({ loai: "edgeSyncRefused", runId: 2_147_483_647, stepId: ma, compId: KHONG_CO_BU_TRU, error: "FOE_OUTCOME_UNKNOWN", lan: ma, buoc, nut: `edge-${"n".repeat(200)}` } as Parameters<typeof noiDungCanhBaoKhongRo>[0]);
  it("X32-CHU every reason: ≤ 800 with run 2 147 483 647 and long ids; the edge's own word; no 'abort', no 'has not ended', no 'decides'; the key is (run, reason) only", () => {
    const dai = `buoc_${"x".repeat(123)}`;
    for (const ma of MA) {
      const n = chu(ma, dai);
      expect(n.kind, ma).toBe("foe_outcome_unknown_edge_sync_refused"); // positive anchor
      expect(n.message, ma).toContain("What the report says is the edge's own word: the system cannot check it, nor whether any STOP reached the machine.");
      expect(n.message, ma).toContain("The system refused the whole report: nothing of it is in the central record of run 2147483647");
      expect(n.message, ma).toContain("Check the machine on site and use its direct STOP / E-STOP if needed.");
      expect(n.dedupKey, ma).toBe(`foe_outcome_unknown_edge_sync_refused:2147483647:${ma}:-:${ma}`);
      expect(n.message.length, ma).toBeLessThanOrEqual(800);
      expect(n.title.length, ma).toBeLessThanOrEqual(800);
      expect(`${n.title} ${n.message}`, ma).not.toMatch(/abort/i); // R of T12-P4 / T12-P4-R reads /abort/i as a promise of the Abort
      expect(n.message, ma).not.toContain("has not ended"); // bổ sung 1 (a): the run may have ended already
      expect(n.message, ma).not.toContain("decides");
      expect(`${n.title} ${n.message}`, ma).not.toContain("what the edge did"); // HST 18:25: only what was observed
      expect(n.title, ma).toBe("Run 2147483647: an edge report was refused in full, nothing of it is in the central record");
      expect(n.title, ma).not.toContain("outcome unknown —"); // khongChot: central never latched what the report says
      expect(n.message, ma).not.toContain(dai); // the step is cut at its ceiling (idGonCua)
    }
    expect(chu("payloadHangKhongRo", "x").message).toContain('said that the outcome of step "x" is unknown.');
    expect(chu("payloadStopChuaRa", "st").message).toContain('said that STOP step "st" was not sent.');
    expect(chu("payloadChot", "x").message).toContain('said that the run is latched (step "x").');
    // the step the edge names is never in the key: another step, the same reason ⇒ the same key; another reason ⇒ another key
    expect(chu("payloadStopChuaRa", "st2").dedupKey).toBe(chu("payloadStopChuaRa", "st").dedupKey);
    expect(chu("payloadHangKhongRo", "st").dedupKey).not.toBe(chu("payloadStopChuaRa", "st").dedupKey);
  });
});
