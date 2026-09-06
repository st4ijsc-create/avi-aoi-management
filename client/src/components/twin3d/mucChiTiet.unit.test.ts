/**
 * mucChiTiet.unit.test.ts — spec §10B.3: bốn bậc LOD + trần cứng 8 GLB, thay theo LRU.
 */
import { describe, it, expect } from "vitest";
import {
  BoDemGlbLru,
  NGUONG_L0_MET,
  NGUONG_L1_MET,
  NGUONG_L2_MET,
  TRAN_GLB_DONG_THOI,
  bacTheoKhoangCach,
  chonMucChiTiet,
  type MayChoLod,
} from "./mucChiTiet";

const CAMERA = { x: 0, y: 0, z: 0 };

/** Máy đặt cách camera đúng `d` mét dọc trục X. */
function may(khoa: string, d: number, phu: Partial<MayChoLod> = {}): MayChoLod {
  return { khoa, viTri: { x: d, y: 0, z: 0 }, coModel: true, ...phu };
}

describe("mucChiTiet — bậc theo khoảng cách (bảng §10B.3)", () => {
  it("ngưỡng đúng như spec: 25 / 60 / 150 m", () => {
    expect(NGUONG_L0_MET).toBe(25);
    expect(NGUONG_L1_MET).toBe(60);
    expect(NGUONG_L2_MET).toBe(150);
    expect(TRAN_GLB_DONG_THOI).toBe(8);
  });

  it.each([
    [0, "L0"],
    [24.999, "L0"],
    [25, "L1"],
    [59.999, "L1"],
    [60, "L2"],
    [149.999, "L2"],
    [150, "L3"],
    [1000, "L3"],
  ] as const)("khoảng cách %s m -> %s", (d, bac) => {
    expect(bacTheoKhoangCach(d)).toBe(bac);
  });

  it("★ biên là CHẶT: đúng 25 m không còn là L0, đúng 150 m là L3", () => {
    expect(bacTheoKhoangCach(25)).not.toBe("L0");
    expect(bacTheoKhoangCach(150)).toBe("L3");
  });

  it("khoảng cách không hữu hạn -> L3, không ném lỗi", () => {
    expect(bacTheoKhoangCach(Number.NaN)).toBe("L3");
    expect(bacTheoKhoangCach(Infinity)).toBe("L3");
  });

  it("ngưỡng ghi đè được qua cấu hình", () => {
    expect(bacTheoKhoangCach(30, { nguongL0Met: 40 })).toBe("L0");
  });
});

