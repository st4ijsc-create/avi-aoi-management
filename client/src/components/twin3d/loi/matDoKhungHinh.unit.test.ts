/**
 * matDoKhungHinh.unit.test.ts — sàng cho bộ theo dõi fps và tự hạ chất lượng.
 *
 * ⚠ TÊN TỆP `*.unit.test.ts` — xem docblock của `locNhan.unit.test.ts`.
 *
 * Sàng này phải KÊU khi: đổi ngưỡng 25 fps, đổi cửa sổ 3 giây, đổi thứ tự thang
 * bậc, bỏ bước xoá cửa sổ sau khi hạ, hoặc bỏ trễ trễ (hysteresis) khi nâng lại.
 *
 * Thời gian được TIÊM VÀO qua `ghiKhungHinh(mocMs)` nên test mô phỏng 3 giây mà
 * chạy trong 0 ms. Không có `setTimeout`, không có `vi.useFakeTimers`.
 */

import { describe, it, expect } from "vitest";
import {
  TheoDoiMatDoKhungHinh,
  THANG_BAC,
  NGUONG_FPS_HA,
  NGUONG_FPS_NANG,
  CUA_SO_MS,
  dacTinhCuaBac,
  docBacDaLuu,
  KHOA_LUU_BAC,
  type BacChatLuong,
} from "./matDoKhungHinh";

/** Bơm khung hình đều nhau ở `fps` cho trong `soMs`, bắt đầu từ `moc0`. */
function bomKhung(
  td: TheoDoiMatDoKhungHinh,
  fps: number,
  soMs: number,
  moc0 = 0,
): { mocCuoi: number; bacCuoi: BacChatLuong; soLanDoi: number } {
  const buoc = 1000 / fps;
  let moc = moc0;
  let soLanDoi = 0;
  let bac = td.bac;
  const het = moc0 + soMs;
  while (moc <= het) {
    const kq = td.ghiKhungHinh(moc);
    if (kq.daDoi) soLanDoi += 1;
    bac = kq.bac;
    moc += buoc;
  }
  return { mocCuoi: moc - buoc, bacCuoi: bac, soLanDoi };
}

describe("hằng số — khớp NGUYÊN VĂN ngân sách §4", () => {
  it("ngưỡng hạ đúng 25 fps", () => {
    expect(NGUONG_FPS_HA).toBe(25);
  });

  it("cửa sổ đo đúng 3 giây", () => {
    expect(CUA_SO_MS).toBe(3000);
  });

  it("ngưỡng nâng cao hơn ngưỡng hạ (bắt buộc, nếu không sẽ bập bênh)", () => {
    expect(NGUONG_FPS_NANG).toBeGreaterThan(NGUONG_FPS_HA);
  });

  it("thang bậc đúng 5 nấc, đúng thứ tự spec", () => {
    expect([...THANG_BAC]).toEqual(["day_du", "tat_bong_do", "dpr_mot", "tat_nhan", "chi_hop"]);
  });
});

describe("dacTinhCuaBac — bảng đặc tính, không if/else rải rác", () => {
  it("day_du: bóng đổ bật, có nhãn, khối chi tiết", () => {
    const d = dacTinhCuaBac("day_du");
    expect(d.bongDo).toBe(true);
    expect(d.nhan).toBe(true);
    expect(d.chiHopBao).toBe(false);
  });

  it("tat_bong_do tắt bóng nhưng GIỮ nhãn", () => {
    expect(dacTinhCuaBac("tat_bong_do").bongDo).toBe(false);
    expect(dacTinhCuaBac("tat_bong_do").nhan).toBe(true);
  });

  it("dpr_mot hạ DPR về 1", () => {
    expect(dacTinhCuaBac("dpr_mot").dprToiDa).toBe(1);
  });

  it("tat_nhan tắt nhãn", () => {
    expect(dacTinhCuaBac("tat_nhan").nhan).toBe(false);
  });

  it("chi_hop chỉ vẽ hộp bao", () => {
    expect(dacTinhCuaBac("chi_hop").chiHopBao).toBe(true);
  });

  it("★ MỌI bậc đều clamp DPR ≤ 1,5 (§4 bảng ngân sách)", () => {
    for (const b of THANG_BAC) expect(dacTinhCuaBac(b).dprToiDa).toBeLessThanOrEqual(1.5);
  });
});

