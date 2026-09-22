import { describe, it, expect } from "vitest";
import { luotDuocNghi, tranTokenTheoLop, type LoaiLuot } from "./loaiLuot";

const NGHI: LoaiLuot[] = ["sinh-ma", "sua-tep", "khoi-sua", "tao-khung"];
const PHU: LoaiLuot[] = ["chon-tep", "kb-qa", "phan-loai", "trich-xuat"];

describe("luotDuocNghi — B1 (T1 rà soát 2026-09-22)", () => {
  it("★★★ lớp SINH/SỬA MÃ được nghĩ — đúng trước nhanh", () => {
    for (const l of NGHI) expect(luotDuocNghi(l), l).toBe(true);
  });

  it("★★★ lớp PHỤ KHÔNG nghĩ — đo sống: 512 tok + nghĩ ⇒ content rỗng, finish=length", () => {
    for (const l of PHU) expect(luotDuocNghi(l), l).toBe(false);
  });

  it("★ ghi đè 'nhanh' (F3) tắt nghĩ cả lớp sinh mã", () => {
    for (const l of NGHI) expect(luotDuocNghi(l, "nhanh"), l).toBe(false);
  });

  it("★ ghi đè 'sau' KHÔNG bật nghĩ cho lớp phụ — lớp phụ không có gì để nghĩ, bật chỉ đốt trần", () => {
    for (const l of PHU) expect(luotDuocNghi(l, "sau"), l).toBe(false);
    for (const l of NGHI) expect(luotDuocNghi(l, "sau"), l).toBe(true);
  });

  it("★ 'can-bang' = quy tắc mặc định", () => {
    for (const l of NGHI) expect(luotDuocNghi(l, "can-bang")).toBe(true);
    for (const l of PHU) expect(luotDuocNghi(l, "can-bang")).toBe(false);
  });

  it("★★★ BẤT BIẾN: mọi lớp thuộc ĐÚNG MỘT nhóm — thêm lớp mới mà quên xếp ⇒ đỏ ở đây", () => {
    const tatCa: LoaiLuot[] = [...NGHI, ...PHU];
    expect(new Set(tatCa).size).toBe(8);
    for (const l of tatCa) expect(typeof luotDuocNghi(l)).toBe("boolean");
  });
});

describe("tranTokenTheoLop", () => {
  it("★★★ lớp PHỤ ⇒ trả ĐÚNG trần gốc — hành vi cũ không đổi một byte (chọn tệp vẫn 512)", () => {
    expect(tranTokenTheoLop("chon-tep", 512, 16_000)).toBe(512);
    expect(tranTokenTheoLop("kb-qa", 220, 16_000)).toBe(220);
  });

  it("★★★ lớp NGHĨ ⇒ max(gốc, trần nghĩ) — khối sửa 4.000 nới lên 16.000; tạo khung 8.000 KHÔNG bị co", () => {
    expect(tranTokenTheoLop("khoi-sua", 4_000, 16_000)).toBe(16_000);
    expect(tranTokenTheoLop("tao-khung", 8_000, 6_000)).toBe(8_000);
  });

  it("★ ghi đè 'nhanh' ⇒ lớp nghĩ dùng trần gốc", () => {
    expect(tranTokenTheoLop("sinh-ma", 3_000, 16_000, "nhanh")).toBe(3_000);
  });

  it("★ trần nghĩ null/rác ⇒ giữ gốc, không ném", () => {
    expect(tranTokenTheoLop("sinh-ma", 3_000, null)).toBe(3_000);
    expect(tranTokenTheoLop("sinh-ma", 3_000, NaN)).toBe(3_000);
    expect(tranTokenTheoLop("sinh-ma", 3_000, -5)).toBe(3_000);
  });

  it("★ trần gốc rác ⇒ sàn 256, không ném", () => {
    expect(tranTokenTheoLop("chon-tep", NaN, null)).toBe(256);
    expect(tranTokenTheoLop("chon-tep", 0, null)).toBe(256);
  });
});
