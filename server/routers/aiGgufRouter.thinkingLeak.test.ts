/**
 * ★★ RÒ CHUỖI SUY LUẬN QUA tRPC `aiGguf.generate` / `aiGguf.chat` — playground + Vision-Lab (G5-E).
 *
 * Hai thủ tục này trả **nguyên vẹn** đối tượng kết quả của engine cho client: `result.text` đi
 * thẳng vào ô hiển thị của trang thử model. Không có một bộ lọc nào trên đường ấy — không cắt thẻ,
 * cũng không che bí mật. Nếu roster đổi sang một model họ Qwen3.x làm mặc định (cả hai thủ tục đều
 * cho phép `modelId` RỖNG ⇒ dùng model mặc định), người mở playground đọc luôn nội tâm model.
 *
 * ⚠ Lưới này canh HÀNH VI (gọi thật thủ tục qua caller tRPC), không canh chú thích: gỡ bộ cắt khỏi
 * `aiGgufRouter.ts` ⇒ §1/§2 ĐỎ.
 *
 * ⚠ §3 KHÔNG HỒI QUY: roster đang chạy (Qwen3-30B-A3B-Instruct) không phát `<think>` ⇒ bản vá phải
 * là no-op TỪNG KÝ TỰ, kể cả khoảng trắng biên (playground là nơi kỹ sư soi đầu ra thô).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// ★ doc 80 — router này nay đứng sau `moduleProcedure("MOD_AI")` / `moduleGate("MOD_AI")`.
//   Cổng license mặc định BẬT (`ENV.licenseModuleGate = LICENSE_MODULE_GATE_ENABLED !== 'false'`)
//   và SKU của môi trường test — suy từ `server/license/license-state-cache.json` (bảng `licenses`
//   RỖNG ở cả hai CSDL) — liệt kê 10 module KHÔNG gồm MOD_AI ⇒ mọi lượt gọi bị FEATURE_DISABLED
//   TRƯỚC khi tới đoạn mã file này cần đo. Tắt cổng Ở ĐÂY, đúng khuôn đã dùng cho MOD_QUALITY tại
//   `defectHeatmapScope.test.ts` / `defectHeatmapSavedScope.test.ts`: `vi.hoisted` chạy TRƯỚC khi
//   `_core/env` được nạp, nên gán ở thân file (sau các `import` đã bị kéo lên) là QUÁ MUỘN.
//   ⚠ Cổng giấy phép được đo ở nơi khác, bằng thiết bị đo riêng: cấu trúc ở
//   `server/routers/congGiayPhepAiCensus.test.ts`, hành vi lúc chạy ở
//   `server/_core/moduleGate.congGiayPhep.test.ts`. File này đo MỘT trục khác — đừng nhập hai trục.
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

const h = vi.hoisted(() => ({ text: "xin chào" }));

const generateTextMock = vi.fn(async (_opts: any, modelId?: string) => ({
  text: h.text,
  tokensPrompt: 3,
  tokensGenerated: 5,
  modelId: modelId || "mac-dinh",
  totalTimeMs: 1,
  tokensPerSecond: 5,
}));
const chatCompletionMock = vi.fn(async (_opts: any, modelId?: string) => ({
  text: h.text,
  tokensPrompt: 3,
  tokensGenerated: 5,
  modelId: modelId || "mac-dinh",
  totalTimeMs: 1,
  tokensPerSecond: 5,
}));

vi.mock("../services/aiGgufEngine", () => ({
  loadGgufModel: vi.fn(),
  unloadGgufModel: vi.fn(),
  generateText: (...a: unknown[]) => generateTextMock(...(a as [any, string?])),
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...(a as [any, string?])),
  analyzeDefect: vi.fn(),
  generateQualityInsights: vi.fn(),
  listGgufModels: vi.fn(async () => []),
  getLoadedGgufModels: vi.fn(() => []),
  isGgufAvailable: vi.fn(async () => true),
  getEngineHealth: vi.fn(() => ({})),
  generateEmbedding: vi.fn(),
  generateTextStream: async function* () {},
  chatCompletionStream: async function* () {},
  countTokens: vi.fn(async () => 0),
}));

vi.mock("../services/aiProviderManager", () => ({ getAIProviderStatus: vi.fn(() => ({})) }));

import { aiGgufRouter } from "./aiGgufRouter";

// `createCaller` của CHÍNH router (như `alertEscalation.test.ts` đang dùng) — không dựng một
// `initTRPC` thứ hai: instance mới có `transformer:false` nên không khớp kiểu với router thật.
const goi = aiGgufRouter.createCaller({ user: { id: 7, role: "admin" } } as any);

const NOI_TAM = "Người dùng hỏi về lô 7. Ta chưa có số liệu, cứ đoán 98% cho chắc.";
const CAU_TRA_LOI = "Tỉ lệ ĐẠT của lô 7 là 96,4% theo báo cáo ca sáng.";

beforeEach(() => {
  h.text = "xin chào";
  delete process.env.AI_THINKING_TAGS;
  delete process.env.AI_THINKING_STARTS_OPEN;
});

function sach(chu: string): void {
  expect(chu).not.toContain(NOI_TAM);
  expect(chu).not.toContain("cứ đoán 98%");
  expect(chu).not.toContain("<think>");
  expect(chu).not.toContain("</think>");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — aiGguf.generate (playground / Vision-Lab)", () => {
  it("★ khối <think> KHÔNG ra ô `text`", async () => {
    h.text = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const r = await goi.generate({ prompt: "chào" });
    sach(r.text);
    expect(r.text).toContain("96,4%");
  });

  it("thẻ LỒNG NHAU — cắt tới thẻ đóng đầu tiên là để lọt nội dung suy luận", async () => {
    h.text = `<think>a<think>${NOI_TAM}</think>c</think>${CAU_TRA_LOI}`;
    const r = await goi.generate({ prompt: "chào" });
    sach(r.text);
    expect(r.text).toContain("96,4%");
  });

  it("thẻ mở KHÔNG BAO GIỜ đóng ⇒ trả rỗng, KHÔNG phun nguyên văn khối", async () => {
    h.text = `<think>${NOI_TAM}`;
    const r = await goi.generate({ prompt: "chào" });
    expect(r.text).toBe("");
  });

  it("tập thẻ khai báo được (AI_THINKING_TAGS) có hiệu lực", async () => {
    process.env.AI_THINKING_TAGS = "phan_tich_noi_bo";
    h.text = `<phan_tich_noi_bo>${NOI_TAM}</phan_tich_noi_bo>${CAU_TRA_LOI}`;
    const r = await goi.generate({ prompt: "chào" });
    expect(r.text).not.toContain(NOI_TAM);
    expect(r.text).not.toContain("phan_tich_noi_bo");
  });

  it("các ô đo lường (token/model) KHÔNG bị bản vá đụng tới", async () => {
    h.text = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const r = await goi.generate({ prompt: "chào", modelId: "mo-hinh-x" });
    expect(r.modelId).toBe("mo-hinh-x");
    expect(r.tokensGenerated).toBe(5);
    expect(r.tokensPrompt).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — aiGguf.chat", () => {
  it("★ khối <think> KHÔNG ra ô `text`", async () => {
    h.text = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const r = await goi.chat({ messages: [{ role: "user", content: "chào" }] });
    sach(r.text);
    expect(r.text).toContain("96,4%");
  });

  it("chat template MỞ SẴN khối (AI_THINKING_STARTS_OPEN): thẻ đầu tiên là thẻ ĐÓNG", async () => {
    process.env.AI_THINKING_STARTS_OPEN = "1";
    h.text = `${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const r = await goi.chat({ messages: [{ role: "user", content: "chào" }] });
    sach(r.text);
    expect(r.text).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — KHÔNG HỒI QUY: đầu ra roster HIỆN TẠI đi qua NGUYÊN VẸN TỪNG KÝ TỰ", () => {
  const SACH = "  Kết quả: ĐẠT.\n  Ngưỡng a < b, tỉ lệ < 0.5% và 3<4 vẫn ổn.\t\n";

  it("generate: `text` === đầu ra engine, kể cả khoảng trắng biên", async () => {
    h.text = SACH;
    const r = await goi.generate({ prompt: "chào" });
    expect(r.text).toBe(SACH);
  });

  it("chat: `text` === đầu ra engine, kể cả khoảng trắng biên", async () => {
    h.text = SACH;
    const r = await goi.chat({ messages: [{ role: "user", content: "chào" }] });
    expect(r.text).toBe(SACH);
  });
});
