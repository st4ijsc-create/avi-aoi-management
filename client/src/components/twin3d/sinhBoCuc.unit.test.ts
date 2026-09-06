/**
 * sinhBoCuc.unit.test.ts — Chín tính chất T1–T9 của §8.3/§8.4.
 *
 * ★ TÊN TỆP `.unit.test.ts` là BẮT BUỘC: `vitest.config.ts` chỉ include
 *   `client/src/**\/*.unit.test.ts`. Đặt tên `.test.ts` thì test KHÔNG ĐƯỢC THU
 *   THẬP mà cổng vẫn báo xanh (luật G3).
 */

import { describe, expect, it } from "vitest";
import {
  CAU_HINH_SINH_MAC_DINH,
  type CauHinhSinh,
  type CayPhanCapDauVao,
  type ViTriDatCho,
  khoaThucThe,
  lechTrongTram,
  sinhBoCuc,
  xepKeXuong,
} from "./sinhBoCuc";
import { type KichThuocMm } from "./hinhKhoiMay";
import { type BBox, bboxGiaoNhauTrenSan, bboxNamTrong, laQuatChuanHoa } from "./heToaDo";

// ---------------------------------------------------------------------------
// Dựng đầu vào
// ---------------------------------------------------------------------------

function cayRong(): CayPhanCapDauVao {
  return { nhaMay: [], toaNha: [], tang: [], xuong: [], chuyen: [], tram: [], may: [] };
}

/**
 * Dựng một cây phân cấp TẤT ĐỊNH theo tham số quy mô.
 * Mọi id sinh bằng công thức, không bằng bộ đếm toàn cục — hai lần gọi cho hai
 * cây deep-equal, điều kiện của T1.
 */
function dungCay(opts: {
  soNhaMay: number;
  soXuongMoiNhaMay: number;
  soChuyenMoiXuong: number;
  soTramMoiChuyen: number;
  soMayMoiTram: number;
  /** Gán tangId cho xưởng theo chỉ số, để đo GC-1. */
  tangChoXuong?: (chiSoXuong: number) => number | null;
}): CayPhanCapDauVao {
  const cay = cayRong();
  let idXuong = 0;
  let idChuyen = 0;
  let idTram = 0;
  let idMay = 0;

  for (let f = 1; f <= opts.soNhaMay; f++) {
    cay.nhaMay.push({ id: f, ma: `FAC-${f}`, isActive: true });
    cay.toaNha.push({ id: 100 + f, factoryId: f, ma: `TN-${f}` });
    cay.tang.push({ id: 200 + f, toaNhaId: 100 + f, capSo: 1 });

    for (let w = 1; w <= opts.soXuongMoiNhaMay; w++) {
      idXuong += 1;
      const chiSo = idXuong;
      cay.xuong.push({
        id: idXuong,
        factoryId: f,
        ma: `XU-${String(idXuong).padStart(2, "0")}`,
        tangId: opts.tangChoXuong ? opts.tangChoXuong(chiSo) : null,
      });
      for (let l = 1; l <= opts.soChuyenMoiXuong; l++) {
        idChuyen += 1;
        cay.chuyen.push({
          id: idChuyen,
          workshopId: idXuong,
          ma: `L-${String(idChuyen).padStart(2, "0")}`,
        });
        for (let s = 1; s <= opts.soTramMoiChuyen; s++) {
          idTram += 1;
          cay.tram.push({
            id: idTram,
            lineId: idChuyen,
            ma: `ST-${String(idTram).padStart(3, "0")}`,
            thuTu: s,
          });
          for (let m = 1; m <= opts.soMayMoiTram; m++) {
            idMay += 1;
            cay.may.push({
              id: idMay,
              stationId: idTram,
              ma: `MC-${String(idMay).padStart(3, "0")}`,
              loaiMay: m % 2 === 0 ? "AOI" : "AVI",
              isActive: true,
            });
          }
        }
      }
    }
  }
  return cay;
}

