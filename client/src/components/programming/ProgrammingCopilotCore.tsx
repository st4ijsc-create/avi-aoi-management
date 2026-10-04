/**
 * doc 81 Đợt 2 Task 13 — LÕI DÙNG CHUNG của Copilot lập trình (doc 81 §1.3 "CopilotPanel (một lõi)").
 *
 * Thân của panel Copilot TRONG layout ở IDE (`EngineeringWorkspace`, inspector phải — Task 13) và IR/POU
 * (`CopilotInspector` — Task 14; dock cố định cũ đã gỡ) — một nơi duy nhất cho:
 *   · chẩn đoán từ editor của host + hai hành động "Giải thích lỗi" / "Đề xuất sửa" (đẩy `seed` vào engine);
 *   · engine `ProgrammingCopilotPanel` (variant embedded, tải lười — chunk CodeMirror chỉ tải khi lõi mount);
 *   · ghi chú "chỉ sao chép" khi host là editor khối/LAD (không có `onApply`).
 * Khung bao (header, cuộn, vị trí) thuộc về host.
 */
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info, MessageCircleQuestion, Wand2, XCircle } from "lucide-react";
import type { CopilotSeed } from "@/components/programming/ProgrammingCopilotPanel";
import type { CopilotBinding } from "@/contexts/ProgrammingCopilotContext";

// doc64 S5-OPT: Panel kéo CodeEditor→@codemirror (~1MB) — chỉ tải khi lõi được mount (dock mở / tab Copilot mở).
const ProgrammingCopilotPanel = lazy(() =>
  import("@/components/programming/ProgrammingCopilotPanel").then((m) => ({ default: m.ProgrammingCopilotPanel })),
);

export function ProgrammingCopilotCore({ binding, className }: { binding: CopilotBinding; className?: string }) {
  const { t } = useTranslation();
  const [seed, setSeed] = useState<CopilotSeed | undefined>();
  const diags = binding.diagnostics ?? [];
  const errText = diags.map((d) => `- [${d.severity ?? "error"}] ${d.message}`).join("\n");

  const pushSeed = (partial: Omit<CopilotSeed, "nonce">) => setSeed({ ...partial, nonce: Date.now() });
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

  return (
    <div className={cn("space-y-3", className)}>
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

      {/* The reusable copilot engine, embedded + seeded from the host. */}
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
          hideSyncFromEditor={binding.scratch}
        />
      </Suspense>

      {binding.scratch ? (
        <p data-copilot-scratch="" className="flex items-start gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[10px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {t(
            "engineering.ws.scratchNote",
            "Chế độ nháp: chưa mở dự án nào — mã sinh ra chỉ để xem và sao chép. Mở một dự án để chèn vào editor.",
          )}
        </p>
      ) : !binding.onApply && (
        <p className="flex items-start gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[10px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {t(
            "progCopilot.dock.copyOnly",
            "Editor dạng khối/LAD nên không chèn trực tiếp — dùng để giải thích, rà soát và sinh mã tham khảo (sao chép).",
          )}
        </p>
      )}
    </div>
  );
}

export default ProgrammingCopilotCore;
