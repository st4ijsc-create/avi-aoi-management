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
 * server-supplied `allowedTypes`) or what the server accepts.
 * Exported (Task V9) so `kbFormatGuidance.crossCheck.unit.test.ts` can assert this manual mirror
 * still matches the server's real `normalizeSourceType` — closes the "never verified
 * programmatically" gap this doc comment used to just accept as a risk. */
export const KNOWN_IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "webp"];

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

/**
 * Task V9 (in-UI training guidance) — gợi ý corpus theo ĐÚNG danh mục miền chủ dự án đã nêu
 * (PLC ladder Mitsubishi/Omron, robot 6 trục Fanuc/Mitsubishi, cobot Techman). Đây là NHÃN GỢI Ý
 * hiển thị trong SourceTab.tsx, không phải danh sách corpus đã tồn tại trên server — bấm vào một
 * gợi ý chỉ ĐIỀN tên vào ô "Tên corpus" (giống gõ tay), KHÔNG gọi `createCorpus` và không tự tạo
 * corpus rỗng hàng loạt. Corpus chỉ thực sự được đăng ký khi tài liệu đầu tiên được nạp vào (xem
 * `SourceTab.tsx`'s "corpusHelp" / module doc: "corpus sẽ tự động đăng ký khi nạp lần đầu").
 * Tên dùng gạch nối, nhất quán một khuôn `<miền>-<hãng>`.
 */
export interface KbCorpusDomainSuggestion {
  /** Điền thẳng vào ô "Tên corpus" khi bấm — không khoảng trắng, không dấu. */
  corpus: string;
  /** Nhãn hiển thị trên nút gợi ý. */
  label: string;
  /**
   * ★ G15 (2026-09-22) — nhóm để xếp nút thành HÀNG CÓ NGHĨA thay vì một dải phẳng. Một dải 15
   * nút không nhóm thì người dùng phải đọc hết mới biết có cái mình cần hay không.
   */
  nhom: "ngon-ngu" | "cong-nghiep" | "du-an";
}

/**
 * ★★★ G15 (audit 2026-09-22) — **CORPUS CHO NGÔN NGỮ LẬP TRÌNH, ĐỦ MIỀN.**
 *
 * Trước bản này danh sách chỉ có năm miền CÔNG NGHIỆP, và màn hình còn khuyên thẳng rằng nạp tài
 * liệu lập trình *"KHÔNG dạy thêm gì"*. Đo được trong đợt audit ba dự án thật (2026-09-22) cho
 * thấy lời khuyên ấy **quá mạnh**: model nắm cú pháp, nhưng sai ở tầng **API**. Ca cụ thể, ổn định
 * 0/3 lượt: nó sinh `reader.GetInt32("MaHocSinh")` — `SqlDataReader.GetInt32` nhận **số thứ tự
 * cột**, không nhận tên cột. Một lỗi gốc lặp 5 lần, và `dotnet build` chặn cả tệp.
 *
 * Đó chính là loại sai mà một corpus **tham chiếu API + quy ước** chữa được, và là loại sai mà
 * "model đã biết ngôn ngữ này rồi" không chữa nổi. Phân biệt phải nói rõ:
 *   • tài liệu **tham chiếu API / quy ước dự án** ⇒ CÓ ÍCH (đúng chỗ model sai);
 *   • giáo trình nhập môn chung chung ⇒ vô ích và gây nhiễu (đúng cảnh báo cũ đã đo).
 *
 * ⚠ Đây vẫn chỉ là NHÃN GỢI Ý: bấm một nút chỉ ĐIỀN tên vào ô "Tên corpus". Không nút nào gọi
 *   `createCorpus`, nên thêm bao nhiêu gợi ý cũng KHÔNG đẻ ra một corpus rỗng nào trên server.
 * ⚠ C++ nằm trong danh sách dù chủ dự án đã hoãn phần C++ — một cái tên gợi ý không tốn gì, và
 *   ngày cần tới thì nó đã ở đúng khuôn `<miền>-<hãng>` thay vì được đặt tên tuỳ hứng.
 */
