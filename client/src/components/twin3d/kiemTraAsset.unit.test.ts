/**
 * kiemTraAsset.unit.test.ts — ba bậc ngưỡng model 3D (§7.4, §10B.2).
 *
 * ★ G5/G32 — mọi ca dùng SỐ THẬT khác 0, và mỗi ca hỏi "đầu ra có KHÁC đầu vào
 *   không": ca `ok` và ca `chan` phải cho `bac` KHÁC NHAU trên cùng một hàm.
 *   Một bộ test chỉ toàn ca `ok` là bộ test không biết kêu.
 */
import { describe, expect, it } from "vitest";

import {
  NGUONG_BYTE_CHAN,
  NGUONG_LECH_BBOX,
  NGUONG_TAM_GIAC_CHAN,
  NGUONG_TAM_GIAC_OK,
  boundsTuBBox,
  chamModel,
  chamTenTep,
  duoiTep,
  laDuoiGltf,
  soLechKichThuoc,
} from "./kiemTraAsset";

const MB = 1024 * 1024;

describe("chamModel — ba bậc §10B.2", () => {
  it("12.400 tam giác / 1,8 MB (ví dụ NGUYÊN VĂN của spec) ⇒ ok, không cảnh báo", () => {
    const kq = chamModel({ soTamGiac: 12_400, soByte: Math.round(1.8 * MB) });
    expect(kq.bac).toBe("ok");
    expect(kq.lyDo).toEqual([]);
    expect(kq.goiYNen).toBe(false);
  });

  it("★ RANH GIỚI 50.000 — đúng ngưỡng là OK, 50.001 mới cảnh báo", () => {
    expect(chamModel({ soTamGiac: NGUONG_TAM_GIAC_OK, soByte: 2 * MB }).bac).toBe("ok");
    const tren = chamModel({ soTamGiac: NGUONG_TAM_GIAC_OK + 1, soByte: 2 * MB });
    expect(tren.bac).toBe("canh_bao");
    expect(tren.goiYNen).toBe(true);
    expect(tren.lyDo).toEqual(["tam_giac_cao"]);
  });

  it("★ RANH GIỚI 150.000 — đúng ngưỡng còn CẢNH BÁO, 150.001 mới CHẶN", () => {
    expect(chamModel({ soTamGiac: NGUONG_TAM_GIAC_CHAN, soByte: 2 * MB }).bac).toBe("canh_bao");
    const chan = chamModel({ soTamGiac: NGUONG_TAM_GIAC_CHAN + 1, soByte: 2 * MB });
    expect(chan.bac).toBe("chan");
    expect(chan.lyDo).toContain("tam_giac_vuot_tran");
    // Đã chặn thì KHÔNG gợi ý nén: nén xong vẫn chặn vì lý do khác thì lời gợi
    // ý đó tốn của người dùng một lượt thử.
    expect(chan.goiYNen).toBe(false);
  });

  it("★ RANH GIỚI 15 MB — đúng ngưỡng qua, hơn 1 byte thì CHẶN", () => {
    expect(chamModel({ soTamGiac: 1_000, soByte: NGUONG_BYTE_CHAN }).bac).toBe("ok");
    const chan = chamModel({ soTamGiac: 1_000, soByte: NGUONG_BYTE_CHAN + 1 });
    expect(chan.bac).toBe("chan");
    expect(chan.lyDo).toEqual(["dung_luong_vuot_tran"]);
  });

  it("★★★ VI PHẠM CẢ HAI ⇒ trả VỀ CẢ HAI lý do, không dừng ở lý do đầu", () => {
    const kq = chamModel({ soTamGiac: 400_000, soByte: 40 * MB });
    expect(kq.bac).toBe("chan");
    expect(kq.lyDo).toContain("dung_luong_vuot_tran");
    expect(kq.lyDo).toContain("tam_giac_vuot_tran");
    expect(kq.lyDo).toHaveLength(2);
  });

  it("tệp 0 byte ⇒ chặn với lý do RIÊNG (không phải 'dung lượng vượt trần')", () => {
    const kq = chamModel({ soTamGiac: 0, soByte: 0 });
    expect(kq.bac).toBe("chan");
    expect(kq.lyDo).toEqual(["tep_rong"]);
  });

  it("ba bậc CHO RA BA KẾT QUẢ KHÁC NHAU trên cùng một hàm (đối chứng G5)", () => {
    const bac = [
      chamModel({ soTamGiac: 10_000, soByte: MB }).bac,
      chamModel({ soTamGiac: 90_000, soByte: MB }).bac,
      chamModel({ soTamGiac: 900_000, soByte: MB }).bac,
    ];
    expect(new Set(bac).size).toBe(3);
    expect(bac).toEqual(["ok", "canh_bao", "chan"]);
  });
});

