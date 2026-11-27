/**
 * T10 (chủ dự án 27/11: "khi boot đã quá hạn: KHÔNG tự gửi STOP — giữ run + URGENT"; HST quyết 1-5) + BOOT-QUET-DUNG-KHI-GHI-LOI (gộp vào T10) — the boot of a process that died
 * while a LATCHED run was walking (the shape measured by T10-KE1 HA / T10-KE3: its first STOP pass in flight at the crash): the boot continues it by itself only inside the bound on the
 * DATABASE clock; past it (or its age unreadable, or automatic continuation off) nothing is sent, the run is held, kind 25 tells a person. A write of the boot scan that throws ends that
 * run's handling only (kind 26). The REAL engine walks on the in-memory drizzle stand-in of foeKetCucKhongRo.a2n.test.ts (its lines 9-333 copied here, line 9 adds afterEach), with a
 * crash simulated by copying the stand-in (the disk) and reloading the engine module (a fresh process). The latch's real age (SQL) is measured by foeBootQuaHan.a2n.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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


// ── T10 — the boot's own bound. The bound's age is answered by a hook PER RUN; every ask is recorded (M7). No key ⇒ the real store function (on this stand-in it cannot run SQL ⇒ it
// throws ⇒ the gate treats the age as unreadable ⇒ past the bound). "nem" ⇒ it throws (M10). The real function is measured by foeBootQuaHan.a2n.db.test.ts
vi.mock("./foeRunStore", async (importOriginal) => {
  const o = await importOriginal<typeof import("./foeRunStore")>();
  const g = globalThis as { __t10tuoi?: Record<number, number | null | "nem">; __t10hoi?: Array<[number, string[]]> };
  // the cast: the red-before tree (no such method) compiles too; there the engine never asks
  const that = (o.centralRunStore as unknown as { docTuoiMocChot?: (runId: number, stepIds: readonly string[]) => Promise<number | null> }).docTuoiMocChot;
  return {
    ...o,
    centralRunStore: {
      ...o.centralRunStore,
      docTuoiMocChot: async (runId: number, stepIds: readonly string[]) => {
        (g.__t10hoi ??= []).push([runId, [...stepIds].sort()]); // B1: the steps asked for too
        const v = g.__t10tuoi?.[runId];
        if (v === undefined) return that ? that(runId, stepIds) : null;
        if (v === "nem") throw new Error("the latch mark read failed (T10)");
        return v;
      },
    },
  };
});

const g10 = globalThis as { __t10tuoi?: Record<number, number | null | "nem">; __t10hoi?: Array<[number, string[]]> };
const lenh10 = (id: string, machineId: number, command: string): WorkflowStep => ({ id, type: "command", machineId, command }) as WorkflowStep;
const goi10 = (tu = 0) => otDispatchMock.mock.calls.slice(tu).map((c) => `${String((c[0] as { commandType?: unknown }).commandType)}@${String((c[0] as { adapterId?: unknown }).adapterId)}`);
const cho10 = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const HAN_MS = 5 * 60_000; // STOP_BU_TRU_KHOI_DONG_HAN_MS (foeBuTruBiNgat.ts:47) = hanGuiLaiMs() here (FOE_ACTION_TTL_MS is larger): quyết 2, one constant
/** machine 4 / adapter 504: a second machine for a second run (T10-KE3: two HA runs on separate machines) — SỬA TAY of the stand-in, inside the case */
function themMay4() {
  rows("machines").push({ id: 4, machineType: "AUTOMATION", capabilities: null, code: "M4", name: "Auto-4", operationStatus: "stopped", stationId: 1 });
  rows("device_adapters").push({ id: 504, machineId: 4, isEnabled: true });
}
/**
 * HA (T10-KE1, KE3): one run per machine of `mays` (1 ⇒ adapter 501, 4 ⇒ 504): [main (start TIMEOUT ⇒ the latch), cs (a STOP)]; the first STOP pass's stop is HELD, the disk is
 * copied while every run is still walking (the process dies there), then released. One run after the other: run i is the i-th row of the scan
 */
