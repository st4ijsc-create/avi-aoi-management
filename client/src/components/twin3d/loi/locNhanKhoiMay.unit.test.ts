/**
 * locNhanKhoiMay.unit.test.ts — ĐỢT 49 (mục A + C): nhãn KHÔNG được nằm đè hình chiếu
 * KHỐI của máy KHÁC, và dời NGANG khi mọi tầng dọc đã hết đường.
 *
 * ⚠ TÊN TỆP `*.unit.test.ts` — `vitest.config.ts` chỉ include khuôn này; đặt tên khác thì
 *   0 test được thu thập mà cổng VẪN XANH.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KẾT CỤC MÀ SÀNG NÀY CANH (QA lần 7, `.qa-dot48/k7/`)
 * ════════════════════════════════════════════════════════════════════════════
 * Bấm ĐÚNG TÂM KHỐI máy 246 ở `/twin`@1600 ⇒ mở `/twin/may/1`; bấm tâm khối máy 23 ở
 * Line@1280 ⇒ mở `/twin/may/21`. Census: 13 lượt máy / 212 tâm có tâm khối nằm trong hộp
 * nhãn của máy KHÁC (5/8 khung). Gốc: `LopNhan.khiBam` lấy hộp nhãn chứa điểm bấm rồi
 * `stopPropagation` — đúng thiết kế Đợt 47; cái sai là nhãn được phép đè thân máy khác.
 *
 * Sàng này phải KÊU khi: (a) ai đó bỏ `hopKhoiMay` khỏi `locNhan`; (b) ai đó biến vùng
 * tránh MỀM thành cửa gác CỨNG (nhãn biến mất thay vì dời); (c) ai đó đổi thứ tự thử
 * (ngang trước dọc) làm nhãn trôi khỏi máy của nó; (d) `xepTang` tắt mà kết quả đổi.
 */

import { describe, it, expect } from "vitest";
import {
  BUOC_NGANG_TOI_DA,
  buocNgangPx,
  KHE_TANG_PX,
  demNhanDeKhoiMayKhac,
  haiHopChongNhau,
  hopNhan,
  locNhan,
  type CauHinhLocNhan,
  type HinhChuNhat,
  type NhanUngVien,
} from "./locNhan";

const RONG = 120;
const CAO = 20;

/** Nhãn tại (x, y) với kích thước ĐO ĐƯỢC (không để hàm suy đoán — fixture phải tất định). */
function nhan(khoa: string, x: number, y: number, tuy: Partial<NhanUngVien> = {}): NhanUngVien {
  return { khoa, x, y, khoangCachMet: 10, rongPx: RONG, caoPx: CAO, ...tuy };
}

/** Hộp khối máy (hình chiếu) quanh tâm (x, y). */
function khoi(khoa: string, x: number, y: number, rong = 60, cao = 90): { khoa: string; hop: HinhChuNhat } {
  return { khoa, hop: { trai: x - rong / 2, phai: x + rong / 2, tren: y - cao / 2, duoi: y + cao / 2 } };
}

const NEN: CauHinhLocNhan = {
  khungCanvas: { rong: 1200, cao: 700 },
  xepTang: true,
  xepTangXuong: true,
};

