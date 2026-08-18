/**
 * W5-B2 (doc 44 G4.17) — quantitative defect-correlation tests (pure stats).
 *   • pearson / point-biserial on known data,
 *   • Student-t two-tailed p-value (incomplete-beta) against reference values,
 *   • univariate logistic fit direction,
 *   • correlateFactor + rankFactors top-k on known association,
 *   • flag OFF → correlateStationDefect degrades (no DB).
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  pearson,
  pearsonTwoTailedP,
  incompleteBeta,
  logisticFit1D,
  correlateFactor,
  rankFactors,
  correlateStationDefect,
  isRcaQuantitativeEnabled,
  benjaminiHochberg,
  applyMultipleTestingCorrection,
  hasSignificantFactor,
  DEFAULT_ALPHA,
  type FactorCorrelation,
} from "./defectCorrelationService";

const SAVED = process.env.RCA_QUANTITATIVE_ENABLED;
afterEach(() => {
  if (SAVED === undefined) delete process.env.RCA_QUANTITATIVE_ENABLED;
  else process.env.RCA_QUANTITATIVE_ENABLED = SAVED;
});

describe("pearson / point-biserial", () => {
  it("perfect positive / negative correlation", () => {
    const x = [1, 2, 3, 4, 5];
    expect(pearson(x, [1, 2, 3, 4, 5])).toBeCloseTo(1, 6);
    expect(pearson(x, [5, 4, 3, 2, 1])).toBeCloseTo(-1, 6);
  });

  it("point-biserial with a binary outcome", () => {
    // higher x → y=1
    const x = [1.0, 1.1, 1.2, 2.0, 2.1, 2.2];
    const y = [0, 0, 0, 1, 1, 1];
    const r = pearson(x, y);
    expect(r).toBeGreaterThan(0.9);
  });

  it("constant vector → 0 (no correlation defined)", () => {
    expect(pearson([2, 2, 2, 2], [0, 1, 0, 1])).toBe(0);
  });
});

describe("Student-t two-tailed p-value (incomplete-beta)", () => {
  it("incompleteBeta boundary + symmetry", () => {
    expect(incompleteBeta(0, 2, 3)).toBe(0);
    expect(incompleteBeta(1, 2, 3)).toBe(1);
    expect(incompleteBeta(0.5, 3, 3)).toBeCloseTo(0.5, 6); // symmetric a=b
  });

  it("r=0 → p≈1; strong r large-n → tiny p", () => {
    expect(pearsonTwoTailedP(0, 50)).toBeCloseTo(1, 6);
    expect(pearsonTwoTailedP(0.9, 20)).toBeLessThan(0.001);
  });

  it("matches the textbook critical r≈0.361 @ n=30 → p≈0.05", () => {
    const p = pearsonTwoTailedP(0.361, 30);
    expect(p).toBeGreaterThan(0.04);
    expect(p).toBeLessThan(0.06);
  });
});

describe("logistic fit — direction", () => {
  it("higher x → defect ⇒ positive slope", () => {
    const x = [1, 1.2, 1.4, 1.6, 2.4, 2.6, 2.8, 3.0];
    const y = [0, 0, 0, 0, 1, 1, 1, 1];
    const fit = logisticFit1D(x, y);
    expect(fit.slope).toBeGreaterThan(0);
  });

  it("lower x → defect ⇒ negative slope", () => {
    const x = [1, 1.2, 1.4, 1.6, 2.4, 2.6, 2.8, 3.0];
    const y = [1, 1, 1, 1, 0, 0, 0, 0];
    const fit = logisticFit1D(x, y);
    expect(fit.slope).toBeLessThan(0);
  });
});

describe("correlateFactor + rankFactors", () => {
  // 20 units: high torque → defect.
  const torqueOk = [1.5, 1.52, 1.55, 1.5, 1.58, 1.6, 1.53, 1.57, 1.54, 1.51];
  const torqueNg = [2.0, 2.05, 2.1, 2.02, 2.08, 2.11, 2.03, 2.07, 2.04, 2.09];
  const torqueValues = [...torqueOk, ...torqueNg];
  const outcomes = [...Array(10).fill(0), ...Array(10).fill(1)];

  it("detects a significant 'higher→more defects' factor with correct means", () => {
    const c = correlateFactor("screw.torque_nm", torqueValues, outcomes, { minSamples: 12 });
    expect(c).not.toBeNull();
    expect(c!.direction).toBe("higher_more_defects");
    expect(c!.significant).toBe(true);
    expect(c!.pValue).toBeLessThan(0.01);
    expect(c!.pearson).toBeGreaterThan(0.9);
    expect(c!.meanDefect).toBeGreaterThan(c!.meanOk);
    expect(c!.logisticCoef).toBeGreaterThan(0);
    expect(c!.n).toBe(20);
  });

  it("returns null on degenerate inputs (too few / one class / constant)", () => {
    expect(correlateFactor("f", [1, 2, 3], [0, 1, 0], { minSamples: 8 })).toBeNull();
    expect(correlateFactor("f", torqueValues, Array(20).fill(1), { minSamples: 12 })).toBeNull();
    expect(correlateFactor("f", Array(20).fill(2), outcomes, { minSamples: 12 })).toBeNull();
  });

  it("rankFactors puts the significant factor first and honors top-k", () => {
    // noise factor: value uncorrelated with outcome (alternating).
    const noise = torqueValues.map((_, i) => (i % 2 === 0 ? 1.0 : 1.01));
    // weak negative factor: glue slightly lower for defects.
    const glue = outcomes.map((o) => (o === 1 ? 4.9 + Math.random() * 0.05 : 5.0 + Math.random() * 0.05));
    const ranked = rankFactors(
      [
        { factor: "noise", values: noise, outcomes },
        { factor: "screw.torque_nm", values: torqueValues, outcomes },
        { factor: "glue.volume_ml", values: glue, outcomes },
      ],
      { topK: 2, minSamples: 12 },
    );
    expect(ranked.length).toBeLessThanOrEqual(2);
    expect(ranked[0].factor).toBe("screw.torque_nm");
    expect(ranked[0].significant).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// HIỆU CHỈNH ĐA PHÉP THỬ (Benjamini-Hochberg / FDR)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PRNG TẤT ĐỊNH (mulberry32). Bộ ca cũ ở trên dùng `Math.random()` — ca nhiễu kiểu
 * ấy xanh/đỏ theo may rủi và KHÔNG chứng minh được gì về dương-tính-giả. Mọi ca
 * dưới đây phải cho ra CÙNG MỘT con số ở mọi lần chạy, nếu không thì bằng chứng
 * "trước hiệu chỉnh có dương-tính-giả" chỉ là một lời kể.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dựng một lượt phân tích có **NGUYÊN NHÂN THẬT ĐÃ BIẾT** + N yếu tố NHIỄU thuần
 * (sinh độc lập hoàn toàn với nhãn NG ⇒ mọi `significant` trên chúng là dương-tính-giả
 * theo ĐỊNH NGHĨA, không phải theo phán đoán).
 */
