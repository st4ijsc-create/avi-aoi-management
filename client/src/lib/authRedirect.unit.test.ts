/**
 * F11 (nhóm C 2026-08-14) — phiên hết hạn phải điều hướng về đăng nhập ở MỌI tuyến,
 * không chỉ tuyến nào tình cờ dùng đúng chuỗi `'Please login (10001)'`.
 *
 * BỆNH ĐÃ CÓ THẬT: `main.tsx` nhận diện bằng `error.message === UNAUTHED_ERR_MSG`.
 * Sáu tuyến cũng ném `UNAUTHORIZED` + `AUTH_REQUIRED` nhưng message khác
 * (`"Login required"` ×4, `"Authentication required to resolve alert"`, `"Chưa đăng nhập"`).
 * Với chúng: KHÔNG điều hướng, và handler toàn cục chỉ `console.error` nên cũng KHÔNG hiện
 * gì ⇒ người dùng nhìn một màn hình rỗng câm và không biết mình cần đăng nhập lại.
 */
import { describe, it, expect } from "vitest";
import { isUnauthorizedError } from "./authRedirect";
import { UNAUTHED_ERR_MSG } from "@shared/const";

/** Dựng lỗi giống hình dạng `TRPCClientError` thật sau khi qua `errorFormatter`. */
function loi(message: string, data?: Record<string, unknown>) {
  return Object.assign(new Error(message), { data });
}

describe("isUnauthorizedError — nhận diện theo MÃ", () => {
  it("tuyến xác thực chính (message chuẩn) ⇒ nhận ra", () => {
    expect(isUnauthorizedError(loi(UNAUTHED_ERR_MSG, { code: "UNAUTHORIZED", appCode: "AUTH_REQUIRED" }))).toBe(true);
  });

  // ⚠ SÁU CA DƯỚI ĐÂY LÀ BỆNH CŨ — bản `message === UNAUTHED_ERR_MSG` ĐỎ hết.
  it.each([
    ["Login required", "aiInspectionAnalyticsRouter / executiveReportRouter"],
    ["Authentication required to resolve alert", "mqttOeeRouters"],
    ["Chưa đăng nhập", "productionSessionRouter"],
  ])('message "%s" (%s) ⇒ VẪN nhận ra nhờ appCode', (message) => {
    expect(isUnauthorizedError(loi(message, { code: "UNAUTHORIZED", appCode: "AUTH_REQUIRED" }))).toBe(true);
  });

  it("đường lui: tuyến CHƯA di trú, chỉ có message chuẩn, không có appCode ⇒ vẫn nhận ra", () => {
    expect(isUnauthorizedError(loi(UNAUTHED_ERR_MSG))).toBe(true);
  });
});

describe("isUnauthorizedError — KHÔNG được đá nhầm người đang đăng nhập hợp lệ", () => {
  it("thiếu quyền (FORBIDDEN) ⇒ KHÔNG điều hướng", () => {
    expect(isUnauthorizedError(loi("Bạn không có quyền", { code: "FORBIDDEN", appCode: "PERMISSION_DENIED" }))).toBe(false);
  });

  it("mã tRPC UNAUTHORIZED nhưng appCode KHÁC ⇒ KHÔNG điều hướng", () => {
    // Cố ý: `UNAUTHORIZED` còn dùng cho tình huống khác. Đá người dùng ra trang đăng nhập
    // khi họ đang đăng nhập hợp lệ là hồi quy tệ hơn bệnh đang chữa.
    expect(isUnauthorizedError(loi("Sai thông tin đăng nhập", { code: "UNAUTHORIZED", appCode: "INVALID_VALUE" }))).toBe(false);
  });

  it("DB_UNAVAILABLE ⇒ KHÔNG điều hướng", () => {
    expect(isUnauthorizedError(loi("Database not available", { code: "INTERNAL_SERVER_ERROR", appCode: "DB_UNAVAILABLE" }))).toBe(false);
  });

  it("lỗi thường, không phải tRPC ⇒ KHÔNG điều hướng", () => {
    expect(isUnauthorizedError(new Error("boom"))).toBe(false);
  });

  it("đầu vào rác ⇒ false, không ném", () => {
    expect(isUnauthorizedError(undefined)).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
    expect(isUnauthorizedError("AUTH_REQUIRED")).toBe(false);
    expect(isUnauthorizedError({ data: { appCode: 123 } })).toBe(false);
  });
});
