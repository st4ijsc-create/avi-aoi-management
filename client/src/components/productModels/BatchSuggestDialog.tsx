/**
 * Wave 2 đường A — Task 3: đề xuất ngưỡng HÀNG LOẠT cho N điểm đo đã chọn.
 *
 * Bối cảnh: kỹ sư sửa ngưỡng cho vài chục điểm một lúc, nhưng trước Task 3 phải
 * mở AIThresholdSuggestButton cho TỪNG điểm một. Dialog này gọi
 * `aiThresholdAdvisor.recommendForPoint` cho từng điểm đã chọn, chia kết quả
 * thành BA nhóm — "gửi được" / "chưa đủ dữ liệu" / "không lấy được khuyến nghị"
 * (batchSuggestLogic.partitionBatch) — cho xem trước từng dòng (checkbox tích
 * sẵn, bỏ tích được), rồi mới gửi.
 *
 * PHẠM VI CỐ Ý HẸP (YAGNI — xem task-3-brief.md):
 *   - Đây CHỈ là đề xuất hàng loạt. KHÔNG duyệt hàng loạt — duyệt hàng loạt đã
 *     có sẵn ở /threshold-approvals (`thresholdApproval.batchApprove`). Dialog
 *     này không gọi mutation đó, không có nút "duyệt tất cả".
 *   - Duyệt/từ chối TỪNG điểm tại chỗ đã có ở Task 2 (PendingSuggestionCard,
 *     trong PointDetailsForm) — không nhân bản ở đây.
 *
 * KHÔNG nới lỏng cổng an toàn nào:
 *   - Gửi hàng loạt gọi ĐÚNG `thresholdApproval.request` (hợp đồng có sẵn) cho
 *     từng dòng đã tích — không có đường ghi mới, không bỏ SoD (approve vẫn
 *     đòi hỏi một người khác, y hệt đường đơn-điểm).
 *   - Suy giảm TRUNG THỰC: điểm thiếu mẫu thật/needsReview hiện trong "Chưa đủ
 *     dữ liệu"; lỗi hạ tầng (mạng/tính toán/trợ lý tắt) hiện RIÊNG trong
 *     "Không lấy được khuyến nghị" — hai bản chất khác nhau, không gộp
 *     (batchSuggestLogic.toBatchItem quyết định việc này — Vòng sửa 1).
 *   - Tổng kết sau khi gửi TRUNG THỰC: không báo "thành công" khi có dòng lỗi,
 *     và KHÔNG khẳng định con số nào nếu phiên gửi đã bị HUỶ giữa chừng (đóng
 *     dialog / điều hướng khỏi trang trong lúc đang gửi — xem `handleSubmit`
 *     + `runCancellableBatchSubmit`, Vòng sửa 1).
 *
 * Advisor là THỐNG KÊ THUẦN (không gọi model GGUF — server/utils/thresholdSuggestion.ts),
 * nên gọi N điểm liên tiếp không tranh VRAM; vẫn gọi TUẦN TỰ (không Promise.all)
 * để không dội DB và để hiện tiến độ "{{done}}/{{total}}" trung thực.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { partitionBatch, toBatchItem, runCancellableBatchSubmit, type BatchSuggestItem, type SubmitOutcome } from "./batchSuggestLogic";
import type { RouterOutputs } from "./types";

type PointRecommendation = RouterOutputs["aiThresholdAdvisor"]["recommendForPoint"];

interface BatchSuggestDialogProps {
  open: boolean;
  pointDefIds: number[];
  onClose: () => void;
}

const DEFAULT_MIN_SAMPLES = 300; // tài liệu hoá ở aiThresholdAdvisor.ts:37-40 (AI_THRESHOLD_ADVISOR_MIN_SAMPLES)

function fmtNum(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : String(v);
}

function fmtTriple(lsl: number | null | undefined, usl: number | null | undefined, nominal: number | null | undefined, unit?: string | null): string {
  const u = unit ? ` ${unit}` : "";
  return `LSL ${fmtNum(lsl)}${u} · USL ${fmtNum(usl)}${u} · ${fmtNum(nominal)}${u}`;
}

export function BatchSuggestDialog({ open, pointDefIds, onClose }: BatchSuggestDialogProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const requestMutation = trpc.thresholdApproval.request.useMutation();

  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState({ done: 0, total: 0 });
  const [recByPoint, setRecByPoint] = useState<Map<number, PointRecommendation>>(new Map());
  const [errorByPoint, setErrorByPoint] = useState<Map<number, string>>(new Map());
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState({ done: 0, total: 0 });
  const [submitResults, setSubmitResults] = useState<SubmitOutcome[] | null>(null);

  // Vòng sửa 1 (review Task 3, Important #1) — cờ huỷ cho PHA GỬI, cùng khuôn
  // với cờ `cancelled` cục bộ mà pha fetch đã có (không phát minh khuôn khác).
  // Bật `true` khi: (a) dialog đóng lại (open→false) trong lúc đang gửi — dù
  // Escape/click-outside/nút X đã bị chặn khi submitting (xem DialogContent
  // bên dưới), ref này vẫn là lưới an toàn cuối; (b) component unmount THẬT
  // (điều hướng khỏi trang) — (a) không cứu được trường hợp này.
  const cancelSubmitRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelSubmitRef.current = true; // unmount thật ⇒ huỷ mọi handleSubmit đang chạy dở
    };
  }, []);

  // Nạp đề xuất khi mở — TUẦN TỰ (xem chú thích đầu file: thống kê thuần,
  // không cần hàng đợi, nhưng vẫn tuần tự để không dội DB + để tiến độ có ý
  // nghĩa). Đóng dialog ⇒ dọn sạch để lần mở sau không hiện lại kết quả cũ.
  useEffect(() => {
    if (!open) {
      cancelSubmitRef.current = true; // dialog đóng ⇒ huỷ handleSubmit đang chạy dở (nếu có)
      setFetching(false);
      setFetchProgress({ done: 0, total: 0 });
      setRecByPoint(new Map());
      setErrorByPoint(new Map());
      setCheckedIds(new Set());
      setSubmitting(false);
      setSubmitProgress({ done: 0, total: 0 });
      setSubmitResults(null);
      return;
    }
    cancelSubmitRef.current = false; // phiên mở mới ⇒ chưa huỷ gì cả
    if (pointDefIds.length === 0) return;

    let cancelled = false;
    setFetching(true);
    setFetchProgress({ done: 0, total: pointDefIds.length });
    setRecByPoint(new Map());
    setErrorByPoint(new Map());
    setCheckedIds(new Set());
    setSubmitResults(null);

    void (async () => {
      const recs = new Map<number, PointRecommendation>();
      const errs = new Map<number, string>();
      for (let i = 0; i < pointDefIds.length; i++) {
        if (cancelled) return;
        const id = pointDefIds[i];
        try {
          const rec = await utils.aiThresholdAdvisor.recommendForPoint.fetch({ measurementPointId: id });
          recs.set(id, rec);
        } catch (err: any) {
          errs.set(id, err?.message || t("productModels.batchFetchError", "Không tính được đề xuất cho điểm này."));
        }
        if (cancelled) return;
        setFetchProgress({ done: i + 1, total: pointDefIds.length });
      }
      if (cancelled) return;
      setRecByPoint(recs);
      setErrorByPoint(errs);
      // Mặc định tích sẵn TẤT CẢ điểm "gửi được" (task-3-brief.md Step 5).
      const readyIds = new Set<number>();
      for (const id of pointDefIds) {
        const item = toBatchItem(id, recs.get(id) ?? null, errs.get(id));
        if (item.ok) readyIds.add(id);
      }
      setCheckedIds(readyIds);
      setFetching(false);
    })();

    return () => {
      cancelled = true;
    };
    // pointDefIds cố tình KHÔNG nằm trong deps — snapshot tại thời điểm mở
    // (cha không đổi selectedPointIds trong lúc dialog đang mở).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const batchItems: BatchSuggestItem[] = useMemo(
    () => pointDefIds.map((id) => toBatchItem(id, recByPoint.get(id) ?? null, errorByPoint.get(id))),
    [pointDefIds, recByPoint, errorByPoint],
  );
  const partition = useMemo(() => partitionBatch(batchItems), [batchItems]);

  const toggleChecked = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pointLabel = (id: number): string => {
    const rec = recByPoint.get(id);
    return rec?.code || rec?.name || `MP-${id}`;
  };

  // Cùng khuôn với PointDetailsForm.refreshSuggestionState (Task 2) — badge
  // "N đề xuất AI" (countPendingByProduct) và danh sách đề xuất (list) PHẢI
  // làm mới cùng lúc để /products và /threshold-approvals không lệch trạng
  // thái sau khi gửi hàng loạt.
  const refreshSuggestionState = () => {
    void utils.thresholdApproval.countPendingByProduct.invalidate();
    void utils.thresholdApproval.list.invalidate();
  };

  const handleSubmit = async () => {
    const toSend = partition.ready.filter((it) => checkedIds.has(it.pointDefId));
    if (toSend.length === 0) return;

    cancelSubmitRef.current = false; // phiên gửi mới bắt đầu ⇒ chưa huỷ
    setSubmitting(true);
    setSubmitProgress({ done: 0, total: toSend.length });

    // Vòng sửa 1 (review Task 3, Important #1) — vòng gửi tách ra
    // `runCancellableBatchSubmit` (batchSuggestLogic.ts, test thuần tuý ở
    // batchSuggest.logic.unit.test.ts) để KHÔNG còn cảnh "kết quả lô cũ đè lên
    // phiên mới": nếu bị huỷ giữa chừng (đóng dialog / unmount do điều hướng),
    // `cancelled=true` và ta KHÔNG setSubmitResults/toast bên dưới. Các request
    // ĐÃ BAY ĐI trước khi huỷ vẫn được gửi thật (không thể/không nên "undo"
    // một bản ghi đã tạo trong DB) — chỉ phần HIỂN THỊ bị bỏ qua.
    const { cancelled, results } = await runCancellableBatchSubmit({
      items: toSend,
      getId: (it) => it.pointDefId,
      isCancelled: () => cancelSubmitRef.current,
      onProgress: (done, total) => setSubmitProgress({ done, total }),
      fallbackErrorMessage: t("productModels.batchSendItemError", "Gửi thất bại"),
      send: async (item) => {
        const rec = recByPoint.get(item.pointDefId);
        await requestMutation.mutateAsync({
          pointDefId: item.pointDefId,
          proposedLsl: item.proposedLsl!,
          proposedUsl: item.proposedUsl!,
          proposedNominal: item.proposedNominal,
          // Cùng hình dạng `suggestion` với AIThresholdSuggestButton.submitPoint
          // (đường đơn-điểm) — để PendingSuggestionCard đọc được cpk/basis/sampleSize
          // giống nhau bất kể đề xuất tới từ đường nào.
          suggestion: {
            source: "aiThresholdAdvisor",
            basis: rec?.basis,
            sampleSize: rec?.sampleSize,
            confidence: rec?.confidence,
            currentCpk: rec?.current?.cpk,
            proposedCpk: rec?.recommended?.projectedCpk,
            code: rec?.code,
            name: rec?.name,
            unit: rec?.unit,
            degraded: rec?.degraded === true,
            needsReview: rec?.needsReview === true,
            recommended: { lsl: item.proposedLsl, usl: item.proposedUsl, target: item.proposedNominal },
            batch: true,
          },
          comment: t("thresholdAdvisor.requestComment", "AI-suggested threshold — submitted for review"),
        });
      },
    });

    // Bất kể huỷ hay không: những request ĐÃ BAY ĐI có thể đã tạo bản ghi thật
    // trong DB — làm mới cache dùng chung LUÔN an toàn (không phải "hiển thị
    // kết quả", chỉ là invalidate; utils.invalidate không đụng React state của
    // component này nên gọi được cả sau khi unmount).
    refreshSuggestionState();

    if (cancelled) {
      // TRUNG THỰC — phiên này đã bị huỷ (dialog đóng / điều hướng khỏi trang
      // giữa chừng). KHÔNG setSubmitResults, KHÔNG toast, KHÔNG khẳng định bất
      // kỳ con số nào: `results` có thể chứa vài request đã gửi thành công thật,
      // nhưng phiên UI hiện tại không còn đại diện cho lô người dùng đang xem
      // (họ đã mở dialog khác/rời trang) — hiện số ở đây sẽ là "kết quả lô cũ
      // đè lên phiên mới", đúng lỗi mà review Task 3 phát hiện.
      return;
    }

    setSubmitResults(results);
    setSubmitting(false);

    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.length - successCount;
    if (failCount === 0) {
      toast.success(t("productModels.batchSendAllSuccess", "Đã gửi {{n}} đề xuất để chờ duyệt.", { n: successCount }));
    } else {
      // TRUNG THỰC — không báo "thành công" khi có dòng lỗi.
      toast.error(
        t("productModels.batchSendPartial", "Gửi {{success}}/{{total}} đề xuất — {{failed}} lỗi.", {
          success: successCount,
          total: results.length,
          failed: failCount,
        }),
      );
    }
  };

  const successCount = submitResults?.filter((r) => r.ok).length ?? 0;
  const failCount = (submitResults?.length ?? 0) - successCount;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-3xl"
        // Vòng sửa 1 (review Task 3, Important #1a) — trong lúc đang GỬI,
        // request đã bay đi có thể đã tạo bản ghi thật trong DB; đóng dialog
        // giữa chừng qua Escape/click-ra-ngoài/nút X thì KHÔNG hề dừng được
        // các request đó, chỉ khiến người dùng mất dấu tiến độ thật (đúng lỗi
        // review Task 3 phát hiện). Chặn cả ba đường đóng "ngầm" này khi
        // `submitting`; nút "Hủy" tường minh đã bị khoá sẵn (disabled={submitting}
        // ở DialogFooter bên dưới) nên không lặp lại ở đây.
        showCloseButton={!submitting}
        onEscapeKeyDown={(e) => { if (submitting) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (submitting) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t("productModels.batchSuggestTitle", "Đề xuất ngưỡng cho {{n}} điểm đã chọn", { n: pointDefIds.length })}
          </DialogTitle>
          <DialogDescription>
            {t(
              "productModels.batchSuggestDesc",
              "AI tính đề xuất ngưỡng bằng thống kê thuần cho từng điểm đã chọn — xem trước rồi mới gửi để chờ duyệt.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto py-1">
          {!fetching && pointDefIds.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("productModels.batchNoPointsSelected", "Chưa chọn điểm nào để đề xuất.")}
            </p>
          )}

          {fetching && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("productModels.batchSuggestLoading", "Đang tính đề xuất cho {{done}}/{{total}} điểm...", {
                done: fetchProgress.done,
                total: fetchProgress.total,
              })}
            </div>
          )}

          {!fetching && partition.ready.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                {t("productModels.batchReadyHeading", "Gửi được ({{n}})", { n: partition.ready.length })}
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>{t("productModels.batchColPoint", "Điểm đo")}</TableHead>
                      <TableHead>{t("thresholdApprovals.current", "Hiện tại")}</TableHead>
                      <TableHead>{t("thresholdApprovals.proposed", "Đề xuất")}</TableHead>
                      <TableHead className="text-right">{t("productModels.batchColSamples", "Số mẫu")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partition.ready.map((item) => {
                      const rec = recByPoint.get(item.pointDefId);
                      return (
                        <TableRow key={item.pointDefId}>
                          <TableCell>
                            <Checkbox
                              checked={checkedIds.has(item.pointDefId)}
                              onCheckedChange={() => toggleChecked(item.pointDefId)}
                              aria-label={pointLabel(item.pointDefId)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{pointLabel(item.pointDefId)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtTriple(rec?.current?.lsl, rec?.current?.usl, rec?.current?.target, rec?.unit)}
                          </TableCell>
                          <TableCell className="text-xs font-semibold">
                            {fmtTriple(item.proposedLsl, item.proposedUsl, item.proposedNominal, rec?.unit)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary" className="text-[10px]">
                              {t("thresholdAdvisor.samples", "{{n}} mẫu", { n: item.sampleCount })}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Vòng sửa 2 (review Task 3) — nhóm này chứa HAI loại khác bản chất:
              thiếu mẫu THẬT (degraded) và đủ mẫu nhưng đáng ngờ (needsReview,
              server chỉ đặt khi degraded===false — server/services/aiThresholdAdvisor.ts:72-75,409-418).
              Tiêu đề cũ "Chưa đủ dữ liệu" tự mâu thuẫn với một dòng needsReview
              hiện rõ ràng 900 mẫu ngay bên dưới. Đổi cả GIÁ TRỊ lẫn TÊN KHOÁ
              (batchInsufficientHeading → batchNeedsCautionHeading) vì tên khoá
              cũ tự mang nghĩa "insufficient" — dễ khiến người sau lại viết ra
              câu sai y hệt. Không đụng partitionBatch/phân loại/test. */}
          {!fetching && partition.insufficient.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                {t("productModels.batchNeedsCautionHeading", "Chưa nên đề xuất tự động ({{n}})", { n: partition.insufficient.length })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  "productModels.batchNeedsCautionHint",
                  "Gồm điểm chưa đủ số mẫu và điểm có đủ mẫu nhưng dữ liệu đáng ngờ — xem lý do từng dòng.",
                )}
              </p>
              <ul className="space-y-1.5 rounded-md border border-dashed bg-muted/20 p-2.5">
                {partition.insufficient.map((item) => (
                  <li key={item.pointDefId} className="flex flex-wrap items-start gap-2 text-xs">
                    <Badge variant="outline" className="shrink-0">{pointLabel(item.pointDefId)}</Badge>
                    <span className="text-muted-foreground">
                      {t("thresholdAdvisor.samples", "{{n}} mẫu", { n: item.sampleCount })}
                      {" — "}
                      {item.reason ||
                        t("productModels.insufficientSamples", "Chưa đủ mẫu để đề xuất — cần tối thiểu {{min}} mẫu.", {
                          min: DEFAULT_MIN_SAMPLES,
                        })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Vòng sửa 1 (review Task 3, Important #2) — lỗi HẠ TẦNG (mạng/tính
              toán/điểm không tìm thấy/trợ lý tắt) tách RIÊNG khỏi "Chưa đủ dữ
              liệu": một cái là "chờ thêm sản phẩm", cái kia là "hệ thống hỏng,
              thử lại đi" — hai việc-cần-làm khác nhau, không được gộp nhãn. */}
          {!fetching && partition.failed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400">
                <XCircle className="h-4 w-4" />
                {t("productModels.batchFailedGroup", "Không lấy được khuyến nghị ({{n}})", { n: partition.failed.length })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("productModels.batchFailedHint", "Có thể do lỗi mạng hoặc hệ thống — hãy đóng và mở lại hộp thoại để thử lại.")}
              </p>
              <ul className="space-y-1.5 rounded-md border border-dashed border-red-300 bg-red-50/40 p-2.5 dark:border-red-900 dark:bg-red-950/10">
                {partition.failed.map((item) => (
                  <li key={item.pointDefId} className="flex flex-wrap items-start gap-2 text-xs">
                    <Badge variant="outline" className="shrink-0 border-red-300 text-red-700 dark:border-red-800 dark:text-red-400">
                      {pointLabel(item.pointDefId)}
                    </Badge>
                    <span className="text-muted-foreground">
                      {item.reason || t("productModels.batchFetchError", "Không tính được đề xuất cho điểm này.")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {submitting && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("productModels.batchSendProgress", "Đang gửi {{done}}/{{total}}...", {
                done: submitProgress.done,
                total: submitProgress.total,
              })}
            </div>
          )}

          {submitResults && (
            <div
              className={cn(
                "space-y-2 rounded-md border p-3 text-sm",
                failCount > 0
                  ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                  : "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30",
              )}
            >
              <p className="flex items-center gap-1.5 font-medium">
                {failCount === 0 ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                )}
                {failCount === 0
                  ? t("productModels.batchSendAllSuccess", "Đã gửi {{n}} đề xuất để chờ duyệt.", { n: successCount })
                  : t("productModels.batchSendPartial", "Gửi {{success}}/{{total}} đề xuất — {{failed}} lỗi.", {
                      success: successCount,
                      total: submitResults.length,
                      failed: failCount,
                    })}
              </p>
              {failCount > 0 && (
                <ul className="space-y-1 pl-1 text-xs text-muted-foreground">
                  {submitResults.filter((r) => !r.ok).map((r) => (
                    <li key={r.pointDefId} className="flex items-start gap-1">
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                      <span>{pointLabel(r.pointDefId)}: {r.error}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {submitResults ? (
            <Button onClick={onClose}>{t("common.close", "Đóng")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                {t("common.cancel", "Hủy")}
              </Button>
              <Button
                onClick={() => { void handleSubmit(); }}
                disabled={fetching || submitting || checkedIds.size === 0}
                className="gap-1.5"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("productModels.batchSendButton", "Gửi {{n}} đề xuất", { n: checkedIds.size })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