function buildFamily(opts: { seed: number; nOk: number; nNg: number; noiseCount: number; effects: number[] }) {
  const { seed, nOk, nNg, noiseCount, effects } = opts;
  const rnd = mulberry32(seed);
  const outcomes = [...Array(nOk).fill(0), ...Array(nNg).fill(1)] as number[];
  const n = nOk + nNg;

  // Nguyên nhân THẬT: trung bình lệch `effect` giữa NG và OK, cùng biên độ nhiễu.
  const causes = effects.map((eff, k) => ({
    factor: k === 0 ? "screw.torque_nm" : `cause${k + 1}`,
    values: outcomes.map((y) => 5 + (y === 1 ? eff : 0) + (rnd() - 0.5)),
    outcomes,
  }));

  // Nhiễu: KHÔNG hề nhìn vào `y`.
  const noise: Array<{ factor: string; values: number[]; outcomes: number[] }> = [];
  for (let k = 0; k < noiseCount; k++) {
    noise.push({ factor: `noise.p${k}`, values: Array.from({ length: n }, () => rnd()), outcomes });
  }
  return { outcomes, inputs: [...causes, ...noise] };
}

describe("benjaminiHochberg — thuần, đối chiếu giá trị tham chiếu", () => {
  it("ví dụ kinh điển Benjamini-Hochberg (1995), m=10", () => {
    const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
    const adj = benjaminiHochberg(p);
    const expected = [0.01, 0.04, 0.084, 0.084, 0.084, 0.1, 0.105714, 0.216, 0.216, 0.216];
    expect(adj).toHaveLength(10);
    adj.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  });

  it("giữ ĐÚNG thứ tự đầu vào (không trả về theo thứ tự đã sắp)", () => {
    const adj = benjaminiHochberg([0.216, 0.001, 0.06]);
    // m=3: p sắp = [0.001, 0.06, 0.216] → 3/1·0.001=0.003 · 3/2·0.06=0.09 · 3/3·0.216=0.216
    expect(adj[0]).toBeCloseTo(0.216, 6);
    expect(adj[1]).toBeCloseTo(0.003, 6);
    expect(adj[2]).toBeCloseTo(0.09, 6);
  });

  it("cưỡng chế ĐƠN ĐIỆU: p thô nhỏ hơn không bao giờ nhận p hiệu chỉnh lớn hơn", () => {
    // p(3)=0.03 cho 5/3·0.03=0.05 nhưng p(4)=0.031 cho 5/4·0.031=0.03875 < 0.05.
    // Thiếu phép min dồn phải→trái thì adj(3)=0.05 > adj(4)=0.03875 — đảo bậy.
    const p = [0.001, 0.02, 0.03, 0.031, 0.9];
    const adj = benjaminiHochberg(p);
    for (let i = 1; i < adj.length; i++) expect(adj[i]).toBeGreaterThanOrEqual(adj[i - 1] - 1e-12);
    expect(adj[2]).toBeCloseTo(0.03875, 6);
  });

  it("m=1 ⇒ không có gì để hiệu chỉnh (đồng nhất); mảng rỗng ⇒ rỗng; kẹp về ≤1", () => {
    expect(benjaminiHochberg([0.037])).toEqual([0.037]);
    expect(benjaminiHochberg([])).toEqual([]);
    expect(benjaminiHochberg([0.5, 0.9]).every((v) => v <= 1)).toBe(true);
  });
});

