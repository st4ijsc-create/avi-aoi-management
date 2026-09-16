/**
 * datNhanSaBan.unit.test.ts — ★★★ LUẬT ĐẶT NHÃN SA BÀN, MỘT BỘ CHO CẢ HAI CHẾ ĐỘ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SỐ ĐO SINH RA TỆP NÀY (trình duyệt thật, cổng 3064, 1280×720, khung MẶC ĐỊNH,
 * KHÔNG thu panel — `.qa-tapdoan/n1-truoc.json` + `n3-sim.json`)
 * ════════════════════════════════════════════════════════════════════════════
 * Tên công ty ĐỌC ĐƯỢC ở chế độ **2D**, `?pv=tapdoan`:
 *
 *   vai              trước    "bê lớp né 3D nguyên si"   bản này (hộp chữ + ứng viên)
 *   qatd_giamdoc     3/3      3/3                        3/3
 *   qatd_quanly      0/1      1/1                        1/1
 *   qatd_kythuat     0/2      **0/2**                    **2/2**
 *   qatd_congnhan    0/1      1/1                        1/1
 *
 * ⇒ **Bê nguyên lớp né của `LopSaBan` sang 2D là KHÔNG ĐỦ** và con số bác bỏ nó
 *   là `qatd_kythuat`: hai nhãn cụm rơi dưới `panel-trai`/`panel-phai`, mà hai
 *   panel ấy **cao suốt khung** — trượt DỌC bao nhiêu cũng không ra khỏi chúng.
 *   Muốn đọc được thì chỗ đặt phải đổi theo **cả hai trục**, và phải bám vào HỘP
 *   của chính cụm (nếu không thì nhãn rời khỏi thứ nó gọi tên).
 *
 * ★★★ VÀ MỘT KHUYẾT TẬT THỨ HAI, Ở BẢN 3D ĐANG CHẠY: `LopSaBan.choDat` kiểm che
 *   trên **ĐIỂM NEO** (đáy nhãn), còn thứ người ta đọc là **CẢ HỘP CHỮ**. Trượt
 *   xuống `che.duoi + 6` đặt ĐÁY nhãn dưới thẻ Metrics, nên 18,5 px chữ vẫn nằm
 *   TRÊN thẻ. Đo được ở `qatd_giamdoc` 3D: hai nhãn "Toà 1"/"Toà 3" bị thẻ phủ
 *   **65,4 %** và **67,6 %** diện tích — trong khi `soNhan()` đếm chúng là "vẽ".
 *   Đó đúng là lời khai sai mà §4 sinh ra để chặn ⇒ phép thử ở đây chạy trên
 *   TÂM HỘP CHỮ, không trên điểm neo.
 *
 * ⚠ GIỮ luật cũ "ẩn theo TÂM, không theo giao-nhau-chút-nào" (`LopSaBan.tsx`):
 *   một nhãn chạm mép panel vẫn đọc được nửa chữ, ẩn nó đi là mất thông tin thật.
 */
import { describe, expect, it } from "vitest";

import {
  KHE_NHAN_PX,
  TRUOT_TOI_DA_PX,
  datNhanSaBan,
  type HopNhanPx,
} from "./datNhanSaBan";

const KHUNG = { rong: 968, cao: 489 };
const CO = { rong: 60, cao: 18 };
/** Khối/cụm mẫu giữa khung, không chạm lớp phủ nào. */
const HOP: HopNhanPx = { trai: 400, phai: 560, tren: 200, duoi: 320 };

/** Thẻ `Metrics` THẬT đã đo (px gốc canvas, 1280×720, khung mặc định). */
const THE_METRICS: HopNhanPx = { trai: 232, phai: 470, tren: 34, duoi: 254.3 };
/** `panel-trai` THẬT — cao SUỐT khung: đây là lớp phủ mà trượt dọc không thoát được. */
const PANEL_TRAI: HopNhanPx = { trai: 0, phai: 224, tren: 0, duoi: 489 };
/** `panel-phai` THẬT. */
const PANEL_PHAI: HopNhanPx = { trai: 712, phai: 968, tren: 0, duoi: 489 };