describe("mucChiTiet — chonMucChiTiet", () => {
  it("danh sách rỗng -> kết quả rỗng, không ném lỗi", () => {
    const kq = chonMucChiTiet([], CAMERA);
    expect(kq.ketQua).toEqual([]);
    expect(kq.khoaL0).toEqual([]);
    expect(kq.demTheoBac).toEqual({ L0: 0, L1: 0, L2: 0, L3: 0 });
  });

  it("giữ NGUYÊN thứ tự đầu vào trong ketQua (tất định)", () => {
    const kq = chonMucChiTiet([may("c", 5), may("a", 10), may("b", 1)], CAMERA);
    expect(kq.ketQua.map((k) => k.khoa)).toEqual(["c", "a", "b"]);
  });

  it("phân bậc bốn mức theo khoảng cách", () => {
    const kq = chonMucChiTiet(
      [may("gan", 5), may("vua", 40), may("xa", 100), may("rat-xa", 500)],
      CAMERA,
    );
    expect(kq.theoKhoa.get("gan")).toBe("L0");
    expect(kq.theoKhoa.get("vua")).toBe("L1");
    expect(kq.theoKhoa.get("xa")).toBe("L2");
    expect(kq.theoKhoa.get("rat-xa")).toBe("L3");
    expect(kq.demTheoBac).toEqual({ L0: 1, L1: 1, L2: 1, L3: 1 });
  });

  it("★ TRẦN CỨNG: 12 máy đều rất gần -> đúng 8 máy L0, 4 máy còn lại HẠ về L1", () => {
    const ds = Array.from({ length: 12 }, (_, i) => may(`m${i}`, i + 1));
    const kq = chonMucChiTiet(ds, CAMERA);
    expect(kq.khoaL0).toHaveLength(TRAN_GLB_DONG_THOI);
    expect(kq.demTheoBac.L0).toBe(8);
    expect(kq.demTheoBac.L1).toBe(4);
    expect(kq.demTheoBac.L3).toBe(0);
  });

  it("★ 8 suất L0 thuộc về 8 máy GẦN NHẤT, không phải 8 máy đầu danh sách", () => {
    // Đảo thứ tự: máy xa xếp trước.
    const ds = [
      may("xa1", 20), may("xa2", 19), may("xa3", 18), may("xa4", 17),
      may("xa5", 16), may("xa6", 15), may("xa7", 14), may("xa8", 13),
      may("gan1", 1), may("gan2", 2), may("gan3", 3),
    ];
    const kq = chonMucChiTiet(ds, CAMERA);
    expect(kq.khoaL0).toContain("gan1");
    expect(kq.khoaL0).toContain("gan2");
    expect(kq.khoaL0).toContain("gan3");
    expect(kq.khoaL0).not.toContain("xa1");
  });

  it("★ tập L0 KHÔNG đổi khi đảo thứ tự đầu vào (tất định thật)", () => {
    const ds = Array.from({ length: 12 }, (_, i) => may(`m${i}`, i + 1));
    const xuoi = chonMucChiTiet(ds, CAMERA).khoaL0.slice().sort();
    const nguoc = chonMucChiTiet([...ds].reverse(), CAMERA).khoaL0.slice().sort();
    expect(nguoc).toEqual(xuoi);
  });

  it("★ hai máy cách camera BẰNG NHAU: chọn tất định theo khoá, không theo thứ tự", () => {
    const ds = [may("z", 5), may("a", 5), may("m", 5)];
    const kq = chonMucChiTiet(ds, CAMERA, { tranGlb: 2 });
    expect(kq.khoaL0.slice().sort()).toEqual(["a", "m"]);
  });

  it("★ máy KHÔNG có model không bao giờ chiếm suất L0 — nó xuống L1", () => {
    const kq = chonMucChiTiet(
      [may("khong-model", 1, { coModel: false }), may("co-model", 10)],
      CAMERA,
    );
    expect(kq.theoKhoa.get("khong-model")).toBe("L1");
    expect(kq.theoKhoa.get("co-model")).toBe("L0");
    expect(kq.khoaL0).toEqual(["co-model"]);
  });

  it("coModel không khai (undefined) coi như không có model", () => {
    const kq = chonMucChiTiet(
      [{ khoa: "x", viTri: { x: 1, y: 0, z: 0 } }],
      CAMERA,
    );
    expect(kq.theoKhoa.get("x")).toBe("L1");
  });

  it("★ ngoài khung nhìn -> L3 kể cả khi rất gần, và KHÔNG tốn suất GLB", () => {
    const ds = [
      may("khuat", 1, { ngoaiKhungNhin: true }),
      ...Array.from({ length: 8 }, (_, i) => may(`m${i}`, 10 + i)),
    ];
    const kq = chonMucChiTiet(ds, CAMERA);
    expect(kq.theoKhoa.get("khuat")).toBe("L3");
    expect(kq.khoaL0).toHaveLength(8);
    expect(kq.khoaL0).not.toContain("khuat");
  });

  it("★ máy bị hạ khỏi L0 vẫn ĐƯỢC VẼ (L1), không biến mất", () => {
    const ds = Array.from({ length: 20 }, (_, i) => may(`m${i}`, 1 + i * 0.1));
    const kq = chonMucChiTiet(ds, CAMERA);
    const khongVe = kq.ketQua.filter((k) => k.bac === "L3");
    expect(khongVe).toEqual([]);
  });

  it("khoảng cách đo bằng Euclid 3D, không chỉ mặt bằng", () => {
    const kq = chonMucChiTiet(
      [{ khoa: "cao", viTri: { x: 0, y: 30, z: 0 }, coModel: true }],
      CAMERA,
    );
    expect(kq.ketQua[0].khoangCachMet).toBeCloseTo(30, 9);
    expect(kq.ketQua[0].bac).toBe("L1");
  });

  it("giuSuatGlb đúng bằng (bac === L0)", () => {
    const kq = chonMucChiTiet([may("a", 1), may("b", 100)], CAMERA);
    for (const k of kq.ketQua) {
      expect(k.giuSuatGlb).toBe(k.bac === "L0");
    }
  });

  it("trần ghi đè được qua cấu hình", () => {
    const ds = Array.from({ length: 10 }, (_, i) => may(`m${i}`, i + 1));
    expect(chonMucChiTiet(ds, CAMERA, { tranGlb: 3 }).khoaL0).toHaveLength(3);
    expect(chonMucChiTiet(ds, CAMERA, { tranGlb: 0 }).demTheoBac.L0).toBe(0);
  });
});

