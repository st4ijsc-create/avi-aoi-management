/**
 * nguongDonViVe.unit.test.ts — CÔNG TẮC ĐỔI ĐƠN VỊ VẼ Ở CẤP NHÀ MÁY.
 *
 * Tệp đo là hàm THUẦN nên lưới này chạy bằng giá trị thật, không dựng cảnh, không jsdom — đúng
 * lý do chọn công thức đóng thay vì đo hình chiếu mỗi khung.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BA CHỖ LƯỚI NÀY CỐ Ý KHÔNG ĐI ĐƯỜNG DỄ
 * ════════════════════════════════════════════════════════════════════════════
 * 1. **Có ca NGHỊCH.** Chỉ kiểm "ra xa ⇒ gộp cụm" là kiểm nửa hợp đồng: một bản cài kẹt-luôn-gộp
 *    vẫn xanh. Mỗi luật ở đây có cặp thuận/nghịch.
 * 2. **Trễ đóng/mở ghim BẤT ĐẲNG THỨC ĐO ĐƯỢC, không ghim con số.** `HE_SO_TRE = 1,5` là một
 *    lựa chọn; thứ KHÔNG được phép sai là "dải trễ phải rộng hơn một nấc cuộn" — đo được
 *    **1,0688 lần mỗi nấc**. Ghim 1,5 thì lưới đỏ khi ai đó chỉnh hằng vì một lý do chính đáng;
 *    ghim bất đẳng thức thì nó chỉ đỏ khi bản vá thật sự mở đường cho nhấp nháy.
 * 3. **Đối chiếu với SỐ ĐO THỰC ĐỊA.** Một công thức tự nhất quán vẫn có thể sai hệ số. Ca cuối
 *    dựng lại đúng tư thế camera đã đo trên `/twin` và đòi công thức cho ra cùng bậc độ lớn với
 *    cạnh trung vị **3,23 × 4,74 px** mà trình duyệt thật trả về.
 */
import { describe, it, expect } from "vitest";

import {
  HE_SO_TRE,
  NGUONG_CANH_NHO_PX,
  TI_LE_MOI_NAC_DO_DUOC,
  canhNhoTrenManPx,
  coTrenManPx,
  donViVeKeTiep,
  khoangCachToiMay,
  trungViCanhNhoPx,
  type MayDeChamCo,
} from "./nguongDonViVe";

const FOV = 45;
const CAO_CANVAS = 720;
const may = (caoMm: number, rongMm: number, z: number): MayDeChamCo => ({
  kichThuocMm: { caoMm, rongMm },
  viTri: { x: 0, y: 0, z },
});

describe("công thức chiếu cỡ", () => {
  it("★★★ cỡ trên màn TỈ LỆ NGHỊCH với khoảng cách — gấp đôi d thì còn một nửa", () => {
    const a = coTrenManPx(2, 100, FOV, CAO_CANVAS);
    const b = coTrenManPx(2, 200, FOV, CAO_CANVAS);
    expect(a).toBeGreaterThan(0);
    expect(b / a).toBeCloseTo(0.5, 6);
  });

  it("★ tỉ lệ THUẬN với cỡ thật và với chiều cao canvas (hai biến còn lại của công thức)", () => {
    expect(coTrenManPx(4, 100, FOV, CAO_CANVAS) / coTrenManPx(2, 100, FOV, CAO_CANVAS)).toBeCloseTo(2, 6);
    expect(coTrenManPx(2, 100, FOV, 1440) / coTrenManPx(2, 100, FOV, 720)).toBeCloseTo(2, 6);
  });

  it("★ fov rộng hơn ⇒ cùng vật NHỎ đi trên màn (ca nghịch của 'zoom vào thì to ra')", () => {
    expect(coTrenManPx(2, 100, 60, CAO_CANVAS)).toBeLessThan(coTrenManPx(2, 100, 30, CAO_CANVAS));
  });

  it("★★★ đối số hỏng ⇒ 0, KHÔNG phải NaN — một NaN làm mọi phép so sánh trả false, tức công tắc kẹt IM LẶNG", () => {
    for (const v of [
      coTrenManPx(2, 0, FOV, CAO_CANVAS),
      coTrenManPx(2, -5, FOV, CAO_CANVAS),
      coTrenManPx(0, 100, FOV, CAO_CANVAS),
      coTrenManPx(2, 100, 0, CAO_CANVAS),
      coTrenManPx(2, 100, 180, CAO_CANVAS),
      coTrenManPx(2, 100, FOV, 0),
      coTrenManPx(Number.NaN, 100, FOV, CAO_CANVAS),
      coTrenManPx(2, Number.POSITIVE_INFINITY, FOV, CAO_CANVAS),
      /*
       * ★★★ `NaN` ở vị trí KHOẢNG CÁCH — ca này thêm vào sau khi đột biến lật tẩy một lỗ trong
       *   chính lưới này: tôi thử `NaN` làm CỠ nhưng chưa bao giờ thử `NaN` làm KHOẢNG CÁCH, nên
       *   gỡ hẳn phép canh khoảng cách mà lưới vẫn 17/17 xanh. Một phép canh không đột biến nào
       *   bắt được là một phép canh chưa ai chứng minh là còn sống.
       */
      coTrenManPx(2, Number.NaN, FOV, CAO_CANVAS),
      coTrenManPx(2, 100, Number.NaN, CAO_CANVAS),
      coTrenManPx(2, 100, FOV, Number.NaN),
    ]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(0);
    }
  });
});

