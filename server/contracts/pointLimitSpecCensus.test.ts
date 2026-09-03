// server/contracts/pointLimitSpecCensus.test.ts
//
// Task 7 Khối C (QĐ-3) — census đối chiếu `shared/pointLimitSpec.ts` (MỘT
// nguồn 18 cột giới hạn) với HAI hợp đồng THẬT mà nó phải khớp:
//   §1 — cột THẬT trong DB: `measurementPointDefs` (`drizzle/schema/product.ts`).
//   §2 — kiểu THẬT mà spec-gate CHẤM BẰNG: `PointLimitSource`
//        (`server/services/pointResultEvaluator.ts:30-56`).
//
// Vì sao lưới này KHÔNG sống trong `shared/pointLimitSpec.test.ts`: cả hai hợp
// đồng trên đều là mã `server/**` (drizzle schema, `PointLimitSource`) trong
// khi `shared/pointLimitSpec.ts` phải giữ 0 import (xem docblock đầu file đó)
// — không tự đối chiếu được. Lưới này sống ở `server/contracts/`, nơi được
// phép import cả hai.
//
// `cayDay.ts` (trước bản vá Task 7, ngay trên SELECT giới hạn cũ) tự cảnh
// báo: "thiếu một cột ở đây là một chiều giới hạn KHÔNG BAO GIỜ được chấm, và
// không lưới nào đỏ vì hàng vẫn ghi." — đây là lưới đóng đúng lỗ đó.
//
// §3 ghi lại bằng chứng ĐỘT BIẾN thật (Task 7 Bước 4 của brief): bỏ
// `thicknessMax` khỏi `POINT_LIMIT_SPEC` trên đĩa, chạy lưới này, chép nguyên
// văn dòng đỏ, rồi hoàn tác — xem báo cáo Task 7 để có dòng đỏ nguyên văn.
//
// ════════════════════════════════════════════════════════════════════════════
// VÒNG SỬA 1 (2026-09-03) — F3: §1/§2 canh HAI MỤC TIÊU CỐ ĐỊNH, không QUÉT
// ════════════════════════════════════════════════════════════════════════════
// Reviewer grep độc lập (không phải §1/§2 ở trên) bắt được HAI bản chép tay
// SỐNG khác, ngoài vùng canh của census: `server/services/productPackageService.ts`
// (`POINT_COPY_COLS`, đủ 18/18) và `server/routers/machineApiRouters.ts`
// (`projectSyncPoint`, đủ 18/18) — cả hai đã sửa trong vòng này (suy từ spec).
// Lý do §1/§2 mù với hai file đó: chúng chỉ so `POINT_LIMIT_SPEC` với ĐÚNG hai
// đích cố định (`measurementPointDefs`, `PointLimitSource`) — một bản chép tay
// MỚI ở một file bất kỳ KHÔNG đụng vào hai đích đó thì không bao giờ đỏ. Đây
// CHÍNH LÀ lỗ mà `cayDay.ts` (trước Task 7) tự tố, tái diễn lần thứ 8 (L-1) ở
// dự án này theo lời nhắc của reviewer.
//
// §3 dưới đây là một BẤT BIẾN — QUÉT `server/**/*.ts` thật trên đĩa mỗi lần
// chạy, không phải một danh sách tên file cố định — nên nó bắt được cả file
// chép tay MỚI trong tương lai, không chỉ hai file đã biết hôm nay.
//
// ⚠ F3 — HAI CƠ CHẾ BỔ SUNG NHAU, KHÔNG THAY NHAU:
//   §2 (`satisfies Record<...>`)  — bắt lệch KIỂU, CHỈ dưới `tsc`/`npm run
//                                    check:tests` (test file bị `tsconfig.json`
//                                    loại trừ nên KHÔNG được `npm run check`
//                                    canh — xem `tsconfig.tests.json`).
//   §3 (quét chuỗi bằng regex)     — bắt lệch VĂN BẢN (một khối liệt kê tay ở
//                                    MỘT FILE BẤT KỲ), CHỈ dưới `vitest` (đọc
//                                    nội dung file trên đĩa lúc chạy) — `tsc`
//                                    không thấy gì sai vì 18 dòng `x: p.x` vẫn
//                                    biên dịch hoàn hảo, đó CHÍNH LÀ lỗ.
//
// ════════════════════════════════════════════════════════════════════════════
// VÒNG SỬA 2 (2026-09-03) — F3 vẫn NỬA VỜI: gốc quét cứng `server/`
// ════════════════════════════════════════════════════════════════════════════
// `GOC_QUET` vòng sửa 1 = `resolve(__dirname, "..")` = `server/` — BẤT BIẾN
// thật (đệ quy đĩa thật) nhưng KHÔNG BAO GIỜ chạm `shared/`/`client/src/`, dù
// chính `LIMIT_FIELDS` mà nó quét theo được IMPORT từ `shared/`. Không phải
// giả thuyết: reviewer grep độc lập bắt SỐNG `client/src/pages/ProductModels.tsx`,
// `client/src/components/productModels/types.ts` (⚠ ĐƯỜNG DẪN reviewer khai
// "pages/productModels/types.ts" SAI — đo lại: file thật nằm ở
// `components/productModels/`, không phải `pages/productModels/`; dùng đường
// dẫn ĐO ĐƯỢC, không dùng nguyên văn brief) và
// `client/src/components/productModels/PointDetailsForm.tsx` — cả ba chép tay
// ĐỦ 18/18 field, ngoài tầm §3.
//
// Đo lại SAU khi mở `GOC_QUET` ra repo root + quét `server/`, `shared/`,
// `client/src/` (thêm `.tsx`, trước đó §3 CHỈ nhặt `.ts` — một lỗ THỨ HAI:
// `ProductModels.tsx`/`PointDetailsForm.tsx` là `.tsx`, "foo.tsx".endsWith(".ts")
// = false trong JS, nên dù có mở gốc quét mà không thêm `.tsx` thì hai file đó
// VẪN lọt) phát hiện THÊM một file ngoài 3 file reviewer nêu:
// `client/src/components/BulkImportDialog.tsx` (10/18 field, cột map CSV/Excel
// giới hạn cho import hàng loạt — chép tay THẬT, không phải chú thích/prose).
// Theo đúng chỉ đạo cho file Task 10 (`TeachTreeTab.tsx`, xem dưới): file MỚI
// phát hiện mà KHÔNG được xác nhận rõ thì KHÔNG tự allowlist — để §3 ĐỎ và
// khai trong báo cáo Task 7 vòng sửa 2, coordinator quyết định hướng xử lý
// (gán ticket/allowlist hay giao sửa). Xem `NO_DA_BIET`/`MIEN_TRU_KIEN_TRUC`
// dưới — `BulkImportDialog.tsx` CỐ Ý không có mặt ở đó.
//
// ── BỔ SUNG vòng sửa 2 (cùng ngày) — Task 8 báo: nợ hoá thạch qua wrapper ──
// Task 8 (`fc232773`) rút BỐN bản `touchesLimits` chép tay thành MỘT hàm dùng
// chung `touchesApprovalLimitFields` (`server/utils/measurementPointLimitGate.ts`,
// suy TỪ `APPROVAL_LIMIT_FIELDS`), và bốn hộ tiêu thụ (`measurementPointImport.ts`,
// `productRouters.ts`, `dataRouters.ts`, `writeHandlers/measurementPoint.ts`)
// import HÀM ĐÓ — không import THẲNG `pointLimitSpec`. §3 (regex trực tiếp)
// không nhận ra "đọc spec qua một lớp bọc" là "đọc spec" ⇒ `measurementPointImport.ts`
// (17/18 field) tiếp tục bị bắt DÙ ĐÃ suy từ spec cho phần `touchesLimits` —
// BG-104 (đặt ra để tạm-nhịn nợ ĐANG SỬA) sẽ KHÔNG BAO GIỜ tự đóng, và test
// permanent "(b) XÁC NHẬN nợ" sẽ KHÔNG BAO GIỜ đỏ dù nợ đã hết — đúng nghịch lý
// mà cơ chế tự-hết-hạn (Task 7 vòng 1/2) SINH RA để tránh.
//
// Sửa: `daDocSpec()` nhận IMPORT BẮC CẦU đúng MỘT BẬC — file X được coi "đọc
// spec" nếu (a) X import thẳng `pointLimitSpec`, HOẶC (b) X import một module Y
// (resolve theo đường dẫn import THẬT — relative hoặc alias `@shared/`/`@/` —
// đọc file Y trên đĩa) mà Y tự import thẳng `pointLimitSpec`. CHỈ một bậc — Y
// import Z import spec thì KHÔNG tính (đo trực tiếp, không suy diễn xa hơn;
// một bậc là đủ cho khuôn "hàm dùng chung 1 lớp" đang thấy, và giữ mệnh đề
// dễ kiểm bằng mắt — sâu hơn thì census chính nó cũng cần một cổng riêng).
//
// ⚠ Đây là exemption CẤP FILE, không phải CẤP KHỐI: nếu X vừa đọc spec bắc cầu
// (cho MỘT mục đích, vd gate `touchesLimits`) VỪA có một khối chép tay THẬT SỰ
// khác trong CHÍNH NÓ (vd zod schema đầu vào của MỘT thủ tục, không liên quan
// gate) thì X vẫn THOÁT toàn bộ — census không phân biệt được hai việc trong
// cùng file. Đo được TRÊN THỰC TẾ 2026-09-03 (`server/routers/productRouters.ts`
// 18/18, `server/utils/measurementPointImport.ts` 17/18): CẢ HAI đều có một
// khối chép tay THẬT SỰ RIÊNG (zod input `measurementPoint.update` ở
// `productRouters.ts`; zod schema hàng nhập CSV ở `measurementPointImport.ts`)
// KHÔNG LIÊN QUAN đến `touchesApprovalLimitFields` — bắc cầu làm chúng thoát
// §3 dù khối chép tay đó CHƯA hề được sửa. Đây là GIỚI HẠN THẬT của quy tắc
// bắc cầu 1 bậc (khai rõ theo yêu cầu coordinator, không giấu) — không phải lỗi
// triển khai, là đánh đổi cố ý (mịn hơn = quét cấp AST, ngoài phạm vi Task 7).
import { describe, it, expect } from "vitest";
import type { PointLimitSource } from "../services/pointResultEvaluator";
import { measurementPointDefs } from "../../drizzle/schema";
import { POINT_LIMIT_SPEC, LIMIT_FIELDS } from "../../shared/pointLimitSpec";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

