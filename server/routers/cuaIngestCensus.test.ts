/**
 * ★★★ **CỔNG ĐIỀU TRA DÂN SỐ — BẢY CỬA INGEST (5 + CỬA THỨ SÁU/ZIP = 2 thủ tục), MỘT ĐIỂM
 * QUYẾT ĐỊNH PHIÊN BẢN.**
 *
 * Pha 1C Task 3 (BG-21 ⛔ + BG-31, kế hoạch
 * `docs/superpowers/plans/2026-08-29-aoi-pha1c-va-lo-du-lieu.md`) dựng NĂM cửa đầu.
 * Task 2 Pha 1D (BG-39 ⛔, kế hoạch `docs/superpowers/plans/2026-08-30-aoi-pha1d-truoc-khoi-b.md`)
 * thêm CỬA THỨ SÁU: `aoiPackageRouter.presign`/`.commit` — xem khối "2026-08-29 (Task 2, BG-39)" ở
 * đầu `cuaIngestScan.ts` cho lý lẽ đầy đủ vì sao cửa này KHÔNG PHẢI rủi ro tương lai (đang chạy
 * thật — 238 gói `committed`, 10 bộ `idempotencyKey LIKE 'aoi-pkg:%'` trong DB test).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BÀI TOÁN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `ingestRejectLegacyMachineEnabled()` (nay đọc qua `quyetDinhPhienBanIngest()`) có ĐÚNG MỘT điểm
 * gọi trong `submitInspection` TRƯỚC Pha 1C — nhưng CÓ BẢY thủ tục nhận dữ liệu/tham chiếu một gói
 * đo từ máy, trải trên HAI router/file: `submitInspection` · `submitInspectionBatch` ·
 * `submitProcessResult` · `submitProcessResultBatch` · `syncEdgeResults` (`machineApiRouter`,
 * `machineApiRouters.ts`) và `presign` · `commit` (`aoiPackageRouter`, `aoiPackageRouter.ts`).
 * "Cắt mà chừa bốn cửa thì không phải cắt" — và cắt mà quên mất một FILE khác hoàn toàn cũng vậy.
 *
 * ⇒ File này canh MỘT lượng từ trên CẢ HAI router: *"∀ cửa nhận dữ liệu kiểm tra từ máy: nó đi qua
 *   `quyetDinhPhienBanIngest`, HOẶC có tên KÝ trong sổ miễn trừ (hợp của
 *   `MIEN_TRU_QUYET_DINH_PHIEN_BAN` + `MIEN_TRU_CUA_INGEST_ZIP`) kèm lý do đo được."* Miễn trừ là
 *   một lựa chọn HỢP LỆ cho NĂM trong bảy cửa (ba cửa thuộc họ hợp đồng khác hẳn + `presign` không
 *   mang payload đo lường + `commit`, tính TỚI Lô 3 Mục 3/BG-39 gđ2, ĐÃ GÁC bằng ba khối dùng
 *   chung nhưng không gọi TRỰC TIẾP `quyetDinhPhienBanIngest` nên bộ suy AST không thấy được) — xem
 *   `MIEN_TRU_CUA_INGEST_ZIP.commit` cho bằng chứng và `aoiPackageZipGacMayCu.test.ts` cho hành vi.
 *
 * ⚠⚠ CỔNG XANH KHÔNG CHỨNG MINH "mọi cửa tương lai sẽ tự động được canh". Nó chứng minh BỐN điều:
 *   (1) bộ suy THẬT SỰ tìm thấy ≥7 cửa trên mã hôm nay, TRÊN CẢ HAI router (§1 — cầu chì chống
 *       "xanh vì quét trúng 0 thứ": một bộ suy luôn trả mảng rỗng cũng làm mọi lượng từ "∀ cửa…"
 *       xanh VÔ NGHĨA — và cầu chì RIÊNG cho cửa ZIP, để một hồi quy chỉ làm QUET_ZIP rỗng không
 *       trốn được sau lưng năm cửa kia);
 *   (2) đúng BẢY cửa đã biết, không thừa không thiếu (§2 — GHIM, đổi thì phải ghi lý do);
 *   (3) mỗi cửa hoặc gác hoặc có lý do miễn trừ ĐÃ KÝ, và sổ miễn trừ (hợp nhất) không hoá thạch
 *       và không đụng tên giữa hai sổ (§3);
 *   (4) một cửa GIẢ thêm vào KHÔNG có gác lẫn không có miễn trừ bị bắt và NÊU ĐÚNG TÊN — đột biến
 *       THẬT chạy trên CHÍNH bộ suy đang canh sản phẩm, không phải một bản giản lược (§5), cộng
 *       một ca ĐỐI CHỨNG chống "vá quá tay" (bộ suy trả `true` cho mọi thứ cũng qua được §1-§4
 *       nhưng sẽ hỏng ở ca đối chứng).
 *
 * ⚠ Bộ suy `quetCuaIngest` (`./cuaIngestScan.ts`) hoạt động trên MÃ (AST), không trên văn bản —
 *   xem khối lý lẽ ở đầu file đó về bài học BG-16 (BG-14 xanh giả vì regex soi nhầm nhánh). CÙNG
 *   một hàm quét cho cả hai router (không viết bộ quét thứ hai) — chỉ đổi tên router/vị từ qua
 *   tham số `tuyChon` (xem `TEN_BIEN_ROUTER_ZIP`/`laTenCuaIngestZip`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  quetCuaIngest,
  TEN_HAM_QUYET_DINH,
  TEN_BIEN_ROUTER_ZIP,
  laTenCuaIngestZip,
  MIEN_TRU_CUA_INGEST_ZIP,
} from "./cuaIngestScan";
import { MIEN_TRU_QUYET_DINH_PHIEN_BAN } from "./machineApiRouters";

const HERE = dirname(fileURLToPath(import.meta.url));

const DUONG_HIEN_THI = "server/routers/machineApiRouters.ts";
const FILE_THAT = join(HERE, "machineApiRouters.ts");
const MA_THAT = readFileSync(FILE_THAT, "utf8");

const DUONG_HIEN_THI_ZIP = "server/routers/aoiPackageRouter.ts";
const FILE_THAT_ZIP = join(HERE, "aoiPackageRouter.ts");
const MA_THAT_ZIP = readFileSync(FILE_THAT_ZIP, "utf8");

const QUET_MACHINE = quetCuaIngest(DUONG_HIEN_THI, MA_THAT);
const QUET_ZIP = quetCuaIngest(DUONG_HIEN_THI_ZIP, MA_THAT_ZIP, {
  tenBienRouter: TEN_BIEN_ROUTER_ZIP,
  laTenCua: laTenCuaIngestZip,
});

/** Hợp nhất hai lượt quét — MỘT dân số cửa ingest, trải trên hai router/file. */
const QUET = {
  cua: [...QUET_MACHINE.cua, ...QUET_ZIP.cua],
  mu: [...QUET_MACHINE.mu, ...QUET_ZIP.mu],
};

