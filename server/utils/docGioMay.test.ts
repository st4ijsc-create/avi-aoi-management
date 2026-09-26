/**
 * Tests for `docGioMay` (server/utils/factoryTime.ts) — BG-99 (Khối C, ruling
 * controller 2026-09-03, Task 5). Đọc một chuỗi thời gian MÁY AOI/AVI khai
 * (`completedAt`/`startedAt`/`inspectionTime`) là giờ tường **UTC**, KHÔNG phải
 * factory TZ (khác `docGioTuongNhaMay`, xem `docGioTuongNhaMay.test.ts`) và
 * KHÔNG phải TZ hệ điều hành server (bẫy BG-96).
 *
 * Di trú nguyên văn từ `server/services/gioiHanLucDoCayV2.test.ts` (describe
 * "BG-97 — mocDoTuChuoi") — hàm nguồn `mocDoTuChuoi` đã XOÁ ở Task 5 (hết caller
 * sản xuất), luật giữ nguyên, chỉ đổi tên + chỗ ở.
 */
import { describe, it, expect } from "vitest";
import { docGioMay } from "./factoryTime";

describe("docGioMay", () => {
  it("chuỗi TRẦN được hiểu là giờ tường UTC — KHÔNG theo múi giờ hệ điều hành server", () => {
    // Đây là dòng phân biệt bản vá đúng với bản vá "lệch một offset, im lặng". drizzle
    // đọc cột `timestamp` không múi giờ bằng cách nối `+0000`; hàm này áp CÙNG luật.
    expect(docGioMay("2026-09-03T11:00:00.000")?.toISOString()).toBe("2026-09-03T11:00:00.000Z");
    expect(docGioMay("2026-09-03T11:00:00")?.toISOString()).toBe("2026-09-03T11:00:00.000Z");
  });

  it("chuỗi CÓ múi giờ được tôn trọng nguyên văn (khác dịch 'fake UTC' vốn dịch vô điều kiện)", () => {
    expect(docGioMay("2026-09-03T11:00:00.000Z")?.toISOString()).toBe("2026-09-03T11:00:00.000Z");
    expect(docGioMay("2026-09-03T18:00:00.000+07:00")?.toISOString()).toBe("2026-09-03T11:00:00.000Z");
    expect(docGioMay("2026-09-03T06:00:00.000-0500")?.toISOString()).toBe("2026-09-03T11:00:00.000Z");
  });

  it("thiếu / rác ⇒ null — người gọi tự quyết định lối thoát, KHÔNG bịa `new Date()` ở đây", () => {
    expect(docGioMay(undefined)).toBeNull();
    expect(docGioMay(null)).toBeNull();
    expect(docGioMay("   ")).toBeNull();
    expect(docGioMay("khong-phai-ngay")).toBeNull();
  });

  it("KHÔNG phụ thuộc múi giờ hệ điều hành: kết quả bằng nhau dù đổi process.env.TZ", () => {
    // ⚠ `process.env.TZ` chỉ có tác dụng với `Date` tạo SAU khi gán (Node đọc lại tz).
    const truoc = process.env.TZ;
    try {
      process.env.TZ = "Asia/Ho_Chi_Minh";
      const a = docGioMay("2026-09-03T11:00:00.000")!.getTime();
      process.env.TZ = "UTC";
      const b = docGioMay("2026-09-03T11:00:00.000")!.getTime();
      process.env.TZ = "America/New_York";
      const c = docGioMay("2026-09-03T11:00:00.000")!.getTime();
      expect(b, "đổi TZ của máy chủ KHÔNG được đổi mốc — đổi mốc là đổi verdict, im lặng").toBe(a);
      expect(c, "đổi TZ của máy chủ KHÔNG được đổi mốc — đổi mốc là đổi verdict, im lặng").toBe(a);
    } finally {
      if (truoc === undefined) delete process.env.TZ;
      else process.env.TZ = truoc;
    }
  });
});
