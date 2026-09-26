import { describe, it, expect } from "vitest";
import { resolveAppliedThreshold, type CurrentPointSnapshot } from "./resolveAppliedThreshold";

const APPLIED = { pointDefId: 42, lsl: "0.24", usl: "0.36", nominal: "0.30" };

function point(overrides: Partial<CurrentPointSnapshot> = {}): CurrentPointSnapshot {
  return { id: 42, lowerLimit: "0.25", upperLimit: "0.35", nominalValue: "0.30", ...overrides };
}

describe("resolveAppliedThreshold — F1 CRITICAL patch, final-fix round tách hàm thuần", () => {
  it("KHÔNG có điểm nào đang mở (selectedPointIndex === null) ⇒ 'none', KHÔNG trả lsl/usl/nominal", () => {
    const result = resolveAppliedThreshold({
      applied: APPLIED,
      selectedPointIndex: null,
      currentPoint: undefined,
      formLowerLimit: "0.25",
      formUpperLimit: "0.35",
      formNominalValue: "0.30",
      showToleranceSection: true,
    });
    expect(result).toEqual({ toast: "none" });
  });

  it("điểm đang mở KHÁC điểm vừa được duyệt (đã chuyển điểm giữa lúc mutation chạy) ⇒ 'none', form giữ nguyên", () => {
    const result = resolveAppliedThreshold({
      applied: APPLIED, // pointDefId: 42
      selectedPointIndex: 0,
      currentPoint: point({ id: 999 }), // điểm KHÁC đang mở
      formLowerLimit: "1",
      formUpperLimit: "2",
      formNominalValue: "1.5",
      showToleranceSection: true,
    });
    expect(result).toEqual({ toast: "none" });
  });

  it("loại điểm KHÔNG hiện ô ngưỡng (showToleranceSection=false) ⇒ 'noInputs', VẪN trả lsl/usl/nominal để component cập nhật state chung", () => {
    const result = resolveAppliedThreshold({
      applied: APPLIED,
      selectedPointIndex: 0,
      currentPoint: point(), // khớp form hiện tại — không dirty, nhưng nhánh noInputs thắng trước
      formLowerLimit: "0.25",
      formUpperLimit: "0.35",
      formNominalValue: "0.30",
      showToleranceSection: false,
    });
    expect(result).toEqual({ toast: "noInputs", lsl: "0.24", usl: "0.36", nominal: "0.30" });
  });

  it("có ô ngưỡng + form ĐANG dirty (đã gõ tay khác snapshot trước-khi-duyệt) ⇒ 'overDirty', nạp đè giá trị mới", () => {
    const result = resolveAppliedThreshold({
      applied: APPLIED,
      selectedPointIndex: 0,
      currentPoint: point(), // snapshot trước-khi-duyệt: 0.25/0.35/0.30
      formLowerLimit: "9.99", // người dùng đã gõ tay khác snapshot
      formUpperLimit: "0.35",
      formNominalValue: "0.30",
      showToleranceSection: true,
    });
    expect(result).toEqual({ toast: "overDirty", lsl: "0.24", usl: "0.36", nominal: "0.30" });
  });

  it("có ô ngưỡng + form KHÔNG dirty (khớp snapshot trước-khi-duyệt) ⇒ 'reloaded'", () => {
    const result = resolveAppliedThreshold({
      applied: APPLIED,
      selectedPointIndex: 0,
      currentPoint: point(), // 0.25/0.35/0.30 — khớp form dưới
      formLowerLimit: "0.25",
      formUpperLimit: "0.35",
      formNominalValue: "0.30",
      showToleranceSection: true,
    });
    expect(result).toEqual({ toast: "reloaded", lsl: "0.24", usl: "0.36", nominal: "0.30" });
  });

  it("applied.nominal === null ⇒ trả nominal rỗng chuỗi (không phải 'null' chữ)", () => {
    const result = resolveAppliedThreshold({
      applied: { pointDefId: 42, lsl: "1", usl: "2", nominal: null },
      selectedPointIndex: 0,
      currentPoint: point(),
      formLowerLimit: "0.25",
      formUpperLimit: "0.35",
      formNominalValue: "0.30",
      showToleranceSection: true,
    });
    expect(result).toEqual({ toast: "reloaded", lsl: "1", usl: "2", nominal: "" });
  });

  it("currentPoint undefined (index ngoài phạm vi) dù selectedPointIndex khác null ⇒ 'none', fail-safe", () => {
    const result = resolveAppliedThreshold({
      applied: APPLIED,
      selectedPointIndex: 3,
      currentPoint: undefined,
      formLowerLimit: "0.25",
      formUpperLimit: "0.35",
      formNominalValue: "0.30",
      showToleranceSection: true,
    });
    expect(result).toEqual({ toast: "none" });
  });
});
