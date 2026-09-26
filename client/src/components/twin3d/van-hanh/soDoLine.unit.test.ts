/**
 * soDoLine.unit.test.ts — lưới cho bố cục SƠ ĐỒ của màn Line.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CA NGHỊCH LÀ PHẦN QUAN TRỌNG NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * Một bản cài "xếp tất cả vào một lưới vuông" thoả gần hết ca thuận. Nên tệp này đòi thêm:
 *   · lưới phải **đổi hình** theo tỉ lệ khung (khung dẹt ⇒ nhiều cột hơn) — không phải một hằng;
 *   · **rắn bò**, không phải quét-lại-từ-trái: hai máy liền kề trong dòng chảy phải liền kề trên
 *     màn **kể cả ở chỗ xuống hàng**;
 *   · luật "một thang, không pha trộn": thiếu `thuTu` ở DÙ MỘT máy ⇒ rơi HẲN về thứ tự vị trí;
 *   · `viTri.y` giữ nguyên — quy ước ĐÁY. ★ Đây là ca viết ra vì `cumTram` đã mắc đúng lỗi ngược
 *     lại (`caoM/2`) và **lưới của chính nó xanh vì nó ghim cái sai ấy**.
 */
import { describe, expect, it } from "vitest";

import {
  O_TOI_THIEU_M,
  apSoDoVaoMay,
  dungSoDoLine,
  hopBaoSoDo,
  soCotSoDo,
} from "./soDoLine";
import type { MayTrongLo } from "../loi/LoBatchMay";

function may(
  id: number,
  x: number,
  z: number,
  co = 2,
  y = 0,
): MayTrongLo {
  return {
    machineId: id,
    khoi: "tram_chung" as MayTrongLo["khoi"],
    kichThuocMm: { rongMm: co * 1000, sauMm: co * 1000, caoMm: 1800 },
    viTri: { x, y, z },
    gocXoayRad: 0.7,
    mau: "#22c55e",
  };
}

/** Chuyền THẬT: 39 máy trên một dải dài — đúng hình dạng đã đo ở `/twin/line/526`. */
function chuyenDai(n = 39): MayTrongLo[] {
  return Array.from({ length: n }, (_, i) => may(100 + i, i * 5.2, 0));
}

const KHONG_CO_THU_TU = new Map<number, number | null>();

describe("soCotSoDo", () => {
  it("★★★ bám tỉ lệ khung: 39 máy trên khung 16/9 ⇒ 8 cột (lưới 8×5 ≈ 1,6 so với 1,78)", () => {
    expect(soCotSoDo(39, 16 / 9)).toBe(8);
  });

  it("★★★ CA NGHỊCH — khung DẸT hơn ⇒ NHIỀU cột hơn (không phải một hằng)", () => {
    expect(soCotSoDo(39, 4)).toBeGreaterThan(soCotSoDo(39, 16 / 9));
    expect(soCotSoDo(39, 0.5)).toBeLessThan(soCotSoDo(39, 16 / 9));
  });

  it("★★★ tham số rác ⇒ rơi về 16/9, KHÔNG ra NaN (một NaN ở đây làm cảnh trống mà không lỗi)", () => {
    for (const rac of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY]) {
      expect(soCotSoDo(39, rac)).toBe(soCotSoDo(39, 16 / 9));
    }
    expect(Number.isFinite(soCotSoDo(39, Number.NaN))).toBe(true);
  });

  it("★ n rác / n ≤ 0 ⇒ 0 cột, và cột không bao giờ vượt n", () => {
    expect(soCotSoDo(0, 2)).toBe(0);
    expect(soCotSoDo(Number.NaN, 2)).toBe(0);
    expect(soCotSoDo(1, 100)).toBe(1);
    expect(soCotSoDo(3, 100)).toBeLessThanOrEqual(3);
  });
});

