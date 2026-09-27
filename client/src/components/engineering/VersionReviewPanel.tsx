/**
 * doc 80 Đợt 1 Task 5 (WS-01 / F1) — DUYỆT PHIÊN BẢN TRONG IDE.
 *
 * Cờ DPC_VERSION_REVIEW_ENABLED bật thì Build bị chặn tới khi một người KHÁC tác giả duyệt phiên
 * bản — nhưng trước đây UI không có đường nào để duyệt (client gọi `reviewArtifact` 0 lần), nên
 * 4/7 phiên bản kẹt `pending_review`. Panel này là đường ấy:
 *   • tác giả: "Yêu cầu duyệt" (ghi người/lúc yêu cầu) — KHÔNG có nút Duyệt (server cũng chặn SoD);
 *   • người khác có quyền: "Duyệt" / "Từ chối" (từ chối BẮT BUỘC lý do);
 *   • phiên bản bị từ chối: hiện lý do.
 * Chỉ được render khi cờ bật (EngineeringWorkspace quyết) — cờ tắt ⇒ 0 phần tử review.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, ShieldX, Send, Hourglass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export type ReviewStatus = "pending_review" | "approved" | "rejected";

interface ReviewTrailView {
  requestedBy?: number;
  requestedAt?: string;
  reason?: string | null;
}

/** Đọc dấu vết duyệt server lưu ở diagnosticsJson.review (null nếu không có). */
export function readReviewTrailView(diagnosticsJson: unknown): ReviewTrailView | null {
  if (!diagnosticsJson || typeof diagnosticsJson !== "object") return null;
  const r = (diagnosticsJson as Record<string, unknown>).review;
  return r && typeof r === "object" ? (r as ReviewTrailView) : null;
}

/** Badge trạng thái duyệt gắn trên chip phiên bản. */
export function ReviewStatusBadge({ status, artifactId }: { status: string; artifactId: number }) {
  const { t } = useTranslation();
  const cfg =
    status === "approved"
      ? { cls: "border-success/50 text-success", label: t("engineering.review.status.approved", "Đã duyệt") }
      : status === "rejected"
        ? { cls: "border-destructive/50 text-destructive", label: t("engineering.review.status.rejected", "Bị từ chối") }
        : { cls: "border-warning/50 text-warning", label: t("engineering.review.status.pending_review", "Chờ duyệt") };
  return (
    <Badge variant="outline" data-testid={`version-review-badge-${artifactId}`} className={`ml-1 text-[9px] ${cfg.cls}`}>
      {cfg.label}
    </Badge>
  );
}

export function VersionReviewPanel({
  artifact,
  userId,
  canReview,
  onRequest,
  onApprove,
  onReject,
  busy,
}: {
  artifact: { id: number; version: number; reviewStatus: string; createdBy: number | null; diagnosticsJson: unknown };
  userId: number | undefined;
  canReview: boolean;
  onRequest: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const trail = readReviewTrailView(artifact.diagnosticsJson);
  const isAuthor = artifact.createdBy != null && userId != null && artifact.createdBy === userId;
  const pending = artifact.reviewStatus === "pending_review";

  return (
    <div data-testid="version-review-panel" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2 text-xs">
      <span className="font-medium">{t("engineering.review.title", "Duyệt phiên bản")} v{artifact.version}:</span>
      <ReviewStatusBadge status={artifact.reviewStatus} artifactId={artifact.id} />

      {pending && trail?.requestedAt && (
        <span data-testid="version-review-requested" className="inline-flex items-center gap-1 text-muted-foreground">
          <Hourglass className="h-3 w-3" aria-hidden="true" />
          {t("engineering.review.requested", "Đã yêu cầu duyệt")}
        </span>
      )}

      {artifact.reviewStatus === "rejected" && trail?.reason && (
        <span data-testid="version-review-reason" className="text-destructive">
          {t("engineering.review.rejectedReason", "Lý do từ chối")}: {trail.reason}
        </span>
      )}

      {pending && isAuthor && (
        <>
          <Button
            size="sm" variant="outline" className="h-7"
            data-testid="version-review-request"
            disabled={busy || !canReview || Boolean(trail?.requestedAt)}
            onClick={onRequest}
          >
            <Send className="mr-1 h-3.5 w-3.5" /> {t("engineering.review.request", "Yêu cầu duyệt")}
          </Button>
          <span className="text-muted-foreground">
            {t("engineering.review.authorHint", "Bạn là tác giả — một người KHÁC phải duyệt phiên bản này.")}
          </span>
        </>
      )}

      {pending && !isAuthor && canReview && (
        <>
          <Button size="sm" className="h-7" data-testid="version-review-approve" disabled={busy} onClick={onApprove}>
            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> {t("engineering.review.approve", "Duyệt")}
          </Button>
          <Button
            size="sm" variant="destructive" className="h-7"
            data-testid="version-review-reject"
            disabled={busy}
            onClick={() => { setReason(""); setRejectOpen(true); }}
          >
            <ShieldX className="mr-1 h-3.5 w-3.5" /> {t("engineering.review.reject", "Từ chối")}
          </Button>
        </>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("engineering.review.rejectTitle", "Từ chối phiên bản")} v{artifact.version}</DialogTitle>
            <DialogDescription>
              {t("engineering.review.rejectDesc", "Tác giả sẽ đọc lý do này để sửa và lưu phiên bản mới.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="version-review-reject-reason" className="text-xs">
              {t("engineering.review.rejectReason", "Lý do từ chối (bắt buộc)")}
            </Label>
            <Textarea
              id="version-review-reject-reason"
              data-testid="version-review-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[72px] text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t("common.cancel", "Hủy")}</Button>
            <Button
              variant="destructive"
              data-testid="version-review-reject-confirm"
              disabled={busy || reason.trim().length === 0}
              onClick={() => { onReject(reason.trim()); setRejectOpen(false); }}
            >
              {t("engineering.review.rejectConfirm", "Từ chối")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
