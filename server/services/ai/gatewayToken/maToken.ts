/**
 * ★★★ Đợt 4A (2026-10-17) — TOKEN THEO NGƯỜI DÙNG cho cổng `/v1` (quyết định Q2-A): phần LÁ, thuần, 0 I/O.
 *
 * VÌ SAO CÓ TOKEN RIÊNG (không dùng lại cookie phiên, không dùng lại `OPENAI_GATEWAY_API_KEY`):
 *   • Key dùng chung KHÔNG gắn người — đo lường, hạn mức, audit của `/v1` đều về một xô "anon"; thu hồi nó là cắt
 *     MỌI kỹ sư cùng lúc.
 *   • Cookie phiên là vé của TOÀN ỨNG DỤNG web (tRPC, socket, mọi tuyến) — đưa nó cho extension là trao quyền rộng
 *     hơn hẳn thứ extension cần, và tài khoản bật 2FA thì extension không tự đăng nhập được.
 *   ⇒ Một token HẸP: chỉ mở `/v1`, chỉ trong `phamVi` (chat · fim · embed), có hạn, thu hồi được từng cái.
 *
 * VÌ SAO LƯU BĂM sha256 (không bcrypt): token là 32 byte NGẪU NHIÊN (256 bit) — không có không gian từ điển để
 *   dò, nên hàm băm chậm chẳng mua thêm gì mà mỗi lượt FIM gõ phím phải trả giá. sha256 cho phép tra bằng chỉ mục
 *   UNIQUE (một truy vấn, không quét). Bản rõ chỉ tồn tại trong phản hồi tạo token — ĐÚNG MỘT LẦN.
 *
 * TIỀN TỐ `avgw_`: nhận diện được bằng mắt + bằng máy quét bí mật (một token dán nhầm vào git bị bắt); cổng `/v1`
 *   dùng nó để rẽ nhánh token-người-dùng / key-chung mà KHÔNG phải tra CSDL cho key chung.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";

export const TIEN_TO_TOKEN = "avgw_";
export const TIEN_TO_MA_THIET_BI = "avgd_";
/** 32 byte → base64url không đệm = 43 ký tự. */
const RE_TOKEN = /^avgw_[A-Za-z0-9_-]{43}$/;
const RE_MA_THIET_BI = /^avgd_[A-Za-z0-9_-]{43}$/;

export const PHAM_VI = ["chat", "fim", "embed"] as const;
export type PhamVi = (typeof PHAM_VI)[number];
/** Mặc định ÍT NHẤT cần cho extension (chat + ghost-text) — `embed` phải xin tường minh. */
export const PHAM_VI_MAC_DINH: readonly PhamVi[] = ["chat", "fim"];

export const SO_NGAY_MAC_DINH = 90;
export const SO_NGAY_TOI_DA = 365;
/** Trần token CÒN HIỆU LỰC mỗi người — chặn một vòng lặp lỗi đẻ token vô hạn. */
export const TRAN_TOKEN_HIEU_LUC = 20;
/** Số ký tự hiển thị (gồm tiền tố) — đủ để người dùng nhận ra token nào, không đủ để dùng. */
export const DO_DAI_TIEN_TO_HIEN_THI = 12;

export function bamToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function laTokenNguoiDung(s: unknown): s is string {
  return typeof s === "string" && RE_TOKEN.test(s);
}

export function laMaThietBi(s: unknown): s is string {
  return typeof s === "string" && RE_MA_THIET_BI.test(s);
}

export interface TokenMoi {
  /** Bản RÕ — chỉ trả cho người dùng một lần, KHÔNG BAO GIỜ ghi xuống CSDL/nhật ký. */
  token: string;
  bam: string;
  tienTo: string;
}

export function sinhToken(): TokenMoi {
  const token = TIEN_TO_TOKEN + randomBytes(32).toString("base64url");
  return { token, bam: bamToken(token), tienTo: token.slice(0, DO_DAI_TIEN_TO_HIEN_THI) };
}

/** Mã bí mật extension giữ để đổi lấy token (không bao giờ hiện cho người). */
export function sinhMaThietBi(): { ma: string; bam: string } {
  const ma = TIEN_TO_MA_THIET_BI + randomBytes(32).toString("base64url");
  return { ma, bam: bamToken(ma) };
}

/**
 * Mã NGẮN người dùng gõ/đối chiếu trên trang web. Bảng chữ 20 phụ âm (RFC 8628 §6.1): không nguyên âm ⇒ không
 * ghép ra từ; không 0/O/1/I ⇒ không đọc nhầm. 8 ký tự ≈ 34,6 bit — đủ khi kèm hết hạn 10 phút + trần lượt thử.
 */
const BANG_CHU_MA = "BCDFGHJKLMNPQRSTVWXZ";
export function sinhMaNguoiDung(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += BANG_CHU_MA[randomInt(BANG_CHU_MA.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Chuẩn hoá thứ người dùng gõ ("bcdf ghjk", "BCDF-GHJK") về dạng lưu; sai bảng chữ/độ dài ⇒ `null`. */
export function chuanHoaMaNguoiDung(vao: unknown): string | null {
  if (typeof vao !== "string") return null;
  const s = vao.toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== 8) return null;
  for (const c of s) if (!BANG_CHU_MA.includes(c)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Lọc + khử trùng phạm vi; rỗng/không hợp lệ ⇒ mặc định. Thứ tự cố định để so sánh/hiển thị ổn định. */
export function chuanHoaPhamVi(vao: unknown): PhamVi[] {
  if (!Array.isArray(vao)) return [...PHAM_VI_MAC_DINH];
  const tap = new Set(vao.filter((x): x is PhamVi => typeof x === "string" && (PHAM_VI as readonly string[]).includes(x)));
  return tap.size ? PHAM_VI.filter((p) => tap.has(p)) : [...PHAM_VI_MAC_DINH];
}

export function chuanHoaSoNgay(vao: unknown): number {
  const n = typeof vao === "number" && Number.isFinite(vao) ? Math.floor(vao) : SO_NGAY_MAC_DINH;
  return Math.min(SO_NGAY_TOI_DA, Math.max(1, n));
}

/**
 * Phạm vi mà MỘT đường của cổng đòi. `/models` ⇒ `null` = mọi token hợp lệ (danh sách model không sinh chữ).
 * Đường lạ ⇒ `"khong-ro"` — cổng trả 404 của nó, không cần phạm vi.
 */
export function phamViCuaDuong(duong: string): PhamVi | null | "khong-ro" {
  const p = duong.replace(/\/+$/, "");
  if (p === "/chat/completions") return "chat";
  if (p === "/completions") return "fim";
  if (p === "/embeddings") return "embed";
  if (p === "/models") return null;
  return "khong-ro";
}