describe("★ ① Không lớp phủ ⇒ giữ đúng neo ưu tiên (bản vá không được dời nhãn đang tốt)", () => {
  it("`tren` ⇒ tâm hộp chữ nằm NGAY TRÊN mép trên, cách đúng KHE_NHAN_PX", () => {
    const d = datNhanSaBan(HOP, CO, [], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(d!.ma).toBe("tren-giua");
    expect(d!.x).toBeCloseTo(480, 6);
    expect(d!.y).toBeCloseTo(200 - KHE_NHAN_PX - 9, 6);
  });

  it("`duoi` ⇒ nằm NGAY DƯỚI mép dưới (khuôn nhãn cụm của bản 3D)", () => {
    const d = datNhanSaBan(HOP, CO, [], KHUNG, "duoi");
    expect(d!.ma).toBe("duoi-giua");
    expect(d!.y).toBeCloseTo(320 + KHE_NHAN_PX + 9, 6);
  });

  it("`trong` ⇒ nằm giữa hộp (khuôn nhãn toà của bản 2D)", () => {
    const d = datNhanSaBan(HOP, CO, [], KHUNG, "trong");
    expect(d!.ma).toBe("trong-giua");
    expect(d!.y).toBeCloseTo(260, 6);
  });
});

describe("★★★ ② Phép thử chạy trên TÂM HỘP CHỮ, không trên điểm neo", () => {
  /**
   * Khối nằm NGAY DƯỚI thẻ Metrics: neo `tren` rơi vào thẻ. Mã cũ trượt ĐÁY nhãn
   * xuống `254,3 + 6` ⇒ hộp chữ 18,5 px trải 241,8..260,3 và **2/3 nằm trên thẻ**.
   * Luật mới phải đặt TÂM dưới thẻ ⇒ mép trên hộp chữ ≥ mép dưới thẻ.
   */
  const KHOI: HopNhanPx = { trai: 370, phai: 450, tren: 250, duoi: 330 };

  it("trượt khỏi thẻ Metrics ⇒ TOÀN BỘ hộp chữ ra khỏi thẻ, không chỉ điểm neo", () => {
    const d = datNhanSaBan(KHOI, CO, [THE_METRICS], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(d!.y - CO.cao / 2).toBeGreaterThanOrEqual(THE_METRICS.duoi);
  });

  it("đối chứng biết kêu — luật CŨ (kiểm điểm neo) cho ra chỗ mà luật mới BÁC BỎ", () => {
    // Điểm neo kiểu cũ: đáy nhãn ở `che.duoi + 6` ⇒ tâm hộp chữ vẫn TRONG thẻ.
    const tamKieuCu = THE_METRICS.duoi + 6 - CO.cao / 2;
    expect(tamKieuCu).toBeLessThan(THE_METRICS.duoi); // ⇐ đúng khuyết tật đang sống
    const d = datNhanSaBan(KHOI, CO, [THE_METRICS], KHUNG, "tren");
    expect(d!.y).not.toBeCloseTo(tamKieuCu, 6);
  });
});

describe("★★★ ③ Lớp phủ CAO SUỐT KHUNG — chỗ trượt dọc bất lực, và là ca bác bỏ hướng 'bê nguyên si'", () => {
  /** Cụm `Công ty A` của `qatd_kythuat` ở 2D: tấm nền trải 59,9..386,1 × 121,8..367,1. */
  const CUM_A: HopNhanPx = { trai: 59.9, phai: 386.1, tren: 121.8, duoi: 367.1 };

  it("trượt DỌC không bao giờ thoát `panel-trai` (đo: 0/2 tên công ty đọc được)", () => {
    const gx = (CUM_A.trai + CUM_A.phai) / 2;
    expect(gx).toBeLessThan(PANEL_TRAI.phai); // tâm cụm nằm TRONG panel
    for (const dy of [-TRUOT_TOI_DA_PX, 0, TRUOT_TOI_DA_PX]) {
      const y = CUM_A.tren - KHE_NHAN_PX - CO.cao / 2 + dy;
      expect(y).toBeGreaterThanOrEqual(PANEL_TRAI.tren);
      expect(y).toBeLessThanOrEqual(PANEL_TRAI.duoi);
    }
  });

  it("luật mới ĐẶT ĐƯỢC, và chỗ đặt nằm ngoài panel mà vẫn trong hộp cụm", () => {
    const d = datNhanSaBan(CUM_A, CO, [PANEL_TRAI, THE_METRICS], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(d!.x).toBeGreaterThan(PANEL_TRAI.phai);
    expect(d!.x).toBeLessThanOrEqual(CUM_A.phai);
    expect(d!.y).toBeGreaterThan(THE_METRICS.duoi);
  });

  it("cụm `Công ty B` nằm dưới `panel-phai` ⇒ dời sang mép TRÁI của chính cụm", () => {
    const cumB: HopNhanPx = { trai: 581.9, phai: 908.1, tren: 121.8, duoi: 367.1 };
    const d = datNhanSaBan(cumB, CO, [PANEL_TRAI, PANEL_PHAI, THE_METRICS], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(d!.x).toBeLessThan(PANEL_PHAI.trai);
    expect(d!.x).toBeGreaterThanOrEqual(cumB.trai);
  });
});

describe("★ ④ Không chỗ nào thoát ⇒ trả `null` (màn ẩn VÀ ĐẾM RA, không im lặng)", () => {
  it("hộp nằm trọn trong một lớp phủ phủ kín khung ⇒ null", () => {
    const kinMit: HopNhanPx = { trai: 0, phai: 968, tren: 0, duoi: 489 };
    expect(datNhanSaBan(HOP, CO, [kinMit], KHUNG, "tren")).toBeNull();
  });

  it("nhãn KHÔNG được rời khỏi thứ nó gọi tên: mọi chỗ đặt nằm trong hộp nở thêm một dòng chữ", () => {
    const d = datNhanSaBan(HOP, CO, [THE_METRICS], KHUNG, "tren");
    expect(d).not.toBeNull();
    const noi = KHE_NHAN_PX + CO.cao;
    expect(d!.x).toBeGreaterThanOrEqual(HOP.trai - noi);
    expect(d!.x).toBeLessThanOrEqual(HOP.phai + noi);
    expect(d!.y).toBeGreaterThanOrEqual(HOP.tren - TRUOT_TOI_DA_PX - noi);
    expect(d!.y).toBeLessThanOrEqual(HOP.duoi + TRUOT_TOI_DA_PX + noi);
  });
});

describe("★ ⑤ Thiếu dữ kiện ⇒ TRẢ NGUYÊN NEO ƯU TIÊN (G8 — không bịa, không ẩn)", () => {
  it("cỡ chữ 0 (jsdom chưa có bố cục) ⇒ vẫn trả chỗ neo, không trả null", () => {
    const d = datNhanSaBan(HOP, { rong: 0, cao: 0 }, [], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(d!.ma).toBe("tren-giua");
  });

  it("khung 0×0 ⇒ trả chỗ neo (không có gì để tránh thì không được ẩn ai)", () => {
    const d = datNhanSaBan(HOP, CO, [THE_METRICS], { rong: 0, cao: 0 }, "tren");
    expect(d).not.toBeNull();
    expect(d!.ma).toBe("tren-giua");
  });
});

describe("★★★ ⑦ Ưu tiên chỗ KHÔNG giao một pixel nào — ca sinh ra từ một lần TỰ XEM ẢNH", () => {
  /**
   * Ảnh `.qa-tapdoan/anh/n1-sau/qatd_quanly-2d-toan-man.png` (bản vá vòng đầu)
   * đọc ra **"ng ty A"**: tâm nhãn sạch, nhưng thẻ `Metrics` ăn mất 24,3 % bên
   * trái — đúng hai chữ đầu. Phép đo theo TÂM nói ĐẠT; con mắt nói KHÔNG.
   */
  /** Thẻ trùm cả bề cao khối — đúng thế của thẻ `Metrics` so với cụm `qatd_quanly`. */
  const THE: HopNhanPx = { trai: 0, phai: 470, tren: 34, duoi: 400 };
  const KHOI: HopNhanPx = { trai: 420, phai: 560, tren: 300, duoi: 380 };

  it("chọn chỗ hộp chữ SẠCH HẲN, không chọn chỗ chỉ sạch tâm", () => {
    const d = datNhanSaBan(KHOI, CO, [THE], KHUNG, "trong");
    expect(d).not.toBeNull();
    expect(d!.x - CO.rong / 2).toBeGreaterThanOrEqual(THE.phai);
  });

  it("đối chứng biết kêu — chỗ 'sạch tâm mà cụt chữ' CÓ tồn tại và luật đã bỏ qua nó", () => {
    const tamGiua = (KHOI.trai + KHOI.phai) / 2; // 490
    expect(tamGiua).toBeGreaterThan(THE.phai); // tâm sạch…
    expect(tamGiua - CO.rong / 2).toBeLessThan(THE.phai); // …mà chữ đầu vẫn bị ăn
    const d = datNhanSaBan(KHOI, CO, [THE], KHUNG, "trong");
    expect(d!.x).not.toBeCloseTo(tamGiua, 6); // luật mới KHÔNG chọn chỗ ấy
  });

  it("không còn chỗ nào sạch hẳn ⇒ VẪN nhận chỗ sạch tâm, KHÔNG ẩn (giữ luật cũ)", () => {
    // Hai dải phủ kín mọi bề ngang trừ đúng một khe hẹp ở giữa khối.
    const traiKin: HopNhanPx = { trai: 0, phai: 470, tren: 0, duoi: 489 };
    const phaiKin: HopNhanPx = { trai: 474, phai: 968, tren: 0, duoi: 489 };
    const khoiHep: HopNhanPx = { trai: 440, phai: 504, tren: 200, duoi: 320 };
    const d = datNhanSaBan(khoiHep, CO, [traiKin, phaiKin], KHUNG, "trong");
    expect(d).not.toBeNull();
    expect(d!.x).toBeGreaterThan(traiKin.phai);
    expect(d!.x).toBeLessThan(phaiKin.trai);
  });
});

describe("★ ⑥ Tâm phải nằm trong khung — nhãn ngoài màn không phải một chỗ đặt", () => {
  it("khối sát mép trên ⇒ không chọn chỗ có tâm âm", () => {
    const satTren: HopNhanPx = { trai: 400, phai: 560, tren: 2, duoi: 120 };
    const d = datNhanSaBan(satTren, CO, [], KHUNG, "tren");
    expect(d).not.toBeNull();
    expect(d!.y).toBeGreaterThanOrEqual(0);
    expect(d!.y).toBeLessThanOrEqual(KHUNG.cao);
  });
});
