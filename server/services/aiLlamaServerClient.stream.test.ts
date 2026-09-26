/**
 * ★★★ G1 — ĐƯỜNG STREAMING SSE QUA `llama-server`.
 *
 * VÌ SAO CÓ FILE NÀY: prefix-cache 44–74× dựng ở G1-A chỉ phục vụ đường KHÔNG-streaming
 * (`serverGenerateText`). Đường người dùng thật đi — ops-chat (`aiLocalKnowledgeService`) và
 * `/v1/chat/completions` của gateway — là đường STREAMING, và trước bản vá này nó **chưa bao giờ
 * hỏi llama-server**. Cái được tăng tốc không nằm trên đường được đi.
 *
 * KHUÔN DÂY THẬT (đo sống 2026-08-16 trên `llama-server` b9814, `:8091`, `od -c` từng byte):
 *   `data: {json}\n\n` lặp lại, kết thúc bằng `data: [DONE]\n\n`.
 *   • Sự kiện ĐẦU có `delta.content = null` (chỉ mang `role`) ⇒ phải BỎ QUA, không phát chuỗi "null".
 *   • `stream_options:{include_usage:true}` được hỗ trợ ⇒ sự kiện áp chót mang `usage` +
 *     `usage.prompt_tokens_details.cached_tokens` + `timings.cache_n/prompt_n` (bằng chứng
 *     prefix-cache đo được NGAY TRONG luồng, không phải suy diễn).
 *
 * BỐN CHỖ DỄ SAI NHẤT, mỗi chỗ một ca ở đây:
 *   1. **Một sự kiện SSE đến làm NHIỀU MẢNH TCP.** Bộ phân giải phải giữ phần dở dang, không
 *      được `JSON.parse` một nửa.
 *   2. **Một ký tự UTF-8 nhiều byte bị chẻ giữa hai mảnh.** Tiếng Việt có dấu ⇒ 2–3 byte/ký tự;
 *      `TextDecoder` KHÔNG có `{stream:true}` sẽ đẻ ra `�` giữa câu trả lời.
 *   3. **Đứt giữa chừng SAU khi đã phát chữ.** Lỗi phải mang cờ `daPhatChu` để tầng trên biết
 *      rằng chạy lại lượt này là NỐI HAI NỬA của hai lượt suy luận khác nhau.
 *   4. **Huỷ từ phía client / hết giờ nhàn rỗi.** Không được để `fetch` treo và không được để
 *      promise nào treo lại sau khi generator đóng.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GgufStreamChunk } from "./aiGgufEngine";

async function freshClient() {
  vi.resetModules();
  return await import("./aiLlamaServerClient");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LLAMA_SERVER_STRICT;
  delete process.env.LLAMA_SERVER_API_KEY;
  delete process.env.LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS;
  process.env.LLAMA_SERVER_ENABLED = "true";
  process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
  process.env.GGUF_DEFAULT_MODEL = "qwen3-30b-a3b-instruct.gguf";
  process.env.LLAMA_SERVER_MODEL = "qwen3-30b-a3b-instruct.gguf";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

// ─── Tiện ích: dựng một `Response` giả có `body.getReader()` phát ĐÚNG các mảnh byte cho trước ──

/** Dựng thân phản hồi phát lần lượt các mảnh `Uint8Array`; `loi` (nếu có) ném ở lần đọc kế tiếp. */
function thanLuong(mieng: Uint8Array[], loi?: Error) {
  let i = 0;
  let daHuy = false;
  const reader = {
    async read(): Promise<{ done: boolean; value?: Uint8Array }> {
      if (daHuy) return { done: true };
      if (i < mieng.length) return { done: false, value: mieng[i++] };
      if (loi) throw loi;
      return { done: true };
    },
    async cancel() {
      daHuy = true;
    },
  };
  return { getReader: () => reader, _daHuy: () => daHuy };
}

