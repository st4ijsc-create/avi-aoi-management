/**
 * ★ Đợt 12 H4.1 (kiem-dinh) — MÁY CHỦ LLM GIẢ tiêm lỗi qua HTTP THẬT, không GPU.
 *
 * Nói OpenAI-compatible `/v1/chat/completions` SSE của llama-server (`delta.content`, `delta.reasoning_content`, `delta.tool_calls`,
 * `finish_reason`, `usage`, `timings`) + `/health`, `/props`, `/v1/models`. Cho phép chạy NGUYÊN đường production
 * `taoGoiModelMayChu → aiGgufEngine.chatCompletionStream → aiLlamaServerClient → fetch` (và `chayVongAgent` / `quanLyLuotChay` ở trên) với lỗi tiêm
 * ở ĐÚNG tầng mạng: RST giữa luồng, im lặng, 200 rỗng, SSE méo, 429, 400 tràn ngữ cảnh, 503 đang nạp, tool call nằm trong suy luận,
 * câu trả lời kẹt trong suy luận (G5-D), `<think>` không đóng, cắt ở max_tokens.
 *
 * TẤT ĐỊNH theo `seed`: cách CHẺ byte SSE thành các lần ghi (kể cả chẻ giữa một ký tự UTF-8 nhiều byte và giữa `data:` / JSON) lấy từ PRNG
 * mulberry32(seed) — cùng seed ⇒ cùng chuỗi lần ghi. Mỗi yêu cầu ăn đúng MỘT bước của kịch bản theo thứ tự tới; hết kịch bản ⇒ 500 có chữ
 * "KICH_BAN_HET" (không im lặng). `chuaDung()` ném khi còn bước chưa ăn (assertConsumed — kịch bản thừa = test sai).
 *
 * ⚠ Đây KHÔNG đo chất lượng model; nó kiểm HARNESS (bộ đọc SSE, phân loại lỗi, thử lại, cắt suy luận, gom tool call, vòng agent).
 */
import assert from "node:assert";
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface ToolCallGia {
  ten: string;
  args: Record<string, unknown> | string;
  id?: string;
}

export interface TraLoiGia {
  loai: "tra-loi";
  chu?: string;
  nghi?: string;
  toolCalls?: ToolCallGia[];
  /** mặc định: `tool_calls` nếu có tool, ngược lại `stop` */
  finish?: "stop" | "length" | "tool_calls" | null;
  usage?: { prompt: number; completion: number; cached?: number };
  timings?: { cache_n: number; prompt_n: number; predicted_n: number };
  /** số ký tự mỗi mảnh `content` / `reasoning_content` (mặc định 7) */
  mieng?: number;
}

export type BuocGia =
  | TraLoiGia
  /** RST socket sau `sauManh` sự kiện SSE (0 = ngay sau header, trước mọi byte thân). */
  | { loai: "connection_reset"; sauManh?: number; truocHeader?: boolean }
  /** Phát `sauManh` sự kiện rồi IM LẶNG (không đóng) cho tới khi client bỏ. */
  | { loai: "stall"; sauManh?: number }
  /** 200 + SSE hợp lệ nhưng không một chữ / tool nào, chỉ `[DONE]`. */
  | { loai: "rong"; finish?: "stop" | "length" }
  /** Xen sự kiện SSE méo (JSON hỏng, dòng chú thích, `event:`) vào giữa luồng tốt. */
  | { loai: "json_hong"; chu: string }
  | { loai: "rate_limit"; retryAfterS?: number; thanKieu?: "insufficient_quota" | "rate_limit" }
  | { loai: "tran_ngu_canh" }
  /** 503 "Loading model" (trước luồng). */
  | { loai: "dang_nap"; retryAfterS?: number }
  /** Lỗi `{"error":…}` GIỮA luồng sau `sauManh` sự kiện chữ (HTTP đã 200). */
  | { loai: "loi_giua_luong"; sauManh?: number; thongDiep?: string }
  | { loai: "http"; status: number; than: string; headers?: Record<string, string> };

export interface YeuCauGhi {
  thuTu: number;
  duong: string;
  than: Record<string, unknown> | null;
  headers: Record<string, string | string[] | undefined>;
  luc: number;
}

export interface LlmGia {
  url: string;
  yeuCau: YeuCauGhi[];
  /** số yêu cầu `/v1/chat/completions` đã nhận */
  soLanGoi: () => number;
  /** các lần ghi thô đã làm (kích thước) của yêu cầu thứ i — để test cùng seed ⇒ cùng cách chẻ */
  cachChe: (i: number) => number[];
  chuaDung: () => void;
  dat: (b: BuocGia[]) => void;
  /** đổi trả lời của `/health` (mặc định 200 ok) */
  suckhoe: (status: number) => void;
  dong: () => Promise<void>;
}

