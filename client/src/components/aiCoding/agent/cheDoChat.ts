/**
 * Đợt 1 · T5 — chế độ ô chat của `/ai-coding-workspace`: **Hỏi** (đường KB cũ) · **Agent duyệt từng bước** (`sua`) ·
 * **Agent tự động** (`tu-dong`, chỉ khi có `ai_repo_exec`). Nhớ theo trình duyệt (localStorage, mọi truy cập trong
 * try/catch — chế độ riêng tư / bị chặn ⇒ mặc định Hỏi). THUẦN trừ tham số `kho`.
 *
 * ⚠ Ẩn/hiện ở client chỉ là phép lịch sự — server (`tu-dong` cần `ai_repo_exec`, Q1) mới là hàng rào.
 */
export type CheDoChat = "hoi" | "sua" | "tu-dong";

export const KHOA_CHE_DO_CHAT = "aiCodingWorkspace.cheDoChat";

export interface KhoNho {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function khoMacDinh(): KhoNho | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Chế độ hợp lệ cho người dùng này: `tu-dong` mà thiếu quyền ⇒ rơi về `hoi`. */
export function chuanHoaCheDo(v: unknown, coQuyenTuDong: boolean): CheDoChat {
  if (v === "sua") return "sua";
  if (v === "tu-dong") return coQuyenTuDong ? "tu-dong" : "hoi";
  return "hoi";
}

export function docCheDoDaLuu(coQuyenTuDong: boolean, kho: KhoNho | null = khoMacDinh()): CheDoChat {
  try {
    return chuanHoaCheDo(kho?.getItem(KHOA_CHE_DO_CHAT) ?? null, coQuyenTuDong);
  } catch {
    return "hoi";
  }
}

export function luuCheDo(v: CheDoChat, kho: KhoNho | null = khoMacDinh()): void {
  try {
    kho?.setItem(KHOA_CHE_DO_CHAT, v);
  } catch {
    /* kho bị chặn — chỉ mất phần nhớ, không hỏng màn */
  }
}