async function dungHinhHA(mays: number[] = [1]) {
  if (mays.includes(4)) themMay4();
  let tha = null as (() => void) | null; // X-39b: the declared type, never narrowed to null
  const giu = new Promise<void>((ok) => (tha = ok));
  otDispatchMock.mockReset();
  otDispatchMock.mockImplementation(async (i) => {
    if (i.commandType === "stop") {
      await giu;
      return ACKED;
    }
    return i.commandType === "start" ? TIMEOUT : ACKED;
  });
  const runIds: number[] = [];
  const luot: Array<Promise<unknown>> = [];
  try {
    for (const may of mays) {
      luot.push(
        chay([lenh10("main", may, "start"), lenh10("cs", may, "stop")], (id) => {
          runIds.push(id);
        }).catch(() => null),
      );
      await vi.waitFor(() => expect(goi10().filter((x) => x.startsWith("stop@")).length, "the shape: this run's first STOP pass handed its STOP over, held").toBe(luot.length), { timeout: 3_000 });
    }
    for (const id of runIds) await vi.waitFor(() => expect(((runRow(id).contextJson ?? {}) as Record<string, unknown>)[KET_CUC_KHONG_RO_CHOT_CTX_KEY], "the shape: the latch is stored").toBeTruthy(), { timeout: 3_000 });
    await cho10(150);
    for (const id of runIds) expect(String(runRow(id).status), "the shape: the run is still walking at the crash (P1's input)").toBe("running");
    const anh = new Map([...store].map(([k, v]) => [k, structuredClone(v)] as const));
    return { runIds, anh };
  } finally {
    tha?.();
    await Promise.all(luot);
    await cho10(300);
  }
}
/** a boot on the copied disk: a fresh engine module (a process after a crash); the hook answers the latch's age per run */
async function boot10(anh: Map<string, Row[]>, x: { durable: boolean; tuoi?: Record<number, number | null | "nem">; foeTat?: true }) {
  for (const [k, v] of store) v.splice(0, v.length, ...structuredClone(anh.get(k) ?? []));
  g10.__t10tuoi = x.tuoi ?? {};
  g10.__t10hoi = [];
  if (x.durable) process.env.FOE_DURABLE = "true";
  else delete process.env.FOE_DURABLE;
  if (x.foeTat) process.env.FOE_ENABLED = "";
  vi.resetModules();
  const eng = await import("./foeEngine");
  otDispatchMock.mockReset();
  otDispatchMock.mockImplementation(async () => ACKED);
  const a0 = alerts.length;
  const kq = await eng.rehydrateInterruptedRuns();
  await cho10(400);
  return { eng, kq, lenh: goi10(0), moi: alerts.slice(a0), hoi: [...(g10.__t10hoi ?? [])] };
}
// the cast: the red-before tree has no kind 25 / 26 (undefined ⇒ a name no URGENT carries ⇒ the URGENT assertions are red there)
const KIND_25 = (CANH_BAO_KHONG_RO_KIND as unknown as Record<string, string | undefined>).bootQuaHan ?? "(no kind 25)";
const KIND_26 = (CANH_BAO_KHONG_RO_KIND as unknown as Record<string, string | undefined>).bootKhongXuLy ?? "(no kind 26)";
const cuaRun = (moi: Array<Record<string, any>>, kind: string, runId: number) => moi.filter((a) => a.kind === kind && a.entityId === runId);
/** the URGENT kinds a boot INSIDE the bound raises today on HA (T10-KE1 V-D1, n2-K0.txt 297ed6e9b8dab371): the inside path must not change */
const KE1_VD1_KINDS: readonly string[] = ["foe_outcome_unknown_no_compensation"];

