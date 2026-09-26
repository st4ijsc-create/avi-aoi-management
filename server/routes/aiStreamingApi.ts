/**
 * AI GGUF Streaming API — Server-Sent Events endpoints for real-time LLM inference
 *
 * Provides token-by-token streaming for text generation and chat completion
 * alongside the existing tRPC router (which only supports request/response).
 */

import type express from "express";
import { thuXacThucRest, thanTuChoiRest } from "./_xacThucRest";
import {
  generateTextStream,
  chatCompletionStream,
  isGgufAvailable,
} from "../services/aiGgufEngine";
import { generateNarrativeStream } from "../services/aiProviderRouter";
import { StreamingSecretRedactor, redactSecretsOnly } from "../services/ai/aiSafety";
// ⚠ Import TĨNH từ module LÁ (`ai/thinkingStrip`), KHÔNG từ `aiGgufEngine`: mọi test mock engine
// bằng factory liệt kê tay sẽ biến bộ cắt thành `undefined` mà lưới vẫn xanh. Xem đầu file đó.
import { StreamingThinkingStripper, stripThinking, thinkingStartsOpen } from "../services/ai/thinkingStrip";

/**
 * ★★★ CHE BÍ MẬT TRƯỚC KHI CHỮ RỜI MÁY CHỦ — vì sao file này có `OngPhatSSE`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỖ ĐÃ ĐO ĐƯỢC, KHÔNG PHẢI GIẢ THUYẾT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba tuyến dưới đây từng ghi thẳng `res.write(\`data: ${JSON.stringify(chunk)}\n\n\`)`. Mọi
 * consumer streaming KHÁC của repo đã có `StreamingSecretRedactor` từ lâu (ops-chat
 * `aiLocalKnowledgeService` · `aiProviderRouter.generateNarrativeStream` · `openaiGateway` /v1) —
 * ba tuyến này là **ngoại lệ duy nhất**, và nay chúng mang chữ từ model 30B qua `llama-server`.
 * Đo bằng `aiStreamingApi.secretLeak.test.ts` TRƯỚC bản vá: **46/58 ca ĐỎ** — khoá `sk-…` ra
 * NGUYÊN VĂN ở đầu ra SSE trên cả ba tuyến, ở **mọi** vị trí chẻ đã thử.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO PHẢI CHE **XUYÊN CHUNK**, KHÔNG CHỈ CHE TỪNG CHUNK
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một khoá `sk-ABC…6789` có thể bị **chẻ làm đôi qua hai sự kiện SSE ở hai mảnh TCP**. Lọc từng
 * chunk độc lập **không bắt được** — mỗi nửa trông vô hại. `StreamingSecretRedactor` sinh ra đúng
 * để giữ trạng thái qua ranh giới chunk (giữ lại 32 ký tự đuôi khi chữ bình thường, và giữ TOÀN
 * BỘ mảnh đang mở khi thấy dấu hiệu một bí mật đang hình thành). ⚠ **KHÔNG viết bản che thứ hai**:
 * hai cài đặt sẽ trôi khỏi nhau — đúng lớp lỗi repo này đã gặp. Dùng lại đúng lớp đã có.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BỐN ĐƯỜNG RÒ, KHÔNG PHẢI MỘT — và đường (2) HOÀN TÁC lượt che của đường (1)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. `token` — đường chính, và là đường DUY NHẤT bị chẻ qua chunk ⇒ cần bộ che GIỮ TRẠNG THÁI.
 *  2. `fullText` (chunk `done`) — `client/src/hooks/useAIStream.ts:94` đọc `chunk.fullText ??
 *     fullText`, nghĩa là chữ NGƯỜI DÙNG THẤY lấy từ ô này chứ **không** từ chuỗi token đã che.
 *     Che token mà bỏ `fullText` = che xong rồi tự gỡ ra.
 *  3. `error` của chunk `{type:"error"}` do engine sinh.
 *  4. `err.message` ở `catch` — **cả** nhánh SSE **lẫn** nhánh `res.status(500).json`. Chỗ này rất
 *     dễ bỏ sót vì nó *"chỉ là thông báo lỗi"*, trong khi `err.message` mang chuỗi kết nối
 *     (`postgres://user:pass@host`), đường dẫn, khoá.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ CHỐNG "N+1": KHÔNG LIỆT KÊ Ô, MÀ QUÉT MỌI Ô
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `phatChunk()` **không** có danh sách tên ô cần che. Nó che `token` bằng bộ che xuyên-chunk, rồi
 * quét **mọi ô chuỗi CÒN LẠI** (kể cả ô một phiên bản engine tương lai mới thêm) bằng
 * `redactSecretsOnly`. Một ô mới ⇒ được che **mà không ai phải nhớ sửa ở đây**.
 * Nửa còn lại của lượng từ nằm ở lưới: `aiStreamingApi.secretLeak.test.ts` §5 đọc **AST** của
 * chính file này và khẳng định *∀ lượt ghi động ra `res` nằm trong `OngPhatSSE`* · *∀ tuyến mở
 * `text/event-stream` đều dựng `OngPhatSSE`* · *∀ lượt chạm `.message` nằm trong `chuoiLoiAn`*.
 * Thêm tuyến thứ tư mà quên che ⇒ lưới **ĐỎ**, kể cả khi chưa ai viết ca cho tuyến ấy.
 *
 * ⚠ ĐÁNH ĐỔI ĐƯỢC KHAI: bộ che giữ tối đa 32 ký tự đuôi ⇒ chữ tới trình duyệt **trễ ~32 ký tự**,
 *   *không* trễ theo thời gian và *không* gom thành khối (đo ở §6 của lưới: 100 mảnh vào ⇒ ≥90
 *   sự kiện SSE ra, mảnh dài nhất ≤ 37 ký tự). Phần giữ được **xả** ở `xaTonDong()` khi luồng kết
 *   thúc — thiếu bước ấy thì 32 ký tự cuối câu trả lời **biến mất** (§4 của lưới canh chuyện này).
 * ⚠ Tuyến `narrative` bị che **hai lần** (`aiProviderRouter` đã che ở tầng dưới). Cố ý: tầng này
 *   là **hàng rào cuối** trước trình duyệt, và một tuyến được miễn trừ chính là hình dạng mà lưới
 *   lượng từ không phát biểu được. `redactSecretsOnly` bất biến trên chữ đã che nên không hại gì.
 */

