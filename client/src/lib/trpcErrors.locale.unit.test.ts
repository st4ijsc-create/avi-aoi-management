/**
 * F1 (2026-08-21) — CÂU DỰ PHÒNG của `mapTrpcError` phải đổi theo ngôn ngữ người dùng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO PHẢI CÓ LƯỚI NÀY, DÙ 8 CỔNG KHÁC ĐÃ XANH
 * ══════════════════════════════════════════════════════════════════════════════════
 * Sau khi di trú, `client/src/lib/trpcErrors.unit.test.ts` **vẫn xanh nguyên** — và đó
 * chính là vấn đề. Trong môi trường test, bundle i18n chưa nạp ⇒ `translateClientKey`
 * trả đúng `fallback` (câu tiếng Việt cũ) ⇒ hành vi trùng khít bản trước. Bộ test cũ
 * không thể phân biệt "đã dịch được" với "chưa dịch gì cả".
 *
 * ⇒ Bài học lặp lại lần thứ N: **cổng xanh chỉ chứng minh không còn thứ nó biết cách
 *   nhìn.** Muốn biết bản vá có tác dụng, phải đo ĐÚNG cái vừa đổi — ở đây là: cùng một
 *   lỗi, đổi `i18n.language`, câu ra phải KHÁC.
 *
 * ── VÌ SAO NHÁNH DỰ PHÒNG ĐÁNG MỘT BỘ TEST RIÊNG ─────────────────────────────────
 * Đường `appCode → translateAppError` đã có lưới. Đường DỰ PHÒNG (lỗi không mang
 * `appCode`) thì chưa, mà nó phủ đúng các nhánh gặp hằng ngày: hết phiên, chối quyền,
 * lỗi zod của biểu mẫu. Trước bản vá, cả ba trả tiếng Việt gán cứng cho MỌI ngôn ngữ.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapTrpcError } from "./trpcErrors";

import "../i18n";
import i18n from "i18next";

const HERE = dirname(fileURLToPath(import.meta.url));
const localeJson = (rel: string) => JSON.parse(readFileSync(join(HERE, rel), "utf8"));

/** Dựng lỗi tRPC mang `data.code` như client thật nhận được. */
function loi(code: string, message = ""): Error & { data: { code: string } } {
  const e = new Error(message) as Error & { data: { code: string } };
  e.data = { code };
  return e;
}

beforeAll(() => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});
afterAll(async () => {
  await i18n.changeLanguage("vi");
});

