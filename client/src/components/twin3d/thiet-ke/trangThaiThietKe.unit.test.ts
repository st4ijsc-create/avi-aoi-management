/**
 * Test cho `trangThaiThietKe.ts` — mô hình thuần màn Thiết kế.
 *
 * ★ LUẬT G8 áp cho mọi cờ boolean ở đây: mỗi test khẳng định cờ TRUE phải có
 *   một test song sinh khẳng định nó FALSE trên đầu vào biết trước. Một cờ luôn
 *   trả true không đo được gì, và đó là hình dạng của "lưới xanh mù" ở §1.6.
 *
 * ★ Số liệu nền của các ca "giống thật" lấy từ DB dev đo ngày 2026-09-06:
 *   SIM-FAC 41 máy sống · 41 đã xếp · 0 chờ · 1 hàng đặt-chỗ mồ côi (machine 250
 *   isActive=false) · máy 257 (factory 18) là máy chờ xếp duy nhất toàn hệ.
 */

import { describe, expect, it } from "vitest";

import {
  KICH_THUOC_MAC_DINH,
} from "../hinhKhoiMay";
import {
  SAI_SO_MM,
  TRAN_LO_GHI,
  apChon,
  apDichVaoDatCho,
  bboxCuaDatCho,
  dichSceneSangDatCho,
  chiaLo,
  dungCayThietKe,
  duongToiNode,
  gomThayDoi,
  kepVaoSan,
  khoaNode,
  kichThuocDeVe,
  locCay,
  nodeChuDao,
  tachKhoaNode,
  tinhSucKhoeDuLieu,
  type DatChoDauVao,
  type MayDauVao,
} from "./trangThaiThietKe";

// ---------------------------------------------------------------------------
// Đồ gá
// ---------------------------------------------------------------------------

function may(id: number, ma: string, stationId: number | null, isActive = true): MayDauVao {
  return { id, ma, ten: null, loaiMay: "AOI", isActive, stationId };
}

