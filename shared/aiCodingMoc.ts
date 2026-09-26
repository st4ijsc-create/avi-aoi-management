/**
 * ★★★ 2026-08-23 · UX LÔ 1 (D1) — **MỐC KHỐI SỬA `SEARCH/=======/REPLACE`, MỘT NGUỒN CHO CẢ HAI ĐẦU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO BA HẰNG NÀY DỌN NHÀ TỪ `server/services/aiCodingAgent.ts` SANG `shared/`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Buổi trải nghiệm người-dùng-thật đo được (D1): văn xuôi model phát ra CÓ MANG các dòng mốc, và
 * chúng đi thẳng vào render markdown của trang — `=======` biến dòng đứng trên nó thành **H1 khổng
 * lồ** (setext heading), `>>>>>>> REPLACE` thành **7 tầng blockquote**. Muốn lọc ở TẦNG HIỂN THỊ,
 * client phải nhận diện ĐÚNG hình dạng mốc mà server dùng — nhưng `aiCodingAgent.ts` nhập
 * `aiSafety`/`aiGateway`/`aiLlamaServerClient`, tức client import nó là kéo nguyên đồ thị server
 * vào bundle trình duyệt. Nên: hằng + hình dạng sống ở đây (`shared/`, 0 import), server RE-EXPORT
 * để mọi điểm gọi cũ (`aiCodingAgent`, `aiLocalKnowledgeService`, CLI, lưới) không đổi một chữ.
 *
 * ⚠ ĐỪNG chép ba regex hình dạng về client: hai bản sao một vị từ là cách chắc chắn nhất để chúng
 *   trôi khỏi nhau — và bản lỏng hơn bao giờ cũng là bản đang chạy.
 *
 * (Docblock gốc của các mốc — vì sao ba dòng ASCII cố định, vì sao trùng khuôn dấu xung đột git,
 *  vì sao KHÔNG nội địa hoá — vẫn ở `aiCodingAgent.ts`, cạnh bộ phân tích khối.)
 */

export const MOC_MO = "<<<<<<< SEARCH";
export const MOC_NGAN = "=======";
export const MOC_DONG = ">>>>>>> REPLACE";

/**
 * Nhận theo **HÌNH DẠNG**, không theo danh sách trắng chuỗi (bài học hậu tố `REPO_PATH_REGEX`
 * 2026-08-21: danh sách trắng nào cũng có phần tử thứ N+1, và cái thiếu tiếp theo hỏng IM LẶNG):
 * "≥3 dấu `<` rồi tới từ SEARCH" là một mệnh đề hình dạng, nên `<<<<<<<< SEARCH` (8 dấu) hay
 * `<<< SEARCH` đều nhận, còn một dòng mã bình thường thì không.
 */
export const RE_MO = /^<{3,}\s*SEARCH\s*$/i;
export const RE_NGAN = /^={3,}\s*$/;
export const RE_DONG = /^>{3,}\s*REPLACE\s*$/i;

/**
 * ★★★ (D1) — LÀM SẠCH mốc SEARCH/REPLACE **CHỈ Ở TẦNG HIỂN THỊ** trước khi đưa văn bản vào một
 * bộ render markdown.
 *
 * Việc nó làm, và KHÔNG làm:
 *   • Một khối trọn vẹn `SEARCH … ======= … REPLACE` (ngoài code fence) được BỌC vào một fence
 *     ```text — ba dòng mốc giữ NGUYÊN VĂN bên trong fence, người đọc vẫn thấy đủ, nhưng markdown
 *     hết đường diễn dịch chúng thành heading/blockquote. (Thẻ diff đẹp đã có ngay dưới thẻ duyệt;
 *     khối này chỉ còn là phần "trích lời model".)
 *   • Một dòng mốc LẺ (`=======` mồ côi, `>>>>>>> REPLACE` không có mở) được bọc thành `inline
 *     code` — trung hoà cú pháp markdown mà không giấu một byte nào.
 *   • Bên trong một code fence có sẵn (```): KHÔNG đụng một dòng nào — fence đã trung hoà sẵn,
 *     bọc thêm là phá fence của model.
 *   • KHÔNG chạm chuỗi gửi cho server/bộ phân tích khối (`docCacKhoiSua`) — hàm này chỉ được gọi
 *     ngay tại chỗ render (client). Sửa ở tầng dữ liệu là đổi CHÍNH thứ được parse, tức lớp lỗi
 *     "thiết bị đo sửa vật được đo".
 *
 * ⚠ THUẦN + chịu được CRLF (`\r\n` giữ nguyên qua split/join theo `\n`, vì `\r` nằm cuối dòng và
 *   các regex hình dạng neo `$` sau `\s*` — `\r` là `\s`).
 * ⚠ Đầu vào đang STREAM (dòng mốc cuối chưa gõ xong) ⇒ dòng chưa trọn không khớp hình dạng ⇒ được
 *   giữ nguyên; lượt render kế tiếp (dòng đã trọn) sẽ bọc. Nhấp nháy một nhịp là cái giá chấp nhận
 *   được — còn hơn render sai cấu trúc vĩnh viễn.
 */
export function lamSachMocChoHienThi(vanBan: string): string {
  if (vanBan === "" || !/[<>=]/.test(vanBan)) return vanBan;
  const dong = vanBan.split("\n");
  const ra: string[] = [];
  let trongFence = false;
  let i = 0;
  while (i < dong.length) {
    const d = dong[i]!;
    const sach = d.replace(/\r$/, "");
    if (/^\s*(```|~~~)/.test(sach)) {
      trongFence = !trongFence;
      ra.push(d);
      i++;
      continue;
    }
    if (trongFence) {
      ra.push(d);
      i++;
      continue;
    }
    if (RE_MO.test(sach)) {
      // Tìm mốc ĐÓNG của khối; có ⇒ bọc trọn khối vào fence ```text.
      let j = i + 1;
      let dong_ = -1;
      while (j < dong.length) {
        if (RE_DONG.test(dong[j]!.replace(/\r$/, ""))) {
          dong_ = j;
          break;
        }
        j++;
      }
      if (dong_ >= 0) {
        ra.push("```text");
        for (let k = i; k <= dong_; k++) ra.push(dong[k]!);
        ra.push("```");
        i = dong_ + 1;
        continue;
      }
      // Không có mốc đóng (bị cắt/đang stream) ⇒ trung hoà MỖI dòng mở này thôi.
      ra.push(`\`${sach.trim()}\``);
      i++;
      continue;
    }
    if (RE_NGAN.test(sach) || RE_DONG.test(sach)) {
      // Dòng mốc mồ côi — `=======` là thứ biến dòng TRÊN nó thành H1, nên phải trung hoà từng dòng.
      ra.push(`\`${sach.trim()}\``);
      i++;
      continue;
    }
    ra.push(d);
    i++;
  }
  return ra.join("\n");
}