describe("★ BẰNG CHỨNG: dương-tính-giả bị loại VÀ nguyên nhân thật được giữ", () => {
  // 60 đơn vị (40 OK / 20 NG), 1 nguyên nhân thật + 30 yếu tố nhiễu thuần.
  const FAMILY = buildFamily({ seed: 20260816, nOk: 40, nNg: 20, noiseCount: 30, effects: [0.55] });

  it("TRƯỚC hiệu chỉnh: ngưỡng thô p<0.05 gắn cờ ÍT NHẤT MỘT yếu tố NHIỄU", () => {
    // Đây là ca chứng minh LỖI CÓ THẬT — nếu nó không đỏ dưới luật cũ thì mọi ca
    // "sau hiệu chỉnh sạch" bên dưới không chứng minh được điều gì.
    const rawFlaggedNoise = FAMILY.inputs
      .filter((f) => f.factor.startsWith("noise."))
      .map((f) => correlateFactor(f.factor, f.values, f.outcomes, { minSamples: 12 })!)
      .filter((c) => c.pValue < DEFAULT_ALPHA);
    expect(rawFlaggedNoise.length).toBeGreaterThanOrEqual(1);
    // …và p THÔ của chúng trông rất thuyết phục — đó là lý do lớp lỗi này nguy hiểm.
    expect(Math.min(...rawFlaggedNoise.map((c) => c.pValue))).toBeLessThan(DEFAULT_ALPHA);
  });

  it("SAU hiệu chỉnh: KHÔNG yếu tố nhiễu nào còn `significant`", () => {
    const ranked = rankFactors(FAMILY.inputs, { topK: FAMILY.inputs.length, minSamples: 12 });
    const flaggedNoise = ranked.filter((c) => c.factor.startsWith("noise.") && c.significant);
    expect(flaggedNoise.map((c) => c.factor)).toEqual([]);
  });

  it("SAU hiệu chỉnh: NGUYÊN NHÂN THẬT VẪN ĐƯỢC GIỮ (ca này quan trọng ngang ca trên)", () => {
    const ranked = rankFactors(FAMILY.inputs, { topK: FAMILY.inputs.length, minSamples: 12 });
    const truth = ranked.find((c) => c.factor === "screw.torque_nm")!;
    expect(truth).toBeDefined();
    expect(truth.significant).toBe(true);
    expect(truth.direction).toBe("higher_more_defects");
    expect(truth.pValueAdjusted).toBeLessThan(DEFAULT_ALPHA);
    // …và nó đứng đầu bảng xếp hạng, tức thứ đi vào top-k của RCA.
    expect(ranked[0].factor).toBe("screw.torque_nm");
  });

  it("hiệu chỉnh KHÔNG QUÁ TAY: đúng 1 khám phá — nguyên nhân thật, không hơn không kém", () => {
    const ranked = rankFactors(FAMILY.inputs, { topK: FAMILY.inputs.length, minSamples: 12 });
    expect(ranked.filter((c) => c.significant).map((c) => c.factor)).toEqual(["screw.torque_nm"]);
  });

  it("VÌ SAO KHÔNG PHẢI BONFERRONI: với p NHỎ NHẤT, hai phương pháp ĐỒNG NHẤT (ghim, chống ca giả)", () => {
    // ⚠ Ca này tồn tại vì bản nháp đầu của tôi có một ca "BH mạnh hơn Bonferroni"
    // dựng trên MỘT nguyên nhân thật — và nó ĐỎ, vì `adj(1) = m/1·p(1)` CHÍNH LÀ
    // ngưỡng `p(1) < α/m` của Bonferroni. Ghim đẳng thức ấy lại để không ai (kể cả
    // tôi ở lượt sau) dựng lại một ca giả trên tiền đề sai đó.
    const ranked = rankFactors(FAMILY.inputs, { topK: FAMILY.inputs.length, minSamples: 12 });
    const best = ranked.reduce((a, b) => (a.pValue <= b.pValue ? a : b));
    const m = best.familySize;
    expect(best.pValueAdjusted).toBeCloseTo(Number((m * best.pValue).toExponential(3)), 12);
    // ⇒ "BH giữ / Bonferroni bỏ" trên hạng 1 là điều KHÔNG THỂ xảy ra.
    expect(best.significant).toBe(best.pValue < DEFAULT_ALPHA / m);
  });

  it("★ Bonferroni GIẾT nguyên nhân thật THỨ HAI mà BH GIỮ — cơ sở ĐO ĐƯỢC cho việc chọn FDR", () => {
    // HAI nguyên nhân thật (nhà máy hiếm khi hỏng vì đúng một tham số) + 30 nhiễu.
    const twoCauses = buildFamily({ seed: 99, nOk: 30, nNg: 15, noiseCount: 30, effects: [0.75, 0.28] });
    const ranked = rankFactors(twoCauses.inputs, { topK: twoCauses.inputs.length, minSamples: 12 });
    const c1 = ranked.find((c) => c.factor === "screw.torque_nm")!;
    const c2 = ranked.find((c) => c.factor === "cause2")!;
    const m = c1.familySize;
    const bonferroniThreshold = DEFAULT_ALPHA / m;
    expect(m).toBe(32);

    expect(c1.significant).toBe(true); // hạng 1: cả hai phương pháp đều giữ
    expect(c2.pValue).toBeGreaterThan(bonferroniThreshold); // hạng 2: Bonferroni BỎ SÓT
    expect(c2.pValueAdjusted).toBeLessThan(DEFAULT_ALPHA); // hạng 2: BH GIỮ
    expect(c2.significant).toBe(true);

    // …và BH vẫn không thả một yếu tố nhiễu nào lọt qua, DÙ ngưỡng thô cũ đang gắn cờ 2 cái.
    const noiseRawFalsePositives = ranked.filter((c) => c.factor.startsWith("noise.") && c.pValue < DEFAULT_ALPHA);
    expect(noiseRawFalsePositives.length).toBe(2);
    expect(ranked.filter((c) => c.factor.startsWith("noise.") && c.significant)).toEqual([]);
  });
});

