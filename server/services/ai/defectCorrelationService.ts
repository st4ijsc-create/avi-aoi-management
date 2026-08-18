/**
 * Defect ⇄ upstream-parameter QUANTITATIVE correlation — doc 44 Batch W5-B2 (G4.17).
 * SYNAPSE Tầng 4 §8.1 "Gợi ý nguyên nhân gốc: tương quan lỗi với tham số công
 * đoạn trước (mô men, thể tích keo, nhiệt)" + §9.2 "Học từ tương quan".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BỐI CẢNH (audit T4): RCA (aiRcaCopilot) gom Pareto+SPC+anomaly+VLM+config-change
 * nhưng tương quan tham-số-công-đoạn-trước = LIỆT KÊ ĐỊNH TÍNH, chưa định lượng.
 * Module này ĐỊNH LƯỢNG: cho một defect-type ở trạm N, lấy tham số các công đoạn
 * TRƯỚC của cùng đơn vị (torque/glue-volume/nhiệt từ process_results.metrics theo
 * genealogy serialNumber) và tính:
 *   • Pearson / point-biserial r (tham số liên tục ↔ nhãn NG nhị phân),
 *   • p-value hai phía (Student-t, incomplete-beta thuần TS),
 *   • hệ số hồi quy LOGISTIC đơn biến (log-odds/đơn-vị) → HƯỚNG tác động.
 * Trả top-k yếu tố kèm hệ số + p-value + hướng. Thuần TypeScript, không thư viện.
 *
 * FLAG: RCA_QUANTITATIVE_ENABLED (mặc định OFF) → correlateStationDefect trả
 * ok:false, RCA giữ nguyên phần định tính.
 *
 * PURE core (pearson / studentT p-value / logisticFit1D / correlateFactor) exported
 * cho test — kiểm được trên dữ liệu biết trước, KHÔNG cần DB.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ─── Flag ─────────────────────────────────────────────────────────────────────

export function isRcaQuantitativeEnabled(): boolean {
  return (process.env.RCA_QUANTITATIVE_ENABLED ?? "false").toLowerCase() === "true";
}

// ─── PURE stats primitives ────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Pearson correlation between `x` (continuous) and `y`. When `y` is dichotomous
 * (0/1) this IS the point-biserial correlation. Returns 0 for degenerate inputs
 * (n<3, constant x or y). Range [-1,1].
 */
export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  if (denom === 0) return 0;
  const r = sxy / denom;
  return Math.max(-1, Math.min(1, r));
}

// ── Regularized incomplete beta (Numerical Recipes) → Student-t p-value ────────

