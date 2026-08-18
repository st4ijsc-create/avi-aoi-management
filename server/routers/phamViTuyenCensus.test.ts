/**
 * ★★★ 2026-08-18 — **CỔNG ĐIỀU TRA DÂN SỐ PHẠM VI ĐỌC, PHẦN TUYẾN EXPRESS.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ CỔNG THỨ HAI — VÀ VÌ SAO NÓ KHÔNG PHẢI "MỘT LƯỚI NỮA CHO MỘT BỀ MẶT NỮA"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `phamViDocCensus.test.ts` canh lượng từ trên **2.209 thủ tục tRPC** và tuyên bố ba điều nó chứng
 * minh được. Ngày 2026-08-18 một lượt đo trên **HTTP THẬT** tìm ra lỗ **THỨ CHÍN** của cùng bề mặt
 * dữ liệu ấy — `GET /api/public/products/:productCode/reference-image-file` — và cổng kia **không
 * thể** đỏ vì nó: tuyến ấy là `app.get(…)`, không nằm trong 2.209, không nằm trong sổ nợ.
 *
 * ⇒ File này canh **cùng một lượng từ**, trên tập còn lại:
 *
 *     ∀ tuyến `app.get/post/…("/…", …)` dưới `server/**`: nó phải rơi vào **ĐÚNG MỘT** nhóm, và
 *     nhóm **A** (chạm dữ liệu tenant mà không tầng nào lọc) chỉ được chứa mục **đã có tên trong
 *     `phamViTuyenBaseline.ts`**.
 *
 * ⚠⚠ Bộ suy là **CHUNG MỘT** với cổng tRPC (`quetPhamViDoc` trả cả `thuTuc` lẫn `tuyen` từ MỘT
 *    lượt quét). Hai bản luật cho cùng câu hỏi *"cái gì là dữ liệu tenant"* là cách chúng lệch
 *    nhau, và **bản lỏng hơn sẽ quyết định ai thấy gì**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ CỔNG XANH **KHÔNG** CHỨNG MINH KHÔNG CÒN RÒ RỈ. Ba thứ nó KHÔNG nói được, ghi ra ở đây:
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   (1) **Nó không phát biểu gì ở tầng HTTP.** Đây là một lưới **TĨNH trên cây cú pháp**: nó đọc
 *       mã, không gửi một gói tin nào. Nó chứng minh *"thân handler CÓ đưa danh tính vào lượt đọc
 *       dữ liệu"*, **không** chứng minh *"máy nhà máy A nhận 403"*. Phép đo HTTP thật vẫn là việc
 *       của người, và §6 dưới đây neo vào đúng cái tuyến đã được đo tay.
 *   (2) **Nó mù với tuyến TĨNH.** `app.use("/uploads", express.static(…))` phục vụ byte tệp,
 *       không qua một lượt đọc bảng nào — §1 ghim danh sách ấy để nó không im lặng lớn thêm.
 *   (3) **83 mục trong sổ là NỢ**, không phải 83 quyết định "chỗ này rò cũng được". §3 in con số
 *       ấy mỗi lượt chạy để không ai quên. (88 → 83 ngày 2026-08-18 khi năm tuyến ảnh được trả —
 *       xem `phamViTuyenBaseline.ts`; con số đến từ một lượt CHẠY LẠI bộ suy, không từ phép trừ.)
 */
import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  quetPhamViDoc,
  nhomTuyenCua,
  khoaTuyen,
  nhomCua,
  khoaCua,
  type NhomTuyen,
  type TuyenExpress,
} from "./phamViDocScan";
import { NO_PHAM_VI_TUYEN } from "./phamViTuyenBaseline";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const GOC_REPO = join(TEST_DIR, "..", "..");

const QUET = quetPhamViDoc(GOC_REPO);
const NHOM = new Map<NhomTuyen, TuyenExpress[]>();
for (const t of QUET.tuyen) {
  const n = nhomTuyenCua(t);
  NHOM.set(n, [...(NHOM.get(n) ?? []), t]);
}
const cua = (n: NhomTuyen): TuyenExpress[] => NHOM.get(n) ?? [];

