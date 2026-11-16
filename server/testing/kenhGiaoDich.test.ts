/**
 * HÀNH VI của kênh giao dịch ROLLBACK (không DB): trong ca ⇒ giao dịch; ngoài ca ⇒ null + GHI LẠI; `kiemKhongLot` làm ca ĐỎ có tên khi có lời gọi lọt ra ngoài.
 * ĐỘT BIẾN PHẢI BẮT: ngoài giao dịch vẫn trả một kết nối thật · ngoài giao dịch im lặng (không ghi lại) · kiemKhongLot không ném · không xoá sổ sau khi ném · trong giao dịch cũng ghi lại ·
 * thông báo không nêu số lần / nơi gọi.
 */
import { describe, expect, it } from "vitest";
import { RollbackPhatLai, ghiNoiKhac, kiemKhongLot, layDbTheoKenh, nuotRollback, type KenhGiaoDich } from "./kenhGiaoDich";

const kenhMoi = (): KenhGiaoDich => ({ db: null, lot: [] });
const TX = { ten: "giao-dich-gia" };

describe("nuotRollback — CHỈ nuốt RollbackPhatLai; mọi lỗi khác phải lan ra (không xanh giả)", () => {
  it("★★★ RollbackPhatLai ⇒ KHÔNG ném (đích của ROLLBACK)", () => {
    expect(() => nuotRollback(new RollbackPhatLai())).not.toThrow();
  });
  it("★★★ MỘT `expect` hỏng / lỗi bất kỳ ⇒ ném LẠI đúng lỗi đó (ca đỏ), kể cả Error thường, TypeError, và chuỗi / giá trị lạ", () => {
    let loiExpect: unknown;
    try {
      expect(1, "lệch giả").toBe(2);
    } catch (e) {
      loiExpect = e;
    }
    expect(() => nuotRollback(loiExpect)).toThrow(/lệch giả|expected 1 to be 2/);
    const te = new TypeError("lỗi của ca");
    expect(() => nuotRollback(te)).toThrow(te);
    expect(() => nuotRollback(new Error("mất kết nối"))).toThrow("mất kết nối");
    expect(() => nuotRollback("chuỗi")).toThrow();
    expect(() => nuotRollback(undefined)).toThrow();
  });
  it("★★ chỉ ĐÚNG lớp RollbackPhatLai: một lỗi khác tên 'Rollback…' không đủ", () => {
    class RollbackGia extends Error {}
    expect(() => nuotRollback(new RollbackGia("không phải của helper"))).toThrow(RollbackGia);
  });
  it("★★ mô phỏng vòng `try { transaction(…throw Rollback) } catch (e) { nuotRollback(e) }`: expect hỏng trong thân LAN RA, thân sạch thì KHÔNG ném", async () => {
    const chay = async (than: () => Promise<void>) => {
      try {
        await (async () => {
          await than();
          throw new RollbackPhatLai();
        })();
      } catch (e) {
        nuotRollback(e);
      }
    };
    await expect(chay(async () => undefined)).resolves.toBeUndefined();
    await expect(
      chay(async () => {
        expect("a").toBe("b");
      }),
    ).rejects.toThrow();
  });
});

describe("ghiNoiKhac — các hàm lấy kết nối KHÁC `getDb`", () => {
  it("★★★ ghi lại TÊN hàm + nơi gọi, trả null, kể cả TRONG giao dịch; kiemKhongLot ném nêu tên", () => {
    const k = kenhMoi();
    k.db = TX;
    expect(ghiNoiKhac(k, "getJobsDb")).toBeNull();
    expect(ghiNoiKhac(k, "getReadDb")).toBeNull();
    expect(ghiNoiKhac(k, "openSessionClient")).toBeNull();
    expect(ghiNoiKhac(k, "getNotifyClient")).toBeNull();
    expect(k.lot).toHaveLength(4);
    expect(() => kiemKhongLot(k)).toThrow(/4 lần/);
    ghiNoiKhac(k, "getJobsDb");
    expect(() => kiemKhongLot(k)).toThrow(/getJobsDb:/);
  });
});

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
