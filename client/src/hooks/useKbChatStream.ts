/**
 * useKbChatStream — P3/W3.1 (doc 11)
 *
 * SSE hook for the RAG-grounded local knowledge-base backend
 * (/api/ai/local-kb/stream). Unlike the bare useAIStream (→ /api/ai/stream/chat,
 * a plain LLM chat with NO RAG/tools), this connects to the SAME endpoint the
 * floating AI chat bubble uses, so /ai-chat answers with full knowledge-base
 * retrieval + the aiLocalTools registry (read/write/client tools).
 *
 * It mirrors AILocalChatBubble.handleAsk's fetch + SSE parse for the local-kb
 * event set and surfaces the streaming text PLUS the structured extras:
 *   - meta:           confidence / intent / language / citations
 *   - tool:           toolResult + toolName  (→ AIToolResultCard)
 *   - pending_action: a proposed WRITE (HITL confirm) — surfaced, NEVER executed here
 *   - client_action:  navigate / prefill_form — fired via callbacks (wouter + copilot ctx)
 *   - token:          progressive answer tokens
 *   - done:           structured / followUpSuggestions / provider / cached
 *   - error
 *
 * The hook is intentionally generic about navigation/prefill: the caller passes
 * onClientAction so this stays decoupled from wouter/AiCopilotContext.
 */

import { useState, useRef, useCallback } from "react";
import type { ToolResultPayload } from "@/components/AIToolResultCard";
import { thongDiepLoiRest } from "@/lib/restAuthError";
import { mapTrpcError } from "@/lib/trpcErrors";

// ─── P3/D8 (doc 34) — shared image-attach helpers (reused by the chat bubble) ──
// Kept here (AIChatPage already imports this hook) so BOTH chat surfaces share one
// set of limits + file→dataURL logic without introducing a new module.
export const MAX_CHAT_IMAGE_BYTES = 6 * 1024 * 1024; // 6 MB — matches the server cap
export const ACCEPTED_CHAT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export interface ChatImageAttachment {
  /** data:image/<mime>;base64,<...> — sent to the backend as `image`. */
  dataUrl: string;
  name: string;
  type: string;
  sizeBytes: number;
}

/** null = OK; otherwise a reason code the caller maps to a localized toast. */
export type ChatImageError = "type" | "size" | "read";

export function validateChatImageFile(file: File): ChatImageError | null {
  if (
    !ACCEPTED_CHAT_IMAGE_TYPES.includes(
      file.type as (typeof ACCEPTED_CHAT_IMAGE_TYPES)[number],
    )
  ) {
    return "type";
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) return "size";
  return null;
}

export function readChatImageFile(file: File): Promise<ChatImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        dataUrl: String(reader.result ?? ""),
        name: file.name || "image",
        type: file.type || "image/png",
        sizeBytes: file.size,
      });
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

