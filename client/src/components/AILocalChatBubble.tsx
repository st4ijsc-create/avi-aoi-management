/**
 * AI Local Chat Bubble — v2 với đầy đủ tính năng nâng cao
 * Trợ lý thông minh nổi: streaming, đa lượt, phản hồi, role-aware, voice, gợi ý
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { mapAppRoleToAiRole } from "@/lib/aiRole";
import { useAiCopilotContext } from "@/contexts/AiCopilotContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send,
  Loader2,
  AlertCircle,
  Bot,
  User,
  RefreshCw,
  Lightbulb,
  BookOpen,
  Sparkles,
  MessageCircle,
  X,
  Minus,
  ThumbsUp,
  ThumbsDown,
  Mic,
  MicOff,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import { AIToolResultCard, type ToolResultPayload } from "./AIToolResultCard";

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_MESSAGES_KEY = "ai_chat_messages_v2";
const MAX_STORED_MESSAGES = 40;

// C5 — role is now derived from the logged-in user via mapAppRoleToAiRole().
// (Previously hard-coded to "engineer".) The AI role only shapes the
// assistant's tone/scope — it never grants permissions; the backend still
// validates it. Falls back to "worker" for unknown/loading users.

const QUICK_QUESTIONS: Array<{ label: string; question: string }> = [
  { label: "📋 Xem kết quả kiểm tra", question: "Làm thế nào để xem kết quả kiểm tra AOI chi tiết?" },
  { label: "⚙️ Cài đặt máy", question: "Cách cấu hình thông số máy kiểm tra AOI?" },
  { label: "📦 Thêm sản phẩm", question: "Hướng dẫn thêm sản phẩm và cài điểm đo cho sản phẩm mới?" },
  { label: "📈 Tỷ lệ yield", question: "Tỷ lệ yield và OEE của các dây chuyền hiện tại?" },
  { label: "⚠️ Lỗi lặp lại", question: "Những lỗi AOI nào đang lặp lại nhiều nhất gần đây?" },
  { label: "📊 KPI tuần", question: "Báo cáo KPI kiểm tra của tuần này so với tuần trước?" },
  { label: "🔔 Cài cảnh báo", question: "Cách cài đặt cảnh báo khi tỷ lệ lỗi vượt ngưỡng?" },
  { label: "👥 Quản lý user", question: "Cách thêm, sửa, xóa tài khoản và phân quyền người dùng?" },
  { label: "🗄️ Backup DB", question: "Quy trình sao lưu và phục hồi cơ sở dữ liệu?" },
];

const TYPING_STAGES = [
  "🔍 Đang tìm kiếm nguồn...",
  "🧠 Đang phân tích nội dung...",
  "✍️ Đang soạn câu trả lời...",
];

function getConfidenceLabel(score: number) {
  if (score >= 0.8) return { label: "Rất phù hợp", color: "text-green-600", icon: "✅" };
  if (score >= 0.6) return { label: "Khá phù hợp", color: "text-blue-600", icon: "👍" };
  if (score >= 0.4) return { label: "Có thể hữu ích", color: "text-amber-600", icon: "💡" };
  return { label: "Tham khảo thêm", color: "text-gray-500", icon: "📖" };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

interface ChatMessage {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: string; // ISO string for JSON serialization
  result?: {
    confidence: number;
    intent: string;
    language: string;
    citations: Array<{ title: string; sourcePath: string }>;
    cached?: boolean;
    followUpSuggestions?: string[];
    provider?: string;
    structured?: {
      navigationPath?: string;
      steps?: string[];
      recommendations?: string[];
      hasCode?: boolean;
    };
  };
  toolResult?: ToolResultPayload | null;
  toolName?: string | null;
  streaming?: boolean;
  feedbackGiven?: "up" | "down";
  // GĐ2 — write-action confirm card (propose → confirm/cancel).
  pendingAction?: PendingAction | null;
  actionState?: "pending" | "executed" | "cancelled" | "denied" | "expired";
  actionMessage?: string | null;
}

// GĐ2 — pending write-action proposed by the AI Copilot (HITL confirm).
interface PendingActionChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  displayName?: string;
}
interface PendingAction {
  actionId: string;
  token: string;
  tool: string;
  summary: string;
  preview: {
    entityType: string;
    entityId?: number;
    entityName?: string;
    changes: PendingActionChange[];
    warnings: string[];
    humanSummary: string;
  };
  expiresAt: string;
}

// ─── Web Speech API types ─────────────────────────────────────────────────────

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
declare const SpeechRecognition: new () => SpeechRecognitionInstance;
declare const webkitSpeechRecognition: new () => SpeechRecognitionInstance;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_MESSAGES_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as ChatMessage[]).slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

function saveMessages(messages: ChatMessage[]) {
  try {
    localStorage.setItem(
      STORAGE_MESSAGES_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // ignore quota errors
  }
}

function buildConversationHistory(messages: ChatMessage[]): ConversationTurn[] {
  return messages
    .filter((m) => !m.streaming)
    .slice(-10) // last 5 turns
    .map((m) => ({ role: m.type === "user" ? "user" : "assistant", content: m.content }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AILocalChatBubble() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages());
  const [showSources, setShowSources] = useState<string | null>(null);
  const [typingStage, setTypingStage] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isListening, setIsListening] = useState(false);

  // C5 — real role from auth context, mapped to an AI UserRole.
  const { user } = useAuth();
  const userRole = mapAppRoleToAiRole(user?.role);

  // C3a — current route + UI language + page-published selection.
  const [location, setLocation] = useLocation();
  const { t, i18n } = useTranslation();
  const { selection, publishPrefill } = useAiCopilotContext();

  const bottomRef = useRef<HTMLDivElement>(null);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const { data: health, isLoading: healthLoading } = trpc.aiLocalKb.health.useQuery();
  const reloadMutation = trpc.aiLocalKb.reload.useMutation();
  const feedbackMutation = trpc.aiLocalKb.feedback.useMutation();
  // GĐ2 — HITL write-action confirm/cancel.
  const confirmActionMutation = trpc.aiCopilot.confirmAction.useMutation();
  const cancelActionMutation = trpc.aiCopilot.cancelAction.useMutation();

  const isReady = health?.ready || false;
  const quickQuestions = QUICK_QUESTIONS;

  // ─── Persist messages ───────────────────────────────────────────────────────
  useEffect(() => {
    saveMessages(messages.filter((m) => !m.streaming));
  }, [messages]);

  // ─── Unread count ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || minimized) {
      const assistantMsgs = messages.filter((m) => m.type === "assistant" && !m.streaming);
      setUnreadCount(Math.min(assistantMsgs.length > 0 ? 1 : 0, 9));
    } else {
      setUnreadCount(0);
    }
  }, [messages, open, minimized]);

  // ─── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open && !minimized) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open, minimized, isStreaming]);

  // ─── Typing stage rotation ───────────────────────────────────────────────────
  const startTypingAnimation = useCallback(() => {
    setTypingStage(0);
    typingIntervalRef.current = setInterval(() => {
      setTypingStage((s) => (s + 1) % TYPING_STAGES.length);
    }, 1200);
  }, []);

  const stopTypingAnimation = useCallback(() => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
  }, []);

  // ─── Voice input ─────────────────────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    const SRConstructor =
      typeof SpeechRecognition !== "undefined"
        ? SpeechRecognition
        : typeof webkitSpeechRecognition !== "undefined"
          ? webkitSpeechRecognition
          : null;

    if (!SRConstructor) {
      toast.error("Trình duyệt không hỗ trợ nhận dạng giọng nói.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SRConstructor();
    recognition.lang = "vi-VN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) setQuestion((prev) => prev + (prev ? " " : "") + transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
      toast.error("Không nhận diện được giọng nói. Vui lòng thử lại.");
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  // ─── Ask (streaming) ─────────────────────────────────────────────────────────
  const handleAsk = useCallback(
    async (q?: string) => {
      const query = (q ?? question).trim();
      if (!query || isStreaming) return;
      if (!isReady) {
        toast.error("Hệ thống chưa sẵn sàng. Vui lòng thử lại sau.");
        return;
      }

      const userMsgId = `u_${Date.now()}`;
      const assistantMsgId = `a_${Date.now() + 1}`;

      const history = buildConversationHistory(messages);

      setMessages((prev) => [
        ...prev,
        { id: userMsgId, type: "user", content: query, timestamp: new Date().toISOString() },
        { id: assistantMsgId, type: "assistant", content: "", timestamp: new Date().toISOString(), streaming: true },
      ]);
      setQuestion("");
      startTypingAnimation();
      setIsStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      // C3a — assemble the optional context payload (route + UI language +
      // page-published selection). Only include fields that have a value so
      // the backend treats absent fields as undefined (backward-compatible).
      const copilotContext: Record<string, unknown> = {
        route: location,
        uiLanguage: i18n.language,
      };
      if (selection.selectedMachineCode) copilotContext.selectedMachineCode = selection.selectedMachineCode;
      if (selection.selectedMachineId != null) copilotContext.selectedMachineId = selection.selectedMachineId;
      if (selection.selectedProductCode) copilotContext.selectedProductCode = selection.selectedProductCode;
      if (selection.selectedProductModelId != null) copilotContext.selectedProductModelId = selection.selectedProductModelId;
      if (selection.selectedLot) copilotContext.selectedLot = selection.selectedLot;

      let metaResult: ChatMessage["result"] | undefined;
      let toolResultPayload: ToolResultPayload | null = null;
      let toolNameValue: string | null = null;
      let pendingActionPayload: PendingAction | null = null;
      let accumulatedContent = "";

      try {
        const res = await fetch("/api/ai/local-kb/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: query, topK: 5, history, userRole, context: copilotContext }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        stopTypingAnimation();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6)) as {
                type: string;
                token?: string;
                intent?: string;
                language?: string;
                confidence?: number;
                citations?: NonNullable<ChatMessage["result"]>["citations"];
                toolResult?: ToolResultPayload;
                toolName?: string;
                pendingAction?: PendingAction;
                clientAction?: {
                  action: "navigate" | "prefill_form";
                  route: string;
                  values?: Record<string, unknown>;
                  message: string;
                };
                error?: string;
                structured?: NonNullable<ChatMessage["result"]>["structured"];
                followUpSuggestions?: string[];
                provider?: string;
                cached?: boolean;
              };

              if (payload.type === "meta") {
                metaResult = {
                  confidence: payload.confidence ?? 0,
                  intent: payload.intent ?? "general",
                  language: payload.language ?? "vi",
                  citations: payload.citations ?? [],
                };
              } else if (payload.type === "tool" && payload.toolResult) {
                toolResultPayload = payload.toolResult;
                toolNameValue = payload.toolName ?? null;
                const tr = toolResultPayload;
                const tn = toolNameValue;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, toolResult: tr, toolName: tn } : m)),
                );
              } else if (payload.type === "pending_action" && payload.pendingAction) {
                pendingActionPayload = payload.pendingAction;
                const pa = pendingActionPayload;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, pendingAction: pa, actionState: "pending" } : m,
                  ),
                );
              } else if (payload.type === "client_action" && payload.clientAction) {
                // GĐ3a Mục 5 — navigate / prefill_form. No DB mutation; FE only.
                const ca = payload.clientAction;
                if (ca.route) {
                  if (ca.action === "prefill_form" && ca.values) {
                    publishPrefill(ca.route, ca.values);
                  }
                  setLocation(ca.route);
                }
              } else if (payload.type === "token" && payload.token) {
                accumulatedContent += payload.token;
                const snapshot = accumulatedContent;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, content: snapshot } : m)),
                );
              } else if (payload.type === "done") {
                if (metaResult) {
                  metaResult = {
                    ...metaResult,
                    structured: payload.structured,
                    followUpSuggestions: payload.followUpSuggestions ?? metaResult.followUpSuggestions,
                    provider: payload.provider ?? metaResult.provider,
                    cached: payload.cached ?? metaResult.cached,
                  };
                }
                break;
              } else if (payload.type === "error") {
                throw new Error(payload.error ?? "Stream error");
              }
            } catch {
              // skip parse errors
            }
          }
        }
      } catch (err: any) {
        stopTypingAnimation();
        if (err?.name !== "AbortError") {
          // Fall back to non-streaming ask via tRPC
          try {
            const result = await fetch("/api/ai/local-kb/ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: query, topK: 5, history, userRole, context: copilotContext }),
            });
            const json = await result.json() as { success: boolean; data?: any; error?: string };
            if (json.success && json.data) {
              accumulatedContent = json.data.answer ?? "";
              metaResult = {
                confidence: json.data.confidence ?? 0,
                intent: json.data.intent ?? "general",
                language: json.data.language ?? "vi",
                citations: json.data.citations ?? [],
                cached: json.data.cached,
                followUpSuggestions: json.data.followUpSuggestions,
                provider: json.data.provider,
                structured: json.data.structured,
              };
              if (json.data.toolResult) {
                toolResultPayload = json.data.toolResult as ToolResultPayload;
                toolNameValue = json.data.toolName ?? null;
              }
              if (json.data.pendingAction) {
                pendingActionPayload = json.data.pendingAction as PendingAction;
              }
            } else {
              accumulatedContent =
                "Xin lỗi, có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại.";
            }
          } catch {
            accumulatedContent = "Không thể kết nối đến hệ thống. Vui lòng kiểm tra mạng và thử lại.";
          }
        }
      } finally {
        stopTypingAnimation();
        setIsStreaming(false);
        abortRef.current = null;
      }

      const finalContent =
        accumulatedContent ||
        (metaResult?.language === "en"
          ? "I couldn't find a suitable answer. Please try rephrasing."
          : "Tôi chưa tìm được câu trả lời phù hợp. Vui lòng thử câu hỏi khác.");

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: finalContent,
                streaming: false,
                result: metaResult,
                toolResult: toolResultPayload,
                toolName: toolNameValue,
                pendingAction: pendingActionPayload,
                actionState: pendingActionPayload ? "pending" : m.actionState,
              }
            : m,
        ),
      );
    },
    [question, isStreaming, isReady, messages, userRole, location, i18n.language, selection, startTypingAnimation, stopTypingAnimation],
  );

  // ─── Feedback ────────────────────────────────────────────────────────────────
  const handleFeedback = useCallback(
    async (msg: ChatMessage, vote: "up" | "down") => {
      if (msg.feedbackGiven) return;
      try {
        await feedbackMutation.mutateAsync({
          messageId: msg.id,
          question: messages.find((m) => m.type === "user")?.content ?? "",
          answer: msg.content.slice(0, 200),
          rating: vote === "up" ? 1 : -1,
          toolName: msg.toolName ?? null,
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, feedbackGiven: vote } : m)),
        );
        toast.success(vote === "up" ? "Cảm ơn phản hồi tích cực!" : "Cảm ơn! Chúng tôi sẽ cải thiện.");
      } catch {
        toast.error("Không thể gửi phản hồi.");
      }
    },
    [messages, feedbackMutation],
  );

  // ─── GĐ2 — Confirm / cancel write-action ──────────────────────────────────────
  const handleConfirmAction = useCallback(
    async (msg: ChatMessage) => {
      const pa = msg.pendingAction;
      if (!pa || msg.actionState !== "pending") return;
      try {
        const res = await confirmActionMutation.mutateAsync({
          actionId: pa.actionId,
          token: pa.token,
          lang: (i18n.language as "vi" | "en" | "zh") ?? "vi",
        });
        const state =
          res.status === "executed" ? "executed"
          : res.status === "denied" ? "denied"
          : res.status === "expired" ? "expired"
          : "pending";
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, actionState: state as any, actionMessage: res.message ?? null } : m)),
        );
        if (res.ok) toast.success(res.message ?? t("copilot.executed", "Đã thực thi."));
        else toast.error(res.message ?? t("copilot.failed", "Không thể thực thi."));
      } catch {
        toast.error(t("copilot.failed", "Không thể thực thi."));
      }
    },
    [confirmActionMutation, i18n.language, t],
  );

  const handleCancelAction = useCallback(
    async (msg: ChatMessage) => {
      const pa = msg.pendingAction;
      if (!pa || msg.actionState !== "pending") return;
      try {
        const res = await cancelActionMutation.mutateAsync({ actionId: pa.actionId });
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, actionState: "cancelled", actionMessage: res.message ?? null } : m)),
        );
        toast.success(t("copilot.cancelled", "Đã hủy."));
      } catch {
        toast.error(t("copilot.failed", "Không thể hủy."));
      }
    },
    [cancelActionMutation, t],
  );

  // ─── Clear history ────────────────────────────────────────────────────────────
  const handleClearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_MESSAGES_KEY);
    toast.success("Đã xóa lịch sử trò chuyện.");
  }, []);

  const handleReload = async () => {
    try {
      const result = await reloadMutation.mutateAsync();
      if (result.success) toast.success("Cập nhật dữ liệu thành công!");
      else toast.error(result.error || "Cập nhật thất bại.");
    } catch (error: any) {
      toast.error(error.message || "Có lỗi xảy ra.");
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  // C3a — mounted globally at App root; hide entirely when not logged in
  // (e.g. /login) so the bubble only appears for authenticated users.
  if (!user) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* ── Chat Panel ─────────────────────────────────────────────────────────── */}
      {open && !minimized && (
        <div className="w-96 flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200" style={{ height: "600px" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-card shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                <Bot className="size-4 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-none">Trợ lý thông minh</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {healthLoading ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : isReady ? (
                    <>
                      <span className="inline-block size-1.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-green-600">Sẵn sàng</span>
                    </>
                  ) : (
                    <>
                      <span className="inline-block size-1.5 rounded-full bg-amber-500" />
                      <span className="text-xs text-amber-600">Đang tải...</span>
                    </>
                  )}
                  {/* Persona fixed: trợ lý chi tiết cho mọi người dùng */}
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full border bg-muted ml-1 leading-none text-muted-foreground"
                    title="Trợ lý trả lời chi tiết, giải thích cặn kẽ"
                  >
                    💬 Chi tiết
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleClearHistory}
                title="Xóa lịch sử"
                disabled={messages.length === 0}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleReload}
                disabled={reloadMutation.isPending}
                title="Làm mới dữ liệu"
              >
                <RefreshCw className={cn("size-3.5", reloadMutation.isPending && "animate-spin")} />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setMinimized(true)} title="Thu nhỏ">
                <Minus className="size-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} title="Đóng">
                <X className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                  <p className="font-semibold text-sm">Xin chào! Tôi có thể giúp gì?</p>
                  <p className="text-xs text-muted-foreground max-w-64">
                    Hỏi tôi về cách sử dụng hệ thống, xem báo cáo, cài đặt máy móc…
                  </p>
                </div>
                <div className="w-full">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1 justify-center">
                    <Lightbulb className="size-3" />
                    Câu hỏi thường gặp
                  </p>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {quickQuestions.map((q, i) => (
                      <button
                        key={i}
                        className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleAsk(q.question)}
                        disabled={!isReady}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className={cn("flex gap-2", msg.type === "user" ? "flex-row-reverse" : "flex-row")}>
                    <div
                      className={cn(
                        "shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-white",
                        msg.type === "user" ? "bg-primary" : "bg-slate-600",
                      )}
                    >
                      {msg.type === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                    </div>
                    <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 space-y-1.5", msg.type === "user" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted rounded-tl-sm")}>
                      {msg.type === "user" ? (
                        <p className="text-xs">{msg.content}</p>
                      ) : (
                        <>
                          {msg.streaming && !msg.content ? (
                            // Typing indicator with stage text
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                              </div>
                              <span className="text-xs text-muted-foreground">{TYPING_STAGES[typingStage]}</span>
                            </div>
                          ) : (
                            <>
                              {msg.toolResult && <AIToolResultCard toolResult={msg.toolResult} />}
                              {msg.pendingAction && (
                                <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2.5 space-y-2 text-[11px]">
                                  <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                                    <AlertCircle className="size-3.5" />
                                    {t("copilot.confirmTitle", "Xác nhận thao tác ghi")}
                                  </div>
                                  <p className="text-foreground/90">{msg.pendingAction.summary}</p>
                                  {msg.pendingAction.preview.changes.length > 0 && (
                                    <table className="w-full text-[10.5px] border-collapse">
                                      <thead>
                                        <tr className="text-muted-foreground">
                                          <th className="text-left font-medium py-0.5">{t("copilot.field", "Trường")}</th>
                                          <th className="text-left font-medium py-0.5">{t("copilot.before", "Trước")}</th>
                                          <th className="text-left font-medium py-0.5">{t("copilot.after", "Sau")}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {msg.pendingAction.preview.changes.map((c, i) => (
                                          <tr key={i} className="border-t border-amber-200/60 dark:border-amber-900/40">
                                            <td className="py-0.5 pr-1.5 font-medium">{c.displayName ?? c.field}</td>
                                            <td className="py-0.5 pr-1.5 text-muted-foreground">{c.oldValue === null || c.oldValue === undefined ? "—" : String(c.oldValue)}</td>
                                            <td className="py-0.5 text-foreground">{c.newValue === null || c.newValue === undefined ? "—" : String(c.newValue)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                  {msg.pendingAction.preview.warnings.length > 0 && (
                                    <ul className="list-disc list-inside text-red-600 dark:text-red-400 space-y-0.5">
                                      {msg.pendingAction.preview.warnings.map((w, i) => (
                                        <li key={i}>{w}</li>
                                      ))}
                                    </ul>
                                  )}
                                  {msg.actionState === "pending" ? (
                                    <div className="flex items-center gap-2 pt-0.5">
                                      <Button
                                        size="sm"
                                        className="h-6 px-2.5 text-[11px]"
                                        disabled={confirmActionMutation.isPending}
                                        onClick={() => handleConfirmAction(msg)}
                                      >
                                        {t("copilot.confirm", "Xác nhận")}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-6 px-2.5 text-[11px]"
                                        disabled={cancelActionMutation.isPending}
                                        onClick={() => handleCancelAction(msg)}
                                      >
                                        {t("copilot.cancel", "Hủy")}
                                      </Button>
                                    </div>
                                  ) : (
                                    <div
                                      className={cn(
                                        "text-[11px] font-medium",
                                        msg.actionState === "executed" ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
                                      )}
                                    >
                                      {msg.actionState === "executed" && (t("copilot.executed", "Đã thực thi."))}
                                      {msg.actionState === "cancelled" && (t("copilot.cancelled", "Đã hủy."))}
                                      {msg.actionState === "denied" && (msg.actionMessage ?? t("copilot.denied", "Không có quyền."))}
                                      {msg.actionState === "expired" && (t("copilot.expired", "Đã hết hạn."))}
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="prose prose-xs dark:prose-invert max-w-none text-xs leading-relaxed">
                                <Markdown>{msg.content}</Markdown>
                                {msg.streaming && <span className="inline-block size-1.5 rounded-full bg-muted-foreground animate-pulse ml-0.5" />}
                              </div>
                              {!msg.streaming && msg.result?.structured && (
                                (msg.result.structured.navigationPath ||
                                  (msg.result.structured.steps && msg.result.structured.steps.length > 0) ||
                                  (msg.result.structured.recommendations && msg.result.structured.recommendations.length > 0)) && (
                                  <div className="mt-1.5 space-y-1.5">
                                    {msg.result.structured.navigationPath && (
                                      <div className="flex items-start gap-1.5 text-[11px] bg-background/60 border border-border/40 rounded px-2 py-1">
                                        <ChevronRight className="size-3 mt-px shrink-0 text-primary" />
                                        <span className="font-medium text-foreground/80">{msg.result.structured.navigationPath}</span>
                                      </div>
                                    )}
                                    {msg.result.structured.steps && msg.result.structured.steps.length > 0 && (
                                      <div className="text-[11px] bg-background/60 border border-border/40 rounded px-2 py-1.5">
                                        <p className="font-semibold text-muted-foreground mb-1">Các bước thực hiện</p>
                                        <ol className="list-decimal list-inside space-y-0.5 marker:text-primary marker:font-semibold">
                                          {msg.result.structured.steps.map((s, i) => (
                                            <li key={i} className="leading-snug">{s}</li>
                                          ))}
                                        </ol>
                                      </div>
                                    )}
                                    {msg.result.structured.recommendations && msg.result.structured.recommendations.length > 0 && (
                                      <div className="text-[11px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded px-2 py-1.5">
                                        <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">Khuyến nghị</p>
                                        <ul className="list-disc list-inside space-y-0.5">
                                          {msg.result.structured.recommendations.map((r, i) => (
                                            <li key={i} className="leading-snug">{r}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                )
                              )}
                            </>
                          )}

                          {/* Metadata row */}
                          {msg.result && !msg.streaming && (
                            <div className="flex items-center gap-1.5 pt-1 border-t border-border/30 flex-wrap">
                              {(() => {
                                const conf = getConfidenceLabel(msg.result.confidence ?? 0);
                                return (
                                  <span className={cn("text-xs flex items-center gap-0.5", conf.color)}>
                                    {conf.icon} {conf.label}
                                  </span>
                                );
                              })()}
                              {msg.result.citations?.length > 0 && (
                                <button
                                  className="text-xs px-1.5 text-muted-foreground hover:text-foreground flex items-center gap-1"
                                  onClick={() => setShowSources(showSources === msg.id ? null : msg.id)}
                                >
                                  <BookOpen className="size-3" />
                                  {msg.result.citations.length} nguồn
                                </button>
                              )}
                              {msg.result.cached && <Badge variant="secondary" className="text-xs h-4 px-1.5">Cache</Badge>}
                              {/* Feedback buttons */}
                              <div className="ml-auto flex items-center gap-0.5">
                                <button
                                  className={cn("p-0.5 rounded hover:bg-background/50 transition-colors", msg.feedbackGiven === "up" && "text-green-600")}
                                  onClick={() => handleFeedback(msg, "up")}
                                  disabled={!!msg.feedbackGiven}
                                  title="Hữu ích"
                                >
                                  <ThumbsUp className="size-3" />
                                </button>
                                <button
                                  className={cn("p-0.5 rounded hover:bg-background/50 transition-colors", msg.feedbackGiven === "down" && "text-red-500")}
                                  onClick={() => handleFeedback(msg, "down")}
                                  disabled={!!msg.feedbackGiven}
                                  title="Chưa hữu ích"
                                >
                                  <ThumbsDown className="size-3" />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Sources list */}
                          {showSources === msg.id && (msg.result?.citations?.length ?? 0) > 0 && (
                            <div className="space-y-1 pt-1 border-t border-border/30">
                              {msg.result?.citations?.slice(0, 4).map((cite: any, i: number) => (
                                <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground bg-background/60 rounded p-1.5">
                                  <span className="shrink-0 font-semibold text-primary">{i + 1}.</span>
                                  <span className="break-all">{cite.title || cite.sourcePath}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Follow-up suggestions */}
                          {msg.result?.followUpSuggestions && !msg.streaming && (
                            <div className="pt-1 border-t border-border/30">
                              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <ChevronRight className="size-3" /> Câu hỏi tiếp theo:
                              </p>
                              <div className="flex flex-col gap-1">
                                {msg.result.followUpSuggestions.slice(0, 2).map((suggestion, i) => (
                                  <button
                                    key={i}
                                    className="text-left text-xs px-2 py-1 rounded-lg border bg-background/60 hover:bg-background transition-colors disabled:opacity-50"
                                    onClick={() => handleAsk(suggestion)}
                                    disabled={!isReady || isStreaming}
                                  >
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      <p className={cn("text-xs opacity-40", msg.type === "user" ? "text-right" : "text-left")}>
                        {new Date(msg.timestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Quick chips */}
          {messages.length > 0 && !isStreaming && (
            <div className="px-3 pb-1 shrink-0">
              <ScrollArea className="w-full" type="scroll">
                <div className="flex gap-1.5 pb-1">
                  {quickQuestions.map((q, i) => (
                    <button
                      key={i}
                      className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-muted transition-colors whitespace-nowrap disabled:opacity-50"
                      onClick={() => handleAsk(q.question)}
                      disabled={!isReady || isStreaming}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Input Area */}
          <div className="px-3 pb-3 pt-2 border-t shrink-0">
            {!isReady && !healthLoading && (
              <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <AlertCircle className="size-3.5 text-amber-600 shrink-0" />
                Dữ liệu chưa tải. Nhấn nút làm mới ở trên.
              </div>
            )}
            <div className="flex gap-2 items-end border rounded-xl px-3 py-2 focus-within:border-primary/50 transition-colors bg-background">
              <Textarea
                placeholder={
                  isListening
                    ? "Đang nghe... (nói câu hỏi của bạn)"
                    : isReady
                      ? "Nhập câu hỏi... (Enter để gửi)"
                      : "Đang khởi động, vui lòng chờ..."
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
                disabled={!isReady || isStreaming}
                className="flex-1 min-h-9 max-h-24 resize-none border-0 focus-visible:ring-0 p-0 text-sm"
                rows={1}
              />
              {/* Voice button */}
              <Button
                size="icon"
                variant={isListening ? "destructive" : "ghost"}
                className="shrink-0 h-8 w-8 rounded-lg"
                onClick={toggleVoice}
                disabled={!isReady || isStreaming}
                title={isListening ? "Dừng ghi âm" : "Nhập bằng giọng nói"}
              >
                {isListening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
              </Button>
              <Button
                onClick={() => handleAsk()}
                disabled={!isReady || isStreaming || !question.trim()}
                size="icon"
                className="shrink-0 h-8 w-8 rounded-lg"
              >
                {isStreaming ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Minimized bar ─────────────────────────────────────────────────────── */}
      {open && minimized && (
        <button
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full shadow-lg hover:shadow-xl transition-all animate-in slide-in-from-bottom-2 fade-in duration-150"
          onClick={() => setMinimized(false)}
        >
          <Bot className="size-4" />
          <span className="text-sm font-medium">Trợ lý thông minh</span>
          {isStreaming && <Loader2 className="size-3.5 animate-spin" />}
        </button>
      )}

      {/* ── FAB Button ────────────────────────────────────────────────────────── */}
      <Button
        size="icon"
        className={cn(
          "h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all relative",
          open && !minimized && "bg-muted text-muted-foreground hover:bg-muted border",
        )}
        onClick={() => {
          if (open && !minimized) {
            setOpen(false);
          } else {
            setOpen(true);
            setMinimized(false);
          }
        }}
        title="Trợ lý thông minh"
      >
        {open && !minimized ? (
          <X className="size-5" />
        ) : (
          <>
            <MessageCircle className="size-6" />
            {isReady && !open && (
              <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-green-500 border-2 border-background" />
            )}
            {!open && unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold border-2 border-background">
                {unreadCount}
              </span>
            )}
          </>
        )}
      </Button>
    </div>
  );
}
