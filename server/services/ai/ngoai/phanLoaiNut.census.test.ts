/**
 * ★ Đợt 10.3 — CENSUS: mọi loại node trong registry Luồng có mục trong `PHAN_LOAI_NGUON_NUT` (node mới chưa phân loại ⇒ ĐỎ, không âm
 * thầm thành `van-hanh` mặc định lúc chạy rồi bị quên). Ngược lại: bảng không giữ loại đã gỡ khỏi registry.
 */
import { describe, expect, it } from "vitest";
import "../../flow/nut/index";
import { danhSachNut } from "../../flow/dangKyNut";
import { PHAN_LOAI_NGUON_NUT } from "./phanLoai";

describe("census phân loại nguồn node", () => {
  const dangKy = danhSachNut().map((d) => d.type).sort();
  it("registry không rỗng (chống xanh vì quét trúng 0)", () => {
    expect(dangKy.length).toBeGreaterThan(20);
  });
  it("mọi loại node đã đăng ký đều có phân loại", () => {
    expect(dangKy.filter((t) => !(t in PHAN_LOAI_NGUON_NUT))).toEqual([]);
  });
  it("bảng không có loại không còn trong registry", () => {
    expect(Object.keys(PHAN_LOAI_NGUON_NUT).filter((t) => !dangKy.includes(t)).sort()).toEqual([]);
  });
});
