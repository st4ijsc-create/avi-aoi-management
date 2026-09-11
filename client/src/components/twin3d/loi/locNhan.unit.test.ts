/**
 * locNhan.unit.test.ts — sàng cho bộ lọc nhãn.
 *
 * ⚠ TÊN TỆP phải là `*.unit.test.ts`. `vitest.config.ts` chỉ include
 * `client/src/**./*.unit.test.ts`; đặt tên `.test.ts` thì test KHÔNG ĐƯỢC THU
 * THẬP mà cổng VẪN BÁO XANH — một suite 0 test cũng xanh.
 *
 * Sàng này phải KÊU khi: đổi trần 30, đổi thứ tự ưu tiên, bỏ khử chồng lấp, hoặc
 * làm kết quả phụ thuộc thứ tự đầu vào.
 */

import { describe, it, expect } from "vitest";
import {
  KHE_TANG_PX,
  TANG_NHAN_TOI_DA,
  hopTrongKhung,
  locNhan,
  demCapChongLap,
  diemUuTienNhan,
  haiHopChongNhau,
  hopNhan,
  TRAN_NHAN_DOM,
  BAN_KINH_VA_CHAM_PX,
  CAO_SUY_DOAN_PX,
  RONG_SUY_DOAN_PX,
  type NhanUngVien,
  uocLuongRongNhanPx,
} from "./locNhan";

/**
 * Sinh N nhãn RỜI NHAU (bbox không chạm nhau) để cô lập luật trần.
 *
 * ⚠ BƯỚC phải lớn hơn BỀ RỘNG nhãn, không phải lớn hơn bán kính. Bản đầu của
 * fixture này lấy `BAN_KINH_VA_CHAM_PX * 3 = 126px` — nhỏ hơn bề rộng suy đoán
 * 150px của nhãn thật, nên sau khi đổi sang mô hình bbox, 6 test "rời nhau" ĐỎ
 * hàng loạt. Đó là fixture sai chứ không phải hành vi sai: 126px thật sự KHÔNG
 * đủ để hai nhãn 150px không đè lên nhau, và chính đó là lỗi mà mô hình đường
 * tròn cũ giấu đi. Giữ ghi chú này để lần sau không ai "sửa" ngược lại.
 */
function nhanRoiNhau(n: number, tuy: Partial<NhanUngVien> = {}): NhanUngVien[] {
  const buoc = RONG_SUY_DOAN_PX * 2;
  return Array.from({ length: n }, (_, i) => ({
    khoa: `may:${String(i).padStart(3, "0")}`,
    x: (i % 20) * buoc,
    y: Math.floor(i / 20) * buoc,
    khoangCachMet: 10 + i,
    ...tuy,
  }));
}

describe("diemUuTienNhan — thứ tự ưu tiên là HẠNG, không phải điểm cộng dồn", () => {
  it("máy đang chọn ở RẤT XA vẫn thắng máy bình thường ngay trước mũi camera", () => {
    const chonXa: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 9999, dangChon: true };
    const thuongGan: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 0.001 };
    expect(diemUuTienNhan(chonXa)).toBeGreaterThan(diemUuTienNhan(thuongGan));
  });

  it("bất thường thắng hover, hover thắng chỉ-gần-camera", () => {
    const batThuong: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 500, batThuong: true };
    const hover: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 1, hover: true };
    const thuong: NhanUngVien = { khoa: "c", x: 0, y: 0, khoangCachMet: 1 };
    expect(diemUuTienNhan(batThuong)).toBeGreaterThan(diemUuTienNhan(hover));
    expect(diemUuTienNhan(hover)).toBeGreaterThan(diemUuTienNhan(thuong));
  });

  it("đang chọn thắng đang bất thường (luật '>' của brief)", () => {
    const chon: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 50, dangChon: true };
    const loi: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 50, batThuong: true };
    expect(diemUuTienNhan(chon)).toBeGreaterThan(diemUuTienNhan(loi));
  });

  it("cùng hạng thì gần camera hơn được điểm cao hơn", () => {
    const gan: NhanUngVien = { khoa: "a", x: 0, y: 0, khoangCachMet: 5 };
    const xa: NhanUngVien = { khoa: "b", x: 0, y: 0, khoangCachMet: 50 };
    expect(diemUuTienNhan(gan)).toBeGreaterThan(diemUuTienNhan(xa));
  });

  it("khoảng cách vô hạn / NaN không làm điểm thành NaN", () => {
    expect(Number.isFinite(diemUuTienNhan({ khoa: "a", x: 0, y: 0, khoangCachMet: Infinity }))).toBe(true);
    expect(Number.isFinite(diemUuTienNhan({ khoa: "a", x: 0, y: 0, khoangCachMet: NaN }))).toBe(true);
  });
});

describe("locNhan — TRẦN CỨNG 30 nhãn DOM (§4)", () => {
  it("trần mặc định đúng bằng 30", () => {
    expect(TRAN_NHAN_DOM).toBe(30);
  });

  it("100 nhãn rời nhau → vẽ đúng 30, phần dư đếm vào soVuotTran", () => {
    const kq = locNhan(nhanRoiNhau(100));
    expect(kq.ve.length).toBe(30);
    expect(kq.tongUngVien).toBe(100);
    expect(kq.soVuotTran).toBe(70);
    expect(kq.ve.length + kq.soVuotTran + kq.soBiChongLap + kq.soNgoaiKhung).toBe(100);
  });

  it("300 nhãn (con số đã đo là 'laggy') vẫn KHÔNG bao giờ vượt 30", () => {
    expect(locNhan(nhanRoiNhau(300)).ve.length).toBeLessThanOrEqual(30);
  });

  it("dưới trần thì vẽ hết, không cắt oan", () => {
    const kq = locNhan(nhanRoiNhau(7));
    expect(kq.ve.length).toBe(7);
    expect(kq.soVuotTran).toBe(0);
  });

  it("trần tuỳ chỉnh được tôn trọng", () => {
    expect(locNhan(nhanRoiNhau(50), { tranNhan: 5 }).ve.length).toBe(5);
  });

  it("trần 0 → không vẽ nhãn nào", () => {
    expect(locNhan(nhanRoiNhau(50), { tranNhan: 0 }).ve.length).toBe(0);
  });
});

