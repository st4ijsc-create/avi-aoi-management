/**
 * W5-B2 (doc 44 G4.13) — OCR engine tests.
 *   • ctcGreedyDecode: REAL confidence from rec max-probs (NOT string length),
 *     with repeat-collapse + blank-skip.
 *   • levenshtein / similarityRatio / labelMatch: barcode/label pass/fail.
 *   • runOcr / checkLabel: HONEST degrade (OCR_MODEL_NOT_AVAILABLE) when models absent.
 *   • flag OFF bit-compat (isOcrEngineEnabled default false).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  levenshtein,
  similarityRatio,
  labelMatch,
  ctcGreedyDecode,
  runOcr,
  checkLabel,
  isOcrEngineEnabled,
  ocrModelsAvailable,
  _resetOcrCachesForTests,
} from "./ocrService";

const SAVED = { ...process.env };
beforeEach(() => {
  _resetOcrCachesForTests();
});
afterEach(() => {
  for (const k of ["OCR_ENGINE_ENABLED", "OCR_VLM_FALLBACK", "OCR_ONNX_REC_MODEL", "OCR_ONNX_DICT", "OCR_MODEL_DIR"]) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe("levenshtein / similarity", () => {
  it("computes edit distance + normalized similarity", () => {
    expect(levenshtein("ABC123", "ABC123")).toBe(0);
    expect(levenshtein("ABC123", "ABC124")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
    expect(similarityRatio("ABC123", "ABC123")).toBe(1);
    expect(similarityRatio("", "")).toBe(1);
    expect(similarityRatio("ABC123", "ABC124")).toBeCloseTo(1 - 1 / 6, 5);
  });
});

describe("labelMatch (barcode/label pass-fail)", () => {
  it("exact mode: pass only on identical (normalized) code", () => {
    expect(labelMatch("sn-abc-001", "SN-ABC-001", { mode: "exact" }).pass).toBe(true); // normalized upper
    expect(labelMatch("SN-ABC-002", "SN-ABC-001", { mode: "exact" }).pass).toBe(false);
    expect(labelMatch("", "SN-ABC-001", { mode: "exact" }).pass).toBe(false);
  });

  it("levenshtein mode: pass within minSimilarity, fail beyond", () => {
    const near = labelMatch("SN-ABC-0O1", "SN-ABC-001", { mode: "levenshtein", minSimilarity: 0.9 });
    expect(near.pass).toBe(true); // 1 char off in 10 → sim 0.9
    expect(near.similarity).toBeGreaterThanOrEqual(0.9);
    const far = labelMatch("XYZ999", "SN-ABC-001", { mode: "levenshtein", minSimilarity: 0.9 });
    expect(far.pass).toBe(false);
  });
});

describe("ctcGreedyDecode — REAL confidence from rec-score", () => {
  // charset with blankIndex 0: [blank, A, B, C]
  const charset = ["", "A", "B", "C"];

  function frame(probs: [number, number, number, number]): number[] {
    return probs;
  }

  it("decodes 'ABC' and confidence = mean of emitted max-probs (not length)", () => {
    // T=5: A(0.9) blank(0.8) B(0.7) blank(0.85) C(0.95)
    const logits = [
      ...frame([0.1, 0.9, 0.0, 0.0]),
      ...frame([0.8, 0.1, 0.1, 0.0]),
      ...frame([0.2, 0.1, 0.7, 0.0]),
      ...frame([0.85, 0.05, 0.05, 0.05]),
      ...frame([0.05, 0.0, 0.0, 0.95]),
    ];
    const r = ctcGreedyDecode(logits, [1, 5, 4], charset, { blankIndex: 0, layout: "TC" });
    expect(r.text).toBe("ABC");
    // confidence = mean(0.9, 0.7, 0.95) — from scores, NOT string length.
    expect(r.score).toBeCloseTo((0.9 + 0.7 + 0.95) / 3, 4);
  });

  it("collapses repeats and skips blanks", () => {
    // A A blank B  → "AB"
    const logits = [
      ...frame([0.1, 0.9, 0.0, 0.0]),
      ...frame([0.1, 0.8, 0.1, 0.0]),
      ...frame([0.9, 0.05, 0.05, 0.0]),
      ...frame([0.1, 0.0, 0.9, 0.0]),
    ];
    const r = ctcGreedyDecode(logits, [1, 4, 4], charset, { blankIndex: 0 });
    expect(r.text).toBe("AB");
    // emitted at first A (0.9) and B (0.9); repeated A is collapsed (not scored).
    expect(r.score).toBeCloseTo(0.9, 4);
  });

  it("all-blank → empty text, zero score", () => {
    const logits = [...frame([0.99, 0.01, 0, 0]), ...frame([0.99, 0.01, 0, 0])];
    const r = ctcGreedyDecode(logits, [1, 2, 4], charset, { blankIndex: 0 });
    expect(r.text).toBe("");
    expect(r.score).toBe(0);
  });
});

describe("runOcr / checkLabel — honest degrade when model absent", () => {
  beforeEach(() => {
    // Point at a dir with no models so ocrModelsAvailable() is false.
    process.env.OCR_MODEL_DIR = "d:/__nonexistent_ocr_models__";
    delete process.env.OCR_VLM_FALLBACK;
  });

  it("ocrModelsAvailable is false and runOcr degrades to OCR_MODEL_NOT_AVAILABLE", async () => {
    expect(ocrModelsAvailable()).toBe(false);
    const r = await runOcr(Buffer.from("not-an-image"), { language: "en" });
    expect(r.ok).toBe(false);
    expect(r.engine).toBe("none");
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe("OCR_MODEL_NOT_AVAILABLE");
    expect(r.text).toBe("");
    expect(r.confidence).toBe(0); // score-sourced, never fabricated
  });

  it("checkLabel on a degraded read → pass:false, degraded, confidence 0 (NOT length-based)", async () => {
    const r = await checkLabel(Buffer.from("not-an-image"), "SN-ABC-000001-LONG-EXPECTED", {
      mode: "levenshtein",
    });
    expect(r.pass).toBe(false); // degraded read can never pass
    expect(r.degraded).toBe(true);
    expect(r.reason).toBe("OCR_MODEL_NOT_AVAILABLE");
    // A length-based confidence scheme would inflate for a long expected string;
    // the REAL score is 0 because nothing was recognized.
    expect(r.confidence).toBe(0);
  });
});

describe("flag OFF bit-compat", () => {
  it("isOcrEngineEnabled defaults to false", () => {
    delete process.env.OCR_ENGINE_ENABLED;
    expect(isOcrEngineEnabled()).toBe(false);
    process.env.OCR_ENGINE_ENABLED = "true";
    expect(isOcrEngineEnabled()).toBe(true);
    process.env.OCR_ENGINE_ENABLED = "false";
    expect(isOcrEngineEnabled()).toBe(false);
  });
});
