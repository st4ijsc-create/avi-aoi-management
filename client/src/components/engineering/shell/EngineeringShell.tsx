/**
 * Doc 81 Đợt 2 Task 3 — <EngineeringShell>: vỏ P1 Workbench cho EngineeringWorkspace (IDE), IrEditor,
 * PouStudio (FE2 §5; doc 81 §1.3):
 *
 *   activity bar 40 · explorer 240–300 · [tab editor 32] · inspector/Copilot 320–420 ·
 *   panel dưới 180–320 (gập được) · thanh trạng thái 24
 *
 * Lớp mỏng trên `WorkbenchShell` (panel co giãn bằng bàn phím, kích thước nhớ theo người dùng,
 * dưới 1024 px chuyển sang tab). Phần riêng ở đây:
 * - Activity bar: `role=toolbar` dọc, roving tabindex (↑/↓/Home/End), mục chọn `aria-pressed`;
 *   bấm lại mục đang chọn ⇒ gập/mở explorer (kiểu VS Code), `aria-expanded` báo trạng thái.
 * - Tab editor: `role=tablist`, ←/→/Home/End chuyển tab (gọi `onTabChange`), dấu ● "chưa lưu",
 *   nút đóng có nhãn riêng. MAIN là `role=tabpanel` của tab đang chọn.
 *
 * Dấu đo: `data-layout-main` CHỈ trên vùng editor; tab strip, activity bar, explorer, inspector
 * (Copilot ⇒ `inspectorIsAi` ⇒ `data-layout-ai`) và thanh trạng thái đều ngoài MAIN. Copilot là
 * panel trong layout đẩy editor — không còn dock `position:fixed` đè lên (Task 13).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkbenchShell } from "@/components/patterns/WorkbenchShell";

export interface ActivityItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
}

export interface EditorTab {
  id: string;
  label: string;
  dirty?: boolean;
  closable?: boolean;
}

export interface EngineeringShellProps {
  layoutId: string;
  userId: number | string | null | undefined;
  activityItems: readonly ActivityItem[];
  activeActivity: string;
  onActivityChange: (id: string) => void;
  explorer: React.ReactNode;
  explorerLabel?: string;
  editorTabs: readonly EditorTab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabClose?: (id: string) => void;
  /** Nội dung MAIN (editor / canvas của tab đang chọn). */
  editor: React.ReactNode;
  inspector?: React.ReactNode;
  inspectorLabel?: string;
  /** Inspector là Copilot/AI ⇒ data-layout-ai. */
  inspectorIsAi?: boolean;
  bottomPanel?: React.ReactNode;
  bottomLabel?: string;
  bottomDefaultCollapsed?: boolean;
  statusBar?: React.ReactNode;
  toolbar?: React.ReactNode;
  heightClass?: string;
  className?: string;
}

