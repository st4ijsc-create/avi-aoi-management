/**
 * ★★★ CENSUS — Task 3, kế hoạch `docs/superpowers/plans/2026-08-29-aoi-wal-cho-cay-v2.md`:
 * *"∀ đường GHI vào `product_inspections`: nó đi qua WAL (`bufferSubmission`), HOẶC có tên KÝ
 * trong `MIEN_TRU_GHI_INSPECTION_WAL` kèm lý do đo được."* `product_inspections` là bảng WORM
 * (`avi_app` không có DELETE) — một đường ghi quên WAL không chỉ "mất bo khi DB hỏng" mà có thể
 * ghi một hàng MỒ CÔI/SAI VĨNH VIỄN không xoá được (xem task-3-brief.md).
 *
 * Bộ suy `quetDuongGhiInspection` (`./ghiInspectionWalScan.ts`) chạy trên MÃ (TypeScript
 * compiler API), không trên văn bản — xem docblock đầu file đó cho lý lẽ BG-16 + TRẦN đầy đủ của
 * cách tiếp cận (vị từ theo TÊN, tập file cố định, "tới-được" không phải "chắc chắn mọi nhánh"…).
 * Đọc TRẦN đó TRƯỚC khi tin cổng xanh dưới đây nghĩa là "đã kín".
 *
 * ⚠⚠ CỔNG XANH KHÔNG CHỨNG MINH "mọi đường ghi tương lai sẽ tự động được canh". Nó chứng minh:
 *   (1) bộ suy THẬT SỰ tìm thấy ≥2 đường — CẢ v1.x LẪN v2.0 — trên mã hôm nay (§1, cầu chì chống
 *       "xanh vì quét trúng 0 thứ": một bộ suy hỏng trả mảng rỗng làm mọi lượng từ "∀ đường…" bên
 *       dưới tự thoả VÔ NGHĨA — mệnh đề 1 của brief);
 *   (2) đúng TÁM đường đã biết hôm nay, không thừa không thiếu (§2 — GHIM, đổi thì phải ghi lý
 *       do — mệnh đề 3 của brief: một đường BIẾN MẤT cũng bị bắt, không chỉ đường THÊM VÀO);
 *   (3) mỗi đường hoặc có WAL hoặc có miễn trừ ĐÃ KÝ lý do đo được, sổ miễn trừ không hoá thạch và
 *       không che giấu một đường thực ra đã có WAL (§3 — mệnh đề 2 của brief);
 *   (4) một đường GIẢ không WAL thêm vào bị bắt và NÊU ĐÚNG TÊN, và một đường giả CÓ WAL thì
 *       KHÔNG bị báo nhầm (§5 — hai đột biến bắt buộc của brief, chạy trên CHÍNH bộ suy đang canh
 *       sản phẩm, không phải một bản giản lược).
 *
 * ★★★ NĂM trong TÁM đường hôm nay nằm trong sổ miễn trừ — HAI mục
 * (`ensureInspectionWalWired→…`) là bộ điều phối phát lại của CHÍNH WAL (miễn trừ kiến trúc hợp
 * lệ), MỘT mục (`commit→persistInspectionAtomic`) là mutation người-kích-hoạt có transaction
 * riêng (miễn trừ hợp lệ), MỘT mục (`hotFolderService`) có tầng bền vững riêng dựa trên file
 * (miễn trừ hợp lệ) — nhưng MỘT mục còn lại
 * (`acquisitionWorker.submitCanonical→processInspectionSubmission`) là LỖ THẬT CHƯA VÁ, ghi vào
 * sổ để không chặn cổng ra Task 3 (brief cấm tự vá mã sản xuất mà không báo trước) — đọc lý do
 * đầy đủ ở `ghiInspectionWalScan.ts` và mục "mối lo" của `task-3-report.md` trước khi coi census
 * xanh là "đã ổn".
 *
 * ★★★ 2026-08-29 (HOTFIX cùng ngày) — census bắt được đường số 9 THẬT SỰ khi mới dựng lưới:
 * `initInspectionStoreForward` (`inspectionStoreForward.ts`, chạy Ở BOOT, TRƯỚC bất kỳ lượt live
 * nào) từng WIRE CỨNG `processFn` vào `processInspectionSubmission` (v1.x) — TÁI DIỄN lớp lỗi
 * §QĐ-WAL-B (Task 2) qua cửa BOOT, và `.env` của repo bật `INSPECTION_STORE_FORWARD_ENABLED=true`
 * THẬT nên không phải rủi ro trên giấy. ĐÃ VÁ NGAY (coordinator yêu cầu sửa trong lượt này, không
 * hoãn): `initInspectionStoreForward` nay gọi THẲNG `ensureInspectionWalWired()` (export) — MỘT
 * điểm điều phối cho CẢ HAI đường (boot + live). Đường số 9 vì vậy KHÔNG CÒN TỒN TẠI như một call
 * site (`initInspectionStoreForward` không còn gọi trực tiếp bất kỳ tên nào trong
 * `TEN_CAC_HAM_GHI`) — dân số đường ghi giảm từ CHÍN xuống TÁM, và khoá miễn trừ tương ứng đã bị
 * XOÁ khỏi `MIEN_TRU_GHI_INSPECTION_WAL` (giữ lại sẽ hoá thạch — xem §3). §6 dưới đây là ca HỒI
 * QUY: nếu ai đó vá lùi (`initInspectionStoreForward` quay lại wire cứng), `initInspectionStoreForward`
 * sẽ TÁI XUẤT HIỆN như phạm vi bao quanh của một call site trong `TEN_CAC_HAM_GHI`, và §6 bắt
 * ngay — độc lập với mệnh đề BOOT bằng DB thật ở `server/db/walCayV2PhatLai.db.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  quetDuongGhiInspection,
  hamGhiConThatSu,
  khoaDuongGhi,
  MIEN_TRU_GHI_INSPECTION_WAL,
  TEN_CAC_HAM_GHI,
  TEN_HAM_WAL,
  type TepQuetGhi,
} from "./ghiInspectionWalScan";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

/** Năm file chứa CALL SITE của các hàm ghi — xem TRẦN mục (2): tập này CỐ ĐỊNH bằng tay. */
const DUONG_FILE_QUET = [
  "server/routers/machineApiRouters.ts",
  "server/routers/aoiPackageRouter.ts",
  "server/services/vision/acquisition/acquisitionWorker.ts",
  "server/services/vision/hotFolderService.ts",
  "server/services/inspection/inspectionStoreForward.ts",
] as const;

