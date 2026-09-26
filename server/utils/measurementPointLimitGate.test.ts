/**
 * server/utils/measurementPointLimitGate.test.ts
 *
 * BG-113 (review Khối C lượt 9, I-2) — lưới THUẦN cho gate khoảng giới hạn
 * (`min ≤ max` trên khoảng ĐÃ MERGE, cho MỌI cặp trong `MIN_MAX_PAIRS`). Lưới
 * KHÔNG chạm DB — 7 call site thật (I-2 + I-3 + NEW-4) được đo bằng census
 * `server/contracts/limitRangeGateCensus.test.ts` (đếm điểm gọi trên mã nguồn).
 *
 * ★★★ NEW-1 (review lượt 9, vòng 2, Important) — TRƯỚC bản vá này gate chỉ kiểm
 * HAI cặp (lowerLimit/upperLimit, heightMin/heightMax) dù `MIN_MAX_PAIRS`
 * (`shared/pointLimitSpec.ts`) khai NĂM cặp — area/volume/thickness đi qua
 * trắng dù `judge()`/`evaluatePointResult` (`pointResultEvaluator.ts`) chấm cả
 * năm. Mục "NEW-1 — cả năm cặp" dưới đây khoá hành vi ĐÃ VÁ.
 */
import { describe, it, expect } from "vitest";
import {
  loiCapGioiHanSauMerge,
  gopCapGioiHanDonGian,
  assertCapGioiHanHopLe,
  touchesApprovalLimitFields,
} from "./measurementPointLimitGate";
import { MIN_MAX_PAIRS } from "@shared/pointLimitSpec";
import { z } from "zod";

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

// ══════════════════════════════════════════════════════════════════════════
// ★★★ NEW-1 (review Khối C lượt 9, vòng 2, Important) — CẢ NĂM cặp min/max
// (`MIN_MAX_PAIRS`, `shared/pointLimitSpec.ts`) phải được gate kiểm, không chỉ
// hai cặp cũ. Trước bản vá: `loiCapGioiHanSauMerge({areaMin:"10", areaMax:"5"})`
// trả `[]` (KHÔNG bắt được) — một khoảng RỖNG ghi thẳng, mọi trị đo area của
// điểm đó TRƯỢT 100% ở `pointResultEvaluator.ts` lúc CHẤM (không phải lúc dạy).
// ══════════════════════════════════════════════════════════════════════════
describe("★★★ NEW-1 — cả NĂM cặp min/max (không chỉ lowerLimit/upperLimit/heightMin/heightMax)", () => {
  it("MIN_MAX_PAIRS khai đúng NĂM cặp hôm nay (cầu chì — nếu spec đổi, lưới này phải sửa lại có chủ ý)", () => {
    expect(MIN_MAX_PAIRS.map((p) => `${p.min}/${p.max}`).sort()).toEqual(
      ["areaMin/areaMax", "heightMin/heightMax", "lowerLimit/upperLimit", "thicknessMin/thicknessMax", "volumeMin/volumeMax"].sort(),
    );
  });

  it("areaMin > areaMax ⇒ 1 lỗi (TRƯỚC bản vá: [] — đi qua trắng)", () => {
    const loi = loiCapGioiHanSauMerge({ areaMin: "10", areaMax: "5" });
    expect(loi.length).toBe(1);
    expect(loi[0]).toMatch(/areaMin.*areaMax/);
  });

  it("volumeMin > volumeMax ⇒ 1 lỗi", () => {
    const loi = loiCapGioiHanSauMerge({ volumeMin: "3", volumeMax: "1" });
    expect(loi.length).toBe(1);
    expect(loi[0]).toMatch(/volumeMin.*volumeMax/);
  });

  it("thicknessMin > thicknessMax ⇒ 1 lỗi", () => {
    const loi = loiCapGioiHanSauMerge({ thicknessMin: "2", thicknessMax: "1" });
    expect(loi.length).toBe(1);
    expect(loi[0]).toMatch(/thicknessMin.*thicknessMax/);
  });

  it("CẢ NĂM cặp cùng vi phạm một lúc ⇒ 5 lỗi ĐỘC LẬP", () => {
    const loi = loiCapGioiHanSauMerge({
      lowerLimit: "10", upperLimit: "1",
      heightMin: "10", heightMax: "1",
      areaMin: "10", areaMax: "1",
      volumeMin: "10", volumeMax: "1",
      thicknessMin: "10", thicknessMax: "1",
    });
    expect(loi.length).toBe(5);
  });

  it("gopCapGioiHanDonGian merge CẢ NĂM cặp — patch chỉ đổi areaMax, areaMin HIỆN CÓ cao hơn ⇒ vẫn bắt được", () => {
    const hienCo = { areaMin: "9", areaMax: "11" };
    const patch = { areaMax: "5" }; // areaMin KHÔNG đổi trong patch này
    const gopSau = gopCapGioiHanDonGian(hienCo, patch);
    expect(loiCapGioiHanSauMerge(gopSau).length, "phải bắt được — areaMin 9 > areaMax 5").toBe(1);
  });

  it("assertCapGioiHanHopLe ném cho cặp area/volume/thickness, giống hệt lowerLimit/upperLimit", () => {
    expect(() => assertCapGioiHanHopLe({ volumeMin: "5", volumeMax: "1" })).toThrow();
    expect(() => assertCapGioiHanHopLe({ volumeMin: "1", volumeMax: "5" })).not.toThrow();
  });

  // ── ĐỘT BIẾN THẬT (mô phỏng TRONG BỘ NHỚ): rút MỘT cặp khỏi MIN_MAX_PAIRS ──
  // chứng minh gate THẬT SỰ suy từ mảng này (không phải một danh sách chép tay
  // trùng hợp khớp) — bỏ một cặp ⇒ đúng cặp đó không còn bị kiểm, các cặp khác
  // vẫn nguyên vẹn.
  it("★★★ ĐỘT BIẾN: rút cặp areaMin/areaMax khỏi MIN_MAX_PAIRS (mô phỏng) ⇒ areaMin>areaMax không còn bị bắt, cặp khác vẫn bắt", () => {
    const capRut = (MIN_MAX_PAIRS as readonly { min: string; max: string }[]).filter((p) => p.max !== "areaMax");
    expect(capRut.length, "đột biến phải thật sự bớt một cặp").toBe(MIN_MAX_PAIRS.length - 1);
    const truongRut = Array.from(new Set(capRut.flatMap((p) => [p.min, p.max])));
    const schemaRut = z
      .object(Object.fromEntries(truongRut.map((f) => [f, z.unknown().optional()])))
      .superRefine((gopSau: Record<string, unknown>, ctx) => {
        for (const { min, max } of capRut) {
          const lo = gopSau[min]; const hi = gopSau[max];
          const loN = lo === null || lo === undefined || lo === "" ? null : Number(lo);
          const hiN = hi === null || hi === undefined || hi === "" ? null : Number(hi);
          if (loN !== null && hiN !== null && Number.isFinite(loN) && Number.isFinite(hiN) && loN > hiN) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [max], message: `${min} phải ≤ ${max}` });
          }
        }
      });
    const ketRut = schemaRut.safeParse({ areaMin: "10", areaMax: "5" });
    expect(ketRut.success, "đột biến: areaMin>areaMax KHÔNG còn bị bắt sau khi rút cặp đó").toBe(true);
    const ketThatSu = loiCapGioiHanSauMerge({ areaMin: "10", areaMax: "5" });
    expect(ketThatSu.length, "gate THẬT (chưa đột biến) phải VẪN bắt được — chứng minh đột biến chỉ sống trong lưới này").toBe(1);
  });
});