describe("§1 — POINT_LIMIT_SPEC ↔ measurementPointDefs (cột THẬT trong DB)", () => {
  it("★★★ dân số đã xét — GHIM 18 (đổi số này là một lời khai, không phải bảo trì im lặng)", () => {
    expect(POINT_LIMIT_SPEC.length).toBe(18);
  });

  it("CẦU CHÌ chống 'xanh vì quét trúng 0 thứ': tập field đo được KHÔNG RỖNG", () => {
    // Một bộ suy luôn trả [] (spec rỗng do bug) sẽ làm §1 dưới đây "xanh" vì
    // `.filter()` trên mảng rỗng luôn trả []. Ghim > 0 (và = 18, xem test
    // trên) chặn đúng lớp lỗi "cổng xanh vì quét trúng 0 thứ" đã xảy ra ở
    // dự án này (glob rỗng làm vitest im lặng mà cổng khai xanh).
    expect(LIMIT_FIELDS.length).toBeGreaterThan(0);
  });

  it("mọi field trong spec là CỘT THẬT của measurementPointDefs", () => {
    const thieuCot = POINT_LIMIT_SPEC.filter((m) => !(m.field in measurementPointDefs)).map((m) => m.field);
    expect(
      thieuCot,
      `field khai trong POINT_LIMIT_SPEC nhưng KHÔNG tồn tại trong drizzle/schema/product.ts: ${thieuCot.join(", ")}`,
    ).toEqual([]);
  });

  it("không field nào trùng khoá", () => {
    expect(new Set(LIMIT_FIELDS).size).toBe(LIMIT_FIELDS.length);
  });
});

describe("§2 — POINT_LIMIT_SPEC ↔ PointLimitSource (kiểu spec-gate THẬT sự chấm bằng)", () => {
  // ── Lưới COMPILE-TIME ───────────────────────────────────────────────────
  // MẪU đủ 18 khoá của `PointLimitSource`, ép `Required<>` để tsc bắt lỗi nếu
  // interface đó có thêm khoá mà mẫu dưới chưa cập nhật; đồng thời ép
  // `satisfies Record<(typeof LIMIT_FIELDS)[number], unknown>` — nếu
  // `LIMIT_FIELDS` có một khoá THỪA không tồn tại trên `PointLimitSource` thì
  // object literal dưới bị tsc từ chối vì "excess property" (khoá đó không có
  // trên mẫu). Kết hợp §1 "đúng 18, không trùng": 18 khoá con hợp lệ của một
  // kiểu có ĐÚNG 18 khoá CHỈ CÓ THỂ LÀ toàn bộ tập khoá — không thể vừa hợp lệ
  // (không khoá lạ) vừa thiếu một khoá thật.
  const MAU_POINT_LIMIT_SOURCE_DAY_DU: Required<PointLimitSource> = {
    lowerLimit: null,
    upperLimit: null,
    unit: null,
    heightMin: null,
    heightMax: null,
    areaMin: null,
    areaMax: null,
    volumeMin: null,
    volumeMax: null,
    coplanarityMax: null,
    warpageMax: null,
    voidPctMax: null,
    offsetXMax: null,
    offsetYMax: null,
    tiltMax: null,
    thicknessMin: null,
    thicknessMax: null,
    criteria: null,
  } satisfies Record<(typeof LIMIT_FIELDS)[number], unknown>;

  it("mẫu compile-time tồn tại và đủ 18 khoá (bằng chứng dòng khai satisfies ở trên đã biên dịch)", () => {
    expect(Object.keys(MAU_POINT_LIMIT_SOURCE_DAY_DU).length).toBe(18);
  });

  it("LIMIT_FIELDS khớp NGUYÊN VĂN danh sách khoá PointLimitSource đối chiếu tay (pointResultEvaluator.ts:30-56, 2026-09-03)", () => {
    const KHOA_POINT_LIMIT_SOURCE_DA_DOI_CHIEU = [
      "lowerLimit",
      "upperLimit",
      "unit",
      "heightMin",
      "heightMax",
      "areaMin",
      "areaMax",
      "volumeMin",
      "volumeMax",
      "coplanarityMax",
      "warpageMax",
      "voidPctMax",
      "offsetXMax",
      "offsetYMax",
      "tiltMax",
      "thicknessMin",
      "thicknessMax",
      "criteria",
    ];
    expect([...LIMIT_FIELDS].sort()).toEqual([...KHOA_POINT_LIMIT_SOURCE_DA_DOI_CHIEU].sort());
  });
});