/** File ĐỊNH NGHĨA hai hàm ghi cấp DB — thêm vào cho §0 (cầu chì hoá thạch tên hàm). */
const DUONG_FILE_DINH_NGHIA = [...DUONG_FILE_QUET, "server/db/inspection.ts"] as const;

function docTep(duong: string): TepQuetGhi {
  return { duong, ma: readFileSync(join(REPO_ROOT, duong), "utf8") };
}

const TEPS_THAT = DUONG_FILE_QUET.map(docTep);
const TEPS_DINH_NGHIA_THAT = DUONG_FILE_DINH_NGHIA.map(docTep);

const QUET = quetDuongGhiInspection(TEPS_THAT);

/** Tám đường đã biết hôm nay — GHIM. Đổi tập này là một LỜI KHAI, không phải bảo trì im lặng. */
const GHIM_TEN_DUONG = [
  "server/routers/machineApiRouters.ts::ensureInspectionWalWired→submitInspectionTreeV2",
  "server/routers/machineApiRouters.ts::ensureInspectionWalWired→processInspectionSubmission",
  "server/routers/machineApiRouters.ts::submitInspection→submitInspectionTreeV2",
  "server/routers/machineApiRouters.ts::submitInspection→processInspectionSubmission",
  "server/routers/machineApiRouters.ts::runItem→processInspectionSubmission",
  "server/routers/aoiPackageRouter.ts::commit→persistInspectionAtomic",
  "server/services/vision/acquisition/acquisitionWorker.ts::submitCanonical→processInspectionSubmission",
  "server/services/vision/hotFolderService.ts::submitCanonical→processInspectionSubmission",
].sort();

/** Ba đường PHẢI có WAL thẳng (nhánh live thật của v1.x + v2.0). */
const GHIM_CO_WAL = [
  "server/routers/machineApiRouters.ts::submitInspection→submitInspectionTreeV2",
  "server/routers/machineApiRouters.ts::submitInspection→processInspectionSubmission",
  "server/routers/machineApiRouters.ts::runItem→processInspectionSubmission",
].sort();

