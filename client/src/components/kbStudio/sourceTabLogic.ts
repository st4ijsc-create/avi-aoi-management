/**
 * Wave 2 đường B (Task 5) — chuẩn hoá danh sách file cho ingest nhiều-file trong SourceTab.tsx.
 *
 * Trước Wave 2: input KHÔNG có `multiple` và code chỉ đọc files[0]; ô "dropzone" có
 * viền nét đứt nhưng KHÔNG có onDrop — trông như vùng thả mà thả không có tác dụng.
 *
 * Hai hàm thuần dưới đây chỉ làm MỘT việc: biến `FileList`/`DataTransfer` (nguồn trình duyệt,
 * có thể null/undefined/rỗng tuỳ thời điểm gọi) thành `File[]` an toàn để component xử lý tiếp.
 * Không lọc theo loại/kích thước ở đây — việc chấp nhận hay từ chối một file (sai định dạng,
 * quá lớn, lỗi nạp) là quyết định của server (`ingestDocumentJob`, nguồn sự thật duy nhất cho
 * `allowedTypes`/`maxUploadBytes`) và phải hiện ra kèm TÊN FILE + LÝ DO thật trong UI — không
 * lọc âm thầm ở tầng này.
 */
export function filesFromInput(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list as ArrayLike<File>);
}

export function filesFromDrop(dt: DataTransfer | null | undefined): File[] {
  if (!dt || !dt.files) return [];
  return Array.from(dt.files as ArrayLike<File>);
}
