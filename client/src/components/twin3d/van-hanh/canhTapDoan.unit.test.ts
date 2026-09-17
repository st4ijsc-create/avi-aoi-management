/**
 * canhTapDoan.unit.test.ts — Task 19, Giai đoạn 6.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI CHIỀU CỦA MỘT CÂU — VÀ VÌ SAO CHIỀU "MỘT KHỐI" KHÔNG ĐỨNG MỘT MÌNH
 * ════════════════════════════════════════════════════════════════════════════
 * Nghiệm thu của thiết kế (§9) có hai ô: **N1** vai cấp tập đoàn ⇒ *ba* cụm
 * khối; **N2** vai chỉ được gán một nhà máy ⇒ *một* cụm. Chỉ đo N2 là vô nghĩa:
 * "một cụm" cũng đúng là kết quả khi tính năng gộp **chưa bật** — nó chứng minh
 * mã chưa chạy, không chứng minh hàng rào chạy đúng (G139: một số 0 chỉ có nghĩa
 * khi kèm ablation trên nền đã chứng minh). Nên mọi ô dưới đây đi theo CẶP, và
 * mỗi ô khẳng định **kích thước đầu vào TRƯỚC** khi khẳng định kết cục (G5: cấm
 * ca xanh trên tập rỗng).
 *
 * ⚠ Số liệu dùng ở đây là số ĐO ĐƯỢC của bộ dữ liệu QATD, không phải số tròn
 *   tiện tay: 3 công ty · 12 toà (4 mỗi công ty) · 7 tầng mỗi toà · bước cụm
 *   1.000.000 mm do `.qa-tapdoan/sinh-tap-doan.mjs` nướng vào `twin_toa_nha`.
 */

import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docMaNguon } from "@shared/testing/docMaNguon";

import {
  BIEU_TUONG_CAO_TOI_THIEU_MM,
  BIEU_TUONG_TOI_THIEU_MM,
  KHE_GIUA_CUM_TOI_THIEU_LAN,
  KHE_HO_KHOI_MM,
  TRAN_NHA_MAY_MOT_LUOT,
  khuonVienTapDoan,
  nhaMayDeNap,
  saBanTapDoan,
  type ToaNhaKhuonVien,
} from "./canhTapDoan";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Giáo cụ — hình dạng THẬT của QATD, không phải một mô hình tiện tay          */
/* ═══════════════════════════════════════════════════════════════════════════ */

const TOA_RONG_MM = 120_000;
const TOA_SAU_MM = 90_000;
const BUOC_CUM_MM = 1_000_000;

/** Bốn toà của một công ty: lưới 2×2 bước 130.000 × 100.000 mm, gốc `xGoc`. */
function toaCuaCongTy(factoryId: number, idDau: number, xGoc: number): ToaNhaKhuonVien[] {
  return [
    { id: idDau, factoryId, viTriXMm: xGoc, viTriYMm: 0, viTriZMm: 0, rongMm: TOA_RONG_MM, sauMm: TOA_SAU_MM },
    { id: idDau + 1, factoryId, viTriXMm: xGoc + 130_000, viTriYMm: 0, viTriZMm: 0, rongMm: TOA_RONG_MM, sauMm: TOA_SAU_MM },
    { id: idDau + 2, factoryId, viTriXMm: xGoc, viTriYMm: 100_000, viTriZMm: 0, rongMm: TOA_RONG_MM, sauMm: TOA_SAU_MM },
    { id: idDau + 3, factoryId, viTriXMm: xGoc + 130_000, viTriYMm: 100_000, viTriZMm: 0, rongMm: TOA_RONG_MM, sauMm: TOA_SAU_MM },
  ];
}

/** 12 toà của ba công ty QATD, đúng bước cụm 1 km mà bộ sinh dùng. */
const TOA_QATD: ToaNhaKhuonVien[] = [
  ...toaCuaCongTy(44, 78, 0),
  ...toaCuaCongTy(45, 82, BUOC_CUM_MM),
  ...toaCuaCongTy(46, 86, 2 * BUOC_CUM_MM),
];

/** Hai nhà máy kiểu `SIM-FAC`: mỗi bên MỘT toà, cả hai ở gốc ⇒ CHỒNG KHÍT. */
const TOA_CHONG: ToaNhaKhuonVien[] = [
  { id: 1, factoryId: 1, viTriXMm: 0, viTriYMm: 0, viTriZMm: 0, rongMm: 40_000, sauMm: 30_000 },
  { id: 2, factoryId: 2, viTriXMm: 0, viTriYMm: 0, viTriZMm: 0, rongMm: 50_000, sauMm: 20_000 },
];