describe("p THÔ vs p ĐÃ HIỆU CHỈNH — phân biệt được trong dữ liệu trả về", () => {
  const FAMILY = buildFamily({ seed: 20260816, nOk: 40, nNg: 20, noiseCount: 30, effects: [0.55] });

  it("mỗi bản ghi mang CẢ HAI con số + hiệu chỉnh bằng gì + trên bao nhiêu phép thử", () => {
    const ranked = rankFactors(FAMILY.inputs, { topK: 5, minSamples: 12 });
    for (const c of ranked) {
      expect(typeof c.pValue).toBe("number");
      expect(typeof c.pValueAdjusted).toBe("number");
      expect(c.correctionMethod).toBe("benjamini_hochberg");
      expect(c.alpha).toBe(DEFAULT_ALPHA);
      // Hiệu chỉnh chỉ có thể LÀM TĂNG p (hoặc giữ nguyên) — không bao giờ giảm.
      expect(c.pValueAdjusted).toBeGreaterThanOrEqual(c.pValue - 1e-12);
    }
    // Ít nhất một yếu tố phải thực sự bị NÂNG p lên, nếu không thì "đã hiệu chỉnh"
    // chỉ là cái nhãn dán lên một phép đồng nhất.
    expect(ranked.some((c) => c.pValueAdjusted > c.pValue)).toBe(true);
  });

  it("★ họ phép thử = MỌI yếu tố ĐÃ THỬ, KHÔNG phải top-k (bất biến chống 'hiệu chỉnh sau khi cắt')", () => {
    const all = rankFactors(FAMILY.inputs, { topK: FAMILY.inputs.length, minSamples: 12 });
    const top3 = rankFactors(FAMILY.inputs, { topK: 3, minSamples: 12 });
    expect(top3).toHaveLength(3);
    expect(all).toHaveLength(31);
    for (const c of top3) expect(c.familySize).toBe(31);
    // p hiệu chỉnh của một yếu tố KHÔNG được đổi vì người gọi xin ít kết quả hơn.
    const byName = new Map(all.map((c) => [c.factor, c]));
    for (const c of top3) expect(c.pValueAdjusted).toBe(byName.get(c.factor)!.pValueAdjusted);
  });

  it("`significant` bám vào p ĐÃ HIỆU CHỈNH, không phải p thô", () => {
    const ranked = rankFactors(FAMILY.inputs, { topK: FAMILY.inputs.length, minSamples: 12 });
    for (const c of ranked) expect(c.significant).toBe(c.pValueAdjusted < c.alpha);
    // Và tồn tại ít nhất một yếu tố mà HAI luật cho HAI kết luận khác nhau — nếu
    // không, ca này xanh qua một cơ chế khác (hai luật trùng nhau trên tập này).
    expect(ranked.some((c) => c.pValue < c.alpha && !c.significant)).toBe(true);
  });

  it("số được BÁO CÁO và quyết định KHÔNG lệch nhau vì làm tròn", () => {
    const ranked = rankFactors(FAMILY.inputs, { topK: FAMILY.inputs.length, minSamples: 12 });
    for (const c of ranked) {
      expect(c.pValueAdjusted).toBe(Number(c.pValueAdjusted.toExponential(3)));
      expect(c.significant).toBe(c.pValueAdjusted < c.alpha);
    }
  });
});