describe("tinhFps — trung bình trên cửa sổ trượt", () => {
  it("chưa đủ 2 mốc → null, KHÔNG phải 0", () => {
    const td = new TheoDoiMatDoKhungHinh();
    expect(td.tinhFps()).toBeNull();
    td.ghiKhungHinh(0);
    expect(td.tinhFps()).toBeNull();
  });

  it("60 khung/giây đo ra ~60 fps", () => {
    const td = new TheoDoiMatDoKhungHinh();
    bomKhung(td, 60, 1000);
    expect(td.tinhFps()).toBeGreaterThan(55);
    expect(td.tinhFps()).toBeLessThan(65);
  });

  it("20 khung/giây đo ra ~20 fps", () => {
    const td = new TheoDoiMatDoKhungHinh();
    bomKhung(td, 20, 2000);
    expect(td.tinhFps()).toBeGreaterThan(18);
    expect(td.tinhFps()).toBeLessThan(22);
  });

  it("mốc thời gian LÙI bị bỏ qua, không làm fps âm", () => {
    const td = new TheoDoiMatDoKhungHinh();
    td.ghiKhungHinh(1000);
    td.ghiKhungHinh(1016);
    const kq = td.ghiKhungHinh(500); // lùi
    expect(kq.soKhungTrongCuaSo).toBe(2);
    expect(td.tinhFps()!).toBeGreaterThan(0);
  });

  it("mốc NaN/Infinity bị bỏ qua", () => {
    const td = new TheoDoiMatDoKhungHinh();
    td.ghiKhungHinh(0);
    td.ghiKhungHinh(NaN);
    td.ghiKhungHinh(Infinity);
    expect(td.ghiKhungHinh(16).soKhungTrongCuaSo).toBe(2);
  });
});

describe("★ tự HẠ bậc: fps < 25 trong 3 giây", () => {
  it("60 fps suốt 6 giây → KHÔNG hạ bậc lần nào", () => {
    const td = new TheoDoiMatDoKhungHinh({ choPhepNang: false });
    const r = bomKhung(td, 60, 6000);
    expect(r.bacCuoi).toBe("day_du");
    expect(r.soLanDoi).toBe(0);
  });

  it("★ 20 fps (dưới 25) suốt 3 giây → hạ đúng MỘT bậc: day_du → tat_bong_do", () => {
    const td = new TheoDoiMatDoKhungHinh({ choPhepNang: false });
    bomKhung(td, 20, 3100);
    expect(td.bac).toBe("tat_bong_do");
  });

  it("★ 26 fps (TRÊN ngưỡng 25) suốt 5 giây → KHÔNG hạ — ngưỡng là 25, không phải 30", () => {
    const td = new TheoDoiMatDoKhungHinh({ choPhepNang: false });
    bomKhung(td, 26, 5000);
    expect(td.bac).toBe("day_du");
  });

  it("★ 20 fps chỉ trong 2 giây (CHƯA đủ cửa sổ 3s) → KHÔNG hạ", () => {
    const td = new TheoDoiMatDoKhungHinh({ choPhepNang: false });
    bomKhung(td, 20, 2000);
    expect(td.bac).toBe("day_du");
  });

  it("★ sau khi hạ, cửa sổ bị XOÁ nên không rơi tự do nhiều nấc trong cùng 3 giây", () => {
    // Không xoá cửa sổ thì các khung chậm cũ vẫn nằm đó và mỗi khung mới lại hạ
    // thêm một nấc → tụt thẳng xuống chi_hop trong ~3 giây.
    const td = new TheoDoiMatDoKhungHinh({ choPhepNang: false });
    const r = bomKhung(td, 20, 3100);
    expect(r.soLanDoi).toBe(1);
    expect(td.bac).toBe("tat_bong_do");
  });

  it("10 fps kéo dài 15 giây → tụt dần tới đáy chi_hop rồi DỪNG", () => {
    const td = new TheoDoiMatDoKhungHinh({ choPhepNang: false });
    bomKhung(td, 10, 20000);
    expect(td.bac).toBe("chi_hop");
  });

  it("ở đáy chi_hop, fps vẫn thấp → không ném, không đổi bậc nữa", () => {
    const td = new TheoDoiMatDoKhungHinh({ bacBanDau: "chi_hop", choPhepNang: false });
    const r = bomKhung(td, 5, 10000);
    expect(r.bacCuoi).toBe("chi_hop");
    expect(r.soLanDoi).toBe(0);
  });

  it("hieuNangThap đúng false ở day_du và true ở mọi bậc thấp hơn", () => {
    expect(new TheoDoiMatDoKhungHinh().hieuNangThap).toBe(false);
    for (const b of THANG_BAC.slice(1)) {
      expect(new TheoDoiMatDoKhungHinh({ bacBanDau: b }).hieuNangThap).toBe(true);
    }
  });
});

