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
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  hasAccessToItem,
  getFilteredNavGroups,
  filterNavGroupsByMode,
  defaultNavModeForRole,
  getNavItemByHref,
  getRequiredPermissionForHref,
  getAcceptedPermissionsForHref,
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
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 62 mục A — CỔNG QUYỀN CỦA LỐI VÀO "LAYOUT" = CỔNG CỦA **ĐÍCH THẬT**
 * ════════════════════════════════════════════════════════════════════════════
 * Lô 5 Mục 2 dựng `getRequiredPermissionForHref` để hai màn (`DataManagementHub`,
 * `DataSettings`) thôi chép tay chuỗi quyền cho ô/liên kết "Layout". Nó chữa được
 * *cách chép*, nhưng không chữa được *chép của ai*: cả hai hỏi quyền của
 * **`/digital-twin`** — một route từ Đợt 21 CHỈ CÒN LÀ REDIRECT. Đích thật (Đợt 61)
 * là `/twin-studio`, gate `settings_factory` **HOẶC** `machine_control`.
 *
 * Đo trên cổng 3062 bằng vai THẬT, trước bản vá (`.qa-dot62/A-TRUOC/`):
 *   · `analytics_oee` một mình   → THẤY ô, bấm vào **bị TỪ CHỐI**  (dead-end)
 *   · `machine_control` một mình → **KHÔNG thấy ô**, mà vào được   (lối vào bị giấu)
 *   · `engineer1` (SEED THẬT)    → **KHÔNG thấy** liên kết, mà vào được
 *
 * Ba điều ghim dưới đây, và mỗi điều bắt một cách hỏng KHÁC nhau:
 *  1. `/twin-studio` trả ĐÚNG TẬP HAI quyền — ai thu nó về một quyền sẽ đỏ.
 *  2. `getRequiredPermissionForHref("/twin-studio")` trả `undefined` — hàm
 *     một-quyền **không đọc nổi** route quyền-HOẶC. Ghim cái bẫy CÂM này để nơi
 *     gọi sau đừng dùng nhầm hàm rồi rơi về fallback đoán mò.
 *  3. Hai màn kia KHÔNG được nhắc tới `/digital-twin` nữa (quét NGUỒN, không
 *     quét hành vi): một bản vá đúng mà để lại lời gọi cũ ở màn thứ ba sẽ tái
 *     diễn y hệt, và không phép đo hành vi nào ở đây thấy được.
 */
