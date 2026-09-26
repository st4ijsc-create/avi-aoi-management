/**
 * ★ Mục mở 1 của báo cáo training (2026-09-23) — BỘ NHẬN DẠNG DÒNG TIẾNG VIỆT (VietOCR `vgg_transformer`, ONNX).
 *
 * VÌ SAO: model rec PaddleOCR đang cài (`latin_PP-OCRv5`) THIẾU 99/178 chữ cái tiếng Việt (ă ơ ư ạ ế ộ…; đo bằng
 * so từ điển, 2026-09-23 — `chinese` thiếu 108, `english` 102), nên chữ có dấu bị rơi/đổi mà điểm tin cậy vẫn 0,97.
 * Không bộ PaddleOCR ONNX nào có sẵn phủ tiếng Việt. VietOCR (pbcquoc/vietocr, Apache‑2.0) có từ vựng ĐỦ 178 chữ.
 *
 * Nguồn trọng số: bản xuất ONNX `vemines/vietocr-onnx` (encoder `img[1,3,32,W]→memory[T,B,256]`, decoder
 * `tgt[L,B] int64 + memory → output`). ONNX là DỮ LIỆU (không chạy mã như pickle); hình dạng vào/ra đã kiểm bằng
 * onnxruntime trước khi viết tệp này. Tệp model KHÔNG vào git (`models/ocr/vietocr/`).
 *
 * Tiền xử lý = `vietocr.tool.translate.process_image`: cao 32, rộng tỉ lệ làm tròn LÊN bội 10, kẹp [32, 512],
 * RGB/255 (không chuẩn hoá mean/std — khác PaddleOCR). Từ vựng: 0 pad · 1 bắt đầu · 2 kết thúc · 3 mask · ký tự từ 4.
 * Giải mã tham lam tối đa 128 bước. Điểm = trung bình xác suất softmax lớn nhất mỗi bước (THẬT, không bịa).
 *
 * Không ném: mọi lỗi ⇒ `null` (người gọi suy biến trung thực), đúng hợp đồng `recognizeSingleLine`.
 */
import fs from "node:fs";
import path from "node:path";

export interface DongViet {
  text: string;
  score: number;
}

const PAD = 0;
const BAT_DAU = 1;
const KET_THUC = 2;
const LECH_KY_TU = 4;
const CAO = 32;
const RONG_MIN = 32;
const RONG_MAX = 512;
const BUOC_MAX = 128;

export function thuMucVietOcr(): string {
  return process.env.OCR_VIETOCR_DIR
    ? path.resolve(process.env.OCR_VIETOCR_DIR)
    : path.resolve(process.cwd(), "models", "ocr", "vietocr");
}

export function coVietOcr(): boolean {
  const d = thuMucVietOcr();
  return ["vgg_encoder.onnx", "vgg_decoder.onnx", "vocab.json"].every((f) => fs.existsSync(path.join(d, f)));
}

export type CheDoNhanDang = "paddle" | "vietocr" | "tu-dong";

/**
 * Chế độ nhận dạng dòng. `OCR_REC_ENGINE` = paddle | vietocr | tu-dong; vắng ⇒ **tu-dong khi đủ tệp VietOCR**, ngược
 * lại paddle (máy không có tệp model giữ nguyên hành vi cũ). Số đo quyết định mặc định (A/B cùng DET, 2026-09-23):
 *   tiếng Việt   : paddle 0,850 · vietocr 0,979   (paddle rơi dấu mà tin cậy 0,96)
 *   Anh/mã/số    : paddle 0,992 · vietocr 0,958   (vietocr bịa "It Is", đọc "@"→"O", "<="→"k-")
 * ⇒ không bộ nào thắng cả hai; `tu-dong` chạy CẢ HAI trên từng dòng và chọn theo `coChuViet`.
 */
export function cheDoNhanDang(): CheDoNhanDang {
  const v = (process.env.OCR_REC_ENGINE ?? "").toLowerCase().trim();
  if (v === "paddle") return "paddle";
  if (v === "vietocr") return coVietOcr() ? "vietocr" : "paddle";
  if (v === "tu-dong" || v === "") return coVietOcr() ? "tu-dong" : "paddle";
  return "paddle";
}

/** Giữ tên cũ cho người gọi: `true` ⇔ VietOCR được dùng ở dạng nào đó. */
export function dungVietOcr(): boolean {
  return cheDoNhanDang() !== "paddle";
}

/** Chữ cái RIÊNG của tiếng Việt (không có trong tiếng Anh): ă â đ ê ô ơ ư và mọi chữ mang dấu thanh. Hàm THUẦN. */
const CHU_VIET = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i;
export function coChuViet(s: string): boolean {
  return CHU_VIET.test(s);
}

