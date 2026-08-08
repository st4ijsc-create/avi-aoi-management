/**
 * ★★★ Pha 7 Task 8b — **DỌN dữ liệu người dùng ĐÃ NẰM SẴN trên đĩa trình duyệt.**
 *
 * Gỡ lượt ghi (`client/src/_core/hooks/useAuth.ts`) chỉ chặn **lượt ghi tiếp theo**. Bản ghi cũ —
 * nguyên đối tượng `auth.me` — **vẫn nằm trong `localStorage` của mọi người đã từng đăng nhập**, và
 * ở đó cho tới khi có ai xoá. Nên bản vá phải có **cả hai nửa**: thôi ghi **và** dọn cái đã ghi.
 *
 * ⚠⚠ **LƯỢNG TỪ — dọn theo HÌNH DẠNG, không theo TÊN.** Nợ được phát hiện là khoá
 * `manus-runtime-user-info`, nhưng nếu người dọn chỉ biết đúng cái tên ấy thì một khoá thứ hai
 * (đổi tên, hoặc do một bản cũ hơn ghi) sẽ **sống sót**. Vị từ dưới đây hỏi *"giá trị này CÓ HÌNH
 * DẠNG một đối tượng người dùng không"* — nên nó dọn cả khoá **chưa ai biết tên**.
 *
 * Hình dạng = có **định danh** (`id` hoặc `openId`) **VÀ** ít nhất một **mẩu danh tính**
 * (`username` · `email` · `passwordHash` · `twoFactorSecret` · `openId` · `loginMethod`). Hai điều
 * kiện, để một đối tượng nghiệp vụ bất kỳ có `id`+`name` (máy, sản phẩm, dây chuyền) **không** bị
 * xoá nhầm.
 */

/** Khoá đã bị bỏ — giữ tên **chỉ để đọc lại lịch sử**, KHÔNG phải điều kiện của phép dọn. */
export const KHOA_DA_BO = ["manus-runtime-user-info"] as const;

/** Mẩu danh tính: sự có mặt của **một** trong số này (kèm định danh) là đủ để gọi là người dùng. */
const MAU_DANH_TINH = ["username", "email", "passwordHash", "twoFactorSecret", "openId", "loginMethod"] as const;

/** Giá trị đã đọc từ kho có **hình dạng** một đối tượng người dùng không. */
export function coHinhDangNguoiDung(gt: string | null): boolean {
  if (!gt || gt.length > 100_000) return false;
  const c = gt.trimStart()[0];
  if (c !== "{" && c !== "[") return false;
  let o: unknown;
  try {
    o = JSON.parse(gt);
  } catch {
    return false;
  }
  return laNguoiDung(o, 0);
}

function laNguoiDung(o: unknown, sau: number): boolean {
  if (sau > 3 || o === null || typeof o !== "object") return false;
  if (Array.isArray(o)) return o.some((x) => laNguoiDung(x, sau + 1));
  const r = o as Record<string, unknown>;
  const coDinhDanh = "id" in r || "openId" in r;
  const coDanhTinh = MAU_DANH_TINH.some((k) => k in r);
  if (coDinhDanh && coDanhTinh) return true;
  // Bọc một lớp (`{ user: {...} }` / `{ data: {...} }`) vẫn là mang người dùng.
  return Object.values(r).some((v) => laNguoiDung(v, sau + 1));
}

/**
 * Xoá **mọi** khoá mang đối tượng người dùng khỏi một kho. Trả về danh sách khoá đã xoá.
 * ⚠ Không bao giờ ném: `localStorage` có thể bị chặn (chế độ riêng tư, cấu hình doanh nghiệp), và
 *   một ngoại lệ ở đây sẽ làm **trắng màn hình** cả ứng dụng.
 */
export function donKhoaMangNguoiDung(kho: Storage | undefined | null): string[] {
  const daBo: string[] = [];
  if (!kho) return daBo;
  try {
    const moiKhoa: string[] = [];
    for (let i = 0; i < kho.length; i++) {
      const k = kho.key(i);
      if (k !== null) moiKhoa.push(k);
    }
    for (const k of moiKhoa) {
      let gt: string | null = null;
      try {
        gt = kho.getItem(k);
      } catch {
        continue;
      }
      if (!coHinhDangNguoiDung(gt)) continue;
      try {
        kho.removeItem(k);
        daBo.push(k);
      } catch {
        /* không xoá được thì thôi — vẫn không được ném */
      }
    }
  } catch {
    /* kho bị chặn hoàn toàn */
  }
  return daBo;
}

/** Gọi **một lần lúc khởi động**, trên cả hai kho. */
export function donKhoNguoiDungLucKhoiDong(): string[] {
  if (typeof window === "undefined") return [];
  const ra: string[] = [];
  for (const kho of [window.localStorage, window.sessionStorage]) {
    try {
      ra.push(...donKhoaMangNguoiDung(kho));
    } catch {
      /* truy cập chính thuộc tính cũng có thể ném */
    }
  }
  return ra;
}
