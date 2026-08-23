/**
 * ★★★ 2026-08-23 · UX LÔ 1 (D2) — **LỌC NHIỄU CÂY TỆP Ở TẦNG HIỂN THỊ.**
 *
 * Sự việc đo được: mở trang là "Repo chinh" với một bãi tệp lẫn ảnh/log (`*.png`, `*.log`,
 * `*.b64`…) — thứ tác nhân KHÔNG đọc được (hộp cát từ chối đuôi nhị phân) nhưng vẫn chiếm chỗ và
 * chôn các tệp mã thật. Bản vá: các mục đuôi nhiễu được GOM SAU CÙNG, hiện mờ, sau một nút
 * "Hiện tệp khác (N)".
 *
 * ⚠⚠ CHỈ TẦNG HIỂN THỊ — KHÔNG đổi API server, KHÔNG đổi cái tác nhân nhìn thấy (`list_files` vẫn
 *   trả đủ; hộp cát server vẫn là nơi quyết định cái gì ĐỌC được). Ẩn ở server là đổi lời khai của
 *   một tool; ẩn ở client là một cái nếp gấp, mở ra là còn nguyên.
 * ⚠ Danh sách đuôi là bảng NHIỄU-HIỂN-THỊ, KHÔNG phải bản sao của `repoSandbox.DUOI_CHO_PHEP`
 *   (một phép NHẬN DẠNG khác một phép CHO PHÉP — bài học đã ghi ở `REPO_PATH_REGEX`): `.log` nằm
 *   đây vì nó là nhiễu điều hướng, dù hộp cát CHO đọc nó.
 */

/** Đuôi bị coi là NHIỄU điều hướng: nhị phân/ảnh/log/khoá — theo đúng danh sách brief UX đã đo. */
const DUOI_NHIEU: ReadonlySet<string> = new Set([
  ".png", ".jpg", ".jpeg", ".log", ".lic", ".b64", ".pt", ".jar",
]);

/** THUẦN: `true` ⇔ mục tệp này xếp vào nhóm "tệp khác" (mờ + gom sau nút). Thư mục KHÔNG bao giờ. */
export function laTepNhieu(relPath: string): boolean {
  const cham = relPath.lastIndexOf(".");
  if (cham < 0) return false;
  return DUOI_NHIEU.has(relPath.slice(cham).toLowerCase());
}

/** Chia một danh sách tệp thành {chinh, nhieu} — giữ NGUYÊN thứ tự trong từng nhóm. */
export function chiaTepHienThi<T extends { path: string }>(tep: readonly T[]): { chinh: T[]; nhieu: T[] } {
  const chinh: T[] = [];
  const nhieu: T[] = [];
  for (const t of tep) (laTepNhieu(t.path) ? nhieu : chinh).push(t);
  return { chinh, nhieu };
}
