/**
 * doc 81 Đợt 2 Task 14 — Inspector phải có tab Copilot cho IR Editor / POU Studio (R-2-b: Copilot là panel TRONG
 * layout, không dock `position:fixed`). Cùng hợp đồng với inspector của IDE (Task 13):
 *
 *  - Tab của trang (vd Thuộc tính / Transpile, hay Transpile → ST / PLCopen XML) + tab "Copilot".
 *  - `open` của `ProgrammingCopilotContext` = tab Copilot đang chọn ⇒ nút AI top bar (ShellAiButton) mở/đóng nó;
 *    trạng thái nhớ ở `progCopilotDock.open` như trước (thiết bị đo dựng biến thể "mở Copilot" bằng khoá này).
 *  - Lõi `ProgrammingCopilotCore` mount ở lần mở đầu rồi GIỮ (stream đang chạy không bị huỷ khi chuyển sang tab khác
 *    — Review Focus 3); tab của trang chỉ vẽ nội dung khi được chọn (như Radix Tabs cũ — vd query transpile chỉ chạy
 *    khi tab đó mở).
 *  - Mở bằng nút AI (không phải bấm tab) ⇒ đưa focus vào panel Copilot; lần nạp trang (đã nhớ "mở") thì không.
 *  - ←/→/Home/End chuyển tab (mẫu WAI-ARIA tabs).
 * Trang đặt component này vào `inspector` của EngineeringShell và truyền `inspectorIsAi={open}` (data-layout-ai).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgrammingCopilotCore } from "@/components/programming/ProgrammingCopilotCore";
import { useProgrammingCopilot, type CopilotBinding } from "@/contexts/ProgrammingCopilotContext";

export interface CopilotInspectorTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
  /** Lớp của tabpanel (mặc định: cuộn dọc, đệm 3). */
  className?: string;
}

export interface CopilotInspectorProps {
  /** Tiền tố id DOM (tab = `${idPrefix}-${id}-tab`, panel = `${idPrefix}-${id}`). */
  idPrefix: string;
  /** Nhãn của tablist. */
  label: string;
  tabs: readonly CopilotInspectorTab[];
  /** Tab của trang đang chọn khi Copilot đóng. */
  activeTab: string;
  onTabChange: (id: string) => void;
  binding: CopilotBinding;
}

const COPILOT = "copilot";

export function CopilotInspector({ idPrefix, label, tabs, activeTab, onTabChange, binding }: CopilotInspectorProps): React.JSX.Element {
  const { t } = useTranslation();
  const { open, setOpen } = useProgrammingCopilot();
  const selected = open ? COPILOT : activeTab;
  const ids = [...tabs.map((x) => x.id), COPILOT];

  // Mount lõi ở lần mở đầu rồi giữ (stream sống qua đổi tab).
  const [mounted, setMounted] = React.useState(open);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const openedByTabRef = React.useRef(false);
  const wasOpenRef = React.useRef(open);
  React.useEffect(() => {
    if (open) setMounted(true);
    if (open && !wasOpenRef.current && !openedByTabRef.current) panelRef.current?.focus();
    openedByTabRef.current = false;
    wasOpenRef.current = open;
  }, [open]);

  const select = (id: string) => {
    const wantOpen = id === COPILOT;
    // Chỉ đánh dấu "do bấm tab" khi lượt bấm THỰC SỰ đổi trạng thái mở/đóng — nếu không, cờ sẽ treo và nuốt lần mở
    // bằng nút AI kế tiếp (không đưa focus vào panel).
    if (wantOpen !== open) {
      openedByTabRef.current = true;
      setOpen(wantOpen);
    }
    if (!wantOpen) onTabChange(id);
  };
  const tabId = (id: string) => `${idPrefix}-${id}-tab`;
  const panelId = (id: string) => `${idPrefix}-${id}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={label}
        className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b [scrollbar-width:none]"
        onKeyDown={(e) => {
          const focused = ids.findIndex((id) => tabId(id) === (e.target as HTMLElement).id);
          const idx = focused >= 0 ? focused : ids.indexOf(selected);
          let next: number | null = null;
          if (e.key === "ArrowRight") next = (idx + 1) % ids.length;
          else if (e.key === "ArrowLeft") next = (idx - 1 + ids.length) % ids.length;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = ids.length - 1;
          if (next == null) return;
          e.preventDefault();
          select(ids[next]);
          document.getElementById(tabId(ids[next]))?.focus();
        }}
      >
        {[...tabs.map((x) => ({ id: x.id, label: x.label, icon: x.icon })), { id: COPILOT, label: t("engineering.ws.copilotTab", "Copilot"), icon: <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> }].map((x) => {
          const isSel = x.id === selected;
          return (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={tabId(x.id)}
              aria-selected={isSel}
              aria-controls={panelId(x.id)}
              tabIndex={isSel ? 0 : -1}
              onClick={() => select(x.id)}
              className={cn(
                "flex shrink-0 items-center gap-1 border-r px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:h-3.5 [&_svg]:w-3.5",
                isSel ? "bg-background font-medium" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {x.icon}
              {x.label}
            </button>
          );
        })}
      </div>
      {tabs.map((x) => {
        const isSel = x.id === selected;
        return (
          <div
            key={x.id}
            role="tabpanel"
            id={panelId(x.id)}
            aria-labelledby={tabId(x.id)}
            hidden={!isSel}
            className={x.className ?? "min-h-0 flex-1 overflow-y-auto p-3"}
          >
            {isSel && x.content}
          </div>
        );
      })}
      <div
        role="tabpanel"
        id={panelId(COPILOT)}
        aria-labelledby={tabId(COPILOT)}
        aria-label={t("progCopilot.dock.title", "Trợ lý Lập trình")}
        hidden={!open}
        tabIndex={-1}
        ref={panelRef}
        className="min-h-0 flex-1 overflow-y-auto p-3 focus:outline-none"
      >
        {(open || mounted) && <ProgrammingCopilotCore binding={binding} />}
      </div>
    </div>
  );
}

export default CopilotInspector;
