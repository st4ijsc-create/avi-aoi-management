/**
 * doc 81 Đợt 1B Task 5 fix round 2 — quét hàng robot_jobs 'running' mồ côi chạy lúc khởi động VÀ một
 * lần nữa khi ngưỡng tuổi đã trôi qua (crash + khởi động lại trong vòng ngưỡng ⇒ lần quét đầu còn
 * thấy hàng "trẻ"). Đồng hồ giả (vi.useFakeTimers) — không chờ 80 s thật. Hàm quét thật đã có test
 * trên CSDL _test (robotJobsReconcile.db.test.ts); ở đây chỉ đo LỊCH gọi.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sweep = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./robotCommandDispatcher", () => ({
  reconcileOrphanedRobotJobs: vi.fn(async () => {
    sweep.calls++;
    return 0;
  }),
  orphanedRunningThresholdMs: () => 80_000,
}));

import { startRobots } from "./robotManager";

const saved = process.env.ROBOT_GATEWAY_ENABLED;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.ROBOT_GATEWAY_ENABLED; // gateway tắt: quét vẫn phải chạy
});
afterEach(() => {
  vi.useRealTimers();
  if (saved === undefined) delete process.env.ROBOT_GATEWAY_ENABLED;
  else process.env.ROBOT_GATEWAY_ENABLED = saved;
});

describe("startRobots — lịch quét 'running' mồ côi", () => {
  it("quét ngay lúc khởi động, rồi ĐÚNG một lần nữa khi hết ngưỡng (timer unref, chỉ lên lịch một lần)", async () => {
    expect(await startRobots()).toBe(false);
    expect(sweep.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(79_999);
    expect(sweep.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep.calls).toBe(2);
    // gọi startRobots lần nữa (gateway tắt nên running=false): quét ngay, nhưng KHÔNG lên lịch thêm
    expect(await startRobots()).toBe(false);
    expect(sweep.calls).toBe(3);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(sweep.calls).toBe(3);
  });
});
