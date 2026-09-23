/**
 * ★★★ G18 (audit 2026-09-22) — **TRẦN TOKEN SINH MÃ THEO LỚP MODEL, KHÔNG PHẢI MỘT HẰNG SỐ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO `MAX_TOKENS_SINH = 3_000` LÀ MỘT CON SỐ ĐÚNG ĐÃ TRỞ THÀNH SAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 3.000 token là dư dả cho một model KHÔNG nghĩ: Qwen3-Coder-30B tiêu trung bình 383 token/bài
 * trên bộ bài khó (đo 2026-09-22, 36 lượt). Nhưng một model BIẾT NGHĨ viết cả chuỗi suy luận
 * vào ngân sách ấy trước khi phát ký tự mã đầu tiên:
 *
 *   | model · nghĩ BẬT       | token/bài TB | tối đa | chạy được |
 *   |------------------------|--------------|--------|-----------|
 *   | Qwen3.6-27B            | 5.243        | 8.015  | 92 %      |
 *   | Qwen3.6-35B-A3B        | 5.068        | —      | 83 %      |
 *
 * ⇒ Với trần 3.000, đường ống **cắt cụt hoặc từ chối** đúng những model chính xác nhất — và dưới
 *   tiêu chí *"tính đúng đắn trước tốc độ"* của chủ dự án, đó là kiểu sai nguy hiểm nhất: nó loại
 *   oan model tốt nhất trong im lặng. Đã đo được đúng hình dạng này HAI lần trên bộ đo thuần
 *   (Qwen3.8: trần 4k ⇒ 22 % GIẢ, 12k ⇒ 67 %; Qwen3.6: trần 4k ⇒ 10/12 bài cụt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KHÔNG GHIM MỘT HẰNG SỐ MỚI, VÀ KHÔNG DÙNG CỜ `.env`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đổi `3_000` thành `16_000` là đổi một hằng sai thành một hằng sai khác: model không nghĩ sẽ được
 * cấp ngữ cảnh nó không cần, và model kế tiếp có thể cần nhiều hơn nữa. Một cờ `.env` thì **hỏng
 * trong im lặng** khi bị quên — trần tụt về 3.000, chất lượng rơi, không lỗi nào nổ. Đó chính là
 * lớp "hàng rào mềm 3/10 vs hàng rào cứng 10/10" đã đo ở đợt trước.
 *
 * ⇒ Tín hiệu "model này biết nghĩ" phải là thứ **ĐO ĐƯỢC LÚC CHẠY**, và repo đã có sẵn nó: lớp
 *   client đếm `reasoning_content` và ném `LoiTokenCanKietVaoSuyLuan` khi model tiêu hết hạn mức
 *   vào suy luận mà chưa phát ký tự nào ra `content`. Vậy:
 *     1. lượt ĐẦU với một model lạ chạy ở trần cũ (không đổi hành vi cho model không nghĩ);
 *     2. nếu lỗi kia nổ ⇒ ghi vào ô nhớ *"model này đã từng nghĩ"* và **thử lại một lần** ở trần
 *        rộng;
 *     3. mọi lượt sau khởi động thẳng ở trần rộng.
 *   Cái giá: đúng MỘT lượt thử lại cho mỗi model lạ, mỗi tiến trình. Đổi lại: không ai phải nhớ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * RANH GIỚI — trần KHÔNG ĐƯỢC vượt ngữ cảnh của slot
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * llama.cpp từ chối khi `prompt + n_predict > n_ctx/slot` (xem `serverSlotContextTokens()`).
 * Nên trần rộng chỉ là *mong muốn*; con số thật là `min(mong muốn, ctx/slot − prompt − đệm)`.
 * Cùng khuôn với `vramTranThietBi.apTranThietBi`: hàm này **chỉ có thể làm NHỎ ĐI** so với mong
 * muốn, không bao giờ nới.
 *
 * Module THUẦN: không I/O, không đọc env, không đọc giờ. Mọi nhánh có lưới (`.test.ts`).
 */

/** Trần cho model KHÔNG nghĩ — giữ NGUYÊN con số cũ để hành vi cũ không đổi một byte. */
export const TRAN_SINH_KHONG_NGHI = 3_000;

/**
 * Trần cho model BIẾT NGHĨ. 16.000 = tối đa đo được (8.015) × ~2 làm dư địa; cùng con số đã dùng
 * cho bộ đo thuần, nơi nó cho **0/48 bài cụt** trên hai model Qwen3.6.
 */
export const TRAN_SINH_BIET_NGHI = 16_000;

