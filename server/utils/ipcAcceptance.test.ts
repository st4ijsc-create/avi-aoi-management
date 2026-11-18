import { describe, expect, it } from "vitest";
import {
  listIpcClasses,
  resolveDefectForClass,
  IPC_CLASSES,
} from "./ipcAcceptance";

describe("listIpcClasses", () => {
  it("trả đúng 3 phần tử với id \"1\",\"2\",\"3\" theo thứ tự, mỗi phần tử có id/name/description khớp IPC_CLASSES", () => {
    const result = listIpcClasses();
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: "1", ...IPC_CLASSES["1"] });
    expect(result[1]).toEqual({ id: "2", ...IPC_CLASSES["2"] });
    expect(result[2]).toEqual({ id: "3", ...IPC_CLASSES["3"] });
  });
});

describe("resolveDefectForClass — luật tường minh classRules", () => {
  it("cấp \"2\" dùng classRules.class2: accept, limit, notes của luật; explicit = true", () => {
    const defect = {
      code: "D001",
      severity: "major",
      acceptanceClass: "2",
      classRules: {
        class2: {
          accept: "reject" as const,
          severity: "critical" as const,
          limit: "void <= 9%",
          notes: "phải kiểm tra diện tích",
        },
      },
    };
    const r = resolveDefectForClass(defect, "2");
    expect(r.accept).toBe("reject");
    expect(r.severity).toBe("critical");
    expect(r.limit).toBe("void <= 9%");
    expect(r.notes).toBe("phải kiểm tra diện tích");
    expect(r.explicit).toBe(true);
  });

  it("cấp \"3\" dùng classRules.class3: accept, limit, notes của luật; explicit = true", () => {
    const defect = {
      code: "D002",
      severity: "major",
      acceptanceClass: "3",
      classRules: {
        class3: {
          accept: "accept" as const,
          severity: "minor" as const,
          limit: "fill >= 100%",
          notes: "chấp nhận được",
        },
      },
    };
    const r = resolveDefectForClass(defect, "3");
    expect(r.accept).toBe("accept");
    expect(r.severity).toBe("minor");
    expect(r.limit).toBe("fill >= 100%");
    expect(r.notes).toBe("chấp nhận được");
    expect(r.explicit).toBe(true);
  });

  it("severity ở nhánh tường minh: của luật nếu có; của hàng nếu luật thiếu; cả hai thiếu ⇒ \"minor\"", () => {
    // Luật có severity
    const d1 = {
      code: "D1",
      severity: "major",
      classRules: { class2: { accept: "reject" as const, severity: "critical" as const } },
    };
    expect(resolveDefectForClass(d1, "2").severity).toBe("critical");

    // Luật thiếu severity, hàng có
    const d2 = {
      code: "D2",
      severity: "cosmetic" as const,
      classRules: { class3: { accept: "accept" as const } },
    };
    expect(resolveDefectForClass(d2, "3").severity).toBe("cosmetic");

    // Cả hai thiếu severity
    const d3 = {
      code: "D3",
      severity: null,
      classRules: { class2: { accept: "reject" as const } },
    };
    expect(resolveDefectForClass(d3, "2").severity).toBe("minor");
  });

  it("cấp \"1\" KHÔNG bao giờ dùng classRules, kể cả khi hàng có cả class2 lẫn class3", () => {
    const defect = {
      code: "D003",
      severity: "major",
      acceptanceClass: "2",
      classRules: {
        class2: { accept: "reject" as const },
        class3: { accept: "accept" as const },
      },
    };
    const r = resolveDefectForClass(defect, "1");
    expect(r.explicit).toBe(false);
    // acceptanceClass = "2", cấp 1 < 2 → không gắn cờ → accept
    expect(r.accept).toBe("accept");
  });

  it("chỉ có class2 mà hỏi \"3\" ⇒ rơi về acceptanceClass, explicit = false", () => {
    const defect = {
      code: "D004",
      severity: "major",
      acceptanceClass: "3",
      classRules: {
        class2: { accept: "reject" as const },
      },
    };
    const r = resolveDefectForClass(defect, "3");
    expect(r.explicit).toBe(false);
    // acceptanceClass = "3", cấp 3 >= 3 → gắn cờ → reject
    expect(r.accept).toBe("reject");
  });

  it("chỉ có class3 mà hỏi \"2\" ⇒ rơi về acceptanceClass, explicit = false", () => {
    const defect = {
      code: "D005",
      severity: "major",
      acceptanceClass: "2",
      classRules: {
        class3: { accept: "reject" as const },
      },
    };
    const r = resolveDefectForClass(defect, "2");
    expect(r.explicit).toBe(false);
    // acceptanceClass = "2", cấp 2 >= 2 → gắn cờ → reject
    expect(r.accept).toBe("reject");
  });
});