describe("đuôi tệp — .svg CỐ Ý bị từ chối (§10B.2)", () => {
  it("nhận .glb và .gltf, KHÔNG phân biệt hoa thường", () => {
    expect(laDuoiGltf("aoi-machine.glb")).toBe(true);
    expect(laDuoiGltf("AOI-MACHINE.GLTF")).toBe(true);
    expect(chamTenTep("aoi-machine.glb")).toBeNull();
  });

  it("★ .svg bị CHẶN — SVG là ảnh 2D, không có chiều sâu", () => {
    const kq = chamTenTep("bieu-tuong.svg");
    expect(kq?.bac).toBe("chan");
    expect(kq?.lyDo).toEqual(["duoi_tep_khong_nhan"]);
  });

  it(".step KHÔNG nạp thẳng được (phải qua occtWorker trước)", () => {
    expect(laDuoiGltf("Cube 10x10.stp")).toBe(false);
    expect(chamTenTep("Cube 10x10.stp")?.bac).toBe("chan");
  });

  it("tên tệp không có dấu chấm ⇒ đuôi rỗng, bị chặn", () => {
    expect(duoiTep("khongcoduoi")).toBe("");
    expect(chamTenTep("khongcoduoi")?.bac).toBe("chan");
  });
});

describe("soLechKichThuoc — hai ví dụ NGUYÊN VĂN mà Đợt 2 đã khoá bằng test", () => {
  const khai = { rongMm: 1400, caoMm: 1900, sauMm: 1200 };

  it("★ model cao 2,9 m / khai 1,9 m ⇒ 52,6 % ⇒ VƯỢT ngưỡng 30 %", () => {
    const kq = soLechKichThuoc({ rongMm: 1400, caoMm: 2900, sauMm: 1200 }, khai);
    expect(kq.vuotNguong).toBe(true);
    expect(kq.chieu).toBe("cao");
    expect(kq.lechLonNhat).toBeCloseTo(0.5263, 3);
  });

  it("★ model cao 2,4 m / khai 1,9 m ⇒ 26,3 % ⇒ KHÔNG vượt (ví dụ cũ của spec)", () => {
    const kq = soLechKichThuoc({ rongMm: 1400, caoMm: 2400, sauMm: 1200 }, khai);
    expect(kq.vuotNguong).toBe(false);
    expect(kq.lechLonNhat).toBeCloseTo(0.2632, 3);
  });

  it("★★★ MẪU SỐ LÀ SỐ KHAI BÁO — đảo hai đối số cho tỉ lệ KHÁC", () => {
    const xuoi = soLechKichThuoc({ rongMm: 1400, caoMm: 2900, sauMm: 1200 }, khai);
    const nguoc = soLechKichThuoc(khai, { rongMm: 1400, caoMm: 2900, sauMm: 1200 });
    expect(xuoi.lechLonNhat).not.toBeCloseTo(nguoc.lechLonNhat, 3);
    expect(nguoc.lechLonNhat).toBeCloseTo(0.3448, 3);
  });

  it("khai báo = 0 (chưa ai đo máy) ⇒ KHÔNG so được, không phải 'lệch vô hạn'", () => {
    const kq = soLechKichThuoc(
      { rongMm: 1400, caoMm: 1900, sauMm: 1200 },
      { rongMm: 0, caoMm: 0, sauMm: 0 },
    );
    expect(kq.vuotNguong).toBe(false);
    expect(kq.lechLonNhat).toBe(0);
    expect(kq.chieu).toBeNull();
    expect(Number.isFinite(kq.lechLonNhat)).toBe(true);
  });

  it("khớp hoàn hảo ⇒ lệch 0", () => {
    expect(soLechKichThuoc(khai, khai).lechLonNhat).toBe(0);
  });

  it("ngưỡng truyền vào ĐỔI được kết luận (chỉ báo biết kêu)", () => {
    const bbox = { rongMm: 1400, caoMm: 2400, sauMm: 1200 };
    expect(soLechKichThuoc(bbox, khai, NGUONG_LECH_BBOX).vuotNguong).toBe(false);
    expect(soLechKichThuoc(bbox, khai, 0.2).vuotNguong).toBe(true);
  });
});

describe("boundsTuBBox — mang cả GỐC, không chỉ kích thước", () => {
  it("giữ nguyên min/max để phát hiện model có tâm lệch khỏi gốc", () => {
    const b = boundsTuBBox({ min: [-700, 0, -600], max: [700, 1900, 600] });
    expect(b).toEqual({ min: [-700, 0, -600], max: [700, 1900, 600] });
    // {w,h,d} sẽ mất thông tin này: hai model dưới đây cùng kích thước nhưng
    // một cái chìm nửa dưới sàn.
    const chim = boundsTuBBox({ min: [-700, -950, -600], max: [700, 950, 600] });
    expect(chim).not.toEqual(b);
  });
});