describe("dungSoDoLine — hình dạng lưới", () => {
  it("★★★ KẾT CỤC ĐANG CHỮA: dải 130:1 thành lưới lấp CẢ HAI chiều", () => {
    const ds = chuyenDai();
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { tiLeKhung: 1280 / 720 })!;
    // Trước: 39 máy dài 200 m × sâu 2 m ⇒ 100:1, chiều cao canvas bỏ không.
    expect(sd.thatRongM / sd.thatSauM).toBeGreaterThan(50);
    // Sau: tỉ lệ lưới bám tỉ lệ khung trong vòng ±35 %.
    const tiLeLuoi = sd.rongM / sd.sauM;
    expect(tiLeLuoi).toBeGreaterThan((1280 / 720) * 0.65);
    expect(tiLeLuoi).toBeLessThan((1280 / 720) * 1.35);
  });

  it("★★★ tập RỖNG ⇒ null (trải sơ đồ cho 0 máy là vẽ ra một chuyền không có)", () => {
    expect(dungSoDoLine([], KHONG_CO_THU_TU)).toBeNull();
  });

  it("★★★ KHÔNG mất máy nào, KHÔNG nhân đôi máy nào", () => {
    const ds = chuyenDai();
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU)!;
    expect(sd.thuTu).toHaveLength(ds.length);
    expect(new Set(sd.thuTu).size).toBe(ds.length);
    expect(sd.viTriMoi.size).toBe(ds.length);
    expect(sd.duongTam).toHaveLength(ds.length);
    for (const m of ds) expect(sd.viTriMoi.has(m.machineId)).toBe(true);
  });

  it("★ lưới đủ chỗ cho mọi máy: cột × hàng ≥ n, và hàng là số hàng NHỎ NHẤT đủ chứa", () => {
    for (const n of [1, 2, 7, 39, 120]) {
      const sd = dungSoDoLine(chuyenDai(n), KHONG_CO_THU_TU, { tiLeKhung: 16 / 9 })!;
      expect(sd.cot * sd.hang).toBeGreaterThanOrEqual(n);
      expect(sd.cot * (sd.hang - 1)).toBeLessThan(n);
    }
  });

  it("★★★ CA NGHỊCH — đổi tỉ lệ khung thì lưới PHẢI đổi hình (ghim `tiLeKhung` được dùng thật)", () => {
    const ds = chuyenDai();
    const dep = dungSoDoLine(ds, KHONG_CO_THU_TU, { tiLeKhung: 0.5 })!;
    const rong = dungSoDoLine(ds, KHONG_CO_THU_TU, { tiLeKhung: 4 })!;
    expect(rong.cot).toBeGreaterThan(dep.cot);
    expect(rong.hang).toBeLessThan(dep.hang);
  });

  it("★★★ `heSoNghieng` PHẢI đi vào phép chia cột — nếu không, cặp camera/lưới lệch mà không ai đỏ", () => {
    const ds = chuyenDai();
    const thuong = dungSoDoLine(ds, KHONG_CO_THU_TU, { tiLeKhung: 16 / 9 })!;
    const bu = dungSoDoLine(ds, KHONG_CO_THU_TU, { tiLeKhung: 16 / 9, heSoNghieng: 4 })!;
    expect(bu.cot).toBeGreaterThan(thuong.cot);
    // ⚠ hệ số rác KHÔNG được làm đổ: rơi về mặc định.
    const rac = dungSoDoLine(ds, KHONG_CO_THU_TU, { tiLeKhung: 16 / 9, heSoNghieng: Number.NaN })!;
    expect(rac.cot).toBe(thuong.cot);
  });

  it("★ `epCot` thắng phép chia (đường mà ablation/phép đo dùng), và bị kẹp vào n", () => {
    const ds = chuyenDai();
    expect(dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 3 })!.cot).toBe(3);
    expect(dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 500 })!.cot).toBe(ds.length);
    expect(dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 0 })!.cot).toBe(
      dungSoDoLine(ds, KHONG_CO_THU_TU)!.cot,
    );
  });
});