describe("resolveDefectForClass — nhánh rơi về (fallback)", () => {
  it("bảng 9 ca: 3 cấp × acceptanceClass \"1\"/\"2\"/\"3\"", () => {
    // acceptanceClass = "1" → flagged ở mọi cấp (t >= 1)
    const d_a1 = { code: "F1", severity: "major", acceptanceClass: "1" };
    expect(resolveDefectForClass(d_a1, "1").accept).toBe("reject");
    expect(resolveDefectForClass(d_a1, "2").accept).toBe("reject");
    expect(resolveDefectForClass(d_a1, "3").accept).toBe("reject");

    // acceptanceClass = "2" → flagged ở cấp 2, 3
    const d_a2 = { code: "F2", severity: "major", acceptanceClass: "2" };
    expect(resolveDefectForClass(d_a2, "1").accept).toBe("accept");
    expect(resolveDefectForClass(d_a2, "2").accept).toBe("reject");
    expect(resolveDefectForClass(d_a2, "3").accept).toBe("reject");

    // acceptanceClass = "3" → flagged ở cấp 3
    const d_a3 = { code: "F3", severity: "major", acceptanceClass: "3" };
    expect(resolveDefectForClass(d_a3, "1").accept).toBe("accept");
    expect(resolveDefectForClass(d_a3, "2").accept).toBe("accept");
    expect(resolveDefectForClass(d_a3, "3").accept).toBe("reject");
  });

  it("kết quả rơi về không có limit và notes", () => {
    const defect = {
      code: "F4",
      severity: "major",
      acceptanceClass: "2",
      classRules: {
        class3: { accept: "reject" as const, limit: "x", notes: "y" },
      },
    };
    // hỏi cấp 2, chỉ có class3 → fallback
    const r = resolveDefectForClass(defect, "2");
    expect(r.limit).toBeUndefined();
    expect(r.notes).toBeUndefined();
  });

  it("severity ở nhánh rơi về: của hàng; hàng null hoặc vắng ⇒ \"minor\"", () => {
    const d1 = { code: "F5", severity: "cosmetic" as const, acceptanceClass: "1" };
    expect(resolveDefectForClass(d1, "2").severity).toBe("cosmetic");

    const d2 = { code: "F6", severity: null, acceptanceClass: "1" };
    expect(resolveDefectForClass(d2, "2").severity).toBe("minor");

    const d3 = { code: "F7", acceptanceClass: "1" };
    expect(resolveDefectForClass(d3, "2").severity).toBe("minor");
  });
});

describe("resolveDefectForClass — acceptanceClass đặc biệt", () => {
  it("acceptanceClass vắng (undefined) ⇒ \"reject\" ở cả ba cấp", () => {
    const defect = { code: "E1", severity: "major" };
    expect(resolveDefectForClass(defect, "1").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "2").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "3").accept).toBe("reject");
  });

  it("acceptanceClass null ⇒ \"reject\" ở cả ba cấp", () => {
    const defect = { code: "E2", severity: "major", acceptanceClass: null };
    expect(resolveDefectForClass(defect, "1").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "2").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "3").accept).toBe("reject");
  });

  it("acceptanceClass chuỗi rỗng ⇒ \"reject\" ở cả ba cấp", () => {
    const defect = { code: "E3", severity: "major", acceptanceClass: "" };
    expect(resolveDefectForClass(defect, "1").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "2").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "3").accept).toBe("reject");
  });

  it("acceptanceClass không phải số ⇒ \"reject\" ở cả ba cấp", () => {
    const defect = { code: "E4", severity: "major", acceptanceClass: "abc" };
    expect(resolveDefectForClass(defect, "1").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "2").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "3").accept).toBe("reject");
  });
});

describe("resolveDefectForClass — classRules null hoặc {}", () => {
  it("classRules null ⇒ rơi về acceptanceClass", () => {
    const defect = { code: "N1", severity: "major", acceptanceClass: "2", classRules: null };
    expect(resolveDefectForClass(defect, "1").accept).toBe("accept");
    expect(resolveDefectForClass(defect, "2").accept).toBe("reject");
    expect(resolveDefectForClass(defect, "3").accept).toBe("reject");
  });

  it("classRules {} (không luật nào) ⇒ rơi về acceptanceClass", () => {
    const defect = { code: "N2", severity: "major", acceptanceClass: "3", classRules: {} };
    expect(resolveDefectForClass(defect, "1").accept).toBe("accept");
    expect(resolveDefectForClass(defect, "2").accept).toBe("accept");
    expect(resolveDefectForClass(defect, "3").accept).toBe("reject");
  });
});
