/**
 * Doc 42 Đợt 1 (INFRA-1) — <ConfirmDeleteDialog>: xác nhận trước khi xoá/lưu trữ.
 *
 * Thay thế mọi nút thùng-rác 1-click (xoá tức thì, không thể hoàn tác) bằng một
 * bước xác nhận thống nhất. Dựng trên shadcn <AlertDialog>. Không tự toast —
 * caller lo thông báo qua toastTrpcError/toast.success.
 *
 * ── Dùng ───────────────────────────────────────────────────────────────────────
 *   <ConfirmDeleteDialog
 *     trigger={<Button variant="ghost" size="icon-sm"><Trash2 /></Button>}
 *     itemLabel={`vật liệu ${row.code}`}
 *     referenceCount={row.usedByCount}
 *     referenceLabel="phiếu nhập kho"
 *     onConfirm={async () => { await del.mutateAsync({ id: row.id }); }}
 *   />
 *
 * Soft-delete (lưu trữ, khôi phục được sau) → truyền `isSoftDelete`.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export interface ConfirmDeleteDialogProps {
  /** Nút mở dialog (thường là nút thùng rác). Bọc trong AlertDialogTrigger asChild. */
  trigger: React.ReactNode;
  /** Tên/mã bản ghi để chèn vào câu hỏi, ví dụ "vật liệu M-001" hoặc "line SMT-1". */
  itemLabel: string;
  /** Chạy khi user xác nhận. Dialog giữ loading tới khi resolve, đóng khi thành công. */
  onConfirm: () => Promise<void> | void;
  /** Số bản ghi khác đang tham chiếu — cảnh báo tham chiếu mồ côi khi > 0. */
  referenceCount?: number;
  /** Nhãn loại bản ghi tham chiếu, ví dụ "phiếu nhập kho". */
  referenceLabel?: string;
  /** true → câu chữ "Lưu trữ / khôi phục sau"; false (mặc định) → "Xoá vĩnh viễn". */
  isSoftDelete?: boolean;
  /** Nút xác nhận dùng style destructive. Mặc định true cho hard-delete, false cho soft. */
  destructive?: boolean;
  /** Tiêu đề tuỳ chỉnh (ghi đè mặc định). */
  title?: string;
  /** Mô tả tuỳ chỉnh (ghi đè mặc định). */
  description?: React.ReactNode;
  /** Nhãn nút xác nhận tuỳ chỉnh. */
  confirmLabel?: string;
  /** Nhãn nút huỷ. Mặc định "Huỷ". */
  cancelLabel?: string;
  disabled?: boolean;
}

export function ConfirmDeleteDialog({
  trigger,
  itemLabel,
  onConfirm,
  referenceCount,
  referenceLabel: referenceLabelProp,
  isSoftDelete = false,
  destructive,
  title,
  description,
  confirmLabel,
  cancelLabel: cancelLabelProp,
  disabled = false,
}: ConfirmDeleteDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  // Mặc định giải ở THÂN hàm — `t` chưa có trong phạm vi danh sách tham số.
  const referenceLabel = referenceLabelProp ?? t("confirmDelete.banGhiKhac", "bản ghi khác");
  const cancelLabel = cancelLabelProp ?? t("confirmDelete.huy", "Huỷ");
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const hasRefs = typeof referenceCount === "number" && referenceCount > 0;
  const isDestructive = destructive ?? !isSoftDelete;

  const resolvedTitle =
    title ?? (isSoftDelete ? t("confirmDelete.luuTruHoi", { item: itemLabel }) : t("confirmDelete.xoaHoi", { item: itemLabel }));
  const resolvedDescription =
    description ??
    (isSoftDelete
      ? t("confirmDeleteDialog.banCoTheKhoiPhuc", "Bạn có thể khôi phục lại sau.")
      : t("confirmDelete.khongHoanTac", "Hành động không thể hoàn tác."));
  const resolvedConfirmLabel =
    confirmLabel ?? (isSoftDelete ? t("confirmDeleteDialog.luuTru", "Lưu trữ") : t("confirmDeleteDialog.xoaVinhVien", "Xoá vĩnh viễn"));

  const handleConfirm = React.useCallback(async () => {
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // Giữ dialog mở khi lỗi; caller đã toast qua onError.
    } finally {
      setLoading(false);
    }
  }, [onConfirm]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Không cho đóng trong lúc đang xử lý.
        if (loading) return;
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild disabled={disabled}>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{resolvedTitle}</AlertDialogTitle>
          <AlertDialogDescription>{resolvedDescription}</AlertDialogDescription>
        </AlertDialogHeader>

        {hasRefs && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {itemLabel} đang được <strong>{referenceCount}</strong> {referenceLabel}{" "}
              tham chiếu — xoá có thể gây tham chiếu mồ côi.
            </span>
          </div>
        )}

        <AlertDialogFooter>
          {/* Không dùng AlertDialogCancel/Action để kiểm soát đóng thủ công (giữ dialog khi lỗi). */}
          <button
            type="button"
            disabled={loading}
            onClick={() => setOpen(false)}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleConfirm}
            className={cn(
              buttonVariants({ variant: isDestructive ? "destructive" : "default" }),
            )}
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {resolvedConfirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDeleteDialog;
