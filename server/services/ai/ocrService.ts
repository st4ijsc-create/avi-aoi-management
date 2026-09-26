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
// ★★★ Pha 2B Task 5 — vị từ "lỗi này có phải LỜI TỪ CHỐI không". Import TĨNH của một module
// LÁ (không import gì, không I/O): nó phải dùng được NGAY TRONG `catch` của một lượt
// `await import()` vừa hỏng. Xem `vramRefusalSignal.ts` để biết vì sao so TÊN, không `instanceof`.
import { isVramRefusal } from "../vram/vramRefusalSignal";
import { sessionCacheMax } from "../vram/vramCaps";
import type sharpNs from "sharp";
import { cheDoNhanDang } from "./ocrVietOcr"; // module LÁ (chỉ fs/path) — dùng được trong hàm đồng bộ

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

// ─── PURE: DB (DBNet) hậu xử lý — bản đồ xác suất → hộp dòng chữ ──────────────

/** Một hộp chữ trên hệ toạ độ của bản đồ xác suất (trục thẳng — tài liệu quét gần như không nghiêng). */
export interface HopChu {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Trung bình xác suất trong hình chữ nhật bao (cách tính "fast" của PaddleOCR) — 0..1. */
  score: number;
}

/**
 * ★ R4 (2026-09-23) — hậu xử lý DBNet, THUẦN: ngưỡng hoá `prob` (H×W, hàng trước) ở `nguong`, gom thành phần
 * liên thông 8 hướng, lấy hình chữ nhật bao, bỏ hộp có cạnh < `canhMin` hoặc điểm < `nguongHop`, rồi NỞ hộp
 * (unclip) một khoảng d = diện tích·`noRong`/chu vi — đúng công thức PaddleOCR, vì DBNet học vùng CO LẠI của
 * dòng chữ; không nở thì rec cắt mất nét trên/dưới. Mặc định = mặc định PaddleOCR (0.3 / 0.6 / 1.5).
 */