describe("cạnh NHỎ, không phải diện tích", () => {
  it("★★★ lấy min(rộng, cao) — chấm theo diện tích sẽ cho lọt một đích 4×144 px", () => {
    // Máy dẹt: cao 3 m, rộng 0,1 m. Diện tích chiếu có thể lớn, cạnh nhỏ thì không.
    const dep = may(3000, 100, 50);
    const caoPx = coTrenManPx(3, khoangCachToiMay({ x: 0, y: 0, z: 0 }, dep.viTri), FOV, CAO_CANVAS);
    const rongPx = coTrenManPx(0.1, khoangCachToiMay({ x: 0, y: 0, z: 0 }, dep.viTri), FOV, CAO_CANVAS);
    const canhNho = canhNhoTrenManPx(dep, { x: 0, y: 0, z: 0 }, FOV, CAO_CANVAS);
    expect(canhNho).toBeCloseTo(Math.min(caoPx, rongPx), 9);
    expect(canhNho).toBeLessThan(caoPx);   // ← nếu ai đó đổi sang chấm theo chiều cao, ca này đỏ
  });

  it("khoảng cách tính theo CẢ BA trục — máy lệch trục xa hơn máy thẳng trục cùng z", () => {
    const thang = khoangCachToiMay({ x: 0, y: 40, z: 0 }, { x: 0, y: 0, z: 100 });
    const lech = khoangCachToiMay({ x: 0, y: 40, z: 0 }, { x: 80, y: 0, z: 100 });
    expect(lech).toBeGreaterThan(thang);
  });
});

describe("trung vị — bền với ngoại lai", () => {
  it("★★★ MỘT máy khổng lồ sát camera KHÔNG kéo được trung vị (trung bình thì có)", () => {
    const nho = Array.from({ length: 10 }, (_, i) => may(1800, 1000, 200 + i));
    const trungViNho = trungViCanhNhoPx(nho, { x: 0, y: 0, z: 0 }, FOV, CAO_CANVAS);
    const themKhongLo = [...nho, may(30_000, 30_000, 5)];
    const trungViSau = trungViCanhNhoPx(themKhongLo, { x: 0, y: 0, z: 0 }, FOV, CAO_CANVAS);
    const tb = (ds: MayDeChamCo[]) =>
      ds.reduce((s, m) => s + canhNhoTrenManPx(m, { x: 0, y: 0, z: 0 }, FOV, CAO_CANVAS), 0) / ds.length;
    // Trung vị gần như đứng yên…
    expect(Math.abs(trungViSau - trungViNho) / trungViNho).toBeLessThan(0.15);
    // …trong khi trung bình bị kéo đi rất xa — đó chính là lý do không dùng trung bình.
    expect(tb(themKhongLo) / tb(nho)).toBeGreaterThan(3);
  });

  it("tập RỖNG ⇒ 0 (không NaN, không ném)", () => {
    expect(trungViCanhNhoPx([], { x: 0, y: 0, z: 0 }, FOV, CAO_CANVAS)).toBe(0);
  });

  it("★ camera lùi ra xa ⇒ trung vị GIẢM; tiến lại gần ⇒ TĂNG (cặp thuận/nghịch)", () => {
    const ds = Array.from({ length: 9 }, (_, i) => may(1800, 1000, 100 + i * 5));
    const gan = trungViCanhNhoPx(ds, { x: 0, y: 0, z: 0 }, FOV, CAO_CANVAS);
    const xa = trungViCanhNhoPx(ds, { x: 0, y: 0, z: -400 }, FOV, CAO_CANVAS);
    expect(xa).toBeLessThan(gan);
    expect(gan).toBeGreaterThan(xa);
  });
});

