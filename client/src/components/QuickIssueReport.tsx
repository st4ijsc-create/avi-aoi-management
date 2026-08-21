/**
 * QuickIssueReport — operator "1-tap issue report" (Báo sự cố).
 *
 * Minimum-effort shop-floor flow: a prominent red button opens a minimal dialog
 * with ONE short free-text input (+ a voice mic, reusing the Web Speech pattern
 * from AILocalChatBubble) and a big Submit. The operator does NOT choose a
 * category or severity — the backend FAST AI model classifies the issue and the
 * mutation routes it straight into the existing Andon system.
 *
 * On submit → trpc.andon.quickReport → a toast shows the AI-chosen category +
 * severity (so the operator sees what was routed and could escalate), then the
 * dialog closes. An empty description is allowed: it becomes a bare
 * "call-for-help" Andon (reason "other", state "call").
 *
 * RBAC: the quickReport mutation is gated by andon/canCreate (same as raise) —
 * the button is best surfaced where operators are. No HITL: an Andon is an alert,
 * not a machine-control write.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AlertTriangle, Mic, MicOff, Send, Loader2, Cpu } from "lucide-react";

// ─── Web Speech API minimal types (mirrors AILocalChatBubble) ─────────────────
interface SpeechRecognitionResultLike {
  0?: { transcript?: string };
}
interface SpeechRecognitionEventLike extends Event {
  results: { 0?: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
type SRConstructorType = new () => SpeechRecognitionLike;

const SR_LANG: Record<string, string> = { vi: "vi-VN", en: "en-US", zh: "zh-CN" };

export interface QuickIssueReportProps {
  /** Prefill the machine context (from a ?machine= URL or a machine card). */
  machineCode?: string;
  /** Optional resolved machine id (skips server-side code resolution). */
  machineId?: number;
  /** Visual size of the default trigger button. */
  size?: "default" | "sm" | "lg";
  className?: string;
  /** Render a custom trigger instead of the default red "Báo sự cố" button. */
  trigger?: React.ReactNode;
}

const REASONS = ["quality", "material", "maintenance", "safety", "setup", "other"] as const;
const STATES = ["green", "yellow", "red", "call"] as const;
type Reason = (typeof REASONS)[number];
type AndonStateT = (typeof STATES)[number];

export default function QuickIssueReport({
  machineCode,
  machineId,
  size = "lg",
  className,
  trigger,
}: QuickIssueReportProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const lang = (["vi", "en", "zh"].includes(i18n.language) ? i18n.language : "vi") as
    | "vi"
    | "en"
    | "zh";

  const quickReport = trpc.andon.quickReport.useMutation();

  // Stop any active recognition when the dialog closes / unmounts.
  useEffect(() => {
    if (!open) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    return () => {
      recognitionRef.current?.stop();
    };
  }, [open]);

  // ─── Voice input (reuse the AILocalChatBubble Web Speech pattern) ───────────
  const toggleVoice = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: SRConstructorType;
      webkitSpeechRecognition?: SRConstructorType;
    };
    const SRConstructor = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
    if (!SRConstructor) {
      toast.error(t("quickIssue.voiceUnsupported", "Trình duyệt không hỗ trợ nhận dạng giọng nói."));
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SRConstructor();
    recognition.lang = SR_LANG[lang] ?? "vi-VN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) setDescription((prev) => prev + (prev ? " " : "") + transcript);
    };
    recognition.onerror = () => {
      setIsListening(false);
      toast.error(t("quickIssue.voiceError", "Không nhận diện được giọng nói. Vui lòng thử lại."));
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, lang, t]);

  // ─── Submit → classify + route to Andon ─────────────────────────────────────
  const submit = useCallback(async () => {
    if (quickReport.isPending) return;
    recognitionRef.current?.stop();
    try {
      const res = await quickReport.mutateAsync({
        description: description.trim() || undefined,
        machineCode: machineId == null ? machineCode : undefined,
        machineId,
        lang,
      });
      const reasonLabel = t(`quickIssue.reason.${res.reason as Reason}`, res.reason);
      const stateLabel = t(`quickIssue.state.${res.state as AndonStateT}`, res.state);
      const key = res.degraded ? "quickIssue.routedDegraded" : "quickIssue.routedToast";
      const fallback = res.degraded
        ? t("quickIssueReport.daBaoMacDinhAn", "Đã báo (mặc định an toàn): {{reason}} · mức {{state}}")
        : "Đã báo: {{reason}} · mức {{state}} — đang định tuyến";
      toast.success(t(key, fallback, { reason: reasonLabel, state: stateLabel }));
      setDescription("");
      setOpen(false);
    } catch {
      toast.error(t("quickIssue.error", "Không gửi được báo cáo. Vui lòng thử lại."));
    }
  }, [quickReport, description, machineCode, machineId, lang, t]);

  const submitting = quickReport.isPending;

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button
          type="button"
          size={size}
          variant="destructive"
          className={cn("gap-2 font-semibold", className)}
          onClick={() => setOpen(true)}
        >
          <AlertTriangle className="h-5 w-5" />
          {t("quickIssue.button", "Báo sự cố")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t("quickIssue.title", "Báo sự cố")}
            </DialogTitle>
            <DialogDescription className="flex items-start gap-1.5">
              <Cpu className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                {t(
                  "quickIssue.description",
                  "Mô tả ngắn vấn đề (hoặc nói). AI sẽ tự chọn loại và mức cảnh báo rồi gửi tới Andon.",
                )}
              </span>
            </DialogDescription>
          </DialogHeader>

          {machineCode && (
            <Badge variant="secondary" className="w-fit">
              {t("quickIssue.machineChip", "Máy: {{code}}", { code: machineCode })}
            </Badge>
          )}

          <div className="relative">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(
                "quickIssue.placeholder",
                "Vấn đề là gì? (vd: máy kẹt, hết keo, lỗi NG...)",
              )}
              rows={3}
              className="pr-12 resize-none"
              autoFocus
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
              }}
            />
            <Button
              type="button"
              size="icon"
              variant={isListening ? "default" : "ghost"}
              className={cn("absolute right-2 top-2 h-8 w-8", isListening && "animate-pulse")}
              onClick={toggleVoice}
              aria-label={
                isListening
                  ? t("quickIssue.voiceStop", "Dừng")
                  : t("quickIssue.voiceStart", "Nói")
              }
              title={
                isListening
                  ? t("quickIssue.voiceStop", "Dừng")
                  : t("quickIssue.voiceStart", "Nói")
              }
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          </div>

          <Button
            type="button"
            size="lg"
            variant="destructive"
            className="w-full gap-2 text-base font-semibold"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
            {submitting
              ? t("quickIssue.submitting", "Đang gửi...")
              : description.trim()
                ? t("quickIssue.submit", "Gửi báo cáo")
                : t("quickIssue.callForHelp", "Gọi hỗ trợ ngay")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