/**
 * **CHỦ DUY NHẤT** biến một lỗi thành chữ an toàn cho người dùng. Mọi lượt chạm `.message` trong
 * file này phải đi qua đây (lưới §5 canh bằng AST).
 */
function chuoiLoiAn(err: unknown): string {
  const tho = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err ?? "");
  return redactSecretsOnly(tho).text;
}

/**
 * **CHỦ DUY NHẤT** ghi nội dung động ra một phản hồi SSE. Một thực thể cho MỘT luồng — không bao
 * giờ dùng chung ở phạm vi module: trạng thái giữ-lại là của riêng từng cuộc.
 */
class OngPhatSSE {
  /**
   * ⚠⚠ THỨ TỰ HAI BỘ LỌC LÀ QUYẾT ĐỊNH, KHÔNG PHẢI CHI TIẾT: **cắt thẻ TRƯỚC, che bí mật SAU**.
   * Cắt thẻ là phép XOÁ ⇒ nó NỐI hai đoạn chữ vốn bị khối `<think>` tách rời. Một khoá bị khối
   * suy luận chẻ đôi (`sk-`+8 ký tự · `<think>…</think>` · 16 ký tự) thì che-trước sẽ thấy hai
   * nửa đều DƯỚI ngưỡng `sk-[A-Za-z0-9]{16,}` ⇒ nhả nguyên văn, rồi bộ cắt nối lại ⇒ **khoá đủ
   * ra trình duyệt**. Bộ canh NỘI DUNG phải đứng CUỐI, sau mọi phép biến đổi cấu trúc.
   * Ca chứng minh: `aiStreamingApi.thinkingLeak.test.ts` §5 (đảo thứ tự ⇒ ĐỎ).
   */
  private readonly cat = new StreamingThinkingStripper({ startInsideThinking: thinkingStartsOpen() });
  private readonly che = new StreamingSecretRedactor();
  private daCanhBaoMoSan = false;

  constructor(private readonly res: express.Response) {}