/** Năm đường MIỄN TRỪ (bốn kiến trúc hợp lệ + một lỗ thật chưa vá, xem docblock trên). */
const GHIM_MIEN_TRU = [
  "server/routers/machineApiRouters.ts::ensureInspectionWalWired→submitInspectionTreeV2",
  "server/routers/machineApiRouters.ts::ensureInspectionWalWired→processInspectionSubmission",
  "server/routers/aoiPackageRouter.ts::commit→persistInspectionAtomic",
  "server/services/vision/acquisition/acquisitionWorker.ts::submitCanonical→processInspectionSubmission",
  "server/services/vision/hotFolderService.ts::submitCanonical→processInspectionSubmission",
].sort();

describe("§1 — CẦU CHÌ: bộ suy có thật sự nhìn thấy mã không", () => {
  it("không có ô mù", () => {
    expect(QUET.mu, "bộ suy tự khai có lời gọi không xác định được phạm vi bao quanh").toEqual([]);
  });

  it("★★★ tìm được ÍT NHẤT 2 đường (chống 'xanh vì quét trúng 0 thứ' — mệnh đề 1 của brief)", () => {
    expect(QUET.duong.length).toBeGreaterThanOrEqual(2);
  });

  it("★★★ trong số đó có CẢ v1.x LẪN v2.0 (không phải toàn một họ)", () => {
    const goiCacHam = new Set(QUET.duong.map((d) => d.goi));
    expect(goiCacHam.has("submitInspectionTreeV2"), "thiếu nhánh v2.0 (cây)").toBe(true);
    expect(
      goiCacHam.has("processInspectionSubmission") || goiCacHam.has("createProductInspection"),
      "thiếu nhánh v1.x (phẳng)",
    ).toBe(true);
  });
});

describe("§0 — bốn tên trong TEN_CAC_HAM_GHI còn là hàm THẬT (chống hoá thạch vị từ)", () => {
  it("cả bốn tên còn là FunctionDeclaration thật trên mã hôm nay", () => {
    const conThatSu = hamGhiConThatSu(TEPS_DINH_NGHIA_THAT);
    const matTich = TEN_CAC_HAM_GHI.filter((t) => !conThatSu.has(t));
    expect(matTich, "tên hàm ghi đã đổi/xoá — cập nhật TEN_CAC_HAM_GHI cho khớp mã thật").toEqual([]);
  });
});

describe("§2 — DÂN SỐ ĐƯỜNG GHI — GHIM", () => {
  it("đúng TÁM đường đã biết, không thừa không thiếu", () => {
    expect(
      QUET.duong.map((d) => khoaDuongGhi(d)).sort(),
      "Dân số đường ghi product_inspections đã đổi. Sửa GHIM_TEN_DUONG cho khớp SỐ ĐO ĐƯỢC — " +
        "đừng sửa cho xanh mà không đọc vì sao đổi.",
    ).toEqual(GHIM_TEN_DUONG);
  });
});

describe("§3 — ★★★ MỖI ĐƯỜNG CÓ WAL, HOẶC CÓ MIỄN TRỪ ĐÃ KÝ LÝ DO", () => {
  it(`đường KHÔNG có WAL ⇒ PHẢI có tên trong MIEN_TRU_GHI_INSPECTION_WAL`, () => {
    const thieu = QUET.duong.filter((d) => !d.coBaoVeWal && MIEN_TRU_GHI_INSPECTION_WAL[khoaDuongGhi(d)] === undefined);
    expect(
      thieu.map((d) => `${d.ten} (${d.duong}:${d.dong})`),
      "ĐƯỜNG NÀY KHÔNG CÓ WAL: không tới được `bufferSubmission` từ try bao quanh, và cũng " +
        "không có tên trong MIEN_TRU_GHI_INSPECTION_WAL (server/routers/ghiInspectionWalScan.ts). " +
        "Sửa MỘT trong hai: (a) bọc lời gọi ghi bằng try/catch → bufferSubmission, HOẶC " +
        "(b) thêm khoá vào MIEN_TRU_GHI_INSPECTION_WAL KÈM lý do đo được — không phải bỏ qua im lặng.",
    ).toEqual([]);
  });

  it("mọi miễn trừ có lý do THẬT (không phải chuỗi rỗng/khẩu vị)", () => {
    for (const [khoa, lyDo] of Object.entries(MIEN_TRU_GHI_INSPECTION_WAL)) {
      expect(typeof lyDo, `miễn trừ \`${khoa}\` không phải chuỗi`).toBe("string");
      expect(lyDo.length, `miễn trừ \`${khoa}\` thiếu lý do đủ dài để coi là đã ký`).toBeGreaterThan(30);
    }
  });

  it("sổ miễn trừ KHÔNG HOÁ THẠCH: mọi khoá còn là một đường ghi CÓ THẬT", () => {
    const khoaThat = new Set(QUET.duong.map((d) => khoaDuongGhi(d)));
    const con = Object.keys(MIEN_TRU_GHI_INSPECTION_WAL).filter((k) => !khoaThat.has(k));
    expect(con, "khoá này không còn là một đường ghi thật (đổi tên/gỡ bỏ) — xoá dòng miễn trừ").toEqual([]);
  });

  it("sổ miễn trừ không che giấu một đường THỰC RA đã có WAL — nối WAL rồi phải GỠ DÒNG", () => {
    const coWal = new Set(QUET.duong.filter((d) => d.coBaoVeWal).map((d) => khoaDuongGhi(d)));
    const thua = Object.keys(MIEN_TRU_GHI_INSPECTION_WAL).filter((k) => coWal.has(k));
    expect(thua, "đường này ĐÃ có WAL nhưng còn khoá trong sổ miễn trừ — xoá dòng miễn trừ tương ứng.").toEqual([]);
  });

  it("phép cộng khớp: có-WAL + miễn-trừ = toàn bộ dân số đường (không đường nào rơi ra ngoài cả hai)", () => {
    const coWal = QUET.duong.filter((d) => d.coBaoVeWal).map((d) => khoaDuongGhi(d)).sort();
    const mienTru = QUET.duong.filter((d) => khoaDuongGhi(d) in MIEN_TRU_GHI_INSPECTION_WAL).map((d) => khoaDuongGhi(d)).sort();
    expect(coWal).toEqual(GHIM_CO_WAL);
    expect(mienTru).toEqual(GHIM_MIEN_TRU);
    expect([...coWal, ...mienTru].sort()).toEqual(GHIM_TEN_DUONG);
  });
});

