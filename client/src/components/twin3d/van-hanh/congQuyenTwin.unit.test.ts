import { describe, it, expect } from "vitest";
import { hasAccessToItem, getNavItemByHref, getAcceptedPermissionsForHref } from "@/lib/navigation";

/**
 * ★★★ Đợt 5 CHẶN-1 — GHIM cổng quyền của `/twin`.
 *
 * Trước bản vá, ô `/twin` khai MỘT quyền `analytics_oee`. Đo trên seed thật:
 * trong 4 vai non-admin, chỉ `supervisor1` có `analytics_oee`; ba vai còn lại
 * (`engineer1`/`maint1`/`operator1`) có `machine_status` nhưng KHÔNG có
 * `analytics_oee` ⇒ 1/4 vào được màn Vận hành. Sau bản vá: 4/4.
 *
 * ⚠ Bộ quyền dưới đây là ẢNH CHỤP seed (users 48-51), KHÔNG phải mock tuỳ ý —
 * nếu seed đổi, test này đỏ và đó là tín hiệu đúng, không phải nhiễu.
 *
 * ⚠ Vì sao đo bằng vai non-admin: `hasAccessToItem` cho `role === 'admin'`
 * trả `true` VÔ ĐIỀU KIỆN (navigation.tsx:2443). Đo bằng admin chứng minh SỐ 0.
 */

/**
 * Ảnh chụp quyền thật của 4 tài khoản seed, CHIẾU xuống 4 module gác hai màn Twin
 * (`analytics_oee`, `machine_status`, `settings_factory`, `machine_control`).
 *
 * ★★★ ĐỢT 62 — ẢNH CHỤP CŨ SAI, và nó sai ở đúng chỗ đang được dùng để kết luận.
 *   Bản trước ghi `maint1: [machine_status]` và `engineer1: [machine_status]`.
 *   Đo lại bằng câu SQL trên `permissions` ngày 2026-09-13 (48/49/50/51):
 *     · supervisor1 CÒN có `machine_control`
 *     · maint1      CÒN có `machine_control`
 *     · engineer1   CÒN có `machine_control` **và** `settings_factory`
 *   Ba dòng ấy là toàn bộ phần trả lời cho câu "ai vào được `/twin-studio`" —
 *   với ảnh chụp cũ thì câu trả lời là "không ai", và mọi kết luận rút từ nó đều
 *   vô nghĩa. Lời khai trong lưới KHÔNG phải phép đo: phải đọc lại từ DB.
 */
const SEED_QUYEN: Record<string, { role: string; quyen: string[] }> = {
  operator1: { role: "operator", quyen: ["machine_status"] },
  supervisor1: { role: "supervisor", quyen: ["analytics_oee", "machine_status", "machine_control"] },
  maint1: { role: "maintenance", quyen: ["machine_status", "machine_control"] },
  engineer1: { role: "engineer", quyen: ["machine_status", "machine_control", "settings_factory"] },
};

function vaoDuoc(href: string, ten: string): boolean {
  const u = SEED_QUYEN[ten];
  return hasAccessToItem(href, u.role, ((m: string) => u.quyen.includes(m)) as never);
}

