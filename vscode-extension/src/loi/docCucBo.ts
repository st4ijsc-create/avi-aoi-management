/**
 * ★★★ PHẦN THUẦN CỦA BA TOOL ĐỌC CỤC BỘ — LỌC · CẮT · CHE · ĐỊNH DẠNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐÂY LÀ MẶT RÒ DỮ LIỆU CỦA ĐỢT D. ĐỌC HẾT TRƯỚC KHI SỬA MỘT DÒNG.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kết quả ba tool `doc_tep`/`liet_ke`/`grep` **RỜI MÁY LẬP TRÌNH VIÊN**: chúng bị nhét vào câu hỏi
 * gửi lên máy chủ để model đọc. Mọi byte đi qua các hàm dưới đây là byte **đã rời máy** — không có
 * nút hoàn tác nào ở phía bên kia.
 *
 * ★★★ R-D2 — VÌ SAO HÀNG RÀO MỨC-TỆP MỘT MÌNH LÀ KHÔNG ĐỦ (phán quyết, không phải phỏng đoán):
 * `duocPhepGuiNoiDung` chặn ở mức **TỆP** (`.env*`, khoá riêng, `.pem`, `.jks`…). Nhưng `grep` quét
 * **NỘI DUNG** toàn workspace và trả về **TỪNG DÒNG** — nó trích được đúng dòng
 * `DATABASE_URL=postgres://user:pass@…` ra khỏi `.env` mà **không hề "đọc" tệp đó** theo nghĩa của
 * hàng rào tệp. Hàng rào mức-tệp KHÔNG chạm tới đường này. Vì vậy BẮT BUỘC hai tầng:
 *   (a) **Loại tệp bị cấm khỏi TẬP QUÉT TRƯỚC khi tìm** — `grep` không được mở chúng ra
 *       (`locTapQuet`, và `grepThuan` lọc LẦN NỮA trên chính đầu vào của nó — xem "NHÁNH KIA");
 *   (b) **`cheBiMat` MỌI mảnh động trả về**, kể cả mảnh đến từ tệp HỢP LỆ: một khoá hardcode trong
 *       `src/config.ts` cũng là khoá, và `src/config.ts` không có trong danh sách cấm nào cả.
 *
 * ★★ NHÁNH KIA (khuôn rút từ Đợt C — bản vá lần năm đẻ ra lỗi lần sáu vì chỉ cài luật ở MỘT phía):
 * tầng (a) được cài ở HAI nơi độc lập — `mang/toolCucBo.ts` lọc trước khi gọi, và `grepThuan` lọc
 * lại đầu vào của chính nó. Nơi gọi thứ hai (Task 3, hay bất kỳ ai sau này) không thể vô tình bỏ
 * qua tầng (a) bằng cách quên gọi `locTapQuet`.
 *
 * ★★★ QUY TẮC BẤT DI: **KHÔNG nội suy thẳng một giá trị ĐỘNG vào chuỗi kết quả.** Mọi mảnh đến từ
 * đĩa, từ model, hay từ hệ tệp phải đi qua `sach()` (tức `cheBiMat`) TRƯỚC. Chữ tĩnh trong khuôn
 * mẫu thì không cần — nó do ta viết, không mang bí mật của ai. Đi tìm `sach(` là cách kiểm nhanh
 * toàn tệp này.
 *
 * ★★★ THỨ TỰ **CHE TRƯỚC — CẮT SAU** LÀ BẮT BUỘC, KHÔNG ĐƯỢC ĐẢO:
 * `postgres://user:MẬT_KHẨU@host` chỉ khớp luật che khi **có dấu `@`**. Cắt trước dấu `@` rồi mới
 * che ⇒ luật không còn khớp và **nửa đầu mật khẩu rời máy nguyên văn**. Có ca lưới canh đúng điều
 * này (`CHE TRƯỚC rồi mới CẮT`).
 *
 * ★★★ CẮT THÌ PHẢI **KHAI LÀ ĐÃ CẮT**. Cắt im lặng là đưa model một **sự thật một nửa**, rồi model
 * kết luận trên đó và không ai truy được vì sao câu trả lời sai. Ba trần ⇒ ba lời khai.
 *
 * ⚠ KHÔNG import `vscode` (quy ước `src/loi/` là lớp THUẦN, đo được bằng vitest thường) và KHÔNG
 *   chạm đĩa: `grepThuan` nhận một hàm ĐỌC được TIÊM VÀO. Nhờ đó lưới đo được cả **kết cục** (chuỗi
 *   bí mật có trong kết quả không) lẫn **ý định** (tệp cấm có bị MỞ RA không) — hai câu khác nhau,
 *   và chỉ câu đầu mới chứng minh không rò.
 */
