/**
 * OCR Service — doc 44 Batch W5-B2 (gap G4.13).
 * SYNAPSE Tầng 4 §8.1 "Kiểm nhãn/tem & bao bì: OCR/so khớp mã, tem, thùng — chống lỗi dán sai".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * BỐI CẢNH (audit T4): OCR cũ chỉ prompt VLM (aiAdvancedVision.extractText) và
 * SUY độ tin cậy từ ĐỘ DÀI chuỗi — yếu, không kiểm được tem/mã. Module này thay
 * bằng một ENGINE OCR THẬT:
 *
 *   (a) ONNX OCR (PaddleOCR/RapidOCR: DET DBNet + REC CRNN-CTC) chạy qua
 *       onnxruntime-node SẴN CÓ. Độ tin cậy THẬT = điểm nhận dạng (mean per-char
 *       max-prob từ CTC), KHÔNG suy từ độ dài.
 *   (b) Nếu model .onnx CHƯA có trên đĩa → DEGRADE TRUNG THỰC:
 *       reason "OCR_MODEL_NOT_AVAILABLE" (giống VISION_NOT_AVAILABLE hiện có),
 *       KHÔNG bịa text/score.
 *   (c) Tùy chọn fallback VLM (OCR_VLM_FALLBACK) với confidence TRUNG THỰC
 *       (không calibrate → trần "medium", không bao giờ "high").
 *
 * + KIỂM TEM/BARCODE: đọc mã người-đọc-được bằng OCR rồi SO KHỚP mã mong đợi
 *   (exact | Levenshtein) → pass/fail + confidence THẬT từ rec-score.
 *   (Không giải mã 1D/2D symbology — cần lib mã vạch riêng; ở đây là human-
 *   readable code matching, honest về phạm vi.)
 *
 * FLAG: OCR_ENGINE_ENABLED (mặc định OFF). OFF → aiAdvancedVision giữ NGUYÊN
 * đường VLM cũ (bit-compat). Module này chỉ được gọi khi cờ ON.
 *
 * PURE core (ctcGreedyDecode / levenshtein / labelMatch) exported cho test —
 * KHÔNG cần onnxruntime để kiểm; onnxruntime chỉ nạp LAZY khi chạy rec/det thật.
 * ════════════════════════════════════════════════════════════════════════════
 */
import fs from "fs";
import path from "path";
import type sharpNs from "sharp";

// ─── Flags ────────────────────────────────────────────────────────────────────

/** Master flag — OFF → callers use the legacy VLM path (bit-compat). */
export function isOcrEngineEnabled(): boolean {
  return (process.env.OCR_ENGINE_ENABLED ?? "false").toLowerCase() === "true";
}

/** When the ONNX models are absent, optionally fall back to the VLM path (honest confidence). */
function isVlmFallbackEnabled(): boolean {
  return (process.env.OCR_VLM_FALLBACK ?? "false").toLowerCase() === "true";
}

// ─── Model path resolution (env-overridable) ──────────────────────────────────

export interface OcrModelPaths {
  detPath: string | null; // DBNet text-detection model (optional)
  recPath: string; // CRNN text-recognition model (required)
  dictPath: string; // character dictionary for CTC decode (required)
  recHeight: number; // rec input height (PaddleOCR default 48)
  blankIndex: number; // CTC blank class index (PaddleOCR default 0)
}

function resolveModelDir(): string {
  return process.env.OCR_MODEL_DIR
    ? path.resolve(process.env.OCR_MODEL_DIR)
    : path.join(process.cwd(), "models", "ocr");
}

/** Resolve the configured model file paths (does NOT check existence). */
export function ocrModelPaths(): OcrModelPaths {
  const dir = resolveModelDir();
  const det = process.env.OCR_ONNX_DET_MODEL || path.join(dir, "det.onnx");
  const rec = process.env.OCR_ONNX_REC_MODEL || path.join(dir, "rec.onnx");
  const dict = process.env.OCR_ONNX_DICT || path.join(dir, "ppocr_keys.txt");
  const recHeight = Number(process.env.OCR_REC_HEIGHT) || 48;
  const blankIndex = Number.isFinite(Number(process.env.OCR_BLANK_INDEX))
    ? Number(process.env.OCR_BLANK_INDEX)
    : 0;
  return {
    // DET is optional: absent → single-line recognition on the (already-ROI) image.
    detPath: fs.existsSync(det) ? det : null,
    recPath: rec,
    dictPath: dict,
    recHeight: recHeight > 0 ? recHeight : 48,
    blankIndex,
  };
}

