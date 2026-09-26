/**
 * ★★★ 2026-08-25 · GỢI Ý TỆP cho @-mention ở ô nhập `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ THÀNH PHẦN NÀY — đòn bẩy SỐ 1 cho model local CHẬM (audit senior/Cursor)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Gõ `@` rồi CHỌN tệp thay cho gõ tay một đường dẫn dài: người dùng đỡ gõ, và — quan trọng hơn —
 * model nhận một THAM CHIẾU TỆP RÕ RÀNG thay vì một chuỗi tự-gõ có thể sai chính tả. Bản NÀY là
 * autocomplete CLIENT thuần: nó chỉ LỌC danh sách đường-dẫn-tương-đối đã có sẵn ở client và VẼ ra
 * một dropdown; "ghim ngữ cảnh server để bỏ vòng read_file" là một bản khác, để đợt sau.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HAI MẢNH, MỘT SỰ THẬT VỀ THỨ HẠNG — và vì sao mảnh xếp hạng phải THUẦN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `locTepTheoQuery` là NƠI DUY NHẤT quyết định "tệp nào lên trước". Nó THUẦN (không React, không
 * trạng thái) để lưới hỏi thẳng "calc → tệp nào đứng đầu" bằng một khẳng định `toEqual`, thay vì
 * phải soi HTML. Một đột biến đảo thứ tự ưu tiên (bỏ ưu tiên basename-prefix, chỉ còn substring
 * đường dẫn) là một thay đổi HÀNH VI, không phải thay đổi hình thức — nên lưới phải ĐỎ, và nó đỏ
 * (xem `goiYTep.unit.test.ts` §1, có một ca DÀN Ý CỐ Ý để basename-prefix nằm trên đường DÀI hơn:
 * chỉ cấp bậc mới đẩy nó lên, tiebreak độ-dài thì đẩy nó xuống — nếu cấp bậc mất, thứ tự lật).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `GoiYTep` — THUẦN HIỂN THỊ + MỘT CALLBACK (khuôn `BangProblems`/`BoChonPhien`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thành phần này KHÔNG tự giữ trạng thái mở/đóng, KHÔNG tự điều hướng phím, KHÔNG biết ô nhập hay
 * vị trí con trỏ. TRANG mới là nơi bắt `@`, tính `query`, gọi `locTepTheoQuery`, giữ `chiSoChon`
 * (điều hướng ↑/↓) và chèn đường dẫn khi chọn. Thành phần chỉ nhận `dsKhop` (ĐÃ lọc), tô mục ở
 * `chiSoChon`, và báo `onChon(duong)` khi bấm chuột. Giữ đúng ranh giới ấy là điều kiện để lưới đo
 * được nó bằng `renderToStaticMarkup` (0 phụ thuộc runtime, 0 cửa mạng, 0 i18n — dropdown chỉ có
 * đường dẫn, không câu chữ nào để dịch).
 *
 * ⚠ `dsKhop` rỗng ⇒ trả `null` (KHÔNG render một hộp rỗng): dropdown chỉ tồn tại khi có gì để chọn;
 *   trang căn cứ vào chính điều đó để biết "còn đang gợi ý hay không".
 * ⚠ Bấm chuột dùng `onMouseDown` + `preventDefault` (KHÔNG `onClick`): mousedown xảy ra TRƯỚC khi ô
 *   nhập kịp mất focus, nên chặn mặc định giữ con trỏ Ở LẠI textarea — người dùng chèn xong đường
 *   dẫn là gõ tiếp được ngay, và quan hệ `aria-activedescendant` của trang không bị đứt.
 * ⚠ `React.JSX.Element` (KHÔNG `JSX.Element` trần — React19 báo TS2503).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tách đường-dẫn-tương-đối thành `{thuMuc, ten}`: `ten` = basename (phần sau dấu `/` cuối), `thuMuc`
 * = phần thư mục KÈM dấu `/` cuối (rỗng nếu tệp ở gốc). THUẦN — dùng cho cả xếp hạng lẫn hiển thị,
 * để "basename" ở hai nơi không bao giờ trôi khỏi nhau.
 */
export function tachTen(duong: string): { thuMuc: string; ten: string } {
  const i = duong.lastIndexOf("/");
  return i >= 0 ? { thuMuc: duong.slice(0, i + 1), ten: duong.slice(i + 1) } : { thuMuc: "", ten: duong };
}

