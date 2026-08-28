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

  const question = dv.nguCanh.trim().length > 0 ? `${dv.nguCanh}\n${dv.cauHoi}` : dv.cauHoi;

  return { question, history: dv.lichSu, userRole: dv.vaiTro, context };
}
