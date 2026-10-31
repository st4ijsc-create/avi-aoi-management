/**
 * SCADA R1b-2b-2a T3E (backlog 90, AN TOÀN) — FOE KHÔNG gửi lại lệnh mà thiết bị áp MỘT PHẦN (bước không phải STOP); STOP vẫn gửi lại.
 *
 * Engine THẬT + bản thay drizzle trong bộ nhớ (khuôn foe.test.ts / foeKhongGuiLaiKhiKhongRo.r1b2b2.test.ts). Chỉ `dispatch` của commandDispatcher
 * được thay — bằng một "dispatcher có thiết bị": mỗi lần gọi ghi một lô HAI item thật qua device stage THẬT (`executeOtDeviceWrite`) xuống
 * nodes7 0.3.18 THẬT trên `__s7commSim` (ĐẾM PDU ghi = số lần thiết bị bị ghi), rồi gộp kết cục bằng CÙNG luật của dispatcher (`ketCucLo`):
 *   `writeMixed` = item đầu 0xFF (áp), item kia 0x0A (không áp) ⇒ failed + reason MOT_PHAN + motPhan.
 * Mặt tiền OT THẬT (`equipmentRegistry` → OtEquipmentAdapter.sendCommand) chuyển `motPhan` vào `detail` cho engine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { otDispatchMock, robotDispatchMock } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(),
  robotDispatchMock: vi.fn(async () => ({ ok: true, status: "simulated" as const, jobId: 7 })),
}));
// the REAL stop-type predicate (the engine classifies a STOP with it); only dispatch is replaced
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, dispatch: otDispatchMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));

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

import {
  validateWorkflow,
  evaluateCondition,
  type WorkflowDefinition,
} from "./workflowModel";
import {
  deployWorkflow,
  rollbackWorkflow,
  startRun,
  resumeRun,
  getRun,
  rehydrateInterruptedRuns,
} from "./foeEngine";

const USER = { id: 42, role: "admin", name: "tester" };
/**
 * doc 81 Đợt 4 Task A5 (QĐ-4a option (a)) — an OT/robot step now runs only after an earlier hitl_gate of the run
 * approved by someone OTHER than the run owner (USER). Tests about engine mechanics put a gate `gate0` first and have
 * APPROVER approve it; the gate rule itself is tested in foeGateApproval.dot4.test.ts.
 */
const APPROVER = { id: 77, role: "admin", name: "approver" };
function withGate0(def: WorkflowDefinition): WorkflowDefinition {
  return { ...def, steps: [{ id: "gate0", type: "hitl_gate", prompt: "Approve the run" }, ...def.steps] };
}
/** Start as USER, then APPROVER approves gate0 (the run pauses there first). */
async function startApproved(ref: string, params: Record<string, unknown> = {}) {
  const r = await startRun(ref, params, USER);
  expect(r.status).toBe("awaiting_confirm");
  return resumeRun(r.runId!, { approved: true }, APPROVER);
}

// Seed machines: id 1 = AUTOMATION (ot-opcua, supports start/stop), id 2 = AOI (vision).
function seedMachines() {
  store.set("machines", [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "AOI", capabilities: null, code: "M2", name: "Aoi-1", operationStatus: "stopped", stationId: 1 },
  ]);
  // doc 81 Đợt 4 fix round 1 (R-4-d): an OT step writes through the adapter BOUND to its machine (no more adapterId = machineId).
  store.set("device_adapters", [{ id: 501, machineId: 1, isEnabled: true }]);
}

function reset() {
  store.clear();
  seqs.clear();
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = ""; // dry-run (the existing dispatcher is mocked anyway)
  seedMachines();
}

import { startS7commSim, type S7commSim, type SimFault } from "../../ot/drivers/__s7commSim";
import { S7Driver } from "../../ot/drivers/s7Driver";
import { executeOtDeviceWrite } from "../../ot/otDeviceWrite";
import { ketCucLo, MA_MOT_PHAN, moTaMotPhan } from "../../ot/motPhan";
import { FOE_OUTCOME_PARTIAL, FOE_OUTCOME_UNKNOWN } from "./foeEngine";

// ── "dispatcher có thiết bị": lô HAI item thật qua device stage + nodes7 + sim ──
const LO = [
  { tagKey: "a", address: "DB1,INT0", value: 5, dataType: "int" as const },
  { tagKey: "b", address: "DB1,INT2", value: 7, dataType: "int" as const },
];
let sim: S7commSim | null = null;
let s7: S7Driver | null = null;
/** lệnh nào đi xuống thiết bị (còn lại: mô phỏng ok — vd bù trừ "stop" ở ca không phải STOP) */
let lenhThietBi = new Set<string>();
const soPduGhi = () => (sim ? sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length : 0);

