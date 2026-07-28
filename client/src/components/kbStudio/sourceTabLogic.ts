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

/**
 * Task 6, review round 2 — the upload card's format description ("pdf, docx, md hoặc txt…")
 * had silently drifted from the REAL server `accept` list the moment Task 6 added image
 * support: the label was hand-typed once and never updated, so png/jpg/jpeg/webp worked but no
 * user would ever know to try dragging one in. `allowedTypes` (from `trpc.kbIngest.status`,
 * `kbIngestRouter.ts:101`) is the SAME SINGLE SOURCE OF TRUTH already used to build the file
 * input's `accept` attribute (`acceptAttr` in SourceTab.tsx) — this just formats that exact
 * array for display, so the label can never drift from `accept` again: add a format server-side
 * and both update together automatically.
 */
export function formatAllowedTypesLabel(allowedTypes: readonly string[]): string {
  return allowedTypes.join(", ");
}

/** Extensions kbDocParser.ts's `detectImageKindFromLabel` (server/services/kbDocParser.ts)
 * recognises as images — kept in sync manually since client and server are separate builds.
 * Used ONLY to decide whether to show the "images are AI-described" hint below; it never
 * gates what the browser actually lets the user pick (that's `accept`, built straight from the
 * server-supplied `allowedTypes`) or what the server accepts. */
const KNOWN_IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "webp"];

/**
 * True when the server's real `allowedTypes` currently include at least one image extension —
 * i.e. an uploaded image will be routed through the VLM description path
 * (`kbImageDescriber.describeImageForKnowledge`) rather than ingested as plain text, which is
 * different enough behavior from every other supported type that the UI should say so up
 * front (Task 6 review round 2) rather than let the user discover it only after uploading.
 */
export function acceptsImageUploads(allowedTypes: readonly string[]): boolean {
  return allowedTypes.some((ext) => KNOWN_IMAGE_EXTENSIONS.includes(ext));
}
