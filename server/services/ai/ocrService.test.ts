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
  dbTimHop,
  xepThuTuDoc,
  runOcrTrang,
  boChuThieuDauViet,
  ocrModelPaths,
} from "./ocrService";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SAVED = { ...process.env };
beforeEach(() => {
  _resetOcrCachesForTests();
});
afterEach(() => {
  for (const k of ["OCR_ENGINE_ENABLED", "OCR_VLM_FALLBACK", "OCR_ONNX_REC_MODEL", "OCR_ONNX_DICT", "OCR_MODEL_DIR", "OCR_ONNX_DET_MODEL"]) {
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

// ═══ R4 (2026-09-23) — OCR TRANG: DET (DBNet) → từng dòng → REC ═══════════════════════════════════════════════
// ĐỘT BIẾN PHẢI BẮT: không nở hộp · gom hai dòng làm một · bỏ ngưỡng điểm hộp · xếp sai thứ tự đọc ·
// kbPdfOcr quay về runOcr một dòng (lưới ở kbPdfOcr.test) · coi bộ chữ latin là đủ dấu tiếng Việt.

/** Bản đồ W×H toàn 0, tô các hình chữ nhật [x,y,w,h,giaTri]. */
function banDo(W: number, H: number, chuNhat: [number, number, number, number, number][]): Float32Array {
  const m = new Float32Array(W * H);
  for (const [x, y, w, h, v] of chuNhat) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m[j * W + i] = v;
  return m;
}

describe("dbTimHop — hậu xử lý DBNet (thuần)", () => {
  it("hai dòng tách rời ⇒ HAI hộp, mỗi hộp NỞ ra quanh vùng lõi (unclip d = S·1.5/C)", () => {
    const hops = dbTimHop(banDo(200, 60, [[20, 10, 100, 8, 0.9], [20, 40, 60, 8, 0.9]]), 200, 60);
    expect(hops).toHaveLength(2);
    // lõi 100×8 ⇒ d = 800·1.5/216 ≈ 5.6 ⇒ hộp phủ rộng hơn lõi ở MỌI phía
    const [a] = hops.sort((p, q) => p.y - q.y);
    expect(a.x).toBeLessThan(20);
    expect(a.y).toBeLessThan(10);
    expect(a.x + a.w).toBeGreaterThan(120);
    expect(a.y + a.h).toBeGreaterThan(18);
    expect(a.score).toBeGreaterThan(0.85);
  });

  it("dưới ngưỡng nhị phân ⇒ không hộp; điểm hộp < 0.6 ⇒ bỏ; cạnh < 3 px ⇒ bỏ (nhiễu)", () => {
    expect(dbTimHop(banDo(100, 40, [[10, 10, 50, 8, 0.25]]), 100, 40)).toEqual([]);
    expect(dbTimHop(banDo(100, 40, [[10, 10, 50, 8, 0.45]]), 100, 40)).toEqual([]);
    expect(dbTimHop(banDo(100, 40, [[10, 10, 50, 2, 0.95]]), 100, 40)).toEqual([]);
    expect(dbTimHop(banDo(100, 40, [[10, 10, 50, 8, 0.95]]), 100, 40)).toHaveLength(1);
  });

  it("chạm nhau theo đường chéo ⇒ MỘT thành phần (8 hướng); bản đồ ngắn hơn W×H ⇒ [] thay vì đọc lố", () => {
    const m = banDo(40, 40, [[5, 5, 10, 10, 0.9], [15, 15, 10, 10, 0.9]]);
    expect(dbTimHop(m, 40, 40, { nguongHop: 0.3 })).toHaveLength(1);
    expect(dbTimHop(new Float32Array(10), 40, 40)).toEqual([]);
  });
});

describe("xepThuTuDoc — thứ tự đọc (thuần)", () => {
  it("gom cùng hàng theo tâm dọc, hàng trên xuống, trong hàng trái sang", () => {
    const b = (x: number, y: number, h = 20) => ({ x, y, w: 50, h });
    const hang = xepThuTuDoc([b(300, 102), b(10, 200), b(10, 100), b(150, 98)]);
    expect(hang.map((r) => r.map((h) => h.x))).toEqual([[10, 150, 300], [10]]);
  });
});

describe("boChuThieuDauViet — chỉ bộ chữ báo được mất dấu, điểm rec thì không", () => {
  it("bộ chữ không có ư/ơ/ạ… ⇒ true; có đủ ⇒ false; không có model ⇒ null", () => {
    const thu = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-dict-"));
    try {
      fs.writeFileSync(path.join(thu, "rec.onnx"), "x");
      fs.writeFileSync(path.join(thu, "ppocr_keys.txt"), ["a", "b", "á", "à", "đ"].join("\n"));
      process.env.OCR_MODEL_DIR = thu;
      _resetOcrCachesForTests();
      expect(boChuThieuDauViet()).toBe(true);
      fs.writeFileSync(path.join(thu, "ppocr_keys.txt"), ["a", "ư", "ơ", "ă", "ạ", "ả", "ế", "ộ", "ữ", "ỳ"].join("\n"));
      _resetOcrCachesForTests();
      expect(boChuThieuDauViet()).toBe(false);
      process.env.OCR_MODEL_DIR = "d:/__nonexistent_ocr_models__";
      expect(boChuThieuDauViet()).toBeNull();
    } finally {
      fs.rmSync(thu, { recursive: true, force: true });
    }
  });
});

// Chạy model THẬT khi models/ocr có đủ DET+REC (máy phát triển; *.onnx không vào git ⇒ CI bỏ qua, không xanh giả).
const coModelThat = (() => {
  try {
    const m = ocrModelPaths();
    return !!m.detPath && fs.existsSync(m.recPath) && fs.existsSync(m.dictPath);
  } catch {
    return false;
  }
})();

describe.skipIf(!coModelThat)("runOcrTrang — model THẬT trên trang dựng sẵn", () => {
  const DONG = ["Quy trinh bao tri may AOI", "Buoc 1: Tat nguon may va cho 5 phut.", "Ma loi E082: ap suat khi nen thap."];
  async function trang(dong: string[]): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    const chu = dong.map((d, i) => `<text x="90" y="${150 + i * 90}" font-family="Arial" font-size="34">${d}</text>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1654" height="900"><rect width="100%" height="100%" fill="#fff"/>${chu}</svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  it("★ ba dòng ⇒ ba dòng ĐÚNG THỨ TỰ, mỗi dòng giống bản gốc ≥ 0.9; runOcr một dòng trên cùng ảnh thì KHÔNG đọc được", async () => {
    const anh = await trang(DONG);
    const r = await runOcrTrang(anh);
    expect(r.ok).toBe(true);
    expect(r.engine).toBe("onnx");
    const doc = r.text.split("\n");
    expect(doc).toHaveLength(3);
    DONG.forEach((d, i) => expect(similarityRatio(doc[i], d), `dòng ${i}: "${doc[i]}"`).toBeGreaterThanOrEqual(0.9));
    // Đối chứng = lỗi sống 2026-09-23: bản một dòng ép cả trang về cao 48 px.
    const motDong = await runOcr(anh);
    expect(similarityRatio(motDong.text, DONG.join(" "))).toBeLessThan(0.5);
  }, 60_000);

  it("trang TRẮNG ⇒ ok, 0 dòng, chữ rỗng — không bịa", async () => {
    const r = await runOcrTrang(await trang([]));
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([]);
    expect(r.text).toBe("");
    expect(r.confidence).toBe(0);
  }, 60_000);
});