function res(mieng: Uint8Array[], loi?: Error): Response {
  return { ok: true, status: 200, body: thanLuong(mieng, loi) } as unknown as Response;
}

const enc = new TextEncoder();

/** Một sự kiện SSE `data: {...}\n\n` mang một mảnh chữ. */
function suKien(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
}
const SU_KIEN_ROLE = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: null } }] })}\n\n`;
const SU_KIEN_USAGE =
  `data: ${JSON.stringify({
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 14, completion_tokens: 3, total_tokens: 17, prompt_tokens_details: { cached_tokens: 12 } },
    timings: { cache_n: 12, prompt_n: 2, predicted_n: 3 },
  })}\n\n`;
const DONE = "data: [DONE]\n\n";

async function gom(gen: AsyncGenerator<GgufStreamChunk>): Promise<GgufStreamChunk[]> {
  const ra: GgufStreamChunk[] = [];
  for await (const c of gen) ra.push(c);
  return ra;
}

describe("serverGenerateTextStream — khuôn dây SSE thật của llama-server", () => {
  it("★ phát từng mảnh chữ theo thứ tự, BỎ QUA sự kiện `delta.content=null`, kết bằng `done` có số token", async () => {
    const day = SU_KIEN_ROLE + suKien("Xin") + suKien(" chào") + suKien(" bạn") + SU_KIEN_USAGE + DONE;
    vi.stubGlobal("fetch", vi.fn(async () => res([enc.encode(day)])));

    const c = await freshClient();
    const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));

    const token = ra.filter((x) => x.type === "token").map((x) => x.token);
    expect(token).toEqual(["Xin", " chào", " bạn"]); // KHÔNG có "null", KHÔNG có chuỗi rỗng
    const done = ra.at(-1)!;
    expect(done.type).toBe("done");
    expect(done.fullText).toBe("Xin chào bạn");
    expect(done.tokensPrompt).toBe(14);
    expect(done.tokensGenerated).toBe(3);
    expect(typeof done.totalTimeMs).toBe("number");
  });

  it("★★ (1) MỘT sự kiện SSE đến làm NHIỀU MẢNH TCP — chẻ ở mọi vị trí byte, không mảnh nào vỡ", async () => {
    const day = SU_KIEN_ROLE + suKien("alpha") + suKien("beta") + SU_KIEN_USAGE + DONE;
    const byte = enc.encode(day);

    // Chẻ ở MỌI vị trí (không chỉ một vị trí "may mắn"): 1 ca xanh ở một điểm chẻ không nói được gì.
    // ⚠ Nạp module MỘT lần rồi chỉ đổi `fetch`: `vi.resetModules()` trong vòng lặp ~470 lần biến
    // ca này thành ~5 s và làm nó hết giờ khi chạy chung bộ — chi phí của bộ nạp, không phải của
    // thứ đang được đo.
    const c = await freshClient();
    for (let cat = 1; cat < byte.length; cat++) {
      vi.stubGlobal("fetch", vi.fn(async () => res([byte.slice(0, cat), byte.slice(cat)])));
      const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));
      expect(ra.filter((x) => x.type === "token").map((x) => x.token).join(""), `chẻ tại byte ${cat}`).toBe("alphabeta");
      expect(ra.at(-1)!.type, `chẻ tại byte ${cat}`).toBe("done");
    }
  });

  it("★★ (2) ký tự UTF-8 nhiều byte bị CHẺ giữa hai mảnh — không được đẻ ra U+FFFD", async () => {
    // "ế" = 3 byte (U+1EBF). Chẻ ĐÚNG GIỮA nó.
    const day = suKien("Ki") + suKien("ểm tra thiết bị") + SU_KIEN_USAGE + DONE;
    const byte = enc.encode(day);
    const viTriE = day.indexOf("thiết") + 4; // chỉ số ký tự…
    // …đổi sang chỉ số BYTE rồi lùi 1 byte để rơi vào GIỮA ký tự "ế".
    const truoc = enc.encode(day.slice(0, viTriE)).length - 1;
    vi.stubGlobal("fetch", vi.fn(async () => res([byte.slice(0, truoc), byte.slice(truoc)])));

    const c = await freshClient();
    const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));
    const chu = ra.filter((x) => x.type === "token").map((x) => x.token).join("");
    expect(chu).toBe("Kiểm tra thiết bị");
    expect(chu).not.toContain("�");
  });

  it("dòng rỗng, dòng chú thích `:` (keep-alive) và `event:` bị bỏ qua, không thành token", async () => {
    const day = `: ping\n\n` + `event: message\n` + suKien("ok") + `\n\n` + SU_KIEN_USAGE + DONE;
    vi.stubGlobal("fetch", vi.fn(async () => res([enc.encode(day)])));
    const c = await freshClient();
    const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));
    expect(ra.filter((x) => x.type === "token").map((x) => x.token)).toEqual(["ok"]);
  });

  it("`\\r\\n` (CRLF) cũng phân giải đúng — không để `\\r` lọt vào chữ", async () => {
    const day = (suKien("A") + suKien("B") + SU_KIEN_USAGE + DONE).replace(/\n/g, "\r\n");
    vi.stubGlobal("fetch", vi.fn(async () => res([enc.encode(day)])));
    const c = await freshClient();
    const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));
    expect(ra.filter((x) => x.type === "token").map((x) => x.token)).toEqual(["A", "B"]);
  });

  it("luồng đóng mà KHÔNG có `\\n` cuối: sự kiện treo vẫn được phát (không nuốt mảnh chữ cuối)", async () => {
    const day = suKien("A") + `data: ${JSON.stringify({ choices: [{ delta: { content: "B" } }] })}`;
    vi.stubGlobal("fetch", vi.fn(async () => res([enc.encode(day)])));
    const c = await freshClient();
    const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));
    expect(ra.filter((x) => x.type === "token").map((x) => x.token)).toEqual(["A", "B"]);
  });

  it("JSON hỏng giữa luồng KHÔNG làm sập cả lượt — bỏ qua sự kiện đó, phần còn lại vẫn tới", async () => {
    const day = suKien("A") + `data: {khong-phai-json\n\n` + suKien("B") + SU_KIEN_USAGE + DONE;
    vi.stubGlobal("fetch", vi.fn(async () => res([enc.encode(day)])));
    const c = await freshClient();
    const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));
    expect(ra.filter((x) => x.type === "token").map((x) => x.token)).toEqual(["A", "B"]);
  });
});

describe("serverGenerateTextStream — hỏng, huỷ, hết giờ (không được để promise treo)", () => {
  it("HTTP 400 (vượt ngữ cảnh) ⇒ NÉM, và `daPhatChu=false` vì chưa mảnh chữ nào ra ngoài", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"the request exceeds the available context size","type":"exceed_context_size_error"}}',
    }) as unknown as Response));
    const c = await freshClient();
    const loi = await gom(c.serverGenerateTextStream({ prompt: "hi" })).then(() => null, (e) => e);
    expect(String(loi?.message)).toMatch(/HTTP 400/);
    expect(c.daPhatChuTruocKhiHong(loi)).toBe(false);
    expect(c.laLoiTranNguCanh(loi)).toBe(true); // vẫn nhận ra đúng nguyên nhân
  });

  it("★★ (3) server CHẾT GIỮA CHỪNG sau khi đã phát chữ ⇒ ném với `daPhatChu=true`", async () => {
    const day = suKien("nửa đầu") + suKien(" câu");
    vi.stubGlobal("fetch", vi.fn(async () => res([enc.encode(day)], new Error("ECONNRESET"))));
    const c = await freshClient();

    const ra: GgufStreamChunk[] = [];
    const loi = await (async () => {
      try {
        for await (const x of c.serverGenerateTextStream({ prompt: "hi" })) ra.push(x);
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    expect(ra.map((x) => x.token).join("")).toBe("nửa đầu câu"); // chữ ĐÃ ra ngoài
    expect(String(loi?.message)).toMatch(/ECONNRESET/);
    expect(c.daPhatChuTruocKhiHong(loi)).toBe(true); // ⇒ tầng trên KHÔNG được chạy lại lượt này
  });

  it("consumer `break` giữa chừng ⇒ reader được huỷ (socket không treo)", async () => {
    const than = thanLuong([enc.encode(suKien("A") + suKien("B") + suKien("C"))]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, body: than }) as unknown as Response));
    const c = await freshClient();

    for await (const x of c.serverGenerateTextStream({ prompt: "hi" })) {
      if (x.type === "token") break; // bỏ ngang ở mảnh chữ ĐẦU TIÊN
    }
    expect(than._daHuy()).toBe(true);
  });

  it("★ AbortSignal đã huỷ TỪ TRƯỚC ⇒ không gửi gì cả, ném ngay", async () => {
    const fetchSpy = vi.fn(async () => res([enc.encode(suKien("A") + DONE)]));
    vi.stubGlobal("fetch", fetchSpy);
    const c = await freshClient();
    const ac = new AbortController();
    ac.abort();
    await expect(gom(c.serverGenerateTextStream({ prompt: "hi" }, undefined, ac.signal))).rejects.toThrow();
  });

  it("★ hết giờ NHÀN RỖI: server im giữa chừng ⇒ ném trong ~ngưỡng, KHÔNG treo mãi", async () => {
    process.env.LLAMA_SERVER_STREAM_IDLE_TIMEOUT_MS = "150";
    let signalNgoai: AbortSignal | undefined;
    const reader = {
      async read(): Promise<{ done: boolean; value?: Uint8Array }> {
        // Im lặng vĩnh viễn — chỉ giải phóng khi bị abort.
        return await new Promise((_resolve, reject) => {
          signalNgoai?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      async cancel() {},
    };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
      signalNgoai = init?.signal;
      return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response;
    }));

    const c = await freshClient();
    const t0 = Date.now();
    await expect(gom(c.serverGenerateTextStream({ prompt: "hi" }))).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(3000);
  }, 10_000);
});

describe("serverGenerateTextStream — thân yêu cầu gửi lên đúng khuôn OpenAI + prefix-cache", () => {
  it("gửi `stream:true` + `stream_options.include_usage` + đúng vai system/user", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      expect(String(url)).toContain("/v1/chat/completions");
      body = JSON.parse(init.body);
      return res([enc.encode(suKien("x") + SU_KIEN_USAGE + DONE)]);
    }));
    const c = await freshClient();
    await gom(c.serverGenerateTextStream({ systemPrompt: "bạn là trợ lý", prompt: "hỏi", maxTokens: 64 }));

    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages[0]).toEqual({ role: "system", content: "bạn là trợ lý" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hỏi" });
    expect(body.max_tokens).toBe(64);
  });

  it("serverChatCompletionStream gửi NGUYÊN lịch sử hội thoại (server tự áp chat template)", async () => {
    let body: any;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      body = JSON.parse(init.body);
      return res([enc.encode(suKien("y") + SU_KIEN_USAGE + DONE)]);
    }));
    const c = await freshClient();
    const ra = await gom(
      c.serverChatCompletionStream({
        messages: [
          { role: "system", content: "S" },
          { role: "user", content: "U1" },
          { role: "assistant", content: "A1" },
          { role: "user", content: "U2" },
        ],
      }),
    );
    expect(body.messages.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(ra.at(-1)!.type).toBe("done");
  });
});

// ─── (4) BÍ MẬT BỊ CHẺ LÀM ĐÔI QUA HAI MẢNH TCP ───────────────────────────────────────────────
/**
 * ★★★ LỚP LỖI ĐÃ GẶP Ở PHA 8: khoá phiên rò NGUYÊN VĂN xuống trình duyệt.
 *
 * `StreamingSecretRedactor` là thứ chặn nó, và nó là STATEFUL — giữ lại phần đuôi khả nghi qua
 * ranh giới chunk. Đường streaming server MỚI đẻ ra một cách chẻ chunk MỚI (theo mảnh TCP, không
 * theo token của node-llama-cpp), nên câu hỏi "bộ che còn ôm được không?" phải được ĐO LẠI trên
 * chính khuôn chẻ đó, chứ không suy ra từ ca cũ.
 *
 * Ca dưới đây tiêu thụ luồng ĐÚNG NHƯ `aiLocalKnowledgeService` làm (một redactor mỗi luồng,
 * `push()` từng mảnh, `flush()` ở cuối) và khẳng định HAI chiều:
 *   • KHÔNG có redactor ⇒ bí mật ra NGUYÊN VĂN (chứng minh mối nguy CÓ THẬT trên đường mới).
 *   • CÓ redactor    ⇒ không mảnh nào của bí mật lọt ra.
 */
describe("★★★ che bí mật XUYÊN MẢNH TCP trên đường streaming server", () => {
  const BI_MAT = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  /** Chẻ bí mật làm đôi: nửa đầu ở sự kiện SSE này, nửa sau ở sự kiện kế — hai mảnh TCP khác nhau. */
  function luongCoBiMatCheDoi() {
    const a = BI_MAT.slice(0, 12);
    const b = BI_MAT.slice(12);
    const m1 = enc.encode(suKien("Khoá của bạn là ") + suKien(a));
    const m2 = enc.encode(suKien(b) + suKien(" — giữ kín nhé.") + SU_KIEN_USAGE + DONE);
    return [m1, m2];
  }

  it("KHÔNG dùng redactor: bí mật ra NGUYÊN VĂN (mối nguy có thật, không phải giả định)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(luongCoBiMatCheDoi())));
    const c = await freshClient();
    const ra = await gom(c.serverGenerateTextStream({ prompt: "hi" }));
    const tho = ra.filter((x) => x.type === "token").map((x) => x.token).join("");
    expect(tho).toContain(BI_MAT); // ⇐ đây là cái phải KHÔNG BAO GIỜ tới trình duyệt
    // và nó THẬT SỰ tới làm nhiều mảnh, không phải một cục:
    expect(ra.filter((x) => x.type === "token").some((x) => x.token === BI_MAT)).toBe(false);
  });

  it("★★★ dùng redactor ĐÚNG NHƯ ops-chat: không một mảnh nào của bí mật lọt ra", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(luongCoBiMatCheDoi())));
    const { StreamingSecretRedactor } = await import("./ai/aiSafety");
    const c = await freshClient();

    const redactor = new StreamingSecretRedactor();
    const raNgoai: string[] = [];
    for await (const x of c.serverGenerateTextStream({ prompt: "hi" })) {
      if (x.type === "token" && x.token) {
        const an = redactor.push(x.token);
        if (an) raNgoai.push(an);
      }
    }
    const duoi = redactor.flush();
    if (duoi) raNgoai.push(duoi);

    const noiLai = raNgoai.join("");
    expect(noiLai).not.toContain(BI_MAT);
    // Không chỉ "thiếu nguyên văn" — không được lọt CẢ MẢNH DÀI của nó.
    expect(noiLai).not.toContain(BI_MAT.slice(0, 20));
    expect(noiLai).not.toContain(BI_MAT.slice(-20));
    expect(noiLai).toContain("[REDACTED_SECRET]");
    // Chữ lành lặn xung quanh vẫn còn nguyên (bộ che không ăn mất câu trả lời).
    expect(noiLai).toContain("Khoá của bạn là ");
    expect(noiLai).toContain("giữ kín nhé.");
  });
});
