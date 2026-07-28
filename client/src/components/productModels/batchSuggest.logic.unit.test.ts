// Wave 2 đường A — Task 3: đề xuất ngưỡng hàng loạt (partitionBatch + toBatchItem
// + runCancellableBatchSubmit).
//
// GOTCHA (task-3-brief.md ghi rõ): vitest.config.ts:27 chỉ glob `client/src/**/*.unit.test.ts`
// cho client-side logic — brief gốc đặt tên `batchSuggest.logic.test.ts` (KHÔNG có `.unit`)
// sẽ không bao giờ được chạy (đỏ giả vĩnh viễn). Đặt đúng hậu tố ở đây, theo đúng tiền lệ
// `pendingSuggestion.logic.unit.test.ts` (Task 2) trong cùng thư mục.
import { describe, it, expect } from "vitest";
import { partitionBatch, toBatchItem, runCancellableBatchSubmit } from "./batchSuggestLogic";

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

  it("danh sách rỗng ⇒ BA nhóm rỗng, không ném", () => {
    // Vòng sửa 1 (review Task 3, Important #2) — partitionBatch giờ trả thêm
    // nhóm `failed`; cập nhật kỳ vọng theo chữ ký mới (KHÔNG nới lỏng — ý
    // nghĩa "rỗng ⇒ mọi nhóm đều rỗng, không ném" được giữ nguyên, chỉ thêm
    // một nhóm phải rỗng nữa).
    expect(partitionBatch([])).toEqual({ ready: [], insufficient: [], failed: [] });
  });

  // Vòng sửa 1 (review Task 3, Important #2) — lỗi hạ tầng (mạng/tính toán/
  // trợ lý tắt) PHẢI tách khỏi "chưa đủ dữ liệu thật" (degraded/needsReview):
  // hai vấn đề khác bản chất ("chờ thêm sản phẩm" vs "hệ thống hỏng, thử lại").
  it("item lỗi hạ tầng (failed=true) ⇒ rơi vào nhóm failed, KHÔNG phải insufficient", () => {
    const r = partitionBatch([
      { pointDefId: 20, ok: false, failed: true, sampleCount: 0, reason: "Network error" },
    ]);
    expect(r.insufficient).toEqual([]);
    expect(r.failed.map(x => x.pointDefId)).toEqual([20]);
  });

  it("hỗn hợp ready / insufficient / failed ⇒ đếm đúng từng nhóm", () => {
    const r = partitionBatch([
      { pointDefId: 1, ok: true, sampleCount: 500, proposedLsl: 1, proposedUsl: 2 },
      { pointDefId: 2, ok: false, sampleCount: 12, reason: "Chỉ có 12 mẫu (khuyến nghị ≥300)." },
      { pointDefId: 3, ok: false, failed: true, sampleCount: 0, reason: "Network error" },
      { pointDefId: 4, ok: true, sampleCount: 900, proposedLsl: 3, proposedUsl: 4 },
      { pointDefId: 5, ok: false, failed: true, sampleCount: 0, reason: "Trợ lý đặt ngưỡng chưa bật." },
    ]);
    expect(r.ready.map(x => x.pointDefId)).toEqual([1, 4]);
    expect(r.insufficient.map(x => x.pointDefId)).toEqual([2]);
    expect(r.failed.map(x => x.pointDefId)).toEqual([3, 5]);
  });
});

