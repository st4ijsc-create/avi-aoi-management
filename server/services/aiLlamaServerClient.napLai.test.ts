/**
 * ★ Đợt 12 H3.1 (đường CỤC BỘ) — llama-server 503 "Loading model" TRƯỚC luồng ⇒ chờ có backoff (+ Retry-After) rồi thử lại, tối đa
 * SO_LAN_THU_NAP lần; hết lần / chờ quá trần ⇒ LoiStreamServer mang httpStatus 503 ⇒ tầng agent MODEL_DANG_NAP (tạm thời).
 * ĐỘT BIẾN PHẢI BẮT: không thử lại 503 · thử lại cả 500 · bỏ Retry-After · không trần · mất httpStatus · agent xếp MODEL_LOI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GgufStreamChunk } from "./aiGgufEngine";

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
  process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

const enc = new TextEncoder();
const SSE =
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "ok" } }] })}\n\n` +
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } })}\n\n` +
  "data: [DONE]\n\n";
function resOk(): Response {
  let xong = false;
  const reader = { read: async () => (xong ? { done: true } : ((xong = true), { done: false, value: enc.encode(SSE) })), cancel: async () => undefined };
  return { ok: true, status: 200, body: { getReader: () => reader }, headers: { get: () => null } } as unknown as Response;
}
const resLoi = (status: number, retryAfter: string | null = null) =>
  ({ ok: false, status, text: async () => '{"error":{"code":503,"message":"Loading model","type":"unavailable_error"}}', headers: { get: (k: string) => (k === "retry-after" ? retryAfter : null) } }) as unknown as Response;

async function chay(chuoi: Response[]) {
  vi.resetModules();
  const c = await import("./aiLlamaServerClient");
  const cho: number[] = [];
  c._datNguNapChoTest(async (ms) => void cho.push(ms));
  let i = 0;
  const f = vi.fn(async () => chuoi[Math.min(i++, chuoi.length - 1)]!);
  vi.stubGlobal("fetch", f);
  const ra: GgufStreamChunk[] = [];
  let loi: unknown = null;
  try {
    for await (const x of c.serverGenerateTextStream({ prompt: "hi" })) ra.push(x);
  } catch (e) {
    loi = e;
  }
  c._datNguNapChoTest(null);
  return { ra, loi, cho, soGoi: f.mock.calls.length, c };
}

describe("503 đang nạp model ⇒ chờ rồi thử lại", () => {
  it("★ 503, 503 rồi 200 ⇒ thành công, 3 lần gọi, 2 lần chờ tăng dần", async () => {
    const r = await chay([resLoi(503), resLoi(503), resOk()]);
    expect(r.loi).toBeNull();
    expect(r.ra.at(-1)).toMatchObject({ type: "done", fullText: "ok" });
    expect(r.soGoi).toBe(3);
    expect(r.cho).toHaveLength(2);
    expect(r.cho[0]).toBeGreaterThanOrEqual(1000);
    expect(r.cho[1]).toBeGreaterThanOrEqual(2000);
  });

  it("Retry-After lớn hơn backoff ⇒ chờ ít nhất bằng Retry-After", async () => {
    const r = await chay([resLoi(503, "5"), resOk()]);
    expect(r.loi).toBeNull();
    expect(r.cho[0]).toBeGreaterThanOrEqual(5000);
  });

  it("Retry-After quá trần (60 s) ⇒ KHÔNG chờ, ném ngay với httpStatus 503", async () => {
    const r = await chay([resLoi(503, "60"), resOk()]);
    expect(r.soGoi).toBe(1);
    expect(r.cho).toEqual([]);
    expect((r.loi as { httpStatus?: number }).httpStatus).toBe(503);
  });

  it("503 mãi ⇒ đúng SO_LAN_THU_NAP lần gọi rồi ném httpStatus 503", async () => {
    const r = await chay([resLoi(503)]);
    expect(r.soGoi).toBe(r.c.SO_LAN_THU_NAP);
    expect((r.loi as { httpStatus?: number }).httpStatus).toBe(503);
  });

  it("500 / 400 KHÔNG thử lại (chỉ 503 là đang nạp); lỗi mang httpStatus", async () => {
    for (const st of [500, 400]) {
      const r = await chay([resLoi(st), resOk()]);
      expect(r.soGoi, String(st)).toBe(1);
      expect((r.loi as { httpStatus?: number }).httpStatus).toBe(st);
    }
  });

  it("choTruocLanThuNap: nhân đôi, jitter ½, trần", async () => {
    const c = await import("./aiLlamaServerClient");
    expect(c.choTruocLanThuNap(1, undefined, () => 0)).toBe(c.CHO_NAP_GOC_MS);
    expect(c.choTruocLanThuNap(3, undefined, () => 0)).toBe(4 * c.CHO_NAP_GOC_MS);
    expect(c.choTruocLanThuNap(1, undefined, () => 0.999)).toBe(c.CHO_NAP_GOC_MS + Math.floor(0.999 * (c.CHO_NAP_GOC_MS / 2)));
    expect(c.choTruocLanThuNap(1, c.TRAN_CHO_NAP_MS, () => 0)).toBe(c.TRAN_CHO_NAP_MS);
    expect(c.choTruocLanThuNap(1, c.TRAN_CHO_NAP_MS + 1, () => 0)).toBeNull();
  });
});

describe("tầng agent: mã ổn định", () => {
  it("httpStatus 503 (kể cả bọc trong cause) ⇒ MODEL_DANG_NAP tạm thời; 429 ⇒ RATE_LIMIT tạm thời; còn lại như cũ", async () => {
    const { chuyenLoiModel } = await import("./ai/agent/goiModelMayChu");
    const { LoiStreamServer } = await import("./aiLlamaServerClient");
    const nap = chuyenLoiModel(new LoiStreamServer("x", false, { httpStatus: 503 }));
    expect([nap.ma, nap.tamThoi]).toEqual(["MODEL_DANG_NAP", true]);
    const boc = chuyenLoiModel(new Error("bọc", { cause: new LoiStreamServer("x", false, { httpStatus: 503 }) }));
    expect(boc.ma).toBe("MODEL_DANG_NAP");
    const rl = chuyenLoiModel(new LoiStreamServer("x", false, { httpStatus: 429 }));
    expect([rl.ma, rl.tamThoi]).toEqual(["RATE_LIMIT", true]);
    expect(chuyenLoiModel(new LoiStreamServer("x", false, { httpStatus: 400 })).ma).toBe("MODEL_LOI");
  });
});