/** Hợp nhất hai sổ miễn trừ — kiểm KHÔNG đụng tên ở §3 trước khi tin phép hợp là an toàn. */
const MIEN_TRU: Readonly<Record<string, string>> = {
  ...MIEN_TRU_QUYET_DINH_PHIEN_BAN,
  ...MIEN_TRU_CUA_INGEST_ZIP,
};

/** Bảy cửa đã biết hôm nay — GHIM. Đổi tập này là một LỜI KHAI, không phải bảo trì im lặng. */
const GHIM_TEN_CUA = [
  "submitInspection",
  "submitInspectionBatch",
  // ★ Khối B Task 2 (2026-09-03) — cửa ĐẨY CÂY DẠY (cấu hình máy → hệ). Vị từ
  //   `laTenCuaIngest` (`/^submit/i`) BẮT nó, đúng như thiết kế: một cửa `submit*`
  //   MỚI không được phép ra đời NGOÀI census. Nó thuộc HỌ HỢP ĐỒNG KHÁC
  //   (`machineTemplateContract`) nên nằm ở sổ miễn trừ điểm-quyết-định-phiên-bản
  //   kèm lý do — xem `MIEN_TRU_QUYET_DINH_PHIEN_BAN.submitMachineTemplate`.
  "submitMachineTemplate",
  "submitProcessResult",
  "submitProcessResultBatch",
  "syncEdgeResults",
  "presign",
  "commit",
].sort();

/** Hai cửa PHẢI gác thẳng (thuộc đúng hợp đồng cutover v1.x-phẳng/v2.0-cây). */
const GHIM_DA_GAC = ["submitInspection", "submitInspectionBatch"].sort();

/** SÁU cửa MIỄN TRỪ có lý do (BỐN hợp đồng khác — kể cả cây DẠY của Khối B / `presign` không payload / `commit` LỖ THẬT CHƯA VÁ). */
const GHIM_MIEN_TRU = [
  "submitMachineTemplate",
  "submitProcessResult",
  "submitProcessResultBatch",
  "syncEdgeResults",
  "presign",
  "commit",
].sort();

