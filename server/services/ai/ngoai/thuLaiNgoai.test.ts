/**
 * ★ Đợt 12 H3.1 (2026-10-31) — mã lỗi ổn định của nhà cung cấp ngoài + chính sách thử lại (thuần, không mạng, không CSDL).
 * Cổng (`congNgoai.goiAiNgoai`) dùng: chỉ RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT thử lại; QUOTA (429 `insufficient_quota`) và
 * CONTEXT_WINDOW_EXCEEDED không bao giờ; chờ = max(`Retry-After`, gốc·2^(lần−1)) + jitter, quá trần ⇒ không thử.
 * ĐỘT BIẾN PHẢI BẮT: 429 quota ⇒ RATE_LIMIT · tràn ngữ cảnh ⇒ CLIENT/thử lại · 401 thử lại · Retry-After giây ⇔ ms · ngày HTTP quá khứ
 * ⇒ số âm · bỏ jitter / bỏ nhân đôi / bỏ trần.
 */
import { describe, expect, it } from "vitest";
import { docRetryAfter, loiHttp, phanLoaiHttp } from "./nhaCungCap/chung";
import { choTruocLanThu, CHO_THU_LAI_GOC_MS, TRAN_CHO_THU_LAI_MS } from "./congNgoai";
import { laLoiHetGioMang } from "./mangNgoai";
import { LoiNgoai } from "./loi";

