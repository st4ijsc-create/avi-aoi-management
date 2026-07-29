/**
 * Vòng sửa cuối Wave 3 (review toàn nhánh, mục 2) — "hết hạn dự báo" (thẻ predictive
 * mờ đi + chìm đáy sau 5 ngày, `FORECAST_EXPIRE_MS`) trước sửa này đo tuổi DÒNG
 * (raisedAt = createdAt). Từ Task 3, routeAlert() UPDATE tại chỗ một cảnh báo đang
 * mở thay vì insert dòng mới mỗi lần tái diễn — nên một máy tái diễn LIÊN TỤC 6
 * ngày vẫn giữ nguyên createdAt của lần đầu:
 *
 *   cũ: `expired = source==="predictive" && (now - raisedAt) > FORECAST_EXPIRE_MS`
 *
 * công thức đó dán nhãn "HẾT HẠN DỰ BÁO" lên đúng cảnh báo đang sống động nhất
 * (Task 7 vừa hiện "đã tái diễn 23 lần" cạnh nó cùng lúc). isForecastExpired() thay
 * mốc đo bằng lastOccurredAt (đã tới client từ Task 7), lùi về raisedAt khi vắng mặt
 * (nguồn khác, hoặc dòng chưa từng tái diễn) — không làm vỡ dòng cũ.
 */
import { describe, it, expect } from "vitest";
import { isForecastExpired, FORECAST_EXPIRE_MS } from "./model";

const NOW = Date.parse("2026-07-29T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;

describe("isForecastExpired", () => {
  it("máy tái diễn LIÊN TỤC 6 ngày (createdAt cũ, lastOccurredAt vừa nãy) ⇒ KHÔNG hết hạn — đây chính là bug bị review bắt", () => {
    const a = {
      source: "predictive" as const,
      raisedAt: new Date(NOW - 6 * DAY), // createdAt của lần tái diễn ĐẦU TIÊN
      lastOccurredAt: new Date(NOW - 1 * 60_000), // vừa tái diễn 1 phút trước
    };
    expect(isForecastExpired(a, NOW)).toBe(false);
  });

  it("đã THÔI tái diễn 6 ngày (lastOccurredAt cũ) ⇒ hết hạn dự báo", () => {
    const a = {
      source: "predictive" as const,
      raisedAt: new Date(NOW - 20 * DAY),
      lastOccurredAt: new Date(NOW - 6 * DAY),
    };
    expect(isForecastExpired(a, NOW)).toBe(true);
  });

  it("lastOccurredAt VẮNG MẶT ⇒ lùi về raisedAt như hành vi cũ (không vỡ dòng cũ trước Task 7)", () => {
    const stillFresh = { source: "predictive" as const, raisedAt: new Date(NOW - 1 * DAY), lastOccurredAt: null };
    const stale = { source: "predictive" as const, raisedAt: new Date(NOW - 6 * DAY), lastOccurredAt: undefined };
    expect(isForecastExpired(stillFresh, NOW)).toBe(false);
    expect(isForecastExpired(stale, NOW)).toBe(true);
  });

  it("đúng biên FORECAST_EXPIRE_MS (5 ngày) tính theo lastOccurredAt", () => {
    const justUnder = { source: "predictive" as const, raisedAt: new Date(0), lastOccurredAt: new Date(NOW - FORECAST_EXPIRE_MS + 1000) };
    const justOver = { source: "predictive" as const, raisedAt: new Date(0), lastOccurredAt: new Date(NOW - FORECAST_EXPIRE_MS - 1000) };
    expect(isForecastExpired(justUnder, NOW)).toBe(false);
    expect(isForecastExpired(justOver, NOW)).toBe(true);
  });

  it("nguồn KHÔNG PHẢI predictive ⇒ không bao giờ hết hạn dự báo, dù raisedAt/lastOccurredAt rất cũ", () => {
    const a = { source: "andon" as const, raisedAt: new Date(NOW - 30 * DAY), lastOccurredAt: new Date(NOW - 30 * DAY) };
    expect(isForecastExpired(a, NOW)).toBe(false);
  });
});