/** Đệm cho token đặc biệt / lệch ước lượng prompt. Giữ nhỏ: đây không phải chỗ giấu dư địa. */
export const DEM_AN_TOAN_TOKEN = 256;

/** Sàn: dưới mức này một lượt sinh mã không thể ra một hàm hoàn chỉnh — trả về vẫn phải ≥ sàn. */
export const SAN_TOKEN_SINH = 256;

export interface ThamSoTranToken {
  /** Ngữ cảnh MỖI SLOT của server (không phải `-c` tổng). Xem `serverSlotContextTokens()`. */
  readonly ctxSlotTokens: number;
  /** Ước lượng token của prompt sắp gửi (hệ thống + ngữ cảnh mã + câu hỏi). */
  readonly tokenPrompt: number;
  /** Ô nhớ: model đang phục vụ ĐÃ TỪNG phát khối suy luận trong tiến trình này. */
  readonly modelDaTungNghi: boolean;
  /**
   * ★ F3 "Nghĩ sâu" (`ai/nghiSau.ts`) — trần MONG MUỐN thay cho `TRAN_SINH_BIET_NGHI` khi model biết nghĩ.
   * Vắng/rác ⇒ 16.000 như cũ. Vẫn bị kẹp ctx/slot − prompt: chỉ nới MONG MUỐN, không bao giờ nới ctx.
   */
  readonly tranMongMuon?: number;
}

const huuHan = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Trần token cho MỘT lượt sinh mã. Hàm THUẦN.
 *
 * Hợp đồng:
 *   • model KHÔNG nghĩ ⇒ kết quả ≤ `TRAN_SINH_KHONG_NGHI` (hành vi cũ, không đổi);
 *   • model BIẾT nghĩ  ⇒ kết quả ≤ `tranMongMuon` nếu đặt ("Nghĩ sâu"), ngược lại ≤ `TRAN_SINH_BIET_NGHI`;
 *   • luôn ≤ `ctxSlotTokens − tokenPrompt − DEM_AN_TOAN_TOKEN` khi hai số ấy hữu hạn;
 *   • luôn ≥ `SAN_TOKEN_SINH`.
 * Đầu vào rác (NaN/âm/không hữu hạn) ⇒ bỏ qua ràng buộc ctx, KHÔNG ném — đường sinh chữ không
 * được chết vì một con số cấu hình hỏng; nó rơi về trần theo lớp model.
 */
export function tranTokenSinhMa(t: ThamSoTranToken): number {
  const mongMuonNghi = huuHan(t.tranMongMuon) && t.tranMongMuon > 0 ? t.tranMongMuon : TRAN_SINH_BIET_NGHI;
  const mongMuon = t.modelDaTungNghi ? mongMuonNghi : TRAN_SINH_KHONG_NGHI;
  let tran = mongMuon;
  if (huuHan(t.ctxSlotTokens) && t.ctxSlotTokens > 0) {
    const prompt = huuHan(t.tokenPrompt) && t.tokenPrompt > 0 ? t.tokenPrompt : 0;
    const conLai = t.ctxSlotTokens - prompt - DEM_AN_TOAN_TOKEN;
    tran = Math.min(tran, conLai);
  }
  return Math.max(SAN_TOKEN_SINH, Math.floor(tran));
}

/**
 * Dấu vết máy-đọc-được của `LoiTokenCanKietVaoSuyLuan` trong THÔNG ĐIỆP. Tồn tại vì lỗi ấy đi
 * qua BA lớp bọc trước khi tới nhánh sinh mã, và mỗi lớp đều làm rơi một phần danh tính:
 *   1. `aiLlamaServerClient` bọc thành `LoiStreamServer(e.message, …, { cause: e })` — còn `cause`;
 *   2. `aiGgufEngine.quyetDinhSauLoiServer` ném `new Error(msg)` với `chiTiet` nhúng vào giữa —
 *      mất `name`, mất `cause`, **còn chuỗi**;
 *   3. `streamCodingModel` ném `new Error(chunk.error)` — chỉ còn chuỗi.
 * ⇒ Chỉ có chuỗi là sống sót qua cả ba. `(G5-D` là mã nhận diện do chính lớp 1 đặt tên cho ca này,
 *   ổn định hơn mọi đoạn văn tiếng Việt xung quanh nó.
 */
export const DAU_VET_CAN_TOKEN_SUY_LUAN = "TỪ CHỐI TRUNG THỰC (G5-D";

