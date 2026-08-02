/**
 * Đợt 2 · Task 4 — "thôi nuốt lỗi im lặng".
 *
 * ingestKbChunks() (kbVectorStore.ts:45-99) gọi generateEmbedding() bên trong try/catch; MỌI
 * lỗi ở đó (kể cả "Input is longer than the context size" — throw thật của getEmbeddingFor()
 * khi một chunk vượt EMBED_CTX, đo được ở Đợt 1) trước đây chỉ tăng skipped++ — không có dấu
 * vết nào khác. Nội dung âm thầm vắng mặt khỏi kb_chunks mà không ai biết.
 *
 * File này ĐÚNG là bản đang sống trên đường nạp tri thức: server/routers/kbVectorRouter.ts
 * (mounted ở server/routers.ts:524 — `kbVector: kbVectorRouter`) dynamic-import
 * "../services/kb/kbVectorStore" rồi gọi thẳng ingestKbChunks() từ mutation `kbVector.ingest`
 * (adminProcedure). File tên gần trùng server/services/kbVectorStore.ts (không có /kb/) là một
 * store KHÁC (KB Studio multi-corpus, bảng kb_studio_chunks, hàm upsertChunks/searchCorpus) —
 * cũng đang sống (dùng bởi kbIngestService.ts), nhưng KHÔNG có ingestKbChunks() và KHÔNG tự gọi
 * generateEmbedding() — lỗi nhúng ở đường đó đã được kbIngestService.ts rethrow tường minh
 * thành KbEmbedError (không nuốt), nên không thuộc phạm vi sửa của task này.
 *
 * Test này KHÔNG chạm GPU/DB thật: generateEmbedding bị mock throw trực tiếp, fs bị mock để
 * ingestKbChunks() đọc đúng MỘT dòng "chunks.jsonl" giả có id "c1", getDb() trả một object giả
 * (đủ truthy để qua cổng "DB unavailable" — không bao giờ tới db.insert() thật vì
 * generateEmbedding throw TRƯỚC bước đó).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const errorSpy = vi.fn();

describe("ingestKbChunks — lỗi nhúng phải HIỆN RA", () => {
  beforeEach(() => {
    errorSpy.mockClear();
    vi.resetModules();
  });

  it("khi generateEmbedding throw, phải log LỖI kèm chunk id và lý do thật — không im lặng", async () => {
    vi.spyOn(console, "error").mockImplementation(errorSpy);

    const fakeChunksJsonl = `${JSON.stringify({ id: "c1", text: "x".repeat(9000) })}\n`;

    vi.doMock("fs", () => {
      const api = {
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn(() => fakeChunksJsonl),
      };
      return { default: api, ...api };
    });
    vi.doMock("../../db/connection", () => ({
      getDb: vi.fn(async () => ({}) as unknown),
    }));
    vi.doMock("../aiGgufEngine", () => ({
      generateEmbedding: vi.fn(async () => {
        throw new Error("Input is longer than the context size");
      }),
    }));

    const { ingestKbChunks } = await import("./kbVectorStore");
    const res = await ingestKbChunks();

    // Hành vi luồng KHÔNG đổi: chunk lỗi vẫn được đếm là skipped, không phải throw ra ngoài.
    expect(res.skipped).toBe(1);
    expect(res.ingested).toBe(0);

    // Điểm cốt lõi của task: lỗi phải HIỆN RA qua console.error, nêu đúng chunk và lý do thật.
    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join(" ");
    expect(msg).toMatch(/c1/); // phải nêu chunk nào
    expect(msg).toMatch(/context size/i); // phải nêu lý do thật (err?.message), không phải thông điệp bịa
  });
});
