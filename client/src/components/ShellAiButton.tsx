/**
 * Doc 81 Đợt 2 Task 2 — nút AI DUY NHẤT trên top bar (một lối vào AI mỗi ngữ cảnh).
 *
 *  · Màn lập trình đã publish binding Copilot (IDE / IR / POU): nút mở/đóng tab Copilot của panel phải TRONG layout
 *    (R-2-b; dock cố định đã gỡ ở Task 14). Bong bóng chat không có lối vào thứ hai ở đó.
 *  · Màn khác: nút mở/đóng SHEET chat phải (bong bóng `AILocalChatBubble` đọc cùng store, Esc đóng).
 *    Cùng hai cổng của bong bóng: khách không mua `MOD_AI` (`isModuleBlocked`) và tuyến ẩn bong bóng
 *    (`anBongBongTrenTuyen`) ⇒ không có nút.
 * Khi mount, nút đăng ký với `aiEntryStore` ⇒ bong bóng bỏ nút nổi.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Bot, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProgrammingCopilot } from "@/contexts/ProgrammingCopilotContext";
import { useLicenseModules } from "@/hooks/useLicenseModules";
import { anBongBongTrenTuyen } from "@/lib/bongBongTheoTuyen";
import { registerAiHeaderEntry, setAiChatOpen, toggleAiChat, useAiEntry } from "@/lib/aiEntryStore";

export function ShellAiButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { binding, open: dockOpen, setOpen: setDockOpen } = useProgrammingCopilot();
  const { isModuleBlocked } = useLicenseModules();
  const { chatOpen } = useAiEntry();

  const copilotMode = binding != null;
  const chatAllowed = !isModuleBlocked("MOD_AI") && !anBongBongTrenTuyen(location);
  const visible = copilotMode || chatAllowed;

  useEffect(() => {
    if (!visible) return;
    return registerAiHeaderEntry();
  }, [visible]);

  // R-2-j — sheet chat và Copilot KHÔNG BAO GIỜ chồng nhau. Ở màn lập trình (có binding) Copilot là
  // lối vào AI: chat đang mở (vd mở ở /recipes rồi điều hướng sang IDE) ⇒ đóng chat và TRAO cho Copilot.
  useEffect(() => {
    if (copilotMode && chatOpen) {
      setAiChatOpen(false);
      if (!dockOpen) setDockOpen(true);
    }
  }, [copilotMode, chatOpen, dockOpen, setDockOpen]);

  if (!visible) return null;

  const label = copilotMode
    ? t("progCopilot.dock.open", "Mở Trợ lý Lập trình")
    : t("nav.aiAssistant", "Trợ lý AI");
  const expanded = copilotMode ? dockOpen : chatOpen;
  const diagCount = copilotMode ? binding?.diagnostics?.length ?? 0 : 0;

  return (
    <button
      type="button"
      data-shell-ai={copilotMode ? "copilot" : "chat"}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={() => (copilotMode ? setDockOpen(!dockOpen) : toggleAiChat())}
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
        "hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        expanded ? "bg-primary/10 text-primary" : "text-muted-foreground",
        className,
      )}
    >
      {copilotMode ? <Sparkles className="h-4 w-4" aria-hidden="true" /> : <Bot className="h-4 w-4" aria-hidden="true" />}
      {diagCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
        >
          {diagCount}
        </span>
      )}
    </button>
  );
}

export default ShellAiButton;
