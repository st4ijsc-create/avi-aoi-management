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

/** Ảnh chụp quyền thật của 4 tài khoản seed (đo từ bảng `permissions`). */
const SEED_QUYEN: Record<string, { role: string; quyen: string[] }> = {
  operator1: { role: "operator", quyen: ["machine_status"] },
  supervisor1: { role: "supervisor", quyen: ["analytics_oee", "machine_status"] },
  maint1: { role: "maintenance", quyen: ["machine_status"] },
  engineer1: { role: "engineer", quyen: ["machine_status"] },
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
