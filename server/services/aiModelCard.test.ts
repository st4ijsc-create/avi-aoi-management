/**
 * B5.4 — Model-card generation/governance tests.
 *
 * Mocks ../db/ai so the card logic is testable offline:
 *   - PORTFOLIO_CARDS covers the current Qwen3 portfolio (5 seed models).
 *   - buildCardForModel fills sane governance defaults from an ai_models row.
 *   - generateModelCard persists the card into ai_models.metadata.modelCard.
 *   - listModelCards merges portfolio seeds + registered rows, de-duped by code,
 *     preferring a persisted metadata.modelCard when present.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getAiModels = vi.fn();
const getAiModelById = vi.fn();
const updateAiModel = vi.fn();

vi.mock("../db/ai", () => ({
  getAiModels: (...a: any[]) => getAiModels(...a),
  getAiModelById: (...a: any[]) => getAiModelById(...a),
  updateAiModel: (...a: any[]) => updateAiModel(...a),
}));

import {
  PORTFOLIO_CARDS,
  buildCardForModel,
  generateModelCard,
  listModelCards,
  seedPortfolioCards,
} from "./aiModelCard";

beforeEach(() => {
  vi.clearAllMocks();
  getAiModels.mockResolvedValue([]);
  getAiModelById.mockResolvedValue(null);
  updateAiModel.mockResolvedValue({});
});

describe("PORTFOLIO_CARDS (Qwen3 seed catalog)", () => {
  it("covers the 5 current portfolio models with required fields", () => {
    const codes = PORTFOLIO_CARDS.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining([
      "qwen3-30b-a3b-instruct",
      "qwen3-4b-instruct",
      "qwen3-vl-8b-instruct",
      "qwen3-embedding-0.6b",
      "dinov2-small",
    ]));
    for (const c of PORTFOLIO_CARDS) {
      expect(c.role).toBeTruthy();
      expect(c.source).toBeTruthy();
      expect(c.intendedUse.length).toBeGreaterThan(0);
      expect(Array.isArray(c.limitations)).toBe(true);
      expect(c.limitations.length).toBeGreaterThan(0);
    }
  });
});

describe("buildCardForModel", () => {
  it("derives role/quant/intendedUse from an ai_models row", () => {
    const card = buildCardForModel({
      id: 9, code: "aoi-classifier", name: "AOI Classifier",
      modelType: "classification", format: "ONNX", currentVersion: "1.2",
      labels: ["OK", "NG_scratch"], accuracy: "97.50", metadata: null,
    });
    expect(card.code).toBe("aoi-classifier");
    expect(card.quant).toBe("ONNX");
    expect(card.generatedBy).toBe("auto");
    expect(card.evalSummary).toContain("97.50");
    expect(card.limitations.length).toBeGreaterThan(0);
  });

  it("prefers an existing persisted card's intendedUse/role", () => {
    const card = buildCardForModel({
      id: 9, code: "aoi-classifier", name: "AOI Classifier",
      modelType: "classification", format: "ONNX",
      metadata: { modelCard: { role: "vision", intendedUse: "custom use" } },
    });
    expect(card.role).toBe("vision");
    expect(card.intendedUse).toBe("custom use");
  });
});

describe("generateModelCard", () => {
  it("persists the card into metadata.modelCard", async () => {
    getAiModelById.mockResolvedValue({
      id: 9, code: "aoi-classifier", name: "AOI Classifier",
      modelType: "classification", format: "ONNX", metadata: { foo: "bar" },
    });
    const card = await generateModelCard(9);
    expect(card).not.toBeNull();
    expect(updateAiModel).toHaveBeenCalledTimes(1);
    const [id, patch] = updateAiModel.mock.calls[0];
    expect(id).toBe(9);
    expect(patch.metadata.foo).toBe("bar"); // preserves existing metadata
    expect(patch.metadata.modelCard.code).toBe("aoi-classifier");
  });

  it("returns null for a missing model", async () => {
    getAiModelById.mockResolvedValue(null);
    expect(await generateModelCard(404)).toBeNull();
  });
});

describe("listModelCards", () => {
  it("returns portfolio seeds when no models are registered", async () => {
    const cards = await listModelCards();
    expect(cards.length).toBe(PORTFOLIO_CARDS.length);
  });

  it("merges a registered row's persisted card (de-duped by code)", async () => {
    getAiModels.mockResolvedValue([
      { id: 9, code: "aoi-classifier", name: "AOI Classifier", modelType: "classification", format: "ONNX",
        metadata: { modelCard: { code: "aoi-classifier", name: "AOI Classifier", role: "image-vector",
          source: "x", quant: "ONNX", contextSize: null, intendedUse: "u", limitations: ["l"],
          evalSummary: "e", lastUpdated: "2026-06-27T00:00:00Z", generatedBy: "auto" } } },
    ]);
    const cards = await listModelCards();
    expect(cards.length).toBe(PORTFOLIO_CARDS.length + 1);
    expect(cards.find((c) => c.code === "aoi-classifier")?.evalSummary).toBe("e");
  });
});

describe("seedPortfolioCards", () => {
  it("persists into a matching ai_models row by code", async () => {
    getAiModels.mockResolvedValue([
      { id: 3, code: "dinov2-small", name: "DINOv2", modelType: "embedding", format: "ONNX", metadata: null },
    ]);
    const cards = await seedPortfolioCards();
    expect(cards.length).toBe(PORTFOLIO_CARDS.length);
    expect(updateAiModel).toHaveBeenCalledTimes(1);
    const [id, patch] = updateAiModel.mock.calls[0];
    expect(id).toBe(3);
    expect(patch.metadata.modelCard.code).toBe("dinov2-small");
  });
});
