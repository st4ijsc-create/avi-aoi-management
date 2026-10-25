/**
 * SCADA R1b-1 Task 7 — BỘ ĐIỀU TIẾT dòng nhật ký thử lệnh (`scada_command_attempts`) cho các mã từ chối ỒN.
 *
 * Vì sao: bảng WORM (chỉ INSERT) — một người bấm lại liên tục (DA_XU_LY, HET_HAN, TOTP_CAN …) hoặc dò id (NOT_FOUND) sẽ làm phình
 * bảng không thể dọn. Điều tiết CHỈ ảnh hưởng việc GHI SỔ: client vẫn nhận ĐÚNG mã từ chối (router không đọc kết quả của module này).
 *
 * Luật (chốt điều phối 2026-10-24):
 *   · Khoá = (userId, reasonCode). Cửa sổ 60 s tính từ dòng ồn ĐẦU TIÊN của cửa sổ đó.
 *   · Chỉ mã trong `MA_ON`. Mã khác (MODE_LOCAL, INTERLOCK, ROLE_FLOOR, TOTP_SAI …) và mọi dòng không phải `rejected`
 *     (dispatched / proposed / confirmed / cancelled / expired) KHÔNG BAO GIỜ qua đây — người gọi (`ghiThuLenh`) lọc trước.
 *   · 30 dòng đầu trong cửa sổ ⇒ `{ghi:true}`; sau đó `{ghi:false}` (đếm số bị gộp).
 *   · Lần gọi đầu tiên SAU khi cửa sổ kết thúc mà có N>0 dòng bị gộp ⇒ `{ghi:"tong_ket", soLan:N}`: người gọi ghi MỘT dòng tổng kết
 *     (reason_code "DIEU_TIET", ly_do "N lần {mã} bị gộp") RỒI dòng hiện tại; dòng hiện tại mở cửa sổ mới với đếm = 1.
 *   · Chỉ trong RAM của tiến trình (khởi động lại = đếm lại; nhiều tiến trình = mỗi tiến trình một bộ đếm — chấp nhận, mục đích là
 *     chặn phình bảng chứ không phải hạn mức chính xác). `now` tiêm vào để test.
 *   · Dọn khoá: mỗi cửa sổ 60 s quét một lần, bỏ khoá đã hết hạn >60 s và KHÔNG còn tổng kết treo; trần cứng `TRAN_KHOA`.
 *
 * ĐÁNH ĐỔI CÓ CHỦ Ý (review T7 M-1, M-2):
 *   · M-1 — `TOTP_CAN` nằm trong `MA_ON` THEO THIẾT KẾ (brief T7): nó là lời nhắc "kênh mức 4–5 cần mã", người dùng bấm lại liên tục khi
 *     chưa nhập mã. Từ dòng thứ 31 trong 60 s của một người, các dòng TOTP_CAN chỉ được ĐẾM (vào dòng tổng kết `DIEU_TIET`), không ghi từng
 *     dòng. Client vẫn nhận đúng TOTP_CAN và lệnh KHÔNG hề được gửi — cổng an toàn vẫn chặn; chỉ nhật ký bị gộp. Mã sai (`TOTP_SAI`,
 *     `TOTP_TAM_KHOA`) KHÔNG nằm trong `MA_ON` nên luôn có dòng riêng.
 *   · M-2 — dòng tổng kết đang treo (đã có dòng bị gộp mà cửa sổ chưa kết thúc) MẤT khi: (a) tiến trình khởi động lại; (b) trần cứng
 *     `TRAN_KHOA` loại khoá cũ nhất. Đó là đánh đổi có chủ ý của lưu trữ trong RAM (không bảng phụ): số dòng bị gộp là thông tin gợi ý,
 *     không phải bằng chứng; bằng chứng (30 dòng đầu mỗi cửa sổ + mã gửi về client) vẫn đủ để dò vết. R1b-2a T9: người NGỪNG HẲN không còn
 *     mất tổng kết nếu tiến trình sống — hẹn giờ unref `batXaTongKet` xả sau ≤ `CUA_SO_MS + CHU_KY_XA_MS`; vẫn mất khi khởi động lại (chấp nhận).
 */
import { logger } from "../../logger";

export const MA_ON = Object.freeze(["DA_XU_LY", "HET_HAN", "NOT_FOUND", "TOTP_CAN"] as const);
export const TRAN_MOI_PHUT = 30;
export const CUA_SO_MS = 60_000;
/** Trần cứng số khoá giữ trong RAM (quét hết hạn không đủ khi bị dò nhiều userId). */
export const TRAN_KHOA = 5_000;

