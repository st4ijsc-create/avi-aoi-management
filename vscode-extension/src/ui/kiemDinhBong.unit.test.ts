/**
 * ★★★ 0.6.0 (E1) — điều phối `chayKiemDinhBong` bằng phụ thuộc tiêm: thứ tự xem trước → modal → chạy; mọi nhánh dừng KHÔNG gọi `chay`.
 */
import { describe, expect, it } from "vitest";
import { chayKiemDinhBong, thongDiepLoiKiemDinh, type PhuThuocKiemDinhBong } from "./kiemDinhBong";

const M = { ma: "ngoai:a:x", nhan: "X", moTa: "" };
const XT = { duocPhep: true, mucDuLieu: "van-hanh", tokenUoc: 1, chiPhiUocUsd: null, nhaCungCap: "a", model: "x", trichTraLoi: "t", doDaiTraLoi: 1 };
const KQ = { ketQua: { ketLuan: "dat", diem: 90, loi: [], baiHocDeXuat: [] }, vet: { nhaCungCap: "a", model: "x" } };

function dung(sua: Partial<PhuThuocKiemDinhBong> = {}) {
  const goi: string[] = [];
  const modal: unknown[] = [];
  const d: PhuThuocKiemDinhBong = {
    banGhi: { cauHoi: "q", traLoi: "a" },
    layDanhMuc: async () => [M],
    chonModel: async (ds) => ds[0],
    goi: async (ten) => {
      goi.push(ten);
      return { ok: true, du: ten === "aiKiemDinh.xemTruoc" ? XT : KQ };
    },
    hoiDongY: async (nd) => {
      modal.push(nd);
      return true;
    },
    baoTrangThai: () => undefined,
    ...sua,
  };
  return { d, goi, modal };
}

describe("chayKiemDinhBong", () => {
  it("★★★ đường thường: xemTruoc → modal → chay → xong", async () => {
    const t = dung();
    const kc = await chayKiemDinhBong(t.d);
    expect(kc.loai).toBe("xong");
    expect(t.goi).toEqual(["aiKiemDinh.xemTruoc", "aiKiemDinh.chay"]);
    expect(t.modal).toHaveLength(1);
  });
  it("★★★ bản ghi vắng / trả lời rỗng ⇒ bo-qua, không gọi gì", async () => {
    for (const banGhi of [undefined, { cauHoi: "q", traLoi: "  " }]) {
      const t = dung({ banGhi });
      expect(await chayKiemDinhBong(t.d)).toEqual({ loai: "bo-qua" });
      expect(t.goi).toEqual([]);
    }
  });
  it("★★★ danh mục rỗng / hủy chọn / model ngoài danh mục ⇒ huy, không gọi máy chủ", async () => {
    for (const sua of [{ layDanhMuc: async () => [] }, { chonModel: async () => undefined }, { chonModel: async () => ({ ma: "ngoai:khac:y", nhan: "Y", moTa: "" }) }]) {
      const t = dung(sua);
      expect((await chayKiemDinhBong(t.d)).loai).toBe("huy");
      expect(t.goi).toEqual([]);
    }
  });
  it("★★★ từ chối modal ⇒ chỉ xemTruoc", async () => {
    const t = dung({ hoiDongY: async () => false });
    expect((await chayKiemDinhBong(t.d)).loai).toBe("huy");
    expect(t.goi).toEqual(["aiKiemDinh.xemTruoc"]);
  });
  it("★★ chay lỗi 401 ⇒ het401; kết quả sai hình dạng ⇒ lỗi", async () => {
    const t = dung({ goi: async (ten) => (ten === "aiKiemDinh.xemTruoc" ? { ok: true, du: XT } : { ok: false, status: 401, ma: null }) });
    expect(await chayKiemDinhBong(t.d)).toMatchObject({ loai: "loi", het401: true });
    const u = dung({ goi: async (ten) => ({ ok: true, du: ten === "aiKiemDinh.xemTruoc" ? XT : { ketQua: {} } }) });
    expect((await chayKiemDinhBong(u.d)).loai).toBe("loi");
  });
  it("★★ thông điệp lỗi theo mã (không bịa nguyên nhân cho mã lạ)", () => {
    expect(thongDiepLoiKiemDinh({ status: 413, ma: "NGOAI_QUA_LON" })).toContain("16 KB");
    expect(thongDiepLoiKiemDinh({ status: 409, ma: "NGOAI_DANG_CHAY" })).toContain("Đang có một lượt kiểm định");
    expect(thongDiepLoiKiemDinh({ status: 429, ma: "NGOAI_VUOT_TRAN" }, "nha-may")).toContain("trần trong ngày của nhà máy");
    expect(thongDiepLoiKiemDinh({ status: 400, ma: "NGOAI_LA_HOAC" })).toContain("NGOAI_LA_HOAC");
    expect(thongDiepLoiKiemDinh({ status: 500, ma: null })).toContain("HTTP 500");
  });
});
