/**
 * Doc 34 · P3 — PROGRAMMING COPILOT PANEL (reusable, in-app IDE surface).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A dependency-free panel that drives the P2 backend (trpc.programming.copilotGenerate)
 * to GENERATE / COMPLETE / TRANSLATE / REVIEW / EXPLAIN device code. It reuses the existing
 * <CodeEditor> (no Monaco/CodeMirror — the repo deliberately avoids them) and renders the
 * full copilot result: safety refusals, the generated code, the substrate VALIDATION verdict
 * (green ok / red diagnostics), cited vendor-manual SOURCES, the note, and Copy / Apply.
 *
 * SAFETY (mirrors the backend, doc 34 §5.2): the copilot is ADVISORY + DISPLAY-ONLY. Nothing
 * is deployed here — the engineer reviews the result and saves/builds/deploys it through the
 * existing gated Engineering Workspace pipeline. Every result carries a persistent reminder to
 * review + simulate before running on real equipment; safety-function requests are hard-refused
 * server-side and surfaced as a prominent notice.
 *
 * Reusable in two homes:
 *   • variant="full"     — standalone /programming-copilot page.
 *   • variant="embedded" — a compact side/collapsible panel inside EngineeringWorkspace, seeded
 *                          with the editor buffer (contextCode) and wired so Apply inserts the
 *                          generated code back into the host editor (onApply).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CodeEditor } from "@/components/engineering/CodeEditor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sparkles, Copy, CornerDownLeft, ShieldAlert, ShieldCheck,
  AlertTriangle, XCircle, CheckCircle2, Loader2, BookText, Info, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

/** The 8 programming kinds the copilot supports (a subset of the server programmingKindEnum). */
export const COPILOT_KINDS = [
  "iec61131-st",
  "iec61131-ld",
  "iec61131-pou",
  "ir-flow",
  "zmotion-basic",
  "mitsubishi-engineering",
  "robot-tm",
  "stub",
] as const;
export type CopilotKind = (typeof COPILOT_KINDS)[number];

const MODES = ["generate", "complete", "translate", "review", "explain"] as const;
type CopilotMode = (typeof MODES)[number];

/** Vendor scopes for RAG grounding (server-side vendor filter). "" / "any" = auto. */
const VENDORS = ["mitsubishi", "delta", "omron", "fanuc", "universal-robots", "zmotion"] as const;

/** Language hint per kind (mirrors server LANG_OF; only used for the editor's data-language). */
const KIND_LANGUAGE: Record<CopilotKind, string> = {
  "iec61131-st": "st",
  "iec61131-ld": "ld",
  "iec61131-pou": "pou-json",
  "ir-flow": "ir-json",
  "zmotion-basic": "basic",
  "mitsubishi-engineering": "device",
  "robot-tm": "tmscript",
  stub: "text",
};

// ── Mirror of the server GenerateProgramResult (read-only; optional-chained on use) ──
interface GenDiagnostic { severity: string; message: string; line?: number }
interface GenValidation { ok: boolean; diagnostics: GenDiagnostic[] }
interface GenCitation { vendor: string; docTitle: string; page: number | null }
interface GenResult {
  ok: boolean;
  refused: boolean;
  reason?: string;
  kind: string;
  code?: string;
  validation?: GenValidation;
  citations?: GenCitation[];
  explanation?: string;
  note?: string;
}

export interface ProgrammingCopilotPanelProps {
  /** "full" (standalone page) or "embedded" (compact, inside a host editor). */
  variant?: "full" | "embedded";
  /** Prefill the source kind (e.g. the host project.kind). */
  initialKind?: CopilotKind;
  /** Seed the "existing code" context from a host editor buffer (kept in sync). */
  contextCode?: string;
  /** When provided, an "Apply" action inserts the generated code into the host. */
  onApply?: (code: string) => void;
  className?: string;
}

const needsContextMode = (m: CopilotMode) => m !== "generate";
const isExplainMode = (m: CopilotMode) => m === "explain" || m === "review";

