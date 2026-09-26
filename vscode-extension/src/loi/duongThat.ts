/**
 * ★★★ R-C5 — GIẢI ĐƯỜNG DẪN **THẬT** TRƯỚC KHI HỎI `duocPhepGhi`.
 *
 * `duocPhepGhi` (`./chanGhi.ts`) so ranh giới thư mục bằng `path.relative`/`path.resolve` — đó là
 * thao tác **CHUỖI THUẦN**: nó chuẩn hoá `..` và `.` nhưng **KHÔNG đi theo symlink/junction**. Một
 * liên kết nằm TRONG workspace mà trỏ RA NGOÀI vì thế **lọt qua nguyên vẹn**: chuỗi đường dẫn nằm
 * trong workspace, còn tệp THẬT thì không. Máy chủ CÓ chặn lớp lỗi này
 * (`server/services/aiLocalTools/repoSandbox.ts`); client thì chưa — đúng cái bẫy đã trả giá nhiều
 * lần trong repo này: *hai hàng rào cho MỘT bất biến, và bản LỎNG HƠN là bản đang chạy*.
 *
 * Vì vậy: đường ghi cục bộ **phải** đi qua hàm này trước, và `duocPhepGhi` chỉ được nhìn thấy đường
 * ĐÃ GIẢI (cả đường đích lẫn các thư mục workspace — giải một phía mà không giải phía kia thì phép
 * so vẫn lệch).
 *
 * BA CA, BA CÁCH XỬ — và ca thứ ba là ca dễ bỏ sót nhất:
 *   1. Tệp TỒN TẠI ⇒ `realpathSync` giải hết mọi liên kết trên đường ⇒ dùng kết quả đó.
 *   2. Tệp CHƯA tồn tại ⇒ `realpathSync` ném `ENOENT`; giải **THƯ MỤC CHA** rồi ghép lại tên tệp.
 *      Vẫn bắt được liên kết ở phần thư mục (ca phổ biến: `ws/lien-ket-ra-ngoai/x.cs`).
 *   3. ⚠⚠ **SYMLINK HỎNG (dangling)** ⇒ `realpathSync` cũng ném `ENOENT`, y hệt ca 2. Nếu rơi thẳng
 *      vào nhánh "giải thư mục cha" thì kết quả là một đường NẰM TRONG workspace — trong khi ghi
 *      qua đường đó sẽ tạo tệp tại **ĐÍCH của liên kết**, có thể ở bất kỳ đâu. Phân biệt bằng
 *      `lstatSync` (KHÔNG đi theo liên kết): có một liên kết ở đó mà `realpath` không giải nổi ⇒
 *      TỪ CHỐI, không đoán.
 *
 * ⚠ KHÔNG import `vscode` (quy ước `src/loi/` là lớp THUẦN, đo được bằng vitest thường). Hàm này có
 *   chạm đĩa nhưng chỉ ĐỌC siêu dữ liệu — không có nhánh nào ở đây ghi byte.
 */
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

export type KetQuaGiaiDuong = { ok: true; duong: string } | { ok: false; lyDo: string };

function maLoi(e: unknown): string {
  return (e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message ?? "không rõ";
}

export function giaiDuongThat(duong: string): KetQuaGiaiDuong {
  // Đường tương đối sẽ được `realpathSync` giải theo THƯ MỤC LÀM VIỆC của tiến trình extension —
  // một cái gốc mà không ai ở đây chọn và không ai kiểm được. Từ chối thẳng, giống luật 1 của
  // `duocPhepGhi`, để hai hàng rào không nói hai câu khác nhau về cùng một đầu vào.
  if (!isAbsolute(duong)) {
    return { ok: false, lyDo: `đường dẫn không tuyệt đối: "${duong}" — không giải đường thật từ một gốc phải đoán` };
  }

  try {
    return { ok: true, duong: realpathSync(duong) };
  } catch (e) {
    if (maLoi(e) !== "ENOENT") {
      return { ok: false, lyDo: `không giải được đường thật cho "${duong}" (${maLoi(e)})` };
    }
  }

  // Tới đây: `realpathSync` báo ENOENT. Ca 3 TRƯỚC ca 2 — xem docblock.
  try {
    if (lstatSync(duong).isSymbolicLink()) {
      return {
        ok: false,
        lyDo: `"${duong}" là liên kết HỎNG (trỏ tới đích không tồn tại) — từ chối ghi qua một liên kết không giải được đích`,
      };
    }
  } catch {
    // `lstat` cũng không thấy gì ⇒ đúng là chưa có gì ở đó ⇒ rơi xuống ca 2 bên dưới.
  }

  const cha = dirname(duong);
  const ten = basename(duong);
  if (cha === duong || ten === "") {
    return { ok: false, lyDo: `không giải được đường thật cho "${duong}" (không có thư mục cha để giải)` };
  }
  try {
    return { ok: true, duong: join(realpathSync(cha), ten) };
  } catch (e) {
    return {
      ok: false,
      lyDo: `không giải được thư mục cha của "${duong}" (${maLoi(e)}) — thư mục chưa tồn tại thì cũng chưa có gì hợp lệ để ghi vào`,
    };
  }
}
