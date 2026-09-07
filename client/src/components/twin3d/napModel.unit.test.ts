/**
 * napModel.unit.test.ts — gán model 3 cấp (§10B.2) + kế hoạch nạp/thả (#4).
 *
 * ★ G5/G32 — mọi ca dùng bảng KHÁC RỖNG, và ca then chốt hỏi thẳng "đầu ra có
 *   KHÁC đầu vào không": cùng một danh sách máy, đổi MỘT hàng registry phải đổi
 *   được kết luận. Một bộ test mà mọi ca đều rơi về `khoi` không đo được gì.
 */
import { describe, expect, it } from "vitest";

import {
  TRAN_GLB_DONG_THOI,
  banDoModel,
  chonModelChoMay,
  khoaModel,
  lapKeHoachNap,
  mayTuKhoa,
  modelDungDuoc,
  taoBoDemModel,
  type HangModel,
} from "./napModel";

const GOC = { x: 0, y: 0, z: 0 };

function hang(p: Partial<HangModel> & { id: number; modelUri: string }): HangModel {
  return { status: "active", conversionStatus: "ready", version: 1, ...p };
}

describe("chonModelChoMay — ba cấp, HẸP thắng RỘNG", () => {
  const bang: HangModel[] = [
    hang({ id: 1, modelUri: "/uploads/models/aoi-chung.glb", equipmentClass: "AOI" }),
    hang({ id: 2, modelUri: "/uploads/models/may-7-rieng.glb", machineId: 7 }),
  ];

  it("máy CÓ model riêng ⇒ cấp `may`, dùng file riêng", () => {
    const kq = chonModelChoMay({ machineId: 7, loaiMay: "AOI" }, bang);
    expect(kq.cap).toBe("may");
    expect(kq.modelUri).toBe("/uploads/models/may-7-rieng.glb");
    expect(kq.modelId).toBe(2);
  });

  it("máy AOI KHÁC ⇒ rơi xuống cấp `chung_loai`, dùng file chung", () => {
    const kq = chonModelChoMay({ machineId: 8, loaiMay: "AOI" }, bang);
    expect(kq.cap).toBe("chung_loai");
    expect(kq.modelUri).toBe("/uploads/models/aoi-chung.glb");
    expect(kq.modelId).toBe(1);
  });

  it("máy loại KHÁC ⇒ `khoi`, không model nào — rơi về khối thủ tục", () => {
    const kq = chonModelChoMay({ machineId: 9, loaiMay: "REFLOW" }, bang);
    expect(kq.cap).toBe("khoi");
    expect(kq.modelUri).toBeNull();
    expect(kq.modelId).toBeNull();
  });

  it("★★★ cùng một máy, THÊM một hàng cấp máy ⇒ kết luận ĐỔI (đối chứng G5)", () => {
    const truoc = chonModelChoMay({ machineId: 8, loaiMay: "AOI" }, bang);
    const sau = chonModelChoMay({ machineId: 8, loaiMay: "AOI" }, [
      ...bang,
      hang({ id: 3, modelUri: "/uploads/models/may-8.glb", machineId: 8 }),
    ]);
    expect(truoc.cap).toBe("chung_loai");
    expect(sau.cap).toBe("may");
    expect(sau.modelUri).not.toBe(truoc.modelUri);
  });

  it("★★★ HÀNG GÁN CHO MỘT MÁY KHÔNG ĐƯỢC TRÀN SANG CẢ CHỦNG LOẠI", () => {
    // Hàng này có CẢ machineId=7 lẫn equipmentClass='AOI' — đúng thứ mà
    // `uploadAndRegister` sinh ra khi người dùng khai loại máy lúc gán riêng.
    const bangBay: HangModel[] = [
      hang({ id: 5, modelUri: "/uploads/models/rieng-cua-7.glb", machineId: 7, equipmentClass: "AOI" }),
    ];
    expect(chonModelChoMay({ machineId: 7, loaiMay: "AOI" }, bangBay).cap).toBe("may");
    // Máy 8 CŨNG là AOI — nhưng hàng trên KHÔNG phải hàng cấp chủng loại.
    const may8 = chonModelChoMay({ machineId: 8, loaiMay: "AOI" }, bangBay);
    expect(may8.cap).toBe("khoi");
    expect(may8.modelUri).toBeNull();
  });

  it("máy không khai loại ⇒ không bao giờ khớp cấp chủng loại", () => {
    expect(chonModelChoMay({ machineId: 99, loaiMay: null }, bang).cap).toBe("khoi");
  });

  it("hoà cấp ⇒ version cao thắng; hoà version ⇒ id lớn thắng", () => {
    const nhieu: HangModel[] = [
      hang({ id: 10, modelUri: "/a.glb", equipmentClass: "SPI", version: 1 }),
      hang({ id: 11, modelUri: "/b.glb", equipmentClass: "SPI", version: 4 }),
      hang({ id: 12, modelUri: "/c.glb", equipmentClass: "SPI", version: 4 }),
    ];
    expect(chonModelChoMay({ machineId: 1, loaiMay: "SPI" }, nhieu).modelId).toBe(12);
  });
});