function datCho(
  thucTheId: number,
  over: Partial<DatChoDauVao> = {},
): DatChoDauVao {
  return {
    id: thucTheId * 10,
    tangId: 28,
    loaiThucThe: "machine",
    thucTheId,
    viTriXMm: 1000,
    viTriYMm: 2000,
    viTriZMm: 0,
    rongMm: 1200,
    caoMm: 1800,
    sauMm: 800,
    kichThuocDaDo: false,
    quatX: 0,
    quatY: 0,
    quatZ: 0,
    quatW: 1,
    daKhoa: false,
    hienThi: true,
    nguon: "sinh",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Khoá node
// ---------------------------------------------------------------------------

describe("khoá node", () => {
  it("dựng khoá dạng loai:id", () => {
    expect(khoaNode("machine", 42)).toBe("machine:42");
  });

  it("tách khoá là phép ngược của dựng khoá", () => {
    expect(tachKhoaNode(khoaNode("station", 7))).toEqual({ loai: "station", id: 7 });
  });

  it("tách khoá trả null với chuỗi sai dạng — G8 nhánh âm", () => {
    expect(tachKhoaNode("machine")).toBeNull();
    expect(tachKhoaNode(":42")).toBeNull();
    expect(tachKhoaNode("machine:abc")).toBeNull();
    expect(tachKhoaNode("machine:0")).toBeNull();
    expect(tachKhoaNode("machine:-3")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sức khoẻ dữ liệu
// ---------------------------------------------------------------------------

describe("tinhSucKhoeDuLieu", () => {
  it("đếm đã xếp / chờ xếp trên ca đơn giản", () => {
    const sk = tinhSucKhoeDuLieu(
      [may(1, "M1", 10), may(2, "M2", 10), may(3, "M3", null)],
      [datCho(1), datCho(2)],
    );
    expect(sk.daXepCho).toBe(2);
    expect(sk.choXepCho).toBe(1);
    expect(sk.tongMaySong).toBe(3);
  });

  it("★ hàng đặt chỗ trỏ vào máy NGỪNG HOẠT ĐỘNG được đếm là mồ côi, KHÔNG cộng vào đã-xếp", () => {
    // Đây là ca THẬT trên DB dev: datCho 776 → machine 250 (isActive=false).
    const sk = tinhSucKhoeDuLieu(
      [may(1, "M1", 10), may(250, "SN-WELD", 1, /* isActive */ false)],
      [datCho(1), datCho(250)],
    );
    expect(sk.daXepCho).toBe(1); // KHÔNG phải 2
    expect(sk.datChoMoCoi).toBe(1);
    expect(sk.tongMaySong).toBe(1);
    expect(sk.choXepCho).toBe(0);
  });

  it("★ đếm bằng datCho.length sẽ SAI — ghim chênh lệch để bản vá sau không quay về cách cũ", () => {
    const ds = [datCho(1), datCho(250)];
    const sk = tinhSucKhoeDuLieu([may(1, "M1", 10), may(250, "X", 1, false)], ds);
    expect(ds.filter((d) => d.loaiThucThe === "machine").length).toBe(2);
    expect(sk.daXepCho).not.toBe(2);
  });

  it("lọc theo loaiThucThe — station/line/workshop KHÔNG được tính là máy đã xếp", () => {
    const sk = tinhSucKhoeDuLieu(
      [may(1, "M1", 10)],
      [
        datCho(1),
        datCho(5, { loaiThucThe: "station" }),
        datCho(6, { loaiThucThe: "line" }),
        datCho(7, { loaiThucThe: "workshop" }),
      ],
    );
    expect(sk.daXepCho).toBe(1);
    expect(sk.datChoMoCoi).toBe(0);
  });

  it("đếm chưa-đo-kích-thước theo cờ kichThuocDaDo (NT-4)", () => {
    const sk = tinhSucKhoeDuLieu(
      [may(1, "M1", 10), may(2, "M2", 10)],
      [datCho(1, { kichThuocDaDo: true }), datCho(2, { kichThuocDaDo: false })],
    );
    expect(sk.chuaDoKichThuoc).toBe(1);
  });

  it("chuaTai TRUE khi chưa có gì để đếm — NT-3.5 'đếm rỗng khác đếm 0'", () => {
    expect(tinhSucKhoeDuLieu([], []).chuaTai).toBe(true);
    expect(tinhSucKhoeDuLieu([], [], true).chuaTai).toBe(true);
  });

  it("chuaTai FALSE khi đã có dữ liệu — G8 nhánh âm", () => {
    expect(tinhSucKhoeDuLieu([may(1, "M1", 10)], [datCho(1)]).chuaTai).toBe(false);
  });

  it("nhà máy có máy nhưng 0 đặt chỗ: chờ xếp = tổng, chuaTai FALSE", () => {
    // Ca THẬT: factory 18 có đúng 1 máy (id 257) và chưa có toà nhà nào.
    const sk = tinhSucKhoeDuLieu([may(257, "T12-SHOT-MC", 44)], []);
    expect(sk.choXepCho).toBe(1);
    expect(sk.daXepCho).toBe(0);
    expect(sk.chuaTai).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cây phân cấp
// ---------------------------------------------------------------------------

const XUONG = [{ id: 1, ma: "X1", ten: "Xuong 1", factoryId: 1, tangId: 28 }];
const CHUYEN = [
  { id: 1, ma: "L1", ten: null, workshopId: 1 },
  { id: 2, ma: "L2", ten: null, workshopId: 1 },
];
const TRAM = [
  { id: 10, ma: "T10", ten: null, lineId: 1, thuTu: 1 },
  { id: 11, ma: "T11", ten: null, lineId: 1, thuTu: 2 },
  { id: 20, ma: "T20", ten: null, lineId: 2, thuTu: 1 },
];

describe("dungCayThietKe", () => {
  it("lồng đúng 4 cấp xưởng → chuyền → trạm → máy", () => {
    const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(1, "M1", 10)], [datCho(1)]);
    expect(cay.goc).toHaveLength(1);
    expect(cay.goc[0].con).toHaveLength(2);
    expect(cay.goc[0].con[0].con).toHaveLength(2);
    expect(cay.goc[0].con[0].con[0].con).toHaveLength(1);
    expect(cay.goc[0].con[0].con[0].con[0].khoa).toBe("machine:1");
  });

  it("★ máy CHƯA có đặt chỗ đi vào khuCho, KHÔNG vào nhánh trạm (§7.1)", () => {
    const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(1, "M1", 10), may(2, "M2", 10)], [datCho(1)]);
    expect(cay.khuCho.map((n) => n.khoa)).toEqual(["machine:2"]);
    expect(cay.goc[0].con[0].con[0].con.map((n) => n.khoa)).toEqual(["machine:1"]);
  });

  it("★ mọi node trong khuCho mang cờ choXepCho = true (mờ + viền nét đứt)", () => {
    const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(2, "M2", 10)], []);
    expect(cay.khuCho.every((n) => n.choXepCho)).toBe(true);
  });

  it("★ G8 nhánh âm — máy ĐÃ xếp chỗ mang cờ choXepCho = false", () => {
    const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(1, "M1", 10)], [datCho(1)]);
    expect(cay.goc[0].con[0].con[0].con[0].choXepCho).toBe(false);
  });

  it("máy isActive=false biến mất khỏi CẢ HAI nhánh", () => {
    const cay = dungCayThietKe(
      XUONG,
      CHUYEN,
      TRAM,
      [may(250, "SN-WELD", 10, false)],
      [datCho(250)],
    );
    expect(cay.khuCho).toHaveLength(0);
    expect(cay.goc[0].con[0].con[0].con).toHaveLength(0);
  });

  it("máy có đặt chỗ nhưng stationId = null vẫn vào khuCho (không có nhánh để treo)", () => {
    const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(9, "M9", null)], [datCho(9)]);
    expect(cay.khuCho.map((n) => n.khoa)).toEqual(["machine:9"]);
  });

  it("trạm sắp theo thuTu, không theo id", () => {
    const tram = [
      { id: 11, ma: "T11", ten: null, lineId: 1, thuTu: 1 },
      { id: 10, ma: "T10", ten: null, lineId: 1, thuTu: 2 },
    ];
    const cay = dungCayThietKe(XUONG, CHUYEN, tram, [], []);
    expect(cay.goc[0].con[0].con.map((n) => n.id)).toEqual([11, 10]);
  });

  it("trạm thuTu = null xuống cuối, phá hoà bằng mã — TẤT ĐỊNH", () => {
    const tram = [
      { id: 30, ma: "TZ", ten: null, lineId: 1, thuTu: null },
      { id: 31, ma: "TA", ten: null, lineId: 1, thuTu: null },
      { id: 10, ma: "T10", ten: null, lineId: 1, thuTu: 5 },
    ];
    const cay = dungCayThietKe(XUONG, CHUYEN, tram, [], []);
    expect(cay.goc[0].con[0].con.map((n) => n.id)).toEqual([10, 31, 30]);
  });

  it("theoKhoa tra được mọi node của cả hai nhánh", () => {
    const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(1, "M1", 10), may(2, "M2", null)], [datCho(1)]);
    expect(cay.theoKhoa.get("machine:1")?.choXepCho).toBe(false);
    expect(cay.theoKhoa.get("machine:2")?.choXepCho).toBe(true);
    expect(cay.theoKhoa.get("station:10")).toBeDefined();
    expect(cay.theoKhoa.get("workshop:1")).toBeDefined();
  });
});

