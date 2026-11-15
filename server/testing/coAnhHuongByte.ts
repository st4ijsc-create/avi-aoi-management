/**
 * V1.1 — DANH SÁCH CỜ ẢNH HƯỞNG BYTE (phát lại fixture H4.2). MỘT nguồn cho: (1) ghim cờ khi phát lại (`banCoKhiPhatLai`), (2) census đối chiếu với mọi chỗ mã đọc cờ
 * (`coAnhHuongByte.census.test.ts`), (3) do-model: ảnh chụp cờ lúc GHI (V1.3) và `dongGoi.ts` (V1.4) import thẳng danh sách này, không định nghĩa lại.
 *
 * NHÓM:
 *   • `doi-byte`        — cờ làm đổi chữ GỬI MODEL (lời nhắc, danh sách / mô tả công cụ, kết quả công cụ, nén ngữ cảnh) HOẶC kết quả lượt chạy thấy được khi phát lại
 *                         (sự kiện, lý do dừng, số lượt). Bắt buộc khai `vang` (giá trị hiệu lực khi cờ VẮNG) — census so với MẶC ĐỊNH THẬT của mã tại chỗ đọc, lệch ⇒ đỏ.
 *   • `khong-doi-byte`  — cờ (hoặc hằng chuỗi trùng tên cờ) KHÔNG đổi byte gửi model và không đổi kết quả lượt; bắt buộc `lyDo` một dòng.
 * Cờ chưa phân loại (có trong mã mà không có ở đây) ⇒ census ĐỎ; mục ở đây mà mã không còn nhắc tới ⇒ census ĐỎ.
 *
 * `vang`: "tat" = vắng ⇒ tính năng TẮT (hành vi cũ) · "bat" = vắng ⇒ BẬT (mặc định bật) · "khong-dat" = cờ giá trị, vắng ⇒ không ghi đè · `chuoi:<x>` = vắng ⇒ giá trị chuỗi hiệu lực <x>.
 * `phuBoi` (chỉ cho `vang = "bat"`): "mac-dinh-tu-dau" = mặc định bật TỪ TRƯỚC mọi fixture (fixture cũ phủ nhánh bật bằng chính việc cờ vắng; danh sách đóng, xem census);
 *   "fixture-co-bat" = mặc định bật SAU NÀY ⇒ phải có ít nhất MỘT fixture ghi với cờ bật (V1.2: chặn đổi mặc định khi không có fixture phủ nhánh).
 *
 * Phạm vi quét của census: mọi tên bắt đầu `AI_AGENT_` / `AI_AGENTIC_` trong server/ + shared/ (không kể test), cộng `CO_QUET_THEM`. Các cờ `AI_CODING_*` khác (chat coding cũ, không qua
 * vòng agent) CHƯA vào phạm vi — đưa vào bằng cách thêm vào `CO_QUET_THEM` + một mục ở đây.
 */

export type NhomCo = "doi-byte" | "khong-doi-byte";
export type GiaTriVang = "tat" | "bat" | "khong-dat" | `chuoi:${string}`;

export interface CoAnhHuongByte {
  ten: string;
  nhom: NhomCo;
  /** Bắt buộc khi `nhom = "doi-byte"`. */
  vang?: GiaTriVang;
  /** Bắt buộc khi `vang = "bat"`. */
  phuBoi?: "mac-dinh-tu-dau" | "fixture-co-bat";
  /** Một dòng. Bắt buộc với `khong-doi-byte`; khuyến khích với `doi-byte`. */
  lyDo: string;
}

/** Tiền tố quét tự động. */
export const TIEN_TO_CO_QUET: readonly string[] = ["AI_AGENT_", "AI_AGENTIC_"];
/** Cờ ngoài tiền tố mà vòng agent đọc (hoặc đổi nội dung gửi model của nó). Thêm ở đây ⇒ census quét thêm. */
export const CO_QUET_THEM: readonly string[] = [
  "AI_CODING_AUTOLOOP",
  "AI_CODING_TU_TRI_GHI",
  "AI_CODING_TU_TRI_GHI_REPO_CHINH",
  "AI_CODING_MODEL_TASK",
  "AI_KIEM_BIEN_DICH_ST",
  "AI_COMPILE_ST_TRAN_MOI_LUOT",
  "AI_GHI_LUOT_DIR",
];

