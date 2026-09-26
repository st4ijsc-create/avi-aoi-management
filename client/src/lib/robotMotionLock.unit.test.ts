/**
 * doc 81 Đợt 1B Task 5 fix round 5 (item 3) — nút "Gỡ khoá chuyển động" chỉ được BẬT cho người mà server
 * sẽ cho qua: sàn vai actuation (admin/supervisor/engineer, cùng hằng ACTUATION_ROLES phía client) VÀ
 * machine_control/canEdit. Người ngoài sàn vai không được thấy một nút bật rồi nhận FORBIDDEN.
 */
import { describe, it, expect } from "vitest";
import { canClearMotionLock } from "./robotMotionLock";

describe("canClearMotionLock — sàn vai actuation + machine_control/canEdit (fix round 5)", () => {
  it.each(["admin", "supervisor", "engineer"])("%s + canEdit ⇒ true", (role) => {
    expect(canClearMotionLock(role, true)).toBe(true);
  });

  it.each(["operator", "viewer", "user", "quality", "", null, undefined])("vai %s + canEdit ⇒ false (server sẽ FORBIDDEN)", (role) => {
    expect(canClearMotionLock(role as string | null | undefined, true)).toBe(false);
  });

  it("vai trong sàn nhưng KHÔNG có machine_control/canEdit ⇒ false", () => {
    expect(canClearMotionLock("engineer", false)).toBe(false);
    expect(canClearMotionLock("admin", false)).toBe(false);
  });
});