import { isAbsolute, relative, resolve } from "node:path";
import { camRoiMay, cheBiMat, duocPhepGuiNoiDung, duocPhepRoiMay } from "./nguCanh";
import { namTrongThuMuc } from "./chanGhi";

/** Trần BYTE cho `doc_tep`. Đo bằng byte UTF-8 vì đó là thứ THẬT SỰ rời máy, không phải số ký tự. */
export const TRAN_BYTE_DOC_TEP = 64 * 1024;
/** Trần SỐ MỤC cho `liet_ke`. */
export const TRAN_MUC_LIET_KE = 300;
/** Trần SỐ KẾT QUẢ cho `grep`. */
export const TRAN_KET_QUA_GREP = 200;
/** Trần ĐỘ DÀI MỘT DÒNG kết quả grep — một tệp sinh tự động có dòng dài hàng trăm KB. */
export const TRAN_KY_TU_MOI_DONG_GREP = 300;

export type KetQuaHangRaoDoc = { ok: true } | { ok: false; lyDo: string };

/** Ứng viên quét: `duong` để ĐỌC (tuyệt đối), `nhan` để HIỆN (tương đối, gọn cho model). */
export interface UngVienQuet {
  duong: string;
  nhan: string;
}

/**
 * ★★★ CỬA DUY NHẤT cho mọi mảnh ĐỘNG đi vào kết quả. Xem "QUY TẮC BẤT DI" ở docblock đầu tệp.
 * Cố ý là một hàm riêng (không gọi thẳng `cheBiMat`) để một lượt tìm `sach(` liệt kê được TOÀN BỘ
 * điểm mà dữ liệu ngoài đi vào chuỗi trả về — thứ mà `cheBiMat(` không cho, vì tên đó còn xuất
 * hiện ở nơi khác trong repo.
 */
function sach(x: string): string {
  return cheBiMat(x);
}

/**
 * ★★★ CỬA CHÓT cho các câu `lyDo` dựng ở lớp `vscode` (`mang/toolCucBo.ts`).
 *
 * Lớp ấy dựng lý do từ chối bằng cách nội suy đường dẫn ĐÃ GIẢI vào một câu tiếng Việt — và câu
 * ấy **cũng rời máy** (hiện lên bảng chat, rồi nhét ngược vào lượt hỏi sau để model biết vì sao
 * lượt đọc hỏng). Đường dẫn đó bắt nguồn từ chuỗi MODEL khai, nên nó mang được bất cứ thứ gì.
 * ⚠ CỐ Ý chỉ áp cho `lyDo`, KHÔNG áp cho `ketQua`: `ketQua` đã được che theo TỪNG MẢNH ở trên, còn
 *   một lượt che lại TOÀN CHUỖI sẽ nuốt luôn chữ trong khuôn mẫu — ví dụ `grep` với `mau` là
 *   `token=` sẽ làm luật "gán khoá = giá trị" ăn hết phần còn lại của DÒNG TIÊU ĐỀ. Che theo mảnh
 *   là đủ kín mà không phá lời khai.
 */
export function lamSachLyDo(lyDo: string): string {
  return sach(lyDo);
}

