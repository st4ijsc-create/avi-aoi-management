import type express from "express";
import fs from "node:fs";
import path from "node:path";
import { thuXacThucRest, thanTuChoiRest } from "./_xacThucRest";
// ★★★★ Review TOÀN NHÁNH Pha 9 · I-6 — chủ DUY NHẤT của cặp cổng "loopback HOẶC vai đặc quyền".
import { laLoopback, doiVaiDacQuyen as requirePrivileged } from "./_congLoopback";
import {
  answerQuestion,
  getKbHealth,
  reloadKbArtifacts,
  retrieveKnowledge,
  streamAnswer,
  warmUpOllamaModels,
  type ConversationMessage,
  type UserRole,
  type KbQueryContext,
  type KbLanguage,
} from "../services/aiLocalKnowledgeService";
import type { ToolExecContext, ToolLang } from "../services/aiLocalTools";
// P3/D8 (doc 34) — vision-in-chat. describeImage routes to the Qwen3-VL llama-server
// sidecar (load-on-demand); isVisionSidecarAvailable lets us degrade honestly to a
// text-only answer when no local VL sidecar is configured (never crash the stream).
import { describeImage } from "../services/aiGgufEngine";
import { isVisionSidecarAvailable } from "../services/llamaVisionSidecar";

// Stage 13.D — feedback log path. JSONL append-only for easy diffing &
// future re-ingestion into KB curation.
const FEEDBACK_LOG_PATH = path.resolve(process.cwd(), "knowledge", "feedback.jsonl");

const VALID_USER_ROLES: ReadonlySet<UserRole> = new Set([
  "worker",
  "engineer",
  "manager",
  "it_admin",
]);

function parseHistory(raw: unknown): ConversationMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      out.push({ role, content });
    }
  }
  return out.slice(-12);
}

function parseUserRole(raw: unknown): UserRole {
  if (typeof raw === "string" && VALID_USER_ROLES.has(raw as UserRole)) {
    return raw as UserRole;
  }
  return "engineer";
}

const VALID_UI_LANGUAGES: ReadonlySet<KbLanguage> = new Set(["vi", "en", "zh"]);

// C3a — parse the optional page context from the request body. Whitelists known
// fields, coerces types, drops unknown keys. Returns undefined when absent or
// empty so the service falls back to legacy behavior (backward-compatible).
function parseContext(raw: unknown): KbQueryContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const ctx: KbQueryContext = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  if (str(r.route)) ctx.route = str(r.route);
  if (typeof r.uiLanguage === "string" && VALID_UI_LANGUAGES.has(r.uiLanguage as KbLanguage)) {
    ctx.uiLanguage = r.uiLanguage as KbLanguage;
  }
  if (str(r.selectedMachineCode)) ctx.selectedMachineCode = str(r.selectedMachineCode);
  if (num(r.selectedMachineId) != null) ctx.selectedMachineId = num(r.selectedMachineId);
  if (str(r.selectedProductCode)) ctx.selectedProductCode = str(r.selectedProductCode);
  if (num(r.selectedProductModelId) != null) ctx.selectedProductModelId = num(r.selectedProductModelId);
  if (str(r.selectedLot)) ctx.selectedLot = str(r.selectedLot);
  // ★★★ doc 79 · TRỤC 1 (A) — cờ phiên lập trình. CHỈ chấp nhận literal `true` (một client vận hành
  // không bao giờ vô tình bật nó); mọi giá trị khác ⇒ vắng ⇒ đường vận hành mặc định.
  if (r.codingMode === true) ctx.codingMode = true;

  return Object.keys(ctx).length > 0 ? ctx : undefined;
}

