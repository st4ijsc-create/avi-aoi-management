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

/** 200 mà thân IM LẶNG mãi (chỉ nhả khi bị abort) — để đo đồng hồ nhàn rỗi. */
function resIm(): { res: Response; datSignal: (sg: AbortSignal | undefined) => void } {
  let sg: AbortSignal | undefined;
  const reader = {
    read: () =>
      new Promise<{ done: boolean }>((_ok, loi) => {
        sg?.addEventListener("abort", () => loi(new Error("aborted")), { once: true });
      }),
    cancel: async () => undefined,
  };
  return { res: { ok: true, status: 200, body: { getReader: () => reader }, headers: { get: () => null } } as unknown as Response, datSignal: (x) => (sg = x) };
}

describe("(rà kiem-dinh) đồng hồ nhàn rỗi, huỷ khi chờ, xả thân, kẹp jitter", () => {
  it("n6 — 503 rồi 200 IM LẶNG ⇒ đồng hồ nhàn rỗi được ĐẶT LẠI sau lần chờ và VẪN nổ (không treo)", async () => {
    process.env.LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS = "150";
    vi.resetModules();
    const c = await import("./aiLlamaServerClient");
    c._datNguNapChoTest(async () => undefined);
    const im = resIm();
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { signal?: AbortSignal }) => (i++ === 0 ? resLoi(503) : (im.datSignal(init.signal), im.res))));
    const t0 = Date.now();
    await expect((async () => {
      for await (const _ of c.serverGenerateTextStream({ prompt: "hi" })) void _;
    })()).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(3000);
    c._datNguNapChoTest(null);
  }, 10_000);

  it("n7 — chờ nạp (Retry-After 1 s) DÀI hơn hạn nhàn rỗi (150 ms) ⇒ đồng hồ KHÔNG nổ trong lúc chờ; lượt thành công", async () => {
    process.env.LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS = "150";
    vi.resetModules();
    const c = await import("./aiLlamaServerClient");
    c._datNguNapChoTest(null); // chờ THẬT
    let i = 0;
    // như fetch thật: tín hiệu đã huỷ (đồng hồ nhàn rỗi nổ trong lúc chờ) ⇒ ném AbortError
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted) throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      return i++ === 0 ? resLoi(503, "1") : resOk();
    }));
    const t0 = Date.now();
    const ra: GgufStreamChunk[] = [];
    for await (const x of c.serverGenerateTextStream({ prompt: "hi" })) ra.push(x);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
    expect(ra.at(-1)).toMatchObject({ type: "done", fullText: "ok" });
  }, 10_000);

  it("n8 — huỷ THẬT giữa lúc chờ ⇒ ném ngay (không đợi hết 5 s); huỷ trước lần chờ ⇒ ném không chờ", async () => {
    vi.resetModules();
    const c = await import("./aiLlamaServerClient");
    c._datNguNapChoTest(null);
    vi.stubGlobal("fetch", vi.fn(async () => resLoi(503, "5")));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    await expect((async () => {
      for await (const _ of c.serverGenerateTextStream({ prompt: "hi" }, undefined, ac.signal)) void _;
    })()).rejects.toThrow(/huỷ/);
    expect(Date.now() - t0).toBeLessThan(2000);
    // huỷ ĐÚNG lúc nhận 503 (trước khi bắt đầu chờ)
    const ac2 = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => (ac2.abort(), resLoi(503, "5"))));
    const t1 = Date.now();
    await expect((async () => {
      for await (const _ of c.serverGenerateTextStream({ prompt: "hi" }, undefined, ac2.signal)) void _;
    })()).rejects.toThrow();
    expect(Date.now() - t1).toBeLessThan(1000);
  }, 15_000);

  it("n13 — thân 503 được ĐỌC/xả trước mỗi lần chờ (không giữ socket)", async () => {
    let xa = 0;
    const loiDem = () => ({ ...resLoi(503), text: async () => (xa++, "loading") }) as unknown as Response;
    const r = await chay([loiDem(), loiDem(), resOk()]);
    expect(r.loi).toBeNull();
    expect(xa).toBe(2);
  });

  it("n14 — nguồn ngẫu nhiên âm / > 1 bị kẹp: jitter trong [0, ½ gốc)", async () => {
    const c = await import("./aiLlamaServerClient");
    expect(c.choTruocLanThuNap(1, undefined, () => -5)).toBe(c.CHO_NAP_GOC_MS);
    expect(c.choTruocLanThuNap(1, undefined, () => 9)).toBe(c.CHO_NAP_GOC_MS + Math.floor(0.999 * (c.CHO_NAP_GOC_MS / 2)));
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
