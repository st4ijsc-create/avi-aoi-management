/**
 * ★★★ 2026-08-29 · ĐUÔI SỐNG — hàm THUẦN chuẩn bị đầu ra lệnh ĐANG CHẠY cho khối sống của
 * `BangTerminal` (lưới: `dauRaSong.unit.test.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI GẬP `\r` — VÀ VÌ SAO GẬP Ở TẦNG HIỂN THỊ, KHÔNG PHẢI Ở SERVER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Progress terminal thật (vite `transforming (110) …`, vitest, dotnet) VẼ ĐÈ một dòng bằng cách in
 * `\r` rồi in lại dòng ấy — hàng trăm lần. Một `<pre>` không hiểu `\r`: nó hiện NGUYÊN mọi phiên
 * bản nối nhau thành một dòng dài vô tận (hoặc — với `\r\n` Windows — thành ký tự rác). Gập đúng
 * ngữ nghĩa terminal ("phần sau `\r` VIẾT ĐÈ từ đầu dòng") biến trăm phiên bản thành MỘT dòng đang
 * cập nhật — đúng cái người dùng thấy ở VSCode.
 *
 * Gập ở CLIENT vì đây là ngữ nghĩa THIẾT BỊ HIỂN THỊ, không phải dữ liệu: kết quả CHÍNH THỨC
 * (`KetQuaChayLenh.dauRa` — vào transcript, vào model, vào sổ) giữ nguyên byte thô có `\r`; chỉ
 * khung nhìn sống mới gập. Server gập hộ là ĐÈ một phép mất-thông-tin lên dữ liệu dùng chung.
 *
 * ⚠ `\r\n` (xuống dòng Windows) KHÔNG phải một lượt viết-đè — phải chuẩn hoá TRƯỚC khi gập, nếu
 *   không mọi dòng CRLF đều bị gập oan thành rỗng (dòng nào cũng "kết thúc bằng một \r treo").
 * ⚠ Ký tự thoát ANSI (`\x1b[...m` màu, `\x1b[K` xoá-đến-cuối-dòng) đi kèm progress thật — lột ở
 *   đây luôn (một nguồn, một lượt) để `<pre>` không hiện `[2m[36m` rác.
 */

/** Lột chuỗi thoát ANSI (CSI `\x1b[...X` + OSC `\x1b]...BEL/ST`) — đủ cho vite/vitest/dotnet. */
export function lotAnsi(chuoi: string): string {
  return chuoi
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * Gập `\r` theo ngữ nghĩa terminal: trong MỖI dòng (`\n` là ranh giới), phần đứng sau `\r` cuối
 * cùng VIẾT ĐÈ phần trước — giữ đúng "khung hình cuối" của một progress bar. `\r` treo cuối chuỗi
 * (chunk cắt giữa một lượt vẽ) giữ khung hiện có, không sinh dòng rỗng.
 */
export function gopVachVe(chuoi: string): string {
  if (chuoi === "") return "";
  const chuan = lotAnsi(chuoi).replace(/\r\n/g, "\n");
  return chuan
    .split("\n")
    .map((dong) => {
      const viTri = dong.lastIndexOf("\r");
      if (viTri < 0) return dong;
      const sau = dong.slice(viTri + 1);
      // `abc\r` (kết thúc bằng \r — lượt vẽ kế tiếp chưa tới) ⇒ giữ khung TRƯỚC, đừng trả rỗng.
      return sau === "" ? dong.slice(0, viTri).split("\r").pop() ?? "" : sau;
    })
    .join("\n");
}

/** Hình dạng lượt sống trang truyền xuống `BangTerminal` — đúng payload `repoWorkspace.dauRaSong`. */
export interface LuotSong {
  lenh: string;
  dauRa: string;
  dangChay: boolean;
  msTroi: number;
  catDau: boolean;
}

/** `msTroi` (server đo) → nhãn giây gọn cho khối sống: `7s`, `1m 23s`. THUẦN — lưới hỏi thẳng. */
export function nhanGiayTroi(msTroi: number): string {
  const giay = Math.max(0, Math.floor(msTroi / 1000));
  if (giay < 60) return `${giay}s`;
  return `${Math.floor(giay / 60)}m ${giay % 60}s`;
}