// ════════════════════════════════════════════════════════════════════════════
// §3 — MỆNH ĐỀ QUÉT: server/ + shared/ + client/src/ không còn bản chép tay
//      NGOÀI vùng canh §1/§2
// ════════════════════════════════════════════════════════════════════════════

/** Gốc repo (thư mục cha của `server/`, hai cấp trên `server/contracts/`). */
const GOC_REPO = resolve(__dirname, "../..");

/**
 * Ba gốc quét THẬT (root-relative) — KHÔNG quét toàn bộ repo (đích `docs/`,
 * `knowledge/`, `scripts/`, `vscode-extension/`, `drizzle/`, … không liên
 * quan đến hộ tiêu thụ 18 cột giới hạn). `client/src` — không phải `client` —
 * vì `client/` còn chứa `index.html`/config, không phải mã tiêu thụ.
 */
const CAC_GOC_QUET = ["server", "shared", "client/src"] as const;

/** File tự loại trừ — CHÍNH `shared/pointLimitSpec.ts` liệt kê nguyên văn 18
 *  field (đó là ĐỊNH NGHĨA spec, không phải một bản sao — quét chính nó ra
 *  chính nó là vòng lặp vô nghĩa, không phải một "chép tay"). */
const DUONG_TU_LOAI_TRU = new Set(["shared/pointLimitSpec.ts"]);

function danhSachTepTs(dir: string, out: string[]): void {
  for (const ten of readdirSync(dir)) {
    if (ten === "node_modules" || ten === "dist") continue;
    const duong = join(dir, ten);
    const tt = statSync(duong);
    if (tt.isDirectory()) {
      danhSachTepTs(duong, out);
      continue;
    }
    // .ts VÀ .tsx — vòng sửa 1 CHỈ nhặt ".ts" (`"foo.tsx".endsWith(".ts")` = false
    // trong JS) nên mọi component React (.tsx) lọt lưới HOÀN TOÀN; đúng lớp file
    // ba bản chép tay client bị bắt hôm nay đều mang.
    const laTs = ten.endsWith(".ts") && !ten.endsWith(".d.ts");
    const laTsx = ten.endsWith(".tsx");
    if (!laTs && !laTsx) continue;
    if (ten.endsWith(".test.ts") || ten.endsWith(".test.tsx")) continue;
    out.push(duong);
  }
}

/**
 * Ngưỡng "chép tay": số field PHÂN BIỆT trong 18 field của `LIMIT_FIELDS` xuất
 * hiện dạng TỪ NGUYÊN (`\bfield\b`) trong MỘT file.
 *
 * ĐO LẠI vòng sửa 2 (2026-09-03) trên tập MỞ RỘNG `server/`+`shared/`+`client/src/`
 * (có `.tsx`, không có `shared/pointLimitSpec.ts`) — khác vòng 1 (chỉ `server/`),
 * khoảng trống KHÔNG còn sạch tuyệt đối như trước: có 3 file rơi ĐÚNG vào 5,
 * mép dưới khoảng nghi vấn coordinator nêu (5-9):
 *   - `shared/rollupVerdict.ts` (5) — ĐÃ KIỂM TỪNG DÒNG: cả 5 field chỉ xuất
 *     hiện trong DOCBLOCK (văn xuôi giải thích hành vi, dòng ~51/64-65), không
 *     một dòng CODE nào gán/khai field đó — KHÔNG phải chép tay.
 *   - `client/src/components/products/teach/ComponentLimitsTable.tsx` (5) và
 *     `teachTreeLogic.ts` (5) — Task 10 (đang chạy): cả hai dùng ĐÚNG 5 field
 *     (`lowerLimit/upperLimit/unit/heightMin/heightMax`) làm MỘT TẬP CON đại
 *     diện cho bảng xem trước UI (KHÔNG phải chép lại 18 field spec-gate), và
 *     `teachTreeLogic.ts` dòng ~14/24 CHỦ ĐỘNG NHẮC ĐẾN `POINT_LIMIT_SPEC`
 *     trong docblock (không phải mù tịt về spec) — khác hẳn 5 file 10-18 field
 *     kia (chép ĐỦ hoặc GẦN ĐỦ 18 field vào một khối dữ liệu thật: object
 *     literal / interface / cột map CSV).
 * ⇒ KHÔNG file nào rơi vào 6-9 (khoảng trống 6-9 CÒN NGUYÊN). Ba file ở mức 5
 * đều đã kiểm bằng tay và xác nhận KHÔNG phải "chép tay toàn khối" — giữ N=6
 * là quyết định LẠI có kiểm chứng lần này, không phải giữ theo quán tính. Nếu
 * lần đo sau có file ở 5 KHÔNG giải thích được bằng lý do trên, hạ N xuống 5.
 */
const NGUONG_CHEP_TAY = 6;

/**
 * ★★★ Vòng sửa lượt 9 (I-5.3, review lượt 9 §6-3 + BG-115) — NGƯỠNG THỨ HAI cho
 * file ĐÃ ĐƯỢC CREDIT (`daDocSpec()` = true). TRƯỚC bản vá này, một file đã credit
 * bị BỎ QUA HOÀN TOÀN (`if (daDocSpec(...)) continue;`) — KHÔNG đếm `soField` dù
 * bao nhiêu field co-occur, kể cả 18/18. Đột biến A của review (nối một khối chép
 * tay 18 field ĐỦ vào `ProductModels.tsx`, vốn đã credit qua bắc cầu) giữ §3 XANH
 * — đúng lỗ "cổng canh miễn-trừ (allow-list bắc cầu) thay vì bất biến".
 *
 * ── SỐ ĐO ĐƯỢC, KHÔNG PHẢI SỐ BG-115 GỢI Ý ("VD ≤3") ─────────────────────────
 * BG-115 gợi ý "≤3" dựa trên ĐÚNG HAI ca đo lúc đó (`productRouters.ts`,
 * `ProductModels.tsx`). Áp `≤3` THẬT trên toàn `server/+shared/+client/src/`
 * (2026-09-04, SAU khi I-2/I-3 vòng sửa 9 thêm gate `assertCapGioiHanHopLe`/
 * `loiCapGioiHanSauMerge` — tham số CHÍNH XÁC 4 tên `lowerLimit/upperLimit/
 * heightMin/heightMax`, xem `CapGioiHan`) cho ra **10 file dương tính giả**, BA
 * TRONG ĐÓ LÀ CHÍNH lời gọi gate I-2/I-3 vừa thêm (`server/db/product.ts`,
 * `server/routers/productVariantRouter.ts`, `server/routers/machineApiRouters.ts`
 * — mỗi nơi build đúng MỘT object `{lowerLimit,upperLimit,heightMin,heightMax}`,
 * KHÔNG phải chép tay). `4` — KHỚP ĐÚNG arity của `CapGioiHan`, khớp gợi ý dự
 * phòng của coordinator cho `ProductModels.tsx` ("cân nhắc ngưỡng ≤4") — xoá
 * SẠCH ba dương tính giả gate I-2/I-3 (đều dừng ở đúng 4 tên phân biệt) VÀ làm
 * `ProductModels.tsx` (4 tên đo được, đã kiểm từng dòng — KHÔNG phải một khối)
 * tự nhiên KHÔNG bị bắt — không cần allowlist tạm cho nó nữa. Một khối chép tay
 * THẬT (≥5, đúng lớp Đột biến A của review — 18/18 hoặc bất kỳ số nào >4) vẫn bị
 * bắt bình thường — xem các file CÒN bị bắt ở ngưỡng `4` trong `NO_DA_BIET_DA_CREDIT`
 * / `MIEN_TRU_KIEN_TRUC` bên dưới, mỗi file kèm lý do đo được riêng.
 */
