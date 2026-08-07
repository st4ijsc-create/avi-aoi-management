/**
 * doc69 Wave 0-C — nav-gating regression test for the `NavItem.requiredRole`
 * widening (`'admin' | 'user'` → `string | string[]`) in navigation.tsx.
 *
 * Proves:
 *  - The 6 engineer-work AI screens widened to `['admin', 'engineer']` admit the
 *    "engineer" role.
 *  - `/ai-monitoring` (deliberately NOT widened — system health/config) still
 *    rejects "engineer" — proves the widening is scoped, not a blanket loosening.
 *  - `/ai-datasets` (fix round 1 — reverted back to admin-only: the aiEval/MLOps
 *    surface is intentionally admin-governed; the engineer's training screen is
 *    /ai-training-studio instead) still rejects "engineer" — same scoping proof.
 *  - A representative still-`'admin'`-only item (single-string legacy shape)
 *    still rejects a non-admin role ("operator") — regression guard for the
 *    single-string code path through the new normalization.
 *  - Admin bypass is intact (admin passes every gated item regardless of
 *    `requiredRole`), including the still-admin-only `/ai-datasets`.
 */
import { describe, it, expect } from "vitest";
import {
  hasAccessToItem,
  getFilteredNavGroups,
  filterNavGroupsByMode,
  defaultNavModeForRole,
  type NavGroup,
} from "./navigation";

// Permission checker that always allows — isolates the test to the ROLE gate
// (isItemAccessible's requiredRole branch), not the separate permission gate.
const allowAllPerms = () => true;

const WIDENED_ENGINEER_SCREENS = [
  "/ai-brain",
  "/ai-command-center",
  "/ai-active-learning",
  "/anomaly-banks",
  "/mask-annotation",
  "/ai-training-studio",
];

describe("navigation.tsx — engineer AI nav widening (doc69 Wave 0-C)", () => {
  it.each(WIDENED_ENGINEER_SCREENS)("engineer can access widened screen %s", (href) => {
    expect(hasAccessToItem(href, "engineer", allowAllPerms)).toBe(true);
  });

  it("engineer is NOT admitted to /ai-monitoring (deliberately not widened)", () => {
    expect(hasAccessToItem("/ai-monitoring", "engineer", allowAllPerms)).toBe(false);
  });

  it("engineer is NOT admitted to /ai-datasets (fix round 1 — reverted to admin-only; MLOps surface is admin-governed, engineer training screen is /ai-training-studio)", () => {
    expect(hasAccessToItem("/ai-datasets", "engineer", allowAllPerms)).toBe(false);
  });

  it("a non-widened admin-only item still rejects a non-admin role (string-path regression)", () => {
    // /ai-models stays a single-string 'admin' requiredRole — unchanged by this task.
    expect(hasAccessToItem("/ai-models", "operator", allowAllPerms)).toBe(false);
  });

  it("admin bypass is intact for both widened and non-widened items", () => {
    expect(hasAccessToItem("/ai-brain", "admin", allowAllPerms)).toBe(true);
    expect(hasAccessToItem("/ai-monitoring", "admin", allowAllPerms)).toBe(true);
    expect(hasAccessToItem("/ai-models", "admin", allowAllPerms)).toBe(true);
    expect(hasAccessToItem("/ai-datasets", "admin", allowAllPerms)).toBe(true);
  });

  it("a role outside the widened set (e.g. operator) is still rejected by the widened items", () => {
    expect(hasAccessToItem("/ai-brain", "operator", allowAllPerms)).toBe(false);
    expect(hasAccessToItem("/ai-datasets", "operator", allowAllPerms)).toBe(false);
  });
});

/**
 * ★★★ Pha 5 Task 3 (N9) — **LỚP 1/5: `supervisor` PHẢI VÀO ĐƯỢC `/ai-brain`.**
 *
 * `/ai-brain` là nhà DUY NHẤT của `VramBrokerPanel`. Chủ dự án chốt `supervisor` được ra lệnh phá
 * huỷ VRAM (`ACTUATION_ROLES` — `server/_core/trpc.ts:495` — đã có nó). Bật nút cho một vai **không
 * mở được màn** là dựng một cái nút không ai bấm được, và tệ hơn: **khai rằng đã trao quyền** trong
 * khi chưa. `RouteGuard` (`components/RouteGuard.tsx:113`) gọi **đúng** `hasAccessToItem` cho
 * `navHref`, nên ca dưới đo cả nav LẪN cổng route.
 */