describe("công tắc CÓ TRỄ", () => {
  it("★★★ đang vẽ MÁY: dưới ngưỡng ⇒ gộp cụm; trên ngưỡng ⇒ giữ máy (cặp thuận/nghịch)", () => {
    expect(donViVeKeTiep(NGUONG_CANH_NHO_PX - 0.01, "may")).toBe("cum");
    expect(donViVeKeTiep(NGUONG_CANH_NHO_PX + 0.01, "may")).toBe("may");
  });

  it("★★★ đang vẽ CỤM: chỉ quay về máy khi vượt HẲN dải trễ — trong dải thì GIỮ NGUYÊN", () => {
    const tran = NGUONG_CANH_NHO_PX * HE_SO_TRE;
    expect(donViVeKeTiep(NGUONG_CANH_NHO_PX + 0.01, "cum")).toBe("cum");   // đã qua ngưỡng, CHƯA qua trần
    expect(donViVeKeTiep(tran - 0.01, "cum")).toBe("cum");
    expect(donViVeKeTiep(tran + 0.01, "cum")).toBe("may");
  });

  it("★★★ ĐÚNG TẠI MỐC thì giữ nguyên — sai số dấu phẩy động không được lật công tắc", () => {
    expect(donViVeKeTiep(NGUONG_CANH_NHO_PX, "may")).toBe("may");
    expect(donViVeKeTiep(NGUONG_CANH_NHO_PX * HE_SO_TRE, "cum")).toBe("cum");
  });

  it("★★★ DẢI TRỄ PHẢI RỘNG HƠN MỘT NẤC CUỘN — ghim bất đẳng thức ĐO ĐƯỢC, không ghim hằng 1,5", () => {
    // Đo `/twin` FUYU-F @1280×720, một máy cố định: cỡPx 3,312 → 4,044 sau 3 nấc ⇒ 1,0688/nấc.
    expect(TI_LE_MOI_NAC_DO_DUOC).toBeGreaterThan(1);
    expect(HE_SO_TRE).toBeGreaterThan(TI_LE_MOI_NAC_DO_DUOC);
    // …và rộng hơn hẳn: một nấc lẻ không được lật công tắc, cần vài nấc liên tiếp.
    expect(HE_SO_TRE).toBeGreaterThan(TI_LE_MOI_NAC_DO_DUOC ** 3);
  });

  it("★★★ KHÔNG NHẤP NHÁY: cuộn một nấc qua lại quanh mốc không được đổi đơn vị vẽ", () => {
    let dv = donViVeKeTiep(NGUONG_CANH_NHO_PX - 0.5, "may");
    expect(dv).toBe("cum");
    // một nấc cuộn phóng to từ ngay dưới mốc — vẫn nằm trong dải trễ ⇒ phải GIỮ cụm
    let px = (NGUONG_CANH_NHO_PX - 0.5) * TI_LE_MOI_NAC_DO_DUOC;
    dv = donViVeKeTiep(px, dv);
    expect(dv).toBe("cum");
    // thêm một nấc nữa — vẫn chưa ra khỏi dải
    px *= TI_LE_MOI_NAC_DO_DUOC;
    dv = donViVeKeTiep(px, dv);
    expect(dv).toBe("cum");
  });

  it("giá trị không hữu hạn ⇒ GIỮ NGUYÊN thứ đang vẽ, không tự ý đổi", () => {
    expect(donViVeKeTiep(Number.NaN, "may")).toBe("may");
    expect(donViVeKeTiep(Number.NaN, "cum")).toBe("cum");
  });
});

describe("đối chiếu với SỐ ĐO THỰC ĐỊA — công thức tự nhất quán vẫn có thể sai hệ số", () => {
  /*
   * Đo trên trình duyệt thật (`/twin` FUYU-F @1280×720, khung mặc định, `.qa-v2/tho-v6`):
   *   · tư thế camera: (361,2 · 136,0 · 350,2), điểm ngắm (121,0 · 0 · ~121)
   *   · cạnh trung vị đo được: 3,23 × 4,74 px  ⇒ cạnh NHỎ trung vị ≈ 3,2 px
   *   · canvas cao 489 px ở khung nhìn 1280×720 (panel ăn phần còn lại)
   * Máy mặc định của bộ sinh tải: 1.000 × 1.800 × 1.000 mm (`CO_DU_PHONG`).
   */
  it("★★★ dựng lại đúng tư thế đã đo ⇒ công thức phải cho CÙNG BẬC với trình duyệt (≈3,2 px)", () => {
    const camera = { x: 361.2, y: 136.0, z: 350.2 };
    // Một máy quanh tâm sa bàn — chính vùng mà trung vị rơi vào.
    const m = { kichThuocMm: { caoMm: 1800, rongMm: 1000 }, viTri: { x: 121, y: 0, z: 121 } };
    const px = canhNhoTrenManPx(m, camera, 45, 489);
    // Không ghim con số: ghim BẬC. Lệch quá 2 lần là công thức sai hệ số, không phải sai số mẫu.
    expect(px).toBeGreaterThan(3.2 / 2);
    expect(px).toBeLessThan(3.2 * 2);
  });

  it("★★★ và ở tư thế ấy công tắc phải BẬT CỤM — đó là toàn bộ lý do tệp này tồn tại", () => {
    const camera = { x: 361.2, y: 136.0, z: 350.2 };
    const ds = Array.from({ length: 21 }, (_, i) => ({
      kichThuocMm: { caoMm: 1800, rongMm: 1000 },
      viTri: { x: 100 + (i % 7) * 7, y: 0, z: 100 + Math.floor(i / 7) * 7 },
    }));
    const tv = trungViCanhNhoPx(ds, camera, 45, 489);
    expect(tv).toBeLessThan(NGUONG_CANH_NHO_PX);
    expect(donViVeKeTiep(tv, "may")).toBe("cum");
  });
});