describe("§1 — CẦU CHÌ: bộ suy có thật sự nhìn thấy CẢ HAI router không", () => {
  it("không có ô mù (gộp cả hai lượt quét)", () => {
    expect(QUET.mu, "bộ suy tự khai KHÔNG tìm thấy router — mất mục tiêu").toEqual([]);
  });

  it("★★★ tìm được ÍT NHẤT 5 cửa trong machineApiRouter (chống 'xanh vì quét trúng 0 thứ')", () => {
    expect(QUET_MACHINE.cua.length).toBeGreaterThanOrEqual(5);
  });

  it("★★★ tìm được ĐÚNG 2 cửa trong aoiPackageRouter — cửa thứ SÁU (chống 'xanh vì quét trúng 0 thứ' RIÊNG cho lượt quét mới; nếu lượt này hỏng và trả rỗng, §1 gộp/§2 vẫn đỏ nhưng ca này nói THẲNG lượt nào)", () => {
    expect(QUET_ZIP.cua.length).toBe(2);
  });

  it("★★★ tổng ÍT NHẤT 7 cửa (mọi khẳng định bên dưới TỰ THOẢ nếu một trong hai bộ suy hỏng và trả mảng rỗng)", () => {
    expect(QUET.cua.length).toBeGreaterThanOrEqual(7);
  });
});

