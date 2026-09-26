/**
 * vungDungCanh.unit.test.ts — PH-46 (thẻ `Metrics` che trọn một cụm) và PH-47
 * (sa bàn chỉ chiếm ~35 % bề rộng canvas).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MỌI CON SỐ ĐẦU VÀO Ở ĐÂY LÀ SỐ **ĐO ĐƯỢC**, KHÔNG PHẢI SỐ BỊA
 * ════════════════════════════════════════════════════════════════════════════
 *   · lớp phủ: bbox thật của `[data-che-nhan]` trên `/twin?pv=tapdoan`,
 *     1280×720, khung MẶC ĐỊNH và khung `?thu=trai,phai,kpi`
 *     (`.qa-tapdoan/t21-truoc.json`);
 *   · toà nhà: 12 toà QATD, mỗi toà 110 000 × 80 000 × 42 000 mm — đọc thẳng
 *     từ CSDL (`.qa-tapdoan/_t21-dims.mjs`).
 * Nhờ vậy lưới này đo ĐÚNG tình huống mà chủ đợt sẽ tự xem bằng mắt, chứ không
 * đo một khung canvas tưởng tượng.
 *
 * ⚠ Lưới CHỐNG TỰ THOẢ: mỗi nhóm khẳng định KÍCH THƯỚC đầu vào trước khi đo
 *   (G5 — một `every()` trên tập rỗng là xanh giả).
 */
import { describe, expect, it } from "vitest";

import { saBanTapDoan, type ToaNhaKhuonVien } from "./canhTapDoan";
import {
  daiDocDung,
  daiNgangDung,
  dinhBBox,
  hopPxCuaDiem,
  khungNhinCho,
  khungNhinVaoVung,
  tiLeNoiDungTrenMan,
  vungDungCanvas,
  LE_VUNG_DUNG_PX,
  type HopCanvas,
  type KhungNhin,
} from "./phamViCanh";
import type { BBox, DiemScene } from "../heToaDo";

const KHUNG = { rongPx: 968, caoPx: 489 };

/** Lớp phủ THẬT — khung MẶC ĐỊNH, vai `qatd_giamdoc` (3 công ty). */
const PHU_MAC_DINH: HopCanvas[] = [
  { trai: 0, phai: 224, tren: 0, duoi: 489 }, // panel-trai (suốt chiều cao)
  { trai: 232, phai: 470, tren: 59, duoi: 279 }, // bang-kpi-noi — thẻ "Metrics"
  { trai: 400, phai: 704, tren: 59, duoi: 88 }, // cum-trang-thai-du-lieu
  { trai: 224, phai: 245, tren: 224, duoi: 266 }, // nut-thu-trai
  { trai: 691, phai: 712, tren: 224, duoi: 266 }, // nut-thu-phai
  { trai: 0, phai: 968, tren: 451, duoi: 489 }, // lop-phu-dong-thoi-gian (suốt bề ngang)
  { trai: 712, phai: 968, tren: 0, duoi: 489 }, // panel-phai (suốt chiều cao)
];

/** Lớp phủ THẬT — cùng cảnh, `?thu=trai,phai,kpi` (ba panel thu hết). */
const PHU_THU_PANEL: HopCanvas[] = [
  { trai: 8, phai: 216, tren: 59, duoi: 87 },
  { trai: 656, phai: 960, tren: 59, duoi: 88 },
  { trai: 0, phai: 21, tren: 224, duoi: 266 },
  { trai: 947, phai: 968, tren: 224, duoi: 266 },
  { trai: 0, phai: 968, tren: 451, duoi: 489 },
];

