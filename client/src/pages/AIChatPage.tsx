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
import {
  useKbChatStream,
  type KbCitation,
  type KbStructured,
  type KbPendingAction,
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
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAIStream } from "@/hooks/useAIStream";
import MachineQuickScan from "@/components/MachineQuickScan";

// P3/W3.1 (doc 11) — Rollback switch. When true, /ai-chat sends to the
// RAG-grounded local knowledge-base backend (/api/ai/local-kb/stream) — the SAME
// endpoint the floating chat bubble uses — so it answers with full KB retrieval +
// the aiLocalTools registry. Flip to false to fall back to the old bare-LLM
// useAIStream path (/api/ai/stream/chat) with one line.
const USE_KB_BACKEND = true;

// Localized "suggested prompts" shown in the empty state for discoverability.
const SUGGESTED_PROMPTS: { emoji: string; key: string; fallback: string }[] = [
  { emoji: "📊", key: "aiChat.suggest.kpiWeek", fallback: "Tóm tắt KPI sản xuất tuần này" },
  { emoji: "🏆", key: "aiChat.suggest.topDefects", fallback: "Top lỗi nhiều nhất hôm nay là gì?" },
  { emoji: "📉", key: "aiChat.suggest.lowYield", fallback: "Trạm nào có FPY thấp nhất?" },
  { emoji: "🔧", key: "aiChat.suggest.pdm", fallback: "Máy nào có nguy cơ hỏng cao nhất?" },
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

  // Machine-context scoping (from ?machine=<code>, e.g. after a QR/NFC scan).
  // When set, questions are seeded with the machine so the assistant answers
  // about that specific machine. The user can clear the chip at any time.
  const [machineCode, setMachineCode] = useState<string | null>(null);

  // Streaming hooks.
  //  - useAIStream     → old bare-LLM path (/api/ai/stream/chat). Kept for rollback.
  //  - useKbChatStream → P3/W3.1 (doc 11) RAG-grounded path (/api/ai/local-kb/stream).
  const { streamingText, isStreaming, error: streamError, startStream, stopStream } = useAIStream();
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

  // Save streamed messages to DB
  const saveStreamedMsg = trpc.aiChat.saveStreamedMessage.useMutation({
    onSuccess: () => {
      refetchConv();
    },
  });

  // P3/W3.1 (doc 11) — unify the two streaming hooks behind one set of names so
  // the render layer is backend-agnostic. Flip USE_KB_BACKEND to switch paths.
  const effStreamingText = USE_KB_BACKEND ? kbStreamingText : streamingText;
  const effIsStreaming = USE_KB_BACKEND ? kbIsStreaming : isStreaming;
  const effStreamError = USE_KB_BACKEND ? kbStreamError : streamError;
  const effStopStream = USE_KB_BACKEND ? stopKbStream : stopStream;

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages, effStreamingText, optimisticUserMsg]);

  // Show stream errors
  useEffect(() => {
    if (effStreamError) {
      toast.error(effStreamError);
    }
  }, [effStreamError]);

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
    const source = typeof override === "string" ? override : inputMessage;
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

    // ── P3/W3.1 (doc 11) — RAG-grounded path ─────────────────────────────────
    // Send to the SAME backend the chat bubble uses so /ai-chat answers with the
    // full knowledge base + tool grounding. We pass the prior turns as `history`,
    // the auth-derived AI role, and the page context (route + UI lang + machine).
    if (USE_KB_BACKEND) {
      // Reset per-turn extras (citations/tool/structured/followups/pending) so a
      // new answer never shows the previous turn's cards.
      setLastExtras(null);
      setStreamToolResult(null);
      setShowSources(false);

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
        },
        {
          // Live tool card while streaming (mirrors the bubble).
          onToolResult: (toolResult, toolName) =>
            setStreamToolResult({ toolResult, toolName }),
          // FE-only directive: navigate / prefill_form. No DB mutation; never
          // auto-executes a write. Same behaviour as the bubble.
          onClientAction: (ca) => {
            if (!ca.route) return;
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
        });
        setStreamToolResult(null);
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
        // Stream failed (non-abort) — fall back to the tRPC chat mutation so the
        // user still gets an answer persisted.
        chatMutation.mutate({
          conversationId: String(convId),
          userMessage: userMsg,
          messages: [{ role: "user" as const, content: userMsg }],
          language: "vi",
        });
      }
      return;
    }

    // ── Legacy path (USE_KB_BACKEND === false): bare-LLM useAIStream ──────────
    const allMessages = [...existingMessages, { role: "user" as const, content: userMsg }];

    // Try streaming first
    const result = await startStream(allMessages, { maxTokens: 512, temperature: 0.7 });

    if (result) {
      // Streaming succeeded — persist messages
      setOptimisticUserMsg(null);
      saveStreamedMsg.mutate({
        conversationId: convId!,
        userMessage: userMsg,
        assistantMessage: result.fullText,
        tokensUsed: result.tokensGenerated,
      });
    } else if (!streamError?.includes("AbortError")) {
      // Streaming failed — fall back to tRPC mutation
      chatMutation.mutate({
        conversationId: String(convId),
        userMessage: userMsg,
        messages: [{ role: "user" as const, content: userMsg }],
        language: "vi",
      });
    } else {
      setOptimisticUserMsg(null);
    }
  };

  const isBusy = effIsStreaming || chatMutation.isPending;
  const messages = conversation?.messages ?? [];
  // P3/W3.1 (doc 11) — index of the last assistant message (extras render here).
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "user") return i;
    }
    return -1;
  })();

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
        {/* Tool result card (reused from the bubble) */}
        {extras.toolResult && <AIToolResultCard toolResult={extras.toolResult} />}

        {/* Pending write-action — surfaced but NEVER executed here. Direct the
            user to the bubble to confirm. We never auto-execute a write. */}
        {extras.pendingAction && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>
              {t(
                "aiChat.pendingActionNotice",
                "Thao tác ghi cần xác nhận — mở Trợ lý bong bóng để xác nhận.",
              )}
            </span>
          </div>
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
              <div className="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded px-2 py-1.5">
                <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">
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
                {extras.citations.slice(0, 5).map((c: KbCitation, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-muted-foreground bg-background/60 rounded p-1.5"
                  >
                    <span className="shrink-0 font-semibold text-primary">{i + 1}.</span>
                    <span className="break-all">{c.title || c.sourcePath}</span>
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
        <div className="w-72 border-r flex flex-col bg-muted/30">
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
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="max-w-3xl mx-auto space-y-4">
                  {messages.length === 0 && !optimisticUserMsg && !effIsStreaming && (
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
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {msg.toolCalls && (
                          <Badge variant="outline" className="mt-1.5 text-xs">
                            <Wrench className="h-3 w-3 mr-1" />
                            {t("aiChat.toolUsed", "Đã sử dụng công cụ")}
                          </Badge>
                        )}
                        {/* P3/W3.1 (doc 11) — RAG extras (citations / tool card /
                            structured / follow-ups) under the latest answer. */}
                        {USE_KB_BACKEND &&
                          msg.role !== "user" &&
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
                  {/* Streaming AI response — also shows a live tool card (KB path). */}
                  {effIsStreaming && (effStreamingText || streamToolResult) && (
                    <div className="flex gap-3 justify-start">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Zap className="h-4 w-4 text-primary animate-pulse" />
                      </div>
                      <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-muted">
                        {/* P3/W3.1 (doc 11) — live tool result while streaming. */}
                        {streamToolResult && (
                          <div className="mb-2">
                            <AIToolResultCard toolResult={streamToolResult.toolResult} />
                          </div>
                        )}
                        {effStreamingText && (
                          <p className="whitespace-pre-wrap">{effStreamingText}</p>
                        )}
                        <Badge variant="outline" className="mt-1.5 text-xs">
                          <Zap className="h-3 w-3 mr-1" />
                          {t("aiChat.streaming", "Đang stream...")}
                        </Badge>
                      </div>
                    </div>
                  )}
                  {/* Loading spinner (fallback non-streaming) */}
                  {(chatMutation.isPending || (effIsStreaming && !effStreamingText && !streamToolResult)) && (
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

              {/* Input */}
              <div className="border-t p-4">
                <div className="max-w-3xl mx-auto flex gap-2">
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
                    disabled={isBusy}
                  />
                  {effIsStreaming ? (
                    <Button variant="destructive" onClick={effStopStream}>
                      <StopCircle className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleSend()}
                      disabled={!inputMessage.trim() || isBusy}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </>
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
        </div>
      </div>
    </DashboardLayout>
  );
}
