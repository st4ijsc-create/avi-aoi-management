/**
 * DataQualityDashboard — doc 42 Đợt 5 (K1) — Bảng điều khiển CHẤT LƯỢNG DỮ LIỆU chủ.
 *
 * Governance (doc 42 §6 "Data quality dashboard" + §8 Đợt 5 benchmark parity): với
 * mỗi thực thể master-data (nhà cung cấp / vật tư / khách hàng / dụng cụ / quy đổi
 * đơn vị) hiện tổng bản ghi + số bản ghi THIẾU trường quan trọng hoặc trỏ tham
 * chiếu MỒ CÔI, để người quản lý phát hiện & dọn dữ liệu bẩn. Mỗi thẻ có link mở
 * đúng tab /master-data đã lọc sẵn.
 *
 * Đây là màn CHỈ ĐỌC: không tạo/sửa/xoá. RBAC = admin HOẶC module "masterdata"
 * canView (server re-enforce ở endpoint; RouteGuard gate ở tầng route).
 *
 * Dữ liệu: masterData.quality.summary (endpoint MỚI Đợt 5). i18n: dùng defaultValue
 * inline t('key','Tiếng Việt') — locale sync để Đợt 3 (doc 42 §9).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { ShieldCheck, Check, AlertTriangle, ArrowRight, Database, ListTree } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  PageContainer,
  SectionCard,
  StatChip,
  StatChipRow,
} from "@/components/patterns";
import { QueryBoundary } from "@/components/AsyncBoundary";
import { cn } from "@/lib/utils";

/** Shape returned by masterData.quality.summary. */
interface QualityIssue {
  code: string;
  label: string;
  count: number;
}
interface QualityEntity {
  entity: string;
  label: string;
  total: number;
  issues: QualityIssue[];
}
/** Doc 54 §11 P0.4b — a concrete offending row for the drill list. */
interface QualityDrillSample {
  id: number;
  label: string;
  reasonCodes: string[];
}
/** Engineering/hierarchy DQ card: issue counts + a bounded drill list. */
interface QualityEntityExtended extends QualityEntity {
  samples: QualityDrillSample[];
}

/** entity → tab /master-data để "mở lọc sẵn". */
const ENTITY_TAB: Record<string, string> = {
  suppliers: "suppliers",
  materials: "materials",
  customers: "customers",
  tools: "tools",
  uom: "uom",
};

