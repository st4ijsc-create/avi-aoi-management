/**
 * ★★★ 2026-08-29 · **SỔ ĐUÔI SỐNG** — đầu ra `run_command` ĐANG CHẠY, cho panel Terminal của
 * `/ai-coding-workspace` poll xem theo thời gian thực (mẫu VSCode: nhìn thấy `transforming (110)`
 * TRONG KHI build, không phải sau 4 phút).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT KÊNH QUAN SÁT SONG SONG — KHÔNG PHẢI MỘT ĐƯỜNG CHẠY MỚI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `confirmAction` (mutation) vẫn CHẶN đến khi lệnh xong và vẫn là nguồn sự thật duy nhất cho kết
 * quả CHÍNH THỨC (đã cắt + đã che + đọc-số-ca). Sổ này chỉ trả lời một câu hỏi khác: *"NGAY LÚC
 * NÀY nó đang in gì?"* — một lời khai BỘ PHẬN, thay thế cho `null` (màn hình trống), không thay
 * thế cho kết quả cuối. Vì thế mất entry (restart server, TTL) là MẤT HIỂN THỊ, không mất dữ liệu.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ CHE BÍ MẬT: `StreamingSecretRedactor` PER-ENTRY, che TRƯỚC khi vào đuôi — KHÔNG che-lúc-đọc
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `chayLenhTrongHopCat` chỉ che (`redactSecretsOnly`) ở `hoanTat` — chunk `onDoan` là THÔ. Nếu sổ
 * giữ đuôi thô rồi che lúc `docLenhSong`, một bí mật ĐANG MỞ (PEM đã in `-----BEGIN…` mà chưa tới
 * `-----END…`) sẽ không khớp regex hai-mốc ⇒ tiền tố của nó RỜI server ở nhịp poll đó — đúng lớp
 * rò Pha 8 ("rò NGUYÊN VĂN KHOÁ PHIÊN xuống trình duyệt"), và là đúng bài mà doc 69 đã trả giá để
 * dựng `StreamingSecretRedactor`. ⇒ mỗi entry một redactor RIÊNG (trạng thái hold-back không được
 * lẫn giữa hai lượt chạy); đuôi CHỈ chứa chữ redactor đã NHẢ — thứ trong đuôi là thứ được phép rời
 * server, theo cấu tạo. `ketThucLenhSong` phải `flush()` để phần hold-back cuối cùng vào đuôi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ CÁCH LY THEO USER — entry khoá theo `userId`, `docLenhSong(userId)` không nhận actionId
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Người A không được xem đầu ra lệnh của người B (đầu ra `git status`/test có thể mang đường dẫn,
 * tên nhánh, chuỗi nội bộ). Khoá sổ là `userId`; router chỉ truyền `ctx.user.id` từ phiên đã xác
 * thực — client KHÔNG gửi khoá nào cả, nên không có gì để giả. Mỗi user MỘT entry hiện hành: lượt
 * mới thay lượt cũ (UI chỉ hiện một khối sống; hai tab trình duyệt đua nhau thì bên sau thắng —
 * vô hại vì đây là kênh hiển thị).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ TRẦN — đuôi ≤ `TRAN_DUOI_SONG` ký tự (cắt ĐẦU, giữ ĐUÔI — người ta xem terminal từ đáy lên),
 * entry chết tự xoá sau `TTL_SAU_KET_THUC_MS` (timer `.unref()` — không giữ tiến trình test sống).
 * Không cắt là mời một `pnpm build` verbose 50 MB ở lại RAM theo mỗi nhịp poll.
 */
import { StreamingSecretRedactor } from "../ai/aiSafety";

/** Đuôi sống tối đa (ký tự). 64k ≈ vài trăm dòng cuối — quá đủ cho "đang chạy tới đâu". */
export const TRAN_DUOI_SONG = 64_000;
/** Entry đã kết thúc ở lại bao lâu cho nhịp poll cuối vớt nốt, rồi tự xoá. */
export const TTL_SAU_KET_THUC_MS = 60_000;

