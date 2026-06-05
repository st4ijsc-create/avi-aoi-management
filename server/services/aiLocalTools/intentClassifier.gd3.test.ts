/**
 * GĐ3a — LLM single-tool routing now includes WRITE + CLIENT tools.
 * generateJSON (bundled GGUF) is mocked so we can assert the picked tool + args
 * survive zod validation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// LLM_FALLBACK_ENABLED is read at module-load → set BEFORE importing the SUT.
process.env.AI_TOOL_LLM_FALLBACK = "1";
process.env.USE_LEGACY_OLLAMA = "false";

const generateJSON = vi.fn();
const isGgufAvailable = vi.fn(async () => true);
vi.mock("../aiGgufEngine", () => ({
  generateJSON: (...a: unknown[]) => generateJSON(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
}));

import "./handlers";
import "./writeHandlers";
import { classifyToolIntentLLM } from "./intentClassifier";

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
});

describe("LLM routing — write tool selection", () => {
  it("routes 'đóng cảnh báo dự đoán' to resolve_predictive_alert with args", async () => {
    generateJSON.mockResolvedValue({ data: { tool: "resolve_predictive_alert", args: { predictiveAlertId: 7, resolutionNotes: "đã xử lý" } } });
    const d = await classifyToolIntentLLM("đóng cảnh báo dự đoán số 7, đã xử lý xong");
    expect(d.tool).toBe("resolve_predictive_alert");
    expect((d.args as any).predictiveAlertId).toBe(7);
  });

  it("rejects write tool args that fail zod (missing resolutionNotes)", async () => {
    generateJSON.mockResolvedValue({ data: { tool: "resolve_predictive_alert", args: { predictiveAlertId: 7 } } });
    const d = await classifyToolIntentLLM("đóng cảnh báo dự đoán 7");
    expect(d.tool).toBeNull();
    expect(d.reason).toMatch(/LLM_INVALID_ARGS/);
  });

  it("routes a navigation request to the navigate client tool", async () => {
    generateJSON.mockResolvedValue({ data: { tool: "navigate", args: { route: "/predictive-alerts" } } });
    const d = await classifyToolIntentLLM("mở trang cảnh báo dự đoán");
    expect(d.tool).toBe("navigate");
    expect((d.args as any).route).toBe("/predictive-alerts");
  });

  it("routes set_yield_threshold with scope+value", async () => {
    generateJSON.mockResolvedValue({ data: { tool: "set_yield_threshold", args: { scope: "FPY", field: "warning", value: 96 } } });
    const d = await classifyToolIntentLLM("đặt ngưỡng cảnh báo FPY = 96");
    expect(d.tool).toBe("set_yield_threshold");
    expect((d.args as any).value).toBe(96);
  });
});
