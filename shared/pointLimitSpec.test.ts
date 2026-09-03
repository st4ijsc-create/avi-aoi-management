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

import { POINT_LIMIT_SPEC, LIMIT_FIELDS, APPROVAL_LIMIT_FIELDS, type MucGioiHan } from "./pointLimitSpec";

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