describe("mucChiTiet — BoDemGlbLru", () => {
  it("trần mặc định là 8", () => {
    expect(new BoDemGlbLru().tranCung).toBe(TRAN_GLB_DONG_THOI);
  });

  it("nạp mới báo đúng trong daNap, lần hai không báo lại", () => {
    const bo = new BoDemGlbLru(4);
    expect(bo.capNhat(["a", "b"]).daNap).toEqual(["a", "b"]);
    expect(bo.capNhat(["a", "b"]).daNap).toEqual([]);
    expect(bo.soDangGiu).toBe(2);
    expect(bo.dangCo("a")).toBe(true);
    expect(bo.dangCo("z")).toBe(false);
  });

  it("★ vượt trần thì đẩy khoá LÂU NHẤT chưa dùng — và BÁO ra để dispose (RB-7)", () => {
    const bo = new BoDemGlbLru(3);
    bo.capNhat(["a"]);
    bo.capNhat(["b"]);
    bo.capNhat(["c"]);
    expect(bo.danhSachTheoLru()).toEqual(["a", "b", "c"]);
    // "a" lâu nhất chưa dùng -> bị đẩy khi "d" vào.
    const kq = bo.capNhat(["d"]);
    expect(kq.daDay).toEqual(["a"]);
    expect(kq.daNap).toEqual(["d"]);
    expect(bo.soDangGiu).toBe(3);
    expect(bo.dangCo("a")).toBe(false);
  });

  it("★ dùng lại một khoá làm nó TƯƠI, khoá khác bị đẩy thay", () => {
    const bo = new BoDemGlbLru(3);
    bo.capNhat(["a"]);
    bo.capNhat(["b"]);
    bo.capNhat(["c"]);
    bo.capNhat(["a"]); // a tươi lại -> b thành cũ nhất
    const kq = bo.capNhat(["d"]);
    expect(kq.daDay).toEqual(["b"]);
    expect(bo.dangCo("a")).toBe(true);
  });

  it("★ khoá ĐANG CẦN không bao giờ bị đẩy trong cùng lượt", () => {
    const bo = new BoDemGlbLru(3);
    bo.capNhat(["a", "b", "c"]);
    const kq = bo.capNhat(["a", "b", "c"]);
    expect(kq.daDay).toEqual([]);
    expect(bo.danhSachTheoLru().slice().sort()).toEqual(["a", "b", "c"]);
  });

  it("★ số khoá cần dùng vượt trần: chỉ nạp `tran` khoá đầu, không đẩy bừa", () => {
    const bo = new BoDemGlbLru(2);
    const kq = bo.capNhat(["a", "b", "c", "d"]);
    expect(bo.soDangGiu).toBe(2);
    expect(kq.daNap).toEqual(["a", "b"]);
    expect(bo.dangCo("c")).toBe(false);
  });

  it("★ số đang giữ KHÔNG BAO GIỜ vượt trần qua nhiều lượt", () => {
    const bo = new BoDemGlbLru(8);
    for (let lan = 0; lan < 30; lan++) {
      bo.capNhat([`m${lan}`, `m${lan + 1}`, `m${lan + 2}`]);
      expect(bo.soDangGiu).toBeLessThanOrEqual(8);
    }
  });

  it("nối được thẳng với chonMucChiTiet: khoaL0 làm đầu vào capNhat", () => {
    const bo = new BoDemGlbLru();
    const ds = Array.from({ length: 12 }, (_, i) => may(`m${i}`, i + 1));
    const kq = chonMucChiTiet(ds, CAMERA);
    bo.capNhat(kq.khoaL0);
    expect(bo.soDangGiu).toBe(8);
    // Camera lùi ra xa 100 m: mọi máy thành L2, không còn khoá L0 nào.
    const kq2 = chonMucChiTiet(ds, { x: -100, y: 0, z: 0 });
    expect(kq2.khoaL0).toEqual([]);

    // ★ capNhat theo LRU thuần KHÔNG đẩy gì (chưa vượt trần) — GLB vẫn giữ lại
    // phòng khi camera quay lại. Đây là hành vi CÓ CHỦ Ý, không phải rò rỉ.
    expect(bo.capNhat(kq2.khoaL0).daDay).toEqual([]);
    expect(bo.soDangGiu).toBe(8);

    // ★ Muốn thu hồi VRAM thật (RB-7) thì phải gọi thaKhongDung.
    const daTha = bo.thaKhongDung(kq2.khoaL0);
    expect(daTha.slice().sort()).toEqual(kq.khoaL0.slice().sort());
    expect(bo.soDangGiu).toBe(0);
  });

  it("★ thaKhongDung giữ đúng phần còn dùng, trả phần còn lại cho dispose", () => {
    const bo = new BoDemGlbLru(8);
    bo.capNhat(["a", "b", "c", "d"]);
    const daTha = bo.thaKhongDung(["b", "d"]);
    expect(daTha.slice().sort()).toEqual(["a", "c"]);
    expect(bo.danhSachTheoLru().slice().sort()).toEqual(["b", "d"]);
  });

  it("thaKhongDung với danh sách rỗng thả sạch bộ đệm", () => {
    const bo = new BoDemGlbLru(8);
    bo.capNhat(["a", "b"]);
    expect(bo.thaKhongDung([]).slice().sort()).toEqual(["a", "b"]);
    expect(bo.soDangGiu).toBe(0);
  });

  it("xoaSach trả về mọi khoá để người gọi dispose", () => {
    const bo = new BoDemGlbLru(4);
    bo.capNhat(["a", "b"]);
    expect(bo.xoaSach().slice().sort()).toEqual(["a", "b"]);
    expect(bo.soDangGiu).toBe(0);
  });

  it("tất định: hai bộ đệm cùng chuỗi thao tác cho cùng trạng thái", () => {
    const chuoi = [["a", "b"], ["c"], ["a"], ["d", "e"], ["f"]];
    const mot = new BoDemGlbLru(3);
    const hai = new BoDemGlbLru(3);
    for (const b of chuoi) {
      expect(mot.capNhat(b)).toEqual(hai.capNhat(b));
    }
    expect(mot.danhSachTheoLru()).toEqual(hai.danhSachTheoLru());
  });
});
