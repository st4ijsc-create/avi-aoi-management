// Wave 2 đường A — Task 3: đề xuất ngưỡng hàng loạt (partitionBatch + toBatchItem).
//
// GOTCHA (task-3-brief.md ghi rõ): vitest.config.ts:27 chỉ glob `client/src/**/*.unit.test.ts`
// cho client-side logic — brief gốc đặt tên `batchSuggest.logic.test.ts` (KHÔNG có `.unit`)
// sẽ không bao giờ được chạy (đỏ giả vĩnh viễn). Đặt đúng hậu tố ở đây, theo đúng tiền lệ
// `pendingSuggestion.logic.unit.test.ts` (Task 2) trong cùng thư mục.
import { describe, it, expect } from "vitest";
import { partitionBatch, toBatchItem } from "./batchSuggestLogic";

describe("partitionBatch", () => {
  it("tách điểm đủ dữ liệu và điểm thiếu mẫu", () => {
    const r = partitionBatch([
      { pointDefId: 1, ok: true, sampleCount: 500, proposedLsl: 1, proposedUsl: 2 },
      { pointDefId: 2, ok: false, sampleCount: 12, reason: "insufficient-samples" },
      { pointDefId: 3, ok: true, sampleCount: 800, proposedLsl: 3, proposedUsl: 4 },
    ]);
    expect(r.ready.map(x => x.pointDefId)).toEqual([1, 3]);
    expect(r.insufficient.map(x => x.pointDefId)).toEqual([2]);
  });

  it("KHÔNG bịa số cho điểm thiếu mẫu — giữ nguyên lý do", () => {
    const r = partitionBatch([{ pointDefId: 9, ok: false, sampleCount: 3, reason: "insufficient-samples" }]);
    expect(r.ready).toEqual([]);
    expect(r.insufficient[0]).toMatchObject({ pointDefId: 9, reason: "insufficient-samples" });
    expect(r.insufficient[0]).not.toHaveProperty("proposedLsl");
  });

  it("danh sách rỗng ⇒ hai nhóm rỗng, không ném", () => {
    expect(partitionBatch([])).toEqual({ ready: [], insufficient: [] });
  });
});

// toBatchItem không nằm trong danh sách bắt buộc của brief (chỉ partitionBatch được yêu
// cầu), nhưng đây chính là nơi quyết định "đủ dữ liệu hay không" từ response thật của
// trpc.aiThresholdAdvisor.recommendForPoint — bỏ qua nó thì lời hứa "trung thực" ở
// partitionBatch vô nghĩa (partitionBatch chỉ trung thực NẾU đầu vào của nó trung thực).
// Thêm test ở đây là lệch khỏi "PASS 3/3" mà brief nêu — ghi rõ trong task-3-report.md.
describe("toBatchItem", () => {
  it("đủ mẫu, không degraded/needsReview ⇒ ready với giá trị đề xuất thật", () => {
    const item = toBatchItem(10, {
      ok: true, degraded: false, needsReview: false, sampleSize: 500,
      recommended: { lsl: 1.1, usl: 2.2, target: 1.65 },
    });
    expect(item).toEqual({
      pointDefId: 10, ok: true, sampleCount: 500,
      proposedLsl: 1.1, proposedUsl: 2.2, proposedNominal: 1.65,
    });
  });

  it("degraded (thiếu mẫu) ⇒ insufficient, giữ lý do thật của server, KHÔNG bịa số đề xuất", () => {
    const item = toBatchItem(11, {
      ok: true, degraded: true, sampleSize: 12,
      note: "Chỉ có 12 mẫu (khuyến nghị ≥300). Đề xuất thiên về giới hạn hiện tại — hãy duyệt thận trọng.",
      recommended: { lsl: 1, usl: 2, target: 1.5 },
    });
    expect(item.ok).toBe(false);
    expect(item.sampleCount).toBe(12);
    expect(item.reason).toContain("Chỉ có 12 mẫu");
    expect(item).not.toHaveProperty("proposedLsl");
  });

  it("needsReview (dữ liệu lệch xa giới hạn hiện tại) ⇒ insufficient dù đủ mẫu", () => {
    const item = toBatchItem(12, {
      ok: true, degraded: false, needsReview: true, sampleSize: 900,
      note: "⚠️ Dữ liệu đo lệch xa giới hạn hiện tại — cần kỹ sư xem lại.",
      recommended: { lsl: -50, usl: 999, target: 400 },
    });
    expect(item.ok).toBe(false);
    expect(item.sampleCount).toBe(900);
    expect(item.reason).toBe("⚠️ Dữ liệu đo lệch xa giới hạn hiện tại — cần kỹ sư xem lại.");
    expect(item).not.toHaveProperty("proposedLsl");
  });

  it("trợ lý chưa bật (disabled) ⇒ insufficient với lý do, không có sampleCount bịa", () => {
    const item = toBatchItem(13, {
      ok: true, disabled: true,
      note: "Trợ lý đặt ngưỡng chưa bật (AI_THRESHOLD_ADVISOR_ENABLED).",
    });
    expect(item.ok).toBe(false);
    expect(item.sampleCount).toBe(0);
    expect(item.reason).toBe("Trợ lý đặt ngưỡng chưa bật (AI_THRESHOLD_ADVISOR_ENABLED).");
  });

  it("lỗi mạng/tính toán ⇒ insufficient với thông điệp lỗi, không đọc rec cũ/lỗi thời", () => {
    const item = toBatchItem(14, { ok: true, recommended: { lsl: 1, usl: 2, target: 1.5 } }, "Network error");
    expect(item).toEqual({ pointDefId: 14, ok: false, sampleCount: 0, reason: "Network error" });
  });
});