/**
 * ★★★ CON SỐ GHIM (đo 2026-08-18, sau khi trả 3 mục — xem docblock `phamViTuyenBaseline.ts`).
 *
 * ⚠ Đổi một số ở đây là một **lời khai**, không phải một lượt bảo trì. Năm con số bị ràng buộc bởi
 * `A + C + D + S + U === tổng`, nên không sửa lén được một ô.
 */
const GHIM = { A: 83, C: 38, D: 71, S: 15, U: 16, tong: 223 } as const;

describe("§1 — CẦU CHÌ: bộ suy có thật sự nhìn thấy tuyến không", () => {
  it("★ không có ô MÙ nào (mỗi ô mù là một tuyến KHÔNG AI CANH)", () => {
    expect(
      QUET.mu,
      "Bộ suy tự khai là không còn đủ. Một `app.get(<biểu thức>, …)` không đặt tên được là một\n" +
        "tuyến nằm ngoài phép đếm — đọc từng dòng, đừng nới lượng từ.",
    ).toEqual([]);
  });

  it("quét trúng đủ tuyến (chống 'xanh vì quét trúng 0 thứ')", () => {
    // Ngưỡng đặt THẤP HƠN hẳn số đo (223) — nó chỉ bắt cái chết hẳn (đổi khung web, đổi hình dạng
    // đăng ký tuyến), không bắt độ trôi bình thường.
    expect(QUET.tuyen.length).toBeGreaterThan(180);
    // Chiều DƯƠNG: phải thấy CẢ tuyến gắn thẳng vào `app` LẪN tuyến của `express.Router()` con —
    // mất một trong hai nghĩa là bộ suy chỉ nhìn được một nửa cây.
    expect(new Set(QUET.tuyen.map((t) => t.bien)).size).toBeGreaterThan(1);
    expect(new Set(QUET.tuyen.map((t) => t.file)).size).toBeGreaterThan(8);
  });

  it("★ KHOÁ DUY NHẤT — hai tuyến không được cùng một khoá", () => {
    const khoa = QUET.tuyen.map(khoaTuyen);
    const trung = [...new Set(khoa.filter((k, i) => khoa.indexOf(k) !== i))];
    expect(trung, "Khoá trùng ⇒ sổ nợ gộp nhiều tuyến thành một mục.").toEqual([]);
  });

  it("★★ BỀ MẶT TĨNH được GHIM — bộ suy KHÔNG phát biểu được gì về nó", () => {
    // `express.static` phục vụ byte tệp thẳng từ đĩa: không lượt đọc bảng nào, nên MỌI vị từ ở đây
    // đều mù với nó. Ghim danh sách để một lượt gắn thư mục MỚI ra web phải được ký tên.
    // ⚠⚠ SỬA 2026-08-18 — câu cũ ở đây ghi: *"`/uploads` đang phục vụ ảnh kiểm của MỌI nhà máy mà
    //    không một phép xác thực nào — món nợ CÓ THẬT, chỉ là món nợ cổng này không đo được"*.
    //    Món nợ ấy nay **đã được vá**: một middleware cổng ảnh (`server/routes/_congAnh.ts`) đứng
    //    TRƯỚC cả handler resize lẫn `express.static`, sau cờ `ANH_CONG_MO`.
    // ⚠ Con số ghim đổi **609 → 642 → 652** vì hai lượt vá chèn middleware lên phía trên, KHÔNG
    //   phải vì một thư mục mới được gắn ra web: danh sách vẫn đúng HAI mục như cũ. Đây là con số
    //   ĐO ĐƯỢC từ bộ quét, không phải một con số nới ra cho lưới xanh.
    // ⚠⚠ Bộ suy vẫn **mù** với bề mặt tĩnh (nó phục vụ byte tệp, không đọc bảng nào) — cổng này vì
    //   thế KHÔNG chứng minh được `/uploads` đã có phòng vệ, **kể cả sau lượt uỷ quyền theo đường
    //   dẫn ngày 2026-08-18**. Phép chứng minh nằm ở ba chỗ KHÁC, và đây là chỗ trỏ tới chúng:
    //   `server/routes/uyQuyenAnhHinhDang.test.ts` (hình dạng + traversal, thuần),
    //   `server/routes/uyQuyenAnhPhamVi.db.test.ts` (âm đối xứng, CSDL thật), và một lượt HTTP
    //   THẬT bằng socket thô (ghi trong báo cáo). Ghim danh sách để một lượt gắn thư mục MỚI ra
    //   web vẫn phải được ký tên.
    expect(QUET.tuyenTinh.map((s) => s.split(" — ")[0])).toEqual([
      "server/_core/index.ts:652",
      "server/_core/vite.ts:58",
    ]);
  });
});

