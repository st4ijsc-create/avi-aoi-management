import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CHINH_SACH_NHAN_MAC_DINH,
  KHOA_UU_TIEN_NHAN,
  chiNhanBatThuongTu,
  chinhSachNhanHieuLuc,
  docUuTienNhan,
  ghiUuTienNhan,
  thuSauKhiDoiChinhSach,
} from "./chinhSachNhan";
import { PANEL_THU_DUOC, docThu, ghiThu } from "./duongDanTwin";

const kho = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("Đợt 45 mục 4 — chính sách nhãn: URL > đã nhớ > mặc định (chỉ bất thường)", () => {
  it("★★★ MẶC ĐỊNH ĐỔI: URL trơn + chưa nhớ gì ⇒ chỉ nhãn bất thường", () => {
    expect(CHINH_SACH_NHAN_MAC_DINH).toBe("batThuong");
    expect(chinhSachNhanHieuLuc([], null)).toBe("batThuong");
    expect(chiNhanBatThuongTu([], null)).toBe(true);
  });
  it("URL `nhanTatCa` thắng mọi thứ; `nhanBatThuong` (link cũ) vẫn đọc được", () => {
    expect(chinhSachNhanHieuLuc(["nhanTatCa"], "batThuong")).toBe("tatCa");
    expect(chinhSachNhanHieuLuc(["nhanBatThuong"], "tatCa")).toBe("batThuong");
    expect(chinhSachNhanHieuLuc(["nhanTatCa", "nhanBatThuong"], null)).toBe("tatCa");
  });
  it("URL im ⇒ theo lựa chọn đã nhớ", () => {
    expect(chinhSachNhanHieuLuc(["kpi"], "tatCa")).toBe("tatCa");
    expect(chinhSachNhanHieuLuc(["kpi"], "batThuong")).toBe("batThuong");
  });
  it("đọc/ghi localStorage: rác ⇒ null, storage ném ⇒ null/không nổ", () => {
    const k = kho();
    expect(docUuTienNhan(k)).toBeNull();
    ghiUuTienNhan(k, "tatCa");
    expect(k.m.get(KHOA_UU_TIEN_NHAN)).toBe("tatCa");
    expect(docUuTienNhan(k)).toBe("tatCa");
    k.m.set(KHOA_UU_TIEN_NHAN, "rac");
    expect(docUuTienNhan(k)).toBeNull();
    const nem = { getItem: () => { throw new Error("private"); }, setItem: () => { throw new Error("quota"); } };
    expect(docUuTienNhan(nem)).toBeNull();
    expect(() => ghiUuTienNhan(nem, "tatCa")).not.toThrow();
    expect(docUuTienNhan(null)).toBeNull();
  });
  it("đổi chính sách ⇒ đúng MỘT tên tường minh, giữ các tên khác, khứ hồi qua ghiThu/docThu", () => {
    expect(thuSauKhiDoiChinhSach(["trai", "nhanBatThuong"], "tatCa")).toEqual(["trai", "nhanTatCa"]);
    expect(thuSauKhiDoiChinhSach(["nhanTatCa", "kpi"], "batThuong")).toEqual(["kpi", "nhanBatThuong"]);
    expect(docThu(ghiThu(thuSauKhiDoiChinhSach([], "tatCa")))).toContain("nhanTatCa");
  });
  it("★ G67 — `nhanTatCa` nằm trong PANEL_THU_DUOC, `docThu` không nuốt", () => {
    expect(PANEL_THU_DUOC).toContain("nhanTatCa");
    expect(docThu("nhanTatCa")).toEqual(["nhanTatCa"]);
  });
  it("★ G16 — `TwinVanHanh` GỌI `chiNhanBatThuongTu` (không còn `thu.includes(\"nhanBatThuong\")` trần)", () => {
    const src = readFileSync(new URL("../../../pages/TwinVanHanh.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/chiNhanBatThuongTu\(/);
    expect(src).toMatch(/thuSauKhiDoiChinhSach\(/);
    expect(src).toMatch(/ghiUuTienNhan\(/);
    expect(src).not.toMatch(/const chiNhanBatThuong = urlState\.thu\.includes\("nhanBatThuong"\)/);
  });
});
