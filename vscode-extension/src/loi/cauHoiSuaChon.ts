import { NHAN_HANG_RAO } from "./khoiAviTool";

/**
 * Dựng câu hỏi cho "Cmd+K — sửa đoạn đang chọn" (phím `ctrl+alt+k`).
 *
 * HÀM THUẦN — không import `vscode`, không đọc đĩa, không gọi mạng. Việc DUY NHẤT nó làm là ghép
 * một CHUỖI câu hỏi từ những gì `extension.ts` đã đọc sẵn (đường dẫn, khoảng dòng, đoạn mã, yêu
 * cầu). Câu hỏi đó sau đó đi qua ĐÚNG đường đã có, y hệt một câu người dùng tự gõ vào bảng chat:
 * `BangChat.hoi()` → SSE → (chế độ LOCAL) `docDeXuatCucBo` đọc khối ```avi-tool``` → thẻ duyệt +
 * diff native → người bấm "Ghi vào workspace" → `apBanVa`.
 *
 * ⚠⚠⚠ RÀNG BUỘC QUAN TRỌNG NHẤT: Cmd+K CHỈ DỰNG CÂU HỎI. Tệp này (và mọi nơi gọi nó) TUYỆT ĐỐI
 * không được mở một đường ghi mới — không API áp chỉnh sửa của VSCode (thứ `apBanVa.ts` dùng ở
 * bước ghi), không API ghi tệp `node:fs`. Nếu một bản vá sau này thêm một API như vậy vào đường
 * Cmd+K, census (`loi/census.unit.test.ts`, khẳng định ĐÚNG MỘT lần cho mỗi API đó, tại
 * `ui/apBanVa.ts`) PHẢI đỏ — đó là hàng rào cố ý, không phải lỗi cần né bằng cách nới lưới.
 *
 * `docDeXuatCucBo` (xem `./deXuatCucBo.ts`) chỉ đọc được khối ```avi-tool``` mang
 * `tool:"de_xuat_sua_doan"` với `args.path`/`args.dongDau`/`args.dongCuoi`/`args.thayThe` đúng
 * hình dạng — câu hỏi PHẢI ra lệnh rõ cho model trả lời đúng hình dạng đó với ĐÚNG `dongDau`/
 * `dongCuoi` đã chọn; thiếu chỉ dẫn này, model có thể trả lời đúng Ý nhưng SAI HÌNH DẠNG, đề xuất
 * bị đọc thành `[]`, và không thẻ duyệt nào hiện ra dù model đã hiểu đúng yêu cầu.
 */
export function dungCauHoiSuaChon(dv: {
  duongTuongDoi: string;
  dongDau: number;
  dongCuoi: number;
  doanChon: string;
  yeuCau: string;
}): string {
  // Đoạn chọn rỗng (hoặc chỉ khoảng trắng) ⇒ không có gì để hỏi — ném RÀNH MẠCH thay vì dựng một
  // câu hỏi trống rỗng gửi đi. Đây là lỗi lập trình (nơi gọi phải kiểm `selection.isEmpty` TRƯỚC),
  // nên throw là đúng chỗ: một chuỗi rỗng lặng lẽ trôi tới `hoi()` sẽ bị `BangChat` coi là
  // "người dùng không gõ gì" và bỏ qua — im lặng SAI, khác hẳn với "không dựng được câu hỏi".
  if (!dv.doanChon.trim()) {
    throw new Error("Không dựng được câu hỏi sửa đoạn: đoạn đang chọn rỗng.");
  }

  return [
    `Sửa đoạn mã sau trong tệp "${dv.duongTuongDoi}", từ dòng ${dv.dongDau} đến dòng ${dv.dongCuoi}:`,
    "```",
    dv.doanChon,
    "```",
    `Yêu cầu: ${dv.yeuCau}`,
    "",
    `Trả lời bằng ĐÚNG MỘT khối \`\`\`${NHAN_HANG_RAO}\`\`\` chứa JSON theo đúng hình dạng sau (KHÔNG ` +
      "dùng tool nào khác, KHÔNG đổi dongDau/dongCuoi):",
    "```" + NHAN_HANG_RAO,
    JSON.stringify({
      tool: "de_xuat_sua_doan",
      args: { path: dv.duongTuongDoi, dongDau: dv.dongDau, dongCuoi: dv.dongCuoi, thayThe: "<mã đã sửa>" },
    }),
    "```",
  ].join("\n");
}
