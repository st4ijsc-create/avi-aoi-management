import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAIStream } from "@/hooks/useAIStream";

export default function AIChatPage() {
  const { t } = useTranslation();
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Streaming hook
  const { streamingText, isStreaming, error: streamError, startStream, stopStream } = useAIStream();
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

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages, streamingText, optimisticUserMsg]);

  // Show stream errors
  useEffect(() => {
    if (streamError) {
      toast.error(streamError);
    }
  }, [streamError]);

  const handleSend = async () => {
    if (!inputMessage.trim()) return;
    const userMsg = inputMessage;
    setInputMessage("");
    setOptimisticUserMsg(userMsg);

    let convId = selectedConvId;

    // Create conversation if none selected
    if (!convId) {
      try {
        const conv = await createConv.mutateAsync({ title: userMsg.slice(0, 50) });
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

  const isBusy = isStreaming || chatMutation.isPending;
  const messages = conversation?.messages ?? [];

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
          {toolsData?.tools && (
            <div className="p-3 border-t">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Wrench className="h-3 w-3" />
                {t("aiChat.toolsAvailable", "{{count}} công cụ AI khả dụng", { count: toolsData.tools.length })}
              </p>
            </div>
          )}
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col">
          {selectedConvId ? (
            <>
              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="max-w-3xl mx-auto space-y-4">
                  {messages.length === 0 && (
                    <div className="text-center py-20 text-muted-foreground">
                      <Bot className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">{t("aiChat.startPrompt", "Hãy đặt câu hỏi về chất lượng sản xuất, phân tích lỗi, hoặc hiệu suất mô hình AI...")}</p>
                    </div>
                  )}
                  {messages.map((msg: any) => (
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
                  {/* Streaming AI response */}
                  {isStreaming && streamingText && (
                    <div className="flex gap-3 justify-start">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Zap className="h-4 w-4 text-primary animate-pulse" />
                      </div>
                      <div className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm bg-muted">
                        <p className="whitespace-pre-wrap">{streamingText}</p>
                        <Badge variant="outline" className="mt-1.5 text-xs">
                          <Zap className="h-3 w-3 mr-1" />
                          {t("aiChat.streaming", "Đang stream...")}
                        </Badge>
                      </div>
                    </div>
                  )}
                  {/* Loading spinner (fallback non-streaming) */}
                  {(chatMutation.isPending || (isStreaming && !streamingText)) && (
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
                  {isStreaming ? (
                    <Button variant="destructive" onClick={stopStream}>
                      <StopCircle className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSend}
                      disabled={!inputMessage.trim() || isBusy}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Empty state */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <MessageSquare className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
                <h2 className="text-lg font-semibold mb-2">
                  {t("aiChat.welcomeTitle", "AI Manufacturing Copilot")}
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {t("aiChat.welcomeDesc", "Trợ lý AI thông minh hỗ trợ phân tích chất lượng, dự đoán lỗi, và tối ưu hóa quy trình sản xuất.")}
                </p>
                <Button
                  onClick={() => createConv.mutate({ title: t("aiChat.newConversation", "Hội thoại mới") })}
                  disabled={createConv.isPending}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  {t("aiChat.startNew", "Bắt đầu hội thoại")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