/**
 * Có nên THỬ LẠI với trần rộng không, sau một lượt hỏng?
 *
 * `true` ⇔ lỗi là (hoặc BỌC) `LoiTokenCanKietVaoSuyLuan` **và** lượt vừa hỏng CHƯA chạy ở trần
 * rộng. Thử lại một lượt đã rộng là lặp vô hạn có tên khác.
 *
 * Nhận diện theo ba lớp, từ chắc tới lỏng: `name` → `cause.name` → dấu vết trong thông điệp.
 * Không `instanceof` để không kéo `aiLlamaServerClient` (module có I/O) vào một module thuần.
 */
export function nenThuLaiVoiTranRong(loi: unknown, daDungTranRong: boolean): boolean {
  if (daDungTranRong) return false;
  const o = loi as { name?: unknown; cause?: { name?: unknown } | null; message?: unknown } | null;
  if (!o || typeof o !== "object") return false;
  if (o.name === "LoiTokenCanKietVaoSuyLuan") return true;
  if (o.cause && typeof o.cause === "object" && o.cause.name === "LoiTokenCanKietVaoSuyLuan") return true;
  return typeof o.message === "string" && o.message.includes(DAU_VET_CAN_TOKEN_SUY_LUAN);
}

// ─────────────────────────────────────────────────────────────── Ô NHỚ TRONG TIẾN TRÌNH
/**
 * *"Model đang phục vụ đã từng phát khối suy luận."* Khoá theo **định danh model** để một lượt đổi
 * model (`GGUF_DEFAULT_MODEL` khác) không kế thừa kết luận của model trước.
 *
 * ⚠ Nếu llama-server bị đổi model MÀ định danh không đổi (đổi tệp tay, không đổi env), ô này có
 *   thể nói "biết nghĩ" cho một model không nghĩ ⇒ chỉ tốn ngữ cảnh, không sai kết quả. Chiều
 *   nguy hiểm (model MỚI biết nghĩ mà ô nói "không") được `nenThuLaiVoiTranRong` bắt lại ở lượt
 *   đầu. Hai chiều, một chiều rẻ, một chiều có lưới — không chiều nào im lặng làm sai.
 */
const oNho = new Set<string>();

export function ghiModelDaNghi(dinhDanhModel: string): void {
  oNho.add(String(dinhDanhModel ?? ""));
}

export function modelDaTungNghi(dinhDanhModel: string): boolean {
  return oNho.has(String(dinhDanhModel ?? ""));
}

/** Chỉ dùng trong test. */
export function __resetONhoForTests(): void {
  oNho.clear();
}

/**
 * ★ GỢI Ý "model này biết nghĩ" theo TÊN — để lượt đầu sau mỗi lần khởi động không phải trả thuế
 * một lượt thử lại (đo được: ~30–80 s đốt vào một lượt G5-D rồi mới thử lại).
 *
 * ⚠ Đây là GỢI Ý, không phải hàng rào. Hai chiều sai của nó đều rẻ:
 *   • gợi ý SAI DƯƠNG (tên khớp nhưng model không nghĩ) ⇒ trần rộng hơn cần ⇒ chỉ tốn ngữ cảnh;
 *   • gợi ý SAI ÂM (model nghĩ mà tên không khớp) ⇒ `nenThuLaiVoiTranRong` vẫn bắt ở lượt đầu.
 * Cơ chế thử-lại vẫn là sàn; bảng tên chỉ bỏ cái thuế lượt đầu cho các model ĐÃ ĐO là biết nghĩ.
 * Danh sách rút từ phép đo 2026-09-22 (template có `enable_thinking`, thinking = 1 mặc định):
 * Qwen3.6-27B · Qwen3.6-35B-A3B · Qwen3.8-27B. Không thêm tên chưa đo.
 */
const TEN_MODEL_DA_DO_BIET_NGHI: readonly RegExp[] = [/qwen3\.6/i, /qwen3\.8/i];

export function goiYModelBietNghi(dinhDanhModel: string | null | undefined): boolean {
  const s = String(dinhDanhModel ?? "");
  return TEN_MODEL_DA_DO_BIET_NGHI.some((re) => re.test(s));
}

/**
 * Ô nhớ HIỆU DỤNG = đã ghi nhận lúc chạy **HOẶC** gợi ý theo tên. Người gọi dùng hàm này thay cho
 * `modelDaTungNghi` trần để lượt đầu đã khởi động ở trần rộng với model đã đo.
 */
export function modelNenCoiLaBietNghi(dinhDanhModel: string): boolean {
  return modelDaTungNghi(dinhDanhModel) || goiYModelBietNghi(dinhDanhModel);
}
