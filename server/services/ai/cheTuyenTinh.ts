/**
 * ★★★ Ba phép che viết lại THUẦN TUYẾN TÍNH cho `aiSafety.ts` (kiem-dinh 2026-10-26) — thay ba regex bậc hai trên đầu vào xấu:
 *
 *   · chuỗi kết nối   /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@]+@[^\s]+/gi
 *   · email           /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
 *   · khối PEM        /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g
 *
 * VÌ SAO: ba regex này thử lại từ MỌI biên chữ / MỌI "-----BEGIN" và mỗi lần quét tới hết chuỗi ⇒ O(n²): `"10.1.1.".repeat(20000)` (140 KB)
 * = 11,6 s trên vòng lặp sự kiện duy nhất (cùng tiến trình với đường STOP). Ở đây mỗi phép đi theo CHỈ MỘT mốc (`://`, `@`, `BEGIN`) và dùng
 * con trỏ "ký tự dừng kế tiếp" có nhớ ⇒ mỗi ký tự bị nhìn O(1) lần.
 *
 * NGỮ NGHĨA GIỮ NGUYÊN (khớp CÙNG đoạn, cùng thứ tự, trái → phải, không chồng): lưới `cheTuyenTinh.test.ts` so từng phép với regex gốc trên
 * hàng chục nghìn chuỗi ngẫu nhiên sinh từ bảng ký tự "khó" + các vector thật. Đổi một phép ở đây ⇒ lưới đó phải xanh.
 * THUẦN: không ném, không đọc env/đĩa.
 */

export interface KetQuaThay {
  text: string;
  n: number;
}

const laChuCai = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const laChuSo = (c: number): boolean => c >= 48 && c <= 57;
/** `\w` của JS (chỉ ASCII khi không có cờ `u`). */
const laTu = (c: number): boolean => laChuCai(c) || laChuSo(c) || c === 95;
const RE_KHOANG_TRANG = /\s/;
/** `\s` của JS (kể cả khoảng trắng Unicode). */
const laKhoangTrang = (s: string, i: number): boolean => {
  const c = s.charCodeAt(i);
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return RE_KHOANG_TRANG.test(s[i]!);
};

/** Chỉ mục của ký tự dừng kế tiếp (khoảng trắng hoặc '@') từ `k`, có nhớ để nhiều truy vấn tăng dần không quét lại. */
function boTimDung(s: string): (k: number) => number {
  let tu = -1;
  let den = -1;
  return (k) => {
    if (tu >= 0 && k >= tu && k <= den) return den;
    let j = k;
    while (j < s.length && s.charCodeAt(j) !== 64 && !laKhoangTrang(s, j)) j++;
    tu = k;
    den = j;
    return j;
  };
}

// ─── Chuỗi kết nối ────────────────────────────────────────────────────────────────

const laKyTuScheme = (c: number): boolean => laChuCai(c) || laChuSo(c) || c === 43 /* + */ || c === 46 /* . */ || c === 45; /* - */

export function cheChuoiKetNoi(text: string, thay: string): KetQuaThay {
  const len = text.length;
  let out = "";
  let n = 0;
  let pos = 0; // hết đoạn đã xử lý (cuối khớp trước)
  const dungKeTiep = boTimDung(text);
  let idx = text.indexOf("://");
  while (idx !== -1) {
    // đầu scheme: khớp trái nhất [a-z] (không phân biệt hoa-thường) đứng ở biên \b trong dải ký tự scheme liền trước "://"
    let r = idx;
    while (r > pos && laKyTuScheme(text.charCodeAt(r - 1))) r--;
    let dau = -1;
    for (let k = r; k < idx; k++) {
      if (laChuCai(text.charCodeAt(k)) && (k === 0 || !laTu(text.charCodeAt(k - 1)))) {
        dau = k;
        break;
      }
    }
    if (dau >= 0) {
      // user: [^\s:@/]+
      let j = idx + 3;
      while (j < len) {
        const c = text.charCodeAt(j);
        if (c === 58 || c === 64 || c === 47 || laKhoangTrang(text, j)) break;
        j++;
      }
      if (j > idx + 3 && j < len && text.charCodeAt(j) === 58) {
        // mật khẩu: [^\s@]+ rồi '@'
        const k = dungKeTiep(j + 1);
        if (k > j + 1 && k < len && text.charCodeAt(k) === 64) {
          // host: [^\s]+
          let e = k + 1;
          while (e < len && !laKhoangTrang(text, e)) e++;
          if (e > k + 1) {
            out += text.slice(pos, dau) + thay;
            n++;
            pos = e;
            idx = text.indexOf("://", pos);
            continue;
          }
        }
      }
    }
    idx = text.indexOf("://", idx + 1);
  }
  return n === 0 ? { text, n } : { text: out + text.slice(pos), n };
}

