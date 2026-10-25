/**
 * ★★★ CENSUS phạm vi NODE Luồng AI: mọi loại node đã đăng ký có dòng trong `KHOA_PHAM_VI_NUT` (khai trục lọc hoặc miễn có lý do); dòng thừa ⇒ đỏ.
 * Node đọc số liệu nhà máy mới mà quên khai ⇒ đỏ ở đây. Lọc THẬT: `soLieuPhamVi.db.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { danhSachNut } from "./dangKyNut";
import "./nut/index";
import { KHOA_PHAM_VI_NUT } from "./phamViNut";

describe("phamViNut census", () => {
  it("mọi loại node đã đăng ký có dòng; không dòng thừa", () => {
    const dk = danhSachNut().map((n) => n.type).sort();
    expect(Object.keys(KHOA_PHAM_VI_NUT).sort()).toEqual(dk);
  });
  it("lý do ≥ 20 ký tự; node loc nêu trục", () => {
    for (const [t, v] of Object.entries(KHOA_PHAM_VI_NUT)) {
      if (v.kieu === "khong") expect(v.lyDo.length, t).toBeGreaterThanOrEqual(20);
      else expect(v.phamVi.length, t).toBeGreaterThan(10);
    }
  });
  it("node hạng doc / ot mà khai 'khong' phải là node ngoài (HTTP) có danh sách trắng — còn lại phải khai trục lọc", () => {
    for (const n of danhSachNut()) {
      const v = KHOA_PHAM_VI_NUT[n.type];
      if ((n.tacDungPhu === "doc" || n.tacDungPhu === "ot") && v?.kieu === "khong") expect(n.type, `${n.type}: hạng ${n.tacDungPhu} phải khai 'loc'`).toMatch(/^tich-hop\.http/);
    }
  });
});
