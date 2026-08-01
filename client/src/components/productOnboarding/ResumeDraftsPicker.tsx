// H3 #2 (doc 42 §10.12 · line 227 "Resume picker") — resume an unfinished setup.
//
// The wizard's "resumable" draft was only reachable by remembering the
// ?product=<id> deep-link; opening the bare route lost your place. The backend
// already exposes productOnboarding.listDrafts (in-progress drafts + product
// code/name) and deleteDraft — this surfaces them on step 0 so an engineer picks
// up exactly where they left off (or discards a stale/orphan draft — closing the
// deleteDraft "mồ côi" gap). Renders nothing when there are no drafts.
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { ConfirmDeleteDialog } from "@/components/patterns";
import { History, Play, Trash2 } from "lucide-react";
import { PRODUCT_ONBOARDING_STEPS } from "./types";

interface Props {
  /** Resume a draft: jump to its product + last step. */
  onResume: (productModelId: number, productCode: string | null, currentStep: number) => void;
}

export function ResumeDraftsPicker({ onResume }: Props) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const draftsQ = trpc.productOnboarding.listDrafts.useQuery();

  const deleteMut = trpc.productOnboarding.deleteDraft.useMutation({
    onSuccess: () => {
      toast.success(t("productOnboarding.resume.discarded", "Đã hủy bản nháp thiết lập"));
      utils.productOnboarding.listDrafts.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });

  const drafts = draftsQ.data ?? [];
  if (draftsQ.isLoading || drafts.length === 0) return null;

  const lastIdx = PRODUCT_ONBOARDING_STEPS.length - 1;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          {t("productOnboarding.resume.title", "Tiếp tục thiết lập đang dở")}
        </CardTitle>
        <CardDescription>
          {t(
            "productOnboarding.resume.subtitle",
            "Bạn có bản thiết lập chưa hoàn tất. Chọn để tiếp tục đúng chỗ đã dừng thay vì bắt đầu lại.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {drafts.map((d) => {
          const idx = Math.min(Math.max(d.currentStep ?? 0, 0), lastIdx);
          const stepLabel = t(
            `productOnboarding.steps.${PRODUCT_ONBOARDING_STEPS[idx].key}`,
            PRODUCT_ONBOARDING_STEPS[idx].key,
          );
          return (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 rounded border bg-background p-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {d.productCode ?? `#${d.productModelId}`}
                  {d.productName ? ` — ${d.productName}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("productOnboarding.resume.atStep", {
                    defaultValue: "Đang ở bước: {{step}}",
                    step: stepLabel,
                  })}
                  {d.updatedAt ? ` · ${new Date(d.updatedAt as unknown as string).toLocaleString()}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => onResume(d.productModelId, d.productCode, d.currentStep ?? 0)}
                >
                  <Play className="h-4 w-4" />
                  {t("productOnboarding.resume.continue", "Tiếp tục")}
                </Button>
                <ConfirmDeleteDialog
                  trigger={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      aria-label={t("productOnboarding.resume.discard", "Hủy bản nháp")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  }
                  itemLabel={t("productOnboarding.resume.draftLabel", {
                    defaultValue: "bản nháp {{code}}",
                    code: d.productCode ?? `#${d.productModelId}`,
                  })}
                  onConfirm={async () => {
                    await deleteMut.mutateAsync({ productModelId: d.productModelId });
                  }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default ResumeDraftsPicker;