describe("locNhan — cull ngoài khung nhìn", () => {
  it("nhãn ngoài khung bị loại NGAY, không tốn suất trong trần", () => {
    const ds: NhanUngVien[] = [
      ...nhanRoiNhau(40).map((n) => ({ ...n, ngoaiKhung: true })),
      ...nhanRoiNhau(5).map((n) => ({ ...n, khoa: `trong:${n.khoa}` })),
    ];
    const kq = locNhan(ds);
    expect(kq.soNgoaiKhung).toBe(40);
    expect(kq.ve.length).toBe(5);
    expect(kq.ve.every((v) => v.khoa.startsWith("trong:"))).toBe(true);
  });
});

describe("locNhan — khử chồng lấp CHẠY TRƯỚC cắt trần", () => {
  it("50 nhãn chồng đúng một chỗ → chỉ 1 sống sót", () => {
    const chong: NhanUngVien[] = Array.from({ length: 50 }, (_, i) => ({
      khoa: `c:${i}`,
      x: 100,
      y: 100,
      khoangCachMet: 10 + i,
    }));
    const kq = locNhan(chong);
    expect(kq.ve.length).toBe(1);
    expect(kq.soBiChongLap).toBe(49);
  });

  it("★ suất bị chồng lấp ăn KHÔNG được tính vào trần: 20 cụm chồng + 25 rời → 25 rời vẫn vẽ", () => {
    // Nếu ai đó đảo thứ tự (cắt 30 trước, khử chồng sau), 20 nhãn chồng nhau sẽ
    // chiếm 20/30 suất và chỉ 10 nhãn rời được vẽ. Test này KÊU đúng lỗi đó.
    const cum: NhanUngVien[] = Array.from({ length: 20 }, (_, i) => ({
      khoa: `cum:${i}`,
      x: 5000,
      y: 5000,
      khoangCachMet: 1, // rất gần → ưu tiên cao, được xét trước
    }));
    const roi = nhanRoiNhau(25).map((n) => ({ ...n, khoangCachMet: 100 + n.khoangCachMet }));
    const kq = locNhan([...cum, ...roi]);
    expect(kq.ve.length).toBe(26); // 1 sống sót của cụm + 25 rời
    expect(kq.soBiChongLap).toBe(19);
    expect(kq.soVuotTran).toBe(0);
  });

  it("★ CHẨN ĐOÁN đúng lý do loại khi cả hai luật cùng áp: 30 rời + 1 chồng + 1 dư", () => {
    // Sàng mật độ bắt được: đảo thứ tự hai nhánh `if` trong vòng lặp KHÔNG đổi
    // tập nhãn được vẽ (nhãn chồng lấp không lọt vào cả hai đường), nhưng ĐỔI
    // LÝ DO ghi vào bộ đếm — và bộ đếm chính là thứ chảy ra `window.__demNhan`
    // để e2e đọc. Một bộ đếm sai lý do làm phép chẩn đoán "vì sao nhãn biến mất"
    // trỏ nhầm chỗ, nên nó đáng được ghim y như tập nhãn.
    const roi = nhanRoiNhau(30).map((n) => ({ ...n, khoangCachMet: 1 + n.khoangCachMet * 0.001 }));
    // Đè LÊN nhãn rời đầu tiên (toạ độ 0,0), ưu tiên thấp hơn → phải tính là CHỒNG LẤP.
    const chong: NhanUngVien = { khoa: "z-chong", x: 3, y: 3, khoangCachMet: 900 };
    // Ở chỗ trống nhưng đã hết suất → phải tính là VƯỢT TRẦN.
    const du: NhanUngVien = { khoa: "z-du", x: 9000, y: 9000, khoangCachMet: 901 };

    const kq = locNhan([...roi, chong, du]);
    expect(kq.ve.length).toBe(30);
    expect(kq.soBiChongLap).toBe(1);
    expect(kq.soVuotTran).toBe(1);
    expect(kq.ve.map((v) => v.khoa)).not.toContain("z-chong");
    expect(kq.ve.map((v) => v.khoa)).not.toContain("z-du");
  });

  it("nhãn KỀ SÁT MÉP nhau (chạm nhưng không đè) KHÔNG bị coi là chồng", () => {
    // Cách nhau đúng một bề rộng ⇒ mép phải của a trùng mép trái của b. Đọc được
    // bình thường, giết một cái đi là mất thông tin không đổi lại được gì.
    const kq = locNhan([
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1, rongPx: 100, caoPx: 20 },
      { khoa: "b", x: 100, y: 0, khoangCachMet: 2, rongPx: 100, caoPx: 20 },
    ]);
    expect(kq.ve.length).toBe(2);
  });

  it("kích thước suy đoán tuỳ chỉnh được", () => {
    const ds: NhanUngVien[] = [
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1 },
      { khoa: "b", x: 100, y: 0, khoangCachMet: 2 },
    ];
    expect(locNhan(ds, { rongSuyDoanPx: 20, caoSuyDoanPx: 20 }).ve.length).toBe(2);
    expect(locNhan(ds, { rongSuyDoanPx: 400, caoSuyDoanPx: 20 }).ve.length).toBe(1);
  });

  it("★ TƯƠNG THÍCH NGƯỢC: `banKinhVaChamPx` cũ ⇒ hộp vuông cạnh 2× bán kính", () => {
    // Người gọi cũ truyền bán kính; hành vi phải suy biến êm chứ không đổi đột ngột.
    const ds: NhanUngVien[] = [
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1 },
      { khoa: "b", x: 100, y: 0, khoangCachMet: 2 },
    ];
    // Bán kính 10 ⇒ hộp 20×20, cách 100px ⇒ rời nhau.
    expect(locNhan(ds, { banKinhVaChamPx: 10 }).ve.length).toBe(2);
    // Bán kính 200 ⇒ hộp 400×400, cách 100px ⇒ chồng.
    expect(locNhan(ds, { banKinhVaChamPx: 200 }).ve.length).toBe(1);
    expect(BAN_KINH_VA_CHAM_PX).toBe(42); // hằng số cũ vẫn xuất khẩu, không phá import
  });

  it("khi chồng nhau, cái ƯU TIÊN CAO HƠN sống sót — không phải cái đến trước", () => {
    const kq = locNhan([
      { khoa: "thuong", x: 10, y: 10, khoangCachMet: 1 },
      { khoa: "loi", x: 12, y: 12, khoangCachMet: 900, batThuong: true },
    ]);
    expect(kq.ve.map((v) => v.khoa)).toEqual(["loi"]);
  });
});

