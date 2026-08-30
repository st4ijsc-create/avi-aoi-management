/**
 * Dựng thân POST cho `/api/ai/local-kb/stream`.
 *
 * ⚠ Vì sao LOCAL phải là `codingMode:false`: tool đọc/grep của server chạy trên hộp cát CỦA
 * SERVER. Mã của dev không có ở đó, nên bật tool server chỉ khiến model đọc nhầm repo khác rồi
 * trả lời tự tin mà sai. Ở chế độ LOCAL, ngữ cảnh do extension gom sẵn và nhét vào `question`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-30 (Đợt D.1, LỖI 1) — CHẾ ĐỘ LOCAL PHẢI TỰ DẠY GIAO THỨC `avi-tool`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `codingMode:false` (bắt buộc, xem trên) đồng nghĩa máy chủ định tuyến câu hỏi LOCAL sang
 * `getSystemPromptForRole()` — persona RAG tri thức VẬN HÀNH, không phải persona lập trình. Đo
 * Task 6: 11/11 lượt LOCAL model không hề thử phát khối ```avi-tool``` — máy chủ chưa từng dạy nó
 * (server KHÔNG hề biết chuỗi "avi-tool", đây là giao thức HOÀN TOÀN client-side, xem docblock
 * `dayGiaoThucDoc.ts`). Cách vá SAI là bật `codingMode:true` cho LOCAL để "mượn" persona lập
 * trình — đã LOẠI vì hai lý do đo được: (1) persona đó dạy một protocol KHÁC hẳn (sinh mã/diff
 * trực tiếp), không phải khối JSON `avi-tool`; (2) nó chạy tool NGAY TRÊN HỘP CÁT CỦA SERVER —
 * đúng thứ đoạn văn ngay phía trên cảnh báo. Cách vá ĐÚNG: EXTENSION tự dạy, cùng cách
 * `cauHoiSuaChon.ts` (Cmd+K) đã dạy cho hai tool GHI.
 */
import { dungVanBanDayGiaoThucDoc, nhacLaiCuoiCauHoi } from "./dayGiaoThucDoc";

export type CheDoDuAn =
  | { loai: "local"; nhan: string }
  | { loai: "server"; projectId: string; nhan: string };

export type LuotChat = { role: "user" | "assistant"; content: string };

/**
 * Nhãn nguồn cho khối ngữ cảnh đính kèm. Ngữ cảnh LUÔN đọc từ editor trên máy DEV
 * (`bangChat.ts#thuThapNguCanh` dùng `vscode.window.activeTextEditor`), BẤT KỂ `cheDo` đang chọn
 * dự án nào. Ở chế độ SERVER, model còn có tool đọc/grep trên MỘT CÂY MÃ KHÁC (dự án trên box AI)
 * — không dán nhãn thì model không cách nào biết đoạn dán vào KHÁC với cây nó tự đọc, đúng loại
 * "tai nạn không cứu được" mà spec cảnh báo (§7).
 */
function nhanNguonNguCanh(cheDo: CheDoDuAn): string {
  if (cheDo.loai === "server") {
    return `--- NGUỒN: đoạn mã dưới đây đọc từ máy LOCAL của lập trình viên — KHÔNG PHẢI dự án SERVER "${cheDo.nhan}" (đó là một cây mã KHÁC, nằm trên máy chủ) ---`;
  }
  return `--- NGUỒN: đoạn mã dưới đây đọc từ máy LOCAL của lập trình viên (${cheDo.nhan}) ---`;
}

export function dungYeuCauStream(dv: {
  cauHoi: string;
  nguCanh: string;
  lichSu: LuotChat[];
  ngonNgu: string;
  vaiTro: string;
  cheDo: CheDoDuAn;
}): Record<string, unknown> {
  const context: Record<string, unknown> = {
    route: "vscode",
    uiLanguage: dv.ngonNgu,
    codingMode: dv.cheDo.loai === "server",
  };
  if (dv.cheDo.loai === "server") context.projectId = dv.cheDo.projectId;

  // ★★★ LỖI 1 — dạy giao thức `avi-tool` (ba tool ĐỌC) CHỈ ở chế độ LOCAL, đứng TRƯỚC cả ngữ cảnh
  // mã lẫn câu hỏi. SERVER có vòng tool riêng chạy trên hộp cát máy chủ (xem docblock module) —
  // dạy `avi-tool` ở đó là dạy một giao thức không ai đọc, nên KHÔNG chèn cho `cheDo.loai==="server"`.
  const phanDayGiaoThuc = dv.cheDo.loai === "local" ? `${dungVanBanDayGiaoThucDoc()}\n\n` : "";

  // ★★★ LỖI 1, vòng đo lại thứ nhất — nhắc lại NGẮN ở CUỐI `question` (gần điểm sinh chữ nhất).
  // Đo LIVE: dạy MỘT LẦN ở đầu prompt thua luật "NGUYÊN TẮC TRẢ LỜI" máy chủ tự chèn ở 10/11 lượt
  // — xem docblock `dayGiaoThucDoc.ts`. KHÔNG áp cho SERVER (cùng lý do không dạy giao thức ở đó).
  // ★ CHỐNG TỰ-THOẢ (đo 2026-08-30): gỡ đúng hai dòng `phanDayGiaoThuc`/`phanNhacLaiCuoi` này (ép
  //   rỗng bất kể chế độ), build lại, chạy 5 câu Step 2 ⇒ tỉ lệ tuân thủ SẬP về 0/5 (C_BO_QUA_GIAO_
  //   THUC cả năm) — y hệt baseline Task 6. Xác nhận số đẹp đến từ ĐÚNG hai dòng này, không phải
  //   nơi khác. Đã hoàn nguyên về đúng bản đã đo LIVE (10/11 A) sau khi ablation xong.
  const phanNhacLaiCuoi = dv.cheDo.loai === "local" ? nhacLaiCuoiCauHoi() : "";

  // Chỉ dán nhãn khi THẬT SỰ có ngữ cảnh đính kèm — ngữ cảnh rỗng thì không đẻ khung/nhãn thừa.
  const nguCanhCoNhan =
    dv.nguCanh.trim().length > 0 ? `${nhanNguonNguCanh(dv.cheDo)}\n${dv.nguCanh}` : dv.nguCanh;
  const than = nguCanhCoNhan.trim().length > 0 ? `${nguCanhCoNhan}\n${dv.cauHoi}` : dv.cauHoi;
  const question = `${phanDayGiaoThuc}${than}${phanNhacLaiCuoi}`;

  return { question, history: dv.lichSu, userRole: dv.vaiTro, context };
}