/**
 * ★ Lọc + XẾP HẠNG danh sách đường-dẫn-tương-đối theo `query` (phần sau dấu `@` đang gõ). Khớp
 * KHÔNG phân biệt hoa/thường. Ưu tiên (thấp = trước):
 *   (0) basename BẮT ĐẦU bằng query   — cái người ta gõ `@` để tới, gần như luôn là ý định;
 *   (1) basename CHỨA query           — khớp giữa tên tệp;
 *   (2) đường dẫn chứa query          — khớp nằm ở phần THƯ MỤC, không ở tên tệp.
 * Trong cùng một hạng: đường NGẮN hơn lên trước, rồi tới khớp SỚM hơn, cuối cùng `localeCompare`
 * cho tất định tuyệt đối. Trần `tran` kết quả. `query` rỗng ⇒ `tran` tệp đầu (giữ nguyên thứ tự
 * TRANG truyền vào — trang đã sắp theo mức liên quan/độ mới của nó).
 *
 * ⚠ THUẦN, không React: đây là NƠI DUY NHẤT quyết định thứ hạng. Đột biến bỏ ưu tiên basename-prefix
 *   (gộp mọi khớp về một hạng "chứa trong đường dẫn") ⇒ thứ tự sai ⇒ lưới §1 ĐỎ.
 */
export function locTepTheoQuery(dsTep: readonly string[], query: string, tran = 8): string[] {
  const q = query.trim().toLowerCase();
  // Rỗng ⇒ đầu danh sách ĐÃ SẮP của trang; KHÔNG tự sắp lại (thứ tự trang truyền vào có ý nghĩa).
  if (!q) return dsTep.slice(0, tran);

  const diem: Array<{ duong: string; hang: number; viTri: number }> = [];
  for (const duong of dsTep) {
    const dLow = duong.toLowerCase();
    const bLow = tachTen(duong).ten.toLowerCase();
    let hang: number;
    if (bLow.startsWith(q)) hang = 0;
    else if (bLow.includes(q)) hang = 1;
    else if (dLow.includes(q)) hang = 2;
    else continue; // không khớp ở đâu ⇒ loại
    diem.push({ duong, hang, viTri: dLow.indexOf(q) });
  }

  diem.sort(
    (a, b) =>
      a.hang - b.hang || // (i) hạng ưu tiên — mảnh mà đột biến đảo
      a.duong.length - b.duong.length || // (ii) đường ngắn hơn
      a.viTri - b.viTri || // (iii) khớp sớm hơn
      a.duong.localeCompare(b.duong), // (iv) tất định cuối
  );

  return diem.slice(0, tran).map((d) => d.duong);
}

interface GoiYTepProps {
  /** ĐÃ lọc: trang gọi `locTepTheoQuery` rồi truyền kết quả vào (component KHÔNG tự lọc lại). */
  dsKhop: readonly string[];
  /** Chỉ số mục đang tô nền — điều hướng phím ↑/↓ do TRANG giữ. Ngoài dải ⇒ không mục nào được tô. */
  chiSoChon: number;
  /** Bấm/chọn một mục ⇒ gọi đúng một lần với đường dẫn của mục ấy. */
  onChon: (duong: string) => void;
}

/**
 * Dropdown gợi ý tệp: mỗi mục hiện basename ĐẬM + đường-dẫn-thư-mục MỜ (để phân biệt tệp trùng
 * tên khác thư mục). Mục ở `chiSoChon` tô nền `bg-muted`. `role="listbox"` + `option` +
 * `aria-selected`. `dsKhop` rỗng ⇒ `null` (không render hộp rỗng).
 *
 * TRANG lo phần định vị (đặt dropdown trên/dưới ô nhập) và quan hệ combobox
 * (`aria-controls`/`aria-activedescendant`); component chỉ vẽ danh sách + báo chọn.
 */
export function GoiYTep({ dsKhop, chiSoChon, onChon }: GoiYTepProps): React.JSX.Element | null {
  if (dsKhop.length === 0) return null;

  return (
    <div
      data-goi-y-tep
      role="listbox"
      className="max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-xs shadow-md"
    >
      {dsKhop.map((duong, i) => {
        const { thuMuc, ten } = tachTen(duong);
        const chon = i === chiSoChon;
        return (
          <div
            key={duong}
            data-muc-goi-y
            role="option"
            aria-selected={chon ? "true" : "false"}
            // mousedown + preventDefault: giữ focus Ở LẠI ô nhập (xem docblock đầu tệp).
            onMouseDown={(e) => {
              e.preventDefault();
              onChon(duong);
            }}
            className={cn(
              "flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1 hover:bg-muted",
              chon && "bg-muted",
            )}
          >
            <span data-ten className="shrink-0 truncate font-medium">
              {ten}
            </span>
            {thuMuc && (
              <span data-thu-muc className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">
                {thuMuc}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
