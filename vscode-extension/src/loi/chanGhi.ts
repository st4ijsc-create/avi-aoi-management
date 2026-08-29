/**
 * Vị từ chặn ghi cục bộ — **nơi cưỡng chế** thay cho máy chủ (spec §4.1).
 *
 * Ở chế độ SERVER (Đợt B), máy chủ giữ tệp nên máy chủ cưỡng chế được (hộp cát, whitelist, RBAC).
 * Ở chế độ LOCAL (Đợt C), mã nằm trên máy dev, máy chủ không với tới ⇒ **nơi cưỡng chế chuyển vào
 * extension**. Hàm này là MỘT trong ba thứ bù lại điều đó (hai thứ kia: đúng MỘT điểm ghi có
 * census canh — xem `census.unit.test.ts` — và kiểm toán ghi-trước-chốt-sau). Nếu nó lỏng, không
 * còn gì đứng giữa model và tệp của người dùng.
 *
 * Ba luật, ĐÚNG THỨ TỰ KIỂM (dừng ở luật đầu tiên bị vi phạm):
 *   1. Đường dẫn phải TUYỆT ĐỐI — đường tương đối bị từ chối vì ta không đoán gốc để suy ra nó.
 *   2. Phải nằm TRONG một thư mục workspace đang mở, so sánh SAU KHI CHUẨN HOÁ (`path.resolve`)
 *      và chặn được `..` thoát ra ngoài. ⚠ Bẫy tiền tố chuỗi: `C:\ws-khac\x.cs` KHÔNG nằm trong
 *      `C:\ws` dù chuỗi bắt đầu giống — phải so theo RANH GIỚI THƯ MỤC (`path.relative`), không
 *      phải `startsWith`. Windows: so sánh không phân biệt hoa/thường (đã đúng "miễn phí" vì
 *      `path.relative`/`path.resolve` trên win32 tự làm việc đó với ổ đĩa và tên thư mục).
 *   3. Cấm tệp nhạy cảm (`.env*`, khoá riêng…).
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
  return r !== "" && r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r);
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

  return { ok: true };
}
