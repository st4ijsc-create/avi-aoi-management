/**
 * ★★★ HIỆU CHỈNH ĐA PHÉP THỬ — MẶT **RCA COPILOT** (hai điểm quyết định).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ FILE NÀY — MỘT ĐỘT BIẾN SỐNG SINH RA NÓ
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Đột biến M5 (`hasMeaningfulEvidence`: đổi `.some(c => c.significant)` trở lại thành
 * `.length > 0`, tức cho một tương quan NHIỄU khởi động cả một lượt tổng hợp giả
 * thuyết) **SỐNG SÓT** qua toàn bộ bộ ca hiện có. Lý do cơ học: đường duy nhất chạm
 * tới hai hàm này là `runRca`, mà `runRca` nạp một model GGUF 7B THẬT — ca duy nhất
 * gọi nó hết giờ ở 5 s trước khi tới nơi. Tức **hai điểm quyết định vừa bị sửa không
 * có lưới nào canh**, và bộ ca xanh không nói gì về chúng.
 *
 * Hai thứ được ghim ở đây:
 *   §1 — `buildEvidenceDigest` nói gì với model: p THÔ và p ĐÃ HIỆU CHỈNH phải phân
 *        biệt được, nhãn SIGNIFICANT chỉ theo p đã hiệu chỉnh, và khi KHÔNG cái nào
 *        sống sót thì phải có câu TỪ CHỐI TRUNG THỰC nói thẳng điều đó.
 *   §2 — `hasMeaningfulEvidence`: nhiễu KHÔNG phải bằng chứng.
 */
import { describe, it, expect } from "vitest";
import { buildEvidenceDigest, hasMeaningfulEvidence, type EvidenceBundle } from "./aiRcaCopilot";
import type { FactorCorrelation } from "./ai/defectCorrelationService";

function yeuTo(over: Partial<FactorCorrelation> = {}): FactorCorrelation {
  return {
    factor: "reflow.peakTempC",
    n: 40,
    pearson: 0.62,
    pValue: 0.004,
    pValueAdjusted: 0.012,
    correctionMethod: "benjamini_hochberg",
    familySize: 30,
    alpha: 0.05,
    logisticCoef: 0.11,
    direction: "higher_more_defects",
    significant: true,
    meanDefect: 251,
    meanOk: 244,
    ...over,
  };
}

function bundle(over: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    paretoTop: [],
    spc: null,
    anomaly: null,
    visionDescription: null,
    recentConfigChanges: [],
    similarIncidents: [],
    recentCorrections: [],
    causalText: "",
    quantitativeCorrelations: [],
    notes: [],
    ...over,
  };
}

describe("§1 — buildEvidenceDigest: p thô vs p hiệu chỉnh, nói rõ với model", () => {
  it("in CẢ HAI con số + cỡ họ phép thử + phương pháp", () => {
    const s = buildEvidenceDigest(bundle({ quantitativeCorrelations: [yeuTo()] }));
    expect(s).toContain("p_raw=0.004");
    expect(s).toContain("p_adj=0.012");
    expect(s).toContain("30 factor(s) tested");
    expect(s).toContain("benjamini_hochberg");
  });

  it("nhãn SIGNIFICANT chỉ gắn theo p ĐÃ HIỆU CHỈNH", () => {
    const s = buildEvidenceDigest(bundle({ quantitativeCorrelations: [yeuTo()] }));
    expect(s).toContain("SIGNIFICANT after correction");
  });

  it("★ yếu tố có p THÔ đẹp nhưng KHÔNG sống sót ⇒ ghi rõ NOT significant", () => {
    // p thô 0.004 trông rất thuyết phục; trên họ 30 phép thử thì BH cho 0.12.
    const s = buildEvidenceDigest(
      bundle({ quantitativeCorrelations: [yeuTo({ pValueAdjusted: 0.12, significant: false })] }),
    );
    expect(s).toContain("NOT significant after correction");
    expect(s).not.toContain(", SIGNIFICANT after correction");
  });

  it("★★ KHÔNG yếu tố nào sống sót ⇒ có câu TỪ CHỐI TRUNG THỰC, cấm model kể thành nguyên nhân", () => {
    const s = buildEvidenceDigest(
      bundle({ quantitativeCorrelations: [yeuTo({ pValueAdjusted: 0.12, significant: false })] }),
    );
    expect(s).toContain("NO upstream parameter reached significance");
    expect(s).toContain("UNCORRECTED");
    expect(s).toMatch(/Do NOT present any of these parameters as an established cause/i);
  });

  it("có ít nhất một yếu tố sống sót ⇒ KHÔNG dán câu từ chối (chống vá quá tay)", () => {
    const s = buildEvidenceDigest(
      bundle({ quantitativeCorrelations: [yeuTo({ significant: true }), yeuTo({ factor: "x", significant: false, pValueAdjusted: 0.4 })] }),
    );
    expect(s).not.toContain("NO upstream parameter reached significance");
  });
});

describe("§2 — hasMeaningfulEvidence: NHIỄU không phải bằng chứng", () => {
  it("★ tương quan KHÔNG sống sót hiệu chỉnh, không có bằng chứng khác ⇒ KHÔNG đủ để tổng hợp", () => {
    const ev = bundle({ quantitativeCorrelations: [yeuTo({ pValueAdjusted: 0.42, significant: false })] });
    expect(hasMeaningfulEvidence(ev)).toBe(false);
  });

  it("★ tương quan CÓ sống sót ⇒ đủ (chống vá quá tay: không giết luôn tín hiệu thật)", () => {
    const ev = bundle({ quantitativeCorrelations: [yeuTo({ significant: true })] });
    expect(hasMeaningfulEvidence(ev)).toBe(true);
  });

  it("loại bằng chứng QUAN SÁT ĐƯỢC vẫn đủ, độc lập với tương quan", () => {
    // Pareto là SỐ ĐẾM, SPC là ĐIỂM VƯỢT KIỂM SOÁT — sự kiện, không phải suy luận
    // thống kê ⇒ hiệu chỉnh đa phép thử không đụng tới chúng.
    expect(hasMeaningfulEvidence(bundle({ paretoTop: [{ category: "solder", count: 9, percentage: 40 }] }))).toBe(true);
    expect(hasMeaningfulEvidence(bundle({ spc: { cpk: 0.8, outOfControlCount: 3, violations: ["r1"] } }))).toBe(true);
    expect(hasMeaningfulEvidence(bundle({ similarIncidents: [{ title: "t", sourcePath: "p", score: 0.9 }] }))).toBe(true);
    // …và một bundle rỗng vẫn là rỗng.
    expect(hasMeaningfulEvidence(bundle())).toBe(false);
  });

  it("nhiễu KHÔNG làm hỏng một bundle vốn đã có bằng chứng thật", () => {
    const ev = bundle({
      paretoTop: [{ category: "solder", count: 9, percentage: 40 }],
      quantitativeCorrelations: [yeuTo({ significant: false, pValueAdjusted: 0.42 })],
    });
    expect(hasMeaningfulEvidence(ev)).toBe(true);
  });
});