describe("dungSoDoLine — RẮN BÒ", () => {
  it("★★★ hai máy LIỀN KỀ trong dòng chảy thì LIỀN KỀ trên màn — kể cả ở chỗ xuống hàng", () => {
    const ds = chuyenDai();
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { tiLeKhung: 16 / 9 })!;
    let soLanXuongHang = 0;
    for (let k = 0; k + 1 < sd.thuTu.length; k += 1) {
      const a = sd.viTriMoi.get(sd.thuTu[k])!;
      const b = sd.viTriMoi.get(sd.thuTu[k + 1])!;
      const dx = Math.abs(b.x - a.x) / sd.buocXM;
      const dz = Math.abs(b.z - a.z) / sd.buocZM;
      // Đúng MỘT bước: sang ngang một ô (dx=1, dz=0) hoặc xuống hàng tại chỗ (dx=0, dz=1).
      expect(dx + dz).toBeCloseTo(1, 6);
      if (dz > 0.5) soLanXuongHang += 1;
    }
    // Và phải CÓ chỗ xuống hàng — nếu không thì ca này đang đo một lưới một hàng.
    expect(soLanXuongHang).toBe(sd.hang - 1);
  });

  it("★★★ CA NGHỊCH của rắn bò — hàng LẺ chạy NGƯỢC chiều hàng chẵn", () => {
    const sd = dungSoDoLine(chuyenDai(12), KHONG_CO_THU_TU, { epCot: 4 })!;
    const x = sd.thuTu.map((id) => sd.viTriMoi.get(id)!.x);
    // hàng 0: tăng dần …
    expect(x[1]).toBeGreaterThan(x[0]);
    expect(x[3]).toBeGreaterThan(x[2]);
    // … hàng 1: GIẢM dần (quét-lại-từ-trái sẽ làm ca này đỏ).
    expect(x[5]).toBeLessThan(x[4]);
    expect(x[7]).toBeLessThan(x[6]);
    // hàng 2: tăng lại.
    expect(x[9]).toBeGreaterThan(x[8]);
  });

  it("★ `duongTam` đi ĐÚNG đường rắn ấy (mũi tên dòng chảy không được vẽ một đường khác)", () => {
    const sd = dungSoDoLine(chuyenDai(12), KHONG_CO_THU_TU, { epCot: 4 })!;
    sd.thuTu.forEach((id, k) => {
      const o = sd.viTriMoi.get(id)!;
      expect(sd.duongTam[k].x).toBeCloseTo(o.x, 9);
      expect(sd.duongTam[k].z).toBeCloseTo(o.z, 9);
    });
  });

  it("★ hàng cuối thiếu ô ⇒ vẫn không có bước nhảy nào >1 ô", () => {
    const sd = dungSoDoLine(chuyenDai(10), KHONG_CO_THU_TU, { epCot: 4 })!;
    expect(sd.hang).toBe(3);
    for (let k = 0; k + 1 < sd.thuTu.length; k += 1) {
      const a = sd.viTriMoi.get(sd.thuTu[k])!;
      const b = sd.viTriMoi.get(sd.thuTu[k + 1])!;
      expect(Math.abs(b.x - a.x) / sd.buocXM + Math.abs(b.z - a.z) / sd.buocZM).toBeCloseTo(1, 6);
    }
  });
});