/** Chu kỳ quét của bộ xả tổng kết (hẹn giờ unref, chỉ chạy khi có cửa sổ treo). Tổng kết trễ tối đa `CUA_SO_MS + CHU_KY_XA_MS`. */
export const CHU_KY_XA_MS = 10_000;

export type KetQuaDieuTiet = { ghi: true } | { ghi: false } | { ghi: "tong_ket"; soLan: number; stage: string };

/** Một dòng tổng kết cần ghi (R1b-2a T9). */
export interface TongKetHetHan {
  userId: number;
  reasonCode: string;
  stage: string;
  soLan: number;
}

interface CuaSo {
  batDau: number;
  daGhi: number;
  biGop: number;
  /** stage của dòng bị gộp CUỐI (cho dòng tổng kết khi người dùng không gọi lại nữa). */
  stage: string;
  userId: number;
  reasonCode: string;
}

const cuaSo = new Map<string, CuaSo>();
let lanQuetCuoi = 0;

/** Mã này có bị điều tiết không (người gọi lọc trước khi hỏi `nenGhiThuLenh`). */
export function laMaOn(reasonCode: string | null | undefined): boolean {
  return !!reasonCode && (MA_ON as readonly string[]).includes(reasonCode);
}

function don(now: number): void {
  if (now - lanQuetCuoi >= CUA_SO_MS) {
    lanQuetCuoi = now;
    for (const [k, w] of cuaSo) {
      if (w.biGop === 0 && now - w.batDau >= 2 * CUA_SO_MS) cuaSo.delete(k);
    }
  }
  if (cuaSo.size >= TRAN_KHOA) {
    // Map giữ thứ tự chèn ⇒ khoá đầu là khoá cũ nhất theo lần mở cửa sổ gần nhất (khoá được xoá rồi chèn lại khi mở cửa sổ mới).
    const dau = cuaSo.keys().next();
    if (!dau.done) cuaSo.delete(dau.value);
  }
}

/**
 * Có nên ghi dòng `rejected` mang mã ồn này không? Gọi ĐÚNG MỘT lần cho mỗi dòng sắp ghi.
 */
export function nenGhiThuLenh(
  userId: number,
  reasonCode: string,
  now: number = Date.now(),
  stage: "request" | "confirm" | "dispatch" | "huy" = "request",
): KetQuaDieuTiet {
  don(now);
  const khoa = `${userId}:${reasonCode}`;
  const w = cuaSo.get(khoa);
  if (!w) {
    cuaSo.set(khoa, { batDau: now, daGhi: 1, biGop: 0, stage, userId, reasonCode });
    return { ghi: true };
  }
  if (now - w.batDau >= CUA_SO_MS) {
    const soLan = w.biGop;
    const stageGop = w.stage;
    cuaSo.delete(khoa); // chèn lại ⇒ về cuối thứ tự (cho trần cứng)
    cuaSo.set(khoa, { batDau: now, daGhi: 1, biGop: 0, stage, userId, reasonCode });
    return soLan > 0 ? { ghi: "tong_ket", soLan, stage: stageGop } : { ghi: true };
  }
  if (w.daGhi < TRAN_MOI_PHUT) {
    w.daGhi += 1;
    return { ghi: true };
  }
  w.biGop += 1;
  w.stage = stage;
  henXa();
  return { ghi: false };
}

/**
 * R1b-2a T9 — LẤY và XOÁ mọi cửa sổ đã hết hạn (≥ `CUA_SO_MS` từ dòng đầu) mà còn dòng bị gộp. Đồng bộ ⇒ một cửa sổ chỉ có đúng MỘT người
 * lấy được (hẹn giờ HOẶC lần gọi kế của chính người đó): không tổng kết hai lần. Người đó quay lại sau khi đã xả ⇒ `nenGhiThuLenh` mở cửa
 * sổ mới `{ghi:true}`.
 */
export function layTongKetHetHan(now: number = Date.now()): TongKetHetHan[] {
  const ra: TongKetHetHan[] = [];
  for (const [k, w] of cuaSo) {
    if (w.biGop > 0 && now - w.batDau >= CUA_SO_MS) {
      ra.push({ userId: w.userId, reasonCode: w.reasonCode, stage: w.stage, soLan: w.biGop });
      cuaSo.delete(k);
    }
  }
  return ra;
}

