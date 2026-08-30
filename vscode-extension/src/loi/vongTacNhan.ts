/**
 * ★★★ VÒNG LẶP TÁC NHÂN Ở CLIENT (Đợt D / Task 3) — QUYẾT ĐỊNH THUẦN, TÁCH KHỎI THỰC THI.
 *
 * Vì sao vòng lặp phải chạy ở CLIENT chứ không phải máy chủ: máy chủ không thấy mã trên máy lập
 * trình viên (mọi việc ĐỌC — `doc_tep`/`liet_ke`/`grep`, Task 2 — chạy trên đĩa của dev), và vòng
 * tool phía máy chủ có TRẦN 20 giây trong khi một lượt hỏi model 30B có thể mất vài phút (spec §3)
 * — đủ cho MỘT lượt token nhưng không đủ cho "hỏi → đọc tệp → hỏi lại" qua nhiều vòng.
 *
 * Hàm DUY NHẤT ở đây (`buocKeTiep`) chỉ trả lời "bước KẾ TIẾP là gì" từ NĂM con số/cờ — không đọc
 * đĩa, không gọi mạng, không `import "vscode"`. `ui/bangChat.ts` là nơi THỰC THI quyết định này
 * (chạy `chayToolCucBo`, gọi model, hiện tiến độ cho người dùng) — tách bạch để đo được TOÀN BỘ
 * logic dừng/tiếp của vòng lặp bằng lưới đơn vị, không cần dựng SSE giả cho mọi ca biên.
 */
import { kepTranVong } from "../../../shared/aiCodingLoop";

/**
 * Bước kế tiếp của vòng lặp.
 *
 * ⚠⚠ `goi_model` KHÔNG BAO GIỜ được `buocKeTiep` dưới đây TRẢ VỀ — hàm này chỉ quyết định giữa
 * "chạy tool" và "dừng". Sau khi tool chạy xong, gọi model lại là bước KẾ TIẾP CHẮC CHẮN của
 * `ui/bangChat.ts` (vòng lặp ở đó tự quay lại đầu), không phải một nhánh cần quyết định thêm — MỌI
 * điều kiện DỪNG (huỷ/lỗi/hết trần/hết yêu cầu đọc) đều đã được xét NGAY SAU lượt model vừa rồi,
 * trước khi có bất kỳ tool nào chạy. Biến thể `goi_model` vẫn có mặt trong kiểu để `ui/bangChat.ts`
 * dùng CHUNG một nhãn khi báo tiến độ ("vòng N/T — đang gọi model") thay vì tự bịa ra một chuỗi
 * loại-bước thứ hai lệch khỏi kiểu này.
 */
export type BuocVong =
  | { loai: "goi_model" }
  | { loai: "chay_tool" }
  | { loai: "dung"; lyDo: "het_tran" | "khong_con_tool" | "nguoi_dung_dung" | "loi" };

/**
 * ★★★ CẦU CHÌ CỦA VÒNG LẶP TÁC NHÂN — được gọi NGAY SAU khi một lượt model vừa trả lời xong (đã
 * biết `traLoi` có yêu cầu đọc hay không, đã biết cờ huỷ/lỗi TẠI THỜI ĐIỂM ĐÓ).
 *
 * Thứ tự ưu tiên khi NHIỀU điều kiện cùng đúng — có tải trọng, không phải văn phong:
 *   1. `biHuy` — NGƯỜI BẤM DỪNG THẮNG TUYỆT ĐỐI, kể cả khi còn trần VÀ model vừa xin đọc thêm. Một
 *      vòng lặp "đã dừng" nhưng vẫn âm thầm chạy thêm một lượt vì "còn việc dở" là phản bội đúng
 *      cái nút người dùng vừa bấm.
 *   2. `coLoi` — lượt vừa rồi máy chủ đã báo lỗi (khung SSE `type:"error"`); đi tiếp trên một lượt
 *      đã hỏng là suy luận trên rác, tốn thêm ít nhất một lượt gọi model vô ích.
 *   3. hết trần.
 *   4. hết yêu cầu đọc (model trả lời suông, không còn `doc_tep`/`liet_ke`/`grep` nào trong văn
 *      bản) ⇒ coi là xong việc.
 *   5. còn lại: còn trần, còn yêu cầu đọc, không huỷ, không lỗi ⇒ chạy tool.
 */
export function buocKeTiep(tt: {
  vong: number;
  tran: number;
  coYeuCauDoc: boolean;
  biHuy: boolean;
  coLoi: boolean;
}): BuocVong {
  if (tt.biHuy) return { loai: "dung", lyDo: "nguoi_dung_dung" };
  if (tt.coLoi) return { loai: "dung", lyDo: "loi" };

  // ★ `tran` PHẢI qua `kepTranVong` — KHÔNG tự đặt hằng số trần mới (chỉ thị của đợt này, xem
  // `shared/aiCodingLoop.ts`). Giá trị rác (NaN/Infinity/âm/quá lớn) phải kẹp về khoảng hợp lệ
  // [TRAN_VONG_TOI_THIEU..TRAN_VONG_TOI_DA], mặc định TRAN_VONG_MAC_DINH=3 — KHÔNG phải 0 (dừng
  // ngay lập tức, vòng chưa chạy được vòng nào) và KHÔNG phải vô hạn (vòng không bao giờ dừng).
  const tran = kepTranVong(tt.tran);
  if (tt.vong >= tran) return { loai: "dung", lyDo: "het_tran" };
  if (!tt.coYeuCauDoc) return { loai: "dung", lyDo: "khong_con_tool" };
  return { loai: "chay_tool" };
}
