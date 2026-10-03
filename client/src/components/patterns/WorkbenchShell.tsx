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
 * sang % theo kích thước nhóm đo bằng ResizeObserver. Kích thước được NHỚ THEO NGƯỜI DÙNG, bằng PX (khoá
 * `layoutKit:<layoutId>:u<userId>:hpx|vpx` trong localStorage); không biết người dùng ⇒ không lưu.
 *
 * Dấu đo (xem `layoutMarkers.ts`): `data-layout-main` CHỈ bọc `main` — toolbar, mainHeader, panel
 * phụ và thanh trạng thái đều nằm ngoài. Panel phải là `<aside role="complementary">`, thêm
 * `data-layout-ai` khi là Copilot. Panel dưới gập bằng `collapse()` — nội dung KHÔNG unmount
 * (Review Focus 3: stream/worker đang chạy không bị huỷ).
 *
 * Dưới 1024 px (plan Global Constraint 10): chuyển sang TAB (Soạn thảo / trái / phải / dưới), mọi
 * tab `forceMount` + `hidden`; activity bar (`leftRail`) vẫn hiện cạnh vùng tab.
 * Fix round 1 (review I3): qua lại mốc 1024 px KHÔNG remount nội dung — mỗi slot render một lần
 * qua portal vào host DOM ổn định, hai layout chỉ đặt outlet (`slotPortal.tsx`).
 * Task 11b: nhóm panel chỉ MOUNT sau lần đo đầu của khung (`useElementBox` → `measured`). Trước đó
 * `defaultSize` là % dự phòng (bề rộng 0 ở lượt render đầu) và thư viện GIỮ % lúc mount ⇒ panel rộng hơn
 * giới hạn px; trạng thái gập (R-2-l) áp lại khi nhóm mount. Panel phụ giữ kích thước theo PX khi khung đổi cỡ
 * (rail trái thu gọn có transition 200 ms: 1336 → 1552 px): đích = px người dùng đã kéo (nhớ theo người dùng,
 * THẮNG) hoặc `defaultPx`.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { PanelBottom } from "lucide-react";
import type { ImperativePanelGroupHandle, ImperativePanelHandle } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { LAYOUT_AI, LAYOUT_MAIN } from "./layoutMarkers";
import { pxRangeToPct, useElementBox, useNarrowViewport, userLayoutKey, type PctRange } from "./layoutKitHooks";
import { SlotOutlet, slotPortal, useSlotHost } from "./slotPortal";

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
  /**
   * Trạng thái của LẦN ĐẦU (người dùng chưa từng tự gập/mở panel này). Ruling R-2-l: lựa chọn gập/mở
   * do NGƯỜI DÙNG tự làm (nút gập, kéo separator) được nhớ theo người dùng (`userLayoutKey(…,
   * "bottomCollapsed")`) và THẮNG mặc định này ở các lần sau; không biết người dùng ⇒ không lưu.
   */
  defaultCollapsed?: boolean;
  /**
   * Ý định mở panel do trang phát ra (chọn một dòng, deep-link, bấm badge…): mỗi lần giá trị ĐỔI ⇒
   * mở panel (màn rộng). Lần render đầu không tính. Mở theo ý định KHÔNG ghi đè lựa chọn đã nhớ.
   */
  openRequest?: number;
  /** Báo trạng thái gập hiện tại (để trang hiện badge/đếm NGOÀI panel khi gập). */
  onCollapsedChange?: (collapsed: boolean) => void;
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
  /** Đổi giá trị ⇒ ở màn hẹp chuyển sang tab panel trái (activity bar chọn một mục). */
  leftRevealToken?: number;
  /** Chiều cao vỏ; mặc định trừ top bar 56 px. */
  heightClass?: string;
  className?: string;
}

const FALLBACK_LEFT: PctRange = { minSize: 14, maxSize: 24, defaultSize: 18 };
const FALLBACK_RIGHT: PctRange = { minSize: 20, maxSize: 30, defaultSize: 24 };
const FALLBACK_BOTTOM: PctRange = { minSize: 18, maxSize: 40, defaultSize: 25 };

