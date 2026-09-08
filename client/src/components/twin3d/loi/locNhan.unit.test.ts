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
