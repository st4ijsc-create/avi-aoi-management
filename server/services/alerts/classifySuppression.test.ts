import { describe, it, expect } from "vitest";
import { classifySuppression } from "./classifySuppression";

const th = { risk: 60, confidence: 50, timeframeHours: 168 };

describe("classifySuppression — vì sao ứng viên bị chặn", () => {
  it("đủ mọi điều kiện ⇒ emit", () => {
    expect(classifySuppression({ failureRisk: 70, confidenceScore: 55, predictedTimeframeHours: 24 }, th)).toBe("emit");
  });
  it("rủi ro thấp ⇒ low-risk", () => {
    expect(classifySuppression({ failureRisk: 40, confidenceScore: 90, predictedTimeframeHours: 24 }, th)).toBe("low-risk");
  });
  it("tin cậy thấp ⇒ low-confidence", () => {
    expect(classifySuppression({ failureRisk: 80, confidenceScore: 20, predictedTimeframeHours: 24 }, th)).toBe("low-confidence");
  });
  it("ngoài khung thời gian ⇒ out-of-timeframe", () => {
    expect(classifySuppression({ failureRisk: 80, confidenceScore: 90, predictedTimeframeHours: 999 }, th)).toBe("out-of-timeframe");
  });
  it("thiếu khung thời gian (null) ⇒ out-of-timeframe, KHÔNG coi là đạt", () => {
    expect(classifySuppression({ failureRisk: 80, confidenceScore: 90, predictedTimeframeHours: null }, th)).toBe("out-of-timeframe");
  });
  it("rủi ro thấp được báo TRƯỚC tin cậy thấp (thứ tự ổn định để đếm không nhập nhằng)", () => {
    expect(classifySuppression({ failureRisk: 10, confidenceScore: 10, predictedTimeframeHours: 24 }, th)).toBe("low-risk");
  });
});
