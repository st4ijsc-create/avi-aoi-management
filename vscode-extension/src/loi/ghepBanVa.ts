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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ 2026-08-30 (F2) — HAI GIẢ ĐỊNH SAI CỦA BẢN CŨ, CẢ HAI ĐỀU LÀM GHI **NHẦM CHỖ**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản cũ `goc.split(eol)` với `eol` suy từ "tệp có chứa \r\n hay không", tức giả định tệp có EOL
 * ĐỒNG NHẤT. Tệp EOL LẪN LỘN là chuyện thường ngày (một lượt merge, một lượt vá bằng tay, một
 * generator .NET ghi CRLF vào tệp LF):
 *   · `"1\r\n2\n3\r\n4".split("\r\n")` ⇒ `["1", "2\n3", "4"]` — BA phần tử cho một tệp BỐN dòng.
 *     `dongDau`/`dongCuoi` là số dòng của VSCode (đếm theo CẢ hai kiểu ngắt), nên chỉ số lệch:
 *     bản vá cắm vào **VÙNG KHÁC**, hoặc một sửa đổi HỢP LỆ bị từ chối với lý do SAI ("vượt số
 *     dòng thật của tệp (3 dòng)" cho một tệp có 4 dòng).
 * Và `thayThe` KHÔNG chắc là LF trần: `deXuatCucBo.ts` cố ý GIỮ NGUYÊN byte của model, nên một
 * `thayThe` mang sẵn CRLF gặp `split("\n").join("\r\n")` sẽ đẻ ra `\r\r\n`.
 *
 * Vì vậy: tách theo `/\r\n|\n/` — **giữ lại dấu ngắt của TỪNG dòng** — nên chỉ số dòng luôn khớp
 * VSCode; `thayThe` cũng tách theo cả hai kiểu rồi nối lại bằng EOL của tệp gốc.
 * ⚠ VÌ SAO GIỮ DẤU NGẮT CỦA TỪNG DÒNG thay vì `split(/\r?\n/).join(eol)` cho gọn: cách gọn hơn sẽ
 *   CHUẨN HOÁ EOL TOÀN TỆP ở một tệp lẫn lộn — tức đổi cả những dòng bản vá KHÔNG hề chạm tới, và
 *   `git diff` khi ấy hiện "sửa toàn bộ tệp". Đó đúng là tai hoạ mà docblock trên vừa mô tả, chỉ
 *   đổi nguyên nhân. Ngoài vùng bị thay, byte của gốc phải nguyên vẹn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ 2026-08-30 (F7) — LOGIC GIỮ EOL Ở ĐÂY ĐÚNG Ở TẦNG CHUỖI, NHƯNG KHÔNG BAO GIỜ TỚI ĐƯỢC ĐĨA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `tachDongVaNgat` (export ngay dưới) tách đúng dấu ngắt của TỪNG dòng, và lưới đơn vị của tệp này
 * (`ghepBanVa.unit.test.ts`) khẳng định điều đó ở mức CHUỖI THUẦN — logic ấy vẫn ĐÚNG và vẫn đáng
 * canh. Nhưng `ui/apBanVa.ts` không ghi chuỗi này thẳng ra đĩa: nó đi qua `TextDocument` + API
 * áp-chỉnh-sửa + `save()` của VSCode, và `TextDocument` chỉ mang **MỘT** `eol` cho cả
 * tài liệu — `save()` CHUẨN HOÁ EOL của TOÀN BỘ tệp về giá trị đó, kể cả những dòng hàm này vừa cố
 * giữ nguyên. Đo bằng `test-real-host/suite/eolBom.test.ts` (đọc đĩa thật bằng `node:fs` sau một
 * lượt `apBanVa` thật): tệp EOL lẫn lộn, sửa dòng 3, dòng 1 (CRLF, không hề bị chạm) đổi thành LF.
 * Vì thế `ui/apBanVa.ts` giờ TỪ CHỐI cả lượt ghi khi tệp gốc có EOL lẫn lộn (`loi/eolLanLon.ts`,
 * dùng lại chính `tachDongVaNgat` bên dưới) — TRƯỚC khi gọi tới hàm này. Hàm này và lưới của nó
 * không đổi, vì tính chất chúng canh vẫn đúng ở tầng CHUỖI; chỉ tầng ĐĨA là tầng bị vô hiệu hoá.
 */
import type { DeXuatCucBo } from "./deXuatCucBo";

/**
 * Tách nội dung thành CẶP (dòng, dấu ngắt-theo-sau), theo CÙNG quy tắc mà `ghepBanVa` dùng để ghép:
 * tách theo `\r\n` hoặc `\n`, KHÔNG coi một `\r` đơn độc (không theo sau bởi `\n`) là dấu ngắt dòng
 * — nó ở lại làm ký tự thường của dòng chứa nó, giống hệt cách `ghepBanVa` xử lý.
 * `ngat[i]` là dấu ngắt đi sau `dong[i]`; dòng cuối không có dấu ngắt thì `ngat[cuoi] === ""`.
 *
 * ⚠ Export để `loi/eolLanLon.ts` DÙNG LẠI — không tự viết một regex tách dòng THỨ HAI. Hai vị từ
 *   cùng nhìn một tệp mà tách dòng khác nhau sẽ TRÔI KHỎI NHAU theo thời gian (bài học đã có ở
 *   `chanGhi.ts`, docblock `duocPhepGhi`), và ở đây hậu quả cụ thể là: `eolLanLon` nói "không lẫn
 *   lộn" trong khi `ghepBanVa` lại đếm dòng khác đi, hoặc ngược lại.
 */
export function tachDongVaNgat(noiDung: string): { dong: string[]; ngat: string[] } {
  // Tách theo CẢ HAI kiểu ngắt dòng và GIỮ LẠI dấu ngắt đi sau mỗi dòng (`ngat[i]` là dấu ngắt sau
  // `dong[i]`, rỗng ở dòng cuối không có ngắt). `split` với nhóm BẮT giữ trả xen kẽ dòng/dấu ngắt.
  const phan = noiDung.split(/(\r\n|\n)/);
  const dong: string[] = [];
  const ngat: string[] = [];
  for (let i = 0; i < phan.length; i += 2) {
    dong.push(phan[i]);
    ngat.push(phan[i + 1] ?? "");
  }
  return { dong, ngat };
}

export function ghepBanVa(
  goc: string,
  d: DeXuatCucBo
): { ok: true; moi: string } | { ok: false; lyDo: string } {
  if (d.loai === "toanVan") {
    return { ok: true, moi: d.modified };
  }

  const { dong, ngat } = tachDongVaNgat(goc);

  if (d.dongCuoi > dong.length) {
    return {
      ok: false,
      lyDo: `dongCuoi=${d.dongCuoi} vượt số dòng thật của tệp (${dong.length} dòng) — không tự cắt bớt`,
    };
  }
  if (d.dongDau < 1 || d.dongCuoi < d.dongDau) {
    return { ok: false, lyDo: `khoảng dòng không hợp lệ: dongDau=${d.dongDau}, dongCuoi=${d.dongCuoi}` };
  }

  // EOL của GỐC quyết định EOL của phần THAY VÀO — không phải EOL model dùng trong `thayThe`.
  const eol = goc.includes("\r\n") ? "\r\n" : "\n";
  // `thayThe` giữ nguyên byte của model ⇒ có thể LF, có thể CRLF, có thể lẫn. Tách theo cả hai rồi
  // nối lại bằng đúng `eol` — bản cũ `split("\n")` để lại `\r` treo và cho ra `\r\r\n`.
  const dongThayThe = d.thayThe.split(/\r\n|\n/);

  let moi = "";
  for (let i = 0; i < d.dongDau - 1; i++) moi += dong[i] + ngat[i];
  moi += dongThayThe.join(eol);
  // Dấu ngắt đi SAU dòng `dongCuoi` của GỐC — giữ nguyên byte của gốc, không tự thêm cũng không bớt.
  moi += ngat[d.dongCuoi - 1];
  for (let i = d.dongCuoi; i < dong.length; i++) moi += dong[i] + ngat[i];

  return { ok: true, moi };
}
