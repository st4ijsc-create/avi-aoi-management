/**
 * NHÃN CỦA THẺ DUYỆT — hàng rào, KHÔNG phải trang trí (spec §7: "tai nạn không cứu được").
 *
 * Hai chế độ ghi vào HAI MÁY KHÁC NHAU: chế độ SERVER khiến MÁY CHỦ ghi byte vào hộp cát của nó;
 * chế độ LOCAL khiến EXTENSION ghi byte vào workspace trên máy lập trình viên. Người bấm nút chỉ có
 * hai thứ để phân biệt: **nhãn nguồn** và **chữ trên nút**. Cả hai vì thế là logic THUẦN có lưới,
 * không phải chuỗi rải rác trong `bangChat.ts`.
 *
 * ⚠ Vì sao `nhanNguonTheDuyet` phải TỰ ĐẢM BẢO tiền tố thay vì tin `MucDuAn.nhan`: `gopDanhSachDuAn`
 *   (`./duAn.ts`) có gắn "LOCAL · "/"SERVER · ", nhưng `bangChat.cheDoHienTai()` có một nhánh RƠI VỀ
 *   khi danh sách dự án rỗng — nhãn khi ấy là `"workspace"` TRẦN, không tiền tố. Một thẻ duyệt
 *   không nhãn là đúng thứ hàng rào này sinh ra để chặn, nên chặn ở đây (một chỗ) chứ không sửa lỏng
 *   lẻo ở chỗ gọi.
 */
export type CheDoLoai = "local" | "server";

const TIEN_TO: Record<CheDoLoai, string> = { local: "LOCAL · ", server: "SERVER · " };

/** Nhãn nguồn cho thẻ duyệt + tiêu đề tab diff. Luôn có ĐÚNG MỘT tiền tố chế độ ở đầu. */
export function nhanNguonTheDuyet(cheDo: { loai: CheDoLoai; nhan: string }): string {
  const tienTo = TIEN_TO[cheDo.loai];
  const than = cheDo.nhan.trim();
  if (than.startsWith(tienTo)) return than;
  return `${tienTo}${than.length > 0 ? than : "workspace"}`;
}

/**
 * Chữ trên nút ghi. Hai câu phải KHÁC NHAU và mỗi câu phải nói đúng NƠI byte rơi — lưới bên cạnh
 * khoá cả hai chiều (câu LOCAL không được chứa "SERVER", câu SERVER không được hứa ghi workspace).
 */
export function nhanNutGhi(loai: CheDoLoai): string {
  return loai === "local" ? "Ghi vào workspace" : "Duyệt & ghi trên SERVER";
}
