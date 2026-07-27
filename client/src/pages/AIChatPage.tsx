import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSearch, useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import AIGuidedActionCards from "@/components/AIGuidedActionCards";
import { useAuth } from "@/_core/hooks/useAuth";
import { mapAppRoleToAiRole } from "@/lib/aiRole";
import { useAiCopilotContext } from "@/contexts/AiCopilotContext";
import { AIToolResultCard, type ToolResultPayload } from "@/components/AIToolResultCard";
// P3/W3.1 (doc 11) — shared HITL write confirm card, reused from the bubble so
// /ai-chat can confirm/cancel a proposed WRITE INLINE (no longer "open the bubble").
import {
  ConfirmActionCard,
  type PendingAction,
  type ActionState,
} from "@/components/ConfirmActionCard";
import {
  useKbChatStream,
  readChatImageFile,
  validateChatImageFile,
  extractImageFromClipboard,
  MAX_CHAT_IMAGE_BYTES,
  ACCEPTED_CHAT_IMAGE_TYPES,
  type KbCitation,
  type KbStructured,
  type KbPendingAction,
  type KbVisionNote,
  type ChatImageAttachment,
} from "@/hooks/useKbChatStream";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Bot,
  User,
  Loader2,
  Wrench,
  StopCircle,
  Zap,
  Lightbulb,
  Cpu,
  X,
  BookOpen,
  ChevronRight,
  ImagePlus,
  Eye,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import MachineQuickScan from "@/components/MachineQuickScan";
// doc69 B2 — unify the renderer with AILocalChatBubble/AILocalKnowledgeBase:
// assistant messages render via react-markdown (safe, no raw HTML), not plain text.
import Markdown from "react-markdown";

// Localized "suggested prompts" shown in the empty state for discoverability.
const SUGGESTED_PROMPTS: { emoji: string; key: string; fallback: string }[] = [
  { emoji: "📊", key: "aiChat.suggest.kpiWeek", fallback: "Tóm tắt KPI sản xuất tuần này" },
  { emoji: "🏆", key: "aiChat.suggest.topDefects", fallback: "Top lỗi nhiều nhất hôm nay là gì?" },
  { emoji: "📉", key: "aiChat.suggest.lowYield", fallback: "Trạm nào có FPY thấp nhất?" },
  { emoji: "🔧", key: "aiChat.suggest.pdm", fallback: "Máy nào có nguy cơ hỏng cao nhất?" },
];

// doc69 B3 (Wave 5) — minimal "walk me through X" onboarding starters. Each is a
// plain how-to QUESTION, not a new mechanism: it goes through the exact SAME
// handleSend -> /api/ai/local-kb/stream pipeline as any other message, so it
// naturally classifies as intent "how_to" (server's classifyIntent — matches
// "hướng dẫn"/"cách"/"how"/"guide") and — once the operational-card corpus is
// synced (doc69 G2-7/E4) — gets grounded with a 1-tap "Mở màn hình" navigate
// button via the SAME resolveOperationalNavigate path any other how-to answer
// uses. No new guided-tour engine: this is a prompt template that reuses
// everything already built. Topics were picked to match real operational cards
// (knowledge/operational-cards.json: reports/root-cause-analysis/alerts) so a
// synced corpus is likely to ground them. Fast-follow: a topic picker sourced
// live from the operational-card index if 3 fixed starters prove too narrow.
const WALKTHROUGH_STARTERS: { emoji: string; key: string; fallback: string }[] = [
  { emoji: "🧭", key: "aiChat.walkthrough.qualityReports", fallback: "Hướng dẫn tôi cách xem báo cáo chất lượng" },
  { emoji: "🧭", key: "aiChat.walkthrough.rootCause", fallback: "Hướng dẫn tôi cách phân tích nguyên nhân gốc rễ (RCA)" },
  { emoji: "🧭", key: "aiChat.walkthrough.alerts", fallback: "Hướng dẫn tôi cách xử lý cảnh báo lỗi" },
];

// P3/W3.1 (doc 11) — extras returned by the RAG backend for the latest assistant
// turn. Rendered under the last assistant message (citations / tool card /
// structured steps / follow-ups). Kept in local state (not persisted to DB).
interface KbAnswerExtras {
  citations: KbCitation[];
  toolResult: ToolResultPayload | null;
  toolName: string | null;
  structured?: KbStructured;
  followUpSuggestions?: string[];
  provider?: string;
  cached?: boolean;
  pendingAction: KbPendingAction | null;
  // P3/D8 (doc 34) — vision step for the latest answer (VL reading or degrade note).
  vision: KbVisionNote | null;
  // doc69 G2-7 — how-to answer grounded in a KNOWN operational card: a 1-tap
  // "Mở màn X" button (NOT auto-navigated — see onClientAction below).
  navigateAction: { route: string; message: string } | null;
}