/** 12 toà QATD như CSDL ghi (`soCongTy` × 4 toà 110×80×42 m). */
function toaNhaQatd(soCongTy: number): ToaNhaKhuonVien[] {
  const ra: ToaNhaKhuonVien[] = [];
  for (let c = 0; c < soCongTy; c += 1)
    for (let i = 0; i < 4; i += 1)
      ra.push({
        id: c * 4 + i + 78,
        factoryId: 44 + c,
        rongMm: 110_000,
        sauMm: 80_000,
        caoMm: 42_000,
        viTriXMm: (i % 2) * 130_000 + c * 1_000_000,
        viTriYMm: Math.floor(i / 2) * 100_000,
        viTriZMm: 0,
      });
  return ra;
}

/** Sa bàn + tập điểm VẼ (8 đỉnh mỗi biểu tượng) + bbox, cho `soCongTy` công ty. */
function canh(soCongTy: number) {
  const sb = saBanTapDoan(toaNhaQatd(soCongTy));
  if (sb === null) throw new Error("sa bàn rỗng — tiền đề của lưới này hỏng");
  const hopToa = sb.bieuTuong.map((b) => {
    const d: DiemScene[] = [];
    for (const x of [b.xMm / 1000, (b.xMm + b.rongMm) / 1000])
      for (const y of [0, b.caoMm / 1000])
        for (const z of [b.yMm / 1000, (b.yMm + b.sauMm) / 1000]) d.push({ x, y, z });
    return d;
  });
  const diem = hopToa.flat();
  const bbox: BBox = {
    minX: Math.min(...diem.map((d) => d.x)),
    maxX: Math.max(...diem.map((d) => d.x)),
    minY: Math.min(...diem.map((d) => d.y)),
    maxY: Math.max(...diem.map((d) => d.y)),
    minZ: Math.min(...diem.map((d) => d.z)),
    maxZ: Math.max(...diem.map((d) => d.z)),
  };
  return { sb, diem, hopToa, bbox };
}

/** Hợp thành ĐÚNG như chỗ dùng thật (`CanhVanHanh.useKhungNhinVungDung`): chọn vùng rồi đặt vào. */
function datVaoVungDung(
  diem: readonly DiemScene[],
  goc: KhungNhin,
  phu: readonly HopCanvas[],
): KhungNhin {
  const vung = vungDungCanvas(KHUNG.rongPx, KHUNG.caoPx, phu);
  return vung === null ? goc : khungNhinVaoVung(diem, goc, KHUNG, vung);
}

/** Khung nhìn CŨ (trước bản vá): `khungNhinCho` căn vào tâm canvas thô. */
const khungCu = (bbox: BBox): KhungNhin => khungNhinCho(bbox, "tapDoan")!;

/** Số CỘT pixel mà sa bàn còn NHÌN THẤY được — cùng thước `.qa-tapdoan/t21-do.mjs`. */
function cotThayDuoc(hopToa: DiemScene[][], k: KhungNhin, phu: readonly HopCanvas[]) {
  const hops = hopToa.map((d) => hopPxCuaDiem(d, k, KHUNG)!);
  const biChe = (x: number, y: number) =>
    phu.some((z) => x >= z.trai && x < z.phai && y >= z.tren && y < z.duoi);
  let thay = 0;
  let tong = 0;
  for (let x = 0; x < KHUNG.rongPx; x += 1) {
    const o = hops.filter((h) => x >= h.trai && x < h.phai);
    if (o.length === 0) continue;
    tong += 1;
    let co = false;
    for (const h of o) {
      for (let y = Math.max(0, h.tren); y < Math.min(KHUNG.caoPx, h.duoi); y += 2)
        if (!biChe(x, y)) {
          co = true;
          break;
        }
      if (co) break;
    }
    if (co) thay += 1;
  }
  const trai = Math.min(...hops.map((h) => h.trai));
  const phai = Math.max(...hops.map((h) => h.phai));
  return { thay, tong, rong: phai - trai, trai, phai };
}

