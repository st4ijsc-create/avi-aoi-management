/**
 * AI Local Knowledge Base Router — wraps Phase 2 KB APIs
 * Integrates codebase knowledge retrieval with chat system
 */

import {
  router,
  publicProcedure,
  moduleProcedure,
  moduleGate,
  adminProcedure as adminProcedureBase,
} from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
// ⚠ `health` CỐ Ý ở lại `publicProcedure` KHÔNG cổng — xem khối lý lẽ tại chỗ khai nó.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
import { z } from "zod";
import { appError } from "../_core/appError";
import { logger } from "../logger";
// doc69 B3 (Wave 5, AI#2) — closes the KB feedback loop: persist every vote to
// kb_answer_feedback ALONGSIDE (not instead of) the legacy JSONL append below.
// Additive + fail-safe (see aiKbFeedbackSignal.ts's top-of-file doc comment) — a
// missing/unmigrated table or any DB error never blocks this mutation.
import { recordAnswerFeedback } from "../services/aiKbFeedbackSignal";

// Knowledge base endpoints configuration
const KB_API_BASE = process.env.KB_API_BASE || "http://localhost:3000";

// ─── Schema ─────────────────────────────────────────────────────

const RetrieveInputSchema = z.object({
  question: z.string().min(1, "Question required"),
  topK: z.number().int().min(1).max(20).default(5),
});

const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const AskInputSchema = z.object({
  question: z.string().min(1, "Question required"),
  topK: z.number().int().min(1).max(20).default(5),
  history: z.array(ConversationMessageSchema).default([]),
  userRole: z.enum(["worker", "engineer", "manager", "it_admin"]).default("engineer"),
});