/** Danh sách ĐÓNG các cờ mặc định BẬT từ trước mọi fixture (xem `phuBoi`). Thêm tên vào đây là một thay đổi hiển thị cho người rà. */
export const CO_MAC_DINH_BAT_TU_DAU: readonly string[] = [
  "AI_AGENT_CUU_TRAN",
  "AI_AGENT_GIU_NGHI",
  "AI_AGENT_KIEM_DAC_TA",
  "AI_AGENT_NGHI",
  "AI_AGENT_THEO_VAI_TRO",
  "AI_AGENT_TU_TRA_API",
];

const db = (ten: string, vang: GiaTriVang, lyDo: string, phuBoi?: "mac-dinh-tu-dau" | "fixture-co-bat"): CoAnhHuongByte => ({ ten, nhom: "doi-byte", vang, lyDo, ...(phuBoi ? { phuBoi } : {}) });
const kd = (ten: string, lyDo: string): CoAnhHuongByte => ({ ten, nhom: "khong-doi-byte", lyDo });

export const CO_ANH_HUONG_BYTE: readonly CoAnhHuongByte[] = [
  db("AI_AGENTIC_ENABLED", "tat", "cổng bật trung tâm tác nhân: vắng ⇒ không có lượt chạy nào"),
  db("AI_AGENT_AN_CONG_CU", "khong-dat", "danh sách tool bị ẩn khỏi model; vắng ⇒ không ẩn tool nào"),
  db("AI_AGENT_CONG_KE_HOACH", "tat", "phơi tool kế hoạch + lời nhắc kế hoạch"),
  db("AI_AGENT_CON_BAO_CAO", "tat", "tool `report` của vòng con"),
  db("AI_AGENT_CSV_DOC", "tat", "mở đọc .csv dưới sandbox-projects + câu thêm vào mô tả read_file (B1)"),
  db("AI_AGENT_CUU_TRAN", "bat", "cứu tràn ngữ cảnh: nén mạnh khi bị từ chối vì tràn", "mac-dinh-tu-dau"),
  db("AI_AGENT_DAU_RA_DAI", "tat", "kho đầu ra dài: kết quả tool dài thành tham chiếu + tool read_output"),
  db("AI_AGENT_DOC_TRUOC_KHI_GHI", "tat", "write/edit tệp có sẵn phải đọc trước (thêm lời từ chối)"),
  db("AI_AGENT_GIAO_VIEC", "tat", "tool `delegate` (giao việc cho vòng con)"),
  db("AI_AGENT_GIU_NGHI", "bat", "giữ suy luận trong lịch sử gửi lại model", "mac-dinh-tu-dau"),
  db("AI_AGENT_GOI_Y_LENH", "tat", "gợi ý dạng lệnh được phép trong lời từ chối lệnh tu-dong (HA-4)"),
  db("AI_AGENT_KIEM_DAC_TA", "bat", "nhắc kiểm đặc tả sau lần xanh đầu", "mac-dinh-tu-dau"),
  db("AI_AGENT_MAX_TOKENS_MOT_LUOT", "khong-dat", "trần token ra mỗi lượt model (tham số yêu cầu)"),
  db("AI_AGENT_NEN_MOC", "khong-dat", "đích nén ngữ cảnh (mức < ngưỡng ⇒ nén sâu một lần)"),
  db("AI_AGENT_NEN_SO_THAT", "tat", "nén dựa số token THẬT của lượt trước thay vì ước lượng"),
  db("AI_AGENT_NGHI", "bat", "bật chế độ suy luận của model (tham số yêu cầu)", "mac-dinh-tu-dau"),
  db("AI_AGENT_SO_LUOT_TOI_DA", "khong-dat", "trần số lượt chạy ⇒ lý do dừng `het-luot`"),
  db("AI_AGENT_THEO_VAI_TRO", "bat", "chọn model/vai theo loại dự án (PLC / phần mềm)", "mac-dinh-tu-dau"),
  db("AI_AGENT_TIEP_TUC", "tat", "lưu lịch sử lượt để tiếp tục lượt chạy"),
  db("AI_AGENT_TOM_TAT_80", "tat", "nhắc tóm tắt khi ngữ cảnh gần đầy"),
  db("AI_AGENT_TOOL_TIMEOUT", "tat", "hạn giờ công cụ đọc/tìm ⇒ kết quả TOOL_TIMEOUT"),
  db("AI_AGENT_TU_TRA_API", "bat", "tự tra API khi lỗi biên dịch, gắn khối gợi ý vào quan sát", "mac-dinh-tu-dau"),
  kd("AI_AGENT_HOAN_TAC", "hằng nhãn kiểm toán (LY_DO_HOAN_TAC, AUDIT_ACTIONS), không phải biến môi trường"),
  kd("AI_AGENT_HOUSEKEEPING_ENABLED", "dọn dữ liệu nền, không vào lượt chạy"),
  kd("AI_AGENT_HOUSEKEEPING_INTERVAL_MS", "chu kỳ dọn nền, không vào lượt chạy"),
  kd("AI_AGENT_TU_DONG", "hằng nhãn lý do (LY_DO_AGENT_TU_DONG) trong sổ duyệt, không phải biến môi trường"),
  kd("AI_AGENT_UOC_LUONG_TOKEN", "ước lượng token cho cổng quota, không vào lời nhắn"),
  db("AI_CODING_AUTOLOOP", "tat", "cho phép lệnh kiểm chứng chạy không duyệt ở tu-dong (không có ⇒ lệnh bị từ chối)"),
  db("AI_CODING_MODEL_TASK", "tat", "đặt `code` ⇒ chọn model lập trình thay model chat"),
  db("AI_CODING_TU_TRI_GHI", "tat", "cho phép ghi không duyệt ở tu-dong"),
  db("AI_CODING_TU_TRI_GHI_REPO_CHINH", "tat", "mở ghi tu-dong vào repo chính (ngoài sandbox-projects)"),
  db("AI_COMPILE_ST_TRAN_MOI_LUOT", "khong-dat", "trần số lần compile_st mỗi lượt chạy"),
  db("AI_KIEM_BIEN_DICH_ST", "chuoi:plc", "bề mặt bật kiểm biên dịch ST; mặc định `agent-plc` ⇒ chỉ dự án PLC"),
  kd("AI_GHI_LUOT_DIR", "bật bộ GHI lượt (chuyển nguyên từng mảnh), không đổi byte gửi model"),
];

