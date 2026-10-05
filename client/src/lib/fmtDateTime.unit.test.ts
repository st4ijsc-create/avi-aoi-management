/**
 * doc 81 Đợt 3 final wave (Task 3 FINAL-WAVE) — `fmtDateTime` dùng chung (Sản xuất › Ca + An toàn): hành vi y hệt hai bản
 * chép cũ, và hai trang nhập CÙNG một bản (không chép lại).
 */
import { describe, expect, it } from "vitest";
import { fmtDateTime } from "./fmtDateTime";
import SHIFTS_SRC from "../pages/ProductionShifts.tsx?raw";
import SAFETY_SRC from "../pages/SafetyWorkforce.tsx?raw";

describe("fmtDateTime", () => {
  it("rỗng / không hợp lệ ⇒ '—'; chuỗi ISO và Date ⇒ toLocaleString()", () => {
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime("")).toBe("—");
    expect(fmtDateTime("không phải ngày")).toBe("—");
    const iso = "2026-10-03T08:00:00.000Z";
    expect(fmtDateTime(iso)).toBe(new Date(iso).toLocaleString());
    expect(fmtDateTime(new Date(iso))).toBe(new Date(iso).toLocaleString());
  });

  it("Sản xuất › Ca và An toàn nhập bản dùng chung, không còn định nghĩa riêng", () => {
    for (const src of [SHIFTS_SRC, SAFETY_SRC]) {
      expect(src).toMatch(/import \{ fmtDateTime \} from "@\/lib\/fmtDateTime";/);
      expect(src).not.toMatch(/function fmtDateTime\s*\(/);
    }
  });
});