const FeedbackInputSchema = z.object({
  messageId: z.string().min(1),
  question: z.string(),
  answer: z.string().optional(),
  rating: z.number().int().min(-1).max(1),
  comment: z.string().optional(),
  toolName: z.string().max(64).optional().nullable(),
  // doc69 B3 (Wave 5) — the citations shown for this answer at feedback time
  // (chunk id + sourcePath), used ONLY to persist a per-source feedback snapshot
  // (kb_answer_feedback.citations) for the re-ranking aggregate. Optional/absent
  // stays backward-compatible with any older caller that doesn't send it.
  citations: z
    .array(
      z.object({
        id: z.string().optional(),
        sourcePath: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

// ─── KB API response shapes ───────────────────────────────────

interface KbHealthResponse {
  success?: boolean;
  ready: boolean;
  chunks: number;
  embeddings?: number;
  error?: string;
  /**
   * F14 — mã máy-đọc-được ĐI KÈM chuỗi kỹ thuật ở trường `error`.
   *
   * Thủ tục này KHÔNG ném khi hỏng: nó trả 200 OK kèm `error`. Nghĩa là `onError` phía
   * client không chạy, `appCode` không tồn tại, và `mapTrpcError` không bao giờ nhìn thấy
   * chuỗi ấy — người dùng đọc nguyên văn tiếng Anh. Trả CẢ HAI: mã cho người, chuỗi cho kỹ sư.
   */
  errorCode?: "OPERATION_FAILED" | "DEVICE_UNREACHABLE";
  errorParams?: Record<string, string | number>;
  // W0.2/W0.3 (doc 11) — honest health: capability + embed-provenance signals
  // surfaced by getKbHealth and passed through unchanged to the client.
  llmReady?: boolean;
  embedModel?: string | null;
  queryEmbedModel?: string;
  embedModelMatches?: boolean;
  kbBuiltAt?: string | null;
  chunkCount?: number;
  staleDays?: number | null;
  // doc69 B1 (Wave 5) — last autosync answer-eval gate outcome, passed through
  // unchanged from getKbHealth. null when autosync hasn't run a gated sync yet.
  // rollbackFailed (review fix) — true only when a rollback was needed but
  // BOTH restore attempts failed; the KB may be a mixed old/new corpus until
  // the next successful autosync self-heals it.
  lastAutosyncEvalGate?: {
    evalGate: "pass" | "fail" | "skipped";
    recall: number | null;
    reason?: string;
    rolledBack: boolean;
    rollbackFailed: boolean;
    at: string;
  } | null;
}

interface KbApiResult {
  success: boolean;
  data?: any;
  error?: string;
}

// ─── Helper: Fetch from KB API ────────────────────────────────

async function fetchKbApi<T>(endpoint: string, method: string = "GET", body?: unknown): Promise<T> {
  const url = `${KB_API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "queryLocalKb" }, `KB API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data as T;
  } catch (error) {
    logger.error(`[KB API] ${endpoint} failed:`, error as any);
    throw error;
  }
}

// ─── Router ─────────────────────────────────────────────────────

export const aiLocalKbRouter = router({
  /**
   * Check knowledge base health and readiness
   */
  // ⚠⚠ CỐ Ý **KHÔNG** khoá sau MOD_AI. Đây là một phép dò TRẠNG THÁI (trả `ready:false` khi hỏng),
  //    và `components/AILocalChatBubble.tsx` — gắn ở GỐC `App.tsx`, tức trên MỌI tuyến — là người
  //    gọi. Nó `enabled: open` nên không tự bắn mỗi trang, nhưng một `publicProcedure` chỉ nói
  //    "KB sẵn sàng chưa" thì khoá lại không giấu được gì mà lại thêm một đường hỏng.
  health: publicProcedure.query(async (): Promise<KbHealthResponse> => {
    try {
      const result = await fetchKbApi<KbHealthResponse>("/api/ai/local-kb/health", "GET");
      return result;
    } catch (error: any) {
      // W0.2 (doc 11) — conservative shape on transport failure (mirrors the
      // KbHealthResponse fields the client reads so the union stays uniform).
      return {
        success: false,
        ready: false,
        chunks: 0,
        embeddings: 0,
        errorCode: "OPERATION_FAILED" as const,
        errorParams: { operation: "kbHealthCheck" },
        // data-raw-ok: chi tiết KỸ THUẬT, ĐI KÈM errorCode ở trên.
        error: error.message,
        llmReady: false,
        embedModelMatches: true,
      };
    }
  }),

  /**
   * Retrieve codebase knowledge chunks using hybrid search
   * Input: question + optional topK
   * Output: intent, language, entities, confidence, citations, contexts
   */
  retrieve: protectedProcedure.input(RetrieveInputSchema).mutation(async ({ input }) => {
    try {
      const result = await fetchKbApi<KbApiResult>("/api/ai/local-kb/retrieve", "POST", input);
      if (result.success) {
        return {
          success: true,
          data: result.data,
        };
      } else {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "queryLocalKb" }, result.error || "Retrieval failed");
      }
    } catch (error: any) {
      return {
        success: false,
        errorCode: "OPERATION_FAILED" as const,
        errorParams: { operation: "queryLocalKb" },
        // data-raw-ok: chi tiết KỸ THUẬT, ĐI KÈM errorCode ở trên để client dịch câu cho
        // người dùng. Giữ nguyên văn vì đây là thứ duy nhất nói được hỏng ở đâu.
        error: error.message,
        data: null,
      };
    }
  }),

  /**
   * Ask a question about the codebase
   * Uses Phase 2 hybrid retrieval + Ollama generation or extractive fallback
   * Input: question + optional topK
   * Output: answer, intent, language, entities, confidence, citations, provider, cached
   */
  ask: protectedProcedure.input(AskInputSchema).mutation(async ({ input }) => {
    try {
      const result = await fetchKbApi<KbApiResult>("/api/ai/local-kb/ask", "POST", input);
      if (result.success) {
        return {
          success: true,
          data: result.data,
        };
      } else {
        throw appError("INTERNAL_SERVER_ERROR", "OPERATION_FAILED", { operation: "queryLocalKb" }, result.error || "Ask failed");
      }
    } catch (error: any) {
      return {
        success: false,
        errorCode: "OPERATION_FAILED" as const,
        errorParams: { operation: "queryLocalKb" },
        // data-raw-ok: chi tiết KỸ THUẬT, ĐI KÈM errorCode ở trên để client dịch câu cho
        // người dùng. Giữ nguyên văn vì đây là thứ duy nhất nói được hỏng ở đâu.
        error: error.message,
        data: null,
      };
    }
  }),

  /**
   * Reload KB artifacts (admin operation)
   * Used after rebuilding the knowledge base via Phase 1 pipeline
   */
  reload: adminProcedure.mutation(async () => {
    try {
      const result = await fetchKbApi("/api/ai/local-kb/reload", "POST");
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      return {
        success: false,
        errorCode: "OPERATION_FAILED" as const,
        errorParams: { operation: "queryLocalKb" },
        // data-raw-ok: chi tiết KỸ THUẬT, ĐI KÈM errorCode ở trên để client dịch câu cho
        // người dùng. Giữ nguyên văn vì đây là thứ duy nhất nói được hỏng ở đâu.
        error: error.message,
      };
    }
  }),

  /**
   * Submit feedback (thumbs up/down) for a KB answer
   *
   * doc69 B3 (Wave 5) — closes the feedback loop: persists to kb_answer_feedback
   * (the queryable source used by the re-ranking signal) ALONGSIDE the legacy
   * knowledge/feedback.jsonl append (kept, unchanged). The two writes are
   * independent — a DB hiccup never blocks the JSONL log and vice versa;
   * recordAnswerFeedback itself never throws (fail-safe on an unmigrated table
   * or any other DB error, see aiKbFeedbackSignal.ts).
   */
  feedback: protectedProcedure.input(FeedbackInputSchema).mutation(async ({ input, ctx }) => {
    const dbResult = await recordAnswerFeedback({
      messageId: input.messageId,
      question: input.question,
      rating: input.rating,
      citations: input.citations ?? [],
      userId: ctx.user.id,
    });

    try {
      const result = await fetchKbApi("/api/ai/local-kb/feedback", "POST", input);
      return { success: true, data: result, persisted: dbResult.persisted };
    } catch (error: any) {
      return {
        success: false,
        errorCode: "OPERATION_FAILED" as const,
        errorParams: { operation: "queryLocalKb" },
        // data-raw-ok: chi tiết KỸ THUẬT, ĐI KÈM errorCode ở trên để client dịch câu cho
        // người dùng. Giữ nguyên văn vì đây là thứ duy nhất nói được hỏng ở đâu.
        error: error.message,
        persisted: dbResult.persisted,
      };
    }
  }),
});