describe("modelDungDuoc — hàng CHƯA có tệp không được nạp", () => {
  it("ready và external dùng được; pending/converting/failed thì không", () => {
    expect(modelDungDuoc(hang({ id: 1, modelUri: "/a.glb" }))).toBe(true);
    expect(modelDungDuoc(hang({ id: 1, modelUri: "/a.glb", conversionStatus: "external" }))).toBe(true);
    for (const cs of ["pending", "converting", "failed"]) {
      expect(modelDungDuoc(hang({ id: 1, modelUri: "/a.glb", conversionStatus: cs }))).toBe(false);
    }
  });

  it("archived hoặc modelUri rỗng ⇒ không dùng được", () => {
    expect(modelDungDuoc(hang({ id: 1, modelUri: "/a.glb", status: "archived" }))).toBe(false);
    expect(modelDungDuoc(hang({ id: 1, modelUri: "" }))).toBe(false);
  });

  it("★ hàng `pending` bị BỎ QUA khi chọn ⇒ rơi về khối, không phải 404", () => {
    const kq = chonModelChoMay({ machineId: 3, loaiMay: "AVI" }, [
      hang({ id: 1, modelUri: "/chua-co.glb", equipmentClass: "AVI", conversionStatus: "pending" }),
    ]);
    expect(kq.cap).toBe("khoi");
  });
});

describe("khoaModel / mayTuKhoa — đi và về", () => {
  it("khứ hồi giữ nguyên id", () => {
    for (const id of [1, 7, 42, 12345]) {
      expect(mayTuKhoa(khoaModel(id))).toBe(id);
    }
  });

  it("khoá không đúng khuôn ⇒ null, không ném", () => {
    expect(mayTuKhoa("station:3")).toBeNull();
    expect(mayTuKhoa("machine:abc")).toBeNull();
    expect(mayTuKhoa("")).toBeNull();
  });
});