describe("§2 — MỖI TUYẾN VÀO ĐÚNG MỘT NHÓM", () => {
  it("★ tổng năm nhóm = tổng tuyến (không mục nào rơi ra ngoài, không mục nào đếm hai lần)", () => {
    const tong = (["A", "C", "D", "S", "U"] as const).reduce((s, n) => s + cua(n).length, 0);
    expect(tong).toBe(QUET.tuyen.length);
  });

  it("`nhomTuyenCua` là hàm TOÀN PHẦN — không tuyến nào cho nhóm ngoài tập", () => {
    const la = QUET.tuyen.filter((t) => !["A", "C", "D", "S", "U"].includes(nhomTuyenCua(t)));
    expect(la.map(khoaTuyen)).toEqual([]);
  });
});

describe("§3 — CON SỐ GHIM", () => {
  it("★ số từng nhóm ĐÚNG BẰNG số đã ghim", () => {
    const dem = {
      A: cua("A").length,
      C: cua("C").length,
      D: cua("D").length,
      S: cua("S").length,
      U: cua("U").length,
      tong: QUET.tuyen.length,
    };
    expect(
      dem,
      "Dân số tuyến đã đổi. Sửa `GHIM` cho khớp SỐ ĐO ĐƯỢC và ghi lý do — đừng sửa cho xanh.",
    ).toEqual(GHIM);
  });
});

describe("§4 — RÒ RỈ MỚI ⇒ ĐỎ (lý do tồn tại của cổng này)", () => {
  it("★★★ mọi tuyến nhóm (A) phải đã có tên trong SỔ NỢ", () => {
    const so = new Set(NO_PHAM_VI_TUYEN);
    const moi = cua("A")
      .filter((t) => !so.has(khoaTuyen(t)))
      .map(
        (t) =>
          `${khoaTuyen(t)} (dòng ${t.dong}; chạm: ${t.bangChung.join(", ") || "bảng tenant trực tiếp"})`,
      );
    expect(
      moi,
      "MỘT TUYẾN EXPRESS ĐỌC DỮ LIỆU TENANT MỚI KHÔNG CÓ BỘ LỌC PHẠM VI.\n" +
        "Hệ này KHÔNG có danh tính ngầm (RLS ở tầng CSDL nằm im — xem `phamViDocScan.ts`), nên một\n" +
        "handler không đưa danh tính ĐÃ XÁC THỰC vào lượt đọc thì KHÔNG tầng nào lọc được nó.\n" +
        "Ba hình dạng danh tính hợp lệ của tuyến REST — CHỌN ĐÚNG CÁI CỦA BỀ MẶT MÌNH:\n" +
        "  • phiên/JWT  → `phamViGoiNgoai(req)` + `nguoiXemCuaPhamVi()` (`server/routes/_phamViNgoai.ts`)\n" +
        "  • khoá API   → `req.apiPrincipal.tenantScope` (mẫu: `api/export/biRouter.ts`)\n" +
        "  • khoá MÁY   → `phamViNhaMayCuaMay()` (`server/routers/publicProductScope.ts`)\n" +
        "CẤM lấy danh tính từ `req.query`/`req.body` — đó là lời TỰ KHAI của người gọi.",
    ).toEqual([]);
  });
});