/** Pull the first image File out of a paste event's clipboard items (or null). */
export function extractImageFromClipboard(
  items: DataTransferItemList | undefined | null,
): File | null {
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

// P3/D8 (doc 34) — the "vision step" note surfaced by the backend when an image
// was attached: ok=true carries the Qwen3-VL reading; ok=false carries a reason so
// the UI can show an honest text-only-degrade message.
export interface KbVisionNote {
  ok: boolean;
  visionText?: string | null;
  reason?: string | null;
}

// ─── Public types (mirror the bubble's local-kb shapes) ───────────────────────

export interface KbCitation {
  title: string;
  sourcePath: string;
  // doc69 B3 (Wave 5) — deep-link target, resolved server-side ONLY for a KNOWN
  // operational card whose route passes the ALLOWED_CLIENT_ROUTES whitelist (see
  // server/services/aiOperationalGrounding.ts's resolveCitationRoute). null/absent
  // means the citation has no safe navigable target — render it as plain,
  // non-clickable text (never navigate to an arbitrary string).
  route?: string | null;
  // Present when the server can supply them (chunk id / source kind) — optional so
  // older payload shapes stay valid.
  id?: string;
  sourceType?: string;
  // Wave 2 đường B — "system" (KB corpus tệp, mặc định/vắng mặt) hay "studio" (tài
  // liệu người dùng tự nạp vào Training Studio, server/services/kbVectorStore.ts).
  origin?: "system" | "studio";
}

export interface KbStructured {
  navigationPath?: string;
  steps?: string[];
  recommendations?: string[];
  hasCode?: boolean;
}

export interface KbConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// GĐ2 — pending write-action proposed by the AI Copilot (HITL confirm).
export interface KbPendingActionChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  displayName?: string;
}
export interface KbPendingAction {
  actionId: string;
  token: string;
  tool: string;
  // doc 78 PHA D — args THẬT của lượt đề xuất (server gửi nguyên PendingActionDTO qua SSE). Với
  // `apply_diff` là `{ path, original, modified }` — đủ để client dựng HunkDiffView (diff đầy đủ).
  // Chỉ để HIỂN THỊ; mọi lượt ghi vẫn qua confirmAction (server đọc args từ hàng ai_pending_actions).
  args?: Record<string, unknown>;
  summary: string;
  preview: {
    entityType: string;
    entityId?: number;
    entityName?: string;
    changes: KbPendingActionChange[];
    warnings: string[];
    humanSummary: string;
  };
  expiresAt: string;
}

export interface KbClientAction {
  action: "navigate" | "prefill_form";
  route: string;
  values?: Record<string, unknown>;
  message: string;
  /**
   * doc69 G2-7 — true when the backend ATTACHED this directive to ground a
   * how-to answer (server/services/aiOperationalGrounding.ts), as opposed to an
   * explicit user command ("mở trang X"). The caller must NOT auto-navigate when
   * this is true — render a tappable "Mở màn X" button instead, since the user
   * didn't ask to leave the answer they're reading.
   */
  suggested?: boolean;
}

/** Final aggregated result returned by startKbStream when the stream completes. */
export interface KbStreamResult {
  /** The full assistant answer text (accumulated tokens or extractive fallback). */
  fullText: string;
  confidence: number;
  intent: string;
  language: string;
  citations: KbCitation[];
  toolResult: ToolResultPayload | null;
  toolName: string | null;
  structured?: KbStructured;
  followUpSuggestions?: string[];
  provider?: string;
  cached?: boolean;
  pendingAction: KbPendingAction | null;
  // P3/D8 (doc 34) — set when an image was attached (VL reading or degrade note).
  vision: KbVisionNote | null;
  // doc69 G2-7 — navigate/prefill_form directive fired during this turn (mirrors
  // toolResult/pendingAction: also delivered live via onClientAction, but
  // aggregated here too so callers that only read the final result — not the
  // live callback — can still render the "ask→do" button after the turn ends).
  clientAction: KbClientAction | null;
}