/** Cờ làm đổi byte (nhóm `doi-byte`), theo thứ tự tên. Dùng cho ảnh chụp cờ lúc ghi (V1.3). */
export function tenCoDoiByte(): string[] {
  return CO_ANH_HUONG_BYTE.filter((c) => c.nhom === "doi-byte")
    .map((c) => c.ten)
    .sort();
}

/**
 * V1.1 — BẢN VÁ MÔI TRƯỜNG khi PHÁT LẠI một fixture: với MỌI cờ `doi-byte`, lấy giá trị lúc ghi nếu fixture có (`moiTruong`), nếu không thì cờ cố định của KHUNG THỬ (`coCoDinh`,
 * vd `AI_AGENT_THEO_VAI_TRO=0`), nếu không nữa thì GỠ BIẾN (mã dùng mặc định thật của nó). ⇒ cờ `export` trong shell, hoặc cờ mới bật ở môi trường chạy test, không làm fixture cũ đỏ oan.
 * Thứ tự ưu tiên: fixture > khung thử > gỡ. Thuần: không đụng `process.env`; người gọi áp dụng rồi khôi phục.
 * Cờ của fixture KHÔNG thuộc danh sách vẫn được đặt (như cũ) — fixture cũ có thể khai cờ ngoài danh sách.
 */
export function banCoKhiPhatLai(
  moiTruong: Readonly<Record<string, string>> | undefined,
  coCoDinh: Readonly<Record<string, string>> = {},
): { dat: Record<string, string>; xoa: string[] } {
  const dat: Record<string, string> = { ...coCoDinh, ...(moiTruong ?? {}) };
  const xoa = tenCoDoiByte().filter((k) => !(k in dat));
  return { dat, xoa };
}