describe("§5 — SỔ NỢ KHÔNG ĐƯỢC HOÁ THẠCH", () => {
  it("★ mọi mục trong sổ vẫn còn là một tuyến CÓ THẬT", () => {
    const co = new Set(QUET.tuyen.map(khoaTuyen));
    const chet = NO_PHAM_VI_TUYEN.filter((k) => !co.has(k));
    expect(chet, "Sổ nợ giữ mục không còn tồn tại — xoá nó đi.").toEqual([]);
  });

  it("★★ mọi mục trong sổ vẫn ĐANG ở nhóm (A) — vá rồi thì phải GỠ DÒNG", () => {
    const nhomTheoKhoa = new Map(QUET.tuyen.map((t) => [khoaTuyen(t), nhomTuyenCua(t)]));
    const daVa = NO_PHAM_VI_TUYEN.filter(
      (k) => nhomTheoKhoa.has(k) && nhomTheoKhoa.get(k) !== "A",
    ).map((k) => `${k} → nay là nhóm ${nhomTheoKhoa.get(k)}`);
    expect(
      daVa,
      "Mục này đã được vá nhưng còn tên trong sổ nợ. Xoá dòng của nó khỏi `phamViTuyenBaseline.ts`\n" +
        "và giảm `GHIM.A` cho khớp — trả nợ phải NHÌN THẤY ĐƯỢC trong diff.",
    ).toEqual([]);
  });

  it("sổ nợ GOM THEO FILE, mỗi file một khối liền mạch, trong khối đã sắp xếp, không lặp", () => {
    const fileCua = (k: string): string => k.split("#")[0] ?? "";
    const thuTuFile: string[] = [];
    for (const k of NO_PHAM_VI_TUYEN) {
      const f = fileCua(k);
      if (thuTuFile[thuTuFile.length - 1] !== f) thuTuFile.push(f);
    }
    expect(
      [...new Set(thuTuFile)].length,
      "một file xuất hiện ở HAI khối rời nhau — gom chúng lại.",
    ).toBe(thuTuFile.length);
    for (const f of thuTuFile) {
      const khoi = NO_PHAM_VI_TUYEN.filter((k) => fileCua(k) === f);
      expect([...khoi].sort(), `khối \`${f}\` chưa sắp xếp`).toEqual(khoi);
    }
    expect(new Set(NO_PHAM_VI_TUYEN).size).toBe(NO_PHAM_VI_TUYEN.length);
  });
});

