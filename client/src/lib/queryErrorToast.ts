/**
 * F11 (nhóm C 2026-08-14) — lỗi QUERY phải nói được cho người dùng, mà không thành bão toast.
 *
 * ── VÌ SAO CẦN ───────────────────────────────────────────────────────────────────
 * React Query v5 **bỏ hẳn `onError` khỏi `useQuery`** (chỉ `MutationOptions` còn có).
 * Nghĩa là cả 1310 lời gọi `useQuery` trong `client/src` KHÔNG có chỗ nào xử lý lỗi
 * riêng — handler toàn cục ở `main.tsx` là nơi DUY NHẤT lỗi query có thể hiện ra, và
 * trước đây nó chỉ `console.error`. Kết quả đo được ở lượt kiểm mắt: `DB_UNAVAILABLE`
 * **không hiện gì cả** — người dùng chỉ thấy một màn hình rỗng im lặng.
 *
 * ── VÌ SAO KHÔNG BẮN THẲNG ───────────────────────────────────────────────────────
 * DB sập thì MỌI query hỏng cùng lúc. Bắn mỗi lỗi một toast là vài chục toast chồng
 * nhau cho cùng một sự thật. Nên gộp theo MÃ lỗi trong một cửa sổ thời gian: một câu
 * "Không kết nối được cơ sở dữ liệu" thay vì bốn mươi câu.
 *
 * Hàm dedupe nhận đồng hồ qua tham số nên test được không cần fake timer.
 */

/** Cửa sổ gộp mặc định. Đủ dài để nuốt một đợt query song song, đủ ngắn để lỗi mới vẫn báo. */
export const CUA_SO_GOP_MS = 10_000;

/**
 * Khoá gộp: ưu tiên `appCode` (mã máy-đọc-được, ổn định). Không có thì lùi về message
 * đã cắt ngắn — hai lỗi khác nhau vẫn tách được, mà một lỗi lặp lại vẫn gộp được.
 */
export function queryErrorToastKey(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const appCode = (error as { data?: { appCode?: unknown } }).data?.appCode;
  if (typeof appCode === "string" && appCode) return `code:${appCode}`;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? `msg:${message.slice(0, 80)}` : "unknown";
}

/** Lần bắn gần nhất theo khoá. Ở cấp module — cố ý, vì cửa sổ gộp là toàn cục. */
const lanBanCuoi = new Map<string, number>();

/**
 * Có nên hiện toast cho lỗi này không. Trả `true` nhiều nhất MỘT lần mỗi khoá trong
 * mỗi cửa sổ. Gọi hàm này CHÍNH LÀ việc ghi nhận đã bắn — đừng gọi để "hỏi thăm".
 */
export function shouldToastQueryError(
  key: string,
  nowMs: number,
  windowMs: number = CUA_SO_GOP_MS,
): boolean {
  const truoc = lanBanCuoi.get(key);
  if (truoc !== undefined && nowMs - truoc < windowMs) return false;
  lanBanCuoi.set(key, nowMs);
  return true;
}

/** Chỉ dùng trong test — xoá trạng thái gộp giữa các ca. */
export function resetQueryErrorToastState(): void {
  lanBanCuoi.clear();
}