  /** Phát một chunk do model sinh — mọi ô văn bản đều đi qua lớp cắt rồi lớp che. */
  phatChunk(chunk: unknown): void {
    const o = (chunk ?? {}) as Record<string, unknown>;
    const an: Record<string, unknown> = { ...o };

    // Ô `token`: cắt thẻ + che bí mật, CẢ HAI đều XUYÊN CHUNK (giữ trạng thái) — một thẻ `<thi`
    // và một khoá `sk-…` đều có thể bị chẻ đôi qua hai sự kiện SSE ở hai mảnh TCP.
    const laToken = typeof o.token === "string";
    if (laToken) an.token = this.che.push(this.cat.push(o.token as string));

    // MỌI ô chuỗi còn lại (`fullText`, `error`, và bất kỳ ô nào engine thêm sau này): cắt + che
    // MỘT LƯỢT. ⚠ `fullText` là ô client THẬT SỰ hiển thị (`useAIStream.ts:94`) — bỏ nó thì lượt
    // cắt ở trên bị tự tay dán lại.
    for (const [k, v] of Object.entries(o)) {
      if (k === "token") continue;
      if (typeof v === "string") an[k] = redactSecretsOnly(stripThinking(v).answer).text;
    }

    this.canhBaoMoSan();

    // Chunk KHÔNG phải "token" (done/error) chốt hạ câu trả lời ⇒ xả phần còn giữ TRƯỚC nó, nếu
    // không thứ tự chữ tới trình duyệt bị đảo và đuôi câu rơi sau dấu kết thúc.
    if (o.type !== "token") this.xaTonDong();

    // Bộ che chưa nhả gì (đang giữ đuôi) ⇒ không có gì để phát; sự kiện rỗng chỉ tốn byte.
    if (laToken && an.token === "") return;

    this.ghi(an);
  }

  /**
   * Xả phần CẢ HAI bộ lọc còn giữ. Gọi khi luồng kết thúc.
   *
   * ⚠ ĐÚNG THỨ TỰ: xả bộ cắt TRƯỚC và đẩy phần ấy QUA bộ che, rồi mới xả bộ che. Xả bộ che trước
   * sẽ làm đuôi câu ra sau phần đã che ⇒ đảo thứ tự chữ tới trình duyệt.
   *
   * ⚠ KHAI THẲNG, ĐÃ ĐO (đột biến M10 của G5-C sống sót và đây là lý do): **chỉ `che.flush()` mới
   * gánh chữ**. `cat.flush()` KHÔNG BAO GIỜ nhả ký tự nào — `push()` luôn để lại bộ đệm rỗng hoặc
   * một mảnh bắt đầu ĐÚNG tại `<`, mà mảnh ấy bị bỏ đi theo thiết kế fail-safe. Giữ lượt gọi vì nó
   * chốt sổ (`truncated`/`thinking`) và vì chính sách giữ có thể đổi. Bất biến ấy được ghim ở
   * `aiGgufEngine.stripThinking.test.ts` — đổi chính sách giữ ⇒ ca đó ĐỎ ⇒ phải xem lại chỗ này.
   */
  xaTonDong(): void {
    const conCat = this.cat.flush();
    const con = (conCat ? this.che.push(conCat) : "") + this.che.flush();
    this.canhBaoMoSan();
    if (con) this.ghi({ type: "token", token: con });
  }

  /**
   * Một thẻ ĐÓNG ở độ sâu 0 sau khi đã phát chữ = template mở sẵn khối suy luận mà
   * `AI_THINKING_STARTS_OPEN` chưa bật. Chữ đã rò và không rút lại được; việc duy nhất còn làm
   * được là biến hỏng-trong-im-lặng thành hỏng-CÓ-TIẾNG để vận hành bật cờ.
   */
  private canhBaoMoSan(): void {
    if (this.daCanhBaoMoSan || !this.cat.suspectedStartInsideThinking) return;
    this.daCanhBaoMoSan = true;
    console.warn(
      "[aiStreamingApi] thấy thẻ đóng suy luận ở độ sâu 0 SAU khi đã phát chữ — nhiều khả năng " +
        "chat template mở sẵn khối <think> và AI_THINKING_STARTS_OPEN chưa được bật. " +
        "Một phần chuỗi suy luận ĐÃ ra tới trình duyệt trong lượt này.",
    );
  }

  /** Phát một lỗi ra luồng đang mở (header đã gửi ⇒ không đổi mã trạng thái được nữa). */
  phatLoi(err: unknown): void {
    this.xaTonDong();
    this.ghi({ type: "error", error: chuoiLoiAn(err) });
  }

  /** Đóng luồng: xả nốt phần giữ, rồi phát dấu kết thúc. */
  ketThuc(): void {
    this.xaTonDong();
    this.res.write("data: [DONE]\n\n");
    this.res.end();
  }

  private ghi(o: unknown): void {
    this.res.write(`data: ${JSON.stringify(o)}\n\n`);
  }
}

