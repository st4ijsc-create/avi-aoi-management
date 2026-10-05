/**
 * Doc 81 Đợt 2 Task 2 — nhóm menu thanh bên theo chế độ + app, KHÔNG BAO GIỜ trống khi người dùng
 * có quyền vào ít nhất một mục.
 *
 * Đo được (FE1 §0, doc 81 §1.4): supervisor mặc định chế độ "Đơn giản"; ở app Kỹ thuật, bộ lọc Đơn
 * giản bỏ mọi mục kỹ thuật (không khai `tier:'simple'`) rồi `scopeGroupsToApp` bỏ nốt nhóm khác app ⇒
 * thanh bên 264 px TRỐNG dù supervisor có quyền vào các màn đó (và đang đứng trên một màn trong đó).
 *
 * Luật (FE1 khuyến nghị 6 — "menu rỗng thì tự chuyển nâng cao"): nếu Đơn giản cho ra danh sách rỗng
 * trong phạm vi hiện tại, dùng danh sách ĐẦY ĐỦ (nâng cao) của CÙNG phạm vi, lấy từ chính nguồn IA đã
 * lọc vai/quyền/giấy phép (`accessible`) — không mở thêm quyền nào — và báo `simpleFallback` để thanh
 * bên ghi chú. Chế độ Đơn giản còn mục ⇒ không đổi gì.
 */
import { filterLabsNavGroups, filterNavGroupsByMode, hasLabsContent, type NavGroup, type NavMode } from "./navigation";
import { scopeGroupsToApp } from "./apps";

export interface ResolveSidebarGroupsInput {
  /** Nhóm đã lọc vai/quyền/giấy phép (mọi thứ người dùng CÓ THỂ thấy). */
  accessible: NavGroup[];
  mode: NavMode;
  launcherOn: boolean;
  appId: string;
  /**
   * Doc 81 Đợt 3 Task 5 ([QĐ-3b]) — sở thích "Hiện Labs" của người dùng (`useShowLabs`). `false` ⇒ bỏ mục `labs: true` khỏi
   * `visible`/`sidebar` (cả nhánh rơi về danh sách đầy đủ). Không khai ⇒ `true` (giữ hành vi cũ cho nơi gọi không biết Labs).
   */
  showLabs?: boolean;
}

export interface ResolvedSidebarGroups {
  /** Nhóm đã lọc chế độ (KHÔNG thu theo app) — BottomNav dùng như cũ. */
  visible: NavGroup[];
  /** Nhóm vẽ trên thanh bên. */
  sidebar: NavGroup[];
  /** True khi Đơn giản trống và thanh bên đang hiện danh sách đầy đủ. */
  simpleFallback: boolean;
  /** Đợt 3 Task 5 — thanh bên (cùng chế độ + phạm vi app) CÓ mục Labs khi bật ⇒ mới hiện công tắc "Hiện Labs". */
  labsAvailable: boolean;
}

export function resolveSidebarGroups({ accessible, mode, launcherOn, appId, showLabs = true }: ResolveSidebarGroupsInput): ResolvedSidebarGroups {
  const scope = (g: NavGroup[]) => (launcherOn ? scopeGroupsToApp(g, appId) : g);
  const withLabs = resolveWithLabs(accessible, mode, scope);
  const labsAvailable = hasLabsContent(withLabs.sidebar);
  if (showLabs) return { ...withLabs, labsAvailable };
  return { ...resolveWithLabs(filterLabsNavGroups(accessible, false), mode, scope), labsAvailable };
}

function resolveWithLabs(
  accessible: NavGroup[],
  mode: NavMode,
  scope: (g: NavGroup[]) => NavGroup[],
): Omit<ResolvedSidebarGroups, "labsAvailable"> {
  const visible = filterNavGroupsByMode(accessible, mode);
  const sidebar = scope(visible);
  if (sidebar.length > 0 || mode === "advanced") return { visible, sidebar, simpleFallback: false };
  const full = scope(accessible);
  return { visible, sidebar: full, simpleFallback: full.length > 0 };
}