describe("phanLoaiHttp — ba họ API", () => {
  it.each([
    ["OpenAI 429 insufficient_quota", 429, { error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" } }, "QUOTA"],
    ["OpenAI 429 rate_limit_exceeded", 429, { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, "RATE_LIMIT"],
    ["OpenAI 400 context_length_exceeded", 400, { error: { message: "This model's maximum context length is 8192 tokens", code: "context_length_exceeded" } }, "CONTEXT_WINDOW_EXCEEDED"],
    ["Anthropic 400 credit balance", 400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the API" } }, "QUOTA"],
    ["Anthropic 400 prompt is too long", 400, { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 210000 tokens > 200000 maximum" } }, "CONTEXT_WINDOW_EXCEEDED"],
    ["Anthropic 429 rate_limit_error", 429, { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } }, "RATE_LIMIT"],
    ["Anthropic 529 overloaded_error", 529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "SERVER"],
    [
      "(rà kiem-dinh) OpenAI 429 RPM THẬT có 'billing' trong lời mời thêm thẻ",
      429,
      { error: { message: "Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 3, Used 3, Requested 1. Please try again in 20s. Visit https://platform.openai.com/account/rate-limits to learn more. You can increase your rate limit by adding a payment method to your account at https://platform.openai.com/account/billing.", type: "requests", code: "rate_limit_exceeded" } },
      "RATE_LIMIT",
    ],
    ["mã insufficient_quota thắng chữ lạ", 429, { error: { message: "Billing hard limit has been reached", code: "insufficient_quota" } }, "QUOTA"],
    ["mã rate_limit thắng chữ 'exceeded your current quota'", 429, { error: { message: "You exceeded your current quota for this minute", code: "rate_limit_exceeded" } }, "RATE_LIMIT"],
    ["429 không mã, chữ có 'billing' (liên kết gói) ⇒ vẫn RATE_LIMIT", 429, { error: { message: "Too many requests. See https://example.com/account/billing for plans." } }, "RATE_LIMIT"],
    ["OpenAI 'exceeded your current quota' không mã", 429, { error: { message: "You exceeded your current quota, please check your plan and billing details." } }, "QUOTA"],
    [
      "(rà kiem-dinh) Gemini RESOURCE_EXHAUSTED theo PHÚT tầng miễn phí (chữ 'exceeded your current quota')",
      429,
      { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-2.0-flash (GenerateRequestsPerMinutePerProjectPerModel-FreeTier)" } },
      "RATE_LIMIT",
    ],
    [
      "Gemini RESOURCE_EXHAUSTED theo NGÀY",
      429,
      { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota. * Quota exceeded for metric: generate_content_free_tier_requests, limit: 1500 (GenerateRequestsPerDayPerProjectPerModel-FreeTier)" } },
      "QUOTA",
    ],
    ["Gemini 429 RESOURCE_EXHAUSTED (theo phút)", 429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." } }, "RATE_LIMIT"],
    ["Gemini 400 vượt token", 400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)." } }, "CONTEXT_WINDOW_EXCEEDED"],
    ["401 khoá sai", 401, { error: { message: "Incorrect API key provided" } }, "AUTH"],
    ["403", 403, { error: "forbidden" }, "AUTH"],
    ["404 model", 404, { error: { message: "model not found" } }, "CLIENT"],
    ["400 tham số khác", 400, { error: { message: "temperature must be <= 2" } }, "CLIENT"],
    ["408", 408, null, "TIMEOUT"],
    ["500", 500, null, "SERVER"],
    ["503 thân rác", 503, { raw: "<html>" }, "SERVER"],
  ] as const)("%s ⇒ %s", (_ten, status, json, loai) => {
    expect(phanLoaiHttp(status, json)).toBe(loai);
  });

  it("loiHttp: chỉ RATE_LIMIT / SERVER / TIMEOUT thử lại; mang phanLoai + choMs", () => {
    const q = loiHttp(429, { error: { code: "insufficient_quota", message: "quota" } }, 5000);
    expect([q.phanLoai, q.thuLai, q.choMs, q.ma]).toEqual(["QUOTA", false, 5000, "NGOAI_NHA_CUNG_CAP_LOI"]);
    const r = loiHttp(429, { error: { message: "slow down" } }, 2000);
    expect([r.phanLoai, r.thuLai, r.choMs]).toEqual(["RATE_LIMIT", true, 2000]);
    expect(loiHttp(400, { error: { code: "context_length_exceeded", message: "x" } }).thuLai).toBe(false);
    expect(loiHttp(401, { error: { message: "bad key" } }).thuLai).toBe(false);
    expect(loiHttp(502, null).thuLai).toBe(true);
    expect(loiHttp(500, null).choMs).toBeUndefined();
  });
});

describe("docRetryAfter", () => {
  const BAY_GIO = Date.parse("2026-10-31T08:00:00Z");
  it.each([
    ["5", 5000],
    ["0", 0],
    ["1.5", 1500],
    ["  12 ", 12_000],
    ["Sat, 31 Oct 2026 08:00:30 GMT", 30_000],
  ] as const)("%j ⇒ %d ms", (v, ms) => {
    expect(docRetryAfter(v, BAY_GIO)).toBe(ms);
  });
  it.each([null, undefined, "", "abc", "-3", "Sat, 31 Oct 2026 07:59:00 GMT"])("%j ⇒ undefined (rác / âm / quá khứ)", (v) => {
    expect(docRetryAfter(v as never, BAY_GIO)).toBeUndefined();
  });
});

describe("choTruocLanThu — backoff + jitter + Retry-After + trần", () => {
  it("nhân đôi theo lần, jitter trong [0, ½ gốc·2^(lần−1))", () => {
    expect(choTruocLanThu(1, undefined, () => 0)).toBe(CHO_THU_LAI_GOC_MS);
    expect(choTruocLanThu(2, undefined, () => 0)).toBe(2 * CHO_THU_LAI_GOC_MS);
    expect(choTruocLanThu(3, undefined, () => 0)).toBe(4 * CHO_THU_LAI_GOC_MS);
    expect(choTruocLanThu(1, undefined, () => 0.999999)).toBe(CHO_THU_LAI_GOC_MS + Math.floor(0.999 * (CHO_THU_LAI_GOC_MS / 2)));
    expect(choTruocLanThu(1, undefined, () => 7)).toBeLessThan(1.5 * CHO_THU_LAI_GOC_MS); // nguồn ngẫu nhiên sai miền ⇒ kẹp
  });
  it("Retry-After lớn hơn backoff ⇒ dùng Retry-After (+ jitter); nhỏ hơn ⇒ dùng backoff", () => {
    expect(choTruocLanThu(1, 3000, () => 0)).toBe(3000);
    expect(choTruocLanThu(1, 100, () => 0)).toBe(CHO_THU_LAI_GOC_MS);
  });
  it("vượt trần ⇒ null (không thử lại)", () => {
    expect(choTruocLanThu(1, TRAN_CHO_THU_LAI_MS + 1, () => 0)).toBeNull();
    expect(choTruocLanThu(1, TRAN_CHO_THU_LAI_MS - 1, () => 0)).toBe(TRAN_CHO_THU_LAI_MS - 1);
  });
});

describe("(rà kiem-dinh t3/t12/t16) biên", () => {
  it("t3 — chờ ĐÚNG bằng trần vẫn thử; trên trần một ms thì không", () => {
    expect(choTruocLanThu(1, TRAN_CHO_THU_LAI_MS, () => 0)).toBe(TRAN_CHO_THU_LAI_MS);
    expect(choTruocLanThu(1, TRAN_CHO_THU_LAI_MS + 1, () => 0)).toBeNull();
  });
  it("t12 — hết giờ (TimeoutError / undici timeout, kể cả bọc trong cause) ⇒ TIMEOUT; đứt kết nối ⇒ không", () => {
    const loiTen = (name: string) => Object.assign(new Error("x"), { name });
    expect(laLoiHetGioMang(loiTen("TimeoutError"))).toBe(true);
    expect(laLoiHetGioMang({ code: "UND_ERR_HEADERS_TIMEOUT" })).toBe(true);
    expect(laLoiHetGioMang({ code: "UND_ERR_BODY_TIMEOUT" })).toBe(true);
    expect(laLoiHetGioMang(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).toBe(true);
    expect(laLoiHetGioMang(Object.assign(new TypeError("fetch failed"), { cause: loiTen("TimeoutError") }))).toBe(true);
    for (const e of [{ code: "ECONNRESET" }, { code: "UND_ERR_SOCKET" }, loiTen("AbortError"), new Error("x"), null]) expect(laLoiHetGioMang(e)).toBe(false);
  });
  it("t16 — choMs âm / không hữu hạn bị bỏ; số lẻ ⇒ phần nguyên", () => {
    expect(new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "x", { choMs: -5 }).choMs).toBeUndefined();
    expect(new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "x", { choMs: Number.NaN }).choMs).toBeUndefined();
    expect(new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "x", { choMs: Number.POSITIVE_INFINITY }).choMs).toBeUndefined();
    expect(new LoiNgoai("NGOAI_NHA_CUNG_CAP_LOI", "x", { choMs: 1500.7 }).choMs).toBe(1500);
  });
});
