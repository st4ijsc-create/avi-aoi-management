/**
 * ★★★ 2026-08-18 — NHÓM B #2/#3. Lưới NHANH cho hai nguyên thuỷ của trục `factoryId`.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * File này KHÔNG thay cho lưới chạm CSDL thật (`oeeWarRoomScope.db.test.ts`) — nó canh đúng ba
 * thứ mà một cái mock CÓ THỂ phát biểu, và ba thứ ấy đều là lớp lỗi ĐÃ CẮN trong repo này:
 *
 *  1. **Tập rỗng KHÔNG được biến thành "không lọc".** Đây chính xác là `or()!` → `undefined` đã
 *     cho 4 tài khoản 0-gán đọc trọn 22.996 bản ghi kiểm (xem `DENY_ALL_ROWS`). Ở đây tập rỗng
 *     phải kết xuất thành vị từ `1 = 0` TƯỜNG MINH.
 *  2. **Không dùng `col = ANY(${mảng JS})`.** postgres.js gửi mảng JS thành `text[]` ⇒ `42809`
 *     (`op ANY/ALL (array) requires array on right side`) — đã cắn 10 chỗ trong repo.
 *  3. **`filter` (đối tượng SQL drizzle, tham chiếu vòng) KHÔNG được có mặt trong kết quả phân
 *     giải.** `TenantFactoryScope` cố ý không có ô ấy; một lượt `{...scope}` trên đường ra tRPC
 *     phải luôn `JSON.stringify` được. (`dashboard.getStats` đã trả 500 vì đúng lỗi này.)
 */
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { factoryIdGate, resolveTenantFactoryScope } from "./reportAggregators";
import { UNSCOPED_LABELS } from "../_core/accessControlLabels";

const dialect = new PgDialect();
const render = (s: ReturnType<typeof factoryIdGate>) => dialect.sqlToQuery(s);

describe("factoryIdGate — vị từ IN trên cột factoryId", () => {
  it("TẬP RỖNG ⇒ `1 = 0` TƯỜNG MINH, KHÔNG phải mảnh rỗng / undefined", () => {
    const q = render(factoryIdGate(sql`"factoryId"`, []));
    expect(q.sql.replace(/\s+/g, " ").trim()).toBe("1 = 0");
    expect(q.params).toEqual([]);
  });

  it("có id ⇒ IN với THAM SỐ RÀNG BUỘC từng cái (không nội suy chuỗi)", () => {
    const q = render(factoryIdGate(sql`"factoryId"`, [7, 9]));
    // Hình dạng thật: `"factoryId" IN ($1, $2)` — khẳng định theo mảnh, không theo chuỗi cứng.
    expect(q.sql).toContain('"factoryId"');
    expect(q.sql).toContain("IN (");
    expect(q.params).toEqual([7, 9]);
  });

  it("KHÔNG bao giờ kết xuất `= ANY(...)` — mảng JS sang postgres.js là `42809`", () => {
    const q = render(factoryIdGate(sql`"factoryId"`, [1, 2, 3]));
    expect(q.sql).not.toMatch(/ANY\s*\(/i);
    // Mỗi phần tử là MỘT tham số riêng, không phải một tham số mảng.
    expect(q.params).toHaveLength(3);
  });

  it("dùng được với bí danh của truy vấn thô (w.\"factoryId\") — không tự đặt tên bảng", () => {
    const q = render(factoryIdGate(sql`w."factoryId"`, [5]));
    expect(q.sql).toContain('w."factoryId"');
    expect(q.sql).not.toContain("workshops");
  });
});

describe("resolveTenantFactoryScope — lối đi KHÔNG mang danh tính + vai toàn quyền", () => {
  it("không có userId ⇒ factoryIds = null (KHÔNG lọc) + nhãn UNSCOPED", async () => {
    const s = await resolveTenantFactoryScope();
    expect(s.factoryIds).toBeNull();
    expect(s.labels).toEqual(UNSCOPED_LABELS);
  });

  it("vai admin ⇒ factoryIds = null (chống vá quá tay thành chặn tất cả)", async () => {
    const s = await resolveTenantFactoryScope({ userId: 1, userRole: "admin" });
    expect(s.factoryIds).toBeNull();
    expect(s.labels.scopeApplied).toBe(false);
  });

  it("kết quả KHÔNG mang ô `filter` ⇒ luôn JSON.stringify được", async () => {
    const s = await resolveTenantFactoryScope({ userId: 1, userRole: "admin" });
    expect(Object.keys(s)).toEqual(["factoryIds", "labels"]);
    expect(Object.keys(s.labels)).not.toContain("filter");
    expect(() => JSON.stringify(s)).not.toThrow();
  });
});