describe("§4 — BA CA CHUẨN trên mã THẬT", () => {
  it("submitInspection→submitInspectionTreeV2 — CÓ WAL (nhánh v2.0 live)", () => {
    const d = QUET.duong.find((x) => khoaDuongGhi(x) === "server/routers/machineApiRouters.ts::submitInspection→submitInspectionTreeV2");
    expect(d, "không thấy đường v2.0 live — bộ suy mất đường này").toBeDefined();
    expect(d?.coBaoVeWal).toBe(true);
  });

  it("submitInspection→processInspectionSubmission — CÓ WAL (nhánh v1.x live)", () => {
    const d = QUET.duong.find((x) => khoaDuongGhi(x) === "server/routers/machineApiRouters.ts::submitInspection→processInspectionSubmission");
    expect(d, "không thấy đường v1.x live — bộ suy mất đường này").toBeDefined();
    expect(d?.coBaoVeWal).toBe(true);
  });

  it("commit→persistInspectionAtomic (aoiPackageRouter) — KHÔNG có WAL, có miễn trừ đã ký", () => {
    const khoa = "server/routers/aoiPackageRouter.ts::commit→persistInspectionAtomic";
    const d = QUET.duong.find((x) => khoaDuongGhi(x) === khoa);
    expect(d, "không thấy đường commit ZIP — bộ suy mất đường này").toBeDefined();
    expect(d?.coBaoVeWal).toBe(false);
    expect(MIEN_TRU_GHI_INSPECTION_WAL[khoa]).toBeDefined();
  });
});

