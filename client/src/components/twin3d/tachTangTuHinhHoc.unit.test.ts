/**
 * tachTangTuHinhHoc.unit.test.ts — Test cho §10A.3.
 *
 * ★★★ TÊN TỆP `.unit.test.ts` — xem lý do ở đầu `boCucTang.unit.test.ts`.
 *
 * Trục kiểm:
 *   1. Khoảng trống > 0,5 m thành ranh giới; ≤ 0,5 m thì KHÔNG.
 *   2. Kết quả là GỢI Ý (`laGoiY=true`), và ranh giới người dùng chốt thì không.
 *   3. Tất định: đảo thứ tự node vào ⇒ kết quả không đổi.
 *   4. "Không tách được" KHÁC "tách ra một tầng" (NT-3).
 *   5. Gộp cụm xuống dưới (bỏ tích mái) đúng.
 */

import { describe, expect, it } from "vitest";
import {
  apDungRanhGioi,
  cumTangSangDongNhap,
  deNghiTachTang,
  gopCumXuongDuoi,
  NGUONG_KHOANG_TRONG_MM,
  type NodeHinhHoc,
} from "./tachTangTuHinhHoc";

/** Node dạng tấm ngang tại cao độ [duoiMm, trenMm]; mặt bằng không ảnh hưởng. */
function node(ten: string, duoiMm: number, trenMm: number, soTamGiac = 100): NodeHinhHoc {
  return {
    ten,
    bbox: { minX: 0, maxX: 10_000, minY: duoiMm, maxY: trenMm, minZ: 0, maxZ: 10_000 },
    soTamGiac,
  };
}

/** Ba cụm như ví dụ §10A.3: 0–6,2 m · 6,3–10,8 m · 10,9–12,4 m. */
const BA_TANG: NodeHinhHoc[] = [
  node("tang1", 0, 6200, 12_408),
  node("tang2", 6300, 10_800, 9117),
  node("mai", 10_900, 12_400, 2043),
];