/* ══════════════════════════════════════════════════════════════════════════ */
describe("① VÙNG CANVAS CÒN DÙNG ĐƯỢC — đọc từ lớp phủ, không từ hằng số", () => {
  it("★ tiền đề G5: bảy lớp phủ THẬT ở khung mặc định, năm ở khung thu panel", () => {
    expect(PHU_MAC_DINH).toHaveLength(7);
    expect(PHU_THU_PANEL).toHaveLength(5);
  });

  it("★ dải NGANG = khoảng giữa hai panel (488 px), không phải cả canvas", () => {
    expect(daiNgangDung(KHUNG.rongPx, KHUNG.caoPx, PHU_MAC_DINH)).toEqual({ tu: 224, den: 712 });
  });

  it("★ dải DỌC = phần trên thanh thời gian (451 px), vì thanh ấy chạy SUỐT bề ngang", () => {
    expect(daiDocDung(KHUNG.rongPx, KHUNG.caoPx, PHU_MAC_DINH)).toEqual({ tu: 0, den: 451 });
  });

  it("★★★ thẻ `Metrics` KHÔNG bị trừ khỏi dải ngang — nó lấy mất một MẢNG, không lấy mất bề rộng", () => {
    // Nếu trừ nó đi thì dải ngang tụt còn 242 px và sa bàn 3 cụm chỉ còn nửa bề rộng.
    const chiThe = daiNgangDung(KHUNG.rongPx, KHUNG.caoPx, [PHU_MAC_DINH[1]]);
    expect(chiThe).toEqual({ tu: 0, den: 968 });
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG BIẾT KÊU: lớp phủ CAO SUỐT canvas THÌ bị trừ", () => {
    const suot: HopCanvas = { trai: 232, phai: 470, tren: 0, duoi: 489 };
    expect(daiNgangDung(KHUNG.rongPx, KHUNG.caoPx, [suot])).toEqual({ tu: 470, den: 968 });
  });

  it("★ thu ba panel ⇒ dải ngang mở ra CẢ canvas (968) — bằng chứng không có khoảng bù cố định", () => {
    expect(daiNgangDung(KHUNG.rongPx, KHUNG.caoPx, PHU_THU_PANEL)).toEqual({ tu: 0, den: 968 });
    expect(vungDungCanvas(KHUNG.rongPx, KHUNG.caoPx, PHU_THU_PANEL)).toEqual({
      trai: 0,
      phai: 968,
      tren: 0,
      duoi: 451,
    });
  });

  it("★ G8 — khung không thực ⇒ `null`, KHÔNG phải một vùng mặc định trông hợp lệ", () => {
    expect(daiNgangDung(0, 489, PHU_MAC_DINH)).toBeNull();
    expect(daiDocDung(968, 0, PHU_MAC_DINH)).toBeNull();
    expect(vungDungCanvas(0, 0, PHU_MAC_DINH)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("② TỈ LỆ TRÊN MÀN — tập điểm VẼ, không phải 8 đỉnh bbox", () => {
  const { diem, bbox, sb } = canh(3);

  it("★ tiền đề G5: 12 biểu tượng ⇒ 96 điểm vẽ", () => {
    expect(sb.bieuTuong).toHaveLength(12);
    expect(diem).toHaveLength(96);
  });

  it("★★★ bbox và tập điểm cho HAI tỉ lệ khác hẳn nhau — ô trống của lưới 2×2 là lý do", () => {
    const goc = khungCu(bbox);
    const theoDiem = tiLeNoiDungTrenMan(diem, goc, KHUNG)!;
    const theoBBox = tiLeNoiDungTrenMan(dinhBBox(bbox), goc, KHUNG)!;
    expect(theoDiem).toBeGreaterThan(2.8);
    expect(theoBBox).toBeLessThan(2.0);
    // Chênh lệch ấy chính là thứ làm bản đầu của khối này thu NHỎ sa bàn lại.
    expect(theoDiem / theoBBox).toBeGreaterThan(1.4);
  });

  it("★ tỉ lệ KHÔNG đổi khi camera tiến/lùi dọc hướng nhìn (tiền đề của bước chọn cỡ)", () => {
    const goc = khungCu(bbox);
    const xa: KhungNhin = {
      viTri: [
        goc.muc[0] + (goc.viTri[0] - goc.muc[0]) * 2,
        goc.muc[1] + (goc.viTri[1] - goc.muc[1]) * 2,
        goc.muc[2] + (goc.viTri[2] - goc.muc[2]) * 2,
      ],
      muc: goc.muc,
      banKinh: goc.banKinh,
    };
    const a = tiLeNoiDungTrenMan(diem, goc, KHUNG)!;
    const b = tiLeNoiDungTrenMan(diem, xa, KHUNG)!;
    expect(Math.abs(a - b) / a).toBeLessThan(0.12);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("③ PH-46 — sa bàn RA KHỎI vùng bị thẻ DOM phủ", () => {
  const { diem, hopToa, bbox } = canh(3);
  const goc = khungCu(bbox);
  const sau = datVaoVungDung(diem, goc, PHU_MAC_DINH);

  it("★★★ ĐỐI CHỨNG DƯƠNG: khung nhìn CŨ để 1/3 cụm nằm dưới thẻ `Metrics`", () => {
    // Phép đo phải biết KÊU trên ca dương đã biết, nếu không nó không đo gì cả.
    const truoc = cotThayDuoc(hopToa, goc, PHU_MAC_DINH);
    expect(truoc.tong).toBeGreaterThan(0);
    expect(truoc.thay / truoc.tong).toBeLessThan(0.7);
  });

  it("★★★ sau bản vá: MỌI cột của sa bàn nhìn thấy được", () => {
    const s = cotThayDuoc(hopToa, sau, PHU_MAC_DINH);
    expect(s.tong).toBeGreaterThan(0);
    expect(s.thay).toBe(s.tong);
  });

  it("★★★ mép ĐÁY chừa đúng `LE_VUNG_DUNG_PX` cho nhãn cụm (nhãn treo DƯỚI cụm)", () => {
    const h = hopPxCuaDiem(diem, sau, KHUNG)!;
    const vung = vungDungCanvas(KHUNG.rongPx, KHUNG.caoPx, PHU_MAC_DINH)!;
    expect(h.duoi).toBeLessThanOrEqual(vung.duoi - LE_VUNG_DUNG_PX + 0.5);
    expect(h.duoi).toBeGreaterThan(vung.duoi - LE_VUNG_DUNG_PX - 12);
  });

  it("★ sa bàn nằm TRỌN trong dải ngang dùng được (không chui xuống dưới panel)", () => {
    const h = hopPxCuaDiem(diem, sau, KHUNG)!;
    const vung = vungDungCanvas(KHUNG.rongPx, KHUNG.caoPx, PHU_MAC_DINH)!;
    expect(h.trai).toBeGreaterThanOrEqual(vung.trai - 0.5);
    expect(h.phai).toBeLessThanOrEqual(vung.phai + 0.5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("④ PH-47 — sa bàn dùng hết bề rộng CÒN DÙNG ĐƯỢC", () => {
  it("★★★ ba công ty, khung mặc định: ≥ 85 % dải ngang (bản cũ: < 40 %)", () => {
    const { diem, hopToa, bbox } = canh(3);
    const goc = khungCu(bbox);
    const dai = 712 - 224;
    const truoc = cotThayDuoc(hopToa, goc, PHU_MAC_DINH);
    const sau = cotThayDuoc(hopToa, datVaoVungDung(diem, goc, PHU_MAC_DINH), PHU_MAC_DINH);
    expect(truoc.thay / dai).toBeLessThan(0.4);
    expect(sau.thay / dai).toBeGreaterThanOrEqual(0.85);
  });

  it("★★★ MỘT công ty KHÔNG bị bản vá làm LÙI — bề rộng sau ≥ bề rộng trước", () => {
    // Ca này đã bác bỏ phương án "ôm vào ô trống lớn nhất, tránh hẳn thẻ Metrics":
    // ô ấy cho 233 px trong khi bản chưa vá đã 307 px.
    const { diem, hopToa, bbox } = canh(1);
    const goc = khungCu(bbox);
    const truoc = cotThayDuoc(hopToa, goc, PHU_MAC_DINH);
    const sau = cotThayDuoc(hopToa, datVaoVungDung(diem, goc, PHU_MAC_DINH), PHU_MAC_DINH);
    expect(truoc.tong).toBeGreaterThan(0);
    expect(sau.rong).toBeGreaterThanOrEqual(truoc.rong);
    expect(sau.thay).toBeGreaterThanOrEqual(truoc.thay);
  });

  it("★★★ THU PANEL ⇒ sa bàn nở theo (bằng chứng KHÔNG phải khoảng bù cố định)", () => {
    const { diem, bbox } = canh(3);
    const goc = khungCu(bbox);
    const mo = hopPxCuaDiem(diem, datVaoVungDung(diem, goc, PHU_MAC_DINH), KHUNG)!;
    const thu = hopPxCuaDiem(diem, datVaoVungDung(diem, goc, PHU_THU_PANEL), KHUNG)!;
    expect(mo.phai - mo.trai).toBeGreaterThan(400);
    expect(thu.phai - thu.trai).toBeGreaterThan((mo.phai - mo.trai) * 1.8);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("⑤ BẤT BIẾN CỦA PHÉP DỜI — đổi chỗ và cỡ, KHÔNG đổi hướng nhìn", () => {
  const { diem, bbox } = canh(3);
  const goc = khungCu(bbox);
  const sau = datVaoVungDung(diem, goc, PHU_MAC_DINH);
  const huong = (k: KhungNhin) => {
    const v: [number, number, number] = [
      k.viTri[0] - k.muc[0],
      k.viTri[1] - k.muc[1],
      k.viTri[2] - k.muc[2],
    ];
    const l = Math.hypot(...v);
    return v.map((c) => c / l);
  };

  it("★ hướng nhìn GIỮ NGUYÊN từng thành phần (không phải chỉ giữ độ dài)", () => {
    const a = huong(goc);
    const b = huong(sau);
    a.forEach((c, i) => expect(b[i]).toBeCloseTo(c, 9));
  });

  it("★ `banKinh` giữ nguyên — người gọi dùng nó đặt `far`/giới hạn zoom", () => {
    expect(sau.banKinh).toBe(goc.banKinh);
  });

  it("★ camera THẬT SỰ đổi chỗ (nếu không thì mọi khẳng định trên là xanh giả)", () => {
    expect(Math.hypot(sau.muc[0] - goc.muc[0], sau.muc[1] - goc.muc[1], sau.muc[2] - goc.muc[2])).toBeGreaterThan(1);
  });

  it("★ TẤT ĐỊNH — cùng đầu vào cho cùng đầu ra", () => {
    const l2 = datVaoVungDung(diem, goc, PHU_MAC_DINH);
    expect(l2).toEqual(sau);
  });

  it("★ G8 — không còn chỗ sau khi trừ lề ⇒ trả NGUYÊN `goc`, không bịa tư thế", () => {
    const kin: HopCanvas[] = [{ trai: 0, phai: 968, tren: 0, duoi: 489 }];
    expect(datVaoVungDung(diem, goc, kin)).toBe(goc);
    const hep: HopCanvas = { trai: 100, phai: 130, tren: 100, duoi: 130 };
    expect(khungNhinVaoVung(diem, goc, KHUNG, hep)).toBe(goc);
  });

  it("★ tập điểm RỖNG ⇒ trả nguyên `goc` (không chia cho 0)", () => {
    expect(khungNhinVaoVung([], goc, KHUNG, { trai: 0, phai: 968, tren: 0, duoi: 451 })).toBe(goc);
  });
});
