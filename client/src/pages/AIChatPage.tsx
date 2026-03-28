import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function AIChatPage() {
  const { t } = useTranslation();
  const [selectedConvId, setSelectedConvId] = useState<number | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const chatMutation = trpc.aiChat.chat.useMutation({
    onSuccess: () => {
      refetchConv();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

  const handleSend = async () => {
    if (!inputMessage.trim()) return;

    if (!selectedConvId) {
      // Create new conversation first
      const conv = await createConv.mutateAsync({ title: inputMessage.slice(0, 50) });
      chatMutation.mutate({
        conversationId: conv.id,
        userMessage: inputMessage,
        messages: [{ role: "user" as const, content: inputMessage }],
        language: "vi",
      });
    } else {
      chatMutation.mutate({
        conversationId: selectedConvId,
        userMessage: inputMessage,
        messages: [{ role: "user" as const, content: inputMessage }],
        language: "vi",
      });
    }
    setInputMessage("");
  };

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
                      "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors",
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
                  {chatMutation.isPending && (
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
                    disabled={chatMutation.isPending}
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!inputMessage.trim() || chatMutation.isPending}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
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