export const KB_CORPUS_DOMAIN_SUGGESTIONS: readonly KbCorpusDomainSuggestion[] = [
  // ── Ngôn ngữ & nền tảng lập trình ─────────────────────────────────────────────
  { corpus: "csharp-dotnet", label: "C# / .NET", nhom: "ngon-ngu" },
  { corpus: "sql-tsql-sqlserver", label: "SQL Server — T-SQL", nhom: "ngon-ngu" },
  { corpus: "sql-postgresql", label: "PostgreSQL", nhom: "ngon-ngu" },
  { corpus: "typescript-node", label: "TypeScript / Node.js", nhom: "ngon-ngu" },
  { corpus: "react-frontend", label: "React / frontend", nhom: "ngon-ngu" },
  { corpus: "python", label: "Python", nhom: "ngon-ngu" },
  { corpus: "cpp", label: "C++", nhom: "ngon-ngu" },
  // ── Miền công nghiệp ──────────────────────────────────────────────────────────
  { corpus: "plc-ladder-mitsubishi", label: "PLC ladder — Mitsubishi", nhom: "cong-nghiep" },
  { corpus: "plc-ladder-omron", label: "PLC ladder — Omron", nhom: "cong-nghiep" },
  { corpus: "plc-st-iec61131", label: "PLC Structured Text — IEC 61131-3", nhom: "cong-nghiep" },
  { corpus: "gcode-cnc", label: "G-code CNC", nhom: "cong-nghiep" },
  { corpus: "zmotion", label: "ZMotion", nhom: "cong-nghiep" },
  { corpus: "robot-fanuc", label: "Robot 6 trục — Fanuc", nhom: "cong-nghiep" },
  { corpus: "robot-mitsubishi", label: "Robot 6 trục — Mitsubishi", nhom: "cong-nghiep" },
  { corpus: "cobot-techman", label: "Cobot — Techman", nhom: "cong-nghiep" },
  // ── Quy ước của chính dự án này ───────────────────────────────────────────────
  { corpus: "repo-conventions", label: "Quy ước repo này", nhom: "du-an" },
];

/** Nhãn tiếng Việt của từng nhóm, dùng làm tiêu đề hàng nút trong SourceTab. */
export const NHAN_NHOM_CORPUS: Readonly<Record<KbCorpusDomainSuggestion["nhom"], string>> = {
  "ngon-ngu": "Ngôn ngữ & nền tảng lập trình",
  "cong-nghiep": "Miền công nghiệp",
  "du-an": "Quy ước dự án",
};

/** Gom gợi ý theo nhóm, GIỮ NGUYÊN thứ tự khai báo trong mỗi nhóm. Hàm THUẦN. */
export function goiYCorpusTheoNhom(): ReadonlyArray<{
  nhom: KbCorpusDomainSuggestion["nhom"];
  nhan: string;
  muc: readonly KbCorpusDomainSuggestion[];
}> {
  const thuTu: ReadonlyArray<KbCorpusDomainSuggestion["nhom"]> = ["ngon-ngu", "cong-nghiep", "du-an"];
  return thuTu.map((n) => ({
    nhom: n,
    nhan: NHAN_NHOM_CORPUS[n],
    muc: KB_CORPUS_DOMAIN_SUGGESTIONS.filter((s) => s.nhom === n),
  }));
}

/**
 * Task V9 — định dạng tệp KHÔNG được `kbDocParser.normalizeSourceType` (server) nhận qua đường
 * tải-tệp của Training Studio, dùng để hiển thị trong bảng hướng dẫn của SourceTab.tsx
 * ("KHÔNG nhận: …"). Server không phơi ra một danh sách "bị từ chối" nào (chỉ có `allowedTypes`,
 * danh sách ĐƯỢC nhận — xem `formatAllowedTypesLabel` ở trên, luôn lấy trực tiếp từ server, không
 * bao giờ chép tay) nên đây buộc phải là hằng số chép tay. Để nó không TRÔI khỏi hành vi thật:
 * `kbFormatGuidance.crossCheck.unit.test.ts` import THẲNG `normalizeSourceType` thật từ
 * `server/services/kbDocParser.ts` (an toàn ở tầng TEST — vitest chạy client và server trong
 * CÙNG một tiến trình node, xem vitest.config.ts; KHÔNG import vào bundle trình duyệt thật, client
 * và server vẫn là hai bản build tách biệt như comment của `KNOWN_IMAGE_EXTENSIONS` ở trên đã nói)
 * và khẳng định MỌI phần tử ở đây thật sự bị `KbUnsupportedTypeError` từ chối.
 */
export const KB_STUDIO_REJECTED_EXTENSIONS_FOR_GUIDANCE: readonly string[] = ["xlsx", "xls", "csv", "chm", "zip"];
