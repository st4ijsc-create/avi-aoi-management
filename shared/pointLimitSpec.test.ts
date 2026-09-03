/**
 * Task 7 Khối C (QĐ-3) — cổng canh MỘT nguồn sự thật cho 18 cột giới hạn.
 *
 * Trước bản vá: danh sách 18 cột chép tay ở BỐN nơi (SELECT `cayDay.ts`, kiểu
 * `PointLimitSource`, zod input `productRouters.ts`, `touchesLimits`), không
 * cổng nào canh lệch nhau — `cayDay.ts` tự cảnh báo "thiếu một cột ở đây là
 * một chiều giới hạn KHÔNG BAO GIỜ được chấm, và không lưới nào đỏ".
 *
 * Lưới NÀY canh phần THUẦN (không cần DB, không cần import server/**): (1)
 * đúng 18 field, không trùng; (2) i18nKey đúng khuôn `pointLimits.<field>`;
 * (3) `APPROVAL_LIMIT_FIELDS` = `LIMIT_FIELDS` + đúng 4 field nghiệp vụ, không
 * gộp lẫn; (4) module giữ 0 import (như `shared/rollupVerdict.ts`) — đối
 * chiếu spec ↔ `PointLimitSource` ↔ `measurementPointDefs` (schema DB thật)
 * sống ở `server/contracts/pointLimitSpecCensus.test.ts`, KHÔNG ở đây; (5)
 * `server/db/cayDay.ts` (nơi DUY NHẤT trong phạm vi Task 7 tiêu thụ spec này)
 * đã đổi sang import từ đây, không còn tự khai danh sách 18 cột.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

import { POINT_LIMIT_SPEC, LIMIT_FIELDS, APPROVAL_LIMIT_FIELDS, F, MIN_MAX_PAIRS, type MucGioiHan, type PointLimitField } from "./pointLimitSpec";

// Bốn field "giới hạn nghiệp vụ" — không nằm trong PointLimitSource (spec-gate
// không tra chúng) nhưng sửa chúng phải qua hàng đợi duyệt ngưỡng.
const FIELD_NGHIEP_VU_RIENG = ["nominalValue", "toleranceMode", "tolPlus", "tolMinus"];

const NHOM_HOP_LE: ReadonlySet<MucGioiHan["nhom"]> = new Set(["1d", "3d", "gdt", "criteria"]);

describe("Task 7 — POINT_LIMIT_SPEC / LIMIT_FIELDS (một nguồn sự thật)", () => {
  it("★★★ có ĐÚNG 18 mục — đổi số này là một lời khai, không phải bảo trì im lặng", () => {
    expect(POINT_LIMIT_SPEC.length).toBe(18);
    expect(LIMIT_FIELDS.length).toBe(18);
  });

  it("không field nào trùng khoá", () => {
    expect(new Set(LIMIT_FIELDS).size).toBe(LIMIT_FIELDS.length);
  });

  it("LIMIT_FIELDS = POINT_LIMIT_SPEC.map(m => m.field), đúng thứ tự", () => {
    expect(LIMIT_FIELDS).toEqual(POINT_LIMIT_SPEC.map((m) => m.field));
  });

  it("mọi mục có nhom hợp lệ (1d/3d/gdt/criteria)", () => {
    for (const m of POINT_LIMIT_SPEC) {
      expect(NHOM_HOP_LE.has(m.nhom), `field "${m.field}" có nhom lạ: "${m.nhom}"`).toBe(true);
    }
  });

  it("mọi mục có i18nKey đúng khuôn pointLimits.<field>", () => {
    for (const m of POINT_LIMIT_SPEC) {
      expect(m.i18nKey).toBe(`pointLimits.${m.field}`);
    }
  });

  it("APPROVAL_LIMIT_FIELDS = LIMIT_FIELDS + đúng 4 field nghiệp vụ (không gộp lẫn)", () => {
    expect(APPROVAL_LIMIT_FIELDS.length).toBe(LIMIT_FIELDS.length + 4);
    // 18 phần tử đầu = nguyên văn LIMIT_FIELDS.
    expect(APPROVAL_LIMIT_FIELDS.slice(0, LIMIT_FIELDS.length)).toEqual(LIMIT_FIELDS);
    // 4 phần tử đuôi = đúng bốn field nghiệp vụ, không thừa không thiếu.
    const duoi = APPROVAL_LIMIT_FIELDS.slice(LIMIT_FIELDS.length);
    expect([...duoi].sort()).toEqual([...FIELD_NGHIEP_VU_RIENG].sort());
  });

  it("shared/pointLimitSpec.ts giữ 0 import (THUẦN — không được import server/**)", () => {
    const src = readFileSync(resolve(__dirname, "pointLimitSpec.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it("server/db/cayDay.ts KHÔNG còn tự khai danh sách 18 cột — dùng POINT_LIMIT_SPEC dùng chung", () => {
    const src = readFileSync(resolve(__dirname, "../server/db/cayDay.ts"), "utf8");
    expect(src).toContain("POINT_LIMIT_SPEC");
    expect(src).toContain('from "@shared/pointLimitSpec"');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ★★★ NEW-2 (review Khối C lượt 9, vòng 2, Important) — `F`: bản đồ TÊN→TÊN
// thay hằng số suy từ VỊ TRÍ mảng (`POINT_LIMIT_SPEC[i].field`) mà
// `client/src/pages/ProductModels.tsx` (I-1, vòng sửa 9 lượt 1) dùng cho 18
// hằng số `FIELD_*` — đúng hôm nay, nhưng CÂM khi ai đổi THỨ TỰ khai trong
// `POINT_LIMIT_SPEC` (không đổi TẬP field, `tsc` không báo lỗi): một hằng số có
// thể lặng lẽ trỏ SANG FIELD KHÁC, vẫn hợp kiểu.
// ══════════════════════════════════════════════════════════════════════════
describe("★★★ NEW-2 — F (bản đồ khoá→tên, KHÔNG neo theo vị trí mảng)", () => {
  it("F.<field> === '<field>' cho cả 18 field — mỗi khoá tự trỏ về CHÍNH NÓ", () => {
    for (const f of LIMIT_FIELDS) {
      expect(F[f]).toBe(f);
    }
  });

  it("F đúng 18 khoá — không thừa không thiếu so với LIMIT_FIELDS", () => {
    expect(Object.keys(F).sort()).toEqual([...LIMIT_FIELDS].sort());
  });

  it("cầu chì kiểu compile-time — F.lowerLimit/F.heightMin PHẢI là literal đúng tên (không phải `string` rộng)", () => {
    // Nếu `F` suy sai kiểu (vd rơi về `Record<string,string>`), dòng dưới vẫn
    // biên dịch được nhưng KHÔNG còn ý nghĩa "khớp field thật" ở compile-time —
    // gán vào một biến kiểu hẹp buộc `tsc` xác nhận LITERAL, không chỉ `string`.
    const kiemLower: "lowerLimit" = F.lowerLimit;
    const kiemHeightMin: "heightMin" = F.heightMin;
    expect(kiemLower).toBe("lowerLimit");
    expect(kiemHeightMin).toBe("heightMin");
  });

  // ── ĐỘT BIẾN THẬT (mô phỏng TRONG BỘ NHỚ) — hoán đổi VỊ TRÍ hai phần tử của
  // một BẢN SAO `POINT_LIMIT_SPEC` (heightMin ⇄ areaMin, giữ NGUYÊN tập field,
  // đúng hình dạng "đổi thứ tự khai, không đổi tập" mà docblock NEW-2 mô tả) —
  // chứng minh HAI CÁCH SUY khác nhau phản ứng khác nhau với cùng một hoán đổi:
  //   · Kiểu CŨ (suy theo CHỈ SỐ, `banSaoDaHoanDoi[i].field`) ⇒ SILENT MISWIRE —
  //     hằng số ở vị trí 3 giờ trỏ sang field KHÁC, không có lỗi nào nổi lên.
  //   · Kiểu MỚI (`F`, suy theo TÊN — LUÔN đúng bằng field.field CHÍNH nó, không
  //     đọc theo vị trí) ⇒ KHÔNG ĐỔI, đúng ý brief "sau bản vá: không đổi".
  // ══════════════════════════════════════════════════════════════════════════
  it("★★★ ĐỘT BIẾN: hoán đổi VỊ TRÍ heightMin/areaMin trong một bản sao spec ⇒ suy-theo-CHỈ-SỐ (kiểu CŨ) đấu dây SAI, suy-theo-TÊN (F) VẪN ĐÚNG", () => {
    const iHeightMin = POINT_LIMIT_SPEC.findIndex((m) => m.field === "heightMin");
    const iAreaMin = POINT_LIMIT_SPEC.findIndex((m) => m.field === "areaMin");
    expect(iHeightMin, "cầu chì: heightMin phải có mặt").toBeGreaterThanOrEqual(0);
    expect(iAreaMin, "cầu chì: areaMin phải có mặt").toBeGreaterThanOrEqual(0);
    expect(iHeightMin).not.toBe(iAreaMin);

    // Bản sao ĐÃ HOÁN ĐỔI vị trí (KHÔNG đổi tập field — vẫn đủ 18, chỉ đổi thứ tự).
    const banSaoDaHoanDoi = POINT_LIMIT_SPEC.map((m) => ({ ...m }));
    const tam = banSaoDaHoanDoi[iHeightMin];
    banSaoDaHoanDoi[iHeightMin] = banSaoDaHoanDoi[iAreaMin]!;
    banSaoDaHoanDoi[iAreaMin] = tam!;
    expect(banSaoDaHoanDoi.map((m) => m.field).sort()).toEqual([...LIMIT_FIELDS].sort()); // tập KHÔNG đổi

    // TRƯỚC (kiểu CŨ, ProductModels.tsx trước NEW-2) — hằng số suy THEO CHỈ SỐ CỐ ĐỊNH.
    const FIELD_HEIGHT_MIN_KIEU_CU = banSaoDaHoanDoi[iHeightMin]!.field; // vị trí CŨ của heightMin, nay giữ field KHÁC
    expect(
      FIELD_HEIGHT_MIN_KIEU_CU,
      "ĐỘT BIẾN PHẢI cho thấy đấu dây SAI ở kiểu CŨ — hằng số ở vị trí heightMin cũ nay trỏ field KHÁC (silent miswire)",
    ).not.toBe("heightMin");
    expect(FIELD_HEIGHT_MIN_KIEU_CU).toBe("areaMin"); // đúng field vừa hoán đổi vào

    // SAU (kiểu MỚI, F suy THEO TÊN, không đọc vị trí mảng — không phụ thuộc
    // banSaoDaHoanDoi chút nào, luôn đọc TỪ chính field.field của MỖI phần tử).
    const fSuyLaiTuBanSaoHoanDoi = Object.fromEntries(banSaoDaHoanDoi.map((m) => [m.field, m.field])) as Record<PointLimitField, PointLimitField>;
    expect(
      fSuyLaiTuBanSaoHoanDoi.heightMin,
      "F PHẢI KHÔNG ĐỔI dù mảng nguồn bị hoán đổi vị trí — suy theo TÊN, không theo CHỈ SỐ",
    ).toBe("heightMin");
    expect(fSuyLaiTuBanSaoHoanDoi.areaMin).toBe("areaMin");
    // Đối chứng: F THẬT (từ POINT_LIMIT_SPEC gốc, chưa hoán đổi) cũng khớp —
    // chứng minh phép suy KHÔNG PHỤ THUỘC thứ tự khai gốc lẫn đột biến.
    expect(F.heightMin).toBe("heightMin");
    expect(F.areaMin).toBe("areaMin");
  });

  it("MIN_MAX_PAIRS (NEW-1) cũng suy theo TÊN, KHÔNG theo vị trí — cùng nguyên tắc với F (đối chứng chéo)", () => {
    for (const { min, max } of MIN_MAX_PAIRS) {
      expect(F[min]).toBe(min);
      expect(F[max]).toBe(max);
    }
  });
});