export function ProgrammingCopilotPanel({
  variant = "full",
  initialKind = "iec61131-st",
  contextCode,
  onApply,
  className,
}: ProgrammingCopilotPanelProps) {
  const { t } = useTranslation();
  const embedded = variant === "embedded";

  const [kind, setKind] = useState<CopilotKind>(initialKind);
  const [mode, setMode] = useState<CopilotMode>("generate");
  const [vendor, setVendor] = useState<string>("any");
  const [targetKind, setTargetKind] = useState<CopilotKind>("zmotion-basic");
  const [request, setRequest] = useState("");
  const [ctxCode, setCtxCode] = useState(contextCode ?? "");
  const [resultCode, setResultCode] = useState("");

  // Keep the context in step with the host editor buffer (embedded seeding).
  useEffect(() => {
    setCtxCode(contextCode ?? "");
  }, [contextCode]);

  const gen = trpc.programming.copilotGenerate.useMutation({
    onSuccess: (data) => {
      setResultCode((data as GenResult)?.code ?? "");
    },
    onError: () => {
      toast.error(t("progCopilot.failed", "Code generation failed"));
    },
  });

  const result = (gen.data ?? null) as GenResult | null;
  const busy = gen.isPending;
  const language = KIND_LANGUAGE[kind] ?? "text";
  const editorHeight = embedded ? "220px" : "340px";
  const ctxHeight = embedded ? "140px" : "180px";

  const needsContext = needsContextMode(mode);
  const explainish = isExplainMode(mode);

  const defaultRequest = (m: CopilotMode): string => {
    switch (m) {
      case "complete": return t("progCopilot.defaults.complete", "Complete this program.");
      case "translate": return t("progCopilot.defaults.translate", "Translate this program, preserving its behaviour.");
      case "review": return t("progCopilot.defaults.review", "Review this program for correctness and issues.");
      case "explain": return t("progCopilot.defaults.explain", "Explain what this program does.");
      default: return "";
    }
  };

  const runGenerate = () => {
    if (busy) return;
    const req = request.trim();
    if (mode === "generate" && !req) {
      toast.warning(t("progCopilot.needRequest", "Describe what you want to generate."));
      return;
    }
    if (explainish && !ctxCode.trim()) {
      toast.warning(t("progCopilot.needContext", "Paste the program to review / explain first."));
      return;
    }
    gen.mutate({
      kind,
      request: req || defaultRequest(mode),
      mode,
      vendor: vendor === "any" ? undefined : vendor,
      contextCode: needsContext && ctxCode.trim() ? ctxCode : undefined,
      targetKind: mode === "translate" ? targetKind : undefined,
    });
  };

  const copyCode = async () => {
    if (!resultCode) return;
    try {
      await navigator.clipboard.writeText(resultCode);
      toast.success(t("progCopilot.copied", "Copied to clipboard"));
    } catch {
      toast.error(t("progCopilot.failed", "Code generation failed"));
    }
  };

  const kindLabel = (k: string) => k;

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className={cn("grid gap-3", embedded ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
        <div className="space-y-1">
          <Label className="text-xs">{t("progCopilot.kind", "Program kind")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as CopilotKind)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COPILOT_KINDS.map((k) => (
                <SelectItem key={k} value={k} className="text-sm">{kindLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("progCopilot.mode", "Mode")}</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as CopilotMode)}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m} value={m} className="text-sm">
                  {t(`progCopilot.modes.${m}`, m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("progCopilot.vendor", "Vendor")}</Label>
          <Select value={vendor} onValueChange={setVendor}>
            <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any" className="text-sm">{t("progCopilot.vendorAny", "Auto (all vendors)")}</SelectItem>
              {VENDORS.map((v) => (
                <SelectItem key={v} value={v} className="text-sm">{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {mode === "translate" && (
          <div className="space-y-1">
            <Label className="text-xs">{t("progCopilot.targetKind", "Translate to")}</Label>
            <Select value={targetKind} onValueChange={(v) => setTargetKind(v as CopilotKind)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COPILOT_KINDS.map((k) => (
                  <SelectItem key={k} value={k} className="text-sm">{kindLabel(k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Request / Focus */}
      <div className="space-y-1">
        <Label className="text-xs">
          {explainish ? t("progCopilot.focus", "Focus (optional)") : t("progCopilot.request", "Request")}
        </Label>
        <Textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder={t("progCopilot.requestPh", "Describe what to generate — e.g. a moving-average filter over D100 sampled every 100 ms")}
          rows={embedded ? 2 : 3}
          className="text-sm"
        />
      </div>

      {/* Existing code context (complete / translate / review / explain) */}
      {needsContext && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("progCopilot.contextCode", "Existing code (context)")}</Label>
            {embedded && (
              <Button
                type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs"
                onClick={() => setCtxCode(contextCode ?? "")}
              >
                <RefreshCw className="mr-1 h-3 w-3" /> {t("progCopilot.syncEditor", "Sync from editor")}
              </Button>
            )}
          </div>
          <CodeEditor
            value={ctxCode}
            onChange={setCtxCode}
            language={language}
            height={ctxHeight}
            placeholder={t("progCopilot.contextPh", "Paste the program to complete / translate / review / explain…")}
            aria-label="copilot-context"
          />
        </div>
      )}

      {/* Generate */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={runGenerate} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? t("progCopilot.generating", "Generating…") : t("progCopilot.generate", "Generate")}
        </Button>
      </div>

      {/* ── Result ───────────────────────────────────────────────────────── */}
      {busy && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {t("progCopilot.generating", "Generating…")}
        </div>
      )}

      {gen.isError && !busy && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("progCopilot.failed", "Code generation failed")}</span>
        </div>
      )}

      {!busy && result && (
        <div className="space-y-3">
          {/* Safety refusal — prominent */}
          {result.refused ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">{t("progCopilot.refusedTitle", "Refused for safety")}</p>
                <p className="mt-0.5 leading-snug">{result.reason}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Explanation / review prose */}
              {result.explanation && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <p className="mb-1 flex items-center gap-1.5 font-medium">
                    <BookText className="h-4 w-4 text-primary" /> {t("progCopilot.explanation", "Explanation")}
                  </p>
                  <p className="whitespace-pre-wrap leading-snug text-muted-foreground">{result.explanation}</p>
                </div>
              )}

              {/* Generated code + validation + actions */}
              {result.code != null && result.code !== "" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-xs">{t("progCopilot.resultCode", "Generated code")}</Label>
                    {result.validation && (
                      result.validation.ok ? (
                        <Badge className="gap-1 border-success/40 bg-success/15 text-success" variant="outline">
                          <CheckCircle2 className="h-3 w-3" /> {t("progCopilot.validationOk", "Validated")}
                        </Badge>
                      ) : (
                        <Badge className="gap-1 border-destructive/40 bg-destructive/10 text-destructive" variant="outline">
                          <XCircle className="h-3 w-3" /> {t("progCopilot.validationFail", "Validation failed")}
                        </Badge>
                      )
                    )}
                    <span className="ml-auto flex gap-1.5">
                      <Button type="button" size="sm" variant="outline" onClick={copyCode} className="h-8">
                        <Copy className="mr-1 h-3.5 w-3.5" /> {t("progCopilot.copy", "Copy")}
                      </Button>
                      {onApply && (
                        <Button type="button" size="sm" onClick={() => onApply(resultCode)} className="h-8">
                          <CornerDownLeft className="mr-1 h-3.5 w-3.5" /> {t("progCopilot.apply", "Apply to editor")}
                        </Button>
                      )}
                    </span>
                  </div>
                  <CodeEditor
                    value={resultCode}
                    onChange={setResultCode}
                    language={language}
                    height={editorHeight}
                    aria-label="copilot-result"
                  />
                  {/* Diagnostics */}
                  {result.validation && result.validation.diagnostics.length > 0 && (
                    <div className="rounded-md border bg-muted/30 p-2 text-xs">
                      {result.validation.diagnostics.map((d, i) => (
                        <div key={i} className="flex items-start gap-1">
                          {d.severity === "error"
                            ? <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
                            : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />}
                          <span>{d.line ? `L${d.line}: ` : ""}{d.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Note (flag off / offline / unvalidated Tier-B / failed-validation hint) */}
              {result.note && (
                <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{result.note}</span>
                </div>
              )}

              {/* Citations */}
              {result.citations && result.citations.length > 0 && (
                <div className="rounded-md border bg-muted/20 p-2 text-xs">
                  <p className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
                    <BookText className="h-3.5 w-3.5" /> {t("progCopilot.citations", "Sources")}
                  </p>
                  <ul className="space-y-0.5">
                    {result.citations.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                        <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                        <span className="break-words">
                          {c.vendor} · {c.docTitle}{c.page != null ? ` · p.${c.page}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Idle hint */}
      {!busy && !result && !gen.isError && (
        <p className="text-xs text-muted-foreground">
          {t("progCopilot.idleHint", "Pick options and Generate to see AI-suggested code here.")}
        </p>
      )}

      {/* Persistent safety reminder */}
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {t(
            "progCopilot.safetyReminder",
            "AI-generated — review, validate and simulate before running on real equipment. The copilot never authors safety logic (E-stop / interlock / SIL).",
          )}
        </span>
      </div>
    </div>
  );
}

export default ProgrammingCopilotPanel;
