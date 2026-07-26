import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";
import { ModelSelect } from "./ModelSelect";

/**
 * doc 69 Wave 6 (F1), servability fixed in the F1 review — admin action wired
 * to `aiEval.bootstrapFirstClassifier`.
 *
 * Wires the EXISTING DINOv2 embedding-head trainer → eval harness → quality
 * gate → registry → gated activation pipeline
 * (server/services/aiBootstrapClassifier.ts) behind one form. This is the ONE
 * classifier shape `aiInferenceEngine.runInference` actually dispatches at
 * serve time (isEmbeddingHeadModel) — a successful bootstrap is genuinely
 * servable, not just registered. Honest: an "insufficient labeled samples" or
 * gate-FAIL response is surfaced verbatim (server message), never silently
 * swallowed or faked as success.
 */
export function BootstrapClassifierDialog({
  open,
  onOpenChange,
  onBootstrapped,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBootstrapped?: () => void;
}) {
  const { t } = useTranslation();
  const [baseModelId, setBaseModelId] = useState("");
  const [classifierCode, setClassifierCode] = useState("");
  const [classifierName, setClassifierName] = useState("");
  const [labelsCsv, setLabelsCsv] = useState("");
  const [minSamplesPerClass, setMinSamplesPerClass] = useState("5");

  const classLabels = labelsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  const canSubmit = !!baseModelId && classifierCode.trim().length > 0 && classLabels.length >= 2;

  const bootstrap = trpc.aiEval.bootstrapFirstClassifier.useMutation({
    onSuccess: (result) => {
      if (result.activated) {
        toast.success(
          t(
            "aiModels.classifierHealth.successActivated",
            "Classifier đã được đăng ký VÀ kích hoạt (vượt qua quality-gate).",
          ),
        );
      } else {
        toast.warning(
          t(
            "aiModels.classifierHealth.successNotActivated",
            "Classifier đã được đăng ký (READY) nhưng CHƯA kích hoạt — không vượt qua quality-gate.",
          ),
        );
      }
      onOpenChange(false);
      onBootstrapped?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSubmit = () => {
    bootstrap.mutate({
      baseModelId: Number(baseModelId),
      classifierCode: classifierCode.trim(),
      classifierName: classifierName.trim() || undefined,
      classLabels,
      minSamplesPerClass: Number(minSamplesPerClass) || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t("aiModels.classifierHealth.dialogTitle", "Bootstrap model phân loại đầu tiên")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "aiModels.classifierHealth.dialogDesc",
              "Huấn luyện few-shot trên embedding của model gốc, đánh giá trên tập test khóa, và chỉ kích hoạt nếu vượt qua quality-gate. Nếu chưa đủ mẫu đã gán nhãn, thao tác sẽ báo lỗi rõ ràng — không tạo model giả.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>
              {t("aiModels.classifierHealth.fields.baseModel", "Model gốc (rút trích đặc trưng, ví dụ DINOv2)")} *
            </Label>
            <ModelSelect value={baseModelId} onChange={setBaseModelId} />
          </div>

          <div className="space-y-2">
            <Label>{t("aiModels.classifierHealth.fields.classifierCode", "Mã classifier")} *</Label>
            <Input
              value={classifierCode}
              onChange={(e) => setClassifierCode(e.target.value)}
              placeholder="bootstrap-defect-classifier"
            />
          </div>

          <div className="space-y-2">
            <Label>{t("aiModels.classifierHealth.fields.classifierName", "Tên classifier")}</Label>
            <Input
              value={classifierName}
              onChange={(e) => setClassifierName(e.target.value)}
              placeholder={t("aiModels.classifierHealth.fields.classifierNamePlaceholder", "(mặc định = mã)")}
            />
          </div>

          <div className="space-y-2">
            <Label>
              {t("aiModels.classifierHealth.fields.classLabels", "Nhãn lỗi (≥2, phân tách bằng dấu phẩy)")} *
            </Label>
            <Input
              value={labelsCsv}
              onChange={(e) => setLabelsCsv(e.target.value)}
              placeholder="OK, scratch, crack"
            />
            <p className="text-xs text-muted-foreground">
              {classLabels.length} {t("aiEval.labelsCount", "nhãn")}
            </p>
          </div>

          <div className="space-y-2">
            <Label>
              {t("aiModels.classifierHealth.fields.minSamplesPerClass", "Số mẫu đã gán nhãn tối thiểu / lớp")}
            </Label>
            <Input
              type="number"
              min={1}
              value={minSamplesPerClass}
              onChange={(e) => setMinSamplesPerClass(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bootstrap.isPending}>
            {t("common.cancel", "Hủy")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || bootstrap.isPending}>
            {bootstrap.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {t("aiModels.classifierHealth.submit", "Chạy Bootstrap")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
