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
import { markUiPrefDirty, UI_PREFS_APPLIED_EVENT } from "@/lib/uiPrefsSync";

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
  /** Task 13 — đổi giá trị ⇒ ở màn hẹp chuyển sang tab panel PHẢI (vd nút AI top bar mở Copilot trong layout). */
  rightRevealToken?: number;
  /**
   * doc 81 Đợt 3 Task 0 (D1) — panel phải đang được yêu cầu HIỆN (vd Copilot đang mở). Màn hẹp: vào màn hẹp, nạp ở màn
   * hẹp, hoặc giá trị đổi false → true ⇒ chọn tab phải (trước: tab giữ "Soạn thảo", Copilot bị giấu trong khi nút AI
   * vẫn báo mở). Màn rộng bỏ qua.
   */
  rightActive?: boolean;
  /**
   * doc 81 Đợt 3 Task 0 (D1) — màn hẹp: tab phải bị RỜI (người dùng bấm tab khác, hoặc mã chuyển tab) trong khi
   * `rightActive` ⇒ gọi một lần, để trang đóng Copilot — trạng thái nút AI khớp với thứ đang nhìn thấy (như màn rộng: chọn
   * tab khác trong inspector = đóng Copilot). Nội dung panel KHÔNG unmount (stream sống — Review Focus 3).
   */
  onRightActiveHidden?: () => void;
  /**
   * final wave M-8 — gập panel PHẢI từ ngoài (màn rộng): 0 px, nội dung VẪN mount (stream Copilot sống — Review Focus 3),
   * MAIN lấy chỗ; separator khoá khi gập. Màn hẹp (tab) bỏ qua. Không truyền ⇒ như cũ.
   */
  rightCollapsed?: boolean;
  /** Chiều cao vỏ; mặc định trừ top bar 56 px. */
  heightClass?: string;
  /** Sàn px của MAIN (mặc định WORKBENCH_MAIN_MIN_PX = 400) — panel phụ thu/gập trước khi MAIN bị ép dưới sàn. */
  mainMinPx?: number;
  className?: string;
}

const FALLBACK_LEFT: PctRange = { minSize: 14, maxSize: 24, defaultSize: 18 };
const FALLBACK_RIGHT: PctRange = { minSize: 20, maxSize: 30, defaultSize: 24 };
const FALLBACK_BOTTOM: PctRange = { minSize: 18, maxSize: 40, defaultSize: 25 };

/**
 * Task 11b fix round 1 — SÀN px của MAIN. 400 px: ở khung nhìn 1024 (cột workbench ≈ 976 px khi rail thu gọn 48 px)
 * cả explorer 240 + inspector 320 (tối thiểu lớn nhất của các trang đã khai: IDE) vẫn vừa (976 − 560 = 416 ≥ 400).
 * Trang có thể đổi qua prop `mainMinPx`.
 */
export const WORKBENCH_MAIN_MIN_PX = 400;
/** id separator (data-panel-resize-handle-id) — biết người dùng đang kéo panel NÀO. */
const HANDLE_LEFT = "wb-handle-left";
const HANDLE_RIGHT = "wb-handle-right";
const HANDLE_BOTTOM = "wb-handle-bottom";

export interface WorkbenchColumnSpec {
  minPx: number;
  maxPx: number;
  /** Đích: px người dùng đã kéo, hoặc defaultPx. */
  targetPx: number;
  /** Đang gập do người dùng (giữ 0). */
  collapsed?: boolean;
}
export interface WorkbenchColumnFit {
  leftPx: number;
  rightPx: number;
  /** Gập vì thiếu chỗ (tự mở lại khi khung đủ rộng). */
  leftForcedCollapsed: boolean;
  rightForcedCollapsed: boolean;
}

