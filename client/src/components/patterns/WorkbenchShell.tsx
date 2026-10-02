/**
 * Doc 81 Đợt 2 Task 3 — <WorkbenchShell>: vỏ workbench cao hết màn, không cuộn trang (doc 81 §1.3
 * P1 Workbench / P2 Canvas designer):
 *
 *   ┌ toolbar 40 ─────────────────────────────────────────────────────────┐
 *   │[rail]│ LEFT 240–300 │ mainHeader (tab editor 32)      │ RIGHT 320–420 │
 *   │      │              │ MAIN  (data-layout-main)          │ (inspector /  │
 *   │      │              ├───────────────────────────────────┤  Copilot)     │
 *   │      │              │ BOTTOM 180–320 (gập được)         │               │
 *   └ status bar 24 ──────────────────────────────────────────────────────┘
 *
 * Dựng trên `ui/resizable` (react-resizable-panels — cùng primitive với WorkspaceShell): mọi
 * separator kéo được bằng BÀN PHÍM (role=separator, phím mũi tên/Home/End). Ràng buộc px được đổi
 * sang % theo kích thước nhóm đo bằng ResizeObserver. Kích thước được NHỚ THEO NGƯỜI DÙNG (khoá
 * `layoutKit:<layoutId>:u<userId>:…` trong localStorage); không biết người dùng ⇒ không lưu.
 *
 * Dấu đo (xem `layoutMarkers.ts`): `data-layout-main` CHỈ bọc `main` — toolbar, mainHeader, panel
 * phụ và thanh trạng thái đều nằm ngoài. Panel phải là `<aside role="complementary">`, thêm
 * `data-layout-ai` khi là Copilot. Panel dưới gập bằng `collapse()` — nội dung KHÔNG unmount
 * (Review Focus 3: stream/worker đang chạy không bị huỷ).
 *
 * Dưới 1024 px (plan Global Constraint 10): chuyển sang TAB (Soạn thảo / trái / phải / dưới), mọi
 * tab `forceMount` + `hidden`. Giới hạn: đổi qua lại mốc 1024 px dựng lại cây (nội dung remount).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { PanelBottom } from "lucide-react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LAYOUT_AI, LAYOUT_MAIN } from "./layoutMarkers";
import { pxRangeToPct, useElementSize, useNarrowViewport, userLayoutKey, type PctRange } from "./layoutKitHooks";

export interface WorkbenchSidePanel {
  label: string;
  content: React.ReactNode;
  minPx?: number;
  maxPx?: number;
  defaultPx?: number;
}
export interface WorkbenchRightPanel extends WorkbenchSidePanel {
  /** Panel là bề mặt AI/Copilot ⇒ `data-layout-ai`. */
  ai?: boolean;
}
export interface WorkbenchBottomPanel extends WorkbenchSidePanel {
  defaultCollapsed?: boolean;
}

export interface WorkbenchShellProps {
  /** Định danh bố cục (vd "ide", "ir-editor") — một phần của khoá lưu kích thước. */
  layoutId: string;
  /** id người dùng đăng nhập; null ⇒ không lưu kích thước. */
  userId: number | string | null | undefined;
  /** Nội dung MAIN (editor/canvas). */
  main: React.ReactNode;
  /** Giá trị của `data-layout-main` (để đọc log đo). */
  mainName?: string;
  /** Nhãn tab MAIN ở chế độ hẹp; mặc định "Soạn thảo". */
  mainLabel?: string;
  /** Dải ngay trên MAIN, NGOÀI MAIN (vd tab editor 32 px). */
  mainHeader?: React.ReactNode;
  /** Thuộc tính ARIA thêm cho phần tử MAIN (vd role="tabpanel" + aria-labelledby của tab editor). */
  mainAria?: { role?: string; "aria-labelledby"?: string; "aria-label"?: string; id?: string };
  toolbar?: React.ReactNode;
  statusBar?: React.ReactNode;
  /** Cột cố định bên trái ngoài cùng (activity bar 40 px của EngineeringShell). */
  leftRail?: React.ReactNode;
  left?: WorkbenchSidePanel;
  right?: WorkbenchRightPanel;
  bottom?: WorkbenchBottomPanel;
  /** Điều khiển gập panel trái từ ngoài (activity bar). */
  leftCollapsed?: boolean;
  onLeftCollapsedChange?: (collapsed: boolean) => void;
  /** Chiều cao vỏ; mặc định trừ top bar 56 px. */
  heightClass?: string;
  className?: string;
}

