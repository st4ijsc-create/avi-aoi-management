/**
 * Doc 81 Đợt 2 Task 3 — hỏi "Bỏ thay đổi chưa lưu?" trước khi đóng một form còn dữ liệu.
 * Dùng chung cho FlyoutHost và WizardDialog. AlertDialog vì đây là xác nhận PHÁ HUỶ (mất dữ liệu)
 * — loại hộp thoại giữa màn duy nhất plan Đợt 2 giữ lại.
 */
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface UnsavedChangesConfirmProps {
  open: boolean;
  /** Người dùng chọn ở lại — form giữ nguyên dữ liệu. */
  onKeep: () => void;
  /** Người dùng chọn bỏ thay đổi — caller đóng form. */
  onDiscard: () => void;
}

export function UnsavedChangesConfirm({ open, onKeep, onDiscard }: UnsavedChangesConfirmProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onKeep(); }}>
      <AlertDialogContent data-unsaved-confirm="">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("layoutKit.flyout.unsavedTitle", "Discard unsaved changes?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("layoutKit.flyout.unsavedDesc", "This form has unsaved data. Closing it will lose those changes.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onKeep}>{t("layoutKit.flyout.keepEditing", "Keep editing")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDiscard}
          >
            {t("layoutKit.flyout.discard", "Discard changes")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default UnsavedChangesConfirm;
