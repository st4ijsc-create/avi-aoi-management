/**
 * ★ Đợt 10.3 Task 9 — 4 bản cài nhà cung cấp gửi ĐÚNG khuôn (khoá đúng chỗ, không trong URL), đọc usage / tool calls, lỗi HTTP ⇒
 * `NGOAI_NHA_CUNG_CAP_LOI` (thử lại khi 429 / 5xx). Máy chủ GIẢ (`datFetchNgoaiChoTest`) — không gọi API thật.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { datPhanGiaiDns } from "../../../flow/nut/mangAnToan";
import { datFetchNgoaiChoTest, taoMangNgoai } from "../mangNgoai";
import { LoiNgoai } from "../loi";
import type { NhaCungCapAi, YeuCauNhaCungCap } from "./kieu";
import { anthropic } from "./anthropic";
import { openai, openaiTuongThich } from "./openai";
import { gemini } from "./gemini";

datPhanGiaiDns(async () => [{ address: "93.184.216.34", family: 4 }]);
afterAll(() => {
  datPhanGiaiDns(null);
  datFetchNgoaiChoTest(null);
});
const ghi: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
let traVe: { status: number; json: unknown } = { status: 200, json: {} };
datFetchNgoaiChoTest(async (url, init) => (ghi.push({ url, headers: init.headers, body: JSON.parse(init.body) }), traVe));
afterEach(() => {
  ghi.length = 0;
});

const KHOA = "khoa-gia-" + "K".repeat(30);
const yc: YeuCauNhaCungCap = {
  model: "m-1",
  tinNhan: [
    { vaiTro: "system", noiDung: "hệ thống" },
    { vaiTro: "user", noiDung: "hỏi" },
    { vaiTro: "assistant", noiDung: "[gọi công cụ t {}]" },
    { vaiTro: "tool", noiDung: "kết quả", tenTool: "t" },
  ],
  congCu: [{ ten: "t", moTa: "tra", schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"], additionalProperties: false } }],
  maxTokens: 77,
  nhietDo: 0.2,
};
const goi = (n: NhaCungCapAi, endpoint: string | null = null) => n.goi(yc, async () => KHOA, taoMangNgoai({ hostNoiBo: new Set() }), { endpoint });

describe("khuôn gửi + đọc", () => {
  it("Anthropic: x-api-key + anthropic-version; system tách; tool_use ⇒ toolCalls; usage", async () => {
    traVe = { status: 200, json: { content: [{ type: "text", text: "chào" }, { type: "tool_use", name: "t", input: { q: "x" } }], usage: { input_tokens: 11, output_tokens: 7 } } };
    const kq = await goi(anthropic);
    const g = ghi[0]!;
    expect(g.url).toBe("https://api.anthropic.com/v1/messages");
    expect(g.headers).toMatchObject({ "x-api-key": KHOA, "anthropic-version": "2023-06-01" });
    expect(g.url).not.toContain(KHOA);
    expect(g.body).toMatchObject({ model: "m-1", max_tokens: 77, system: "hệ thống" });
    expect((g.body.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect((g.body.tools as Array<{ name: string; input_schema: unknown }>)[0]).toMatchObject({ name: "t", input_schema: { type: "object" } });
    expect(kq).toEqual({ noiDung: "chào", toolCalls: [{ ten: "t", thamSo: { q: "x" } }], tokenVao: 11, tokenRa: 7 });
  });

  it("OpenAI: Bearer; max_completion_tokens; tool_calls arguments JSON ⇒ thamSo; usage", async () => {
    traVe = { status: 200, json: { choices: [{ message: { content: "ok", tool_calls: [{ function: { name: "t", arguments: '{"q":"y"}' } }] } }], usage: { prompt_tokens: 3, completion_tokens: 4 } } };
    const kq = await goi(openai);
    const g = ghi[0]!;
    expect(g.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(g.headers.authorization).toBe(`Bearer ${KHOA}`);
    expect(g.body).toMatchObject({ model: "m-1", max_completion_tokens: 77 });
    expect(g.body).not.toHaveProperty("max_tokens");
    expect(kq).toEqual({ noiDung: "ok", toolCalls: [{ ten: "t", thamSo: { q: "y" } }], tokenVao: 3, tokenRa: 4 });
  });

  it("Tương thích OpenAI: endpoint của khoá + /chat/completions, max_tokens; thiếu endpoint ⇒ chưa gửi", async () => {
    traVe = { status: 200, json: { choices: [{ message: { content: "c" } }] } };
    const kq = await goi(openaiTuongThich, "https://llm.example.com/v1/");
    expect(ghi[0]!.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(ghi[0]!.body).toMatchObject({ max_tokens: 77 });
    expect(kq.tokenVao).toBeNull();
    await expect(goi(openaiTuongThich, null)).rejects.toMatchObject({ ma: "NGOAI_URL_KHONG_HOP_LE", chuaGui: true });
  });

  it("Gemini: khoá ở header x-goog-api-key (KHÔNG trong URL); model trong đường dẫn; bỏ additionalProperties; functionCall ⇒ toolCalls", async () => {
    traVe = { status: 200, json: { candidates: [{ content: { parts: [{ text: "g" }, { functionCall: { name: "t", args: { q: "z" } } }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } } };
    const kq = await goi(gemini);
    const g = ghi[0]!;
    expect(g.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent");
    expect(g.headers["x-goog-api-key"]).toBe(KHOA);
    expect(g.url).not.toContain(KHOA);
    expect(JSON.stringify(g.body)).not.toContain("additionalProperties");
    expect(g.body).toMatchObject({ systemInstruction: { parts: [{ text: "hệ thống" }] }, generationConfig: { maxOutputTokens: 77 } });
    expect(kq).toEqual({ noiDung: "g", toolCalls: [{ ten: "t", thamSo: { q: "z" } }], tokenVao: 5, tokenRa: 6 });
  });
});

describe("lỗi HTTP", () => {
  it.each([
    [400, false],
    [401, false],
    [429, true],
    [500, true],
    [503, true],
  ])("%i ⇒ NGOAI_NHA_CUNG_CAP_LOI (thuLai=%s), thông điệp mang mã + lời nhà cung cấp (cổng che sau)", async (status, thuLai) => {
    traVe = { status, json: { error: { message: "loi cua nha cung cap" } } };
    for (const n of [anthropic, openai, gemini]) {
      const e = await goi(n).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LoiNgoai);
      expect(e).toMatchObject({ ma: "NGOAI_NHA_CUNG_CAP_LOI", thuLai, chuaGui: false });
      expect((e as LoiNgoai).chiTiet).toContain(String(status));
    }
  });

  it("(H3.1) cả ba bản cài: 429 quota ⇒ QUOTA không thử lại; 429 thường ⇒ RATE_LIMIT mang Retry-After (choMs) của tầng mạng", async () => {
    for (const n of [anthropic, openai, gemini]) {
      traVe = { status: 429, json: { error: { message: "You exceeded your current quota", code: "insufficient_quota" } }, retryAfterMs: 4000 } as never;
      const q = (await goi(n).catch((x: unknown) => x)) as LoiNgoai;
      expect([q.phanLoai, q.thuLai], n.ma).toEqual(["QUOTA", false]);
      traVe = { status: 429, json: { error: { message: "slow down" } }, retryAfterMs: 4000 } as never;
      const r = (await goi(n).catch((x: unknown) => x)) as LoiNgoai;
      expect([r.phanLoai, r.thuLai, r.choMs], n.ma).toEqual(["RATE_LIMIT", true, 4000]);
    }
  });
});