describe("dungSoDoLine — THỨ TỰ: một thang, không pha trộn", () => {
  const bonMay = [may(1, 0, 0), may(2, 10, 0), may(3, 20, 0), may(4, 30, 0)];

  it("★★★ MỌI máy tra được `thuTu` ⇒ dùng trình tự TRẠM, kể cả khi nó ngược với vị trí", () => {
    const tt = new Map<number, number | null>([[1, 4], [2, 3], [3, 2], [4, 1]]);
    const sd = dungSoDoLine(bonMay, tt, { epCot: 4 })!;
    expect(sd.theoThuTuTram).toBe(true);
    expect(sd.thuTu).toEqual([4, 3, 2, 1]);
  });

  it("★★★ THIẾU DÙ MỘT máy ⇒ rơi HẲN về vị trí, KHÔNG xếp máy-có-thứ-tự lên trước", () => {
    // Nếu trộn hai thang (null xuống cuối) thì kết quả sẽ là [4,3,2,1]; luật đúng cho [1,2,3,4].
    const tt = new Map<number, number | null>([[2, 3], [3, 2], [4, 1]]);
    const sd = dungSoDoLine(bonMay, tt, { epCot: 4 })!;
    expect(sd.theoThuTuTram).toBe(false);
    expect(sd.thuTu).toEqual([1, 2, 3, 4]);
  });

  it("★ `thuTu` rác (NaN/undefined) tính là THIẾU, không tính là 0", () => {
    const tt = new Map<number, number | null>([[1, Number.NaN], [2, 3], [3, 2], [4, 1]]);
    const sd = dungSoDoLine(bonMay, tt, { epCot: 4 })!;
    expect(sd.theoThuTuTram).toBe(false);
    expect(sd.thuTu).toEqual([1, 2, 3, 4]);
  });

  it("★★ TRONG một trạm (cùng `thuTu`) vẫn xếp theo vị trí, rồi chốt bằng id — ỔN ĐỊNH", () => {
    const ds = [may(9, 30, 0), may(7, 10, 0), may(8, 20, 0)];
    const tt = new Map<number, number | null>([[7, 1], [8, 1], [9, 1]]);
    expect(dungSoDoLine(ds, tt, { epCot: 3 })!.thuTu).toEqual([7, 8, 9]);
    // Đảo thứ tự MẢNG VÀO ⇒ kết quả KHÔNG đổi (nếu không, cảnh nhảy mỗi lần tải lại).
    expect(dungSoDoLine([...ds].reverse(), tt, { epCot: 3 })!.thuTu).toEqual([7, 8, 9]);
  });

  it("★★ trùng HOÀN TOÀN vị trí ⇒ chốt bằng machineId (không có hai lần tải khác nhau)", () => {
    const ds = [may(30, 5, 5), may(10, 5, 5), may(20, 5, 5)];
    expect(dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 3 })!.thuTu).toEqual([10, 20, 30]);
  });

  it("★★★ trục chính THẬT quyết chiều xếp: dải dọc trục Z ⇒ xếp theo z, không theo x", () => {
    const ds = [may(1, 0, 30), may(2, 0, 10), may(3, 0, 20)];
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 3 })!;
    expect(sd.trucThat).toBe("Z");
    expect(sd.thuTu).toEqual([2, 3, 1]);
  });
});