export function dbTimHop(
  prob: Float32Array | number[],
  W: number,
  H: number,
  opts: { nguong?: number; nguongHop?: number; noRong?: number; canhMin?: number } = {},
): HopChu[] {
  const nguong = opts.nguong ?? 0.3;
  const nguongHop = opts.nguongHop ?? 0.6;
  const noRong = opts.noRong ?? 1.5;
  const canhMin = opts.canhMin ?? 3;
  if (W <= 0 || H <= 0 || prob.length < W * H) return [];
  const daXet = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const hops: HopChu[] = [];
  for (let start = 0; start < W * H; start++) {
    if (daXet[start] || Number(prob[start]) <= nguong) continue;
    let top = 0;
    stack[top++] = start;
    daXet[start] = 1;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    while (top > 0) {
      const p = stack[--top];
      const px = p % W;
      const py = (p - px) / W;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (!daXet[q] && Number(prob[q]) > nguong) {
            daXet[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (Math.min(w, h) < canhMin) continue;
    let tong = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tong += Number(prob[y * W + x]);
    const score = tong / (w * h);
    if (score < nguongHop) continue;
    const d = (w * h * noRong) / (2 * (w + h));
    const nx0 = Math.max(0, Math.floor(x0 - d));
    const ny0 = Math.max(0, Math.floor(y0 - d));
    const nx1 = Math.min(W - 1, Math.ceil(x1 + d));
    const ny1 = Math.min(H - 1, Math.ceil(y1 + d));
    hops.push({ x: nx0, y: ny0, w: nx1 - nx0 + 1, h: ny1 - ny0 + 1, score: Number(score.toFixed(4)) });
  }
  return hops;
}

/**
 * Xếp hộp theo THỨ TỰ ĐỌC: gom thành HÀNG (hai hộp cùng hàng khi tâm dọc của hộp sau nằm trong nửa chiều cao
 * của hàng), hàng từ trên xuống, trong hàng từ trái sang. Thuần.
 */
export function xepThuTuDoc<T extends { x: number; y: number; w: number; h: number }>(hops: T[]): T[][] {
  const theoY = [...hops].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  const hang: T[][] = [];
  for (const hop of theoY) {
    const tam = hop.y + hop.h / 2;
    const cuoi = hang[hang.length - 1];
    if (cuoi) {
      const tamHang = cuoi.reduce((s, b) => s + b.y + b.h / 2, 0) / cuoi.length;
      const caoHang = cuoi.reduce((s, b) => s + b.h, 0) / cuoi.length;
      if (Math.abs(tam - tamHang) <= Math.min(caoHang, hop.h) / 2) {
        cuoi.push(hop);
        continue;
      }
    }
    hang.push([hop]);
  }
  return hang.map((r) => r.sort((a, b) => a.x - b.x));
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

/**
 * ★ R4 (2026-09-23) — bộ chữ CTC có ĐỦ dấu tiếng Việt không. Đo sống: model latin PP-OCRv5 (bộ chữ 500 ký tự,
 * không có ư/ơ/ạ/ế/ộ…) đọc "Bảo trì … thiếc" thành "bo trì … thiéc" — ký tự ngoài bộ chữ bị RƠI hoặc thay
 * bằng họ hàng gần, mà điểm rec vẫn 0.97 ⇒ ĐIỂM TIN CẬY KHÔNG BÁO ĐƯỢC LỖI NÀY; chỉ bộ chữ báo được.
 * `null` = không có model để hỏi. Never throws.
 */
export function boChuThieuDauViet(): boolean | null {
  try {
    if (!ocrModelsAvailable()) return null;
    // ★ OCR trang đọc dòng bằng VietOCR (đủ 178 chữ) ở chế độ vietocr/tu-dong ⇒ bộ chữ paddle không còn quyết định
    //   việc mất dấu của tài liệu nạp. Cảnh báo `ocr-mat-dau` chỉ còn đúng khi paddle là bộ đọc dòng.
    if (cheDoNhanDang() !== "paddle") return false;
    const { dictPath, blankIndex } = ocrModelPaths();
    const bo = new Set(getCharset(dictPath, blankIndex));
    return !["ư", "ơ", "ă", "ạ", "ả", "ế", "ộ", "ữ", "ỳ"].every((c) => bo.has(c));
  } catch {
    return null;
  }
}

// ─── ONNX inference (lazy — never imported unless models exist & flag on) ─────

let _cachedCharset: { path: string; charset: string[] } | null = null;
function getCharset(dictPath: string, blankIndex: number): string[] {
  if (_cachedCharset && _cachedCharset.path === dictPath) return _cachedCharset.charset;
  const charset = loadCharset(dictPath, blankIndex);
  _cachedCharset = { path: dictPath, charset };
  return charset;
}

/**
 * ★★★ Pha 2B Task 7 (§8) — **KHO NÀY ĐÃ VÀO DƯỚI BROKER.**
 *
 * Trước task này nó là một `Map` **KHÔNG GIỚI HẠN**, và docstring cũ ngay tại đây khẳng định
 * *"session sống tới hết vòng đời tiến trình — đó là ĐÚNG, không phải rò"*. Câu đó đúng về **vòng
 * đời** và sai về **hậu quả**: mỗi `modelPath` OCR mới thêm một giấy phép **vĩnh viễn** vào sổ, nên
 * `headroom` của toàn hệ **chỉ có giảm**, không bao giờ hồi — một cái rò theo nghĩa SỔ, dù không
 * phải rò theo nghĩa bộ nhớ. Nay nó dùng **cùng trần `AI_SESSION_CACHE_MAX`** với kho phiên của
 * `aiInferenceEngine` (một người đọc duy nhất: `vram/vramCaps.ts`), đuổi LRU, và **trả giấy phép**
 * khi đuổi.
 *
 * ⚠⚠ LƯỢT ĐUỔI NÀY **KHÔNG CHỨNG MINH ĐƯỢC THIẾT BỊ ĐÃ NHẢ** — cùng ca với
 * `aiInferenceEngine.LruSessionCache`: gỡ tham chiếu JS không gọi `ort.InferenceSession.release()`,
 * và gọi `release()` dưới chân một `session.run` đang bay là ABORT ở tầng native. Vì vậy hộ này
 * **KHÔNG khai `reclaimer`** ⇒ `preempt()` không bao giờ chạm tới nó và câu từ chối không bao giờ
 * cộng nó vào "tổng nhường được". Việc task này làm là **chặn nó phình vô hạn**, không phải biến
 * nó thành thu-hồi-được. (Giấy phép vẫn khai `releaseProof` mặc định như trước — xem
 * `getOnnxSession()`.)
 */
const recSessionCache = new Map<string, unknown>();

/** Pha 1 Task 5 (điều phối VRAM) — giấy phép theo modelPath, vòng đời khớp `recSessionCache`. */
const recSessionVramTickets = new Map<string, import("../vram/vramWiring").VramTicket>();

/** Trả giấy phép của một phiên rời kho. KHÔNG BAO GIỜ ném. */
function traGiayPhepPhien(key: string): void {
  try {
    const t = recSessionVramTickets.get(key);
    if (!t) return;
    recSessionVramTickets.delete(key);
    t.release();
  } catch {
    /* telemetry KHÔNG được làm hỏng vòng đời cache */
  }
}

/**
 * Đuổi LRU cho tới khi kho vừa trần. `Map` của JS giữ **thứ tự chèn**, nên phần tử đầu tiên là cũ
 * nhất — cùng kỹ thuật `LruSessionCache` của `aiInferenceEngine` dùng.
 * ⚠ `guard`: một vòng `while` trên một trần đọc được từ `.env` là một vòng lặp vô tận chờ một
 * cấu hình hỏng; trần đã được kẹp ở `vramCaps` nhưng lưới này rẻ hơn một lời tin.
 */
function donKhoPhienOcr(): void {
  const tran = Math.max(1, sessionCacheMax());
  let guard = 0;
  while (recSessionCache.size > tran && guard++ <= recSessionCache.size) {
    const cuNhat = recSessionCache.keys().next().value;
    if (cuNhat === undefined) break;
    recSessionCache.delete(cuNhat);
    traGiayPhepPhien(cuNhat);
  }
}

async function getOnnxSession(modelPath: string): Promise<unknown> {
  const cached = recSessionCache.get(modelPath);
  if (cached) {
    // ★ Task 7 — chạm vào = đẩy xuống cuối (mới dùng nhất), để trần LRU đuổi ĐÚNG kẻ cũ nhất.
    recSessionCache.delete(modelPath);
    recSessionCache.set(modelPath, cached);
    return cached;
  }
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
    noteRefCount: () => {},
  };
  try {
    const { beginVramAllocation } = await import("../vram/vramWiring");
    vramTicket = await beginVramAllocation({
      owner: `onnx-ocr:${modelPath}`,
      kind: "onnx-session",
      priority: "production",
      filePath: modelPath,
    });
  } catch (err) {
    // ★★★ Pha 2B Task 5 — TỪ CHỐI ≠ TELEMETRY HỎNG: nuốt ở đây là TẮT cưỡng chế tại điểm gọi này.
    if (isVramRefusal(err)) throw err;
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
  traGiayPhepPhien(modelPath);
  recSessionVramTickets.set(modelPath, vramTicket);
  // Ghi lại cuối map = "vừa dùng" (thứ tự chèn của `Map` chính là thứ tự LRU).
  recSessionCache.delete(modelPath);
  recSessionCache.set(modelPath, session);
  // ★ Task 7 — vào dưới trần `AI_SESSION_CACHE_MAX`. Trước đây kho này phình VÔ HẠN.
  donKhoPhienOcr();
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
async function recognizeSingleLine(image: Buffer, models: OcrModelPaths, choPhepViet = false): Promise<OcrLine | null> {
  // ★ Tiếng Việt (2026-09-23): chọn bộ đọc dòng theo `cheDoNhanDang()` — paddle | vietocr | tu-dong (mặc định khi đủ
  //   tệp VietOCR: chạy cả hai, lấy VietOCR chỉ khi dòng mang chữ Việt). Lý do và số đo: `ocrVietOcr.ts`.
  //   DET (tìm dòng) KHÔNG đổi — chỉ bộ đọc từng dòng.
  const { cheDoNhanDang, nhanDangDongViet, chonDong } = await import("./ocrVietOcr");
  // ⚠ CHỈ OCR TRANG (nạp tài liệu, ngoại tuyến) được dùng VietOCR: `runOcr` một dòng là đường đọc NHÃN trên dây chuyền,
  //   nơi +~5 s/dòng là không chấp nhận được và nhãn là mã/số Latin (paddle 0,992 > vietocr 0,958).
  const cheDo = choPhepViet ? cheDoNhanDang() : "paddle";
  if (cheDo === "vietocr") return nhanDangDongViet(image);
  if (cheDo === "tu-dong") {
    const [paddle, viet] = [await nhanDangDongPaddle(image, models), await nhanDangDongViet(image)];
    return chonDong(paddle, viet);
  }
  return nhanDangDongPaddle(image, models);
}

async function nhanDangDongPaddle(image: Buffer, models: OcrModelPaths): Promise<OcrLine | null> {
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
  } catch (err) {
    /**
     * ★★ M-6 (review vòng 1) — MỘT LỜI TỪ CHỐI MỨC `production` KHÔNG ĐƯỢC SUY BIẾN **IM LẶNG**.
     *
     * `getOnnxSession()` ngay trên nay ném `VramRefusedError` (cổng sổ, Pha 2B Task 5), và `catch`
     * này nuốt nó **một tầng bên trên** cái `catch` đã được dạy ⇒ OCR trả rỗng, người trực thấy
     * "đọc không ra chữ" và đi soi ảnh/ánh sáng/mã vạch, trong khi nguyên nhân thật là **hết VRAM**.
     * Chiều AN TOÀN (không cấp phát byte nào), nhưng mất hẳn tín hiệu — đúng lớp *"suy biến im
     * lặng"* mà §5.5 tồn tại để diệt.
     *
     * ⚠ VẪN GIỮ HỢP ĐỒNG *"Never throws → degrade"* (khai ngay ở docstring, và OCR là đường
     * `production`: một cú ném ở đây làm hỏng cả lượt kiểm thay vì chỉ mất một dòng chữ). Việc phải
     * làm là **CÓ TIẾNG**, không phải đổi luồng.
     */
    if (isVramRefusal(err)) {
      console.warn(
        `[ocrService] cổng SỔ TỪ CHỐI giấy phép VRAM cho session OCR (mức production) ⇒ lượt đọc ` +
          `này trả RỖNG. Đây KHÔNG phải ảnh xấu hay charset sai: ${(err as Error)?.message ?? String(err)}`,
      );
    }
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

// ─── Trang tài liệu: DET (DBNet) → cắt từng dòng → REC ─────────────────────────

/** Cạnh dài tối đa của ảnh đưa vào DET (bội 32). Trang A4 200 dpi ≈ 1654×2339 ⇒ thu về 1152×1632. */
function detCanhMax(): number {
  const n = Number(process.env.OCR_DET_MAX_SIDE ?? 1632);
  return Number.isFinite(n) && n >= 64 ? Math.floor(n) : 1632;
}

/** PaddleOCR `drop_score`: dòng rec dưới ngưỡng này bị bỏ (thường là nhiễu DET — viền, khung, vết bẩn). */
function recDiemMin(): number {
  const n = Number(process.env.OCR_REC_MIN_SCORE ?? 0.5);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
}

/**
 * Chạy DET trên cả ảnh ⇒ hộp dòng chữ trên toạ độ ẢNH GỐC. `null` = DET hỏng (khác "0 hộp" = trang trắng).
 * Tiền xử lý đúng PaddleOCR: thu cạnh dài về ≤ `detCanhMax()`, làm tròn mỗi cạnh về bội 32, chuẩn hoá
 * mean/std ImageNet theo thứ tự kênh BGR (Paddle đọc ảnh bằng cv2).
 */
async function timHopChu(
  image: Buffer,
  models: OcrModelPaths,
): Promise<{ hops: HopChu[]; srcW: number; srcH: number } | null> {
  if (!models.detPath) return null;
  try {
    const sharp = (await import("sharp")).default as typeof sharpNs;
    const ort = await import("onnxruntime-node");
    const meta = await sharp(image).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (srcW < 8 || srcH < 8) return { hops: [], srcW, srcH };
    const tiLe = Math.min(1, detCanhMax() / Math.max(srcW, srcH));
    const W = Math.max(32, Math.round((srcW * tiLe) / 32) * 32);
    const H = Math.max(32, Math.round((srcH * tiLe) / 32) * 32);
    const raw = await sharp(image).resize(W, H, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const plane = W * H;
    const tensor = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        const v = raw[i * 3 + (2 - c)] / 255; // kênh c của tensor = B,G,R
        tensor[c * plane + i] = (v - mean[c]) / std[c];
      }
    }
    const session = (await getOnnxSession(models.detPath)) as {
      inputNames: string[];
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
    };
    const feeds = { [session.inputNames[0]]: new (ort as any).Tensor("float32", tensor, [1, 3, H, W]) };
    let out: Record<string, { data: Float32Array; dims: number[] }>;
    try {
      const { gpuSessionSemaphore } = await import("../aiInferenceEngine");
      out = await gpuSessionSemaphore.run(() => session.run(feeds));
    } catch {
      out = await session.run(feeds);
    }
    const o = out[session.outputNames[0]];
    if (!o) return null;
    const oH = o.dims[o.dims.length - 2];
    const oW = o.dims[o.dims.length - 1];
    const sx = srcW / oW;
    const sy = srcH / oH;
    const hops = dbTimHop(o.data, oW, oH).map((b) => {
      const x = Math.max(0, Math.floor(b.x * sx));
      const y = Math.max(0, Math.floor(b.y * sy));
      return {
        x,
        y,
        w: Math.min(srcW - x, Math.ceil(b.w * sx)),
        h: Math.min(srcH - y, Math.ceil(b.h * sy)),
        score: b.score,
      };
    });
    return { hops: hops.filter((b) => b.w >= 4 && b.h >= 4), srcW, srcH };
  } catch (err) {
    if (isVramRefusal(err)) {
      console.warn(
        `[ocrService] cổng SỔ TỪ CHỐI giấy phép VRAM cho session DET (mức production) ⇒ trang này trả RỖNG: ` +
          `${(err as Error)?.message ?? String(err)}`,
      );
    }
    return null;
  }
}

/**
 * ★ R4 (2026-09-23) — OCR MỘT TRANG TÀI LIỆU (nhiều dòng). `runOcr` chỉ nhận dạng MỘT dòng trên cả ảnh (đúng
 * cho tem/serial đã cắt ROI); đưa nguyên trang A4 vào đó thì rec ép cả trang về cao 48 px ⇒ trả "" — đo sống
 * 2026-09-23: OCR PDF quét "chạy" mà 0 chữ. Ở đây: DET tìm từng dòng → cắt → REC từng dòng → ghép theo thứ tự
 * đọc (hàng cách nhau `\n`, hộp cùng hàng cách nhau dấu cách). Dòng rec < `OCR_REC_MIN_SCORE` bị bỏ.
 * Không có model DET ⇒ lùi về `runOcr` (một dòng) — trung thực, vì với ảnh đã là một dòng thì đó là đúng.
 * Never throws.
 */
export async function runOcrTrang(
  image: Buffer,
  opts: { language?: "en" | "vi" | "auto" } = {},
): Promise<OcrResult> {
  const models = ocrModelsAvailable() ? ocrModelPaths() : null;
  if (!models || !models.detPath) return runOcr(image, opts);
  const det = await timHopChu(image, models);
  if (!det) {
    return { ok: false, engine: "none", text: "", lines: [], confidence: 0, degraded: true, reason: "OCR_DET_FAILED" };
  }
  const sharp = (await import("sharp")).default as typeof sharpNs;
  const diemMin = recDiemMin();
  const hang: OcrLine[][] = [];
  for (const r of xepThuTuDoc(det.hops)) {
    const dong: OcrLine[] = [];
    for (const b of r) {
      let cat: Buffer;
      try {
        cat = await sharp(image).extract({ left: b.x, top: b.y, width: b.w, height: b.h }).png().toBuffer();
      } catch {
        continue;
      }
      const line = await recognizeSingleLine(cat, models, true);
      if (line && line.text.trim() && line.score >= diemMin) {
        dong.push({ text: line.text.trim(), score: line.score, box: { x: b.x, y: b.y, w: b.w, h: b.h } });
      }
    }
    if (dong.length) hang.push(dong);
  }
  const lines = hang.flat();
  const confidence = lines.length ? Number((lines.reduce((s, l) => s + l.score, 0) / lines.length).toFixed(4)) : 0;
  return {
    ok: true,
    engine: "onnx",
    text: hang.map((d) => d.map((l) => l.text).join(" ")).join("\n"),
    lines,
    confidence,
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
