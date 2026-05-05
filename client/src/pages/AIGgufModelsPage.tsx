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
import { trpc } from "@/lib/trpc";
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
  Globe,
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
    onSuccess: () => { toast.success(t("gguf.loadSuccess", "ÄÃ£ load model thÃ nh cÃ´ng")); status.refetch(); models.refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const unloadModel = trpc.aiGguf.unloadModel.useMutation({
    onSuccess: () => { toast.success(t("gguf.unloadSuccess", "ÄÃ£ unload model")); status.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <Cpu className="h-6 w-6 text-violet-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("gguf.title", "GGUF Model Manager")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("gguf.subtitle", "Quáº£n lÃ½ vÃ  sá»­ dá»¥ng local LLM models (.gguf)")}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {status.data?.available ? (
              <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> {t("gguf.available", "Sáºµn sÃ ng")}</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> {t("gguf.unavailable", "ChÆ°a cÃ i Ä‘áº·t")}</Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => { status.refetch(); models.refetch(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Status Strip */}
        {status.data && (
          <div className="flex flex-wrap gap-3">
            {/* AI Provider Status */}
            {providerStatus.data && (
              <Card className="flex-1 min-w-50">
                <CardContent className="py-3 flex items-center gap-3">
                  {providerStatus.data.activeProvider === "openai" ? (
                    <Globe className="h-4 w-4 text-green-500" />
                  ) : providerStatus.data.activeProvider === "gguf" ? (
                    <Server className="h-4 w-4 text-violet-500" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-gray-400" />
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">{t("gguf.activeProvider", "AI Provider")}</p>
                    <p className="text-sm font-bold">
                      {providerStatus.data.activeProvider === "openai" && (
                        <span className="text-green-600">OpenAI ({providerStatus.data.openai.model})</span>
                      )}
                      {providerStatus.data.activeProvider === "gguf" && (
                        <span className="text-violet-600">Local GGUF {providerStatus.data.gguf.modelName ? `(${providerStatus.data.gguf.modelName})` : ""}</span>
                      )}
                      {providerStatus.data.activeProvider === "offline" && (
                        <span className="text-gray-500">{t("gguf.offlineMode", "Offline (quy táº¯c)")}</span>
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card className="flex-1 min-w-50">
              <CardContent className="py-3 flex items-center gap-3">
                <Zap className="h-4 w-4 text-yellow-500" />
                <div>
                  <p className="text-xs text-muted-foreground">{t("gguf.loadedModels", "Models Ä‘ang cháº¡y")}</p>
                  <p className="text-lg font-bold">{status.data.loadedModels?.length ?? 0}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="flex-1 min-w-50">
              <CardContent className="py-3 flex items-center gap-3">
                <HardDrive className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground">{t("gguf.availableModels", "Models cÃ³ sáºµn")}</p>
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
              <h3 className="font-semibold mb-2">{t("gguf.notInstalled", "node-llama-cpp chÆ°a Ä‘Æ°á»£c cÃ i Ä‘áº·t")}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {t("gguf.installHint", "CÃ i Ä‘áº·t package Ä‘á»ƒ sá»­ dá»¥ng GGUF models: npm install node-llama-cpp")}
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

            {/* â•â•â• MODELS TAB â•â•â• */}
            <TabsContent value="models" className="space-y-4">
              {models.isLoading ? (
                <div className="grid gap-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
              ) : models.data?.length ? (
                <div className="grid gap-3">
                  {models.data.map((m: any) => {
                    const isLoaded = status.data?.loadedModels?.some((lm: any) => lm.config?.modelPath === m.filePath || lm.modelId === m.id);
                    return (
                      <Card key={m.id} className={`transition-colors ${isLoaded ? "border-green-500/50 bg-green-500/5" : ""}`}>
                        <CardContent className="py-3 flex items-center gap-4">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${isLoaded ? "bg-green-500/10" : "bg-muted"}`}>
                            <HardDrive className={`h-5 w-5 ${isLoaded ? "text-green-500" : "text-muted-foreground"}`} />
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
                    <p className="font-medium">{t("gguf.noModels", "KhÃ´ng tÃ¬m tháº¥y .gguf models")}</p>
                    <p className="text-xs mt-1">{t("gguf.modelDir", "Äáº·t file .gguf vÃ o thÆ° má»¥c uploads/gguf-models/")}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* â•â•â• TEXT GENERATION TAB â•â•â• */}
            <TabsContent value="generate">
              <TextGenerationPlayground />
            </TabsContent>

            {/* â•â•â• CHAT TAB â•â•â• */}
            <TabsContent value="chat">
              <ChatInterface />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
}

// â”€â”€â”€ Text Generation Playground â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TextGenerationPlayground() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(512);
  const [result, setResult] = useState<string | null>(null);

  const generate = trpc.aiGguf.generate.useMutation({
    onSuccess: (data) => setResult(data.text),
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            {t("gguf.textGen", "Text Generation")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("gguf.systemPrompt", "System Prompt")}</label>
            <Textarea
              placeholder={t("gguf.systemPromptHint", "HÆ°á»›ng dáº«n cho model (tÃ¹y chá»n)...")}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={2}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("gguf.prompt", "Prompt")}</label>
            <Textarea
              placeholder={t("gguf.promptHint", "Nháº­p prompt...")}
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
            {t("gguf.generateBtn", "Táº¡o vÄƒn báº£n")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" />
            {t("gguf.output", "Káº¿t quáº£")}
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
              {t("gguf.noOutput", "Káº¿t quáº£ sáº½ hiá»ƒn thá»‹ á»Ÿ Ä‘Ã¢y")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// â”€â”€â”€ Chat Interface â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    onError: (e) => toast.error(e.message),
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
          <MessageSquare className="h-4 w-4 text-blue-500" />
          {t("gguf.chatTitle", "Local LLM Chat")}
        </CardTitle>
        <CardDescription className="text-xs">
          {t("gguf.chatDesc", "TrÃ² chuyá»‡n vá»›i GGUF model trÃªn mÃ¡y cá»¥c bá»™")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-20">
              <div className="text-center">
                <Bot className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p>{t("gguf.chatEmpty", "Báº¯t Ä‘áº§u cuá»™c há»™i thoáº¡i...")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={`${msg.role}-${i}`} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="h-7 w-7 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                      <Bot className="h-4 w-4 text-violet-500" />
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
                    <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4 text-blue-500" />
                    </div>
                  )}
                </div>
              ))}
              {chat.isPending && (
                <div className="flex gap-3">
                  <div className="h-7 w-7 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-violet-500" />
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
            placeholder={t("gguf.chatInput", "Nháº­p tin nháº¯n...")}
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
