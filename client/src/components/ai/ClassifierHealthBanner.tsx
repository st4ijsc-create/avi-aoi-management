import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Info, Sparkles } from "lucide-react";
import { BootstrapClassifierDialog } from "./BootstrapClassifierDialog";

/**
 * doc 69 Wave 6 (F1) — "no active classifier" health banner.
 *
 * Surfaces `aiModel.classifierHealth` so operators SEE when the quality-gate /
 * A-B testing / active-learning superstructure is inert (no ACTIVE defect
 * classifier to gate). Renders nothing while loading or once a classifier is
 * ACTIVE — purely additive, never blocks the page.
 *
 * `withAction`: on AIModelManagementPage (admin surface) this opens the
 * bootstrap-first-classifier dialog directly; elsewhere (e.g. AIBrainDashboard)
 * it links over to /ai-models instead, since the bootstrap action itself is
 * admin-gated and lives there.
 */
export function ClassifierHealthBanner({ withAction = false }: { withAction?: boolean }) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const health = trpc.aiModel.classifierHealth.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (health.isLoading || !health.data || health.data.hasActiveClassifier) return null;

  return (
    <>
      <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-amber-800 dark:text-amber-200">
            {t("aiModels.classifierHealth.bannerTitle", "Chưa có model phân loại lỗi ACTIVE")}
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {t(
              "aiModels.classifierHealth.bannerBody",
              "Quality-gate / A-B testing đang trơ (không có gì để kiểm định) cho đến khi một classifier được bootstrap và kích hoạt.",
            )}
          </div>
          {health.data.reason ? (
            <div
              className="mt-1 truncate font-mono text-xs text-muted-foreground/80"
              title={health.data.reason}
            >
              {health.data.reason}
            </div>
          ) : null}
        </div>
        <div className="shrink-0">
          {withAction ? (
            <Button size="sm" variant="outline" className="border-amber-500/50" onClick={() => setDialogOpen(true)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {t("aiModels.classifierHealth.cta", "Bootstrap model đầu tiên")}
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline" className="border-amber-500/50">
              <Link href="/ai-models">
                {t("aiModels.classifierHealth.ctaLink", "Đi tới Quản lý Model")}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {withAction ? (
        <BootstrapClassifierDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onBootstrapped={() => health.refetch()}
        />
      ) : null}
    </>
  );
}
