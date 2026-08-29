/**
 * ★★★ **CỔNG ĐIỀU TRA DÂN SỐ — NĂM CỬA INGEST, MỘT ĐIỂM QUYẾT ĐỊNH PHIÊN BẢN.**
 *
 * Pha 1C Task 3 (BG-21 ⛔ + BG-31, kế hoạch
 * `docs/superpowers/plans/2026-08-29-aoi-pha1c-va-lo-du-lieu.md`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BÀI TOÁN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `ingestRejectLegacyMachineEnabled()` (nay đọc qua `quyetDinhPhienBanIngest()`) có ĐÚNG MỘT điểm
 * gọi trong `submitInspection` TRƯỚC bản vá này — nhưng CÓ NĂM cửa nhận dữ liệu kiểm tra từ máy:
 * `submitInspection` · `submitInspectionBatch` · `submitProcessResult` ·
 * `submitProcessResultBatch` · `syncEdgeResults`. "Cắt mà chừa bốn cửa thì không phải cắt."
 *
 * ⇒ File này canh MỘT lượng từ: *"∀ cửa nhận dữ liệu kiểm tra từ máy trong `machineApiRouter`: nó
 *   đi qua `quyetDinhPhienBanIngest`, HOẶC có tên KÝ trong `MIEN_TRU_QUYET_DINH_PHIEN_BAN` kèm lý
 *   do đo được."* Miễn trừ là một lựa chọn HỢP LỆ (ba trong năm cửa thuộc một họ hợp đồng khác hẳn
 *   — xem lý do tại từng dòng của sổ) — nhưng phải KÝ TÊN, không phải im lặng bỏ sót.
 *
 * ⚠⚠ CỔNG XANH KHÔNG CHỨNG MINH "mọi cửa tương lai sẽ tự động được canh". Nó chứng minh BỐN điều:
 *   (1) bộ suy THẬT SỰ tìm thấy ≥5 cửa trên mã hôm nay (§1 — cầu chì chống "xanh vì quét trúng 0
 *       thứ": một bộ suy luôn trả mảng rỗng cũng làm mọi lượng từ "∀ cửa…" xanh VÔ NGHĨA);
 *   (2) đúng NĂM cửa đã biết, không thừa không thiếu (§2 — GHIM, đổi thì phải ghi lý do);
 *   (3) mỗi cửa hoặc gác hoặc có lý do miễn trừ ĐÃ KÝ, và sổ miễn trừ không hoá thạch (§3);
 *   (4) một cửa GIẢ thêm vào KHÔNG có gác lẫn không có miễn trừ bị bắt và NÊU ĐÚNG TÊN — đột biến
 *       THẬT chạy trên CHÍNH bộ suy đang canh sản phẩm, không phải một bản giản lược (§5), cộng
 *       một ca ĐỐI CHỨNG chống "vá quá tay" (bộ suy trả `true` cho mọi thứ cũng qua được §1-§4
 *       nhưng sẽ hỏng ở ca đối chứng).
 *
 * ⚠ Bộ suy `quetCuaIngest` (`./cuaIngestScan.ts`) hoạt động trên MÃ (AST), không trên văn bản —
 *   xem khối lý lẽ ở đầu file đó về bài học BG-16 (BG-14 xanh giả vì regex soi nhầm nhánh).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { quetCuaIngest, TEN_HAM_QUYET_DINH } from "./cuaIngestScan";
import { MIEN_TRU_QUYET_DINH_PHIEN_BAN } from "./machineApiRouters";

const DUONG_HIEN_THI = "server/routers/machineApiRouters.ts";
const FILE_THAT = join(dirname(fileURLToPath(import.meta.url)), "machineApiRouters.ts");
const MA_THAT = readFileSync(FILE_THAT, "utf8");

const QUET = quetCuaIngest(DUONG_HIEN_THI, MA_THAT);

/** Năm cửa đã biết hôm nay — GHIM. Đổi tập này là một LỜI KHAI, không phải bảo trì im lặng. */
const GHIM_TEN_CUA = [
  "submitInspection",
  "submitInspectionBatch",
  "submitProcessResult",
  "submitProcessResultBatch",
  "syncEdgeResults",
].sort();

