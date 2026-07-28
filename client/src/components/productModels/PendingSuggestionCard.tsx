/**
 * Wave 2 đường A — Task 2: xem + duyệt đề xuất ngưỡng NGAY trong form điểm đo,
 * ngay cạnh AIThresholdSuggestButton (nơi kỹ sư vừa đứng để tạo đề xuất mới).
 *
 * Bối cảnh: 150 đề xuất AI từng chỉ hiện ở /threshold-approvals — một màn KHÁC
 * với nơi kỹ sư thực sự chỉnh điểm đo (/products) — nên chúng gần như vô hình.
 * Component này đưa việc XEM + DUYỆT về đúng chỗ, không tạo đường ghi mới.
 *
 * KHÔNG nới lỏng cổng an toàn nào:
 *   - approve/reject gọi ĐÚNG hai mutation đã có (thresholdApprovalRouter,
 *     qualityProcedure). Không hợp đồng mới, không đường ghi mới.
 *   - Cổng SoD (canDecide, ./pendingSuggestionLogic) CHỈ là lớp hiển thị để khoá
 *     nút + nêu lý do rõ ràng. Máy chủ vẫn là nơi thực thi thật (assertApprovalSoD
 *     — decidedBy ≠ requestedBy). Một client cũ/bị sửa vẫn bị chặn ở server.
 *   - Suy giảm phải TRUNG THỰC: lỗi tải danh sách hiện thông báo LỖI (không giả
 *     vờ "không có đề xuất"); rỗng thật sự ⇒ không render gì (không chiếm chỗ).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Sparkles, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { canDecide } from "./pendingSuggestionLogic";
import type { RouterOutputs } from "./types";

type Approval = RouterOutputs["thresholdApproval"]["list"][number];

interface PendingSuggestionCardProps {
  pointDefId: number;
  currentUserId?: number;
  /** Cha invalidate cả countPendingByProduct lẫn list (xem PointDetailsForm.refreshSuggestionState). */
  onDecided?: () => void;
  /**
   * Vòng sửa 2 (F1, nghiệm thu live) — gọi CHỈ khi một đề xuất của điểm này vừa
   * được DUYỆT VÀ ÁP DỤNG THẬT (server ghi measurement_point_defs, status trả về
   * "applied"). KHÔNG gọi khi Từ chối (không ghi gì) hay khi duyệt-không-áp-dụng
   * (không xảy ra ở thẻ này — không có toggle apply, nhưng kiểm tra status cho
   * chắc thay vì giả định). Cha dùng để nạp lại ô nhập ngưỡng của form — nếu
   * không, form giữ giá trị CŨ và nút "Lưu" ngay cạnh sẽ ghi đè ngược đề xuất
   * vừa duyệt (đúng lỗi CRITICAL bị bắt khi nghiệm thu live).
   */
  onApplied?: (applied: { pointDefId: number; lsl: string; usl: string; nominal: string | null }) => void;
}