export interface KbStreamContext {
  route: string;
  uiLanguage: string;
  selectedMachineCode?: string;
  // ★★★ doc 79 · TRỤC 1 (A) — true khi phiên chat là phiên LẬP TRÌNH (/ai-coding-workspace). Server
  // (streamAnswer) định tuyến tới tác nhân lập trình + 5 tool lập trình, KHÔNG tới trợ lý vận hành.
  codingMode?: boolean;
  // ★★★ doc 79 · TRỤC 2 — id DỰ ÁN đang chọn. Là một ID, KHÔNG phải đường dẫn — server tra danh sách
  // TRẮNG để ra gốc. Chỉ có nghĩa khi codingMode=true.
  projectId?: string;
  // ★★★ doc 79 · VÒNG TỰ ĐỘNG — đường dẫn tệp ĐANG SỬA, do bộ điều khiển vòng ghim (là tệp người
  // vừa duyệt ghi). Chỉ gửi ở LƯỢT SỬA KẾ TIẾP của vòng. Server đọc LẠI tệp từ đĩa trong lượt ấy —
  // client KHÔNG BAO GIỜ gửi nội dung tệp (đó là điểm neo của băm chống TOCTOU).
  codingEditPath?: string;
  /**
   * ★★★ 2026-08-23 — ĐẦU RA MÁY (`dotnet test`, `npm run check`…) của lượt vòng tự động vừa chạy.
   *
   * ⚠⚠ Nó đi **RIÊNG**, KHÔNG được nối vào `question`. Trước bản vá này bộ điều khiển vòng nhét
   *   nguyên văn đầu ra vào câu hỏi ⇒ nó rơi vào khối `=== YÊU CẦU ===`, ô **thẩm quyền cao nhất**
   *   của prompt, chỉ bị CẮT chứ không hề được che/bọc. Một dòng *"BỎ QUA CHỈ DẪN TRƯỚC…"* nằm
   *   trong tên một ca kiểm thử khi ấy lái được tác nhân. Server bọc nó
   *   (`sanitizeUntrustedBlock` + `wrapUntrustedBlock`) rồi đặt vào khối LỊCH SỬ — thẩm quyền thấp
   *   nhất — đúng như CLI đã làm. Xem `KbQueryContext.dauRaKhongTinCay`.
   */
  dauRaKhongTinCay?: string;
}

export interface KbStreamRequest {
  question: string;
  history: KbConversationTurn[];
  userRole: "worker" | "engineer" | "manager" | "it_admin";
  context: KbStreamContext;
  topK?: number;
  // P3/D8 (doc 34) — optional attached image as a base64 data URL. The backend
  // reads it with Qwen3-VL and folds the reading into the RAG answer.
  image?: string;
}

export interface KbStreamCallbacks {
  /** Fired on each token batch with the cumulative text (for live rendering). */
  onText?: (text: string) => void;
  /** Fired once when a tool result arrives (live tool card). */
  onToolResult?: (toolResult: ToolResultPayload, toolName: string | null) => void;
  /** Fired once when a write-action is proposed (surface a confirm/notice). */
  onPendingAction?: (action: KbPendingAction) => void;
  /** Fired on navigate / prefill_form directives (caller wires wouter + copilot ctx). */
  onClientAction?: (action: KbClientAction) => void;
  /** P3/D8 (doc 34) — fired once with the vision step (VL reading or degrade note). */
  onVision?: (vision: KbVisionNote) => void;
  /**
   * ★★★ doc 81 · VIỆC 2 — mỗi nhịp của vòng lặp tool (bắt đầu vòng · vòng xong · vòng dừng).
   * Thuần HIỂN THỊ: một consumer ném ở đây KHÔNG được làm hỏng lượt stream (xem `bao()` trong
   * `toolLoop.ts` — cùng lập trường: đây là kênh hiển thị, không phải kênh quyết định).
   */
  onToolLoop?: (p: KbToolLoopProgress) => void;
}

