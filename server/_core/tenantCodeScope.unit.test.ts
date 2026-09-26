/**
 * ★★★ 2026-08-18 — TRỤC PHẠM VI THỨ HAI (mã tenant tường minh của khoá API).
 *
 * Lưới này đo **SQL THẬT ĐƯỢC KẾT XUẤT**, không đo "hàm có trả về gì đó không". Lý do đo được:
 * cả tuần này lớp lỗi lặp lại đúng một hình dạng — một vị từ TRÔNG như đang lọc nhưng kết xuất
 * thành thứ khác (`or()` rỗng ⇒ `undefined` ⇒ KHÔNG có mệnh đề WHERE ⇒ 22.996/22.996 hàng lọt).
 * Một ca `expect(filter).toBeDefined()` XANH dưới cả `1 = 1` lẫn `1 = 0`, nên nó không phân biệt
 * được bản vá với chính lỗ hổng. `PgDialect.sqlToQuery` cho ra CHUỖI SQL và DANH SÁCH THAM SỐ —
 * đó mới là thứ chạy trên CSDL.
 *
 * Ba điều được canh, và mỗi điều đều có một đột biến rất dễ viết đứng sau nó:
 *   ① Lời khai RỖNG ⇒ `1 = 0` (KHÔNG phải `1 = 1`, KHÔNG phải `undefined`).
 *   ② Hai mã nối bằng **AND**, không phải OR. Đột biến AND→OR NỚI quyền: một khoá khai
 *     `corporateCode='SIM' + factoryCode='SIM-FAC'` sẽ thấy MỌI nhà máy của SIM.
 *   ③ Mã đi vào bằng **THAM SỐ RÀNG BUỘC**, không nối chuỗi (nối chuỗi ở đây là một lỗ tiêm).
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  isTenantCodeScopeEmpty,
  tenantCodeInspectionFilter,
  type TenantCodeScope,
} from "./tenantCodeScope";
import type { ReportRollupFilters } from "../db/reportAggregators";
import type { ShiftReportFilters } from "../db/statistics";
import type { OeeViewerScope } from "../services/oeeService";

const dialect = new PgDialect();
const render = (scope: TenantCodeScope | null | undefined) => {
  const q = dialect.sqlToQuery(tenantCodeInspectionFilter(scope));
  return { sql: q.sql, params: q.params };
};

describe("tenantCodeInspectionFilter — SQL kết xuất, không phải 'có trả về gì đó'", () => {
  it("① lời khai RỖNG ⇒ `1 = 0` TƯỜNG MINH", () => {
    for (const empty of [{}, null, undefined, { corporateCode: null, factoryCode: null }, { factoryCode: "" }]) {
      const r = render(empty as TenantCodeScope);
      expect(r.sql.replace(/\s+/g, " ").trim()).toBe("1 = 0");
      // ⚠ Neo cả chiều NGƯỢC: `1 = 1` là bản vá-giả trông y hệt bản vá thật ở mọi ca "toBeDefined".
      expect(r.sql).not.toContain("1 = 1");
    }
    expect(isTenantCodeScopeEmpty({})).toBe(true);
    expect(isTenantCodeScopeEmpty({ factoryCode: "F" })).toBe(false);
  });

  it("② hai mã nối bằng AND (đột biến AND→OR NỚI quyền ra cả tập đoàn)", () => {
    const r = render({ corporateCode: "CORP", factoryCode: "FAC" });
    expect(r.sql).toContain('"product_inspections"."corporateCode"');
    expect(r.sql).toContain('"product_inspections"."factoryCode"');
    expect(r.sql.toLowerCase()).toContain(" and ");
    expect(r.sql.toLowerCase()).not.toContain(" or ");
    expect(r.params).toEqual(["CORP", "FAC"]);
  });

  it("③ mã đi qua THAM SỐ RÀNG BUỘC, không nối chuỗi (chống tiêm)", () => {
    const evil = "X' OR '1'='1";
    const r = render({ factoryCode: evil });
    expect(r.sql).not.toContain(evil);
    expect(r.params).toEqual([evil]);
  });

  it("một mã một mình vẫn ra ĐÚNG cột ấy (chiều DƯƠNG, chống vá quá tay)", () => {
    const onlyCorp = render({ corporateCode: "CORP" });
    expect(onlyCorp.sql).toContain('"product_inspections"."corporateCode"');
    expect(onlyCorp.sql).not.toContain('"factoryCode"');
    expect(onlyCorp.params).toEqual(["CORP"]);

    const onlyFac = render({ factoryCode: "FAC" });
    expect(onlyFac.sql).toContain('"product_inspections"."factoryCode"');
    expect(onlyFac.sql).not.toContain('"corporateCode"');
  });

  it("⚠ KHÔNG đặt bí danh bảng — cột kết xuất theo TÊN BẢNG (bẫy 42P01)", () => {
    // Truy vấn thô nào viết `FROM product_inspections pi` sẽ vỡ `42P01` khi nhúng vị từ này.
    // Ca này giữ hợp đồng ấy hiện hình, để một lượt "dọn dẹp" thêm bí danh vào sẽ ĐỎ ở đây
    // trước khi ĐỎ trên CSDL sản xuất.
    expect(render({ factoryCode: "FAC" }).sql).toContain('"product_inspections".');
  });
});

/**
 * ★★★ LƯỚI Ở TẦNG KIỂU. Hai trục phạm vi phải LOẠI TRỪ NHAU, và điều đó phải do trình biên dịch
 * cưỡng chế — không phải do một quy ước ai đó nhớ.
 *
 * ⚠ `@ts-expect-error` là một PHÉP ĐO HAI CHIỀU, không phải một lời chú thích: nếu kiểu bị nới ra
 * (ví dụ ai đó đổi union thành một interface phẳng) thì dòng dưới nó KHÔNG còn lỗi, và `tsc` sẽ
 * báo **"Unused '@ts-expect-error' directive"** ⇒ `npm run check:tests` ĐỎ. Đó chính là cái bẫy
 * cần: một union giả (chấp nhận cả hai trục) sẽ bị bắt, chứ không lặng lẽ xanh.
 */
