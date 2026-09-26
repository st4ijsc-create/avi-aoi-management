/**
 * ★ B7 (2026-09-22) — sổ đo lượt `ai_gateway_metrics` mang `reasoningTokens` · `thinking` · `samplingProfile`.
 *
 * Điều đắt nhất cần canh: **vắng ⇒ NULL, không phải 0**. Một hàng cũ / đường in-process không đếm được
 * suy luận mà ghi 0 thì mọi thống kê "tỉ lệ token nghĩ" sau này đều sai theo chiều đẹp hơn thật.
 * Lưới đo HÀNG THẬT đi vào `db.insert(...).values(...)` qua `flush()`, không đo lời khai của `record()`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTableName } from "drizzle-orm";

const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
// Bảng đi cùng mỗi lượt `values` — `record()` còn gọi `recordLlmAudit` (sổ `ai_llm_audit`, CÙNG getDb mock này), nên
// đếm `insert` trần là đếm lẫn hai sổ. Xem `hangDaGhi`.
const insertMock = vi.fn((table: unknown) => ({ values: (rows: unknown) => insertValuesMock(rows, table) }));

vi.mock("./aiGgufEngine", () => ({
  generateText: vi.fn(),
  generateJSON: vi.fn(),
  describeImage: vi.fn(),
  generateTextStream: vi.fn(),
  ggufModelFileExists: vi.fn(() => false),
}));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  getDbMock.mockReset();
  insertValuesMock.mockClear();
  insertMock.mockClear();
  getDbMock.mockResolvedValue({ insert: insertMock });
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function hangDaGhi(o: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Mỗi lượt gọi đo MỘT hàng — xoá dấu vết lượt trước (một `it` có thể gọi hai lần).
  insertValuesMock.mockClear();
  vi.resetModules();
  const gateway = await import("./aiGateway");
  const plan = await gateway.planInference({ task: "code", text: "viết hàm cộng hai số", userId: 7 } as never);
  plan.record(o as never);
  await gateway.flush();
  // ⚠ 2026-09-24 (đỏ khi chạy gộp cả thư mục, "called 2 times"): `record` gài HAI `setInterval` xả 5 s — của sổ đo
  //   (aiGateway) và của sổ audit (aiLlmAudit, cùng getDb mock). `vi.resetModules()` không gỡ bộ đếm của bản module
  //   cũ ⇒ khi máy chậm, bộ đếm mồ côi của sổ AUDIT bắn vào giữa ca kế và bị đếm như một hàng sổ đo. Gỡ cả hai bộ đếm
  //   (móc có sẵn trong hai tệp) VÀ chỉ đếm lượt ghi vào `ai_gateway_metrics`.
  gateway.stopGatewayFlushTimer();
  (await import("./ai/aiLlmAudit")).stopLlmAuditFlushTimer();
  const cuaSoDo = insertValuesMock.mock.calls.filter((c) => getTableName((c as unknown[])[1] as never) === "ai_gateway_metrics");
  expect(cuaSoDo).toHaveLength(1);
  const hang = (cuaSoDo[0] as unknown[])[0] as Array<Record<string, unknown>>;
  expect(hang).toHaveLength(1);
  return hang[0];
}

describe("B7 — ba cột mới đi tới INSERT đúng như đã đo", () => {
  it("★★★ có đủ ba số ⇒ hàng mang đúng ba số (không làm tròn kiểu, không cắt)", async () => {
    const h = await hangDaGhi({
      tokensIn: 100,
      tokensOut: 5300,
      latencyMs: 12000,
      outcome: "ok",
      reasoningTokens: 5000,
      thinking: true,
      samplingProfile: "chinh-hang",
    });
    expect(h.reasoningTokens).toBe(5000);
    expect(h.thinking).toBe(true);
    expect(h.samplingProfile).toBe("chinh-hang");
    expect(h.tokensOut).toBe(5300);
  });

  it("★★★ VẮNG ba số ⇒ NULL cả ba — KHÔNG phải 0 / false / \"\" (không biết ≠ 0)", async () => {
    const h = await hangDaGhi({ tokensIn: 1, tokensOut: 2, latencyMs: 3, outcome: "ok" });
    expect(h.reasoningTokens).toBeNull();
    expect(h.thinking).toBeNull();
    expect(h.samplingProfile).toBeNull();
    // Đối chứng: các cột cũ vẫn theo luật cũ (vắng ⇒ 0).
    expect(h.tokensIn).toBe(1);
  });

  it("`thinking: false` (đã gửi enable_thinking=false) được GIỮ là false, không bị coi là vắng", async () => {
    const h = await hangDaGhi({ outcome: "ok", thinking: false, reasoningTokens: 0, samplingProfile: "hien-tai" });
    expect(h.thinking).toBe(false);
    expect(h.reasoningTokens, "0 đo được là 0 — khác với null").toBe(0);
    expect(h.samplingProfile).toBe("hien-tai");
  });

  it("rác (âm, NaN, chuỗi rỗng, chuỗi quá dài) ⇒ NULL hoặc cắt về 24 ký tự — không ghi rác vào sổ", async () => {
    const h1 = await hangDaGhi({ outcome: "ok", reasoningTokens: -5, samplingProfile: "" });
    expect(h1.reasoningTokens).toBeNull();
    expect(h1.samplingProfile).toBeNull();
    const h2 = await hangDaGhi({ outcome: "ok", reasoningTokens: Number.NaN, samplingProfile: "x".repeat(40) });
    expect(h2.reasoningTokens).toBeNull();
    expect(String(h2.samplingProfile)).toHaveLength(24);
  });

  it("lượt lỗi (`outcome: error`) không mang số đo ⇒ NULL, không ném", async () => {
    const h = await hangDaGhi({ latencyMs: 9, outcome: "error" });
    expect(h.outcome).toBe("error");
    expect(h.reasoningTokens).toBeNull();
    expect(h.thinking).toBeNull();
  });
});
