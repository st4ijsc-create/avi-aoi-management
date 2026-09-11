/**
 * cheDoDo.ts — CHẾ ĐỘ ĐO (Đợt 47, A.2).
 *
 * Cửa sổ đo tương tác `window.__demTuongTac` (KhungCanh / LoBatchMay) đọc thẳng
 * `internal.interaction` + raycaster của R3F — rẻ, nhưng là mặt cắt nội bộ và
 * không có lý do để mở ở sản phẩm. Mở khi: build DEV, HOẶC URL mang `?do=1`
 * (dist chạy e2e/QA). Đọc MỘT lần lúc mount (người gọi truyền `location.search`
 * lúc đó) — `ghiUrl` của `/twin` giữ nguyên khoá lạ trong query, nhưng không
 * dựa vào điều ấy để lật cờ giữa chừng.
 */

/** `?do=1` trong chuỗi query ⇒ chế độ đo. Tách ra để lưới kiểm được phần URL rời khỏi `import.meta.env`. */
export function coCoDoTrongUrl(search: string): boolean {
  try {
    return new URLSearchParams(search).get("do") === "1";
  } catch {
    return false;
  }
}

export function laCheDoDo(
  search: string = typeof location !== "undefined" ? location.search : "",
  dev: boolean = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV),
): boolean {
  return dev || coCoDoTrongUrl(search);
}