describe("Pha 5 N9 — nav `/ai-brain` mở cho supervisor (lớp 1 của năm lớp)", () => {
  it("★★★ supervisor VÀO ĐƯỢC /ai-brain (nếu không, bốn lớp còn lại là vô nghĩa)", () => {
    expect(hasAccessToItem("/ai-brain", "supervisor", allowAllPerms)).toBe(true);
  });

  it("★★ nới đúng MỘT màn: supervisor VẪN bị từ chối ở các màn agent-ops khác", () => {
    // ⚠ `supervisor` không có sàn `aiAgent.listAgentSessionsForOps` (admin|engineer). Mở nav ở đây
    // sẽ là đúng cùng lỗi "màn hứa nhiều hơn máy chủ", chỉ đổi bề mặt.
    expect(hasAccessToItem("/ai-command-center", "supervisor", allowAllPerms)).toBe(false);
    expect(hasAccessToItem("/ai-monitoring", "supervisor", allowAllPerms)).toBe(false);
    expect(hasAccessToItem("/ai-datasets", "supervisor", allowAllPerms)).toBe(false);
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * ★★★ I-1 (review Task 3) — **LỚP THỨ SÁU: VÀO ĐƯỢC ≠ THẤY ĐƯỜNG VÀO.**
   * ══════════════════════════════════════════════════════════════════════════════════════════
   * `hasAccessToItem` trả lời *"vai này có QUYỀN vào không"*. Nó **không** và **không thể** trả
   * lời *"thanh bên có HIỆN dòng ấy không"* — đó là một cổng thứ hai, hoàn toàn khác:
   * `defaultNavModeForRole('supervisor') === 'simple'` (supervisor không nằm trong
   * `ADVANCED_DEFAULT_ROLES`), group `ai` khai `tier:'advanced'`, và `filterNavGroupsByMode` ở
   * chế độ `simple` giữ **CHỈ** những item khai **TƯỜNG MINH** `tier:'simple'` bên trong một
   * group advanced. Đo được trước bản vá: **FALSE** — dòng menu **biến mất**.
   *
   * ⚠ Vì sao lớp này vô hình suốt: `engineer` mặc định `advanced` nên dòng ấy **luôn** hiện với
   * vai cũ. Cổng chỉ lộ khi thêm một vai **KHÔNG kỹ thuật** — tức đúng lúc N9 làm việc đó.
   * ⚠ Không có ca dưới đây thì lớp sáu sẽ **tái sinh y hệt lớp năm**: một cổng đúng, một quyết
   * định đã duyệt, và một người dùng không tìm thấy màn.
   */
  const allowAllCat = () => true;
  const coHref = (groups: NavGroup[], href: string): boolean =>
    groups.some((g) => g.items.some((i) => i.href === href));

  it("★★★ supervisor THẤY dòng /ai-brain ở chế độ MẶC ĐỊNH của chính vai đó (không phải chỉ 'có quyền')", () => {
    const mode = defaultNavModeForRole("supervisor");
    expect(mode, "supervisor mặc định Simple — đây là tiền đề của cả ca này").toBe("simple");
    const thay = getFilteredNavGroups("supervisor", allowAllPerms, allowAllCat);
    expect(coHref(thay, "/ai-brain"), "cầu chì: RBAC phải cho qua trước đã").toBe(true);
    expect(
      coHref(filterNavGroupsByMode(thay, mode), "/ai-brain"),
      "supervisor mở thanh bên ở chế độ mặc định mà KHÔNG thấy dòng /ai-brain ⇒ 'cấp quyền rồi mà không thấy màn đâu'",
    ).toBe(true);
  });

  it("★★ vá đúng MỘT dòng: các màn agent-ops khác VẪN bị Simple ẩn (không nới cả group)", () => {
    const simple = filterNavGroupsByMode(
      getFilteredNavGroups("admin", allowAllPerms, allowAllCat),
      "simple",
    );
    expect(coHref(simple, "/ai-brain"), "dòng vừa vá phải sống sót ở Simple").toBe(true);
    for (const href of ["/ai-command-center", "/ai-monitoring", "/ai-datasets"]) {
      expect(coHref(simple, href), `${href} KHÔNG được nới theo`).toBe(false);
    }
  });

  it("★★ chế độ Advanced không đổi gì — vai cũ (engineer) vẫn thấy đúng như trước", () => {
    const g = getFilteredNavGroups("engineer", allowAllPerms, allowAllCat);
    expect(defaultNavModeForRole("engineer")).toBe("advanced");
    expect(coHref(filterNavGroupsByMode(g, "advanced"), "/ai-brain")).toBe(true);
  });

  it("★★ chiều NGƯỢC — /ai-brain vẫn KHÔNG mở cho các vai ngoài bộ ba", () => {
    for (const role of ["operator", "viewer", "quality_inspector", "maintenance", "user"]) {
      expect(hasAccessToItem("/ai-brain", role, allowAllPerms), role).toBe(false);
    }
    // Không vai nào ⇒ không vào.
    expect(hasAccessToItem("/ai-brain", undefined, allowAllPerms)).toBe(false);
  });
});