/** True only when the REQUIRED models (rec + dict) exist on disk. Never throws. */
export function ocrModelsAvailable(): boolean {
  try {
    const { recPath, dictPath } = ocrModelPaths();
    return fs.existsSync(recPath) && fs.existsSync(dictPath);
  } catch {
    return false;
  }
}

// ─── Public shapes ────────────────────────────────────────────────────────────

export type OcrEngine = "onnx" | "vlm" | "none";

export interface OcrLine {
  text: string;
  /** Recognition confidence 0..1 — REAL (mean per-char CTC max-prob), never from string length. */
  score: number;
  box?: { x: number; y: number; w: number; h: number };
}

export interface OcrResult {
  ok: boolean;
  engine: OcrEngine;
  text: string;
  lines: OcrLine[];
  /** Aggregate confidence 0..1 — mean of line scores (REAL). 0 when degraded. */
  confidence: number;
  degraded: boolean;
  /** Present when degraded, e.g. "OCR_MODEL_NOT_AVAILABLE". Honest, never fabricated. */
  reason?: string;
}

export interface LabelCheckResult {
  pass: boolean;
  engine: OcrEngine;
  recognized: string;
  expected: string;
  matchMode: "exact" | "levenshtein";
  /** Normalized similarity 0..1 (1 = identical). */
  similarity: number;
  /** Levenshtein edit distance (0 = identical). */
  distance: number;
  /** OCR recognition confidence 0..1 — REAL rec-score, NOT string length. */
  confidence: number;
  degraded: boolean;
  reason?: string;
}

// ─── PURE: Levenshtein distance + normalized similarity ───────────────────────

/** Classic Wagner–Fischer edit distance. Pure. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 1 − distance/maxLen, clamped to [0,1]. Two empty strings → 1. */
export function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return Math.max(0, Math.min(1, 1 - levenshtein(a, b) / maxLen));
}

// ─── PURE: label / barcode matching decision ──────────────────────────────────

/**
 * Match a recognized string against an expected code. Confidence is the OCR
 * rec-score (supplied by the caller) — NOT derived from string length.
 * `normalize` (default) strips whitespace + upper-cases before comparing, which is
 * the right thing for serials/labels/barcodes (case/space are rarely significant).
 */
export function labelMatch(
  recognized: string,
  expected: string,
  opts: { mode?: "exact" | "levenshtein"; minSimilarity?: number; normalize?: boolean } = {},
): { pass: boolean; similarity: number; distance: number; matchMode: "exact" | "levenshtein" } {
  const mode = opts.mode ?? "levenshtein";
  const norm = (s: string) => (opts.normalize === false ? s : s.replace(/\s+/g, "").toUpperCase());
  const r = norm(recognized);
  const e = norm(expected);
  const distance = levenshtein(r, e);
  const similarity = similarityRatio(r, e);
  const pass = mode === "exact" ? r === e && e.length > 0 : similarity >= (opts.minSimilarity ?? 0.9) && e.length > 0;
  return { pass, similarity: Number(similarity.toFixed(4)), distance, matchMode: mode };
}

// ─── PURE: CTC greedy decode (the heart of REAL confidence) ───────────────────

export interface CtcDecodeResult {
  text: string;
  /** Mean of the per-emitted-char max-probabilities — the honest recognition score. */
  score: number;
}

/**
 * Greedy CTC decode of a recognition-head output.
 *
 * `logits` is the flat output; `dims` its shape. Supported layouts:
 *   • [1,T,C] or [T,C]  (default "TC" — PaddleOCR/RapidOCR CRNN)
 *   • [1,C,T] or [C,T]  (layout:"CT")
 * `charset[i]` = the character for class index i (charset[blankIndex] is ignored).
 * Decode rule (canonical greedy CTC): per timestep pick argmax class; emit its
 * char only when it differs from the previous class AND is not blank; the emitted
 * timestep's max-prob feeds the confidence. Values are treated as probabilities;
 * pass `applySoftmax` if the head emits raw logits.
 */
