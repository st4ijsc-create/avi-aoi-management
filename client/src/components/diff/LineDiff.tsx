/**
 * W3-11 (audit doc 25 · T3) — SHARED line-diff view.
 *
 * A dependency-free, LCS-based line diff reused across Engineering (program source),
 * Orchestration (workflow definition JSON) and Recipes (payload JSON). Renders a
 * unified +/- view with per-side line numbers. PURE + read-only (no side effects).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export type DiffRow =
  | { kind: "same"; leftNo: number; rightNo: number; text: string }
  | { kind: "del"; leftNo: number; text: string }
  | { kind: "add"; rightNo: number; text: string };

/** LCS-based line diff (không phụ thuộc lib ngoài). */
export function computeLineDiff(a: string, b: string): DiffRow[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const n = aLines.length;
  const m = bLines.length;

  // Bảng độ dài LCS (dp[i][j] = LCS của a[i..], b[j..]).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Truy vết để dựng danh sách dòng giữ / xóa / thêm.
  const out: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ kind: "same", leftNo: i + 1, rightNo: j + 1, text: aLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", leftNo: i + 1, text: aLines[i] });
      i++;
    } else {
      out.push({ kind: "add", rightNo: j + 1, text: bLines[j] });
      j++;
    }
  }
  while (i < n) { out.push({ kind: "del", leftNo: i + 1, text: aLines[i] }); i++; }
  while (j < m) { out.push({ kind: "add", rightNo: j + 1, text: bLines[j] }); j++; }
  return out;
}

/** Pretty-print bất kỳ giá trị JSON nào (an toàn với cả string/null). */
export function prettyJson(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    // Nếu là chuỗi JSON thì format lại; ngược lại giữ nguyên.
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Hiển thị diff dòng-theo-dòng giữa `left` (bản gốc) và `right` (bản so sánh).
 * Cuộn ngang bên trong (không tràn ra ngoài layout).
 */
export function LineDiff({
  left,
  right,
  className,
  maxHeightClass = "max-h-[420px]",
}: {
  left: string;
  right: string;
  className?: string;
  maxHeightClass?: string;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => computeLineDiff(left, right), [left, right]);
  const changed = rows.some((r) => r.kind !== "same");
  const adds = rows.filter((r) => r.kind === "add").length;
  const dels = rows.filter((r) => r.kind === "del").length;

  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-3 text-[11px] text-muted-foreground">
        {changed ? (
          <>
            <span className="text-emerald-600 dark:text-emerald-400">+{adds}</span>
            <span className="text-red-600 dark:text-red-400">−{dels}</span>
          </>
        ) : (
          <span>{t("diff.identical", "Hai phiên bản giống nhau")}</span>
        )}
      </div>
      <div className={`overflow-auto rounded-md border bg-muted/20 ${maxHeightClass}`}>
        <pre className="min-w-full text-xs leading-relaxed">
          <code className="block">
            {rows.map((r, idx) => {
              const sign = r.kind === "add" ? "+" : r.kind === "del" ? "-" : " ";
              const rowBg =
                r.kind === "add"
                  ? "bg-emerald-500/10"
                  : r.kind === "del"
                    ? "bg-red-500/10"
                    : "";
              const color =
                r.kind === "add"
                  ? "text-emerald-700 dark:text-emerald-300"
                  : r.kind === "del"
                    ? "text-red-700 dark:text-red-300"
                    : "text-foreground/80";
              return (
                <div key={idx} className={`flex ${rowBg}`}>
                  <span className="w-10 shrink-0 select-none border-r px-1 text-right text-[10px] text-muted-foreground">
                    {"leftNo" in r ? r.leftNo : ""}
                  </span>
                  <span className="w-10 shrink-0 select-none border-r px-1 text-right text-[10px] text-muted-foreground">
                    {"rightNo" in r ? r.rightNo : ""}
                  </span>
                  <span className={`w-4 shrink-0 select-none text-center ${color}`}>{sign}</span>
                  <span className={`whitespace-pre px-1 ${color}`}>{r.text || " "}</span>
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}