/** Bảng kích thước theo loại — mọi số là GIẢ ĐỊNH (NT-4). */
const BANG_KICH_THUOC: ReadonlyMap<string, KichThuocMm> = new Map([
  ["AOI", { rongMm: 1400, caoMm: 1800, sauMm: 1200 }],
  ["AVI", { rongMm: 1600, caoMm: 1800, sauMm: 1200 }],
  ["SPI", { rongMm: 1200, caoMm: 1600, sauMm: 1000 }],
]);

function bboxCua(h: ViTriDatCho): BBox {
  return {
    minX: h.viTriXMm - h.rongMm / 2,
    maxX: h.viTriXMm + h.rongMm / 2,
    minY: h.viTriZMm,
    maxY: h.viTriZMm + h.caoMm,
    minZ: h.viTriYMm - h.sauMm / 2,
    maxZ: h.viTriYMm + h.sauMm / 2,
  };
}

/** Chỉ MÁY — T4 nói về "2 máy bất kỳ trong cùng tầng". */
function chiMay(kq: { datCho: ViTriDatCho[] }): ViTriDatCho[] {
  return kq.datCho.filter((d) => d.loaiThucThe === "machine");
}

// ---------------------------------------------------------------------------
// T1 — Tất định
// ---------------------------------------------------------------------------

describe("T1 — tất định", () => {
  it("gọi 2 lần cùng đầu vào cho kết quả deep-equal", () => {
    const cay = dungCay({
      soNhaMay: 2,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 3,
      soTramMoiChuyen: 4,
      soMayMoiTram: 2,
    });
    const a = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    const b = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(a).toEqual(b);
    // Deep-equal của JSON là phép so ĐỘC LẬP với toEqual (khác mô hình):
    // toEqual bỏ qua thứ tự khoá của object, JSON.stringify thì KHÔNG.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("KHÔNG phụ thuộc thứ tự DB trả về — đảo mọi mảng đầu vào cho cùng kết quả", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 2,
      soChuyenMoiXuong: 2,
      soTramMoiChuyen: 3,
      soMayMoiTram: 2,
    });
    const daoNguoc: CayPhanCapDauVao = {
      nhaMay: [...cay.nhaMay].reverse(),
      toaNha: [...cay.toaNha].reverse(),
      tang: [...cay.tang].reverse(),
      xuong: [...cay.xuong].reverse(),
      chuyen: [...cay.chuyen].reverse(),
      tram: [...cay.tram].reverse(),
      may: [...cay.may].reverse(),
    };
    expect(sinhBoCuc(daoNguoc, BANG_KICH_THUOC, new Set())).toEqual(
      sinhBoCuc(cay, BANG_KICH_THUOC, new Set()),
    );
  });

  it("mã nguồn KHÔNG chứa Math.random / Date.now / localeCompare (§8.3)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const nguon = await fs.readFile(
      path.resolve(import.meta.dirname, "sinhBoCuc.ts"),
      "utf8",
    );
    // ⚠ Phải bóc CHÚ THÍCH trước khi grep. Docblock của chính file đó viết
    //   "không Math.random(), không Date.now()" nên grep trên nguyên văn sẽ
    //   ĐỎ vì đúng cái câu cam kết không dùng chúng — một âm-tính-giả hoàn hảo
    //   (phép đo bắt lời KHAI thay vì bắt hành VI).
    const chiMa = nguon
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(chiMa).not.toMatch(/Math\.random/);
    expect(chiMa).not.toMatch(/Date\.now/);
    // localeCompare cũng KHÔNG tất định (phụ thuộc ICU/locale của máy chạy).
    expect(chiMa).not.toMatch(/localeCompare/);
    // Sàng: phép bóc chú thích KHÔNG được nuốt hết mã (nếu nuốt hết thì ba
    // assertion trên xanh vĩnh viễn — đúng lớp "chỉ báo tự thoả mãn" của G8).
    expect(chiMa).toMatch(/export function sinhBoCuc/);
    expect(chiMa.length).toBeGreaterThan(nguon.length / 4);
  });
});

// ---------------------------------------------------------------------------
// T2 — Idempotent
// ---------------------------------------------------------------------------