describe("locNhan — TẤT ĐỊNH", () => {
  it("đảo ngược thứ tự đầu vào cho ra CÙNG tập nhãn, CÙNG thứ tự", () => {
    const ds = nhanRoiNhau(60);
    const xuoi = locNhan(ds).ve.map((v) => v.khoa);
    const nguoc = locNhan([...ds].reverse()).ve.map((v) => v.khoa);
    expect(nguoc).toEqual(xuoi);
  });

  it("hai nhãn hoà điểm tuyệt đối → phá hoà bằng khoá, ổn định giữa hai lần gọi", () => {
    const a: NhanUngVien = { khoa: "may:002", x: 0, y: 0, khoangCachMet: 12 };
    const b: NhanUngVien = { khoa: "may:001", x: 500, y: 500, khoangCachMet: 12 };
    expect(locNhan([a, b]).ve.map((v) => v.khoa)).toEqual(["may:001", "may:002"]);
    expect(locNhan([b, a]).ve.map((v) => v.khoa)).toEqual(["may:001", "may:002"]);
  });

  it("không làm biến dạng mảng đầu vào của người gọi", () => {
    const ds = nhanRoiNhau(10);
    const truoc = ds.map((n) => n.khoa);
    locNhan(ds);
    expect(ds.map((n) => n.khoa)).toEqual(truoc);
  });

  it("kết quả sắp theo ưu tiên GIẢM DẦN", () => {
    const kq = locNhan(nhanRoiNhau(20));
    for (let i = 1; i < kq.ve.length; i++) {
      expect(kq.ve[i - 1].diemUuTien).toBeGreaterThanOrEqual(kq.ve[i].diemUuTien);
    }
  });

  it("danh sách rỗng → kết quả rỗng, không ném", () => {
    const kq = locNhan([]);
    expect(kq.ve).toEqual([]);
    expect(kq.tongUngVien).toBe(0);
  });
});