describe("T10 — a boot past the bound does not send a latched run's STOP by itself: held, an URGENT, a person decides (chủ dự án 27/11)", () => {
  afterEach(() => {
    delete g10.__t10tuoi;
    delete g10.__t10hoi;
    delete process.env.FOE_DURABLE;
    process.env.FOE_ENABLED = "true";
  });

  it("T10-THAT-QUA-HAN past the bound (age > D, FOE_DURABLE on): the latch's age is asked ONCE for this run; nothing is sent; held, interrupted; ONE URGENT of kind 25", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      const b = await boot10(anh, { durable: true, tuoi: { [c!]: HAN_MS + 1 } });
      expect(b.lenh, "past the bound a boot sends nothing by itself").toEqual([]);
      expect(b.hoi, "the gate asks the latch's age, for this run and its latched step, once (M7, B1)").toEqual([[c, ["main"]]]);
      expect(String(runRow(c!).status)).toBe("held");
      expect((runRow(c!).contextJson as Record<string, unknown>).interrupted).toBe(true);
      expect(cuaRun(b.moi, KIND_25, c!), "a person is told").toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-DUNG-HAN exactly at the bound (age = D): past it, as the boot re-send's window (conLai <= 0, foeEngine.ts:5595)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      const b = await boot10(anh, { durable: true, tuoi: { [c!]: HAN_MS } });
      expect(b.lenh).toEqual([]);
      expect(cuaRun(b.moi, KIND_25, c!)).toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-VANG-MOC the latch's age cannot be read (null): past the bound (quyết 1: no evidence, no act)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      const b = await boot10(anh, { durable: true, tuoi: { [c!]: null } });
      expect(b.lenh).toEqual([]);
      expect(String(runRow(c!).status)).toBe("held");
      expect(cuaRun(b.moi, KIND_25, c!)).toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-DOC-NEM the age read THROWS for the first run: that run only is past the bound (nothing of it sent, kind 25); the next run is still looked at and sends its STOP (M10)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c1, c2], anh } = await dungHinhHA([1, 4]);
      const b = await boot10(anh, { durable: true, tuoi: { [c1!]: "nem", [c2!]: 0 } });
      expect(b.lenh.filter((x) => x === "stop@501"), "the run whose read threw sends nothing").toEqual([]);
      expect(b.hoi, "both runs are asked, in the scan's order").toEqual([[c1, ["main"]], [c2, ["main"]]]);
      expect(b.lenh.filter((x) => x === "stop@504").length, "the next run inside the bound sends its STOP").toBeGreaterThanOrEqual(1);
      expect(b.lenh.filter((x) => x.startsWith("start@"))).toEqual([]);
      expect(cuaRun(b.moi, KIND_25, c1!)).toHaveLength(1);
      expect(cuaRun(b.moi, KIND_25, c2!)).toEqual([]);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-TRONG-HAN (guard, green before) inside the bound: the boot's walk sends the STOP as today, nothing forward; the URGENT kinds are today's (T10-KE1 V-D1)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      const b = await boot10(anh, { durable: true, tuoi: { [c!]: HAN_MS - 60_000 } });
      expect(b.lenh.filter((x) => x === "stop@501").length, "the STOP goes").toBeGreaterThanOrEqual(1);
      expect(b.lenh.filter((x) => x.startsWith("start@")), "nothing forward").toEqual([]);
      expect([...new Set(b.moi.map((a) => String(a.kind)))].sort(), "the inside path's URGENTs do not change (no kind 25 among them)").toEqual([...KE1_VD1_KINDS].sort());
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-TAT FOE_DURABLE off: nothing is sent, held, and ONE URGENT of kind 25 says so (T10-KE1 V-T0: none today)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      const b = await boot10(anh, { durable: false });
      expect(b.lenh).toEqual([]);
      expect(String(runRow(c!).status)).toBe("held");
      expect(cuaRun(b.moi, KIND_25, c!), "a person is told even when nothing would have sent it").toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-FOE-TAT FOE_DURABLE on but FOE_ENABLED off (autoResume returns at once): nothing is sent, held, ONE URGENT of kind 25 (A1)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      const b = await boot10(anh, { durable: true, foeTat: true, tuoi: { [c!]: 0 } });
      expect(b.lenh).toEqual([]);
      expect(String(runRow(c!).status)).toBe("held");
      expect(cuaRun(b.moi, KIND_25, c!), "a latched run nothing continues: a person is told").toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-CHOT-HANG the latch only in the rows (the context's mark gone), two latched rows, the newer one first: the run is latched (B2), BOTH steps are asked (A2: the MIN in SQL), past the bound nothing is sent", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      // SỬA TAY of the copied disk: the stored latch mark removed (a crash before the context was saved); a second latched row m0 put BEFORE main in the rows' order
      delete (anh.get("orchestration_runs")!.find((x) => x.id === c)!.contextJson as Record<string, unknown>)[KET_CUC_KHONG_RO_CHOT_CTX_KEY];
      const buoc = anh.get("orchestration_run_steps")!;
      buoc.unshift({ id: 9_001, runId: c, stepId: "m0", stepType: "command", status: "failed", attempt: 1, error: "FOE_OUTCOME_UNKNOWN: Command \"start\" rejected (timeout).", resultJson: null, startedAt: null, finishedAt: null });
      const b = await boot10(anh, { durable: true, tuoi: { [c!]: HAN_MS + 1 } });
      expect(b.lenh, "latched by its rows alone: past the bound nothing is sent").toEqual([]);
      expect(b.hoi, "every latched step is asked for, never the first row only").toEqual([[c, ["m0", "main"]]]);
      expect(cuaRun(b.moi, KIND_25, c!)).toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("T10-THAT-CHOT-NGU-CANH every latch source of the context names a step of its own (the outcome-unknown mark, the unknown-outcome list, a resume entry): all of them are asked (R2, R3)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      // SỬA TAY of the copied disk: three more latched steps, each named by ONE source of the context only; their rows carry no code
      const ctx = anh.get("orchestration_runs")!.find((x) => x.id === c)!.contextJson as Record<string, unknown>;
      ctx[KET_CUC_KHONG_RO_CTX_KEY] = { stepId: "m2", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", ds: [] };
      ctx.foeOutcomeUnknown = ["m0"];
      ctx.foeResumeState = { m1: { state: "outcomeUnknown" } };
      const buoc = anh.get("orchestration_run_steps")!;
      for (const [i, id] of ["m0", "m1", "m2"].entries()) buoc.push({ id: 9_101 + i, runId: c, stepId: id, stepType: "command", status: "running", attempt: 1, error: null, resultJson: null, startedAt: null, finishedAt: null });
      const b = await boot10(anh, { durable: true, tuoi: { [c!]: HAN_MS + 1 } });
      expect(b.hoi, "every step the latch names, from every source").toEqual([[c, ["m0", "m1", "m2", "main"]]]);
      expect(b.lenh).toEqual([]);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  /** a run that finished a and b, then (SỬA TAY) b's row gone and the run held + interrupted, as a crash after a: a Continue would walk b (start@501). `chot` adds the latch mark on a */
  async function dungChuaXong(chot: boolean) {
    otDispatchMock.mockReset();
    otDispatchMock.mockImplementation(async () => ACKED);
    const r = await chay([lenh10("a", 1, "start"), lenh10("b", 1, "start")]);
    store.set("orchestration_run_steps", rows("orchestration_run_steps").filter((x) => x.runId !== r.runId || x.stepId !== "b"));
    Object.assign(runRow(r.runId), { status: "held", finishedAt: null, error: null, contextJson: { interrupted: true, ...(chot ? { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: "a", ma: "FOE_OUTCOME_UNKNOWN", at: new Date().toISOString() } } : {}) } });
    return r.runId;
  }
  /** the FIRST read of step rows (the gate's) throws; the later ones answer */
  function hongLanDocHangDau() {
    const selGoc = fakeDb.select;
    let lan = 0;
    (fakeDb as { select: typeof selGoc }).select = (...a: unknown[]) => {
      const ch = (selGoc as (...x: unknown[]) => any).apply(fakeDb, a);
      const from0 = ch.from.bind(ch);
      ch.from = (t: any) => {
        if (tbl(t) === "orchestration_run_steps" && lan++ === 0) throw new Error("step rows read failed (T10)");
        return from0(t);
      };
      return ch;
    };
    return () => {
      (fakeDb as { select: typeof selGoc }).select = selGoc;
    };
  }

  it("T10-HANG-KHONG-DOC (D3, a change of behaviour on the conservative side) an interrupted run NOT latched whose rows cannot be read at the gate: not continued (b not sent), ONE kind 26", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const traLai = hongLanDocHangDau;
    let tra: (() => void) | null = null;
    try {
      const id = await dungChuaXong(false);
      process.env.FOE_DURABLE = "true";
      const g0 = otDispatchMock.mock.calls.length;
      const a0 = alerts.length;
      tra = traLai();
      const kq = await autoResumeInterruptedRuns([id]);
      tra();
      tra = null;
      await cho10(200);
      expect(cuaRun(alerts.slice(a0), KIND_26, id), "a person is told").toHaveLength(1);
      expect(goi10(g0), "not continued: b is not sent").toEqual([]);
      expect(kq.runIds).toEqual([]);
      expect(String(runRow(id).status)).toBe("held");
    } finally {
      tra?.();
      err.mockRestore();
    }
  }, 30_000);

  it("T10-HANG-KHONG-DOC-CHOT the same unreadable rows, but the context holds the latch mark: the gate is still passed (the mark's step is asked for), no kind 26", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let tra: (() => void) | null = null;
    try {
      const id = await dungChuaXong(true);
      process.env.FOE_DURABLE = "true";
      g10.__t10tuoi = { [id]: 0 };
      g10.__t10hoi = [];
      const a0 = alerts.length;
      tra = hongLanDocHangDau();
      await autoResumeInterruptedRuns([id]);
      tra();
      tra = null;
      await cho10(200);
      expect(g10.__t10hoi, "the gate asked the mark's step").toEqual([[id, ["a"]]]);
      expect(cuaRun(alerts.slice(a0), KIND_26, id)).toEqual([]);
    } finally {
      tra?.();
      err.mockRestore();
    }
  }, 30_000);

  it("T10-NGUOI-CONTINUE the bound is the boot's only: after a boot held it past the bound, a PERSON's Continue sends the STOP as today, nothing forward (M9)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      const b = await boot10(anh, { durable: true, tuoi: { [c!]: HAN_MS + 1 } });
      expect(String(runRow(c!).status), "past the bound the boot holds it").toBe("held");
      const g0 = otDispatchMock.mock.calls.length;
      await b.eng.resumeRun(c!, { approved: true, note: "checked on site after the restart" }, ADMIN, {}, { scope: null });
      await cho10(300);
      expect(goi10(g0).filter((x) => x === "stop@501").length, "a person's Continue sends the STOP").toBeGreaterThanOrEqual(1);
      expect(goi10(g0).filter((x) => x.startsWith("start@")), "nothing forward").toEqual([]);
    } finally {
      err.mockRestore();
    }
  }, 30_000);
});

