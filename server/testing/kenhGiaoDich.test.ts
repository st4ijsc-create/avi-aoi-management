/**
 * HÀNH VI của kênh giao dịch ROLLBACK (không DB): trong ca ⇒ giao dịch; ngoài ca ⇒ null + GHI LẠI; `kiemKhongLot` làm ca ĐỎ có tên khi có lời gọi lọt ra ngoài.
 * ĐỘT BIẾN PHẢI BẮT: ngoài giao dịch vẫn trả một kết nối thật · ngoài giao dịch im lặng (không ghi lại) · kiemKhongLot không ném · không xoá sổ sau khi ném · trong giao dịch cũng ghi lại ·
 * thông báo không nêu số lần / nơi gọi.
 */
import { describe, expect, it } from "vitest";
import { kiemKhongLot, layDbTheoKenh, type KenhGiaoDich } from "./kenhGiaoDich";

const kenhMoi = (): KenhGiaoDich => ({ db: null, lot: [] });
const TX = { ten: "giao-dich-gia" };

describe("kenhGiaoDich — getDb ngoài giao dịch ⇒ null + ĐỎ có tên", () => {
  it("★★★ TRONG giao dịch: trả CHÍNH giao dịch, không ghi lại gì, kiemKhongLot không ném", () => {
    const k = kenhMoi();
    k.db = TX;
    expect(layDbTheoKenh(k)).toBe(TX);
    expect(layDbTheoKenh(k)).toBe(TX);
    expect(k.lot).toEqual([]);
    expect(() => kiemKhongLot(k)).not.toThrow();
  });
  it("★★★ NGOÀI giao dịch: trả null (không kết nối nào để ghi) VÀ ghi lại lời gọi; kiemKhongLot ném, nêu số lần + nơi gọi", () => {
    const k = kenhMoi();
    expect(layDbTheoKenh(k)).toBeNull();
    expect(layDbTheoKenh(k)).toBeNull();
    expect(k.lot).toHaveLength(2);
    expect(() => kiemKhongLot(k)).toThrow(/NGOÀI giao dịch ROLLBACK 2 lần/);
    k.db = null;
    layDbTheoKenh(k);
    try {
      kiemKhongLot(k);
    } catch (e) {
      expect(String((e as Error).message)).toContain("Nơi gọi đầu tiên:");
      expect(String((e as Error).message)).toContain("kenhGiaoDich.test.ts"); // ngăn xếp nêu CHỖ GỌI (tệp test này), không chỉ nội bộ helper
    }
  });
  it("★★★ ném MỘT lần rồi xoá sổ: lần kiểm kế không ném nếu không có lời gọi mới; có lời gọi mới thì ném lại", () => {
    const k = kenhMoi();
    layDbTheoKenh(k);
    expect(() => kiemKhongLot(k)).toThrow();
    expect(k.lot).toEqual([]);
    expect(() => kiemKhongLot(k)).not.toThrow();
    layDbTheoKenh(k);
    expect(() => kiemKhongLot(k)).toThrow(/1 lần/);
  });
  it("★★★ ca kết thúc (kênh trả về null) rồi MỘT lời gọi muộn (việc nền) ⇒ ĐỎ ở lần kiểm kế, KHÔNG rơi vào giao dịch cũ đã hoàn tác", () => {
    const k = kenhMoi();
    k.db = TX;
    expect(layDbTheoKenh(k)).toBe(TX);
    k.db = null; // finally của ca
    expect(layDbTheoKenh(k)).toBeNull();
    expect(() => kiemKhongLot(k)).toThrow(/1 lần/);
  });
  it("★★ `db = undefined` cũng coi là NGOÀI giao dịch", () => {
    const k: KenhGiaoDich = { db: undefined, lot: [] };
    expect(layDbTheoKenh(k)).toBeNull();
    expect(k.lot).toHaveLength(1);
  });
});