const giaoNhau = (
  a: { xMm: number; yMm: number; rongMm: number; sauMm: number },
  b: { xMm: number; yMm: number; rongMm: number; sauMm: number },
) =>
  a.xMm < b.xMm + b.rongMm && b.xMm < a.xMm + a.rongMm && a.yMm < b.yMm + b.sauMm && b.yMm < a.yMm + a.sauMm;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 1. nhaMayDeNap — PHẠM VI TẬP ĐOÀN THÔI BỊ HẠ XUỐNG MỘT NHÀ MÁY              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ nhaMayDeNap — phạm vi tập đoàn KHÔNG còn bị hạ cấp xuống một nhà máy", () => {
  it("★ N1 — vai cấp tập đoàn thấy 3 nhà máy ⇒ nạp ĐỦ BA, và đây là cảnh khuôn viên", () => {
    const trongPhamVi = [44, 45, 46];
    // Tiền đề: đầu vào KHÔNG rỗng và có đúng ba mã — nếu không, mọi khẳng định
    // dưới đây chỉ nói về một tập rỗng (G5).
    expect(trongPhamVi).toHaveLength(3);

    const kq = nhaMayDeNap("tapDoan", trongPhamVi, 44);
    expect(kq.gui).toEqual([44, 45, 46]);
    expect(kq.gopKhuonVien).toBe(true);
    expect(kq.biCat).toBe(0);
    expect(kq.tong).toBe(3);
    // Bất biến: gửi + bị cắt = tổng. Không nhà máy nào rơi vào khe giữa.
    expect(kq.gui.length + kq.biCat).toBe(kq.tong);
  });

  it("★ N2 — vai chỉ được gán MỘT nhà máy ⇒ vẫn chỉ ra MỘT khối (hàng rào tenant)", () => {
    // `dsTrongPhamVi` là thứ `factory.list` trả về — con số ĐÃ QUA hàng rào.
    // Client KHÔNG lọc lại: một bộ lọc thứ hai ở đây là bộ luật thứ hai.
    const trongPhamVi = [44];
    expect(trongPhamVi).toHaveLength(1);

    const kq = nhaMayDeNap("tapDoan", trongPhamVi, 44);
    expect(kq.gui).toEqual([44]);
    expect(kq.tong).toBe(1);
    // ★ VẪN là cảnh khuôn viên: họ phải thấy CẢ nhà máy (4 toà × 7 tầng), không
    //   phải một tầng của một toà. Lẫn hai thứ này chính là cách N2 bị khai láo.
    expect(kq.gopKhuonVien).toBe(true);
  });

  it("★★★ CẶP N1/N2 PHẢI KHÁC NHAU — nếu không, hàm là một hằng luôn-đúng (G8)", () => {
    const ba = nhaMayDeNap("tapDoan", [44, 45, 46], 44);
    const mot = nhaMayDeNap("tapDoan", [44], 44);
    expect(ba.gui.length).not.toBe(mot.gui.length);
    expect(ba.gui.length).toBe(3);
    expect(mot.gui.length).toBe(1);
  });

  it("★★★ ĐỐI CHỨNG BIẾT KÊU — cấp KHÁC tapDoan KHÔNG gộp, dù thấy cả ba nhà máy", () => {
    // Không có ô này, một bản cài "luôn nạp hết" vẫn xanh ở hai ô trên — và màn
    // `?pv=tang` sẽ nạp 1.108 máy để vẽ 68 cái.
    for (const cap of ["nhaMay", "tang", "line", "may"] as const) {
      const kq = nhaMayDeNap(cap, [44, 45, 46], 45);
      expect(kq.gui, `cấp ${cap}`).toEqual([45]);
      expect(kq.gopKhuonVien, `cấp ${cap}`).toBe(false);
      expect(kq.tong, `cấp ${cap}`).toBe(1);
    }
  });

  it("★ chưa phân giải được nhà máy (null) ở cấp thường ⇒ rỗng, không bịa mã", () => {
    const kq = nhaMayDeNap("nhaMay", [44, 45, 46], null);
    expect(kq.gui).toEqual([]);
    expect(kq.gopKhuonVien).toBe(false);
  });

  it("★ phạm vi RỖNG (chưa được gán nhà máy nào) ⇒ rỗng, và KHÔNG gộp", () => {
    // Gộp một tập rỗng là gửi `factoryIds: []` — Zod `.min(1)` ném BAD_REQUEST
    // và cảnh trắng. "Chưa được gán" phải là một màn rỗng có lời, không một lỗi.
    const kq = nhaMayDeNap("tapDoan", [], null);
    expect(kq.gui).toEqual([]);
    expect(kq.tong).toBe(0);
    expect(kq.gopKhuonVien).toBe(false);
  });

  it("★★★ VƯỢT TRẦN ⇒ cắt thì phải KÊU, và giữ đúng các mã NHỎ NHẤT", () => {
    const chin = [51, 52, 53, 54, 55, 56, 57, 58, 59];
    expect(chin).toHaveLength(TRAN_NHA_MAY_MOT_LUOT + 1);
    const kq = nhaMayDeNap("tapDoan", chin, 51);
    expect(kq.gui).toHaveLength(TRAN_NHA_MAY_MOT_LUOT);
    expect(kq.biCat).toBe(1);
    expect(kq.tong).toBe(9);
    expect(kq.gui).toEqual([51, 52, 53, 54, 55, 56, 57, 58]);
  });

  it("★★★ ĐÚNG BẰNG trần ⇒ KHÔNG kêu (banner không được kêu oan ở biên dưới)", () => {
    const day = Array.from({ length: TRAN_NHA_MAY_MOT_LUOT }, (_, i) => i + 41);
    const kq = nhaMayDeNap("tapDoan", day, 41);
    expect(kq.gui).toHaveLength(TRAN_NHA_MAY_MOT_LUOT);
    expect(kq.biCat).toBe(0);
  });

  it("★★★ THỨ TỰ ỔN ĐỊNH theo MÃ — `factory.list` xáo thứ tự thì cảnh KHÔNG nhảy chỗ", () => {
    // Khối được rải theo chỉ số trong danh sách này. Một thứ tự phụ thuộc lượt
    // tải sẽ làm ba khối đổi chỗ giữa hai lần F5 — lỗi §10C.6 đã ghi.
    const xuoi = nhaMayDeNap("tapDoan", [44, 45, 46], 44).gui;
    const nguoc = nhaMayDeNap("tapDoan", [46, 44, 45], 44).gui;
    expect(xuoi).toEqual([44, 45, 46]);
    expect(nguoc).toEqual(xuoi);
  });

  it("★ mã trùng / rác (âm, 0, không nguyên) rơi im lặng — cùng luật của server", () => {
    const kq = nhaMayDeNap("tapDoan", [44, 44, -1, 0, 1.5, 45], 44);
    expect(kq.gui).toEqual([44, 45]);
    expect(kq.tong).toBe(2);
  });

  it("★ trần ≤ 0 ⇒ KHÔNG cắt — một trần 0 sẽ làm cảnh trắng trong im lặng", () => {
    const kq = nhaMayDeNap("tapDoan", [44, 45, 46], 44, 0);
    expect(kq.gui).toHaveLength(3);
    expect(kq.biCat).toBe(0);
  });

  it("★★★ TRẦN CLIENT PHẢI KHỚP `.max()` CỦA SERVER — hai nguồn sự thật là một lỗi", () => {
    /*
     * ⚠⚠ Ô chặn DRIFT. Nới ở client mà quên server ⇒ Zod ném `BAD_REQUEST` ⇒
     *   **cảnh trắng hoàn toàn**; hạ ở server mà quên client ⇒ cắt sớm hơn cần.
     *   Ô này đọc GIÁ TRỊ THẬT trong mã router, không đếm chính tả.
     *
     * ★ Ghim CẢ HAI thủ tục: `canhThietKe` (dữ liệu máy) và `toaNhaTangNhieuNhaMay`
     *   (hình học sàn) phục vụ đúng MỘT lượt vẽ. Lệch nhau ⇒ một bên nhận, một
     *   bên từ chối, và cảnh có máy mà không có chỗ đặt.
     */
    const ma = docMaNguon(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../server/routers/twinCanhRouter.ts"),
    );
    const khopCanh = ma.match(
      /factoryIds:\s*z\.array\(z\.number\(\)\.int\(\)\.positive\(\)\)\.min\(1\)\.max\((\d+)\)\.optional\(\)/,
    );
    expect(khopCanh, "không đọc được `factoryIds ... .max(n)` của canhThietKe").not.toBeNull();
    expect(Number(khopCanh![1])).toBe(TRAN_NHA_MAY_MOT_LUOT);

    const khopToa = ma.match(
      /factoryIds:\s*z\.array\(z\.number\(\)\.int\(\)\.positive\(\)\)\.min\(1\)\.max\((\d+)\)\s*\}\)\)/,
    );
    expect(khopToa, "không đọc được `factoryIds ... .max(n)` của toaNhaTangNhieuNhaMay").not.toBeNull();
    expect(Number(khopToa![1])).toBe(TRAN_NHA_MAY_MOT_LUOT);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. khuonVienTapDoan — BA KHỐI, KHÔNG CHỒNG NHAU, GÓC VỀ (0,0)               */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ khuonVienTapDoan — dời chỗ từng khối nhà máy (thiết kế §5.3, D-1)", () => {
  it("★ N1 — 12 toà của BA công ty ⇒ đúng BA khối", () => {
    expect(TOA_QATD).toHaveLength(12);
    const kv = khuonVienTapDoan(TOA_QATD)!;
    expect(kv).not.toBeNull();
    expect(kv.khoi).toHaveLength(3);
    expect(kv.khoi.map((k) => k.factoryId)).toEqual([44, 45, 46]);
    // Mỗi khối gộp đúng 4 toà — tiền đề chống "bao hình của tập rỗng".
    expect(kv.khoi.map((k) => k.soToa)).toEqual([4, 4, 4]);
    expect(kv.toaNha).toHaveLength(12);
  });

  it("★ N2 — MỘT công ty trong phạm vi ⇒ đúng MỘT khối, và nó ôm đủ 4 toà", () => {
    const motCongTy = toaCuaCongTy(44, 78, 0);
    expect(motCongTy).toHaveLength(4);
    const kv = khuonVienTapDoan(motCongTy)!;
    expect(kv.khoi).toHaveLength(1);
    expect(kv.khoi[0].factoryId).toBe(44);
    expect(kv.khoi[0].soToa).toBe(4);
  });

  it("★★★ CẶP N1/N2 PHẢI KHÁC — ba toà-của-ba-công-ty ≠ ba toà-của-một-công-ty", () => {
    // Cùng SỐ toà, khác SỐ công ty. Một bản cài đếm toà thay vì đếm công ty sẽ
    // cho hai kết quả giống nhau và cả hai ô trên vẫn xanh.
    const baCongTy = [TOA_QATD[0], TOA_QATD[4], TOA_QATD[8]];
    const motCongTy = [TOA_QATD[0], TOA_QATD[1], TOA_QATD[2]];
    expect(baCongTy).toHaveLength(3);
    expect(motCongTy).toHaveLength(3);
    expect(khuonVienTapDoan(baCongTy)!.khoi).toHaveLength(3);
    expect(khuonVienTapDoan(motCongTy)!.khoi).toHaveLength(1);
  });

  it("★★★ N3 — BA KHỐI KHÔNG CHỒNG NHAU (0 cặp giao)", () => {
    const kv = khuonVienTapDoan(TOA_QATD)!;
    expect(kv.khoi).toHaveLength(3);
    let cap = 0;
    for (let i = 0; i < kv.khoi.length; i += 1) {
      for (let j = i + 1; j < kv.khoi.length; j += 1) {
        if (giaoNhau(kv.khoi[i], kv.khoi[j])) cap += 1;
      }
    }
    expect(cap).toBe(0);
    expect(kv.soCapChong).toBe(0);
  });

  it("★★★ DỮ LIỆU ĐÃ TÁCH SẴN ⇒ **KHÔNG** rải lưới (cấm cộng hai lần)", () => {
    /*
     * Bộ sinh nướng bước cụm 1 km vào `twin_toa_nha.viTriXMm`. Một lưới cố định
     * chồng lên nó sẽ cộng hai lần — đúng lỗi §10C.6 ("bước lưới 400 m làm 4 khối
     * 3 km lồng vào nhau"), chỉ theo chiều ngược. Nên ô này ghim: khoảng cách
     * giữa hai khối liền kề đúng bằng BƯỚC CỤM CỦA DỮ LIỆU, không hơn.
     */
    const kv = khuonVienTapDoan(TOA_QATD)!;
    expect(kv.daRaiLuoi).toBe(false);
    expect(kv.khoi[1].xMm - kv.khoi[0].xMm).toBe(BUOC_CUM_MM);
    expect(kv.khoi[2].xMm - kv.khoi[1].xMm).toBe(BUOC_CUM_MM);
  });

  it("★★★ GÓC KHUÔN VIÊN VỀ (0,0) — sàn của `CanhVanHanh` trải từ 0, không từ tâm", () => {
    const kv = khuonVienTapDoan(TOA_QATD)!;
    expect(Math.min(...kv.toaNha.map((t) => t.viTriXMm))).toBe(0);
    expect(Math.min(...kv.toaNha.map((t) => t.viTriYMm))).toBe(0);
    expect(Math.min(...kv.khoi.map((k) => k.xMm))).toBe(0);
    // Bề rộng = 2 km (hai bước cụm) + bề rộng một cụm (130.000 + 120.000).
    expect(kv.rongMm).toBe(2 * BUOC_CUM_MM + 130_000 + TOA_RONG_MM);
    expect(kv.sauMm).toBe(100_000 + TOA_SAU_MM);
  });

  it("★★★ GỐC KHÔNG BỊ TỊNH TIẾN KHI NHÀ MÁY ĐẦU KHÔNG Ở 0 — phép dời có thật", () => {
    // Nếu ai đó bỏ phép tịnh tiến, ô "góc về 0" vẫn xanh với dữ liệu QATD (vốn
    // đã bắt đầu ở 0). Ô này dịch cả tập đi 500 km để phép dời phải LỘ RA.
    const doiXa = TOA_QATD.map((t) => ({ ...t, viTriXMm: Number(t.viTriXMm) + 500_000_000 }));
    const kv = khuonVienTapDoan(doiXa)!;
    expect(Math.min(...kv.toaNha.map((t) => t.viTriXMm))).toBe(0);
    expect(kv.rongMm).toBe(2 * BUOC_CUM_MM + 130_000 + TOA_RONG_MM);
  });

  it("★★★ HAI NHÀ MÁY CÙNG Ở GỐC (ca SIM-FAC có thật) ⇒ ĐO ĐƯỢC LÀ CHỒNG, rồi RẢI", () => {
    expect(TOA_CHONG).toHaveLength(2);
    const kv = khuonVienTapDoan(TOA_CHONG)!;
    expect(kv.soCapChong).toBe(1);
    expect(kv.daRaiLuoi).toBe(true);
    // Sau khi rải, không còn cặp nào giao nhau.
    expect(giaoNhau(kv.khoi[0], kv.khoi[1])).toBe(false);
    // Bước rải = bề rộng khối to nhất + khe hở, KHÔNG cộng lên offset cũ.
    expect(kv.khoi[0].xMm).toBe(0);
    expect(kv.khoi[1].xMm).toBe(50_000 + KHE_HO_KHOI_MM);
  });

  it("★★★ ĐỐI CHỨNG — chạm MÉP không phải là chồng (đừng rải oan)", () => {
    const chamMep: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 1, viTriXMm: 0, viTriYMm: 0, viTriZMm: 0, rongMm: 40_000, sauMm: 30_000 },
      { id: 2, factoryId: 2, viTriXMm: 40_000, viTriYMm: 0, viTriZMm: 0, rongMm: 40_000, sauMm: 30_000 },
    ];
    const kv = khuonVienTapDoan(chamMep)!;
    expect(kv.soCapChong).toBe(0);
    expect(kv.daRaiLuoi).toBe(false);
  });

  it("★★★ Z KHÔNG BỊ DỜI — cao độ đã tuyệt đối trong toà (thiết kế §5.1)", () => {
    const coZ: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 44, viTriXMm: 900_000, viTriYMm: 700_000, viTriZMm: 1_234, rongMm: 10, sauMm: 10 },
    ];
    const kv = khuonVienTapDoan(coZ)!;
    expect(kv.toaNha[0].viTriZMm).toBe(1_234);
    // …trong khi X/Y THÌ bị dời về gốc — hai trục, hai luật, và ô này ghim cả hai.
    expect(kv.toaNha[0].viTriXMm).toBe(0);
    expect(kv.toaNha[0].viTriYMm).toBe(0);
  });

  it("★ toà thiếu `rongMm/sauMm` ⇒ bao hình là một ĐIỂM, không phải kích thước bịa", () => {
    const thieu: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 44, viTriXMm: 0, viTriYMm: 0, viTriZMm: 0 },
    ];
    const kv = khuonVienTapDoan(thieu)!;
    expect(kv.khoi[0].rongMm).toBe(0);
    expect(kv.khoi[0].sauMm).toBe(0);
  });

  it("★★★ KHÔNG CÓ TOÀ NÀO ⇒ `null`, KHÔNG phải khuôn viên 0×0", () => {
    // Một sàn 0 × 0 là cảnh trắng không lời giải thích, và người gọi mất đường
    // phân biệt "chưa tải xong" với "đã tải, 0 toà" (NT-3.5).
    expect(khuonVienTapDoan([])).toBeNull();
  });

  it("★ numeric về dạng CHUỖI (drizzle) vẫn cộng đúng — không nối chuỗi", () => {
    // `"38400" + "0"` = `"384000"`: không throw, nhà xưởng to gấp mười.
    const chuoi: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 44, viTriXMm: "0", viTriYMm: "0", viTriZMm: "0", rongMm: "38400", sauMm: "1000" },
      { id: 2, factoryId: 44, viTriXMm: "38400", viTriYMm: "0", viTriZMm: "0", rongMm: "1000", sauMm: "1000" },
    ];
    const kv = khuonVienTapDoan(chuoi)!;
    expect(kv.khoi).toHaveLength(1);
    expect(kv.rongMm).toBe(39_400);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 3. saBanTapDoan — SA BÀN QUY HOẠCH (Task 20)                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ Ô NGHIỆM THU CỦA TASK 20 LÀ **PIXEL**, MÀ LƯỚI NÀY CHẠY Ở NODE
 * ════════════════════════════════════════════════════════════════════════════
 * Tiêu chí chủ đợt đặt ra là "mỗi biểu tượng rộng ≥ 24 px ở 1280×720, khung mặc
 * định". Không hàm thuần nào đo được pixel — nên lưới này **không giả vờ đo**
 * pixel. Nó đo đúng cái CƠ CHẾ sinh ra pixel ấy, và cơ chế đó là một tỉ số:
 *
 *   bề rộng biểu tượng / bề rộng SA BÀN
 *
 * vì khung nhìn ôm cả sa bàn, nên số pixel của một biểu tượng tỉ lệ thẳng với tỉ
 * số này. Số đo trước/sau nói rõ vì sao Task 19 đen màn hình:
 *   · toạ độ THẬT  : 110.000 / 2.240.000 = **4,9 %** bề rộng
 *   · sa bàn Task 20: 110.000 /   629.200 = **17,5 %** — gấp 3,56 lần.
 * Pixel thật do `.qa-tapdoan/t20-do.mjs` đo trên trình duyệt; ở đây ta ghim cái
 * **bất biến** làm nó đúng, để một bản vá sau này nới bố cục ra là ĐỎ ngay.
 *
 * ⚠ Mọi ô dưới đây khẳng định KÍCH THƯỚC ĐẦU VÀO trước khi khẳng định kết cục
 *   (G5), và đi theo CẶP N1/N2 như phần trên của tệp.
 */

