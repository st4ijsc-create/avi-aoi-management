/**
 * server/utils/measurementPointLimitGate.test.ts
 *
 * BG-113 (review Khối C lượt 9, I-2) — lưới THUẦN cho gate khoảng giới hạn
 * (`lowerLimit ≤ upperLimit`, `heightMin ≤ heightMax` trên khoảng ĐÃ MERGE).
 * Lưới KHÔNG chạm DB — 6 call site thật (I-2 + I-3) được đo bằng census
 * `server/contracts/limitRangeGateCensus.test.ts` (đếm điểm gọi trên mã nguồn).
 */
import { describe, it, expect } from "vitest";
import {
  loiCapGioiHanSauMerge,
  gopCapGioiHanDonGian,
  assertCapGioiHanHopLe,
  touchesApprovalLimitFields,
} from "./measurementPointLimitGate";

describe("BG-113 — loiCapGioiHanSauMerge (thuần, không DB)", () => {
  it("lowerLimit ≤ upperLimit hợp lệ ⇒ [] (chuỗi, đúng kiểu numeric-as-string trên dây)", () => {
    expect(loiCapGioiHanSauMerge({ lowerLimit: "1", upperLimit: "10" })).toEqual([]);
    expect(loiCapGioiHanSauMerge({ lowerLimit: "5", upperLimit: "5" })).toEqual([]); // bằng nhau vẫn hợp lệ
  });

  it("★★★ lowerLimit > upperLimit ⇒ 1 lỗi (đúng hình dạng khoảng RỖNG mà BG-113 mô tả)", () => {
    const loi = loiCapGioiHanSauMerge({ lowerLimit: "10", upperLimit: "1" });
    expect(loi.length).toBe(1);
    expect(loi[0]).toMatch(/lowerLimit.*upperLimit/);
  });

  it("heightMin > heightMax ⇒ 1 lỗi, ĐỘC LẬP với lowerLimit/upperLimit", () => {
    const loi = loiCapGioiHanSauMerge({ lowerLimit: "1", upperLimit: "10", heightMin: "5", heightMax: "2" });
    expect(loi.length).toBe(1);
    expect(loi[0]).toMatch(/heightMin.*heightMax/);
  });

  it("cả hai cặp cùng vi phạm ⇒ 2 lỗi", () => {
    const loi = loiCapGioiHanSauMerge({ lowerLimit: "10", upperLimit: "1", heightMin: "5", heightMax: "2" });
    expect(loi.length).toBe(2);
  });

  it("một cận RỖNG (null/undefined/'') không mâu thuẫn với cận kia ⇒ [] (điểm min-only/max-only)", () => {
    expect(loiCapGioiHanSauMerge({ lowerLimit: "1" })).toEqual([]);
    expect(loiCapGioiHanSauMerge({ upperLimit: "10" })).toEqual([]);
    expect(loiCapGioiHanSauMerge({ lowerLimit: null, upperLimit: "10" })).toEqual([]);
    expect(loiCapGioiHanSauMerge({ lowerLimit: "1", upperLimit: "" })).toEqual([]);
  });

  it("chấp nhận number lẫn string (call site AI Copilot gửi number, router gửi string)", () => {
    expect(loiCapGioiHanSauMerge({ lowerLimit: 10, upperLimit: 1 }).length).toBe(1);
    expect(loiCapGioiHanSauMerge({ lowerLimit: 1, upperLimit: 10 })).toEqual([]);
  });

  it("giá trị KHÔNG PHẢI số (rác) ⇒ bỏ qua so sánh — gate này không phải kiểm-định-dạng", () => {
    expect(loiCapGioiHanSauMerge({ lowerLimit: "abc", upperLimit: "10" })).toEqual([]);
  });
});

describe("BG-113 — gopCapGioiHanDonGian (merge field-theo-field)", () => {
  it("★★★ patch CHỈ gửi upperLimit mới, lowerLimit HIỆN CÓ cao hơn ⇒ merge vẫn thấy mâu thuẫn", () => {
    // Đúng hình dạng brief mô tả: "patch chỉ gửi upperLimit mới thấp hơn
    // lowerLimit cũ vẫn phải chặn" — kiểm RIÊNG `patch` (không merge) sẽ MÙ vì
    // patch.lowerLimit === undefined, không có gì để so trong chính patch.
    const hienCo = { lowerLimit: "9", upperLimit: "11" };
    const patch = { upperLimit: "5" }; // lowerLimit KHÔNG đổi trong patch này
    const gopSau = gopCapGioiHanDonGian(hienCo, patch);
    expect(gopSau).toEqual({ lowerLimit: "9", upperLimit: "5", heightMin: undefined, heightMax: undefined });
    expect(loiCapGioiHanSauMerge(gopSau).length, "phải bắt được — 9 > 5").toBe(1);
  });

  it("patch field vắng mặt ⇒ giữ hienCo; patch field có mặt (kể cả null) ⇒ đè lên hienCo", () => {
    const hienCo = { lowerLimit: "1", upperLimit: "10", heightMin: "2", heightMax: "8" };
    const gopSau = gopCapGioiHanDonGian(hienCo, { upperLimit: "20", heightMin: null });
    expect(gopSau).toEqual({ lowerLimit: "1", upperLimit: "20", heightMin: null, heightMax: "8" });
  });
});

describe("BG-113 — assertCapGioiHanHopLe (ném lỗi cho tRPC router/hàm DB)", () => {
  it("hợp lệ ⇒ không ném", () => {
    expect(() => assertCapGioiHanHopLe({ lowerLimit: "1", upperLimit: "10" })).not.toThrow();
  });

  it("★★★ không hợp lệ ⇒ ném TRPCError BAD_REQUEST/INVALID_VALUE", () => {
    let bat: unknown;
    try {
      assertCapGioiHanHopLe({ lowerLimit: "10", upperLimit: "1" });
    } catch (e) {
      bat = e;
    }
    expect(bat, "phải ném — nếu đây là undefined thì gate không canh được gì").toBeDefined();
    expect((bat as { code?: string }).code).toBe("BAD_REQUEST");
    const cause = (bat as { cause?: { appCode?: string } }).cause;
    expect(cause?.appCode).toBe("INVALID_VALUE");
  });
});

// Hồi quy — touchesApprovalLimitFields KHÔNG đổi hành vi (Task 8 Khối C, đã có
// lưới riêng ở nơi khác, ghim thêm một mệnh đề mỏng ở đây vì cùng file).
describe("touchesApprovalLimitFields — hồi quy mỏng (lưới đầy đủ ở nơi khác)", () => {
  it("field ngoài APPROVAL_LIMIT_FIELDS ⇒ false", () => {
    expect(touchesApprovalLimitFields({ name: "x", componentCode: "y" })).toBe(false);
  });
  it("lowerLimit có mặt ⇒ true", () => {
    expect(touchesApprovalLimitFields({ lowerLimit: "1" })).toBe(true);
  });
});
