/**
 * `kiemRoRiDb.ts` — phần THUẦN: chỉ chạy trên CSDL `aoi_management_test` (chốt an toàn) và câu báo lỗi. KHÔNG chạm CSDL.
 * ĐỘT BIẾN PHẢI BẮT: bỏ chốt tên CSDL (đếm trên CSDL khác) · câu báo lỗi không nêu số hàng / userId / nơi đi qua kênh.
 */
import { describe, expect, it } from "vitest";
import { cauBaoRoRi, demHangRoRi } from "./kiemRoRiDb";

describe("demHangRoRi — chốt CSDL", () => {
  it("★★★ từ chối mọi URL KHÔNG phải aoi_management_test (và URL vắng) TRƯỚC khi mở kết nối", async () => {
    for (const url of [undefined, "", "postgresql://u:p@127.0.0.1:5434/aoi_management", "postgresql://u:p@127.0.0.1:5434/aoi_dev", "postgresql://u:p@127.0.0.1:1/none"]) {
      await expect(demHangRoRi(1, url), String(url)).rejects.toThrow(/chỉ chạy trên CSDL aoi_management_test/);
    }
  });
});

describe("cauBaoRoRi", () => {
  it("★★★ nêu số hàng từng bảng, userId, và bản tóm tắt nơi đi qua kênh (hoặc nói không có lời gọi nào)", () => {
    const c = cauBaoRoRi({ audit_logs: 2, ai_pending_actions: 1, tong: 3 }, 235087, "server/services/x.ts:10:5 ×4");
    expect(c).toContain("2 hàng audit_logs");
    expect(c).toContain("1 hàng ai_pending_actions");
    expect(c).toContain("userId=235087");
    expect(c).toContain("server/services/x.ts:10:5 ×4");
    expect(cauBaoRoRi({ audit_logs: 1, ai_pending_actions: 0, tong: 1 }, 7, "")).toContain("(không lời gọi nào)");
  });
});