/** `duong` CHÍNH LÀ thư mục `ws` (không phải tệp con của nó). */
function laChinhThuMuc(duong: string, ws: string): boolean {
  return relative(resolve(ws), resolve(duong)) === "";
}

/**
 * Hàng rào ĐƯỜNG DẪN cho lượt **ĐỌC**. Ba luật, đúng thứ tự kiểm.
 *
 * ⚠⚠ CỐ Ý **KHÔNG** gọi `duocPhepGhi`: luật 4 của nó (`camGhiRieng`) cấm `.git/…`,
 * `.vscode/tasks.json`, `*.code-workspace` — những tệp **nguy hiểm khi GHI** (byte đặt vào đó là
 * MÃ SẼ CHẠY trên máy lập trình viên) nhưng **vô hại khi ĐỌC**: chúng là văn bản, và model đọc
 * chúng để hiểu dự án. Áp nhầm danh sách chỉ-cấm-ghi vào đường đọc là làm AI mù đúng các tệp cấu
 * hình nó cần nhất — mất chức năng ÂM THẦM, người dùng chỉ thấy "AI không đọc được" mà không hiểu
 * vì sao. Ta dùng chung MẢNH đúng nghĩa (`namTrongThuMuc`), không dùng chung cả QUYẾT ĐỊNH.
 * ⚠ Bù lại, nội dung `.git/config` (có thể mang `https://user:token@host`) được lớp (b) `cheBiMat`
 *   phủ — đây là phòng thủ CHIỀU SÂU, không phải chỗ bị bỏ quên.
 *
 * ⚠ `choPhepChinhGoc`: `liet_ke` trên **chính** thư mục gốc workspace là thao tác thường gặp nhất,
 *   nhưng `namTrongThuMuc` trả `false` cho ca đó (nó hỏi "có phải tệp CON không"). `doc_tep` thì
 *   KHÔNG được bật cờ này — đọc một thư mục như một tệp là một lỗi, không phải một tính năng.
 *
 * ⚠ `lyDo` cũng RỜI MÁY (hiện lên bảng chat và nhét ngược vào lượt hỏi sau), và nó nhắc lại đường
 *   dẫn do MODEL khai — nên chính nó cũng phải qua `sach()`.
 */
export function duocPhepDoc(
  duongTuyetDoi: string,
  thuMucWorkspace: string[],
  choPhepChinhGoc = false,
): KetQuaHangRaoDoc {
  if (!isAbsolute(duongTuyetDoi)) {
    return { ok: false, lyDo: `đường dẫn không tuyệt đối: "${sach(duongTuyetDoi)}" — không đoán gốc` };
  }

  if (thuMucWorkspace.length === 0) {
    return { ok: false, lyDo: "không có thư mục workspace nào đang mở — từ chối mọi lượt đọc cục bộ" };
  }

  const trong = thuMucWorkspace.some(
    (ws) => namTrongThuMuc(duongTuyetDoi, ws) || (choPhepChinhGoc && laChinhThuMuc(duongTuyetDoi, ws)),
  );
  if (!trong) {
    return { ok: false, lyDo: `nằm ngoài mọi thư mục workspace đang mở: "${sach(duongTuyetDoi)}"` };
  }

  if (!duocPhepGuiNoiDung(duongTuyetDoi)) {
    return {
      ok: false,
      lyDo:
        `tệp nhạy cảm (.env / khoá riêng / chứng chỉ…) — KHÔNG đọc và KHÔNG gửi: ` +
        `"${sach(duongTuyetDoi)}"`,
    };
  }

  // Luật 4 (vòng sửa 1): cấm RỜI MÁY riêng — hiện là `.git/**`. Hỏi RIÊNG thay vì qua
  // `duocPhepRoiMay` để giữ được LÝ DO cụ thể của `camRoiMay`; một câu "tệp nhạy cảm" chung chung
  // ở đây sẽ khiến người dùng không hiểu vì sao `.git/config` bị chặn còn `.gitignore` thì không.
  const camDoc = camRoiMay(duongTuyetDoi);
  if (camDoc) return { ok: false, lyDo: sach(camDoc) };

  return { ok: true };
}