// GĐ2 — build the write-action exec context from the REAL authenticated user.
// `lang` mirrors how the SSE error branch picks a language. The user's true
// id/role drive RBAC (never the body.userRole, which only shapes tone).
function buildExecCtx(
  user: { id: number; role: string; name?: string | null },
  req: any,
  question: string,
  context?: KbQueryContext,
): ToolExecContext {
  const lang: ToolLang = /[一-鿿]/.test(question)
    ? "zh"
    : /[À-ỹ]/.test(question)
      ? "vi"
      : context?.uiLanguage ?? "vi";
  return {
    user: { id: user.id, role: String(user.role), name: user.name ?? null },
    lang,
    req: { ip: req?.ip, headers: req?.headers, socket: req?.socket },
  };
}

// ─── P3/D8 (doc 34) — vision-in-chat ─────────────────────────────────────────
// An engineer can attach a photo (ladder/LD diagram, HMI screen, wiring diagram,
// datasheet page, or an error/alarm screen). We read it with Qwen3-VL, emit a
// visible "vision" step, then fold the VL reading INTO the question so the normal
// RAG + answer pipeline combines it with the vendor manuals (e.g. VL reads
// "AL.32" → RAG looks up AL.32 in the manual → grounded answer). The reading is
// advisory only — the existing "verify before acting" posture is unchanged.

const MAX_CHAT_IMAGE_BYTES = (() => {
  const mb = Number(process.env.CHAT_VISION_MAX_IMAGE_MB ?? 6);
  return (Number.isFinite(mb) && mb > 0 ? mb : 6) * 1024 * 1024;
})();
const ACCEPTED_CHAT_IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

interface ParsedChatImage {
  buffer: Buffer;
  mime: string;
}

/** Language for the VL prompt/answer — mirrors buildExecCtx's heuristic. */
function detectChatLang(question: string, context?: KbQueryContext): KbLanguage {
  if (/[一-鿿]/.test(question)) return "zh";
  if (/[À-ỹ]/.test(question)) return "vi";
  return context?.uiLanguage ?? "vi";
}

/**
 * Parse an optional inline image (base64 data URL, or bare base64 + a mimeType
 * hint) from the request body. Returns the decoded buffer on success, an { error }
 * code on a validation failure, or null when no image was supplied. NEVER throws.
 */
function parseInlineImage(
  raw: unknown,
  mimeHint: unknown,
): ParsedChatImage | { error: "type" | "size" | "decode" } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let b64 = raw.trim();
  let mime = typeof mimeHint === "string" ? mimeHint.toLowerCase().trim() : "";
  const m = b64.match(/^data:([a-z0-9.+/-]+);base64,(.*)$/is);
  if (m) {
    mime = m[1].toLowerCase();
    b64 = m[2];
  }
  b64 = b64.replace(/\s/g, "");
  if (!b64) return null;
  if (!mime) mime = "image/png";
  if (!ACCEPTED_CHAT_IMAGE_MIME.has(mime)) return { error: "type" };
  // Cheap upper-bound on the base64 string before allocating the buffer.
  if (b64.length > Math.ceil((MAX_CHAT_IMAGE_BYTES * 4) / 3) + 16) {
    return { error: "size" };
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64, "base64");
  } catch {
    return { error: "decode" };
  }
  if (buffer.length === 0) return null;
  if (buffer.length > MAX_CHAT_IMAGE_BYTES) return { error: "size" };
  return { buffer, mime };
}

