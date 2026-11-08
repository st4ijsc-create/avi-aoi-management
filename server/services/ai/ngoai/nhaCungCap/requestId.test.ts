/**
 * ★ Đợt 12 H3.3a — `request-id` của nhà cung cấp: đọc đúng tiêu đề từng họ API, CHỈ nhận bộ ký tự an toàn (dữ liệu ngoài vào sổ / log),
 * mang theo cả khi lỗi HTTP (429 / 5xx — lúc cần nhất để hỏi nhà cung cấp). Máy chủ GIẢ (`datFetchNgoaiChoTest`) — không gọi API thật.
 */
import { afterAll, describe, expect, it } from "vitest";
import { datPhanGiaiDns } from "../../../flow/nut/mangAnToan";
import { datFetchNgoaiChoTest, taoMangNgoai } from "../mangNgoai";
import { LoiNgoai, requestIdHopLe } from "../loi";
import type { NhaCungCapAi, YeuCauNhaCungCap } from "./kieu";
import { docRequestId, loiHttp, TIEU_DE_REQUEST_ID } from "./chung";
import { anthropic } from "./anthropic";
import { openai, openaiTuongThich } from "./openai";
import { gemini } from "./gemini";

datPhanGiaiDns(async () => [{ address: "93.184.216.34", family: 4 }]);
let traVe: { status: number; json: unknown; requestId?: string } = { status: 200, json: {} };
datFetchNgoaiChoTest(async () => traVe);
afterAll(() => {
  datPhanGiaiDns(null);
  datFetchNgoaiChoTest(null);
});

const yc: YeuCauNhaCungCap = { model: "m-1", tinNhan: [{ vaiTro: "user", noiDung: "hỏi" }], maxTokens: 10, nhietDo: 0.2 };
const goi = (n: NhaCungCapAi) => n.goi(yc, async () => "khoa-gia", taoMangNgoai({ hostNoiBo: new Set() }), { endpoint: "https://llm.example.com/v1" });
const tieuDe = (h: Record<string, string>) => (t: string) => h[t] ?? null;

describe("H3.3a — requestIdHopLe / docRequestId (thuần)", () => {
  it("bộ ký tự [A-Za-z0-9_.:-], 1..128; khác ⇒ undefined (không cắt, không làm sạch)", () => {
    expect(requestIdHopLe("req_011CUjx7z:abc.def-9")).toBe("req_011CUjx7z:abc.def-9");
    expect(requestIdHopLe("a".repeat(128))).toBe("a".repeat(128));
    expect(requestIdHopLe("a".repeat(129))).toBeUndefined();
    for (const xau of ["", "a b", "a\r\nX-Gia: 1", "id\u0000", "mã-yêu-cầu", "a/b", "<script>", "a;b"]) expect(requestIdHopLe(xau), JSON.stringify(xau)).toBeUndefined();
    expect(requestIdHopLe(12345)).toBeUndefined();
  });
  it("thứ tự tiêu đề: request-id (Anthropic) → x-request-id (OpenAI) → x-goog-request-id (Gemini); tiêu đề CÓ MẶT đầu tiên quyết định", () => {
    expect(TIEU_DE_REQUEST_ID).toEqual(["request-id", "x-request-id", "x-goog-request-id"]);
    expect(docRequestId(tieuDe({ "request-id": "req_a", "x-request-id": "req_b" }))).toBe("req_a");
    expect(docRequestId(tieuDe({ "x-request-id": "req_b" }))).toBe("req_b");
    expect(docRequestId(tieuDe({ "x-goog-request-id": "g-1" }))).toBe("g-1");
    expect(docRequestId(tieuDe({}))).toBeUndefined();
    // tiêu đề đầu có mặt nhưng BẨN ⇒ không lấy tiêu đề sau (không trộn nguồn)
    expect(docRequestId(tieuDe({ "request-id": "x y", "x-request-id": "req_b" }))).toBeUndefined();
    // rỗng = vắng
    expect(docRequestId(tieuDe({ "request-id": "", "x-request-id": "req_b" }))).toBe("req_b");
  });
  it("LoiNgoai / loiHttp: requestId hợp lệ được giữ; bẩn bị bỏ", () => {
    expect(new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "x", { requestId: "req_1" }).requestId).toBe("req_1");
    expect(new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "x", { requestId: "a\nb" }).requestId).toBeUndefined();
    const e = loiHttp(429, { error: { type: "rate_limit_error", message: "chậm lại" } }, 1000, "req_429");
    expect(e).toMatchObject({ phanLoai: "RATE_LIMIT", thuLai: true, choMs: 1000, requestId: "req_429" });
  });
});

describe("H3.3a — qua mạng giả: bốn bản cài mang requestId khi thành công và khi lỗi", () => {
  const thanhCong: Array<[string, NhaCungCapAi, unknown]> = [
    ["anthropic", anthropic, { content: [{ type: "text", text: "a" }], usage: { input_tokens: 1, output_tokens: 1 } }],
    ["openai", openai, { choices: [{ message: { content: "a" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }],
    ["openai_compat", openaiTuongThich, { choices: [{ message: { content: "a" } }] }],
    ["gemini", gemini, { candidates: [{ content: { parts: [{ text: "a" }] } }] }],
  ];
  for (const [ten, n, json] of thanhCong) {
    it(`${ten}: 200 + id hợp lệ ⇒ kq.requestId; id bẩn ⇒ vắng; không id ⇒ vắng`, async () => {
      traVe = { status: 200, json, requestId: "req_ok-1" };
      expect((await goi(n)).requestId).toBe("req_ok-1");
      traVe = { status: 200, json, requestId: "req\r\nSet-Cookie: x" };
      expect(await goi(n)).not.toHaveProperty("requestId");
      traVe = { status: 200, json };
      expect(await goi(n)).not.toHaveProperty("requestId");
    });
    it(`${ten}: 429 / 503 ⇒ LoiNgoai mang requestId`, async () => {
      traVe = { status: 429, json: { error: { type: "rate_limit_error", message: "chậm" } }, requestId: "req_429" };
      await expect(goi(n)).rejects.toMatchObject({ ma: "NGOAI_NHA_CUNG_CAP_LOI", requestId: "req_429" });
      traVe = { status: 503, json: { error: { message: "quá tải" } }, requestId: "req_503" };
      await expect(goi(n)).rejects.toMatchObject({ phanLoai: "SERVER", requestId: "req_503" });
    });
  }
});
