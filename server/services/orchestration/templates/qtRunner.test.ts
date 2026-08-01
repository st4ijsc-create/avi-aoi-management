/**
 * Doc 44 W3-B3 (G3.8) — QT-1 END-TO-END trên FOE engine THẬT, DB in-memory
 * (pattern foe.test.ts): register template → startQtRun → pump các gate nghiệp vụ
 * (handler mock ở ranh giới SERVICE — engine + runner + registry chạy thật) →
 * gate monitor chờ ngoài → resolveQtGate → completed. Kèm nhánh FAIL: bù trừ §18.2
 * chạy đảo thứ tự (cancelOrder được gọi) → run 'aborted'.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock các SERVICE nghiệp vụ (ranh giới handler — engine/runner chạy thật) ──
const svc = vi.hoisted(() => ({
  allocateOrder: vi.fn(),
  cancelOrder: vi.fn(),
  transitionOrder: vi.fn(),
  getOrderDetail: vi.fn(),
  executeLineCommand: vi.fn(),
  transitionLine: vi.fn(),
  getLineStateDetail: vi.fn(),
  getLineStages: vi.fn(),
  checkLineReadiness: vi.fn(),
}));
vi.mock("../../orders/orderLifecycleService", () => ({
  allocateOrder: svc.allocateOrder,
  cancelOrder: svc.cancelOrder,
  transitionOrder: svc.transitionOrder,
  getOrderDetail: svc.getOrderDetail,
}));
vi.mock("../../lineController/lineControllerService", () => ({
  executeLineCommand: svc.executeLineCommand,
  transitionLine: svc.transitionLine,
  getLineStateDetail: svc.getLineStateDetail,
  getLineStages: svc.getLineStages,
}));
vi.mock("../../lineController/lineReadiness", () => ({
  checkLineReadiness: svc.checkLineReadiness,
}));

// ── tiny in-memory drizzle stand-in (chains engine + loader dùng — foe.test.ts) ──
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

vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    desc: (col: any) => ({ __op: "desc", col }),
  };
});

function colName(col: any): string {
  return col?.name ?? col?.config?.name ?? String(col);
}
function applyWhere(list: Row[], cond: any): Row[] {
  if (!cond) return list;
  if (cond.__op === "eq") return list.filter((r) => r[colName(cond.col)] === cond.val);
  return list;
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
    const c: any = {
      from(t: any) {
        return makeSelect(tbl(t)).from();
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
        return Promise.resolve();
      },
    };
    return upd;
  },
};

vi.mock("../../../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb),
}));

import { registerQtTemplates } from "./registerQtTemplates";
import { QT1_REF } from "./qtTemplates";
import { startQtRun, resolveQtGate, pumpQtRun } from "./qtRunner";
import { getRun } from "../foe/foeEngine";

const ORDER_ID = 11;
const LINE_ID = 2;

function seedHappyMocks() {
  svc.allocateOrder.mockResolvedValue({
    orderId: ORDER_ID,
    allocated: true,
    state: "allocated",
    lineId: LINE_ID,
    strategy: "requested",
    transitionId: 1,
  });
  svc.getOrderDetail.mockResolvedValue({
    order: { id: ORDER_ID, allocation: { lineId: LINE_ID, factoryId: 1, workshopId: 1 } },
    transitions: [],
  });
  svc.checkLineReadiness.mockResolvedValue({ ready: true, checks: [{ name: "stations_online", passed: true }] });
  svc.executeLineCommand.mockResolvedValue({ ok: true, lineId: LINE_ID, from: "ready", to: "producing" });
  svc.transitionLine.mockResolvedValue({ ok: true, lineId: LINE_ID, from: "producing", to: "held" });
  svc.transitionOrder.mockResolvedValue({ orderId: ORDER_ID, from: "allocated", to: "running", transitionId: 2 });
  svc.cancelOrder.mockResolvedValue({ orderId: ORDER_ID, state: "failed", via: "compensation" });
}

async function register(): Promise<void> {
  const reg = await registerQtTemplates();
  expect(reg.failed).toEqual([]);
  expect(reg.registered).toHaveLength(4);
}

beforeEach(() => {
  store.clear();
  seqs.clear();
  for (const fn of Object.values(svc)) fn.mockReset();
  process.env.FOE_ENABLED = "true";
  process.env.QT_TEMPLATES_ENABLED = "true";
  delete process.env.FOE_DURABLE;
  delete process.env.FOE_SIM_GATE_REQUIRED;
  seedHappyMocks();
});

describe("registerQtTemplates — idempotent theo nội dung trên kho FOE thật", () => {
  it("lần 1 deploy 4 template; lần 2 skip cả 4 (không bump version)", async () => {
    await register();
    expect(rows("orchestration_workflows")).toHaveLength(4);
    const v1 = rows("orchestration_workflows").map((w) => w.version);

    const again = await registerQtTemplates();
    expect(again.registered).toEqual([]);
    expect(again.skipped).toHaveLength(4);
    expect(rows("orchestration_workflows").map((w) => w.version)).toEqual(v1);
  });
});

describe("QT-1 end-to-end trên engine thật (in-memory)", () => {
  it("happy path: allocate → recipe(skip honest) → readiness → line-start → monitor (chờ ngoài) → complete", async () => {
    await register();

    const res = await startQtRun(QT1_REF, { orderId: ORDER_ID, lineId: LINE_ID });
    expect(res.started).toBe(true);
    // Pump dừng ở gate chờ ngoài qt1-monitor.
    expect(res.status).toBe("waiting_external");
    expect(res.pausedStepId).toBe("qt1-monitor");

    // Các handler nghiệp vụ đã chạy đúng thứ tự với đúng tham số.
    expect(svc.allocateOrder).toHaveBeenCalledWith(ORDER_ID, expect.objectContaining({ lineId: LINE_ID }));
    expect(svc.checkLineReadiness).toHaveBeenCalledWith(LINE_ID, { requireRecipe: false });
    expect(svc.executeLineCommand).toHaveBeenCalledWith(
      LINE_ID,
      "start",
      expect.objectContaining({ activeOrderId: ORDER_ID }),
    );
    expect(svc.transitionOrder).toHaveBeenCalledWith(ORDER_ID, "running", expect.anything());

    // Run bền trong orchestration_runs, đứng ở awaiting_confirm tại monitor.
    const view = await getRun(res.runId);
    expect(view?.run.status).toBe("awaiting_confirm");
    expect(view?.run.currentStepId).toBe("qt1-monitor");
    const done = new Set(view!.steps.filter((s) => s.status === "completed").map((s) => s.stepId));
    expect([...done].sort()).toEqual(
      ["qt1-allocate", "qt1-distribute-recipe", "qt1-line-ready-check", "qt1-line-start"].sort(),
    );

    // Tín hiệu ngoài: sản xuất xong → resolve monitor → bước complete tự chạy → run completed.
    const resolved = await resolveQtGate(res.runId, { approved: true, note: "sản lượng đạt (test)" });
    expect(resolved.status).toBe("completed");
    expect(resolved.ok).toBe(true);
    expect(svc.transitionOrder).toHaveBeenCalledWith(ORDER_ID, "done", expect.anything());
    // drain tuyến best-effort sau hoàn tất
    expect(svc.executeLineCommand).toHaveBeenCalledWith(LINE_ID, "complete", expect.anything());

    const final = await getRun(res.runId);
    expect(final?.run.status).toBe("completed");
    // Không handler nào bị gọi bù trừ trên happy path.
    expect(svc.cancelOrder).not.toHaveBeenCalled();
  });

  it("line-start FAIL → bù trừ §18.2 chạy k-1..1 (cancelOrder nhả giữ chỗ) → run aborted", async () => {
    await register();
    svc.executeLineCommand.mockResolvedValue({
      ok: false,
      code: "POLICY_DENIED",
      message: "policy chặn line.command.producing",
    });

    const res = await startQtRun(QT1_REF, { orderId: ORDER_ID, lineId: LINE_ID });
    expect(res.started).toBe(true);
    expect(res.status).toBe("aborted");
    expect(res.pausedStepId).toBe("qt1-line-start");

    // §18.2: allocate đã completed trước đó → compensation cancelOrder được gọi.
    expect(svc.cancelOrder).toHaveBeenCalledTimes(1);
    expect(svc.cancelOrder.mock.calls[0][0]).toBe(ORDER_ID);
    // order chưa từng sang running (executeLineCommand fail TRƯỚC transitionOrder).
    expect(svc.transitionOrder).not.toHaveBeenCalledWith(ORDER_ID, "running", expect.anything());

    const view = await getRun(res.runId);
    expect(view?.run.status).toBe("aborted");
    const failedGate = view!.steps.find((s) => s.stepId === "qt1-line-start");
    expect(failedGate?.status).toBe("failed");
    // Lý do fail + bù trừ được persist vào gate (truy vết saga).
    expect(String(failedGate?.error ?? "") + JSON.stringify(failedGate?.result ?? {})).toMatch(/POLICY_DENIED|§18.2/);
  });

  it("từ chối gate chờ ngoài (resolveQtGate approved=false) → bù trừ rồi aborted", async () => {
    await register();
    const res = await startQtRun(QT1_REF, { orderId: ORDER_ID, lineId: LINE_ID });
    expect(res.status).toBe("waiting_external");

    const rejected = await resolveQtGate(res.runId, { approved: false, note: "hủy đơn giữa chừng (test)" });
    expect(rejected.status).toBe("aborted");
    // Bù trừ §18.2: line về held an toàn + cancelOrder.
    expect(svc.transitionLine).toHaveBeenCalledWith(LINE_ID, "held", expect.anything());
    expect(svc.cancelOrder).toHaveBeenCalledTimes(1);

    const view = await getRun(res.runId);
    expect(view?.run.status).toBe("aborted");
  });

  it("pumpQtRun idempotent: gọi lại trên run đang chờ ngoài không side-effect", async () => {
    await register();
    const res = await startQtRun(QT1_REF, { orderId: ORDER_ID, lineId: LINE_ID });
    expect(res.status).toBe("waiting_external");
    const callsBefore = svc.allocateOrder.mock.calls.length;

    const again = await pumpQtRun(res.runId);
    expect(again.status).toBe("waiting_external");
    expect(again.pausedStepId).toBe("qt1-monitor");
    expect(svc.allocateOrder.mock.calls.length).toBe(callsBefore); // không chạy lại handler đã xong
  });

  it("FOE_ENABLED off → startQtRun honest disabled", async () => {
    delete process.env.FOE_ENABLED;
    const res = await startQtRun(QT1_REF, { orderId: ORDER_ID });
    expect(res.started).toBe(false);
    expect(res.status).toBe("disabled");
  });
});
