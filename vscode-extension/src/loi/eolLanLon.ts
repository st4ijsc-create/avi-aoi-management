/**
 * ★★★ 2026-08-30 (F7) — VỊ TỪ THUẦN: tệp có EOL LẪN LỘN hay không (không import `vscode`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO HÀM NÀY TỒN TẠI — LỖI CHỈ MỘT VSCODE HOST THẬT MỚI BẮT ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tệp EOL lẫn lộn (`"M1\r\nM2\nM3\r\nM4\n"`), áp bản vá sửa đúng dòng 3, đọc lại bằng `node:fs`:
 * dòng 1 (CRLF, KHÔNG hề bị chạm) đổi thành LF. Nguyên nhân: `loi/ghepBanVa.ts` giữ đúng dấu ngắt
 * của TỪNG dòng ở tầng CHUỖI (lưới đơn vị của nó xanh, và ĐÚNG), nhưng `ui/apBanVa.ts` không ghi
 * chuỗi ấy thẳng ra đĩa — nó đi qua `TextDocument` + API áp-chỉnh-sửa + `save()` của VSCode (xem
 * `ui/apBanVa.ts`), và `TextDocument` chỉ mang **MỘT** `eol` cho cả tài liệu. `save()` CHUẨN HOÁ EOL của
 * TOÀN BỘ tệp về giá trị đó, xoá sạch nỗ lực giữ-từng-dòng của `ghepBanVa`. Đo bằng
 * `test-real-host/suite/eolBom.test.ts` (VSCode extension host THẬT, đọc đĩa bằng `node:fs`) — một
 * lưới vitest chạy trên `vscode` giả sẽ không bao giờ thấy điều này, vì chính cái giả đó không có
 * hành vi chuẩn-hoá-EOL-toàn-tài-liệu của VSCode thật.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA HƯỚNG VÁ ĐÃ CÂN NHẮC — VÌ SAO CHỌN "TỪ CHỐI, NÓI RÕ" THAY VÌ CỐ GIỮ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   (A) Ép `eol` của tài liệu theo ý mình — KHÔNG cứu được: `TextDocument` vẫn chỉ có MỘT `eol`,
 *       nên vẫn mất kiểu ngắt dòng của một trong hai nhóm dòng, chỉ đổi nhóm nào bị mất.
 *   (B) Ghi thẳng bằng `fs` cho riêng tệp lẫn lộn — CẤM TUYỆT ĐỐI. Census bất biến của cả dự án
 *       (`loi/census.unit.test.ts`) đòi đúng MỘT nơi gọi tới API áp-chỉnh-sửa của VSCode và không
 *       nơi nào khác ghi đĩa bằng `fs`. Mở một đường ghi thứ hai là phá đúng hàng rào an toàn chịu
 *       lực nhất của extension.
 *   (C) ✅ FAIL-CLOSED (chọn): `ui/apBanVa.ts` gọi `eolLanLon()` TRƯỚC khi chạm đĩa; tệp lẫn lộn ⇒
 *       từ chối CẢ LƯỢT áp vá, nói thẳng lý do. Âm thầm viết lại EOL của những dòng người dùng
 *       không yêu cầu đổi tệ hơn nhiều so với từ chối và giải thích. Tệp lẫn lộn HIẾM; tệp CRLF
 *       đồng nhất — ca thường gặp nhất trên Windows — hay tệp LF đồng nhất đều KHÔNG bị hàm này
 *       chạm tới (xem nhánh dưới).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CẨN THẬN `\r` ĐƠN ĐỘC VÀ TỆP KHÔNG CÓ EOL CUỐI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dùng LẠI `tachDongVaNgat` của `ghepBanVa.ts` — KHÔNG tự viết một regex tách dòng thứ hai (bài học
 * `chanGhi.ts`: hai bản sao của một vị từ an toàn sẽ trôi khỏi nhau). Hệ quả trực tiếp: một `\r`
 * ĐƠN ĐỘC (không theo sau bởi `\n`, kiểu Mac Classic cũ) KHÔNG được đếm là một kiểu ngắt dòng riêng
 * — nó ở lại làm ký tự thường bên trong dòng chứa nó, ĐÚNG NHƯ cách `ghepBanVa` xử lý khi ghép bản
 * vá. Nếu hai hàm đếm khác nhau, `eolLanLon` có thể nói "không lẫn lộn" trong khi `ghepBanVa` lại
 * tính chỉ số dòng khác đi — một cặp vị từ trôi khỏi nhau đúng như bài học đã ghi.
 * Tệp KHÔNG có dòng ngắt nào (một dòng duy nhất, không `\n`/`\r\n`) ⇒ mảng dấu ngắt sau khi lọc
 * rỗng ⇒ 0 kiểu ⇒ KHÔNG lẫn lộn — không có gì để chuẩn hoá.
 * Tệp có dấu ngắt cuối trống (dòng cuối không kết thúc bằng EOL) ⇒ phần tử `""` bị lọc bỏ trước khi
 * đếm kiểu — dòng cuối thiếu EOL không phải là một "kiểu ngắt dòng thứ hai".
 */
import { tachDongVaNgat } from "./ghepBanVa";

/**
 * `true` ⇔ tệp có ÍT NHẤT hai kiểu dấu ngắt dòng THẬT khác nhau (`"\r\n"` và `"\n"`) — tức VSCode
 * sẽ chuẩn hoá EOL của toàn tệp về một trong hai khi `save()`, đổi cả những dòng không bị bản vá
 * chạm tới. Tệp EOL đồng nhất (toàn CRLF hoặc toàn LF), kể cả khi thiếu EOL ở dòng cuối, trả `false`.
 */
export function eolLanLon(noiDung: string): boolean {
  const { ngat } = tachDongVaNgat(noiDung);
  const kieuNgat = new Set(ngat.filter((n) => n !== ""));
  return kieuNgat.size > 1;
}
