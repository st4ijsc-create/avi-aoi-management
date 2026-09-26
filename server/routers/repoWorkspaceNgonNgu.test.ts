/**
 * ★★★ 2026-09-03 — LƯỚI CHO **CỔNG NGÔN NGỮ** của `repoWorkspaceRouter` (`langSchema`).
 *
 * Lỗi đã đo trên trình duyệt sạch: `i18n.language` là BCP-47 (`"en-US"`), client cũ CAST nó thành
 * `"vi"|"en"|"zh"` (cast không đổi giá trị) ⇒ với `z.enum` cứng, tRPC ném **input invalid** TRƯỚC
 * khi vào handler ⇒ tìm-toàn-repo hiện "No results found" trong khi server chưa quét một tệp nào.
 * Một tính năng chết CÂM vì hậu tố vùng của locale.
 *
 * §1 nhận mọi BCP-47 thường gặp · §2 lùi `"vi"` cho thứ không hiểu được (fail-SAFE, không
 * fail-closed) · §3 KHÔNG BAO GIỜ ném — vì "ném" chính là hình dạng của sự cố này.
 * ĐỘT BIẾN: trả `langSchema` về `z.enum([...])` cứng ⇒ §1 ĐỎ ngay ở ca `en-US`.
 */
import { describe, expect, it } from "vitest";
import { langSchema } from "./repoWorkspaceRouter";

describe("§1 BCP-47 phải qua được, và về đúng ngôn ngữ gốc", () => {
  it("★★★ hậu tố vùng bị cắt, KHÔNG bị từ chối", () => {
    expect(langSchema.parse("en-US")).toBe("en");
    expect(langSchema.parse("en-GB")).toBe("en");
    expect(langSchema.parse("vi-VN")).toBe("vi");
    expect(langSchema.parse("zh-CN")).toBe("zh");
    expect(langSchema.parse("zh-Hant-TW")).toBe("zh");
  });

  it("★ mã trần vẫn đúng như cũ (tương thích ngược từng ca)", () => {
    expect(langSchema.parse("vi")).toBe("vi");
    expect(langSchema.parse("en")).toBe("en");
    expect(langSchema.parse("zh")).toBe("zh");
    expect(langSchema.parse("EN")).toBe("en"); // hoa/thường không được là hai số phận
  });
});

describe("§2 LÙI `vi` cho thứ không hiểu — im lặng ĐÚNG CHỖ", () => {
  it("★★★ ngôn ngữ ngoài tập ⇒ vi, KHÔNG ném", () => {
    for (const v of ["fr", "fr-FR", "ja", "xx-YY", "", "  "]) {
      expect(langSchema.parse(v), `"${v}" phải lùi về vi`).toBe("vi");
    }
  });

  it("★★ vắng / kiểu lạ ⇒ vi (client cũ có thể không gửi trường này)", () => {
    expect(langSchema.parse(undefined)).toBe("vi");
    expect(langSchema.parse(null)).toBe("vi");
    expect(langSchema.parse(123)).toBe("vi");
    expect(langSchema.parse({})).toBe("vi");
  });
});

describe("§3 KHÔNG BAO GIỜ NÉM — 'ném' chính là hình dạng sự cố", () => {
  it("★★★ mọi đầu vào lạ đều parse được, không một ngoại lệ nào", () => {
    for (const v of ["en-US", "fr", undefined, null, 0, [], {}, "zh-Hans"]) {
      expect(() => langSchema.parse(v), `ném với ${JSON.stringify(v)}`).not.toThrow();
    }
  });
});
