import { describe, it, expect } from "vitest";
import { decideNotify } from "./decideNotify";

const HOUR = 3600_000;
const base = {
  action: "update" as const,
  incomingSeverity: "HIGH" as const,
  previousSeverity: "HIGH" as const,
  lastNotifiedAt: 1_000_000,
  now: 1_000_000 + 5 * 60_000, // mới báo 5 phút trước
  cooldownMs: 4 * HOUR,
  criticalCooldownMs: 0,
};

describe("decideNotify — có gửi thông báo không", () => {
  it("cảnh báo MỚI (insert) ⇒ luôn báo", () => {
    expect(decideNotify({ ...base, action: "insert", previousSeverity: null, lastNotifiedAt: null }))
      .toEqual({ notify: true, reason: "first" });
  });

  it("CRITICAL với cooldown-critical = 0 ⇒ luôn báo, kể cả vừa báo 5 phút trước", () => {
    expect(decideNotify({ ...base, incomingSeverity: "CRITICAL", previousSeverity: "CRITICAL" }))
      .toEqual({ notify: true, reason: "critical" });
  });

  it("CRITICAL nhưng khách đặt cooldown-critical 60 phút, mới báo 5 phút ⇒ IM LẶNG", () => {
    expect(decideNotify({
      ...base, incomingSeverity: "CRITICAL", previousSeverity: "CRITICAL",
      criticalCooldownMs: 60 * 60_000,
    })).toEqual({ notify: false, reason: "suppressed-cooldown" });
  });

  it("mức TĂNG (MEDIUM → HIGH) ⇒ báo ngay, không chờ cooldown", () => {
    expect(decideNotify({ ...base, previousSeverity: "MEDIUM" }))
      .toEqual({ notify: true, reason: "severity-raised" });
  });

  // ⚠ BẪY CHÍNH — maxSeverity() KHÔNG dùng được cho luật này.
  it("mức KHÔNG đổi (HIGH → HIGH) KHÔNG phải 'mức tăng' ⇒ im lặng", () => {
    expect(decideNotify(base)).toEqual({ notify: false, reason: "suppressed-cooldown" });
  });

  it("mức TỤT (HIGH → MEDIUM) không phải 'mức tăng' ⇒ im lặng", () => {
    expect(decideNotify({ ...base, incomingSeverity: "MEDIUM", previousSeverity: "HIGH" }))
      .toEqual({ notify: false, reason: "suppressed-cooldown" });
  });

  it("chưa từng báo (lastNotifiedAt null) ⇒ báo, fail-open", () => {
    expect(decideNotify({ ...base, lastNotifiedAt: null }))
      .toEqual({ notify: true, reason: "never-notified" });
  });

  it("hết cooldown ⇒ báo lại", () => {
    expect(decideNotify({ ...base, now: base.lastNotifiedAt + 5 * HOUR }))
      .toEqual({ notify: true, reason: "cooldown-elapsed" });
  });

  it("đúng BIÊN cooldown (>= chứ không phải >) ⇒ báo lại", () => {
    expect(decideNotify({ ...base, now: base.lastNotifiedAt + 4 * HOUR }))
      .toEqual({ notify: true, reason: "cooldown-elapsed" });
  });

  it("previousSeverity null trên nhánh update (dữ liệu lỗi) ⇒ không sập, rơi về luật cooldown", () => {
    expect(decideNotify({ ...base, previousSeverity: null }))
      .toEqual({ notify: false, reason: "suppressed-cooldown" });
  });
});
