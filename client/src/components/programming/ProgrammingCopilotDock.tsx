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
 *
 * Doc 81 Đợt 2 Task 2 (ruling R-2-b) — dock GIỮ trên IDE/IR/POU cho tới khi Task 13/14 đặt panel
 * Copilot trong layout. Một lối vào AI: khi shell có nút AI trên top bar (`aiEntryStore`), nút đó mở/đóng
 * dock ⇒ tab dọc nổi (lối vào thứ hai, che MAIN) không vẽ nữa; ở chế độ chiếm màn (< 900 px, không đẩy
 * trang) dock bắt đầu DƯỚI top bar thay vì đè lên nó. Chế độ đẩy trang (paddingRight) giữ nguyên.
 *
 * Doc 81 Đợt 2 Task 13 — IDE đặt Copilot TRONG layout (binding `inLayout`): dock không vẽ, không đẩy trang, Esc
 * không đóng. Thân dock (chẩn đoán + engine) là lõi dùng chung `ProgrammingCopilotCore`.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, X } from "lucide-react";
// doc64 S5-OPT: lõi tải lười engine (CodeMirror) — chỉ khi dock MỞ (lõi chỉ mount ở nhánh mở).
import { ProgrammingCopilotCore } from "@/components/programming/ProgrammingCopilotCore";
import { useProgrammingCopilot } from "@/contexts/ProgrammingCopilotContext";
import { useAiEntry } from "@/lib/aiEntryStore";

const PUSH_MIN_WIDTH = 900;

export function ProgrammingCopilotDock() {
  const { t } = useTranslation();
  const { open, setOpen, binding } = useProgrammingCopilot();
  const viaHeader = useAiEntry().headerEntries > 0;
  // Task 13 — host đặt Copilot trong layout của nó ⇒ dock nhường hoàn toàn.
  const hostedInLayout = binding?.inLayout === true;

  // Escape closes the rail.
  useEffect(() => {
    if (!open || hostedInLayout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, hostedInLayout]);

  // doc 54 cosmetic — PUSH the page instead of overlaying it: when the rail is open on a
  // programming surface, reserve its width on the right so the editor/inspector isn't
  // hidden underneath. On narrow viewports (rail is 92vw) we don't push (it's a takeover).
  useEffect(() => {
    const canPush = open && !!binding && !hostedInLayout && typeof window !== "undefined" && window.innerWidth >= PUSH_MIN_WIDTH;
    document.body.style.transition = "padding-right 0.2s ease";
    document.body.style.paddingRight = canPush ? "min(420px, 92vw)" : "";
    return () => { document.body.style.paddingRight = ""; };
  }, [open, binding, hostedInLayout]);

  // Only present on programming surfaces (a surface published a binding) — and not when the host renders the
  // Copilot inside its own layout (Task 13, IDE).
  if (!binding || hostedInLayout) return null;

  const diags = binding.diagnostics ?? [];

  // ── Collapsed: a vertical toggle tab pinned to the right edge ────────────────
  if (!open) {
    // Shell có nút AI trên top bar ⇒ đó là lối vào duy nhất (nó mở dock); không vẽ tab nổi thứ hai.
    if (viaHeader) return null;
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
  // Chế độ chiếm màn (không đẩy trang) mà có top bar ⇒ bắt đầu dưới top bar (h-14), không đè nó.
  const takeover = typeof window !== "undefined" && window.innerWidth < PUSH_MIN_WIDTH;
  const belowTopBar = viaHeader && takeover;
  return (
    <aside
      role="complementary"
      aria-label={t("progCopilot.dock.title", "Trợ lý Lập trình")}
      className={cn(
        "fixed right-0 z-40 flex w-[min(420px,92vw)] flex-col border-l bg-background shadow-2xl",
        belowTopBar ? "top-14 h-[calc(100dvh-3.5rem)]" : "top-0 h-screen",
      )}
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
        <div className="p-3">
          <ProgrammingCopilotCore binding={binding} />
        </div>
      </ScrollArea>
    </aside>
  );
}

export default ProgrammingCopilotDock;
