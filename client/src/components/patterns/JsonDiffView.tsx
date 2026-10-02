/**
 * Doc 81 Đợt 2 Task 3 — <JsonDiffView>: diff hai phiên bản (JSON in đẹp, hoặc văn bản nguyên văn)
 * dùng chung. Lớp mỏng trên `LineDiff` (LCS theo dòng, đã dùng ở Workspace/Recipes/Orchestration)
 * thêm nhãn hai bản và một vùng `region` có tên để trình đọc màn hình biết đang so cái gì.
 */
import { useTranslation } from "react-i18next";
import { LineDiff, prettyJson } from "@/components/diff/LineDiff";
import { cn } from "@/lib/utils";

export interface JsonDiffViewProps {
  left: unknown;
  right: unknown;
  /** Nhãn bản gốc, vd "v2". */
  leftLabel: string;
  /** Nhãn bản so sánh, vd "v3". */
  rightLabel: string;
  /** "json" (mặc định): in đẹp JSON/chuỗi JSON; "text": so nguyên văn (mã nguồn). */
  mode?: "json" | "text";
  maxHeightClass?: string;
  className?: string;
}

function asText(v: unknown, mode: "json" | "text"): string {
  if (mode === "json") return prettyJson(v);
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}

export function JsonDiffView({ left, right, leftLabel, rightLabel, mode = "json", maxHeightClass, className }: JsonDiffViewProps) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("layoutKit.diff.label", "Differences between {{base}} and {{compare}}", { base: leftLabel, compare: rightLabel })}
      className={cn("space-y-1", className)}
    >
      <p className="font-mono text-xs text-muted-foreground">
        {leftLabel} → {rightLabel}
      </p>
      <LineDiff left={asText(left, mode)} right={asText(right, mode)} maxHeightClass={maxHeightClass} />
    </section>
  );
}

export default JsonDiffView;
