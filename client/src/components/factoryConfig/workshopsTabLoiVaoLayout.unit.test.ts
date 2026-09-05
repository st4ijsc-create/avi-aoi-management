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
import { pickExistingLayoutId, buildWorkshopLayoutUrl } from "./WorkshopsTab";

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