describe("locNhan — NT-2 luật 1: alarm không bao giờ bị góc camera che", () => {
  it("35 máy bình thường ở gần + 1 máy lỗi ở xa → máy lỗi VẪN nằm trong 30 nhãn", () => {
    const thuong = nhanRoiNhau(35).map((n) => ({ ...n, khoangCachMet: 1 + n.khoangCachMet * 0.001 }));
    const loi: NhanUngVien = {
      khoa: "may:LOI",
      x: 5000,
      y: 5000,
      khoangCachMet: 800,
      batThuong: true,
    };
    const kq = locNhan([...thuong, loi]);
    expect(kq.ve.length).toBe(30);
    expect(kq.ve.map((v) => v.khoa)).toContain("may:LOI");
    expect(kq.ve[0].khoa).toBe("may:LOI"); // và nó đứng ĐẦU
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* ★★★ KHỬ CHỒNG LẤP THEO BBOX — bản vá cho một LỜI KHAI SAI                */
/*                                                                           */
/* QA đo bằng `getBoundingClientRect` trên màn thật: 5 CẶP nhãn chồng nhau,   */
/* chồng ngang tới 66px, chữ che nhau không đọc được — TRONG KHI bộ đếm       */
/* `__demNhan.chongLap` báo 0. Bộ đếm không sai số học; MÔ HÌNH của nó sai    */
/* hình: nó coi nhãn là đường tròn bán kính 42px, nhãn thật là hình chữ nhật  */
/* rộng 112–198px. Khối test dưới đây ghim mô hình mới bằng cách đo ĐẦU RA    */
/* (quét toàn bộ cặp), không bằng cách đọc lại bộ đếm.                        */
/* ═════════════════════════════════════════════════════════════════════════ */

describe("★ khử chồng lấp theo BBOX, không theo đường tròn", () => {
  it("★ CA HỒI QUY QA: hai nhãn rộng 180px cách tâm 100px CHỒNG 80px — mô hình cũ bảo KHÔNG", () => {
    // Đây đúng là ca mà bán kính 42 bỏ lọt: khoảng cách tâm 100 > 42, "không
    // chồng" theo đường tròn; nhưng 180px rộng thì hai hộp đè nhau 80px thật.
    const ds: NhanUngVien[] = [
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1, rongPx: 180, caoPx: 22 },
      { khoa: "b", x: 100, y: 0, khoangCachMet: 2, rongPx: 180, caoPx: 22 },
    ];
    const kq = locNhan(ds);
    expect(kq.ve.length).toBe(1);
    expect(kq.soBiChongLap).toBe(1);
    expect(kq.ve[0].khoa).toBe("a"); // gần camera hơn thì sống
  });

  it("★ KHÔNG có bán kính nào cứu được: nhãn 9:1 chồng NGANG mà rời DỌC", () => {
    // Vì sao phải đổi HÌNH chứ không nới SỐ. Cùng bề rộng 180, cùng cách 100px:
    //  - lệch NGANG  ⇒ chồng thật     ⇒ phải loại
    //  - lệch DỌC    ⇒ đọc được cả hai ⇒ phải giữ
    // Mọi bán kính đường tròn xử hai ca này GIỐNG NHAU, nên luôn sai một trong hai.
    const ngang: NhanUngVien[] = [
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1, rongPx: 180, caoPx: 22 },
      { khoa: "b", x: 100, y: 0, khoangCachMet: 2, rongPx: 180, caoPx: 22 },
    ];
    const doc: NhanUngVien[] = [
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1, rongPx: 180, caoPx: 22 },
      { khoa: "b", x: 0, y: 100, khoangCachMet: 2, rongPx: 180, caoPx: 22 },
    ];
    expect(locNhan(ngang).ve.length).toBe(1);
    expect(locNhan(doc).ve.length).toBe(2);
  });

  it("★ HẬU ĐIỀU KIỆN: 0 cặp CÒN chồng trong kết quả, với kích thước nhãn HỖN TẠP", () => {
    // Phép đo ĐỘC LẬP với thuật toán: quét mọi cặp trong `ve` bằng
    // `demCapChongLap`. Đây chính là điều `__demNhan.chongLap = 0` ngầm khai mà
    // bản đường tròn KHÔNG giữ được. Bề rộng trải 112–198px đúng dải QA đo được.
    const rong = [112, 128, 145, 160, 175, 198];
    const ds: NhanUngVien[] = Array.from({ length: 120 }, (_, i) => ({
      khoa: `may:${String(i).padStart(3, "0")}`,
      // Lưới CỐ Ý dày (60px) để có rất nhiều cặp chồng thật ở đầu vào.
      x: (i % 12) * 60,
      y: Math.floor(i / 12) * 18,
      khoangCachMet: 5 + i * 0.1,
      rongPx: rong[i % rong.length],
      caoPx: 22,
    }));

    // Đầu vào PHẢI có chồng lấp thật, nếu không phép đo dưới thành vô can giả.
    expect(demCapChongLap(ds)).toBeGreaterThan(5);

    const kq = locNhan(ds);
    const daVe = kq.ve.map((v) => {
      const goc = ds.find((n) => n.khoa === v.khoa)!;
      return { x: v.x, y: v.y, rongPx: goc.rongPx, caoPx: goc.caoPx };
    });
    expect(demCapChongLap(daVe)).toBe(0);
  });

  it("★ `hop` trả về KHỚP với `getBoundingClientRect` của CSS thật", () => {
    // CSS của LopNhan.tsx: `left: x; top: y; transform: translate(-50%, -100%)`.
    // Nghĩa là (x, y) là GIỮA CẠNH DƯỚI, không phải tâm. Nhầm chỗ này thì lệch
    // nửa chiều cao — và lệch đúng theo hướng báo THIẾU chồng lấp.
    const h = hopNhan({ x: 500, y: 300, rongPx: 180, caoPx: 22 });
    expect(h.trai).toBe(410); // 500 - 180/2
    expect(h.phai).toBe(590); // 500 + 180/2
    expect(h.duoi).toBe(300); // neo nằm ở CẠNH DƯỚI
    expect(h.tren).toBe(278); // 300 - 22, hộp nằm HOÀN TOÀN phía trên neo
  });

  it("★ nhãn NGAY TRÊN nhau (cùng x, cách dọc 21px < cao 22px) bị bắt là chồng", () => {
    // Ca mà mô hình cũ CÓ bắt được (21 < 42) nhưng lý do đúng phải là bbox.
    const gan = locNhan([
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1, rongPx: 100, caoPx: 22 },
      { khoa: "b", x: 0, y: 21, khoangCachMet: 2, rongPx: 100, caoPx: 22 },
    ]);
    expect(gan.ve.length).toBe(1);
    // Cách dọc 22px = đúng bằng chiều cao ⇒ chạm mép, KHÔNG chồng.
    const vua = locNhan([
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1, rongPx: 100, caoPx: 22 },
      { khoa: "b", x: 0, y: 22, khoangCachMet: 2, rongPx: 100, caoPx: 22 },
    ]);
    expect(vua.ve.length).toBe(2);
  });

  it("thiếu rongPx/caoPx ⇒ dùng suy đoán, không NaN và không bỏ qua khử chồng", () => {
    const h = hopNhan({ x: 0, y: 0 });
    expect(h.phai - h.trai).toBe(RONG_SUY_DOAN_PX);
    expect(h.duoi - h.tren).toBe(CAO_SUY_DOAN_PX);
    // rongPx = 0 / âm / NaN đều rơi về suy đoán chứ không thành hộp rỗng (hộp
    // rỗng thì không bao giờ chồng ⇒ khử chồng lấp tắt câm lặng).
    for (const xau of [0, -5, NaN, Infinity]) {
      const hx = hopNhan({ x: 0, y: 0, rongPx: xau, caoPx: xau });
      expect(hx.phai - hx.trai).toBe(RONG_SUY_DOAN_PX);
      expect(hx.duoi - hx.tren).toBe(CAO_SUY_DOAN_PX);
    }
  });

  it("haiHopChongNhau tất định và đối xứng", () => {
    const a = { trai: 0, phai: 100, tren: 0, duoi: 20 };
    const b = { trai: 50, phai: 150, tren: 10, duoi: 30 };
    const c = { trai: 200, phai: 300, tren: 0, duoi: 20 };
    expect(haiHopChongNhau(a, b)).toBe(true);
    expect(haiHopChongNhau(b, a)).toBe(true);
    expect(haiHopChongNhau(a, c)).toBe(false);
    expect(haiHopChongNhau(c, a)).toBe(false);
  });

  it("demCapChongLap đếm ĐÚNG số cặp, không phải số nhãn", () => {
    // Ba nhãn chồng nhau đôi một = 3 CẶP (không phải 3 nhãn, không phải 2).
    const ba = [
      { x: 0, y: 0, rongPx: 100, caoPx: 22 },
      { x: 10, y: 0, rongPx: 100, caoPx: 22 },
      { x: 20, y: 0, rongPx: 100, caoPx: 22 },
    ];
    expect(demCapChongLap(ba)).toBe(3);
    expect(demCapChongLap([])).toBe(0);
    expect(demCapChongLap([ba[0]])).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 23 M1 — KHAI BÁO SỰ THIẾU + CHÍNH SÁCH CHỌN NHÃN                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("Đợt 23 M1 — soBiGiau nói ra số tên KHÔNG đọc được", () => {
  /**
   * Dựng lại ĐÚNG hình dạng đo được trên `dist` (`.qa-dot23/M1-do-nhan.json`):
   * nhiều ứng viên chen trong một dải hẹp ⇒ phần lớn bị khử vì chồng bbox.
   */
  const chumDay = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      khoa: `may:${String(i).padStart(3, "0")}`,
      x: 400 + (i % 6) * 24,
      y: 300 + Math.floor(i / 6) * 9,
      khoangCachMet: 5 + i * 0.1,
      rongPx: 150,
      caoPx: 22,
    }));

  it("★★★ `ve` một mình KHÔNG trả lời được 'bao nhiêu máy mất tên' — `soBiGiau` thì có", () => {
    const kq = locNhan(chumDay(45));
    // Đầu vào PHẢI thật sự chen chúc, nếu không phép đo dưới là vô can giả.
    expect(kq.ve.length).toBeLessThan(45);
    // Bất biến kế toán: mọi ứng viên hoặc được vẽ, hoặc bị giấu. Không ô nào rơi.
    expect(kq.ve.length + kq.soBiGiau).toBe(kq.tongUngVien);
    expect(kq.soBiGiau).toBeGreaterThan(0);
  });

  it("★ soBiGiau CỘNG ĐỦ bốn nguồn, không thiếu ô nào", () => {
    const ds = [
      ...chumDay(40),
      { khoa: "xa:1", x: -9999, y: -9999, khoangCachMet: 2, ngoaiKhung: true },
    ];
    const kq = locNhan(ds, { tranNhan: 5 });
    expect(kq.soNgoaiKhung).toBe(1);
    expect(kq.soBiGiau).toBe(kq.soNgoaiKhung + kq.soBiChongLap + kq.soVuotTran);
    expect(kq.ve.length + kq.soBiGiau).toBe(kq.tongUngVien);
  });

  it("không ai bị giấu ⇒ soBiGiau = 0 (đối chứng chiều DƯƠNG)", () => {
    // Ba nhãn cách nhau thừa thãi — không cớ gì phải giấu.
    const kq = locNhan([
      { khoa: "a", x: 0, y: 0, khoangCachMet: 1, rongPx: 100, caoPx: 22 },
      { khoa: "b", x: 400, y: 0, khoangCachMet: 2, rongPx: 100, caoPx: 22 },
      { khoa: "c", x: 800, y: 0, khoangCachMet: 3, rongPx: 100, caoPx: 22 },
    ]);
    expect(kq.ve.length).toBe(3);
    expect(kq.soBiGiau).toBe(0);
  });
});

