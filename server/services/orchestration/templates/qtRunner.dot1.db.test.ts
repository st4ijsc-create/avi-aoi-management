/**
 * doc 80 Đợt 1 Task 9 (§12 "Còn mở") — qtRunner trên CSDL THẬT (`_test`):
 *
 *   (1) Nhánh TỪ CHỐI chạy bù trừ §18.2 TRƯỚC khi giành được quyền từ chối (CAS) ⇒ lượt từ chối
 *       thua race (người/lượt khác đã nhận gate) vẫn đã nhả giữ chỗ đơn (cancelOrder), đưa tuyến
 *       về held… trên một run đang CHẠY TIẾP. Vá: bù trừ nằm trong `resumeRun(..., {compensate})`
 *       — chỉ chạy sau khi CAS 'awaiting_confirm' → 'compensating' thắng.
 *   (2) Pump duyệt gate auto X SAU khi handler của X chạy, nhưng không ghim bước: nếu trong lúc
 *       handler chạy, gate X đã được lượt khác duyệt và run dừng ở gate Y, lượt duyệt của pump rơi
 *       vào Y ⇒ Y "OK" mà handler Y (vd khởi động tuyến) KHÔNG BAO GIỜ chạy. Vá: pump gửi
 *       `expectedStepId: X` ⇒ CONFLICT ⇒ đọc lại ⇒ chạy handler Y đúng một lần.
 *
 * Handler nghiệp vụ mock ở ranh giới SERVICE (khuôn qtRunner.test.ts) — engine FOE, runner,
 * registry và CAS chạy thật trên Postgres. Race (1) cưỡng bức: giao dịch NGOÀI giữ khoá hàng run
 * và nhận nó ('running') trong lúc lượt từ chối xếp hàng sau khoá.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

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

import { registerQtTemplates } from "./registerQtTemplates";
import { QT1_REF } from "./qtTemplates";
import { startQtRun, resolveQtGate } from "./qtRunner";
import { waitForLockWaiters, backendPid } from "../../../db/lockWait.testkit";

const DB_URL = process.env.DATABASE_URL;
const ORDER_ID = 990_811;
const LINE_ID = 990_812;

let sql: ReturnType<typeof postgres>;
const runIds: number[] = [];

function seedHappyMocks() {
  svc.allocateOrder.mockResolvedValue({ orderId: ORDER_ID, allocated: true, state: "allocated", lineId: LINE_ID, strategy: "requested", transitionId: 1 });
  svc.getOrderDetail.mockResolvedValue({ order: { id: ORDER_ID, allocation: { lineId: LINE_ID, factoryId: 1, workshopId: 1 } }, transitions: [] });
  svc.checkLineReadiness.mockResolvedValue({ ready: true, checks: [{ name: "stations_online", passed: true }] });
  svc.executeLineCommand.mockResolvedValue({ ok: true, lineId: LINE_ID, from: "ready", to: "producing" });
  svc.transitionLine.mockResolvedValue({ ok: true, lineId: LINE_ID, from: "producing", to: "held" });
  svc.transitionOrder.mockResolvedValue({ orderId: ORDER_ID, from: "allocated", to: "running", transitionId: 2 });
  svc.cancelOrder.mockResolvedValue({ orderId: ORDER_ID, state: "failed", via: "compensation" });
}

async function runRow(id: number) {
  const r = await sql`SELECT status, "currentStepId", error FROM orchestration_runs WHERE id = ${id}`;
  return r[0] as { status: string; currentStepId: string | null; error: string | null };
}

describe.skipIf(!DB_URL)("qtRunner Task 9 — bù trừ sau CAS + pump ghim bước (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    process.env.FOE_ENABLED = "true";
    process.env.QT_TEMPLATES_ENABLED = "true";
    delete process.env.FOE_DURABLE;
    delete process.env.FOE_SIM_GATE_REQUIRED;
    // Idempotent theo nội dung — _test có thể đã có 4 template (không xoá khi dọn).
    const reg = await registerQtTemplates();
    expect(reg.failed).toEqual([]);
  });

  beforeEach(() => {
    for (const fn of Object.values(svc)) fn.mockReset();
    seedHappyMocks();
  });

  afterAll(async () => {
    if (!sql) return;
    if (runIds.length) {
      await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ANY(${runIds})`;
      await sql`DELETE FROM orchestration_runs WHERE id = ANY(${runIds})`;
    }
    await sql.end({ timeout: 5 });
  });

  it("★★★ race CƯỠNG BỨC: resolveQtGate(TỪ CHỐI) thua CAS (lượt khác đã nhận run) ⇒ KHÔNG bù trừ (cancelOrder/transitionLine 0 lần), không nói 'aborted'", async () => {
    const res = await startQtRun(QT1_REF, { orderId: ORDER_ID, lineId: LINE_ID });
    runIds.push(res.runId);
    expect(res.status).toBe("waiting_external");
    expect(res.pausedStepId).toBe("qt1-monitor");

    const ext = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const lockedP = new Promise<void>((r) => (locked = r));
      let holderPid = 0;
      const holder = ext.begin(async (tx) => {
        holderPid = await backendPid(tx);
        await tx`SELECT id FROM orchestration_runs WHERE id = ${res.runId} FOR UPDATE`;
        // "người khác" đã duyệt gate monitor và đang drive run
        await tx`UPDATE orchestration_runs SET status = 'running', "updatedAt" = now() WHERE id = ${res.runId}`;
        locked();
        await gate;
      });
      await lockedP;
      const p = resolveQtGate(res.runId, { approved: false, note: "huy don (test race)" });
      // fix round 1 — chờ tới khi lượt từ chối THẬT SỰ xếp hàng ở CAS sau khoá (không ngủ cố định).
      const queued = await waitForLockWaiters(sql, { holderPid });
      const compensatedBeforeClaim = svc.cancelOrder.mock.calls.length;
      release();
      await holder;
      const r = await p;
      expect(queued).toBeGreaterThanOrEqual(1);
      expect(compensatedBeforeClaim, "bù trừ chạy TRƯỚC khi giành quyền từ chối").toBe(0);
      expect(r.ok).toBe(false);
      expect(r.status).toBe("running");
      expect(svc.cancelOrder).not.toHaveBeenCalled();
      expect(svc.transitionLine).not.toHaveBeenCalled();
    } finally {
      await ext.end();
    }
  });

  it("từ chối THẮNG CAS ⇒ bù trừ chạy (cancelOrder 1 lần), run 'aborted' + lý do mang ghi chú bù trừ", async () => {
    const res = await startQtRun(QT1_REF, { orderId: ORDER_ID, lineId: LINE_ID });
    runIds.push(res.runId);
    expect(res.status).toBe("waiting_external");
    const r = await resolveQtGate(res.runId, { approved: false, note: "huy don (test)" });
    expect(r.status).toBe("aborted");
    expect(svc.cancelOrder).toHaveBeenCalledTimes(1);
    const row = await runRow(res.runId);
    expect(row.status).toBe("aborted");
    expect(row.error).toContain("huy don (test)");
    expect(row.error).toContain("Bù trừ §18.2");
    expect(r.notes.some((n) => n.startsWith("bù trừ:"))).toBe(true);
  });

  it("★★★ pump duyệt gate X khi run đã sang gate Y (lượt khác duyệt X lúc handler X đang chạy) ⇒ CONFLICT, KHÔNG duyệt nhầm Y; handler Y chạy ĐÚNG một lần", async () => {
    let readinessEntered!: () => void;
    const entered = new Promise<void>((r) => (readinessEntered = r));
    let finishReadiness!: () => void;
    const readinessGate = new Promise<void>((r) => (finishReadiness = r));
    svc.checkLineReadiness.mockImplementation(async () => {
      readinessEntered();
      await readinessGate;
      return { ready: true, checks: [{ name: "stations_online", passed: true }] };
    });

    const pStart = startQtRun(QT1_REF, { orderId: ORDER_ID, lineId: LINE_ID });
    await entered; // pump đang chạy handler của qt1-line-ready-check
    const [live] = await sql`SELECT id FROM orchestration_runs WHERE "currentStepId" = 'qt1-line-ready-check' AND status = 'awaiting_confirm' AND "workflowRef" = ${QT1_REF} ORDER BY id DESC LIMIT 1`;
    const runId = Number((live as { id: number }).id);
    runIds.push(runId);
    // "lượt khác" đã duyệt ready-check: gate completed, run dừng ở gate kế (line-start).
    await sql`
      INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson", "finishedAt")
      VALUES (${runId}, 'qt1-line-ready-check', 'hitl_gate', 'completed', 0, ${sql.json({ approved: true, note: "lượt khác" })}, now())
      ON CONFLICT ("runId", "stepId") DO UPDATE SET status = 'completed'`;
    await sql`UPDATE orchestration_runs SET "currentStepId" = 'qt1-line-start', "updatedAt" = now() WHERE id = ${runId}`;
    finishReadiness();

    const res = await pStart;
    expect(res.runId).toBe(runId);
    // handler line-start (khởi động tuyến THẬT) phải chạy đúng một lần — không bị "duyệt hộ".
    expect(svc.executeLineCommand).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("waiting_external");
    expect(res.pausedStepId).toBe("qt1-monitor");
    const [ls] = await sql`SELECT "resultJson" FROM orchestration_run_steps WHERE "runId" = ${runId} AND "stepId" = 'qt1-line-start'`;
    expect(JSON.stringify((ls as { resultJson: unknown }).resultJson)).not.toContain("readiness");
  });
});