export function ctcGreedyDecode(
  logits: Float32Array | number[],
  dims: number[],
  charset: string[],
  opts: { blankIndex?: number; layout?: "TC" | "CT"; applySoftmax?: boolean } = {},
): CtcDecodeResult {
  const blankIndex = opts.blankIndex ?? 0;
  const layout = opts.layout ?? "TC";
  // Derive T (timesteps) and C (classes) from dims (drop a leading batch dim of 1).
  const shape = dims.length === 3 && dims[0] === 1 ? dims.slice(1) : dims;
  if (shape.length !== 2) return { text: "", score: 0 };
  const [d0, d1] = shape;
  const T = layout === "TC" ? d0 : d1;
  const C = layout === "TC" ? d1 : d0;
  if (T <= 0 || C <= 0) return { text: "", score: 0 };

  const at = (t: number, c: number): number =>
    layout === "TC" ? Number(logits[t * C + c]) : Number(logits[c * T + t]);

  let text = "";
  let scoreSum = 0;
  let scoreN = 0;
  let prev = -1;
  for (let t = 0; t < T; t++) {
    // argmax over classes at timestep t.
    let bestC = 0;
    let bestV = -Infinity;
    let sumExp = 0;
    let maxRaw = -Infinity;
    if (opts.applySoftmax) {
      for (let c = 0; c < C; c++) maxRaw = Math.max(maxRaw, at(t, c));
      for (let c = 0; c < C; c++) sumExp += Math.exp(at(t, c) - maxRaw);
    }
    for (let c = 0; c < C; c++) {
      const v = at(t, c);
      if (v > bestV) {
        bestV = v;
        bestC = c;
      }
    }
    const prob = opts.applySoftmax ? Math.exp(bestV - maxRaw) / (sumExp || 1) : bestV;
    if (bestC !== prev && bestC !== blankIndex) {
      const ch = charset[bestC] ?? "";
      if (ch) {
        text += ch;
        scoreSum += Math.max(0, Math.min(1, prob));
        scoreN += 1;
      }
    }
    prev = bestC;
  }
  return { text, score: scoreN > 0 ? Number((scoreSum / scoreN).toFixed(4)) : 0 };
}

// ─── Dictionary loader (CTC charset) ──────────────────────────────────────────

/**
 * Load the PaddleOCR character dictionary into a class-indexed charset.
 * File is one character per line (dict[0]→first real char). With blankIndex=0
 * (PaddleOCR convention) the charset becomes [blank, c0, c1, …]; a trailing
 * ' ' (space) class is appended as PaddleOCR does by default.
 */
export function loadCharset(dictPath: string, blankIndex = 0): string[] {
  const raw = fs.readFileSync(dictPath, "utf8");
  const chars = raw.split(/\r?\n/);
  // Trim a single trailing empty line (common), keep intentional inner blanks as-is.
  if (chars.length && chars[chars.length - 1] === "") chars.pop();
  const charset: string[] = [];
  if (blankIndex === 0) {
    charset.push(""); // index 0 = blank
    for (const c of chars) charset.push(c);
    charset.push(" "); // PaddleOCR appends a space class at the end
  } else {
    for (const c of chars) charset.push(c);
    charset.push(" ");
    // blank sits at the end (blankIndex === charset.length) — represented by "".
    charset.push("");
  }
  return charset;
}

// ─── ONNX inference (lazy — never imported unless models exist & flag on) ─────

let _cachedCharset: { path: string; charset: string[] } | null = null;
function getCharset(dictPath: string, blankIndex: number): string[] {
  if (_cachedCharset && _cachedCharset.path === dictPath) return _cachedCharset.charset;
  const charset = loadCharset(dictPath, blankIndex);
  _cachedCharset = { path: dictPath, charset };
  return charset;
}

const recSessionCache = new Map<string, unknown>();

/**
 * Pha 1 Task 5 (điều phối VRAM) — giấy phép theo modelPath. ⚠ `recSessionCache` KHÔNG có đường
 * đuổi nào trong sản xuất: session sống tới hết vòng đời tiến trình, nên giấy phép cũng vậy —
 * đó là ĐÚNG, không phải rò. Chỉ `_resetOcrCachesForTests()` mới trả chỗ.
 */
const recSessionVramTickets = new Map<string, import("../vram/vramWiring").VramTicket>();