describe("navigation.tsx — cổng quyền lối vào Layout (Đợt 62 mục A)", () => {
  it("★★★ `/twin-studio` (ĐÍCH THẬT) trả ĐÚNG tập hai quyền, không phải một", () => {
    expect(getAcceptedPermissionsForHref("/twin-studio")).toEqual([
      "settings_factory",
      "machine_control",
    ]);
  });

  it("★★★ BẪY CÂM: hàm một-quyền trả `undefined` cho `/twin-studio` (route quyền-HOẶC)", () => {
    expect(getRequiredPermissionForHref("/twin-studio")).toBeUndefined();
  });

  it("/layout (mục nav ĐÃ XOÁ ở Khối D Task 2) trả undefined — không suy ra quyền sai", () => {
    expect(getRequiredPermissionForHref("/layout")).toBeUndefined();
    expect(getAcceptedPermissionsForHref("/layout")).toEqual([]);
  });

  it("một href không tồn tại trong navGroups cũng trả undefined / tập rỗng", () => {
    expect(getRequiredPermissionForHref("/khong-ton-tai-lo5")).toBeUndefined();
    expect(getAcceptedPermissionsForHref("/khong-ton-tai-lo5")).toEqual([]);
  });

  it("★★★ hai màn quick-link KHÔNG còn tra quyền qua `/digital-twin` (quét nguồn)", () => {
    for (const tep of ["../pages/DataManagementHub.tsx", "../pages/DataSettings.tsx"]) {
      const nguon = readFileSync(new URL(tep, import.meta.url), "utf8");
      expect(nguon, `${tep} còn tra quyền của một route CHỈ LÀ REDIRECT`).not.toContain(
        'getRequiredPermissionForHref("/digital-twin")',
      );
      // và phải tra bằng hàm ĐỌC ĐƯỢC TẬP, không phải hàm một-quyền
      expect(nguon, `${tep} phải dùng getAcceptedPermissionsForHref`).toContain(
        'getAcceptedPermissionsForHref',
      );
      // ⚠ Không có fallback chuỗi cứng: nó chính là thứ biến "mục nav biến mất"
      //   thành "ô hiện cho tất cả" trong im lặng.
      expect(nguon, `${tep} còn fallback chuỗi quyền cứng`).not.toContain('?? "analytics_oee"');
    }
  });

  it("★★★ Đợt 62 C — ô nav `/digital-twin` ĐÃ XOÁ, và không ai còn tra quyền qua nó", () => {
    // Ô này là DÒNG MENU THỨ HAI trỏ vào một route chỉ-là-redirect. Đợt 21 giữ nó
    // vì hai màn quick-link tra quyền qua chính nó; mục A đã gỡ điều kiện chặn ấy.
    expect(getNavItemByHref("/digital-twin")).toBeUndefined();
    expect(getRequiredPermissionForHref("/digital-twin")).toBeUndefined();
    expect(getAcceptedPermissionsForHref("/digital-twin")).toEqual([]);
  });

  it("★★★ Đợt 62 C — xoá ô nav KHÔNG được kéo theo lối vào bằng URL", () => {
    // Cái bị bỏ là dòng menu trùng, KHÔNG phải bookmark cũ. Nếu ai đó "dọn nốt"
    // <Route path="/digital-twin"> thì 8 đường vào cũ của bảng dinhTuyenTwinCu
    // chết câm — ô này bắt đúng ca đó, ở tầng rẻ nhất.
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain('<Route path="/digital-twin">');
  });

  it("★★★ href của lối vào và href dùng tra quyền là MỘT HẰNG (không thể lệch)", () => {
    // Bất biến CẤU TRÚC, không phải bất biến giá trị: kể cả khi ai đó đổi đích,
    // hai bên vẫn đổi cùng lúc vì chúng là cùng một biến.
    const hub = readFileSync(new URL("../pages/DataManagementHub.tsx", import.meta.url), "utf8");
    expect(hub).toContain("const LAYOUT_TILE_PERMISSION_ANY = getAcceptedPermissionsForHref(LAYOUT_TILE_HREF);");
    expect(hub).toContain("href: LAYOUT_TILE_HREF");
    const ds = readFileSync(new URL("../pages/DataSettings.tsx", import.meta.url), "utf8");
    expect(ds).toContain("const layoutQuyenChapNhan = getAcceptedPermissionsForHref(LAYOUT_QUICKLINK_HREF);");
    expect(ds).toContain("href: LAYOUT_QUICKLINK_HREF");
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ★★★ Twin 3D Đợt 3 — CHẶN-1: quyền HOẶC ở tầng nav/guard (`/twin-studio`)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `server/routers/twinCanhRouter.ts:63` khai `requireAnyPermission([settings_factory,
 * machine_control])` theo §6.4. Mục nav `/twin-studio` TRƯỚC bản vá này khai MỘT
 * quyền `settings_factory`, và `App.tsx:326` dựng `RouteGuard navHref="/twin-studio"`
 * — guard tra CHÍNH mục nav đó. Hậu quả đo được: `supervisor1`/`maint1` (có
 * `machine_control`, KHÔNG có `settings_factory`) bị UI chặn khỏi đúng màn mà API
 * cho phép họ ghi.
 *
 * ★ Bộ test này đo bằng permission-checker HẸP (chỉ cấp đúng một quyền), KHÔNG
 *   phải `allowAllPerms`: `allowAllPerms` cho true với mọi chuỗi nên nó KHÔNG
 *   BAO GIỜ phân biệt được HOẶC với VÀ — nó sẽ xanh cả trước lẫn sau bản vá.
 *   Đây chính là lý do 5 test cũ ở đầu file mù với lớp lỗi này.
 *
 * ★ Vai dùng để đo KHÔNG được là "admin": `isItemAccessible` bypass admin ở dòng
 *   đầu, nên một phép đo bằng admin chứng minh SỐ 0 (bài học Khối D).
 *
 * ★ ABLATION — hoàn `requiredPermissionAny` về `requiredPermission:
 *   "settings_factory"` thì hai case `machine_control` dưới đây phải ĐỎ. Nếu
 *   chúng vẫn xanh thì thiết bị đo hỏng, không phải bản vá đúng.
 */
describe("★★★ Đợt 3 CHẶN-1 — /twin-studio nhận quyền HOẶC (§6.4), khớp requireAnyPermission của router", () => {
  /** Checker cấp ĐÚNG một quyền — phân biệt được HOẶC với VÀ. */
  function chiCo(...quyen: string[]) {
    return (module: string, _action?: string) => quyen.includes(module);
  }

  it("★ vai có machine_control (supervisor1/maint1) VÀO ĐƯỢC /twin-studio — ca hỏng đã đo", () => {
    expect(hasAccessToItem("/twin-studio", "supervisor", chiCo("machine_control"))).toBe(true);
    expect(hasAccessToItem("/twin-studio", "maintenance", chiCo("machine_control"))).toBe(true);
  });

  it("vai có settings_factory vẫn vào được — bản vá KHÔNG lấy mất nhánh cũ", () => {
    expect(hasAccessToItem("/twin-studio", "engineer", chiCo("settings_factory"))).toBe(true);
  });

  it("★ CHIỀU NGƯỢC — vai KHÔNG có quyền nào trong tập vẫn BỊ CHẶN (không nới bừa)", () => {
    expect(hasAccessToItem("/twin-studio", "operator", chiCo("history_view"))).toBe(false);
    expect(hasAccessToItem("/twin-studio", "viewer", chiCo())).toBe(false);
  });

  it("★ /twin (màn VẬN HÀNH) KHÔNG bị nới theo — vẫn chỉ analytics_oee", () => {
    // Hai màn hai quyền là chủ ý (§6.4). machine_control KHÔNG mở được màn vận hành.
    expect(hasAccessToItem("/twin", "supervisor", chiCo("machine_control"))).toBe(false);
    expect(hasAccessToItem("/twin", "supervisor", chiCo("analytics_oee"))).toBe(true);
  });

  it("★ tập quyền của nav KHỚP TỪNG PHẦN TỬ với quyenThietKe() của twinCanhRouter", () => {
    // Ghim hợp đồng hai bên. Router: requireAnyPermission([settings_factory, machine_control]).
    expect([...getAcceptedPermissionsForHref("/twin-studio")].sort()).toEqual(
      ["machine_control", "settings_factory"],
    );
  });

  it("getAcceptedPermissionsForHref vẫn đúng cho `/twin` và route không tồn tại", () => {
    /*
     * ════════════════════════════════════════════════════════════════════════
     * ★★★ ĐỢT 22 — KỲ VỌNG NÀY BỊ SỬA, VÀ **MÃ SẢN PHẨM THÌ KHÔNG**
     * ════════════════════════════════════════════════════════════════════════
     * Bản cũ ghim `["analytics_oee"]` với tiêu đề *"route MỘT quyền"*. Đó là
     * một **bánh cóc đã hết hạn**: Đợt 5 CHẶN-1 đã cố ý nới `/twin` sang
     * `requiredPermissionAny: ["analytics_oee", "machine_status"]`
     * (`navigation.tsx:475`), vì đo được rằng trong 4 vai non-admin của seed
     * chỉ `supervisor1` có `analytics_oee` — `engineer1`/`maint1`/`operator1`
     * đều CHỈ có `machine_status`, tức **3/4 vai vận hành bị chặn khỏi chính
     * màn Vận hành**, không lỗi nào nổ.
     *
     * ⇒ Ca này đỏ vì **nó đang đo một thế giới không còn tồn tại**, không phải
     *   vì mã hỏng. Đo được: nó đỏ **y hệt ở `HEAD`** (`17a3f4c6`), trước mọi
     *   thay đổi của Đợt 22 — tức nó KHÔNG phải hồi quy của đợt này.
     *
     * ★★★ VÀ ĐÂY LÀ CHỖ PHẢI CẨN THẬN: "sửa test cho xanh" là công thức chuẩn
     *   để giấu một lỗi thật. Nó hợp lệ ở đây vì có **đối chứng chiều ngược**
     *   ngay phía trên (`/twin` + `machine_control` ⇒ `false`) vẫn XANH: tập
     *   quyền được nới đúng MỘT phần tử có lý lẽ đo được, chứ không bị mở toang.
     *   Nếu ai đó nới `/twin` thêm nữa, ca ấy và ca này cùng đỏ.
     */
    expect([...getAcceptedPermissionsForHref("/twin")].sort()).toEqual([
      "analytics_oee",
      "machine_status",
    ]);
    expect(getAcceptedPermissionsForHref("/khong-ton-tai-dot3")).toEqual([]);
  });

  it("★ admin bypass — vào được, nhưng phép đo này chứng minh SỐ 0 về cổng quyền", () => {
    expect(hasAccessToItem("/twin-studio", "admin", chiCo())).toBe(true);
  });
});
