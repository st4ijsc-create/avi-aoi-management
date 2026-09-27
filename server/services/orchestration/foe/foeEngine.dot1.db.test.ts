/**
 * doc 80 Đợt 1 Task 9 (§12 "Còn mở") — FOE: gate CHƯA GHIM BƯỚC + từ chối có bù trừ.
 *
 *   (1) `resumeRun` đọc run (gate g1), kiểm quyền duyệt THEO g1, rồi CAS chỉ trên `status`. Nếu
 *       giữa lúc đọc và CAS, run đã được người khác duyệt g1 và dừng ở g2 (vẫn 'awaiting_confirm'),
 *       CAS vẫn thắng ⇒ người duyệt g1 vô tình duyệt g2 (bước họ chưa xem, vai trò chưa kiểm).
 *       Vá: CAS ghim `currentStepId` = bước đã đọc; caller gửi `expectedStepId` (bước màn hình
 *       đang hiện) ⇒ lệch ⇒ CONFLICT (reason `runGateChanged`).
 *   (2) Từ chối có bù trừ (qtRunner): bù trừ phải chạy SAU khi giành được quyền từ chối (CAS).
 *       Vá: `resumeRun(..., { compensate })` — CAS 'awaiting_confirm|held' → 'compensating' (ghim
 *       bước), chạy compensate(), rồi CAS 'compensating' → 'aborted'. Thua CAS ⇒ compensate KHÔNG
 *       chạy.
 *
 * CSDL THẬT (`_test`) — race cưỡng bức: giao dịch NGOÀI giữ khoá hàng orchestration_runs, đẩy
 * run sang gate kế (hoặc nhận nó) rồi commit trong lúc lượt resume/reject đang xếp hàng sau khoá.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

import { deployWorkflow, startRun, resumeRun, getRun } from "./foeEngine";
import type { WorkflowDefinition } from "./workflowModel";

const DB_URL = process.env.DATABASE_URL;
const DAU = `t9foe-${Date.now().toString(36)}`;
const ENG = { id: 990_700_001, role: "engineer", name: "t9-eng" };
const SUP_A = { id: 990_700_002, role: "supervisor", name: "t9-sup-a" };
const SUP_B = { id: 990_700_003, role: "supervisor", name: "t9-sup-b" };

const TWO_GATES: WorkflowDefinition = {
  ref: `${DAU}-two-gates`,
  name: "T9 two gates",
  steps: [
    { id: "g1", type: "hitl_gate", prompt: "Duyệt bước 1?" },
    { id: "g2", type: "hitl_gate", prompt: "Duyệt bước 2?" },
  ],
};

let sql: ReturnType<typeof postgres>;
const runIds: number[] = [];

function codeOf(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}
function reasonOf(e: unknown): unknown {
  return (e as { cause?: { appParams?: Record<string, unknown> } } | null)?.cause?.appParams?.reason;
}
async function runRow(id: number) {
  const r = await sql`SELECT status, "currentStepId", error FROM orchestration_runs WHERE id = ${id}`;
  return r[0] as { status: string; currentStepId: string | null; error: string | null };
}
async function stepStatus(runId: number, stepId: string): Promise<string | null> {
  const r = await sql`SELECT status FROM orchestration_run_steps WHERE "runId" = ${runId} AND "stepId" = ${stepId}`;
  return (r[0] as { status?: string } | undefined)?.status ?? null;
}
async function startAtG1(): Promise<number> {
  const started = await startRun(TWO_GATES.ref, {}, ENG);
  expect(started.status).toBe("awaiting_confirm");
  runIds.push(started.runId!);
  expect((await runRow(started.runId!)).currentStepId).toBe("g1");
  return started.runId!;
}

/** Giao dịch ngoài: khoá hàng run, chạy `mutate`, rồi GIỮ khoá cho tới khi được thả. */
async function holdRunRow(runId: number, mutate: (tx: postgres.TransactionSql) => Promise<unknown>) {
  const ext = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const lockedP = new Promise<void>((r) => (locked = r));
  const holder = ext.begin(async (tx) => {
    await tx`SELECT id FROM orchestration_runs WHERE id = ${runId} FOR UPDATE`;
    await mutate(tx);
    locked();
    await gate;
  });
  await lockedP;
  return {
    async releaseAndEnd() {
      release();
      await holder;
      await ext.end();
    },
  };
}