/** Hai cửa PHẢI gác thẳng (thuộc đúng hợp đồng cutover v1.x-phẳng/v2.0-cây). */
const GHIM_DA_GAC = ["submitInspection", "submitInspectionBatch"].sort();

/** Ba cửa MIỄN TRỪ có lý do (họ hợp đồng khác / không phải payload đo lường máy). */
const GHIM_MIEN_TRU = ["submitProcessResult", "submitProcessResultBatch", "syncEdgeResults"].sort();

describe("§1 — CẦU CHÌ: bộ suy có thật sự nhìn thấy router không", () => {
  it("không có ô mù", () => {
    expect(QUET.mu, "bộ suy tự khai KHÔNG tìm thấy machineApiRouter — mất mục tiêu").toEqual([]);
  });

  it("★★★ tìm được ÍT NHẤT 5 cửa (chống 'xanh vì quét trúng 0 thứ' — mọi khẳng định bên dưới TỰ THOẢ nếu bộ suy hỏng và trả mảng rỗng)", () => {
    expect(QUET.cua.length).toBeGreaterThanOrEqual(5);
  });
});

describe("§2 — DÂN SỐ CỬA — GHIM", () => {
  it("đúng NĂM cửa đã biết, không thừa không thiếu", () => {
    expect(
      QUET.cua.map((c) => c.ten).sort(),
      "Dân số cửa ingest đã đổi. Sửa GHIM_TEN_CUA cho khớp SỐ ĐO ĐƯỢC — đừng sửa cho xanh mà không đọc vì sao đổi.",
    ).toEqual(GHIM_TEN_CUA);
  });

  it("mọi cửa đều là mutation (đúng bản chất 'nhận dữ liệu' — không phải đọc)", () => {
    for (const c of QUET.cua) expect(c.loai, `cửa ${c.ten} không phải mutation`).toBe("mutation");
  });
});

describe("§3 — ★★★ MỖI CỬA ĐI QUA ĐÚNG MỘT ĐIỂM QUYẾT ĐỊNH, HOẶC CÓ MIỄN TRỪ ĐÃ KÝ", () => {
  it(`cửa KHÔNG có tên trong MIEN_TRU_QUYET_DINH_PHIEN_BAN ⇒ PHẢI tới được \`${TEN_HAM_QUYET_DINH}\``, () => {
    const thieu = QUET.cua.filter((c) => !c.quaDiemQuyetDinh && !(c.ten in MIEN_TRU_QUYET_DINH_PHIEN_BAN));
    expect(
      thieu.map((c) => `${c.ten} (dòng ${c.dong})`),
      "CỬA NÀY KHÔNG GÁC: không tới được `quyetDinhPhienBanIngest` và cũng không có tên trong\n" +
        "`MIEN_TRU_QUYET_DINH_PHIEN_BAN` (server/routers/machineApiRouters.ts). Sửa MỘT trong hai:\n" +
        "  (a) nối cửa này qua `quyetDinhPhienBanIngest`, HOẶC\n" +
        "  (b) thêm tên vào MIEN_TRU_QUYET_DINH_PHIEN_BAN KÈM lý do đo được — không phải bỏ qua im lặng.",
    ).toEqual([]);
  });

  it("mọi cửa MIỄN TRỪ có lý do THẬT (không phải chuỗi rỗng/khẩu vị)", () => {
    for (const [ten, lyDo] of Object.entries(MIEN_TRU_QUYET_DINH_PHIEN_BAN)) {
      expect(typeof lyDo, `miễn trừ \`${ten}\` không phải chuỗi`).toBe("string");
      expect(lyDo.length, `miễn trừ \`${ten}\` thiếu lý do đủ dài để coi là đã ký`).toBeGreaterThan(30);
    }
  });

  it("sổ miễn trừ KHÔNG HOÁ THẠCH: mọi tên còn là một cửa CÓ THẬT", () => {
    const tenCua = new Set(QUET.cua.map((c) => c.ten));
    const con = Object.keys(MIEN_TRU_QUYET_DINH_PHIEN_BAN).filter((t) => !tenCua.has(t));
    expect(con, "tên này không còn là một cửa ingest (đổi tên/gỡ bỏ) — xoá dòng miễn trừ").toEqual([]);
  });

  it("sổ miễn trừ không che giấu một cửa THỰC RA đã gác — nối cổng rồi phải GỠ DÒNG", () => {
    const daGac = new Set(QUET.cua.filter((c) => c.quaDiemQuyetDinh).map((c) => c.ten));
    const thua = Object.keys(MIEN_TRU_QUYET_DINH_PHIEN_BAN).filter((t) => daGac.has(t));
    expect(
      thua,
      "cửa này ĐÃ được gác nhưng còn tên trong sổ miễn trừ — xoá dòng miễn trừ tương ứng.",
    ).toEqual([]);
  });

  it("phép cộng khớp: gác + miễn trừ = toàn bộ dân số cửa (không cửa nào rơi ra ngoài cả hai)", () => {
    const daGac = QUET.cua.filter((c) => c.quaDiemQuyetDinh).map((c) => c.ten).sort();
    const mienTru = QUET.cua.filter((c) => c.ten in MIEN_TRU_QUYET_DINH_PHIEN_BAN).map((c) => c.ten).sort();
    expect(daGac).toEqual(GHIM_DA_GAC);
    expect(mienTru).toEqual(GHIM_MIEN_TRU);
    expect([...daGac, ...mienTru].sort()).toEqual(GHIM_TEN_CUA);
  });
});