/**
 * ★★★ TẦNG (a) — loại tệp bị cấm khỏi **TẬP QUÉT**, trước khi bất kỳ ai mở chúng ra.
 * Dùng ở `mang/toolCucBo.ts` (trước khi đọc đĩa) VÀ bên trong `grepThuan` (nhánh kia).
 */
export function locTapQuet(duongs: string[]): string[] {
  return duongs.filter(duocPhepRoiMay);
}

/**
 * Cắt theo BYTE UTF-8 mà **không xẻ đôi một ký tự nhiều byte**.
 *
 * ⚠ Cắt thô ở giữa một chuỗi byte tiếp nối sẽ đẻ ra ký tự thay thế `�` rải rác — model đọc
 *   thành mã hỏng và kết luận sai về mã nguồn. Lùi về ranh giới ký tự (`10xxxxxx` là byte TIẾP NỐI).
 */
function catTheoByte(s: string, tranByte: number): { than: string; daCat: boolean; byteGoc: number } {
  const byteGoc = Buffer.byteLength(s, "utf8");
  if (byteGoc <= tranByte) return { than: s, daCat: false, byteGoc };

  const buf = Buffer.from(s, "utf8");
  let het = Math.min(tranByte, buf.length);
  while (het > 0 && (buf[het] & 0b1100_0000) === 0b1000_0000) het--;
  return { than: buf.subarray(0, het).toString("utf8"), daCat: true, byteGoc };
}

/**
 * `doc_tep` — nội dung một tệp, ĐÃ CHE và (nếu vượt trần) ĐÃ CẮT KÈM LỜI KHAI.
 * ⚠ Thứ tự CHE → CẮT là bắt buộc; xem docblock đầu tệp.
 */
export function dinhDangDocTep(nhan: string, noiDung: string, tranByte = TRAN_BYTE_DOC_TEP): string {
  const daChe = sach(noiDung);
  const { than, daCat, byteGoc } = catTheoByte(daChe, tranByte);

  const dong = [`--- TỆP ${sach(nhan)} ---`, than];
  if (daCat) {
    dong.push(
      `… ⚠ ĐÃ CẮT: chỉ gửi ${tranByte} / ${byteGoc} byte ĐẦU tệp — phần còn lại KHÔNG có trong ngữ ` +
        `cảnh này, đừng kết luận về nó.`,
    );
  }
  return dong.join("\n");
}

/**
 * `liet_ke` — danh sách tệp, ĐÃ LOẠI tệp cấm và ĐÃ KHAI mọi chỗ bị cắt.
 *
 * ⚠ `tapNguonBiCat` = chính lượt tìm kiếm ở lớp `vscode` đã chạm trần của nó. Cắt ở đâu cũng là
 *   cắt: một danh sách thiếu mà không khai là một sự thật một nửa, y như cắt ở đây.
 * ⚠ SỐ tệp bị loại được KHAI (không khai TÊN): người đọc cần biết danh sách không đầy đủ, còn tên
 *   `.env.production` thì chính nó cũng là một mẩu thông tin không cần rời máy.
 *
 * ★★★ `soDaLoaiTruoc` — LỖ BẮT ĐƯỢC BẰNG PHÉP ĐO TRÊN ĐĨA THẬT (2026-08-30), KHÔNG BẰNG LƯỚI:
 * lưới ở đây khai đúng "(đã loại N tệp nhạy cảm)" vì nó truyền THẲNG `.env` vào hàm này. Nhưng
 * trên đường chạy THẬT, `mang/toolCucBo.ts` đã lọc tệp nhạy cảm khỏi tập ứng viên TRƯỚC ĐÓ (đúng
 * theo tầng (a) của R-D2) — nên tới đây `soBiChan` bằng 0 và **lời khai biến mất**. Kết quả: model
 * nhận một danh sách trông như ĐẦY ĐỦ và có thể kết luận "dự án này không có tệp cấu hình bí mật"
 * rồi khuyên người dùng tạo mới một tệp đã tồn tại. Đúng lớp lỗi "cắt im lặng = sự thật một nửa"
 * mà cả tệp này được dựng ra để chống — chỉ khác là nó nấp ở KHE GIỮA hai lớp, nơi mỗi lớp nhìn
 * riêng đều đúng. Nên: nơi lọc TRƯỚC phải ĐẾM và truyền con số ấy vào đây.
 * ⚠ Chỉ đếm phần bị loại vì NHẠY CẢM. Ứng viên bị loại vì thoát ra ngoài workspace (symlink) thì
 *   KHÔNG đếm — chúng vốn không thuộc dự án, khai ra chỉ thêm nhiễu.
 */