const NGUONG_CHEP_TAY_DA_CREDIT = 4;

/**
 * File ĐÃ BIẾT chép tay một khối giới hạn nhưng KHÔNG PHẢI của Task 7 — canh
 * riêng bằng ticket, KHÔNG xoá âm thầm khi nó biến mất (xem test "XÁC NHẬN nợ"
 * bên dưới — hễ nợ hết thật thì XOÁ dòng tương ứng Ở ĐÂY). Đường dẫn LUÔN
 * root-relative (từ vòng sửa 2 — vòng 1 dùng đường dẫn relative-tới-`server/`).
 */
const NO_DA_BIET: Record<string, string> = {
  // ⚠ BG-104 (`server/utils/measurementPointImport.ts`) ĐÃ GỠ vòng sửa 2 —
  // đúng thiết kế tự-hết-hạn: sau khi nhận import BẮC CẦU (xem `daDocSpec()`),
  // file này KHÔNG còn bị mệnh đề quét bắt (đo được 2026-09-03: `daDocSpec()`
  // = true qua `server/utils/measurementPointLimitGate.ts`, import trực tiếp
  // `APPROVAL_LIMIT_FIELDS`). Test permanent "(b)" cũ ĐÃ XOÁ theo đúng chỉ dẫn
  // — KHÔNG viết lại nếu nợ tái xuất hiện mà không đo trước, thêm dòng MỚI.
  "server/routers/productRouters.ts":
    "Task 8 — zod input `measurementPoint.update` (đầu vào `z.object({...})` khoảng dòng 1244-1275, KHÔNG suy từ spec — vẫn khai tay từng field) là gap CÒN MỞ, mở từ brief Task 7 gốc; agent khác đang giữ file này, Task 7 KHÔNG được chạm. " +
      "⚠ Vòng sửa 2: file này giờ CŨNG daDocSpec()=true qua bắc cầu (import touchesApprovalLimitFields cho `touchesLimits`, đã đóng) — dòng allowlist này về mặt CƠ CHẾ §3 đã dư (file thoát dù không có dòng này), NHƯNG giữ lại để không xoá âm thầm chứng cứ 'zod input schema vẫn hand-copy' — gap đó KHÔNG liên quan touchesLimits và KHÔNG được đo lại tự-hết-hạn được nữa (bắc cầu 1 bậc là miễn trừ CẤP FILE, không phân biệt được hai việc trong cùng file — xem giới hạn khai ở docblock BỔ SUNG vòng sửa 2).",
  // ── Vòng sửa 2 — BG-107, ba file client reviewer grep độc lập bắt SỐNG ─────
  // ⚠ Task 14 (2026-09-04) ĐÃ DI TRÚ 3/4 file BG-107 gốc — xoá 3 dòng allowlist
  // + 3 test "(c)" tương ứng đúng thiết kế tự-hết-hạn (khuôn BG-104):
  //   - `client/src/pages/ProductModels.tsx` — bỏ interface `MeasurementPoint`
  //     local (khai tay y hệt bản sao `types.ts`), import từ
  //     `@/components/productModels/types` (bắc cầu 1 bậc → spec).
  //   - `client/src/components/productModels/types.ts` — `MeasurementPoint`
  //     giờ suy 18 field từ `LIMIT_FIELDS` (import THẲNG `@shared/pointLimitSpec`).
  //   - `client/src/components/productModels/PointDetailsForm.tsx` — props
  //     đọc/ghi 17 field chuỗi suy từ `LIMIT_FIELDS` qua khoá mẫu
  //     `point${Capitalize<F>}`/`setPoint${Capitalize<F>}` (import THẲNG spec).
  // Dòng đỏ nguyên văn TRƯỚC khi gỡ (test "(c)" của cả 3, đo 2026-09-04) — chép
  // trong báo cáo Task 14, không lặp lại ở đây để tránh trôi khỏi nguồn gốc.
  // ── Ruling coordinator R-KC-7 (2026-09-03), tinh chỉnh R-KC-8: file thứ TƯ — cùng lớp BG-107 NHƯNG là bảng ánh xạ HEADER Excel/CSV (alias EN/VI), di trú cần thiết kế alias-map (BG-110), KHÔNG phải đổi 1 dòng. Task 14 di trú 3 tệp đơn ở trên; GIỮ NGUYÊN allowlist này.
  "client/src/components/BulkImportDialog.tsx":
    "BG-107/R-KC-8 — bảng ánh xạ HEADER Excel/CSV (alias EN/VI), di trú cần thiết kế alias-map (BG-110), ngoài phạm vi Task 14. Xác nhận CÒN bị mệnh đề quét bắt 2026-09-04 (xem test '(c) XÁC NHẬN nợ BG-107' bên dưới).",
};

/**
 * ★★★ Vòng sửa lượt 9 (I-5.3) — allowlist RIÊNG cho file ĐÃ CREDIT
 * (`daDocSpec()`=true) nhưng vượt `NGUONG_CHEP_TAY_DA_CREDIT`. TÁCH khỏi
 * `NO_DA_BIET` (dành cho file CHƯA credit) vì lý do bị bắt khác hẳn: đây không
 * phải "chưa đọc spec", mà là "đã đọc spec nhưng vẫn còn nhắc TÊN field ở nhiều
 * chỗ hơn ngưỡng cho phép" — hai câu hỏi khác nhau, hai sổ khác nhau.
 *
 * ⚠ RỖNG hôm nay (2026-09-04) — không phải bỏ quên, đo được: brief vòng sửa 9
 * (I-5.3) chỉ đạo "khôi phục allowlist BG-107 cho ProductModels.tsx", NHƯNG ở
 * ngưỡng `4` đo được ĐÚNG (xem docblock `NGUONG_CHEP_TAY_DA_CREDIT` — ngưỡng `3`
 * mà BG-115 gợi ý gây 10 dương tính giả trên toàn repo, kể cả 3 điểm gọi CHÍNH
 * gate I-2/I-3 vòng sửa 9 vừa thêm), `ProductModels.tsx` co-occur ĐÚNG 4 tên —
 * KHÔNG vượt ngưỡng — không cần allowlist tạm nữa. Phép đo bác chỉ đạo brief
 * ⇒ theo phép đo (đúng luật "Phép đo bác brief ⇒ theo phép đo, khai rõ"), khai
 * trong báo cáo Task này. Hạ tầng dict giữ lại cho nợ TƯƠNG LAI (file thật sự
 * chép tay đang nấp sau credit, chưa xác nhận được là kiến trúc vĩnh viễn).
 */
