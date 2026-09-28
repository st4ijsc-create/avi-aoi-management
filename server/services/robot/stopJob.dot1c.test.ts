/**
 * doc 81 Đợt 1C residual round 2 (R-1C-m, lớp b) — MỘT bộ phân loại "job này là DỪNG?" dùng chung
 * (stopJob.ts): dispatcher, mọi driver, MotionLock và AbortFence.
 *
 * Trước: dispatcher nhận abort/stop/e_stop (mọi hoa thường) nhưng MotionLock/AbortFence chỉ nhận đúng chuỗi "abort"
 * ⇒ một "stop"/"e_stop"/"ABORT" gọi thẳng driver bị KHOÁ CHUYỂN ĐỘNG từ chối như một chuyển động (STOP bị chặn), và
 * bị hàng rào abort chặn. Oracle: danh sách chính tả viết tay trong test, không lấy từ STOP_JOB_TYPES.
 */
import { describe, it, expect } from "vitest";
import { isStopJob, isStopJobType, driverJob } from "./stopJob";
import { MotionLock, AbortFence } from "./robotDriver";
import { isMotionJob } from "./robotCommandDispatcher";

const STOPS = ["abort", "stop", "e_stop", "ABORT", "Stop", " E_STOP "];
const MOTIONS = ["move", "home", "custom", "pick_place", "estop", "stopPause", "", "abort2"];

describe("stopJob — bộ phân loại dùng chung", () => {
  it.each(STOPS)("'%s' là DỪNG ở MỌI nơi (classifier, dispatcher)", (t) => {
    expect(isStopJobType(t)).toBe(true);
    expect(isStopJob({ jobType: t as never })).toBe(true);
    expect(isMotionJob({ jobType: t as never })).toBe(false);
  });
  it.each(MOTIONS)("'%s' KHÔNG phải dừng (fail-closed: chuyển động)", (t) => {
    expect(isStopJobType(t)).toBe(false);
    expect(isMotionJob({ jobType: t as never })).toBe(true);
  });
  it("driverJob: dừng (mọi chính tả, mọi params) ⇒ { abort, {} }; chuyển động giữ nguyên", () => {
    expect(driverJob({ jobType: "e_stop" as never, params: { joints: [9, 9, 9, 9, 9, 9] } })).toEqual({ jobType: "abort", params: {} });
    const m = { jobType: "move" as const, params: { x: 1 } };
    expect(driverJob(m)).toBe(m);
  });
});

describe("MotionLock / AbortFence — dừng mọi chính tả là KHÔNG chuyển động", () => {
  it.each(STOPS)("khoá đang BẬT: '%s' không bị refusal() từ chối, guard() không ném", (t) => {
    const lock = new MotionLock();
    lock.lock("motion_locked_after_link_loss", "test");
    const job = { jobType: t as never, params: { joints: [1, 2, 3, 4, 5, 6] } };
    expect(lock.refusal(job)).toBeNull();
    expect(() => lock.guard(job, () => undefined)()).not.toThrow();
  });
  it("khoá đang BẬT: chuyển động vẫn bị từ chối (không nới)", () => {
    const lock = new MotionLock();
    lock.lock("motion_locked_after_link_loss", "test");
    expect(lock.refusal({ jobType: "move", params: {} })).not.toBeNull();
  });
  it.each(STOPS)("AbortFence: '%s' không bị hàng rào abort chặn (chỉ chuyển động bị chặn)", (t) => {
    const fence = new AbortFence();
    const stopCheck = fence.capture({ jobType: t as never });
    const motionCheck = fence.capture({ jobType: "move" });
    fence.bump();
    expect(() => stopCheck()).not.toThrow();
    expect(() => motionCheck()).toThrow();
  });
});