async function getOnnxSession(modelPath: string): Promise<unknown> {
  const cached = recSessionCache.get(modelPath);
  if (cached) return cached;
  const ort = await import("onnxruntime-node");
  // Reuse the same EP resolution style as aiInferenceEngine (DirectML/CPU).
  const providers: string[] = [];
  const explicit = (process.env.AI_INFER_EP || "").toLowerCase().trim();
  if (explicit) {
    for (const p of explicit.split(/[,\s]+/).filter(Boolean)) {
      if (["tensorrt", "cuda", "dml", "cpu"].includes(p) && !providers.includes(p)) providers.push(p);
    }
  } else if (process.env.ENABLE_GPU === "true") {
    providers.push("dml");
  }
  if (!providers.includes("cpu")) providers.push("cpu");
  // Pha 1 Task 5 — CHỈ KHAI BÁO. Mức `production`: OCR đọc tem/nhãn/serial trên đường kiểm
  // tra AOI (spec §5.2). Telemetry hỏng ⇒ giấy phép rỗng, lượt tạo session vẫn chạy y nguyên.
  let vramTicket: import("../vram/vramWiring").VramTicket = {
    commitMeasured: async () => {},
    release: () => {},
  };
  try {
    const { beginVramAllocation } = await import("../vram/vramWiring");
    vramTicket = await beginVramAllocation({
      owner: `onnx-ocr:${modelPath}`,
      kind: "onnx-session",
      priority: "production",
      filePath: modelPath,
    });
  } catch {
    /* telemetry KHÔNG được làm hỏng đường tạo session */
  }
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: providers,
    graphOptimizationLevel: "all",
    // ⚠ `.catch()` để dòng `create(...)` đứng nguyên văn — xem ghi chú cùng loại ở
    // aiInferenceEngine.getSession(). Chỉ trả chỗ rồi ném lại NGUYÊN lỗi cũ.
  }).catch((err: unknown) => {
    vramTicket.release();
    throw err;
  });
  await vramTicket.commitMeasured();
  // Cùng lý do đã ghi ở aiInferenceEngine.getSession(): không có khoá in-flight ⇒ trả giấy
  // phép cũ trước khi ghi đè, không để nó treo trong sổ.
  recSessionVramTickets.get(modelPath)?.release();
  recSessionVramTickets.set(modelPath, vramTicket);
  recSessionCache.set(modelPath, session);
  return session;
}

/**
 * Preprocess to the REC input tensor: grayscale→RGB not needed; PaddleOCR rec
 * expects [1,3,H,W] normalized to [-1,1]. Resize keeping aspect to height H,
 * width clamped to [minW, maxW]. Returns the CHW float tensor + width.
 */
async function preprocessRec(
  image: Buffer,
  height: number,
): Promise<{ data: Float32Array; width: number }> {
  const sharp = (await import("sharp")).default as typeof sharpNs;
  const meta = await sharp(image).metadata();
  const srcW = meta.width ?? height;
  const srcH = meta.height ?? height;
  const ratio = srcW / Math.max(1, srcH);
  let w = Math.round(height * ratio);
  w = Math.max(16, Math.min(w, 1024));
  const raw = await sharp(image).resize(w, height, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const channels = 3;
  const tensor = new Float32Array(channels * height * w);
  const plane = height * w;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < channels; c++) {
      const v = raw[i * channels + c] / 255.0;
      tensor[c * plane + i] = (v - 0.5) / 0.5; // → [-1,1]
    }
  }
  return { data: tensor, width: w };
}

/** Run a single-line recognition on the whole (already-ROI) image. Never throws → degrade. */
async function recognizeSingleLine(image: Buffer, models: OcrModelPaths): Promise<OcrLine | null> {
  try {
    const ort = await import("onnxruntime-node");
    const session = (await getOnnxSession(models.recPath)) as {
      inputNames: string[];
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
    };
    const { data, width } = await preprocessRec(image, models.recHeight);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) return null;

    // Bound GPU concurrency via the shared semaphore (best-effort; direct run on failure).
    let out: Record<string, { data: Float32Array; dims: number[] }>;
    const feeds = { [inputName]: new (ort as any).Tensor("float32", data, [1, 3, models.recHeight, width]) };
    try {
      const { gpuSessionSemaphore } = await import("../aiInferenceEngine");
      out = await gpuSessionSemaphore.run(() => session.run(feeds));
    } catch {
      out = await session.run(feeds);
    }
    const o = out[outputName];
    if (!o) return null;
    const charset = getCharset(models.dictPath, models.blankIndex);
    const decoded = ctcGreedyDecode(o.data, o.dims, charset, { blankIndex: models.blankIndex, layout: "TC" });
    return { text: decoded.text, score: decoded.score };
  } catch {
    return null; // fail-safe: caller degrades honestly
  }
}

// ─── VLM fallback (honest confidence — never "high") ──────────────────────────