export default function DataQualityDashboard() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { hasPermission, isAdmin } = usePermissions();
  const canView = isAdmin || hasPermission("masterdata", "canView");

  const title = t("dataQuality.title", "Chất lượng dữ liệu");
  const currentPath = "/data-quality";

  const summaryQuery = trpc.masterData.quality.summary.useQuery(undefined, {
    enabled: canView,
    staleTime: 60_000,
  });
  // Doc 54 §11 P0.4b — measurement-point + hierarchy DQ (with drill lists).
  const engineeringQuery = trpc.masterData.quality.engineering.useQuery(undefined, {
    enabled: canView,
    staleTime: 60_000,
  });

  const rollup = useMemo(() => {
    const data = [
      ...((summaryQuery.data ?? []) as QualityEntity[]),
      ...((engineeringQuery.data ?? []) as QualityEntityExtended[]),
    ];
    let totalRecords = 0;
    let totalIssues = 0;
    let affectedEntities = 0;
    for (const e of data) {
      totalRecords += e.total;
      const issueSum = e.issues.reduce((s, i) => s + i.count, 0);
      totalIssues += issueSum;
      if (issueSum > 0) affectedEntities += 1;
    }
    return { totalRecords, totalIssues, affectedEntities, entityCount: data.length };
  }, [summaryQuery.data, engineeringQuery.data]);

  if (!canView) {
    return (
      <DashboardLayout title={title} navItems={navItems} currentPath={currentPath}>
        <PageContainer>
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("masterData.noPermission", "Bạn không có quyền xem trang này.")}
            </CardContent>
          </Card>
        </PageContainer>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={title} navItems={navItems} currentPath={currentPath}>
      <PageContainer>
        <PageHeader
          icon={<ShieldCheck className="h-6 w-6" />}
          title={title}
          description={t(
            "dataQuality.subtitle",
            "Phát hiện bản ghi dữ liệu chủ thiếu trường hoặc tham chiếu mồ côi để dọn dẹp (chỉ đọc).",
          )}
        />

        <StatChipRow>
          <StatChip
            label={t("dataQuality.stat.records", "Tổng bản ghi")}
            value={rollup.totalRecords}
          />
          <StatChip
            label={t("dataQuality.stat.issues", "Tổng vấn đề")}
            value={rollup.totalIssues}
            tone={rollup.totalIssues > 0 ? "warning" : "success"}
          />
          <StatChip
            label={t("dataQuality.stat.entities", "Thực thể cần chú ý")}
            value={`${rollup.affectedEntities}/${rollup.entityCount}`}
            tone={rollup.affectedEntities > 0 ? "warning" : "success"}
          />
        </StatChipRow>

        <QueryBoundary
          query={summaryQuery}
          preset="cards"
          isEmpty={(d) => !d || (d as QualityEntity[]).length === 0}
          errorTitle={t("dataQuality.error", "Không tải được chỉ số chất lượng dữ liệu")}
        >
          {(data) => (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(data as QualityEntity[]).map((e) => (
                <EntityQualityCard
                  key={e.entity}
                  entity={e}
                  onOpen={
                    ENTITY_TAB[e.entity]
                      ? () => setLocation(`/master-data?tab=${ENTITY_TAB[e.entity]}`)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </QueryBoundary>

        {/* Doc 54 §11 P0.4b — điểm đo + phân cấp (kèm drill list). */}
        <div className="mt-8">
          <PageHeader
            icon={<ListTree className="h-6 w-6" />}
            title={t("dataQuality.engSection.title", "Điểm đo & phân cấp")}
            description={t(
              "dataQuality.engSection.subtitle",
              "Điểm đo thiếu ngưỡng / toạ độ gốc / thiếu linh kiện và các mắt xích phân cấp bị mồ côi (chỉ đọc).",
            )}
          />
          <QueryBoundary
            query={engineeringQuery}
            preset="cards"
            isEmpty={(d) => !d || (d as QualityEntityExtended[]).length === 0}
            errorTitle={t("dataQuality.error", "Không tải được chỉ số chất lượng dữ liệu")}
          >
            {(data) => (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(data as QualityEntityExtended[]).map((e) => (
                  <EntityQualityCard key={e.entity} entity={e} samples={e.samples} />
                ))}
              </div>
            )}
          </QueryBoundary>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}

function EntityQualityCard({
  entity,
  onOpen,
  samples,
}: {
  entity: QualityEntity;
  onOpen?: () => void;
  /** Doc 54 §11 P0.4b — optional bounded drill list of concrete offenders. */
  samples?: QualityDrillSample[];
}) {
  const { t } = useTranslation();
  const issueSum = entity.issues.reduce((s, i) => s + i.count, 0);
  const entityLabel = t(`dataQuality.entity.${entity.entity}`, entity.label);
  const drill = (samples ?? []).filter((s) => s.reasonCodes.length > 0);

  return (
    <SectionCard
      icon={<Database className="h-4 w-4 text-muted-foreground" />}
      title={entityLabel}
      description={t("dataQuality.recordCount", "{{n}} bản ghi").replace(
        "{{n}}",
        String(entity.total),
      )}
      action={
        onOpen ? (
          <Button variant="outline" size="sm" className="gap-1" onClick={onOpen}>
            {t("dataQuality.open", "Mở")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : undefined
      }
      contentClassName="pt-0"
    >
      {entity.total === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {t("dataQuality.noRecords", "Chưa có dữ liệu")}
        </p>
      ) : issueSum === 0 ? (
        <div className="flex items-center gap-2 py-2 text-sm text-success">
          <Check className="h-4 w-4" />
          {t("dataQuality.allClean", "Đầy đủ — không có vấn đề")}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {entity.issues.map((issue) => {
            const has = issue.count > 0;
            return (
              <li
                key={issue.code}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {has ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                  )}
                  <span className="truncate text-muted-foreground">
                    {t(`dataQuality.issue.${entity.entity}.${issue.code}`, issue.label)}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums font-semibold",
                    has ? "text-warning" : "text-muted-foreground",
                  )}
                  title={t("dataQuality.ofTotal", "trên tổng {{n}} bản ghi").replace(
                    "{{n}}",
                    String(entity.total),
                  )}
                >
                  {issue.count}
                  <span className="font-normal text-muted-foreground">/{entity.total}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {drill.length > 0 && (
        <details className="mt-3 border-t border-border pt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            {t("dataQuality.drill.show", "Xem {{n}} bản ghi cần dọn").replace(
              "{{n}}",
              String(drill.length),
            )}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {drill.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="truncate font-mono text-muted-foreground">{s.label}</span>
                <span className="flex flex-wrap gap-1">
                  {s.reasonCodes.map((code) => (
                    <span
                      key={code}
                      className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning"
                    >
                      {t(`dataQuality.issue.${entity.entity}.${code}`, code)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </SectionCard>
  );
}