describe("Đợt 23 M1 — chiNhanBatThuong: đổi CHÍNH SÁCH, không chỉ đổi số", () => {
  const ds = [
    { khoa: "ok:1", x: 100, y: 100, khoangCachMet: 1 },
    { khoa: "ok:2", x: 400, y: 100, khoangCachMet: 2 },
    { khoa: "loi:1", x: 700, y: 100, khoangCachMet: 30, batThuong: true },
  ];

  it("★★★ bật ⇒ CHỈ máy bất thường còn nhãn, dù nó XA camera nhất", () => {
    const kq = locNhan(ds, { chiNhanBatThuong: true });
    expect(kq.ve.map((v) => v.khoa)).toEqual(["loi:1"]);
    // Hai cái bị lọc phải được KHAI, không biến mất khỏi sổ.
    expect(kq.soBiGiau).toBe(2);
    expect(kq.ve.length + kq.soBiGiau).toBe(kq.tongUngVien);
  });

  it("★ ĐỐI CHỨNG (G5/G32): tắt ⇒ đầu ra KHÁC HẲN — cờ thật sự làm gì đó", () => {
    const tat = locNhan(ds, { chiNhanBatThuong: false });
    const bat = locNhan(ds, { chiNhanBatThuong: true });
    expect(tat.ve.length).toBe(3);
    expect(bat.ve.length).toBe(1);
    expect(tat.ve.length).not.toBe(bat.ve.length);
  });

  it("★ Đợt 45 — máy đang RÊ CHUỘT không bị chính sách giấu (chính sách nay là mặc định; rê = cách đọc tên)", () => {
    const kq = locNhan(
      [...ds, { khoa: "ok:3", x: 1000, y: 100, khoangCachMet: 4, hover: true }],
      { chiNhanBatThuong: true },
    );
    expect(kq.ve.map((v) => v.khoa).sort()).toEqual(["loi:1", "ok:3"]);
    // ĐỐI CHỨNG: cùng máy, không hover ⇒ bị chính sách giấu.
    const khong = locNhan([...ds, { khoa: "ok:3", x: 1000, y: 100, khoangCachMet: 4 }], { chiNhanBatThuong: true });
    expect(khong.ve.map((v) => v.khoa)).toEqual(["loi:1"]);
  });

  it("★ máy ĐANG CHỌN không bị chính sách giấu — người dùng vừa bấm vào nó", () => {
    const kq = locNhan(
      [...ds, { khoa: "ok:3", x: 1000, y: 100, khoangCachMet: 4, dangChon: true }],
      { chiNhanBatThuong: true },
    );
    expect(kq.ve.map((v) => v.khoa).sort()).toEqual(["loi:1", "ok:3"]);
  });

  it("mặc định TẮT — bật bậc này phải là quyết định tường minh của người gọi", () => {
    expect(locNhan(ds).ve.length).toBe(3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 35 (Pareto #5) — VÙNG CẤM DOM · HỘP TRỌN TRONG CANVAS · SỰ CỐ NGOÀI KHUNG */
/* ══════════════════════════════════════════════════════════════════════════ */
/*
 * QA Đợt 32: nhãn máy nằm DƯỚI Metrics/panel (che 72–100 %) mà `__demNhan.ve`
 * vẫn đếm là "hiện"; nhãn neo lệch tới ±10 % ngoài mép vẫn vẽ (cắt nửa tên);
 * andon `raised` trên máy ngoài khung ⇒ không dấu hiệu nào. Ba luật mới của
 * `locNhan` — thuần, đo bằng GIÁ TRỊ.
 */
const nhan35 = (khoa: string, x: number, y: number, tuy: Partial<NhanUngVien> = {}): NhanUngVien => ({
  khoa, x, y, khoangCachMet: 5, rongPx: 150, caoPx: 22, ...tuy,
});

describe("★★★ Đợt 35 — VÙNG CẤM (lớp phủ DOM): nhãn dưới Metrics/panel KHÔNG vẽ", () => {
  /** ≈ `bang-kpi-noi` 208×220 ở góc trái trên, quy về gốc canvas. */
  const CAM = [{ trai: 8, phai: 216, tren: 8, duoi: 228 }];

  it("hộp nhãn giao vùng cấm ⇒ bỏ, đếm `soBiChe` VÀ `soBiGiau`; nhãn ngoài vùng vẫn vẽ", () => {
    const kq = locNhan([nhan35("a", 100, 100), nhan35("b", 600, 300)], { vungCam: CAM });
    expect(kq.ve.map((v) => v.khoa)).toEqual(["b"]);
    expect(kq.soBiChe).toBe(1);
    expect(kq.soBiGiau).toBe(1);
    expect(kq.soBiChongLap).toBe(0);
  });

  it("★ nhãn bị che KHÔNG chiếm suất và KHÔNG giữ chỗ giết nhãn khác — cửa che chạy TRƯỚC khử chồng/trần", () => {
    // a (ưu tiên cao, gần) đè lên vùng cấm; c ngoài vùng cấm nhưng CHỒNG hộp với a.
    const a = nhan35("a", 200, 100, { khoangCachMet: 1 }); // hộp [125..275]×[78..100] — giao CAM (phai 216 > 125)
    const c = nhan35("c", 330, 100, { khoangCachMet: 9 }); // hộp [255..405] — chồng a (255 < 275), ngoài CAM
    const kq = locNhan([a, c], { vungCam: CAM, tranNhan: 1 });
    expect(kq.ve.map((v) => v.khoa)).toEqual(["c"]);
    expect(kq.soBiChe).toBe(1);
    expect(kq.soBiChongLap).toBe(0);
    expect(kq.soVuotTran).toBe(0);
  });

  it("chạm MÉP vùng cấm không tính là che — cùng luật `<` của khử chồng", () => {
    // hộp [216..366]: `trai` = 216 = CAM.phai ⇒ không giao.
    const kq = locNhan([nhan35("a", 291, 100)], { vungCam: CAM });
    expect(kq.ve.map((v) => v.khoa)).toEqual(["a"]);
    expect(kq.soBiChe).toBe(0);
  });

  it("không truyền `vungCam` ⇒ `soBiChe = 0`, `soVuotMep = 0`, kết quả Y HỆT bản cũ (tương thích ngược)", () => {
    const ds = nhanRoiNhau(40);
    const cu = locNhan(ds);
    const moi = locNhan(ds, { vungCam: [], khungCanvas: undefined });
    expect(moi.ve).toEqual(cu.ve);
    expect(cu.soBiChe).toBe(0);
    expect(cu.soVuotMep).toBe(0);
    expect(cu.soBatThuongNgoaiKhung).toBe(0);
  });

  it("★ HẬU ĐIỀU KIỆN: không hộp nào trong `ve` giao BẤT KỲ vùng cấm nào (quét 60 nhãn lưới, 2 vùng cấm)", () => {
    const cam = [CAM[0], { trai: 700, phai: 1000, tren: 0, duoi: 600 }];
    const ds = Array.from({ length: 60 }, (_, i) => nhan35(`m:${i}`, (i % 10) * 110 + 40, Math.floor(i / 10) * 60 + 30));
    const kq = locNhan(ds, { vungCam: cam });
    for (const v of kq.ve) for (const c of cam) expect(haiHopChongNhau(v.hop, c), v.khoa).toBe(false);
    expect(kq.soBiChe).toBeGreaterThan(0);
    expect(kq.soBiGiau).toBe(kq.soBiChe + kq.soBiChongLap + kq.soVuotTran + kq.soNgoaiKhung + kq.soVuotMep);
  });
});

describe("★★★ Đợt 35 — hộp nhãn phải TRỌN trong canvas (bỏ biên ±10 %)", () => {
  const KHUNG = { rong: 1000, cao: 600 };

  it("neo TRONG nhưng hộp thò mép trái / mép trên ⇒ `soVuotMep`, không vẽ; neo giữa ⇒ vẽ", () => {
    const kq = locNhan(
      [nhan35("trai", 30, 100), nhan35("tren", 500, 10), nhan35("giua", 500, 300)],
      { khungCanvas: KHUNG },
    );
    expect(kq.ve.map((v) => v.khoa)).toEqual(["giua"]);
    expect(kq.soVuotMep).toBe(2);
    expect(kq.soBiGiau).toBe(2);
    expect(kq.soNgoaiKhung).toBe(0);
  });

  it("`hopTrongKhung`: chạm mép được tính là TRONG (trai = 0, phai = rộng)", () => {
    expect(hopTrongKhung({ trai: 0, phai: 1000, tren: 0, duoi: 600 }, KHUNG)).toBe(true);
    expect(hopTrongKhung({ trai: -0.5, phai: 100, tren: 0, duoi: 22 }, KHUNG)).toBe(false);
    expect(hopTrongKhung({ trai: 900, phai: 1000.5, tren: 0, duoi: 22 }, KHUNG)).toBe(false);
    expect(hopTrongKhung({ trai: 0, phai: 100, tren: 590, duoi: 601 }, KHUNG)).toBe(false);
  });

  it("neo NGOÀI canvas là cờ `ngoaiKhung` của người gọi ⇒ `soNgoaiKhung`, KHÔNG phải `soVuotMep`", () => {
    const kq = locNhan([nhan35("ngoai", -50, 100, { ngoaiKhung: true }), nhan35("giua", 500, 300)], { khungCanvas: KHUNG });
    expect(kq.soNgoaiKhung).toBe(1);
    expect(kq.soVuotMep).toBe(0);
    expect(kq.ve.map((v) => v.khoa)).toEqual(["giua"]);
  });

  it("không truyền `khungCanvas` ⇒ không cull theo hộp (hành vi cũ)", () => {
    const kq = locNhan([nhan35("trai", 30, 100)]);
    expect(kq.ve.map((v) => v.khoa)).toEqual(["trai"]);
    expect(kq.soVuotMep).toBe(0);
  });
});

describe("★★★ Đợt 35 — SỰ CỐ NGOÀI KHUNG NHÌN: đếm máy bất thường bị cull, KHÔNG đếm máy bị che", () => {
  it("2 bất thường ngoài khung + 1 bất thường trong + 1 thường ngoài ⇒ 2", () => {
    const kq = locNhan([
      nhan35("a", 0, 0, { ngoaiKhung: true, batThuong: true }),
      nhan35("b", 0, 0, { ngoaiKhung: true, batThuong: true }),
      nhan35("c", 500, 300, { batThuong: true }),
      nhan35("d", 0, 0, { ngoaiKhung: true }),
    ]);
    expect(kq.soBatThuongNgoaiKhung).toBe(2);
    expect(kq.soNgoaiKhung).toBe(3);
    expect(kq.ve.map((v) => v.khoa)).toEqual(["c"]);
  });

  it("bất thường DƯỚI vùng cấm ⇒ KHÔNG đếm là ngoài khung (máy vẫn trong khung, badge 3D vẫn hiện)", () => {
    const kq = locNhan([nhan35("a", 100, 100, { batThuong: true })], { vungCam: [{ trai: 8, phai: 216, tren: 8, duoi: 228 }] });
    expect(kq.soBiChe).toBe(1);
    expect(kq.soBatThuongNgoaiKhung).toBe(0);
  });

  it("0 ngoài khung ⇒ 0; và số này KHÔNG bị `chiNhanBatThuong` hay trần làm đổi", () => {
    const ds = [nhan35("a", 0, 0, { ngoaiKhung: true, batThuong: true }), ...nhanRoiNhau(50)];
    expect(locNhan(nhanRoiNhau(5)).soBatThuongNgoaiKhung).toBe(0);
    expect(locNhan(ds, { chiNhanBatThuong: true, tranNhan: 3 }).soBatThuongNgoaiKhung).toBe(1);
  });
});

describe("★★★ Đợt 35 — XẾP TẦNG nhãn chồng (đẩy lên ≤ TANG_NHAN_TOI_DA tầng trước khi bỏ)", () => {
  const CAO = 22;
  /** Bật `xepTang` như `LopNhan` — mặc định của kit vẫn là luật 3 "chồng ⇒ bỏ" (9 ca phía trên ghim). */
  const locXT = (ds: NhanUngVien[], cfg: Parameters<typeof locNhan>[1] = {}) => locNhan(ds, { xepTang: true, ...cfg });
  it("hai nhãn cùng chỗ ⇒ cái ưu tiên cao ở tầng 0, cái kia ĐẨY LÊN tầng 1 (y − (cao + khe)), KHÔNG bị bỏ", () => {
    const kq = locXT([nhan35("a", 300, 200, { khoangCachMet: 1, caoPx: CAO }), nhan35("b", 300, 200, { khoangCachMet: 9, caoPx: CAO })]);
    expect(kq.ve.map((v) => [v.khoa, v.tang, v.y])).toEqual([["a", 0, 200], ["b", 1, 200 - (CAO + KHE_TANG_PX)]]);
    expect(kq.soBiChongLap).toBe(0);
    expect(demCapChongLap(kq.ve.map((v) => ({ x: v.x, y: v.y, rongPx: 150, caoPx: CAO })))).toBe(0);
  });
  it("bốn nhãn cùng chỗ ⇒ tầng 0,1,2 vẽ; cái thứ tư HẾT tầng ⇒ `soBiChongLap`", () => {
    const ds = ["a", "b", "c", "d"].map((k, i) => nhan35(k, 300, 200, { khoangCachMet: 1 + i, caoPx: CAO }));
    const kq = locXT(ds);
    expect(kq.ve.map((v) => v.tang)).toEqual([0, 1, 2]);
    expect(kq.soBiChongLap).toBe(1);
    expect(TANG_NHAN_TOI_DA).toBe(2);
  });
  it("tầng đẩy lên KHÔNG được thò mép trên canvas, KHÔNG được chui dưới vùng cấm ⇒ khi ấy bỏ", () => {
    const KHUNG = { rong: 1000, cao: 600 };
    // neo y=30: hộp [8..30]; tầng 1 ⇒ [−16..6] thò mép ⇒ bỏ.
    const sat = locXT([nhan35("a", 300, 30, { khoangCachMet: 1 }), nhan35("b", 300, 30, { khoangCachMet: 9 })], { khungCanvas: KHUNG });
    expect(sat.ve.map((v) => v.khoa)).toEqual(["a"]);
    expect(sat.soBiChongLap).toBe(1);
    // vùng cấm ngay trên neo: tầng 1 chui vào vùng cấm ⇒ bỏ.
    const cam = [{ trai: 0, phai: 1000, tren: 100, duoi: 250 }];
    const duoiCam = locXT([nhan35("a", 300, 290, { khoangCachMet: 1 }), nhan35("b", 300, 290, { khoangCachMet: 9 })], { vungCam: cam });
    expect(duoiCam.ve.map((v) => v.khoa)).toEqual(["a"]);
  });
  it("★ CA HỒI QUY E4: 12 nóc máy gần cùng hàng ngang, cách 95 px, nhãn 150 px ⇒ ≥ 10/12 vẽ (trước: 5/12)", () => {
    const ds = Array.from({ length: 12 }, (_, i) => nhan35(`m${i}`, 150 + i * 95, 400, { khoangCachMet: 20 + i }));
    const kq = locXT(ds, { khungCanvas: { rong: 1288, cao: 683 } });
    expect(kq.ve.length).toBeGreaterThanOrEqual(10);
    expect(kq.ve.filter((v) => v.tang > 0).length).toBeGreaterThan(0);
    expect(demCapChongLap(kq.ve.map((v) => ({ x: v.x, y: v.y, rongPx: 150, caoPx: 22 })))).toBe(0);
    for (const v of kq.ve) expect(hopTrongKhung(v.hop, { rong: 1288, cao: 683 })).toBe(true);
  });
  it("tất định: đảo thứ tự đầu vào ⇒ cùng tầng cho cùng khoá", () => {
    const ds = ["a", "b", "c"].map((k, i) => nhan35(k, 300, 200, { khoangCachMet: 1 + i }));
    const x = locXT(ds).ve.map((v) => `${v.khoa}:${v.tang}`);
    const y = locXT([...ds].reverse()).ve.map((v) => `${v.khoa}:${v.tang}`);
    expect(x).toEqual(y);
  });
});

describe("★ Đợt 35 — `xepTang` mặc định TẮT: luật 3 cũ nguyên vẹn cho người gọi không bật", () => {
  it("hai nhãn cùng chỗ, không bật ⇒ cái ưu tiên thấp bị BỎ (soBiChongLap 1), tang luôn 0", () => {
    const kq = locNhan([nhan35("a", 300, 200, { khoangCachMet: 1 }), nhan35("b", 300, 200, { khoangCachMet: 9 })]);
    expect(kq.ve.map((v) => [v.khoa, v.tang])).toEqual([["a", 0]]);
    expect(kq.soBiChongLap).toBe(1);
  });
});

/* ★★★ Đợt 38 (Pareto #7 QA Đợt 37) — nhãn chưa đo: ước lượng theo CHỮ, không phải 150 px của nhãn cũ */
describe("uocLuongRongNhanPx — cận trên nhẹ của bề rộng thật (đo 11 nhãn @1280, .qa-dot38/sau/p7-*)", () => {
  const DO_THAT: Array<[string, number]> = [
    ["SIM-L2-CONVEYOR · Unknown", 191], ["SIM-L2-ROBOT · Unknown", 166], ["SIM-L2-FCT · Unknown", 147],
    ["CONVEYOR · Unknown", 144], ["SCREW · Unknown", 122], ["ROBOT · Unknown", 119], ["PACK · Unknown", 110],
    ["PWR · Unknown", 105], ["FCT · Unknown", 101], ["AOI · Unknown", 99], ["ICT · Unknown", 97],
  ];
  it("★★★ không bao giờ HẸP hơn thật (hẹp ⇒ hai nhãn đè nhau), và không rộng hơn thật quá 15 %", () => {
    for (const [chu, that] of DO_THAT) {
      const uoc = uocLuongRongNhanPx(chu);
      expect(uoc, chu).toBeGreaterThanOrEqual(that);
      expect(uoc, chu).toBeLessThanOrEqual(Math.round(that * 1.15));
    }
  });
  it("★★★ CA GỐC RỄ @1280 (.qa-dot38/sau/vung-cam-1280.json): hàng nhãn ngay DƯỚI panel Metrics ⇒ chỉ đẩy LÊN thì giấu; `xepTangXuong` ⇒ 12/12", () => {
    // 12 nóc máy cách ~61 px, neo (đáy nhãn) y=257 ⇒ hộp t0 [233..257]; vùng cấm THẬT: Metrics [8..254]×[8..228], Mô phỏng [720..960]×[8..36].
    const CHU = ["SPI", "AOI", "AVI", "ICT", "FCT", "CONVEYOR", "PWR", "ASSY", "SCREW", "PACK", "ROBOT", "AGV"].map((m) => `${m} · Unknown`);
    const KHUNG = { rong: 968, cao: 479 };
    const VUNG_CAM = [{ trai: 8, phai: 254, tren: 8, duoi: 228 }, { trai: 720, phai: 960, tren: 8, duoi: 36 }];
    const ds = () => CHU.map((c, i) => nhan35(`m${i}`, 150 + i * 61, 257, { khoangCachMet: 20 + i, rongPx: uocLuongRongNhanPx(c), caoPx: 24 }));
    // Chỉ LÊN (hợp đồng Đợt 35): nhãn bên trái không có tầng nào phía trên ⇒ bị giấu — đúng "3 more names hidden" QA/Đợt 38 đo.
    const len = locNhan(ds(), { xepTang: true, khungCanvas: KHUNG, vungCam: VUNG_CAM });
    expect(len.soBiChongLap).toBeGreaterThan(0);
    expect(len.ve.every((v) => v.tang >= 0)).toBe(true);
    // LÊN rồi XUỐNG: 12/12, có nhãn tầng âm, 0 cặp chồng, mọi hộp trong canvas và ngoài vùng cấm.
    const xuong = locNhan(ds(), { xepTang: true, xepTangXuong: true, khungCanvas: KHUNG, vungCam: VUNG_CAM });
    expect(xuong.ve.length).toBe(12);
    expect(xuong.soBiChongLap).toBe(0);
    expect(xuong.ve.some((v) => v.tang < 0)).toBe(true);
    expect(demCapChongLap(xuong.ve.map((v) => ({ x: v.x, y: v.y, rongPx: uocLuongRongNhanPx(CHU[Number(v.khoa.slice(1))]), caoPx: 24 })))).toBe(0);
    for (const v of xuong.ve) {
      expect(hopTrongKhung(v.hop, KHUNG)).toBe(true);
      for (const c of VUNG_CAM) expect(haiHopChongNhau(c, v.hop)).toBe(false);
      // hộp trả về khớp với y đã cộng tầng (tầng âm ⇒ y lớn hơn neo)
      expect(v.hop.duoi).toBe(v.y);
    }
  });
  it("★ `xepTangXuong` KHÔNG có nghĩa khi `xepTang` tắt; và tầng xuống cũng phải nằm TRỌN trong canvas", () => {
    const hai = [nhan35("a", 300, 200, { khoangCachMet: 1 }), nhan35("b", 300, 200, { khoangCachMet: 9 })];
    const tat = locNhan(hai, { xepTangXuong: true });
    expect(tat.ve.map((v) => [v.khoa, v.tang])).toEqual([["a", 0]]);
    // neo y = 595 trên canvas cao 600: tầng −1 ⇒ đáy 619 thò mép dưới ⇒ bỏ (trên: t1/t2 vẫn được nếu trống)
    const satDay = locNhan([nhan35("a", 300, 595, { khoangCachMet: 1 }), nhan35("b", 300, 595, { khoangCachMet: 9 }), nhan35("c", 300, 595, { khoangCachMet: 10 }), nhan35("d", 300, 595, { khoangCachMet: 11 })], { xepTang: true, xepTangXuong: true, khungCanvas: { rong: 1000, cao: 600 } });
    expect(satDay.ve.map((v) => v.tang)).toEqual([0, 1, 2]);
    expect(satDay.soBiChongLap).toBe(1);
  });
  it("★ `LopNhan` bật `xepTang` + `xepTangXuong` — kit dùng ĐÚNG hai cờ (G16)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const lop = readFileSync(resolve(__dirname, "LopNhan.tsx"), "utf8");
    expect(lop).toContain("xepTang: true,");
    expect(lop).toContain("xepTangXuong: true,");
  });
  it("kích thước kit không đổi: TANG_NHAN_TOI_DA = 2 (3 hàng) và RONG_SUY_DOAN_PX = 150 vẫn là mặc định khi không ước lượng", () => {
    expect(TANG_NHAN_TOI_DA).toBe(2);
    expect(RONG_SUY_DOAN_PX).toBe(150);
  });
});