export default function AIChatPage() {
  const { t, i18n } = useTranslation();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prefillSentRef = useRef(false);

  // P3/W3.1 (doc 11) — auth role + page-published selection + prefill channel,
  // wired into the local-kb payload (same context the bubble sends).
  const { user } = useAuth();
  const { selection, publishPrefill } = useAiCopilotContext();

  // P3/W3.1 (doc 11) — extras for the most recent assistant answer + live tool
  // card during streaming. Cleared at the start of each new send.
  const [lastExtras, setLastExtras] = useState<KbAnswerExtras | null>(null);
  const [streamToolResult, setStreamToolResult] = useState<
    { toolResult: ToolResultPayload; toolName: string | null } | null
  >(null);
  const [showSources, setShowSources] = useState(false);
  // P3/D8 (doc 34) — vision-in-chat: image attached to the next send + the live VL
  // step surfaced while streaming (mirrors the bubble).
  const [attachedImage, setAttachedImage] = useState<ChatImageAttachment | null>(null);
  const [streamVision, setStreamVision] = useState<KbVisionNote | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // P3/W3.1 (doc 11) — inline HITL confirm state for the latest turn's pending
  // write (mirrors the bubble's per-message actionState/actionMessage). The
  // proposed action itself lives in lastExtras.pendingAction; these track its
  // lifecycle (pending → executed/cancelled/denied/expired) + backend message.
  const [actionState, setActionState] = useState<ActionState>("pending");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Machine-context scoping (from ?machine=<code>, e.g. after a QR/NFC scan).
  // When set, questions are seeded with the machine so the assistant answers
  // about that specific machine. The user can clear the chip at any time.
  const [machineCode, setMachineCode] = useState<string | null>(null);

  // Streaming hook — P3/W3.1 (doc 11) RAG-grounded path (/api/ai/local-kb/stream).
  // doc69 B2 removed the legacy bare-LLM useAIStream fallback + USE_KB_BACKEND
  // toggle — this is now the ONLY streaming engine (useAIStream the hook is kept
  // for DashboardAIWidget, which still uses it independently).
  const {
    streamingText: kbStreamingText,
    isStreaming: kbIsStreaming,
    error: kbStreamError,
    abortedRef: kbAbortedRef,
    startKbStream,
    stopKbStream,
  } = useKbChatStream();
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);

  // Conversations list
  const { data: conversations, isLoading: loadingConvs, refetch: refetchConvs } =
    trpc.aiChat.listConversations.useQuery({ limit: 50 });

  // Current conversation messages
  const { data: conversation, refetch: refetchConv } =
    trpc.aiChat.getConversation.useQuery(
      { id: selectedConvId!, messageLimit: 100 },
      { enabled: selectedConvId !== null }
    );

  // Available tools
  const { data: toolsData } = trpc.aiChat.tools.useQuery();

  // Machine list — used to resolve the ?machine=<code> param to a display name.
  const { data: machinesData } = trpc.machine.list.useQuery(undefined, {
    enabled: machineCode !== null,
  });
  const machineContext = machineCode
    ? (machinesData ?? []).find(
        (m: any) => String(m.code).toLowerCase() === machineCode.toLowerCase(),
      ) ?? null
    : null;

  // Mutations
  const createConv = trpc.aiChat.createConversation.useMutation({
    onSuccess: (data) => {
      setSelectedConvId(data.id);
      refetchConvs();
    },
  });

  const deleteConv = trpc.aiChat.deleteConversation.useMutation({
    onSuccess: () => {
      setSelectedConvId(null);
      refetchConvs();
    },
  });

  // Fallback: non-streaming chat mutation
  const chatMutation = trpc.aiChat.chat.useMutation({
    onSuccess: () => {
      setOptimisticUserMsg(null);
      refetchConv();
    },
    onError: (err) => {
      setOptimisticUserMsg(null);
      toast.error(err.message);
    },
  });

  // P3/W3.1 (doc 11) — HITL write-action confirm/cancel (SAME mutations the
  // bubble uses). The card only fires these on the user's explicit click; a
  // pending write is NEVER auto-executed.
  const confirmActionMutation = trpc.aiCopilot.confirmAction.useMutation();
  const cancelActionMutation = trpc.aiCopilot.cancelAction.useMutation();

  // Save streamed messages to DB
  const saveStreamedMsg = trpc.aiChat.saveStreamedMessage.useMutation({
    onSuccess: () => {
      refetchConv();
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages, kbStreamingText, optimisticUserMsg]);

  // Show stream errors
  useEffect(() => {
    if (kbStreamError) {
      toast.error(kbStreamError);
    }
  }, [kbStreamError]);

  // Deep-link prefill: /ai-chat?q=...&machine=<code> (e.g. from a QR/NFC scan via
  // MachineQuickScan, or MachineAISummary "Hỏi AI"). Read ?machine= to scope the
  // conversation, then send ?q= once. Both are honoured together.
  useEffect(() => {
    if (prefillSentRef.current) return;
    const params = new URLSearchParams(search);
    const machine = params.get("machine");
    if (machine && machine.trim()) {
      setMachineCode(machine.trim());
    }
    const q = params.get("q");
    if (q && q.trim()) {
      prefillSentRef.current = true;
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      void handleSend(q, machine?.trim() || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSend = async (override?: string, machineOverride?: string) => {
    // P3/D8 (doc 34) — capture the attached image for THIS send. An image with no
    // text is allowed (falls back to a default "what does this show?" prompt).
    const image = attachedImage;
    const source =
      typeof override === "string"
        ? override
        : inputMessage.trim() ||
          (image ? t("aiChat.imageDefaultPrompt", "Ảnh này cho thấy gì? Hãy giải thích.") : "");
    if (!source.trim()) return;
    // Seed machine context: prefer an explicit override (deep-link), else the
    // active chip. We prepend a short scope line so the local model answers about
    // that machine. The chip the user sees stays the displayed message.
    const scopeCode = machineOverride ?? machineCode ?? undefined;
    const displayMsg = source;
    const userMsg = scopeCode
      ? `${t("aiChat.machineScopePrefix", "[Bối cảnh: Máy {{code}}]", { code: scopeCode })} ${source}`
      : source;
    setInputMessage("");
    setAttachedImage(null);
    setOptimisticUserMsg(displayMsg);

    let convId = selectedConvId;

    // Create conversation if none selected
    if (!convId) {
      try {
        const conv = await createConv.mutateAsync({ title: displayMsg.slice(0, 50) });
        convId = conv.id;
      } catch {
        setOptimisticUserMsg(null);
        return;
      }
    }

    // Build messages for context — limit to last 10 messages to speed up GGUF inference
    const existingMessages = (conversation?.messages ?? []).slice(-10).map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // ── P3/W3.1 (doc 11) — RAG-grounded path (SOLE engine; doc69 B2 removed the
    // legacy bare-LLM useAIStream fallback + USE_KB_BACKEND toggle) ──────────
    // Send to the SAME backend the chat bubble uses so /ai-chat answers with the
    // full knowledge base + tool grounding. We pass the prior turns as `history`,
    // the auth-derived AI role, and the page context (route + UI lang + machine).
    // Reset per-turn extras (citations/tool/structured/followups/pending) so a
    // new answer never shows the previous turn's cards.
    setLastExtras(null);
    setStreamToolResult(null);
    setStreamVision(null);
    setShowSources(false);
    // P3/W3.1 (doc 11) — reset the inline confirm lifecycle for the new turn.
    setActionState("pending");
    setActionMessage(null);

    const kbResult = await startKbStream(
      {
        question: userMsg,
        topK: 5,
        history: existingMessages,
        userRole: mapAppRoleToAiRole(user?.role),
        context: {
          route: "/ai-chat",
          uiLanguage: i18n.language,
          selectedMachineCode:
            scopeCode ?? selection.selectedMachineCode ?? undefined,
        },
        // P3/D8 (doc 34) — attach the image (base64 data URL) when present.
        image: image?.dataUrl,
      },
      {
        // Live tool card while streaming (mirrors the bubble).
        onToolResult: (toolResult, toolName) =>
          setStreamToolResult({ toolResult, toolName }),
        // P3/D8 (doc 34) — live VL step (shown above the streaming answer).
        onVision: (v) => setStreamVision(v),
        // FE-only directive: navigate / prefill_form. No DB mutation; never
        // auto-executes a write. Same behaviour as the bubble — EXCEPT doc69
        // G2-7's `suggested` (grounded from a how-to answer, not an explicit
        // "mở trang X" command): that one must NOT auto-navigate the user away
        // from the answer they're reading. It's surfaced as a button instead
        // (rendered in renderKbExtras via lastExtras.navigateAction below).
        onClientAction: (ca) => {
          if (!ca.route) return;
          if (ca.suggested) return; // handled via lastExtras.navigateAction, not here
          if (ca.action === "prefill_form" && ca.values) {
            publishPrefill(ca.route, ca.values);
          }
          setLocation(ca.route);
        },
      },
    );

    if (kbResult) {
      setOptimisticUserMsg(null);
      // Stash the extras so they render under the persisted assistant message.
      setLastExtras({
        citations: kbResult.citations,
        toolResult: kbResult.toolResult,
        toolName: kbResult.toolName,
        structured: kbResult.structured,
        followUpSuggestions: kbResult.followUpSuggestions,
        provider: kbResult.provider,
        cached: kbResult.cached,
        pendingAction: kbResult.pendingAction,
        vision: kbResult.vision,
        navigateAction:
          kbResult.clientAction?.suggested && kbResult.clientAction.route
            ? { route: kbResult.clientAction.route, message: kbResult.clientAction.message }
            : null,
      });
      setStreamToolResult(null);
      setStreamVision(null);
      // saveStreamedMessage requires a non-empty assistant message.
      const assistantText =
        kbResult.fullText.trim() ||
        t(
          "aiChat.noAnswer",
          "Tôi chưa tìm được câu trả lời phù hợp. Vui lòng thử câu hỏi khác.",
        );
      saveStreamedMsg.mutate({
        conversationId: convId!,
        userMessage: userMsg,
        assistantMessage: assistantText,
      });
    } else if (kbAbortedRef.current) {
      // User cancelled — just drop the optimistic message, persist nothing.
      setOptimisticUserMsg(null);
      setStreamToolResult(null);
    } else {
      // Stream failed (non-abort) — fall back to the tRPC `chat` mutation. P1
      // (doc 11): that mutation now routes through the SAME RAG/KB backend
      // (`answerQuestion`) as the stream, so the fallback answer is grounded in
      // the knowledge base + tools (extractive on LLM failure) — never the old
      // no-RAG assistant. We pass the prior turns so RAG keeps conversational
      // context, not just the latest message.
      chatMutation.mutate({
        conversationId: String(convId),
        userMessage: userMsg,
        messages: [...existingMessages, { role: "user" as const, content: userMsg }],
        language: "vi",
      });
    }
  };

  // ── P3/W3.1 (doc 11) — inline confirm / cancel of the proposed write ─────────
  // Mirrors AILocalChatBubble.handleConfirmAction / handleCancelAction: pass
  // { actionId, token, lang } to confirm and { actionId } to cancel, then update
  // the lifecycle state from res.status / res.ok and toast the result. Only ever
  // fired by the user's Confirm/Cancel click — never auto-executed.
  const handleConfirmAction = useCallback(async () => {
    const pa = lastExtras?.pendingAction;
    if (!pa || actionState !== "pending") return;
    try {
      const res = await confirmActionMutation.mutateAsync({
        actionId: pa.actionId,
        token: pa.token,
        lang: (i18n.language as "vi" | "en" | "zh") ?? "vi",
      });
      const next: ActionState =
        res.status === "executed" ? "executed"
        : res.status === "denied" ? "denied"
        : res.status === "expired" ? "expired"
        : "pending";
      setActionState(next);
      setActionMessage(res.message ?? null);
      if (res.ok) toast.success(res.message ?? t("copilot.executed", "Đã thực thi."));
      else toast.error(res.message ?? t("copilot.failed", "Không thể thực thi."));
    } catch {
      toast.error(t("copilot.failed", "Không thể thực thi."));
    }
  }, [lastExtras, actionState, confirmActionMutation, i18n.language, t]);

  const handleCancelAction = useCallback(async () => {
    const pa = lastExtras?.pendingAction;
    if (!pa || actionState !== "pending") return;
    try {
      const res = await cancelActionMutation.mutateAsync({ actionId: pa.actionId });
      setActionState("cancelled");
      setActionMessage(res.message ?? null);
      toast.success(t("copilot.cancelled", "Đã hủy."));
    } catch {
      toast.error(t("copilot.failed", "Không thể hủy."));
    }
  }, [lastExtras, actionState, cancelActionMutation, t]);

  // ── P3/D8 (doc 34) — image attach / remove / paste ──────────────────────────
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

  const isBusy = kbIsStreaming || chatMutation.isPending;
  const messages = conversation?.messages ?? [];
  // P3/W3.1 (doc 11) — index of the last assistant message (extras render here).
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "user") return i;
    }
    return -1;
  })();

  // P3/D8 (doc 34) — render the vision step (VL reading or an honest degrade note).
  const renderVisionNote = (v: KbVisionNote) => (
    <div
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-xs leading-snug",
        v.ok
          ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900/50"
          : "bg-warning/10 border-warning/30",
      )}
    >
      {v.ok ? (
        <>
          <p className="font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1 mb-0.5">
            <Eye className="h-3 w-3 shrink-0" />
            {t("aiChat.visionReading", "Ảnh đã đọc (VL)")}
          </p>
          <p className="whitespace-pre-wrap text-foreground/80 max-h-48 overflow-y-auto">
            {v.visionText}
          </p>
        </>
      ) : (
        <p className="text-warning flex items-center gap-1">
          <Eye className="h-3 w-3 shrink-0" />
          {t(
            "aiChat.visionUnavailable",
            "Không đọc được ảnh (thị giác không khả dụng) — trả lời chỉ dựa trên văn bản.",
          )}
        </p>
      )}
    </div>
  );

  // P3/W3.1 (doc 11) — render the RAG extras block (citations / structured steps /
  // recommendations / follow-up chips / pending-write notice) under an answer.
  const renderKbExtras = (extras: KbAnswerExtras) => {
    const s = extras.structured;
    const hasStructured =
      !!s &&
      (s.navigationPath ||
        (s.steps && s.steps.length > 0) ||
        (s.recommendations && s.recommendations.length > 0));
    return (
      <div className="mt-2 space-y-2">
        {/* P3/D8 (doc 34) — vision step for this answer (VL reading / degrade note). */}
        {extras.vision && renderVisionNote(extras.vision)}
        {/* Tool result card (reused from the bubble) */}
        {extras.toolResult && <AIToolResultCard toolResult={extras.toolResult} />}

        {/* doc69 G2-7 — "ask→do": 1-tap "Mở màn X" button for a how-to answer
            grounded in a KNOWN operational card. NEVER auto-navigates — the user
            taps to leave the answer they're reading. */}
        {extras.navigateAction && (
          <button
            type="button"
            onClick={() => setLocation(extras.navigateAction!.route)}
            className="w-full flex items-center justify-between gap-2 text-xs rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors px-2.5 py-1.5 text-left"
          >
            <span className="flex items-center gap-1.5 text-foreground/90">
              <ExternalLink className="h-3.5 w-3.5 text-primary shrink-0" />
              {extras.navigateAction.message}
            </span>
            <span className="text-primary font-medium shrink-0">
              {t("aiChat.openScreen", "Mở màn hình")}
            </span>
          </button>
        )}

        {/* P3/W3.1 (doc 11) — proposed write-action: confirmed/cancelled INLINE
            via the shared card (same component + mutations the bubble uses). The
            write is NEVER auto-executed — it fires only on the user's click. */}
        {extras.pendingAction && (
          <ConfirmActionCard
            action={extras.pendingAction as PendingAction}
            state={actionState}
            message={actionMessage}
            busy={confirmActionMutation.isPending || cancelActionMutation.isPending}
            onConfirm={handleConfirmAction}
            onCancel={handleCancelAction}
            t={t}
          />
        )}

        {/* Structured navigation / steps / recommendations */}
        {hasStructured && (
          <div className="space-y-1.5">
            {s!.navigationPath && (
              <div className="flex items-start gap-1.5 text-xs bg-background/60 border border-border/40 rounded px-2 py-1">
                <ChevronRight className="h-3 w-3 mt-px shrink-0 text-primary" />
                <span className="font-medium text-foreground/80">{s!.navigationPath}</span>
              </div>
            )}
            {s!.steps && s!.steps.length > 0 && (
              <div className="text-xs bg-background/60 border border-border/40 rounded px-2 py-1.5">
                <p className="font-semibold text-muted-foreground mb-1">
                  {t("aiChat.stepsTitle", "Các bước thực hiện")}
                </p>
                <ol className="list-decimal list-inside space-y-0.5 marker:text-primary marker:font-semibold">
                  {s!.steps.map((step, i) => (
                    <li key={i} className="leading-snug">{step}</li>
                  ))}
                </ol>
              </div>
            )}
            {s!.recommendations && s!.recommendations.length > 0 && (
              <div className="text-xs bg-warning/10 border border-warning/30 rounded px-2 py-1.5">
                <p className="font-semibold text-warning mb-1">
                  {t("aiChat.recommendationsTitle", "Khuyến nghị")}
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {s!.recommendations.map((r, i) => (
                    <li key={i} className="leading-snug">{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Citations (sources count + collapsible list) */}
        {extras.citations.length > 0 && (
          <div className="space-y-1">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => setShowSources((v) => !v)}
            >
              <BookOpen className="h-3 w-3" />
              {t("aiChat.sourcesCount", "{{count}} nguồn", { count: extras.citations.length })}
            </button>
            {showSources && (
              <div className="space-y-1">
                {/* doc69 B3 (Wave 5) — a citation is clickable ONLY when the server
                    resolved a whitelisted deep-link route (c.route); otherwise it
                    stays plain, non-clickable text (honest — never navigate to an
                    arbitrary string). */}
                {extras.citations.slice(0, 5).map((c: KbCitation, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground bg-background/60 rounded p-1.5"
                  >
                    <span className="shrink-0 font-semibold text-primary">{i + 1}.</span>
                    {c.route ? (
                      <button
                        type="button"
                        onClick={() => setLocation(c.route!)}
                        title={t("aiChat.openCitation", "Mở trang liên quan")}
                        className="break-all text-left underline decoration-dotted underline-offset-2 hover:text-primary transition-colors"
                      >
                        {c.title || c.sourcePath}
                      </button>
                    ) : (
                      <span className="break-all">{c.title || c.sourcePath}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Follow-up suggestion chips */}
        {extras.followUpSuggestions && extras.followUpSuggestions.length > 0 && (
          <div className="pt-1 border-t border-border/30">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              {t("aiChat.followUps", "Câu hỏi tiếp theo")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {extras.followUpSuggestions.slice(0, 3).map((sug, i) => (
                <button
                  key={i}
                  className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-muted transition-colors disabled:opacity-50"
                  onClick={() => handleSend(sug)}
                  disabled={isBusy}
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* Sidebar - Conversations */}
        <div className="hidden md:flex w-72 border-r flex-col bg-muted/30">
          <div className="p-3 border-b">
            <Button
              className="w-full"
              size="sm"
              onClick={() => createConv.mutate({ title: t("aiChat.newConversation", "Hội thoại mới") })}
              disabled={createConv.isPending}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t("aiChat.newChat", "Hội thoại mới")}
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {loadingConvs ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {conversations?.conversations?.map((conv: any) => (
                  <div
                    key={conv.id}
                    className={cn(
                      "group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors",
                      selectedConvId === conv.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted"
                    )}
                    onClick={() => setSelectedConvId(conv.id)}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    <span className="truncate flex-1">{conv.title || t("aiChat.untitled", "Không tiêu đề")}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConv.mutate({ id: conv.id });
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {(!conversations?.conversations || conversations.conversations.length === 0) && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    {t("aiChat.noConversations", "Chưa có hội thoại nào")}
                  </p>
                )}
              </div>
            )}
          </ScrollArea>
          {/* Tools info */}
          {toolsData && toolsData.length > 0 && (
            <div className="p-3 border-t">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Wrench className="h-3 w-3" />
                {t("aiChat.toolsAvailable", "{{count}} công cụ AI khả dụng", { count: toolsData.length })}
              </p>
            </div>
          )}
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Machine-context chip (from ?machine= / QR-NFC scan) — clearable */}
          {machineCode && (
            <div className="border-b bg-primary/5 px-4 py-2">
              <div className="max-w-3xl mx-auto flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className="flex items-center gap-1.5 py-1 pl-2 pr-1 text-xs"
                >
                  <Cpu className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium">
                    {t("aiChat.machineContextChip", "Đang hỏi về: Máy {{code}}", {
                      code: machineContext?.code ?? machineCode,
                    })}
                  </span>
                  {machineContext?.name && (
                    <span className="text-muted-foreground">· {machineContext.name}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setMachineCode(null)}
                    aria-label={t("aiChat.clearMachineContext", "Bỏ bối cảnh máy")}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              </div>
            </div>
          )}
          {selectedConvId ? (
            /* Messages */
            <ScrollArea className="flex-1 p-4">
                <div className="max-w-3xl mx-auto space-y-4">
                  {messages.length === 0 && !optimisticUserMsg && !kbIsStreaming && (
                    <div className="py-10">
                      <div className="text-center text-muted-foreground mb-6">
                        <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">{t("aiChat.startPrompt", "Hãy đặt câu hỏi về chất lượng sản xuất, phân tích lỗi, hoặc hiệu suất mô hình AI...")}</p>
                      </div>
                      <div className="mb-5 flex justify-center">
                        <MachineQuickScan size="lg" variant="default" className="min-h-[44px]" />
                      </div>
                      <div className="mb-5">
                        <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                          <Lightbulb className="h-3.5 w-3.5 text-primary" />
                          {t("aiChat.suggestedPrompts", "Gợi ý câu hỏi")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {SUGGESTED_PROMPTS.map((p, i) => {
                            const text = t(p.key, p.fallback);
                            return (
                              <button
                                key={i}
                                onClick={() => handleSend(text)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1.5 rounded-full border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {p.emoji} {text}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* doc69 B3 (Wave 5) — "walk me through X" onboarding starters:
                          plain how-to prompts, same send pipeline, grounded via the
                          existing operational-card system (no new mechanism). */}
                      <div className="mb-5">
                        <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                          <ChevronRight className="h-3.5 w-3.5 text-primary" />
                          {t("aiChat.walkthroughLabel", "Hướng dẫn từng bước")}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {WALKTHROUGH_STARTERS.map((p, i) => {
                            const text = t(p.key, p.fallback);
                            return (
                              <button
                                key={i}
                                onClick={() => handleSend(text)}
                                disabled={isBusy}
                                className="text-xs px-3 py-1.5 rounded-full border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {p.emoji} {text}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <AIGuidedActionCards onSend={(req) => handleSend(req)} disabled={isBusy} />
                    </div>
                  )}
                  {messages.map((msg: any, idx: number) => (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex gap-3",
                        msg.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      {msg.role !== "user" && (
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Bot className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-4 py-2.5 text-sm",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        )}
                      >
                        {/* doc69 B2 — assistant messages render via react-markdown
                            (mirrors AILocalChatBubble/AILocalKnowledgeBase); user
                            messages stay plain text. */}
                        {msg.role === "user" ? (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                            <Markdown>{msg.content}</Markdown>
                          </div>
                        )}
                        {msg.toolCalls && (
                          <Badge variant="outline" className="mt-1.5 text-xs">
                            <Wrench className="h-3 w-3 mr-1" />
                            {t("aiChat.toolUsed", "Đã sử dụng công cụ")}
                          </Badge>
                        )}
                        {/* P3/W3.1 (doc 11) — RAG extras (citations / tool card /
                            structured / follow-ups) under the latest answer. */}
                        {msg.role !== "user" &&
                          idx === lastAssistantIdx &&
                          lastExtras &&
                          renderKbExtras(lastExtras)}
                      </div>
                      {msg.role === "user" && (
                        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                          <User className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Optimistic user message */}
                  {optimisticUserMsg && (
                    <div className="flex gap-3 justify-end">
                      <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-primary text-primary-foreground">
                        <p className="whitespace-pre-wrap">{optimisticUserMsg}</p>
                      </div>
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <User className="h-4 w-4" />
                      </div>
                    </div>
                  )}
                  {/* Streaming AI response — also shows a live vision + tool card (KB path). */}
                  {kbIsStreaming && (kbStreamingText || streamToolResult || streamVision) && (
                    <div className="flex gap-3 justify-start">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Zap className="h-4 w-4 text-primary animate-pulse" />
                      </div>
                      <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-muted">
                        {/* P3/D8 (doc 34) — live VL step while streaming. */}
                        {streamVision && <div className="mb-2">{renderVisionNote(streamVision)}</div>}
                        {/* P3/W3.1 (doc 11) — live tool result while streaming. */}
                        {streamToolResult && (
                          <div className="mb-2">
                            <AIToolResultCard toolResult={streamToolResult.toolResult} />
                          </div>
                        )}
                        {kbStreamingText && (
                          <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                            <Markdown>{kbStreamingText}</Markdown>
                          </div>
                        )}
                        <Badge variant="outline" className="mt-1.5 text-xs">
                          <Zap className="h-3 w-3 mr-1" />
                          {t("aiChat.streaming", "Đang stream...")}
                        </Badge>
                      </div>
                    </div>
                  )}
                  {/* Loading spinner (fallback non-streaming) */}
                  {(chatMutation.isPending ||
                    (kbIsStreaming && !kbStreamingText && !streamToolResult && !streamVision)) && (
                    <div className="flex gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                      <div className="bg-muted rounded-lg px-4 py-3">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
          ) : (
            /* Empty state — welcome + discoverability (suggested prompts + guided cards) */
            <ScrollArea className="flex-1">
              <div className="max-w-2xl mx-auto px-4 py-10">
                <div className="text-center mb-6">
                  <MessageSquare className="h-14 w-14 mx-auto mb-3 text-muted-foreground/30" />
                  <h2 className="text-lg font-semibold mb-2">
                    {t("aiChat.welcomeTitle", "AI Manufacturing Copilot")}
                  </h2>
                  <p className="text-sm text-muted-foreground mb-1">
                    {t("aiChat.welcomeDesc", "Trợ lý AI thông minh hỗ trợ phân tích chất lượng, dự đoán lỗi, và tối ưu hóa quy trình sản xuất.")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("aiChat.whatYouCanAsk", "Bạn có thể hỏi về KPI, lỗi, hiệu suất máy — hoặc dùng các tác vụ kỹ thuật có hướng dẫn bên dưới.")}
                  </p>
                </div>

                {/* Scan-a-machine entry — minimum-effort shop-floor scoping */}
                <div className="mb-6 flex justify-center">
                  <MachineQuickScan size="lg" variant="default" className="min-h-[44px]" />
                </div>

                {/* Suggested prompts */}
                <div className="mb-6">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5 text-primary" />
                    {t("aiChat.suggestedPrompts", "Gợi ý câu hỏi")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_PROMPTS.map((p, i) => {
                      const text = t(p.key, p.fallback);
                      return (
                        <button
                          key={i}
                          onClick={() => handleSend(text)}
                          disabled={isBusy || createConv.isPending}
                          className="text-xs px-3 py-1.5 rounded-full border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {p.emoji} {text}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* doc69 B3 (Wave 5) — "walk me through X" onboarding starters (see
                    the constant's doc comment: reuses the existing operational-card
                    grounding, no new guided-tour engine). */}
                <div className="mb-6">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                    <ChevronRight className="h-3.5 w-3.5 text-primary" />
                    {t("aiChat.walkthroughLabel", "Hướng dẫn từng bước")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {WALKTHROUGH_STARTERS.map((p, i) => {
                      const text = t(p.key, p.fallback);
                      return (
                        <button
                          key={i}
                          onClick={() => handleSend(text)}
                          disabled={isBusy || createConv.isPending}
                          className="text-xs px-3 py-1.5 rounded-full border bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {p.emoji} {text}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Guided write-action cards (role-gated inside the component) */}
                <AIGuidedActionCards
                  onSend={(req) => handleSend(req)}
                  disabled={isBusy || createConv.isPending}
                  className="mb-6"
                />

                <div className="text-center">
                  <Button
                    variant="outline"
                    onClick={() => createConv.mutate({ title: t("aiChat.newConversation", "Hội thoại mới") })}
                    disabled={createConv.isPending}
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    {t("aiChat.startNew", "Bắt đầu hội thoại")}
                  </Button>
                </div>
              </div>
            </ScrollArea>
          )}

          {/* Input — B7 (doc 46 §2.3): ALWAYS render the textbox + send button,
              even before a conversation exists (handleSend lazily creates one) and
              regardless of AI model availability. Previously the input only mounted
              when a conversation was selected, so a fresh /ai-chat showed suggested
              prompts but NO way to type — the reported "missing input box" bug. */}
          <div className="border-t p-4">
            <div className="max-w-3xl mx-auto space-y-2">
              {/* P3/D8 (doc 34) — attached-image preview chip (remove with ×). */}
              {attachedImage && (
                <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-2 py-1.5">
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
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
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
                {/* P3/D8 (doc 34) — attach an image (ladder/HMI/wiring/datasheet/error screen). */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isBusy}
                  title={t("aiChat.attachImage", "Đính kèm ảnh (sơ đồ, HMI, màn hình lỗi…)")}
                  aria-label={t("aiChat.attachImage", "Đính kèm ảnh")}
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder={t("aiChat.placeholder", "Nhập câu hỏi của bạn...")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
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
                  disabled={isBusy}
                />
                {kbIsStreaming ? (
                  <Button variant="destructive" onClick={stopKbStream}>
                    <StopCircle className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleSend()}
                    disabled={(!inputMessage.trim() && !attachedImage) || isBusy}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
