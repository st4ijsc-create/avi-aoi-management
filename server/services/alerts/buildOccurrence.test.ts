import { describe, it, expect } from "vitest";
import { buildOccurrence } from "./buildOccurrence";

const now = new Date("2026-07-29T10:00:00.000Z");

describe("buildOccurrence", () => {
  it("dựng đủ trường từ sự kiện của LẦN NÀY", () => {
    expect(buildOccurrence(7, { severity: "HIGH", confidence: 63.5 }, now)).toEqual({
      alertId: 7, occurredAt: now, severity: "HIGH",
    });
  });

  it("★★★ D4 — KHÔNG còn ghi `confidenceScore` (mig 0335)", () => {
    // Ba ca cũ ở đây khoá rất kỹ phép chuẩn hoá độ tin cậy: số → "63.50", chuỗi "50" →
    // "50.00", rác → null. Chúng đúng, và chúng vẫn xanh cho tới hôm nay — nhưng thứ
    // chúng canh KHÔNG AI ĐỌC: cột `predictive_alert_occurrences.confidenceScore` được
    // ghi mỗi lần tái diễn (một máy ~22 lần/ngày) mà không một truy vấn nào chọn nó.
    //
    // ⇒ Bài học đáng giữ: **một bộ test kỹ lưỡng KHÔNG chứng minh thứ nó canh là cần
    //   thiết.** Nó chỉ chứng minh thứ đó đang hoạt động đúng như đã viết. Câu hỏi "ai
    //   ĐỌC cái này?" không nằm trong tầm phát biểu của bất kỳ ca test nào.
    //
    // `toEqual` khớp CHÍNH XÁC tập khoá, nên ca này đỏ ngay nếu trường quay lại lặng lẽ.
    const row = buildOccurrence(7, { severity: "LOW", confidence: "50" }, now);
    expect(row).not.toBeNull();
    expect(Object.keys(row!).sort()).toEqual(["alertId", "occurredAt", "severity"]);
  });

  it("vẫn NHẬN `confidence` ở đầu vào — không bắt chỗ gọi phải sửa theo", () => {
    // Hợp đồng đầu vào giữ nguyên có chủ đích: `routeAlert` vẫn truyền độ tin cậy của
    // lần này. Bỏ tham số sẽ buộc sửa chỗ gọi cho một thứ không liên quan tới lý do sửa.
    for (const c of [63.5, "50", "abc", null, undefined]) {
      const r = buildOccurrence(7, { severity: "LOW", confidence: c as never }, now);
      expect(r, `confidence=${String(c)}`).toEqual({ alertId: 7, occurredAt: now, severity: "LOW" });
    }
  });

  it("KHÔNG có alertId ⇒ null (không ghi dòng mồ côi)", () => {
    expect(buildOccurrence(undefined as any, { severity: "HIGH", confidence: 1 }, now)).toBeNull();
  });
});