async function vlmExtract(image: Buffer, language: "en" | "vi" | "auto"): Promise<OcrResult> {
  try {
    const { describeImage } = await import("../aiProviderRouter");
    const prompt =
      language === "vi"
        ? "Hãy trích xuất CHÍNH XÁC mọi văn bản (chữ, số, mã serial, nhãn) hiển thị trong ảnh. Trả về NGUYÊN văn, mỗi dòng một dòng. Nếu không có chữ, trả về 'NO_TEXT'."
        : "Extract EXACTLY all visible text (letters, digits, serial numbers, labels) in the image. Return verbatim, one line per text block. If no text, return 'NO_TEXT'.";
    const r = await describeImage({
      image,
      prompt,
      language: language === "auto" ? "en" : language,
      maxTokens: 512,
      temperature: 0,
    });
    // Honest: vision sidecar off → degrade, do NOT fabricate.
    if (r.fallbackUsed) {
      return { ok: false, engine: "none", text: "", lines: [], confidence: 0, degraded: true, reason: "VISION_NOT_AVAILABLE" };
    }
    const text = r.text.trim() === "NO_TEXT" ? "" : r.text.trim();
    // A VLM has NO calibrated per-char score → confidence is NOT trustworthy.
    // Honest ceiling: 0 when empty, else a flat "uncertain" 0.5 — never inflated by length.
    const confidence = text.length === 0 ? 0 : 0.5;
    return {
      ok: true,
      engine: "vlm",
      text,
      lines: text ? [{ text, score: confidence }] : [],
      confidence,
      degraded: false,
      reason: "VLM_UNCALIBRATED_CONFIDENCE",
    };
  } catch {
    return { ok: false, engine: "none", text: "", lines: [], confidence: 0, degraded: true, reason: "OCR_VLM_ERROR" };
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Run OCR on an image. Precedence:
 *   1. ONNX models present → REAL engine (rec CTC; confidence from rec-score).
 *   2. Models absent + OCR_VLM_FALLBACK → VLM path (honest, uncalibrated confidence).
 *   3. Otherwise → HONEST degrade: OCR_MODEL_NOT_AVAILABLE (never fabricated).
 * Never throws.
 */
export async function runOcr(
  image: Buffer,
  opts: { language?: "en" | "vi" | "auto" } = {},
): Promise<OcrResult> {
  const language = opts.language ?? "auto";
  const models = ocrModelsAvailable() ? ocrModelPaths() : null;

  if (!models) {
    if (isVlmFallbackEnabled()) return vlmExtract(image, language);
    return {
      ok: false,
      engine: "none",
      text: "",
      lines: [],
      confidence: 0,
      degraded: true,
      reason: "OCR_MODEL_NOT_AVAILABLE",
    };
  }

  // ONNX path — single-line recognition on the (ROI) image.
  // (DET/multi-line is a follow-up; single-line covers serials/labels/tem which
  //  are the doc-44 §8.1 target. DET model path is resolved but not yet split.)
  const line = await recognizeSingleLine(image, models);
  if (!line) {
    return {
      ok: false,
      engine: "none",
      text: "",
      lines: [],
      confidence: 0,
      degraded: true,
      reason: "OCR_INFERENCE_FAILED",
    };
  }
  return {
    ok: true,
    engine: "onnx",
    text: line.text,
    lines: [line],
    confidence: line.score,
    degraded: false,
  };
}

/**
 * Kiểm tem/nhãn/barcode: đọc mã bằng OCR rồi so khớp với mã mong đợi.
 * pass/fail + similarity + confidence THẬT (rec-score). Degrade trung thực khi
 * model vắng mặt (pass=false, degraded=true, reason). Never throws.
 */
export async function checkLabel(
  image: Buffer,
  expected: string,
  opts: {
    mode?: "exact" | "levenshtein";
    minSimilarity?: number;
    normalize?: boolean;
    language?: "en" | "vi" | "auto";
  } = {},
): Promise<LabelCheckResult> {
  const ocr = await runOcr(image, { language: opts.language });
  const match = labelMatch(ocr.text, expected, {
    mode: opts.mode,
    minSimilarity: opts.minSimilarity,
    normalize: opts.normalize,
  });
  return {
    // A degraded read can NEVER pass — honest: no evidence, no pass.
    pass: ocr.degraded ? false : match.pass,
    engine: ocr.engine,
    recognized: ocr.text,
    expected,
    matchMode: match.matchMode,
    similarity: match.similarity,
    distance: match.distance,
    confidence: ocr.confidence, // REAL rec-score, not string length
    degraded: ocr.degraded,
    reason: ocr.reason,
  };
}

/** Test seam — clear the cached ONNX sessions / charset. */
export function _resetOcrCachesForTests(): void {
  recSessionCache.clear();
  // Pha 1 Task 5 — dọn cả sổ, nếu không test sau thấy giấy phép của test trước.
  for (const t of recSessionVramTickets.values()) {
    try {
      t.release();
    } catch {
      /* best-effort */
    }
  }
  recSessionVramTickets.clear();
  _cachedCharset = null;
}
