/**
 * doc 81 Đợt 3 Task 0 (O2, browser check 2026-10-05) — bước 4 của wizard deploy hiện "Tài khoản đặc quyền phải bật 2FA"
 * NGAY TRÊN bản xem trước nói cổng 2FA ĐẠT (chế độ nội bộ `AUTH_2FA_BAT_BUOC=0`, quyết định chủ dự án 2026-09-26).
 * Gốc: `useActuationReadiness` coi `twoFactorEnabled=false` là chặn với mọi vai đặc quyền, không biết chính sách
 * 2FA của triển khai; `deployPreview.callerGates` thì biết. Sửa: cảnh báo 2FA đọc CÙNG nguồn với bản xem trước — cổng
 * `twoFactor` của `deployPreview` (khi có) là sự thật; không có cổng đó (chưa có bản xem trước / lối Hộp duyệt) ⇒ giữ
 * cảnh báo tư vấn của hook như cũ.
 */
import { describe, expect, it } from "vitest";
import { reconcileBlockersWithDeployPreview, type ActuationBlocker } from "./useActuationReadiness";

const B2FA: ActuationBlocker = { code: "2fa", severity: "error", defaultMessage: "phải bật 2FA" };
const BROLE: ActuationBlocker = { code: "role", severity: "error", defaultMessage: "vai không đủ" };

describe("reconcileBlockersWithDeployPreview", () => {
  it("cổng twoFactor ĐẠT (step-up bỏ qua ở chế độ nội bộ / step-up tắt / OTP) ⇒ bỏ cảnh báo 2FA, giữ cảnh báo khác", () => {
    for (const reason of ["stepUpBypassedInternalMode", "stepUpOff", "otpRequired"]) {
      expect(reconcileBlockersWithDeployPreview([B2FA, BROLE], [{ name: "role", ok: true }, { name: "twoFactor", ok: true, reason }])).toEqual([BROLE]);
    }
  });
  it("cổng twoFactor CHẶN ⇒ có cảnh báo 2FA (kể cả khi hook chưa có — server là nguồn sự thật)", () => {
    expect(reconcileBlockersWithDeployPreview([B2FA], [{ name: "twoFactor", ok: false, reason: "twoFactorNotSetUp" }])).toEqual([B2FA]);
    const r = reconcileBlockersWithDeployPreview([], [{ name: "twoFactor", ok: false, reason: "twoFactorNotSetUp" }]);
    expect(r.map((b) => b.code)).toEqual(["2fa"]);
  });
  it("không có bản xem trước / không có cổng twoFactor (lối Hộp duyệt) ⇒ giữ nguyên cảnh báo của hook", () => {
    expect(reconcileBlockersWithDeployPreview([B2FA], undefined)).toEqual([B2FA]);
    expect(reconcileBlockersWithDeployPreview([B2FA], null)).toEqual([B2FA]);
    expect(reconcileBlockersWithDeployPreview([B2FA], [{ name: "permission", ok: true }, { name: "approver", ok: true }])).toEqual([B2FA]);
  });
  it("cảnh báo vai KHÔNG bị bản xem trước gỡ (hook và server cùng một luật vai)", () => {
    expect(reconcileBlockersWithDeployPreview([BROLE], [{ name: "role", ok: true }, { name: "twoFactor", ok: true }])).toEqual([BROLE]);
  });
});
