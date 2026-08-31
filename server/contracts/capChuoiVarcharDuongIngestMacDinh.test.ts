// server/contracts/capChuoiVarcharDuongIngestMacDinh.test.ts
//
// Pha 1E Task 3 (BG-69) — "census schema-walk hẹp hơn lời khai, LẦN THỨ BA".
//
// Đo được TRƯỚC bản vá này: census (`capChuoiVarcharScan.ts`) chỉ soi ĐÚNG hai
// schema (`machineDataContractV2`, `metaJsonSchema`). `submitInspectionCoreObject`
// (machineApiRouters.ts) — hợp đồng v1.x của CHÍNH hai cửa `submitInspection`/
// `submitInspectionBatch` mà `machineDataContractV2` (hợp đồng v2.0 cây) đã
// được soi — ĐÃ `export` từ Pha 1D Task 5 với chú thích "chỉ để census soi
// được" nhưng 0 census nào thực sự soi nó. Sau bản vá 9 trường ở Pha 1D, nó
// còn 20 lá chuỗi không `.max()`, 3 lá chạm cột thật. Cùng lúc, `presign`
// (`aoiPackageRouter.ts`, cửa thứ sáu) mang `inspectionId` INSERT thẳng vào
// `inspection_packages.packageId` varchar(100) mà không hề có `.max()` — một
// lỗ `22001` THẬT, xảy ra Ở BƯỚC TRƯỚC `metaJsonSchema` (meta.json chỉ xuất
// hiện sau khi ZIP đã tải lên xong).
//
// File này canh BỐN mệnh đề của brief:
//   §1 — DANH SÁCH ĐẦY ĐỦ schema census phải soi (mệnh đề 1) + walker XANH
//        trên CẢ SÁU, với danh sách miễn trừ NHỎ tường minh.
//   §2 — HAI bảng kiểm kê MỚI (`KIEM_KE_SUBMIT_INSPECTION_CORE`,
//        `KIEM_KE_PRESIGN`, `capChuoiVarcharScan.ts`) khớp SỐ ĐO ĐƯỢC, và CA
//        BIÊN trên TOÀN BỘ hai bảng (mệnh đề 2 + 3: đúng-bằng-sức-chứa HỢP LỆ).
//   §3 — CHỐNG HỒI QUY: mẫu máy THẬT vẫn parse `success:true` qua
//        `machineDataContractV2` (đường v2.0), và một payload v1.x tối thiểu
//        vẫn parse qua `submitInspectionCoreObject` SAU khi siết.
//   §4 — HAI ĐỘT BIẾN BẮT BUỘC (mệnh đề 4): (a) trường chuỗi MỚI không
//        `.max()` ở BẤT KỲ schema nào trong sáu ⇒ census ĐỎ nêu đúng tên,
//        KHÔNG cần sửa bảng; (b) trường bọc `.transform()` ⇒ walker BÁO ĐỘNG
//        (throw), không im lặng bỏ qua — kèm ca đối chứng `.default()` (TRONG
//        SUỐT, không báo động — vì `machineDataContractV2.schemaVersion` là
//        một `.default()` THẬT đang chạy sản xuất, xem `capChuoiVarcharScan.ts`).
//
// ══════════════════════════════════════════════════════════════════════════
// ★★★ Pha 1F Task 3 (BG-80) — §0 MỚI: "biên tựa vào census cửa ingest" chuyển
// từ LỜI VĂN sang LIÊN KẾT MÃ.
// ══════════════════════════════════════════════════════════════════════════
// Đo được TRƯỚC bản vá này: khối chú thích §1 phía dưới (giữ nguyên, KHÔNG bị
// xoá — nó vẫn đúng VỀ NỘI DUNG) tự nhận "tái dùng NGUYÊN VĂN cửa ingest mà
// `cuaIngestScan.ts` đã xác lập" — nhưng file này KHÔNG hề `import` bất cứ gì
// từ `cuaIngestScan.ts`; `laTenCuaIngest` còn CHƯA được export; và
// `DANH_SACH_SCHEMA_INGEST` là một mảng VIẾT TAY, đối chiếu bằng
// `expect(length).toBe(6)` — con số do NGƯỜI ĐẾM, không phải do MÃ tính ra.
// "Tái dùng nguyên văn" thật ra là "tái tạo cùng REGEX bằng lời văn trong
// comment" — không phải liên kết mã, dù chữ dùng đọc như một liên kết.
//
// §0 sửa bằng chọn (a) CHO PHẦN RẺ: import + gọi THẬT `quetCuaIngest`/
// `laTenCuaIngest`/`laTenCuaIngestZip` (nay đã export) — CÙNG census mà
// `cuaIngestCensus.test.ts` tin cậy — rồi buộc HAI điều bằng mã, không lời:
//   (1) tập TÊN CỬA trong `CUA_TOI_TEN_SCHEMA` (mapping cửa → tên schema mong
//       đợi) phải khớp CHÍNH XÁC tập cửa THẬT mà `quetCuaIngest` tìm được —
//       không đoán số 7, tính ra.
//   (2) MỖI tên schema trong mapping đó phải THẬT SỰ tới được (đệ quy AST,
//       `dinhDanhOInput` — xem `cuaIngestScan.ts`) TỪ CHÍNH tham số truyền cho
//       `.input(...)` của cửa đó — không phải một cặp tên trùng nhau tình cờ.
// `DANH_SACH_SCHEMA_INGEST` (§1, giữ nguyên cấu trúc bảng cũ) nay được đối
// chiếu với tập tên schema SUY RA từ `CUA_TOI_TEN_SCHEMA` — con số không còn
// là một hằng số 6 đứng một mình.
//
// ⚠ GIỚI HẠN THẬT, KHÔNG PHỦ NHẬN (chọn (b) CHO PHẦN KHÔNG RẺ): `commit` →
// `metaJsonSchema` KHÔNG buộc được ở mức `.input()` — `meta.json` được parse
// TRONG thân `.mutation()` (sau khi tải ZIP về), `.input()` của `commit` chỉ
// mang `apiKey/machineCode/packageId/sizeBytes/sha256`, không hề nhắc tới
// `metaJsonSchema`. §0 đo THẲNG điều này (kỳ vọng RỖNG ở phạm vi `.input()`)
// thay vì giả vờ đã buộc được — chỉ dùng phạm vi TOÀN THÂN thủ tục
// (`dinhDanhCaThan`, RỘNG HƠN, YẾU HƠN: một tên xuất hiện lại trong logic xử
// lý cũng tính, không chỉ ở input) làm bằng chứng "còn được nhắc tới ở đâu đó
// trong `commit`", KHÔNG phải bằng chứng "hình dạng đăng ký chưa hề bị sửa".
// Đây KHÔNG phải một lỗ MỚI do §0 tạo ra — nó tồn tại từ Pha 1D Task 5 (câu
// "commit's OWN input schema … KHÔNG nằm trong danh sách" ở khối §1 dưới đây
// đã nói y hệt); §0 chỉ dừng việc NGẦM để `commit` hưởng chung một mức đảm bảo
// với sáu cửa kia.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { machineDataContractV2 } from "./machineDataContractV2";
import {
  KIEM_KE_SUBMIT_INSPECTION_CORE,
  KIEM_KE_PRESIGN,
  kiemKeTheoBang,
  kiemTraToanBoTruongChuoi,
  duyetTimTruongChuoi,
  duongDanDuLieu,
  type MucCapChuoi,
} from "./capChuoiVarcharScan";
import {
  submitInspectionCoreObject,
  submitProcessResultCoreObject,
  syncEdgeResultsCoreObject,
  machineApiRouter,
} from "../routers/machineApiRouters";
import { presignCoreObject, metaJsonSchema, aoiPackageRouter } from "../routers/aoiPackageRouter";
import {
  quetCuaIngest,
  laTenCuaIngest,
  laTenCuaIngestZip,
  TEN_BIEN_ROUTER_ZIP,
  coLoiGoiParseTrenSchema,
} from "../routers/cuaIngestScan";

const MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\dashboard-sample.json";

// Chụp NGUYÊN VĂN hai file nguồn bị lượt này CHỈNH SỬA THẬT (không phải một
// mutation trong bộ nhớ — khác cơ chế "chụp/so khớp" của các lưới §4 mutation
// khác trong dự án, dùng ở ĐÂY để chứng minh CÁC CA ĐỘT BIẾN trong CHÍNH file
// test này không vô tình ghi đè lên hai file đã sửa thật sự).
const DUONG_MACHINE_API = new URL("../routers/machineApiRouters.ts", import.meta.url);
const DUONG_AOI_PACKAGE = new URL("../routers/aoiPackageRouter.ts", import.meta.url);
const NOI_DUNG_MACHINE_API_GOC = readFileSync(DUONG_MACHINE_API, "utf8");
const NOI_DUNG_AOI_PACKAGE_GOC = readFileSync(DUONG_AOI_PACKAGE, "utf8");

// ════════════════════════════════════════════════════════════════════════════
// §0 — ★★★ BG-80: CỬA ↔ SCHEMA nối bằng MÃ THẬT (không phải lời văn).
// ════════════════════════════════════════════════════════════════════════════
// Chạy LẠI ĐÚNG census mà `cuaIngestCensus.test.ts` tin cậy (cùng hàm
// `quetCuaIngest`, cùng vị từ, cùng NỘI DUNG file — `NOI_DUNG_MACHINE_API_GOC`/
// `NOI_DUNG_AOI_PACKAGE_GOC` đã snapshot ở trên) — KHÔNG viết một bộ quét
// thứ hai (cấm theo tiền lệ `cuaIngestScan.ts`), KHÔNG tự đếm/tự đoán tên cửa.
const QUET_MACHINE = quetCuaIngest("server/routers/machineApiRouters.ts", NOI_DUNG_MACHINE_API_GOC);
const QUET_ZIP = quetCuaIngest("server/routers/aoiPackageRouter.ts", NOI_DUNG_AOI_PACKAGE_GOC, {
  tenBienRouter: TEN_BIEN_ROUTER_ZIP,
  laTenCua: laTenCuaIngestZip,
});
const QUET_CUA = [...QUET_MACHINE.cua, ...QUET_ZIP.cua];

/**
 * Mapping "cửa → (các) tên schema mong đợi tới được TỪ CHÍNH tham số `.input(...)`
 * của cửa đó". `commit` cố ý map tới `[]` (RỖNG) — xem khối chú thích lớn ở
 * đầu file: `.input()` của `commit` KHÔNG hề mang `metaJsonSchema`, ánh xạ RỖNG
 * ở đây là PHÁT BIỂU TRUNG THỰC, không phải một ô quên điền.
 */
const CUA_TOI_TEN_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  submitInspection: ["submitInspectionCoreObject", "machineDataContractV2"],
  submitInspectionBatch: ["submitInspectionCoreObject"],
  submitProcessResult: ["submitProcessResultCoreObject"],
  submitProcessResultBatch: ["submitProcessResultCoreObject"],
  syncEdgeResults: ["syncEdgeResultsCoreObject"],
  presign: ["presignCoreObject"],
  commit: [],
};

