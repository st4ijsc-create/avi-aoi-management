/**
 * Vị từ chặn ghi cục bộ — **nơi cưỡng chế** thay cho máy chủ (spec §4.1).
 *
 * Ở chế độ SERVER (Đợt B), máy chủ giữ tệp nên máy chủ cưỡng chế được (hộp cát, whitelist, RBAC).
 * Ở chế độ LOCAL (Đợt C), mã nằm trên máy dev, máy chủ không với tới ⇒ **nơi cưỡng chế chuyển vào
 * extension**. Hàm này là MỘT trong ba thứ bù lại điều đó (hai thứ kia: đúng MỘT điểm ghi có
 * census canh — xem `census.unit.test.ts` — và kiểm toán ghi-trước-chốt-sau). Nếu nó lỏng, không
 * còn gì đứng giữa model và tệp của người dùng.
 *
 * Bốn luật, ĐÚNG THỨ TỰ KIỂM (dừng ở luật đầu tiên bị vi phạm):
 *   1. Đường dẫn phải TUYỆT ĐỐI — đường tương đối bị từ chối vì ta không đoán gốc để suy ra nó.
 *   2. Phải nằm TRONG một thư mục workspace đang mở, so sánh SAU KHI CHUẨN HOÁ (`path.resolve`)
 *      và chặn được `..` thoát ra ngoài. ⚠ Bẫy tiền tố chuỗi: `C:\ws-khac\x.cs` KHÔNG nằm trong
 *      `C:\ws` dù chuỗi bắt đầu giống — phải so theo RANH GIỚI THƯ MỤC (`path.relative`), không
 *      phải `startsWith`. Windows: so sánh không phân biệt hoa/thường (đã đúng "miễn phí" vì
 *      `path.relative`/`path.resolve` trên win32 tự làm việc đó với ổ đĩa và tên thư mục).
 *   3. Cấm tệp nhạy cảm (`.env*`, khoá riêng…) — danh sách DÙNG CHUNG với đường GỬI.
 *   4. Cấm đường dẫn **CHỈ NGUY HIỂM KHI GHI** (`.git/…`, `.vscode/tasks.json`,
 *      `.vscode/launch.json`) — danh sách RIÊNG của đường ghi, xem phán quyết ngay dưới đây.
 *
 * ⚠⚠⚠ PHÁN QUYẾT VỀ LUẬT 3 — VÌ SAO DÙNG LẠI `duocPhepGuiNoiDung` (đọc kỹ trước khi sửa):
 * `duocPhepGuiNoiDung` (ở `./nguCanh.ts`) có TÊN nói về việc **GỬI nội dung đi** (dựng ngữ cảnh
 * gửi kèm câu hỏi cho model), còn ở đây ta dùng nó để quyết định **được GHI hay không**. Đây là
 * HAI CÂU HỎI KHÁC NHAU — hiện tại chúng tình cờ cùng đáp án (cùng một danh sách "tệp nhạy cảm":
 * `.env*`, khoá SSH, `.pem`/`.key`/`.jks`/...). Ta vẫn CHỦ ĐỘNG dùng lại một bản DUY NHẤT, vì bài
 * học đắt nhất của dự án này là: hai bản sao của MỘT vị từ an toàn sẽ TRÔI KHỎI NHAU theo thời
 * gian, và bản LỎNG HƠN bao giờ cũng là bản ĐANG CHẠY (xem docblock `daBiTuChoiGhi` trong
 * `shared/aiCodingLoop.ts` — đúng bài học đó, ở một cặp vị từ khác của repo này).
 * ⚠ BẮT BUỘC: nếu một ngày MỘT TRONG HAI câu hỏi ("gửi được không" / "ghi được không") cần một
 *   danh sách tệp cấm KHÁC với câu hỏi kia, phải TÁCH TƯỜNG MINH thành hai hàm/hai danh sách có
 *   tên riêng — TUYỆT ĐỐI KHÔNG sửa lén bên trong `duocPhepGuiNoiDung` để chỉ đúng ý một phía,
 *   vì đó chính là cách hai bản trôi khỏi nhau mà không ai nhận ra.
 *
 * ⚠⚠⚠ 2026-08-29 — **NGÀY ĐÓ ĐÃ TỚI**, và đây là cách nó được xử lý (đọc kỹ trước khi gộp lại).
 * Hai câu hỏi ĐÃ TÁCH ĐÁP ÁN. `.git/hooks/pre-commit` và `.vscode/tasks.json` **vô hại khi GỬI**
 * (chúng là văn bản, không chứa bí mật, và model đọc chúng để hiểu dự án) nhưng **nguy hiểm khi
 * GHI**: byte đặt vào đó KHÔNG phải "sửa mã nguồn" — nó là **MÃ SẼ CHẠY trên máy lập trình viên**
 * ở lượt `git commit` kế tiếp hoặc lần bấm "Run Task" kế tiếp, sau một thẻ duyệt chỉ nói vỏn vẹn
 * "Ghi vào workspace". Thẻ duyệt ấy KHÔNG mô tả đúng hậu quả, và người bấm không có cách nào biết.
 *
 * Vì thế, theo ĐÚNG chỉ dẫn của chính docblock trên (tách TƯỜNG MINH, không sửa lén bên trong
 * `duocPhepGuiNoiDung`):
 *   · `duocPhepGuiNoiDung` GIỮ NGUYÊN và VẪN ĐƯỢC GỌI ở luật 3 — danh sách "tệp nhạy cảm" vẫn là
 *     MỘT bản dùng chung cho cả hai câu hỏi, không nhân bản, không rẽ nhánh bên trong nó;
 *   · `camGhiRieng` bên dưới là danh sách **CỘNG THÊM, CHỈ CHO ĐƯỜNG GHI**, có tên riêng nói rõ
 *     điều đó. Nó không xoá gì của danh sách chung; nó chỉ hẹp thêm cho một câu hỏi hẹp hơn.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { duocPhepGuiNoiDung } from "./nguCanh";

/** Đường `duong` có nằm TRONG thư mục `ws` không, so theo ranh giới thư mục (không phải tiền tố chuỗi). */
function namTrongThuMuc(duong: string, ws: string): boolean {
  const r = relative(resolve(ws), resolve(duong));
  // Nằm trong ⇔ cả ba: (a) r không rỗng — rỗng nghĩa là CHÍNH thư mục ws, không phải tệp con;
  // (b) r không phải ".." và không bắt đầu bằng "..<sep>" — đó là dấu hiệu đã thoát RA NGOÀI qua
  //     `path.relative`, cách duy nhất đáng tin để phát hiện việc thoát ra sau khi chuẩn hoá `..`;
  // (c) r không tuyệt đối — trên Windows, `path.relative` giữa hai Ổ ĐĨA khác nhau (vd C:\ws và
  //     D:\other\x.cs) trả về nguyên đường ĐÍCH dạng tuyệt đối thay vì một đường tương đối.
  return r !== "" && r !== ".." && !r.startsWith(`..${sep}`) && !r.startsWith("../") && !isAbsolute(r);
}

