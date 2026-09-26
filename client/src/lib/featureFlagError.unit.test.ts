/**
 * F11 (nhóm C 2026-08-14) — nhận diện "tính năng đang tắt cờ" theo MÃ, không theo chuỗi.
 *
 * BỆNH ĐÃ CÓ THẬT: tám màn hình tự viết lại cùng vị từ
 *   `e.data?.code === "CONFLICT" && /disabled/i.test(e.message)`
 * — khớp chữ "disabled" trong message TIẾNG ANH. Mục đích tốt (thay lỗi đỏ bằng câu
 * bình tĩnh, actionable), nhưng đổi câu chữ ở máy chủ là cả tám cùng gãy IM LẶNG.
 * `FleetOrchestration`/`RobotModelHealth` còn có tầng regex THỨ HAI để phân biệt hai cờ.
 */
import { describe, it, expect } from "vitest";
import { isFeatureDisabledError, featureKeyOf } from "./featureFlagError";

function loi(message: string, data?: Record<string, unknown>) {
  return Object.assign(new Error(message), { data });
}

describe("isFeatureDisabledError — theo mã", () => {
  it("appCode FEATURE_DISABLED ⇒ nhận ra, KỂ CẢ khi message không có chữ disabled", () => {
    // Đây là ca chứng minh giá trị: máy chủ đổi câu chữ (hoặc dịch sang tiếng Việt)
    // thì bản cũ gãy im lặng, bản mới vẫn nhận ra.
    const e = loi("Tính năng điều phối đội máy chưa được bật", {
      code: "CONFLICT",
      appCode: "FEATURE_DISABLED",
      appParams: { feature: "fleetOrchestration" },
    });
    expect(isFeatureDisabledError(e)).toBe(true);
  });

  it("đường lui: tuyến CHƯA di trú (CONFLICT + 'disabled' tiếng Anh, không appCode) ⇒ vẫn nhận ra", () => {
    expect(isFeatureDisabledError(loi("Fleet orchestration disabled (set FLEET_ORCH_ENABLED=true)", { code: "CONFLICT" }))).toBe(true);
  });

  it("CONFLICT nhưng KHÔNG phải cờ tắt ⇒ không nhận nhầm", () => {
    expect(isFeatureDisabledError(loi("Mã sản phẩm đã tồn tại", { code: "CONFLICT", appCode: "ENTITY_DUPLICATE" }))).toBe(false);
  });

  it("mã lỗi khác ⇒ false", () => {
    expect(isFeatureDisabledError(loi("Không tìm thấy máy", { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND" }))).toBe(false);
  });

  it("đầu vào rác ⇒ false, không ném", () => {
    expect(isFeatureDisabledError(undefined)).toBe(false);
    expect(isFeatureDisabledError(null)).toBe(false);
    expect(isFeatureDisabledError("FEATURE_DISABLED")).toBe(false);
    expect(isFeatureDisabledError({})).toBe(false);
  });
});

describe("featureKeyOf — phân nhánh nhiều cờ mà không cần regex", () => {
  it.each([
    ["fleetOrchestration"],
    ["fleetResourceLayer"],
    ["modelAutoRollback"],
    ["robotAnomalyDetection"],
  ])('trả đúng khoá "%s"', (feature) => {
    const e = loi("bất kỳ", { code: "CONFLICT", appCode: "FEATURE_DISABLED", appParams: { feature } });
    expect(featureKeyOf(e)).toBe(feature);
  });

  it("hai cờ của cùng một màn phân biệt được bằng khoá, KHÔNG cần đọc message", () => {
    const orch = loi("x", { appCode: "FEATURE_DISABLED", appParams: { feature: "fleetOrchestration" } });
    const res = loi("x", { appCode: "FEATURE_DISABLED", appParams: { feature: "fleetResourceLayer" } });
    expect(featureKeyOf(orch)).not.toBe(featureKeyOf(res));
  });

  it("tuyến chưa di trú ⇒ undefined, chỗ gọi phải chịu được (có đường lui regex)", () => {
    expect(featureKeyOf(loi("Fleet resource layer disabled", { code: "CONFLICT" }))).toBeUndefined();
  });

  it("feature không phải chuỗi ⇒ undefined, không ném", () => {
    expect(featureKeyOf(loi("x", { appParams: { feature: 42 } }))).toBeUndefined();
    expect(featureKeyOf(undefined)).toBeUndefined();
  });
});