/** Task 11b — kích thước người dùng đã kéo: px (nguồn chính) + % (dùng khi chưa đo được khung, vd jsdom). */
interface StoredSize {
  px: number;
  pct: number;
}
interface StoredSizes {
  left?: StoredSize;
  right?: StoredSize;
  bottom?: StoredSize;
}
function readStoredSizes(key: string | null): StoredSizes | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as StoredSizes) : null;
  } catch {
    return null;
  }
}
function writeStoredSizes(key: string | null, patch: StoredSizes): void {
  if (!key || Object.keys(patch).length === 0) return;
  try {
    localStorage.setItem(key, JSON.stringify({ ...(readStoredSizes(key) ?? {}), ...patch }));
  } catch {
    /* bộ nhớ trình duyệt bị chặn ⇒ chỉ không nhớ */
  }
}
const isSize = (s: StoredSize | undefined): s is StoredSize =>
  s != null && Number.isFinite(s.px) && Number.isFinite(s.pct) && (s.px > 0 || s.pct > 0);
/** % đích của một panel phụ: px người dùng (đổi theo khung hiện tại) ⇒ % đã lưu (khung chưa đo) ⇒ mặc định px. */
function targetPct(s: StoredSize | undefined, range: PctRange, groupPx: number): number {
  if (!isSize(s)) return range.defaultSize;
  const pct = groupPx > 0 && s.px > 0 ? (s.px / groupPx) * 100 : s.pct;
  return Math.min(range.maxSize, Math.max(range.minSize, pct));
}

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
  leftRevealToken,
  heightClass = "h-[calc(100dvh-3.5rem)]",
  className,
}: WorkbenchShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();
  // Task 11b — MỘT phần tử đo cả hai chiều: khung chứa nhóm ngang (cao = cao nhóm dọc của cột giữa). Nhóm panel
  // chỉ mount khi đã đo (`measured`) ⇒ `defaultSize` là % suy từ px ngay lần mount đầu (thư viện giữ % lúc mount).
  const [groupRef, { width, height }, measured] = useElementBox();
  const groupReady = !narrow && measured;
  const leftRef = React.useRef<ImperativePanelHandle | null>(null);
  const bottomRef = React.useRef<ImperativePanelHandle | null>(null);
  const bottomId = React.useId();
  // R-2-l — gập/mở panel dưới: lựa chọn người dùng đã nhớ (theo người dùng) thắng `defaultCollapsed`.
  const bottomKey = userLayoutKey(layoutId, userId, "bottomCollapsed");
  const readStoredBottom = (key: string | null): boolean | null => {
    if (!key) return null;
    try {
      const v = localStorage.getItem(key);
      return v === "1" ? true : v === "0" ? false : null;
    } catch {
      return null;
    }
  };
  const [bottomCollapsed, setBottomCollapsedState] = React.useState<boolean>(
    () => readStoredBottom(bottomKey) ?? bottom?.defaultCollapsed ?? false,
  );
  // Trạng thái mà MÃ đã yêu cầu thư viện (collapse/expand) — callback trùng giá trị này là của mã, khác là
  // người dùng kéo separator. Trước khi đồng bộ lần đầu, callback của thư viện (mount) bị bỏ qua.
  const desiredBottomRef = React.useRef(bottomCollapsed);
  const bottomSyncedRef = React.useRef(false);
  const userTouchedBottomRef = React.useRef(false);
  const onBottomCollapsedChange = bottom?.onCollapsedChange;
  const setBottomCollapsed = React.useCallback(
    (c: boolean) => {
      setBottomCollapsedState(c);
      onBottomCollapsedChange?.(c);
    },
    [onBottomCollapsedChange],
  );
  // Lệnh tới panel dưới qua thư viện. Panel chưa đăng ký vào layout (lượt render đầu, hoặc bản "node" của
  // thư viện nơi layout effect rỗng) ⇒ thư viện ném "Panel size not found" — bỏ qua, trạng thái vẫn đúng.
  const bottomCmd = (c: boolean) => {
    const p = bottomRef.current;
    if (!p) return;
    try {
      if (c && !p.isCollapsed()) p.collapse();
      if (!c && p.isCollapsed()) p.expand();
    } catch {
      /* chưa có layout */
    }
  };
  const persistBottom = (c: boolean) => {
    userTouchedBottomRef.current = true;
    if (!bottomKey) return;
    try {
      localStorage.setItem(bottomKey, c ? "1" : "0");
    } catch {
      /* bộ nhớ trình duyệt bị chặn ⇒ chỉ không nhớ */
    }
  };
  const [narrowTab, setNarrowTab] = React.useState("main");

  // Một host DOM ổn định cho mỗi slot — nội dung không remount khi đổi layout (slotPortal.tsx).
  const hToolbar = useSlotHost("toolbar");
  const hRail = useSlotHost("leftRail");
  const hHeader = useSlotHost("mainHeader");
  const hMain = useSlotHost("main");
  const hLeft = useSlotHost("left");
  const hRight = useSlotHost("right");
  const hBottom = useSlotHost("bottom");
  const hStatus = useSlotHost("statusBar");

  // Panel trái/dưới: áp lại trạng thái gập mỗi khi cây rộng được dựng (lần đầu hoặc sau màn hẹp).
  React.useEffect(() => {
    if (!groupReady) return;
    const p = leftRef.current;
    if (!p || leftCollapsed === undefined) return;
    if (leftCollapsed && !p.isCollapsed()) p.collapse();
    if (!leftCollapsed && p.isCollapsed()) p.expand();
  }, [leftCollapsed, groupReady]);

  // Cây rộng vừa dựng ⇒ áp trạng thái hiện tại (đã tính lựa chọn đã nhớ) theo CẢ HAI chiều — không gập lại
  // một panel người dùng đã chọn mở.
  // Task 11b: "vừa dựng" = nhóm panel vừa mount sau lần đo đầu (groupReady), không phải lượt render đầu của cây rộng.
  React.useEffect(() => {
    if (!groupReady) return;
    desiredBottomRef.current = bottomCollapsed;
    bottomCmd(bottomCollapsed);
    bottomSyncedRef.current = true;
    onBottomCollapsedChange?.(bottomCollapsed);
    // chỉ khi nhóm panel vừa mount; nút gập / ý định mở tự gọi collapse/expand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupReady]);

  // Người dùng chưa biết lúc mount (auth đang tải) ⇒ khi biết, áp lựa chọn đã nhớ (nếu chưa tự thao tác).
  React.useEffect(() => {
    if (narrow || userTouchedBottomRef.current) return;
    const stored = readStoredBottom(bottomKey);
    if (stored == null || stored === desiredBottomRef.current) return;
    desiredBottomRef.current = stored;
    setBottomCollapsed(stored);
    bottomCmd(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomKey]);

  // ── Task 11b — kích thước theo PX (mặc định hoặc của người dùng), không theo % lúc mount ─────────────────
  /**
   * % của react-resizable-panels là TƯƠNG ĐỐI: khi khung đổi bề rộng sau lúc mount (rail trái thu gọn có transition
   * 200 ms khi vào màn workbench — đo thật 1336 → 1552 px; hay đổi cỡ cửa sổ) panel phụ phình theo. Nên WorkbenchShell
   * giữ kích thước panel phụ bằng PX: đích = px người dùng đã kéo (nhớ theo người dùng, THẮNG) hoặc `defaultPx`; mỗi
   * lần khung đổi cỡ, đích px được áp lại (setLayout). Không dùng `autoSaveId` của thư viện (nó lưu %, và % lưu ở
   * cỡ khung này bị kẹp sai ở cỡ khung khác). Khoá `userLayoutKey(…, "hpx"|"vpx")`; không biết người dùng ⇒ không lưu.
   */
  const lRange = left ? pxRangeToPct({ minPx: left.minPx ?? 240, maxPx: left.maxPx ?? 300, defaultPx: left.defaultPx ?? 260 }, width, FALLBACK_LEFT) : null;
  const rRange = right ? pxRangeToPct({ minPx: right.minPx ?? 320, maxPx: right.maxPx ?? 420, defaultPx: right.defaultPx ?? 380 }, width, FALLBACK_RIGHT) : null;
  const bRange = bottom ? pxRangeToPct({ minPx: bottom.minPx ?? 180, maxPx: bottom.maxPx ?? 320, defaultPx: bottom.defaultPx ?? 200 }, height, FALLBACK_BOTTOM) : null;
  const hStoreKey = userLayoutKey(layoutId, userId, "hpx");
  const vStoreKey = userLayoutKey(layoutId, userId, "vpx");
  const storedH = readStoredSizes(hStoreKey);
  const storedV = readStoredSizes(vStoreKey);
  const l = lRange ? { ...lRange, defaultSize: targetPct(storedH?.left, lRange, width) } : null;
  const r = rRange ? { ...rRange, defaultSize: targetPct(storedH?.right, rRange, width) } : null;
  const b = bRange ? { ...bRange, defaultSize: targetPct(storedV?.bottom, bRange, height) } : null;
  const hGroupRef = React.useRef<ImperativePanelGroupHandle | null>(null);
  const vGroupRef = React.useRef<ImperativePanelGroupHandle | null>(null);
  /** Đang áp đích px bằng mã (setLayout) — onLayout lúc đó KHÔNG phải người dùng. */
  const applyingRef = React.useRef(false);
  /** Người dùng đang kéo (onDragging) / vừa bấm phím trên separator của nhóm — chỉ lúc đó mới lưu. */
  const interactingRef = React.useRef({ h: false, v: false });
  const apply = (g: ImperativePanelGroupHandle | null, layoutPct: number[]) => {
    if (!g) return;
    applyingRef.current = true;
    try {
      g.setLayout(layoutPct);
    } catch {
      /* nhóm chưa đăng ký panel */
    } finally {
      applyingRef.current = false;
    }
  };
  // Khung đổi cỡ (kể cả transition của rail) ⇒ áp lại đích px. Panel trái đang gập ⇒ giữ 0; panel dưới đang gập
  // ⇒ không đụng nhóm dọc (R-2-l).
  React.useEffect(() => {
    if (!groupReady) return;
    if (width > 0 && (l || r)) {
      const leftNow = l ? (leftRef.current?.isCollapsed() ? 0 : l.defaultSize) : 0;
      const rightNow = r ? r.defaultSize : 0;
      apply(hGroupRef.current, [...(l ? [leftNow] : []), 100 - leftNow - rightNow, ...(r ? [rightNow] : [])]);
    }
    if (height > 0 && b && !desiredBottomRef.current) apply(vGroupRef.current, [100 - b.defaultSize, b.defaultSize]);
    // l/r/b suy từ width/height (+ bộ nhớ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupReady, width, height]);
  /** Bàn phím trên separator ⇒ lượt onLayout ngay sau là của người dùng (thư viện nghe keydown trên chính separator). */
  const markKeyInteraction = (e: React.KeyboardEvent) => {
    const h = (e.target as HTMLElement | null)?.closest?.("[data-panel-resize-handle-id]");
    if (!h) return;
    const dir = h.getAttribute("data-panel-group-direction") === "vertical" ? "v" : "h";
    interactingRef.current[dir] = true;
    setTimeout(() => {
      interactingRef.current[dir] = false;
    }, 0);
  };
  const onDragH = (d: boolean) => {
    interactingRef.current.h = d;
  };
  const onDragV = (d: boolean) => {
    interactingRef.current.v = d;
  };
  const sizeEntry = (pct: number, groupPx: number): StoredSize => ({ pct, px: groupPx > 0 ? Math.round((pct * groupPx) / 100) : 0 });
  const onHLayout = (layout: number[]) => {
    if (applyingRef.current || !interactingRef.current.h) return;
    const patch: StoredSizes = {};
    if (l && layout[0] > 0) patch.left = sizeEntry(layout[0], width);
    if (r && layout[layout.length - 1] > 0) patch.right = sizeEntry(layout[layout.length - 1], width);
    writeStoredSizes(hStoreKey, patch);
  };
  const onVLayout = (layout: number[]) => {
    if (applyingRef.current || !interactingRef.current.v) return;
    if (b && layout[1] > 0) writeStoredSizes(vStoreKey, { bottom: sizeEntry(layout[1], height) });
  };

  // Ý định mở panel do trang phát (bỏ lần render đầu) — không ghi nhớ.
  const lastOpenRequest = React.useRef(bottom?.openRequest);
  React.useEffect(() => {
    const req = bottom?.openRequest;
    if (req === lastOpenRequest.current) return;
    lastOpenRequest.current = req;
    if (narrow) return;
    desiredBottomRef.current = false;
    bottomCmd(false);
    setBottomCollapsed(false);
  }, [bottom?.openRequest, narrow, setBottomCollapsed]);

  // Màn hẹp: chọn mục trên activity bar ⇒ chuyển sang tab panel trái (bỏ lần render đầu).
  const lastReveal = React.useRef(leftRevealToken);
  React.useEffect(() => {
    if (leftRevealToken === lastReveal.current) return;
    lastReveal.current = leftRevealToken;
    if (narrow && left) setNarrowTab("left");
  }, [leftRevealToken, narrow, left]);

  const mainProps = { ...mainAria, [LAYOUT_MAIN]: mainName };
  const aiProps = right?.ai ? { [LAYOUT_AI]: "" } : {};
  const toolbarOutlet = toolbar != null && (
    <SlotOutlet host={hToolbar} data-workbench-toolbar="" style={{ height: 40 }} className="flex shrink-0 items-center gap-2 overflow-hidden border-b px-2" />
  );
  const statusBarOutlet = (bottomToggle: React.ReactNode) =>
    (statusBar != null || bottomToggle != null) && (
      <div
        data-workbench-statusbar=""
        aria-label={t("layoutKit.shell.statusBar", "Status bar")}
        style={{ height: 24 }}
        className="flex shrink-0 items-center gap-3 overflow-hidden border-t px-2 text-[11px] text-muted-foreground"
      >
        {bottomToggle}
        <SlotOutlet host={hStatus} />
      </div>
    );
  const mainOutlet = (
    <div className="flex h-full min-h-0 flex-col">
      {mainHeader != null && <SlotOutlet host={hHeader} className="shrink-0" />}
      <SlotOutlet host={hMain} {...mainProps} className="min-h-0 flex-1 overflow-auto" />
    </div>
  );

  let layout: React.ReactNode;
  if (narrow) {
    const tabs: Array<{ value: string; label: string; node: React.ReactNode }> = [
      { value: "main", label: mainLabel ?? t("layoutKit.shell.editor", "Editor"), node: mainOutlet },
    ];
    if (left) tabs.push({ value: "left", label: left.label, node: <SlotOutlet host={hLeft} className="block h-full overflow-auto" /> });
    if (right)
      tabs.push({
        value: "right",
        label: right.label,
        node: <SlotOutlet host={hRight} as="aside" aria-label={right.label} {...aiProps} className="block h-full overflow-auto" />,
      });
    if (bottom)
      tabs.push({
        value: "bottom",
        label: bottom.label,
        node: <SlotOutlet host={hBottom} as="section" aria-label={bottom.label} className="block h-full overflow-auto" />,
      });
    layout = (
      <div key="narrow" data-workbench="" data-narrow="" className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border bg-background", heightClass, className)}>
        {toolbarOutlet}
        <div className="flex min-h-0 flex-1">
          {leftRail != null && <SlotOutlet host={hRail} className="flex shrink-0" />}
          <Tabs value={narrowTab} onValueChange={setNarrowTab} className="min-h-0 min-w-0 flex-1 gap-0">
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
        </div>
        {statusBarOutlet(null)}
      </div>
    );
  } else {

    const toggleBottom = () => {
      if (!bottomRef.current) return;
      const next = !bottomCollapsed;
      desiredBottomRef.current = next;
      bottomCmd(next);
      setBottomCollapsed(next);
      persistBottom(next);
    };
    // Callback của thư viện: trùng trạng thái mã yêu cầu ⇒ của mã; khác ⇒ người dùng kéo/bàn phím ⇒ nhớ.
    const onBottomLib = (c: boolean) => {
      if (!bottomSyncedRef.current) return;
      if (c === desiredBottomRef.current) {
        setBottomCollapsed(c);
        return;
      }
      desiredBottomRef.current = c;
      setBottomCollapsed(c);
      persistBottom(c);
    };
    const bottomToggle = bottom ? (
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
    ) : null;

    layout = (
      <div key="wide" data-workbench="" className={cn("flex min-h-0 flex-col overflow-hidden rounded-md border bg-background", heightClass, className)}>
        {toolbarOutlet}
        <div className="flex min-h-0 flex-1">
          {leftRail != null && <SlotOutlet host={hRail} className="flex shrink-0" />}
          <div ref={groupRef} data-workbench-group="" className="min-w-0 flex-1" onKeyDownCapture={markKeyInteraction}>
            {groupReady && (
            <ResizablePanelGroup ref={hGroupRef} direction="horizontal" onLayout={onHLayout} className="h-full">
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
                    <SlotOutlet host={hLeft} data-workbench-left="" aria-label={left.label} role="region" className="h-full overflow-auto border-r" />
                  </ResizablePanel>
                  <ResizableHandle aria-label={t("layoutKit.shell.resizeLeft", "Resize the left panel")} onDragging={onDragH} />
                </>
              )}
              <ResizablePanel id="center" order={2} minSize={30} defaultSize={100 - (l?.defaultSize ?? 0) - (r?.defaultSize ?? 0)}>
                <div className="h-full">
                  <ResizablePanelGroup ref={vGroupRef} direction="vertical" onLayout={onVLayout} className="h-full">
                    <ResizablePanel id="main" order={1} minSize={30} defaultSize={bottom && b ? 100 - b.defaultSize : 100}>
                      {mainOutlet}
                    </ResizablePanel>
                    {bottom && b && (
                      <>
                        <ResizableHandle aria-label={t("layoutKit.shell.resizeBottom", "Resize the bottom panel")} onDragging={onDragV} />
                        <ResizablePanel
                          id="bottom"
                          order={2}
                          ref={bottomRef}
                          collapsible
                          collapsedSize={0}
                          minSize={b.minSize}
                          maxSize={b.maxSize}
                          defaultSize={b.defaultSize}
                          onCollapse={() => onBottomLib(true)}
                          onExpand={() => onBottomLib(false)}
                        >
                          <SlotOutlet
                            host={hBottom}
                            as="section"
                            id={bottomId}
                            data-workbench-bottom=""
                            aria-label={bottom.label}
                            className="h-full overflow-auto border-t"
                          />
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                </div>
              </ResizablePanel>
              {right && r && (
                <>
                  <ResizableHandle aria-label={t("layoutKit.shell.resizeRight", "Resize the right panel")} onDragging={onDragH} />
                  <ResizablePanel id="right" order={3} minSize={r.minSize} maxSize={r.maxSize} defaultSize={r.defaultSize}>
                    <SlotOutlet host={hRight} as="aside" aria-label={right.label} {...aiProps} className="h-full overflow-auto border-l" />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
            )}
          </div>
        </div>
        {statusBarOutlet(bottomToggle)}
      </div>
    );
  }

  return (
    <>
      {layout}
      {slotPortal(toolbar, hToolbar, "slot-toolbar")}
      {slotPortal(leftRail, hRail, "slot-rail")}
      {slotPortal(mainHeader, hHeader, "slot-header")}
      {slotPortal(main, hMain, "slot-main")}
      {slotPortal(left?.content, hLeft, "slot-left")}
      {slotPortal(right?.content, hRight, "slot-right")}
      {slotPortal(bottom?.content, hBottom, "slot-bottom")}
      {slotPortal(statusBar, hStatus, "slot-status")}
    </>
  );
}

export default WorkbenchShell;
