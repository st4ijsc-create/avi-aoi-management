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

  // Fix-round 1 — CRITICAL-1: sanitizeJsonBlock trước đây cắt VÔ ĐIỀU KIỆN tại
  // fence ``` kế tiếp bất kỳ ở đâu, kể cả một fence HỢP LỆ nằm trong giá trị
  // chuỗi của patchHints (chuyện thường gặp với backend-engineer minh hoạ patch
  // bằng code block). Probe: JSON.stringify() hợp lệ, đủ 8 khoá, patchHints
  // chứa 1 đoạn ```ts...``` — phải đi thẳng qua nhánh JSON.parse chặt chẽ,
  // KHÔNG bị cắt cụt, mọi khoá phải còn nguyên (không được rơi vào "No content").
  it("a. JSON hợp lệ đủ 8 khoá, patchHints chứa fence ``` hợp lệ ⇒ cả 8 khoá vẫn phân tích đúng qua đường JSON.parse chặt chẽ", () => {
    const rawText = JSON.stringify({
      summary: "Tóm tắt",
      diagnosis: ["d1"],
      actionPlan: ["a1"],
      patchHints: ["Wrap the fix like this: ```ts\nconst x=1;\n``` for clarity"],
      testPlan: ["t1"],
      optimizationIdeas: ["o1"],
      risks: ["r1"],
      reportTemplate: ["rt1"],
    });

    const out = parseAgentOutput(rawText);

    expect(out).toEqual({
      summary: "Tóm tắt",
      diagnosis: ["d1"],
      actionPlan: ["a1"],
      patchHints: ["Wrap the fix like this: ```ts\nconst x=1;\n``` for clarity"],
      testPlan: ["t1"],
      optimizationIdeas: ["o1"],
      risks: ["r1"],
      reportTemplate: ["rt1"],
    });
  });

  // Fix-round 1 — CRITICAL-2 (Probe B): tìm khoá bằng regex.exec() thất bại vì
  // khớp cả vị trí văn bản NẰM TRONG giá trị chuỗi của khoá khác. `summary`
  // chứa nguyên văn `"risks": [...]` như một phần lời văn (dấu " không escape
  // ⇒ đây chính là lý do JSON tổng thể KHÔNG hợp lệ ⇒ rơi vào salvage). Bug cũ:
  // risks trả về mảnh giả "FAKE-RISK-FROM-SUMMARY" lấy từ trong summary, còn
  // mảng risks THẬT ở cuối bị bỏ qua. Phải lấy đúng mảng THẬT, không bao giờ
  // hiển thị mảnh vỡ từ summary dưới mục Risks.
  it("b. khoá giả nằm trong chuỗi summary (dấu ngoặc kép không escape) ⇒ risks/diagnosis lấy đúng mảng THẬT, không lấy mảnh vỡ từ summary", () => {
    const rawText =
      `{"summary": "risk note: "risks": ["FAKE-RISK-FROM-SUMMARY"] should be reviewed", ` +
      `"diagnosis": ["real-diagnosis-1"], "risks": ["real-risk-1", "real-risk-2"]}`;

    // Bằng chứng đây đúng là input hỏng (mới đi vào salvage, không phải qua
    // đường JSON.parse chặt chẽ bình thường):
    expect(() => JSON.parse(rawText)).toThrow();

    const out = parseAgentOutput(rawText);

    expect(out.risks).toEqual(["real-risk-1", "real-risk-2"]);
    expect(out.risks).not.toContain("FAKE-RISK-FROM-SUMMARY");
    expect(out.diagnosis).toEqual(["real-diagnosis-1"]);
  });

  // Fix-round 1 — CRITICAL-2 (Probe A): summary chứa `\"actionPlan\": []` được
  // ESCAPE ĐÚNG (bản thân summary là 1 chuỗi JSON hợp lệ) — bug cũ vẫn latch
  // vào khoá giả này vì regex.exec() không quan tâm escape, khớp thẳng lên
  // "actionPlan" nằm giữa 2 dấu `\"`. actionPlan THẬT ở sau bị mất (đọc được [],
  // rỗng ⇒ bị coi là "không vớt được gì"). JSON tổng thể hỏng vì diagnosis bị
  // cắt cụt ở cuối (không có dấu đóng) — đó là lý do đi vào salvage.
  it("c. khoá giả trong summary được escape đúng (\\\"actionPlan\\\": []) ⇒ actionPlan lấy đúng mảng THẬT phía sau, không lấy mảng rỗng nhúng trong summary", () => {
    const rawText =
      `{"summary": "Earlier the code returned \\"actionPlan\\": [] here, now fixed with real steps", ` +
      `"actionPlan": ["real-step-1", "real-step-2", "real-step-3"], "diagnosis": ["cut-off-here`;

    expect(() => JSON.parse(rawText)).toThrow();

    const out = parseAgentOutput(rawText);

    expect(out.actionPlan).toEqual(["real-step-1", "real-step-2", "real-step-3"]);
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
