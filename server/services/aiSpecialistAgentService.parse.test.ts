import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseAgentOutput, salvageAgentSections, specialistMaxTokens } from "./aiSpecialistAgentService";

// Wave 1 FF-A — live-verify trên trình duyệt cho `backend-engineer` sinh đúng
// 1400 token (chạm trần maxTokens cũ) ⇒ JSON hỏng ⇒ parseAgentOutput cũ vứt hết
// vào `summary` thô, 6/7 khối còn lại "No content". Test dưới đây bắt LẠI đúng
// bug đó bằng fixture text, KHÔNG gọi model thật.

describe("parseAgentOutput", () => {
  it("1. JSON hợp lệ đủ 8 khoá ⇒ phân tích đúng (chống hồi quy hành vi cũ)", () => {
    const rawText = JSON.stringify({
      summary: "Tóm tắt ngắn gọn",
      diagnosis: ["nguyên nhân 1", "nguyên nhân 2"],
      actionPlan: ["bước 1", "bước 2"],
      patchHints: ["gợi ý vá 1"],
      testPlan: ["test 1"],
      optimizationIdeas: ["ý tưởng 1"],
      risks: ["rủi ro 1"],
      reportTemplate: ["mục báo cáo 1"],
    });

    const out = parseAgentOutput(rawText);

    expect(out).toEqual({
      summary: "Tóm tắt ngắn gọn",
      diagnosis: ["nguyên nhân 1", "nguyên nhân 2"],
      actionPlan: ["bước 1", "bước 2"],
      patchHints: ["gợi ý vá 1"],
      testPlan: ["test 1"],
      optimizationIdeas: ["ý tưởng 1"],
      risks: ["rủi ro 1"],
      reportTemplate: ["mục báo cáo 1"],
    });
  });

  it("2. JSON bị cắt giữa mảng ⇒ vớt được summary/diagnosis/actionPlan riêng lẻ, KHÔNG dồn tất cả vào summary", () => {
    const rawText = `{"summary":"S","diagnosis":["a","b"],"actionPlan":["x","y`;

    const out = parseAgentOutput(rawText);

    expect(out.summary).toBe("S");
    expect(out.diagnosis).toEqual(["a", "b"]);
    expect(out.actionPlan).toEqual(["x"]); // phần tử "y bị cắt dở ⇒ bỏ
    // KHÔNG dồn nguyên rawText vào summary như fallback cũ:
    expect(out.summary).not.toContain("diagnosis");
  });

  it("3. Khoá lặp lại (actionPlan xuất hiện 2 lần, nội dung khác nhau) ⇒ lấy lần đầu, không nhân đôi", () => {
    // Hai đối tượng JSON dính liền nhau ⇒ KHÔNG phải 1 JSON hợp lệ (JSON.parse
    // ném "Unexpected non-whitespace character after JSON") ⇒ đi vào salvage.
    const rawText =
      `{"summary":"S","actionPlan":["first-1","first-2"]}` +
      `{"actionPlan":["second-1"]}`;

    const out = parseAgentOutput(rawText);

    expect(out.actionPlan).toEqual(["first-1", "first-2"]);
  });

  it("4. Fence ```json giữa dòng rồi bắt đầu đối tượng mới ⇒ vẫn vớt được các khối của đối tượng đầu", () => {
    const rawText =
      `{"summary":"S1","diagnosis":["d1"],"actionPlan":["a1"` +
      "\n```json\n" +
      `{"summary":"S2","diagnosis":["d2"]}`;

    const out = parseAgentOutput(rawText);

    expect(out.summary).toBe("S1");
    expect(out.diagnosis).toEqual(["d1"]);
    expect(out.actionPlan).toEqual(["a1"]);
    // Đối tượng thứ hai (sau fence) không được lẫn vào:
    expect(out.summary).not.toBe("S2");
  });

  it("5. Rác hoàn toàn ⇒ giữ đúng fallback cũ: summary = nguyên văn, các mảng rỗng", () => {
    const rawText = "xin chào, đây không phải JSON";

    const out = parseAgentOutput(rawText);

    expect(out).toEqual({
      summary: "xin chào, đây không phải JSON",
      diagnosis: [],
      actionPlan: [],
      patchHints: [],
      testPlan: [],
      optimizationIdeas: [],
      risks: [],
      reportTemplate: [],
    });
  });
});

describe("salvageAgentSections", () => {
  it("6. chuỗi rỗng / null-ish ⇒ trả {}, không ném", () => {
    expect(salvageAgentSections("")).toEqual({});
    expect(salvageAgentSections(null as unknown as string)).toEqual({});
    expect(salvageAgentSections(undefined as unknown as string)).toEqual({});
  });
});

describe("specialistMaxTokens", () => {
  const KEY = "AI_SPECIALIST_MAX_TOKENS";
  const original = process.env[KEY];

  beforeEach(() => {
    delete process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("7. không set ⇒ 3000; '0' ⇒ 3000; '-5' ⇒ 3000; 'abc' ⇒ 3000; '5000' ⇒ 5000", () => {
    delete process.env[KEY];
    expect(specialistMaxTokens()).toBe(3000);

    process.env[KEY] = "0";
    expect(specialistMaxTokens()).toBe(3000);

    process.env[KEY] = "-5";
    expect(specialistMaxTokens()).toBe(3000);

    process.env[KEY] = "abc";
    expect(specialistMaxTokens()).toBe(3000);

    process.env[KEY] = "5000";
    expect(specialistMaxTokens()).toBe(5000);
  });
});
