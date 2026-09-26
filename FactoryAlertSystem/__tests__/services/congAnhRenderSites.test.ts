/**
 * Lưới TĨNH: **mọi** `<Image>` render ảnh máy chủ phải đi qua `nguonAnh`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO CẦN LƯỚI NÀY — MỘT LỖ HỔNG DO CHÍNH PHÉP ĐỘT BIẾN CHỈ RA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `nguonAnh.test.ts` canh **HÀNH VI CỦA HÀM**. Nó xanh rực rỡ kể cả khi không một điểm render nào
 * gọi hàm ấy — tức lớp lỗi "đúng công cụ, không ai cầm". Một lượt sửa giao diện sau này chỉ cần
 * viết lại `source={{ uri: x }}` cho "gọn" là ảnh chết ngoài hiện trường, **và cả hai lưới kia vẫn
 * xanh**.
 *
 * ⇒ Lưới này đếm theo **SỐ**, không theo danh sách chép tay: nó quét toàn bộ `src/**` và đòi
 *   **0** chỗ dựng `source` bằng đối tượng `{ uri: … }` viết thẳng.
 *
 * ⚠ Vì sao ngưỡng là 0 chứ không phải "≤ số hiện tại": một ngưỡng trôi được là một ngưỡng sẽ trôi.
 *   Nếu sau này có một điểm render ảnh **cục bộ** (require/asset) thật sự không cần khoá, hãy
 *   thêm nó vào `MIỄN_TRỪ` **kèm lý do** — một lượt miễn trừ có tên đọc được rõ hơn một con số tăng.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const GOC = join(__dirname, '..', '..', 'src');

/** Điểm render CỐ Ý không đi qua `nguonAnh` — phải kèm lý do. Hiện tại: rỗng. */
const MIEN_TRU: ReadonlyArray<{ tep: string; dong: number; lyDo: string }> = [];

function duyet(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) duyet(p, ra);
    else if (/\.tsx$/.test(ten)) ra.push(p);
  }
  return ra;
}

describe('cổng ảnh — điểm render', () => {
  const tep = duyet(GOC);

  it('không còn một `source={{ uri: … }}` viết thẳng nào trong src/**', () => {
    const pham: string[] = [];
    for (const f of tep) {
      const dong = readFileSync(f, 'utf8').split(/\r?\n/);
      dong.forEach((l, i) => {
        // `source={{ uri: x }}` / `source={{uri:x}}` — đối tượng viết thẳng, KHÔNG qua nguonAnh
        if (/source=\{\{[^}]*\buri\b/.test(l)) {
          const rel = f.replace(GOC, 'src').replace(/\\/g, '/');
          if (!MIEN_TRU.some((m) => m.tep === rel && m.dong === i + 1)) {
            pham.push(`${rel}:${i + 1}  ${l.trim().slice(0, 100)}`);
          }
        }
      });
    }
    expect(pham).toEqual([]);
  });

  it('vẫn còn ĐÚNG 17 điểm render đi qua `nguonAnh` (chống xoá âm thầm)', () => {
    let n = 0;
    for (const f of tep) {
      n += (readFileSync(f, 'utf8').match(/source=\{nguonAnh\(/g) || []).length;
    }
    // ⚠ Con số này là một PHÉP ĐẾM, không phải một lời hứa: thêm màn ảnh mới thì SỬA nó lên,
    //   và lượt sửa ấy buộc người viết nhìn lại xem điểm render mới có qua cổng chưa.
    expect(n).toBe(17);
  });
});