// ─── Bộ xả tổng kết cho người NGỪNG HẲN (R1b-2a T9) ───────────────────────────────────────────────────────────────────────────
// Trước đây tổng kết chỉ được ghi ở lần gọi kế của CHÍNH người đó ⇒ người dừng hẳn sau khi bị gộp thì không bao giờ có dòng `DIEU_TIET`.
// Nay: hẹn giờ `unref` quét `layTongKetHetHan` mỗi `chuKyMs`, ghi qua `ghi` do người gọi truyền (đường ghi WORM insert-only của họ).
// Bật LƯỜI ở lần `{ghi:false}` đầu; tự dừng khi không còn cửa sổ treo; bật lại ở lần `{ghi:false}` kế. MẤT khi tiến trình khởi động lại
// hoặc trần cứng loại khoá — đánh đổi đã chấp nhận (số bị gộp là gợi ý, bằng chứng là 30 dòng đầu mỗi cửa sổ).
type GhiTongKet = (d: TongKetHetHan) => Promise<void>;
let xaGhi: GhiTongKet | null = null;
let xaChuKyMs = CHU_KY_XA_MS;
let hen: ReturnType<typeof setInterval> | null = null;

/** Dòng tổng kết ghi lỗi lần đầu, chờ MỘT lần thử lại ở lượt quét kế. */
const thuLaiSau: TongKetHetHan[] = [];

function conCuaSoTreo(): boolean {
  for (const w of cuaSo.values()) if (w.biGop > 0) return true;
  return false;
}

function dungHen(): void {
  if (hen) clearInterval(hen);
  hen = null;
}

function quetXa(): void {
  const ghi = xaGhi;
  if (ghi) {
    // Mới hết hạn + những dòng thử-lại của lượt quét trước (mỗi dòng tối đa MỘT lần thử lại).
    const viec: Array<{ d: TongKetHetHan; thuLai: boolean }> = [
      ...thuLaiSau.splice(0).map((d) => ({ d, thuLai: true })),
      ...layTongKetHetHan().map((d) => ({ d, thuLai: false })),
    ];
    for (const { d, thuLai } of viec) {
      // Lỗi chỉ log (sổ phụ): không bao giờ ném ra khỏi hẹn giờ.
      void Promise.resolve()
        .then(() => ghi(d))
        .catch((err: unknown) => {
          const chiTiet = { err: (err as Error)?.message ?? String(err), userId: d.userId, reasonCode: d.reasonCode, soLan: d.soLan };
          if (!thuLai) {
            // Lần đầu lỗi (insert KHÔNG thành công ⇒ chưa có dòng nào): xếp lại ĐÚNG MỘT lần cho lượt quét kế.
            thuLaiSau.push(d);
            henXa();
            logger.warn(chiTiet, "[SCADA] xả dòng tổng kết DIEU_TIET lỗi — thử lại một lần ở lượt quét kế");
          } else {
            logger.error(chiTiet, "[SCADA] xả dòng tổng kết DIEU_TIET lỗi lần hai — bỏ qua");
          }
        });
    }
  }
  if (!conCuaSoTreo() && thuLaiSau.length === 0) dungHen();
}

function henXa(): void {
  if (hen || !xaGhi) return;
  hen = setInterval(quetXa, xaChuKyMs);
  (hen as { unref?: () => void }).unref?.();
}

/**
 * Đăng ký đường ghi dòng tổng kết cho người ngừng hẳn. Idempotent: gọi nhiều lần chỉ thay hàm `ghi` (và chu kỳ), không tạo thêm hẹn giờ.
 * Hẹn giờ KHÔNG bật ở đây — bật lười ở lần `{ghi:false}` đầu của `nenGhiThuLenh`.
 */
export function batXaTongKet(ghi: GhiTongKet, chuKyMs: number = CHU_KY_XA_MS): void {
  xaGhi = ghi;
  if (chuKyMs !== xaChuKyMs) {
    xaChuKyMs = chuKyMs;
    if (hen) {
      dungHen();
      henXa();
    }
  }
}

/** CHỈ cho test. */
export function __datLaiDieuTiet(): void {
  cuaSo.clear();
  lanQuetCuoi = 0;
  thuLaiSau.length = 0;
  dungHen();
  xaGhi = null;
  xaChuKyMs = CHU_KY_XA_MS;
}

/** CHỈ cho test: hẹn giờ xả đang chạy? */
export function __henXaDangChay(): boolean {
  return hen !== null;
}

/** CHỈ cho test: số khoá đang giữ. */
export function __soKhoaDieuTiet(): number {
  return cuaSo.size;
}
