/**
 * ★ Đợt 12 H0.1 (2026-10-31, mig 0445) — `ai_gateway_metrics.cacheTokens` · `promptEvalTokens`: token prompt tái dùng từ prefix-cache /
 * xử lý lại. Đo HÀNG THẬT đi vào `db.insert(...).values(...)` qua `flush()` (khuôn `aiGateway.luotPhu.test.ts`).
 * ĐỘT BIẾN PHẢI BẮT: hai cột không tới INSERT · vắng ⇒ 0 (không biết ≠ 0) · số âm / không hữu hạn đi thẳng xuống (CHECK 0445 làm hỏng
 * CẢ lô xả) · ghiLuotNgoaiCong (đường agent khi cờ vai trò tắt) bỏ rơi hai số.
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

type Gw = typeof import("./aiGateway");

async function chay(ghi: (gw: Gw, plan: Awaited<ReturnType<Gw["planInference"]>>) => void) {
  vi.resetModules();
  const gateway = await import("./aiGateway");
  const audit = await import("./ai/aiLlmAudit");
  const plan = await gateway.planInference({ task: "code", text: "viết FB", userId: 7 } as never);
  ghi(gateway, plan);
  await gateway.flush();
  await audit.flushLlmAudit();
  gateway.stopGatewayFlushTimer();
  audit.stopLlmAuditFlushTimer();
  return insertValuesMock.mock.calls
    .filter((c) => getTableName((c as unknown[])[1] as never) === "ai_gateway_metrics")
    .flatMap((c) => (c as unknown[])[0] as Array<Record<string, unknown>>);
}

describe("H0.1 — cacheTokens / promptEvalTokens xuống INSERT", () => {
  it("★ recordPhu (agent-luot) + record ⇒ hai cột đúng; vắng ⇒ NULL", async () => {
    const hang = await chay((_gw, p) => {
      p.recordPhu!({ luotPhu: "agent-luot", requestId: "r1", tokensIn: 6554, cacheTokens: 6000, promptEvalTokens: 554, latencyMs: 1, outcome: "ok" });
      p.record({ tokensIn: 1, tokensOut: 2, latencyMs: 3, outcome: "ok", requestId: "r1" });
    });
    expect(hang.map((r) => [r.luotPhu, r.tokensIn, r.cacheTokens, r.promptEvalTokens])).toEqual([
      ["agent-luot", 6554, 6000, 554],
      [null, 1, null, null],
    ]);
  });

  it("0 là số đo (cache trượt) — giữ 0; âm / NaN / Infinity ⇒ NULL; số lẻ ⇒ phần nguyên", async () => {
    const hang = await chay((_gw, p) => {
      p.recordPhu!({ luotPhu: "agent-luot", cacheTokens: 0, promptEvalTokens: 900, latencyMs: 1, outcome: "ok" });
      p.recordPhu!({ luotPhu: "agent-luot", cacheTokens: -1, promptEvalTokens: Number.NaN, latencyMs: 1, outcome: "ok" });
      p.recordPhu!({ luotPhu: "agent-luot", cacheTokens: Number.POSITIVE_INFINITY, promptEvalTokens: 2.9, latencyMs: 1, outcome: "ok" });
    });
    expect(hang.map((r) => [r.cacheTokens, r.promptEvalTokens])).toEqual([
      [0, 900],
      [null, null],
      [null, 2],
    ]);
  });

  it("ghiLuotNgoaiCong (dấu vết chỉ-ghi của agent) chuyển hai số xuống hàng", async () => {
    const hang = await chay((gw) => {
      gw.ghiLuotNgoaiCong({ task: "chat", tokensIn: 14, cacheTokens: 12, promptEvalTokens: 2, latencyMs: 1, outcome: "ok" });
      gw.ghiLuotNgoaiCong({ task: "chat", tokensIn: 14, latencyMs: 1, outcome: "ok" });
    });
    expect(hang.map((r) => [r.cacheTokens, r.promptEvalTokens])).toEqual([
      [12, 2],
      [null, null],
    ]);
  });
});