// toBatchItem không nằm trong danh sách bắt buộc của brief (chỉ partitionBatch được yêu
// cầu), nhưng đây chính là nơi quyết định "đủ dữ liệu hay không / lỗi hạ tầng hay không"
// từ response thật của trpc.aiThresholdAdvisor.recommendForPoint — bỏ qua nó thì lời hứa
// "trung thực" ở partitionBatch vô nghĩa (partitionBatch chỉ trung thực NẾU đầu vào của
// nó trung thực). Thêm test ở đây là lệch khỏi "PASS 3/3" mà brief nêu — ghi rõ trong
// task-3-report.md (mục 5 + "Vòng sửa 1").
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

  it("degraded (thiếu mẫu THẬT) ⇒ insufficient (KHÔNG failed), giữ lý do thật của server, KHÔNG bịa số đề xuất", () => {
    const item = toBatchItem(11, {
      ok: true, degraded: true, sampleSize: 12,
      note: "Chỉ có 12 mẫu (khuyến nghị ≥300). Đề xuất thiên về giới hạn hiện tại — hãy duyệt thận trọng.",
      recommended: { lsl: 1, usl: 2, target: 1.5 },
    });
    expect(item.ok).toBe(false);
    expect(item.failed).toBeFalsy(); // Vòng sửa 1 — PHẢI ở nhóm "insufficient", không phải "failed"
    expect(item.sampleCount).toBe(12);
    expect(item.reason).toContain("Chỉ có 12 mẫu");
    expect(item).not.toHaveProperty("proposedLsl");
  });

  it("needsReview (dữ liệu lệch xa giới hạn hiện tại) ⇒ insufficient (KHÔNG failed) dù đủ mẫu", () => {
    const item = toBatchItem(12, {
      ok: true, degraded: false, needsReview: true, sampleSize: 900,
      note: "⚠️ Dữ liệu đo lệch xa giới hạn hiện tại — cần kỹ sư xem lại.",
      recommended: { lsl: -50, usl: 999, target: 400 },
    });
    expect(item.ok).toBe(false);
    expect(item.failed).toBeFalsy(); // Vòng sửa 1 — vẫn "insufficient", không phải lỗi hạ tầng
    expect(item.sampleCount).toBe(900);
    expect(item.reason).toBe("⚠️ Dữ liệu đo lệch xa giới hạn hiện tại — cần kỹ sư xem lại.");
    expect(item).not.toHaveProperty("proposedLsl");
  });

  it("trợ lý chưa bật (disabled) ⇒ failed (lỗi hạ tầng), không có sampleCount bịa", () => {
    const item = toBatchItem(13, {
      ok: true, disabled: true,
      note: "Trợ lý đặt ngưỡng chưa bật (AI_THRESHOLD_ADVISOR_ENABLED).",
    });
    expect(item.ok).toBe(false);
    expect(item.failed).toBe(true); // Vòng sửa 1 — trước đây gộp vào "insufficient", nay tách riêng
    expect(item.sampleCount).toBe(0);
    expect(item.reason).toBe("Trợ lý đặt ngưỡng chưa bật (AI_THRESHOLD_ADVISOR_ENABLED).");
  });

  it("server trả ok:false (điểm không tìm thấy / lỗi tính toán) ⇒ failed, KHÔNG phải insufficient", () => {
    const item = toBatchItem(15, { ok: false, note: "Không tìm thấy điểm đo." });
    expect(item.ok).toBe(false);
    expect(item.failed).toBe(true);
    expect(item.reason).toBe("Không tìm thấy điểm đo.");
  });

  it("lỗi mạng/tính toán ⇒ failed với thông điệp lỗi, không đọc rec cũ/lỗi thời", () => {
    const item = toBatchItem(14, { ok: true, recommended: { lsl: 1, usl: 2, target: 1.5 } }, "Network error");
    expect(item).toEqual({ pointDefId: 14, ok: false, failed: true, sampleCount: 0, reason: "Network error" });
  });
});

// Vòng sửa 1 (review Task 3, Important #1) — vòng gửi hàng loạt CÓ THỂ HUỶ,
// tách khỏi React/trpc để test thuần tuý. Đây chính là phần logic đáng lẽ phải
// tách được, để không có "kết quả lô cũ đè lên phiên mới" khi dialog bị đóng/
// unmount giữa chừng lúc đang gửi (xem BatchSuggestDialog.handleSubmit).
describe("runCancellableBatchSubmit", () => {
  it("chạy hết không bị huỷ ⇒ cancelled=false, ghi đủ kết quả từng item, tiến độ đúng", async () => {
    const sent: number[] = [];
    const progress: Array<[number, number]> = [];
    const r = await runCancellableBatchSubmit({
      items: [1, 2, 3],
      getId: (n: number) => n,
      send: async (n: number) => {
        sent.push(n);
        if (n === 2) throw new Error("boom");
      },
      isCancelled: () => false,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(r.cancelled).toBe(false);
    expect(sent).toEqual([1, 2, 3]);
    expect(r.results).toEqual([
      { pointDefId: 1, ok: true },
      { pointDefId: 2, ok: false, error: "boom" },
      { pointDefId: 3, ok: true },
    ]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it("huỷ NGAY SAU khi item đầu gửi xong ⇒ dừng ngay, KHÔNG bắn thêm request, KHÔNG báo tiến độ cho phiên đã huỷ", async () => {
    const sent: number[] = [];
    let cancelled = false;
    const progress: Array<[number, number]> = [];
    const r = await runCancellableBatchSubmit({
      items: [1, 2, 3],
      getId: (n: number) => n,
      send: async (n: number) => {
        sent.push(n);
        // Mô phỏng: người dùng đóng dialog / điều hướng khỏi trang ngay sau khi
        // request của item 1 đã bay đi (đã tạo bản ghi thật).
        cancelled = true;
      },
      isCancelled: () => cancelled,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(r.cancelled).toBe(true);
    expect(sent).toEqual([1]); // KHÔNG bắn thêm request cho item 2/3 của lô đã bị huỷ
    // Request của item 1 ĐÃ BAY ĐI (có thể đã tạo bản ghi thật) — vẫn phải ghi
    // nhận, không được "quên" nó chỉ vì bị huỷ ngay sau đó.
    expect(r.results).toEqual([{ pointDefId: 1, ok: true }]);
    // Nhưng KHÔNG được báo tiến độ (setState) cho một phiên đã huỷ.
    expect(progress).toEqual([]);
  });

  it("đã huỷ TRƯỚC khi bắt đầu ⇒ không gửi item nào, results rỗng", async () => {
    const sent: number[] = [];
    const r = await runCancellableBatchSubmit({
      items: [1, 2],
      getId: (n: number) => n,
      send: async (n: number) => { sent.push(n); },
      isCancelled: () => true,
    });
    expect(r.cancelled).toBe(true);
    expect(sent).toEqual([]);
    expect(r.results).toEqual([]);
  });
});