/** Ngưỡng tỉ số "đọc được": biểu tượng nhỏ nhất ≥ 1/10 bề rộng sa bàn. */
const TI_SO_DOC_DUOC = 0.1;

/**
 * Mẫu số là CẠNH DÀI NHẤT của sa bàn, không phải bề rộng: khung nhìn ôm cả bao
 * hình, nên cạnh dài mới là thứ quyết định số mét trên một pixel.
 */
const tiSoNhoNhat = (sb: { bieuTuong: { rongMm: number }[]; rongMm: number; sauMm: number }) =>
  Math.min(...sb.bieuTuong.map((v) => v.rongMm)) / Math.max(sb.rongMm, sb.sauMm);

describe("★★★ saBanTapDoan — đổi ĐƠN VỊ VẼ, không đổi khung nhìn (Task 20)", () => {
  it("★ N1 — 12 toà của BA công ty ⇒ 12 BIỂU TƯỢNG trong BA cụm, mỗi cụm 4 toà", () => {
    expect(TOA_QATD).toHaveLength(12);
    const sb = saBanTapDoan(TOA_QATD);
    expect(sb).not.toBeNull();
    if (!sb) return;

    expect(sb.bieuTuong).toHaveLength(12);
    expect(sb.oCum).toHaveLength(3);
    expect(sb.oCum.map((o) => o.factoryId)).toEqual([44, 45, 46]);
    expect(sb.oCum.map((o) => o.soToa)).toEqual([4, 4, 4]);
    // Tổng biểu tượng = tổng toà của các cụm: không toà nào rơi vào khe.
    expect(sb.oCum.reduce((a, o) => a + o.soToa, 0)).toBe(sb.bieuTuong.length);
  });

  it("★★★ QUAN HỆ ĐÚNG — mỗi biểu tượng nằm TRONG ô cụm của ĐÚNG nhà máy nó thuộc về", () => {
    const sb = saBanTapDoan(TOA_QATD);
    if (!sb) throw new Error("sa bàn null");
    expect(sb.bieuTuong.length).toBeGreaterThan(0);

    for (const v of sb.bieuTuong) {
      const o = sb.oCum.find((c) => c.factoryId === v.factoryId);
      expect(o, `toà ${v.toaNhaId} không có cụm`).toBeDefined();
      if (!o) continue;
      expect(v.chiSoCum).toBe(o.chiSoCum);
      expect(v.xMm).toBeGreaterThanOrEqual(o.xMm);
      expect(v.yMm).toBeGreaterThanOrEqual(o.yMm);
      expect(v.xMm + v.rongMm).toBeLessThanOrEqual(o.xMm + o.rongMm + 1e-6);
      expect(v.yMm + v.sauMm).toBeLessThanOrEqual(o.yMm + o.sauMm + 1e-6);
    }
  });

  it("★★★ CÁC CỤM TÁCH BẠCH — 0 cặp ô cụm giao nhau (đây là thứ 'ba cụm' nghĩa là)", () => {
    const sb = saBanTapDoan(TOA_QATD);
    if (!sb) throw new Error("sa bàn null");
    expect(sb.oCum.length).toBe(3);

    let cap = 0;
    for (let i = 0; i < sb.oCum.length; i += 1) {
      for (let j = i + 1; j < sb.oCum.length; j += 1) {
        if (giaoNhau(sb.oCum[i], sb.oCum[j])) cap += 1;
      }
    }
    expect(cap).toBe(0);
  });

  it("★★★ KHE GIỮA CỤM PHẢI LỚN HƠN HẲN KHE TRONG CỤM — nếu không, 12 toà đọc thành MỘT lưới đều", () => {
    const sb = saBanTapDoan(TOA_QATD);
    if (!sb) throw new Error("sa bàn null");

    // Khe TRONG cụm: hai biểu tượng liền nhau cùng một cụm, cùng hàng.
    const cumA = sb.bieuTuong.filter((v) => v.factoryId === 44).sort((a, b) => a.xMm - b.xMm);
    expect(cumA.length).toBe(4);
    const kheTrong = cumA[2].xMm - (cumA[0].xMm + cumA[0].rongMm);

    // Khe GIỮA cụm: mép phải ô cụm 0 → mép trái ô cụm 1.
    const o0 = sb.oCum[0];
    const o1 = sb.oCum[1];
    const kheGiua = o1.xMm - (o0.xMm + o0.rongMm);

    expect(kheTrong).toBeGreaterThan(0);
    expect(kheGiua).toBeGreaterThan(0);
    expect(kheGiua / kheTrong).toBeGreaterThanOrEqual(KHE_GIUA_CUM_TOI_THIEU_LAN);
  });

  it("★★★ KẾT CỤC ĐO ĐƯỢC — biểu tượng nhỏ nhất chiếm ≥ 10 % bề rộng sa bàn", () => {
    const sb = saBanTapDoan(TOA_QATD);
    if (!sb) throw new Error("sa bàn null");
    expect(sb.bieuTuong).toHaveLength(12);
    expect(tiSoNhoNhat(sb)).toBeGreaterThanOrEqual(TI_SO_DOC_DUOC);
  });

  it("★★★ ĐỐI CHỨNG BIẾT KÊU — ĐÚNG phép đo ấy BÁC BỎ bố cục toạ độ thật (4,9 %)", () => {
    /*
     * Không có ô này, ô trên là một khẳng định không ai kiểm được: nó phải ĐỎ
     * trên bố cục cũ thì mới chứng minh được nó đo đúng thứ Task 20 sinh ra để
     * sửa. `khuonVienTapDoan` là chính bố cục cũ, còn sống và còn lưới.
     */
    const cu = khuonVienTapDoan(TOA_QATD);
    if (!cu) throw new Error("khuôn viên null");
    const tiSoCu = TOA_RONG_MM / cu.rongMm;
    expect(tiSoCu).toBeLessThan(TI_SO_DOC_DUOC);

    const sb = saBanTapDoan(TOA_QATD);
    if (!sb) throw new Error("sa bàn null");
    // Và hai phép đo phải KHÁC NHAU rõ rệt: sa bàn nén bề rộng xuống dưới MỘT
    // NỬA (đo được với giáo cụ này: 2.250.000 → 734.400 mm, tức 3,06 lần).
    expect(sb.rongMm).toBeLessThan(cu.rongMm / 2);
    expect(tiSoNhoNhat(sb)).toBeGreaterThan(tiSoCu * 2);
  });

  it("★ N2 — MỘT công ty ⇒ MỘT cụm, 4 biểu tượng; CẶP N1/N2 phải KHÁC NHAU", () => {
    const motCongTy = toaCuaCongTy(44, 78, 0);
    expect(motCongTy).toHaveLength(4);
    const mot = saBanTapDoan(motCongTy);
    const ba = saBanTapDoan(TOA_QATD);
    if (!mot || !ba) throw new Error("sa bàn null");

    expect(mot.oCum).toHaveLength(1);
    expect(mot.bieuTuong).toHaveLength(4);
    // Cặp phải khác: "một cụm" cũng là kết quả khi tính năng gộp chưa bật (G139).
    expect(mot.oCum.length).not.toBe(ba.oCum.length);
    expect(ba.oCum.length).toBe(3);
  });

  it("★★★ SỰ THẬT VỀ DỮ LIỆU KHÔNG BỊ VỨT — `thatRongMm`/`soCapChong` giữ nguyên phép đo cũ", () => {
    const cu = khuonVienTapDoan(TOA_QATD);
    const sb = saBanTapDoan(TOA_QATD);
    if (!cu || !sb) throw new Error("null");
    expect(sb.thatRongMm).toBe(cu.rongMm);
    expect(sb.thatSauMm).toBe(cu.sauMm);
    expect(sb.soCapChong).toBe(cu.soCapChong);
    expect(sb.soCapChong).toBe(0);

    // Ca CÓ chồng (SIM-FAC): con số phải đi theo, không bị sa bàn xoá mất.
    const chong = saBanTapDoan(TOA_CHONG);
    if (!chong) throw new Error("null");
    expect(chong.soCapChong).toBe(1);
  });

  it("★★★ LỜI KHAI SƠ ĐỒ LUÔN BẬT — `laSoDo`/`daRaiLuoi` không phụ thuộc dữ liệu có chồng hay không", () => {
    // Đây là chỗ Task 20 đổi hợp đồng: trước đây banner chỉ nói thật khi ĐO ĐƯỢC
    // là chồng; nay vị trí LUÔN là sơ đồ nên lời khai phải luôn bật.
    const tach = saBanTapDoan(TOA_QATD);
    const chong = saBanTapDoan(TOA_CHONG);
    if (!tach || !chong) throw new Error("null");
    expect(tach.laSoDo).toBe(true);
    expect(chong.laSoDo).toBe(true);
    expect(tach.daRaiLuoi).toBe(true);
    expect(chong.daRaiLuoi).toBe(true);

    // Đối chứng: hàm CŨ vẫn phân biệt hai ca — nó chưa bị sửa nghĩa.
    expect(khuonVienTapDoan(TOA_QATD)?.daRaiLuoi).toBe(false);
    expect(khuonVienTapDoan(TOA_CHONG)?.daRaiLuoi).toBe(true);
  });

  it("★★★ GÓC SA BÀN VỀ (0,0) VÀ MỌI BIỂU TƯỢNG NẰM TRONG SÀN", () => {
    const sb = saBanTapDoan(TOA_QATD);
    if (!sb) throw new Error("null");
    expect(sb.bieuTuong.length).toBe(12);
    for (const v of sb.bieuTuong) {
      expect(v.xMm).toBeGreaterThan(0);
      expect(v.yMm).toBeGreaterThan(0);
      expect(v.xMm + v.rongMm).toBeLessThanOrEqual(sb.rongMm);
      expect(v.yMm + v.sauMm).toBeLessThanOrEqual(sb.sauMm);
    }
  });

  it("★ `toaNha` đã dời TRÙNG KHỚP góc biểu tượng — máy trong tầng mới nằm trong toà", () => {
    const sb = saBanTapDoan(TOA_QATD);
    if (!sb) throw new Error("null");
    expect(sb.toaNha).toHaveLength(12);
    for (const v of sb.bieuTuong) {
      const t = sb.toaNha.find((x) => x.id === v.toaNhaId);
      expect(t, `toà ${v.toaNhaId}`).toBeDefined();
      expect(t?.viTriXMm).toBe(v.xMm);
      expect(t?.viTriYMm).toBe(v.yMm);
    }
  });

  it("★★★ Z KHÔNG BỊ DỜI — cùng bất biến với `khuonVienTapDoan` (thiết kế §5.1)", () => {
    const co: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 1, viTriXMm: 0, viTriYMm: 0, viTriZMm: 12_345, rongMm: 40_000, sauMm: 30_000 },
      { id: 2, factoryId: 2, viTriXMm: 500_000, viTriYMm: 0, viTriZMm: -7_000, rongMm: 40_000, sauMm: 30_000 },
    ];
    const sb = saBanTapDoan(co);
    if (!sb) throw new Error("null");
    expect(sb.toaNha.find((t) => t.id === 1)?.viTriZMm).toBe(12_345);
    expect(sb.toaNha.find((t) => t.id === 2)?.viTriZMm).toBe(-7_000);
  });

  /**
   * ⚠⚠ Ô NÀY ĐÃ XANH RỒI ĐỎ Ở PH-50 — ghi lại CẢ HAI SỐ, không im lặng sửa.
   *
   *   · TRƯỚC PH-50: toà thiếu số đo ⇒ `20.000` (sàn); toà có số đo ⇒ `60.000`.
   *   · SAU  PH-50: cả hai ⇒ `40.000` = trung vị của `[20.000, 60.000]`.
   *
   * Đây KHÔNG phải hồi quy: chủ dự án đã chốt bỏ ràng buộc "vẽ đúng tỉ lệ kích
   * thước", nên "mỗi biểu tượng mang cỡ THẬT của nó" thôi là hợp đồng. Thứ ô này
   * sinh ra để canh — *một toà thiếu số đo không được biến mất khỏi màn* — vẫn
   * được canh, và canh CHẶT HƠN: nay nó to bằng mọi toà khác, chứ không còn là
   * cái nhỏ nhất màn hình. Ô đổi **kỳ vọng**, giữ nguyên **ý định**.
   */
  it("★★★ TOÀ THIẾU SỐ ĐO **KHÔNG** rộng 0 — và từ PH-50 nó nhận CỠ CHUNG (20.000 → 40.000)", () => {
    const co: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 1, viTriXMm: 0, viTriYMm: 0, viTriZMm: 0 },
      { id: 2, factoryId: 1, viTriXMm: 0, viTriYMm: 0, viTriZMm: 0, rongMm: 60_000, sauMm: 50_000 },
    ];
    const sb = saBanTapDoan(co);
    if (!sb) throw new Error("null");
    const v1 = sb.bieuTuong.find((v) => v.toaNhaId === 1);
    // Ý ĐỊNH GỐC, giữ nguyên: không 0, không dưới sàn, vẫn có khối cao nhìn thấy.
    expect(v1?.rongMm).toBeGreaterThanOrEqual(BIEU_TUONG_TOI_THIEU_MM);
    expect(v1?.sauMm).toBeGreaterThanOrEqual(BIEU_TUONG_TOI_THIEU_MM);
    expect(v1?.caoMm).toBe(BIEU_TUONG_CAO_TOI_THIEU_MM);
    // HỢP ĐỒNG MỚI, ghim bằng con số: cả hai toà CÙNG cỡ = trung vị đã kẹp sàn.
    expect(v1?.rongMm).toBe((BIEU_TUONG_TOI_THIEU_MM + 60_000) / 2);
    expect(sb.bieuTuong.find((v) => v.toaNhaId === 2)?.rongMm).toBe(v1?.rongMm);
    expect(sb.bieuTuongRongMm).toBe(40_000);
  });

  it("★ NHÃN lấy từ CSDL; thiếu ⇒ chuỗi RỖNG, không bịa tên", () => {
    const co: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 1, ma: "QATD-A-T1", ten: "Toà 1", rongMm: 40_000, sauMm: 30_000 },
      { id: 2, factoryId: 1, rongMm: 40_000, sauMm: 30_000 },
    ];
    const sb = saBanTapDoan(co);
    if (!sb) throw new Error("null");
    expect(sb.bieuTuong.find((v) => v.toaNhaId === 1)?.ten).toBe("Toà 1");
    expect(sb.bieuTuong.find((v) => v.toaNhaId === 1)?.ma).toBe("QATD-A-T1");
    expect(sb.bieuTuong.find((v) => v.toaNhaId === 2)?.ten).toBe("");
    expect(sb.bieuTuong.find((v) => v.toaNhaId === 2)?.ma).toBe("");
  });

  it("★★★ THỨ TỰ ỔN ĐỊNH — xáo đầu vào ⇒ CÙNG một sa bàn (không nhảy chỗ giữa hai lần F5)", () => {
    const xao = [...TOA_QATD].reverse();
    expect(xao).toHaveLength(12);
    const a = saBanTapDoan(TOA_QATD);
    const b = saBanTapDoan(xao);
    if (!a || !b) throw new Error("null");
    const khoa = (sb: NonNullable<ReturnType<typeof saBanTapDoan>>) =>
      [...sb.bieuTuong]
        .sort((x, y) => x.toaNhaId - y.toaNhaId)
        .map((v) => `${v.toaNhaId}@${v.xMm},${v.yMm}#${v.chiSoCum}`)
        .join("|");
    expect(khoa(b)).toBe(khoa(a));
  });

  it("★★★ KHÔNG CÓ TOÀ NÀO ⇒ `null` — KHÔNG phải một sa bàn 0×0 (cảnh trắng không lời giải thích)", () => {
    expect(saBanTapDoan([])).toBeNull();
  });

  it("★ numeric dạng CHUỖI (drizzle) vẫn ra số — không nối chuỗi", () => {
    const co: ToaNhaKhuonVien[] = [
      {
        id: 1,
        factoryId: 1,
        viTriXMm: "100000.000",
        viTriYMm: "0",
        viTriZMm: "3000.000",
        rongMm: "110000.000",
        sauMm: "80000.000",
        caoMm: "42000.000",
      },
    ];
    const sb = saBanTapDoan(co);
    if (!sb) throw new Error("null");
    expect(sb.bieuTuong[0].rongMm).toBe(110_000);
    expect(sb.bieuTuong[0].caoMm).toBe(42_000);
    expect(sb.toaNha[0].viTriZMm).toBe(3_000);
    expect(Number.isFinite(sb.rongMm)).toBe(true);
  });

  /* ═════════════════════════════════════════════════════════════════════════ */
  /* PH-50 — CỠ BIỂU TƯỢNG LÀ **ƯỚC LỆ**: ĐỒNG CỠ THEO TRUNG VỊ                */
  /* ═════════════════════════════════════════════════════════════════════════ */

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ★★★ VÌ SAO Ô ĐƠN VỊ THÔI LẤY `max` — MỘT PHÉP CHIA, KHÔNG PHẢI THẨM MỸ
   * ══════════════════════════════════════════════════════════════════════════
   * Ô đơn vị cũ = **cạnh lớn nhất TOÀN TẬP**. Ở vai `qatd_admin` (thấy cả QATD
   * lẫn `FUYU-F`) tập ấy chứa MỘT toà rộng 3.000 m bên cạnh 12 toà 110 m và một
   * toà 38,4 m. Hệ quả ĐO ĐƯỢC trên trình duyệt (`.qa-tapdoan/n1-p50truoc.json`,
   * @1280×720 khung mặc định):
   *
   *   · sa bàn phình **28.920 m** (viewBox `-964 -964 30848 16288`)
   *   · biểu tượng nhỏ nhất **1,2 px** — trần nghiệm thu là **24 px**
   *   · 3D: canvas ĐEN, `soNhan() = {ve:0, an:19, anNgoaiKhung:19, tong:19}`
   *
   * Tỉ số lớn/nhỏ của tập admin là **78,13 : 1**. Với bố cục này, bề rộng pixel
   * của biểu tượng NHỎ NHẤT bằng `72,3 / R` (R = tỉ số lớn/nhỏ sau khi kẹp) —
   * nên R = 78 cho ~1 px, và **không khung nhìn nào bù được**. Chủ dự án đã chốt
   * *"không nhất thiết phải vẽ đúng tỉ lệ kích thước của từng toà nhà"* ⇒ R := 1:
   * **mọi biểu tượng một cỡ**.
   *
   * ★★★ CỠ CHUNG LÀ **TRUNG VỊ CỦA CHÍNH TẬP ĐANG XEM**, không phải một hằng.
   *   Đây là điều làm bản vá KHÔNG HỒI QUY bốn vai QATD: cả 12 toà của chúng đo
   *   được là **110.000 × 80.000 mm y hệt nhau** (CSDL, `.qa-tapdoan/p50-db.mjs`),
   *   nên trung vị = chính con số ấy ⇒ sa bàn của chúng **không đổi một số nào**.
   *   Một hằng cố định (ví dụ 100 m) sẽ làm bốn vai ấy đổi hình — mà bốn vai ấy
   *   đã được chủ đợt nghiệm thu BẰNG MẮT ở `c41892bc`.
   */
  it("★★★ PH-50 N1 — MỌI biểu tượng CÙNG MỘT CỠ, và cỡ ấy là TRUNG VỊ của tập", () => {
    // Kích thước đầu vào TRƯỚC (G5): 3 toà, ba cỡ khác hẳn nhau, trung vị ở giữa.
    const co: ToaNhaKhuonVien[] = [
      { id: 1, factoryId: 1, rongMm: 38_400, sauMm: 29_600, caoMm: 8_000 },
      { id: 2, factoryId: 1, rongMm: 110_000, sauMm: 80_000, caoMm: 42_000 },
      { id: 3, factoryId: 1, rongMm: 3_000_000, sauMm: 2_000_000, caoMm: 25_000 },
    ];
    expect(co).toHaveLength(3);
    expect(3_000_000 / 38_400).toBeCloseTo(78.125, 3);

    const sb = saBanTapDoan(co);
    if (!sb) throw new Error("null");
    expect(sb.bieuTuong).toHaveLength(3);
    expect(sb.bieuTuong.map((v) => v.rongMm)).toEqual([110_000, 110_000, 110_000]);
    expect(sb.bieuTuong.map((v) => v.sauMm)).toEqual([80_000, 80_000, 80_000]);
    // Cỡ chung được KHAI RA, để banner nêu được CON SỐ thay vì một tính từ.
    expect(sb.bieuTuongRongMm).toBe(110_000);
    expect(sb.bieuTuongSauMm).toBe(80_000);
    // …và cái ĐÃ BỊ THAY vẫn giữ được, nếu không thì màn không nói thật nổi.
    expect(sb.thatCanhNhoNhatMm).toBe(29_600);
    expect(sb.thatCanhLonNhatMm).toBe(3_000_000);
  });

  it("★★★ PH-50 N2 — MỌI TOÀ BẰNG NHAU ⇒ sa bàn KHÔNG ĐỔI MỘT SỐ NÀO (nền 4 vai QATD)", () => {
    // Đây là hình học THẬT của 4 vai QATD: 110.000 × 80.000 mm, không lệch một mm.
    const bang: ToaNhaKhuonVien[] = [];
    for (let nm = 48; nm <= 50; nm += 1) {
      for (let k = 0; k < 4; k += 1) {
        bang.push({ id: nm * 10 + k, factoryId: nm, rongMm: 110_000, sauMm: 80_000, caoMm: 42_000 });
      }
    }
    expect(bang).toHaveLength(12);
    expect(new Set(bang.map((b) => `${b.rongMm}x${b.sauMm}`)).size).toBe(1);

    const sb = saBanTapDoan(bang);
    if (!sb) throw new Error("null");
    // Cỡ chung = chính cỡ thật ⇒ ô đơn vị y hệt bản `max` cũ ⇒ 0 pixel xê dịch.
    expect(sb.bieuTuongRongMm).toBe(110_000);
    expect(sb.bieuTuongSauMm).toBe(80_000);
    // Con số ĐÃ ĐO SỐNG (`n1-p50truoc.json`, `qatd_giamdoc` 2D): viewBox
    // 718,08 × 598,08 m, tức sa bàn 673,2 × 553,2 m (lề = cạnh dài / 30).
    expect(sb.rongMm).toBe(673_200);
    expect(sb.sauMm).toBe(553_200);
    // Đối chứng dương: thước BIẾT KÊU nếu cỡ chung lệch sang cỡ của tập admin.
    expect(sb.rongMm).not.toBe(1_060_400);
  });

  it("★★★ PH-50 — TẬP CỦA `qatd_admin`: sa bàn 28.920 m → 1.060,4 m, tỉ số lớn/nhỏ 78,13 → 1", () => {
    const admin: ToaNhaKhuonVien[] = [
      { id: 24, factoryId: 1, rongMm: 38_400, sauMm: 29_600, caoMm: 8_000 },
      { id: 90, factoryId: 47, rongMm: 3_000_000, sauMm: 2_000_000, caoMm: 25_000 },
    ];
    for (let nm = 48; nm <= 50; nm += 1) {
      for (let k = 0; k < 4; k += 1) {
        admin.push({ id: nm * 10 + k, factoryId: nm, rongMm: 110_000, sauMm: 80_000, caoMm: 42_000 });
      }
    }
    expect(admin).toHaveLength(14);
    expect(new Set(admin.map((b) => b.factoryId)).size).toBe(5);

    const sb = saBanTapDoan(admin);
    if (!sb) throw new Error("null");
    expect(sb.oCum).toHaveLength(5);
    expect(sb.bieuTuong).toHaveLength(14);
    // Sa bàn CŨ 28.920.000 mm (đo sống). MỚI:
    expect(sb.rongMm).toBe(1_060_400);
    expect(sb.sauMm).toBe(553_200);
    const rongs = sb.bieuTuong.map((v) => v.rongMm);
    expect(Math.max(...rongs) / Math.min(...rongs)).toBe(1);
    // Tỉ số đọc-được. CŨ = 38.400 / 28.920.000 = 0,13 % (≈1,2 px). Ngưỡng 10 %.
    expect(tiSoNhoNhat(sb)).toBeGreaterThanOrEqual(TI_SO_DOC_DUOC);
  });

  it("★★★ PH-50 — QUAN HỆ KHÔNG ĐỔI: 1 cụm = 1 nhà máy, 0 cặp toà KHÁC công ty chồng nhau", () => {
    const admin: ToaNhaKhuonVien[] = [
      { id: 24, factoryId: 1, rongMm: 38_400, sauMm: 29_600 },
      { id: 90, factoryId: 47, rongMm: 3_000_000, sauMm: 2_000_000 },
    ];
    for (let nm = 48; nm <= 50; nm += 1) {
      for (let k = 0; k < 4; k += 1) {
        admin.push({ id: nm * 10 + k, factoryId: nm, rongMm: 110_000, sauMm: 80_000 });
      }
    }
    const sb = saBanTapDoan(admin);
    if (!sb) throw new Error("null");
    expect(sb.bieuTuong).toHaveLength(14);

    let capKhacNhaMay = 0;
    for (let i = 0; i < sb.bieuTuong.length; i += 1) {
      for (let j = i + 1; j < sb.bieuTuong.length; j += 1) {
        const a = sb.bieuTuong[i];
        const b = sb.bieuTuong[j];
        if (a.factoryId === b.factoryId) continue;
        if (
          a.xMm < b.xMm + b.rongMm &&
          b.xMm < a.xMm + a.rongMm &&
          a.yMm < b.yMm + b.sauMm &&
          b.yMm < a.yMm + a.sauMm
        ) {
          capKhacNhaMay += 1;
        }
      }
    }
    expect(capKhacNhaMay).toBe(0);
    // …và mỗi biểu tượng vẫn nằm trong ĐÚNG ô cụm của nhà máy nó thuộc về.
    for (const v of sb.bieuTuong) {
      expect(sb.oCum.find((c) => c.factoryId === v.factoryId)?.chiSoCum).toBe(v.chiSoCum);
    }
  });

  it("★★★ PH-50 — TOÀ THIẾU SỐ ĐO cũng nhận CỠ CHUNG, và cỡ chung KHÔNG BAO GIỜ dưới sàn", () => {
    // Một mình một toà không số đo ⇒ trung vị của tập ĐÃ KẸP SÀN = chính sàn.
    const motMinh = saBanTapDoan([{ id: 1, factoryId: 1 }]);
    if (!motMinh) throw new Error("null");
    expect(motMinh.bieuTuongRongMm).toBe(BIEU_TUONG_TOI_THIEU_MM);
    expect(motMinh.bieuTuong[0].rongMm).toBe(BIEU_TUONG_TOI_THIEU_MM);
    expect(motMinh.bieuTuong[0].caoMm).toBe(BIEU_TUONG_CAO_TOI_THIEU_MM);

    // Hai toà, một thiếu số đo ⇒ CẢ HAI nhận trung vị, và KHÔNG cái nào rộng 0.
    const sb = saBanTapDoan([
      { id: 1, factoryId: 1 },
      { id: 2, factoryId: 1, rongMm: 60_000, sauMm: 50_000 },
    ]);
    if (!sb) throw new Error("null");
    expect(sb.bieuTuongRongMm).toBe((BIEU_TUONG_TOI_THIEU_MM + 60_000) / 2);
    for (const v of sb.bieuTuong) {
      expect(v.rongMm).toBeGreaterThanOrEqual(BIEU_TUONG_TOI_THIEU_MM);
      expect(v.sauMm).toBeGreaterThanOrEqual(BIEU_TUONG_TOI_THIEU_MM);
    }
  });

  it("★★★ PH-50 — CHIỀU CAO vẫn là số THẬT: chỉ MẶT BẰNG bị đồng cỡ, và banner phải nói đúng chừng ấy", () => {
    const sb = saBanTapDoan([
      { id: 1, factoryId: 1, rongMm: 38_400, sauMm: 29_600, caoMm: 8_000 },
      { id: 2, factoryId: 2, rongMm: 110_000, sauMm: 80_000, caoMm: 42_000 },
      { id: 3, factoryId: 3, rongMm: 3_000_000, sauMm: 2_000_000, caoMm: 25_000 },
    ]);
    if (!sb) throw new Error("null");
    expect(sb.bieuTuong.map((v) => v.caoMm)).toEqual([8_000, 42_000, 25_000]);
  });

  it("★★★ NỚI TỚI TRẦN 8 NHÀ MÁY — tỉ số đọc-được VẪN đứng (không chỉ đúng với 3)", () => {
    const tam: ToaNhaKhuonVien[] = [];
    for (let k = 0; k < TRAN_NHA_MAY_MOT_LUOT; k += 1) {
      tam.push(...toaCuaCongTy(40 + k, 100 + k * 10, k * BUOC_CUM_MM));
    }
    expect(tam).toHaveLength(32);
    const sb = saBanTapDoan(tam);
    if (!sb) throw new Error("null");
    expect(sb.oCum).toHaveLength(8);
    expect(sb.bieuTuong).toHaveLength(32);
    expect(tiSoNhoNhat(sb)).toBeGreaterThanOrEqual(TI_SO_DOC_DUOC);
  });
});