function ActivityBar({
  items,
  active,
  explorerOpen,
  onSelect,
}: {
  items: readonly ActivityItem[];
  active: string;
  explorerOpen: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeIdx = Math.max(0, items.findIndex((x) => x.id === active));
  const [focusIdx, setFocusIdx] = React.useState(activeIdx);
  const move = (to: number) => {
    const n = items.length;
    if (n === 0) return;
    const i = ((to % n) + n) % n;
    setFocusIdx(i);
    refs.current[i]?.focus();
  };
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("layoutKit.shell.activityBar", "Activity bar")}
      style={{ width: 40 }}
      className="flex shrink-0 flex-col items-center gap-1 border-r bg-muted/30 py-1"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") move(focusIdx + 1);
        else if (e.key === "ArrowUp") move(focusIdx - 1);
        else if (e.key === "Home") move(0);
        else if (e.key === "End") move(items.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {items.map((it, i) => {
        const isActive = it.id === active;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-label={it.label}
            title={it.label}
            aria-pressed={isActive}
            aria-expanded={isActive ? explorerOpen : undefined}
            tabIndex={i === focusIdx ? 0 : -1}
            onFocus={() => setFocusIdx(i)}
            onClick={() => onSelect(it.id)}
            className={cn(
              "relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4",
              isActive && explorerOpen && "bg-accent text-foreground",
            )}
          >
            {it.icon}
            {it.badge != null && <span className="absolute -right-0.5 -top-0.5 text-[9px]">{it.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

function EditorTabStrip({
  tabs,
  activeId,
  idPrefix,
  mainId,
  onChange,
  onClose,
}: {
  tabs: readonly EditorTab[];
  activeId: string;
  idPrefix: string;
  mainId: string;
  onChange: (id: string) => void;
  onClose?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const focusTab = (id: string) => {
    onChange(id);
    document.getElementById(`${idPrefix}-${id}`)?.focus();
  };
  const activeIdx = Math.max(0, tabs.findIndex((x) => x.id === activeId));
  return (
    <div
      role="tablist"
      aria-label={t("layoutKit.shell.editorTabs", "Editor tabs")}
      style={{ height: 32 }}
      className="flex items-stretch overflow-x-auto border-b bg-muted/20 [scrollbar-width:thin]"
      onKeyDown={(e) => {
        if (!(e.target instanceof HTMLElement) || e.target.getAttribute("role") !== "tab") return;
        // Tính từ tab ĐANG CÓ FOCUS (không phải tab đang chọn) — đúng mẫu WAI-ARIA tabs.
        const focused = tabs.findIndex((x) => `${idPrefix}-${x.id}` === (e.target as HTMLElement).id);
        const idx = focused >= 0 ? focused : activeIdx;
        let next: number | null = null;
        if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next == null) return;
        e.preventDefault();
        focusTab(tabs[next].id);
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <div key={tab.id} className={cn("group flex shrink-0 items-center border-r", selected ? "bg-background" : "text-muted-foreground")}>
            <button
              type="button"
              role="tab"
              id={`${idPrefix}-${tab.id}`}
              aria-selected={selected}
              aria-controls={mainId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className="flex h-full items-center gap-1 px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="max-w-[12rem] truncate">{tab.label}</span>
              {tab.dirty && (
                <span className="text-[10px] text-warning">
                  <span aria-hidden="true">●</span>
                  <span className="sr-only">{t("layoutKit.shell.unsavedTab", "unsaved")}</span>
                </span>
              )}
            </button>
            {tab.closable && onClose && (
              <button
                type="button"
                aria-label={t("layoutKit.shell.closeTab", "Close tab {{label}}", { label: tab.label })}
                title={t("layoutKit.shell.closeTab", "Close tab {{label}}", { label: tab.label })}
                onClick={() => onClose(tab.id)}
                className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded opacity-60 hover:bg-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EngineeringShell({
  layoutId,
  userId,
  activityItems,
  activeActivity,
  onActivityChange,
  explorer,
  explorerLabel,
  editorTabs,
  activeTabId,
  onTabChange,
  onTabClose,
  editor,
  inspector,
  inspectorLabel,
  inspectorIsAi = false,
  bottomPanel,
  bottomLabel,
  bottomDefaultCollapsed,
  statusBar,
  toolbar,
  heightClass,
  className,
}: EngineeringShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const idPrefix = React.useId();
  const mainId = `${idPrefix}-main`;
  const [explorerCollapsed, setExplorerCollapsed] = React.useState(false);
  /** Mỗi lần chọn mục ⇒ tăng; ở màn hẹp WorkbenchShell chuyển sang tab explorer. */
  const [revealToken, setRevealToken] = React.useState(0);

  const onSelectActivity = (id: string) => {
    setRevealToken((n) => n + 1);
    if (id === activeActivity) {
      setExplorerCollapsed((c) => !c);
      return;
    }
    setExplorerCollapsed(false);
    onActivityChange(id);
  };

  return (
    <WorkbenchShell
      layoutId={layoutId}
      userId={userId}
      className={className}
      heightClass={heightClass}
      toolbar={toolbar}
      statusBar={statusBar}
      leftRail={<ActivityBar items={activityItems} active={activeActivity} explorerOpen={!explorerCollapsed} onSelect={onSelectActivity} />}
      left={{ label: explorerLabel ?? t("layoutKit.shell.explorer", "Explorer"), content: explorer }}
      leftCollapsed={explorerCollapsed}
      leftRevealToken={revealToken}
      onLeftCollapsedChange={setExplorerCollapsed}
      mainName={`${layoutId}-editor`}
      mainHeader={
        editorTabs.length > 0 ? (
          <EditorTabStrip tabs={editorTabs} activeId={activeTabId} idPrefix={idPrefix} mainId={mainId} onChange={onTabChange} onClose={onTabClose} />
        ) : undefined
      }
      mainAria={
        editorTabs.length > 0
          ? { role: "tabpanel", id: mainId, "aria-labelledby": `${idPrefix}-${activeTabId}` }
          : { id: mainId }
      }
      main={editor}
      right={
        inspector != null
          ? { label: inspectorLabel ?? t("layoutKit.shell.inspector", "Inspector"), content: inspector, ai: inspectorIsAi }
          : undefined
      }
      bottom={
        bottomPanel != null
          ? { label: bottomLabel ?? t("layoutKit.shell.bottomPanel", "Bottom panel"), content: bottomPanel, defaultCollapsed: bottomDefaultCollapsed }
          : undefined
      }
    />
  );
}

export default EngineeringShell;
