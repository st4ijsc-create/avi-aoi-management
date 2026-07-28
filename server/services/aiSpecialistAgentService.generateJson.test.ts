import { describe, it, expect, vi, beforeEach } from "vitest";

// Wave 1 FF-A fix-round 2 — live-verify sau round 1 cho thấy nâng `maxTokens`
// KHÔNG sửa được triệu chứng: model sinh đủ 3000 token nhưng là văn bản THOÁI
// HOÁ (lặp từ/trộn ngôn ngữ), không phải JSON bị cắt — vì `jsonMode` cũ chỉ
// chèn câu chữ vào prompt, không ràng buộc gì thật. Test dưới đây mock
// `generateJSON`/`generateText` — KHÔNG gọi model thật.

const generateJSONMock = vi.fn();
const generateTextMock = vi.fn();
const isGgufAvailableMock = vi.fn(async () => true);

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: (...a: unknown[]) => isGgufAvailableMock(...a),
  generateJSON: (...a: unknown[]) => generateJSONMock(...a),
  generateText: (...a: unknown[]) => generateTextMock(...a),
}));

import { runSpecialistAgent } from "./aiSpecialistAgentService";

const ALL_8_KEYS = [
  "summary",
  "diagnosis",
  "actionPlan",
  "patchHints",
  "testPlan",
  "optimizationIdeas",
  "risks",
  "reportTemplate",
];

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailableMock.mockResolvedValue(true);
});

describe("runSpecialistAgent — generateJSON (grammar-constrained) là đường CHÍNH", () => {
  it("a. gọi generateJSON với schema object có required = đủ 8 khoá; data trả về map đúng vào SpecialistAgentRunResult", async () => {
    generateJSONMock.mockResolvedValue({
      data: {
        summary: "Tóm tắt hợp lệ",
        diagnosis: ["nguyên nhân 1"],
        actionPlan: ["bước 1", "bước 2"],
        patchHints: ["gợi ý vá 1"],
        testPlan: ["test 1"],
        optimizationIdeas: ["ý tưởng 1"],
        risks: ["rủi ro 1"],
        reportTemplate: ["mục 1"],
      },
      raw: '{"summary":"Tóm tắt hợp lệ", "...": "..."}',
      tokensGenerated: 700,
      tokensPrompt: 300,
      totalTimeMs: 2000,
      tokensPerSecond: 3.5,
      modelId: "qwen3-30b-test",
    });

    const result = await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
    });

    // (a1) generateJSON được gọi đúng 1 lần, với schema object có required = đủ 8 khoá.
    expect(generateJSONMock).toHaveBeenCalledTimes(1);
    const [schemaArg, optionsArg, modelIdArg] = generateJSONMock.mock.calls[0]!;
    expect(schemaArg).toMatchObject({ type: "object" });
    expect((schemaArg as { required: string[] }).required.sort()).toEqual([...ALL_8_KEYS].sort());
    // summary phải là string, 7 khoá còn lại phải là array-of-string trong schema.
    const properties = (schemaArg as { properties: Record<string, { type: string; items?: { type: string } }> })
      .properties;
    expect(properties.summary).toEqual({ type: "string" });
    for (const key of ALL_8_KEYS.filter((k) => k !== "summary")) {
      expect(properties[key]).toEqual({ type: "array", items: { type: "string" } });
    }
    expect(optionsArg).toMatchObject({ prompt: expect.any(String) });
    expect(modelIdArg).toBeUndefined(); // input.modelId không set trong test này

    // (a2) `data` map đúng vào output — không gọi qua parseAgentOutput/generateText.
    expect(result.output).toEqual({
      summary: "Tóm tắt hợp lệ",
      diagnosis: ["nguyên nhân 1"],
      actionPlan: ["bước 1", "bước 2"],
      patchHints: ["gợi ý vá 1"],
      testPlan: ["test 1"],
      optimizationIdeas: ["ý tưởng 1"],
      risks: ["rủi ro 1"],
      reportTemplate: ["mục 1"],
    });
    expect(result.modelId).toBe("qwen3-30b-test");
    expect(result.metrics).toEqual({
      tokensGenerated: 700,
      tokensPrompt: 300,
      totalTimeMs: 2000,
      tokensPerSecond: 3.5,
    });
    expect(result.rawText).toBe('{"summary":"Tóm tắt hợp lệ", "...": "..."}');
    expect(generateTextMock).not.toHaveBeenCalled(); // đường chính thành công ⇒ KHÔNG cần lưới dự phòng
  });

  it("b. generateJSON REJECT ⇒ rơi về generateText+parseAgentOutput, vẫn trả kết quả hợp lệ (không ném ra ngoài)", async () => {
    generateJSONMock.mockRejectedValue(new Error("Grammar produced invalid JSON: unexpected token"));
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        summary: "Tóm tắt từ đường lưới dự phòng",
        diagnosis: ["d1"],
        actionPlan: ["a1"],
        patchHints: [],
        testPlan: [],
        optimizationIdeas: [],
        risks: [],
        reportTemplate: [],
      }),
      modelId: "fallback-model",
      tokensGenerated: 500,
      tokensPrompt: 250,
      totalTimeMs: 1500,
      tokensPerSecond: 3,
    });

    const result = await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
    });

    expect(generateJSONMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    // Lưới dự phòng vẫn dùng jsonMode text-suffix (hành vi cũ trước round 2).
    expect(generateTextMock.mock.calls[0]![0]).toMatchObject({ jsonMode: true });

    expect(result.output.summary).toBe("Tóm tắt từ đường lưới dự phòng");
    expect(result.output.diagnosis).toEqual(["d1"]);
    expect(result.output.actionPlan).toEqual(["a1"]);
    expect(result.modelId).toBe("fallback-model");
  });

  it("c. generateJSON reject VÀ generateText trả rác không phải JSON ⇒ vẫn không ném (salvage/fallback của parseAgentOutput vẫn hoạt động phía sau lưới dự phòng)", async () => {
    generateJSONMock.mockRejectedValue(new Error("JSON schema grammar API not available in node-llama-cpp"));
    generateTextMock.mockResolvedValue({
      text: "đây không phải JSON",
      modelId: "fallback-model-2",
      tokensGenerated: 20,
      tokensPrompt: 10,
      totalTimeMs: 100,
      tokensPerSecond: 2,
    });

    const result = await runSpecialistAgent({
      agentId: "backend-engineer",
      objective: "sửa lỗi X trong service",
    });

    expect(result.output).toEqual({
      summary: "đây không phải JSON",
      diagnosis: [],
      actionPlan: [],
      patchHints: [],
      testPlan: [],
      optimizationIdeas: [],
      risks: [],
      reportTemplate: [],
    });
  });

  it("cả generateJSON và generateText đều reject ⇒ runSpecialistAgent VẪN ném (đúng hợp đồng cũ — caller [background runner] mới là nơi bọc try/catch)", async () => {
    generateJSONMock.mockRejectedValue(new Error("grammar unavailable"));
    generateTextMock.mockRejectedValue(new Error("model boom"));

    await expect(
      runSpecialistAgent({ agentId: "backend-engineer", objective: "sửa lỗi X trong service" }),
    ).rejects.toThrow("model boom");
  });
});
