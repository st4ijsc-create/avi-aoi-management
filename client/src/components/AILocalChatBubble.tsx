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
  ImagePlus,
  Eye,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import { AIToolResultCard, type ToolResultPayload } from "./AIToolResultCard";
import {
  AgentPlanCard,
  type AgentPlanView,
  type AgentSessionStatus,
  type AgentStepResultView,
} from "./AgentPlanCard";
// P3/W3.1 (doc 11) — shared HITL write confirm card (extracted from this file so
// /ai-chat can render the SAME inline confirm/cancel card). The card + helpers +
// PendingAction types now live in ConfirmActionCard.tsx.
import {
  ConfirmActionCard,
  type PendingAction,
} from "./ConfirmActionCard";
// P3/D8 (doc 34) — vision-in-chat: shared image-attach helpers + the VL-step note
// type, reused from the /ai-chat hook so both chat surfaces share one impl.
import {
  readChatImageFile,
  validateChatImageFile,
  extractImageFromClipboard,
  MAX_CHAT_IMAGE_BYTES,
  ACCEPTED_CHAT_IMAGE_TYPES,
  type ChatImageAttachment,
  type KbVisionNote,
} from "@/hooks/useKbChatStream";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ListChecks } from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_MESSAGES_KEY = "ai_chat_messages_v2";
const MAX_STORED_MESSAGES = 40;
// doc69 B1 (Wave 5) — the KB autosync's default cron is nightly (03:00); a corpus
// older than a week means the KB either isn't being rebuilt or has been failing
// its rebuilds, so the "KB age" badge switches from neutral to attention beyond
// this threshold. Purely visual (does not gate `isReady`/input, which stay keyed
// off health.ready as before).
const KB_STALE_DAYS_THRESHOLD = 7;

// C5 — role is now derived from the logged-in user via mapAppRoleToAiRole().
// (Previously hard-coded to "engineer".) The AI role only shapes the
// assistant's tone/scope — it never grants permissions; the backend still
// validates it. Falls back to "worker" for unknown/loading users.

// Role-filtered example prompts. Keyed by i18n so they localize (vi/en/zh).
// The label IS the question sent to the assistant (with an emoji prefix for
// scannability on a kiosk). Grouped by AI role (mapAppRoleToAiRole):
//   worker   ← operator/viewer            → shop-floor monitoring prompts
//   engineer ← maintenance/quality        → config + predictive-maintenance
//   manager  ← supervisor                 → KPI / reporting
//   it_admin ← admin                      → reuses the manager set
type QuickQuestionKey = { emoji: string; key: string };

const QUICK_QUESTIONS_BY_ROLE: Record<
  "worker" | "engineer" | "manager" | "it_admin",
  QuickQuestionKey[]
> = {
  worker: [
    { emoji: "⚠️", key: "quickQuestions.operator.ngRepeat" },
    { emoji: "📈", key: "quickQuestions.operator.oeeWeek" },
    { emoji: "🔔", key: "quickQuestions.operator.threshold" },
  ],
  engineer: [
    { emoji: "⚙️", key: "quickQuestions.maintenance.raiseNg" },
    { emoji: "🛠️", key: "quickQuestions.maintenance.config" },
    { emoji: "🔧", key: "quickQuestions.maintenance.pdm" },
  ],
  manager: [
    { emoji: "📊", key: "quickQuestions.supervisor.kpiWeek" },
    { emoji: "🏆", key: "quickQuestions.supervisor.topDefects" },
    { emoji: "📉", key: "quickQuestions.supervisor.yieldTrend" },
  ],
  it_admin: [
    { emoji: "📊", key: "quickQuestions.supervisor.kpiWeek" },
    { emoji: "🏆", key: "quickQuestions.supervisor.topDefects" },
    { emoji: "📉", key: "quickQuestions.supervisor.yieldTrend" },
  ],
};

// doc69 B4 — key+fallback tuples (same shape as QUICK_QUESTIONS_BY_ROLE above) so the
// rotating typing-stage text resolves through t() at the render site (this array is
// module-level, outside the component, so it has no access to the `t` hook itself).
const TYPING_STAGES: { key: string; fallback: string }[] = [
  { key: "aiChat.typingSearching", fallback: "🔍 Đang tìm kiếm nguồn..." },
  { key: "aiChat.typingAnalyzing", fallback: "🧠 Đang phân tích nội dung..." },
  { key: "aiChat.typingComposing", fallback: "✍️ Đang soạn câu trả lời..." },
];

// doc69 B4 — takes `t` as a parameter (module-level function, no hook access) so the
// confidence label localizes instead of always rendering the Vietnamese literal.
function getConfidenceLabel(score: number, t: (key: string, fallback: string) => string) {
  if (score >= 0.8) return { label: t("aiChat.confidenceHigh", "Rất phù hợp"), color: "text-green-600", icon: "✅" };
  if (score >= 0.6) return { label: t("aiChat.confidenceGood", "Khá phù hợp"), color: "text-blue-600", icon: "👍" };
  if (score >= 0.4) return { label: t("aiChat.confidenceMaybe", "Có thể hữu ích"), color: "text-amber-600", icon: "💡" };
  return { label: t("aiChat.confidenceLow", "Tham khảo thêm"), color: "text-gray-500", icon: "📖" };
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
    citations: Array<{
      title: string;
      sourcePath: string;
      // doc69 B3 (Wave 5) — deep-link target, resolved server-side ONLY for a
      // KNOWN operational card whose route passes the ALLOWED_CLIENT_ROUTES
      // whitelist. null/absent -> render as plain, non-clickable text.
      route?: string | null;
      id?: string;
      sourceType?: string;
      // Wave 2 đường B — "system" (KB corpus tệp, mặc định/vắng mặt) hay "studio"
      // (tài liệu người dùng tự nạp vào Training Studio).
      origin?: "system" | "studio";
    }>;
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
  // P3/D8 (doc 34) — user turn: an image was attached (persisted flag only, not
  // the bytes — keeps localStorage small). Assistant turn: the VL reading / note.
  hasImage?: boolean;
  vision?: KbVisionNote | null;
  // GĐ2 — write-action confirm card (propose → confirm/cancel).
  pendingAction?: PendingAction | null;
  actionState?: "pending" | "executed" | "cancelled" | "denied" | "expired";
  actionMessage?: string | null;
  // doc69 G2-7 — how-to answer grounded in a KNOWN operational card: a 1-tap
  // "Mở màn X" button (NOT auto-navigated — see the client_action handler below).
  navigateAction?: { route: string; message: string } | null;
}

