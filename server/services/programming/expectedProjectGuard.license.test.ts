/**
 * doc 81 Đợt 2 Task 12b fix round 1 (review Important #1) — cổng dự án kỳ vọng chạy trước step-up OTP
 * phải đứng SAU giấy phép MOD_ENGINEERING: người gọi KHÔNG có giấy phép không được khiến server đọc
 * build (dò tồn tại / dự án) trước cả OTP.
 *
 * Trong môi trường test cổng giấy phép TẮT (LICENSE_MODULE_GATE_ENABLED đọc một lần lúc nạp `env.ts`),
 * nên lưới DB không đo được nhánh này. Ở đây `moduleGate` được thay bằng một cổng LUÔN TỪ CHỐI (lỗi
 * mốc riêng) và lượt đọc build của cổng (`assertDeployTargetInScopeAndProject`) là một spy:
 * kết cục đúng = lỗi giấy phép, spy KHÔNG được gọi. Bỏ phép kiểm giấy phép trong cổng ⇒ spy bị gọi (đỏ).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  delete process.env.ACTUATION_STEPUP_2FA; // step-up tắt: không chạm sổ OTP/DB ở lưới này
});

const h = vi.hoisted(() => ({ docBuild: vi.fn(async () => {}) }));
const LOI_GIAY_PHEP = "T12B-LICENSE-SENTINEL";

vi.mock("../../_core/moduleGate", async (orig) => {
  const that = await orig<typeof import("../../_core/moduleGate")>();
  const { TRPCError } = await import("@trpc/server");
  return {
    ...that,
    moduleGate: () => async () => {
      throw new TRPCError({ code: "FORBIDDEN", message: LOI_GIAY_PHEP });
    },
  };
});
vi.mock("./deployPreview", async (orig) => {
  const that = await orig<typeof import("./deployPreview")>();
  return { ...that, assertDeployTargetInScopeAndProject: h.docBuild };
});

import { programmingRouter } from "../../routers/programmingRouter";

const caller = () =>
  programmingRouter.createCaller({
    user: { id: 1, role: "admin", twoFactorEnabled: true, username: "t12b", name: "t12b" },
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
    sessionToken: "t12b-license",
  } as never);

const base = { stage: "staging" as const, actionId: "a", confirmedBy: 1, totpCode: "123456", expectedProjectId: 7 };

beforeEach(() => h.docBuild.mockClear());

describe("Task 12b fix round 1 — cổng trước OTP đứng SAU giấy phép", () => {
  it.each([
    ["deployBuild", () => caller().deployBuild({ ...base, buildId: 5, idempotencyKey: "k" })],
    [
      "deployToFleet",
      () =>
        caller().deployToFleet({
          ...base,
          buildId: 5,
          deviceIds: [3],
          strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: true },
          idempotencyKeyPrefix: "p",
        }),
    ],
  ] as const)("%s — không giấy phép ⇒ lỗi giấy phép, KHÔNG đọc build", async (_n, goi) => {
    await expect(goi()).rejects.toThrow(LOI_GIAY_PHEP);
    expect(h.docBuild).not.toHaveBeenCalled();
  });
});
