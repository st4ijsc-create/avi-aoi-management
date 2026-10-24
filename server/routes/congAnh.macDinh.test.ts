/**
 * ★★★ 2026-10-24 — MẶC ĐỊNH CỦA CỔNG ẢNH LÀ CƯỠNG CHẾ (chủ dự án quyết): vắng cờ `ANH_CONG_MO` ⇒ `congAnhMo() === false`.
 * "Mở" phải được viết ra đúng chữ (`true`/`1`); mọi giá trị khác (rỗng, `yes`, sai chính tả) ⇒ cưỡng chế (fail-closed).
 * Đột biến đã chạy: đổi mặc định về "true" ⇒ ĐỎ; nới `=== "true"` về `!== "false"` ⇒ ĐỎ (ca "yes"/rỗng).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { congAnhMo } from "./_congAnh";

afterEach(() => vi.unstubAllEnvs());

describe("congAnhMo — mặc định cưỡng chế", () => {
  it("★★★ vắng cờ ⇒ CƯỠNG CHẾ (congAnhMo() = false)", () => {
    delete process.env.ANH_CONG_MO;
    expect(congAnhMo()).toBe(false);
  });
  it("chỉ 'true' / '1' (mọi hoa-thường, có khoảng trắng) mới MỞ", () => {
    for (const v of ["true", "TRUE", " True ", "1"]) {
      vi.stubEnv("ANH_CONG_MO", v);
      expect(congAnhMo(), v).toBe(true);
    }
  });
  it("'false' / '0' / rỗng / giá trị lạ ⇒ CƯỠNG CHẾ", () => {
    for (const v of ["false", "0", "", "yes", "on", "tru", "mo"]) {
      vi.stubEnv("ANH_CONG_MO", v);
      expect(congAnhMo(), JSON.stringify(v)).toBe(false);
    }
  });
});