describe("deNghiTachTang — chiếu bbox lên trục cao (§10A.3)", () => {
  it("khoảng trống rộng chia ba cụm đúng như ví dụ spec", () => {
    // Khoảng trống 6200→6300 chỉ 100 mm — DƯỚI ngưỡng 500. Dùng khe rộng thật.
    const rong: NodeHinhHoc[] = [
      node("tang1", 0, 6000, 12_408),
      node("tang2", 6600, 10_800, 9117),
      node("mai", 11_500, 12_400, 2043),
    ];
    const kq = deNghiTachTang(rong);
    expect(kq.cum).toHaveLength(3);
    expect(kq.cum.map((c) => [c.duoiMm, c.trenMm])).toEqual([
      [0, 6000],
      [6600, 10_800],
      [11_500, 12_400],
    ]);
  });

  it("★ khe ĐÚNG BẰNG ngưỡng 500 mm KHÔNG tách (phải LỚN HƠN)", () => {
    const kq = deNghiTachTang([node("a", 0, 3000), node("b", 3500, 6000)]);
    expect(kq.cum).toHaveLength(1);
    expect(kq.khongTachDuoc).toBe(true);
  });

  it("★ khe 501 mm THÌ tách — ngưỡng nằm đúng chỗ nó khai", () => {
    const kq = deNghiTachTang([node("a", 0, 3000), node("b", 3501, 6000)]);
    expect(kq.cum).toHaveLength(2);
    expect(NGUONG_KHOANG_TRONG_MM).toBe(500);
  });

  it("ranh giới đặt ở GIỮA khoảng trống", () => {
    const kq = deNghiTachTang([node("a", 0, 3000), node("b", 5000, 8000)]);
    expect(kq.ranhGioiMm).toEqual([4000]);
  });

  it("số ranh giới luôn bằng số cụm trừ một", () => {
    const kq = deNghiTachTang([
      node("a", 0, 1000),
      node("b", 2000, 3000),
      node("c", 4000, 5000),
      node("d", 6000, 7000),
    ]);
    expect(kq.cum).toHaveLength(4);
    expect(kq.ranhGioiMm).toHaveLength(3);
  });

  it("★ mọi cụm máy tìm ra mang laGoiY=true — chưa ai xác nhận (NT-4)", () => {
    expect(deNghiTachTang(BA_TANG).cum.every((c) => c.laGoiY)).toBe(true);
  });

  it("★ TẤT ĐỊNH: đảo thứ tự node vào cho ra kết quả y hệt", () => {
    const xuoi = deNghiTachTang([
      node("a", 0, 3000),
      node("b", 5000, 8000),
      node("c", 10_000, 12_000),
    ]);
    const nguoc = deNghiTachTang([
      node("c", 10_000, 12_000),
      node("b", 5000, 8000),
      node("a", 0, 3000),
    ]);
    expect(nguoc).toEqual(xuoi);
  });

  it("node CHỒNG NHAU trong cùng tầng gộp làm một cụm", () => {
    const kq = deNghiTachTang([
      node("may1", 0, 2000),
      node("may2", 1500, 3500),
      node("may3", 3400, 4000),
    ]);
    expect(kq.cum).toHaveLength(1);
    expect(kq.cum[0].trenMm).toBe(4000);
    expect(kq.cum[0].tenNode).toEqual(["may1", "may2", "may3"]);
  });

  it("★ node CỘT suốt hai tầng dán liền hai cụm — không có ranh giới nào", () => {
    // Đây là hành vi ĐÚNG của thuật toán khoảng-trống, và là lý do §10A.3 gọi
    // kết quả là GỢI Ý: cột thông tầng bịt mất khe, người dùng phải sửa tay.
    const kq = deNghiTachTang([
      node("tang1", 0, 6000),
      node("cot", 0, 12_000),
      node("tang2", 6600, 12_000),
    ]);
    expect(kq.cum).toHaveLength(1);
    expect(kq.khongTachDuoc).toBe(true);
  });

  it("số tam giác cộng dồn theo cụm", () => {
    const rong: NodeHinhHoc[] = [
      node("a", 0, 1000, 500),
      node("b", 900, 2000, 700),
      node("c", 5000, 6000, 300),
    ];
    const kq = deNghiTachTang(rong);
    expect(kq.cum.map((c) => c.soTamGiac)).toEqual([1200, 300]);
  });

  it("★ 0 node ⇒ khongTachDuoc, KHÔNG dựng một tầng rỗng (NT-3)", () => {
    const kq = deNghiTachTang([]);
    expect(kq.cum).toEqual([]);
    expect(kq.khongTachDuoc).toBe(true);
  });

  it("★ một cụm duy nhất ⇒ khongTachDuoc=true, không phải kết luận một tầng", () => {
    const kq = deNghiTachTang([node("chi-mot", 0, 6000)]);
    expect(kq.cum).toHaveLength(1);
    expect(kq.khongTachDuoc).toBe(true);
  });

  it("node có bbox suy biến (minY > maxY hoặc NaN) bị bỏ, không làm hỏng cả lượt", () => {
    const xau: NodeHinhHoc = {
      ten: "hong",
      bbox: { minX: 0, maxX: 1, minY: NaN, maxY: NaN, minZ: 0, maxZ: 1 },
      soTamGiac: 9,
    };
    const kq = deNghiTachTang([node("a", 0, 1000), xau, node("b", 5000, 6000)]);
    expect(kq.cum).toHaveLength(2);
    expect(kq.cum.flatMap((c) => c.tenNode)).not.toContain("hong");
  });

  it("khoảng cao tổng phủ từ đáy cụm đầu tới đỉnh cụm cuối", () => {
    const kq = deNghiTachTang([node("a", 200, 1000), node("b", 5000, 6400)]);
    expect(kq.duoiMm).toBe(200);
    expect(kq.trenMm).toBe(6400);
  });
});

