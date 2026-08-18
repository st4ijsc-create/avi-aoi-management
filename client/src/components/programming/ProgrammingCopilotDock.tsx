/**
 * doc 41 (2026-07-11) — PROGRAMMING COPILOT DOCK.
 *
 * The single, consistent "assistant rail" that makes the Programming Copilot behave like an
 * EXTENSION attached to the programming surfaces (Engineering Workspace / IR Editor / POU
 * Studio) — the "Claude-in-VS-Code" model — instead of a standalone destination page.
 *
 * Mounted ONCE at app root. It reads the active binding from ProgrammingCopilotContext and
 * renders NOTHING when no surface has published one (so it appears only where code is
 * authored, and follows the active editor). It is a FIXED viewport overlay (right edge): a
 * collapsed vertical tab toggles a right-hand panel — position:fixed so it never perturbs the
 * host page layout.
 *
 * Fidelity scales with the host:
 *   • TEXT editors (Engineering Workspace): binding.onApply present → generated code inserts
 *     back into the buffer; binding.code is the live buffer; binding.diagnostics carries the
 *     latest build/validation errors → inline "Explain error / Suggest fix" actions.
 *   • STRUCTURED editors (IR / POU): no onApply (you can't inject text into a block/LAD flow)
 *     → the dock is ADVISORY: explain the transpiled preview, generate reference snippets, and
 *     reason over the lint diagnostics. Honest about being copy-only there.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, X, AlertTriangle, XCircle, Info, Wand2, MessageCircleQuestion } from "lucide-react";
import { lazy, Suspense } from "react";
import type { CopilotSeed } from "@/components/programming/ProgrammingCopilotPanel";
// doc64 S5-OPT: Panel kéo CodeEditor→@codemirror (~1MB) — chỉ tải khi user MỞ dock,
// không tải theo mỗi phiên chỉ vì dock được mount toàn cục.
const ProgrammingCopilotPanel = lazy(() =>
  import("@/components/programming/ProgrammingCopilotPanel").then((m) => ({ default: m.ProgrammingCopilotPanel })),
);
import { useProgrammingCopilot } from "@/contexts/ProgrammingCopilotContext";

export function ProgrammingCopilotDock() {
  const { t } = useTranslation();
  const { open, setOpen, binding } = useProgrammingCopilot();
  const [seed, setSeed] = useState<CopilotSeed | undefined>();

  // Escape closes the rail.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // doc 54 cosmetic — PUSH the page instead of overlaying it: when the rail is open on a
  // programming surface, reserve its width on the right so the editor/inspector isn't
  // hidden underneath. On narrow viewports (rail is 92vw) we don't push (it's a takeover).
  useEffect(() => {
    const canPush = open && !!binding && typeof window !== "undefined" && window.innerWidth >= 900;
    document.body.style.transition = "padding-right 0.2s ease";
    document.body.style.paddingRight = canPush ? "min(420px, 92vw)" : "";
    return () => { document.body.style.paddingRight = ""; };
  }, [open, binding]);

  // Only present on programming surfaces (a surface published a binding).
  if (!binding) return null;

  const diags = binding.diagnostics ?? [];
  const errText = diags.map((d) => `- [${d.severity ?? "error"}] ${d.message}`).join("\n");

  const pushSeed = (partial: Omit<CopilotSeed, "nonce">) =>
    setSeed({ ...partial, nonce: Date.now() });

  const explainErrors = () =>
    pushSeed({
      mode: "explain",
      request: `${t("progCopilot.dock.explainReq", "Giải thích các chẩn đoán/lỗi sau, nguyên nhân gốc và hướng khắc phục:")}\n${errText}`,
      autoRun: true,
    });
  const suggestFix = () =>
    pushSeed({
      mode: "review",
      request: `${t("progCopilot.dock.fixReq", "Rà soát và đề xuất cách sửa các chẩn đoán/lỗi sau (nêu đoạn sửa cụ thể):")}\n${errText}`,
      autoRun: true,
    });

  // ── Collapsed: a vertical toggle tab pinned to the right edge ────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("progCopilot.dock.open", "Mở Trợ lý Lập trình")}
        className="fixed right-0 top-1/2 z-40 -translate-y-1/2 flex items-center gap-1.5 rounded-l-lg border border-r-0 border-primary/30 bg-primary px-2 py-3 text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
      >
        <Sparkles className="h-4 w-4" />
        <span className="text-[11px] font-medium [writing-mode:vertical-rl] rotate-180">
          {t("progCopilot.dock.tab", "Copilot")}
        </span>
        {diags.length > 0 && (
          <span className="absolute -left-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
            {diags.length}
          </span>
        )}
      </button>
    );
  }

  // ── Expanded: fixed right rail ──────────────────────────────────────────────
  return (
    <aside
      role="complementary"
      aria-label={t("progCopilot.dock.title", "Trợ lý Lập trình")}
      className="fixed right-0 top-0 z-40 flex h-screen w-[min(420px,92vw)] flex-col border-l bg-background shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold">{t("progCopilot.dock.title", "Trợ lý Lập trình")}</span>
        {binding.surfaceLabel && (
          <Badge variant="outline" className="text-[10px]">
            {binding.surfaceLabel}
          </Badge>
        )}
        {!binding.onApply && (
          <Badge variant="secondary" className="text-[10px]">
            {t("progCopilot.dock.advisory", "Cố vấn")}
          </Badge>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto h-7 w-7"
          onClick={() => setOpen(false)}
          aria-label={t("common.close", "Đóng")}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 p-3">
          {/* Diagnostics → inline actions (deep context) */}
          {diags.length > 0 && (
            <div className="space-y-2 rounded-md border border-border/70 bg-muted/40 p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("progCopilot.dock.diagnostics", "Chẩn đoán từ editor")} ({diags.length})
              </div>
              <div className="max-h-28 space-y-0.5 overflow-auto">
                {diags.slice(0, 12).map((d, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-1 rounded px-1.5 py-0.5 text-[11px]",
                      d.severity === "warn"
                        ? "bg-warning/10 text-warning"
                        : d.severity === "info"
                          ? "bg-muted text-muted-foreground"
                          : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {d.severity === "warn" ? (
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    ) : d.severity === "info" ? (
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    ) : (
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    )}
                    <span>
                      {d.source && <span className="font-mono opacity-70">[{d.source}] </span>}
                      {d.message}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={explainErrors}>
                  <MessageCircleQuestion className="mr-1 h-3.5 w-3.5" />
                  {t("progCopilot.dock.explain", "Giải thích lỗi")}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={suggestFix}>
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                  {t("progCopilot.dock.fix", "Đề xuất sửa")}
                </Button>
              </div>
            </div>
          )}

          {/* The reusable copilot engine, embedded + seeded from the host.
              doc64 S5-OPT: chunk Panel (codemirror) tải lười lúc dock mở — spinner ngắn. */}
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                {t("progCopilot.dock.loading", "Đang tải trình soạn…")}
              </div>
            }
          >
            <ProgrammingCopilotPanel
              variant="embedded"
              initialKind={binding.kind}
              vendorInitial={binding.vendor}
              contextCode={binding.code}
              onApply={binding.onApply}
              onApplyText={binding.onApplyText}
              seed={seed}
            />
          </Suspense>

          {!binding.onApply && (
            <p className="flex items-start gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              {t(
                "progCopilot.dock.copyOnly",
                "Editor dạng khối/LAD nên không chèn trực tiếp — dùng để giải thích, rà soát và sinh mã tham khảo (sao chép).",
              )}
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

export default ProgrammingCopilotDock;