describe("§0a — CẦU CHÌ: census cửa (quetCuaIngest) tìm được ≥7 cửa (chống 'xanh vì quét trúng 0 thứ')", () => {
  it("không có ô mù (gộp cả hai lượt quét)", () => {
    expect([...QUET_MACHINE.mu, ...QUET_ZIP.mu]).toEqual([]);
  });

  it("tìm được ĐÚNG 7 cửa — cùng con số GHIM_TEN_CUA của cuaIngestCensus.test.ts", () => {
    expect(QUET_CUA.length).toBe(7);
  });
});

describe("§0b — ★★★ CUA_TOI_TEN_SCHEMA khớp ĐÚNG tập cửa THẬT (không phải bảy cái tên đoán tay)", () => {
  it("khoá của CUA_TOI_TEN_SCHEMA === tập tên cửa mà quetCuaIngest tìm được", () => {
    expect(Object.keys(CUA_TOI_TEN_SCHEMA).sort()).toEqual(QUET_CUA.map((c) => c.ten).sort());
  });
});

describe("§0c — ★★★ MỖI cửa (trừ commit) ↔ ĐÚNG schema nó ĐĂNG KÝ ở .input() — bằng AST, không bằng tên trùng tình cờ", () => {
  for (const [ten, tenSchemaMongDoi] of Object.entries(CUA_TOI_TEN_SCHEMA)) {
    if (tenSchemaMongDoi.length === 0) continue; // commit — xem §0d
    it(`${ten} — dinhDanhOInput chứa ĐỦ [${tenSchemaMongDoi.join(", ")}] (tới được TỪ tham số .input() thật)`, () => {
      const cua = QUET_CUA.find((c) => c.ten === ten);
      expect(cua, `không tìm thấy cửa ${ten} trong census`).toBeDefined();
      expect(cua!.dinhDanhOInput, `${ten}: .input() không tìm thấy trong subtree`).not.toBeNull();
      for (const tenSchema of tenSchemaMongDoi) {
        expect(
          cua!.dinhDanhOInput!.has(tenSchema),
          `${ten}: .input() KHÔNG nhắc tới định danh "${tenSchema}" — census .max() đang soi một schema ` +
            `KHÔNG LIÊN QUAN gì tới cửa thật này (đúng lỗ BG-80).`,
        ).toBe(true);
      }
    });
  }
});