describe("apDungRanhGioi — ranh giới NGƯỜI DÙNG chốt (§10A.3)", () => {
  it("★ cụm áp từ ranh giới người dùng mang laGoiY=false", () => {
    const cum = apDungRanhGioi(BA_TANG, [6250, 10_850]);
    expect(cum.every((c) => !c.laGoiY)).toBe(true);
  });

  it("chia đúng số cụm = số ranh giới + 1", () => {
    expect(apDungRanhGioi(BA_TANG, [6250, 10_850])).toHaveLength(3);
    expect(apDungRanhGioi(BA_TANG, [6250])).toHaveLength(2);
  });

  it("★ người dùng ép ranh giới ở chỗ máy KHÔNG tìm ra vẫn tách được", () => {
    // Khối liền 0–12 m, không khe nào; người dùng biết đó là hai tầng.
    const lien = [node("duoi", 0, 5900), node("tren", 5900, 12_000)];
    expect(deNghiTachTang(lien).khongTachDuoc).toBe(true);
    const cum = apDungRanhGioi(lien, [5900]);
    expect(cum).toHaveLength(2);
    expect(cum[0].tenNode).toEqual(["duoi"]);
    expect(cum[1].tenNode).toEqual(["tren"]);
  });

  it("★ node bị ranh giới CẮT NGANG xếp theo TÂM của nó", () => {
    // Cột 0–12 m có tâm 6000 > ranh giới 5000 ⇒ thuộc cụm TRÊN.
    const cum = apDungRanhGioi([node("cot", 0, 12_000)], [5000]);
    expect(cum[0].tenNode).toEqual([]);
    expect(cum[1].tenNode).toEqual(["cot"]);
  });

  it("★ cụm RỖNG vẫn được trả về — số cụm khớp số ranh giới người dùng chốt", () => {
    const cum = apDungRanhGioi([node("a", 0, 1000)], [5000, 9000]);
    expect(cum).toHaveLength(3);
    expect(cum[1].tenNode).toEqual([]);
    expect(cum[2].tenNode).toEqual([]);
  });

  it("ranh giới truyền vào lộn xộn vẫn được sắp trước khi áp", () => {
    const a = apDungRanhGioi(BA_TANG, [10_850, 6250]);
    const b = apDungRanhGioi(BA_TANG, [6250, 10_850]);
    expect(a).toEqual(b);
  });

  it("0 ranh giới ⇒ đúng một cụm chứa mọi node", () => {
    const cum = apDungRanhGioi(BA_TANG, []);
    expect(cum).toHaveLength(1);
    expect(cum[0].tenNode).toHaveLength(3);
  });
});

describe("cumTangSangDongNhap — cầu nối sang con đường B (§10A.2)", () => {
  it("mm sang MÉT đúng, capSo đánh từ 1", () => {
    const dong = cumTangSangDongNhap(
      apDungRanhGioi(BA_TANG, [6250, 10_850]),
      (n) => `Tầng ${n}`,
    );
    expect(dong.map((d) => d.capSo)).toEqual([1, 2, 3]);
    expect(dong[0].caoDoM).toBe(0);
    expect(dong[0].caoThongThuyM).toBe(6.2);
    expect(dong[1].caoDoM).toBe(6.3);
    expect(dong[1].caoThongThuyM).toBe(4.5);
  });

  it("★ nguonHinhHoc='ban_ve' — số ĐO TỪ HÌNH HỌC, khác 'sinh' và 'nhap_tay'", () => {
    const dong = cumTangSangDongNhap(apDungRanhGioi(BA_TANG, [6250]), (n) => `T${n}`);
    expect(dong.every((d) => d.nguonHinhHoc === "ban_ve")).toBe(true);
  });

  it("tên tầng lấy từ hàm gọi vào, không hằng trong module", () => {
    const dong = cumTangSangDongNhap(apDungRanhGioi(BA_TANG, [6250]), (n) => `Level ${n}`);
    expect(dong.map((d) => d.ten)).toEqual(["Level 1", "Level 2"]);
  });
});

describe("gopCumXuongDuoi — bỏ tích = gộp vào tầng dưới (§10A.3)", () => {
  const CUM = deNghiTachTang([
    node("tang1", 0, 6000, 12_408),
    node("tang2", 6600, 10_800, 9117),
    node("mai", 11_500, 12_400, 2043),
  ]).cum;

  it("gộp mái xuống tầng 2: còn 2 cụm, cụm cuối cao tới 12400", () => {
    const ket = gopCumXuongDuoi(CUM, 2);
    expect(ket).toHaveLength(2);
    expect(ket[1].trenMm).toBe(12_400);
    expect(ket[1].duoiMm).toBe(6600);
    expect(ket[1].tenNode).toEqual(["tang2", "mai"]);
    expect(ket[1].soTamGiac).toBe(9117 + 2043);
  });

  it("★ cụm sau khi gộp KHÔNG còn là gợi ý — người dùng đã quyết", () => {
    expect(gopCumXuongDuoi(CUM, 2)[1].laGoiY).toBe(false);
  });

  it("★ gộp cụm ĐẦU TIÊN không làm gì (không có cụm dưới) — không MẤT cụm", () => {
    expect(gopCumXuongDuoi(CUM, 0)).toEqual(CUM);
  });

  it("chỉ số ngoài phạm vi không làm gì, không ném", () => {
    expect(gopCumXuongDuoi(CUM, 99)).toEqual(CUM);
    expect(gopCumXuongDuoi(CUM, -1)).toEqual(CUM);
  });

  it("không sửa mảng gốc (thuần hàm)", () => {
    const truoc = JSON.parse(JSON.stringify(CUM));
    gopCumXuongDuoi(CUM, 2);
    expect(CUM).toEqual(truoc);
  });
});
