/**
 * Ghép một đề xuất cục bộ (`DeXuatCucBo`, Task 1) vào nội dung GỐC để ra nội dung MỚI của tệp.
 * Đây là bước THUẦN, không đụng đĩa — hộ ai gọi sau (Đợt sau) mới thật sự ghi.
 *
 * ⚠⚠⚠ GIỮ NGUYÊN EOL của tệp gốc. Model luôn viết `thayThe` bằng `\n` trần, nhưng nếu tệp gốc
 * dùng CRLF (Windows — phổ biến trong repo .NET của dự án này) mà ta ghép thẳng LF vào, kết quả
 * là một tệp CÓ CẢ HAI loại dòng-kết-thúc, hoặc nếu ai đó "sửa cho gọn" bằng cách chuẩn hoá cả
 * tệp về LF thì MỌI dòng sẽ hiện thành đã đổi trong `git diff` — người duyệt mất khả năng thấy
 * thay đổi THẬT giữa hàng chục dòng đổi-vì-EOL và một dòng đổi-vì-NỘI-DUNG. Vì vậy: phát hiện EOL
 * của GỐC, tách theo đúng EOL đó, và dịch `thayThe` (luôn `\n`) sang đúng EOL ấy trước khi ghép.
 *
 * ⚠⚠ KHÔNG tự cắt/tự đoán khi `dongCuoi` vượt số dòng thật của tệp. Đề xuất đến từ model đọc một
 * bản chụp NGUCẢNH có thể đã lệch khỏi đĩa hiện tại; im lặng cắt bớt sẽ ghi một thứ người duyệt
 * chưa từng thấy trong diff. Trả `{ok:false}` kèm lý do, để lớp gọi (Đợt sau) báo lỗi rõ ràng.
 *
 * ⚠ KHÔNG tự thêm newline cuối tệp nếu gốc không có — giữ đúng "hình dạng byte" của gốc ở phần
 * không bị đề xuất chạm tới.
 */
import type { DeXuatCucBo } from "./deXuatCucBo";

export function ghepBanVa(
  goc: string,
  d: DeXuatCucBo
): { ok: true; moi: string } | { ok: false; lyDo: string } {
  if (d.loai === "toanVan") {
    return { ok: true, moi: d.modified };
  }

  // EOL của GỐC quyết định EOL của kết quả — không phải EOL mà model dùng trong `thayThe`.
  const eol = goc.includes("\r\n") ? "\r\n" : "\n";
  const dong = goc.split(eol);

  if (d.dongCuoi > dong.length) {
    return {
      ok: false,
      lyDo: `dongCuoi=${d.dongCuoi} vượt số dòng thật của tệp (${dong.length} dòng) — không tự cắt bớt`,
    };
  }
  if (d.dongDau < 1 || d.dongCuoi < d.dongDau) {
    return { ok: false, lyDo: `khoảng dòng không hợp lệ: dongDau=${d.dongDau}, dongCuoi=${d.dongCuoi}` };
  }

  // `thayThe` luôn dùng \n trần (quy ước của model) — dịch sang EOL của gốc trước khi ghép.
  const dongThayThe = d.thayThe.split("\n");
  const moi = [...dong.slice(0, d.dongDau - 1), ...dongThayThe, ...dong.slice(d.dongCuoi)].join(eol);

  return { ok: true, moi };
}