// GĐ2 — pending write-action types (PendingAction / PendingActionChange) moved
// to ./ConfirmActionCard and imported above (P3/W3.1, doc 11).

// G2.3c — agentic multi-step session state (FE flow control only). The plan +
// step outcomes come from aiAgent.* router; this component NEVER executes a tool
// and NEVER calls commandDispatcher. Each write step is confirmed individually
// via the existing confirm card (which here calls aiAgent.confirmStep — the
// orchestrator re-uses the CORE confirmAction/HITL and only then advances).
interface AgentSessionState {
  sessionId: string;
  goal: string;
  plan: AgentPlanView;
  status: AgentSessionStatus;
  cursor: number;
  stepResults: AgentStepResultView[];
  /** Pending write at the current step (awaiting_confirm) — drives the confirm card. */
  pendingAction: PendingAction | null;
  /** Backend-surfaced message (paused reason / empty-plan note). */
  message: string | null;
  /** Confirm-card UI state for the current pending write (mirrors chat pendingAction). */
  actionState: "pending" | "executed" | "cancelled" | "denied" | "expired";
  actionMessage: string | null;
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
  // P3/D8 (doc 34) — image attached to the next message (photo of a ladder/HMI/
  // wiring/datasheet/error screen). Held transiently; cleared on send.
  const [attachedImage, setAttachedImage] = useState<ChatImageAttachment | null>(null);

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
  const imageInputRef = useRef<HTMLInputElement>(null);

  // doc 67 W6 (việc 2) — LAZY health: this bubble mounts globally (App root) so an
  // eager query fired on EVERY page load. The health badge/gate only renders inside
  // the opened panel (closed FAB shows just the local unread count) → fetch on
  // first open only, then keep for 5' (reopening within 5' does not refetch).
  const { data: health, isLoading: healthLoading } = trpc.aiLocalKb.health.useQuery(undefined, {
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const reloadMutation = trpc.aiLocalKb.reload.useMutation();
  const feedbackMutation = trpc.aiLocalKb.feedback.useMutation();
  // GĐ2 — HITL write-action confirm/cancel.
  const confirmActionMutation = trpc.aiCopilot.confirmAction.useMutation();
  const cancelActionMutation = trpc.aiCopilot.cancelAction.useMutation();

  // ── G2.3c — agentic multi-step (FE flow control only) ───────────────────────
  const [agentSession, setAgentSession] = useState<AgentSessionState | null>(null);
  const utils = trpc.useUtils();
  const startSessionMutation = trpc.aiAgent.startSession.useMutation();
  const approvePlanMutation = trpc.aiAgent.approvePlan.useMutation();
  const confirmStepMutation = trpc.aiAgent.confirmStep.useMutation();
  const cancelSessionMutation = trpc.aiAgent.cancelSession.useMutation();
  const startPlaybookMutation = trpc.aiAgent.startPlaybook.useMutation();
  // Gate: empty/disabled for non-agentic roles → no agentic UI shown.
  // doc 67 W6 (việc 2) — LAZY like health above: the playbook picker/agentic UI
  // only exists inside the opened panel, so don't fire this on every page load.
  const { data: playbooksData } = trpc.aiAgent.listPlaybooks.useQuery(undefined, {
    enabled: !!user && open,
    staleTime: 5 * 60 * 1000,
  });
  const agenticEnabled = playbooksData?.enabled === true;
  const playbooks = playbooksData?.playbooks ?? [];
  const agentBusy =
    startSessionMutation.isPending ||
    approvePlanMutation.isPending ||
    confirmStepMutation.isPending ||
    cancelSessionMutation.isPending ||
    startPlaybookMutation.isPending;

  const isReady = health?.ready || false;
  // W0.2/W0.3 (doc 11) — honest, non-misleading status. `ready` only proves the
  // KB files loaded; the badge must also reflect whether the LLM is loadable and
  // whether the query embed-model matches the corpus. Input stays gated on
  // `ready` (users can still ask in extractive mode), but the badge tells the truth.
  //   green  "Sẵn sàng"        — ready + LLM loadable + embed model matches
  //   red    "Lệch model..."   — embed model mismatch (retrieval may be inaccurate)
  //   amber  "Chế độ trích dẫn"— ready but LLM not loadable → extractive answers
  //   amber  "Đang tải..."     — not ready yet
  const embedMismatch = health?.embedModelMatches === false;
  const llmReady = health?.llmReady === true;
  const healthStatus: "loading" | "ready" | "extractive" | "embed_mismatch" = embedMismatch
    ? "embed_mismatch"
    : !isReady
      ? "loading"
      : llmReady
        ? "ready"
        : "extractive";
  // Role-filtered example prompts (operators no longer see admin tasks). The
  // localized label IS the question we send to the assistant.
  const quickQuestions = (QUICK_QUESTIONS_BY_ROLE[userRole] ?? QUICK_QUESTIONS_BY_ROLE.worker).map(
    (q) => {
      const text = t(q.key);
      return { label: `${q.emoji} ${text}`, question: text };
    },
  );

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
      toast.error(t("voice.notSupported", "Trình duyệt không hỗ trợ nhận dạng giọng nói."));
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
      toast.error(t("voice.recognitionFailed", "Không nhận diện được giọng nói. Vui lòng thử lại."));
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, t]);