describe("correlateFactor đơn lẻ + applyMultipleTestingCorrection", () => {
  const torqueValues = [1.5, 1.52, 1.55, 1.5, 1.58, 1.6, 1.53, 1.57, 1.54, 1.51, 2.0, 2.05, 2.1, 2.02, 2.08, 2.11, 2.03, 2.07, 2.04, 2.09];
  const outcomes = [...Array(10).fill(0), ...Array(10).fill(1)];

  it("một yếu tố ⇒ familySize=1 và p hiệu chỉnh ĐÚNG BẰNG p thô (không có gì để hiệu chỉnh)", () => {
    const c = correlateFactor("screw.torque_nm", torqueValues, outcomes, { minSamples: 12 })!;
    expect(c.familySize).toBe(1);
    expect(c.pValueAdjusted).toBe(c.pValue);
    expect(c.significant).toBe(true);
  });

  it("hiệu chỉnh lại trên họ đầy đủ đọc p THÔ ⇒ áp hai lần cho cùng kết quả (không cộng dồn)", () => {
    const once = applyMultipleTestingCorrection([
      correlateFactor("a", torqueValues, outcomes, { minSamples: 12 })!,
      correlateFactor("b", torqueValues.slice().reverse(), outcomes, { minSamples: 12 })!,
    ]);
    const twice = applyMultipleTestingCorrection(once);
    expect(twice.map((c) => c.pValueAdjusted)).toEqual(once.map((c) => c.pValueAdjusted));
    expect(twice.map((c) => c.significant)).toEqual(once.map((c) => c.significant));
  });

  it("hasSignificantFactor phản ánh đúng cờ đã hiệu chỉnh", () => {
    const none: FactorCorrelation[] = [];
    expect(hasSignificantFactor(none)).toBe(false);
    const ranked = rankFactors([{ factor: "screw.torque_nm", values: torqueValues, outcomes }], { minSamples: 12 });
    expect(hasSignificantFactor(ranked)).toBe(true);
  });
});

describe("correlateStationDefect — flag gate (no DB)", () => {
  it("defaults OFF → ok:false, RCA_QUANTITATIVE_DISABLED", async () => {
    delete process.env.RCA_QUANTITATIVE_ENABLED;
    expect(isRcaQuantitativeEnabled()).toBe(false);
    const r = await correlateStationDefect({ machineId: 1, defectType: "missing" });
    expect(r.ok).toBe(false);
    expect(r.notes).toContain("RCA_QUANTITATIVE_DISABLED");
    expect(r.factors).toEqual([]);
  });

  it("enabled but no station → INSUFFICIENT_SCOPE_NO_STATION", async () => {
    process.env.RCA_QUANTITATIVE_ENABLED = "true";
    const r = await correlateStationDefect({ defectType: "missing" });
    expect(r.ok).toBe(false);
    expect(r.notes).toContain("INSUFFICIENT_SCOPE_NO_STATION");
  });
});