export function dinhDangLietKe(
  nhanThuMuc: string,
  duongs: string[],
  tran = TRAN_MUC_LIET_KE,
  tapNguonBiCat = false,
  soDaLoaiTruoc = 0,
): string {
  const loc = locTapQuet(duongs);
  const soBiChan = duongs.length - loc.length + soDaLoaiTruoc;
  const daCat = loc.length > tran;
  const hienThi = daCat ? loc.slice(0, tran) : loc;

  const dong = [`--- LIỆT KÊ ${sach(nhanThuMuc)} — ${loc.length} tệp ---`];
  if (hienThi.length === 0) dong.push("(KHÔNG có tệp nào đọc được / gửi được trong thư mục này)");
  else dong.push(...hienThi.map(sach));

  if (daCat) {
    dong.push(`… ⚠ ĐÃ CẮT: chỉ liệt kê ${tran} / ${loc.length} tệp — danh sách KHÔNG đầy đủ.`);
  }
  if (tapNguonBiCat) {
    dong.push("… ⚠ ĐÃ CẮT ở tầng tìm kiếm: thư mục còn tệp chưa được liệt kê ra đây.");
  }
  if (soBiChan > 0) {
    // ⚠ Câu khai này CỐ Ý không viết ra tên/đuôi cụ thể của nhóm tệp bị loại. Hai lý do, cái thứ
    //   hai mới là lý do thật: (1) tên tệp bí mật cũng là một mẩu tin không cần rời máy; (2) lưới
    //   khẳng định "kết quả KHÔNG chứa chuỗi `.env`" — một câu khai có chữ ấy sẽ làm khẳng định
    //   MẠNH NHẤT đo được ở đây trở thành bất khả, và ta sẽ phải nới lưới để giữ một câu chữ.
    dong.push(`(đã loại ${soBiChan} tệp nhạy cảm — tệp cấu hình bí mật / khoá riêng — khỏi danh sách)`);
  }
  return dong.join("\n");
}

/** Cắt một dòng kết quả quá dài, KÈM lời khai ngay tại dòng đó. */
function catDong(s: string): string {
  if (s.length <= TRAN_KY_TU_MOI_DONG_GREP) return s;
  return `${s.slice(0, TRAN_KY_TU_MOI_DONG_GREP)} … ⚠ ĐÃ CẮT dòng`;
}