describe("§2 — DÂN SỐ CỬA — GHIM", () => {
  it("đúng BẢY cửa đã biết, không thừa không thiếu", () => {
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
  it("hai sổ miễn trừ KHÔNG đụng tên (điều kiện để hợp bằng spread ở trên là an toàn)", () => {
    const trung = Object.keys(MIEN_TRU_QUYET_DINH_PHIEN_BAN).filter((t) => t in MIEN_TRU_CUA_INGEST_ZIP);
    expect(trung, "hai sổ miễn trừ dùng CHUNG một tên — spread sẽ ghi đè âm thầm, phải khoá theo file").toEqual([]);
  });

  it(`cửa KHÔNG có tên trong sổ miễn trừ hợp nhất ⇒ PHẢI tới được \`${TEN_HAM_QUYET_DINH}\``, () => {
    const thieu = QUET.cua.filter((c) => !c.quaDiemQuyetDinh && !(c.ten in MIEN_TRU));
    expect(
      thieu.map((c) => `${c.ten} (dòng ${c.dong})`),
      "CỬA NÀY KHÔNG GÁC: không tới được `quyetDinhPhienBanIngest` và cũng không có tên trong sổ\n" +
        "miễn trừ (MIEN_TRU_QUYET_DINH_PHIEN_BAN ở machineApiRouters.ts, hoặc MIEN_TRU_CUA_INGEST_ZIP\n" +
        "ở cuaIngestScan.ts). Sửa MỘT trong hai:\n" +
        "  (a) nối cửa này qua `quyetDinhPhienBanIngest`, HOẶC\n" +
        "  (b) thêm tên vào sổ miễn trừ tương ứng KÈM lý do đo được — không phải bỏ qua im lặng.",
    ).toEqual([]);
  });

  it("mọi cửa MIỄN TRỪ có lý do THẬT (không phải chuỗi rỗng/khẩu vị)", () => {
    for (const [ten, lyDo] of Object.entries(MIEN_TRU)) {
      expect(typeof lyDo, `miễn trừ \`${ten}\` không phải chuỗi`).toBe("string");
      expect(lyDo.length, `miễn trừ \`${ten}\` thiếu lý do đủ dài để coi là đã ký`).toBeGreaterThan(30);
    }
  });

  it("sổ miễn trừ KHÔNG HOÁ THẠCH: mọi tên còn là một cửa CÓ THẬT", () => {
    const tenCua = new Set(QUET.cua.map((c) => c.ten));
    const con = Object.keys(MIEN_TRU).filter((t) => !tenCua.has(t));
    expect(con, "tên này không còn là một cửa ingest (đổi tên/gỡ bỏ) — xoá dòng miễn trừ").toEqual([]);
  });

  it("sổ miễn trừ không che giấu một cửa THỰC RA đã gác — nối cổng rồi phải GỠ DÒNG", () => {
    const daGac = new Set(QUET.cua.filter((c) => c.quaDiemQuyetDinh).map((c) => c.ten));
    const thua = Object.keys(MIEN_TRU).filter((t) => daGac.has(t));
    expect(
      thua,
      "cửa này ĐÃ được gác nhưng còn tên trong sổ miễn trừ — xoá dòng miễn trừ tương ứng.",
    ).toEqual([]);
  });

  it("phép cộng khớp: gác + miễn trừ = toàn bộ dân số cửa (không cửa nào rơi ra ngoài cả hai)", () => {
    const daGac = QUET.cua.filter((c) => c.quaDiemQuyetDinh).map((c) => c.ten).sort();
    const mienTru = QUET.cua.filter((c) => c.ten in MIEN_TRU).map((c) => c.ten).sort();
    expect(daGac).toEqual(GHIM_DA_GAC);
    expect(mienTru).toEqual(GHIM_MIEN_TRU);
    expect([...daGac, ...mienTru].sort()).toEqual(GHIM_TEN_CUA);
  });
});

describe("§4 — NĂM CA CHUẨN trên mã THẬT", () => {
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
    expect(MIEN_TRU.syncEdgeResults).toBeDefined();
  });

  it("★★★ presign (CỬA THỨ SÁU, aoiPackageRouter) — MIỄN TRỪ, không tới được điểm quyết định (đúng — không mang payload đo lường)", () => {
    const c = QUET.cua.find((x) => x.ten === "presign");
    expect(c, "không thấy presign — bộ suy mất cửa ZIP này").toBeDefined();
    expect(c?.quaDiemQuyetDinh).toBe(false);
    expect(MIEN_TRU.presign).toBeDefined();
  });

  it("★★★ commit (CỬA THỨ SÁU, aoiPackageRouter) — KHÔNG gọi quyetDinhPhienBanIngest TRỰC TIẾP (bộ suy AST không thấy), nhưng ĐÃ GÁC bằng ba khối dùng chung (BG-39 gđ2 — xem aoiPackageZipGacMayCu.test.ts cho bằng chứng hành vi)", () => {
    const c = QUET.cua.find((x) => x.ten === "commit");
    expect(c, "không thấy commit — bộ suy mất cửa ZIP này").toBeDefined();
    expect(c?.quaDiemQuyetDinh, "commit KHÔNG gọi quyetDinhPhienBanIngest trực tiếp (hàm đó ở tầng payload submitInspection, không khớp meta.json trong ZIP) — nếu true, sổ miễn trừ đã hoá thạch, xoá dòng commit").toBe(false);
    expect(MIEN_TRU.commit).toBeDefined();
    expect(MIEN_TRU.commit).toContain("ĐÃ GÁC");
  });

  it("★★★ HỒI QUY: nếu `commit` ĐƯỢC vá để gọi `quyetDinhPhienBanIngest`, bộ suy phải nhận ra NGAY (chứng minh việc gác CÓ được phát hiện qua router/file khác — không chỉ việc KHÔNG gác)", () => {
    const NEO_COMMIT = "commit: publicProcedure";
    const viTri = MA_THAT_ZIP.indexOf(NEO_COMMIT);
    expect(viTri, "không tìm thấy điểm neo `commit: publicProcedure` — bộ suy đã đổi neo?").toBeGreaterThan(-1);
    // Chèn một lời gọi trực tiếp NGAY ĐẦU thân `.mutation(async ({ input, ctx }) => { … })`.
    const NEO_MUTATION = ".mutation(async ({ input, ctx }) => {";
    const diemMutation = MA_THAT_ZIP.indexOf(NEO_MUTATION, viTri);
    expect(diemMutation, "không tìm thấy thân .mutation của commit — bộ suy đã đổi neo?").toBeGreaterThan(-1);
    const diemChen = diemMutation + NEO_MUTATION.length;
    const maVa =
      MA_THAT_ZIP.slice(0, diemChen) +
      "\n      quyetDinhPhienBanIngest(input);" +
      MA_THAT_ZIP.slice(diemChen);

    const laiQuet = quetCuaIngest(DUONG_HIEN_THI_ZIP, maVa, {
      tenBienRouter: TEN_BIEN_ROUTER_ZIP,
      laTenCua: laTenCuaIngestZip,
    });
    const commitVa = laiQuet.cua.find((c) => c.ten === "commit");
    expect(commitVa?.quaDiemQuyetDinh, "sau khi vá gọi quyetDinhPhienBanIngest, bộ suy PHẢI nhận ra ngay").toBe(true);
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
