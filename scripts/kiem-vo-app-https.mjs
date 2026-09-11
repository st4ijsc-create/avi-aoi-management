/**
 * CỔNG "VỎ ỨNG DỤNG KHÔNG TẢI TÀI NGUYÊN TỪ MẠNG NGOÀI" — Đợt 43 (G117 / RB-5, 2026-09-11).
 *
 * Vì sao có tệp này: client/index.html từng tải
 *   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist…">
 * — một stylesheet RENDER-BLOCKING từ CDN ngoài. Nhà máy không có internet ổn định: đo Đợt 42
 * fonts.googleapis trả 2 s / treo 30 s / 19 s ⇒ deep-link TRANG TRẮNG tới khi CDN trả lời
 * (Playwright goto /twin 38 s, a6b HỎNG cả hai viewport, p6 treo 29 phút). Không phải server,
 * không phải harness — là MỘT dòng <link> trong vỏ. Mọi <link>/<script>/<img>… trỏ ra
 * http(s):// hoặc //host trong vỏ app là một điểm treo tiềm tàng; cổng này giữ nó ở 0.
 *
 * Đo CÁI GÌ (và không đo cái gì):
 *   - ĐO: thuộc tính tải tài nguyên (href/src/srcset/data/poster) của thẻ link/script/img/iframe/
 *     source/video/audio/object/embed/track, và url()/@import trong <style> nội tuyến.
 *   - KHÔNG tính: chuỗi "https://…" trong <script> nội tuyến (vd. "https://react.dev/errors/" của
 *     React trong runtime nhúng) — đó là chuỗi ký tự, trình duyệt không tải. Được đếm riêng ở
 *     `chuoiKhac` để người đọc biết vì sao "grep https:// ≠ 0".
 *   - <meta http-equiv="Content-Security-Policy"> chứa https:// được LIỆT KÊ (metaCsp), không tính lỗi.
 *
 *   node scripts/kiem-vo-app-https.mjs                 (bước cuối `npm run build`: client/index.html + dist/public/index.html)
 *   node scripts/kiem-vo-app-https.mjs <tệp…>          (kiểm tệp chỉ định; tệp thiếu ⇒ lỗi)
 * Thoát 1 khi có bất kỳ tài nguyên ngoài nào. Lưới: scripts/kiem-vo-app-https.test.ts (có ca dương).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");
export const TEP_MAC_DINH = ["client/index.html", "dist/public/index.html"];

const THE_TAI = /<(link|script|img|iframe|source|video|audio|object|embed|track)\b[^>]*>/gi;
const THUOC_TINH = /(?<=\s)(href|src|srcset|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const META_CSP = /<meta\b[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/gi;
const STYLE_NOI_TUYEN = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const URL_CSS = /(?:@import\s+(?:url\(\s*)?["']?|url\(\s*["']?)\s*((?:https?:)?\/\/[^"')\s]+)/gi;
const RA_NGOAI = /^\s*(?:https?:)?\/\/|https?:\/\//i;

/**
 * @param {string} html
 * @returns {{ taiNguyen: string[], metaCsp: string[], tongHttps: number, chuoiKhac: number }}
 *   taiNguyen — mỗi mục "thẻ thuộc-tính=giá-trị" trỏ ra ngoài (PHẢI rỗng);
 *   tongHttps — số lần "http(s)://" xuất hiện thô trong tệp; chuoiKhac = tongHttps − (trong taiNguyen + metaCsp).
 */
export function kiemVoAppKhongHttps(html) {
  const taiNguyen = [];
  for (const the of html.matchAll(THE_TAI)) {
    for (const tt of the[0].matchAll(THUOC_TINH)) {
      const giaTri = tt[2] ?? tt[3] ?? tt[4] ?? "";
      if (RA_NGOAI.test(giaTri)) taiNguyen.push(`<${the[1].toLowerCase()} ${tt[1].toLowerCase()}=${giaTri.slice(0, 140)}>`);
    }
  }
  for (const s of html.matchAll(STYLE_NOI_TUYEN)) for (const u of s[1].matchAll(URL_CSS)) taiNguyen.push(`<style ${u[1].slice(0, 140)}>`);
  const metaCsp = [...html.matchAll(META_CSP)].map((m) => m[0].slice(0, 200));
  const dem = (t) => (t.match(/https?:\/\//gi) || []).length;
  const tongHttps = dem(html);
  const chuoiKhac = tongHttps - taiNguyen.reduce((n, t) => n + dem(t), 0) - metaCsp.reduce((n, t) => n + dem(t), 0);
  return { taiNguyen, metaCsp, tongHttps, chuoiKhac };
}

/** Kiểm một danh sách tệp (đường dẫn tương đối REPO_ROOT hoặc tuyệt đối). Tệp thiếu ⇒ lỗi (không im lặng). */
export function kiemTep(danhSach) {
  return danhSach.map((tep) => {
    const duong = resolve(REPO_ROOT, tep);
    if (!existsSync(duong)) return { tep, thieu: true, taiNguyen: [], metaCsp: [], tongHttps: 0, chuoiKhac: 0 };
    return { tep, thieu: false, ...kiemVoAppKhongHttps(readFileSync(duong, "utf8")) };
  });
}

const invokedDirectly = process.argv[1] != null && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const ds = process.argv.slice(2).length ? process.argv.slice(2) : TEP_MAC_DINH;
  const kq = kiemTep(ds);
  let loi = 0;
  for (const r of kq) {
    if (r.thieu) { console.error(`[kiem-vo-app-https] THIẾU ${r.tep} — chạy sau 'vite build'?`); loi += 1; continue; }
    const trangThai = r.taiNguyen.length === 0 ? "ĐẠT" : "TRƯỢT";
    console.log(`[kiem-vo-app-https] ${trangThai} ${r.tep}: tài nguyên ngoài ${r.taiNguyen.length} · meta CSP ${r.metaCsp.length} · http(s):// thô ${r.tongHttps} (chuỗi trong script nội tuyến/chú thích: ${r.chuoiKhac})`);
    for (const t of r.taiNguyen) console.log(`      ✗ ${t}`);
    for (const t of r.metaCsp) console.log(`      · CSP: ${t}`);
    if (r.taiNguyen.length) loi += 1;
  }
  process.exit(loi ? 1 : 0);
}