/**
 * Register SSE streaming routes on the Express app
 */
export function registerAiStreamingRoutes(app: express.Express) {
  // ─── SSE: Text Generation Stream ────────────────────
  app.post("/api/ai/stream/generate", async (req, res) => {
    let phat: OngPhatSSE | null = null;
    try {
      const xacThuc = await thuXacThucRest(req);
      if (!xacThuc.ok) {
        res.status(xacThuc.ma).json(thanTuChoiRest(xacThuc));
        return;
      }
      const user = xacThuc.user;

      const available = await isGgufAvailable();
      if (!available) {
        res.status(503).json({ error: "GGUF engine not available" });
        return;
      }

      const {
        prompt, systemPrompt, modelId,
        maxTokens, temperature, topP, topK,
        repeatPenalty, stopSequences, jsonMode, language,
      } = req.body;

      if (!prompt || typeof prompt !== "string") {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      phat = new OngPhatSSE(res);

      // Abort GGUF generation when client disconnects
      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      const stream = generateTextStream(
        {
          prompt,
          systemPrompt,
          maxTokens: maxTokens ?? 1024,
          temperature: temperature ?? 0.7,
          topP, topK, repeatPenalty, stopSequences,
          jsonMode: jsonMode ?? false,
          language: language ?? "vi",
        },
        modelId,
        abortController.signal,
      );

      for await (const chunk of stream) {
        if (res.destroyed) break;
        phat.phatChunk(chunk);
      }

      phat.ketThuc();
    } catch (err: unknown) {
      if (!res.headersSent) {
        res.status(500).json({ error: chuoiLoiAn(err) });
      } else {
        (phat ?? new OngPhatSSE(res)).phatLoi(err);
        res.end();
      }
    }
  });

  // ─── SSE: Chat Completion Stream ────────────────────
  app.post("/api/ai/stream/chat", async (req, res) => {
    let phat: OngPhatSSE | null = null;
    try {
      const xacThuc = await thuXacThucRest(req);
      if (!xacThuc.ok) {
        res.status(xacThuc.ma).json(thanTuChoiRest(xacThuc));
        return;
      }
      const user = xacThuc.user;

      const available = await isGgufAvailable();
      if (!available) {
        res.status(503).json({ error: "GGUF engine not available" });
        return;
      }

      const { messages, modelId, maxTokens, temperature, topP, topK, repeatPenalty, jsonMode } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      phat = new OngPhatSSE(res);

      // Abort GGUF generation when client disconnects
      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      const stream = chatCompletionStream(
        {
          messages,
          maxTokens: maxTokens ?? 1024,
          temperature: temperature ?? 0.7,
          topP, topK, repeatPenalty,
          jsonMode: jsonMode ?? false,
        },
        modelId,
        abortController.signal,
      );

      for await (const chunk of stream) {
        if (res.destroyed) break;
        phat.phatChunk(chunk);
      }

      phat.ketThuc();
    } catch (err: unknown) {
      if (!res.headersSent) {
        res.status(500).json({ error: chuoiLoiAn(err) });
      } else {
        (phat ?? new OngPhatSSE(res)).phatLoi(err);
        res.end();
      }
    }
  });

  // ─── SSE: Narrative Stream (Hybrid OpenAI + GGUF via provider router) ──
  app.post("/api/ai/stream/narrative", async (req, res) => {
    let phat: OngPhatSSE | null = null;
    try {
      const xacThuc = await thuXacThucRest(req);
      if (!xacThuc.ok) {
        res.status(xacThuc.ma).json(thanTuChoiRest(xacThuc));
        return;
      }
      const user = xacThuc.user;

      const { prompt, systemPrompt, maxTokens, temperature, language } = req.body;
      if (!prompt || typeof prompt !== "string") {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      phat = new OngPhatSSE(res);

      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      const stream = generateNarrativeStream(
        {
          prompt,
          systemPrompt,
          maxTokens: maxTokens ?? 1024,
          temperature: temperature ?? 0.7,
          language: language ?? "vi",
        },
        abortController.signal,
      );

      for await (const chunk of stream) {
        if (res.destroyed) break;
        phat.phatChunk(chunk);
      }

      phat.ketThuc();
    } catch (err: unknown) {
      if (!res.headersSent) {
        res.status(500).json({ error: chuoiLoiAn(err) });
      } else {
        (phat ?? new OngPhatSSE(res)).phatLoi(err);
        res.end();
      }
    }
  });
}
