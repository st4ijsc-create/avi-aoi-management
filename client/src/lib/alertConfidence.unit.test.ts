import { describe, it, expect } from "vitest";
import { confidenceBand } from "./alertConfidence";

describe("confidenceBand", () => {
  it("dưới 60 ⇒ thấp", () => { expect(confidenceBand(52)).toBe("low"); });
  it("60–79 ⇒ trung bình", () => { expect(confidenceBand(70)).toBe("medium"); });
  it("từ 80 ⇒ cao", () => { expect(confidenceBand(88)).toBe("high"); });
  it("null ⇒ unknown, KHÔNG mặc định thành 'cao'", () => { expect(confidenceBand(null)).toBe("unknown"); });
  it("chuỗi số (decimal từ pg) vẫn phân dải đúng", () => { expect(confidenceBand("52.00")).toBe("low"); });
  it("giá trị rác ⇒ unknown, không ném", () => { expect(confidenceBand("abc" as any)).toBe("unknown"); });
});
