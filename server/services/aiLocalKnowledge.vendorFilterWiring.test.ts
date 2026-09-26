/**
 * ★★★ B3 (spec "lọc theo hãng đã có sẵn", `task-v7-report.md`) — lưới cho BA NHÁNH nối
 * `detectProgrammingVendors` (B2) vào lời gọi `searchProgrammingKb` bên trong
 * `retrieveProgrammingKnowledgeForVscode` (`aiLocalKnowledgeService.ts`):
 *   §A — câu hỏi nêu ĐÚNG MỘT hãng    ⇒ `vendor` được TRUYỀN, đúng slug.
 *   §B — câu hỏi KHÔNG nêu hãng nào   ⇒ `vendor` KHÔNG được truyền — HÀNH VI CŨ (tìm khắp sáu hãng).
 *   §C — câu hỏi nêu NHIỀU hãng       ⇒ CHỌN KHÔNG LỌC (giống §B) — xem lý do ở docblock cạnh lời
 *        gọi `searchProgrammingKb` trong `aiLocalKnowledgeService.ts` (hợp đồng `vendor` chỉ nhận
 *        MỘT chuỗi, mở rộng sang lọc-theo-tập ngoài phạm vi bản vá "nhỏ, giá trị cao" này).
 *
 * ─── MOCK BỘ PHẬN, cùng khuôn `aiLocalKnowledge.progKbRouteGate.test.ts` ─────────────────────────
 * `./aiProgrammingKnowledgeService` bị mock TOÀN BỘ — lưới này đo ĐÚNG MỘT ranh giới (câu hỏi →
 * tham số `vendor` truyền cho `searchProgrammingKb`), không đo lại vị từ B2 (đã có lưới riêng
 * `aiLocalKnowledge.vendorDetect.test.ts`) hay bộ lọc thật bên trong `searchProgrammingKb` (đã có
 * lưới riêng `aiProgrammingKnowledgeService.test.ts`).
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC: bỏ dòng gọi `detectProgrammingVendors` (luôn truyền `vendor: undefined`)
 *   ⇒ §A ĐỎ (không lọc được câu hỏi một-hãng — đúng lỗi gốc của brief: hỏi Universal Robots nhận
 *   trích dẫn Delta). Đảo ngược — LUÔN truyền vendor đầu tiên tìm được kể cả khi có ≥2 hãng ⇒ §C ĐỎ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

vi.mock("node:fs", () => ({
  default: { existsSync: () => true, readFileSync: () => "" },
  existsSync: () => true,
  readFileSync: () => "",
}));

const searchProgrammingKb = vi.fn();
// ★ Khớp `manifest.json` thật (6 hãng) — cần mock riêng vì `detectProgrammingVendors` giờ đọc
// danh sách hãng qua `getProgrammingKbVendorSlugs()` thay vì một bảng chép tay (phản hồi chủ dự án
// 2026-09-04, xem `aiLocalKnowledge.vendorDetect.test.ts` §E/§F cho lưới của chính cơ chế đọc động).
const getProgrammingKbVendorSlugs = vi.fn(() => ["delta", "fanuc", "mitsubishi", "omron", "universal-robots", "zmotion"]);
vi.mock("./aiProgrammingKnowledgeService", () => ({
  searchProgrammingKb: (...a: unknown[]) => searchProgrammingKb(...a),
  getProgrammingKbVendorSlugs: () => getProgrammingKbVendorSlugs(),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateText: vi.fn(),
  generateTextStream: vi.fn(),
}));

import { retrieveKnowledge } from "./aiLocalKnowledgeService";

const emptyProgResult = {
  query: "x",
  enabled: true,
  semanticUsed: false,
  answerContext: "",
  citations: [],
  chunks: [],
  rerankMs: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(false);
  searchProgrammingKb.mockResolvedValue(emptyProgResult);
});

describe("§A — ĐÚNG MỘT hãng nêu tên ⇒ vendor được TRUYỀN để lọc", () => {
  it("'Universal Robots' (câu hỏi gốc của brief: movel) ⇒ vendor: 'universal-robots'", async () => {
    await retrieveKnowledge("Cú pháp lệnh movel trên Universal Robots là gì?", 5, { route: "vscode" });
    expect(searchProgrammingKb).toHaveBeenCalledWith({
      query: "Cú pháp lệnh movel trên Universal Robots là gì?",
      topK: 5,
      vendor: "universal-robots",
    });
  });

  it("Omron (hãng hiếm nghĩa) ⇒ vendor: 'omron'", async () => {
    await retrieveKnowledge("Omron CP1E báo lỗi gì khi mất nguồn?", 5, { route: "vscode" });
    expect(searchProgrammingKb).toHaveBeenCalledWith({
      query: "Omron CP1E báo lỗi gì khi mất nguồn?",
      topK: 5,
      vendor: "omron",
    });
  });

  it("Delta viết hoa tên riêng + ngữ cảnh PLC ⇒ vendor: 'delta'", async () => {
    await retrieveKnowledge("Delta PLC AS300 đọc thanh ghi Modbus thế nào?", 5, { route: "vscode" });
    expect(searchProgrammingKb).toHaveBeenCalledWith({
      query: "Delta PLC AS300 đọc thanh ghi Modbus thế nào?",
      topK: 5,
      vendor: "delta",
    });
  });
});

describe("§B — ★ NHÁNH KIA (bắt buộc): KHÔNG hãng nào nêu tên ⇒ KHÔNG lọc, giữ hành vi hôm nay", () => {
  it("câu hỏi lập trình chung chung, không hãng ⇒ vendor KHÔNG được truyền", async () => {
    await retrieveKnowledge("cách đọc file JSON trong Node.js là gì?", 5, { route: "vscode" });
    expect(searchProgrammingKb).toHaveBeenCalledWith({
      query: "cách đọc file JSON trong Node.js là gì?",
      topK: 5,
      vendor: undefined,
    });
  });

  it("'const delta = t1 - t0' (biến JS, KHÔNG phải hãng Delta) ⇒ vendor KHÔNG được truyền", async () => {
    await retrieveKnowledge("const delta = t1 - t0; cách tính deltaTime mỗi frame ra sao?", 5, { route: "vscode" });
    expect(searchProgrammingKb).toHaveBeenCalledWith({
      query: "const delta = t1 - t0; cách tính deltaTime mỗi frame ra sao?",
      topK: 5,
      vendor: undefined,
    });
  });
});

describe("§C — NHIỀU hãng cùng nêu tên ⇒ chọn KHÔNG LỌC (không phải lọc-theo-tập)", () => {
  it("so sánh Delta và Mitsubishi ⇒ vendor KHÔNG được truyền (tìm khắp, để thấy CẢ HAI)", async () => {
    await retrieveKnowledge("So sánh Delta PLC và Mitsubishi PLC, cái nào rẻ hơn?", 5, { route: "vscode" });
    expect(searchProgrammingKb).toHaveBeenCalledWith({
      query: "So sánh Delta PLC và Mitsubishi PLC, cái nào rẻ hơn?",
      topK: 5,
      vendor: undefined,
    });
  });
});