describe("§5 — ★★★ ĐỘT BIẾN THẬT: đường giả KHÔNG WAL bị bắt và NÊU TÊN, đường giả CÓ WAL thì KHÔNG", () => {
  /**
   * ⚠⚠ Không ghi file ra đĩa — chèn đột biến vào một BIẾN THỂ TRONG BỘ NHỚ của nội dung THẬT của
   * `machineApiRouters.ts` rồi chạy lại CHÍNH `quetDuongGhiInspection` (không phải một bản giản
   * lược riêng cho lưới này). Bốn file còn lại giữ nguyên nội dung THẬT. Không cần dọn dẹp
   * `git status` vì file thật KHÔNG BAO GIỜ bị đụng tới trên đĩa.
   */
  const MA_THAT_ROUTER = TEPS_THAT.find((t) => t.duong === "server/routers/machineApiRouters.ts")!.ma;
  const CAC_TEP_KHAC = TEPS_THAT.filter((t) => t.duong !== "server/routers/machineApiRouters.ts");
  const NEO = "export const machineApiRouter = router({";

  function chenTruocRouter(doanChen: string): string {
    const viTri = MA_THAT_ROUTER.indexOf(NEO);
    expect(viTri, "không tìm thấy điểm neo `export const machineApiRouter = router({` — bộ suy đã đổi neo?").toBeGreaterThan(-1);
    return MA_THAT_ROUTER.slice(0, viTri) + doanChen + "\n" + MA_THAT_ROUTER.slice(viTri);
  }

  it("★★★ (a) một hàm GHI GIẢ KHÔNG bọc try/catch/bufferSubmission ⇒ census phải bắt và NÊU TÊN nó", () => {
    const maDotBien = chenTruocRouter(
      `// ĐỘT BIẾN THỬ NGHIỆM (§5a) — đường ghi giả, KHÔNG WAL.\n` +
        `async function attackVectorNoWal(payload: unknown): Promise<void> {\n` +
        `  await createProductInspection(payload as never, undefined);\n` +
        `}\n`,
    );

    const laiQuet = quetDuongGhiInspection([{ duong: "server/routers/machineApiRouters.ts", ma: maDotBien }, ...CAC_TEP_KHAC]);
    const duongGia = laiQuet.duong.find((d) => d.ten === "attackVectorNoWal→createProductInspection");
    expect(duongGia, "bộ suy KHÔNG THẤY đường giả — lượng từ 'call site của hàm ghi' đã thủng").toBeDefined();
    expect(duongGia?.coBaoVeWal, "đường giả không hề gọi bufferSubmission").toBe(false);

    // Áp ĐÚNG luật §3 lên kết quả đột biến — đây là điều census thật sẽ làm khi ai đó thêm đường này.
    const khoaGia = khoaDuongGhi(duongGia!);
    const bịBắt = !duongGia!.coBaoVeWal && MIEN_TRU_GHI_INSPECTION_WAL[khoaGia] === undefined;
    expect(bịBắt, "census PHẢI bắt đường giả (không có WAL, không có miễn trừ)").toBe(true);

    // NGUYÊN VĂN thông điệp mà một lượt chạy census thật sẽ in ra cho người xem lỗi:
    const thongDiepThat = `${duongGia!.ten} (${duongGia!.duong}:${duongGia!.dong})`;
    expect(thongDiepThat.startsWith("attackVectorNoWal→createProductInspection")).toBe(true);
  });

  it("ĐỐI CHỨNG (b): hàm GHI GIẢ CÓ try/catch→bufferSubmission ⇒ KHÔNG bị bắt (chống 'vá quá tay')", () => {
    const maDotBien = chenTruocRouter(
      `// ĐỘT BIẾN THỬ NGHIỆM (§5b, đối chứng) — đường ghi giả, CÓ WAL.\n` +
        `async function attackVectorWithWal(payload: unknown): Promise<void> {\n` +
        `  try {\n` +
        `    await createProductInspection(payload as never, undefined);\n` +
        `  } catch (err) {\n` +
        `    await bufferSubmission(payload as never);\n` +
        `  }\n` +
        `}\n`,
    );

    const laiQuet = quetDuongGhiInspection([{ duong: "server/routers/machineApiRouters.ts", ma: maDotBien }, ...CAC_TEP_KHAC]);
    const duongGia = laiQuet.duong.find((d) => d.ten === "attackVectorWithWal→createProductInspection");
    expect(duongGia, "bộ suy KHÔNG THẤY đường đối chứng").toBeDefined();
    expect(duongGia?.coBaoVeWal, `CHỐNG VÁ QUÁ TAY: đường CÓ gọi ${TEN_HAM_WAL} thì KHÔNG được bắt`).toBe(true);

    const khoaGia = khoaDuongGhi(duongGia!);
    const bịBắt = !duongGia!.coBaoVeWal && MIEN_TRU_GHI_INSPECTION_WAL[khoaGia] === undefined;
    expect(bịBắt, "đường đối chứng KHÔNG được bị bắt").toBe(false);
  });

  it("cả hai đột biến KHÔNG chạm đĩa — file thật không đổi (chứng minh bằng nội dung đọc lại)", () => {
    const doc = readFileSync(join(REPO_ROOT, "server/routers/machineApiRouters.ts"), "utf8");
    expect(doc).toBe(MA_THAT_ROUTER);
    expect(doc.includes("attackVectorNoWal")).toBe(false);
    expect(doc.includes("attackVectorWithWal")).toBe(false);
  });
});

