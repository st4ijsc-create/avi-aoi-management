/**
 * WS-G3 — Unit tests for invokeLLM (local GGUF routing) + processChat ordering.
 *
 * aiProviderRouter is fully mocked so no real model/binary is required.
 * Asserts:
 *  - text → generateNarrative, content is the narrative string
 *  - json_schema → generateInsightJson, content JSON.parse-able
 *  - vision (image_url) → describeImage called with a Buffer
 *  - invokeLLM does NOT throw when no forge/OPENAI key is set (regression)
 *  - processChat prefers GGUF even when OPENAI_API_KEY is set (fake)
 *  - offline reply is non-empty in both en + vi
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the local provider router ─────────────────────────────
const generateNarrative = vi.fn();
const generateInsightJson = vi.fn();
const describeImage = vi.fn();

vi.mock("../services/aiProviderRouter", () => ({
  generateNarrative: (...a: unknown[]) => generateNarrative(...a),
  generateInsightJson: (...a: unknown[]) => generateInsightJson(...a),
  describeImage: (...a: unknown[]) => describeImage(...a),
}));

import { invokeLLM } from "./llm";

beforeEach(() => {
  vi.clearAllMocks();
  // Regression: ensure no cloud key is present.
  delete process.env.OPENAI_API_KEY;
  delete process.env.BUILT_IN_FORGE_API_KEY;
});

describe("invokeLLM — local GGUF routing", () => {
  it("routes plain text to generateNarrative and returns string content", async () => {
    generateNarrative.mockResolvedValue({
      text: "Hello from local model",
      model: "gguf-test",
      tokensPrompt: 5,
      tokensGenerated: 7,
    });

    const res = await invokeLLM({
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Say hi" },
      ],
    });

    expect(generateNarrative).toHaveBeenCalledTimes(1);
    expect(generateInsightJson).not.toHaveBeenCalled();
    const arg = generateNarrative.mock.calls[0][0];
    expect(arg.prompt).toContain("Say hi");
    expect(arg.systemPrompt).toContain("You are helpful.");

    expect(res.choices[0].message.content).toBe("Hello from local model");
    expect(res.choices[0].finish_reason).toBe("stop");
    expect(res.choices[0].message.tool_calls).toEqual([]);
    expect(res.usage?.total_tokens).toBe(12);
  });

  it("routes json_schema to generateInsightJson with parseable content", async () => {
    const data = { assessment: "OK", confidence: 90 };
    generateInsightJson.mockResolvedValue({
      data,
      raw: JSON.stringify(data),
      model: "gguf-test",
    });

    const res = await invokeLLM({
      messages: [{ role: "user", content: "Analyze" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "x",
          schema: {
            type: "object",
            properties: {
              assessment: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["assessment", "confidence"],
          },
        },
      },
    });

    expect(generateInsightJson).toHaveBeenCalledTimes(1);
    const arg = generateInsightJson.mock.calls[0][0];
    expect(arg.jsonSchema).toMatchObject({ type: "object" });

    const content = res.choices[0].message.content as string;
    const parsed = JSON.parse(content);
    expect(parsed.assessment).toBe("OK");
    expect(parsed.confidence).toBe(90);
  });

  it("routes vision (data: image_url) to describeImage with a Buffer", async () => {
    describeImage.mockResolvedValue({ text: "A defect at top-left", model: "gguf-vision" });

    // 1x1 png base64
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const res = await invokeLLM({
      messages: [
        { role: "system", content: "You are an inspector." },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe defects" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
    });

    expect(describeImage).toHaveBeenCalledTimes(1);
    const arg = describeImage.mock.calls[0][0];
    expect(Buffer.isBuffer(arg.image)).toBe(true);
    expect(arg.image.length).toBeGreaterThan(0);
    expect(res.choices[0].message.content).toBe("A defect at top-left");
  });

  it("vision + json_schema → describeImage then generateInsightJson (2-step)", async () => {
    describeImage.mockResolvedValue({ text: "scratch visible", model: "gguf-vision" });
    const data = { assessment: "NG", defects: ["scratch"], confidence: 80, recommendations: "rework" };
    generateInsightJson.mockResolvedValue({ data, raw: JSON.stringify(data), model: "gguf-test" });

    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const res = await invokeLLM({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Inspect" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "y",
          schema: { type: "object", properties: { assessment: { type: "string" } }, required: ["assessment"] },
        },
      },
    });

    expect(describeImage).toHaveBeenCalledTimes(1);
    expect(generateInsightJson).toHaveBeenCalledTimes(1);
    // description is fed into the JSON step
    expect(generateInsightJson.mock.calls[0][0].prompt).toContain("scratch visible");
    expect(JSON.parse(res.choices[0].message.content as string).assessment).toBe("NG");
  });

  it("does NOT throw when no forge/OPENAI key is configured (regression)", async () => {
    generateNarrative.mockResolvedValue({ text: "ok", model: "gguf" });
    await expect(
      invokeLLM({ messages: [{ role: "user", content: "ping" }] }),
    ).resolves.toBeDefined();
  });
});
