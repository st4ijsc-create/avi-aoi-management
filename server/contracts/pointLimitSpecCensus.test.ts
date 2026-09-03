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
import { describe, it, expect } from "vitest";
import type { PointLimitSource } from "../services/pointResultEvaluator";
import { measurementPointDefs } from "../../drizzle/schema";
import { POINT_LIMIT_SPEC, LIMIT_FIELDS } from "../../shared/pointLimitSpec";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

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
// §3 — MỆNH ĐỀ QUÉT: server/**/*.ts không còn bản chép tay NGOÀI vùng canh §1/§2
// ════════════════════════════════════════════════════════════════════════════

/** Gốc quét = `server/` (thư mục cha của `server/contracts/`, nơi file này sống). */
const GOC_QUET = resolve(__dirname, "..");

function danhSachTepTs(dir: string, out: string[]): void {
  for (const ten of readdirSync(dir)) {
    if (ten === "node_modules") continue;
    const duong = join(dir, ten);
    const tt = statSync(duong);
    if (tt.isDirectory()) danhSachTepTs(duong, out);
    else if (ten.endsWith(".ts") && !ten.endsWith(".test.ts") && !ten.endsWith(".d.ts")) out.push(duong);
  }
}

/**
 * Ngưỡng "chép tay": số field PHÂN BIỆT trong 18 field của `LIMIT_FIELDS` xuất
 * hiện dạng TỪ NGUYÊN (`\bfield\b`, không khớp một phần của tên khác) trong
 * MỘT file. Đo THẬT trên `server/**\/*.ts` (2026-09-03, trước khi vá vòng này):
 * có một khoảng trống RÕ giữa "chép tay thật" và "nhắc lẻ tẻ không phải chép
 * tay" — 5 file ở mức 10-18 field (`machineApiRouters.ts`, `productRouters.ts`,
 * `pointResultEvaluator.ts`, `productPackageService.ts` = 18; `measurementPointImport.ts`
 * = 10), rồi RỚT THẲNG xuống ≤4 (`masterDataRouter.ts`, `stationAnalysisRouter.ts`,
 * `productReadinessService.ts`, … — chỉ nhắc 1-4 field cho việc khác, không phải
 * chép cả khối). KHÔNG file nào rơi vào khoảng 5-9. N=6 nằm giữa khoảng trống
 * đó — chọn 6 (không phải 5 hay 10) để có biên an toàn cả hai phía.
 */
const NGUONG_CHEP_TAY = 6;

/**
 * File ĐÃ BIẾT chép tay một khối giới hạn nhưng KHÔNG PHẢI của Task 7 — canh
 * riêng bằng ticket, KHÔNG xoá âm thầm khi nó biến mất (xem test "XÁC NHẬN nợ"
 * bên dưới — hễ nợ hết thật thì XOÁ dòng tương ứng Ở ĐÂY).
 */
const NO_DA_BIET: Record<string, string> = {
  "routers/productRouters.ts":
    "Task 8 — zod input `measurementPoint.update` + `touchesLimits` (mở từ brief Task 7 gốc; agent khác đang giữ file này, Task 7 KHÔNG được chạm).",
  "utils/measurementPointImport.ts":
    "BG-104 — Task 8 (gate `touchesLimits` riêng), đang chạy. Xác nhận CÒN bị mệnh đề quét bắt 2026-09-03 (xem test '(b) XÁC NHẬN nợ' bên dưới) — Task 8 đóng thì xoá dòng này VÀ xoá test đó.",
};

/** File KHÔNG phải bản sao — nó LÀ đích tham chiếu mà §2 đã so trực tiếp (spec suy THEO nó, không phải ngược lại). Miễn trừ VĨNH VIỄN, không phải nợ. */
const MIEN_TRU_KIEN_TRUC: Record<string, string> = {
  "services/pointResultEvaluator.ts":
    "Định nghĩa `PointLimitSource` — §2 ở trên đã đối chiếu trực tiếp (compile-time `satisfies` + runtime). Bắt buộc file này import chính spec suy TỪ nó là vòng ngược chiều.",
};

/**
 * Quét toàn bộ `server/**\/*.ts` (trừ `*.test.ts`/`*.d.ts`), trả về file có
 * ≥`NGUONG_CHEP_TAY` field của `LIMIT_FIELDS` co-occur mà KHÔNG import
 * `pointLimitSpec` — trừ các đường dẫn trong `boQua`. Đường dẫn trả về LUÔN
 * dùng `/` (không phụ thuộc hệ điều hành).
 */
function quetChepTayGioiHan(boQua: ReadonlySet<string>): { duong: string; soField: number }[] {
  const tep: string[] = [];
  danhSachTepTs(GOC_QUET, tep);
  const ket: { duong: string; soField: number }[] = [];
  for (const duong of tep) {
    const duongTuongDoi = relative(GOC_QUET, duong).split(sep).join("/");
    if (boQua.has(duongTuongDoi)) continue;
    const src = readFileSync(duong, "utf8");
    // Đã suy từ spec ⇒ có dòng `import { ... } from ".../pointLimitSpec"`.
    if (/from\s+["'][^"']*pointLimitSpec["']/.test(src)) continue;
    let soField = 0;
    for (const field of LIMIT_FIELDS) {
      if (new RegExp(`\\b${field}\\b`).test(src)) soField++;
    }
    if (soField >= NGUONG_CHEP_TAY) ket.push({ duong: duongTuongDoi, soField });
  }
  return ket.sort((a, b) => a.duong.localeCompare(b.duong));
}

describe("§3 — MỆNH ĐỀ QUÉT: không còn bản chép tay MỚI ngoài §1/§2", () => {
  const boQuaHomNay = new Set([...Object.keys(NO_DA_BIET), ...Object.keys(MIEN_TRU_KIEN_TRUC)]);

  it("★★★ QUÉT THẬT trên server/**/*.ts: 0 file chép tay ngoài nợ đã biết + miễn trừ kiến trúc", () => {
    const ket = quetChepTayGioiHan(boQuaHomNay);
    expect(
      ket,
      `phát hiện file chép tay ≥${NGUONG_CHEP_TAY}/18 field, chưa import pointLimitSpec, chưa khai ở NO_DA_BIET/MIEN_TRU_KIEN_TRUC: ${JSON.stringify(ket)}`,
    ).toEqual([]);
  });

  it("(b) XÁC NHẬN nợ 'utils/measurementPointImport.ts' (BG-104) CÒN THẬT hôm nay — Task 8 đóng thì test này sẽ ĐỎ, đúng lúc đó xoá NO_DA_BIET tương ứng và xoá CHÍNH test này", () => {
    const boQuaTruMPI = new Set([...boQuaHomNay].filter((p) => p !== "utils/measurementPointImport.ts"));
    const ket = quetChepTayGioiHan(boQuaTruMPI);
    const duongs = ket.map((k) => k.duong);
    expect(
      duongs,
      "mệnh đề quét KHÔNG còn bắt được utils/measurementPointImport.ts — nợ BG-104 có thể đã hết (Task 8 xong); nếu đúng, xoá dòng NO_DA_BIET và xoá test này",
    ).toContain("utils/measurementPointImport.ts");
  });
});