describe("§6 — BỐN CA CHUẨN ĐÃ ĐƯỢC VÁ (hoàn nguyên bản vá ⇒ ĐỎ)", () => {
  /**
   * Ca đầu là tuyến đã được **đo tay trên HTTP thật** (cổng 3111, 2026-08-18): trước bản vá, máy
   * của nhà máy A tải được ảnh sản phẩm của nhà máy B — **200 · image/png**. Ba ca sau là phần nợ
   * mà lượt tạo sổ này trả; hai trong số đó trả về `machines.apiKey`, tức một BÍ MẬT.
   */
  const CA_CHUAN = [
    "server/_core/index.ts#GET /api/public/products/:productCode/reference-image-file",
    "server/_core/index.ts#GET /api/external/machines",
    "server/_core/index.ts#GET /api/external/machines/by-code/:code",
    "server/_core/index.ts#GET /api/external/stations",
  ] as const;

  for (const k of CA_CHUAN) {
    it(`${k} — chạm dữ liệu tenant VÀ đã đưa danh tính vào lượt đọc`, () => {
      const t = QUET.tuyen.find((x) => khoaTuyen(x) === k);
      expect(t, `không còn thấy tuyến \`${k}\` — nó bị đổi tên/gỡ bỏ?`).toBeDefined();
      // Hai vế TÁCH RỜI có chủ ý: "vá" bằng cách làm tuyến thôi chạm dữ liệu tenant ⇒ vế đầu ĐỎ,
      // chứ không lặng lẽ xanh nhờ vế sau.
      expect(t?.chamTenant, "ca chuẩn phải VẪN chạm dữ liệu tenant — nếu không, vị từ đã trôi").toBe(true);
      expect(t?.danhTinhRoiTay, "danh tính phải ĐI VÀO lượt đọc (hoàn nguyên bản vá ⇒ ĐỎ)").toBe(true);
      expect(nhomTuyenCua(t as TuyenExpress)).toBe("S");
    });
  }

  it("★★ nhóm (S) ĐÚNG BẰNG tập đã ký — không tuyến nào lẻn vào", () => {
    // ⇐ ĐỎ theo hai chiều. THÊM một tên ⇒ hoặc là một lượt trả nợ (mừng — ký vào đây và xoá dòng
    //   khỏi sổ), hoặc là một lượt XANH GIẢ. Vị từ `danhTinhRoiTay` đòi danh tính đi vào một lời
    //   gọi **NẰM TRÊN ĐƯỜNG ĐỌC** (BẬC 2 ở `phamViDocScan.danhTinhRoiTayRest`) — luật ấy sinh ra
    //   từ một đột biến ĐÃ CHẠY và ĐÃ bắt được một lượt xanh giả; nhưng nó vẫn không phân biệt
    //   được *"đọc có cổng"* với *"đọc rồi lọc SAI trục"*. Cả 15 mục dưới đây đã được đọc TAY từng
    //   dòng ngày 2026-08-18 và xác nhận là thu hẹp THẬT.
    // ★ 2026-08-18 — NĂM mục ảnh chuyển từ nhóm A sang đây (10 → 15). Cả năm còn được kiểm bằng
    //   một lượt **HTTP THẬT** (`aoi_management_test`, cổng 3099): tài khoản nhà máy A nhận
    //   `403 · application/json · image_factory_scope_denied` trên đường dẫn của nhà máy B, và
    //   `200 · image/png` trên đường dẫn của chính A. Xem `phamViTuyenBaseline.ts`.
    expect(cua("S").map(khoaTuyen).sort()).toEqual([
      "server/_core/index.ts#GET /api/aoi/download/:packageId",
      "server/_core/index.ts#GET /api/aoi/image/:packageId/:fileName",
      "server/_core/index.ts#GET /api/external/machines",
      "server/_core/index.ts#GET /api/external/machines/by-code/:code",
      "server/_core/index.ts#GET /api/external/stations",
      "server/_core/index.ts#GET /api/inspection/:id/images",
      "server/_core/index.ts#GET /api/measurement-point/:id/reference-image",
      "server/_core/index.ts#GET /api/product-model/:id/reference-images",
      "server/_core/index.ts#GET /api/public/products/:productCode/reference-image-file",
      "server/api/export/biRouter.ts#GET /datasets",
      "server/api/export/biRouter.ts#GET /datasets/:name",
      "server/api/export/exportRouter.ts#GET /^\\/(yield|oee|defect-pareto)\\.(csv|json|xlsx)$/",
      "server/api/export/exportRouter.ts#GET /^\\/inspections\\.(csv|json|xlsx|pdf)$/",
      "server/api/export/exportRouter.ts#GET /^\\/measurements\\.(csv|json|xlsx|pdf)$/",
      "server/api/v1/moduleReads.ts#GET /ecosystem/kpi",
      // ⚠ `reportArtifactRoutes.ts#GET /api/reports/artifacts/:id/download` **KHÔNG** ở đây, và nó
      //   CÓ lọc theo người xem. Nó nằm trong SỔ NỢ vì `chamTenant` của nó bật do bao đóng của hàm
      //   XÁC THỰC (`api_keys` mang `factoryCode`), còn `report_artifacts` thì không thuộc tenant
      //   nên `getDownloadTarget` không nằm trên đường đọc mà vị từ đo được. Xem chú thích tại chỗ
      //   trong `phamViTuyenBaseline.ts`.
    ]);
  });
});

