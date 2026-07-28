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

/**
 * Wave 2 đường B (Task 5, vòng sửa 1) — quyết định "file này còn nên GỬI không", đọc từ hàng
 * đợi SỐNG (không phải snapshot chụp lúc bấm nút "Gửi").
 *
 * Review vòng 1 chỉ ra: `handleUpload` cũ lặp qua một snapshot `queuedFiles` chụp một lần lúc
 * bấm gửi. Nút xoá (X) trên một file "waiting" chỉ xoá dòng đó khỏi state/màn hình — nó KHÔNG
 * ngăn vòng lặp cũ (đang lặp trên snapshot cũ) vẫn gọi `ingestDocumentJob` cho đúng file đó ở
 * lượt kế tiếp. Kết quả: người dùng thấy dòng đã biến mất nhưng file vẫn bị gửi lên, và tổng
 * kết cuối cùng ("Xong N/M") vẫn đếm file đó — con số nói dối theo hướng "đã gửi mà báo như
 * chưa gửi" hoặc ngược lại tuỳ cách đếm.
 *
 * Cách gọi đúng (xem `SourceTab.tsx`'s `handleUpload`): NGAY TRƯỚC khi gửi từng file, gọi hàm
 * này với `queuedFilesRef.current` (mảng SỐNG, cập nhật đồng bộ mỗi khi thêm/xoá) chứ không
 * phải mảng đã chụp lúc bắt đầu vòng lặp. `false` ⇒ file đã bị xoá ⇒ bỏ qua hẳn (không gọi
 * API, không tính vào done/failed) — người dùng bấm xoá là muốn huỷ, và huỷ chỉ hợp lệ khi file
 * CHƯA được gửi (xem `SourceTab.tsx`'s `removeQueuedFile`, chỉ cho xoá file đang ở trạng thái
 * "waiting" — file đang "running" không thể bị xoá nữa, kể cả khi bấm X đúng lúc UI chưa kịp
 * vẽ lại, vì `removeQueuedFile` tự kiểm tra lại trạng thái SỐNG chứ không tin nút bấm).
 */
export function isQueuedFileStillPending(id: string, currentQueue: readonly { id: string }[]): boolean {
  return currentQueue.some((item) => item.id === id);
}
