/**
 * AI Setup Advisor — verification tests (LUỒNG ① + E.0).
 *
 * Focus on the PURE helpers + the fail-safe / flag-gated public surface:
 *   - scoreCandidate / pickBestTemplate: picks the best template (exact type +
 *     same product + richest points), rejects unrelated types.
 *   - assembleProposedPoint: tags source "data" when enough samples vs "copied"
 *     (with the auto-tune note) when thin.
 *   - assembleBundle: counts, degraded flag, no-template → defaults bundle.
 *   - findSimilarTemplate / buildConfigBundle: flag-OFF → null / disabled no-op;
 *     never throw.
 *
 * No DB is touched: pure helpers take injected templates, and with the flag OFF
 * the public functions short-circuit before any query.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  round2,
  typesRelated,
  scoreCandidate,
  pickBestTemplate,
  assembleProposedPoint,
  assembleBundle,
  setupMinSamples,
  isSetupAdvisorEnabled,
  findSimilarTemplate,
  buildConfigBundle,
  DEFAULT_MODEL,
  type TemplateMachineLite,
  type TemplateData,
  type TemplatePoint,
} from "./aiSetupAdvisor";

function mkMachine(over: Partial<TemplateMachineLite> & { id: number }): TemplateMachineLite {
  return {
    code: `M${over.id}`,
    name: `Machine ${over.id}`,
    machineType: "AOI",
    stationId: 7,
    productModelId: null,
    ...over,
  };
}

describe("pure helpers", () => {
  it("typesRelated: exact + related optical family", () => {
    expect(typesRelated("AOI", "AOI")).toBe(true);
    expect(typesRelated("AOI", "SPI")).toBe(true);
    expect(typesRelated("AOI", "ICT")).toBe(false);
    expect(typesRelated("ICT", "FCT")).toBe(true);
  });

  it("scoreCandidate: exact type beats related, same product adds weight, unrelated = -1", () => {
    const target = { machineType: "AOI", productModelId: 5 };
    const exactSameProduct = scoreCandidate(target, { machineType: "AOI", productModelId: 5, pointCount: 10 });
    const exactOtherProduct = scoreCandidate(target, { machineType: "AOI", productModelId: 9, pointCount: 10 });
    const related = scoreCandidate(target, { machineType: "SPI", productModelId: 5, pointCount: 10 });
    const unrelated = scoreCandidate(target, { machineType: "ICT", productModelId: 5, pointCount: 10 });

    expect(exactSameProduct).toBeGreaterThan(exactOtherProduct);
    expect(exactOtherProduct).toBeGreaterThan(related);
    expect(unrelated).toBe(-1);
  });

  it("scoreCandidate: richer point set scores higher (capped)", () => {
    const target = { machineType: "AOI", productModelId: null };
    const rich = scoreCandidate(target, { machineType: "AOI", productModelId: 1, pointCount: 25 });
    const poor = scoreCandidate(target, { machineType: "AOI", productModelId: 1, pointCount: 2 });
    expect(rich).toBeGreaterThan(poor);
  });

  it("round2 rounds to 2 decimals and coerces junk to 0", () => {
    expect(round2(1.23456)).toBe(1.23);
    expect(round2(NaN)).toBe(0);
  });
});

describe("pickBestTemplate", () => {
  it("picks the exact-type + same-product + richest candidate", () => {
    const target = { machineType: "AOI", productModelId: 5 };
    const candidates = [
      { machine: mkMachine({ id: 1, machineType: "SPI", productModelId: 5 }), pointCount: 30 },
      { machine: mkMachine({ id: 2, machineType: "AOI", productModelId: 9 }), pointCount: 20 },
      { machine: mkMachine({ id: 3, machineType: "AOI", productModelId: 5 }), pointCount: 12 },
    ];
    const best = pickBestTemplate(target, candidates);
    expect(best).not.toBeNull();
    expect(best!.machine.id).toBe(3);
    expect(best!.reason).toContain("cùng model sản phẩm");
  });

  it("returns null when no candidate is type-related", () => {
    const target = { machineType: "AOI", productModelId: 5 };
    const candidates = [
      { machine: mkMachine({ id: 1, machineType: "ICT" }), pointCount: 30 },
      { machine: mkMachine({ id: 2, machineType: "CMM" }), pointCount: 30 },
    ];
    expect(pickBestTemplate(target, candidates)).toBeNull();
  });
});

describe("assembleProposedPoint (E.0 copy vs suggest)", () => {
  const base: TemplatePoint = {
    id: 1, code: "MP1", name: "Width", measurementType: "DIMENSION",
    unit: "mm", lowerLimit: 9, upperLimit: 11, nominalValue: 10,
  };

  it("source=data when enough samples (uses suggestThresholds)", () => {
    const values = Array.from({ length: 300 }, (_, i) => 10 + Math.sin(i) * 0.2);
    const p = assembleProposedPoint({ ...base, sampleValues: values }, 200);
    expect(p.source).toBe("data");
    expect(p.sampleSize).toBe(300);
    expect(typeof p.lsl).toBe("number");
    expect(typeof p.usl).toBe("number");
  });

  it("source=copied with auto-tune note when data is thin", () => {
    const p = assembleProposedPoint({ ...base, sampleValues: [10, 10.1] }, 200);
    expect(p.source).toBe("copied");
    expect(p.lsl).toBe(9);
    expect(p.usl).toBe(11);
    expect(p.target).toBe(10);
    expect(p.note).toContain("tự tinh chỉnh khi đủ dữ liệu");
  });

  it("source=copied when no samples at all", () => {
    const p = assembleProposedPoint(base, 200);
    expect(p.source).toBe("copied");
    expect(p.sampleSize).toBe(0);
  });
});

describe("assembleBundle", () => {
  it("no template → defaults bundle, degraded, default model", () => {
    const b = assembleBundle(null, { minSamples: 200 });
    expect(b.templateMachine).toBeNull();
    expect(b.degraded).toBe(true);
    expect(b.model.code).toBe(DEFAULT_MODEL);
    expect(b.model.source).toBe("default");
    expect(b.notes.join(" ")).toContain("Không tìm thấy máy tương tự");
    expect(b.summary.points).toBe(0);
  });

  it("tags thresholds data vs copied and counts them; station copied from template", () => {
    const richValues = Array.from({ length: 250 }, () => 10 + (Math.random() - 0.5));
    const template: TemplateData = {
      machine: mkMachine({ id: 3, machineType: "AOI", productModelId: 5, stationId: 42 }),
      points: [
        { id: 1, code: "MP1", name: "A", measurementType: "DIMENSION", unit: "mm",
          lowerLimit: 9, upperLimit: 11, nominalValue: 10, sampleValues: richValues },
        { id: 2, code: "MP2", name: "B", measurementType: "DIMENSION", unit: "mm",
          lowerLimit: 1, upperLimit: 2, nominalValue: 1.5, sampleValues: [1.4] },
      ],
      ngThresholds: [
        { warning: 5, critical: 10, minSampleSize: 20, cooldownMinutes: 30 },
      ],
      reason: "test reason",
    };
    const b = assembleBundle(template, { minSamples: 200 });
    expect(b.degraded).toBe(false);
    expect(b.summary.points).toBe(2);
    expect(b.summary.thresholdsFromData).toBe(1);
    expect(b.summary.thresholdsCopied).toBe(1);
    expect(b.summary.ngThresholds).toBe(1);
    expect(b.stationSuggestion.stationId).toBe(42);
    expect(b.stationSuggestion.source).toBe("copied");
    expect(b.ngThresholds[0].source).toBe("copied");
  });

  it("NG threshold orders critical >= warning", () => {
    const template: TemplateData = {
      machine: mkMachine({ id: 1 }),
      points: [],
      ngThresholds: [{ warning: 8, critical: 3, minSampleSize: null, cooldownMinutes: null }],
      reason: "r",
    };
    const b = assembleBundle(template, { minSamples: 200 });
    expect(b.ngThresholds[0].critical).toBeGreaterThanOrEqual(b.ngThresholds[0].warning);
  });
});

describe("flag-gated + fail-safe public surface", () => {
  const prev = process.env.AI_SETUP_ADVISOR_ENABLED;
  beforeEach(() => { delete process.env.AI_SETUP_ADVISOR_ENABLED; });
  afterEach(() => {
    if (prev === undefined) delete process.env.AI_SETUP_ADVISOR_ENABLED;
    else process.env.AI_SETUP_ADVISOR_ENABLED = prev;
  });

  it("isSetupAdvisorEnabled defaults OFF", () => {
    expect(isSetupAdvisorEnabled()).toBe(false);
  });

  it("setupMinSamples defaults to a positive integer", () => {
    expect(setupMinSamples()).toBeGreaterThan(0);
  });

  it("findSimilarTemplate flag-OFF → null (no DB touched)", async () => {
    await expect(findSimilarTemplate({ machineType: "AOI" })).resolves.toBeNull();
  });

  it("buildConfigBundle flag-OFF → disabled defaults bundle, never throws", async () => {
    const b = await buildConfigBundle({ machineType: "AOI" });
    expect(b.disabled).toBe(true);
    expect(b.degraded).toBe(true);
    expect(b.templateMachine).toBeNull();
    expect(b.model.code).toBe(DEFAULT_MODEL);
  });
});