/**
 * ★★★ CẤM **CHỈ CHO ĐƯỜNG GHI** — trả về lý do nếu cấm, `undefined` nếu cho qua.
 *
 * Tiêu chí vào danh sách này KHÔNG phải "tệp quan trọng" mà là: **ghi vào đó = THỰC THI MÃ trên
 * máy lập trình viên, ở một thời điểm sau, không do người dùng khởi xướng.** Thẻ duyệt hiện thời
 * chỉ nói "Ghi vào workspace"; với những đường dưới đây câu đó mô tả SAI hậu quả.
 *
 * ⚠ So theo ĐOẠN đường dẫn (`.git` phải là NGUYÊN một đoạn), không phải chuỗi con: `.gitignore`,
 *   `.github/`, `src/gitUtils.ts` là tệp mã bình thường và chặn nhầm chúng là mất chức năng ÂM
 *   THẦM — người dùng chỉ thấy "AI không sửa được tệp này" mà không hiểu vì sao.
 * ⚠ Hoa/thường: Windows coi `.GIT` và `.git` là một, nên so bằng chữ thường. Trên Linux hai tên
 *   đó là hai thư mục khác nhau — chặn cả hai vẫn ĐÚNG HƯỚNG (fail-closed, không mất gì).
 *
 * ⚠ CHƯA phủ (nói thẳng, không giả vờ đã kín): `.vscode/settings.json` cũng trỏ được tới chương
 *   trình sẽ chạy qua một số thiết lập/extension. Nó KHÔNG có trong danh sách này vì đó là tệp
 *   người ta sửa hằng ngày và chặn nó sẽ chặn nhầm rất nhiều lượt sửa hợp lệ. Đây là đánh đổi
 *   ĐƯỢC BIẾT, không phải chỗ bị bỏ quên.
 */
function camGhiRieng(duongTuyetDoi: string): string | undefined {
  const doan = duongTuyetDoi.split(/[\\/]+/).filter((x) => x !== "").map((x) => x.toLowerCase());
  if (doan.includes(".git")) {
    return (
      `nằm trong ".git" — ghi vào đó KHÔNG phải sửa mã nguồn mà là ĐẶT MÃ SẼ CHẠY trên máy bạn ` +
      `(hook chạy ở lượt git kế tiếp, "config" đổi được cả chương trình git gọi): "${duongTuyetDoi}"`
    );
  }
  const cuoi = doan[doan.length - 1] ?? "";
  const truoc = doan[doan.length - 2] ?? "";
  if (truoc === ".vscode" && (cuoi === "tasks.json" || cuoi === "launch.json")) {
    return (
      `là ".vscode/${cuoi}" — VSCode CHẠY lệnh khai trong tệp này (task/debug), nên ghi vào đó là ` +
      `đặt mã sẽ chạy trên máy bạn, không phải sửa mã nguồn: "${duongTuyetDoi}"`
    );
  }
  return undefined;
}

