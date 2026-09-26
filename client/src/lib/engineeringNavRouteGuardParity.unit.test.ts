/**
 * doc 80 Đợt 0 — Task 8 (RBAC-01, XC-02, F §2 bảng RBAC ma trận 3 lớp).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * `/ir-editor`, `/pou-studio`, `/fleet-orchestration` khai nav `machine_status`
 * (đọc — 4 user thật CHỈ có bit này: operator1, qatd_congnhan, qatd_khonggan,
 * qatd_giamdoc) nhưng `App.tsx` dựng `RouteGuard requirePermission="machine_control"`
 * cho chính ba route đó (`App.tsx:581,592,593` trước bản vá). Hậu quả đo được
 * (Phụ lục F, hàng RBAC-01): BỐN người dùng THẤY dòng menu (nav cho `machine_status`
 * qua) rồi bấm vào bị "Không có quyền truy cập" (route đòi `machine_control`) — đúng
 * lớp lỗi "một lối vào rồi từ chối" đã ghim ở nhiều nơi khác trong repo (Khối D).
 *
 * Quyết định (task-8-brief.md RBAC-01): các trang này có CHẾ ĐỘ CHỈ-XEM đã thiết
 * kế sẵn (nút ghi vẫn gate `machine_control` trong trang/server) ⇒ route phải
 * dùng `RouteGuard navHref="…"` (tự tra ĐÚNG quyền của mục nav — không thể lệch
 * vì cùng một nguồn `hasAccessToItem`), KHÔNG hạ nav xuống hay nâng route lên
 * bằng tay (hai chuỗi chép tay luôn có thể trôi lại).
 *
 * Test này KHÔNG chỉ ghim 3 route trên — nó quét TOÀN BỘ item của navGroup
 * "engineering" (14 mục) và đòi MỌI route tương ứng trong App.tsx hoặc (a) dùng
 * `navHref="<chính href đó>"`, hoặc (b) khai `requirePermission` giống hệt
 * `requiredPermission` của mục nav. Đây là "test tĩnh" mà task-8-brief.md yêu
 * cầu — quét MÃ NGUỒN của App.tsx bằng regex trên văn bản gốc (không import/
 * render App.tsx — 60+ trang lười tải sẽ kéo theo mọi provider/route khác),
 * đối chiếu với cấu hình `navGroups` đã import thật (không chép tay danh sách
 * href — item nào bị xoá/thêm ở navigation.tsx thì lưới này tự thấy).
 *
 * MUTATION: hoàn một trong ba dòng App.tsx về `requirePermission="machine_control"`
 * ⇒ đúng case `it.each` của href đó phải ĐỎ; các case khác vẫn XANH (lưới không
 * bắt nhầm hàng xóm).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { navGroups } from "./navigation";

const appSrc = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Trích nội dung thuộc tính của `<RouteGuard …>` đứng NGAY SAU `<Route path="href">`. */
function routeGuardPropsFor(href: string): string {
  const re = new RegExp(`<Route path="${escapeForRegex(href)}">[\\s\\S]{0,40}?<RouteGuard([^>]*)>`);
  const m = appSrc.match(re);
  if (!m) {
    throw new Error(
      `Không tìm thấy <Route path="${href}"><RouteGuard …> trong App.tsx — route bị xoá, đổi tên, hoặc không còn bọc RouteGuard.`,
    );
  }
  return m[1]!;
}

const engineeringGroup = navGroups.find((g) => g.id === "engineering");
if (!engineeringGroup) {
  throw new Error("navGroups thiếu group id='engineering' — cấu trúc nav đã đổi, cập nhật lại test này.");
}

describe("★★★ doc 80 Task 8 (RBAC-01) — App.tsx RouteGuard khớp quyền nav cho MỌI mục nhóm 'engineering'", () => {
  it.each(engineeringGroup.items.map((i) => [i.href, i.requiredPermission] as const))(
    "%s: RouteGuard dùng navHref=\"%s\" của CHÍNH route đó, hoặc requirePermission=\"%s\" khớp nav",
    (href, requiredPermission) => {
      const props = routeGuardPropsFor(href);
      const usesOwnNavHref = new RegExp(`navHref="${escapeForRegex(href)}"`).test(props);
      const requirePermMatch = props.match(/requirePermission="([^"]+)"/);
      const matchesPermission = requiredPermission != null && requirePermMatch?.[1] === requiredPermission;
      expect(
        usesOwnNavHref || matchesPermission,
        `RouteGuard của ${href} lệch nav (nav đòi "${requiredPermission}"): thấy <RouteGuard${props}>`,
      ).toBe(true);
    },
  );

  // ── Ba ca hỏng ĐÃ ĐO trước bản vá (F §2, XC-02) — ghim tường minh để phép
  //    đột biến hoàn nguyên ĐÚNG dòng này thì ĐÚNG ba ca sau đỏ, không ca nào khác. ──
  it("★ /ir-editor, /pou-studio, /fleet-orchestration — nav machine_status khớp route (KHÔNG còn machine_control)", () => {
    for (const href of ["/ir-editor", "/pou-studio", "/fleet-orchestration"]) {
      const props = routeGuardPropsFor(href);
      expect(props, `${href} vẫn còn requirePermission="machine_control" lệch nav`).not.toContain(
        'requirePermission="machine_control"',
      );
      expect(props, `${href} phải dùng navHref="${href}"`).toContain(`navHref="${href}"`);
    }
  });
});
