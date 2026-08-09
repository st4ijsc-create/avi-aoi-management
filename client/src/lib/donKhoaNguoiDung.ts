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
 * (`username` · `email` · `openId` · `loginMethod` · `twoFactorEnabled` · `lastSignedIn`). Hai điều
 * kiện, để một đối tượng nghiệp vụ bất kỳ có `id`+`name` (máy, sản phẩm, dây chuyền) **không** bị
 * xoá nhầm. ⚠ Xem khối **M-2** ở `MAU_DANH_TINH` — danh sách ấy KHÔNG được suy từ
 * `PUBLIC_USER_FIELDS` (nó chứa `name`, và phép suy ấy XOÁ NHẦM mọi đối tượng nghiệp vụ).
 */

/** Khoá đã bị bỏ — giữ tên **chỉ để đọc lại lịch sử**, KHÔNG phải điều kiện của phép dọn. */
export const KHOA_DA_BO = ["manus-runtime-user-info"] as const;

/**
 * Mẩu danh tính: sự có mặt của **một** trong số này (kèm định danh) là đủ để gọi là người dùng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 7 / review TOÀN NHÁNH **M-2** — hai phần tử CHẾT đã được thay bằng hai ô CÒN SỐNG.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `passwordHash` và `twoFactorSecret` **không bao giờ** còn xuất hiện trong `auth.me` sau Task 7
 * (phép chiếu cho-phép) và Task 9 (hai cột rời sang `user_secrets`) ⇒ hai phần tử **chết**: chúng
 * không làm sai điều gì, nhưng chúng chiếm chỗ của phép nhận diện thật. Thay bằng
 * `twoFactorEnabled` + `lastSignedIn` — hai ô **có thật** trong `PUBLIC_USER_FIELDS`, và **riêng
 * của tài khoản**: không máy/sản phẩm/dây chuyền nào mang chúng.
 *
 * ⚠⚠⚠ **VÀ ĐÂY LÀ CHỖ ĐỀ XUẤT CỦA BÁO CÁO REVIEW **KHÔNG** ÁP ĐƯỢC NGUYÊN VĂN.** Báo cáo đề nghị
 * *"suy `MAU_DANH_TINH` từ `PUBLIC_USER_FIELDS`"*. Đo lại thì phép suy ấy **HỎNG THEO CHIỀU MỞ**:
 * `PUBLIC_USER_FIELDS` chứa **`name`** (và `createdAt`/`updatedAt`), nên **mọi** đối tượng nghiệp
 * vụ có `{id, name}` — máy, sản phẩm, dây chuyền — sẽ khớp và **bị XOÁ NHẦM** khỏi `localStorage`.
 * Đó đúng là điều mà điều kiện hai vế ở docstring trên được dựng ra để chặn.
 * ⇒ Tập này **KHÔNG** phải "mọi ô công khai của người dùng"; nó là *"những ô mà **chỉ** một tài
 *   khoản mới có"* — một khái niệm **hẹp hơn**, nên nó vẫn được viết ra ở đây. Nợ còn lại: chưa có
 *   lưới nào canh *"∀ phần tử của tập này là một ô THẬT của `auth.me`"* (cần đưa danh sách ô công
 *   khai xuống `shared/` — `publicUser.ts` nhập `drizzle/schema`, không mang sang trình duyệt được).
 * ⚠ Cổng **vẫn đúng**: `localStorageUserScan.unit.test.ts` suy nguồn từ AST (`auth.me.useQuery`),
 *   không từ danh sách này; danh sách chỉ lái phép **dọn lúc chạy** của dữ liệu cũ.
 */
const MAU_DANH_TINH = [
  "username",
  "email",
  "openId",
  "loginMethod",
  "twoFactorEnabled",
  "lastSignedIn",
] as const;

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