describe("§7 — ĐỘT BIẾN THẬT: cổng có ĐỎ khi thêm một tuyến đọc tenant KHÔNG LỌC không", () => {
  /**
   * ⚠⚠ Không có ô này thì §4 xanh **không chứng minh gì**: một vị từ luôn trả "không có mục mới"
   * cũng cho đúng màu ấy. Nên ô này **ghi thật một tuyến rò ra đĩa**, chạy lại **đúng** bộ suy đang
   * canh sản phẩm, rồi đòi nó bị bắt — **và đòi thông điệp gọi ĐÍCH DANH tuyến ấy**.
   *
   * Ba lời khai, phá ba kiểu vá-cổng-cho-xanh khác nhau:
   *   (a) tuyến mới rơi vào nhóm **A** — vị từ nhận ra hình dạng rò;
   *   (b) nó **không** có tên trong sổ nợ ⇒ §4 ĐỎ, và tên nó có mặt trong danh sách §4 in ra;
   *   (c) bản ĐỐI CHỨNG **có** phạm vi người gọi rơi vào nhóm **S** — chống "vá quá tay": một cổng
   *       bắt TẤT CẢ cũng thoả (a) và (b), nhưng sẽ làm hỏng (c).
   */
  const FILE_DOT_BIEN = join(GOC_REPO, "server", "routes", "__dotBienTuyenPhamVi.ts");
  const MA = `import type { Express, Request, Response } from "express";
import * as db from "../db";

/** Tệp ĐỘT BIẾN do \`phamViTuyenCensus.test.ts\` §7 sinh ra và tự xoá. KHÔNG gắn vào app thật. */
export function dangKyDotBienTuyen(app: Express): void {
  // (a)(b) — ĐỌC toàn đội máy, KHÔNG một phép thu hẹp nào: đúng hình dạng của lỗ thứ chín.
  app.get("/api/__dot-bien/ro-ri", async (_req: Request, res: Response) => {
    res.json({ machines: await db.getMachines() });
  });
  // (c) — ĐỐI CHỨNG: cùng lượt đọc, có phạm vi người gọi ⇒ phải KHÔNG bị bắt.
  app.get("/api/__dot-bien/da-loc", async (req: Request, res: Response) => {
    const { phamViGoiNgoai, nguoiXemCuaPhamVi } = await import("./_phamViNgoai");
    const phamVi = phamViGoiNgoai(req);
    res.json({ machines: await db.getMachines(nguoiXemCuaPhamVi(phamVi)) });
  });
}
`;

  it("★★★ tuyến rò MỚI ⇒ nhóm A + KHÔNG có trong sổ nợ; bản đã lọc ⇒ nhóm S", () => {
    expect(existsSync(FILE_DOT_BIEN), "file đột biến còn sót từ lượt trước — dọn đi trước khi chạy").toBe(false);
    try {
      writeFileSync(FILE_DOT_BIEN, MA, "utf8");
      const lai = quetPhamViDoc(GOC_REPO);
      const tim = (duong: string): TuyenExpress | undefined =>
        lai.tuyen.find((t) => t.file.endsWith("__dotBienTuyenPhamVi.ts") && t.duong === duong);

      const roRi = tim("/api/__dot-bien/ro-ri");
      expect(roRi, "bộ suy KHÔNG THẤY tuyến mới — lượng từ đã thủng, mọi ô khác vô nghĩa").toBeDefined();
      expect(roRi?.chamTenant, "tuyến rò phải được nhận ra là chạm dữ liệu tenant").toBe(true);
      expect(nhomTuyenCua(roRi as TuyenExpress)).toBe("A");
      expect(NO_PHAM_VI_TUYEN).not.toContain(khoaTuyen(roRi as TuyenExpress));

      // ⚠ Cầu chì chống "ĐỎ nhưng không nói được ĐỎ Ở ĐÂU": dựng lại đúng danh sách mà §4 in ra và
      //   đòi tên tuyến rò có mặt trong đó. Một cổng đỏ mà không gọi đích danh thì người sau sẽ
      //   tắt nó đi thay vì đi sửa.
      const so = new Set(NO_PHAM_VI_TUYEN);
      const moi = lai.tuyen
        .filter((t) => nhomTuyenCua(t) === "A" && !so.has(khoaTuyen(t)))
        .map(khoaTuyen);
      expect(moi).toContain(khoaTuyen(roRi as TuyenExpress));

      const daLoc = tim("/api/__dot-bien/da-loc");
      expect(daLoc).toBeDefined();
      expect(daLoc?.chamTenant, "bản đối chứng phải VẪN chạm dữ liệu tenant").toBe(true);
      expect(nhomTuyenCua(daLoc as TuyenExpress), "CHỐNG VÁ QUÁ TAY: có phạm vi ⇒ KHÔNG bị bắt").toBe("S");
    } finally {
      rmSync(FILE_DOT_BIEN, { force: true });
    }
    expect(existsSync(FILE_DOT_BIEN), "phép đột biến phải tự dọn — file rò không được ở lại cây").toBe(false);
  }, 180_000);
});