async function thietBi(fault: SimFault, lenh: string[]) {
  sim = await startS7commSim();
  sim.setFault(fault);
  s7 = new S7Driver();
  await s7.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1500 });
  lenhThietBi = new Set(lenh);
  otDispatchMock.mockImplementation(async (input: { commandType: string; adapterId: number; idempotencyKey: string }) => {
    if (!lenhThietBi.has(input.commandType)) return { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] };
    const ex = await executeOtDeviceWrite({
      input: { adapterId: input.adapterId, machineId: 1, commandType: input.commandType, idempotencyKey: input.idempotencyKey, writes: LO.map((w) => ({ tagKey: w.tagKey, value: w.value })) } as never,
      driver: s7!,
      resolved: LO.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
      driverWrites: LO.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType })),
      timeoutMs: 3000,
      stopTyped: input.commandType === "stop",
      ledger: { intentIds: [1, 2], confirmedBy: 1 },
    });
    const results = ex.outcomes.map((o) => ({ tagKey: LO[o.idx]!.tagKey, ok: o.ok, status: o.status, ...(o.errorText ? { error: o.errorText } : {}) }));
    const k = ketCucLo(results, ex.timedOut);
    return {
      ok: k.ok,
      simulated: false,
      status: k.status,
      results,
      commandLogIds: [],
      ...(k.motPhan ? { reason: MA_MOT_PHAN, motPhan: k.motPhan, message: `Command "${input.commandType}": ${moTaMotPhan(k.motPhan)}.` } : {}),
    };
  });
}

beforeEach(() => {
  reset();
  otDispatchMock.mockReset();
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
  delete process.env.OT_READBACK_ENABLED;
});
afterEach(async () => {
  await s7?.disconnect().catch(() => undefined);
  await sim?.close().catch(() => undefined);
  s7 = null;
  sim = null;
});

function def(ref: string, command: string, withComp: boolean): WorkflowDefinition {
  return {
    ref,
    name: ref,
    steps: [
      {
        id: "main",
        type: "command",
        machineId: 1,
        command,
        maxAttempts: 2, // 3 attempts in all
        ...(withComp ? { compensation: { id: "undo", type: "command", machineId: 1, command: "stop" } } : {}),
      },
    ],
  };
}
async function run(d: WorkflowDefinition) {
  const dep = await deployWorkflow(withGate0(d), USER);
  expect(dep.ok).toBe(true);
  return startApproved(d.ref);
}
const goi = (cmd: string) => otDispatchMock.mock.calls.filter((c: any) => c[0].commandType === cmd).length;

describe("T3E — FOE không gửi lại lô áp MỘT PHẦN", () => {
  it("★ (2) bước không phải STOP, maxAttempts 2 (3 lần), lô trộn 0xFF+0x0A ⇒ dispatcher ĐÚNG 1 lần, MỘT PDU ghi (không gói thứ hai), failed FOE_OUTCOME_PARTIAL kèm danh sách; bù trừ 1 lần", async () => {
    await thietBi("writeMixed", ["start"]);
    const res = await run(def("t3e-2", "start", true));
    expect(res.status).toBe("failed");
    expect(goi("start")).toBe(1);
    expect(soPduGhi()).toBe(1);
    expect(goi("stop")).toBe(1); // compensation ran exactly once
    const view = await getRun(res.runId!);
    const main = view?.steps.find((s) => s.stepId === "main");
    expect(main?.status).toBe("failed");
    expect(String(main?.error)).toMatch(new RegExp(`^${FOE_OUTCOME_PARTIAL}: `));
    expect(String(main?.error)).toContain("applied: a; not applied: b");
    expect(String(main?.error)).not.toContain(FOE_OUTCOME_UNKNOWN);
    // the step's result row keeps the structured lists (Studio / scada-ui)
    expect((main?.result as any)?.detail?.motPhan).toEqual({ daAp: ["a"], khongAp: ["b"] });
  }, 30_000);

  it("(4) đối chứng STOP: bước STOP với lô trộn ⇒ VẪN thử lại tới maxAttempts (3 lần, 3 PDU) — dừng là idempotent", async () => {
    await thietBi("writeMixed", ["stop"]);
    const res = await run(def("t3e-4", "stop", false));
    expect(res.status).toBe("failed");
    expect(goi("stop")).toBe(3);
    expect(soPduGhi()).toBe(3);
    const main = (await getRun(res.runId!))?.steps.find((s) => s.stepId === "main");
    expect(String(main?.error)).not.toContain(FOE_OUTCOME_PARTIAL);
  }, 30_000);

  it("(5a) đối chứng: lô toàn 0x0A (không item nào áp) ⇒ failed thường, FOE thử lại như cũ (3 lần, 3 PDU)", async () => {
    await thietBi("writeError", ["start"]);
    const res = await run(def("t3e-5a", "start", false));
    expect(res.status).toBe("failed");
    expect(goi("start")).toBe(3);
    expect(soPduGhi()).toBe(3);
    const main = (await getRun(res.runId!))?.steps.find((s) => s.stepId === "main");
    expect(String(main?.error)).not.toContain(FOE_OUTCOME_PARTIAL);
  }, 30_000);

  it("(5b) đối chứng: lô toàn 0xFF ⇒ ok, một lần", async () => {
    await thietBi(null, ["start"]);
    const res = await run(def("t3e-5b", "start", false));
    expect(res.status).toBe("completed");
    expect(goi("start")).toBe(1);
    expect(soPduGhi()).toBe(1);
  }, 30_000);
});
