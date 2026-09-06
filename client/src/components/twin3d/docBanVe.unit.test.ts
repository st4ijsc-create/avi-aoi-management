/**
 * docBanVe.unit.test.ts — Test phần thuần của con đường A (§10A.1).
 *
 * ★★★ TÊN TỆP `.unit.test.ts` — xem lý do ở đầu `boCucTang.unit.test.ts`.
 *
 * Trục kiểm quan trọng nhất: **HỘP THOẠI HIỆU CHỈNH PHẢI CÓ TÁC DỤNG THẬT** —
 * đổi đơn vị mm → m trên CÙNG MỘT bbox phải đổi kích thước đúng 1000 lần. Đó là
 * phép đo chứng minh hộp thoại không phải trang trí.
 */

import { describe, expect, it } from "vitest";
import {
  bboxCuaMesh,
  canOcct,
  dinhDangTuTenTep,
  donViDeNghi,
  donViDeNghiChacChan,
  phanQuyetChan,
  soTamGiacCuaMesh,
  tomTatKetQuaOcct,
  TRAN_BYTE,
  TRAN_TAM_GIAC,
  type KetQuaOcct,
  type OcctMesh,
} from "./docBanVe";
import { apDungHieuChinh, CAU_HINH_MAC_DINH } from "./hieuChinhNhapModel";
import { kichThuocBBox } from "./heToaDo";

/** Hộp chữ nhật đặc: 8 đỉnh, 12 tam giác. */
function meshHop(ten: string, dx: number, dy: number, dz: number, goc = { x: 0, y: 0, z: 0 }): OcctMesh {
  const p: number[] = [];
  for (const x of [goc.x, goc.x + dx]) {
    for (const y of [goc.y, goc.y + dy]) {
      for (const z of [goc.z, goc.z + dz]) p.push(x, y, z);
    }
  }
  return {
    name: ten,
    attributes: { position: { array: p } },
    index: { array: new Array(36).fill(0).map((_, i) => i % 8) },
  };
}

describe("dinhDangTuTenTep — định dạng nhận ở v1 (§10A.1)", () => {
  it("nhận .step/.stp/.iges/.igs/.brep/.glb/.gltf", () => {
    expect(dinhDangTuTenTep("nha.step")).toBe("step");
    expect(dinhDangTuTenTep("nha.STP")).toBe("step");
    expect(dinhDangTuTenTep("nha.iges")).toBe("iges");
    expect(dinhDangTuTenTep("nha.igs")).toBe("iges");
    expect(dinhDangTuTenTep("nha.brep")).toBe("brep");
    expect(dinhDangTuTenTep("nha.glb")).toBe("gltf");
    expect(dinhDangTuTenTep("nha.gltf")).toBe("gltf");
  });

  it("★ .dxf và .dwg KHÔNG nhận ở v1 (hoãn sang §16) — null, không đoán bừa", () => {
    expect(dinhDangTuTenTep("mat-bang.dxf")).toBeNull();
    expect(dinhDangTuTenTep("mat-bang.dwg")).toBeNull();
  });

  it("đuôi lạ và tên không đuôi trả null", () => {
    expect(dinhDangTuTenTep("bao-cao.pdf")).toBeNull();
    expect(dinhDangTuTenTep("khongduoi")).toBeNull();
  });

  it("chỉ CAD đặc mới cần worker occt; glTF nạp thẳng", () => {
    expect(canOcct("step")).toBe(true);
    expect(canOcct("iges")).toBe(true);
    expect(canOcct("brep")).toBe(true);
    expect(canOcct("gltf")).toBe(false);
  });
});

describe("soTamGiacCuaMesh / bboxCuaMesh", () => {
  it("có index: index.length / 3", () => {
    expect(soTamGiacCuaMesh({ index: { array: new Array(36).fill(0) } })).toBe(12);
  });

  it("không index: position.length / 9", () => {
    expect(
      soTamGiacCuaMesh({ attributes: { position: { array: new Array(27).fill(0) } } }),
    ).toBe(3);
  });

  it("mesh rỗng cho 0 tam giác, không ném", () => {
    expect(soTamGiacCuaMesh({})).toBe(0);
  });

  it("bbox đúng từ mảng position phẳng", () => {
    const b = bboxCuaMesh(meshHop("hop", 84_000, 52_000, 6000));
    expect(kichThuocBBox(b)).toEqual({ rong: 84_000, cao: 52_000, sau: 6000 });
  });

  it("mesh không position cho bbox RỖNG, không phải bbox 0×0×0", () => {
    // Khác nhau thật: bbox rỗng nói "không biết", bbox 0 nói "biết, và bằng 0".
    const b = bboxCuaMesh({});
    expect(b.minX).toBe(Infinity);
  });
});

