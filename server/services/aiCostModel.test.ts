/**
 * aiCostModel — PURE cloud-equivalent cost estimator (doc69 Wave E2, task E2-2).
 *
 * No I/O, no DB mocking needed — every test is a plain function-call assertion. Env
 * overrides are set with `vi.stubEnv` (auto-unstubbed in `afterEach`) to prove the
 * resolver reads fresh on every call rather than caching an import-time snapshot.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_CLASS_PRICES,
  DEFAULT_MODEL_CLASS,
  LOCAL_MARGINAL_USD_PER_1K,
  classifyModel,
  getCloudPriceForClass,
  resolveCloudPrice,
  estimateCloudEquivalentUsd,
  estimateLocalCostUsd,
  estimateSavingsUsd,
} from "./aiCostModel";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("classifyModel", () => {
  it("buckets a small (<=4B) model", () => {
    expect(classifyModel("Qwen3-4B-Instruct-Q4_K_M.gguf")).toBe("small");
    expect(classifyModel("phi-3.8b-mini.gguf")).toBe("small");
  });

  it("buckets a medium (5-20B) model", () => {
    expect(classifyModel("Qwen3-14B-Instruct.gguf")).toBe("medium");
  });

  it("buckets a large (>20B) model", () => {
    expect(classifyModel("Llama-70B-Instruct.gguf")).toBe("large");
  });

  it("falls back to DEFAULT_MODEL_CLASS for the literal gateway default", () => {
    expect(classifyModel("default")).toBe(DEFAULT_MODEL_CLASS);
  });

  it("falls back to DEFAULT_MODEL_CLASS for an unparsable/unknown name", () => {
    expect(classifyModel("totally-unknown-model-xyz")).toBe(DEFAULT_MODEL_CLASS);
  });

  it("falls back to DEFAULT_MODEL_CLASS for null/undefined", () => {
    expect(classifyModel(null)).toBe(DEFAULT_MODEL_CLASS);
    expect(classifyModel(undefined)).toBe(DEFAULT_MODEL_CLASS);
  });
});

describe("getCloudPriceForClass / resolveCloudPrice — built-in defaults", () => {
  it("returns the built-in default price row when no env override is set", () => {
    expect(getCloudPriceForClass("medium")).toEqual(DEFAULT_CLASS_PRICES.medium);
  });

  it("resolveCloudPrice tags the resolved class alongside the price row", () => {
    expect(resolveCloudPrice("Llama-70B-Instruct.gguf")).toEqual({
      ...DEFAULT_CLASS_PRICES.large,
      modelClass: "large",
    });
  });
});

describe("estimateCloudEquivalentUsd — known tokens x known price = exact USD", () => {
  it("1000 in + 1000 out at the medium default price → exact USD", () => {
    // medium defaults: in 0.003 / 1k, out 0.015 / 1k
    const usd = estimateCloudEquivalentUsd(1000, 1000, "default");
    expect(usd).toBeCloseTo(0.003 + 0.015, 10);
  });

  it("an unknown model falls back to the default class price (medium)", () => {
    const known = estimateCloudEquivalentUsd(2000, 500, "default");
    const unknown = estimateCloudEquivalentUsd(2000, 500, "some-brand-new-model-nobody-registered");
    expect(unknown).toBeCloseTo(known, 10);
  });

  it("zero tokens → 0", () => {
    expect(estimateCloudEquivalentUsd(0, 0, "default")).toBe(0);
  });

  it("negative/garbage token counts are clamped to 0, never negative or NaN", () => {
    expect(estimateCloudEquivalentUsd(-100, Number.NaN, "default")).toBe(0);
  });

  it("prices a small model at its own (cheaper) class rate", () => {
    const small = estimateCloudEquivalentUsd(1000, 1000, "Qwen3-4B-Instruct.gguf");
    const large = estimateCloudEquivalentUsd(1000, 1000, "Llama-70B-Instruct.gguf");
    expect(small).toBeLessThan(large);
    expect(small).toBeCloseTo(DEFAULT_CLASS_PRICES.small.inputPricePer1kUsd + DEFAULT_CLASS_PRICES.small.outputPricePer1kUsd, 10);
  });
});

describe("price-table env override — read fresh, documented precedence", () => {
  it("AI_CLOUD_PRICE_MEDIUM_IN_PER_1K / _OUT_PER_1K change the medium-class estimate", () => {
    vi.stubEnv("AI_CLOUD_PRICE_MEDIUM_IN_PER_1K", "0.01");
    vi.stubEnv("AI_CLOUD_PRICE_MEDIUM_OUT_PER_1K", "0.02");

    const usd = estimateCloudEquivalentUsd(1000, 1000, "default");
    expect(usd).toBeCloseTo(0.01 + 0.02, 10);
  });

  it("an invalid env value (non-numeric) falls back to the built-in default, not NaN", () => {
    vi.stubEnv("AI_CLOUD_PRICE_SMALL_IN_PER_1K", "not-a-number");
    const price = getCloudPriceForClass("small");
    expect(price.inputPricePer1kUsd).toBe(DEFAULT_CLASS_PRICES.small.inputPricePer1kUsd);
  });

  it("a negative env value falls back to the built-in default", () => {
    vi.stubEnv("AI_CLOUD_PRICE_LARGE_OUT_PER_1K", "-5");
    const price = getCloudPriceForClass("large");
    expect(price.outputPricePer1kUsd).toBe(DEFAULT_CLASS_PRICES.large.outputPricePer1kUsd);
  });

  it("env is re-read on every call (no import-time caching)", () => {
    const before = getCloudPriceForClass("large").inputPricePer1kUsd;
    vi.stubEnv("AI_CLOUD_PRICE_LARGE_IN_PER_1K", "0.5");
    const after = getCloudPriceForClass("large").inputPricePer1kUsd;
    expect(after).not.toBe(before);
    expect(after).toBe(0.5);
  });
});

describe("$0-local-marginal-cost assumption — explicit + tunable", () => {
  it("LOCAL_MARGINAL_USD_PER_1K is 0 today", () => {
    expect(LOCAL_MARGINAL_USD_PER_1K).toBe(0);
  });

  it("estimateLocalCostUsd is 0 for any token count while the constant is 0", () => {
    expect(estimateLocalCostUsd(1000, 1000)).toBe(0);
  });

  it("estimateSavingsUsd equals estimateCloudEquivalentUsd while local cost is 0", () => {
    const cloud = estimateCloudEquivalentUsd(1234, 567, "Qwen3-14B-Instruct.gguf");
    const savings = estimateSavingsUsd(1234, 567, "Qwen3-14B-Instruct.gguf");
    expect(savings).toBeCloseTo(cloud, 10);
  });
});
