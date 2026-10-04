/**
 * Doc 81 Đợt 2 Task 2 — KHUNG của bong bóng chat AI (một lối vào AI mỗi ngữ cảnh).
 *
 * `AILocalChatBubble` giữ nguyên toàn bộ logic chat; component này chỉ quyết định CHỖ ĐẶT:
 *  · `headerEntry` (shell có nút AI trên top bar): KHÔNG có nút nổi `fixed bottom-6 right-6` (thiết bị đo
 *    Task 1 đo nó che MAIN 1 152 px² trên 9/14 màn). Chat mở thành SHEET PHẢI bắt đầu DƯỚI top bar
 *    (`top-14`, không đè top bar), không có lớp phủ, Esc đóng, bấm ra ngoài KHÔNG đóng (làm việc song
 *    song với trang). Khi đóng, focus trả về nút AI của top bar.
 *  · không có shell (trang tự dựng): giữ y nguyên khung nổi cũ (nút nổi + panel + thanh thu nhỏ).
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

export interface AiChatFrameProps {
  headerEntry: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nội dung panel chat (đầu + tin nhắn + ô nhập). */
  panel: React.ReactNode;
  /** Nút nổi cũ — chỉ dùng khi KHÔNG có shell. */
  fab: React.ReactNode;
  /** Thanh thu nhỏ cũ — chỉ dùng khi KHÔNG có shell. */
  minimizedBar: React.ReactNode;
  /** Chế độ cũ: panel đang hiện (mở và không thu nhỏ). */
  legacyPanelVisible?: boolean;
}

export function AiChatFrame({
  headerEntry,
  open,
  onOpenChange,
  panel,
  fab,
  minimizedBar,
  legacyPanelVisible = open,
}: AiChatFrameProps): React.JSX.Element | null {
  const { t } = useTranslation();

  if (headerEntry) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            data-ai-sheet=""
            aria-describedby={undefined}
            onInteractOutside={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => {
              const back = document.querySelector<HTMLElement>("[data-shell-ai]");
              if (back) {
                e.preventDefault();
                back.focus();
              }
            }}
            className="fixed bottom-0 right-0 top-14 z-40 flex w-[min(420px,100vw)] flex-col border-l bg-card shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
          >
            <DialogPrimitive.Title className="sr-only">{t("nav.aiAssistant", "Trợ lý AI")}</DialogPrimitive.Title>
            {panel}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {legacyPanelVisible && panel}
      {minimizedBar}
      {fab}
    </div>
  );
}

export default AiChatFrame;
