/**
 * ★ F3 — bộ chọn chế độ nghĩ theo lượt: danh sách TRẮNG `locCheDoNghi` + cách `ghiDe` thắng quy tắc lớp.
 * Điều đắt nhất: `"nhanh"` phải tắt nghĩ CẢ lớp sinh mã (đó là ý người dùng), còn `"sau"` KHÔNG được bật
 * nghĩ cho lớp phụ (bật chỉ đốt trần và làm lượt chọn tệp rỗng trở lại).
 */
import { describe, it, expect } from "vitest";
import { locCheDoNghi, luotDuocNghi, tranTokenTheoLop } from "./loaiLuot";

describe("locCheDoNghi — danh sách TRẮNG, không chuẩn hoá", () => {
  it("đúng ba literal đi qua", () => {
    expect(locCheDoNghi("sau")).toBe("sau");
    expect(locCheDoNghi("can-bang")).toBe("can-bang");
    expect(locCheDoNghi("nhanh")).toBe("nhanh");
  });
  it("★ mọi thứ khác ⇒ undefined (hoa/thường, khoảng trắng, số, null, object)", () => {
    for (const x of ["SAU", " nhanh", "nhanh ", "can_bang", "", 1, null, undefined, {}, ["nhanh"], true]) {
      expect(locCheDoNghi(x), JSON.stringify(x)).toBeUndefined();
    }
  });
});

describe("luotDuocNghi / tranTokenTheoLop với ghiDe", () => {
  it("★★★ nhanh ⇒ tắt nghĩ cả lớp sinh/sửa mã, và trần về trần GỐC (không nới)", () => {
    for (const loai of ["sinh-ma", "sua-tep", "khoi-sua", "tao-khung"] as const) {
      expect(luotDuocNghi(loai, "nhanh"), loai).toBe(false);
      expect(tranTokenTheoLop(loai, 3000, 16000, "nhanh"), loai).toBe(3000);
    }
  });
  it("★★ sau / can-bang ⇒ đúng quy tắc lớp: lớp nghĩ nghĩ (trần nới), lớp phụ KHÔNG nghĩ (trần gốc)", () => {
    for (const ghiDe of ["sau", "can-bang", undefined] as const) {
      expect(luotDuocNghi("khoi-sua", ghiDe)).toBe(true);
      expect(tranTokenTheoLop("khoi-sua", 4000, 16000, ghiDe)).toBe(16000);
      expect(luotDuocNghi("chon-tep", ghiDe), "lớp phụ không bao giờ nghĩ, kể cả 'sau'").toBe(false);
      expect(tranTokenTheoLop("chon-tep", 512, 16000, ghiDe)).toBe(512);
    }
  });
  it("sau ≡ can-bang hôm nay (chưa có B3) — hai chế độ cho cùng kết cục trên mọi lớp", () => {
    for (const loai of ["sinh-ma", "sua-tep", "khoi-sua", "tao-khung", "chon-tep", "kb-qa", "phan-loai", "trich-xuat"] as const) {
      expect(luotDuocNghi(loai, "sau")).toBe(luotDuocNghi(loai, "can-bang"));
      expect(tranTokenTheoLop(loai, 1000, 9000, "sau")).toBe(tranTokenTheoLop(loai, 1000, 9000, "can-bang"));
    }
  });
});
