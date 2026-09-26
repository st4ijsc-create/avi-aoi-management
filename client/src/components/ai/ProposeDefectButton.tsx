/**
 * ProposeDefectButton — P4-F "vision-close-loop".
 *
 * Drop-in action that turns a vision/anomaly finding into an inspection defect
 * record through the EXISTING HITL flow. NOTHING is written until the user
 * approves:
 *
 *   1. Click "Propose as defect" → opens a confirm dialog.
 *   2. The dialog suggests IPC defect codes mapped from the finding text
 *      (aiVision.suggestDefectCodes) and lets the user PICK/OVERRIDE any code
 *      (aiVision.defectCodes).
 *   3. "Propose" → aiVision.proposeDefect (creates a pending HITL action; still
 *      NO write) → immediately aiCopilot.confirmAction (token == actionId) to
 *      execute the approved write. The two-step propose→confirm is the same
 *      lifecycle every AI write uses.
 *
 * Honest: read-only roles (no `history_correct` canEdit) do NOT see the button.
 * A denied propose surfaces the server's localized message.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

export type VisionSource =
  | "advanced_vision" | "anomaly" | "segmentation" | "image_search" | "vision_language";

export interface ProposeDefectFinding {
  /** Free-text description of the finding (drives code suggestion). */
  findingText: string;
  source: VisionSource;
  confidence?: number | null;
  /** Attach mode — set defectCatalogId on an existing measurement result. */
  measurementResultId?: number | null;
  /** Create mode — both required to INSERT a new NG measurement result. */
  inspectionId?: number | null;
  pointDefId?: number | null;
  /** Optional defect location on the board image (pixels). */
  bbox?: { x: number; y: number; w: number; h: number } | null;
  imageKey?: string | null;
}

interface Props {
  finding: ProposeDefectFinding;
  /** Optional small/ghost styling for inline use. */
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "secondary" | "default";
  className?: string;
}

export default function ProposeDefectButton({ finding, size = "sm", variant = "outline", className }: Props) {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  // Mirrors the server-side RBAC (history_correct canEdit).
  const canPropose = isAdmin === true || hasPermission("history_correct", "canEdit");

  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const canTarget =
    !!finding.measurementResultId || (!!finding.inspectionId && !!finding.pointDefId);

  const suggestQ = trpc.aiVision.suggestDefectCodes.useQuery(
    { findingText: finding.findingText || "?", limit: 5 },
    { enabled: open && !!finding.findingText },
  );
  const codesQ = trpc.aiVision.defectCodes.useQuery(undefined, { enabled: open });

  const proposeM = trpc.aiVision.proposeDefect.useMutation();
  const confirmM = trpc.aiCopilot.confirmAction.useMutation();

  const suggestions = (suggestQ.data?.matches ?? []) as Array<{
    catalog: { id: number; code: string; name: string; severity: string };
    score: number;
    matchedOn: string;
  }>;
  const allCodes = (codesQ.data ?? []) as Array<{
    id: number; code: string; name: string; severity: string; category: string;
  }>;

  // Default the picker to the top suggestion when the dialog opens.
  const effectiveId = useMemo(() => {
    if (selectedId) return selectedId;
    if (suggestions.length > 0) return String(suggestions[0].catalog.id);
    return "";
  }, [selectedId, suggestions]);

  if (!canPropose) return null;

  const submit = async () => {
    const defectCatalogId = Number(effectiveId);
    if (!defectCatalogId) {
      toast.error(t("visionDefect.pickCode", "Hãy chọn một mã lỗi"));
      return;
    }
    setSubmitting(true);
    try {
      const proposed = await proposeM.mutateAsync({
        defectCatalogId,
        source: finding.source,
        findingText: finding.findingText?.slice(0, 500),
        confidence: finding.confidence ?? null,
        measurementResultId: finding.measurementResultId ?? null,
        inspectionId: finding.inspectionId ?? null,
        pointDefId: finding.pointDefId ?? null,
        bbox: finding.bbox ?? null,
        imageKey: finding.imageKey ?? null,
      });
      if (!proposed.ok) {
        toast.error(proposed.message ?? t("visionDefect.proposeFailed", "Không thể đề xuất lỗi"));
        return;
      }
      // Approve immediately — the dialog IS the human confirm step.
      const res = await confirmM.mutateAsync({
        actionId: proposed.actionId,
        token: proposed.token,
      });
      if (res.ok && res.status === "executed") {
        toast.success(t("visionDefect.written", "Đã ghi bản ghi lỗi vào dữ liệu kiểm tra"));
        setOpen(false);
        setSelectedId("");
      } else {
        toast.error(res.message ?? t("visionDefect.confirmFailed", "Xác nhận thất bại"));
      }
    } catch (e: any) {
      toast.error(mapTrpcError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={!canTarget}
        title={!canTarget ? t("visionDefect.noTarget", "Thiếu tham chiếu inspection/measurement để gắn lỗi") : undefined}
        onClick={() => setOpen(true)}
      >
        <ShieldCheck className="h-4 w-4 mr-1.5" />
        {t("visionDefect.proposeBtn", "Đề xuất là lỗi (HITL)")}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelectedId(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("visionDefect.dialogTitle", "Đề xuất bản ghi lỗi")}</DialogTitle>
            <DialogDescription>
              {t(
                "visionDefect.dialogDesc",
                "Chưa có gì được ghi cho đến khi bạn xác nhận. Chọn mã lỗi IPC phù hợp (có thể ghi đè gợi ý).",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {finding.findingText && (
              <div className="text-sm rounded bg-muted/50 p-2">
                <span className="text-muted-foreground">{t("visionDefect.finding", "Phát hiện")}: </span>
                {finding.findingText.slice(0, 240)}
                {finding.confidence != null && (
                  <span className="text-muted-foreground"> · conf {(finding.confidence * 100).toFixed(0)}%</span>
                )}
              </div>
            )}

            {suggestions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">{t("visionDefect.suggested", "Gợi ý (best-effort)")}</Label>
                <div className="flex flex-wrap gap-1">
                  {suggestions.map((s) => (
                    <button
                      key={s.catalog.id}
                      type="button"
                      onClick={() => setSelectedId(String(s.catalog.id))}
                      className="focus:outline-none"
                    >
                      <Badge variant={effectiveId === String(s.catalog.id) ? "default" : "outline"}>
                        {s.catalog.code} · {(s.score * 100).toFixed(0)}%
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">{t("visionDefect.code", "Mã lỗi (ghi đè được)")}</Label>
              <Select value={effectiveId} onValueChange={setSelectedId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("visionDefect.selectCode", "Chọn mã lỗi…")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {allCodes.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.code} — {c.name} ({c.severity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {finding.measurementResultId
                ? t("visionDefect.attachNote", "Sẽ gắn mã lỗi vào kết quả đo hiện có (NG).")
                : t("visionDefect.createNote", "Sẽ tạo một kết quả đo NG mới mang mã lỗi này.")}
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              {t("common.cancel", "Hủy")}
            </Button>
            <Button onClick={submit} disabled={submitting || !effectiveId}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("visionDefect.confirmWrite", "Xác nhận ghi lỗi")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