describe.skipIf(!DB_URL)("FOE Task 9 — gate ghim bước + từ chối có bù trừ (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    process.env.FOE_ENABLED = "true";
    delete process.env.FOE_SIM_GATE_REQUIRED;
    delete process.env.FOE_DURABLE;
    const dep = await deployWorkflow(TWO_GATES, ENG);
    expect(dep.ok, JSON.stringify(dep)).toBe(true);
  });

  afterAll(async () => {
    if (!sql) return;
    if (runIds.length) {
      await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ANY(${runIds})`;
      await sql`DELETE FROM orchestration_runs WHERE id = ANY(${runIds})`;
    }
    await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" IN (SELECT id FROM orchestration_workflows WHERE ref LIKE ${DAU + "%"})`;
    await sql`DELETE FROM orchestration_workflows WHERE ref LIKE ${DAU + "%"}`;
    await sql.end({ timeout: 5 });
  });

  // ── (1) gate ghim bước ────────────────────────────────────────────────────────
  it("★★★ người duyệt CŨ (đã xem g1) bấm duyệt sau khi g1 đã được duyệt và run dừng ở g2 ⇒ CONFLICT, g2 KHÔNG bị duyệt", async () => {
    const runId = await startAtG1();
    const a = await resumeRun(runId, { approved: true, expectedStepId: "g1" }, SUP_A);
    expect(a.status).toBe("awaiting_confirm");
    expect((await runRow(runId)).currentStepId).toBe("g2");

    const err = await resumeRun(runId, { approved: true, expectedStepId: "g1" }, SUP_B).catch((e) => e);
    expect(codeOf(err)).toBe("CONFLICT");
    expect(reasonOf(err)).toBe("runGateChanged");
    const row = await runRow(runId);
    expect(row.status).toBe("awaiting_confirm");
    expect(row.currentStepId).toBe("g2");
    expect(await stepStatus(runId, "g2")).not.toBe("completed");
  });

  it("người duyệt CŨ bấm TỪ CHỐI sau khi run đã sang g2 ⇒ CONFLICT, run KHÔNG bị huỷ", async () => {
    const runId = await startAtG1();
    await resumeRun(runId, { approved: true, expectedStepId: "g1" }, SUP_A);
    const err = await resumeRun(runId, { approved: false, note: "khong", expectedStepId: "g1" }, SUP_B).catch((e) => e);
    expect(codeOf(err)).toBe("CONFLICT");
    expect((await runRow(runId)).status).toBe("awaiting_confirm");
  });

  it("duyệt đúng bước đang hiển thị ⇒ qua bình thường (g1 rồi g2 ⇒ completed)", async () => {
    const runId = await startAtG1();
    await resumeRun(runId, { approved: true, expectedStepId: "g1" }, SUP_A);
    const r2 = await resumeRun(runId, { approved: true, expectedStepId: "g2" }, SUP_B);
    expect(r2.status).toBe("completed");
  });

  it("★★★ race CƯỠNG BỨC: resume đọc g1 rồi CAS xếp hàng sau khoá; giao dịch ngoài đẩy run sang g2 (vẫn awaiting_confirm) rồi commit ⇒ CAS ghim bước ⇒ CONFLICT, g2 KHÔNG bị duyệt", async () => {
    const runId = await startAtG1();
    const h = await holdRunRow(runId, (tx) => tx`UPDATE orchestration_runs SET "currentStepId" = 'g2', "updatedAt" = now() WHERE id = ${runId}`);
    // Lượt resume đọc hàng (MVCC: vẫn thấy g1, không bị khoá chặn), kiểm quyền cho g1, rồi CAS chờ khoá.
    const p = resumeRun(runId, { approved: true, expectedStepId: "g1" }, SUP_B).catch((e) => e);
    await new Promise((r) => setTimeout(r, 400));
    await h.releaseAndEnd();
    const res = await p;
    expect(codeOf(res), `CAS lọt: ${JSON.stringify(res)}`).toBe("CONFLICT");
    const row = await runRow(runId);
    expect(row.status).toBe("awaiting_confirm");
    expect(row.currentStepId).toBe("g2");
    expect(await stepStatus(runId, "g2")).not.toBe("completed");
  });

  // ── (2) từ chối có bù trừ: CAS TRƯỚC, bù trừ SAU ──────────────────────────────
  it("★★★ race CƯỠNG BỨC: từ chối có bù trừ thua CAS (giao dịch ngoài đã nhận run) ⇒ compensate KHÔNG chạy, CONFLICT", async () => {
    const runId = await startAtG1();
    const compensate = vi.fn(async () => "bù trừ đã chạy");
    const h = await holdRunRow(runId, (tx) => tx`UPDATE orchestration_runs SET status = 'running', "updatedAt" = now() WHERE id = ${runId}`);
    const p = resumeRun(runId, { approved: false, note: "huy", expectedStepId: "g1" }, SUP_B, { compensate }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 400));
    expect(compensate).not.toHaveBeenCalled(); // chưa giành được quyền ⇒ chưa được bù
    await h.releaseAndEnd();
    const res = await p;
    expect(codeOf(res)).toBe("CONFLICT");
    expect(compensate).not.toHaveBeenCalled();
    expect((await runRow(runId)).status).toBe("running");
  });

  it("từ chối có bù trừ thắng CAS ⇒ run ở 'compensating' TRONG lúc bù, cuối cùng 'aborted' + lý do kèm ghi chú bù trừ, gate 'failed'", async () => {
    const runId = await startAtG1();
    let statusDuringCompensation = "";
    const compensate = vi.fn(async () => {
      statusDuringCompensation = (await runRow(runId)).status;
      return "huy · Bù trừ §18.2: b1 bù OK";
    });
    const res = await resumeRun(runId, { approved: false, note: "huy", expectedStepId: "g1" }, SUP_B, { compensate });
    expect(res.status).toBe("aborted");
    expect(compensate).toHaveBeenCalledTimes(1);
    expect(statusDuringCompensation).toBe("compensating");
    const row = await runRow(runId);
    expect(row.status).toBe("aborted");
    expect(row.error).toContain("Bù trừ §18.2: b1 bù OK");
    expect(await stepStatus(runId, "g1")).toBe("failed");
  });

  it("từ chối KHÔNG kèm bù trừ giữ nguyên hành vi Đợt 0 (claim thẳng 'aborted')", async () => {
    const runId = await startAtG1();
    const res = await resumeRun(runId, { approved: false, note: "khong" }, SUP_B);
    expect(res.status).toBe("aborted");
    const row = await runRow(runId);
    expect(row.status).toBe("aborted");
    expect(row.error).toContain("Reason: khong");
    expect((await getRun(runId))?.steps.find((s) => s.stepId === "g1")?.status).toBe("failed");
  });
});