describe("locCay", () => {
  const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(1, "M1", 10), may(2, "M2", 20)], [datCho(1), datCho(2)]);

  it("chuỗi rỗng trả cây nguyên vẹn", () => {
    expect(locCay(cay.goc, "")).toHaveLength(1);
    expect(locCay(cay.goc, "   ")[0].con).toHaveLength(2);
  });

  it("★ GIỮ node cha khi con khớp — không làm phẳng mất ngữ cảnh", () => {
    const ket = locCay(cay.goc, "M2");
    expect(ket).toHaveLength(1);
    expect(ket[0].con).toHaveLength(1);
    expect(ket[0].con[0].khoa).toBe("line:2");
    expect(ket[0].con[0].con[0].con[0].khoa).toBe("machine:2");
  });

  it("khớp node cha thì giữ NGUYÊN cây con của nó", () => {
    const ket = locCay(cay.goc, "L1");
    expect(ket[0].con[0].con).toHaveLength(2);
  });

  it("★ G8 nhánh âm — chuỗi không khớp gì trả mảng RỖNG", () => {
    expect(locCay(cay.goc, "khong-ton-tai-zzz")).toEqual([]);
  });

  it("lọc không phân biệt hoa thường", () => {
    expect(locCay(cay.goc, "m2")).toHaveLength(1);
    expect(locCay(cay.goc, "M2")).toHaveLength(1);
  });
});