/**
 * Đường TƯƠNG ĐỐI của một tệp trong workspace — dùng để KHAI LÊN SỔ KIỂM TOÁN và hiện trên thẻ.
 *
 * ⚠⚠ VÌ SAO KHÔNG GỌI THẲNG `path.relative(goc, tep)` Ở NƠI GỌI (lỗ đã có thật, 2026-08-29):
 * nơi gọi có hai đại lượng KHÁC HỆ QUY CHIẾU — gốc workspace CHƯA giải liên kết và đường đích ĐÃ
 * giải (`giaiDuongThat`). Khi chính gốc ấy là một junction/symlink, `relative` giữa hai hệ đó đẻ
 * ra một đường `..\..\…`; và trên Windows, nếu đích nằm ở Ổ ĐĨA khác thì `relative` trả về NGUYÊN
 * đường TUYỆT ĐỐI của máy dev. Cả hai đều bị khai lên cột `path` của sổ kiểm toán và in lên thẻ —
 * tức **sổ nói SAI tệp nào vừa bị sửa**. Byte vẫn rơi đúng chỗ; cái sai là LỜI KHAI về nó.
 * ⚠ Và nó phải thử LẦN LƯỢT mọi gốc: tệp có thể nằm ở thư mục workspace THỨ HAI, không phải cái
 *   đang chọn ở ô dự án. Trả `undefined` khi không gốc nào chứa nó — nơi gọi phải xử lý tường
 *   minh, KHÔNG được nhận một chuỗi trông-như-đường-dẫn mà sai.
 *
 * `cacGocThat` phải là các gốc ĐÃ giải đường thật, cùng hệ quy chiếu với `duongThat`.
 *
 * ⚠ Trả về CẢ `goc` đã chọn, không chỉ chuỗi tương đối: nơi gọi khai lên sổ kiểm toán một cặp
 *   `{nhanWorkspace, path}` và hai ô ấy phải nói về CÙNG một gốc. Trả riêng chuỗi tương đối là mời
 *   nơi gọi ghép nó với một gốc khác — lại đúng lớp lỗi "sổ khai sai tệp" mà hàm này sinh ra để vá.
 */
export function duongTuongDoiTrongWorkspace(
  duongThat: string,
  cacGocThat: string[],
): { goc: string; duongTuongDoi: string } | undefined {
  for (const goc of cacGocThat) {
    if (!namTrongThuMuc(duongThat, goc)) continue;
    return { goc, duongTuongDoi: relative(resolve(goc), resolve(duongThat)).replace(/\\/g, "/") };
  }
  return undefined;
}

export function duocPhepGhi(
  duongTuyetDoi: string,
  thuMucWorkspace: string[],
): { ok: true } | { ok: false; lyDo: string } {
  // Luật 1: phải TUYỆT ĐỐI.
  if (!isAbsolute(duongTuyetDoi)) {
    return { ok: false, lyDo: `đường dẫn không tuyệt đối: "${duongTuyetDoi}" — không đoán gốc` };
  }

  // Luật 2: phải nằm trong MỘT thư mục workspace đang mở. Danh sách rỗng ⇒ không có gì hợp lệ để
  // ghi (không phải "cho qua vì không có gì để so").
  if (thuMucWorkspace.length === 0) {
    return { ok: false, lyDo: "không có thư mục workspace nào đang mở — từ chối mọi đường ghi" };
  }
  if (!thuMucWorkspace.some((ws) => namTrongThuMuc(duongTuyetDoi, ws))) {
    return {
      ok: false,
      lyDo: `đường dẫn nằm ngoài mọi thư mục workspace đang mở: "${duongTuyetDoi}"`,
    };
  }

  // Luật 3: cấm tệp nhạy cảm — DÙNG LẠI `duocPhepGuiNoiDung`, xem phán quyết ở docblock trên.
  if (!duocPhepGuiNoiDung(duongTuyetDoi)) {
    return { ok: false, lyDo: `tệp nhạy cảm (.env / khoá riêng...) bị chặn ghi: "${duongTuyetDoi}"` };
  }

  // Luật 4: cấm đường CHỈ nguy hiểm khi GHI (danh sách riêng của đường ghi — xem `camGhiRieng`).
  const camRieng = camGhiRieng(duongTuyetDoi);
  if (camRieng) return { ok: false, lyDo: camRieng };

  return { ok: true };
}