describe("A — nhãn né hình chiếu khối máy KHÁC", () => {
  it("★★★ nhãn máy A đè khối máy B ⇒ ĐƯỢC DỜI, và sau khi dời KHÔNG còn giao khối B", () => {
    // A neo ở (400,300) ⇒ hộp tầng 0 = [340,460] × [280,300]. Khối B phủ đúng dải ấy.
    const uv = [nhan("machine:A", 400, 300)];
    const khoiMay = [khoi("machine:A", 400, 420), khoi("machine:B", 400, 292, 60, 40)];

    const truoc = locNhan(uv, NEN); // GỠ VÁ: không truyền hopKhoiMay
    expect(demNhanDeKhoiMayKhac(truoc.ve, khoiMay)).toBe(1);

    const sau = locNhan(uv, { ...NEN, hopKhoiMay: khoiMay, doiNgang: true });
    expect(sau.ve).toHaveLength(1); // KHÔNG giấu tên máy để chữa lỗi hit-test
    expect(demNhanDeKhoiMayKhac(sau.ve, khoiMay)).toBe(0);
    expect(sau.soDeKhoiMayKhac).toBe(0);
    expect(sau.ve[0].deKhoiMayKhac).toBe(false);
  });

  it("★★★ khối của CHÍNH máy KHÔNG phải vùng tránh — nhãn vẫn ở tầng 0 trên nóc máy mình", () => {
    const uv = [nhan("machine:A", 400, 300)];
    // Khối của chính A phủ trùm chỗ nhãn A.
    const khoiMay = [khoi("machine:A", 400, 300, 200, 200)];
    const kq = locNhan(uv, { ...NEN, hopKhoiMay: khoiMay, doiNgang: true });
    expect(kq.ve).toHaveLength(1);
    expect(kq.ve[0].tang).toBe(0);
    expect(kq.ve[0].lechNgangPx).toBe(0);
    expect(kq.ve[0].x).toBe(400);
  });

  it("★★★ HẾT CHỖ ⇒ GIỮ nhãn (không giấu) và ĐẾM — `soDeKhoiMayKhac` = `demNhanDeKhoiMayKhac`", () => {
    const uv = [nhan("machine:A", 400, 300)];
    // Khối B phủ toàn bộ vùng mà mọi tầng/cột của nhãn A có thể tới.
    const khoiMay = [khoi("machine:B", 400, 300, 1000, 600)];
    const kq = locNhan(uv, { ...NEN, hopKhoiMay: khoiMay, doiNgang: true });
    expect(kq.ve).toHaveLength(1);
    expect(kq.soDeKhoiMayKhac).toBe(1);
    expect(kq.ve[0].deKhoiMayKhac).toBe(true);
    expect(demNhanDeKhoiMayKhac(kq.ve, khoiMay)).toBe(1);
    // Không rơi vào ô "bị giấu": nhãn VẪN hiện.
    expect(kq.soBiGiau).toBe(0);
  });

  it("ưu tiên DỌC trước NGANG: khi tầng dọc đã thoát khối, nhãn KHÔNG dời ngang", () => {
    const uv = [nhan("machine:A", 400, 300)];
    // Khối B chỉ phủ dải y quanh tầng 0 (nhãn tầng 0: tren=280, duoi=300).
    const khoiMay = [khoi("machine:B", 400, 292, 400, 30)];
    const kq = locNhan(uv, { ...NEN, hopKhoiMay: khoiMay, doiNgang: true });
    expect(kq.ve[0].lechNgangPx).toBe(0);
    expect(kq.ve[0].tang).not.toBe(0);
    expect(kq.ve[0].x).toBe(400);
  });

  it("10 nhãn + 10 khối rời nhau ⇒ 0 nhãn đè khối máy khác VÀ 0 nhãn bị giấu", () => {
    const uv: NhanUngVien[] = [];
    const khoiMay: { khoa: string; hop: HinhChuNhat }[] = [];
    for (let i = 0; i < 10; i += 1) {
      const x = 80 + i * 125;
      uv.push(nhan(`machine:${i}`, x, 300));
      khoiMay.push(khoi(`machine:${i}`, x, 360, 50, 100));
    }
    // Canvas rộng hơn: 10 nhãn × 120 px = 1200 px, đúng bằng bề rộng NEN ⇒ nhãn cuối thò mép.
    const kq = locNhan(uv, { ...NEN, khungCanvas: { rong: 1600, cao: 700 }, hopKhoiMay: khoiMay, doiNgang: true });
    expect(kq.ve).toHaveLength(10);
    expect(demNhanDeKhoiMayKhac(kq.ve, khoiMay)).toBe(0);
    expect(kq.soBiGiau).toBe(0);
  });
});

describe("C — dời NGANG khi mọi tầng dọc hết đường", () => {
  it("★★★ vùng cấm chặn CẢ CỘT dọc, bên cạnh còn trống ⇒ nhãn DỜI NGANG thay vì bị giấu", () => {
    // Một dải cấm đứng (như panel) phủ đúng cột x của nhãn, mọi y.
    const uv = [nhan("machine:A", 400, 300)];
    const vungCam: HinhChuNhat[] = [{ trai: 330, phai: 415, tren: 0, duoi: 700 }];
    const khongNgang = locNhan(uv, { ...NEN, vungCam });
    expect(khongNgang.ve).toHaveLength(0);
    expect(khongNgang.soBiChe).toBe(1);

    const coNgang = locNhan(uv, { ...NEN, vungCam, doiNgang: true });
    expect(coNgang.ve).toHaveLength(1);
    expect(coNgang.ve[0].lechNgangPx).toBe(buocNgangPx(RONG) * 2);
    expect(coNgang.ve[0].x).toBe(400 + buocNgangPx(RONG) * 2);
    // Hộp đã dời phải THẬT SỰ ra khỏi vùng cấm.
    expect(vungCam.some((v) => haiHopChongNhau(v, coNgang.ve[0].hop))).toBe(false);
  });

  it("ngân sách ngang có TRẦN: cấm rộng hơn `BUOC_NGANG_TOI_DA` bước ⇒ vẫn bị giấu (không trôi vô hạn)", () => {
    const uv = [nhan("machine:A", 400, 300)];
    const rongCam = RONG / 2 + buocNgangPx(RONG) * BUOC_NGANG_TOI_DA + 40;
    const vungCam: HinhChuNhat[] = [{ trai: 400 - rongCam, phai: 400 + rongCam, tren: 0, duoi: 700 }];
    const kq = locNhan(uv, { ...NEN, vungCam, doiNgang: true });
    expect(kq.ve).toHaveLength(0);
    expect(kq.soBiChe).toBe(1);
  });

  it("dời ngang KHÔNG được chui ra ngoài canvas", () => {
    const uv = [nhan("machine:A", RONG / 2, 300)]; // sát mép trái
    const vungCam: HinhChuNhat[] = [{ trai: 0, phai: RONG / 2 + 10, tren: 0, duoi: 700 }];
    const kq = locNhan(uv, { ...NEN, vungCam, doiNgang: true });
    for (const v of kq.ve) expect(v.hop.trai).toBeGreaterThanOrEqual(0);
  });
});

