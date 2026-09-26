/**
 * DashboardAIWidget — Compact AI insights & mini-chat for the main Dashboard
 *
 * Shows a quick AI question box and links to the full AI Chat page.
 * Uses SSE streaming for real-time responses.
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Send, Zap, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { useAIStream } from "@/hooks/useAIStream";
import { Link } from "wouter";

interface QuickMessage {
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS = [
  "dashboardAIWidget.tongQuanChatLuongHom",
  "dashboardAIWidget.mayNaoCanChuY",
  "dashboardAIWidget.phanTichXuHuongNg",
];

export function DashboardAIWidget() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<QuickMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { streamingText, isStreaming, startStream } = useAIStream();

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSend = async (text?: string) => {
    const msg = text ?? input;
    if (!msg.trim() || isStreaming) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: msg }]);

    const chatMessages = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: msg },
    ];

    const result = await startStream(chatMessages, {
      maxTokens: 512,
      temperature: 0.5,
    });

    if (result) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.fullText },
      ]);
    }
  };

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("dashboard.aiAssistant", "AI Manufacturing Copilot")}
          </CardTitle>
          <Link href="/ai-chat">
            <Button variant="ghost" size="sm" className="text-xs gap-1">
              {t("dashboard.openFullChat", "Mở chat đầy đủ")}
              <ExternalLink className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Quick prompts */}
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt) => (
              <Button
                key={prompt}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => handleSend(t(prompt))}
                disabled={isStreaming}
              >
                {t(prompt)}
              </Button>
            ))}
          </div>
        )}

        {/* Message area */}
        {messages.length > 0 && (
          <ScrollArea className="max-h-48">
            <div className="space-y-2">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  )}
                  <div
                    className={`text-xs rounded-md px-3 py-1.5 max-w-[85%] ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {/* Streaming response */}
              {isStreaming && streamingText && (
                <div className="flex gap-2 justify-start">
                  <Zap className="h-5 w-5 text-primary shrink-0 mt-0.5 animate-pulse" />
                  <div className="text-xs rounded-md px-3 py-1.5 max-w-[85%] bg-muted">
                    <p className="whitespace-pre-wrap">{streamingText}</p>
                  </div>
                </div>
              )}
              {isStreaming && !streamingText && (
                <div className="flex gap-2 justify-start">
                  <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("dashboard.aiQuickAsk", "Hỏi nhanh AI về sản xuất...")}
            className="text-xs h-8"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isStreaming}
          />
          <Button
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => handleSend()}
            disabled={!input.trim() || isStreaming}
          >
            <Send className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
