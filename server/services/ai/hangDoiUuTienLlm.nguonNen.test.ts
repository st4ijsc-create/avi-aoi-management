/**
 * Đợt 0.3 — các ĐIỂM VÀO nền thật sự mang mức `nen` xuống tới chỗ gọi model.
 *
 * Đo bằng cách thay đúng phụ thuộc mà điểm vào gọi (tầng dưới cùng trước model) và đọc
 * `mucUuTienHienTai()` NGAY TẠI ĐÓ — tức qua `await import()` động, qua ranh giới module, đúng
 * như đường thật. Một điểm vào quên bọc sẽ đọc ra `tuong-tac` (mặc định).
 */
import { describe, expect, it, vi } from "vitest";
import { mucUuTienHienTai } from "./hangDoiUuTienLlm";

const thay: Record<string, string> = {};

vi.mock("../aiExecutiveReport", () => ({
  runExecutiveReportNow: vi.fn(async () => {
    await Promise.resolve();
    thay.baoCao = mucUuTienHienTai();
    return { summary: { generatedBy: "test", kpis: { dataWarnings: [] } }, insightId: 1 };
  }),
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => {
    thay.loRca = mucUuTienHienTai();
    return null; // dừng sớm sau khi đã đo
  }),
}));

describe("điểm vào nền ⇒ mức `nen`", () => {
  it("cron báo cáo điều hành (reportScheduler.runExecutiveReport)", async () => {
    const { runExecutiveReport } = await import("../reportScheduler");
    await runExecutiveReport("day");
    expect(thay.baoCao).toBe("nen");
  });

  it("RCA hàng loạt (aiBatchRcaScheduler.runBatchRCAOnce)", async () => {
    const { runBatchRCAOnce } = await import("../aiBatchRcaScheduler");
    await runBatchRCAOnce();
    expect(thay.loRca).toBe("nen");
  });

  it("ngoài các điểm vào ấy, mức vẫn là `tuong-tac`", () => {
    expect(mucUuTienHienTai()).toBe("tuong-tac");
  });
});