interface EntrySong {
  /** Hàng `ai_pending_actions` sinh ra lượt chạy — để lượt mới CÙNG user thay đúng chỗ. */
  actionId: string;
  /** Lệnh nguyên văn (nhãn hiển thị `$ …`). */
  lenh: string;
  /** Đuôi ĐÃ QUA redactor (chỉ chứa chữ được phép rời server), đã cắt đầu theo trần. */
  duoi: string;
  /** true ⇔ đã cắt bớt phần đầu (UI báo "… (đã cắt phần đầu)"). */
  catDau: boolean;
  dangChay: boolean;
  batDauMs: number;
  /** Bộ che TRẠNG THÁI của riêng lượt này — hold-back không được lẫn giữa hai lượt. */
  redactor: StreamingSecretRedactor;
  /** Timer tự xoá sau khi kết thúc; giữ để lượt mới thay chỗ thì huỷ timer cũ. */
  henXoa: NodeJS.Timeout | null;
}

/** Hình dạng trả cho client — KHÔNG lộ redactor/timer, chỉ dữ liệu hiển thị. */
export interface LatDocSong {
  lenh: string;
  dauRa: string;
  dangChay: boolean;
  /** Số ms đã trôi kể từ lúc lệnh bắt đầu (server đo — client không tự bịa đồng hồ). */
  msTroi: number;
  catDau: boolean;
}

const so = new Map<number, EntrySong>();

function huyHenXoa(e: EntrySong | undefined): void {
  if (e?.henXoa) clearTimeout(e.henXoa);
}

/** Bắt đầu một lượt sống cho `userId` — thay entry cũ (nếu có) của CHÍNH user ấy. */
export function batDauLenhSong(userId: number, actionId: string, lenh: string): void {
  huyHenXoa(so.get(userId));
  so.set(userId, {
    actionId,
    lenh,
    duoi: "",
    catDau: false,
    dangChay: true,
    batDauMs: Date.now(),
    redactor: new StreamingSecretRedactor(),
    henXoa: null,
  });
}

/**
 * Nối một chunk THÔ vào lượt sống. Chunk đi qua redactor TRƯỚC (phần chưa chắc chắn bị giữ lại
 * trong redactor — KHÔNG vào đuôi); đuôi cắt ĐẦU khi vượt trần.
 * ⚠ So `actionId`: một chunk tới TRỄ của lượt cũ (đường ống stdout còn vét) không được phép nối
 * vào đuôi của lượt MỚI đã thay chỗ.
 */
export function noiDauRaSong(userId: number, actionId: string, doan: string): void {
  const e = so.get(userId);
  if (!e || e.actionId !== actionId) return;
  const nha = e.redactor.push(doan);
  if (nha === "") return;
  e.duoi += nha;
  if (e.duoi.length > TRAN_DUOI_SONG) {
    e.duoi = e.duoi.slice(e.duoi.length - TRAN_DUOI_SONG);
    e.catDau = true;
  }
}

/** Kết thúc lượt: flush phần hold-back của redactor vào đuôi, đánh dấu xong, hẹn tự xoá. */
export function ketThucLenhSong(userId: number, actionId: string): void {
  const e = so.get(userId);
  if (!e || e.actionId !== actionId) return;
  const conLai = e.redactor.flush();
  if (conLai !== "") {
    e.duoi += conLai;
    if (e.duoi.length > TRAN_DUOI_SONG) {
      e.duoi = e.duoi.slice(e.duoi.length - TRAN_DUOI_SONG);
      e.catDau = true;
    }
  }
  e.dangChay = false;
  huyHenXoa(e);
  const timer = setTimeout(() => {
    // Chỉ xoá nếu entry hiện hành VẪN là lượt này (một lượt mới có thể đã thay chỗ).
    const hienTai = so.get(userId);
    if (hienTai && hienTai.actionId === actionId) so.delete(userId);
  }, TTL_SAU_KET_THUC_MS);
  // `.unref()` — timer dọn dẹp không được giữ tiến trình (vitest treo vì timer là lớp lỗi đã biết).
  timer.unref?.();
  e.henXoa = timer;
}

/** Đọc lượt sống của ĐÚNG user ấy — không có thì `null` (client hiểu là "không gì đang chạy"). */
export function docLenhSong(userId: number): LatDocSong | null {
  const e = so.get(userId);
  if (!e) return null;
  return {
    lenh: e.lenh,
    dauRa: e.duoi,
    dangChay: e.dangChay,
    msTroi: Date.now() - e.batDauMs,
    catDau: e.catDau,
  };
}

/** Chỉ dùng trong lưới — đặt lại sổ giữa hai ca để không rò trạng thái. */
export function _xoaSachSoSong(): void {
  for (const e of so.values()) huyHenXoa(e);
  so.clear();
}
