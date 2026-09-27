/**
 * doc 80 Đợt 1 Task 4 (X-01 · ORC-13, phụ lục E §3/§6.6) — NHÃN NGUỒN DỮ LIỆU dùng chung.
 *
 * Trước task này KHÔNG trang nào trong cụm Điều phối/An toàn/Chuẩn hoá có nhãn DEMO/SEED: 6/6
 * run orchestration là seed, 2/2 task fleet là DEMO-TASK-*, 2/2 assignment scope='demo',
 * 31/31 device type origin='seed' — tất cả hiện như dữ liệu thật.
 *
 *   <ProvenanceBadge row={…}/>     — badge SEED/DEMO/SIM, suy từ tín hiệu ĐÃ CÓ trong hàng
 *                                    (`deriveProvenance`, shared/provenance.ts). Hàng thật ⇒ null.
 *   <ProvenanceSummary rows={…}/>  — dải "N/M hàng là dữ liệu demo/seed/giả lập"; ẩn khi N = 0.
 *   <DispatchModeBadge dispatch/>  — run orchestration: DRY-RUN (mô phỏng) / một phần / LIVE.
 *
 * Bất biến (có test ở từng trang): không hàng nào mang tín hiệu seed/demo/sim được hiện mà
 * không có badge.
 */
import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  deriveProvenance,
  type ProvenanceLabel,
  type RunDispatchSummary,
} from "@shared/provenance";

export { deriveProvenance };

const LABEL_CLASS: Record<ProvenanceLabel, string> = {
  SIM: "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  DEMO: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  SEED: "border-slate-500/50 bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

/** Any row object (tRPC rows, interfaces) — only its existing signal fields are read. */
type Row = object | null | undefined;
const provenanceOf = (row: Row) => deriveProvenance(row as Record<string, unknown> | null | undefined);

export function ProvenanceBadge({ row, className }: { row: Row; className?: string }) {
  const { t } = useTranslation();
  const p = provenanceOf(row);
  if (!p) return null;
  return (
    <Badge
      variant="outline"
      data-testid="provenance-badge"
      data-provenance={p.label}
      title={`${t("provenance.tip", "Not live data — source marker")}: ${p.reasons.join(", ")}`}
      className={cn("px-1.5 py-0 font-mono text-[10px] font-semibold", LABEL_CLASS[p.label], className)}
    >
      {t(`provenance.label.${p.label}`, p.label)}
    </Badge>
  );
}

export function ProvenanceSummary({ rows, className }: { rows: Row[]; className?: string }) {
  const { t } = useTranslation();
  const total = rows.length;
  const count = rows.filter((r) => provenanceOf(r) != null).length;
  if (count === 0) return null;
  return (
    <div
      data-testid="provenance-summary"
      data-count={count}
      data-total={total}
      className={cn(
        "flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300",
        className,
      )}
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {t("provenance.summary", "{{count}}/{{total}} rows are demo / seed / simulated data — not from real equipment", { count, total })}
      </span>
    </div>
  );
}

export function DispatchModeBadge({ dispatch, className }: { dispatch: RunDispatchSummary | null | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!dispatch || dispatch.mode === "none") return null;
  const { mode, simulated, live } = dispatch;
  // Fix round 1 — failed/timeout steps may have reached the device: never shown as dry-run.
  const unconfirmed = dispatch.unconfirmed ?? 0;
  const text =
    mode === "simulated"
      ? t("provenance.dispatch.simulated", "DRY-RUN")
      : mode === "mixed"
        ? t("provenance.dispatch.mixed", "PARTLY SIMULATED")
        : mode === "unconfirmed"
          ? t("provenance.dispatch.unconfirmed", "UNCONFIRMED")
          : t("provenance.dispatch.live", "LIVE");
  const baseTip =
    mode === "simulated"
      ? t("provenance.dispatch.simulatedTip", "Commands in this run were simulated (dry-run) — nothing was written to equipment ({{simulated}} step(s)).", { simulated })
      : mode === "mixed"
        ? t("provenance.dispatch.mixedTip", "{{simulated}} step(s) simulated, {{live}} step(s) sent to equipment.", { simulated, live })
        : mode === "unconfirmed"
          ? t("provenance.dispatch.unconfirmedTip", "{{unconfirmed}} command step(s) failed or timed out — they may have reached the device.", { unconfirmed })
          : t("provenance.dispatch.liveTip", "{{live}} command step(s) were sent to equipment.", { live });
  const tip = mode !== "unconfirmed" && unconfirmed > 0
    ? `${baseTip} ${t("provenance.dispatch.unconfirmedTip", "{{unconfirmed}} command step(s) failed or timed out — they may have reached the device.", { unconfirmed })}`
    : baseTip;
  const cls =
    mode === "live"
      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : mode === "unconfirmed"
        ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
        : "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300";
  return (
    <Badge
      variant="outline"
      data-testid="dispatch-mode"
      data-mode={mode}
      title={tip}
      className={cn("px-1.5 py-0 font-mono text-[10px] font-semibold", cls, className)}
    >
      {text}
    </Badge>
  );
}
