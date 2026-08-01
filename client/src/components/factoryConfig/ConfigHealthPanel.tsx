/**
 * doc 47 IA Đợt 2 — Bảng kiểm tra cấu hình (analog cấu-hình-nhà-máy của /data-quality).
 *
 * Tính lỗ hổng cấu hình THẬT từ cùng dữ liệu list (qua useFactoryModel), 100% phía
 * client, trung thực — chỉ liệt kê vấn đề CÓ THẬT:
 *   • Container rỗng: nhà máy 0 xưởng · xưởng 0 dây chuyền · dây chuyền 0 trạm · trạm 0 máy
 *   • Trùng mã trong cùng một cấp
 *   • Máy chưa kết nối: registrationStatus ≠ 'approved' hoặc thiếu model
 *     (apiKey KHÔNG có trong payload machine.list nên không kiểm được — dùng tín hiệu thật này)
 *
 * Mỗi dòng: chip mức độ + đường dẫn (Nhà máy ▸ Xưởng ▸ …) + "Sửa →". Header tóm tắt
 * "N vấn đề cấu hình" / "Cấu hình hợp lệ ✓".
 */
import { useTranslation } from "react-i18next";
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/AnalyticsSkeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { StatChip, StatChipRow } from "@/components/patterns";
import { cn } from "@/lib/utils";
import { useFactoryModel, type Finding, type Navigate } from "./factoryModel";

export interface ConfigHealthPanelProps {
  onNavigate: Navigate;
  className?: string;
}

export function ConfigHealthPanel({ onNavigate, className }: ConfigHealthPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const { isLoading, isError, error, refetch, isEmpty, model } = useFactoryModel();

  if (isLoading) return <div className={className}><ListSkeleton /></div>;

  if (isError) {
    return (
      <div className={className}>
        <Alert variant="destructive" className="border-destructive/30">
          <AlertTitle>{t("dataSettings.overview.health.loadError", "Không tải được kiểm tra cấu hình")}</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : null}
            <Button variant="outline" size="sm" className="mt-2" onClick={refetch}>
              {t("common.retry", "Thử lại")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { findings, summary } = model;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header tóm tắt */}
      {summary.total === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm font-medium text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {isEmpty
            ? t("dataSettings.overview.health.emptyModel", "Chưa có cấu hình để kiểm tra")
            : t("dataSettings.overview.health.ok", "Cấu hình hợp lệ ✓")}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("dataSettings.overview.health.issues", "{{count}} vấn đề cấu hình").replace("{{count}}", String(summary.total))}
          </div>
          <StatChipRow>
            <StatChip
              label={t("dataSettings.overview.health.sev.error", "Lỗi")}
              value={summary.errors}
              tone={summary.errors > 0 ? "error" : "default"}
            />
            <StatChip
              label={t("dataSettings.overview.health.sev.warning", "Cảnh báo")}
              value={summary.warnings}
              tone={summary.warnings > 0 ? "warning" : "default"}
            />
          </StatChipRow>
        </>
      )}

      {summary.total > 0 && (
        <ul className="max-h-[500px] divide-y divide-border overflow-y-auto rounded-lg border border-border/60">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingRow({ finding, onNavigate }: { finding: Finding; onNavigate: Navigate }): React.JSX.Element {
  const { t } = useTranslation();
  const isError = finding.sev === "error";

  const defaults: Record<Finding["kind"], string> = {
    emptyFactory: "Nhà máy chưa có phân xưởng",
    emptyWorkshop: "Phân xưởng chưa có dây chuyền",
    emptyLine: "Dây chuyền chưa có trạm",
    emptyStation: "Trạm chưa có máy",
    dupCode: 'Trùng mã "{{code}}"',
    machineUnapproved: "Máy chưa được duyệt (trạng thái: {{status}})",
    machineNoModel: "Máy chưa khai báo model",
  };

  let message = t(`dataSettings.overview.health.${finding.kind}`, defaults[finding.kind]);
  if (finding.vars) {
    for (const [k, v] of Object.entries(finding.vars)) {
      message = message.replace(`{{${k}}}`, String(v));
    }
  }

  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40">
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
          isError
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : "border-warning/40 bg-warning/5 text-warning",
        )}
      >
        {isError ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        {isError
          ? t("dataSettings.overview.health.sev.error", "Lỗi")
          : t("dataSettings.overview.health.sev.warning", "Cảnh báo")}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{message}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-0.5 text-xs text-muted-foreground">
          {finding.path.map((c, i) => (
            <span key={`${c.level}-${i}`} className="inline-flex items-center">
              {i > 0 && <ChevronRight className="mx-0.5 h-3 w-3 opacity-60" />}
              <span className={cn(i === finding.path.length - 1 && "font-medium text-foreground/80")}>
                {c.name}
              </span>
            </span>
          ))}
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2 text-xs text-primary opacity-70 transition-opacity group-hover:opacity-100 focus:opacity-100"
        onClick={() => onNavigate(finding.nav)}
      >
        {t("dataSettings.overview.edit", "Sửa")}
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

export default ConfigHealthPanel;