describe("dungSoDoLine — SỰ THẬT ĐÃ BỊ THAY, và thứ KHÔNG bị thay", () => {
  it("★★★ giữ `thatRongM`/`thatSauM` của bố cục THẬT (banner nêu cả hai vế)", () => {
    // 3 máy cạnh 2 m tại x = 0, 100, 200 ⇒ bề rộng thân-tới-thân = 202 m.
    const sd = dungSoDoLine([may(1, 0, 0), may(2, 100, 0), may(3, 200, 0)], KHONG_CO_THU_TU)!;
    expect(sd.thatRongM).toBeCloseTo(202, 6);
    expect(sd.thatSauM).toBeCloseTo(2, 6);
    expect(sd.laSoDo).toBe(true);
  });

  it("★★★ giữ cạnh THẬT nhỏ nhất/lớn nhất — con số để người đọc tự thấy có méo hay không", () => {
    const sd = dungSoDoLine(
      [may(1, 0, 0, 1), may(2, 10, 0, 4), may(3, 20, 0, 9)],
      KHONG_CO_THU_TU,
    )!;
    expect(sd.thatCanhNhoM).toBeCloseTo(1, 6);
    expect(sd.thatCanhLonM).toBeCloseTo(9, 6);
    // Mặt bằng vẽ = TRUNG VỊ (4), không phải min/max/trung bình.
    expect(sd.oRongM).toBeCloseTo(4, 6);
    expect(sd.oSauM).toBeCloseTo(4, 6);
  });

  it("★★★ QUY ƯỚC ĐÁY — `viTri.y` GIỮ NGUYÊN của chính máy đó, KHÔNG thành `caoM/2`", () => {
    // Ca này viết ra vì `cumTram` đã mắc đúng lỗi ngược lại và lưới của nó ghim cái sai ấy.
    const ds = [may(1, 0, 0, 2, 0), may(2, 10, 0, 2, 7.5), may(3, 20, 0, 2, 7.5)];
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU)!;
    expect(sd.viTriMoi.get(1)!.y).toBe(0);
    expect(sd.viTriMoi.get(2)!.y).toBe(7.5);
    expect(sd.viTriMoi.get(3)!.y).toBe(7.5);
  });

  it("★ máy tí hon vẫn có ô DƯƠNG (không co về 0, không chia cho 0)", () => {
    const sd = dungSoDoLine([may(1, 0, 0, 0), may(2, 1, 0, 0)], KHONG_CO_THU_TU)!;
    expect(sd.oRongM).toBe(O_TOI_THIEU_M);
    expect(sd.buocXM).toBeGreaterThan(0);
    expect(Number.isFinite(sd.rongM)).toBe(true);
  });

  it("★ MỘT máy duy nhất ⇒ lưới 1×1, mọi số hữu hạn", () => {
    const sd = dungSoDoLine([may(1, 3, 4)], KHONG_CO_THU_TU)!;
    expect(sd.cot).toBe(1);
    expect(sd.hang).toBe(1);
    expect(Number.isFinite(sd.viTriMoi.get(1)!.x)).toBe(true);
    expect(Number.isFinite(sd.viTriMoi.get(1)!.z)).toBe(true);
  });

  it("★★ sơ đồ NEO vào tâm bố cục thật (cảnh không nhảy sang một góc khác của sàn)", () => {
    const ds = [may(1, 1000, 500), may(2, 1010, 500), may(3, 1020, 500)];
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 3 })!;
    const tbX = sd.thuTu.reduce((a, id) => a + sd.viTriMoi.get(id)!.x, 0) / 3;
    expect(tbX).toBeCloseTo(1010, 6);
  });
});

describe("apSoDoVaoMay", () => {
  const ds = [may(1, 0, 0, 3), may(2, 50, 0, 9)];

  it("★★★ đổi vị trí + mặt bằng + góc xoay; GIỮ chiều cao, màu, id", () => {
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 2 })!;
    const ra = apSoDoVaoMay(ds, sd);
    expect(ra).toHaveLength(2);
    for (const m of ra) {
      expect(m.kichThuocMm.caoMm).toBe(1800);
      expect(m.gocXoayRad).toBe(0);
      expect(m.kichThuocMm.rongMm).toBeCloseTo(sd.oRongM * 1000, 6);
      expect(m.kichThuocMm.sauMm).toBeCloseTo(sd.oSauM * 1000, 6);
      expect(m.mau).toBe("#22c55e");
      expect(m.viTri).toEqual(sd.viTriMoi.get(m.machineId));
    }
    expect(ra.map((m) => m.machineId).sort()).toEqual([1, 2]);
  });

  it("★★★ `null` ⇒ trả NGUYÊN danh sách (không ném, không rỗng)", () => {
    const ra = apSoDoVaoMay(ds, null);
    expect(ra).toHaveLength(2);
    expect(ra[0].viTri).toEqual(ds[0].viTri);
    expect(ra[0].gocXoayRad).toBe(0.7);
  });

  it("★★★ máy KHÔNG có trong sơ đồ ⇒ GIỮ NGUYÊN, không bị bỏ im lặng (lớp lỗi F2)", () => {
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 2 })!;
    const laSau = may(99, 7, 7, 3);
    const ra = apSoDoVaoMay([...ds, laSau], sd);
    expect(ra).toHaveLength(3);
    const con = ra.find((m) => m.machineId === 99)!;
    /*
     * ★★★ Khẳng định là ĐỒNG NHẤT THỰC THỂ, không phải "có mặt trong mảng".
     *   Bản đầu của ca này chỉ so `viTri`/`gocXoayRad`, và một đột biến trả
     *   `{ ...m, hien: false }` **sống sót**: máy vẫn nằm trong mảng, vẫn đúng toạ độ, và
     *   **biến mất khỏi cảnh**. Đó đúng là lớp lỗi F2 mà ca này được viết ra để chặn — nó
     *   đo nhầm tính chất. Đồng nhất thực thể đóng mọi lối: không cờ ẩn, không cỡ đổi.
     */
    expect(con).toBe(laSau);
    expect(con.hien).not.toBe(false);
  });

  it("★ KHÔNG sửa tại chỗ mảng/đối tượng vào (memo phía trên so tham chiếu)", () => {
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 2 })!;
    apSoDoVaoMay(ds, sd);
    expect(ds[0].gocXoayRad).toBe(0.7);
    expect(ds[0].viTri).toEqual({ x: 0, y: 0, z: 0 });
    expect(ds[1].kichThuocMm.rongMm).toBe(9000);
  });
});

