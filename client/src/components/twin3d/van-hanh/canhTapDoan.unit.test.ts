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
  KHE_HO_KHOI_MM,
  TRAN_NHA_MAY_MOT_LUOT,
  khuonVienTapDoan,
  nhaMayDeNap,
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