/**
 * ★★★ `grep` — TÌM CHUỖI, và là mặt rò nguy hiểm nhất của cả đợt.
 *
 * `docNoiDung` được **TIÊM VÀO** để hàm này THUẦN. Nhờ đó lưới đo được cả hai câu:
 *   · KẾT CỤC — "chuỗi bí mật có trong chuỗi trả về không" (khẳng định CHÍNH);
 *   · Ý ĐỊNH — "`.env` có bị MỞ RA không" (khẳng định phụ, qua sổ ghi lời gọi `docNoiDung`).
 *
 * ⚠⚠ TẦNG (a) LẶP LẠI Ở ĐÂY, CÓ CHỦ Ý: `mang/toolCucBo.ts` đã gọi `locTapQuet` trước khi truyền
 *    vào, nhưng hàm này lọc LẠI trên chính đầu vào của nó. Không phải thừa — đó là "nhánh kia":
 *    nơi gọi thứ hai (Task 3 hay bất kỳ ai sau này) không thể mở lỗ bằng cách quên một lượt lọc.
 *    Lọc theo CẢ `duong` lẫn `nhan`: hai chuỗi khác nhau, và chỉ cần một chuỗi khai `.env` là đủ.
 *
 * ⚠ So khớp là CHUỖI CON, KHÔNG phân biệt hoa/thường, KHÔNG phải regex: `mau` do model sinh, và
 *   một regex do model sinh là một cửa ReDoS mở thẳng vào tiến trình extension.
 *
 * ⚠ Dừng đọc NGAY khi đã có `tran + 1` kết quả — vừa đủ để BIẾT là đã cắt, và không mở thêm một
 *   tệp nào nữa. Trần ở đây vì thế cũng là trần số tệp bị mở ra.
 */
export function grepThuan(
  mau: string,
  ungVien: UngVienQuet[],
  docNoiDung: (duong: string) => string,
  tran = TRAN_KET_QUA_GREP,
  tapNguonBiCat = false,
  soDaLoaiTruoc = 0,
): string {
  const tapQuet = ungVien.filter((u) => duocPhepRoiMay(u.duong) && duocPhepRoiMay(u.nhan));
  // `soDaLoaiTruoc`: xem docblock `dinhDangLietKe` — nơi lọc TRƯỚC phải đếm, nếu không lời khai
  // biến mất đúng trên đường chạy thật.
  const soBiChan = ungVien.length - tapQuet.length + soDaLoaiTruoc;
  const canTim = mau.toLowerCase();

  const ra: string[] = [];
  let soTepDaQuet = 0;

  for (const u of tapQuet) {
    if (ra.length > tran) break;

    let noiDung: string;
    try {
      noiDung = docNoiDung(u.duong);
    } catch {
      // Tệp nhị phân / không có quyền / vừa bị xoá ⇒ bỏ qua ĐÚNG tệp đó, không hỏng cả lượt tìm.
      continue;
    }
    soTepDaQuet++;

    const cacDong = noiDung.split(/\r?\n/);
    for (let i = 0; i < cacDong.length; i++) {
      if (ra.length > tran) break;
      if (!cacDong[i].toLowerCase().includes(canTim)) continue;
      ra.push(`${sach(u.nhan)}:${i + 1}: ${catDong(sach(cacDong[i].trim()))}`);
    }
  }

  const daCat = ra.length > tran;
  const hienThi = daCat ? ra.slice(0, tran) : ra;

  const dong: string[] = [];
  if (hienThi.length === 0) {
    dong.push(`--- GREP mẫu "${sach(mau)}" — KHÔNG có kết quả nào (đã quét ${soTepDaQuet} tệp) ---`);
  } else {
    dong.push(`--- GREP mẫu "${sach(mau)}" — ${hienThi.length} kết quả (đã quét ${soTepDaQuet} tệp) ---`);
    dong.push(...hienThi);
  }

  if (daCat) {
    dong.push(`… ⚠ ĐÃ CẮT: dừng ở ${tran} kết quả — workspace CÒN chỗ khớp chưa được liệt kê.`);
  }
  if (tapNguonBiCat) {
    dong.push("… ⚠ ĐÃ CẮT ở tầng tìm kiếm: còn tệp chưa nằm trong tập quét của lượt này.");
  }
  if (soBiChan > 0) {
    // ⚠ Không viết ra tên/đuôi cụ thể — xem lý do ở `dinhDangLietKe`.
    dong.push(
      `(đã loại ${soBiChan} tệp nhạy cảm — tệp cấu hình bí mật / khoá riêng — khỏi TẬP QUÉT, không hề mở ra)`,
    );
  }
  return dong.join("\n");
}