function buildVisionPrompt(question: string, lang: KbLanguage): string {
  const q = question.trim();
  if (lang === "zh") {
    return [
      "你是自动化工程师。请仔细阅读这张技术图片（可能是梯形图/LD、HMI 画面、接线图、数据手册页面，或报错/报警画面）。",
      "准确提取图中真实可见的内容：报警/错误代码（如 AL.32、ERR、E-052）、信号标签/名称、参数数值、梯形逻辑、接线关系。",
      "只描述图中确实存在的内容，不要臆测。",
      q ? `用户的问题：“${q}”。请聚焦相关部分。` : "",
    ].filter(Boolean).join("\n");
  }
  if (lang === "vi") {
    return [
      "Bạn là kỹ sư tự động hóa. Hãy đọc kỹ hình ảnh kỹ thuật này (có thể là sơ đồ ladder/LD, màn hình HMI, sơ đồ đấu dây, trang datasheet, hoặc màn hình báo lỗi/alarm).",
      "Trích xuất CHÍNH XÁC những gì thực sự nhìn thấy: mã lỗi/alarm (vd AL.32, ERR, E-052), nhãn/tên tín hiệu, giá trị thông số, logic ladder, cách đấu dây.",
      "Chỉ mô tả những gì thực sự có trong ảnh, KHÔNG suy diễn.",
      q ? `Người dùng hỏi: “${q}”. Hãy tập trung vào phần liên quan.` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    "You are an automation engineer. Carefully read this technical image (it may be a ladder/LD diagram, an HMI screen, a wiring diagram, a datasheet page, or an error/alarm screen).",
    "Extract EXACTLY what is actually visible: alarm/error codes (e.g. AL.32, ERR, E-052), signal labels/names, parameter values, ladder logic, wiring.",
    "Only describe what is truly present in the image; do NOT speculate.",
    q ? `The user asks: “${q}”. Focus on the relevant part.` : "",
  ].filter(Boolean).join("\n");
}

function augmentQuestionWithVision(
  question: string,
  visionText: string,
  lang: KbLanguage,
): string {
  const header =
    lang === "zh"
      ? "[附加图片内容 — 由视觉模型 Qwen3-VL 读取]"
      : lang === "vi"
        ? "[Nội dung ảnh đính kèm — do thị giác máy Qwen3-VL đọc]"
        : "[Attached image content — read by the Qwen3-VL vision model]";
  return `${question}\n\n${header}:\n${visionText}`.trim();
}

export interface ChatVisionNote {
  ok: boolean;
  visionText?: string;
  reason?: "type" | "size" | "decode" | "unavailable" | "empty" | "error";
}

/**
 * If an image is attached, read it with Qwen3-VL and fold the reading into the
 * question. Returns the (possibly augmented) question plus a UI note describing
 * the vision step. Fail-safe: any problem degrades to the original question with
 * a note — it NEVER throws, so the chat always continues text-only.
 */
async function applyChatVision(
  question: string,
  imageRaw: unknown,
  mimeHint: unknown,
  lang: KbLanguage,
): Promise<{ effectiveQuestion: string; vision: ChatVisionNote | null }> {
  const parsed = parseInlineImage(imageRaw, mimeHint);
  if (parsed === null) return { effectiveQuestion: question, vision: null };
  if ("error" in parsed) {
    return { effectiveQuestion: question, vision: { ok: false, reason: parsed.error } };
  }
  if (!isVisionSidecarAvailable()) {
    return { effectiveQuestion: question, vision: { ok: false, reason: "unavailable" } };
  }
  try {
    const maxTokensRaw = Number(process.env.CHAT_VISION_MAX_TOKENS ?? 512);
    const result = await describeImage({
      image: parsed.buffer,
      prompt: buildVisionPrompt(question, lang),
      language: lang === "vi" ? "vi" : "en",
      maxTokens: Number.isFinite(maxTokensRaw) && maxTokensRaw > 0 ? maxTokensRaw : 512,
      temperature: 0.1,
    });
    const visionText = (result.text ?? "").trim();
    if (!visionText) return { effectiveQuestion: question, vision: { ok: false, reason: "empty" } };
    return {
      effectiveQuestion: augmentQuestionWithVision(question, visionText, lang),
      vision: { ok: true, visionText },
    };
  } catch (err: any) {
    console.warn("[aiLocalKnowledge] chat vision failed (non-fatal):", err?.message ?? err);
    return { effectiveQuestion: question, vision: { ok: false, reason: "error" } };
  }
}

function chunkAnswerForStream(answer: string): string[] {
  // Split into roughly word-sized tokens so the UI sees progressive updates
  // without overwhelming the SSE channel. Keep whitespace attached to the
  // preceding token so concatenation reproduces the original text exactly.
  const matches = answer.match(/\S+\s*|\s+/g);
  return matches ?? [answer];
}

export function registerAiLocalKnowledgeRoutes(app: express.Express) {
  // Kick off Ollama warm-up so the embed + QA models are loaded before the
  // first user question (otherwise the first ask pays a cold-load penalty).
  warmUpOllamaModels();

  app.get("/api/ai/local-kb/health", async (_req, res) => {
    try {
      // W0.2/W0.3 (doc 11) — getKbHealth is now async (probes LLM loadability +
      // embed-model match). New fields spread through to the client unchanged.
      const health = await getKbHealth();
      res.json({
        success: true,
        ...health,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to get KB health",
      });
    }
  });

  app.post("/api/ai/local-kb/reload", async (req, res) => {
    try {
      const xacThuc = await thuXacThucRest(req);
      if (!xacThuc.ok) {
        res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
        return;
      }
      const user = xacThuc.user;

      const health = await reloadKbArtifacts();
      res.json({ success: true, health });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to reload KB artifacts",
      });
    }
  });

  app.post("/api/ai/local-kb/retrieve", async (req, res) => {
    try {
      const xacThuc = await thuXacThucRest(req);
      if (!xacThuc.ok) {
        res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
        return;
      }
      const user = xacThuc.user;

      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      const topK = Number(req.body?.topK ?? 5);
      if (!question) {
        res.status(400).json({ success: false, error: "question is required" });
        return;
      }

      // Final-fix round, Task 6 (SECURITY) — this endpoint used to call retrieveKnowledge()
      // with NO context at all, discarding the just-authenticated `user.role` entirely. That's
      // exactly the gap the Studio-corpus role gate (canAccessStudioCorpus, inside
      // retrieveKnowledge) closes: `callerRole` here is the REAL DB role, never client-supplied.
      const data = await retrieveKnowledge(question, topK, { callerRole: String((user as any).role) });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to retrieve knowledge",
      });
    }
  });

  app.post("/api/ai/local-kb/ask", async (req, res) => {
    try {
      const xacThuc = await thuXacThucRest(req);
      if (!xacThuc.ok) {
        res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
        return;
      }
      const user = xacThuc.user;

      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      const topK = Number(req.body?.topK ?? 5);
      if (!question) {
        res.status(400).json({ success: false, error: "question is required" });
        return;
      }

      const history = parseHistory(req.body?.history);
      const userRole = parseUserRole(req.body?.userRole);
      const context = parseContext(req.body?.context);
      const execCtx = buildExecCtx(user as any, req, question, context);
      // P3/D8 (doc 34) — optional attached image: read via Qwen3-VL, fold into the
      // question so the answer combines the VL reading with manual RAG. Degrades to
      // a text-only answer (with a note) if VL is unavailable.
      const lang = detectChatLang(question, context);
      const { effectiveQuestion, vision } = await applyChatVision(
        question,
        req.body?.image,
        req.body?.imageMimeType,
        lang,
      );
      const data = await answerQuestion(effectiveQuestion, topK, history, userRole, context, execCtx);
      res.json({ success: true, data: { ...data, vision } });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to answer question",
      });
    }
  });

  // SSE streaming endpoint. Emits `meta`, optional `tool`, one or more
  // `token` events, then `done`. Falls back to chunked emission of the
  // final answer when an LLM is not available locally.
  app.post("/api/ai/local-kb/stream", async (req, res) => {
    const xacThuc = await thuXacThucRest(req);
    if (!xacThuc.ok) {
      res.status(xacThuc.ma).json({ success: false, ...thanTuChoiRest(xacThuc) });
      return;
    }
    const user = xacThuc.user;

    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    const topK = Number(req.body?.topK ?? 5);
    if (!question) {
      res.status(400).json({ success: false, error: "question is required" });
      return;
    }

    const history = parseHistory(req.body?.history);
    const userRole = parseUserRole(req.body?.userRole);
    const context = parseContext(req.body?.context);
    const execCtx = buildExecCtx(user as any, req, question, context);

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    const send = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    try {
      // P3/D8 (doc 34) \u2014 if an image is attached, read it with Qwen3-VL FIRST and
      // fold the reading into the question. Emit a visible `vision` step so the
      // user sees what the model read. Fail-safe: degrades to a text-only answer
      // (with a note) on any problem \u2014 it never aborts the stream.
      const lang = detectChatLang(question, context);
      const { effectiveQuestion, vision } = await applyChatVision(
        question,
        req.body?.image,
        req.body?.imageMimeType,
        lang,
      );
      if (vision && !closed) {
        send({
          type: "vision",
          ok: vision.ok,
          visionText: vision.visionText ?? null,
          reason: vision.reason ?? null,
        });
      }

      // Real token streaming: stream the LLM output as it's generated so
      // the user sees the first words within ~1-2s instead of waiting for
      // the entire answer. `streamAnswer` runs the full pipeline (tool +
      // retrieve + LLM) and yields events in order: meta \u2192 [tool] \u2192
      // token* \u2192 done. Falls back to extractive/tool text inside the
      // generator when the LLM isn't reachable.
      let followUpSuggestions: string[] = [];
      let finalAnswer = "";
      let finalProvider: "ollama" | "extractive" | "tool" = "extractive";
      let cached = false;
      let structured: Record<string, unknown> | undefined;
      // FE-W0.3 (doc 46 §2.3) — degenerate-loop signal forwarded to the client.
      let degraded = false;
      let degradedReason: string | undefined;

      for await (const evt of streamAnswer(effectiveQuestion, topK, history, userRole, context, execCtx)) {
        if (closed) return;
        switch (evt.type) {
          case "meta":
            send({
              type: "meta",
              intent: evt.intent,
              language: evt.language,
              confidence: evt.confidence,
              citations: evt.citations,
            });
            break;
          case "tool":
            send({
              type: "tool",
              toolName: evt.toolName,
              toolResult: evt.toolResult,
            });
            break;
          case "pending_action":
            send({
              type: "pending_action",
              toolName: evt.toolName,
              pendingAction: evt.pendingAction,
            });
            break;
          case "client_action":
            send({
              type: "client_action",
              toolName: evt.toolName,
              clientAction: evt.clientAction,
            });
            break;
          case "token":
            send({ type: "token", token: evt.token });
            break;
          case "done":
            followUpSuggestions = evt.followUpSuggestions;
            finalAnswer = evt.answer;
            finalProvider = evt.provider;
            cached = evt.cached;
            structured = evt.structured as any;
            // FE-W0.3 (doc 46 §2.3) — carry the degenerate-loop flag through.
            degraded = evt.degraded ?? false;
            degradedReason = evt.degradedReason;
            break;
        }
      }

      if (!closed) {
        send({
          type: "done",
          provider: finalProvider,
          cached,
          followUpSuggestions,
          answer: finalAnswer,
          structured,
          // FE-W0.3 (doc 46 §2.3) — tell the client to replace streamed garbage with `answer`.
          ...(degraded ? { degraded: true, degradedReason } : {}),
        });
      }
    } catch (error: any) {
      if (!closed) {
        send({
          type: "error",
          error: error?.message ?? "Stream failed",
          language: /[\u4e00-\u9fff]/.test(question)
            ? "zh"
            : /[\u00c0-\u1ef9]/.test(question)
              ? "vi"
              : context?.uiLanguage ?? "en",
        });
      }
    } finally {
      if (!closed) res.end();
    }
  });

  /**
   * Stage 13.D — user feedback (👍 / 👎) on a single answer.
   * Path matches what `aiLocalKbRouter.feedback` POSTs to via `fetchKbApi`
   * (server-to-server localhost call — no cookie forwarded).
   * Persisted to `knowledge/feedback.jsonl` for later curation.
   *
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-6 — "TRONG LOCALHOST" PHẢI LÀ MỘT CƠ CHẾ, KHÔNG PHẢI MỘT CÂU.**
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Bình luận cũ ở đúng dòng này khai *"lượt gọi máy-sang-máy trong localhost … tầng tRPC đã cưỡng
   * chế phiên"* và kết luận tuyến *"cố ý auth-free"*. **Không có cơ chế nào cưỡng chế mệnh đề "trong
   * localhost"** — nó là một **mô tả về người gọi có thiện chí**, không phải một điều kiện được kiểm.
   *
   * **Đo sống trước bản vá** (máy chủ đang chạy, KHÔNG cookie):
   *
   *     curl -X POST -d '{}' http://127.0.0.1:3000/api/ai/local-kb/feedback
   *     {"success":false,"error":"messageId and question are required"}   HTTP=400
   *
   * **400, không phải 401** ⇒ thân handler chạy **trước** mọi phép xác thực. Mỗi lượt gọi hợp lệ
   * **append một dòng** tới ~10 KB vào một tệp **trong repo** ⇒ bất kỳ ai với tới cổng 3000 đều ghi
   * được không giới hạn (đầy đĩa) và bơm nội dung tuỳ ý vào đúng kho *"để tái nạp vào KB curation"*.
   *
   * ⇒ Cơ chế nay **giống hệt** `/api/observability/metrics` (`observabilityRoutes.ts`): **loopback
   *   HOẶC phiên đặc quyền**. Lượt gọi tự-thân (`KB_API_BASE` mặc định `http://localhost:3000`)
   *   thoả nhánh thứ nhất ⇒ **không khoá ai ra ngoài**.
   * ⚠ CAVEAT ĐƯỢC KHAI: nếu một triển khai đặt `KB_API_BASE` sang một địa chỉ **không loopback**
   *   thì lượt tự-thân rơi sang nhánh thứ hai và **không có cookie** ⇒ 401. Đó là một cấu hình
   *   không tồn tại trong `.env` hôm nay, và nó phải được đổi **cùng lúc** với một đường mang danh
   *   tính — không được sửa bằng cách gỡ phép kiểm này.
   */
  app.post("/api/ai/local-kb/feedback", async (req, res) => {
    if (!laLoopback(req)) {
      const auth = await requirePrivileged(req);
      if (!auth.ok) {
        res.status(auth.status).json({ success: false, error: auth.message });
        return;
      }
    }
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
      const question = typeof body.question === "string" ? body.question.trim() : "";
      const ratingRaw = Number(body.rating);
      if (!messageId || !question) {
        res.status(400).json({ success: false, error: "messageId and question are required" });
        return;
      }
      if (!Number.isFinite(ratingRaw) || ratingRaw < -1 || ratingRaw > 1) {
        res.status(400).json({ success: false, error: "rating must be -1, 0, or 1" });
        return;
      }

      const entry = {
        ts: new Date().toISOString(),
        messageId,
        question: question.slice(0, 2000),
        answer: typeof body.answer === "string" ? body.answer.slice(0, 8000) : null,
        rating: Math.round(ratingRaw),
        comment: typeof body.comment === "string" ? body.comment.slice(0, 2000) : null,
        toolName: typeof body.toolName === "string" ? body.toolName : null,
      };

      await fs.promises.mkdir(path.dirname(FEEDBACK_LOG_PATH), { recursive: true });
      await fs.promises.appendFile(FEEDBACK_LOG_PATH, JSON.stringify(entry) + "\n", "utf8");

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to record feedback",
      });
    }
  });
}
