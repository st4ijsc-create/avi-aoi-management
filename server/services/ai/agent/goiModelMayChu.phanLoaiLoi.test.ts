/**
 * ★ Đợt 12 H3.1b — phân loại lỗi đường model CỤC BỘ theo chuỗi `cause` (lỗ L1–L5 kiem-dinh H4.1; đầu–cuối qua HTTP thật ở
 * `server/testing/llmGia.test.ts`). Ở đây: các biên mà máy chủ giả không tạo được.
 * ĐỘT BIẾN PHẢI BẮT: chỉ đọc `code` ngoài cùng · bỏ bit `daPhatChu` trong chuỗi · QUOTA tạm thời · bỏ trần độ sâu (vòng cause treo) ·
 * EMPTY_RESPONSE đã hiện suy luận vẫn tạm thời · lượt `length` rỗng bị coi là EMPTY_RESPONSE · engine bọc bỏ `cause`.
 */
import { describe, expect, it } from "vitest";
import type { ManhModel } from "@shared/agentCore";
import { chuyenLoiModel, taoGoiModelMayChu } from "./goiModelMayChu";
import { LoiStreamServer, maLoiTrongThan } from "../../aiLlamaServerClient";
import type { GgufStreamChunk } from "../../aiGgufEngine";

const socket = (code: string) => Object.assign(new Error("other side closed"), { code });
const fetchHong = (code: string) => new TypeError("fetch failed", { cause: socket(code) });

describe("chuyenLoiModel — chuỗi cause", () => {
  it("RST nằm sâu (bọc engine ⇒ LoiStreamServer ⇒ fetch failed ⇒ ECONNRESET), CHƯA phát ⇒ tạm thời, mã mạng", () => {
    const e = new Error("[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1-D…)", { cause: new LoiStreamServer("[llamaServer] stream lỗi: fetch failed", false, { cause: fetchHong("ECONNRESET") }) });
    expect(chuyenLoiModel(e)).toMatchObject({ tamThoi: true, ma: "ECONNRESET" });
  });
  it("RST SAU khi đã phát (bit daPhatChu ở client HOẶC ở lớp bọc engine) ⇒ KHÔNG tạm thời", () => {
    const client = new LoiStreamServer("[llamaServer] stream lỗi: terminated", true, { cause: socket("UND_ERR_SOCKET") });
    expect(chuyenLoiModel(client)).toMatchObject({ tamThoi: false, ma: "UND_ERR_SOCKET" });
    const engine = Object.assign(new Error("[aiGgufEngine] TỪ CHỐI TRUNG THỰC (G1, …)", { cause: new LoiStreamServer("x", false, { cause: socket("ECONNRESET") }) }), { daPhatChu: true });
    expect(chuyenLoiModel(engine)).toMatchObject({ tamThoi: false, ma: "ECONNRESET" });
  });
  it("429 insufficient_quota ⇒ QUOTA không tạm thời; 429 khác ⇒ RATE_LIMIT tạm thời; 503 bọc ⇒ MODEL_DANG_NAP", () => {
    const q = new LoiStreamServer("[llamaServer] stream HTTP 429: …", false, { httpStatus: 429, maNhaCungCap: "insufficient_quota" });
    expect(chuyenLoiModel(new Error("bọc", { cause: q }))).toMatchObject({ tamThoi: false, ma: "QUOTA" });
    const r = new LoiStreamServer("[llamaServer] stream HTTP 429: …", false, { httpStatus: 429, maNhaCungCap: "rate_limit_exceeded" });
    expect(chuyenLoiModel(new Error("bọc", { cause: r }))).toMatchObject({ tamThoi: true, ma: "RATE_LIMIT" });
    expect(chuyenLoiModel(new Error("bọc", { cause: new LoiStreamServer("503", false, { httpStatus: 503 }) }))).toMatchObject({ tamThoi: true, ma: "MODEL_DANG_NAP" });
  });
  it("chuỗi cause VÒNG / sâu quá trần ⇒ không treo, không đọc quá trần (mã ở tầng 7 không được thấy)", () => {
    const a: Error & { cause?: unknown } = new Error("a");
    a.cause = new Error("b", { cause: a });
    expect(chuyenLoiModel(a)).toMatchObject({ tamThoi: false, ma: "MODEL_LOI" });
    let sau: unknown = socket("ECONNRESET");
    for (let i = 0; i < 6; i++) sau = new Error(`t${i}`, { cause: sau });
    expect(chuyenLoiModel(sau)).toMatchObject({ tamThoi: false, ma: "MODEL_LOI" });
  });
  it("maLoiTrongThan: code trước type; không JSON / ký tự lạ ⇒ undefined", () => {
    expect(maLoiTrongThan('{"error":{"code":"insufficient_quota","type":"x"}}')).toBe("insufficient_quota");
    expect(maLoiTrongThan('{"error":{"type":"insufficient_quota"}}')).toBe("insufficient_quota");
    expect(maLoiTrongThan("Loading model")).toBeUndefined();
    expect(maLoiTrongThan('{"error":{"code":"a b<script>"}}')).toBeUndefined();
  });
});

async function luot(manh: GgufStreamChunk[]): Promise<{ ra: ManhModel[]; loi: unknown }> {
  const goi = taoGoiModelMayChu({
    khongGhiDauVet: true,
    chatStream: async function* () {
      for (const m of manh) yield m;
    },
  });
  const ra: ManhModel[] = [];
  try {
    for await (const m of goi({ tinNhan: [{ role: "user", content: "hỏi" }], congCu: [], signal: new AbortController().signal })) ra.push(m);
    return { ra, loi: null };
  } catch (e) {
    return { ra, loi: e };
  }
}

describe("EMPTY_RESPONSE (lỗ L5)", () => {
  it("200 không chữ, không tool ⇒ EMPTY_RESPONSE tạm thời (chưa phát gì), KHÔNG có mảnh xong", async () => {
    const r = await luot([{ type: "done", toolCalls: [] } as GgufStreamChunk]);
    expect(r.loi).toMatchObject({ ma: "EMPTY_RESPONSE", tamThoi: true });
    expect(r.ra.some((m) => m.loai === "xong")).toBe(false);
  });
  it("đã HIỆN suy luận rồi mới rỗng ⇒ EMPTY_RESPONSE KHÔNG tạm thời (không chạy lại thứ người dùng đã thấy)", async () => {
    const r = await luot([{ type: "reasoning", token: "nghĩ…" } as GgufStreamChunk, { type: "done", toolCalls: [] } as GgufStreamChunk]);
    expect(r.ra.some((m) => m.loai === "nghi")).toBe(true);
    expect(r.loi).toMatchObject({ ma: "EMPTY_RESPONSE", tamThoi: false });
  });
  it("chỉ có tool call ⇒ bình thường; rỗng nhưng bị cắt ở trần (length) ⇒ để lõi xử lý biCat như cũ", async () => {
    const tool = await luot([{ type: "done", toolCalls: [{ id: "c", type: "function", function: { name: "read_file", arguments: "{}" } }] } as GgufStreamChunk]);
    expect(tool.loi).toBeNull();
    const cat = await luot([{ type: "done", toolCalls: [], finishReason: "length" } as GgufStreamChunk]);
    expect(cat.loi).toBeNull();
    expect(cat.ra.find((m) => m.loai === "xong")).toMatchObject({ biCat: true });
  });
});
