/**
 * X-39 (STOPCHUARA-LOC-THIEU-COMPENSATED, sửa PHÍA GHI; giấy tam/x39-ghi-buoc1-1.md + hàng X-39) — unit half (no DB): when a STOP compensation the stored state-C list
 * (foeStopChuaRa) names goes (its own send answered ok), central drops it from the STORED list (centralRunStore.xoaStopChuaRaDaLuu) BEFORE its `compensated` row, so a process
 * that dies between the two never leaves a list naming a STOP its row says went (X39-KE4: after a restart a person's Continue was held by that STOP, an URGENT said it was not
 * sent, until an Abort). Same in-memory harness as foeKetCucKhongRo.a2n.test.ts (the block below is copied from it, unchanged: its lines 9-333), in a file of its own because the
 * crash case reloads the engine module (vi.resetModules). The store method's SQL (one UPDATE of that key only) cannot run on this stand-in: here it is the stand-in's equivalent
 * (globalThis.__x39xoa, below), the SQL itself is measured on the `_test` DB by foeStopChuaRaGhi.a2n.db.test.ts. The eye (HX.rowSlowMs) reads the STORED list the moment a
 * row of cs is written (it is asked before the row lands).
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


// X-39 — the store's new write, on this stand-in: what its one UPDATE does (foeRunStore.xoaStopChuaRaDaLuuTrong), applied to the stored run row; off ⇒ the real function (its SQL
// needs a database). A hoisted factory reads the stand-in through a global, never a module binding
vi.mock("./foeRunStore", async (importOriginal) => {
  const o = await importOriginal<typeof import("./foeRunStore")>();
  const s = o.centralRunStore;
  return {
    ...o,
    centralRunStore: {
      ...s,
      xoaStopChuaRaDaLuu: async (runId: number, id: string) => {
        const gia = (globalThis as { __x39xoa?: (runId: number, id: string) => Promise<void> }).__x39xoa;
        // the cast: the red-before tree (store without the method) compiles too; there the walk never calls it
        return gia ? gia(runId, id) : (s as { xoaStopChuaRaDaLuu?: (runId: number, id: string) => Promise<void> }).xoaStopChuaRaDaLuu?.(runId, id);
      },
    },
  };
});

describe("X-39 — a STOP compensation that went leaves the STORED state-C list before its `compensated` row", () => {
  const stopX = (id: string, machineId = 1): WorkflowStep => ({ id, type: "command", machineId, command: "stop" }) as WorkflowStep;
  const par = (id: string, steps: WorkflowStep[]): WorkflowStep => ({ id, type: "parallel", failFast: false, steps }) as WorkflowStep;
  const qq = (id: string, comp?: WorkflowStep): WorkflowStep => ({ id, type: "command", machineId: 3, command: "start", ...(comp ? { compensation: comp } : {}) }) as WorkflowStep;
  const doi = (f: () => void | Promise<void>, timeout = 3_000) => vi.waitFor(f, { timeout });
  const tiep = (runId: number) => resumeRun(runId, { approved: true, note: "checked on site" }, ADMIN, {}, { scope: null });
  const cho = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  const luuLai = (runId: number) => structuredClone((runRow(runId).contextJson ?? {}).foeStopChuaRa ?? null);
  /** the store's write, on this stand-in: `id` leaves the stored list, the key goes with its last element, nothing else is touched; every call is recorded */
  const goiXoa: Array<{ runId: number; id: string }> = [];
  const gia = async (runId: number, id: string) => {
    goiXoa.push({ runId, id });
    const run = runRow(runId);
    const ds = (run?.contextJson ?? {}).foeStopChuaRa;
    if (!run || !Array.isArray(ds) || !ds.includes(id)) return;
    const { foeStopChuaRa: _bo, ...con } = run.contextJson as Record<string, unknown>;
    const moi = ds.filter((x: unknown) => x !== id);
    run.contextJson = moi.length ? { ...con, foeStopChuaRa: moi } : con;
  };
  /** start@503 REJECTED (qq), start@501 TIMEOUT (the latch); stop: walk 1 per `lan1`, after it per `lan2`; reset ACKED, held while `giu` is set */
  const may = (x: { lan1: (a: unknown) => Record<string, unknown>; lan2: (a: unknown) => Record<string, unknown>; giu?: Promise<void> }) => {
    let luot = 1;
    otDispatchMock.mockReset();
    otDispatchMock.mockImplementation(async (i) => {
      const a = (i as { adapterId?: unknown }).adapterId;
      if (i.commandType === "start") return a === 503 ? REJECTED : TIMEOUT;
      if (i.commandType === "stop") return luot === 1 ? x.lan1(a) : x.lan2(a);
      if (i.commandType === "reset" && luot === 2 && x.giu) await x.giu;
      return ACKED;
    });
    return () => void (luot = 2);
  };
  beforeEach(() => {
    goiXoa.length = 0;
    (globalThis as { __x39xoa?: unknown }).__x39xoa = gia;
  });

  it("X39-GHI-TU-CHOI-GIU-NO (ca giữ) cs refused again at the Continue: when its failed row is written the stored list still names cs; the store's write is never called", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const sang2 = may({ lan1: () => REJECTED, lan2: () => REJECTED });
      const r = await chay([par("p", [seq("a", [main(resetComp("undo"))]), qq("qq", stopX("cs"))])]);
      await doi(() => expect(String(runRow(r.runId).status), "the shape: held").toBe("held"));
      expect(luuLai(r.runId), "the shape: cs in state C, the stored list").toEqual(["cs"]);
      const luc: unknown[] = [];
      HX.rowSlowMs = (h) => (h.runId === r.runId && h.stepId === "cs" && h.status === "failed" ? (luc.push(luuLai(r.runId)), 0) : 0);
      sang2();
      expect(String((await tiep(r.runId)).status)).toBe("held");
      expect(luc.length, "the shape: cs's failed row written at the Continue").toBeGreaterThan(0);
      expect(luc.every((x) => JSON.stringify(x) === JSON.stringify(["cs"])), `the stored list when cs's failed row is written: ${JSON.stringify(luc)}`).toBe(true);
      expect(goiXoa, "a refused send clears nothing").toEqual([]);
      expect(luuLai(r.runId)).toEqual(["cs"]);
    } finally {
      HX.rowSlowMs = null;
      err.mockRestore();
    }
  });

  it("X39-GHI-HAI-STOP two STOP compensations in state C (cs1 @501 accepted, cs2 @503 refused at the Continue): when cs1's compensated row is written the stored list names cs2 alone", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const sang2 = may({ lan1: () => REJECTED, lan2: (a) => (a === 501 ? ACKED : REJECTED) });
      const r = await chay([par("p", [seq("a", [main(resetComp("undo"))]), qq("q1", stopX("cs1")), qq("q2", stopX("cs2", 3))])]);
      await doi(() => expect(String(runRow(r.runId).status), "the shape: held").toBe("held"));
      expect([...((luuLai(r.runId) as string[] | null) ?? [])].sort(), "the shape: both in state C").toEqual(["cs1", "cs2"]);
      const luc: unknown[] = [];
      HX.rowSlowMs = (h) => (h.runId === r.runId && h.stepId === "cs1" && h.status === "compensated" ? (luc.push(luuLai(r.runId)), 0) : 0);
      sang2();
      await tiep(r.runId);
      expect(luc, "when cs1's compensated row is written: cs1 left the stored list, cs2 stays").toEqual([["cs2"]]);
      expect(goiXoa, "the store's write names the STOP that went, and only it").toEqual([{ runId: r.runId, id: "cs1" }]);
    } finally {
      HX.rowSlowMs = null;
      err.mockRestore();
    }
  });

  // LAST in the file: it reloads the engine module (a process after a crash)
  it("X39-GHI-CUA-SO-DONG (X39-KE4 V1) the block's compensation is a reset, cs (a STOP) went at the Continue: when its compensated row is written the stored list no longer names cs; a crash in the window, a restart, a person's Continue: the run is not held by cs, no URGENT says cs did not go", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let tha: (() => void) | null = null;
    const giu = new Promise<void>((ok) => (tha = ok));
    try {
      const sang2 = may({ lan1: () => REJECTED, lan2: () => ACKED, giu });
      const r = await chay([{ ...par("p", [main(), qq("qq", stopX("cs"))]), compensation: resetComp("undo") } as WorkflowStep]);
      await doi(() => expect(String(runRow(r.runId).status), "the shape: held").toBe("held"));
      expect(luuLai(r.runId), "the shape: cs in state C, the stored list").toEqual(["cs"]);
      const luc: unknown[] = [];
      HX.rowSlowMs = (h) => (h.runId === r.runId && h.stepId === "cs" && h.status === "compensated" ? (luc.push(luuLai(r.runId)), 0) : 0);
      sang2();
      const kqP = tiep(r.runId).then(
        (v) => ({ status: (v as { status?: unknown }).status ?? null }),
        (x) => ({ nem: String((x as Error)?.message ?? x).slice(0, 200) }),
      );
      await doi(() => expect(sent("reset").length, "the shape: the window is open (reset handed over, held)").toBeGreaterThanOrEqual(1));
      expect(luc.length, "the shape: cs's compensated row written once").toBe(1);
      expect(luc[0], "when cs's compensated row is written, the stored list no longer names cs").toBeNull();
      // the process dies in the window: what is stored now is all a restart reads
      await cho(100);
      const anh = new Map([...store].map(([k, v]) => [k, structuredClone(v)] as const));
      tha?.();
      await kqP;
      await cho(300);
      for (const [k, v] of store) v.splice(0, v.length, ...structuredClone(anh.get(k) ?? []));
      HX.rowSlowMs = null;
      vi.resetModules();
      const eng = await import("./foeEngine");
      otDispatchMock.mockReset();
      otDispatchMock.mockImplementation(async (i) => (i.commandType === "start" ? TIMEOUT : ACKED));
      await eng.rehydrateInterruptedRuns();
      await cho(300);
      expect(String(runRow(r.runId).status), "the shape: the restart holds the run (its block's compensation was in flight)").toBe("held");
      const a0 = alerts.length;
      await eng.resumeRun(r.runId, { approved: true, note: "checked on site after restart" }, ADMIN, {}, { scope: null });
      await cho(300);
      expect(String(runRow(r.runId).status), "a person's Continue after the restart is not held by cs (X39-KE4 V0: failed)").toBe("failed");
      expect(String(runRow(r.runId).error ?? "")).not.toContain('STOP "cs" is not confirmed out');
      expect(alerts.slice(a0).map((a) => String(a.dedupKey)).filter((k) => k.includes("stop_not_sent") && k.includes(":cs:")), "no URGENT that cs did not go").toEqual([]);
    } finally {
      tha?.();
      HX.rowSlowMs = null;
      delete (globalThis as { __x39xoa?: unknown }).__x39xoa;
      err.mockRestore();
    }
  });
});