describe("§0d — ★★★ commit ↔ metaJsonSchema: GIỚI HẠN THẬT, đo bằng mã, KHÔNG che giấu", () => {
  it("commit — .input() KHÔNG nhắc tới metaJsonSchema (ĐÚNG — meta.json parse TRONG thân .mutation(), không phải .input())", () => {
    const cua = QUET_CUA.find((c) => c.ten === "commit");
    expect(cua).toBeDefined();
    expect(cua!.dinhDanhOInput, "commit .input() không tìm thấy").not.toBeNull();
    expect(
      cua!.dinhDanhOInput!.has("metaJsonSchema"),
      "commit.input() ĐÃ nhắc tới metaJsonSchema — nếu đúng, mệnh đề 'không buộc được ở .input()' đã lỗi thời, cập nhật docblock",
    ).toBe(false);
  });

  it("commit — dinhDanhCaThan (TOÀN THÂN thủ tục) CÓ nhắc tới metaJsonSchema — bằng chứng YẾU (chỉ 'định danh còn xuất hiện đâu đó', KHÔNG phân biệt được một type query `z.infer<typeof metaJsonSchema>` với một lời gọi `.parse()` thật — xem §0d2 ngay dưới cho phép đo LIVE của giới hạn này; §0d3 là bằng chứng CHẶT thay thế)", () => {
    const cua = QUET_CUA.find((c) => c.ten === "commit");
    expect(cua!.dinhDanhCaThan.has("metaJsonSchema")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §0d2 — ★★★ Pha 1F Task 8 (I-3) — ĐO LIVE giới hạn của §0d (dinhDanhCaThan):
// xoá lời gọi `.parse()` thật nhưng GIỮ type annotation `z.infer<typeof
// metaJsonSchema>` ⇒ bằng chứng CŨ vẫn "xanh giả", trong khi hàm MỚI
// (`coLoiGoiParseTrenSchema`, §0d3) phải ĐỎ. Đúng đột biến người review đã
// chạy tay và bắt được: "xoá metaJsonSchema.parse(...) ⇒ VẪN true".
// ════════════════════════════════════════════════════════════════════════════
describe("§0d2 — ĐỘT BIẾN: xoá .parse() thật, GIỮ type query z.infer<typeof metaJsonSchema>", () => {
  const NEO = "metaData = metaJsonSchema.parse(JSON.parse(metaContent));";
  const viTri = NOI_DUNG_AOI_PACKAGE_GOC.indexOf(NEO);
  const maDotBien =
    viTri > -1
      ? NOI_DUNG_AOI_PACKAGE_GOC.slice(0, viTri) +
        "metaData = JSON.parse(metaContent) as z.infer<typeof metaJsonSchema>; // BỎ QUA VALIDATION — chỉ ép kiểu" +
        NOI_DUNG_AOI_PACKAGE_GOC.slice(viTri + NEO.length)
      : NOI_DUNG_AOI_PACKAGE_GOC;

  it("điểm neo `metaData = metaJsonSchema.parse(...)` còn tồn tại trên mã thật — bộ suy đã đổi neo?", () => {
    expect(viTri).toBeGreaterThan(-1);
  });

  it("★ ĐỐI CHỨNG — bằng chứng CŨ (dinhDanhCaThan) vẫn 'xanh giả' trên mã đã mất .parse(): type query z.infer<typeof metaJsonSchema> (dòng khai `let metaData`, KHÔNG bị đột biến này chạm tới) vẫn đủ để dinhDanhCaThan.has('metaJsonSchema') === true", () => {
    const laiQuet = quetCuaIngest("server/routers/aoiPackageRouter.ts", maDotBien, {
      tenBienRouter: TEN_BIEN_ROUTER_ZIP,
      laTenCua: laTenCuaIngestZip,
    });
    const cua = laiQuet.cua.find((c) => c.ten === "commit");
    expect(cua, "không tìm thấy cửa commit sau đột biến").toBeDefined();
    expect(
      cua!.dinhDanhCaThan.has("metaJsonSchema"),
      "ĐÚNG lỗ được báo cáo: mất .parse() nhưng dinhDanhCaThan vẫn true vì type annotation còn nguyên",
    ).toBe(true);
  });

  it("★★★ bằng chứng MỚI (coLoiGoiParseTrenSchema) PHẢI ĐỎ: không còn CALL EXPRESSION .parse()/.safeParse() nào trên metaJsonSchema trong commit", () => {
    expect(
      coLoiGoiParseTrenSchema("server/routers/aoiPackageRouter.ts", maDotBien, "commit", "metaJsonSchema", {
        tenBienRouter: TEN_BIEN_ROUTER_ZIP,
        laTenCua: laTenCuaIngestZip,
      }),
    ).toBe(false);
  });

  it("mã thật KHÔNG hề bị đụng bởi đột biến trong chính test này (đọc lại đĩa, so nguyên văn)", () => {
    expect(readFileSync(DUONG_AOI_PACKAGE, "utf8")).toBe(NOI_DUNG_AOI_PACKAGE_GOC);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §0d3 — ★★★ bằng chứng CHẶT THẬT (thay thế §0d cho lời khai "commit gọi
// .parse() trên metaJsonSchema"): CALL EXPRESSION .parse()/.safeParse() thật.
// ════════════════════════════════════════════════════════════════════════════
describe("§0d3 — ★★★ commit CÓ lời gọi metaJsonSchema.parse(...)/.safeParse(...) THẬT (bằng chứng CHẶT — CALL EXPRESSION, không phải 'định danh xuất hiện đâu đó')", () => {
  it("mã THẬT hôm nay: coLoiGoiParseTrenSchema(commit, metaJsonSchema) === true", () => {
    expect(
      coLoiGoiParseTrenSchema(
        "server/routers/aoiPackageRouter.ts",
        NOI_DUNG_AOI_PACKAGE_GOC,
        "commit",
        "metaJsonSchema",
        { tenBienRouter: TEN_BIEN_ROUTER_ZIP, laTenCua: laTenCuaIngestZip },
      ),
    ).toBe(true);
  });

  it("★ ĐỐI CHỨNG — đổi lời gọi sang MỘT SCHEMA KHÁC (không phải metaJsonSchema) ⇒ coLoiGoiParseTrenSchema('metaJsonSchema') phải ĐỎ (chống 'vá quá tay' — hàm không được trả true cho BẤT KỲ .parse() nào, chỉ cho đúng schema hỏi tới)", () => {
    const NEO = "metaJsonSchema.parse(JSON.parse(metaContent))";
    const viTri = NOI_DUNG_AOI_PACKAGE_GOC.indexOf(NEO);
    expect(viTri, "không tìm thấy điểm neo — bộ suy đã đổi neo?").toBeGreaterThan(-1);
    const maDotBien =
      NOI_DUNG_AOI_PACKAGE_GOC.slice(0, viTri) +
      "schemaKhongLienQuanGiCa.parse(JSON.parse(metaContent))" +
      NOI_DUNG_AOI_PACKAGE_GOC.slice(viTri + NEO.length);

    expect(
      coLoiGoiParseTrenSchema("server/routers/aoiPackageRouter.ts", maDotBien, "commit", "metaJsonSchema", {
        tenBienRouter: TEN_BIEN_ROUTER_ZIP,
        laTenCua: laTenCuaIngestZip,
      }),
    ).toBe(false);

    expect(readFileSync(DUONG_AOI_PACKAGE, "utf8")).toBe(NOI_DUNG_AOI_PACKAGE_GOC);
  });

  it("★ ĐỐI CHỨNG — safeParse() cũng được nhận diện (không chỉ parse())", () => {
    const NEO = "metaData = metaJsonSchema.parse(JSON.parse(metaContent));";
    const viTri = NOI_DUNG_AOI_PACKAGE_GOC.indexOf(NEO);
    expect(viTri).toBeGreaterThan(-1);
    const maDotBien =
      NOI_DUNG_AOI_PACKAGE_GOC.slice(0, viTri) +
      "{ const r = metaJsonSchema.safeParse(JSON.parse(metaContent)); if (r.success) metaData = r.data; }" +
      NOI_DUNG_AOI_PACKAGE_GOC.slice(viTri + NEO.length);

    expect(
      coLoiGoiParseTrenSchema("server/routers/aoiPackageRouter.ts", maDotBien, "commit", "metaJsonSchema", {
        tenBienRouter: TEN_BIEN_ROUTER_ZIP,
        laTenCua: laTenCuaIngestZip,
      }),
    ).toBe(true);

    expect(readFileSync(DUONG_AOI_PACKAGE, "utf8")).toBe(NOI_DUNG_AOI_PACKAGE_GOC);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §0b2 — ★★★ Pha 1F Task 8 (I-3) — GHIM chống PHÌNH sổ miễn AST-level. Đo được
// TRƯỚC bản sửa này: `CUA_TOI_TEN_SCHEMA` map một cửa tới `[]` (mảng RỖNG) để
// nói "cửa này KHÔNG bị buộc kiểm ở .input()" (hôm nay chỉ `commit`, vì
// metaJsonSchema chỉ được parse TRONG thân .mutation(), không phải .input()).
// §0b/§1 chỉ so bằng `new Set(Object.values(...).flat())` — flatten một mảng
// RỖNG KHÔNG đổi kích thước tập hợp, nên thêm MỘT cửa miễn MỚI (`{ten: []}`)
// không đổi `tenSchemaMongDoi.size` (vẫn 6) và trôi qua §0b/§1 im lặng — đo
// được: thêm `submitProcessResultBatch: []` làm số cửa miễn 1→2 mà
// `expect(size).toBe(6)` VẪN PASS. Cùng kỹ thuật GHIM_MIEN_TRU của
// `cuaIngestCensus.test.ts` (danh sách TÊN cụ thể, so bằng `.toEqual` — không
// chỉ đếm kích thước một tập đã bị nén).
// ════════════════════════════════════════════════════════════════════════════
describe("§0b2 — ★★★ GHIM chống phình sổ miễn AST-level (CUA_TOI_TEN_SCHEMA ánh xạ tới [])", () => {
  it("đúng TẬP TÊN cửa map tới [] (không bị buộc kiểm .input()) — thêm/bớt một cửa vào tập này là một LỜI KHAI, không phải một ô trống vô hại (flatten không bắt được)", () => {
    const cuaMienAstLevel = Object.entries(CUA_TOI_TEN_SCHEMA)
      .filter(([, danhSachSchema]) => danhSachSchema.length === 0)
      .map(([ten]) => ten)
      .sort();
    expect(
      cuaMienAstLevel,
      "tập cửa miễn kiểm AST-level (map tới []) đã đổi — nếu bạn vừa THÊM một cửa vào đây để né §0c, " +
        "đây chính là lưới được dựng ra để bắt điều đó (§0b/§1 flatten-size không bắt được vì mảng rỗng " +
        "không đổi kích thước tập hợp).",
    ).toEqual(["commit"]);
  });
});

describe("§0e — ★★★ ĐỘT BIẾN BẮT BUỘC: gỡ liên kết mã ⇒ §0c PHẢI ĐỎ", () => {
  /** Cùng idiom mutation-trong-bộ-nhớ đã dùng ở `cuaIngestCensus.test.ts §5` —
   *  KHÔNG ghi đè file thật, chỉ chèn vào một BIẾN THỂ text rồi chạy lại CHÍNH
   *  `quetCuaIngest`. */
  it("thay .input(submitProcessResultInputSchema) bằng một schema KHÔNG liên quan ⇒ dinhDanhOInput mất 'submitProcessResultCoreObject' — §0c sẽ đỏ trên mã thật nếu ai làm điều này", () => {
    const NEO = ".input(submitProcessResultInputSchema)";
    const viTri = NOI_DUNG_MACHINE_API_GOC.indexOf(NEO);
    expect(viTri, "không tìm thấy điểm neo — bộ suy đã đổi neo?").toBeGreaterThan(-1);
    const maDotBien =
      NOI_DUNG_MACHINE_API_GOC.slice(0, viTri) +
      ".input(z.object({ khongLienQuanGiCaSchemaCu: z.string() }))" +
      NOI_DUNG_MACHINE_API_GOC.slice(viTri + NEO.length);

    const laiQuet = quetCuaIngest("server/routers/machineApiRouters.ts", maDotBien);
    const cua = laiQuet.cua.find((c) => c.ten === "submitProcessResult");
    expect(cua, "cửa submitProcessResult biến mất sau đột biến — bộ suy mất mục tiêu").toBeDefined();
    expect(cua!.dinhDanhOInput).not.toBeNull();

    // ★ NGUYÊN VĂN — đây là điều §0c sẽ thấy nếu liên kết mã bị gỡ trên file thật:
    const conLienKet = cua!.dinhDanhOInput!.has("submitProcessResultCoreObject");
    expect(conLienKet, "ĐỘT BIẾN PHẢI cắt đứt liên kết — nếu vẫn true, đột biến không có tác dụng").toBe(false);
  });

  it("mã thật KHÔNG hề bị đụng bởi đột biến trong chính test này (đọc lại đĩa, so nguyên văn)", () => {
    expect(readFileSync(DUONG_MACHINE_API, "utf8")).toBe(NOI_DUNG_MACHINE_API_GOC);
  });
});

describe("§0f — BONUS (không thay thế §0c): với BA cửa KHÔNG bọc .transform(), một mức MẠNH HƠN — THAM CHIẾU OBJECT thật lúc chạy, không chỉ TRÙNG TÊN", () => {
  // `.shape` của ZodObject là MỘT tham chiếu cố định lúc dựng — `.refine()`/
  // `.superRefine()` KHÔNG tạo `.shape` mới (đã đo bằng node, xem task-3-report.md),
  // nhưng `.extend()`/`.merge()`/`.omit()`/`.pick()` THÌ CÓ (đối chứng bên dưới
  // chứng minh kỹ thuật này không tự thoả). `submitInspection`/`submitInspectionBatch`
  // KHÔNG có ca này — `.input()` của chúng là `ZodPipe` (`.transform()`, xem
  // `submitInspectionRouterInputSchema`), không có `.shape` cấp ngoài để so —
  // §0c (đệ quy định danh) là bằng chứng DUY NHẤT khả thi cho hai cửa đó.
  it("presign — .input() đăng ký ĐÚNG THAM CHIẾU presignCoreObject (.shape trùng object)", () => {
    const inp: any = (aoiPackageRouter as any).presign._def.inputs[0];
    expect(inp.shape).toBe((presignCoreObject as any).shape);
  });

  it("submitProcessResult — .input() đăng ký ĐÚNG THAM CHIẾU submitProcessResultCoreObject", () => {
    const inp: any = (machineApiRouter as any).submitProcessResult._def.inputs[0];
    expect(inp.shape).toBe((submitProcessResultCoreObject as any).shape);
  });

  it("syncEdgeResults — .input() đăng ký ĐÚNG THAM CHIẾU syncEdgeResultsCoreObject", () => {
    const inp: any = (machineApiRouter as any).syncEdgeResults._def.inputs[0];
    expect(inp.shape).toBe((syncEdgeResultsCoreObject as any).shape);
  });

  it("ĐỐI CHỨNG — kỹ thuật '.shape ===' THẬT SỰ phân biệt được: .extend() tại chỗ tạo .shape KHÁC tham chiếu (không tự thoả)", () => {
    const bienThe = (presignCoreObject as any).extend({ truongMoiChenTaiCho: z.string() });
    expect(bienThe.shape).not.toBe((presignCoreObject as any).shape);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §1 — DANH SÁCH ĐẦY ĐỦ mọi schema census phải soi + VÌ SAO ĐỦ.
// ════════════════════════════════════════════════════════════════════════════
// Ranh giới KHÔNG tự nghĩ ra mới: tái dùng NGUYÊN VĂN "cửa ingest" mà
// `cuaIngestScan.ts` (Pha 1C, BG-16→BG-21→BG-39) đã ba lần sửa lại cho ĐÚNG —
// vị từ `laTenCuaIngest` (`/^submit/i` hoặc `/^sync.*result/i`) trên
// `machineApiRouter`, và `laTenCuaIngestZip` (`presign`/`commit`) trên
// `aoiPackageRouter`. Sáu cửa, sáu schema input (v1.x/v2.0 của cùng hai cửa
// TÁCH RIÊNG vì hai HÌNH DẠNG khác nhau — `quyetDinhPhienBanIngest` chọn một
// trong hai LÚC CHẠY, không phải "một cửa được soi hai lần"):
//   1&2. submitInspection / submitInspectionBatch → submitInspectionCoreObject (v1.x) + machineDataContractV2 (v2.0)
//   3&4. submitProcessResult / submitProcessResultBatch → submitProcessResultCoreObject
//   5.   syncEdgeResults → syncEdgeResultsCoreObject
//   6.   presign → presignCoreObject · commit → metaJsonSchema (parse meta.json TRONG zip)
// `commit`'s OWN input schema (apiKey/machineCode/packageId/sizeBytes/sha256)
// KHÔNG nằm trong danh sách: `packageId` ở đó chỉ SO KHỚP (SELECT eq(),
// aoiPackageRouter.ts) — gói đã được `presign` INSERT từ trước — không INSERT
// verbatim ở bước `commit`, nên không mang rủi ro `22001` mà census này được
// dựng để đóng (đối xứng lý do `machineCode`/`apiKey` VỆ SINH ở các bảng khác).
// Mọi thủ tục KHÁC của hai router này (heartbeat, key rotation, config pull,
// deployment confirm, listPackages, getPackage, …) — theo ĐÚNG vị từ
// `laTenCuaIngest`/`laTenCuaIngestZip` — KHÔNG phải cửa ingest (không nhận DỮ
// LIỆU ĐO từ máy), ngoài phạm vi. Router CRUD nội bộ (nhân viên qua UI) khác
// HẲN lớp rủi ro — người, tần suất thấp, UI có validate riêng — không phải
// nguồn của lỗi `22001` lặp lại BA LẦN mà census này tồn tại để đóng.
interface MucSchemaIngest {
  readonly ten: string;
  readonly schema: z.ZodTypeAny;
  readonly mienTru: ReadonlySet<string>;
}
const DANH_SACH_SCHEMA_INGEST: readonly MucSchemaIngest[] = [
  { ten: "machineDataContractV2", schema: machineDataContractV2,
    mienTru: new Set(["surfaces[].positions[].captures[].components[].errorDesc"]) },
  { ten: "submitInspectionCoreObject", schema: submitInspectionCoreObject,
    mienTru: new Set(["measurements[].remark"]) },
  { ten: "submitProcessResultCoreObject", schema: submitProcessResultCoreObject, mienTru: new Set() },
  { ten: "syncEdgeResultsCoreObject", schema: syncEdgeResultsCoreObject,
    mienTru: new Set(["results[].inputReference"]) },
  { ten: "presignCoreObject", schema: presignCoreObject, mienTru: new Set() },
  { ten: "metaJsonSchema", schema: metaJsonSchema, mienTru: new Set(["measurements[].remark"]) },
];

describe("§1 — DANH SÁCH ĐẦY ĐỦ 6 schema (6 cửa ingest) — walker XANH trên cả sáu", () => {
  it("★★★ BG-80: tập TÊN SCHEMA trong DANH_SACH_SCHEMA_INGEST == tập SUY RA từ CUA_TOI_TEN_SCHEMA (§0) + 'metaJsonSchema' (payload ZIP của commit, ngoài .input()) — KHÔNG còn là hằng số 6 đứng một mình", () => {
    const tuCuaToiSchema = new Set(Object.values(CUA_TOI_TEN_SCHEMA).flat());
    const tenSchemaMongDoi = new Set([...tuCuaToiSchema, "metaJsonSchema"]);
    expect(DANH_SACH_SCHEMA_INGEST.map((x) => x.ten).sort()).toEqual([...tenSchemaMongDoi].sort());
    // Con số 6 giờ là một KẾT QUẢ suy ra, không phải một lời khai đứng riêng —
    // nhưng vẫn hiển thị tường minh cho người đọc lỗi khi con số đổi:
    expect(tenSchemaMongDoi.size, "đổi số này là một lời khai (thêm/bớt cửa ingest) — sửa CUA_TOI_TEN_SCHEMA (§0) trước, DANH_SACH_SCHEMA_INGEST sẽ tự đối chiếu theo").toBe(6);
  });

  for (const { ten, schema, mienTru } of DANH_SACH_SCHEMA_INGEST) {
    it(`${ten} — walker (kiemTraToanBoTruongChuoi) 0 lỗi, KHÔNG throw`, () => {
      const r = kiemTraToanBoTruongChuoi(schema, ten, mienTru);
      expect(r.loi, r.loi.join("\n")).toEqual([]);
    });
  }

  it("KHÔNG miễn trừ nào là thừa — mỗi mục trong mienTru khớp ĐÚNG một lá max:null thật (chống miễn trừ ma)", () => {
    for (const { ten, schema, mienTru } of DANH_SACH_SCHEMA_INGEST) {
      const laNull = new Set(duyetTimTruongChuoi(schema).filter((l) => l.max === null).map((l) => l.duongDan));
      for (const m of mienTru) {
        expect(laNull.has(m), `${ten}: miễn trừ "${m}" không khớp lá max:null nào thật`).toBe(true);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §2 — Hai bảng kiểm kê MỚI khớp SỐ ĐO ĐƯỢC + CA BIÊN trên TOÀN BỘ.
// ════════════════════════════════════════════════════════════════════════════
/** Payload v1.x TỐI THIỂU hợp lệ cho `submitInspectionCoreObject` — đủ để mọi
 *  đường trong `KIEM_KE_SUBMIT_INSPECTION_CORE` ĐẾN ĐƯỢC (measurements[0] tồn
 *  tại với mọi trường liên quan). KHÔNG lấy từ mẫu máy thật (không có sample
 *  v1.x — machine thật gửi hôm nay đều v2.0 cây, xem §3) — dựng tay, tối
 *  thiểu, đúng shape schema yêu cầu (`result` bắt buộc trong mỗi measurement).
 */
function mauHopLeV1x(): any {
  return structuredClone({
    machineCode: "MC-01",
    apiKey: "mk_test",
    serialNumber: "SN123456",
    overallResult: "OK",
    inspectionTime: "2026-08-30T10:00:00Z",
    serverReceivedAt: "2026-08-30T10:00:00Z",
    measurements: [{
      pointId: "P1",
      pointCode: "P1",
      measuredValue: "12.5",
      unitScaleToCanonical: "1",
      result: "OK",
      valueZ: "1", valueHeight: "1", valueArea: "1", valueVolume: "1",
      valueVoidPct: "1", valueCoplanarity: "1", valueWarpage: "1",
      valueOffsetX: "1", valueOffsetY: "1", valueTilt: "1", valueThickness: "1",
    }],
  });
}

function mauHopLePresign(): any {
  return { apiKey: "mk_test", machineCode: "MC-01", inspectionId: "INSPECT-1", sizeBytes: 1024, sha256: "abc123" };
}

/** Đặt `gia` vào payload mẫu, đi theo đường DỮ LIỆU tương ứng `duongDan` ("[]" → phần tử 0). */
function apDungGiaTri(mau: any, duongDan: MucCapChuoi["duongDan"], gia: string): void {
  const dp = duongDanDuLieu(duongDan);
  let obj = mau;
  for (let i = 0; i < dp.length - 1; i++) obj = obj[dp[i] as keyof typeof obj];
  obj[dp[dp.length - 1] as keyof typeof obj] = gia as never;
}

describe("§2a — KIEM_KE_SUBMIT_INSPECTION_CORE (19 lá) khớp submitInspectionCoreObject THẬT", () => {
  it("★★★ đúng 19 hàng — đổi số này là một lời khai", () => {
    expect(KIEM_KE_SUBMIT_INSPECTION_CORE.length).toBe(19);
  });

  it("★★★ 3 lá 'db' (khớp cột thật) — đúng CÁC TÊN mệnh đề 2 nêu", () => {
    const dbTen = KIEM_KE_SUBMIT_INSPECTION_CORE.filter((m) => m.nguon === "db").map((m) => m.ten).sort();
    expect(dbTen).toEqual([
      "measurements[].measuredValue",
      "measurements[].pointCode",
      "measurements[].pointId",
    ].sort());
  });

  it("0 lỗi trên submitInspectionCoreObject thật (kiemKeTheoBang)", () => {
    const r = kiemKeTheoBang(submitInspectionCoreObject, KIEM_KE_SUBMIT_INSPECTION_CORE);
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    expect(r.soTruongDaXet).toBe(19);
  });

  it("mỗi hàng có `ten` DUY NHẤT", () => {
    const ten = KIEM_KE_SUBMIT_INSPECTION_CORE.map((m) => m.ten);
    expect(new Set(ten).size).toBe(ten.length);
  });

  for (const muc of KIEM_KE_SUBMIT_INSPECTION_CORE) {
    it(`${muc.ten} — đúng .max(${muc.max}) ký tự vẫn HỢP LỆ (${muc.nguon === "db" ? muc.ghiChu : "vệ sinh"})`, () => {
      const p = mauHopLeV1x();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max));
      const r = submitInspectionCoreObject.safeParse(p);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`${muc.ten} — quá .max(${muc.max}) MỘT ký tự bị TỪ CHỐI`, () => {
      const p = mauHopLeV1x();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max + 1));
      expect(submitInspectionCoreObject.safeParse(p).success).toBe(false);
    });
  }
});

describe("§2b — KIEM_KE_PRESIGN (4 lá) khớp presignCoreObject THẬT", () => {
  it("★★★ đúng 4 hàng", () => {
    expect(KIEM_KE_PRESIGN.length).toBe(4);
  });

  it("0 lỗi trên presignCoreObject thật", () => {
    const r = kiemKeTheoBang(presignCoreObject, KIEM_KE_PRESIGN);
    expect(r.loi, r.loi.join("\n")).toEqual([]);
    expect(r.soTruongDaXet).toBe(4);
  });

  it("★★★ inspectionId — .max(100) khớp inspection_packages.packageId (đo avi_app) — LỖ 22001 thật được đóng ở đây", () => {
    const muc = KIEM_KE_PRESIGN.find((m) => m.ten === "inspectionId")!;
    expect(muc.max).toBe(100);
    expect(muc.nguon).toBe("db");
  });

  for (const muc of KIEM_KE_PRESIGN) {
    it(`${muc.ten} — đúng .max(${muc.max}) ký tự vẫn HỢP LỆ`, () => {
      const p = mauHopLePresign();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max));
      const r = presignCoreObject.safeParse(p);
      expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
    });

    it(`${muc.ten} — quá .max(${muc.max}) MỘT ký tự bị TỪ CHỐI`, () => {
      const p = mauHopLePresign();
      apDungGiaTri(p, muc.duongDan, "x".repeat(muc.max + 1));
      expect(presignCoreObject.safeParse(p).success).toBe(false);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// §3 — CHỐNG HỒI QUY.
// ════════════════════════════════════════════════════════════════════════════
describe("§3 — CHỐNG HỒI QUY", () => {
  it(`${MAU_MAY_THAT} (v2.0, đường machineDataContractV2) nguyên văn ⇒ success:true SAU lượt sửa này`, () => {
    const raw = readFileSync(MAU_MAY_THAT, "utf8");
    const data = JSON.parse(raw);
    const r = machineDataContractV2.safeParse(data);
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("payload v1.x TỐI THIỂU (mauHopLeV1x) vẫn parse được qua submitInspectionCoreObject SAU khi siết 19 .max() mới", () => {
    const r = submitInspectionCoreObject.safeParse(mauHopLeV1x());
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });

  it("payload presign TỐI THIỂU vẫn parse được qua presignCoreObject SAU khi siết", () => {
    const r = presignCoreObject.safeParse(mauHopLePresign());
    expect(r.success, r.success ? "" : JSON.stringify((r as { error?: unknown }).error)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §4 — ★★★ HAI ĐỘT BIẾN BẮT BUỘC (mệnh đề 4).
// ════════════════════════════════════════════════════════════════════════════
describe("§4a — ĐỘT BIẾN (a): trường chuỗi MỚI không .max() ở BẤT KỲ schema nào trong sáu ⇒ census ĐỎ nêu đúng tên, KHÔNG cần sửa bảng", () => {
  for (const { ten, schema, mienTru } of DANH_SACH_SCHEMA_INGEST) {
    it(`${ten}.truongMoiChuaTungCo (KHÔNG .max()) ⇒ đỏ đúng tên, không kéo trường khác`, () => {
      const dotBien = (schema as any).extend({ truongMoiChuaTungCo: z.string().optional() });
      const r = kiemTraToanBoTruongChuoi(dotBien, ten, mienTru);
      expect(r.loi).toEqual([`[${ten}] truongMoiChuaTungCo: THIẾU .max()`]);
    });
  }
});

describe("§4b — ★★★ ĐỘT BIẾN (b): trường bọc .transform() ⇒ walker BÁO ĐỘNG (throw), KHÔNG im lặng bỏ qua", () => {
  for (const { ten, schema } of DANH_SACH_SCHEMA_INGEST) {
    it(`${ten}.truongTransform (bọc .transform()) ⇒ duyetTimTruongChuoi THROW, không trả [] im lặng`, () => {
      const dotBien = (schema as any).extend({
        truongTransform: z.string().max(50).transform((v) => v.trim()),
      });
      expect(() => duyetTimTruongChuoi(dotBien)).toThrow(/CHƯA HỖ TRỢ/);
    });
  }

  it("ĐỐI CHỨNG — .default() KHÔNG báo động (TRONG SUỐT, giống Optional/Nullable): machineDataContractV2.schemaVersion là MỘT .default() THẬT đang chạy sản xuất, không phải giả định", () => {
    expect(() => duyetTimTruongChuoi(machineDataContractV2)).not.toThrow();
    const dotBien = submitInspectionCoreObject.extend({ truongDefault: z.string().default("x") });
    const r = duyetTimTruongChuoi(dotBien);
    const phatHien = r.find((x) => x.duongDan === "truongDefault");
    expect(phatHien, "trường bọc .default() KHÔNG .max() phải vẫn được PHÁT HIỆN (không bị nuốt bởi unwrap)").toBeDefined();
    expect(phatHien!.max).toBeNull();
  });

  it("★ BONUS — ZodDiscriminatedUnion (lớp con của ZodUnion) KHÔNG được nhánh union thường âm thầm nuốt — throw, không phải 'không có trường chuỗi'", () => {
    const dotBien = submitInspectionCoreObject.extend({
      truongDU: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), val: z.string() }), // val KHÔNG .max() — nếu union thường nuốt, sẽ không bao giờ bị bắt
      ]),
    });
    expect(() => duyetTimTruongChuoi(dotBien)).toThrow(/ZodDiscriminatedUnion/);
  });

  it("ĐỐI CHỨNG — tuple SỐ THẬT trong submitProcessResultCoreObject.waveforms[].samples KHÔNG throw (đã hỗ trợ thật, không phải miễn trừ)", () => {
    expect(() => duyetTimTruongChuoi(submitProcessResultCoreObject)).not.toThrow();
  });
});

describe("§5 — hai file nguồn ĐÃ SỬA THẬT của Task 3 không hề bị đụng THÊM bởi các ca đột biến trong chính file test này", () => {
  it("machineApiRouters.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module test này", () => {
    expect(readFileSync(DUONG_MACHINE_API, "utf8")).toBe(NOI_DUNG_MACHINE_API_GOC);
  });

  it("aoiPackageRouter.ts trên đĩa khớp nguyên văn bản chụp lúc nạp module test này", () => {
    expect(readFileSync(DUONG_AOI_PACKAGE, "utf8")).toBe(NOI_DUNG_AOI_PACKAGE_GOC);
  });
});