describe("tomTatKetQuaOcct — gộp cây node", () => {
  const KQ: KetQuaOcct = {
    success: true,
    root: {
      name: "ToaNha",
      children: [
        { name: "Tang1", meshes: [0] },
        { name: "Tang2", meshes: [1] },
      ],
    },
    meshes: [
      meshHop("san-tang-1", 84_000, 52_000, 300),
      meshHop("san-tang-2", 84_000, 52_000, 300, { x: 0, y: 0, z: 6300 }),
    ],
  };

  it("đếm đúng số node và cộng dồn tam giác", () => {
    const tt = tomTatKetQuaOcct(KQ);
    expect(tt.soNode).toBe(2);
    expect(tt.soTamGiac).toBe(24);
  });

  it("bbox tổng bao cả hai mesh", () => {
    const tt = tomTatKetQuaOcct(KQ);
    expect(tt.bbox.minZ).toBe(0);
    expect(tt.bbox.maxZ).toBe(6600);
  });

  it("★ success vắng mặt coi là THẤT BẠI, không phải mặc định thành công (NT-3)", () => {
    expect(tomTatKetQuaOcct({ meshes: [meshHop("a", 1, 1, 1)] }).thanhCong).toBe(false);
    expect(tomTatKetQuaOcct({ success: false, meshes: [] }).thanhCong).toBe(false);
  });

  it("★ mesh KHÔNG được node nào tham chiếu vẫn được đếm — không hụt trần chặn", () => {
    const moCoi: KetQuaOcct = {
      success: true,
      root: { name: "r", meshes: [0] },
      meshes: [meshHop("co-cha", 1000, 1000, 1000), meshHop("mo-coi", 2000, 2000, 2000)],
    };
    const tt = tomTatKetQuaOcct(moCoi);
    expect(tt.soNode).toBe(2);
    expect(tt.nodes.map((n) => n.ten)).toEqual(expect.arrayContaining(["mo-coi"]));
  });

  it("mesh được tham chiếu HAI LẦN chỉ đếm một lần", () => {
    const doi: KetQuaOcct = {
      success: true,
      root: { name: "r", children: [{ meshes: [0] }, { meshes: [0] }] },
      meshes: [meshHop("dung-chung", 1000, 1000, 1000)],
    };
    expect(tomTatKetQuaOcct(doi).soNode).toBe(1);
  });

  it("kết quả rỗng cho 0 node, 0 tam giác, không ném", () => {
    const tt = tomTatKetQuaOcct({ success: true, meshes: [] });
    expect(tt.soNode).toBe(0);
    expect(tt.soTamGiac).toBe(0);
  });
});

describe("phanQuyetChan — ngưỡng CHẶN (§10A.1)", () => {
  const TOT = tomTatKetQuaOcct({
    success: true,
    root: { meshes: [0] },
    meshes: [meshHop("nha", 84_000, 52_000, 6000)],
  });

  it("file hợp lệ KHÔNG bị chặn", () => {
    const pq = phanQuyetChan(TOT, 5 * 1024 * 1024, "step");
    expect(pq.chan).toBe(false);
    expect(pq.lyDo).toBeNull();
  });

  it("★ định dạng không nhận bị chặn TRƯỚC mọi thứ khác", () => {
    const pq = phanQuyetChan(TOT, 1, null);
    expect(pq).toMatchObject({ chan: true, lyDo: "dinhDangKhongNhan" });
  });

  it("★ > 60 MB bị chặn — và chặn TRƯỚC khi đọc (đọc 500 MB làm treo tab)", () => {
    const pq = phanQuyetChan(null, TRAN_BYTE + 1, "step");
    expect(pq).toMatchObject({ chan: true, lyDo: "fileQuaLon" });
    expect(TRAN_BYTE).toBe(60 * 1024 * 1024);
  });

  it("đúng 60 MB KHÔNG bị chặn — ngưỡng nằm đúng chỗ nó khai", () => {
    expect(phanQuyetChan(TOT, TRAN_BYTE, "step").chan).toBe(false);
  });

  it("★ > 2.000.000 tam giác bị chặn", () => {
    const nang = { ...TOT, soTamGiac: TRAN_TAM_GIAC + 1 };
    expect(phanQuyetChan(nang, 1024, "step")).toMatchObject({
      chan: true,
      lyDo: "quaNhieuTamGiac",
    });
    expect(TRAN_TAM_GIAC).toBe(2_000_000);
  });

  it("đúng 2.000.000 tam giác KHÔNG bị chặn", () => {
    expect(phanQuyetChan({ ...TOT, soTamGiac: TRAN_TAM_GIAC }, 1024, "step").chan).toBe(false);
  });

  it("★ 0 tam giác BỊ CHẶN — không dựng một toà nhà vô hình (NT-3)", () => {
    const rong = tomTatKetQuaOcct({ success: true, meshes: [] });
    expect(phanQuyetChan(rong, 1024, "step")).toMatchObject({
      chan: true,
      lyDo: "khongCoHinhHoc",
    });
  });

  it("occt báo thất bại thì chặn với lý do docThatBai", () => {
    const hong = tomTatKetQuaOcct({ success: false, meshes: [] });
    expect(phanQuyetChan(hong, 1024, "step")).toMatchObject({
      chan: true,
      lyDo: "docThatBai",
    });
  });

  it("phán quyết luôn kèm số đo để UI hiện được lý do cụ thể", () => {
    const pq = phanQuyetChan(TOT, 12345, "step");
    expect(pq.soTamGiac).toBe(12);
    expect(pq.kichThuocByte).toBe(12345);
  });
});