describe("tự NÂNG lại có trễ trễ (hysteresis)", () => {
  it("máy khoẻ lại (60 fps > 50) → nâng một bậc", () => {
    const td = new TheoDoiMatDoKhungHinh({ bacBanDau: "dpr_mot" });
    bomKhung(td, 60, 3100);
    expect(td.bac).toBe("tat_bong_do");
  });

  it("★ fps quanh quẩn 30 (trên ngưỡng hạ 25, dưới ngưỡng nâng 50) → ĐỨNG YÊN, không bập bênh", () => {
    const td = new TheoDoiMatDoKhungHinh({ bacBanDau: "dpr_mot" });
    const r = bomKhung(td, 30, 15000);
    expect(r.bacCuoi).toBe("dpr_mot");
    expect(r.soLanDoi).toBe(0);
  });

  it("choPhepNang=false thì không bao giờ nâng dù fps rất cao", () => {
    const td = new TheoDoiMatDoKhungHinh({ bacBanDau: "chi_hop", choPhepNang: false });
    bomKhung(td, 144, 10000);
    expect(td.bac).toBe("chi_hop");
  });
});

describe("ép bậc thủ công — người dùng thắng bộ tự động", () => {
  it("ép chi_hop thì 144 fps cũng không nâng", () => {
    const td = new TheoDoiMatDoKhungHinh();
    td.epBac("chi_hop");
    bomKhung(td, 144, 10000);
    expect(td.bac).toBe("chi_hop");
    expect(td.dangBiEp).toBe(true);
  });

  it("ép day_du thì 5 fps cũng không hạ", () => {
    const td = new TheoDoiMatDoKhungHinh();
    td.epBac("day_du");
    bomKhung(td, 5, 10000);
    expect(td.bac).toBe("day_du");
  });

  it("bỏ ép (null) trả quyền lại cho bộ tự động", () => {
    const td = new TheoDoiMatDoKhungHinh();
    td.epBac("chi_hop");
    td.epBac(null);
    expect(td.dangBiEp).toBe(false);
    bomKhung(td, 10, 4000);
    expect(td.bac).toBe("tat_bong_do");
  });
});

describe("datLai — xoá lịch sử đo", () => {
  it("sau datLai, cửa sổ rỗng và fps trở lại null", () => {
    const td = new TheoDoiMatDoKhungHinh();
    bomKhung(td, 60, 2000);
    td.datLai();
    expect(td.tinhFps()).toBeNull();
  });
});

describe("docBacDaLuu — khôi phục lựa chọn từ localStorage", () => {
  it("giá trị hợp lệ được trả nguyên", () => {
    expect(docBacDaLuu(() => "tat_nhan")).toBe("tat_nhan");
  });

  it("giá trị rác → null, KHÔNG rơi về một bậc bịa", () => {
    expect(docBacDaLuu(() => "sieu_net")).toBeNull();
    expect(docBacDaLuu(() => "")).toBeNull();
    expect(docBacDaLuu(() => null)).toBeNull();
  });

  it("storage ném (Safari private mode) → null, không làm sập màn", () => {
    expect(
      docBacDaLuu(() => {
        throw new Error("SecurityError");
      }),
    ).toBeNull();
  });

  it("khoá lưu ổn định", () => {
    expect(KHOA_LUU_BAC).toBe("twin3d.bacChatLuong");
  });
});
