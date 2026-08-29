/**
 * Đếm dòng thêm/bớt để thẻ duyệt nói được QUY MÔ trước khi người dùng mở diff.
 *
 * ⚠ Chuẩn hoá CRLF trước khi so: trên Windows một tệp lưu lại bằng editor khác dòng-kết-thúc sẽ
 * làm MỌI dòng trông như đã đổi — một con số sai kiểu đó khiến người duyệt mất niềm tin vào thẻ.
 * Đây là phép đếm ĐỊNH HƯỚNG (đa tập hợp), không phải thuật toán diff; diff thật do VSCode vẽ.
 */
export function tomTatDiff(original: string, modified: string): { them: number; bot: number; doiDong: boolean } {
  const tach = (s: string) => s.replace(/\r\n/g, "\n").split("\n");
  const dem = (ds: string[]) => { const m = new Map<string, number>(); for (const d of ds) m.set(d, (m.get(d) ?? 0) + 1); return m; };
  const a = dem(tach(original)), b = dem(tach(modified));
  let them = 0, bot = 0;
  for (const [d, n] of b) them += Math.max(0, n - (a.get(d) ?? 0));
  for (const [d, n] of a) bot += Math.max(0, n - (b.get(d) ?? 0));
  return { them, bot, doiDong: them > 0 || bot > 0 };
}
