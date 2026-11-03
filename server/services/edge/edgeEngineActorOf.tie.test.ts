import { describe, it, expect } from "vitest";
import { EDGE_RESUMED_BY_CTX_KEY, edgeEngineActorOf } from "./edgeAuthorizeCentral";

// kiem-dinh 2026-11-02 — foeRunStoreParity.dot10 "Continue records edgeResumedBy…" đỏ ngẫu nhiên: {12,'gate'} thay vì {14,'held'}.
// Gốc: `at > newestApproval.at` (mili giây) — hai mốc TRÙNG ms thì rơi về người DUYỆT dù người tiếp tục ghi sau.
// Ở mốc trùng không thể biết ai sau ai ⇒ phải FAIL-CLOSED ({unknown:true}), không đoán.
const ctx = (at: number) => ({ [EDGE_RESUMED_BY_CTX_KEY]: { userId: 14, at } });
const approval = (at: number) => ({ approvedBy: 12, at });

describe("edgeEngineActorOf — thứ tự người duyệt / người tiếp tục theo mili giây", () => {
  it("tiếp tục SAU duyệt (at lớn hơn) ⇒ người tiếp tục", () => {
    expect(edgeEngineActorOf(ctx(1001), approval(1000))).toEqual({ userId: 14, path: "held" });
  });
  it("tiếp tục TRƯỚC duyệt (at nhỏ hơn) ⇒ người duyệt", () => {
    expect(edgeEngineActorOf(ctx(999), approval(1000))).toEqual({ userId: 12, path: "gate" });
  });
  it("★ TRÙNG ms ⇒ không đoán: unknown (fail-closed), không gán cho người duyệt", () => {
    expect(edgeEngineActorOf(ctx(1000), approval(1000))).toEqual({ unknown: true });
  });
});