describe("F1 — nhánh dự phòng của mapTrpcError đổi theo ngôn ngữ", () => {
  it("cầu chì: ba bundle phải NẠP THẬT — thiếu thì mọi ca dưới đây xanh vô nghĩa", () => {
    // Không có ca này, `translateClientKey` lặng lẽ trả fallback tiếng Việt ở CẢ BA
    // ngôn ngữ và bộ test vẫn xanh — đúng cái bẫy mà bộ test cũ đã rơi vào.
    for (const lg of ["vi", "en", "zh"]) {
      expect(i18n.hasResourceBundle(lg, "translation"), `bundle ${lg}`).toBe(true);
      expect(i18n.getResource(lg, "translation", "errors.client.generic"), `khoá ${lg}`).toBeTruthy();
    }
  });

  it("★★★ UNAUTHORIZED — hết phiên: vi ≠ en ≠ zh", async () => {
    await i18n.changeLanguage("vi");
    const vi = mapTrpcError(loi("UNAUTHORIZED"));
    await i18n.changeLanguage("en");
    const en = mapTrpcError(loi("UNAUTHORIZED"));
    await i18n.changeLanguage("zh");
    const zh = mapTrpcError(loi("UNAUTHORIZED"));

    expect(vi).toBe("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại");
    expect(en).toBe("Your session has expired, please sign in again");
    expect(zh).toBe("登录会话已过期，请重新登录");
    expect(new Set([vi, en, zh]).size).toBe(3);
  });

  it("★★★ FORBIDDEN generic — chối quyền không mang reason", async () => {
    await i18n.changeLanguage("en");
    expect(mapTrpcError(loi("FORBIDDEN"))).toBe("You do not have permission to perform this action");
    await i18n.changeLanguage("zh");
    expect(mapTrpcError(loi("FORBIDDEN"))).toBe("您没有权限执行此操作");
  });

  it("★★★ FORBIDDEN — máy chủ gửi ĐÚNG câu tiếng Việt: KHÔNG được lặp đôi ở giao diện en", async () => {
    // Đây là cái bẫy đã suýt lọt: dòng chống-lặp-đôi so `message` với một hằng. Nếu hằng
    // đó cũng bị dịch, thì ở giao diện `en` phép so không còn khớp câu tiếng Việt mà máy
    // chủ gửi ⇒ người dùng đọc câu ĐÔI. Cùng lớp lỗi với `col.header` ở `masterDataIO.ts`.
    await i18n.changeLanguage("en");
    const ra = mapTrpcError(loi("FORBIDDEN", "Bạn không có quyền thực hiện thao tác này"));
    expect(ra).toBe("You do not have permission to perform this action");
    expect(ra).not.toMatch(/—/); // không có phần nối ⇒ không lặp
  });

  it("★★★ lỗi zod — lớp lỗi thường gặp nhất của biểu mẫu", async () => {
    const issues = JSON.stringify([{ path: ["email"], message: "Invalid email" }]);
    await i18n.changeLanguage("vi");
    expect(mapTrpcError(new Error(issues))).toBe('Dữ liệu không hợp lệ — Trường "email": email không hợp lệ');
    await i18n.changeLanguage("en");
    expect(mapTrpcError(new Error(issues))).toBe('Invalid data — Field "email": is not a valid email');
    await i18n.changeLanguage("zh");
    expect(mapTrpcError(new Error(issues))).toBe("数据无效 — 字段“email”：邮箱格式无效");
  });

  it("zod nhiều lỗi — phần đuôi đếm cũng phải dịch", async () => {
    const issues = JSON.stringify([
      { path: ["a"], message: "Required" },
      { path: ["b"], message: "Required" },
      { path: ["c"], message: "Required" },
    ]);
    await i18n.changeLanguage("en");
    const ra = mapTrpcError(new Error(issues));
    expect(ra).toContain("(and 2 more)");
    expect(ra).not.toMatch(/lỗi khác/);
  });

  it("★★★ message máy chủ có dấu hiệu leak SQL ⇒ câu chung, ĐÃ DỊCH", async () => {
    // Nhánh này vừa là bảo mật vừa là i18n: không lộ SQL, và không lộ tiếng Việt.
    await i18n.changeLanguage("en");
    expect(mapTrpcError(new Error("Failed query: select * from users"))).toBe(
      "System error, please try again",
    );
  });

  it("message THẬT của máy chủ vẫn THẮNG câu dự phòng — không nuốt thông tin", async () => {
    // Đối trọng cho mọi ca trên: nếu bản vá biến mọi thứ thành câu generic thì nó vừa
    // "dịch được" vừa làm người dùng mất thông tin hành-động-được (lớp lỗi F4).
    await i18n.changeLanguage("en");
    expect(mapTrpcError(loi("CONFLICT", "Mã máy MC-01 đã tồn tại"))).toBe("Mã máy MC-01 đã tồn tại");
  });

  it("★★★ F8 — locale `en` nạp ĐỦ nhưng THIẾU đúng khoá mới ⇒ KHÔNG được rơi về tiếng Việt", async () => {
    // Đây là lớp lỗi F8 round 2: `hasResourceBundle('en')` vẫn `true` (bundle đầy đủ
    // hàng nghìn khoá) mà vẫn thiếu ĐÚNG một khoá mới thêm — khi ấy `fallbackLng: 'vi'`
    // của dự án sẽ trả CÂU TIẾNG VIỆT cho người dùng en. `fallbackLng: false` tại lời gọi
    // là thứ duy nhất chặn được, và không cổng nào khác canh đường `translateClientKey`.
    //
    // Tình huống này KHÔNG giả định: 12 khoá `errors.client.*` vừa được thêm hôm nay;
    // một bản triển khai lệch nhịp (FE mới, bundle locale cũ trong cache) là đúng nó.
    const en = i18n.getResourceBundle("en", "translation");
    const luuClient = en.errors.client;
    try {
      delete en.errors.client;
      i18n.addResourceBundle("en", "translation", en, false, true); // ghi đè, không deep-merge
      await i18n.changeLanguage("en");
      const ra = mapTrpcError(loi("UNAUTHORIZED"));
      // Thiếu khoá ⇒ rơi về `fallback` (tiếng Việt) là ĐÚNG THEO THIẾT KẾ — nhưng phải
      // là fallback CỦA LỜI GỌI, không phải bản dịch vi mà i18next tự lấy. Hai thứ này
      // trùng mặt chữ ở đây, nên ca dưới mới là ca phân biệt được.
      expect(ra).toBe("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại");

      // Ca PHÂN BIỆT: đổi bản dịch `vi` thành một câu KHÁC fallback. Nếu `fallbackLng`
      // còn sống, i18next trả câu vi ĐÃ ĐỔI; nếu bị tắt đúng cách, ta nhận fallback.
      i18n.addResourceBundle("vi", "translation", { errors: { client: { sessionExpired: "CÂU-VI-KHÁC" } } }, true, true);
      expect(mapTrpcError(loi("UNAUTHORIZED"))).toBe("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại");
      expect(mapTrpcError(loi("UNAUTHORIZED"))).not.toBe("CÂU-VI-KHÁC");
    } finally {
      en.errors.client = luuClient;
      i18n.addResourceBundle("en", "translation", en, false, true);
      i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
    }
  });

  it("★★★ zod message KHÔNG có trong bảng ⇒ giữ nguyên văn, không nuốt", async () => {
    await i18n.changeLanguage("en");
    const issues = JSON.stringify([{ path: ["qty"], message: "Number must be less than or equal to 500" }]);
    expect(mapTrpcError(new Error(issues))).toBe(
      'Invalid data — Field "qty": Number must be less than or equal to 500',
    );
  });
});