function logGamma(z: number): number {
  // Lanczos approximation (g=7, n=9).
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    // Reflection formula.
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * Two-tailed p-value of a Pearson correlation `r` over `n` samples, via the
 * Student-t test: t = r·√((n−2)/(1−r²)), p = I_{df/(df+t²)}(df/2, 1/2).
 * Returns 1 for |r|→0 and →0 for |r|→1 (given enough n). Clamped [0,1].
 */
export function pearsonTwoTailedP(r: number, n: number): number {
  const df = n - 2;
  if (df <= 0) return 1;
  const rr = Math.min(0.9999999999, Math.abs(r));
  if (rr <= 0) return 1;
  const t2 = (rr * rr * df) / (1 - rr * rr);
  const p = incompleteBeta(df / (df + t2), df / 2, 0.5);
  return Math.max(0, Math.min(1, p));
}

// ── Univariate logistic regression (Newton–Raphson, standardized) ─────────────

export interface LogisticFit {
  /** Slope on the ORIGINAL x scale (log-odds per unit of x). */
  slope: number;
  /** Intercept on the ORIGINAL x scale. */
  intercept: number;
  converged: boolean;
  iterations: number;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Fit p(y=1) = sigmoid(a + b·x) by IRLS/Newton over 2 params on STANDARDIZED x
 * (numerically stable), then map (a,b) back to the original x scale. A tiny ridge
 * stabilizes near-separable data. Returns the original-scale slope/intercept.
 */
export function logisticFit1D(
  x: number[],
  y: number[],
  opts: { maxIter?: number; tol?: number; ridge?: number } = {},
): LogisticFit {
  const n = Math.min(x.length, y.length);
  const maxIter = opts.maxIter ?? 50;
  const tol = opts.tol ?? 1e-7;
  const ridge = opts.ridge ?? 1e-6;

  const mx = mean(x.slice(0, n));
  let sd = Math.sqrt(mean(x.slice(0, n).map((v) => (v - mx) * (v - mx))));
  if (sd === 0 || !Number.isFinite(sd)) sd = 1;
  const z = new Array<number>(n);
  for (let i = 0; i < n; i++) z[i] = (x[i] - mx) / sd;

  let a = 0; // intercept (standardized)
  let b = 0; // slope (standardized)
  let converged = false;
  let it = 0;
  for (; it < maxIter; it++) {
    // Gradient g = Xᵀ(y − p); Hessian H = XᵀWX  (2×2). X columns [1, z].
    let g0 = 0;
    let g1 = 0;
    let h00 = ridge;
    let h01 = 0;
    let h11 = ridge;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a + b * z[i]);
      const w = Math.max(1e-9, p * (1 - p));
      const resid = y[i] - p;
      g0 += resid;
      g1 += resid * z[i];
      h00 += w;
      h01 += w * z[i];
      h11 += w * z[i] * z[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    // Δ = H⁻¹ g
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (-h01 * g0 + h00 * g1) / det;
    a += da;
    b += db;
    if (Math.max(Math.abs(da), Math.abs(db)) < tol) {
      converged = true;
      it++;
      break;
    }
  }
  // Map standardized (a,b) → original scale: z=(x−mx)/sd ⇒ slope=b/sd, intercept=a−b·mx/sd.
  return {
    slope: b / sd,
    intercept: a - (b * mx) / sd,
    converged,
    iterations: it,
  };
}

// ─── Multiple-testing correction ──────────────────────────────────────────────

/**
 * ★★★ VÌ SAO MODULE NÀY PHẢI HIỆU CHỈNH ĐA PHÉP THỬ — VÀ VÌ SAO LÀ **BENJAMINI-HOCHBERG**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG VÁ (không crash, không cảnh báo — người ta đi sửa NHẦM MÁY)
 * ══════════════════════════════════════════════════════════════════════════════
 * `rankFactors` chạy `correlateFactor` trên **MỌI** khoá `${stepType}.${metricKey}`
 * số hoá được của mọi công đoạn trước — thực tế hàng chục yếu tố mỗi lượt. Mỗi yếu tố
 * là **một phép thử giả thuyết riêng**. Với ngưỡng cố định `p < 0.05` áp cho từng
 * phép thử độc lập, kỳ vọng số dương-tính-giả là `m × 0.05`: **m = 20 ⇒ ~1 yếu tố
 * SAI được gắn `significant` MỖI LƯỢT**, kèm một p-value trông rất thuyết phục.
 * Con số ấy đi thẳng vào prompt của `aiRcaCopilot.buildEvidenceDigest` (nhãn
 * `SIGNIFICANT`) và vào khuyến nghị của `aiPredictiveAlertService` ⇒ AI trình bày
 * một nguyên nhân giả **như nguyên nhân thật, có số liệu hậu thuẫn**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * VÌ SAO **FDR (Benjamini-Hochberg)** CHỨ KHÔNG PHẢI FWER (Bonferroni/Holm)
 * ══════════════════════════════════════════════════════════════════════════════
 * ① **Đầu ra của module này là một DANH SÁCH NGẮN ĐỂ ĐI ĐIỀU TRA, không phải một
 *    kết luận cuối.** Người kỹ sư nhận top-k rồi tự đi đo lại. Tỷ lệ lỗi đúng ngữ
 *    nghĩa ở đây là *"trong những yếu tố tôi nêu, bao nhiêu phần là rác?"* — đó
 *    ĐÚNG là định nghĩa FDR. FWER trả lời một câu khác: *"xác suất có DÙ CHỈ MỘT
 *    cái sai trong toàn lượt"* — quá đắt cho một bước sàng lọc.
 * ② **Chi phí hai loại lỗi KHÔNG đối xứng.** Bỏ sót nguyên nhân thật = tiếp tục
 *    sản xuất phế phẩm (đắt, kéo dài). Một dương-tính-giả = một lượt điều tra phí
 *    (rẻ, và người kỹ sư loại nó ra ngay ở bước đo lại).
 * ③ **Bonferroni GIẾT nguyên nhân thật THỨ HAI trở đi.**
 *    ⚠ ĐÍNH CHÍNH MỘT ĐIỀU TÔI ĐÃ VIẾT SAI Ở BẢN NHÁP ĐẦU, do một ca test đỏ chỉ
 *    ra: với **p NHỎ NHẤT** của họ, BH và Bonferroni **ĐỒNG NHẤT** — BH cho
 *    `adj(1) = m/1 · p(1)`, tức đúng ngưỡng `p(1) < α/m` của Bonferroni. Vậy nếu
 *    lượt phân tích chỉ có MỘT nguyên nhân thật, chọn BH hay Bonferroni **không
 *    khác gì nhau**, và mọi ca "BH mạnh hơn" dựng trên một-nguyên-nhân đều là ca
 *    GIẢ (nó xanh vì lý do khác).
 *    Lợi thế thật của BH nằm ở khám phá **thứ 2, 3, …**: `adj(k) = m/k · p(k)` nới
 *    dần theo hạng, trong khi Bonferroni giữ nguyên `α/m` cho mọi hạng. Nhà máy
 *    hiếm khi hỏng vì đúng một tham số — nhiệt và thời gian của một trạm hàn cùng
 *    trôi là chuyện thường ⇒ đây đúng là ca cần sức mạnh.
 *    Đây không phải lập luận suông: ca `"Bonferroni GIẾT nguyên nhân thật thứ hai…"`
 *    trong bộ test **ĐO** trên dữ liệu tất định (m=32): nguyên nhân #2 có
 *    p thô = 2,572e-3 > α/m = 1,563e-3 (**Bonferroni bỏ sót**) nhưng
 *    p hiệu chỉnh BH = 4,115e-2 < 0,05 (**BH giữ**), trong khi 0/30 yếu tố nhiễu
 *    lọt qua BH — và 2/30 trong số đó ĐANG được ngưỡng thô cũ gắn cờ.
 * ④ **BH hợp lệ dưới phụ thuộc dương (PRDS).** Các yếu tố ở đây phụ thuộc dương
 *    theo cấu tạo: cùng đơn vị (`serialNumber`), cùng dây chuyền, nhiều metric của
 *    CÙNG một `stepType` (nhiệt/áp/thời gian của một trạm hàn). Benjamini-Hochberg
 *    (1995) được chứng minh kiểm soát FDR dưới đúng lớp phụ thuộc này ⇒ KHÔNG cần
 *    hạ xuống Benjamini-Yekutieli (vốn nhân thêm hệ số điều hoà, bảo thủ như
 *    Bonferroni ở m nhỏ và sẽ tái tạo lại chính vấn đề ③).
 *
 * ⚠ **KHÔNG PHẢI "ĐỔI NGƯỠNG".** p **thô** (`pValue`) và p **đã hiệu chỉnh**
 *   (`pValueAdjusted`) cùng có mặt trong dữ liệu trả về, kèm `familySize` (hiệu
 *   chỉnh trên BAO NHIÊU phép thử) và `correctionMethod` (hiệu chỉnh BẰNG GÌ), để
 *   tầng trên và người đọc biết cái nào là cái nào và kiểm lại được.
 * ⚠ **Họ phép thử = MỌI yếu tố THỰC SỰ ĐƯỢC THỬ, không phải top-k.** Hiệu chỉnh
 *   SAU khi cắt top-k là một lưới giả: m nhỏ đi ⇒ ngưỡng lỏng ra ⇒ đúng những
 *   dương-tính-giả lọt vào top-k lại được cấp giấy chứng nhận. Bất biến này được
 *   ghim bằng ca `familySize` riêng.
 */

/** Ngưỡng ý nghĩa mặc định, dùng CHUNG cho mọi điểm quyết định trong module. */
export const DEFAULT_ALPHA = 0.05;

/** Phương pháp hiệu chỉnh đã áp cho `pValueAdjusted`. */
export type PCorrectionMethod = "none" | "benjamini_hochberg";

/**
 * Benjamini-Hochberg step-up FDR adjustment — thuần, không phụ thuộc.
 * Trả p đã hiệu chỉnh THEO ĐÚNG THỨ TỰ đầu vào.
 *
 * adj(i) = min_{j ≥ i} ( m/j · p(j) ) trên dãy p ĐÃ SẮP TĂNG, rồi kẹp về [0,1].
 * Phép `min` chạy dồn từ phải sang trái là điều kiện **đơn điệu**: nếu thiếu nó,
 * một p thô nhỏ hơn có thể nhận p hiệu chỉnh LỚN hơn của một p thô lớn hơn — vô
 * nghĩa, và phá luôn thứ tự xếp hạng ở tầng trên.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adj = new Array<number>(m);
  let running = Number.POSITIVE_INFINITY;
  for (let k = m - 1; k >= 0; k--) {
    const rank = k + 1; // 1-based
    running = Math.min(running, (m / rank) * order[k].p);
    adj[order[k].i] = Math.max(0, Math.min(1, running));
  }
  return adj;
}

// ─── Per-factor correlation ───────────────────────────────────────────────────

export type CorrelationDirection = "higher_more_defects" | "lower_more_defects" | "none";

export interface FactorCorrelation {
  factor: string;
  n: number;
  /** point-biserial r (-1..1). */
  pearson: number;
  /**
   * p-value **THÔ** (chưa hiệu chỉnh) của RIÊNG yếu tố này, hai phía, Student-t.
   * ⚠ KHÔNG dùng ô này để quyết định ý nghĩa thống kê khi đã thử nhiều yếu tố —
   *   đó chính là lỗi mà `pValueAdjusted` sinh ra để vá. Giữ lại vì nó là số ĐO
   *   ĐƯỢC của phép thử đơn lẻ, và vì người đọc cần thấy cả hai để kiểm lại.
   */
  pValue: number;
  /**
   * p-value **SAU HIỆU CHỈNH ĐA PHÉP THỬ** trên `familySize` phép thử của lượt
   * phân tích này. Đây là con số `significant` thực sự dựa vào.
   * Với `familySize === 1` thì BH cho ra đúng `pValue` (không có gì để hiệu chỉnh).
   */
  pValueAdjusted: number;
  /** Hiệu chỉnh BẰNG GÌ. */
  correctionMethod: PCorrectionMethod;
  /** Hiệu chỉnh trên BAO NHIÊU phép thử (họ phép thử THỰC SỰ đã chạy). */
  familySize: number;
  /** Ngưỡng đã dùng cho quyết định `significant`. */
  alpha: number;
  /** logistic log-odds per unit of the parameter (original scale). */
  logisticCoef: number;
  direction: CorrelationDirection;
  /** ⚠ `pValueAdjusted < alpha` — **KHÔNG** phải `pValue < alpha`. */
  significant: boolean;
  /** mean parameter value among defective (y=1) units. */
  meanDefect: number;
  /** mean parameter value among OK (y=0) units. */
  meanOk: number;
}

/**
 * Áp hiệu chỉnh đa phép thử cho MỘT họ phép thử và gắn quyết định `significant`.
 * ĐÂY LÀ NƠI DUY NHẤT trong module đặt `significant` — `correlateFactor` và
 * `rankFactors` đều đi qua hàm này, nên không có đường thoát thứ hai nào còn dùng
 * ngưỡng thô.
 *
 * Đọc `pValue` (THÔ) làm đầu vào, nên gọi lại trên một danh sách đã hiệu chỉnh là
 * **bình thường và bất biến** (`rankFactors` hiệu chỉnh lại trên họ đầy đủ những
 * bản ghi mà `correlateFactor` đã hiệu chỉnh với họ-một-phần-tử).
 */
export function applyMultipleTestingCorrection(
  correlations: FactorCorrelation[],
  opts: { alpha?: number; method?: PCorrectionMethod } = {},
): FactorCorrelation[] {
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const method = opts.method ?? "benjamini_hochberg";
  const familySize = correlations.length;
  const raw = correlations.map((c) => c.pValue);
  const adjusted = method === "benjamini_hochberg" ? benjaminiHochberg(raw) : raw.slice();
  return correlations.map((c, i) => {
    // ⚠ Quyết định dựa trên ĐÚNG con số được BÁO CÁO (đã làm tròn), không phải trên
    // một giá trị nội bộ khác. Nếu không, người đọc có thể thấy `p_adj = 0.050` bên
    // cạnh nhãn `significant` — thước và kết luận nói hai chuyện khác nhau.
    const padj = Number(adjusted[i].toExponential(3));
    return { ...c, pValueAdjusted: padj, correctionMethod: method, familySize, alpha, significant: padj < alpha };
  });
}

/** True ⇔ có ít nhất một yếu tố còn ý nghĩa SAU hiệu chỉnh. */
export function hasSignificantFactor(factors: FactorCorrelation[]): boolean {
  return factors.some((f) => f.significant);
}

/**
 * Correlate ONE upstream parameter against the binary defect outcome.
 * Requires ≥ `minSamples` paired points, both classes present, and non-constant x.
 * Returns null when the guard fails (honest — no correlation on degenerate data).
 */
export function correlateFactor(
  factor: string,
  values: number[],
  outcomes: number[],
  opts: { minSamples?: number; alpha?: number } = {},
): FactorCorrelation | null {
  const minSamples = opts.minSamples ?? 8;
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  const n = Math.min(values.length, outcomes.length);
  if (n < minSamples) return null;

  const x = values.slice(0, n);
  const y: number[] = outcomes.slice(0, n).map((v) => (v ? 1 : 0));
  const nDefect = y.reduce((s, v) => s + v, 0);
  if (nDefect === 0 || nDefect === n) return null; // need both classes
  // constant x → no correlation defined.
  if (x.every((v) => v === x[0])) return null;

  const r = pearson(x, y);
  const p = pearsonTwoTailedP(r, n);
  const fit = logisticFit1D(x, y);

  const defectVals = x.filter((_, i) => y[i] === 1);
  const okVals = x.filter((_, i) => y[i] === 0);

  // Direction from the sign of r (falls back to logistic slope when r≈0).
  const signSource = Math.abs(r) > 1e-6 ? r : fit.slope;
  const direction: CorrelationDirection =
    Math.abs(signSource) < 1e-9 ? "none" : signSource > 0 ? "higher_more_defects" : "lower_more_defects";

  // ⚠ MỘT yếu tố ⇒ họ phép thử có ĐÚNG MỘT phần tử ⇒ BH cho ra chính p thô. Vẫn đi
  // qua `applyMultipleTestingCorrection` thay vì gán tay `significant: p < alpha`, để
  // repo chỉ có MỘT nơi đặt `significant` (không có đường thoát thứ hai để quên vá).
  const [corrected] = applyMultipleTestingCorrection(
    [
      {
        factor,
        n,
        pearson: Number(r.toFixed(4)),
        pValue: Number(p.toExponential(3)),
        pValueAdjusted: Number(p.toExponential(3)),
        correctionMethod: "benjamini_hochberg",
        familySize: 1,
        alpha,
        logisticCoef: Number(fit.slope.toFixed(6)),
        direction,
        significant: false,
        meanDefect: Number(mean(defectVals).toFixed(4)),
        meanOk: Number(mean(okVals).toFixed(4)),
      },
    ],
    { alpha },
  );
  return corrected;
}

/**
 * Correlate every factor, hiệu chỉnh đa phép thử trên **TOÀN BỘ họ đã thử**, rồi
 * rank: yếu tố còn SIGNIFICANT sau hiệu chỉnh lên trước (theo |pearson| giảm dần),
 * phần còn lại theo |pearson| giảm dần. Trả top-k.
 *
 * ⚠⚠ THỨ TỰ KHÔNG ĐẢO ĐƯỢC: hiệu chỉnh TRƯỚC, cắt top-k SAU. Cắt trước rồi hiệu
 * chỉnh sẽ tính BH trên `m = topK` thay vì `m = số phép thử thật`, tức nới lỏng
 * ngưỡng đúng cho những yếu tố đã lọt vào top-k — chính là dương-tính-giả mà lượt
 * hiệu chỉnh này sinh ra để loại. `familySize` trong mỗi bản ghi là bằng chứng
 * kiểm lại được cho việc này (ca test riêng ghim nó).
 */
export function rankFactors(
  factors: Array<{ factor: string; values: number[]; outcomes: number[] }>,
  opts: { topK?: number; minSamples?: number; alpha?: number } = {},
): FactorCorrelation[] {
  const tested: FactorCorrelation[] = [];
  for (const f of factors) {
    const c = correlateFactor(f.factor, f.values, f.outcomes, { minSamples: opts.minSamples, alpha: opts.alpha });
    if (c) tested.push(c);
  }
  const out = applyMultipleTestingCorrection(tested, { alpha: opts.alpha });
  out.sort((a, b) => {
    if (a.significant !== b.significant) return a.significant ? -1 : 1;
    return Math.abs(b.pearson) - Math.abs(a.pearson);
  });
  return out.slice(0, opts.topK ?? 5);
}

// ─── DB assembly (fail-safe, flag-gated) ──────────────────────────────────────

export interface CorrelateInput {
  /** Station N (target inspection machine). Required to scope the defect outcome. */
  machineId?: number;
  /** Optional defect narrowing (matched against measurement_results.defectCodeRaw). */
  defectType?: string;
  windowDays?: number;
  topK?: number;
  minSamples?: number;
  /** Skip/refresh cache. Default false (use cache when fresh). */
  noCache?: boolean;
}

export interface CorrelateResult {
  ok: boolean;
  machineId?: number;
  defectType?: string;
  windowDays: number;
  totalUnits: number;
  defectUnits: number;
  factors: FactorCorrelation[];
  notes: string[];
  cached: boolean;
}

function cacheTtlMs(): number {
  const n = Number(process.env.RCA_QUANT_CACHE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 6 * 60 * 60 * 1000; // 6h
}

/**
 * ⚠ `v=` LÀ PHIÊN BẢN **HÌNH DẠNG BẢN GHI `factors`**, KHÔNG PHẢI TRANG TRÍ.
 * `factors` được cất vào `defect_correlation_cache` dưới dạng `jsonb` và đọc lại
 * NGUYÊN VĂN thành `FactorCorrelation[]`. Hàng cache ghi TRƯỚC lượt hiệu chỉnh này
 * KHÔNG có `pValueAdjusted`/`familySize`/`correctionMethod` ⇒ đọc lại sẽ cho một
 * bản ghi mà `significant` là quyết định THÔ cũ, còn `pValueAdjusted` là `undefined`
 * và in ra prompt RCA thành chữ "undefined". Bơm `v=2` vào chữ ký khiến mọi hàng cũ
 * KHÔNG BAO GIỜ khớp nữa (chúng tự hết hạn theo TTL) — rẻ hơn và chắc hơn mọi phép
 * suy đoán hình dạng lúc đọc. Đổi hình dạng `FactorCorrelation` lần sau ⇒ tăng số này.
 */
const CACHE_SHAPE_VERSION = 2;

function signatureOf(input: { machineId?: number; defectType?: string; windowDays: number }): string {
  return `m=${input.machineId ?? "*"};d=${(input.defectType ?? "*").slice(0, 120)};w=${input.windowDays};v=${CACHE_SHAPE_VERSION}`;
}

/**
 * Optional cache read (raw SQL, fail-open). The table (0264) may not exist yet →
 * returns null on any error, exactly like measurement_corrections access in RCA.
 */
async function readCache(db: any, signature: string): Promise<CorrelateResult | null> {
  try {
    const { sql } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - cacheTtlMs());
    const res = await db.execute(sql`
      SELECT machine_id, defect_type, window_days, total_units, defect_units, factors, notes
      FROM defect_correlation_cache
      WHERE signature = ${signature} AND computed_at >= ${cutoff.toISOString()}
      LIMIT 1
    `);
    const rows = ((res as { rows?: unknown[] })?.rows ?? res ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    const factors = (typeof row.factors === "string" ? JSON.parse(row.factors) : row.factors) as FactorCorrelation[];
    const notes = (typeof row.notes === "string" ? JSON.parse(row.notes) : row.notes) as string[];
    return {
      ok: true,
      machineId: row.machine_id != null ? Number(row.machine_id) : undefined,
      defectType: (row.defect_type as string | null) ?? undefined,
      windowDays: Number(row.window_days),
      totalUnits: Number(row.total_units),
      defectUnits: Number(row.defect_units),
      factors: Array.isArray(factors) ? factors : [],
      notes: Array.isArray(notes) ? notes : [],
      cached: true,
    };
  } catch {
    return null; // table absent / query mismatch → skip cache
  }
}

/** Optional cache write (raw SQL, fail-open, best-effort). */
async function writeCache(db: any, signature: string, result: CorrelateResult): Promise<void> {
  try {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO defect_correlation_cache
        (signature, machine_id, defect_type, window_days, total_units, defect_units, factors, notes, computed_at)
      VALUES (
        ${signature}, ${result.machineId ?? null}, ${result.defectType ?? null}, ${result.windowDays},
        ${result.totalUnits}, ${result.defectUnits},
        ${JSON.stringify(result.factors)}::jsonb, ${JSON.stringify(result.notes)}::jsonb, now()
      )
      ON CONFLICT (signature) DO UPDATE SET
        machine_id = EXCLUDED.machine_id,
        defect_type = EXCLUDED.defect_type,
        window_days = EXCLUDED.window_days,
        total_units = EXCLUDED.total_units,
        defect_units = EXCLUDED.defect_units,
        factors = EXCLUDED.factors,
        notes = EXCLUDED.notes,
        computed_at = now()
    `);
  } catch {
    /* cache is best-effort; table may not exist yet */
  }
}

function degrade(input: CorrelateInput, windowDays: number, note: string): CorrelateResult {
  return {
    ok: false,
    machineId: input.machineId,
    defectType: input.defectType,
    windowDays,
    totalUnits: 0,
    defectUnits: 0,
    factors: [],
    notes: [note],
    cached: false,
  };
}

/**
 * Quantitative correlation of a defect at station N against upstream parameters.
 * Fail-safe: NEVER throws. Flag-gated (RCA_QUANTITATIVE_ENABLED).
 *
 * Outcome: per unit (serialNumber) inspected at station N in the window,
 * defect=1 when the inspection is NG (narrowed to `defectType` via
 * measurement_results.defectCodeRaw when supplied), else 0. Parameters: numeric
 * keys of process_results.metrics recorded UPSTREAM of that unit's station-N
 * inspection time (last value per key per unit). READ-ONLY.
 */
export async function correlateStationDefect(input: CorrelateInput): Promise<CorrelateResult> {
  const windowDays = input.windowDays ?? 30;
  if (!isRcaQuantitativeEnabled()) return degrade(input, windowDays, "RCA_QUANTITATIVE_DISABLED");
  if (input.machineId == null) return degrade(input, windowDays, "INSUFFICIENT_SCOPE_NO_STATION");

  const topK = input.topK ?? 5;
  const minSamples = input.minSamples ?? 12;
  const signature = signatureOf({ machineId: input.machineId, defectType: input.defectType, windowDays });

  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return degrade(input, windowDays, "DB_UNAVAILABLE");

    if (!input.noCache) {
      const cached = await readCache(db, signature);
      if (cached) return cached;
    }

    const { and, eq, gte, desc, sql } = await import("drizzle-orm");
    const { productInspections, measurementResults, processResults } = await import("../../../drizzle/schema");
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    // 1) Station-N inspections in the window (one outcome per serial).
    const inspRows = await db
      .select({
        serialNumber: productInspections.serialNumber,
        overallResult: productInspections.overallResult,
        inspectionTime: productInspections.inspectionTime,
        id: productInspections.id,
      })
      .from(productInspections)
      .where(and(eq(productInspections.machineId, input.machineId), gte(productInspections.inspectionTime, since)))
      .orderBy(desc(productInspections.inspectionTime))
      .limit(20000);

    if (inspRows.length === 0) return degrade(input, windowDays, "NO_STATION_INSPECTIONS");

    // Optional defect-type narrowing: which inspection ids carry that defect code.
    let defectInspectionIds: Set<number> | null = null;
    if (input.defectType) {
      try {
        const dr = await db
          .select({ inspectionId: measurementResults.inspectionId })
          .from(measurementResults)
          .where(
            and(
              eq(measurementResults.result, "NG"),
              sql`(${measurementResults.defectCodeRaw} ILIKE ${input.defectType} OR ${measurementResults.remark} ILIKE ${"%" + input.defectType + "%"})`,
            ),
          )
          .limit(50000);
        defectInspectionIds = new Set(dr.map((r) => r.inspectionId));
      } catch {
        defectInspectionIds = null; // narrowing failed → fall back to overallResult-only
      }
    }

    // Outcome per serial: NG(1)/OK(0). A serial is defective if ANY station-N
    // inspection is NG (and, when narrowing, carries the defect code). Keep the
    // earliest inspectionTime per serial for the upstream cutoff.
    const outcomeBySerial = new Map<string, number>();
    const cutoffBySerial = new Map<string, Date>();
    for (const r of inspRows) {
      const sn = r.serialNumber;
      const isNg =
        String(r.overallResult) === "NG" && (defectInspectionIds ? defectInspectionIds.has(r.id) : true);
      outcomeBySerial.set(sn, Math.max(outcomeBySerial.get(sn) ?? 0, isNg ? 1 : 0));
      const t = new Date(r.inspectionTime);
      const prev = cutoffBySerial.get(sn);
      if (!prev || t > prev) cutoffBySerial.set(sn, t); // latest station-N time = upstream boundary
    }

    const serials = [...outcomeBySerial.keys()];
    if (serials.length < minSamples) return degrade(input, windowDays, "TOO_FEW_UNITS");

    // 2) Upstream process_results for those serials (numeric metrics only).
    const { inArray } = await import("drizzle-orm");
    const prRows = await db
      .select({
        serialNumber: processResults.serialNumber,
        stepType: processResults.stepType,
        metrics: processResults.metrics,
        measuredAt: processResults.measuredAt,
      })
      .from(processResults)
      .where(and(inArray(processResults.serialNumber, serials), gte(processResults.measuredAt, since)))
      .orderBy(desc(processResults.measuredAt))
      .limit(100000);

    // Per serial × factor → latest UPSTREAM numeric value (before station-N time).
    // Factor key = `${stepType}.${metricKey}` to avoid cross-step collisions.
    const perSerialFactor = new Map<string, Map<string, { at: Date; value: number }>>();
    for (const r of prRows) {
      const sn = r.serialNumber;
      const cutoff = cutoffBySerial.get(sn);
      const at = new Date(r.measuredAt);
      if (cutoff && at >= cutoff) continue; // only strictly-upstream steps
      const metrics = (r.metrics ?? {}) as Record<string, unknown>;
      let bag = perSerialFactor.get(sn);
      if (!bag) {
        bag = new Map();
        perSerialFactor.set(sn, bag);
      }
      for (const [k, v] of Object.entries(metrics)) {
        const num = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
        if (num == null || !Number.isFinite(num)) continue;
        const key = `${r.stepType}.${k}`;
        const cur = bag.get(key);
        if (!cur || at > cur.at) bag.set(key, { at, value: num }); // latest upstream wins
      }
    }

    // 3) Build aligned (values, outcomes) per factor.
    const factorKeys = new Set<string>();
    for (const bag of perSerialFactor.values()) for (const k of bag.keys()) factorKeys.add(k);

    const factorInputs: Array<{ factor: string; values: number[]; outcomes: number[] }> = [];
    for (const key of factorKeys) {
      const values: number[] = [];
      const outcomes: number[] = [];
      for (const sn of serials) {
        const v = perSerialFactor.get(sn)?.get(key);
        if (!v) continue;
        values.push(v.value);
        outcomes.push(outcomeBySerial.get(sn) ?? 0);
      }
      if (values.length >= minSamples) factorInputs.push({ factor: key, values, outcomes });
    }

    const factors = rankFactors(factorInputs, { topK, minSamples });
    const defectUnits = [...outcomeBySerial.values()].reduce((s, v) => s + v, 0);
    const notes: string[] = [];
    if (factorInputs.length === 0) notes.push("no_upstream_numeric_params");
    if (defectUnits === 0) notes.push("no_defects_in_window");
    // ★ TỪ CHỐI TRUNG THỰC, DẠNG CÓ CẤU TRÚC: "đã thử m yếu tố, KHÔNG cái nào sống sót
    // qua hiệu chỉnh". Trước đây trạng thái này không phân biệt được với "không có yếu
    // tố nào để thử" — cả hai đều chỉ là `factors` không có cờ `significant`, im lặng.
    if (factorInputs.length > 0 && !hasSignificantFactor(factors)) {
      notes.push(`no_factor_significant_after_${factors[0]?.correctionMethod ?? "benjamini_hochberg"}`);
    }

    const result: CorrelateResult = {
      ok: true,
      machineId: input.machineId,
      defectType: input.defectType,
      windowDays,
      totalUnits: serials.length,
      defectUnits,
      factors,
      notes,
      cached: false,
    };
    void writeCache(db, signature, result); // best-effort, fire-and-forget
    return result;
  } catch (err) {
    console.warn("[defectCorrelation] correlateStationDefect failed:", err instanceof Error ? err.message : String(err));
    return degrade(input, windowDays, "CORRELATION_ERROR");
  }
}
