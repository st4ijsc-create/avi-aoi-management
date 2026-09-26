/**
 * Fix round 1 (doc 80 Task 2 review) — round-trip `commandValueOrNull(serializeCommandValueForEdit(x))`.
 *
 * Bug reproduced: `openEdit()` used `String(r.commandValue)` to populate the edit
 * field. For an object, `String({...})` = the literal text "[object Object]" —
 * opening and saving a rule (even for an unrelated rename) silently REPLACES the
 * stored object with that unparseable string, which `interlockEngine.ts:284`
 * (`value: rule.commandValue ?? true`) then sends straight to the PLC/adapter.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC: khôi phục `serializeCommandValueForEdit` về
 * `String(v)` (hành vi cũ) ⇒ ca object/array PHẢI ĐỎ.
 */
import { describe, it, expect } from "vitest";
import { commandValueOrNull, serializeCommandValueForEdit } from "./interlockCommandValue";

function roundTrip(x: unknown): unknown {
  return commandValueOrNull(serializeCommandValueForEdit(x));
}

describe("interlockCommandValue — round-trip qua ô nhập edit (Fix round 1)", () => {
  it("★★★ object round-trip NGUYÊN VẸN (trước vá: thành chuỗi '[object Object]')", () => {
    const x = { targetSpeedPct: 40, reason: "giảm tốc line 1" };
    expect(roundTrip(x)).toEqual(x);
  });

  it("array round-trip nguyên vẹn", () => {
    const x = [1, 2, 3];
    expect(roundTrip(x)).toEqual(x);
  });

  it("number round-trip nguyên vẹn", () => {
    expect(roundTrip(42)).toBe(42);
    expect(roundTrip(0)).toBe(0);
  });

  it("boolean round-trip nguyên vẹn", () => {
    expect(roundTrip(true)).toBe(true);
    expect(roundTrip(false)).toBe(false);
  });

  it("null round-trip nguyên vẹn (ô nhập rỗng)", () => {
    expect(serializeCommandValueForEdit(null)).toBe("");
    expect(roundTrip(null)).toBeNull();
  });

  it("chuỗi KHÔNG giống cú pháp JSON (vd tag lệnh) round-trip nguyên vẹn", () => {
    expect(roundTrip("STOP_LINE")).toBe("STOP_LINE");
  });

  // ⚠ GIỚI HẠN ĐÃ BIẾT (tài liệu hoá, không phải hồi quy ẩn) — xem docblock của
  // interlockCommandValue.ts: một Ô NHẬP MỘT DÒNG không thể phân biệt "chuỗi có
  // nội dung giống số/bool" với "số/bool thật" nếu không có quy ước trích dẫn —
  // ngoài phạm vi Đợt 0. Hai ca dưới XÁC NHẬN hành vi HIỆN TẠI (không round-trip
  // đúng kiểu), để giới hạn này LUÔN HIỆN, không bị vá âm thầm rồi trôi đi.
  it("⚠ chuỗi \"1\" (giống số) KHÔNG round-trip đúng kiểu — trở thành number 1 (giới hạn đã biết)", () => {
    expect(serializeCommandValueForEdit("1")).toBe("1");
    expect(roundTrip("1")).toBe(1);
    expect(roundTrip("1")).not.toBe("1");
  });

  it("⚠ chuỗi \"true\" (giống bool) KHÔNG round-trip đúng kiểu — trở thành boolean true (giới hạn đã biết)", () => {
    expect(serializeCommandValueForEdit("true")).toBe("true");
    expect(roundTrip("true")).toBe(true);
  });
});
