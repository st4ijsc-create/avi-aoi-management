/**
 * W7-E (doc 27 V17) — validation harness tests.
 *
 * • computeGageRR: verified against a HAND-COMPUTED average-and-range fixture
 *   (3 parts × 2 appraisers × 2 trials) — EV/AV/GRR/PV/%GRR/ndc exact.
 * • computeAccuracy: bias/RMS/max on known pairs.
 * • Shape validation errors (parts/appraisers/trials bounds, ragged matrix).
 * • End-to-end synthetic study through the REAL estimators (registerToReference
 *   + computeBoardSpi): sub-pixel registration accuracy, small SPI volume bias,
 *   Gage R&R computed, markdown renders with the synthetic warning label.
 */
import { describe, it, expect } from "vitest";
import {
  buildSyntheticStudy,
  computeAccuracy,
  computeGageRR,
  renderReportMarkdown,
  runValidationStudy,
} from "./validationHarness";

describe("computeGageRR — hand-computed fixture", () => {
  // parts × appraisers × trials; every appraiser-range = 0.2, appraiser B reads +0.1.
  const m = [
    [
      [10.0, 10.2],
      [10.1, 10.3],
    ],
    [
      [12.0, 12.2],
      [12.1, 12.3],
    ],
    [
      [14.0, 14.2],
      [14.1, 14.3],
    ],
  ];

  it("matches the AIAG average-and-range math exactly", () => {
    const g = computeGageRR(m);
    // R̄̄ = 0.2 → EV = 0.2 × 0.8862 = 0.17724
    expect(g.ev).toBeCloseTo(0.17724, 5);
    // X̄diff = 0.1 → (0.1×0.7071)² − EV²/(n·r) = 0.005 − 0.005236 < 0 → AV = 0
    expect(g.av).toBe(0);
    expect(g.grr).toBeCloseTo(0.17724, 5);
    // Rp = 4 → PV = 4 × 0.5231 = 2.0924
    expect(g.pv).toBeCloseTo(2.0924, 4);
    expect(g.tv).toBeCloseTo(Math.hypot(0.17724, 2.0924), 4);
    expect(g.pctGrr).toBeCloseTo((100 * 0.17724) / Math.hypot(0.17724, 2.0924), 2);
    expect(g.verdict).toBe("good"); // ≈8.4% < 10
    expect(g.ndc).toBe(Math.floor((1.41 * 2.0924) / 0.17724)); // 16
    expect(g.method).toBe("average-and-range");
  });

  it("rejects invalid study shapes", () => {
    expect(() => computeGageRR([[[1, 2]]])).toThrow(/≥2 parts/);
    expect(() => computeGageRR([[[1]], [[2]]])).toThrow(/2–5 trials/);
    expect(() => computeGageRR([[[1, 2], [1, 2]], [[1, 2]]])).toThrow(/ragged/);
    expect(() =>
      computeGageRR([
        [[1, 2], [1, 2], [1, 2], [1, 2]],
        [[1, 2], [1, 2], [1, 2], [1, 2]],
      ]),
    ).toThrow(/1–3 appraisers/);
    expect(() => computeGageRR([[[1, NaN]], [[1, 2]]])).toThrow(/non-finite|2–5/);
  });

  it("single appraiser → repeatability-only (AV = 0 by definition)", () => {
    const g = computeGageRR([
      [[5.0, 5.1]],
      [[7.0, 7.1]],
    ]);
    expect(g.appraisers).toBe(1);
    expect(g.av).toBe(0);
    expect(g.ev).toBeGreaterThan(0);
  });
});

describe("computeAccuracy", () => {
  it("bias / RMS / max on known pairs", () => {
    const a = computeAccuracy([
      { measured: 1.1, truth: 1.0 }, // e = +0.1
      { measured: 1.9, truth: 2.0 }, // e = −0.1
      { measured: 3.3, truth: 3.0 }, // e = +0.3
    ]);
    expect(a.n).toBe(3);
    expect(a.bias).toBeCloseTo(0.1, 10);
    expect(a.rms).toBeCloseTo(Math.sqrt((0.01 + 0.01 + 0.09) / 3), 10);
    expect(a.maxAbsError).toBeCloseTo(0.3, 10);
  });

  it("empty input → zeroed stats (no fabricated numbers)", () => {
    expect(computeAccuracy([])).toEqual({ n: 0, bias: 0, rms: 0, maxAbsError: 0 });
  });
});

describe("synthetic study end-to-end (real estimators)", () => {
  it("registration recovers truth sub-pixel; SPI volume bias small; Gage R&R present", async () => {
    const study = buildSyntheticStudy({
      parts: 2,
      appraisers: 2,
      trials: 2,
      imageSize: 96,
      regNoiseSigma: 2,
      spiNoiseSigmaUm: 1,
    });
    expect(study.synthetic).toBe(true);
    const report = await runValidationStudy(study);

    // Registration: sub-pixel recovery despite injected capture noise.
    expect(report.registration).not.toBeNull();
    expect(report.registration!.accuracyDx.maxAbsError).toBeLessThan(1.0);
    expect(report.registration!.accuracyDy.maxAbsError).toBeLessThan(1.0);
    expect(report.registration!.gageRRDx).not.toBeNull();
    for (const c of report.registration!.cases) expect(c.alignedRate).toBe(1);

    // SPI: measured volume within a few % of ground truth.
    expect(report.spi).not.toBeNull();
    expect(report.spi!.gageRRVolume).not.toBeNull();
    for (const c of report.spi!.cases) {
      expect(Math.abs(c.volumeErrorPct ?? 100)).toBeLessThan(5);
      expect(Math.abs(c.meanMeasuredHeight - (c.truthMeanHeight ?? 0))).toBeLessThan(3);
    }

    // Markdown renders + carries the honest synthetic label.
    const md = renderReportMarkdown(report);
    expect(md).toContain("SYNTHETIC corpus");
    expect(md).toContain("%GRR");
  }, 60_000);
});