describe("§4 — BA CA CHUẨN trên mã THẬT", () => {
  it("submitInspection — gọi `quyetDinhPhienBanIngest` GIÁN TIẾP qua `.input(submitInspectionRouterInputSchema)` (chống BG-16: chữ không nằm trong thân thủ tục)", () => {
    const c = QUET.cua.find((x) => x.ten === "submitInspection");
    expect(c, "không thấy submitInspection — bộ suy mất cửa này").toBeDefined();
    expect(c?.quaDiemQuyetDinh).toBe(true);
  });

  it("submitInspectionBatch — gọi TRỰC TIẾP qua `.input(submitInspectionBatchRouterInputSchema)`", () => {
    const c = QUET.cua.find((x) => x.ten === "submitInspectionBatch");
    expect(c, "không thấy submitInspectionBatch — bộ suy mất cửa này").toBeDefined();
    expect(c?.quaDiemQuyetDinh).toBe(true);
  });

  it("syncEdgeResults — MIỄN TRỪ có lý do, KHÔNG tới được điểm quyết định (đúng — payload không liên quan machineDataContract)", () => {
    const c = QUET.cua.find((x) => x.ten === "syncEdgeResults");
    expect(c, "không thấy syncEdgeResults — bộ suy mất cửa này").toBeDefined();
    expect(c?.quaDiemQuyetDinh).toBe(false);
    expect(MIEN_TRU_QUYET_DINH_PHIEN_BAN.syncEdgeResults).toBeDefined();
  });
});