describe("hopBaoSoDo — hộp bao theo THÂN máy, không theo tâm", () => {
  it("★★★ KẾT CỤC ĐANG CHỮA: bao cả nửa mặt bằng hai bên, không dừng ở tâm ô rìa", () => {
    const ds = [may(1, 0, 0, 4), may(2, 20, 0, 4), may(3, 40, 0, 4)];
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 3 })!;
    const hb = hopBaoSoDo(sd, ds);
    const xs = sd.thuTu.map((id) => sd.viTriMoi.get(id)!.x);
    expect(hb.minX).toBeCloseTo(Math.min(...xs) - sd.oRongM / 2, 9);
    expect(hb.maxX).toBeCloseTo(Math.max(...xs) + sd.oRongM / 2, 9);
    // …và bề rộng hộp bao PHẢI lớn hơn bề rộng tâm-tới-tâm đúng một mặt bằng.
    expect(hb.maxX - hb.minX).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + sd.oRongM, 9);
  });

  it("★★★ bao CHIỀU CAO THẬT cao nhất của tập (khối cao nhất không bị cắt nóc)", () => {
    const ds = [may(1, 0, 0, 2), may(2, 10, 0, 2), may(3, 20, 0, 2)];
    ds[1].kichThuocMm.caoMm = 9_000; // một khối 9 m giữa đám 1,8 m
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 3 })!;
    const hb = hopBaoSoDo(sd, ds);
    expect(hb.maxY - hb.minY).toBeCloseTo(9, 9);
  });

  it("★★★ `minY` = MẶT PHẲNG MÁY, không phải 0 — máy trên tầng 3 thì hộp bao cũng ở tầng 3", () => {
    const ds = [may(1, 0, 0, 2, 16.6), may(2, 10, 0, 2, 16.6)];
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 2 })!;
    expect(sd.yMatPhangM).toBeCloseTo(16.6, 9);
    expect(hopBaoSoDo(sd, ds).minY).toBeCloseTo(16.6, 9);
  });

  it("★ mọi số hữu hạn kể cả khi danh sách máy rỗng (cỡ cao = 0, hộp vẫn có bề rộng)", () => {
    const ds = [may(1, 0, 0, 2), may(2, 10, 0, 2)];
    const sd = dungSoDoLine(ds, KHONG_CO_THU_TU, { epCot: 2 })!;
    const hb = hopBaoSoDo(sd, []);
    for (const v of Object.values(hb)) expect(Number.isFinite(v)).toBe(true);
    expect(hb.maxX).toBeGreaterThan(hb.minX);
  });
});
