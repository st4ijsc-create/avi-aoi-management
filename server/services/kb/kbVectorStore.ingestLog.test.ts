/**
 * Đợt 2 · Task 4 — "thôi nuốt lỗi im lặng".
 *
 * ingestKbChunks() (kbVectorStore.ts:45-99) có BA đường skipped++ trong cùng vòng lặp:
 *   (a) :57-62 JSON.parse(lines[i]) hỏng → catch trần, KHÔNG một chữ nào (bare-catch im lặng
 *       đúng nghĩa đen — không có docId để nêu, chỉ có chỉ số dòng i).
 *   (b) :65 content rỗng/chỉ khoảng trắng sau .trim() → skip không log.
 *   (c) :67-95 generateEmbedding()/db.insert() throw → catch CÓ log sẵn (console.error với
 *       docId + err.message, từ commit gốc e4e24aa6 — xem test đầu tiên dưới đây, phần đã xác
 *       nhận KHÔNG cần sửa).
 * Cả ba đổ chung vào một biến `skipped`; dòng tổng kết :97 trước đây chỉ in một con số gộp —
 * "skipped: 42" không phân biệt được 42 dòng JSON hỏng với 42 chunk rỗng với 42 lần nhúng lỗi,
 * ba nguyên nhân cần ba cách xử lý khác nhau. Test này khoá (a) và (b) phải HIỆN RA qua
 * console.error, cùng khuôn "[KB] ..." với (c) đã có sẵn.
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
 * Test này KHÔNG chạm GPU/DB thật: generateEmbedding bị mock (throw hoặc không bao giờ gọi tới,
 * tuỳ test), fs bị mock để ingestKbChunks() đọc đúng nội dung "chunks.jsonl" giả mỗi test tự
 * dựng, getDb() trả một object giả (đủ truthy để qua cổng "DB unavailable" — không bao giờ tới
 * db.insert() thật vì ở cả ba test, luồng dừng lại trước bước đó).
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

  it("khi một dòng chunks.jsonl là JSON hỏng, phải log LỖI kèm số dòng — không câm lặng", async () => {
    vi.spyOn(console, "error").mockImplementation(errorSpy);

    // Dòng 0 hỏng JSON hoàn toàn (không có docId nào parse được — chỉ số dòng là định danh duy nhất).
    const fakeChunksJsonl = `{not valid json at all\n`;

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
    // generateEmbedding không bao giờ được gọi tới ở test này (dòng hỏng bị loại TRƯỚC bước nhúng)
    // — vẫn phải mock vì ingestKbChunks() dynamic-import module này vô điều kiện ở đầu hàm.
    vi.doMock("../aiGgufEngine", () => ({
      generateEmbedding: vi.fn(async () => {
        throw new Error("KHÔNG được gọi tới trong test này");
      }),
    }));

    const { ingestKbChunks } = await import("./kbVectorStore");
    const res = await ingestKbChunks();

    // Hành vi luồng KHÔNG đổi: dòng hỏng vẫn chỉ skipped++, không throw ra ngoài.
    expect(res.skipped).toBe(1);
    expect(res.ingested).toBe(0);

    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join(" ");
    expect(msg).toMatch(/\b0\b/); // phải nêu chỉ số dòng (i=0, dòng duy nhất trong file giả)
    expect(/parse|JSON/i.test(msg)).toBe(true); // phải nêu ĐÚNG loại lỗi (parse), không lẫn với lỗi nhúng
  });

  it("khi text rỗng/chỉ khoảng trắng, phải log LỖI kèm docId — không câm lặng", async () => {
    vi.spyOn(console, "error").mockImplementation(errorSpy);

    const fakeChunksJsonl = `${JSON.stringify({ id: "c2", text: "   " })}\n`;

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
    // generateEmbedding không bao giờ được gọi tới ở test này (content rỗng bị loại TRƯỚC bước nhúng).
    vi.doMock("../aiGgufEngine", () => ({
      generateEmbedding: vi.fn(async () => {
        throw new Error("KHÔNG được gọi tới trong test này");
      }),
    }));

    const { ingestKbChunks } = await import("./kbVectorStore");
    const res = await ingestKbChunks();

    expect(res.skipped).toBe(1);
    expect(res.ingested).toBe(0);

    expect(errorSpy).toHaveBeenCalled();
    const msg = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join(" ");
    expect(msg).toMatch(/c2/); // phải nêu chunk nào
    expect(/empty|rỗng/i.test(msg)).toBe(true); // phải nêu ĐÚNG lý do (rỗng), không lẫn với lỗi nhúng
  });
});
