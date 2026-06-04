import { describe, it, expect } from 'vitest';
import {
  generateControlChart,
  calculateCapabilityIndices,
  computeSixSigmaMetrics,
  normInv,
  d2Table,
  c4Table,
} from './spc';

const ts = (i: number) => new Date(2026, 0, 1, 0, 0, i);

/** Build n subgroups of size `size` from a flat value array (assumes len divisible). */
function flat(values: number[]) {
  return values.map((v, i) => ({ value: v, inspectionTime: ts(i) }));
}

describe('generateControlChart — X-bar/R', () => {
  // 4 subgroups of n=5, each range = 4 (max-min), so R̄ = 4 → σ̂ = R̄/d2(5)=4/2.326
  const data = flat([
    10, 12, 14, 11, 13,   // mean 12, range 4
    11, 13, 15, 12, 14,   // mean 13, range 4
    9, 11, 13, 10, 12,    // mean 11, range 4
    10, 12, 14, 11, 13,   // mean 12, range 4
  ]);

  it('estimates within-subgroup sigma = R̄/d2', () => {
    const chart = generateControlChart(data, 'xbar_r', 5)!;
    expect(chart).not.toBeNull();
    const expectedSigma = 4 / d2Table[5]; // 4 / 2.326 = 1.71969...
    expect(chart.estimatedSigma).toBeCloseTo(expectedSigma, 3);
    expect(chart.type).toBe('xbar_r');
    expect(chart.primary.label).toBe('xbar');
    expect(chart.secondary.label).toBe('range');
    expect(chart.totalPoints).toBe(4);
  });

  it('centers X-bar chart at grand mean', () => {
    const chart = generateControlChart(data, 'xbar_r', 5)!;
    // grand mean of subgroup means (12,13,11,12) = 12
    expect(chart.centerLine).toBeCloseTo(12, 6);
    // UCL = X̄̄ + A2*R̄ = 12 + 0.577*4 = 14.308
    expect(chart.primary.limits.UCL).toBeCloseTo(12 + 0.577 * 4, 3);
    expect(chart.primary.limits.LCL).toBeCloseTo(12 - 0.577 * 4, 3);
  });
});

describe('generateControlChart — X-bar/S', () => {
  const data = flat([
    10, 12, 14, 11, 13,
    11, 13, 15, 12, 14,
    9, 11, 13, 10, 12,
    10, 12, 14, 11, 13,
  ]);
  it('estimates sigma = S̄/c4', () => {
    const chart = generateControlChart(data, 'xbar_s', 5)!;
    expect(chart.type).toBe('xbar_s');
    expect(chart.secondary.label).toBe('stddev');
    // Each subgroup sample stdDev is the same (same shape). Compute it.
    const s0 = Math.sqrt([10, 12, 14, 11, 13].reduce((a, v) => a + (v - 12) ** 2, 0) / 4);
    const expectedSigma = s0 / c4Table[5];
    expect(chart.estimatedSigma).toBeCloseTo(expectedSigma, 3);
  });
});

describe('generateControlChart — I-MR', () => {
  // values 10,12,14,13,15 → MRs |2|,|2|,|1|,|2| → MR̄ = 1.75 → σ̂ = 1.75/1.128
  const data = flat([10, 12, 14, 13, 15]);
  it('estimates sigma = MR̄/1.128 and centers at mean', () => {
    const chart = generateControlChart(data, 'individual_mr', 5)!;
    expect(chart.type).toBe('individual_mr');
    expect(chart.primary.label).toBe('individual');
    expect(chart.secondary.label).toBe('movingRange');
    const mrBar = (2 + 2 + 1 + 2) / 4; // 1.75
    expect(chart.estimatedSigma).toBeCloseTo(mrBar / 1.128, 3);
    expect(chart.centerLine).toBeCloseTo((10 + 12 + 14 + 13 + 15) / 5, 6); // 12.8
    expect(chart.secondary.points.length).toBe(4); // n-1 moving ranges
  });
});

describe('calculateCapabilityIndices — within-subgroup vs overall', () => {
  // Hand example: values mean=10, USL=16, LSL=4, estimatedSigma(within)=1, overall stdDev computed
  const values = [8, 9, 10, 11, 12, 10, 9, 11, 10, 10];
  it('Cp/Cpk use estimatedSigma; Pp/Ppk use overall stdDev', () => {
    const estimatedSigma = 1; // pretend within-subgroup σ̂ = 1
    const r = calculateCapabilityIndices(values, 16, 4, estimatedSigma);
    // Cp = (USL-LSL)/(6σ̂) = 12/6 = 2.0
    expect(r.cp).toBeCloseTo(2.0, 6);
    // mean = 10 → Cpu=(16-10)/3=2, Cpl=(10-4)/3=2 → Cpk=2
    expect(r.cpk).toBeCloseTo(2.0, 6);
    // Pp uses overall stdDev (≈ sample sd of values), should differ from Cp
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    const overall = Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
    expect(r.overallStdDev).toBeCloseTo(overall, 6);
    expect(r.pp).toBeCloseTo(12 / (6 * overall), 6);
    // Cp (within σ̂=1) must NOT equal Pp (overall ≈1.18) — proves bug fix
    expect(r.cp).not.toBeCloseTo(r.pp!, 2);
  });
});

describe('computeSixSigmaMetrics — DPMO & sigma level', () => {
  it('computes DPMO = defectRate * 1e6', () => {
    const m = computeSixSigmaMetrics(5, 1000); // 0.5% defects
    expect(m.dpmo).toBe(5000);
    expect(m.yieldPercent).toBeCloseTo(99.5, 2);
  });

  it('sigma level uses 1.5σ shift convention', () => {
    // DPMO ≈ 6210 → z(1-0.00621)+1.5 ≈ 2.5+1.5 = 4.0 (classic 4σ table value)
    const m = computeSixSigmaMetrics(6210, 1_000_000);
    expect(m.sigmaLevel).toBeCloseTo(4.0, 1);
  });

  it('normInv is accurate', () => {
    expect(normInv(0.975)).toBeCloseTo(1.959963, 4);
    expect(normInv(0.5)).toBeCloseTo(0, 6);
  });

  it('caps perfect quality at 6 sigma', () => {
    const m = computeSixSigmaMetrics(0, 1000);
    expect(m.dpmo).toBe(0);
    expect(m.sigmaLevel).toBe(6);
    expect(m.yieldPercent).toBe(100);
  });
});