describe("duongToiNode", () => {
  const cay = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(1, "M1", 10)], [datCho(1)]);

  it("trả tổ tiên từ gốc xuống, KHÔNG gồm chính node", () => {
    expect(duongToiNode(cay, "machine:1")).toEqual(["workshop:1", "line:1", "station:10"]);
  });

  it("node gốc trả mảng rỗng", () => {
    expect(duongToiNode(cay, "workshop:1")).toEqual([]);
  });

  it("khoá không tồn tại trả mảng rỗng, không ném lỗi", () => {
    expect(duongToiNode(cay, "machine:99999")).toEqual([]);
  });

  it("node khu chờ (cha = null) trả mảng rỗng", () => {
    const c2 = dungCayThietKe(XUONG, CHUYEN, TRAM, [may(2, "M2", 10)], []);
    expect(duongToiNode(c2, "machine:2")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chọn
// ---------------------------------------------------------------------------

describe("apChon", () => {
  it("click thường THAY toàn bộ tập", () => {
    expect(apChon(["machine:1", "machine:2"], "machine:5", false)).toEqual(["machine:5"]);
  });

  it("shift-click THÊM vào tập", () => {
    expect(apChon(["machine:1"], "machine:2", true)).toEqual(["machine:1", "machine:2"]);
  });

  it("★ shift-click node ĐANG chọn thì BỎ chọn nó (toggle)", () => {
    expect(apChon(["machine:1", "machine:2"], "machine:1", true)).toEqual(["machine:2"]);
  });

  it("★ G8 — hai đầu vào cho ra tập RỖNG", () => {
    expect(apChon(["machine:1"], null, false)).toEqual([]);
    expect(apChon(["machine:1"], "machine:1", true)).toEqual([]);
  });

  it("click nền (null) xoá tập kể cả khi giữ shift", () => {
    expect(apChon(["machine:1", "machine:2"], null, true)).toEqual([]);
  });
});

describe("nodeChuDao", () => {
  it("là phần tử CUỐI — vật vừa chạm nhất", () => {
    expect(nodeChuDao(["machine:1", "machine:2"])).toBe("machine:2");
  });

  it("tập rỗng trả null (Inspector đóng)", () => {
    expect(nodeChuDao([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kích thước
// ---------------------------------------------------------------------------

describe("kichThuocDeVe — chuỗi dự phòng §5.3", () => {
  it("bậc 1: dùng số đo của twin_dat_cho khi đủ ba cạnh", () => {
    const r = kichThuocDeVe(
      { rongMm: 1400, caoMm: 2000, sauMm: 900, kichThuocDaDo: true },
      { rongMm: 1, caoMm: 1, sauMm: 1 },
    );
    expect(r.kichThuoc).toEqual({ rongMm: 1400, caoMm: 2000, sauMm: 900 });
    expect(r.daDo).toBe(true);
  });

  it("bậc 2: NULL ở đặt chỗ ⇒ rơi xuống bảng theo loại, daDo = false", () => {
    const r = kichThuocDeVe(
      { rongMm: null, caoMm: 2000, sauMm: 900, kichThuocDaDo: true },
      { rongMm: 1500, caoMm: 1900, sauMm: 850 },
    );
    expect(r.kichThuoc).toEqual({ rongMm: 1500, caoMm: 1900, sauMm: 850 });
    expect(r.daDo).toBe(false);
  });

  it("bậc 3: không có gì ⇒ mặc định của hinhKhoiMay", () => {
    const r = kichThuocDeVe(null, null);
    expect(r.kichThuoc).toEqual({ ...KICH_THUOC_MAC_DINH });
    expect(r.daDo).toBe(false);
  });

  it("★ cạnh <= 0 KHÔNG được coi là số đo hợp lệ (bbox suy biến làm máy biến mất)", () => {
    const r = kichThuocDeVe(
      { rongMm: 0, caoMm: 1800, sauMm: 800, kichThuocDaDo: true },
      { rongMm: 1500, caoMm: 1900, sauMm: 850 },
    );
    expect(r.kichThuoc.rongMm).toBe(1500);
    expect(r.daDo).toBe(false);
  });

  it("★ G8 — daDo TRUE chỉ khi số đo thật đến từ đặt chỗ VÀ cờ bật", () => {
    expect(
      kichThuocDeVe({ rongMm: 1, caoMm: 1, sauMm: 1, kichThuocDaDo: true }, null).daDo,
    ).toBe(true);
    expect(
      kichThuocDeVe({ rongMm: 1, caoMm: 1, sauMm: 1, kichThuocDaDo: false }, null).daDo,
    ).toBe(false);
  });
});

describe("bboxCuaDatCho — hoán vị trục DB → scene", () => {
  const kt = { rongMm: 1200, caoMm: 1800, sauMm: 800 };

  it("bbox quanh TÂM, nửa kích thước mỗi phía trên trục X (trục không hoán vị)", () => {
    const b = bboxCuaDatCho(datCho(1, { viTriXMm: 1000, viTriYMm: 0, viTriZMm: 0 }), kt);
    expect(b.minX).toBe(400);
    expect(b.maxX).toBe(1600);
  });

  it("★★★ G10 — viTriYMm (mặt bằng) phải ra trục Z của scene, KHÔNG ra trục Y", () => {
    const b = bboxCuaDatCho(datCho(1, { viTriXMm: 0, viTriYMm: 5000, viTriZMm: 0 }), kt);
    // Tâm Z scene = 5000 (bề sâu 800 ⇒ 4600..5400)
    expect(b.minZ).toBe(4600);
    expect(b.maxZ).toBe(5400);
    // Trục Y scene chỉ mang ĐỘ CAO, và viTriZMm = 0 ⇒ tâm cao độ 0.
    expect(b.minY).toBe(-900);
    expect(b.maxY).toBe(900);
  });

  it("★★★ G10 — viTriZMm (độ cao) phải ra trục Y của scene", () => {
    const b = bboxCuaDatCho(datCho(1, { viTriXMm: 0, viTriYMm: 0, viTriZMm: 3000 }), kt);
    expect(b.minY).toBe(2100);
    expect(b.maxY).toBe(3900);
    expect(b.minZ).toBe(-400);
  });

  it("★ nếu KHÔNG hoán vị thì hai ca trên cho cùng một bbox — ghim rằng chúng KHÁC nhau", () => {
    const theoY = bboxCuaDatCho(datCho(1, { viTriXMm: 0, viTriYMm: 5000, viTriZMm: 0 }), kt);
    const theoZ = bboxCuaDatCho(datCho(1, { viTriXMm: 0, viTriYMm: 0, viTriZMm: 5000 }), kt);
    expect(theoY).not.toEqual(theoZ);
    expect(theoY.minZ).toBe(4600);
    expect(theoZ.minY).toBe(4100);
  });
});

describe("dichSceneSangDatCho / apDichVaoDatCho — phép NGƯỢC", () => {
  it("★★★ vòng tròn DB → scene → DB trả đúng số ban đầu", () => {
    const goc = datCho(1, { viTriXMm: 1000, viTriYMm: 2000, viTriZMm: 300 });
    const b = bboxCuaDatCho(goc, { rongMm: 1200, caoMm: 1800, sauMm: 800 });
    // Tâm bbox scene, đưa ngược về DB qua cùng phép hoán vị.
    const tamScene = {
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
      z: (b.minZ + b.maxZ) / 2,
    };
    const nguoc = dichSceneSangDatCho(tamScene);
    expect(nguoc.dXMm).toBeCloseTo(goc.viTriXMm, 9);
    expect(nguoc.dYMm).toBeCloseTo(goc.viTriYMm, 9);
    expect(nguoc.dZMm).toBeCloseTo(goc.viTriZMm, 9);
  });

  it("★ dịch theo trục Z SCENE cộng vào viTriYMm (mặt bằng), KHÔNG vào độ cao", () => {
    const d = apDichVaoDatCho(datCho(1, { viTriYMm: 0, viTriZMm: 0 }), { x: 0, y: 0, z: 1500 });
    expect(d.viTriYMm).toBe(1500);
    expect(d.viTriZMm).toBe(0);
  });

  it("★ dịch theo trục Y SCENE cộng vào viTriZMm (độ cao)", () => {
    const d = apDichVaoDatCho(datCho(1, { viTriYMm: 0, viTriZMm: 0 }), { x: 0, y: 900, z: 0 });
    expect(d.viTriZMm).toBe(900);
    expect(d.viTriYMm).toBe(0);
  });

  it("★★★ align 6 hướng qua hinhHocCanChinh dời máy trên MẶT BẰNG, không trên độ cao", async () => {
    const { canhTheoBien } = await import("../hinhHocCanChinh");
    const kt = { rongMm: 1200, caoMm: 1800, sauMm: 800 };
    const a = datCho(1, { viTriXMm: 0, viTriYMm: 1000, viTriZMm: 0 });
    const b = datCho(2, { viTriXMm: 0, viTriYMm: 9000, viTriZMm: 0 });
    const ket = canhTheoBien(
      [
        { khoa: "machine:1", bbox: bboxCuaDatCho(a, kt) },
        { khoa: "machine:2", bbox: bboxCuaDatCho(b, kt) },
      ],
      "tren",
    );
    const dich2 = ket.find((k) => k.khoa === "machine:2")!.dich;
    // Máy 2 phải LÙI trên trục Z scene về ngang máy 1 — tức đổi viTriYMm.
    const sau = apDichVaoDatCho(b, dich2);
    expect(sau.viTriYMm).toBeCloseTo(1000, 6);
    expect(sau.viTriZMm).toBe(0); // độ cao KHÔNG đổi
  });
});

// ---------------------------------------------------------------------------
// Gom thay đổi
// ---------------------------------------------------------------------------

describe("gomThayDoi", () => {
  it("★ G8 — không đổi gì trả mảng RỖNG (không ghi toàn bảng mỗi lần Lưu)", () => {
    const g = new Map([["machine:1", datCho(1)]]);
    const h = new Map([["machine:1", datCho(1)]]);
    expect(gomThayDoi(g, h)).toEqual([]);
  });

  it("bắt được thay đổi vị trí", () => {
    const g = new Map([["machine:1", datCho(1)]]);
    const h = new Map([["machine:1", datCho(1, { viTriXMm: 5000 })]]);
    const ket = gomThayDoi(g, h);
    expect(ket).toHaveLength(1);
    expect(ket[0].viTriXMm).toBe(5000);
  });

  it("bắt được thay đổi quaternion (xoay)", () => {
    const g = new Map([["machine:1", datCho(1)]]);
    const h = new Map([["machine:1", datCho(1, { quatY: 0.2588, quatW: 0.9659 })]]);
    expect(gomThayDoi(g, h)).toHaveLength(1);
  });

  it("bắt được đổi cờ daKhoa / hienThi / kichThuocDaDo", () => {
    const g = new Map([["machine:1", datCho(1)]]);
    expect(gomThayDoi(g, new Map([["machine:1", datCho(1, { daKhoa: true })]]))).toHaveLength(1);
    expect(gomThayDoi(g, new Map([["machine:1", datCho(1, { hienThi: false })]]))).toHaveLength(1);
    expect(
      gomThayDoi(g, new Map([["machine:1", datCho(1, { kichThuocDaDo: true })]])),
    ).toHaveLength(1);
  });

  it("★ lệch DƯỚI sai số numeric(14,3) KHÔNG tính là thay đổi", () => {
    const g = new Map([["machine:1", datCho(1, { viTriXMm: 1000 })]]);
    const h = new Map([["machine:1", datCho(1, { viTriXMm: 1000 + SAI_SO_MM / 2 })]]);
    expect(gomThayDoi(g, h)).toEqual([]);
  });

  it("★ lệch TRÊN sai số thì CÓ tính — G8 nhánh dương của cùng ngưỡng", () => {
    const g = new Map([["machine:1", datCho(1, { viTriXMm: 1000 })]]);
    const h = new Map([["machine:1", datCho(1, { viTriXMm: 1000 + SAI_SO_MM * 10 })]]);
    expect(gomThayDoi(g, h)).toHaveLength(1);
  });

  it("hàng MỚI (chưa có trong gốc) luôn được gom", () => {
    expect(gomThayDoi(new Map(), new Map([["machine:1", datCho(1)]]))).toHaveLength(1);
  });

  it("NULL ↔ số được coi là thay đổi", () => {
    const g = new Map([["machine:1", datCho(1, { rongMm: null })]]);
    const h = new Map([["machine:1", datCho(1, { rongMm: 1200 })]]);
    expect(gomThayDoi(g, h)).toHaveLength(1);
  });

  it("NULL ↔ NULL KHÔNG phải thay đổi", () => {
    const g = new Map([["machine:1", datCho(1, { rongMm: null })]]);
    const h = new Map([["machine:1", datCho(1, { rongMm: null })]]);
    expect(gomThayDoi(g, h)).toEqual([]);
  });

  it("kết quả TẤT ĐỊNH bất kể thứ tự Map", () => {
    const goc = new Map<string, DatChoDauVao>();
    const a = new Map([
      ["machine:2", datCho(2)],
      ["machine:1", datCho(1)],
    ]);
    const b = new Map([
      ["machine:1", datCho(1)],
      ["machine:2", datCho(2)],
    ]);
    expect(gomThayDoi(goc, a)).toEqual(gomThayDoi(goc, b));
  });
});

describe("chiaLo", () => {
  it("★ G8 — mảng rỗng trả [] chứ KHÔNG phải [[]]", () => {
    expect(chiaLo([])).toEqual([]);
  });

  it("dưới trần thì một lô", () => {
    expect(chiaLo([1, 2, 3])).toHaveLength(1);
  });

  it("đúng trần thì vẫn một lô", () => {
    expect(chiaLo(new Array(TRAN_LO_GHI).fill(0))).toHaveLength(1);
  });

  it("trên trần thì chia đôi, lô cuối là phần dư", () => {
    const lo = chiaLo(new Array(TRAN_LO_GHI + 1).fill(0));
    expect(lo).toHaveLength(2);
    expect(lo[0]).toHaveLength(TRAN_LO_GHI);
    expect(lo[1]).toHaveLength(1);
  });

  it("trần không hợp lệ rơi về mặc định thay vì chia vô hạn", () => {
    expect(chiaLo([1, 2, 3], 0)).toHaveLength(1);
    expect(chiaLo([1, 2, 3], Number.NaN)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Kẹp vào sàn
// ---------------------------------------------------------------------------

describe("kepVaoSan", () => {
  const kt = { rongMm: 1200, caoMm: 1800, sauMm: 800 };
  const san = { rongMm: 38400, sauMm: 30300 }; // TN-SEED-1 thật

  it("vị trí trong lòng sàn giữ NGUYÊN", () => {
    expect(kepVaoSan({ x: 10000, y: 0, z: 10000 }, kt, san)).toEqual({
      x: 10000,
      y: 0,
      z: 10000,
    });
  });

  it("★ kẹp có tính NỬA kích thước — máy không thò một nửa ra ngoài tường", () => {
    expect(kepVaoSan({ x: 0, y: 0, z: 0 }, kt, san).x).toBe(600);
    expect(kepVaoSan({ x: 0, y: 0, z: 0 }, kt, san).z).toBe(400);
  });

  it("kẹp mép xa", () => {
    expect(kepVaoSan({ x: 99999, y: 0, z: 99999 }, kt, san)).toEqual({
      x: 38400 - 600,
      y: 0,
      z: 30300 - 400,
    });
  });

  it("độ cao Y KHÔNG bị kẹp (kéo ngang không nhấc máy)", () => {
    expect(kepVaoSan({ x: 0, y: 12345, z: 0 }, kt, san).y).toBe(12345);
  });

  it("★ sàn NHỎ hơn máy ⇒ về tâm sàn, không dán vào mép ngẫu nhiên", () => {
    const r = kepVaoSan({ x: 0, y: 0, z: 0 }, kt, { rongMm: 500, sauMm: 400 });
    expect(r.x).toBe(250);
    expect(r.z).toBe(200);
  });
});
