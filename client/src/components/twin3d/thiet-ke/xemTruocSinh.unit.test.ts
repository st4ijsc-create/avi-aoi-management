/**
 * Test cho `xemTruocSinh.ts` — bảng tổng kết + ghost của `HopThoaiSinh`.
 *
 * ★★★ Test quan trọng nhất ở đây là "vòng tròn khoá": dựng tập `nguon='tay'`
 *   bằng {@link khoaDaChinhTay}, đưa vào `sinhBoCuc`, rồi khẳng định `boQua`
 *   CHỨA đúng mục đó. Đây là bản vá cấu trúc cho lớp lỗi BG-127 — nếu hai bên
 *   dựng khoá bằng hai công thức khác nhau thì tập vẫn có phần tử, hàm vẫn
 *   chạy, `boQua` rỗng, và mọi chỉnh tay bị đè SẠCH mà không lỗi nào nổ.
 */

import { describe, expect, it } from "vitest";

import {
  CAU_HINH_SINH_MAC_DINH,
  type CayPhanCapDauVao,
  type KetQuaSinh,
  sinhBoCuc,
} from "../sinhBoCuc";
import type { KichThuocMm } from "../hinhKhoiMay";
import type { DatChoDauVao } from "./trangThaiThietKe";
import {
  NGUONG_DOI_MM,
  dungLopMa,
  khoaDaChinhTay,
  soMaySeDoi,
  tongKetSinh,
} from "./xemTruocSinh";

// ---------------------------------------------------------------------------
// Đồ gá — cây nhỏ nhưng ĐÚNG HÌNH DẠNG của SIM-FAC
// ---------------------------------------------------------------------------

function cayMau(soMay = 3): CayPhanCapDauVao {
  return {
    nhaMay: [{ id: 1, ma: "SIM-FAC", isActive: true }],
    toaNha: [{ id: 24, factoryId: 1, ma: "TN-SEED-1" }],
    tang: [{ id: 28, toaNhaId: 24, capSo: 1 }],
    xuong: [{ id: 1, ma: "X1", factoryId: 1, tangId: 28 }],
    chuyen: [{ id: 1, ma: "L1", workshopId: 1 }],
    tram: [{ id: 10, ma: "T10", lineId: 1, thuTu: 1 }],
    may: Array.from({ length: soMay }, (_, i) => ({
      id: i + 1,
      stationId: 10,
      ma: `M${i + 1}`,
      loaiMay: "AOI",
      isActive: true,
    })),
  };
}

const KICH_THUOC = new Map<string, KichThuocMm>([
  ["AOI", { rongMm: 1400, caoMm: 1900, sauMm: 900 }],
]);