// ── BOOT-QUET-DUNG-KHI-GHI-LOI (HST 27/11, gộp vào T10; BQ-KE1 n4-K0.txt 0f6489e638754c24): one status write of the boot scan throws ⇒ that run only is not handled ⇒ kind 26, not in
// result.runIds, nothing sent for it; the scan goes on. Three runs walked to their end on the real path, then their status set by hand (SỬA TAY, as BQ-KE1): R1 compensating, R2 running,
// R3 compensating. The fault: fakeDb.update wrapped for ONE run and ONE status, inside the case. Order of the scan = the stand-in's row order (BQ-THU-TU-KHONG-CHAC on Postgres)
describe("BQ — one write of the boot scan that throws ends that run's handling only (BOOT-QUET-DUNG-KHI-GHI-LOI)", () => {
  const buoc = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "start" }) as WorkflowStep;
  const updGoc = fakeDb.update;
  /** `sau` false: the write throws before it lands; true: it lands, then throws (a commit whose answer is lost: SUY of a deadline / a dropped connection) */
  function nemKhiGhi(runId: number, status: string, sau: boolean) {
    (fakeDb as { update: typeof updGoc }).update = (t: any) => {
      const u = updGoc.call(fakeDb, t);
      const set0 = u.set.bind(u);
      u.set = (p: Row) => {
        const r = set0(p);
        const where0 = r.where.bind(r);
        r.where = (c: any) => {
          const trung = tbl(t) === "orchestration_runs" && p.status === status && applyWhere(rows("orchestration_runs"), c).some((x) => x.id === runId);
          if (!trung) return where0(c);
          if (!sau) throw new Error("status write failed (BQ)");
          where0(c);
          throw new Error("status write answered with an error after it landed (BQ)");
        };
        return r;
      };
      return u;
    };
  }
  async function baRun() {
    otDispatchMock.mockReset();
    otDispatchMock.mockImplementation(async () => ACKED);
    const r1 = await chay([buoc("a")]);
    const r2 = await chay([buoc("b")]);
    const r3 = await chay([buoc("c")]);
    runRow(r1.runId).status = "compensating";
    runRow(r2.runId).status = "running";
    runRow(r3.runId).status = "compensating";
    return [r1.runId, r2.runId, r3.runId] as const;
  }
  afterEach(() => {
    (fakeDb as { update: typeof updGoc }).update = updGoc;
    delete process.env.FOE_DURABLE;
  });

  it("BQ-GHI-NEM-DAU the first run's failed write throws: the two after it are still handled; ONE kind 26 for the first; it is not in runIds; nothing is sent", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const [r1, r2, r3] = await baRun();
      nemKhiGhi(r1, "failed", false);
      const a0 = alerts.length;
      const g0 = otDispatchMock.mock.calls.length;
      const kq = await (await import("./foeEngine")).rehydrateInterruptedRuns();
      await cho10(200);
      expect(String(runRow(r2).status), "the scan goes on").toBe("held");
      expect(String(runRow(r3).status)).toBe("failed");
      expect(kq.runIds, "a run whose handling threw is never continued").toEqual([r2, r3]);
      expect(cuaRun(alerts.slice(a0), KIND_26, r1), "a person is told of the run the boot could not handle").toHaveLength(1);
      expect(alerts.slice(a0).filter((a) => a.kind === KIND_26 && a.entityId !== r1)).toEqual([]);
      expect(cuaRun(alerts.slice(a0), KIND_25, r2), "a run held that is not latched gets no kind 25 (B4)").toEqual([]);
      expect(goi10(g0)).toEqual([]);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("BQ-GHI-NEM-GIUA the middle run's held write throws: the first and the last are handled; ONE kind 26 for the middle; it is not in runIds", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const [r1, r2, r3] = await baRun();
      nemKhiGhi(r2, "held", false);
      const a0 = alerts.length;
      const kq = await (await import("./foeEngine")).rehydrateInterruptedRuns();
      await cho10(200);
      expect(String(runRow(r1).status)).toBe("failed");
      expect(String(runRow(r3).status), "the scan goes on past the run that threw").toBe("failed");
      expect(kq.runIds).toEqual([r1, r3]);
      expect(cuaRun(alerts.slice(a0), KIND_26, r2)).toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("BQ-NEM-SAU-GHI a latched run (HA, inside the bound) whose held write LANDED and then threw: not continued, its STOP not sent by the boot, ONE kind 26; the URGENT never says its status did not change", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      for (const [k, v] of store) v.splice(0, v.length, ...structuredClone(anh.get(k) ?? []));
      g10.__t10tuoi = { [c!]: 0 };
      g10.__t10hoi = [];
      process.env.FOE_DURABLE = "true";
      vi.resetModules();
      const eng = await import("./foeEngine");
      otDispatchMock.mockReset();
      otDispatchMock.mockImplementation(async () => ACKED);
      nemKhiGhi(c!, "held", true);
      const a0 = alerts.length;
      const kq = await eng.rehydrateInterruptedRuns();
      await cho10(400);
      expect(String(runRow(c!).status), "the write landed").toBe("held");
      expect(kq.runIds, "the run whose handling threw is not in runIds (autoResume never takes it)").toEqual([]);
      expect(g10.__t10hoi, "the gate is never reached for it").toEqual([]);
      expect(goi10(0), "its STOP is not sent by this boot").toEqual([]);
      const k26 = cuaRun(alerts.slice(a0), KIND_26, c!);
      expect(k26).toHaveLength(1);
      expect(cuaRun(alerts.slice(a0), KIND_25, c!), "no kind 25: its held write did not answer").toEqual([]);
      expect(`${k26[0]!.title} ${k26[0]!.message}`).not.toMatch(/did not change|unchanged/i);
    } finally {
      err.mockRestore();
    }
  }, 30_000);

  it("BQ-TAT-GHI-NEM FOE_DURABLE off, a LATCHED run (HA) whose held write throws before it lands: ONE kind 26, NO kind 25 (kind 25 says the run is held: only after that write answered, B5)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { runIds: [c], anh } = await dungHinhHA();
      for (const [k, v] of store) v.splice(0, v.length, ...structuredClone(anh.get(k) ?? []));
      delete process.env.FOE_DURABLE;
      vi.resetModules();
      const eng = await import("./foeEngine");
      otDispatchMock.mockReset();
      otDispatchMock.mockImplementation(async () => ACKED);
      nemKhiGhi(c!, "held", false);
      const a0 = alerts.length;
      await eng.rehydrateInterruptedRuns();
      await cho10(300);
      expect(cuaRun(alerts.slice(a0), KIND_26, c!)).toHaveLength(1);
      expect(cuaRun(alerts.slice(a0), KIND_25, c!), "never 'held' before the held write answered").toEqual([]);
      expect(String(runRow(c!).status), "the write did not land").toBe("running");
      expect(goi10(0)).toEqual([]);
    } finally {
      err.mockRestore();
    }
  }, 30_000);
});