// ─── Email ──────────────────────────────────────────────────────────────────────

const laKyTuLocal = (c: number): boolean => laChuCai(c) || laChuSo(c) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45; // . _ % + -
const laKyTuMien = (c: number): boolean => laChuCai(c) || laChuSo(c) || c === 46 || c === 45; // . -

export function cheEmail(text: string, thay: string): KetQuaThay {
  const len = text.length;
  let out = "";
  let n = 0;
  let pos = 0;
  let at = text.indexOf("@");
  while (at !== -1) {
    // phần local: dải [A-Za-z0-9._%+-] liền trước '@', bắt đầu ở biên \b trái nhất
    let r = at;
    while (r > pos && laKyTuLocal(text.charCodeAt(r - 1))) r--;
    let dau = -1;
    for (let k = r; k < at; k++) {
      const truoc = k > 0 && laTu(text.charCodeAt(k - 1));
      if (laTu(text.charCodeAt(k)) !== truoc) {
        dau = k;
        break;
      }
    }
    if (dau >= 0) {
      // miền: dải [A-Za-z0-9.-]; khớp = phần đầu tham lam + "." + >=2 chữ + \b ⇒ chấm PHẢI NHẤT thoả điều kiện
      let q = at + 1;
      while (q < len && laKyTuMien(text.charCodeAt(q))) q++;
      let ketThuc = -1;
      for (let d = q - 1; d >= at + 2; d--) {
        if (text.charCodeAt(d) !== 46) continue;
        let e = d + 1;
        while (e < q && laChuCai(text.charCodeAt(e))) e++;
        if (e - (d + 1) >= 2 && (e === len || !laTu(text.charCodeAt(e)))) {
          ketThuc = e;
          break;
        }
      }
      if (ketThuc >= 0) {
        out += text.slice(pos, dau) + thay;
        n++;
        pos = ketThuc;
        at = text.indexOf("@", pos);
        continue;
      }
    }
    at = text.indexOf("@", at + 1);
  }
  return n === 0 ? { text, n } : { text: out + text.slice(pos), n };
}

// ─── Khối PEM ─────────────────────────────────────────────────────────────────────

export function chePem(text: string, thay: string): KetQuaThay {
  if (text.indexOf("-----BEGIN") === -1) return { text, n: 0 };
  const reDau = /-----BEGIN[ A-Z]*PRIVATE KEY-----/g;
  const reCuoi = /-----END[ A-Z]*PRIVATE KEY-----/g;
  let out = "";
  let n = 0;
  let pos = 0;
  for (;;) {
    reDau.lastIndex = pos;
    const d = reDau.exec(text);
    if (!d) break;
    reCuoi.lastIndex = d.index + d[0].length;
    const c = reCuoi.exec(text);
    if (!c) break; // không còn END nào phía sau ⇒ mọi BEGIN về sau cũng không khớp
    out += text.slice(pos, d.index) + thay;
    n++;
    pos = c.index + c[0].length;
  }
  return n === 0 ? { text, n } : { text: out + text.slice(pos), n };
}