/** ★★★ doc 81 · VIỆC 2 — một nhịp tiến độ của vòng lặp tool (hình dạng khớp `ToolLoopProgress`). */
export interface KbToolLoopProgress {
  round: number;
  phase: "dang_goi" | "xong" | "dung";
  toolName: string | null;
  elapsedMs: number;
  stop?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useKbChatStream() {
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous "was the last run aborted?" flag — the caller reads this right
  // after the await (state updates are async, so it can't trust `error` for
  // control flow). True only when the user cancelled via stopKbStream.
  const abortedRef = useRef(false);

  const startKbStream = useCallback(
    async (
      req: KbStreamRequest,
      callbacks?: KbStreamCallbacks,
    ): Promise<KbStreamResult | null> => {
      setIsStreaming(true);
      setStreamingText("");
      setError(null);
      abortedRef.current = false;

      const controller = new AbortController();
      abortRef.current = controller;

      // Build the local-kb payload (same shape the bubble sends). Only include
      // selectedMachineCode when present so the backend treats it as absent.
      const context: Record<string, unknown> = {
        route: req.context.route,
        uiLanguage: req.context.uiLanguage,
      };
      if (req.context.selectedMachineCode) {
        context.selectedMachineCode = req.context.selectedMachineCode;
      }
      // ★★★ doc 79 · TRỤC 1 (A) — chỉ gửi khi TRUE (giữ payload vận hành không đổi một byte).
      if (req.context.codingMode) {
        context.codingMode = true;
      }
      // ★★★ doc 79 · TRỤC 2 — gửi id DỰ ÁN (KHÔNG phải đường dẫn) để server tra danh sách trắng.
      if (req.context.projectId) {
        context.projectId = req.context.projectId;
      }
      // ★★★ doc 79 · VÒNG TỰ ĐỘNG — chỉ gửi khi vòng đang ghim một tệp (payload các lượt khác
      // KHÔNG đổi một byte).
      if (req.context.codingEditPath) {
        context.codingEditPath = req.context.codingEditPath;
      }
      // ★★★ 2026-08-23 — đầu ra máy đi RIÊNG khỏi `question`. Xem `KbStreamContext.dauRaKhongTinCay`.
      if (req.context.dauRaKhongTinCay) {
        context.dauRaKhongTinCay = req.context.dauRaKhongTinCay;
      }

      let confidence = 0;
      let intent = "general";
      let language = "vi";
      let citations: KbCitation[] = [];
      let toolResult: ToolResultPayload | null = null;
      let toolName: string | null = null;
      let structured: KbStructured | undefined;
      let followUpSuggestions: string[] | undefined;
      let provider: string | undefined;
      let cached: boolean | undefined;
      let pendingAction: KbPendingAction | null = null;
      let vision: KbVisionNote | null = null;
      let clientAction: KbClientAction | null = null;
      let accumulated = "";

      try {
        const res = await fetch("/api/ai/local-kb/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            question: req.question,
            topK: req.topK ?? 5,
            history: req.history,
            userRole: req.userRole,
            context,
            // P3/D8 (doc 34) — optional attached image (base64 data URL).
            ...(req.image ? { image: req.image } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errBody = await res.json().catch(() => ({}));
          // ★ M-4 — mã máy-đọc-được (`code`) → câu BẢN ĐỊA; không hiển thị chuỗi tiếng Anh cứng.
          throw new Error(thongDiepLoiRest(errBody, `Stream failed (${res.status})`));
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const payload = JSON.parse(data) as {
                type: string;
                token?: string;
                intent?: string;
                language?: string;
                confidence?: number;
                citations?: KbCitation[];
                toolResult?: ToolResultPayload;
                toolName?: string;
                pendingAction?: KbPendingAction;
                clientAction?: KbClientAction;
                error?: string;
                structured?: KbStructured;
                followUpSuggestions?: string[];
                provider?: string;
                cached?: boolean;
                ok?: boolean;
                visionText?: string | null;
                reason?: string | null;
                // ★★★ doc 81 · VIỆC 2 — tiến độ vòng lặp tool. Server phát sự kiện này TỪ TRƯỚC
                // (`aiLocalKnowledgeService` :3228, đường vận hành) nhưng client CHƯA BAO GIỜ đọc
                // nó — grep `tool_loop` trong `client/` = 0. Nay chế độ lập trình cần nó để người
                // dùng THẤY đang ở vòng mấy trên một trần 180 s.
                round?: number;
                phase?: "dang_goi" | "xong" | "dung";
                elapsedMs?: number;
                stop?: string;
              };

              if (payload.type === "tool_loop" && typeof payload.round === "number") {
                // ⚠ NUỐT CÓ CHỦ Ý: một consumer hiển thị hỏng KHÔNG được giết lượt stream đang
                // chạy. Không nuốt ở đây thì lỗi rơi vào `catch (parseErr)` bên dưới và — vì nó
                // KHÔNG chứa chữ "JSON" — sẽ được NÉM LẠI, tức một cái nhãn "vòng 2/3" vẽ hỏng
                // sẽ huỷ nguyên câu trả lời. Cùng lập trường với `bao()` ở `toolLoop.ts`.
                try {
                  callbacks?.onToolLoop?.({
                    round: payload.round,
                    phase: payload.phase ?? "dang_goi",
                    toolName: payload.toolName ?? null,
                    elapsedMs: payload.elapsedMs ?? 0,
                    stop: payload.stop,
                  });
                } catch {
                  /* kênh hiển thị, không phải kênh quyết định */
                }
              } else if (payload.type === "vision") {
                // P3/D8 (doc 34) — the VL reading step (or its degrade note).
                vision = {
                  ok: !!payload.ok,
                  visionText: payload.visionText ?? null,
                  reason: payload.reason ?? null,
                };
                callbacks?.onVision?.(vision);
              } else if (payload.type === "meta") {
                confidence = payload.confidence ?? 0;
                intent = payload.intent ?? "general";
                language = payload.language ?? "vi";
                citations = payload.citations ?? [];
              } else if (payload.type === "tool" && payload.toolResult) {
                toolResult = payload.toolResult;
                toolName = payload.toolName ?? null;
                callbacks?.onToolResult?.(toolResult, toolName);
              } else if (payload.type === "pending_action" && payload.pendingAction) {
                pendingAction = payload.pendingAction;
                callbacks?.onPendingAction?.(pendingAction);
              } else if (payload.type === "client_action" && payload.clientAction) {
                // FE-only directive: navigate / prefill_form. No DB mutation.
                clientAction = payload.clientAction;
                callbacks?.onClientAction?.(payload.clientAction);
              } else if (payload.type === "token" && payload.token) {
                accumulated += payload.token;
                const snapshot = accumulated;
                setStreamingText(snapshot);
                callbacks?.onText?.(snapshot);
              } else if (payload.type === "done") {
                structured = payload.structured;
                followUpSuggestions = payload.followUpSuggestions;
                provider = payload.provider;
                cached = payload.cached;
                const doneAnswer = (payload as any).answer;
                // FE-W0.3 (doc 46 §2.3) — the backend flagged the streamed LLM
                // output as a degenerate loop ("cell cell cell…") and sent a clean
                // fallback in `answer`. REPLACE the accumulated garbage tokens so the
                // user (and the saved message) never see the loop.
                if ((payload as any).degraded === true && typeof doneAnswer === "string") {
                  accumulated = doneAnswer;
                  setStreamingText(accumulated);
                  callbacks?.onText?.(accumulated);
                } else if (!accumulated && typeof doneAnswer === "string") {
                  // Some providers send the full answer only on `done` (extractive).
                  accumulated = doneAnswer;
                  setStreamingText(accumulated);
                  callbacks?.onText?.(accumulated);
                }
              } else if (payload.type === "error") {
                throw new Error(payload.error ?? "Stream error");
              }
            } catch (parseErr: any) {
              // Re-throw real stream errors; ignore malformed-JSON noise.
              if (parseErr?.message && !parseErr.message.includes("JSON")) {
                throw parseErr;
              }
            }
          }
        }

        setIsStreaming(false);
        return {
          fullText: accumulated,
          confidence,
          intent,
          language,
          citations,
          toolResult,
          toolName,
          structured,
          followUpSuggestions,
          provider,
          cached,
          pendingAction,
          vision,
          clientAction,
        };
      } catch (err: any) {
        if (err?.name === "AbortError") {
          abortedRef.current = true;
        } else {
          setError(mapTrpcError(err));
        }
        setIsStreaming(false);
        return null;
      }
    },
    [],
  );

  const stopKbStream = useCallback(() => {
    abortedRef.current = true;
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { streamingText, isStreaming, error, abortedRef, startKbStream, stopKbStream };
}