/** mulberry32 — PRNG tất định, đủ cho chia nhỏ. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

function cat(s: string, n: number): string[] {
  const ra: string[] = [];
  const chars = [...s];
  for (let i = 0; i < chars.length; i += n) ra.push(chars.slice(i, i + n).join(""));
  return ra;
}

const khung = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: "chatcmpl-gia",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/** Dựng chuỗi sự kiện SSE (mảng, mỗi phần tử = một sự kiện đầy đủ) cho một bước `tra-loi`. */
export function dungSuKien(b: TraLoiGia): string[] {
  const ev: string[] = [];
  const n = Math.max(1, b.mieng ?? 7);
  ev.push(sse(khung({ role: "assistant", content: null })));
  for (const m of cat(b.nghi ?? "", n)) if (m) ev.push(sse(khung({ reasoning_content: m })));
  for (const m of cat(b.chu ?? "", n)) if (m) ev.push(sse(khung({ content: m })));
  const tcs = b.toolCalls ?? [];
  tcs.forEach((t, i) => {
    const args = typeof t.args === "string" ? t.args : JSON.stringify(t.args);
    ev.push(sse(khung({ tool_calls: [{ index: i, id: t.id ?? `call_gia_${i}`, type: "function", function: { name: t.ten, arguments: "" } }] })));
    for (const m of cat(args, 9)) ev.push(sse(khung({ tool_calls: [{ index: i, function: { arguments: m } }] })));
  });
  const finish = b.finish === undefined ? (tcs.length ? "tool_calls" : "stop") : b.finish;
  const cuoi: Record<string, unknown> = khung({}, finish);
  if (b.usage) cuoi.usage = { prompt_tokens: b.usage.prompt, completion_tokens: b.usage.completion, ...(b.usage.cached !== undefined ? { prompt_tokens_details: { cached_tokens: b.usage.cached } } : {}) };
  if (b.timings) cuoi.timings = b.timings;
  ev.push(sse(cuoi));
  ev.push("data: [DONE]\n\n");
  return ev;
}

/** Chẻ chuỗi byte thành các lần ghi cỡ 1..maxLan theo PRNG (có thể rơi giữa ký tự UTF-8). */
export function cheByte(buf: Buffer, rnd: () => number, toiDa = 23): Buffer[] {
  const ra: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    const k = 1 + Math.floor(rnd() * toiDa);
    ra.push(buf.subarray(i, i + k));
    i += k;
  }
  return ra;
}

