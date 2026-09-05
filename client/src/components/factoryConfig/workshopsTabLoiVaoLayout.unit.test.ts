/**
 * Lô 5 Mục 3 — "/layout/:id" (settings_factory, route param THẬT — App.tsx) sống mà
 * 0 lối vào UI trước Lô 5. Lưới này đo LOGIC THUẦN của lối vào mới trong `WorkshopsTab.tsx`
 * (nút "Bố cục xưởng" ở hàng xưởng của danh sách xưởng), KHÔNG dựng render/network (BG-129:
 * cấm hạ tầng render-test) — hai hàm export tách khỏi async handler đúng vì lý do đó.
 *
 * Vì sao KHÔNG đoán id: "/layout/:id" không có cú pháp param tuỳ chọn; nếu truyền id giả,
 * `Layout.tsx` gọi `layout.getById({id: giả})` → server ném NOT_FOUND, và hiệu ứng tự-chọn-
 * layout-đầu-tiên bị chặn vì `selectedLayout` đã "có vẻ hợp lệ" (params.id truthy) — trang bị
 * kẹt ở trạng thái xấu thay vì tự phục hồi. `pickExistingLayoutId` ghim đúng quyết định: có
 * layout thật thì lấy CÁI ĐẦU TIÊN (không suy đoán "đúng" cái nào khác); không có thì trả
 * `null` để nơi gọi tạo mới rồi mới điều hướng bằng id thật.
 */
import { describe, it, expect } from "vitest";
import { pickExistingLayoutId, buildWorkshopLayoutUrl, canOpenWorkshopLayoutButton } from "./WorkshopsTab";

describe("WorkshopsTab — pickExistingLayoutId (Lô 5 Mục 3)", () => {
  it("xưởng có ≥1 layout → trả id của layout ĐẦU TIÊN", () => {
    expect(pickExistingLayoutId([{ id: 42 }, { id: 43 }])).toBe(42);
  });

  it("xưởng có ĐÚNG 1 layout → trả id đó", () => {
    expect(pickExistingLayoutId([{ id: 7 }])).toBe(7);
  });

  it("xưởng CHƯA có layout nào (mảng rỗng) → null, KHÔNG đoán id", () => {
    expect(pickExistingLayoutId([])).toBeNull();
  });

  it("undefined (chưa fetch xong / lỗi mạng) → null, không phải 0 hay NaN", () => {
    expect(pickExistingLayoutId(undefined)).toBeNull();
  });
});

describe("WorkshopsTab — buildWorkshopLayoutUrl (Lô 5 Mục 3, một chỗ dựng URL)", () => {
  it("dựng đúng '/layout/:id?workshopId=:workshopId'", () => {
    expect(buildWorkshopLayoutUrl(42, 7)).toBe("/layout/42?workshopId=7");
  });

  it("layoutId và workshopId độc lập — không hoán đổi vị trí", () => {
    expect(buildWorkshopLayoutUrl(1, 999)).toBe("/layout/1?workshopId=999");
    expect(buildWorkshopLayoutUrl(999, 1)).toBe("/layout/999?workshopId=1");
  });
});

/**
 * Vòng sửa review Lô 5 (Important) — `canOpenWorkshopLayoutButton` PHẢI khớp đúng vị từ
 * `RouteGuard` dùng cho `/layout/:id` (App.tsx:587 → `requirePermission="settings_factory"`,
 * xét `canView` — RouteGuard.tsx dòng ~156-169). Bản trước dùng `canEdit`: một user
 * canEdit=true/canView=false (hai cột ĐỘC LẬP của bảng permissions) sẽ thấy nút rồi bị
 * RouteGuard chặn — đúng lớp "một lối vào rồi TỪ CHỐI" mà Mục 2 vừa dẹp. Lưới này khoá cả hai
 * chiều: canView=true (dù canEdit=false) PHẢI cho hiện nút; canEdit=true (dù canView=false)
 * PHẢI KHÔNG cho hiện nút — đây chính là ca đột biến review đã bắt.
 */
describe("WorkshopsTab — canOpenWorkshopLayoutButton (vòng sửa review Lô 5, khớp RouteGuard canView)", () => {
  it("admin → luôn true, không cần hỏi hasPermission", () => {
    const hasPermission = () => false;
    expect(canOpenWorkshopLayoutButton(true, hasPermission)).toBe(true);
  });

  it("không-admin, có canView('settings_factory') → true (đúng ca DƯƠNG, dù KHÔNG có canEdit)", () => {
    const hasPermission = (module: string, action: "canView") => module === "settings_factory" && action === "canView";
    expect(canOpenWorkshopLayoutButton(false, hasPermission)).toBe(true);
  });

  it("không-admin, KHÔNG có canView('settings_factory') → false (đúng ca ÂM)", () => {
    const hasPermission = () => false;
    expect(canOpenWorkshopLayoutButton(false, hasPermission)).toBe(false);
  });

  it("★★★ ĐỘT BIẾN REVIEW BẮT ĐƯỢC — chỉ hỏi canView, KHÔNG BAO GIỜ hỏi canEdit (nếu code trôi ngược về canEdit, ca canEdit-only sẽ SAI thành true)", () => {
    // hasPermission mô phỏng đúng ca review nêu: canEdit=true nhưng canView=false.
    const hasPermissionCanEditOnly = (module: string, action: "canView") => {
      if (module !== "settings_factory") return false;
      // Hàm chỉ có thể hỏi "canView" theo chữ ký — nếu implementation từng đổi sang hỏi
      // "canEdit" (ép kiểu qua `as any` để bỏ qua TS), giả lập này vẫn phải trả false cho
      // canView để ca canEdit-only lộ ra đúng như review đã bắt.
      return action === "canView" ? false : true;
    };
    expect(canOpenWorkshopLayoutButton(false, hasPermissionCanEditOnly)).toBe(false);
  });
});
