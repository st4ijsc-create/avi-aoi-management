/**
 * AI Local Knowledge Base - User-friendly Chat Interface
 * Giao diện hỏi đáp thông minh, thân thiện với mọi người dùng
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";

// Gợi ý câu hỏi nhanh theo chủ đề
const QUICK_QUESTIONS = [
  { label: "aiKb.quick.xemBaoCaoLoi.label", question: "aiKb.quick.xemBaoCaoLoi.question" },
  { label: "aiKb.quick.caiDatMay.label", question: "aiKb.quick.caiDatMay.question" },
  { label: "aiKb.quick.themSanPham.label", question: "aiKb.quick.themSanPham.question" },
  { label: "aiKb.quick.ketQuaKiemTra.label", question: "aiKb.quick.ketQuaKiemTra.question" },
  { label: "aiKb.quick.xuatDuLieu.label", question: "aiKb.quick.xuatDuLieu.question" },
  { label: "aiKb.quick.caiBaoDong.label", question: "aiKb.quick.caiBaoDong.question" },
];

function getConfidenceLabel(score: number) {
  if (score >= 0.8) return { label: "aiKb.confidence.ratPhuHop", color: "text-green-600", icon: "✅" };
  if (score >= 0.6) return { label: "aiKb.confidence.khaPhuHop", color: "text-blue-600", icon: "👍" };
  if (score >= 0.4) return { label: "aiKb.confidence.coTheHuuIch", color: "text-amber-600", icon: "💡" };
  return { label: "aiKb.confidence.thamKhaoThem", color: "text-gray-500", icon: "📖" };
}

interface ChatMessage {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  result?: any;
}

export function AILocalKnowledgeBase() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showSources, setShowSources] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: health, isLoading: healthLoading } = trpc.aiLocalKb.health.useQuery();
  const askMutation = trpc.aiLocalKb.ask.useMutation();
  const reloadMutation = trpc.aiLocalKb.reload.useMutation();

  const isReady = health?.ready || false;
  const isLoading = askMutation.isPending;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleAsk = async (q?: string) => {
    const query = (q ?? question).trim();
    if (!query) return;
    if (!isReady) {
      toast.error("Hệ thống chưa sẵn sàng. Vui lòng thử lại sau.");
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), type: "user", content: query, timestamp: new Date() },
    ]);
    setQuestion("");

    try {
      const result = await askMutation.mutateAsync({ question: query, topK: 5 });
      if (result.success && result.data) {
        const data = result.data;
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            type: "assistant",
            content: data.answer || "Tôi không tìm thấy thông tin phù hợp. Vui lòng thử diễn đạt câu hỏi theo cách khác.",
            timestamp: new Date(),
            result: data,
          },
        ]);
      } else {
        toast.error(result.error || "Không lấy được câu trả lời.");
      }
    } catch (error: any) {
      toast.error(error.message || "Có lỗi xảy ra, vui lòng thử lại.");
    }
  };

  const handleReload = async () => {
    try {
      const result = await reloadMutation.mutateAsync();
      if (result.success) {
        toast.success("Cập nhật dữ liệu thành công!");
      } else {
        toast.error(result.error || "Cập nhật thất bại.");
      }
    } catch (error: any) {
      toast.error(error.message || "Có lỗi xảy ra.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {healthLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : isReady ? (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <span className="inline-block size-2 rounded-full bg-green-500 animate-pulse" />
              Sẵn sàng · {health?.chunks?.toLocaleString() || 0} tài liệu
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-amber-600">
              <AlertCircle className="size-4" />
              Chưa sẵn sàng
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReload}
          disabled={reloadMutation.isPending}
          className="text-muted-foreground text-xs"
        >
          <RefreshCw className={cn("size-3.5 mr-1", reloadMutation.isPending && "animate-spin")} />
          Làm mới
        </Button>
      </div>

      {/* Chat Messages */}
      <div className="min-h-75 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-7 w-7 text-primary" />
              </div>
              <p className="font-semibold text-base">{t("aiLocalKb.xinChaoToiCoThe", "Xin chào! Tôi có thể giúp gì cho bạn?")}</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Hỏi tôi về cách sử dụng hệ thống, xem báo cáo, cài đặt máy móc, hay bất kỳ thắc mắc nào về nhà máy.
              </p>
            </div>
            <div className="w-full">
              <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1 justify-center">
                <Lightbulb className="size-3.5" />
                Gợi ý câu hỏi thường gặp
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {QUICK_QUESTIONS.map((q, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 rounded-full"
                    onClick={() => handleAsk(t(q.question))}
                    disabled={!isReady}
                  >
                    {t(q.label)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn("flex gap-3", msg.type === "user" ? "flex-row-reverse" : "flex-row")}
              >
                <div
                  className={cn(
                    "shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white",
                    msg.type === "user" ? "bg-primary" : "bg-slate-600"
                  )}
                >
                  {msg.type === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
                </div>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-3",
                    msg.type === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted rounded-tl-sm"
                  )}
                >
                  {msg.type === "user" ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                      {msg.result && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/30 flex-wrap">
                          {(() => {
                            const conf = getConfidenceLabel(msg.result.confidence ?? 0);
                            return (
                              <span className={cn("text-xs flex items-center gap-1", conf.color)}>
                                {conf.icon} {t(conf.label)}
                              </span>
                            );
                          })()}
                          {msg.result.citations?.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2 text-muted-foreground"
                              onClick={() => setShowSources(showSources === msg.id ? null : msg.id)}
                            >
                              <BookOpen className="size-3 mr-1" />
                              {msg.result.citations.length} nguồn tham khảo
                            </Button>
                          )}
                          {msg.result.cached && (
                            <Badge variant="secondary" className="text-xs h-5">{t("aiLocalKb.daLuuCache", "Đã lưu cache")}</Badge>
                          )}
                        </div>
                      )}
                      {showSources === msg.id && msg.result?.citations?.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-border/30">
                          <p className="text-xs text-muted-foreground font-medium">{t("aiLocalKb.taiLieuThamKhao", "Tài liệu tham khảo:")}</p>
                          {msg.result.citations.slice(0, 3).map((cite: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground bg-background/60 rounded-lg p-2">
                              <span className="shrink-0 font-semibold text-primary">{i + 1}.</span>
                              <span className="truncate">{cite.title || cite.sourcePath}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p className={cn("text-xs mt-1 opacity-50", msg.type === "user" ? "text-right" : "text-left")}>
                    {msg.timestamp.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="shrink-0 h-8 w-8 rounded-full bg-slate-600 flex items-center justify-center">
                  <Bot className="size-4 text-white" />
                </div>
                <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Quick suggestions after first message */}
      {messages.length > 0 && !isLoading && (
        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-1">
            {QUICK_QUESTIONS.map((q, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                className="text-xs h-7 rounded-full shrink-0"
                onClick={() => handleAsk(t(q.question))}
                disabled={!isReady}
              >
                {t(q.label)}
              </Button>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Input */}
      <Card className="border-2 focus-within:border-primary/50 transition-colors">
        <CardContent className="p-3">
          <div className="flex gap-2 items-end">
            <Textarea
              placeholder={
                isReady
                  ? "Nhập câu hỏi của bạn... (Enter để gửi)"
                  : "Hệ thống đang khởi động, vui lòng chờ..."
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk();
                }
              }}
              disabled={!isReady || isLoading}
              className="flex-1 min-h-11 max-h-30 resize-none border-0 focus-visible:ring-0 p-0 text-sm"
              rows={1}
            />
            <Button
              onClick={() => handleAsk()}
              disabled={!isReady || isLoading || !question.trim()}
              size="icon"
              className="shrink-0 h-9 w-9 rounded-xl"
            >
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Not Ready warning */}
      {!isReady && !healthLoading && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm">
          <AlertCircle className="size-4 text-amber-600 shrink-0" />
          <p className="text-amber-800">
            Dữ liệu chưa được tải. Nhấn <strong>{t("aiLocalKb.lamMoi", "Làm mới")}</strong> ở trên để khởi động lại.
          </p>
        </div>
      )}
    </div>
  );
}