export async function khoiDongLlmGia(opts: { kichBan: BuocGia[]; seed?: number; chiTieuModel?: string; nCtx?: number }): Promise<LlmGia> {
  let kichBan = [...opts.kichBan];
  let thuTu = 0;
  let statusHealth = 200;
  const yeuCau: YeuCauGhi[] = [];
  const cacheChe: number[][] = [];
  const ocon = new Set<http.ServerResponse>();
  const rnd0 = opts.seed ?? 1;
  const model = opts.chiTieuModel ?? "fake-model";

  const sv = http.createServer(async (req, res) => {
    ocon.add(res);
    res.on("close", () => ocon.delete(res));
    const duong = (req.url ?? "").split("?")[0]!;
    if (req.method === "GET") {
      if (duong === "/health") {
        res.writeHead(statusHealth, { "content-type": "application/json" }).end(JSON.stringify(statusHealth === 200 ? { status: "ok" } : { error: { message: "Loading model", code: 503 } }));
      } else if (duong === "/props") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ total_slots: 1, default_generation_settings: { n_ctx: opts.nCtx ?? 65536 }, modalities: { vision: false } }));
      } else if (duong === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: `${model}.gguf` }] }));
      } else res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let than: Record<string, unknown> | null = null;
    try {
      than = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      than = null;
    }
    const i = thuTu++;
    yeuCau.push({ thuTu: i, duong, than, headers: req.headers, luc: Date.now() });
    const buoc = kichBan.shift();
    cacheChe[i] = [];
    if (!buoc) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "KICH_BAN_HET: llm gia khong con buoc nao", type: "server_error" } }));
      return;
    }
    const rnd = mulberry32(rnd0 * 7919 + i);
    const ghiSse = async (ev: string[], toiDaChe = 23) => {
      for (const p of cheByte(Buffer.from(ev.join(""), "utf8"), rnd, toiDaChe)) {
        if (res.destroyed) return;
        cacheChe[i]!.push(p.length);
        res.write(p);
        await new Promise<void>((r) => setImmediate(r));
      }
    };
    const dauSse = () => res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });

    switch (buoc.loai) {
      case "tra-loi":
        dauSse();
        await ghiSse(dungSuKien(buoc));
        res.end();
        return;
      case "rong":
        dauSse();
        await ghiSse([sse(khung({ role: "assistant", content: null })), sse(khung({}, buoc.finish ?? "stop")), "data: [DONE]\n\n"]);
        res.end();
        return;
      case "json_hong": {
        dauSse();
        const tot = cat(buoc.chu, 5).map((m) => sse(khung({ content: m })));
        const ev = [
          ": keep-alive\n\n",
          'event: ping\ndata: {"khong":"phai chu"}\n\n',
          tot[0] ?? "",
          'data: {"choices":[{"delta":{"content":"HONG\n\n', // JSON cụt
          "data: not-json-at-all\n\n",
          ...tot.slice(1),
          sse(khung({}, "stop")),
          "data: [DONE]\n\n",
        ];
        await ghiSse(ev);
        res.end();
        return;
      }
      case "connection_reset": {
        if (buoc.truocHeader) {
          res.socket?.resetAndDestroy();
          return;
        }
        dauSse();
        const ev = dungSuKien({ loai: "tra-loi", chu: "mot cau tra loi kha dai de co nhieu manh", mieng: 4 });
        await ghiSse(ev.slice(0, 1 + (buoc.sauManh ?? 0)), 9);
        res.socket?.resetAndDestroy();
        return;
      }
      case "stall": {
        dauSse();
        const ev = dungSuKien({ loai: "tra-loi", chu: "mot cau tra loi kha dai de co nhieu manh", mieng: 4 });
        await ghiSse(ev.slice(0, 1 + (buoc.sauManh ?? 0)), 9);
        return; // KHÔNG end — client phải tự bỏ khi hết giờ nhàn rỗi
      }
      case "loi_giua_luong": {
        dauSse();
        const ev = dungSuKien({ loai: "tra-loi", chu: "mot cau tra loi kha dai de co nhieu manh", mieng: 4 });
        await ghiSse([...ev.slice(0, 1 + (buoc.sauManh ?? 1)), sse({ error: { message: buoc.thongDiep ?? "slot error", type: "server_error", code: 500 } })]);
        res.end();
        return;
      }
      case "rate_limit":
        res.writeHead(429, { "content-type": "application/json", ...(buoc.retryAfterS !== undefined ? { "retry-after": String(buoc.retryAfterS) } : {}) });
        res.end(JSON.stringify({ error: { message: buoc.thanKieu === "insufficient_quota" ? "You exceeded your current quota" : "Rate limit reached", type: buoc.thanKieu ?? "rate_limit", code: buoc.thanKieu === "insufficient_quota" ? "insufficient_quota" : "rate_limit_exceeded" } }));
        return;
      case "tran_ngu_canh":
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: 400, message: "request (70123 tokens) exceeds the available context size (65536 tokens), try increasing it", type: "exceed_context_size_error", n_prompt_tokens: 70123, n_ctx: 65536 } }));
        return;
      case "dang_nap":
        res.writeHead(503, { "content-type": "application/json", ...(buoc.retryAfterS !== undefined ? { "retry-after": String(buoc.retryAfterS) } : {}) });
        res.end(JSON.stringify({ error: { code: 503, message: "Loading model", type: "unavailable_error" } }));
        return;
      case "http":
        res.writeHead(buoc.status, { "content-type": "application/json", ...(buoc.headers ?? {}) });
        res.end(buoc.than);
        return;
    }
  });
  await new Promise<void>((ok) => sv.listen(0, "127.0.0.1", ok));
  const port = (sv.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    yeuCau,
    soLanGoi: () => thuTu,
    cachChe: (i) => cacheChe[i] ?? [],
    chuaDung: () => {
      if (kichBan.length) assert.fail(`llmGia: còn ${kichBan.length} bước kịch bản chưa dùng (${kichBan.map((b) => b.loai).join(", ")})`); // assert.fail, not `throw new Error`: the F3 census (rawErrorCensus) counts raw throws and forbids raising its budget
    },
    dat: (b) => {
      kichBan = [...b];
    },
    suckhoe: (s) => {
      statusHealth = s;
    },
    dong: async () => {
      for (const r of ocon) r.socket?.destroy();
      await new Promise<void>((ok) => sv.close(() => ok()));
    },
  };
}

/** Đặt env để đường production đi qua máy chủ giả (STRICT: lỗi KHÔNG lùi nạp model in-process). Trả hàm khôi phục. */
export function datMoiTruongLlmGia(url: string, them: Record<string, string> = {}): () => void {
  const khoa: Record<string, string> = {
    LLAMA_SERVER_ENABLED: "true",
    LLAMA_SERVER_URL: url,
    LLAMA_SERVER_MODEL: "fake-model",
    GGUF_DEFAULT_MODEL: "fake-model.gguf",
    LLAMA_SERVER_STRICT: "true",
    LLAMA_SERVER_CTX_PER_SLOT: "65536",
    LLAMA_SERVER_TIMEOUT_MS: "5000",
    LLAMA_SERVER_HEALTH_TIMEOUT_MS: "1500",
    ...them,
  };
  const cu: Record<string, string | undefined> = {};
  for (const k of Object.keys(khoa)) {
    cu[k] = process.env[k];
    process.env[k] = khoa[k];
  }
  return () => {
    for (const [k, v] of Object.entries(cu)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