function num(v: string | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

export function PendingSuggestionCard({ pointDefId, currentUserId, onDecided, onApplied }: PendingSuggestionCardProps) {
  const { t } = useTranslation();
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  // F3 (nghiệm thu live) — mặc định chỉ hiện đề xuất MỚI NHẤT (auto-tune lặp lại
  // tạo hàng chục bản trùng cho cùng 1 điểm, không có ràng buộc chống trùng ở DB —
  // nợ có sẵn, không sửa DB ở đây). Reset khi đổi điểm để không mang trạng thái
  // "đã mở rộng" của điểm cũ sang điểm mới.
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    setShowAll(false);
    setRejectingId(null);
    setRejectComment("");
  }, [pointDefId]);

  // Vòng sửa 1 (review Task 2) — approve/reject là qualityProcedure ở server
  // (settings_alerts.canEdit); dùng ĐÚNG cặp module/action mà hai tiền lệ trong
  // codebase đã dùng cho cùng router này (ThresholdApprovalsPage.tsx,
  // ApprovalsInbox.tsx) để client ↔ server luôn khớp gate.
  const { hasPermission } = usePermissions();
  const canApproveThresholds = hasPermission("settings_alerts", "canEdit");

  // Server ĐÃ hỗ trợ lọc theo pointDefId (thresholdApprovalRouter.list) — dùng
  // thẳng bộ lọc của server, KHÔNG lọc phía client, KHÔNG đổi hợp đồng `list`.
  const listQuery = trpc.thresholdApproval.list.useQuery({ status: "requested", pointDefId });

  const approveM = trpc.thresholdApproval.approve.useMutation({
    onSuccess: (data) => {
      toast.success(t("productModels.approveSuccess", "Đã duyệt đề xuất"));
      // F1 (nghiệm thu live) — chỉ báo cho cha nạp lại ô nhập khi server THỰC SỰ
      // ghi giới hạn mới (status "applied"); "approved" (chưa apply) không đổi gì
      // ở measurement_point_defs nên KHÔNG được đụng ô nhập.
      if (data?.status === "applied") {
        onApplied?.({
          pointDefId: data.pointDefId,
          lsl: data.proposedLsl,
          usl: data.proposedUsl,
          nominal: data.proposedNominal ?? null,
        });
      }
      onDecided?.();
    },
    onError: (e) => toast.error(e.message || t("productModels.approveFailed", "Duyệt thất bại")),
  });

  const rejectM = trpc.thresholdApproval.reject.useMutation({
    onSuccess: () => {
      toast.success(t("productModels.rejectSuccess", "Đã từ chối đề xuất"));
      setRejectingId(null);
      setRejectComment("");
      onDecided?.();
    },
    onError: (e) => toast.error(e.message || t("productModels.rejectFailed", "Từ chối thất bại")),
  });

  const confirmReject = (id: number) => {
    // reject.comment KHÔNG optional ở server (z.string().max(1000)) — chặn sớm
    // ở client để không nhận lỗi zod khó hiểu, giống ThresholdApprovalsPage.
    if (rejectComment.trim().length === 0) {
      toast.error(t("thresholdApprovals.commentRequired", "Vui lòng nhập lý do từ chối"));
      return;
    }
    rejectM.mutate({ id, comment: rejectComment.trim() });
  };

  // Lỗi tải ⇒ nói THẬT là lỗi — không im lặng biến thành "không có đề xuất".
  if (listQuery.isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("productModels.pendingLoadError", "Không tải được đề xuất đang chờ.")}
        </span>
        <Button size="sm" variant="outline" onClick={() => { void listQuery.refetch(); }}>
          {t("productModels.pendingRetry", "Thử lại")}
        </Button>
      </div>
    );
  }

  if (listQuery.isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("productModels.pendingLoading", "Đang tải đề xuất đang chờ...")}
      </div>
    );
  }

  const approvals = (listQuery.data ?? []) as Approval[];
  if (approvals.length === 0) return null; // rỗng thật ⇒ không chiếm chỗ trong form

  // F3 (nghiệm thu live) — `list` đã orderBy(desc(createdAt)) ở server nên
  // approvals[0] LÀ đề xuất mới nhất; mặc định chỉ hiện nó, phần còn lại mở khi
  // bấm — KHÔNG được rơi mất khỏi bộ đếm (heading vẫn dùng approvals.length thật).
  const visibleApprovals = showAll ? approvals : approvals.slice(0, 1);
  const olderCount = approvals.length - 1;

  return (
    <div className="space-y-2 rounded-md border bg-muted/10 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        {t("productModels.pendingHeading", "{{n}} đề xuất đang chờ duyệt", { n: approvals.length })}
      </div>

      {visibleApprovals.map((approval) => {
        const gate = canDecide({ requestedBy: approval.requestedBy }, currentUserId, canApproveThresholds);
        const s = (approval.suggestion ?? {}) as Record<string, any>;
        const sampleSize = s.sampleSize ?? null;
        // Producer khác nhau đặt tên khác nhau (proposedCpk từ AIThresholdSuggestButton,
        // projectedCpk từ auto-tune) — đọc rộng rãi, giống ThresholdApprovalsPage.
        const cpk = s.cpk ?? s.Cpk ?? s.proposedCpk ?? s.projectedCpk ?? null;
        const basis = s.basis ?? s.reason ?? s.rationale ?? null;
        // V25 provenance marker — chỉ auto-tune đặt field này.
        const isAutoTune = s.proposedBy === "ai_autotune";
        const recentNg: Array<{ measurementId?: number; imageUrl?: string | null; aiDescription?: string | null }> =
          Array.isArray(s.evidence?.recentNg) ? s.evidence.recentNg : [];

        const approvingThis = approveM.isPending && approveM.variables?.id === approval.id;
        const rejectingThisBusy = rejectM.isPending && rejectM.variables?.id === approval.id;
        const busy = approvingThis || rejectingThisBusy;
        const isRejectingUi = rejectingId === approval.id;

        return (
          <div key={approval.id} className="space-y-2 rounded border bg-background p-2.5 text-xs">
            {(isAutoTune || sampleSize != null) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {isAutoTune && <Badge variant="outline">{t("productModels.autoTuneBadge", "Tự động dò")}</Badge>}
                {sampleSize != null && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t("thresholdAdvisor.samples", "{{n}} mẫu", { n: sampleSize })}
                  </Badge>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border p-2">
                <div className="mb-1 font-medium text-muted-foreground">{t("thresholdApprovals.current", "Hiện tại")}</div>
                <div>LSL: <b>{num(approval.currentLsl)}</b></div>
                <div>USL: <b>{num(approval.currentUsl)}</b></div>
                <div>{t("thresholdApprovals.nominal", "Danh nghĩa")}: <b>{num(approval.currentNominal)}</b></div>
              </div>
              <div className="rounded border bg-muted/30 p-2">
                <div className="mb-1 font-medium text-muted-foreground">{t("thresholdApprovals.proposed", "Đề xuất")}</div>
                <div>LSL: <b>{num(approval.proposedLsl)}</b></div>
                <div>USL: <b>{num(approval.proposedUsl)}</b></div>
                <div>{t("thresholdApprovals.nominal", "Danh nghĩa")}: <b>{num(approval.proposedNominal)}</b></div>
              </div>
            </div>

            {(cpk != null || basis != null) && (
              <div className="rounded border p-2">
                <div className="mb-1 font-medium text-muted-foreground">{t("thresholdApprovals.aiBasis", "Cơ sở AI")}</div>
                {cpk != null && (
                  <div>Cpk: <b>{typeof cpk === "number" ? cpk.toFixed(3) : String(cpk)}</b></div>
                )}
                {basis != null && <p className="whitespace-pre-wrap text-muted-foreground">{String(basis)}</p>}
              </div>
            )}

            {recentNg.length > 0 && (
              <div className="space-y-1">
                <div className="font-medium text-muted-foreground">{t("thresholdApprovals.evidenceTitle", "Bằng chứng NG gần đây (ảnh)")}</div>
                <div className="flex flex-wrap gap-2">
                  {recentNg.slice(0, 3).map((e, i) =>
                    e.imageUrl ? (
                      <img
                        key={e.measurementId ?? i}
                        src={e.imageUrl}
                        alt={t("thresholdApprovals.evidenceImageAlt", "Ảnh điểm đo NG")}
                        title={e.aiDescription ?? undefined}
                        className="h-14 w-20 rounded border object-cover"
                        loading="lazy"
                      />
                    ) : null,
                  )}
                </div>
              </div>
            )}

            {!gate.allowed && (
              <p className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {gate.reason === "unknown-user"
                  ? t("productModels.unknownUserBlocked", "Chưa xác định được tài khoản của bạn — hãy đăng nhập lại để duyệt.")
                  : gate.reason === "no-permission"
                    ? t("productModels.noPermissionBlocked", "Bạn không có quyền duyệt đề xuất ngưỡng — cần người phụ trách chất lượng.")
                    : t("productModels.ownRequestBlocked", "Bạn là người tạo đề xuất này — cần người khác duyệt.")}
              </p>
            )}

            {isRejectingUi ? (
              <div className="space-y-1.5">
                <Textarea
                  value={rejectComment}
                  onChange={(e) => setRejectComment(e.target.value)}
                  placeholder={t("productModels.rejectCommentPlaceholder", "Lý do từ chối (bắt buộc)")}
                  className="min-h-16 text-xs"
                />
                <div className="flex gap-1.5">
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => confirmReject(approval.id)}>
                    {rejectingThisBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    {t("productModels.rejectConfirm", "Xác nhận từ chối")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => { setRejectingId(null); setRejectComment(""); }}
                  >
                    {t("productModels.cancelReject", "Huỷ")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {/* Vòng sửa 1 — Duyệt ở đây gọi apply mặc định true (server default),
                    tức ghi thẳng vào measurement_point_defs của sản phẩm đang chạy
                    NGAY khi bấm. Nói thẳng điều đó thay vì để nút "Duyệt" trông như
                    một quyết định nhẹ nhàng, không hậu quả tức thời. */}
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {t("productModels.approveAppliesImmediately", "Duyệt sẽ áp ngưỡng mới vào điểm đo ngay lập tức.")}
                </p>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    disabled={!gate.allowed || busy}
                    onClick={() => approveM.mutate({ id: approval.id })}
                  >
                    {approvingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {t("productModels.approveSuggestion", "Duyệt")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!gate.allowed || busy}
                    onClick={() => setRejectingId(approval.id)}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {t("productModels.rejectSuggestion", "Từ chối")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {olderCount > 0 && (
        // F3 — KHÔNG được im lặng giấu N cái còn lại: một dòng thật, bấm được,
        // luôn hiện (không phải tooltip/ẩn trong menu), nêu đúng số thật.
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="flex w-full items-center justify-center gap-1 rounded border border-dashed py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40"
        >
          {showAll ? (
            <>
              <ChevronUp className="h-3 w-3" />
              {t("productModels.collapseOlderSuggestions", "Thu gọn")}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              {t("productModels.showOlderSuggestions", "Còn {{n}} đề xuất cũ hơn cho điểm này — bấm để xem", { n: olderCount })}
            </>
          )}
        </button>
      )}
    </div>
  );
}