const NO_DA_BIET_DA_CREDIT: Record<string, string> = {};

/** File KHÔNG phải bản sao — nó LÀ đích tham chiếu mà §2 đã so trực tiếp (spec suy THEO nó, không phải ngược lại), HOẶC một file mà TOÀN BỘ mục đích là xử lý/hiển thị TỪNG field riêng lẻ (form/row-builder toàn trường, không phải một khối chép — không thể "gộp" các lần nhắc tên field lại mà không phá vỡ chức năng). Miễn trừ VĨNH VIỄN, không phải nợ. */
const MIEN_TRU_KIEN_TRUC: Record<string, string> = {
  "server/services/pointResultEvaluator.ts":
    "Định nghĩa `PointLimitSource` — §2 ở trên đã đối chiếu trực tiếp (compile-time `satisfies` + runtime). Bắt buộc file này import chính spec suy TỪ nó là vòng ngược chiều.",
  // ── Vòng sửa lượt 9 (I-5.3) — BỐN file ĐÃ credit vẫn vượt NGUONG_CHEP_TAY_DA_CREDIT
  // (4) SAU khi bỏ comment (`boComment`) — đo TỪNG DÒNG 2026-09-04, cả bốn đều là
  // "toàn bộ mục đích của file LÀ xử lý per-field", không phải một khối chép giấu.
  "client/src/components/productModels/PointDetailsForm.tsx":
    "18/18 field — nhưng ĐÃ suy props TỪ LIMIT_FIELDS (khoá `point${Capitalize<F>}`/`setPoint${Capitalize<F>}`, " +
      "xác nhận lại ở review lượt 9 §I-1: 'kiểm từng dòng, đúng'). Mỗi field vẫn cần MỘT <Label>/<Input>/validate/i18n-key " +
      "RIÊNG trong JSX (không thể vòng-lặp-hoá UI form mà không phá cấu trúc hiển thị) ⇒ tên field xuất hiện nhiều " +
      "chỗ THẬT SỰ, không phải chép tay object literal.",
  "server/utils/measurementPointImport.ts":
    "10/18 field (sau bỏ comment) — hàm `buildInsertFromImportPoint` là ROW-BUILDER cho TOÀN BỘ cột giới hạn của " +
      "InsertMeasurementPointDef (bulk import): mỗi field có một dòng `strip ? undefined : dec(point.X)` RIÊNG (gate " +
      "BG-113/I-2 mới thêm SAU đột biến, xem `loiCapGioiHanSauMerge`) — không phải chép tay tên cột mà TÍNH TOÁN " +
      "per-field thật. `touchesLimits` đã suy từ `touchesApprovalLimitFields` (BG-104, tự-hết-hạn xong) từ trước.",
  "client/src/components/products/teach/ComponentLimitsDialog.tsx":
    "5/18 field (lowerLimit/upperLimit/unit/heightMin/heightMax) — dialog 'dạy giới hạn TRÊN HỆ' (Task 11), MỘT TẬP " +
      "CON CỐ Ý đại diện cho form nhập nhanh (không phải toàn bộ 18 cột spec-gate) — đã ghi rõ trong chính docblock " +
      "đầu file đó. Cùng lớp lý do đã xác nhận cho `teachTreeLogic.ts` (xem docblock `NGUONG_CHEP_TAY` phía trên).",
  "client/src/components/products/teach/teachTreeLogic.ts":
    "5/18 field — CÙNG tập con `TEN_COT_HIEN_THI` (lowerLimit/upperLimit/unit/heightMin/heightMax) cho bảng xem " +
      "trước UI cây dạy — đã xác nhận trong docblock `NGUONG_CHEP_TAY` (vòng sửa 2): 'KHÔNG phải chép lại 18 field " +
      "spec-gate'. Tái xuất hiện ở vòng sửa 9 CHỈ vì ngưỡng credited MỚI (4) — không phải một file mới, không phải " +
      "hành vi mới.",
  // ── Vòng sửa lượt 9, VÒNG 2 (NEW-1) — MỘT file MỚI vượt ngưỡng, do CHÍNH bản
  // vá NEW-1 (không phải nợ CÓ SẴN, đo lại 2026-09-04 SAU khi thêm gate 5 cặp).
  "server/db/product.ts":
    "10/18 field (lowerLimit/upperLimit/heightMin/heightMax/areaMin/areaMax/volumeMin/volumeMax/thicknessMin/" +
      "thicknessMax) — NEW-1 (review lượt 9, vòng 2, Important): gate `updateMeasurementPointLimitsBatch` " +
      "(assertCapGioiHanHopLe/gopCapGioiHanDonGian) TRƯỚC bản vá chỉ liệt kê 4 field (đúng arity CapGioiHan cũ, " +
      "trong ngưỡng); NEW-1 mở gate ra CẢ NĂM cặp min/max (area/volume/thickness từng đi qua trắng dù judge() chấm " +
      "cả năm) ⇒ hai object literal (`previous`/`rawFields`) PHẢI liệt kê đủ 10 tên để merge đúng — per-field THẬT " +
      "(không phải một khối chép tay giấu), CÙNG lớp lý do đã xác nhận cho `measurementPointImport.ts` ngay trên " +
      "(row-builder/gate cần TỪNG field một, không gộp được). `limitRangeGateCensus.test.ts` (NEW-1) đã kiểm ĐỘC " +
      "LẬP rằng đủ năm cặp — census này chỉ cần biết ĐÂY LÀ MỘT trong các điểm gọi đó, không phải chép tay mới.",
};

/** File thật trên đĩa CÓ DÒNG import từ `pointLimitSpec` (đọc dòng `import`, không đoán) — CHƯA đòi hỏi đã DÙNG. */
function importThangSpec(noiDung: string): boolean {
  return /from\s+["'][^"']*pointLimitSpec["']/.test(noiDung);
}

/**
 * ★★★ Vòng sửa lượt 9 (I-5.3) — trích các ĐỊNH DANH được import từ dòng
 * `import {...} from ".../pointLimitSpec"` (chịu được `import type`, đổi tên
 * `as`). Trả `[]` nếu không trích được theo dạng named-import (side-effect
 * import trần `import ".../pointLimitSpec";` — hiếm, không có định danh nào để
 * đòi "có dùng").
 */