describe("CHẶN-1 — cổng quyền màn Vận hành `/twin`", () => {
  it("ô nav `/twin` khai cổng HOẶC trên đúng hai quyền vận hành", () => {
    const item = getNavItemByHref("/twin");
    expect(item).toBeDefined();
    // Ghim CHÍNH XÁC tập, không chỉ \"có requiredPermissionAny\": một tập rỗng
    // hay một tập chứa quyền khác vẫn làm test \"có khai\" xanh mà cổng sai.
    expect(item?.requiredPermissionAny).toEqual(["analytics_oee", "machine_status"]);
  });

  it("CẢ BỐN vai non-admin của seed vào được `/twin` (trước bản vá: 1/4)", () => {
    const vao = Object.keys(SEED_QUYEN).filter((ten) => vaoDuoc("/twin", ten));
    expect(vao.sort()).toEqual(["engineer1", "maint1", "operator1", "supervisor1"]);
  });

  it("ba vai CHỈ có `machine_status` vào được — đây là cái bản vá mở ra", () => {
    // Ba ô này là toàn bộ delta của bản vá. Nếu ai đó thu `/twin` về một quyền,
    // ba dòng này đỏ ngay, và đỏ RIÊNG từng vai chứ không gộp thành một số.
    expect(vaoDuoc("/twin", "engineer1")).toBe(true);
    expect(vaoDuoc("/twin", "maint1")).toBe(true);
    expect(vaoDuoc("/twin", "operator1")).toBe(true);
  });

  it("cổng vẫn CHẶN vai không có quyền nào trong tập — không phải mở toang", () => {
    // Đối chứng: nếu bản vá vô tình biến cổng thành \"ai cũng vào\", test 4/4 ở
    // trên vẫn xanh mà chẳng đo gì (lớp lỗi G5). Ô này bắt đúng ca đó.
    const khongQuyen = hasAccessToItem("/twin", "operator", (() => false) as never);
    expect(khongQuyen).toBe(false);
  });

  it("`analytics_oee` MỘT MÌNH vẫn đủ — bản vá mở thêm, không thay thế", () => {
    const chiOee = hasAccessToItem("/twin", "supervisor", ((m: string) => m === "analytics_oee") as never);
    expect(chiOee).toBe(true);
  });

  it("`getAcceptedPermissionsForHref` thấy CẢ HAI quyền của `/twin`", () => {
    // Hàm cũ `getRequiredPermissionForHref` chỉ đọc ô ĐƠN ⇒ với route quyền-HOẶC
    // nó trả `undefined`, tức "route không gán quyền" — sai một cách CÂM. Ghim
    // rằng `/twin` giờ nằm đúng phía hàm ĐỌC ĐƯỢC tập.
    expect(getAcceptedPermissionsForHref("/twin")).toEqual(["analytics_oee", "machine_status"]);
  });

  it("`/twin-studio` giữ nguyên cổng HOẶC của Đợt 3 — không bị bản vá này chạm", () => {
    const item = getNavItemByHref("/twin-studio");
    expect(item?.requiredPermissionAny).toEqual(["settings_factory", "machine_control"]);
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 62 mục A — AI VÀO ĐƯỢC `/twin-studio`, TRÊN SEED THẬT
 * ════════════════════════════════════════════════════════════════════════════
 * Đây là nửa "ĐÍCH" của bất biến *thấy ⇔ vào được*. Nửa "LỐI VÀO" nằm ở
 * `navigation.unit.test.ts` (cổng của ô/liên kết) và ở e2e
 * `e2e/dot62-cong-quyen-layout.spec.ts` (đo bằng trình duyệt, vai thật).
 *
 * ⚠ Giá trị của khối này là nó ĐỎ khi ai đó thu cổng `/twin-studio` về một
 *   quyền: lúc ấy 2/3 vai đang sửa được bố cục mất lối vào, và trước Đợt 62
 *   KHÔNG phép đo nào ở tầng unit thấy được điều đó.
 */
describe("Đợt 62 A — cổng `/twin-studio` trên 4 vai seed THẬT", () => {
  it("★★★ BA vai vào được: supervisor1 · maint1 · engineer1 (qua machine_control / settings_factory)", () => {
    expect(vaoDuoc("/twin-studio", "supervisor1")).toBe(true);
    expect(vaoDuoc("/twin-studio", "maint1")).toBe(true);
    expect(vaoDuoc("/twin-studio", "engineer1")).toBe(true);
  });

  it("★★★ `operator1` KHÔNG vào được — cổng vẫn CHẶN, bản vá không nới toang", () => {
    expect(vaoDuoc("/twin-studio", "operator1")).toBe(false);
  });

  it("`analytics_oee` MỘT MÌNH KHÔNG mở được `/twin-studio` — lý do ô Layout từng dead-end", () => {
    // Đây chính là ca đo được trên trình duyệt: vai chỉ có `analytics_oee` THẤY ô
    // (vì ô tra quyền của `/digital-twin`) rồi bị RouteGuard của `/twin-studio` từ chối.
    const chiOee = hasAccessToItem("/twin-studio", "supervisor", ((m: string) => m === "analytics_oee") as never);
    expect(chiOee).toBe(false);
  });

  it("★★★ tập chấp nhận của `/twin-studio` KHÁC tập của `/twin` — hai màn, hai cổng", () => {
    // Nếu ai đó gộp hai cổng làm một, ô Layout sẽ lại tra nhầm màn, lần thứ ba.
    expect(getAcceptedPermissionsForHref("/twin-studio")).toEqual(["settings_factory", "machine_control"]);
    expect(getAcceptedPermissionsForHref("/twin")).toEqual(["analytics_oee", "machine_status"]);
  });
});