function chay(cay: CayPhanCapDauVao, daTay: ReadonlySet<string> = new Set()): KetQuaSinh {
  return sinhBoCuc(cay, KICH_THUOC, daTay, CAU_HINH_SINH_MAC_DINH);
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
    viTriXMm: 0,
    viTriYMm: 0,
    viTriZMm: 0,
    rongMm: 1400,
    caoMm: 1900,
    sauMm: 900,
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
// ★★★ Vòng tròn khoá — bản vá cấu trúc cho BG-127
// ---------------------------------------------------------------------------

describe("khoaDaChinhTay — vòng tròn với sinhBoCuc", () => {
  it("★★★ khoá dựng ở đây ĐƯỢC sinhBoCuc nhận ra ⇒ mục đó vào boQua", () => {
    const hienCo = [datCho(2, { nguon: "tay" })];
    const tap = khoaDaChinhTay(hienCo);
    expect(tap.has("machine:2")).toBe(true);

    const ket = chay(cayMau(3), tap);
    expect(ket.boQua.map((b) => `${b.loai}:${b.id}`)).toContain("machine:2");
    expect(ket.datCho.some((d) => d.loaiThucThe === "machine" && d.thucTheId === 2)).toBe(false);
  });

  it("★★★ ĐỐI CHỨNG — khoá dựng SAI DẠNG (gạch nối) KHÔNG chặn được gì", () => {
    // Đây là hình dạng của lỗi BG-127: tập KHÔNG rỗng, hàm chạy, boQua RỖNG.
    const tapSai = new Set(["machine-2"]);
    expect(tapSai.size).toBe(1);
    const ket = chay(cayMau(3), tapSai);
    expect(ket.boQua).toHaveLength(0);
    expect(ket.datCho.some((d) => d.loaiThucThe === "machine" && d.thucTheId === 2)).toBe(true);
  });

  it("★ G8 — chỉ hàng nguon='tay' vào tập; 'sinh' và 'nhap' KHÔNG", () => {
    const tap = khoaDaChinhTay([
      datCho(1, { nguon: "sinh" }),
      datCho(2, { nguon: "tay" }),
      datCho(3, { nguon: "nhap" }),
    ]);
    expect([...tap]).toEqual(["machine:2"]);
  });

  it("mảng rỗng cho tập rỗng", () => {
    expect(khoaDaChinhTay([]).size).toBe(0);
  });

  it("bắt được mọi loại thực thể, không chỉ machine", () => {
    const tap = khoaDaChinhTay([
      datCho(10, { loaiThucThe: "station", nguon: "tay" }),
      datCho(1, { loaiThucThe: "line", nguon: "tay" }),
    ]);
    expect(tap.has("station:10")).toBe(true);
    expect(tap.has("line:1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bảng tổng kết
// ---------------------------------------------------------------------------

describe("tongKetSinh", () => {
  it("seTao bằng số hàng datCho mà sinhBoCuc trả về", () => {
    const ket = chay(cayMau(3));
    const tk = tongKetSinh(ket, []);
    expect(tk.seTao).toBe(ket.datCho.length);
  });

  it("chưa có gì trong DB ⇒ tất cả là seTaoMoi, seGhiDe = 0", () => {
    const tk = tongKetSinh(chay(cayMau(3)), []);
    expect(tk.seGhiDe).toBe(0);
    expect(tk.seTaoMoi).toBe(tk.seTao);
  });

  it("★ hàng đã tồn tại đếm vào seGhiDe, KHÔNG vào seTaoMoi", () => {
    const ket = chay(cayMau(3));
    const daCo = ket.datCho
      .filter((d) => d.loaiThucThe === "machine")
      .slice(0, 2)
      .map((d) => datCho(d.thucTheId));
    const tk = tongKetSinh(ket, daCo);
    expect(tk.seGhiDe).toBe(2);
    expect(tk.seTaoMoi).toBe(tk.seTao - 2);
  });

  it("seTaoMoi + seGhiDe LUÔN bằng seTao — bất biến số học", () => {
    const ket = chay(cayMau(5));
    for (const n of [0, 1, 3]) {
      const daCo = ket.datCho.slice(0, n).map((d) => datCho(d.thucTheId, { loaiThucThe: d.loaiThucThe }));
      const tk = tongKetSinh(ket, daCo);
      expect(tk.seTaoMoi + tk.seGhiDe).toBe(tk.seTao);
    }
  });

  it("★★★ giuNguyen = số mục sinhBoCuc TỰ KHAI bỏ qua — con số M của câu spec", () => {
    const tap = khoaDaChinhTay([datCho(2, { nguon: "tay" })]);
    const ket = chay(cayMau(3), tap);
    const tk = tongKetSinh(ket, []);
    expect(tk.giuNguyen).toBe(ket.boQua.length);
    expect(tk.giuNguyen).toBe(1);
    expect(tk.chiTietGiuNguyen[0].id).toBe(2);
  });

  it("★ G8 — không có gì chỉnh tay thì giuNguyen = 0", () => {
    expect(tongKetSinh(chay(cayMau(3)), []).giuNguyen).toBe(0);
  });

  it("★ máy bị giữ nguyên KHÔNG nằm trong seTao (không bị đè)", () => {
    const tap = khoaDaChinhTay([datCho(2, { nguon: "tay" })]);
    const ket = chay(cayMau(3), tap);
    const idMaySinh = ket.datCho
      .filter((d) => d.loaiThucThe === "machine")
      .map((d) => d.thucTheId);
    expect(idMaySinh).not.toContain(2);
    expect(idMaySinh).toContain(1);
    expect(idMaySinh).toContain(3);
  });

  it("vatTheHaTang và canhBao đi thẳng từ kết quả sinh", () => {
    const ket = chay(cayMau(3));
    const tk = tongKetSinh(ket, []);
    expect(tk.vatTheHaTang).toBe(ket.vatThe.length);
    expect(tk.canhBao).toEqual(ket.canhBao);
  });

  it("cảnh báo cấu trúc được chở lên UI (máy không thuộc trạm nào)", () => {
    const cay = cayMau(2);
    cay.may.push({ id: 99, stationId: null, ma: "M99", loaiMay: "AOI", isActive: true });
    const tk = tongKetSinh(chay(cay), []);
    expect(tk.canhBao.length).toBeGreaterThan(0);
    expect(tk.canhBao.join(" ")).toContain("không thuộc trạm");
  });
});

// ---------------------------------------------------------------------------
// Lớp ghost
// ---------------------------------------------------------------------------

describe("dungLopMa", () => {
  it("★ CHỈ ghost cho máy — station/line/workshop bị loại", () => {
    const ket = chay(cayMau(3));
    const ma = dungLopMa(ket, []);
    expect(ma.every((m) => m.loai === "machine")).toBe(true);
    expect(ma).toHaveLength(3);
    // Kết quả sinh CÓ chở các loại khác — chứng minh phép lọc thật sự lọc.
    expect(ket.datCho.some((d) => d.loaiThucThe !== "machine")).toBe(true);
  });

  it("★ máy CHƯA có vị trí cũ ⇒ seDoi = true", () => {
    expect(dungLopMa(chay(cayMau(2)), []).every((m) => m.seDoi)).toBe(true);
  });

  it("★★★ G8 — máy sinh lại ĐÚNG chỗ cũ ⇒ seDoi = FALSE", () => {
    const ket = chay(cayMau(3));
    const hienCo = ket.datCho
      .filter((d) => d.loaiThucThe === "machine")
      .map((d) =>
        datCho(d.thucTheId, {
          viTriXMm: d.viTriXMm,
          viTriYMm: d.viTriYMm,
          viTriZMm: d.viTriZMm,
        }),
      );
    const ma = dungLopMa(ket, hienCo);
    expect(ma).toHaveLength(3);
    expect(ma.every((m) => m.seDoi === false)).toBe(true);
    expect(soMaySeDoi(ma)).toBe(0);
  });

  it("★ lệch DƯỚI ngưỡng không tính là dời (nhiễu numeric)", () => {
    const ket = chay(cayMau(1));
    const m = ket.datCho.find((d) => d.loaiThucThe === "machine")!;
    const ma = dungLopMa(ket, [
      datCho(m.thucTheId, {
        viTriXMm: m.viTriXMm + NGUONG_DOI_MM / 4,
        viTriYMm: m.viTriYMm,
        viTriZMm: m.viTriZMm,
      }),
    ]);
    expect(ma[0].seDoi).toBe(false);
  });

  it("★ lệch TRÊN ngưỡng CÓ tính — cùng ngưỡng, nhánh dương", () => {
    const ket = chay(cayMau(1));
    const m = ket.datCho.find((d) => d.loaiThucThe === "machine")!;
    const ma = dungLopMa(ket, [
      datCho(m.thucTheId, {
        viTriXMm: m.viTriXMm + NGUONG_DOI_MM * 100,
        viTriYMm: m.viTriYMm,
        viTriZMm: m.viTriZMm,
      }),
    ]);
    expect(ma[0].seDoi).toBe(true);
  });

  it("thứ tự ghost TẤT ĐỊNH", () => {
    const ket = chay(cayMau(4));
    expect(dungLopMa(ket, []).map((m) => m.khoa)).toEqual(
      dungLopMa(ket, []).map((m) => m.khoa),
    );
    const khoas = dungLopMa(ket, []).map((m) => m.khoa);
    expect([...khoas].sort()).toEqual(khoas);
  });

  it("ghost mang kích thước thật của hàng sẽ sinh", () => {
    const ma = dungLopMa(chay(cayMau(1)), []);
    expect(ma[0].rongMm).toBe(1400);
    expect(ma[0].caoMm).toBe(1900);
    expect(ma[0].sauMm).toBe(900);
  });

  it("máy bị GIỮ NGUYÊN không có ghost (nó không nằm trong datCho)", () => {
    const tap = khoaDaChinhTay([datCho(2, { nguon: "tay" })]);
    const ma = dungLopMa(chay(cayMau(3), tap), []);
    expect(ma.map((m) => m.khoa)).not.toContain("machine:2");
  });
});

describe("soMaySeDoi", () => {
  it("mảng rỗng trả 0", () => {
    expect(soMaySeDoi([])).toBe(0);
  });

  it("đếm đúng số cờ seDoi", () => {
    const ket = chay(cayMau(3));
    expect(soMaySeDoi(dungLopMa(ket, []))).toBe(3);
  });
});
