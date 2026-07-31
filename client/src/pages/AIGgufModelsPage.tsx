/**
 * AI GGUF Models Page
 * Management dashboard for local .gguf LLM models:
 * - List available/loaded models, load/unload controls
 * - Text generation playground
 * - Chat interface
 * - Status & GPU info
 */

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Cpu,
  HardDrive,
  Play,
  Square,
  Send,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Settings2,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Bot,
  User,
  Server,
  Wifi,
  WifiOff,
} from "lucide-react";

export default function AIGgufModelsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("models");

  const status = trpc.aiGguf.status.useQuery(undefined, { refetchInterval: 10000 });
  const models = trpc.aiGguf.listModels.useQuery(undefined, { enabled: status.data?.available });
  const providerStatus = trpc.aiGguf.providerStatus.useQuery(undefined, { refetchInterval: 15000 });

  const loadModel = trpc.aiGguf.loadModel.useMutation({
    onSuccess: () => { toast.success(t("gguf.loadSuccess", "Đã load model thành công")); status.refetch(); models.refetch(); },
    onError: (e) => toastTrpcError(e),
  });
  const unloadModel = trpc.aiGguf.unloadModel.useMutation({
    onSuccess: () => { toast.success(t("gguf.unloadSuccess", "Đã unload model")); status.refetch(); },
    onError: (e) => toastTrpcError(e),
  });

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<Cpu className="h-6 w-6" />}
          title={t("gguf.title", "GGUF Model Manager")}
          description={t("gguf.subtitle", "Quản lý và sử dụng local LLM models (.gguf)")}
          actions={
            <>
              {status.data?.available ? (
                <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {t("gguf.available", "Sẵn sàng")}</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> {t("gguf.unavailable", "Chưa cài đặt")}</Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => { status.refetch(); models.refetch(); }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          }
        />

        {/* Status Strip */}
        {status.data && (
          <div className="flex flex-wrap gap-3">
            {/* AI Provider Status */}
            {providerStatus.data && (
              <Card className="flex-1 min-w-50">
                <CardContent className="py-3 flex items-center gap-3">
                  {/* X2 cleanup: OpenAI branch removed — system is 100% local. */}
                  {providerStatus.data.activeProvider === "gguf" ? (
                    <Server className="h-4 w-4 text-primary" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">{t("gguf.activeProvider", "AI Provider")}</p>
                    <p className="text-sm font-bold">
                      {providerStatus.data.activeProvider === "gguf" && (
                        <span className="text-primary">Local GGUF {providerStatus.data.gguf.modelName ? `(${providerStatus.data.gguf.modelName})` : ""}</span>
                      )}
                      {providerStatus.data.activeProvider === "offline" && (
                        <span className="text-muted-foreground">{t("gguf.offlineMode", "Offline (quy tắc)")}</span>
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card className="flex-1 min-w-50">
              <CardContent className="py-3 flex items-center gap-3">
                <Zap className="h-4 w-4 text-warning" />
                <div>
                  <p className="text-xs text-muted-foreground">{t("gguf.loadedModels", "Models đang chạy")}</p>
                  <p className="text-lg font-bold">{status.data.loadedModels?.length ?? 0}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="flex-1 min-w-50">
              <CardContent className="py-3 flex items-center gap-3">
                <HardDrive className="h-4 w-4 text-info" />
                <div>
                  <p className="text-xs text-muted-foreground">{t("gguf.availableModels", "Models có sẵn")}</p>
                  <p className="text-lg font-bold">{models.data?.length ?? 0}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {!status.data?.available ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Cpu className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
              <h3 className="font-semibold mb-2">{t("gguf.notInstalled", "node-llama-cpp chưa được cài đặt")}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t("gguf.installHint", "Cài đặt package để sử dụng GGUF models: npm install node-llama-cpp")}
              </p>
              <code className="bg-muted p-2 rounded text-sm">npm install node-llama-cpp</code>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="models">{t("gguf.tabs.models", "Models")}</TabsTrigger>
              <TabsTrigger value="generate">{t("gguf.tabs.generate", "Text Gen")}</TabsTrigger>
              <TabsTrigger value="chat">{t("gguf.tabs.chat", "Chat")}</TabsTrigger>
            </TabsList>

            {/* ═══ MODELS TAB ═══ */}
            <TabsContent value="models" className="space-y-4">
              {models.isLoading ? (
                <div className="grid gap-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
              ) : models.data?.length ? (
                <div className="grid gap-3">
                  {models.data.map((m: any) => {
                    const isLoaded = status.data?.loadedModels?.some((lm: any) => lm.config?.modelPath === m.filePath || lm.modelId === m.id);
                    return (
                      <Card key={m.id} className={`transition-colors ${isLoaded ? "border-success/50 bg-success/5" : ""}`}>
                        <CardContent className="py-3 flex items-center gap-4">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${isLoaded ? "bg-success/10" : "bg-muted"}`}>
                            <HardDrive className={`h-5 w-5 ${isLoaded ? "text-success" : "text-muted-foreground"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{m.filename}</p>
                            <p className="text-xs text-muted-foreground truncate">{m.filePath}</p>
                            {m.fileSize && (
                              <p className="text-xs text-muted-foreground">{(m.fileSize / 1024 / 1024 / 1024).toFixed(2)} GB</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isLoaded ? (
                              <>
                                <Badge variant="default" className="gap-1 text-xs"><CheckCircle2 className="h-3 w-3" /> Loaded</Badge>
                                <Button
                                  variant="outline" size="sm"
                                  onClick={() => unloadModel.mutate({ modelId: m.id })}
                                  disabled={unloadModel.isPending}
                                >
                                  <Square className="h-3 w-3 mr-1" /> Unload
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="default" size="sm"
                                onClick={() => loadModel.mutate({ modelPath: m.filePath })}
                                disabled={loadModel.isPending}
                              >
                                {loadModel.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                                Load
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <HardDrive className="h-12 w-12 mx-auto mb-3" />
                    <p className="font-medium">{t("gguf.noModels", "Không tìm thấy .gguf models")}</p>
                    <p className="text-xs mt-1">{t("gguf.modelDir", "Đặt file .gguf vào thư mục uploads/gguf-models/")}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* ═══ TEXT GENERATION TAB ═══ */}
            <TabsContent value="generate">
              <TextGenerationPlayground />
            </TabsContent>

            {/* ═══ CHAT TAB ═══ */}
            <TabsContent value="chat">
              <ChatInterface />
            </TabsContent>
          </Tabs>
        )}
      </PageContainer>
    </DashboardLayout>
  );
}

// ─── Text Generation Playground ───────────────────────
function TextGenerationPlayground() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [result, setResult] = useState<string | null>(null);

  const generate = trpc.aiGguf.generate.useMutation({
    onSuccess: (data) => setResult(data.text),
    onError: (e) => toastTrpcError(e),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-warning" />
            {t("gguf.textGen", "Text Generation")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("gguf.systemPrompt", "System Prompt")}</label>
            <Textarea
              placeholder={t("gguf.systemPromptHint", "Hướng dẫn cho model (tùy chọn)...")}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={2}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("gguf.prompt", "Prompt")}</label>
            <Textarea
              placeholder={t("gguf.promptHint", "Nhập prompt...")}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={5}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Temperature: {temperature}</label>
              <Slider value={[temperature]} onValueChange={([v]) => setTemperature(v)} min={0} max={2} step={0.1} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Max Tokens: {maxTokens}</label>
              <Slider value={[maxTokens]} onValueChange={([v]) => setMaxTokens(v)} min={64} max={4096} step={64} />
            </div>
          </div>
          <Button
            className="w-full"
            onClick={() => generate.mutate({ prompt, systemPrompt: systemPrompt || undefined, temperature, maxTokens })}
            disabled={!prompt.trim() || generate.isPending}
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {t("gguf.generateBtn", "Tạo văn bản")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-info" />
            {t("gguf.output", "Kết quả")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {generate.isPending ? (
            <div className="flex items-center justify-center h-75">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : result ? (
            <ScrollArea className="h-75">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{result}</pre>
            </ScrollArea>
          ) : (
            <div className="h-75 flex items-center justify-center text-muted-foreground text-sm">
              {t("gguf.noOutput", "Kết quả sẽ hiển thị ở đây")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Chat Interface ───────────────────────────────────
type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function ChatInterface() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = trpc.aiGguf.chat.useMutation({
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: "assistant", content: data.text }]);
    },
    onError: (e) => toastTrpcError(e),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function sendMessage() {
    if (!input.trim() || chat.isPending) return;
    const userMsg: ChatMsg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    chat.mutate({ messages: newMessages });
  }

  return (
    <Card className="flex flex-col h-150">
      <CardHeader className="pb-2 border-b">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-info" />
          {t("gguf.chatTitle", "Local LLM Chat")}
        </CardTitle>
        <CardDescription className="text-xs">
          {t("gguf.chatDesc", "Trò chuyện với GGUF model trên máy cục bộ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-20">
              <div className="text-center">
                <Bot className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p>{t("gguf.chatEmpty", "Bắt đầu cuộc hội thoại...")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={`${msg.role}-${i}`} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}>
                    <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                  </div>
                  {msg.role === "user" && (
                    <div className="h-7 w-7 rounded-full bg-info/10 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-info" />
                    </div>
                  )}
                </div>
              ))}
              {chat.isPending && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <div className="border-t p-3 flex gap-2">
          <Input
            placeholder={t("gguf.chatInput", "Nhập tin nhắn...")}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            disabled={chat.isPending}
          />
          <Button size="icon" onClick={sendMessage} disabled={!input.trim() || chat.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
