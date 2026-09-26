/**
 * ★★★ NGƯỜI GHI SỔ KIỂM TOÁN phải chịu được đúng lúc mọi thứ đang hỏng.
 * ════════════════════════════════════════════════════════════════════════════
 * SỰ CỐ ĐÃ ĐO (2026-08-18): 8/8 lượt xuất HỎNG in
 *   `[Export] audit log failed: Cannot read properties of undefined (reading 'id')`
 * và KHÔNG hàng audit nào được ghi; 16/16 lượt xuất XONG thì im lặng. Một lượt xuất mất
 * 22.599 hàng **không để lại dấu vết nào**.
 *
 * `Number(result.id)` với `result` là phần tử đầu của `RETURNING` là **biểu thức DUY NHẤT**
 * trong toàn chuỗi ghi audit có thể đúc ra câu lỗi ấy. Lưới dưới đây ghim ba tính chất mà
 * một sổ-kiểm-toán-của-đường-lỗi bắt buộc phải có, và mỗi ca đều ĐỎ nếu tính chất bị gỡ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  /** Hàng mà `.returning()` sẽ trả về (kịch bản). */
  returning: [{ id: 1 }] as Array<{ id: number }>,
  /** Giá trị đã được đưa xuống `INSERT` ở lượt gần nhất. */
  lastValues: null as Record<string, unknown> | null,
  /** Lỗi mà `INSERT` sẽ ném, nếu có. */
  insertError: null as Error | null,
}));

vi.mock("./connection", () => ({
  getDb: vi.fn(async () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.lastValues = v;
        return {
          returning: async () => {
            if (h.insertError) throw h.insertError;
            return h.returning;
          },
        };
      },
    }),
  })),
}));

import { createAuditLog } from "./system";

beforeEach(() => {
  h.returning = [{ id: 1 }];
  h.lastValues = null;
  h.insertError = null;
});

describe("createAuditLog — đường LỖI là đường chính", () => {
  it("chiều dương: ghi bình thường và trả id thật (chống hồi quy)", async () => {
    h.returning = [{ id: 4242 }];
    const out = await createAuditLog({
      userId: 51,
      userName: "engineer1",
      action: "export",
      status: "success",
      ipAddress: "127.0.0.1",
    });
    expect(out).toEqual({ id: 4242 });
    expect(h.lastValues).toMatchObject({ userId: 51, userName: "engineer1", status: "success" });
  });

  it("★ `RETURNING` trả 0 hàng ⇒ KHÔNG được ném `reading 'id'` (đây chính là sự cố)", async () => {
    h.returning = [];
    // Trước bản vá dòng này ném `Cannot read properties of undefined (reading 'id')`,
    // và vì nó nằm sau `INSERT` nên nó tố cáo "mất dấu vết" cho một hàng VẪN ĐANG TỒN TẠI.
    await expect(createAuditLog({ action: "export", status: "failure" })).resolves.toEqual({ id: 0 });
  });

  it("★ khoá API KHÔNG PHẢI người dùng: thiếu `userId` vẫn ghi được hàng", async () => {
    h.returning = [{ id: 7 }];
    const out = await createAuditLog({
      // không có userId — khoá API không mang danh tính người dùng
      userName: "LIVE_GLOBAL",
      action: "export",
      entityName: "/api/export/measurements.csv",
      ipAddress: "127.0.0.1",
      status: "failure",
    });
    expect(out).toEqual({ id: 7 });
    expect(h.lastValues).toMatchObject({ userId: null, userName: "LIVE_GLOBAL", status: "failure" });
  });

  it("★ thiếu MỌI thứ trừ `action` vẫn ghi được hàng — thiếu trường ≠ mất bản ghi", async () => {
    h.returning = [{ id: 9 }];
    await expect(createAuditLog({ action: "export" })).resolves.toEqual({ id: 9 });
    expect(h.lastValues).toMatchObject({
      userId: null,
      userName: null,
      entityName: null,
      details: null,
      ipAddress: null,
      userAgent: null,
      status: "success",
    });
  });

  it("★ giá trị vượt trần `varchar` bị CẮT, không làm mất cả hàng (22001)", async () => {
    h.returning = [{ id: 11 }];
    const hugeUa = "U".repeat(4000); // userAgent là varchar(500)
    const hugeIp = "1".repeat(300); // ipAddress là varchar(45)
    await createAuditLog({ action: "export", userAgent: hugeUa, ipAddress: hugeIp, status: "failure" });
    expect((h.lastValues?.userAgent as string).length).toBe(500);
    expect((h.lastValues?.ipAddress as string).length).toBe(45);
  });

  it("★ `details` có vòng lặp ⇒ giữ hàng, chỉ mất ô `details`", async () => {
    h.returning = [{ id: 13 }];
    const circular: Record<string, unknown> = { endpoint: "/api/export/measurements.csv" };
    circular.self = circular;
    await expect(createAuditLog({ action: "export", details: circular, status: "failure" })).resolves.toEqual({
      id: 13,
    });
    expect(String(h.lastValues?.details)).toContain("_detailsUnserializable");
  });

  it("lỗi THẬT của CSDL vẫn được ném ra ngoài — không nuốt", async () => {
    h.insertError = new Error("permission denied for table audit_logs");
    await expect(createAuditLog({ action: "export" })).rejects.toThrow(/permission denied/);
  });
});
