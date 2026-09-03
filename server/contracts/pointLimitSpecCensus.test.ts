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
import { describe, it, expect } from "vitest";
import type { PointLimitSource } from "../services/pointResultEvaluator";
import { measurementPointDefs } from "../../drizzle/schema";
import { POINT_LIMIT_SPEC, LIMIT_FIELDS } from "../../shared/pointLimitSpec";

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