describe("§8 — NHÓM (U): lượt UỶ QUYỀN là một PHÉP NỐI CÓ KIỂM CHỨNG, không phải một cái nhãn", () => {
  /**
   * 16 tuyến `/api/machine/**` và `/api/public/**` chỉ dựng `createContext({req,res})` rồi gọi
   * `appRouter.createCaller(ctx).x.y(…)`. Phán quyết phạm vi của chúng **ĐÚNG BẰNG** phán quyết
   * của thủ tục đích — đã được đếm trong 2.209. Nếu không nối lại, nhóm (U) chỉ là một chỗ trốn.
   */
  const nhomThuTuc = new Map(QUET.thuTuc.map((t) => [khoaCua(t), nhomCua(t)]));

  it("★★ mọi đích uỷ quyền GIẢI ĐƯỢC về một thủ tục tRPC CÓ THẬT", () => {
    const hong = cua("U")
      .flatMap((t) => t.uyQuyen.map((k) => ({ t, k })))
      .filter(({ k }) => !nhomThuTuc.has(k))
      .map(({ t, k }) => `${khoaTuyen(t)} → ${k}`);
    expect(
      hong,
      "Bản đồ alias `appRouter` không giải được đích này ⇒ tuyến ấy đang ở nhóm (U) mà KHÔNG ai\n" +
        "biết nó uỷ quyền cho cái gì — tức (U) trở thành chỗ trốn. Xem `giaiAlias` ở `phamViDocScan.ts`.",
    ).toEqual([]);
  });

  it("★★★ tuyến UỶ QUYỀN cho một thủ tục nhóm (A) phải là tập ĐÃ KÝ", () => {
    // Đây là lời khai QUAN TRỌNG NHẤT của §8: một tuyến REST rò **qua** một món nợ tRPC đã có tên
    // trong `phamViDocBaseline.ts`. Không ghim thì lỗ ấy có hai lớp vỏ (REST → tRPC) và không sổ
    // nào nói ra được rằng nó **cũng** lộ ra ngoài qua HTTP thuần.
    const roQuaUyQuyen = cua("U")
      .filter((t) => t.uyQuyen.some((k) => nhomThuTuc.get(k) === "A"))
      .map((t) => `${khoaTuyen(t)} → ${t.uyQuyen.filter((k) => nhomThuTuc.get(k) === "A").join(", ")}`)
      .sort();
    expect(roQuaUyQuyen).toEqual([
      "server/_core/index.ts#GET /api/machine/config → server/routers/hierarchyRouters.ts#machineRouter.config",
    ]);
  });

  it("★ số tuyến uỷ quyền ĐÚNG BẰNG số đã ghim (thêm một proxy mới phải được ký)", () => {
    expect(cua("U").length).toBe(GHIM.U);
  });
});