describe("§5 — ★★★ ĐỘT BIẾN THẬT: cửa giả KHÔNG gác bị bắt và NÊU TÊN, cửa giả CÓ gác thì KHÔNG", () => {
  /**
   * ⚠⚠ Không ghi file ra đĩa — chèn đột biến vào một BIẾN THỂ TRONG BỘ NHỚ của mã thật rồi chạy
   * lại CHÍNH `quetCuaIngest` (không phải một bản giản lược riêng cho lưới này). Không cần dọn dẹp
   * `git status` vì file thật KHÔNG BAO GIỜ bị đụng tới — cách an toàn nhất để "hoàn tác đột biến"
   * là không bao giờ ghi nó xuống đĩa.
   */
  const NEO = `export const ${"machineApiRouter"} = router({`;

  function chenVaoRouter(doanChen: string): string {
    const viTri = MA_THAT.indexOf(NEO);
    expect(viTri, "không tìm thấy điểm neo `export const machineApiRouter = router({` — bộ suy đã đổi neo?").toBeGreaterThan(-1);
    const diemChen = MA_THAT.indexOf("{", viTri) + 1;
    return MA_THAT.slice(0, diemChen) + doanChen + MA_THAT.slice(diemChen);
  }

  it("★★★ (a) `submitFakeInspection` KHÔNG gọi `quyetDinhPhienBanIngest`, KHÔNG có trong sổ miễn trừ ⇒ census phải ĐỎ và NÊU TÊN nó", () => {
    const maDotBien = chenVaoRouter(
      `\n  // ĐỘT BIẾN THỬ NGHIỆM (§5) — cửa giả nhận dữ liệu máy, KHÔNG gác gì cả.\n` +
        `  submitFakeInspection: publicProcedure\n` +
        `    .input(z.object({ serialNumber: z.string() }))\n` +
        `    .mutation(async () => ({ success: true as const })),\n`,
    );

    const laiQuet = quetCuaIngest(DUONG_HIEN_THI, maDotBien);
    const cuaGia = laiQuet.cua.find((c) => c.ten === "submitFakeInspection");
    expect(cuaGia, "bộ suy KHÔNG THẤY cửa giả — lượng từ 'tên cửa ingest' đã thủng").toBeDefined();
    expect(cuaGia?.loai).toBe("mutation");
    expect(cuaGia?.quaDiemQuyetDinh, "cửa giả không hề nhắc tới quyetDinhPhienBanIngest").toBe(false);

    // Áp ĐÚNG luật §3 lên kết quả đột biến — đây là điều census thật sẽ làm khi ai đó thêm cửa này.
    const thieu = laiQuet.cua.filter((c) => !c.quaDiemQuyetDinh && !(c.ten in MIEN_TRU_QUYET_DINH_PHIEN_BAN));
    const tenBiBat = thieu.map((c) => c.ten);
    expect(tenBiBat, "census PHẢI nêu đúng tên cửa giả — không được im lặng bỏ qua").toContain(
      "submitFakeInspection",
    );

    // NGUYÊN VĂN output mà một lượt chạy census thật sẽ in ra cho người xem lỗi:
    const thongDiepThat = thieu.map((c) => `${c.ten} (dòng ${c.dong})`);
    expect(thongDiepThat.some((s) => s.startsWith("submitFakeInspection"))).toBe(true);
  });

  it("ĐỐI CHỨNG (b): `submitFakeInspectionOk` CÓ gọi `quyetDinhPhienBanIngest` ⇒ KHÔNG bị bắt (chống 'vá quá tay' — một bộ suy luôn trả `false` cũng qua được ca (a) nhưng hỏng ở đây)", () => {
    const maDotBien = chenVaoRouter(
      `\n  submitFakeInspectionOk: publicProcedure\n` +
        `    .input(z.unknown().transform((raw) => { quyetDinhPhienBanIngest(raw); return raw; }))\n` +
        `    .mutation(async () => ({ success: true as const })),\n`,
    );

    const laiQuet = quetCuaIngest(DUONG_HIEN_THI, maDotBien);
    const c = laiQuet.cua.find((x) => x.ten === "submitFakeInspectionOk");
    expect(c, "bộ suy KHÔNG THẤY cửa đối chứng").toBeDefined();
    expect(c?.quaDiemQuyetDinh, "CHỐNG VÁ QUÁ TAY: cửa CÓ gọi thật thì KHÔNG được bắt").toBe(true);

    const thieu = laiQuet.cua.filter((x) => !x.quaDiemQuyetDinh && !(x.ten in MIEN_TRU_QUYET_DINH_PHIEN_BAN));
    expect(thieu.map((x) => x.ten)).not.toContain("submitFakeInspectionOk");
  });

  it("cả hai đột biến KHÔNG chạm đĩa — file thật không đổi (chứng minh bằng nội dung đọc lại)", () => {
    const doc = readFileSync(FILE_THAT, "utf8");
    expect(doc).toBe(MA_THAT);
    expect(doc.includes("submitFakeInspection")).toBe(false);
  });
});