const FALLBACK_LEFT: PctRange = { minSize: 14, maxSize: 24, defaultSize: 18 };
const FALLBACK_RIGHT: PctRange = { minSize: 20, maxSize: 30, defaultSize: 24 };
const FALLBACK_BOTTOM: PctRange = { minSize: 18, maxSize: 40, defaultSize: 25 };

export function WorkbenchShell({
  layoutId,
  userId,
  main,
  mainName = layoutId,
  mainLabel,
  mainHeader,
  mainAria,
  toolbar,
  statusBar,
  leftRail,
  left,
  right,
  bottom,
  leftCollapsed,
  onLeftCollapsedChange,
  heightClass = "h-[calc(100dvh-3.5rem)]",
  className,
}: WorkbenchShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();
  const hRef = React.useRef<HTMLDivElement | null>(null);
  const vRef = React.useRef<HTMLDivElement | null>(null);
  const width = useElementSize(hRef, "width");
  const height = useElementSize(vRef, "height");
  const leftRef = React.useRef<ImperativePanelHandle | null>(null);
  const bottomRef = React.useRef<ImperativePanelHandle | null>(null);
  const bottomId = React.useId();
  const [bottomCollapsed, setBottomCollapsed] = React.useState<boolean>(bottom?.defaultCollapsed ?? false);
  const [narrowTab, setNarrowTab] = React.useState("main");

  React.useEffect(() => {
    const p = leftRef.current;
    if (!p || leftCollapsed === undefined) return;
    if (leftCollapsed && !p.isCollapsed()) p.collapse();
    if (!leftCollapsed && p.isCollapsed()) p.expand();
  }, [leftCollapsed]);

  React.useEffect(() => {
    if (bottom?.defaultCollapsed) bottomRef.current?.collapse();
    // chỉ lúc mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mainProps = { ...mainAria, [LAYOUT_MAIN]: mainName };
  const aiProps = right?.ai ? { [LAYOUT_AI]: "" } : {};
  const toolbarNode = toolbar != null && (
    <div data-workbench-toolbar="" style={{ height: 40 }} className="flex shrink-0 items-center gap-2 overflow-hidden border-b px-2">
      {toolbar}
    </div>
  );

  if (narrow) {
    const tabs: Array<{ value: string; label: string; node: React.ReactNode }> = [
      {
        value: "main",
        label: mainLabel ?? t("layoutKit.shell.editor", "Editor"),
        node: (
          <div className="flex h-full min-h-0 flex-col">
            {mainHeader != null && <div className="shrink-0">{mainHeader}</div>}
            <div {...mainProps} className="min-h-0 flex-1 overflow-auto">
              {main}
            </div>
          </div>
        ),
      },
    ];
    if (left) tabs.push({ value: "left", label: left.label, node: <div className="h-full overflow-auto">{left.content}</div> });
    if (right)
      tabs.push({
        value: "right",
        label: right.label,
        node: (
          <aside aria-label={right.label} {...aiProps} className="h-full overflow-auto">
            {right.content}
          </aside>
        ),
      });
    if (bottom) tabs.push({ value: "bottom", label: bottom.label, node: <section aria-label={bottom.label} className="h-full overflow-auto">{bottom.content}</section> });
    return (
      <div data-workbench="" data-narrow="" className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border bg-background", heightClass, className)}>
        {toolbarNode}
        <Tabs value={narrowTab} onValueChange={setNarrowTab} className="min-h-0 flex-1 gap-0">
          <TabsList aria-label={t("layoutKit.shell.narrowLabel", "Workspace areas")} className="h-9 w-full justify-start rounded-none border-b">
            {tabs.map((x) => (
              <TabsTrigger key={x.value} value={x.value} className="min-h-8 flex-none text-xs">
                {x.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((x) => (
            <TabsContent key={x.value} value={x.value} forceMount hidden={narrowTab !== x.value} className="min-h-0">
              {x.node}
            </TabsContent>
          ))}
        </Tabs>
        {statusBar != null && (
          <div data-workbench-statusbar="" aria-label={t("layoutKit.shell.statusBar", "Status bar")} style={{ height: 24 }} className="flex shrink-0 items-center gap-3 overflow-hidden border-t px-2 text-[11px] text-muted-foreground">
            {statusBar}
          </div>
        )}
      </div>
    );
  }

  const l = left ? pxRangeToPct({ minPx: left.minPx ?? 240, maxPx: left.maxPx ?? 300, defaultPx: left.defaultPx ?? 260 }, width, FALLBACK_LEFT) : null;
  const r = right ? pxRangeToPct({ minPx: right.minPx ?? 320, maxPx: right.maxPx ?? 420, defaultPx: right.defaultPx ?? 380 }, width, FALLBACK_RIGHT) : null;
  const b = bottom ? pxRangeToPct({ minPx: bottom.minPx ?? 180, maxPx: bottom.maxPx ?? 320, defaultPx: bottom.defaultPx ?? 200 }, height, FALLBACK_BOTTOM) : null;
  const hKey = userLayoutKey(layoutId, userId, "h");
  const vKey = userLayoutKey(layoutId, userId, "v");

  const toggleBottom = () => {
    const p = bottomRef.current;
    if (!p) return;
    if (p.isCollapsed()) {
      p.expand();
      setBottomCollapsed(false);
    } else {
      p.collapse();
      setBottomCollapsed(true);
    }
  };

  return (
    <div data-workbench="" className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border bg-background", heightClass, className)}>
      {toolbarNode}
      <div className="flex min-h-0 flex-1">
        {leftRail}
        <div ref={hRef} className="min-w-0 flex-1">
          <ResizablePanelGroup direction="horizontal" autoSaveId={hKey} className="h-full">
            {left && l && (
              <>
                <ResizablePanel
                  id="left"
                  order={1}
                  ref={leftRef}
                  collapsible
                  collapsedSize={0}
                  minSize={l.minSize}
                  maxSize={l.maxSize}
                  defaultSize={l.defaultSize}
                  onCollapse={() => onLeftCollapsedChange?.(true)}
                  onExpand={() => onLeftCollapsedChange?.(false)}
                >
                  <div data-workbench-left="" aria-label={left.label} role="region" className="h-full overflow-auto border-r">
                    {left.content}
                  </div>
                </ResizablePanel>
                <ResizableHandle aria-label={t("layoutKit.shell.resizeLeft", "Resize the left panel")} />
              </>
            )}
            <ResizablePanel id="center" order={2} minSize={30}>
              <div ref={vRef} className="h-full">
                <ResizablePanelGroup direction="vertical" autoSaveId={vKey} className="h-full">
                  <ResizablePanel id="main" order={1} minSize={30}>
                    <div className="flex h-full min-h-0 flex-col">
                      {mainHeader != null && <div className="shrink-0">{mainHeader}</div>}
                      <div {...mainProps} className="min-h-0 flex-1 overflow-auto">
                        {main}
                      </div>
                    </div>
                  </ResizablePanel>
                  {bottom && b && (
                    <>
                      <ResizableHandle aria-label={t("layoutKit.shell.resizeBottom", "Resize the bottom panel")} />
                      <ResizablePanel
                        id="bottom"
                        order={2}
                        ref={bottomRef}
                        collapsible
                        collapsedSize={0}
                        minSize={b.minSize}
                        maxSize={b.maxSize}
                        defaultSize={b.defaultSize}
                        onCollapse={() => setBottomCollapsed(true)}
                        onExpand={() => setBottomCollapsed(false)}
                      >
                        <section id={bottomId} data-workbench-bottom="" aria-label={bottom.label} className="h-full overflow-auto border-t">
                          {bottom.content}
                        </section>
                      </ResizablePanel>
                    </>
                  )}
                </ResizablePanelGroup>
              </div>
            </ResizablePanel>
            {right && r && (
              <>
                <ResizableHandle aria-label={t("layoutKit.shell.resizeRight", "Resize the right panel")} />
                <ResizablePanel id="right" order={3} minSize={r.minSize} maxSize={r.maxSize} defaultSize={r.defaultSize}>
                  <aside aria-label={right.label} {...aiProps} className="h-full overflow-auto border-l">
                    {right.content}
                  </aside>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
      {(statusBar != null || bottom) && (
        <div
          data-workbench-statusbar=""
          aria-label={t("layoutKit.shell.statusBar", "Status bar")}
          style={{ height: 24 }}
          className="flex shrink-0 items-center gap-3 overflow-hidden border-t px-2 text-[11px] text-muted-foreground"
        >
          {bottom && (
            <button
              type="button"
              aria-expanded={!bottomCollapsed}
              aria-controls={bottomId}
              aria-label={t("layoutKit.shell.toggleBottom", "Toggle the bottom panel")}
              title={t("layoutKit.shell.toggleBottom", "Toggle the bottom panel")}
              onClick={toggleBottom}
              className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PanelBottom className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {statusBar}
        </div>
      )}
    </div>
  );
}

export default WorkbenchShell;
