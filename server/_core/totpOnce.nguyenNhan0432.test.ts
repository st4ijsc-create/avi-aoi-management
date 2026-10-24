/**
 * kiem-dinh P1-6 (2026-10-24) — DB thiếu migration 0432 ⇒ `verifyTotpOnce` trả `TOTP_KHONG_KIEM_DUOC` (fail-closed, như trước) VÀ log máy
 * chủ nói rõ nguyên nhân "thiếu migration 0432". Bộ đếm (`napLuotThu`) giả ném đúng lỗi postgres 42P01 (bảng không tồn tại).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./totpKhoaSai", async (orig) => {
  const real = await orig<typeof import("./totpKhoaSai")>();
  return {
    ...real,
    napLuotThu: async () => {
      throw new real.LoiBoDemTotp("Tính lượt thử hỏng: relation \"totp_khoa_sai\" does not exist", {
        cause: Object.assign(new Error('relation "totp_khoa_sai" does not exist'), { code: "42P01" }),
      });
    },
  };
});

import { verifyTotpOnce } from "./totpOnce";

afterEach(() => vi.restoreAllMocks());

describe("verifyTotpOnce — bộ đếm hỏng vì thiếu 0432", () => {
  it("⇒ TOTP_KHONG_KIEM_DUOC + console.error mang 'thiếu migration 0432'", async () => {
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await verifyTotpOnce({ userId: 1, secret: "JBSWY3DPEHPK3PXP", token: "123456" });
    expect(r).toEqual({ hopLe: false, phatLai: false, ma: "TOTP_KHONG_KIEM_DUOC" });
    const log = loi.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(log).toContain("thiếu migration 0432");
  });
});