describe("Tương thích ngược — bản GỠ VÁ phải y hệt Đợt 38", () => {
  const uv: NhanUngVien[] = [];
  for (let i = 0; i < 8; i += 1) uv.push(nhan(`machine:${i}`, 200 + i * 40, 300 + (i % 3) * 5));

  it("★★★ không truyền `hopKhoiMay`/`doiNgang` ⇒ kết quả TRÙNG với cấu hình Đợt 38", () => {
    const a = locNhan(uv, NEN);
    const b = locNhan(uv, { ...NEN, hopKhoiMay: [], doiNgang: false });
    expect(b.ve.map((v) => [v.khoa, v.x, v.y, v.tang])).toEqual(a.ve.map((v) => [v.khoa, v.x, v.y, v.tang]));
    expect(a.ve.every((v) => v.lechNgangPx === 0)).toBe(true);
    expect(a.soDeKhoiMayKhac).toBe(0);
  });

  it("★★★ `xepTang` TẮT ⇒ `doiNgang` vô hiệu (ngang là bước SAU của xếp tầng, không phải bậc riêng)", () => {
    const cauHinh: CauHinhLocNhan = { khungCanvas: NEN.khungCanvas };
    const a = locNhan(uv, cauHinh);
    const b = locNhan(uv, { ...cauHinh, doiNgang: true });
    expect(b.ve.map((v) => [v.khoa, v.x, v.y, v.tang])).toEqual(a.ve.map((v) => [v.khoa, v.x, v.y, v.tang]));
  });

  it("hậu điều kiện cũ giữ nguyên: 0 cặp nhãn ĐƯỢC VẼ chồng nhau, kể cả khi có dời ngang", () => {
    const khoiMay = uv.map((n, i) => khoi(n.khoa, n.x, 420 + i));
    const kq = locNhan(uv, { ...NEN, hopKhoiMay: khoiMay, doiNgang: true });
    for (let i = 0; i < kq.ve.length; i += 1) {
      for (let j = i + 1; j < kq.ve.length; j += 1) {
        expect(haiHopChongNhau(kq.ve[i].hop, kq.ve[j].hop)).toBe(false);
      }
    }
  });

  it("`hop` trả về khớp `hopNhan` đã dời (ngang + tầng) — e2e đối chiếu bằng bbox thật", () => {
    const uv1 = [nhan("machine:A", 400, 300)];
    const vungCam: HinhChuNhat[] = [{ trai: 330, phai: 415, tren: 0, duoi: 700 }];
    const kq = locNhan(uv1, { ...NEN, vungCam, doiNgang: true });
    const v = kq.ve[0];
    const mong = hopNhan({ x: v.x, y: 300, rongPx: RONG, caoPx: CAO });
    expect(v.hop.trai).toBeCloseTo(mong.trai, 6);
    expect(v.hop.phai).toBeCloseTo(mong.phai, 6);
    expect(v.hop.duoi).toBeCloseTo(mong.duoi - v.tang * (CAO + KHE_TANG_PX), 6);
  });
});

describe("Đợt 49 — `soDeKhoiMayKhac` là ĐẾM NHÃN ĐƯỢC VẼ, không phải đếm lượt dùng phương án chót", () => {
  it("★★★ nhãn phải dùng phương án chót NHƯNG bị cửa `tranNhan` chặn ⇒ KHÔNG được tính", () => {
    // 3 nhãn rời nhau; trần 2 ⇒ nhãn thứ ba bị `soVuotTran`. Khối máy khác phủ chỗ của cả ba.
    const uv = [
      nhan("machine:A", 200, 300, { khoangCachMet: 1 }),
      nhan("machine:B", 500, 300, { khoangCachMet: 2 }),
      nhan("machine:C", 800, 300, { khoangCachMet: 3 }),
    ];
    const khoiMay = [khoi("machine:Z", 600, 300, 1200, 600)];
    const kq = locNhan(uv, { ...NEN, tranNhan: 2, hopKhoiMay: khoiMay, doiNgang: true });
    expect(kq.ve).toHaveLength(2);
    expect(kq.soVuotTran).toBe(1);
    // Hai đại lượng ĐO CÙNG MỘT THỨ — chúng phải bằng nhau, luôn.
    expect(kq.soDeKhoiMayKhac).toBe(demNhanDeKhoiMayKhac(kq.ve, khoiMay));
    expect(kq.soDeKhoiMayKhac).toBe(2);
  });
});
