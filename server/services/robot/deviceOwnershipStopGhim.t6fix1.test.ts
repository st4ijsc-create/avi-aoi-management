/**
 * SCADA R1b-2b-2a T6 fix 1 (review m1) — STOP ghim khi chuyển chủ sở hữu (`sendAdapterStop` ⇒ `ketQuaStopGhim`): khi kết cục KHÔNG RÕ (≥ 1 write
 * `timeout` — lệnh quá hạn, hoặc nhãn theo TỪNG write từ T2 / T6: driver tự hết hạn, liên kết mất giữa lô) câu chi tiết nói "timed out — outcome
 * unknown", KHÔNG BAO GIỜ "failed" (lời ghi đã giao có thể đã áp). `sent` / `ok` không đổi.
 */
import { describe, it, expect } from "vitest";
import { ketQuaStopGhim } from "./deviceOwnershipService";

const PINS = [{ tagKey: "stop_a" }, { tagKey: "stop_b" }];

describe("T6 fix 1 — ketQuaStopGhim (STOP ghim của chuyển chủ sở hữu)", () => {
  it("★ lô ['acked','timeout'] (timedOut=false — nhãn theo từng write) ⇒ 'timed out — outcome unknown', sent failed, ok false", () => {
    expect(
      ketQuaStopGhim(
        {
          timedOut: false,
          outcomes: [
            { ok: true, status: "acked" },
            { ok: false, status: "timeout" },
          ],
        },
        PINS,
      ),
    ).toEqual({ ok: false, sent: "failed", detail: "pinned stop write timed out — outcome unknown" });
  });

  it("lệnh quá hạn (timedOut=true) ⇒ cùng câu 'timed out — outcome unknown'", () => {
    expect(ketQuaStopGhim({ timedOut: true, outcomes: [{ ok: false, status: "timeout" }] }, PINS).detail).toBe("pinned stop write timed out — outcome unknown");
  });

  it("chỉ 'failed' (thiết bị từ chối / không gửi) ⇒ 'pinned stop write failed'", () => {
    expect(
      ketQuaStopGhim(
        {
          timedOut: false,
          outcomes: [
            { ok: true, status: "acked" },
            { ok: false, status: "failed" },
          ],
        },
        PINS,
      ),
    ).toEqual({ ok: false, sent: "failed", detail: "pinned stop write failed" });
  });

  it("mọi write ok ⇒ sent, liệt kê tag", () => {
    expect(
      ketQuaStopGhim(
        {
          timedOut: false,
          outcomes: [
            { ok: true, status: "acked_verified" },
            { ok: true, status: "acked_unverified" },
          ],
        },
        PINS,
      ),
    ).toEqual({ ok: true, sent: "sent", detail: "pinned stop written (stop_a, stop_b)" });
  });

  it("kiem-dinh e3: lô RỖNG (không write nào chạy) KHÔNG được coi là đã ghi STOP ⇒ ok false, sent failed", () => {
    expect(ketQuaStopGhim({ timedOut: false, outcomes: [] }, PINS)).toEqual({ ok: false, sent: "failed", detail: "pinned stop write failed" });
    expect(ketQuaStopGhim({ timedOut: true, outcomes: [] }, PINS)).toEqual({ ok: false, sent: "failed", detail: "pinned stop write timed out — outcome unknown" });
  });
});