describe("donViDeNghi — chỉ ĐỀ NGHỊ, không tự áp (NT-4)", () => {
  function bboxCanh(canh: number) {
    return { minX: 0, maxX: canh, minY: 0, maxY: canh / 2, minZ: 0, maxZ: canh / 10 };
  }

  it("cạnh 84.000 (số thô) ⇒ đề nghị mm (84 m)", () => {
    expect(donViDeNghi(bboxCanh(84_000))).toBe("mm");
  });

  it("cạnh 84 (số thô) ⇒ đề nghị m", () => {
    expect(donViDeNghi(bboxCanh(84))).toBe("m");
  });

  it("cạnh 8.400 ⇒ đề nghị cm", () => {
    expect(donViDeNghi(bboxCanh(8400))).toBe("cm");
  });

  it("★ không đơn vị nào cho ra nhà xưởng hợp lý ⇒ giữ mm mặc định, KHÔNG đoán bừa", () => {
    // Cạnh 10^9: mm ra 1000 km, m ra 10^9 m — không cái nào hợp lý.
    expect(donViDeNghi(bboxCanh(1e9))).toBe("mm");
    expect(donViDeNghiChacChan(bboxCanh(1e9))).toBe(false);
  });

  it("★ đề nghị CHẮC CHẮN khác đề nghị MẶC ĐỊNH — UI phải phân biệt được", () => {
    expect(donViDeNghiChacChan(bboxCanh(84_000))).toBe(true);
    expect(donViDeNghiChacChan(bboxCanh(1e9))).toBe(false);
  });

  it("bbox suy biến (cạnh 0) ⇒ mm và KHÔNG chắc chắn", () => {
    const b = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    expect(donViDeNghi(b)).toBe("mm");
    expect(donViDeNghiChacChan(b)).toBe(false);
  });
});

describe("★★★ HỘP THOẠI HIỆU CHỈNH CÓ TÁC DỤNG THẬT (§10A.1)", () => {
  // Đây là phép đo chứng minh hộp thoại không phải trang trí: cùng MỘT file,
  // đổi mỗi ô "Đơn vị nguồn", kích thước đọc ra phải đổi đúng hệ số.
  const BBOX_THO = bboxCuaMesh(meshHop("nha", 84_000, 52_000, 6000));

  it("mm → m: kích thước tăng ĐÚNG 1000 lần", () => {
    const mm = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, donViNguon: "mm" });
    const m = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, donViNguon: "m" });
    expect(m.kichThuocMm.rongMm / mm.kichThuocMm.rongMm).toBeCloseTo(1000, 9);
    expect(m.kichThuocMm.caoMm / mm.kichThuocMm.caoMm).toBeCloseTo(1000, 9);
    expect(m.kichThuocMm.sauMm / mm.kichThuocMm.sauMm).toBeCloseTo(1000, 9);
  });

  it("đọc mm cho ra một nhà xưởng 84 m; đọc m cho ra 84 KM — sai lệch phải LỘ RA", () => {
    const mm = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, donViNguon: "mm" });
    const m = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, donViNguon: "m" });
    expect(mm.kichThuocMm.rongMm).toBe(84_000); // 84 m — hợp lý
    expect(m.kichThuocMm.rongMm).toBe(84_000_000); // 84 km — vô lý, mắt thấy ngay
  });

  it("cm → mm hệ số 10; inch → mm hệ số 25,4", () => {
    const mm = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, donViNguon: "mm" });
    const cm = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, donViNguon: "cm" });
    const inch = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, donViNguon: "inch" });
    expect(cm.kichThuocMm.rongMm / mm.kichThuocMm.rongMm).toBeCloseTo(10, 9);
    expect(inch.kichThuocMm.rongMm / mm.kichThuocMm.rongMm).toBeCloseTo(25.4, 9);
  });

  it("★ đổi TRỤC LÊN Z→Y hoán vị cao và sâu — nhà nằm ngửa lộ ra ngay", () => {
    const zUp = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, trucLen: "Z" });
    const yUp = apDungHieuChinh(BBOX_THO, { ...CAU_HINH_MAC_DINH, trucLen: "Y" });
    // Số thô 84.000 × 52.000 × 6.000: với Z-up thì 6.000 là ĐỘ CAO; với Y-up thì
    // 52.000 mới là độ cao — một toà nhà cao 52 m mà chỉ sâu 6 m, sai rõ ràng.
    expect(zUp.kichThuocMm.caoMm).toBe(6000);
    expect(yUp.kichThuocMm.caoMm).toBe(52_000);
  });
});
