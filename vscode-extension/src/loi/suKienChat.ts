/**
 * Xử lý THUẦN các sự kiện SSE của MỘT lượt chat: gom token, đóng lượt khi có `done`, phát hiện
 * lượt bị CẮT NGANG (luồng kết thúc mà KHÔNG có khung `done`).
 *
 * ⚠ Vì sao module này tồn tại tách khỏi `bangChat.ts` (import `vscode`, không đo được bằng lưới):
 * "chữ ngừng chảy vì máy chủ nói xong" và "chữ ngừng chảy vì kết nối đứt/hỏng giữa chừng" TRÔNG
 * GIỐNG NHAU ở phía người dùng nhưng nghĩa khác hẳn. Gộp chung ⇒ câu trả lời cụt bị lưu vào lịch
 * sử như thể hoàn chỉnh — model lượt sau tin vào một câu trả lời chưa từng được nói hết.
 *
 * ⚠ `degraded:true` (server/routes/aiLocalKnowledgeApi.ts:610-620, "FE-W0.3") nghĩa là: vòng lặp
 * công cụ phía server bị suy biến, chữ ĐÃ STREAM không đáng tin — BỎ nó, dùng `answer` của khung
 * `done` thay thế toàn bộ.
 *
 * ⚠ `hong` (`docLuongSse` trả về — hợp đồng của `khungSse.ts`) là các khung SSE không phân tích
 * được. Hợp đồng đó nói rõ: KHÔNG được nuốt im lặng — module này giữ đúng lời hứa ấy tới tận UI.
 */

export interface TrangThaiLuotChat {
  /** Chữ hiển thị/lưu cho lượt này — token gộp dần, hoặc bị THAY bằng `answer` nếu `degraded`. */
  traLoi: string;
  /** Đã nhận khung `done` chưa — false khi kết thúc nghĩa là luồng bị CẮT NGANG. */
  daNhanDone: boolean;
  /** true khi khung `done` bảo thay chữ đã stream bằng `answer` (vòng lặp công cụ suy biến). */
  degraded: boolean;
  /** Đã có khung `error` chưa — chặn cảnh báo "cắt ngang" LẶP LẠI khi lỗi đã được báo riêng. */
  daBaoLoi: boolean;
}

export function trangThaiBanDau(): TrangThaiLuotChat {
  return { traLoi: "", daNhanDone: false, degraded: false, daBaoLoi: false };
}

/** Áp MỘT sự kiện SSE đã phân tích vào trạng thái lượt chat. Trả trạng thái MỚI, không đổi cũ. */
export function apDungSuKienChat(
  tt: TrangThaiLuotChat,
  sk: Record<string, unknown>,
): TrangThaiLuotChat {
  if (sk.type === "token" && typeof sk.token === "string") {
    return { ...tt, traLoi: tt.traLoi + sk.token };
  }
  if (sk.type === "done") {
    const dungAnswer = sk.degraded === true && typeof sk.answer === "string";
    return {
      ...tt,
      daNhanDone: true,
      degraded: dungAnswer,
      traLoi: dungAnswer ? (sk.answer as string) : tt.traLoi,
    };
  }
  if (sk.type === "error") {
    return { ...tt, daBaoLoi: true };
  }
  return tt;
}

/**
 * Kết luận sau khi vòng đọc SSE kết thúc (dù bình thường hay vì lỗi/huỷ). Trả chữ CUỐI CÙNG để
 * hiện/lưu, và một câu cảnh báo (hoặc `null` nếu không có gì phải nói).
 */
export function ketLuanLuotChat(
  tt: TrangThaiLuotChat,
  hong: string[],
): { traLoi: string; canhBao: string | null } {
  const ghiChu: string[] = [];
  // Đã báo lỗi riêng rồi thì KHÔNG lặp lại — "cắt ngang" chỉ dành cho ca im lặng không rõ lý do.
  if (!tt.daNhanDone && !tt.daBaoLoi) {
    ghiChu.push("Câu trả lời có thể đã bị CẮT NGANG — luồng kết thúc mà không có tín hiệu hoàn tất.");
  }
  if (hong.length > 0) {
    ghiChu.push(`${hong.length} khung dữ liệu lỗi không đọc được, đã bỏ qua.`);
  }
  return { traLoi: tt.traLoi, canhBao: ghiChu.length > 0 ? ghiChu.join(" ") : null };
}