describe("T2 — idempotent", () => {
  it("đưa kết quả lần 1 vào làm daCoThuCong rỗng → lần 2 y hệt", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 2,
      soChuyenMoiXuong: 3,
      soTramMoiChuyen: 4,
      soMayMoiTram: 1,
    });
    const lan1 = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    const lan2 = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(lan2).toEqual(lan1);
  });

  it("mọi hàng sinh ra đều mang nguon='sinh'", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 2,
      soTramMoiChuyen: 2,
      soMayMoiTram: 1,
    });
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(kq.datCho.length).toBeGreaterThan(0);
    for (const d of kq.datCho) expect(d.nguon).toBe("sinh");
    for (const v of kq.vatThe) expect(v.nguon).toBe("sinh");
  });
});

// ---------------------------------------------------------------------------
// T3 — Tôn trọng thủ công
// ---------------------------------------------------------------------------

describe("T3 — tôn trọng thủ công", () => {
  it("5 máy đánh dấu 'tay' nằm trong boQua và KHÔNG có trong datCho", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 2,
      soTramMoiChuyen: 5,
      soMayMoiTram: 2,
    });
    const idTay = [1, 3, 5, 7, 9];
    const daTay = new Set(idTay.map((id) => khoaThucThe("machine", id)));
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, daTay);

    const idTrongDatCho = new Set(chiMay(kq).map((d) => d.thucTheId));
    for (const id of idTay) expect(idTrongDatCho.has(id)).toBe(false);

    const boQuaMay = kq.boQua.filter((b) => b.loai === "machine").map((b) => b.id);
    expect([...boQuaMay].sort((a, b) => a - b)).toEqual(idTay);
  });

  it("daCoThuCong rỗng → boQua rỗng (đối chứng: cờ biết im lặng)", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 3,
      soMayMoiTram: 1,
    });
    expect(sinhBoCuc(cay, BANG_KICH_THUOC, new Set()).boQua).toEqual([]);
  });

  it("chặn cả xưởng/chuyền/trạm đã chỉnh tay, không chỉ máy", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 2,
      soMayMoiTram: 1,
    });
    const daTay = new Set([
      khoaThucThe("workshop", 1),
      khoaThucThe("line", 1),
      khoaThucThe("station", 2),
    ]);
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, daTay);
    const loai = kq.boQua.map((b) => `${b.loai}:${b.id}`).sort();
    expect(loai).toEqual(["line:1", "station:2", "workshop:1"]);
    expect(kq.datCho.some((d) => d.loaiThucThe === "workshop")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4 — KHÔNG chồng lấn (phép so CHẶT)
// ---------------------------------------------------------------------------

describe("T4 — không chồng lấn", () => {
  /** Trả cặp chồng lấn ĐẦU TIÊN để thông báo lỗi nói được CHỖ NÀO sai. */
  function capChongLan(may: ViTriDatCho[]): string | null {
    const theoTang = new Map<number, ViTriDatCho[]>();
    for (const m of may) {
      const cu = theoTang.get(m.tangId);
      if (cu) cu.push(m);
      else theoTang.set(m.tangId, [m]);
    }
    for (const [tangId, ds] of theoTang) {
      for (let i = 0; i < ds.length; i++) {
        for (let j = i + 1; j < ds.length; j++) {
          if (bboxGiaoNhauTrenSan(bboxCua(ds[i]), bboxCua(ds[j]))) {
            return `tầng ${tangId}: machine:${ds[i].thucTheId} × machine:${ds[j].thucTheId}`;
          }
        }
      }
    }
    return null;
  }

  it("quy mô NHỎ NHẤT — 1 xưởng, 2 chuyền, 2 trạm, 2 máy", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 2,
      soTramMoiChuyen: 2,
      soMayMoiTram: 2,
    });
    const may = chiMay(sinhBoCuc(cay, BANG_KICH_THUOC, new Set()));
    expect(may.length).toBe(8);
    expect(capChongLan(may)).toBeNull();
  });

  it("★ QUY MÔ THẬT — 2 nhà máy / 2 xưởng / 3 Line / 37 trạm / 43 máy", () => {
    const cay = cayQuyMoThat();
    const may = chiMay(sinhBoCuc(cay, BANG_KICH_THUOC, new Set()));
    expect(may.length).toBe(43);
    expect(capChongLan(may)).toBeNull();
  });

  it("★ HAI XƯỞNG KỀ NHAU trên một tầng — ca T4 nhạy với phép đảo trục bước 3", () => {
    // ⚠ Đo được: một xưởng ĐỨNG MỘT MÌNH trên tầng vẫn cho T4 XANH khi trục bị
    //   đảo, vì nội dung bên trong ô vẫn xếp đúng — nó chỉ TRÀN ra ngoài ô, và
    //   cái tràn đó chỉ va vào cái gì khi có một xưởng KHÁC ngay bên cạnh.
    //   Số đo cho cấu hình dưới đây (2 chuyền × 10 trạm, hai xưởng cùng hàng):
    //     ô ĐÚNG 27.500 × 18.000 ⇒ xưởng 2 bắt đầu tại x = 31.500 (nội dung
    //       xưởng 1 chỉ tới 25.000)  → không chạm
    //     ô SAI  14.500 × 31.000 ⇒ xưởng 2 bắt đầu tại x = 18.500, mà nội dung
    //       xưởng 1 vẫn tới 25.000  → CHỒNG LẤN
    //   Không có ca này thì T4 mù đúng cái lỗi mà §8.2 bảo nó phải bắt.
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 2,
      soChuyenMoiXuong: 2,
      soTramMoiChuyen: 10,
      soMayMoiTram: 1,
    });
    const may = chiMay(sinhBoCuc(cay, BANG_KICH_THUOC, new Set()));
    expect(may.length).toBe(40);
    expect(capChongLan(may)).toBeNull();
  });

  it("nhiều xưởng xuống hàng (shelf packing) vẫn không chồng", () => {
    const chatHep: CauHinhSinh = { ...CAU_HINH_SINH_MAC_DINH, rongSanToiDaMm: 30_000 };
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 5,
      soChuyenMoiXuong: 2,
      soTramMoiChuyen: 6,
      soMayMoiTram: 2,
    });
    const may = chiMay(sinhBoCuc(cay, BANG_KICH_THUOC, new Set(), chatHep));
    expect(may.length).toBe(120);
    expect(capChongLan(may)).toBeNull();
  });

  it("bboxGiaoNhauTrenSan KÊU trên ca dương đã biết (sàng mật độ assertion)", () => {
    // Nếu phép đo của T4 không biết kêu, mọi kết quả xanh ở trên là vô nghĩa.
    const a: BBox = { minX: 0, maxX: 100, minY: 0, maxY: 10, minZ: 0, maxZ: 100 };
    const b: BBox = { minX: 50, maxX: 150, minY: 0, maxY: 10, minZ: 50, maxZ: 150 };
    expect(bboxGiaoNhauTrenSan(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T5 — Trong biên
// ---------------------------------------------------------------------------

describe("T5 — trong biên", () => {
  it("mọi máy nằm trong bbox mặt sàn của tầng chứa nó", () => {
    const cay = cayQuyMoThat();
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());

    // Biên tầng = bbox của SÀN sinh kèm (bước 8) — đây là biên mà người dùng thấy.
    const sanTheoTang = new Map<number, BBox>();
    for (const v of kq.vatThe) {
      if (v.ten !== "Sàn tầng") continue;
      sanTheoTang.set(v.tangId, {
        minX: v.viTriXMm - v.rongMm / 2,
        maxX: v.viTriXMm + v.rongMm / 2,
        minY: -Infinity,
        maxY: Infinity,
        minZ: v.viTriYMm - v.sauMm / 2,
        maxZ: v.viTriYMm + v.sauMm / 2,
      });
    }
    expect(sanTheoTang.size).toBeGreaterThan(0);

    for (const m of chiMay(kq)) {
      const san = sanTheoTang.get(m.tangId);
      expect(san, `tầng ${m.tangId} không có sàn`).toBeDefined();
      const b = bboxCua(m);
      const trong: BBox = { ...b, minY: 0, maxY: 0 };
      expect(
        bboxNamTrong(trong, san as BBox),
        `machine:${m.thucTheId} ra ngoài sàn tầng ${m.tangId}`,
      ).toBe(true);
    }
  });

  it("bboxNamTrong KÊU trên ca âm đã biết (sàng mật độ assertion)", () => {
    const ngoai: BBox = { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 };
    const tran: BBox = { minX: 5, maxX: 15, minY: 0, maxY: 1, minZ: 0, maxZ: 1 };
    expect(bboxNamTrong(tran, ngoai)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T6 — Quaternion chuẩn hoá
// ---------------------------------------------------------------------------

describe("T6 — quaternion chuẩn hoá", () => {
  it("mọi hàng datCho có x²+y²+z²+w² ≈ 1 (sai số 1e-6, khớp CHECK của DB)", () => {
    const kq = sinhBoCuc(cayQuyMoThat(), BANG_KICH_THUOC, new Set());
    expect(kq.datCho.length).toBeGreaterThan(0);
    for (const d of kq.datCho) {
      const q = { x: d.quatX, y: d.quatY, z: d.quatZ, w: d.quatW };
      expect(
        laQuatChuanHoa(q, 1e-6),
        `${d.loaiThucThe}:${d.thucTheId} quaternion lệch chuẩn`,
      ).toBe(true);
      expect(Number.isFinite(d.quatX + d.quatY + d.quatZ + d.quatW)).toBe(true);
    }
  });

  it("dải chuyền LẺ quay 180° — hướng máy có THẬT hai giá trị, không hằng số", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 2,
      soTramMoiChuyen: 1,
      soMayMoiTram: 1,
    });
    const may = chiMay(sinhBoCuc(cay, BANG_KICH_THUOC, new Set()));
    const gocY = new Set(may.map((m) => Math.round(Math.abs(m.quatY) * 1e6) / 1e6));
    // Dải 0 → quatY = 0; dải 1 (180°) → |quatY| = 1.
    expect([...gocY].sort()).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// T7 — Đầu vào rỗng
// ---------------------------------------------------------------------------

describe("T7 — đầu vào rỗng", () => {
  it("cây rỗng → kết quả rỗng, KHÔNG ném lỗi", () => {
    const kq = sinhBoCuc(cayRong(), new Map(), new Set());
    expect(kq).toEqual({ datCho: [], vatThe: [], boQua: [], canhBao: [] });
  });

  it("chỉ có nhà máy, không có gì khác → rỗng, không ném", () => {
    const cay = cayRong();
    cay.nhaMay.push({ id: 1, ma: "FAC-1", isActive: true });
    const kq = sinhBoCuc(cay, new Map(), new Set());
    expect(kq.datCho).toEqual([]);
    expect(kq.vatThe).toEqual([]);
  });

  it("nhà máy KHÔNG hoạt động bị loại khỏi phép sinh", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 2,
      soMayMoiTram: 1,
    });
    cay.nhaMay[0].isActive = false;
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(kq.datCho).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T8 — Dữ liệu khuyết
// ---------------------------------------------------------------------------

describe("T8 — dữ liệu khuyết", () => {
  it("xưởng không chuyền → cảnh báo, phần còn lại vẫn sinh", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 2,
      soMayMoiTram: 1,
    });
    cay.xuong.push({ id: 99, factoryId: 1, ma: "XU-99", tangId: null });
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(kq.canhBao.some((c) => c.includes("xưởng không có chuyền"))).toBe(true);
    expect(chiMay(kq).length).toBe(2);
  });

  it("chuyền không trạm → cảnh báo, phần còn lại vẫn sinh", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 2,
      soMayMoiTram: 1,
    });
    cay.chuyen.push({ id: 99, workshopId: 1, ma: "L-99" });
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(kq.canhBao.some((c) => c.includes("chuyền không có trạm"))).toBe(true);
    expect(chiMay(kq).length).toBe(2);
  });

  it("máy không thuộc trạm nào → cảnh báo, KHÔNG có trong datCho", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 2,
      soMayMoiTram: 1,
    });
    cay.may.push({
      id: 999,
      stationId: null,
      ma: "MC-999",
      loaiMay: "AOI",
      isActive: true,
    });
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(kq.canhBao.some((c) => c.includes("không thuộc trạm nào"))).toBe(true);
    expect(chiMay(kq).some((d) => d.thucTheId === 999)).toBe(false);
  });

  it("trạm thiếu orderIndex vẫn xếp được (xuống cuối, tất định theo mã)", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 3,
      soMayMoiTram: 1,
    });
    cay.tram[1].thuTu = null;
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    const tram = kq.datCho.filter((d) => d.loaiThucThe === "station");
    expect(tram.length).toBe(3);
    // Trạm thiếu thứ tự (id 2) đi CUỐI ⇒ x lớn nhất.
    const xTheoId = new Map(tram.map((t) => [t.thucTheId, t.viTriXMm]));
    expect(xTheoId.get(2)).toBeGreaterThan(xTheoId.get(3) as number);
  });

  it("loại máy KHÔNG có trong bảng kích thước → dùng mặc định, không ném", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 1,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 1,
      soMayMoiTram: 1,
    });
    cay.may[0].loaiMay = "LOAI_LA_HOAC_MOI";
    const may = chiMay(sinhBoCuc(cay, BANG_KICH_THUOC, new Set()));
    expect(may[0].rongMm).toBe(CAU_HINH_SINH_MAC_DINH.kichThuocMacDinh.rongMm);
    // NT-4: số theo chủng loại là GIẢ ĐỊNH, phải tự khai.
    expect(may[0].kichThuocDaDo).toBe(false);
  });

  it("xưởng không có toà nhà/tầng → cảnh báo, không ném", () => {
    const cay = cayRong();
    cay.nhaMay.push({ id: 1, ma: "FAC-1", isActive: true });
    cay.xuong.push({ id: 1, factoryId: 1, ma: "XU-01", tangId: null });
    cay.chuyen.push({ id: 1, workshopId: 1, ma: "L-01" });
    cay.tram.push({ id: 1, lineId: 1, ma: "ST-001", thuTu: 1 });
    cay.may.push({ id: 1, stationId: 1, ma: "MC-001", loaiMay: "AOI", isActive: true });
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    expect(kq.canhBao.some((c) => c.includes("không có toà nhà/tầng"))).toBe(true);
    expect(kq.datCho).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T9 — Quy mô thật
// ---------------------------------------------------------------------------

/**
 * Quy mô THẬT đo được trên DB dev (§1.2 / §10C.0):
 * 2 nhà máy · 2 xưởng · 3 Line (SIM-L1 12 trạm 18 máy, SIM-L2 12/12, SIM-L3
 * 12/12) + Line thứ 4 của nhà máy 2 (T12: 1 trạm, 1 máy) = 37 trạm, 43 máy.
 */
function cayQuyMoThat(): CayPhanCapDauVao {
  const cay = cayRong();
  cay.nhaMay.push(
    { id: 1, ma: "SIM-FAC", isActive: true },
    { id: 2, ma: "T12-FAC", isActive: true },
  );
  cay.toaNha.push(
    { id: 101, factoryId: 1, ma: "TN-1" },
    { id: 102, factoryId: 2, ma: "TN-2" },
  );
  cay.tang.push(
    { id: 201, toaNhaId: 101, capSo: 1 },
    { id: 202, toaNhaId: 102, capSo: 1 },
  );
  cay.xuong.push(
    { id: 1, factoryId: 1, ma: "XU-LAP-RAP-AO", tangId: 201 },
    { id: 2, factoryId: 2, ma: "XU-T12", tangId: 202 },
  );

  let idTram = 0;
  let idMay = 0;
  const line: [number, number, string, number, number, number][] = [
    // [idChuyen, idXuong, mã, số trạm, số máy, ...]
    [1, 1, "SIM-L1", 12, 18, 0],
    [2, 1, "SIM-L2", 12, 12, 0],
    [3, 1, "SIM-L3", 12, 12, 0],
    [11, 2, "T12-SHOT-LA", 1, 1, 0],
  ];
  for (const [idChuyen, idXuong, ma, soTram, soMay] of line) {
    cay.chuyen.push({ id: idChuyen, workshopId: idXuong, ma });
    const tramCuaLine: number[] = [];
    for (let s = 1; s <= soTram; s++) {
      idTram += 1;
      tramCuaLine.push(idTram);
      cay.tram.push({
        id: idTram,
        lineId: idChuyen,
        ma: `${ma}-ST${String(s).padStart(2, "0")}`,
        thuTu: s,
      });
    }
    // Rải máy đều lên các trạm của line (tất định: chia dư theo chỉ số).
    for (let m = 0; m < soMay; m++) {
      idMay += 1;
      cay.may.push({
        id: idMay,
        stationId: tramCuaLine[m % tramCuaLine.length],
        ma: `MC-${String(idMay).padStart(3, "0")}`,
        loaiMay: m % 3 === 0 ? "AOI" : m % 3 === 1 ? "AVI" : "SPI",
        isActive: true,
      });
    }
  }
  return cay;
}

describe("T9 — quy mô thật", () => {
  it("cây dựng đúng 2 nhà máy / 2 xưởng / 4 chuyền / 37 trạm / 43 máy", () => {
    const cay = cayQuyMoThat();
    expect(cay.nhaMay.length).toBe(2);
    expect(cay.xuong.length).toBe(2);
    expect(cay.chuyen.length).toBe(4);
    expect(cay.tram.length).toBe(37);
    expect(cay.may.length).toBe(43);
  });

  it("chạy dưới 100 ms", () => {
    const cay = cayQuyMoThat();
    // Chạy nóng một lần để loại chi phí JIT lần đầu ra khỏi phép đo.
    sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    const t0 = performance.now();
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    const msec = performance.now() - t0;
    expect(chiMay(kq).length).toBe(43);
    expect(msec).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// GC-1 — toaNha/tang trong chữ ký
// ---------------------------------------------------------------------------

describe("GC-1 — lựa chọn tầng của người dùng KHÔNG bị xoá", () => {
  it("xưởng đã gán tangId đi vào ĐÚNG tầng đó, không vào tầng mặc định", () => {
    const cay = cayRong();
    cay.nhaMay.push({ id: 1, ma: "FAC-1", isActive: true });
    cay.toaNha.push({ id: 101, factoryId: 1, ma: "TN-1" });
    // Toà có HAI tầng; tầng 1 (capSo=1) là mặc định, tầng 2 là lựa chọn người dùng.
    cay.tang.push(
      { id: 201, toaNhaId: 101, capSo: 1 },
      { id: 202, toaNhaId: 101, capSo: 2 },
    );
    cay.xuong.push(
      { id: 1, factoryId: 1, ma: "XU-01", tangId: 202 },
      { id: 2, factoryId: 1, ma: "XU-02", tangId: null },
    );
    cay.chuyen.push(
      { id: 1, workshopId: 1, ma: "L-01" },
      { id: 2, workshopId: 2, ma: "L-02" },
    );
    cay.tram.push(
      { id: 1, lineId: 1, ma: "ST-001", thuTu: 1 },
      { id: 2, lineId: 2, ma: "ST-002", thuTu: 1 },
    );
    cay.may.push(
      { id: 1, stationId: 1, ma: "MC-001", loaiMay: "AOI", isActive: true },
      { id: 2, stationId: 2, ma: "MC-002", loaiMay: "AOI", isActive: true },
    );

    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    const tangCua = new Map(
      kq.datCho
        .filter((d) => d.loaiThucThe === "workshop")
        .map((d) => [d.thucTheId, d.tangId]),
    );
    // XU-01 GIỮ tầng 202 người dùng chọn; XU-02 rơi về tầng 1 của toà (201).
    expect(tangCua.get(1)).toBe(202);
    expect(tangCua.get(2)).toBe(201);
  });

  it("hai tầng là hai mặt sàn RIÊNG — mỗi tầng có sàn và tường của mình", () => {
    const cay = dungCay({
      soNhaMay: 1,
      soXuongMoiNhaMay: 2,
      soChuyenMoiXuong: 1,
      soTramMoiChuyen: 2,
      soMayMoiTram: 1,
      tangChoXuong: (i) => (i === 1 ? 201 : null),
    });
    cay.tang.push({ id: 999, toaNhaId: 101, capSo: 2 });
    const kq = sinhBoCuc(cay, BANG_KICH_THUOC, new Set());
    const san = kq.vatThe.filter((v) => v.ten === "Sàn tầng");
    // Cả hai xưởng đều về tầng 201 (một có tangId, một fallback tầng 1) ⇒ 1 sàn.
    expect(san.length).toBe(1);
    expect(san[0].tangId).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Đơn vị — các hàm phụ trợ xuất khẩu
// ---------------------------------------------------------------------------

describe("xepKeXuong — shelf packing", () => {
  it("xuống hàng khi vượt rongSanToiDaMm", () => {
    const cauHinh: CauHinhSinh = { ...CAU_HINH_SINH_MAC_DINH, rongSanToiDaMm: 25_000 };
    const o = xepKeXuong(
      [
        { xuongId: 1, rongMm: 20_000, sauMm: 10_000 },
        { xuongId: 2, rongMm: 20_000, sauMm: 8_000 },
      ],
      cauHinh,
    );
    expect(o[0].gocYMm).toBe(0);
    expect(o[1].gocYMm).toBeGreaterThan(0);
  });

  it("ô cùng hàng cách nhau đúng loiDiMm", () => {
    const o = xepKeXuong(
      [
        { xuongId: 1, rongMm: 10_000, sauMm: 5_000 },
        { xuongId: 2, rongMm: 8_000, sauMm: 5_000 },
      ],
      CAU_HINH_SINH_MAC_DINH,
    );
    // Sắp GIẢM DẦN theo bề rộng ⇒ xuongId 1 (10k) đứng trước.
    expect(o[0].gocXMm).toBe(0);
    expect(o[1].gocXMm).toBe(10_000 + CAU_HINH_SINH_MAC_DINH.loiDiMm);
  });

  it("ô ĐẦU của hàng vẫn được đặt dù rộng hơn cả sàn (không mất im lặng)", () => {
    const cauHinh: CauHinhSinh = { ...CAU_HINH_SINH_MAC_DINH, rongSanToiDaMm: 1_000 };
    const o = xepKeXuong([{ xuongId: 7, rongMm: 50_000, sauMm: 5_000 }], cauHinh);
    expect(o.length).toBe(1);
    expect(o[0].xuongId).toBe(7);
  });

  it("đầu vào rỗng → mảng rỗng", () => {
    expect(xepKeXuong([], CAU_HINH_SINH_MAC_DINH)).toEqual([]);
  });

  it("tất định: đảo thứ tự đầu vào cho cùng kết quả", () => {
    const nguon = [
      { xuongId: 3, rongMm: 5_000, sauMm: 5_000 },
      { xuongId: 1, rongMm: 5_000, sauMm: 5_000 },
      { xuongId: 2, rongMm: 9_000, sauMm: 5_000 },
    ];
    expect(xepKeXuong(nguon, CAU_HINH_SINH_MAC_DINH)).toEqual(
      xepKeXuong([...nguon].reverse(), CAU_HINH_SINH_MAC_DINH),
    );
  });
});

describe("lechTrongTram — toả đều hai phía", () => {
  it("máy đầu ở TÂM trạm", () => {
    expect(lechTrongTram(0, 1400)).toBe(0);
  });

  it("toả ±b, ±2b — không xếp một chiều", () => {
    expect(lechTrongTram(1, 1400)).toBe(1400);
    expect(lechTrongTram(2, 1400)).toBe(-1400);
    expect(lechTrongTram(3, 1400)).toBe(2800);
    expect(lechTrongTram(4, 1400)).toBe(-2800);
  });

  it("máy thứ 4 cách tâm 2 bước, KHÔNG phải 3 (đối chứng xếp một chiều)", () => {
    expect(Math.abs(lechTrongTram(4, 1400))).toBeLessThan(3 * 1400);
  });
});