function tenDinhDanhImportSpec(noiDung: string): string[] {
  const m = noiDung.match(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*pointLimitSpec["']/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.replace(/^\s*type\s+/, "").trim())
    .map((s) => (s.includes(" as ") ? s.split(" as ")[1]!.trim() : s))
    .filter(Boolean);
}

/**
 * ★★★ Vòng sửa lượt 9 (I-5.3, review lượt 9 §6-3 Đột biến B) — file THẬT SỰ đọc
 * spec: CÓ dòng import từ `pointLimitSpec` VÀ ÍT NHẤT MỘT định danh import đó
 * XUẤT HIỆN NGOÀI chính (các) dòng import — không chỉ một import TRANG TRÍ để
 * qua mặt census. Đo được (review): thêm
 * `import { LIMIT_FIELDS } from "@shared/pointLimitSpec";` KHÔNG DÙNG vào một
 * file chép tay 18 field MỚI giữ `daDocSpec()` cũ (chỉ đòi "có dòng import")
 * XANH — `importThangSpec()` đo "tệp có NHẮC TÊN module spec trong một câu
 * `from`", KHÔNG đo "tệp suy từ spec". Hàm này thay thế `importThangSpec` ở
 * MỌI chỗ census dùng để quyết định "đã đọc spec".
 */
function importThangSpecThatDuocDung(noiDung: string): boolean {
  if (!importThangSpec(noiDung)) return false;
  const ten = tenDinhDanhImportSpec(noiDung);
  if (ten.length === 0) return true; // side-effect import trần — không có định danh để đòi "dùng"
  // Bỏ MỌI COMMENT trước (kể cả comment CUỐI DÒNG ngay sau câu import — nếu
  // không, một dòng như `import {X} from "..."; // giải thích KHÔNG dùng X` sẽ
  // tự nhắc lại chữ `X` trong chính lời giải thích và đánh lừa phép kiểm "dùng
  // ngoài import" — đo được khi viết fuse test §6-3 Đột biến B của chính hàm
  // này), RỒI mới bỏ MỌI dòng `import ...;` (kể cả nhiều dòng, dừng ở dấu `;`
  // đầu tiên) và hỏi định danh còn xuất hiện Ở PHẦN CÒN LẠI không — "chỉ nằm
  // trong chính câu import (hoặc một comment nhắc tên nó)" ⇒ trang trí, không
  // phải dùng thật. Dùng `boComment` (khai bên dưới, hoisted — cùng module).
  const khongComment = boComment(noiDung);
  const khongCoDongImport = khongComment.replace(/^\s*import\b[^;]*;?/gm, "");
  return ten.some((t) => new RegExp(`\\b${t}\\b`).test(khongCoDongImport));
}

/**
 * Suy đường dẫn IMPORT (chuỗi sau `from`) của file `tuFile` thành một đường
 * dẫn TUYỆT ĐỐI trên đĩa (thử `.ts`/`.tsx`/`index.ts`/`index.tsx`), hoặc `null`
 * nếu KHÔNG phải import cục bộ (gói `node_modules`, vd `"zod"`/`"drizzle-orm"`)
 * hoặc không resolve được file nào. Hỗ trợ đúng ba kiểu import repo này dùng:
 * relative (`./x`, `../x`), alias `@shared/x` (`shared/x`), alias `@/x`
 * (`client/src/x`, xem `tsconfig.json` paths).
 */
function suyDuongDanImport(specifier: string, tuFile: string): string | null {
  let goc: string;
  if (specifier.startsWith(".")) {
    goc = resolve(dirname(tuFile), specifier);
  } else if (specifier.startsWith("@shared/")) {
    goc = join(GOC_REPO, "shared", specifier.slice("@shared/".length));
  } else if (specifier.startsWith("@/")) {
    goc = join(GOC_REPO, "client/src", specifier.slice("@/".length));
  } else {
    return null; // gói node_modules hoặc alias khác — không cục bộ, không resolve.
  }
  for (const ung of [`${goc}.ts`, `${goc}.tsx`, join(goc, "index.ts"), join(goc, "index.tsx")]) {
    try {
      if (statSync(ung).isFile()) return ung;
    } catch {
      // không tồn tại — thử ứng viên tiếp theo.
    }
  }
  return null;
}

/**
 * File `duongFile` (nội dung `noiDung`) được coi "ĐÃ ĐỌC SPEC" nếu import
 * THẲNG `pointLimitSpec`, HOẶC import một module mà module đó import THẲNG
 * `pointLimitSpec` (bắc cầu ĐÚNG MỘT BẬC — xem docblock "BỔ SUNG vòng sửa 2").
 * ⚠ Miễn trừ CẤP FILE — xem cảnh báo giới hạn ở docblock đầu file.
 */
function daDocSpec(duongFile: string, noiDung: string): boolean {
  if (importThangSpecThatDuocDung(noiDung)) return true;
  const specifiers = [...noiDung.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const sp of specifiers) {
    const duongY = suyDuongDanImport(sp, duongFile);
    if (!duongY) continue;
    let noiDungY: string;
    try {
      noiDungY = readFileSync(duongY, "utf8");
    } catch {
      continue;
    }
    // ★★★ I-5.3 — Y (module bắc cầu) cũng phải THẬT SỰ dùng spec, không chỉ nhắc
    // tên nó trong một câu `from` trang trí — cùng đòi hỏi như bậc trực tiếp.
    if (importThangSpecThatDuocDung(noiDungY)) return true;
  }
  return false;
}

/**
 * Quét `server/` + `shared/` + `client/src/` (trừ `node_modules`, `dist`,
 * `*.test.ts`/`*.test.tsx`, `*.d.ts`, và `DUONG_TU_LOAI_TRU`) — trừ các đường
 * dẫn trong `boQua`. Đường dẫn trả về LUÔN root-relative, dùng `/` (không phụ
 * thuộc hệ điều hành).
 *
 * ★★★ Vòng sửa lượt 9 (I-5.3, review §6-3) — file ĐÃ `daDocSpec()` KHÔNG còn
 * được BỎ QUA HOÀN TOÀN như trước (`if (daDocSpec) continue;` — lỗ mà Đột biến
 * A của review khai thác: nối một khối chép tay 18/18 field ĐỦ vào một file đã
 * credit, census cũ vẫn XANH vì không hề đếm `soField` của file đó). Nay MỌI
 * file đều được đếm `soField`, chỉ NGƯỠNG khác nhau: file CHƯA credit dùng
 * `NGUONG_CHEP_TAY` (6, giữ nguyên); file ĐÃ credit dùng
 * `NGUONG_CHEP_TAY_DA_CREDIT` (4, chặt hơn hẳn — một file đã đọc spec mà vẫn
 * nhắc >4 tên field là dấu hiệu một khối chép tay ĐANG NẤP sau credit).
 */
/**
 * ★★★ Vòng sửa lượt 9 (I-5.3) — xoá comment `//` VÀ khối `/* … *‍/` trước khi đếm
 * `soField` (không cần giữ số dòng). ĐO ĐƯỢC: `client/src/components/productModels/
 * types.ts` co-occur 2 tên spec (`lowerLimit`/`upperLimit`) NHƯNG cả hai chỉ nằm
 * trong MỘT dòng docblock liệt kê tên 18 field bằng VĂN XUÔI (giải thích "18 field
 * spec-gate, nay đến từ CacCotGioiHan") — không một dòng CODE nào khai/gán field
 * đó. Cùng khuôn `fakeUtcCensus.test.ts#dongMaKhongComment`/BG-96, viết lại độc
 * lập ở đây (không import chéo giữa hai tệp *.test.ts).
 */
function boComment(src: string): string {
  return src
    .split("\n")
    .map((dong) => {
      const tr = dong.trim();
      if (tr.startsWith("//") || tr.startsWith("*") || tr.startsWith("/**")) return "";
      // Comment `//` Ở CUỐI DÒNG (vd `import {X} from "...";  // giải thích`) —
      // cắt từ `//` trở đi. Đơn giản hoá CÓ CHỦ Ý (không phân biệt `//` trong
      // chuỗi ký tự, vd URL "http://…") — cùng đánh đổi mà mọi census regex khác
      // trong repo này chấp nhận (không phải AST); đo được KHÔNG có case đó xuất
      // hiện gần tên field trong sáu file bị canh hôm nay.
      const iCuoiDong = dong.indexOf("//");
      return iCuoiDong === -1 ? dong : dong.slice(0, iCuoiDong);
    })
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, ""); // khối /* … */ (kể cả trải nhiều dòng, đã qua lọc dòng-bắt-đầu-bằng-* ở trên cho ca thường gặp)
}

/** Đếm `soField` co-occur (SAU KHI bỏ comment — xem `boComment`) + `daCredit` cho
 * MỘT file — tách riêng để lưới đột biến gọi lại được ĐÚNG logic này trên một
 * chuỗi đã sửa trong bộ nhớ, không cần đi qua `quetChepTayGioiHan` (vốn luôn đọc
 * đĩa thật). ⚠ `daDocSpec` vẫn nhận `src` NGUYÊN VĂN (import luôn ở đầu dòng code
 * thật, không cần bỏ comment để tìm nó). */
function phanTichMotTep(duong: string, src: string): { soField: number; daCredit: boolean } {
  const daCredit = daDocSpec(duong, src);
  const srcKhongComment = boComment(src);
  let soField = 0;
  for (const field of LIMIT_FIELDS) {
    if (new RegExp(`\\b${field}\\b`).test(srcKhongComment)) soField++;
  }
  return { soField, daCredit };
}

/** `true` nếu (soField, daCredit) của một file VƯỢT ngưỡng tương ứng (đã credit dùng ngưỡng chặt hơn). */
function vuotNguong(pt: { soField: number; daCredit: boolean }): boolean {
  return pt.daCredit ? pt.soField > NGUONG_CHEP_TAY_DA_CREDIT : pt.soField >= NGUONG_CHEP_TAY;
}

function quetChepTayGioiHan(boQua: ReadonlySet<string>): { duong: string; soField: number; daCredit: boolean }[] {
  const tep: string[] = [];
  for (const goc of CAC_GOC_QUET) danhSachTepTs(join(GOC_REPO, goc), tep);
  const ket: { duong: string; soField: number; daCredit: boolean }[] = [];
  for (const duong of tep) {
    const duongTuongDoi = relative(GOC_REPO, duong).split(sep).join("/");
    if (DUONG_TU_LOAI_TRU.has(duongTuongDoi)) continue;
    if (boQua.has(duongTuongDoi)) continue;
    const src = readFileSync(duong, "utf8");
    const pt = phanTichMotTep(duong, src);
    if (vuotNguong(pt)) ket.push({ duong: duongTuongDoi, ...pt });
  }
  return ket.sort((a, b) => a.duong.localeCompare(b.duong));
}

describe("§3 — MỆNH ĐỀ QUÉT: không còn bản chép tay MỚI ngoài §1/§2", () => {
  const boQuaHomNay = new Set([
    ...Object.keys(NO_DA_BIET),
    ...Object.keys(MIEN_TRU_KIEN_TRUC),
    ...Object.keys(NO_DA_BIET_DA_CREDIT),
  ]);

  it("★★★ QUÉT THẬT trên server/+shared/+client/src/: 0 file chép tay ngoài nợ đã biết + miễn trừ kiến trúc (kể cả file ĐÃ credit vượt ngưỡng chặt)", () => {
    const ket = quetChepTayGioiHan(boQuaHomNay);
    expect(
      ket,
      `phát hiện file chép tay (≥${NGUONG_CHEP_TAY}/18 field nếu CHƯA đọc spec, >${NGUONG_CHEP_TAY_DA_CREDIT}/18 nếu ĐÃ đọc spec), chưa khai ở NO_DA_BIET/MIEN_TRU_KIEN_TRUC/NO_DA_BIET_DA_CREDIT: ${JSON.stringify(ket)}. ` +
        `Nếu tên KHÔNG nằm trong danh sách đã biết — ĐỪNG tự thêm allowlist, khai trong báo cáo để coordinator quyết định (xem docblock VÒNG SỬA 2 + BỔ SUNG vòng sửa 2 + I-5.3 vòng sửa 9).`,
    ).toEqual([]);
  });

  // ⚠ KHÔNG còn test "(b) BG-104" — đã XOÁ đúng thiết kế tự-hết-hạn (xem chú
  // thích tại chỗ BG-104 từng nằm trong NO_DA_BIET, ngay phía trên). Viết lại
  // một test tương tự CHO CÙNG file mà không đo lại lý do là đúng lỗi "nợ hoá
  // thạch" mà bản vá này sinh ra để tránh.
  //
  // Đột biến MÔ TẢ (không chạy — coordinator yêu cầu mô tả, không cần sửa đĩa
  // thật): giả sử `server/utils/measurementPointLimitGate.ts` bị đổi thành chép
  // TAY 18 tên field (thay vì `import { APPROVAL_LIMIT_FIELDS } from "@shared/pointLimitSpec"`).
  // Khi đó (a) chính `measurementPointLimitGate.ts` có `soField>=6` VÀ
  // `importThangSpec()` = false ⇒ bị §3 bắt TRỰC TIẾP, đúng tên; (b) với MỌI
  // file X import nó (`measurementPointImport.ts`/`productRouters.ts`/…),
  // `daDocSpec(X)` đọc LẠI nội dung `measurementPointLimitGate.ts` TRÊN ĐĨA tại
  // thời điểm quét (không cache, không đoán) — nội dung đó không còn khớp
  // `importThangSpec()` ⇒ `daDocSpec(X)` = false ⇒ X TÁI XUẤT HIỆN trong danh
  // sách bắt (nếu soField(X) vẫn ≥6, đúng trường hợp `measurementPointImport.ts`/
  // `productRouters.ts` hôm nay). Tức KHÔNG có file nào "sạch lây" nhờ một lần
  // import — mỗi lần quét đọc THẬT trạng thái Y, không ghim kết quả cũ.

  // (c) — cùng khuôn BG-104 cũ, MỘT test mỗi file BG-107 CÒN nợ (chưa credit).
  // Task 14 (2026-09-04) đã di trú 3/4 file gốc (`ProductModels.tsx`/`types.ts`/
  // `PointDetailsForm.tsx`) — 3 test (c) tương ứng ĐÃ XOÁ đúng thiết kế
  // tự-hết-hạn. Chỉ còn `BulkImportDialog.tsx` (R-KC-8 — di trú cần alias-map,
  // ngoài phạm vi Task 14, xem `NO_DA_BIET` ở trên).
  //
  // ★ Vòng sửa 9 (I-5.3) — `ProductModels.tsx` KHÔNG tái xuất hiện: ở ngưỡng
  // `NGUONG_CHEP_TAY_DA_CREDIT` ĐO ĐƯỢC ĐÚNG (4, không phải `3` BG-115 chỉ gợi
  // ý), co-occur đo được của nó (4) KHÔNG vượt ngưỡng ⇒ không cần allowlist tạm
  // (`NO_DA_BIET_DA_CREDIT` RỖNG hôm nay — xem docblock tại chỗ khai). `(c')`
  // dưới đây là hạ tầng cho lần tới dict đó có entry, không phải test đang chạy.
  for (const duongBG107 of [
    "client/src/components/BulkImportDialog.tsx",
  ] as const) {
    it(`(c) XÁC NHẬN nợ '${duongBG107}' (BG-107) CÒN THẬT hôm nay — Task 14 di trú xong file này thì test sẽ ĐỎ, đúng lúc đó xoá dòng NO_DA_BIET tương ứng và xoá CHÍNH test này`, () => {
      const boQuaTru = new Set([...boQuaHomNay].filter((p) => p !== duongBG107));
      const ket = quetChepTayGioiHan(boQuaTru);
      const duongs = ket.map((k) => k.duong);
      expect(
        duongs,
        `mệnh đề quét KHÔNG còn bắt được ${duongBG107} — nợ BG-107 (phần file này) có thể đã hết; nếu đúng, xoá dòng NO_DA_BIET và xoá test này`,
      ).toContain(duongBG107);
    });
  }

  // (c') — vòng sửa 9 (I-5.3) — MỘT test mỗi file trong `NO_DA_BIET_DA_CREDIT`
  // CÒN nợ (đã credit nhưng vẫn vượt ngưỡng chặt `NGUONG_CHEP_TAY_DA_CREDIT`).
  // CLIENT di trú xong (soField ≤ 3) thì test này ĐỎ — đúng lúc đó xoá dòng
  // allowlist tương ứng và xoá CHÍNH test này (cùng thiết kế tự-hết-hạn BG-104).
  for (const duongDaCredit of Object.keys(NO_DA_BIET_DA_CREDIT)) {
    it(`(c') XÁC NHẬN nợ '${duongDaCredit}' (đã credit, vẫn vượt ngưỡng ${NGUONG_CHEP_TAY_DA_CREDIT}) CÒN THẬT hôm nay — CLIENT di trú xong (soField ≤ ${NGUONG_CHEP_TAY_DA_CREDIT}) thì test này ĐỎ, đúng lúc đó xoá dòng NO_DA_BIET_DA_CREDIT và xoá CHÍNH test này`, () => {
      const boQuaTru = new Set([...boQuaHomNay].filter((p) => p !== duongDaCredit));
      const ket = quetChepTayGioiHan(boQuaTru);
      const duongs = ket.map((k) => k.duong);
      expect(
        duongs,
        `mệnh đề quét KHÔNG còn bắt được ${duongDaCredit} — nợ (phần file này) có thể đã hết; nếu đúng, xoá dòng NO_DA_BIET_DA_CREDIT và xoá test này`,
      ).toContain(duongDaCredit);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ★★★ ĐỘT BIẾN THẬT (I-5.3, review lượt 9 §6-3) — MÔ PHỎNG TRONG BỘ NHỚ, 0 byte
  // chạm đĩa: đo trên NỘI DUNG THẬT của `ProductModels.tsx` đã đọc ở trên, KHÔNG
  // ghi đè file.
  // ══════════════════════════════════════════════════════════════════════════
  const DUONG_PM = "client/src/pages/ProductModels.tsx";
  const NOI_DUNG_PM_THAT = readFileSync(join(GOC_REPO, DUONG_PM), "utf8");

  it("★★★ ĐỘT BIẾN A (§6-3): thêm 7 tên field MỚI vào ProductModels.tsx (đã credit) ⇒ vượt ngưỡng chặt, census phải ĐỎ", () => {
    const truoc = phanTichMotTep(DUONG_PM, NOI_DUNG_PM_THAT);
    expect(truoc.daCredit, "ProductModels.tsx phải ĐÃ credit hôm nay (bắc cầu qua types.ts) — nếu không, đột biến này không đo đúng lỗ §6-3").toBe(true);
    expect(vuotNguong(truoc), `soField hôm nay (${truoc.soField}) phải TRONG ngưỡng cho phép — nếu đã đỏ sẵn thì đột biến dưới đây không chứng minh được gì mới`).toBe(false);

    // 7 tên KHÔNG có mặt hôm nay trong ProductModels.tsx (đo trước — tránh đếm
    // trùng field đã co-occur sẵn, giữ đúng nghĩa "+7 tên MỚI").
    const BAY_TEN_MOI = ["heightMin", "heightMax", "areaMin", "areaMax", "volumeMin", "volumeMax", "coplanarityMax"] as const;
    for (const t of BAY_TEN_MOI) {
      expect(new RegExp(`\\b${t}\\b`).test(NOI_DUNG_PM_THAT), `[cầu chì] "${t}" đã có mặt sẵn — chọn lại 7 tên thật sự MỚI`).toBe(false);
    }
    // ★ Nối bằng MÃ THẬT (object literal), KHÔNG PHẢI comment — nếu chỉ bơm mồi
    // vào một dòng `//`, chính `boComment()` (được thêm vòng sửa 9 để đóng lỗ
    // `types.ts` co-occur-trong-docblock) sẽ xoá nó, khiến đột biến KHÔNG đột
    // biến gì (đo được — thất bại lần đầu viết test này, giữ lại bài học).
    const noiDungDotBien = `${NOI_DUNG_PM_THAT}\nconst BG113_DOT_BIEN_S6_3 = { ${BAY_TEN_MOI.map((t) => `${t}: null`).join(", ")} };\n`;
    const sau = phanTichMotTep(DUONG_PM, noiDungDotBien);
    expect(sau.soField, "soField phải tăng đúng 7").toBe(truoc.soField + 7);
    expect(sau.daCredit, "vẫn credit — đột biến không đụng dòng import").toBe(true);
    expect(vuotNguong(sau), "sau đột biến PHẢI vượt ngưỡng chặt — nếu vẫn false thì census KHÔNG canh được gì").toBe(true);

    // Đột biến chỉ sống trong biến `noiDungDotBien` — chưa từng ghi đĩa.
    const docLai = readFileSync(join(GOC_REPO, DUONG_PM), "utf8");
    expect(docLai).toBe(NOI_DUNG_PM_THAT);
  });

  it("★★★ ĐỘT BIẾN B (§6-3): import spec KHÔNG DÙNG (trang trí) trên một file chép tay MỚI ⇒ vẫn bị bắt (không credit giả)", () => {
    // Mô phỏng ĐÚNG hình dạng Đột biến B của review: một file MỚI hoàn toàn chép
    // tay đủ field, kèm MỘT dòng import spec nhưng KHÔNG hề dùng định danh đó ở
    // đâu khác trong file — "trang trí" để qua mặt daDocSpec() cũ.
    const TEN_GIA = "server/contracts/__gia_lap_dot_bien_b.ts";
    const NOI_DUNG_GIA =
      `import { LIMIT_FIELDS } from "@shared/pointLimitSpec"; // KHÔNG dùng LIMIT_FIELDS ở đâu khác\n` +
      `export const row = {\n` +
      LIMIT_FIELDS.map((f) => `  ${f}: null,`).join("\n") +
      `\n};\n`;
    // Cầu chì: bản GIẢ ĐỊNH này thật sự có dòng import (importThangSpec cũ sẽ tin nó).
    expect(importThangSpec(NOI_DUNG_GIA)).toBe(true);
    const pt = phanTichMotTep(TEN_GIA, NOI_DUNG_GIA);
    expect(pt.daCredit, "import KHÔNG DÙNG không được tính là 'đã đọc spec' — nếu true thì §6-3 Đột biến B vẫn qua mặt được census").toBe(false);
    expect(pt.soField).toBe(LIMIT_FIELDS.length); // đủ 18/18
    expect(vuotNguong(pt), "0 credit ⇒ dùng ngưỡng THƯỜNG (6) — 18 ≥ 6 ⇒ phải bị bắt").toBe(true);
  });
});