describe("lapKeHoachNap — LOD + LRU + lệnh nạp/thả", () => {
  const bang: HangModel[] = [hang({ id: 1, modelUri: "/aoi.glb", equipmentClass: "AOI" })];

  /** N máy AOI xếp thẳng hàng, cách camera 1m, 2m, … N mét. */
  function dayMay(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      machineId: i + 1,
      loaiMay: "AOI",
      viTri: { x: i + 1, y: 0, z: 0 },
    }));
  }

  it("★★★ TRẦN 8 ĐƯỢC TÔN TRỌNG — 12 máy đều gần, chỉ 8 được nạp", () => {
    const may = dayMay(12);
    const banDo = banDoModel(may, bang);
    const kh = lapKeHoachNap(may, banDo, GOC, taoBoDemModel());
    expect(kh.canNap.size).toBe(TRAN_GLB_DONG_THOI);
    expect(kh.canNap.size).toBe(8);
    // 8 máy GẦN NHẤT — không phải 8 máy đầu danh sách một cách tình cờ.
    expect([...kh.canNap.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // 4 máy còn lại KHÔNG biến mất: chúng vẽ bằng khối.
    expect(kh.veKhoi).toEqual([9, 10, 11, 12]);
    expect(kh.lod.demTheoBac.L0).toBe(8);
  });

  it("★★★ MÁY KHÔNG CÓ MODEL KHÔNG CHIẾM SUẤT — 3 máy REFLOW chen giữa", () => {
    const may = [
      { machineId: 1, loaiMay: "REFLOW", viTri: { x: 1, y: 0, z: 0 } },
      { machineId: 2, loaiMay: "REFLOW", viTri: { x: 2, y: 0, z: 0 } },
      { machineId: 3, loaiMay: "REFLOW", viTri: { x: 3, y: 0, z: 0 } },
      ...dayMay(9).map((m) => ({ ...m, machineId: m.machineId + 10, viTri: { x: m.viTri.x + 3, y: 0, z: 0 } })),
    ];
    const banDo = banDoModel(may, bang);
    const kh = lapKeHoachNap(may, banDo, GOC, taoBoDemModel());
    // 8 suất đều thuộc về máy AOI (id >= 11), không một suất nào bị REFLOW ăn.
    expect(kh.canNap.size).toBe(8);
    expect([...kh.canNap.keys()].every((id) => id >= 11)).toBe(true);
    // Ba máy REFLOW vẫn có mặt trong `veKhoi`.
    expect(kh.veKhoi).toContain(1);
    expect(kh.veKhoi).toContain(2);
    expect(kh.veKhoi).toContain(3);
  });

  it("máy xa hơn 25 m ⇒ không nạp GLB (bậc L1 trở lên)", () => {
    const may = [{ machineId: 1, loaiMay: "AOI", viTri: { x: 30, y: 0, z: 0 } }];
    const kh = lapKeHoachNap(may, banDoModel(may, bang), GOC, taoBoDemModel());
    expect(kh.canNap.size).toBe(0);
    expect(kh.veKhoi).toEqual([1]);
    expect(kh.lod.theoKhoa.get("machine:1")).toBe("L1");
  });

  it("★★★ CAMERA DỜI ĐI ⇒ máy cũ bị ĐẨY RA và trả về `canTha` (RB-7)", () => {
    const boDem = taoBoDemModel();
    // Lượt 1: camera ở gốc, 8 máy đầu vào bộ đệm.
    const may = dayMay(16);
    const banDo = banDoModel(may, bang);
    const l1 = lapKeHoachNap(may, banDo, GOC, boDem);
    expect(l1.canNap.size).toBe(8);
    expect(l1.canTha).toEqual([]);

    // Lượt 2: camera nhảy tới đầu kia — 8 máy KHÁC vào, 8 máy cũ phải ra.
    const l2 = lapKeHoachNap(may, banDo, { x: 17, y: 0, z: 0 }, boDem);
    expect(l2.canNap.size).toBe(8);
    expect([...l2.canNap.keys()].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    // ★ Đây là con số quan trọng nhất của test này: không có nó thì VRAM rò.
    expect(l2.canTha.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("máy ngoài khung nhìn ⇒ L3, không nạp và không chiếm suất", () => {
    const may = dayMay(3).map((m, i) => ({ ...m, ngoaiKhungNhin: i === 0 }));
    const kh = lapKeHoachNap(may, banDoModel(may, bang), GOC, taoBoDemModel());
    expect(kh.lod.theoKhoa.get("machine:1")).toBe("L3");
    expect(kh.canNap.has(1)).toBe(false);
    expect(kh.canNap.size).toBe(2);
  });

  it("bảng registry RỖNG ⇒ mọi máy vẽ khối, 0 lệnh nạp (ca đối chứng)", () => {
    const may = dayMay(5);
    const kh = lapKeHoachNap(may, banDoModel(may, []), GOC, taoBoDemModel());
    expect(kh.canNap.size).toBe(0);
    expect(kh.veKhoi).toHaveLength(5);
    // ★ Và ca này phải KHÁC ca có bảng — nếu bằng nhau thì phép đo mù.
    const coBang = lapKeHoachNap(may, banDoModel(may, bang), GOC, taoBoDemModel());
    expect(coBang.canNap.size).not.toBe(kh.canNap.size);
  });

  it("gọi hai lượt LIÊN TIẾP với cùng đầu vào ⇒ lượt 2 không nạp lại (bộ đệm giữ)", () => {
    const boDem = taoBoDemModel();
    const may = dayMay(4);
    const banDo = banDoModel(may, bang);
    lapKeHoachNap(may, banDo, GOC, boDem);
    const l2 = lapKeHoachNap(may, banDo, GOC, boDem);
    expect(l2.canTha).toEqual([]);
    expect(boDem.soDangGiu).toBe(4);
  });
});
