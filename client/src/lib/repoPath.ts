/**
 * ★ 2026-08-24 — Tách `baseName` (trước nằm cục bộ trong `AICodingWorkspace.tsx`) ra module LÁ dùng
 * chung. Lý do: thẻ duyệt LÔ (`TheDuyetDiffLo`) cũng cần lấy tên tệp cho nhãn tab, và một bản sao
 * thứ hai của cùng phép tính là một chỗ nữa phải giữ đồng bộ tay.
 *
 * ⚠ Repo dùng **"/" cho relPath ở MỌI hệ điều hành** (kể cả Windows) — server chuẩn hoá trước khi trả
 *   (`repoSandbox`). Nên KHÔNG tách theo `\` ở đây: một `\` trong đường tương đối là ký tự tên tệp,
 *   không phải dấu phân cấp. Tách theo `\` sẽ cắt nhầm tên tệp Linux hợp lệ có chứa `\`.
 */
export function baseName(p: string): string {
  const parts = String(p ?? "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
