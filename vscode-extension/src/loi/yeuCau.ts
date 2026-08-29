/**
 * Dựng thân POST cho `/api/ai/local-kb/stream`.
 *
 * ⚠ Vì sao LOCAL phải là `codingMode:false`: tool đọc/grep của server chạy trên hộp cát CỦA
 * SERVER. Mã của dev không có ở đó, nên bật tool server chỉ khiến model đọc nhầm repo khác rồi
 * trả lời tự tin mà sai. Ở chế độ LOCAL, ngữ cảnh do extension gom sẵn và nhét vào `question`.
 */
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

  // Chỉ dán nhãn khi THẬT SỰ có ngữ cảnh đính kèm — ngữ cảnh rỗng thì không đẻ khung/nhãn thừa.
  const nguCanhCoNhan =
    dv.nguCanh.trim().length > 0 ? `${nhanNguonNguCanh(dv.cheDo)}\n${dv.nguCanh}` : dv.nguCanh;
  const question = nguCanhCoNhan.trim().length > 0 ? `${nguCanhCoNhan}\n${dv.cauHoi}` : dv.cauHoi;

  return { question, history: dv.lichSu, userRole: dv.vaiTro, context };
}