describe("hai trục phạm vi loại trừ nhau Ở TẦNG KIỂU", () => {
  it("mỗi trục MỘT MÌNH biên dịch được; CẢ HAI cùng lúc thì KHÔNG", () => {
    const win = { startDate: new Date(), endDate: new Date() };

    // ── DƯƠNG: từng trục một mình (chống "cấm quá tay thành cấm tất cả") ──
    const byUser: ReportRollupFilters = { ...win, userId: 7, userRole: "engineer" };
    const byTenant: ReportRollupFilters = { ...win, tenantScope: { factoryCode: "FAC" } };
    const byNothing: ReportRollupFilters = { ...win, machineId: 3 };
    const shiftUser: ShiftReportFilters = { userId: 7, userRole: "engineer" };
    const shiftTenant: ShiftReportFilters = { tenantScope: { corporateCode: "CORP" } };
    const oeeUser: OeeViewerScope = { userId: 7 };
    const oeeTenant: OeeViewerScope = { tenantScope: { factoryCode: "FAC" } };

    // ── ÂM: hai trục cùng lúc là một câu MƠ HỒ về phân quyền ⇒ phải không biên dịch được ──
    // @ts-expect-error hai trục loại trừ nhau
    const bothRollup: ReportRollupFilters = { ...win, userId: 7, tenantScope: { factoryCode: "FAC" } };
    // @ts-expect-error hai trục loại trừ nhau
    const bothShift: ShiftReportFilters = { userId: 7, tenantScope: { factoryCode: "FAC" } };
    // @ts-expect-error hai trục loại trừ nhau
    const bothOee: OeeViewerScope = { userId: 7, tenantScope: { factoryCode: "FAC" } };

    // Dùng tới các biến để lint/tsc không loại chúng khỏi phép đo.
    expect([byUser, byTenant, byNothing, shiftUser, shiftTenant, oeeUser, oeeTenant].length).toBe(7);
    expect([bothRollup, bothShift, bothOee].length).toBe(3);
  });
});