describe("§6 — ★★★ HỒI QUY: initInspectionStoreForward KHÔNG được tự gọi trực tiếp một hàm ghi", () => {
  /**
   * ★★★ 2026-08-29 (Task 3 hotfix) — `initInspectionStoreForward` (`inspectionStoreForward.ts`,
   * chạy Ở BOOT — server/_core/index.ts, TRƯỚC bất kỳ lượt live nào) TỪNG wire cứng `processFn`
   * vào `processInspectionSubmission` (v1.x) thay vì gọi `ensureInspectionWalWired` (dispatch
   * theo hình dạng của Task 2) — TÁI DIỄN lớp lỗi §QĐ-WAL-B qua cửa BOOT (đã vá: nay gọi thẳng
   * `ensureInspectionWalWired()`, export). Ca này canh bằng CHÍNH đầu ra của census (không chỉ
   * bằng mệnh đề BOOT trên DB thật ở `server/db/walCayV2PhatLai.db.test.ts`): nếu ai vá lùi về
   * wire cứng, `initInspectionStoreForward` sẽ tái xuất hiện làm phạm vi bao quanh của một call
   * site trong `TEN_CAC_HAM_GHI` — ca này bắt ngay, không cần chạy lưới DB thật (nhanh, không
   * cần `DATABASE_URL`).
   */
  it("initInspectionStoreForward không phải phạm vi bao quanh của bất kỳ đường ghi nào", () => {
    const truc = QUET.duong.filter((d) => d.tuNoi === "initInspectionStoreForward");
    expect(
      truc.map((d) => d.ten),
      "initInspectionStoreForward gọi TRỰC TIẾP một hàm ghi trở lại — ĐÚNG lớp lỗi Task 3 hotfix " +
        "đã đóng (wire cứng v1.x tại BOOT, tái diễn §QĐ-WAL-B). Phải gọi THẲNG " +
        "ensureInspectionWalWired() (machineApiRouters.ts, export) thay vì tự setProcessFn/" +
        "setDedupFn với processInspectionSubmission/inspectionAlreadyPersisted.",
    ).toEqual([]);
  });

  it("★★★ ĐỘT BIẾN THẬT: vá lùi initInspectionStoreForward về wire cứng ⇒ ca trên phải bắt lại", () => {
    const duongThat = TEPS_THAT.find((t) => t.duong === "server/services/inspection/inspectionStoreForward.ts")!;
    const NEO_INIT = "export async function initInspectionStoreForward(): Promise<void> {\n  if (!inspectionStoreForwardEnabled()) return;\n  const router = await import(\"../../routers/machineApiRouters\");\n  router.ensureInspectionWalWired();";
    expect(duongThat.ma.includes(NEO_INIT), "không tìm thấy thân hàm initInspectionStoreForward ĐÃ VÁ — bộ suy đã đổi neo?").toBe(true);

    const maDotBien = duongThat.ma.replace(
      NEO_INIT,
      "export async function initInspectionStoreForward(): Promise<void> {\n" +
        "  if (!inspectionStoreForwardEnabled()) return;\n" +
        '  const router = await import("../../routers/machineApiRouters");\n' +
        "  // ĐỘT BIẾN THỬ NGHIỆM (§6) — vá lùi về wire cứng v1.x.\n" +
        "  setProcessFn((payload) => router.processInspectionSubmission(payload as never));\n" +
        "  setDedupFn((payload) => router.inspectionAlreadyPersisted(payload as never));",
    );
    expect(maDotBien).not.toBe(duongThat.ma);

    const cacTepKhac = TEPS_THAT.filter((t) => t.duong !== duongThat.duong);
    const laiQuet = quetDuongGhiInspection([{ duong: duongThat.duong, ma: maDotBien }, ...cacTepKhac]);
    const truc = laiQuet.duong.filter((d) => d.tuNoi === "initInspectionStoreForward");
    expect(
      truc.map((d) => d.ten),
      "census PHẢI bắt lại initInspectionStoreForward→processInspectionSubmission khi vá lùi",
    ).toEqual(["initInspectionStoreForward→processInspectionSubmission"]);
    expect(truc[0]?.coBaoVeWal, "wire cứng KHÔNG gọi bufferSubmission").toBe(false);
  });

  it("file thật KHÔNG chạm đĩa — nội dung đọc lại khớp nguyên văn", () => {
    const duongThat = TEPS_THAT.find((t) => t.duong === "server/services/inspection/inspectionStoreForward.ts")!;
    const doc = readFileSync(join(REPO_ROOT, duongThat.duong), "utf8");
    expect(doc).toBe(duongThat.ma);
  });
});
