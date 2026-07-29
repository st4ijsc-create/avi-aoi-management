/** Doc 42 Đợt 0.5 — unit tests for the shared tRPC error mapper. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

import { mapTrpcError } from "./trpcErrors";

// Sprint 5 §4.3 — bộ test dưới đây (describe "mã lỗi máy-đọc-được") thực sự đi
// qua `translateAppError` → `i18n.t(...)`, nên cần i18n THẬT đã có bản dịch, KHÔNG
// được stub `i18n.t` để trả nguyên khoá (test sẽ xanh giả trong khi người dùng
// thật thấy "errors.ENTITY_NOT_FOUND" trên màn hình).
//
// `../i18n` là file khởi tạo i18n thật của dự án (fallbackLng 'vi', interpolation
// escapeValue:false, …) — import nó để chạy đúng cấu hình production. Nhưng phần
// nạp nội dung dịch của nó dùng fetch/dynamic-import (bootstrap cho trình duyệt),
// không chạy được trong môi trường test Node — nên nạp thẳng 3 file JSON dịch
// THẬT từ đĩa qua `addResourceBundle` (API công khai của i18next, không phải
// stub `t`) để `i18n.t()` phân giải đúng nội dung production.
import "../i18n";
import i18n from "i18next";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

beforeAll(async () => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
  await i18n.changeLanguage("vi");
});

function fakeTrpcError(message: string, code?: string) {
  const err = new Error(message) as Error & { data?: { code?: string } };
  if (code) err.data = { code };
  return err;
}

describe("mapTrpcError", () => {
  it("returns the server message for CONFLICT", () => {
    expect(mapTrpcError(fakeTrpcError("Mã đã tồn tại", "CONFLICT"))).toBe("Mã đã tồn tại");
  });

  it("falls back for CONFLICT messages that leak SQL", () => {
    expect(mapTrpcError(fakeTrpcError('Failed query: insert into "skills" ...', "CONFLICT"))).toBe(
      "Mã đã tồn tại",
    );
  });

  it("parses zod issue arrays into field + first message (no JSON dump)", () => {
    const zodMessage = JSON.stringify([
      { code: "invalid_type", path: ["code"], message: "Required" },
      { code: "too_small", path: ["name"], message: "String must contain at least 1 character(s)" },
    ]);
    const result = mapTrpcError(fakeTrpcError(zodMessage, "BAD_REQUEST"));
    expect(result).toContain('"code"');
    expect(result).toContain("bắt buộc nhập");
    expect(result).not.toContain("invalid_type");
    expect(result).not.toContain("[");
  });

  it("maps FORBIDDEN and UNAUTHORIZED to fixed Vietnamese messages", () => {
    expect(mapTrpcError(fakeTrpcError("nope", "FORBIDDEN"))).toBe(
      "Bạn không có quyền thực hiện thao tác này",
    );
    expect(mapTrpcError(fakeTrpcError("expired", "UNAUTHORIZED"))).toBe(
      "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại",
    );
  });

  // Doc 44 G5.4 — 403 không nuốt reason cụ thể nữa.
  it("keeps a recognizable FORBIDDEN reason code + original message", () => {
    const result = mapTrpcError(
      fakeTrpcError("APPROVAL_REQUIRED: lệnh deploy cần phê duyệt four-eyes", "FORBIDDEN"),
    );
    expect(result).toContain("Bạn không có quyền thực hiện thao tác này");
    expect(result).toContain("APPROVAL_REQUIRED");
    expect(result).toContain("four-eyes");
  });

  it("keeps actionable FORBIDDEN details (role/permission/2FA)", () => {
    expect(mapTrpcError(fakeTrpcError("Required role: admin or supervisor", "FORBIDDEN"))).toContain(
      "Required role: admin or supervisor",
    );
    expect(
      mapTrpcError(
        fakeTrpcError(
          "Tài khoản đặc quyền phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.",
          "FORBIDDEN",
        ),
      ),
    ).toContain("xác thực 2 bước");
  });

  it("still falls back to generic for FORBIDDEN messages that leak SQL", () => {
    expect(
      mapTrpcError(fakeTrpcError('Failed query: select quyền from "users"', "FORBIDDEN")),
    ).toBe("Bạn không có quyền thực hiện thao tác này");
  });

  it("never surfaces 'Failed query'/SQL for unknown codes", () => {
    expect(mapTrpcError(fakeTrpcError('Failed query: insert into "x" values ($1)'))).toBe(
      "Lỗi hệ thống, vui lòng thử lại",
    );
    expect(mapTrpcError(fakeTrpcError('duplicate key value violates unique constraint "u"'))).toBe(
      "Lỗi hệ thống, vui lòng thử lại",
    );
  });

  it("truncates long plain messages to 200 chars", () => {
    const long = "a".repeat(500);
    const result = mapTrpcError(fakeTrpcError(long));
    expect(result.length).toBeLessThanOrEqual(201);
    expect(result.endsWith("…")).toBe(true);
  });

  it("keeps short plain messages as-is and handles non-errors", () => {
    expect(mapTrpcError(fakeTrpcError("Không tìm thấy sản phẩm"))).toBe("Không tìm thấy sản phẩm");
    expect(mapTrpcError(null)).toBe("Lỗi hệ thống, vui lòng thử lại");
    expect(mapTrpcError("boom")).toBe("boom");
  });
});

describe("mapTrpcError — mã lỗi máy-đọc-được (Sprint 5 §4.3)", () => {
  function withAppCode(code: string, appCode: string, appParams?: any, message = "raw english") {
    const err: any = new Error(message);
    err.data = { code, appCode, appParams };
    return err;
  }

  it("có appCode + khoá i18n ⇒ dịch, KHÔNG hiện chuỗi tiếng Anh", () => {
    const out = mapTrpcError(withAppCode("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "product" }, "Product not found"));
    expect(out).not.toContain("Product not found");
    expect(out).toContain("sản phẩm");
  });

  it("appCode LẠ (client cũ, server mới) ⇒ rơi về message máy chủ, KHÔNG hiện mã trần", () => {
    const out = mapTrpcError(withAppCode("NOT_FOUND", "MÃ_CHƯA_TỪNG_CÓ", undefined, "Widget not found"));
    expect(out).toBe("Widget not found");
    expect(out).not.toContain("MÃ_CHƯA_TỪNG_CÓ");
  });

  it("KHÔNG có appCode (router chưa di trú) ⇒ hành vi y hệt trước đây", () => {
    const err: any = new Error("Product not found");
    err.data = { code: "NOT_FOUND" };
    expect(mapTrpcError(err)).toBe("Product not found");
  });

  it("appCode nhưng message có dấu hiệu leak SQL ⇒ vẫn dịch theo mã, không lộ SQL", () => {
    const out = mapTrpcError(withAppCode("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Failed query: SELECT * FROM users"));
    expect(out).not.toContain("SELECT");
  });

  it("thực thể chưa có trong từ điển ⇒ dùng nguyên văn khoá, không sập", () => {
    const out = mapTrpcError(withAppCode("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "flux_capacitor" }, "Flux capacitor not found"));
    expect(out).toContain("flux_capacitor");
  });
});