/**
 * Chọn kết quả của chế độ tu-dong. Hàm THUẦN. Dòng VietOCR mang chữ Việt ⇒ lấy VietOCR (paddle chắc chắn rơi dấu ở
 * đó); ngược lại lấy paddle (chính xác hơn trên chữ Latin không dấu, mã, số). Một bên hỏng ⇒ lấy bên còn lại.
 */
export function chonDong<T extends { text: string; score: number }>(paddle: T | null, viet: T | null): T | null {
  if (!viet) return paddle;
  if (!paddle) return viet;
  return coChuViet(viet.text) ? viet : paddle;
}

/** Rộng đầu vào theo đúng `process_image` của VietOCR. Hàm THUẦN. */
export function rongVietOcr(w: number, h: number): number {
  const moi = Math.floor((CAO * Math.max(1, w)) / Math.max(1, h));
  const tron = Math.ceil(moi / 10) * 10;
  return Math.min(RONG_MAX, Math.max(RONG_MIN, tron));
}

/** Chuỗi chỉ số ⇒ văn bản (bỏ pad/bắt đầu/kết thúc/mask). Hàm THUẦN. */
export function giaiMaChiSo(ids: readonly number[], vocab: string): string {
  let s = "";
  for (const i of ids) {
    if (i === KET_THUC) break;
    if (i < LECH_KY_TU) continue;
    const c = vocab[i - LECH_KY_TU];
    if (c !== undefined) s += c;
  }
  return s;
}

let phien: { enc: any; dec: any; vocab: string } | null = null;
async function layPhien(): Promise<{ enc: any; dec: any; vocab: string }> {
  if (phien) return phien;
  const ort = (await import("onnxruntime-node")) as any;
  const d = thuMucVietOcr();
  const vocab = JSON.parse(fs.readFileSync(path.join(d, "vocab.json"), "utf8")) as string;
  const enc = await ort.InferenceSession.create(path.join(d, "vgg_encoder.onnx"));
  const dec = await ort.InferenceSession.create(path.join(d, "vgg_decoder.onnx"));
  phien = { enc, dec, vocab };
  return phien;
}

/** Softmax của một hàng logit ⇒ (chỉ số lớn nhất, xác suất của nó). Hàm THUẦN. */
export function argmaxSoftmax(logits: ArrayLike<number>, tu: number, dai: number): { i: number; p: number } {
  let max = -Infinity;
  let im = 0;
  for (let k = 0; k < dai; k++) {
    const v = logits[tu + k];
    if (v > max) { max = v; im = k; }
  }
  let tong = 0;
  for (let k = 0; k < dai; k++) tong += Math.exp(logits[tu + k] - max);
  return { i: im, p: 1 / tong };
}

export async function nhanDangDongViet(image: Buffer): Promise<DongViet | null> {
  try {
    const ort = (await import("onnxruntime-node")) as any;
    const sharp = (await import("sharp")).default;
    const { enc, dec, vocab } = await layPhien();
    const meta = await sharp(image).metadata();
    const w = rongVietOcr(meta.width ?? CAO, meta.height ?? CAO);
    const raw = await sharp(image).resize(w, CAO, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
    const mat = CAO * w;
    const x = new Float32Array(3 * mat);
    for (let i = 0; i < mat; i++) for (let c = 0; c < 3; c++) x[c * mat + i] = raw[i * 3 + c] / 255;
    const memory = (await enc.run({ img: new ort.Tensor("float32", x, [1, 3, CAO, w]) })).memory;

    const ids: number[] = [BAT_DAU];
    const xs: number[] = [];
    for (let b = 0; b < BUOC_MAX; b++) {
      const tgt = new ort.Tensor("int64", BigInt64Array.from(ids.map((v) => BigInt(v))), [ids.length, 1]);
      const out = (await dec.run({ tgt, memory })).output as { data: Float32Array; dims: number[] };
      const V = out.dims[out.dims.length - 1];
      // Hình dạng ra có thể là [B, L, V] hoặc [L, B, V] tuỳ bản xuất; B = 1 nên bước CUỐI luôn là V phần tử cuối.
      const { i, p } = argmaxSoftmax(out.data, out.data.length - V, V);
      if (i === KET_THUC || i === PAD) break;
      ids.push(i);
      xs.push(p);
    }
    const text = giaiMaChiSo(ids.slice(1), vocab);
    const score = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    return { text, score };
  } catch {
    return null;
  }
}