/**
 * Chia bề rộng nhóm cho explorer / MAIN / inspector theo px, giữ MAIN ≥ `mainMinPx`:
 *   1. mỗi panel phụ lấy đích của nó, kẹp trong [min, max];
 *   2. thiếu chỗ ⇒ thu inspector về min, rồi explorer về min;
 *   3. vẫn thiếu ⇒ GẬP inspector (explorer lấy lại đích, rồi thu về min nếu cần);
 *   4. vẫn thiếu ⇒ gập explorer. MAIN không bao giờ bị ép dưới sàn để giữ panel phụ.
 * doc 81 Đợt 5 H fix 1 (review M9) — `preferRight` (panel phải đang được yêu cầu hiện, vd Copilot mở): ở bước 3 gập EXPLORER
 * trước (inspector lấy lại đích, rồi thu về min nếu cần); vẫn thiếu ⇒ gập inspector.
 */
export function fitWorkbenchColumns(
  groupPx: number,
  mainMinPx: number,
  left: WorkbenchColumnSpec | null,
  right: WorkbenchColumnSpec | null,
  opts: { preferRight?: boolean } = {},
): WorkbenchColumnFit {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const want = (c: WorkbenchColumnSpec | null) => (c && !c.collapsed ? clamp(c.targetPx, c.minPx, Math.max(c.minPx, c.maxPx)) : 0);
  let L = want(left);
  let R = want(right);
  let leftForcedCollapsed = false;
  let rightForcedCollapsed = false;
  const deficit = () => L + R + mainMinPx - groupPx;
  const shrink = (side: "L" | "R") => {
    const d = deficit();
    if (d <= 0) return;
    if (side === "R" && right && R > 0) R -= Math.min(d, R - right.minPx);
    if (side === "L" && left && L > 0) L -= Math.min(d, L - left.minPx);
  };
  shrink("R");
  shrink("L");
  if (opts.preferRight && deficit() > 0 && L > 0 && R > 0) {
    L = 0;
    leftForcedCollapsed = true;
    R = want(right);
    shrink("R");
  }
  if (deficit() > 0 && R > 0) {
    R = 0;
    rightForcedCollapsed = true;
    leftForcedCollapsed = false; // explorer lấy lại chỗ (bước 4 quyết lại)
    L = want(left);
    shrink("L");
  }
  if (deficit() > 0 && L > 0) {
    L = 0;
    leftForcedCollapsed = true;
  }
  return { leftPx: L, rightPx: R, leftForcedCollapsed, rightForcedCollapsed };
}

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
    markUiPrefDirty(key); // doc 81 Đợt 4 Task D1 — theo tài khoản (gom + debounce: kéo separator bắn liên tục)
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
  rightRevealToken,
  rightActive = false,
  onRightActiveHidden,
  rightCollapsed = false,
  heightClass = "h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem))]",
  className,
  mainMinPx,
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
  // doc 81 Đợt 4 Task D1 — tăng khi giá trị SERVER của một khoá của shell này vừa được áp vào localStorage (đăng nhập ở máy
  // mới, `UI_PREFS_APPLIED_EVENT`) ⇒ đọc lại kho (kích thước + gập), như lúc mount.
  const [prefsVersion, setPrefsVersion] = React.useState(0);
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
      markUiPrefDirty(bottomKey);
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
  }, [bottomKey, prefsVersion]);

  // ── Task 11b — kích thước theo PX (mặc định hoặc của người dùng), không theo % lúc mount ─────────────────
  /**
   * % của react-resizable-panels là TƯƠNG ĐỐI: khi khung đổi bề rộng sau lúc mount (rail trái thu gọn có transition
   * 200 ms khi vào màn workbench — đo thật 1336 → 1552 px; hay đổi cỡ cửa sổ) panel phụ phình theo. Nên WorkbenchShell
   * giữ kích thước panel phụ bằng PX: đích = px người dùng đã kéo (phiên này ⇒ đã nhớ theo người dùng — THẮNG) hoặc
   * `defaultPx`; mỗi lần khung đổi cỡ, đích px được áp lại (setLayout, TRƯỚC khi vẽ). Không dùng `autoSaveId` của thư
   * viện (nó lưu %, và % lưu ở cỡ khung này bị kẹp sai ở cỡ khung khác). Khoá `userLayoutKey(…, "hpx"|"vpx")`; không
   * biết người dùng hoặc bộ nhớ bị chặn ⇒ không lưu, nhưng lựa chọn của phiên vẫn được giữ (ref).
   * Fix round 1: MAIN có sàn px (`mainMinPx`, mặc định WORKBENCH_MAIN_MIN_PX) — xem `fitWorkbenchColumns`.
   */
  const lRange = left ? pxRangeToPct({ minPx: left.minPx ?? 240, maxPx: left.maxPx ?? 300, defaultPx: left.defaultPx ?? 260 }, width, FALLBACK_LEFT) : null;
  const rRange = right ? pxRangeToPct({ minPx: right.minPx ?? 320, maxPx: right.maxPx ?? 420, defaultPx: right.defaultPx ?? 380 }, width, FALLBACK_RIGHT) : null;
  const bRange = bottom ? pxRangeToPct({ minPx: bottom.minPx ?? 180, maxPx: bottom.maxPx ?? 320, defaultPx: bottom.defaultPx ?? 200 }, height, FALLBACK_BOTTOM) : null;
  const hStoreKey = userLayoutKey(layoutId, userId, "hpx");
  const vStoreKey = userLayoutKey(layoutId, userId, "vpx");
  // Đọc bộ nhớ MỘT lần mỗi khi khoá đổi (không parse JSON mỗi lượt render); lượt kéo sau đó nằm trong `userSizesRef`.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- prefsVersion: kho vừa nhận giá trị server (D1)
  const storedH = React.useMemo(() => readStoredSizes(hStoreKey), [hStoreKey, prefsVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const storedV = React.useMemo(() => readStoredSizes(vStoreKey), [vStoreKey, prefsVersion]);
  const prefKeysRef = React.useRef<Array<string | null>>([]);
  prefKeysRef.current = [hStoreKey, vStoreKey, bottomKey];
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onApplied = (e: Event) => {
      const keys = (e as CustomEvent<string[]>).detail ?? [];
      if (prefKeysRef.current.some((k) => k != null && keys.includes(k))) setPrefsVersion((v) => v + 1);
    };
    window.addEventListener(UI_PREFS_APPLIED_EVENT, onApplied);
    return () => window.removeEventListener(UI_PREFS_APPLIED_EVENT, onApplied);
  }, []);
  /** Kích thước người dùng đã kéo TRONG PHIÊN — thắng bộ nhớ; vẫn giữ khi không lưu được (chưa biết user / bị chặn). */
  const userSizesRef = React.useRef<StoredSizes>({});
  const lastStoreKeyRef = React.useRef(hStoreKey);
  if (lastStoreKeyRef.current !== hStoreKey) {
    // Đổi sang NGƯỜI DÙNG KHÁC (khoá A → khoá B) ⇒ bỏ lựa chọn của phiên trước; null → khoá (auth vừa tải) ⇒ giữ.
    if (lastStoreKeyRef.current != null && hStoreKey != null) userSizesRef.current = {};
    lastStoreKeyRef.current = hStoreKey;
  }
  const pick = (side: keyof StoredSizes, stored: StoredSizes | null): StoredSize | undefined => {
    const u = userSizesRef.current[side];
    return isSize(u) ? u : stored?.[side];
  };
  const pxOf = (s: StoredSize | undefined, defPx: number) => (isSize(s) && s.px > 0 ? s.px : defPx);
  const mainFloorPx = mainMinPx ?? WORKBENCH_MAIN_MIN_PX;
  /** Panel trái gập do NGƯỜI DÙNG (prop activity bar, hoặc kéo gập) — khác gập do thiếu chỗ (`forcedRef`). */
  const forcedRef = React.useRef({ left: false, right: false });
  const leftUserCollapsed = (): boolean =>
    leftCollapsed === true || (leftCollapsed === undefined && Boolean(leftRef.current?.isCollapsed()) && !forcedRef.current.left);
  const fit =
    width > 0
      ? fitWorkbenchColumns(
          width,
          mainFloorPx,
          left ? { minPx: left.minPx ?? 240, maxPx: left.maxPx ?? 300, targetPx: pxOf(pick("left", storedH), left.defaultPx ?? 260), collapsed: leftUserCollapsed() } : null,
          right ? { minPx: right.minPx ?? 320, maxPx: right.maxPx ?? 420, targetPx: pxOf(pick("right", storedH), right.defaultPx ?? 380), collapsed: rightCollapsed } : null,
          { preferRight: rightActive },
        )
      : null;
  // Ghi lại SAU khi tính (lượt render sau dùng để phân biệt gập do người dùng / do thiếu chỗ). Cập nhật trong render
  // vì thư viện báo onCollapse ngay ở layout effect của chính nó (trước layout effect của shell) khi nhóm mount.
  if (fit) forcedRef.current = { left: fit.leftForcedCollapsed, right: fit.rightForcedCollapsed };
  const pctOf = (px: number) => (px / width) * 100;
  const l = lRange ? { ...lRange, defaultSize: fit ? pctOf(fit.leftPx) : targetPct(pick("left", storedH), lRange, 0) } : null;
  const r = rRange
    ? { ...rRange, minSize: fit?.rightForcedCollapsed || rightCollapsed ? 0 : rRange.minSize, defaultSize: fit ? pctOf(fit.rightPx) : targetPct(pick("right", storedH), rRange, 0) }
    : null;
  const b = bRange ? { ...bRange, defaultSize: targetPct(pick("bottom", storedV), bRange, height) } : null;
  // Sàn của MAIN (cột giữa) cho CẢ thao tác kéo của người dùng — trừ phần tối thiểu của panel phụ còn mở.
  const centerMinSize = fit
    ? Math.max(0, Math.min(pctOf(mainFloorPx), 100 - (l && !fit.leftForcedCollapsed ? l.minSize : 0) - (r && !fit.rightForcedCollapsed && !rightCollapsed ? r.minSize : 0)))
    : 30;
  const hGroupRef = React.useRef<ImperativePanelGroupHandle | null>(null);
  const vGroupRef = React.useRef<ImperativePanelGroupHandle | null>(null);
  /** Đang áp đích px bằng mã (setLayout) — onLayout / onCollapse lúc đó KHÔNG phải người dùng. */
  const applyingRef = React.useRef(false);
  /** Separator người dùng đang kéo / vừa bấm phím — CHỈ panel kề separator đó được lưu. */
  const interactingRef = React.useRef<{ h: "left" | "right" | null; v: boolean }>({ h: null, v: false });
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
  // Khung đổi cỡ (kể cả transition của rail) ⇒ áp lại đích px TRƯỚC khi vẽ (useLayoutEffect — không giật khung hình).
  // Panel trái gập do người dùng ⇒ giữ 0; panel dưới đang gập ⇒ không đụng nhóm dọc (R-2-l).
  React.useLayoutEffect(() => {
    if (!groupReady) return;
    if (fit && (l || r)) {
      const lp = l ? pctOf(fit.leftPx) : 0;
      const rp = r ? pctOf(fit.rightPx) : 0;
      apply(hGroupRef.current, [...(l ? [lp] : []), 100 - lp - rp, ...(r ? [rp] : [])]);
    }
    if (height > 0 && b && !desiredBottomRef.current) apply(vGroupRef.current, [100 - b.defaultSize, b.defaultSize]);
    // l/r/b/fit suy từ width/height/leftCollapsed (+ bộ nhớ)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupReady, width, height, leftCollapsed, rightCollapsed, prefsVersion]);
  /** Bàn phím trên separator ⇒ lượt onLayout ngay sau là của người dùng (thư viện nghe keydown trên chính separator). */
  const markKeyInteraction = (e: React.KeyboardEvent) => {
    const h = (e.target as HTMLElement | null)?.closest?.("[data-panel-resize-handle-id]");
    if (!h) return;
    const id = h.getAttribute("data-panel-resize-handle-id");
    if (id === HANDLE_BOTTOM) {
      interactingRef.current.v = true;
      setTimeout(() => {
        interactingRef.current.v = false;
      }, 0);
    } else if (id === HANDLE_LEFT || id === HANDLE_RIGHT) {
      const side = id === HANDLE_LEFT ? "left" : "right";
      interactingRef.current.h = side;
      setTimeout(() => {
        if (interactingRef.current.h === side) interactingRef.current.h = null;
      }, 0);
    }
  };
  const onDragLeft = (d: boolean) => {
    interactingRef.current.h = d ? "left" : null;
  };
  const onDragRight = (d: boolean) => {
    interactingRef.current.h = d ? "right" : null;
  };
  const onDragV = (d: boolean) => {
    interactingRef.current.v = d;
  };
  const sizeEntry = (pct: number, groupPx: number): StoredSize => ({ pct, px: groupPx > 0 ? Math.round((pct * groupPx) / 100) : 0 });
  const remember = (key: string | null, side: keyof StoredSizes, entry: StoredSize) => {
    userSizesRef.current = { ...userSizesRef.current, [side]: entry };
    writeStoredSizes(key, { [side]: entry });
  };
  const onHLayout = (layout: number[]) => {
    const side = interactingRef.current.h;
    if (applyingRef.current || !side) return;
    const pct = side === "left" ? (l ? layout[0] : 0) : r ? layout[layout.length - 1] : 0;
    if (pct > 0) remember(hStoreKey, side, sizeEntry(pct, width));
  };
  const onVLayout = (layout: number[]) => {
    if (applyingRef.current || !interactingRef.current.v) return;
    if (b && layout[1] > 0) remember(vStoreKey, "bottom", sizeEntry(layout[1], height));
  };

  // Ý định mở panel do trang phát (bỏ lần render đầu) — không ghi nhớ.
  const lastOpenRequest = React.useRef(bottom?.openRequest);
  React.useEffect(() => {
    const req = bottom?.openRequest;
    if (req === lastOpenRequest.current) return;
    lastOpenRequest.current = req;
    // final wave (T5 minor) — màn hẹp (tab): ý định mở = chuyển sang tab panel dưới (trước: bị bỏ qua im lặng).
    if (narrow) {
      if (bottom) setNarrowTab("bottom");
      return;
    }
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
  const lastRightReveal = React.useRef(rightRevealToken);
  React.useEffect(() => {
    if (rightRevealToken === lastRightReveal.current) return;
    lastRightReveal.current = rightRevealToken;
    if (narrow && right) setNarrowTab("right");
  }, [rightRevealToken, narrow, right]);

  // doc 81 Đợt 3 Task 0 (D1) — vào màn hẹp / nạp ở màn hẹp / rightActive vừa bật ⇒ tab phải.
  const prevNarrowRef = React.useRef<boolean | null>(null);
  const prevRightActiveRef = React.useRef(rightActive);
  React.useEffect(() => {
    const enteredNarrow = narrow && prevNarrowRef.current !== true;
    const activated = rightActive && !prevRightActiveRef.current;
    prevNarrowRef.current = narrow;
    prevRightActiveRef.current = rightActive;
    if (narrow && right && rightActive && (enteredNarrow || activated)) setNarrowTab("right");
  }, [narrow, rightActive, right]);
  // …và RỜI tab phải ở màn hẹp khi rightActive (bấm tab khác hoặc mã chuyển tab) ⇒ báo trang (đóng Copilot).
  const prevNarrowTabRef = React.useRef(narrowTab);
  const rightActiveRef = React.useRef(rightActive);
  rightActiveRef.current = rightActive;
  const onRightActiveHiddenRef = React.useRef(onRightActiveHidden);
  onRightActiveHiddenRef.current = onRightActiveHidden;
  React.useEffect(() => {
    const prev = prevNarrowTabRef.current;
    prevNarrowTabRef.current = narrowTab;
    if (narrow && prev === "right" && narrowTab !== "right" && rightActiveRef.current) onRightActiveHiddenRef.current?.();
  }, [narrowTab, narrow]);

  // doc 81 Đợt 5 H fix 1 (review M9) — màn RỘNG: panel phải đang được yêu cầu hiện (`rightActive`) mà bị GẬP VÌ THIẾU CHỖ
  // (kể cả sau khi ưu tiên nó hơn explorer) ⇒ báo trang MỘT lần (đóng Copilot) — không để Copilot "mở" trên panel 0 px.
  const rightForcedNow = !narrow && Boolean(fit?.rightForcedCollapsed);
  const prevForcedActiveRef = React.useRef(false);
  React.useEffect(() => {
    const forcedActive = rightForcedNow && rightActive;
    const was = prevForcedActiveRef.current;
    prevForcedActiveRef.current = forcedActive;
    if (forcedActive && !was) onRightActiveHiddenRef.current?.();
  }, [rightForcedNow, rightActive]);

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
            {/* doc 81 Đợt 3 Task 0 (D3) — XUỐNG DÒNG thay vì tràn: ở 375/414 px tab thứ 4 nằm ngoài khung và bị cắt. */}
            <TabsList aria-label={t("layoutKit.shell.narrowLabel", "Workspace areas")} className="h-auto min-h-9 w-full flex-wrap justify-start rounded-none border-b">
              {tabs.map((x) => (
                <TabsTrigger key={x.value} value={x.value} className="h-8 min-h-8 flex-none text-xs">
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
          <div ref={groupRef} data-workbench-group="" data-group-px={width} className="min-w-0 flex-1" onKeyDownCapture={markKeyInteraction}>
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
                    onCollapse={() => {
                      // Gập vì thiếu chỗ (mã áp) KHÔNG phải người dùng gập explorer.
                      if (!applyingRef.current && !forcedRef.current.left) onLeftCollapsedChange?.(true);
                    }}
                    onExpand={() => {
                      if (!applyingRef.current) onLeftCollapsedChange?.(false);
                    }}
                  >
                    <SlotOutlet host={hLeft} data-workbench-left="" aria-label={left.label} role="region" className="h-full overflow-auto border-r" />
                  </ResizablePanel>
                  <ResizableHandle id={HANDLE_LEFT} aria-label={t("layoutKit.shell.resizeLeft", "Resize the left panel")} onDragging={onDragLeft} />
                </>
              )}
              <ResizablePanel id="center" order={2} minSize={centerMinSize} defaultSize={100 - (l?.defaultSize ?? 0) - (r?.defaultSize ?? 0)}>
                <div className="h-full">
                  <ResizablePanelGroup ref={vGroupRef} direction="vertical" onLayout={onVLayout} className="h-full">
                    <ResizablePanel id="main" order={1} minSize={30} defaultSize={bottom && b ? 100 - b.defaultSize : 100}>
                      {mainOutlet}
                    </ResizablePanel>
                    {bottom && b && (
                      <>
                        <ResizableHandle id={HANDLE_BOTTOM} aria-label={t("layoutKit.shell.resizeBottom", "Resize the bottom panel")} onDragging={onDragV} />
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
                  <ResizableHandle id={HANDLE_RIGHT} aria-label={t("layoutKit.shell.resizeRight", "Resize the right panel")} onDragging={onDragRight} disabled={rightCollapsed} />
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
