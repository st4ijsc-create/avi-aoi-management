/**
 * ★ Đợt 9 (2026-10-21, mig 0406) — `ai_gateway_metrics.requestId` · `luotPhu`: lượt PHỤ của một yêu cầu (lượt sửa của vòng
 * kiểm biên dịch ST) là MỘT hàng đo riêng, CÙNG requestId với hàng chính. Đo HÀNG THẬT đi vào `db.insert(...).values(...)`
 * qua `flush()` (khuôn `aiGateway.b7.test.ts`).
 *
 * ĐỘT BIẾN PHẢI BẮT: recordPhu idempotent như record (lượt phụ thứ 2 mất) · recordPhu ghi audit · luotPhu/requestId không tới
 * INSERT · hàng chính mang luotPhu · nhãn sai hình dạng đi thẳng xuống (CHECK 0406 làm hỏng CẢ lô).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";

const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn((table: unknown) => ({ values: (rows: unknown) => insertValuesMock(rows, table) }));

vi.mock("./aiGgufEngine", () => ({
  generateText: vi.fn(),
  generateJSON: vi.fn(),
  describeImage: vi.fn(),
  generateTextStream: vi.fn(),
  ggufModelFileExists: vi.fn(() => false),
}));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

beforeEach(() => {
  getDbMock.mockReset();
  insertValuesMock.mockClear();
  getDbMock.mockResolvedValue({ insert: insertMock });
});

async function chay(ghi: (plan: Awaited<ReturnType<typeof import("./aiGateway")["planInference"]>>) => void) {
  vi.resetModules();
  const gateway = await import("./aiGateway");
  const audit = await import("./ai/aiLlmAudit");
  const plan = await gateway.planInference({ task: "code", text: "viết FB", userId: 7 } as never);
  ghi(plan);
  await gateway.flush();
  await audit.flushLlmAudit();
  gateway.stopGatewayFlushTimer();
  audit.stopLlmAuditFlushTimer();
  const theoBang = (ten: string) =>
    insertValuesMock.mock.calls
      .filter((c) => getTableName((c as unknown[])[1] as never) === ten)
      .flatMap((c) => (c as unknown[])[0] as Array<Record<string, unknown>>);
  return { doDem: theoBang("ai_gateway_metrics"), audit: theoBang("ai_llm_audit") };
}

describe("lượt phụ — hàng đo riêng, cùng requestId", () => {
  it("★★★ một lượt chính + HAI lượt sửa ⇒ ba hàng; chính luotPhu NULL; cả ba cùng requestId; audit CHỈ một hàng", async () => {
    const { doDem, audit } = await chay((p) => {
      p.recordPhu!({ luotPhu: "sua-bien-dich-st", requestId: "chatcmpl-1", tokensIn: 10, tokensOut: 20, latencyMs: 30, outcome: "ok" });
      p.recordPhu!({ luotPhu: "sua-bien-dich-st", requestId: "chatcmpl-1", latencyMs: 5, outcome: "error" });
      p.record({ tokensIn: 1, tokensOut: 2, latencyMs: 3, outcome: "ok", requestId: "chatcmpl-1" });
    });
    expect(doDem.map((r) => [r.luotPhu, r.requestId, r.outcome, r.tokensOut])).toEqual([
      ["sua-bien-dich-st", "chatcmpl-1", "ok", 20],
      ["sua-bien-dich-st", "chatcmpl-1", "error", 0],
      [null, "chatcmpl-1", "ok", 2],
    ]);
    expect(audit).toHaveLength(1);
  });

  it("vắng requestId ⇒ NULL (mọi đường cũ không đổi)", async () => {
    const { doDem } = await chay((p) => p.record({ tokensIn: 1, tokensOut: 2, latencyMs: 3, outcome: "ok" }));
    expect(doDem).toHaveLength(1);
    expect(doDem[0].requestId).toBeNull();
    expect(doDem[0].luotPhu).toBeNull();
  });

  it("nhãn lượt phụ sai hình dạng ⇒ chuẩn hoá về ^[a-z0-9-]{1,32}$ (không để CHECK 0406 làm hỏng cả lô xả)", async () => {
    const { doDem } = await chay((p) => p.recordPhu!({ luotPhu: "Sửa Biên_dịch".padEnd(40, "x"), latencyMs: 1, outcome: "ok" }));
    expect(String(doDem[0].luotPhu)).toMatch(/^[a-z0-9-]{1,32}$/);
  });
});