  // ─── P3/D8 (doc 34) — image attach / remove / paste ─────────────────────────
  const notifyImageError = useCallback(
    (reason: "type" | "size" | "read") => {
      if (reason === "type") {
        toast.error(t("aiChat.imageTypeInvalid", "Ảnh không hợp lệ. Dùng PNG, JPG hoặc WebP."));
      } else if (reason === "size") {
        toast.error(
          t("aiChat.imageTooLarge", "Ảnh quá lớn (tối đa {{max}} MB).", {
            max: Math.round(MAX_CHAT_IMAGE_BYTES / (1024 * 1024)),
          }),
        );
      } else {
        toast.error(t("aiChat.imageReadError", "Không đọc được ảnh. Vui lòng thử lại."));
      }
    },
    [t],
  );

  const pickImage = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      const err = validateChatImageFile(file);
      if (err) {
        notifyImageError(err);
        return;
      }
      try {
        setAttachedImage(await readChatImageFile(file));
      } catch {
        notifyImageError("read");
      }
    },
    [notifyImageError],
  );

  // ─── Ask (streaming) ─────────────────────────────────────────────────────────
  const handleAsk = useCallback(
    async (q?: string) => {
      // P3/D8 (doc 34) — capture the attached image for THIS send, then clear it.
      const image = attachedImage;
      const query =
        (q ?? question).trim() ||
        (image ? t("aiChat.imageDefaultPrompt", "Ảnh này cho thấy gì? Hãy giải thích.") : "");
      if (!query || isStreaming) return;
      if (!isReady) {
        toast.error(t("aiChat.notReady", "Hệ thống chưa sẵn sàng. Vui lòng thử lại sau."));
        return;
      }

      const userMsgId = `u_${Date.now()}`;
      const assistantMsgId = `a_${Date.now() + 1}`;

      const history = buildConversationHistory(messages);

      setMessages((prev) => [
        ...prev,
        { id: userMsgId, type: "user", content: query, timestamp: new Date().toISOString(), hasImage: !!image },
        { id: assistantMsgId, type: "assistant", content: "", timestamp: new Date().toISOString(), streaming: true },
      ]);
      setQuestion("");
      setAttachedImage(null);
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
      let visionPayload: KbVisionNote | null = null;
      // doc69 G2-7 — set only by the non-streaming /ask fallback below (the SSE
      // path sets ChatMessage.navigateAction directly via setMessages, live).
      let navigateActionPayload: { route: string; message: string } | null = null;
      let accumulatedContent = "";

      try {
        const res = await fetch("/api/ai/local-kb/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: query,
            topK: 5,
            history,
            userRole,
            context: copilotContext,
            // P3/D8 (doc 34) — attach the image (base64 data URL) when present.
            ...(image ? { image: image.dataUrl } : {}),
          }),
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
                  // doc69 G2-7 — see ChatMessage.navigateAction's doc comment.
                  suggested?: boolean;
                };
                error?: string;
                structured?: NonNullable<ChatMessage["result"]>["structured"];
                followUpSuggestions?: string[];
                provider?: string;
                cached?: boolean;
                ok?: boolean;
                visionText?: string | null;
                reason?: string | null;
              };

              if (payload.type === "vision") {
                // P3/D8 (doc 34) — the VL reading step (or its degrade note).
                visionPayload = {
                  ok: !!payload.ok,
                  visionText: payload.visionText ?? null,
                  reason: payload.reason ?? null,
                };
                const vp = visionPayload;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, vision: vp } : m)),
                );
              } else if (payload.type === "meta") {
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
                  if (ca.suggested) {
                    // doc69 G2-7 — grounded from a how-to answer, NOT an explicit
                    // "mở trang X" command: never auto-navigate away from the
                    // answer the user is reading. Surface a 1-tap button instead.
                    const nav = { route: ca.route, message: ca.message };
                    setMessages((prev) =>
                      prev.map((m) => (m.id === assistantMsgId ? { ...m, navigateAction: nav } : m)),
                    );
                  } else {
                    if (ca.action === "prefill_form" && ca.values) {
                      publishPrefill(ca.route, ca.values);
                    }
                    setLocation(ca.route);
                  }
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
                // FE-W0.3 (doc 46 §2.3) — degenerate-loop rejected: replace the
                // streamed garbage with the clean fallback `answer` from the backend.
                if ((payload as any).degraded === true && typeof (payload as any).answer === "string") {
                  accumulatedContent = (payload as any).answer;
                  const clean = accumulatedContent;
                  setMessages((prev) =>
                    prev.map((m) => (m.id === assistantMsgId ? { ...m, content: clean } : m)),
                  );
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
              body: JSON.stringify({
                question: query,
                topK: 5,
                history,
                userRole,
                context: copilotContext,
                ...(image ? { image: image.dataUrl } : {}),
              }),
            });
            const json = await result.json() as { success: boolean; data?: any; error?: string };
            if (json.success && json.data) {
              accumulatedContent = json.data.answer ?? "";
              if (json.data.vision) visionPayload = json.data.vision as KbVisionNote;
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
              // doc69 G2-7 — a suggested navigate action from the how-to grounding
              // (never auto-navigate; same button-only treatment as the SSE path).
              if (json.data.clientAction?.suggested && json.data.clientAction?.route) {
                navigateActionPayload = {
                  route: json.data.clientAction.route,
                  message: json.data.clientAction.message,
                };
              }
            } else {
              accumulatedContent = t(
                "aiChat.processingError",
                "Xin lỗi, có lỗi xảy ra khi xử lý câu hỏi. Vui lòng thử lại.",
              );
            }
          } catch {
            accumulatedContent = t(
              "aiChat.connectionError",
              "Không thể kết nối đến hệ thống. Vui lòng kiểm tra mạng và thử lại.",
            );
          }
        }
      } finally {
        stopTypingAnimation();
        setIsStreaming(false);
        abortRef.current = null;
      }

      // doc69 B4 — reuses the existing aiChat.noAnswer key (same string AIChatPage.tsx
      // already renders for this fallback); `lng` forces the reply's DETECTED question
      // language (metaResult.language), not the active UI locale — preserves the
      // pre-existing en-vs-vi selection behavior exactly (only en/vi were ever chosen
      // here; the UI-locale-driven default the option omits was never in play before).
      const finalContent =
        accumulatedContent ||
        t("aiChat.noAnswer", {
          defaultValue: "Tôi chưa tìm được câu trả lời phù hợp. Vui lòng thử câu hỏi khác.",
          lng: metaResult?.language === "en" ? "en" : "vi",
        });

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
                vision: visionPayload ?? m.vision ?? null,
                navigateAction: navigateActionPayload ?? m.navigateAction ?? null,
              }
            : m,
        ),
      );
    },
    [question, isStreaming, isReady, messages, userRole, location, i18n.language, selection, attachedImage, t, startTypingAnimation, stopTypingAnimation],
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
          // doc69 B3 (Wave 5) — the citations shown for THIS answer, persisted
          // alongside the vote so the re-ranking aggregate can attribute it to
          // the right source(s).
          citations: (msg.result?.citations ?? []).map((c) => ({
            id: c.id,
            sourcePath: c.sourcePath,
            title: c.title,
          })),
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, feedbackGiven: vote } : m)),
        );
        toast.success(
          vote === "up"
            ? t("aiChat.feedbackThanksPositive", "Cảm ơn phản hồi tích cực!")
            : t("aiChat.feedbackThanksNegative", "Cảm ơn! Chúng tôi sẽ cải thiện."),
        );
      } catch {
        toast.error(t("aiChat.feedbackSendFailed", "Không thể gửi phản hồi."));
      }
    },
    [messages, feedbackMutation, t],
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

  // ─── G2.3c — agentic plan flow (start / approve / confirm-step / cancel) ───────
  // Authoritative state always comes from getSession; the pending write at the
  // current step is derived from the last awaiting_confirm step result's payload
  // (which IS the proposeAction DTO — same shape as the chat confirm card).
  const derivePending = useCallback(
    (status: AgentSessionStatus, stepResults: AgentStepResultView[]): PendingAction | null => {
      if (status !== "awaiting_confirm") return null;
      const last = stepResults[stepResults.length - 1];
      if (!last || last.status !== "awaiting_confirm") return null;
      const payload = (last as any).payload as PendingAction | undefined;
      return payload ?? null;
    },
    [],
  );

  // Refresh the agentic session from the server (cursor/status/stepResults +
  // derived pending write). Also fires navigate/prefill directives for any
  // newly-completed client step.
  const refreshAgentSession = useCallback(
    async (sessionId: string, prevDoneCount = 0) => {
      const lang = (i18n.language as "vi" | "en" | "zh") ?? "vi";
      const row = await utils.aiAgent.getSession.fetch({ sessionId });
      if (!row) {
        setAgentSession(null);
        return;
      }
      const status = row.status as AgentSessionStatus;
      const plan = (row.plan ?? { steps: [] }) as AgentPlanView;
      const stepResults = (row.stepResults ?? []) as unknown as AgentStepResultView[];

      // Execute client directives (navigate / prefill) for newly-completed steps.
      const completedClient = stepResults.filter(
        (r) => (r.kind === "navigate" || r.kind === "prefill") && r.status === "done",
      );
      for (const r of completedClient.slice(prevDoneCount)) {
        const directive = (r as any).payload as
          | { action?: string; route?: string; values?: Record<string, unknown> }
          | undefined;
        if (directive?.route) {
          if (directive.action === "prefill_form" && directive.values) {
            publishPrefill(directive.route, directive.values);
          }
          setLocation(directive.route);
        }
      }

      setAgentSession({
        sessionId,
        goal: row.goal,
        plan,
        status,
        cursor: row.cursor,
        stepResults,
        pendingAction: derivePending(status, stepResults),
        message: null,
        actionState: "pending",
        actionMessage: null,
      });
      void lang;
    },
    [utils, i18n.language, publishPrefill, setLocation, derivePending],
  );

  const handleStartAgentSession = useCallback(
    async (goal: string) => {
      if (!agenticEnabled || agentBusy) return;
      const trimmed = goal.trim();
      if (!trimmed) return;
      try {
        const res = await startSessionMutation.mutateAsync({
          goal: trimmed,
          lang: (i18n.language as "vi" | "en" | "zh") ?? "vi",
        });
        if (!res.ok || res.enabled === false || !res.sessionId) {
          if (res.enabled === false) return; // gated — stay silent, normal chat still works
          toast.error(res.message ?? t("agent.startFailed", "Không thể lập kế hoạch."));
          return;
        }
        setAgentSession({
          sessionId: res.sessionId,
          goal: trimmed,
          plan: (res.plan ?? { steps: [] }) as AgentPlanView,
          status: (res.status ?? "awaiting_approval") as AgentSessionStatus,
          cursor: 0,
          stepResults: [],
          pendingAction: null,
          message: res.message ?? null,
          actionState: "pending",
          actionMessage: null,
        });
      } catch {
        toast.error(t("agent.startFailed", "Không thể lập kế hoạch."));
      }
    },
    [agenticEnabled, agentBusy, startSessionMutation, i18n.language, t],
  );

  const handleStartPlaybook = useCallback(
    async (playbookId: string) => {
      if (!agenticEnabled || agentBusy) return;
      try {
        const res = await startPlaybookMutation.mutateAsync({
          playbookId,
          lang: (i18n.language as "vi" | "en" | "zh") ?? "vi",
        });
        if (!res.ok || res.enabled === false || !res.sessionId) {
          if (res.enabled === false) return;
          toast.error(res.message ?? t("agent.startFailed", "Không thể bắt đầu playbook."));
          return;
        }
        setAgentSession({
          sessionId: res.sessionId,
          goal: res.plan?.summary ?? playbookId,
          plan: (res.plan ?? { steps: [] }) as AgentPlanView,
          status: (res.status ?? "awaiting_approval") as AgentSessionStatus,
          cursor: 0,
          stepResults: [],
          pendingAction: null,
          message: res.message ?? null,
          actionState: "pending",
          actionMessage: null,
        });
      } catch {
        toast.error(t("agent.startFailed", "Không thể bắt đầu playbook."));
      }
    },
    [agenticEnabled, agentBusy, startPlaybookMutation, i18n.language, t],
  );

  const handleApprovePlan = useCallback(async () => {
    if (!agentSession || agentBusy) return;
    try {
      const res = await approvePlanMutation.mutateAsync({ sessionId: agentSession.sessionId });
      await refreshAgentSession(agentSession.sessionId, agentSession.stepResults.length);
      if (!res.ok && res.message) {
        setAgentSession((s) => (s ? { ...s, message: res.message ?? null } : s));
      }
    } catch {
      toast.error(t("agent.startFailed", "Không thể bắt đầu."));
    }
  }, [agentSession, agentBusy, approvePlanMutation, refreshAgentSession, t]);

  // Confirm the pending WRITE at the current step. confirmStep calls the CORE
  // confirmAction (HITL) server-side, then advances — we never execute the tool.
  const handleAgentConfirmStep = useCallback(async () => {
    if (!agentSession || agentBusy) return;
    const pa = agentSession.pendingAction;
    if (!pa || agentSession.status !== "awaiting_confirm") return;
    try {
      const res = await confirmStepMutation.mutateAsync({
        sessionId: agentSession.sessionId,
        actionId: pa.actionId,
        token: pa.token,
      });
      const prevDone = agentSession.stepResults.filter(
        (r) => (r.kind === "navigate" || r.kind === "prefill") && r.status === "done",
      ).length;
      await refreshAgentSession(agentSession.sessionId, prevDone);
      if (res.ok) toast.success(t("copilot.executed", "Đã thực thi."));
      else toast.error(res.message ?? t("copilot.failed", "Không thể thực thi."));
    } catch {
      toast.error(t("copilot.failed", "Không thể thực thi."));
    }
  }, [agentSession, agentBusy, confirmStepMutation, refreshAgentSession, t]);

  // Cancel the whole session (also cancels any pending proposed write server-side).
  const handleCancelAgentSession = useCallback(async () => {
    if (!agentSession) return;
    try {
      await cancelSessionMutation.mutateAsync({ sessionId: agentSession.sessionId });
      setAgentSession((s) => (s ? { ...s, status: "aborted", pendingAction: null } : s));
      toast.success(t("agent.stopped", "Đã dừng phiên."));
    } catch {
      toast.error(t("copilot.failed", "Không thể dừng."));
    }
  }, [agentSession, cancelSessionMutation, t]);

  // ─── Clear history ────────────────────────────────────────────────────────────
  const handleClearHistory = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(STORAGE_MESSAGES_KEY);
    toast.success(t("aiChat.clearHistorySuccess", "Đã xóa lịch sử trò chuyện."));
  }, [t]);

  const handleReload = async () => {
    try {
      const result = await reloadMutation.mutateAsync();
      if (result.success) toast.success(t("aiChat.reloadSuccess", "Cập nhật dữ liệu thành công!"));
      else toast.error(result.error || t("aiChat.reloadFailed", "Cập nhật thất bại."));
    } catch (error: any) {
      toast.error(error.message || t("aiChat.genericErrorFallback", "Có lỗi xảy ra."));
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  // C3a — mounted globally at App root; hide entirely when not logged in
  // (e.g. /login) so the bubble only appears for authenticated users.
  if (!user) return null;
  // UX group A — the global FAB is redundant on the full-page chat (/ai-chat),
  // so hide it there to avoid two AI entry points stacking on the same screen.
  if (location.startsWith("/ai-chat")) return null;
  // doc65 V3/V5 — /andon là wallboard TV nhìn xa: widget chat cá nhân không thuộc
  // ngữ cảnh đó và FAB đè lên ticker cảnh báo ở mép dưới → ẩn hẳn.
  if (location.startsWith("/andon")) return null;

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
                <p className="text-sm font-semibold leading-none">{t("aiChat.assistantTitle", "Trợ lý thông minh")}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {/* W0.2/W0.3 (doc 11) — honest status badge (green/amber/red). */}
                  {healthLoading ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : healthStatus === "ready" ? (
                    <>
                      <span className="inline-block size-1.5 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs text-green-600">{t("aiHealth.ready", "Sẵn sàng")}</span>
                    </>
                  ) : healthStatus === "embed_mismatch" ? (
                    <span
                      className="flex items-center gap-1.5"
                      title={t(
                        "aiHealth.embedMismatchTip",
                        "Model embedding truy vấn khác model đã build kho tri thức — kết quả tìm kiếm có thể không chính xác.",
                      )}
                    >
                      <span className="inline-block size-1.5 rounded-full bg-red-500" />
                      <span className="text-xs text-red-600">
                        {t("aiHealth.embedMismatch", "Lệch model embedding")}
                      </span>
                    </span>
                  ) : healthStatus === "extractive" ? (
                    <span
                      className="flex items-center gap-1.5"
                      title={t(
                        "aiHealth.extractiveTip",
                        "LLM chưa nạp — đang trả lời bằng trích dẫn tài liệu.",
                      )}
                    >
                      <span className="inline-block size-1.5 rounded-full bg-amber-500" />
                      <span className="text-xs text-amber-600">
                        {t("aiHealth.extractiveMode", "Chế độ trích dẫn")}
                      </span>
                    </span>
                  ) : (
                    <>
                      <span className="inline-block size-1.5 rounded-full bg-amber-500" />
                      <span className="text-xs text-amber-600">{t("aiHealth.loading", "Đang tải...")}</span>
                    </>
                  )}
                  {/* Persona fixed: trợ lý chi tiết cho mọi người dùng */}
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full border bg-muted ml-1 leading-none text-muted-foreground"
                    title={t("aiChat.personaDetailedTip", "Trợ lý trả lời chi tiết, giải thích cặn kẽ")}
                  >
                    {t("aiChat.personaDetailedLabel", "💬 Chi tiết")}
                  </span>
                  {/* doc69 B1 (Wave 5) — KB corpus age badge. staleDays is computed server-side
                      (aiLocalKnowledgeService.wholeDaysSince) and was already returned in the
                      health payload but never rendered — this wires it into the badge row that
                      already exists here (color-neutral when fresh, amber past the threshold). */}
                  {typeof health?.staleDays === "number" && (
                    <span
                      className={cn(
                        "text-xs px-1.5 py-0.5 rounded-full border ml-1 leading-none",
                        health.staleDays > KB_STALE_DAYS_THRESHOLD
                          ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                      title={t("aiHealth.kbAgeTip", {
                        defaultValue: "Kho tri thức được xây dựng cách đây {{days}} ngày.",
                        days: health.staleDays,
                      })}
                    >
                      {t("aiHealth.kbAge", { defaultValue: "KB {{days}} ngày tuổi", days: health.staleDays })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {/* G2.3c — Playbook picker (only for agentic roles). */}
              {agenticEnabled && playbooks.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title={t("agent.playbooks", "Playbook")}
                      disabled={agentBusy || !!agentSession}
                    >
                      <ListChecks className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-w-72">
                    <DropdownMenuLabel>{t("agent.playbooks", "Playbook")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {playbooks.map((pb) => {
                      const title =
                        pb.title?.[(i18n.language as "vi" | "en" | "zh")] ?? pb.title?.vi ?? pb.id;
                      return (
                        <DropdownMenuItem
                          key={pb.id}
                          onClick={() => handleStartPlaybook(pb.id)}
                          className="flex-col items-start gap-0.5"
                        >
                          <span className="text-xs font-medium">{title}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {pb.stepCount} {t("agent.stepsLabel", "bước")}
                            {pb.category ? ` · ${pb.category}` : ""}
                          </span>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={handleClearHistory}
                title={t("aiChat.clearHistoryTip", "Xóa lịch sử")}
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
                title={t("aiChat.refreshTip", "Làm mới dữ liệu")}
              >
                <RefreshCw className={cn("size-3.5", reloadMutation.isPending && "animate-spin")} />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setMinimized(true)} title={t("aiChat.minimizeTip", "Thu nhỏ")}>
                <Minus className="size-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} title={t("common.close", "Đóng")}>
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
                  <p className="font-semibold text-sm">{t("aiChat.welcomeGreeting", "Xin chào! Tôi có thể giúp gì?")}</p>
                  <p className="text-xs text-muted-foreground max-w-64">
                    {t("aiChat.welcomeSubtitle", "Hỏi tôi về cách sử dụng hệ thống, xem báo cáo, cài đặt máy móc…")}
                  </p>
                </div>
                <div className="w-full">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1 justify-center">
                    <Lightbulb className="size-3" />
                    {t("aiChat.faqLabel", "Câu hỏi thường gặp")}
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
                        <div className="space-y-1">
                          {msg.hasImage && (
                            <span className="inline-flex items-center gap-1 text-[10px] opacity-80">
                              <ImagePlus className="size-3" />
                              {t("aiChat.imageAttached", "Đã đính kèm ảnh")}
                            </span>
                          )}
                          <p className="text-xs">{msg.content}</p>
                        </div>
                      ) : (
                        <>
                          {/* P3/D8 (doc 34) — vision step: the VL reading or an honest degrade note. */}
                          {msg.vision && (
                            <div
                              className={cn(
                                "rounded-lg border px-2 py-1.5 text-[11px] leading-snug",
                                msg.vision.ok
                                  ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900/50"
                                  : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50",
                              )}
                            >
                              {msg.vision.ok ? (
                                <>
                                  <p className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1 mb-0.5">
                                    <Eye className="size-3 shrink-0" />
                                    {t("aiChat.visionReading", "Ảnh đã đọc (VL)")}
                                  </p>
                                  <p className="whitespace-pre-wrap text-foreground/80 max-h-40 overflow-y-auto">
                                    {msg.vision.visionText}
                                  </p>
                                </>
                              ) : (
                                <p className="text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                  <Eye className="size-3 shrink-0" />
                                  {t(
                                    "aiChat.visionUnavailable",
                                    "Không đọc được ảnh (thị giác không khả dụng) — trả lời chỉ dựa trên văn bản.",
                                  )}
                                </p>
                              )}
                            </div>
                          )}
                          {msg.streaming && !msg.content ? (
                            // Typing indicator with stage text
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {t(TYPING_STAGES[typingStage].key, TYPING_STAGES[typingStage].fallback)}
                              </span>
                            </div>
                          ) : (
                            <>
                              {msg.toolResult && <AIToolResultCard toolResult={msg.toolResult} />}
                              {/* doc69 G2-7 — "ask→do": 1-tap "Mở màn X" button for a
                                  how-to answer grounded in a KNOWN operational card.
                                  NEVER auto-navigates. */}
                              {msg.navigateAction && (
                                <button
                                  type="button"
                                  onClick={() => setLocation(msg.navigateAction!.route)}
                                  className="w-full flex items-center justify-between gap-2 text-[11px] rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors px-2 py-1.5 text-left"
                                >
                                  <span className="flex items-center gap-1.5 text-foreground/90">
                                    <ExternalLink className="size-3 text-primary shrink-0" />
                                    {msg.navigateAction.message}
                                  </span>
                                  <span className="text-primary font-medium shrink-0">
                                    {t("aiChat.openScreen", "Mở màn hình")}
                                  </span>
                                </button>
                              )}
                              {msg.pendingAction && (
                                <ConfirmActionCard
                                  action={msg.pendingAction}
                                  state={msg.actionState}
                                  message={msg.actionMessage}
                                  busy={confirmActionMutation.isPending || cancelActionMutation.isPending}
                                  onConfirm={() => handleConfirmAction(msg)}
                                  onCancel={() => handleCancelAction(msg)}
                                  t={t}
                                />
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
                                        <p className="font-semibold text-muted-foreground mb-1">{t("aiChat.stepsTitle", "Các bước thực hiện")}</p>
                                        <ol className="list-decimal list-inside space-y-0.5 marker:text-primary marker:font-semibold">
                                          {msg.result.structured.steps.map((s, i) => (
                                            <li key={i} className="leading-snug">{s}</li>
                                          ))}
                                        </ol>
                                      </div>
                                    )}
                                    {msg.result.structured.recommendations && msg.result.structured.recommendations.length > 0 && (
                                      <div className="text-[11px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded px-2 py-1.5">
                                        <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">{t("aiChat.recommendationsTitle", "Khuyến nghị")}</p>
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

                          {/* W0.2 (doc 11) — honest "extractive mode" note: the LLM
                              was not used for this answer (chunk-stitch fallback).
                              Non-alarming inline row, matches the metadata-row style. */}
                          {!msg.streaming && msg.result?.provider === "extractive" && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                              {t(
                                "aiHealth.extractiveAnswerNote",
                                "⚠️ Trả lời ở chế độ trích dẫn (chưa dùng LLM)",
                              )}
                            </p>
                          )}

                          {/* Metadata row */}
                          {msg.result && !msg.streaming && (
                            <div className="flex items-center gap-1.5 pt-1 border-t border-border/30 flex-wrap">
                              {(() => {
                                const conf = getConfidenceLabel(msg.result.confidence ?? 0, t);
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
                                  {t("aiChat.sourcesCount", "{{count}} nguồn", { count: msg.result.citations.length })}
                                </button>
                              )}
                              {msg.result.cached && (
                                <Badge variant="secondary" className="text-xs h-4 px-1.5">
                                  {t("aiChat.cachedBadge", "Cache")}
                                </Badge>
                              )}
                              {/* Feedback buttons */}
                              <div className="ml-auto flex items-center gap-0.5">
                                <button
                                  className={cn("p-0.5 rounded hover:bg-background/50 transition-colors", msg.feedbackGiven === "up" && "text-green-600")}
                                  onClick={() => handleFeedback(msg, "up")}
                                  disabled={!!msg.feedbackGiven}
                                  title={t("aiChat.feedbackHelpful", "Hữu ích")}
                                >
                                  <ThumbsUp className="size-3" />
                                </button>
                                <button
                                  className={cn("p-0.5 rounded hover:bg-background/50 transition-colors", msg.feedbackGiven === "down" && "text-red-500")}
                                  onClick={() => handleFeedback(msg, "down")}
                                  disabled={!!msg.feedbackGiven}
                                  title={t("aiChat.feedbackNotHelpful", "Chưa hữu ích")}
                                >
                                  <ThumbsDown className="size-3" />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Sources list — doc69 B3 (Wave 5): clickable ONLY when
                              the server resolved a whitelisted deep-link route
                              (cite.route); otherwise plain, non-clickable text
                              (honest — never navigate to an arbitrary string). */}
                          {showSources === msg.id && (msg.result?.citations?.length ?? 0) > 0 && (
                            <div className="space-y-1 pt-1 border-t border-border/30">
                              {msg.result?.citations?.slice(0, 4).map((cite: any, i: number) => (
                                <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground bg-background/60 rounded p-1.5">
                                  <span className="shrink-0 font-semibold text-primary">{i + 1}.</span>
                                  {cite.route ? (
                                    <button
                                      type="button"
                                      onClick={() => setLocation(cite.route)}
                                      title={t("aiChat.openCitation", "Mở trang liên quan")}
                                      className="break-all text-left underline decoration-dotted underline-offset-2 hover:text-primary transition-colors"
                                    >
                                      {cite.title || cite.sourcePath}
                                    </button>
                                  ) : (
                                    <span className="break-all">{cite.title || cite.sourcePath}</span>
                                  )}
                                  {/* Wave 2 đường B — phân biệt nguồn hệ thống vs tài
                                      liệu người dùng tự nạp (Training Studio). */}
                                  <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0 h-4">
                                    {cite.origin === "studio"
                                      ? t("ai.citation.studio", "Tài liệu bạn nạp")
                                      : t("ai.citation.system", "Kho hệ thống")}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Follow-up suggestions */}
                          {msg.result?.followUpSuggestions && !msg.streaming && (
                            <div className="pt-1 border-t border-border/30">
                              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                                <ChevronRight className="size-3" /> {t("aiChat.followUps", "Câu hỏi tiếp theo")}:
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

          {/* G2.3c — agentic plan panel (only for agentic roles, when a session exists) */}
          {agenticEnabled && agentSession && (
            <div className="px-3 pb-2 shrink-0 border-t pt-2 max-h-64 overflow-y-auto">
              <AgentPlanCard
                goal={agentSession.goal}
                plan={agentSession.plan}
                status={agentSession.status}
                cursor={agentSession.cursor}
                stepResults={agentSession.stepResults}
                busy={agentBusy}
                message={agentSession.message}
                onApprove={handleApprovePlan}
                onCancel={handleCancelAgentSession}
                confirmCard={
                  agentSession.pendingAction ? (
                    <ConfirmActionCard
                      action={agentSession.pendingAction}
                      state={agentSession.actionState}
                      message={agentSession.actionMessage}
                      busy={agentBusy}
                      onConfirm={handleAgentConfirmStep}
                      onCancel={handleCancelAgentSession}
                      t={t}
                    />
                  ) : null
                }
              />
              {(agentSession.status === "done" ||
                agentSession.status === "aborted" ||
                agentSession.status === "failed") && (
                <div className="flex justify-end pt-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-muted-foreground"
                    onClick={() => setAgentSession(null)}
                  >
                    {t("agent.dismiss", "Đóng")}
                  </Button>
                </div>
              )}
            </div>
          )}

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
                {t("aiChat.dataNotLoaded", "Dữ liệu chưa tải. Nhấn nút làm mới ở trên.")}
              </div>
            )}
            {/* P3/D8 (doc 34) — attached-image preview chip (remove with ×). */}
            {attachedImage && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/50 px-2 py-1.5">
                <img
                  src={attachedImage.dataUrl}
                  alt={t("aiChat.imageAttached", "Đã đính kèm ảnh")}
                  className="h-10 w-10 rounded object-cover border shrink-0"
                />
                <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
                  {attachedImage.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachedImage(null)}
                  className="rounded-full p-0.5 hover:bg-background shrink-0"
                  aria-label={t("aiChat.removeImage", "Bỏ ảnh")}
                  title={t("aiChat.removeImage", "Bỏ ảnh")}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            {/* Hidden file input driving the attach-image button. */}
            <input
              ref={imageInputRef}
              type="file"
              accept={ACCEPTED_CHAT_IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                void pickImage(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="flex gap-2 items-end border rounded-xl px-3 py-2 focus-within:border-primary/50 transition-colors bg-background">
              <Textarea
                placeholder={
                  isListening
                    ? t("aiChat.listeningPlaceholder", "Đang nghe... (nói câu hỏi của bạn)")
                    : isReady
                      ? t("aiChat.bubblePlaceholder", "Nhập câu hỏi... (Enter để gửi)")
                      : t("aiChat.startingPlaceholder", "Đang khởi động, vui lòng chờ...")
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAsk();
                  }
                }}
                onPaste={(e) => {
                  // P3/D8 (doc 34) — paste an image straight from the clipboard.
                  const f = extractImageFromClipboard(e.clipboardData?.items);
                  if (f) {
                    e.preventDefault();
                    void pickImage(f);
                  }
                }}
                disabled={!isReady || isStreaming}
                className="flex-1 min-h-9 max-h-24 resize-none border-0 focus-visible:ring-0 p-0 text-sm"
                rows={1}
              />
              {/* P3/D8 (doc 34) — attach an image (ladder/HMI/wiring/datasheet/error screen). */}
              <Button
                size="icon"
                variant={attachedImage ? "secondary" : "ghost"}
                className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => imageInputRef.current?.click()}
                disabled={!isReady || isStreaming}
                title={t("aiChat.attachImage", "Đính kèm ảnh (sơ đồ, HMI, màn hình lỗi…)")}
                aria-label={t("aiChat.attachImage", "Đính kèm ảnh")}
              >
                <ImagePlus className="size-4" />
              </Button>
              {/* G2.3c — start an agentic plan from the typed goal (agentic roles only) */}
              {agenticEnabled && !agentSession && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 h-8 w-8 rounded-lg text-primary"
                  onClick={() => handleStartAgentSession(question)}
                  disabled={!isReady || isStreaming || agentBusy || !question.trim()}
                  title={t("agent.planGoal", "Lập kế hoạch nhiều bước cho yêu cầu này")}
                >
                  {agentBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />}
                </Button>
              )}
              {/* Voice button — large touch target + labeled for hands-free/gloves use */}
              <Button
                size="icon"
                variant={isListening ? "destructive" : "secondary"}
                className={cn(
                  "shrink-0 h-10 w-10 min-h-[40px] min-w-[40px] rounded-lg",
                  isListening && "animate-pulse",
                )}
                onClick={toggleVoice}
                disabled={!isReady || isStreaming}
                title={isListening ? t("voice.stop", "Dừng nói") : t("voice.speak", "Nói")}
                aria-label={isListening ? t("voice.stop", "Dừng nói") : t("voice.speak", "Nói")}
              >
                {isListening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>
              <Button
                onClick={() => handleAsk()}
                disabled={!isReady || isStreaming || (!question.trim() && !attachedImage)}
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
          <span className="text-sm font-medium">{t("aiChat.assistantTitle", "Trợ lý thông minh")}</span>
          {isStreaming && <Loader2 className="size-3.5 animate-spin" />}
        </button>
      )}

      {/* ── FAB Button ────────────────────────────────────────────────────────── */}
      <Button
        size="icon"
        className={cn(
          // doc65 PRO-100: 56→48px — vẫn ≥40 chuẩn chạm nhưng đè ít nội dung góc màn hơn.
          "h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-all relative",
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
        title={t("nav.aiAssistant", "Trợ lý AI")}
        aria-label={t("nav.aiAssistant", "Trợ lý AI")}
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
