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
// `chePem` giữ NGUYÊN ngữ nghĩa regex gốc (cặp BEGIN…END; lưới cheTuyenTinh.test.ts so từng ký tự). Phần "BEGIN không có END phía sau" là
// luật RIÊNG, thêm sau (HST 16/11): `chePemThieuEnd`; đường chung dùng `chePemDayDu` = hai phép nối tiếp.

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

/**
 * (HST 16/11) trần THÂN khoá được che khi BEGIN thiếu END. Căn cứ số học (DER ASN.1, trường hợp xấu): RSA-8192 PKCS#8 = 98 dòng × 64 /
 * 6 244 ký tự base64; RSA-16384 PKCS#8 = 194 dòng / 12 388 ký tự (12 582 kèm xuống dòng) ⇒ 256 dòng / 16 384 ký tự phủ RSA-16384 có dư.
 *
 * ═══ GIỚI HẠN ĐÃ BIẾT của "PEM thiếu END" (MỘT chỗ duy nhất; ca đo đúng con số ở cheTuyenTinh.pemThieuEnd.test.ts, khối "giới hạn đã biết") ═══
 *   G1. Thân dài hơn trần ⇒ phần SAU trần (dòng thứ 257 trở đi, hoặc từ dòng làm tổng vượt 16 384 ký tự) còn HIỆN.
 *   G2. Dòng ngắn sau thân mà KHÔNG chia hết cho 4 và < 16 ký tự ⇒ không nhận là thân ⇒ còn hiện, tối đa 15 ký tự (khoá thật luôn bội 4 nên
 *       dòng cuối thật vẫn bị che; G2 chỉ là ranh để không nuốt chữ thường).
 *   G3. Một "từ" toàn ký tự base64 dài 4 / 8 / 12 ký tự đứng NGAY dòng sau thân bị nuốt làm dòng cuối (che oan một dòng).
 *   G4. Luồng (`StreamingSecretRedactor`, aiSafety.ts): thân dài hơn `STREAM_HOLD_CAP` (8 192) ⇒ lần xả cưỡng bức che phần đã giữ, nhưng các
 *       mẩu SAU lần xả không còn header ⇒ phần thân còn lại nhả NGUYÊN VĂN (đo: khoá giả 200 dòng ⇒ 134–138 dòng lọt). Lô 2 (HST) — ca `it.fails`.
 */
export const TRAN_DONG_THAN_PEM = 256;
export const TRAN_KY_TU_THAN_PEM = 16_384;
/** Dòng ĐẦU của thân tối thiểu bao nhiêu ký tự (dòng ngắn hơn ngay sau header ⇒ không phải thân). */
const DONG_THAN_TOI_THIEU = 16;

const laB64 = (c: number): boolean => laChuCai(c) || laChuSo(c) || c === 43 /* + */ || c === 47 /* / */;
const laCachNgang = (c: number): boolean => c === 32 || c === 9;

/**
 * Quét THÂN khoá bắt đầu NGAY sau header ở `p`; trả chỉ số kết thúc (không gồm ký tự xuống dòng cuối) — `p` nếu không có thân.
 * Hai dạng:
 *   · nhiều dòng thật: phần còn lại của dòng header chỉ là khoảng trắng; mỗi dòng thân = [khoảng ngang] base64 ={0,2} [khoảng ngang] rồi
 *     hết dòng / hết văn bản; cho phép `Proc-Type:` / `DEK-Info:` (PEM mã hoá kiểu cũ) + một dòng trống ở ĐẦU thân;
 *   · một dòng có `\n` thoát (chuỗi JSON/JS): các đoạn base64 ngăn bằng `\n` hay `\r\n` hai ký tự; đoạn cuối có thể dừng ở ký tự lạ (`"`).
 * Dừng ở dòng/đoạn đầu tiên không thuộc thân; dừng ở trần dòng / ký tự. Mỗi ký tự được nhìn O(1) lần.
 */
function ketThucThanPem(text: string, p: number): number {
  const n = text.length;
  let i = p;
  while (i < n && laCachNgang(text.charCodeAt(i))) i++;
  let thoat = false;
  if (text.startsWith("\\r\\n", i)) {
    thoat = true;
    i += 4;
  } else if (text.startsWith("\\n", i)) {
    thoat = true;
    i += 2;
  } else if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10) i += 2;
  else if (text.charCodeAt(i) === 10) i += 1;
  else return p; // header không đứng cuối dòng ⇒ nhắc tên trong câu chữ, không phải khối
  let ketThuc = p;
  let soDong = 0;
  let soKyTu = 0;
  let doDaiChuan = 0;
  let daCoTieuDe = false;
  for (;;) {
    if (soDong >= TRAN_DONG_THAN_PEM) break;
    const dau = i;
    // tiêu đề PEM mã hoá kiểu cũ, chỉ ở đầu thân, chỉ dạng nhiều dòng thật
    if (!thoat && soDong === 0 && (text.startsWith("Proc-Type:", i) || text.startsWith("DEK-Info:", i))) {
      let j = i;
      while (j < n && text.charCodeAt(j) !== 10) j++;
      daCoTieuDe = true;
      ketThuc = j > i && text.charCodeAt(j - 1) === 13 ? j - 1 : j;
      i = j < n ? j + 1 : j;
      continue;
    }
    if (!thoat && daCoTieuDe && soDong === 0 && (text.charCodeAt(i) === 10 || (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) === 10))) {
      i += text.charCodeAt(i) === 13 ? 2 : 1; // một dòng trống sau tiêu đề
      daCoTieuDe = false;
      continue;
    }
    if (!thoat) while (i < n && laCachNgang(text.charCodeAt(i))) i++;
    const batDau = i;
    while (i < n && laB64(text.charCodeAt(i))) i++;
    let k = 0;
    while (k < 2 && i < n && text.charCodeAt(i) === 61 /* = */) {
      i++;
      k++;
    }
    const dai = i - batDau;
    // ranh giới dòng
    let hetDong = false;
    let tiep = i;
    let dungSauDong = false;
    if (thoat) {
      if (text.startsWith("\\r\\n", i)) {
        hetDong = true;
        tiep = i + 4;
      } else if (text.startsWith("\\n", i)) {
        hetDong = true;
        tiep = i + 2;
      } else {
        hetDong = true; // ký tự lạ (nháy, dấu phẩy…) hoặc hết văn bản ⇒ đoạn này là đoạn CUỐI
        dungSauDong = true;
      }
    } else {
      let j = i;
      while (j < n && laCachNgang(text.charCodeAt(j))) j++;
      if (j >= n) {
        hetDong = true;
        dungSauDong = true;
        tiep = j;
      } else if (text.charCodeAt(j) === 10) {
        hetDong = true;
        tiep = j + 1;
      } else if (text.charCodeAt(j) === 13 && text.charCodeAt(j + 1) === 10) {
        hetDong = true;
        tiep = j + 2;
      }
    }
    if (!hetDong || dai === 0) break;
    if (soKyTu + dai > TRAN_KY_TU_THAN_PEM) break;
    // Dòng ĐẦU của thân: ≥ 16 ký tự, đặt "độ dài dòng chuẩn". Dòng sau: đúng độ dài chuẩn ⇒ dòng đầy; NGẮN hơn ⇒ chỉ nhận làm dòng CUỐI
    // khi độ dài chia hết cho 4 (base64 luôn bội 4 kể cả đệm `=`) hoặc khi văn bản hết ngay đó (bị cắt giữa dòng); dài hơn ⇒ không phải thân.
    if (soDong === 0) {
      if (dai < DONG_THAN_TOI_THIEU) break; // dòng ngắn ngay sau header ⇒ không nhận là thân
      doDaiChuan = dai;
    } else if (dai !== doDaiChuan) {
      if (dai > doDaiChuan) break;
      // bị cắt giữa dòng ở CUỐI văn bản: chỉ nhận khi đoạn còn lại đủ dài (≥ 16) — chữ ngắn ở cuối tệp ("sau", "b") không phải thân
      if (dai % 4 !== 0 && !(dungSauDong && !thoat && dai >= DONG_THAN_TOI_THIEU)) break;
      soDong++;
      soKyTu += dai;
      ketThuc = i;
      break; // dòng ngắn = dòng CUỐI
    }
    soDong++;
    soKyTu += dai;
    ketThuc = i; // không gồm khoảng trắng/xuống dòng sau dòng thân
    if (dungSauDong) break;
    i = tiep;
    if (i === dau) break; // phòng vòng lặp không tiến
  }
  return soDong === 0 ? p : ketThuc;
}

/** BEGIN…PRIVATE KEY KHÔNG có END phía sau ⇒ che header + THÂN liền sau (xem `ketThucThanPem`); header trơ (0 dòng thân) ⇒ GIỮ NGUYÊN. */
export function chePemThieuEnd(text: string, thay: string): KetQuaThay {
  if (text.indexOf("-----BEGIN") === -1) return { text, n: 0 };
  const reDau = /-----BEGIN[ A-Z]*PRIVATE KEY-----/g;
  // Vị trí bắt đầu của END CUỐI CÙNG (một lượt quét) ⇒ "có END phía sau BEGIN" ⇔ endCuoi >= sauDau, không quét lại cho từng BEGIN.
  let endCuoi = -1;
  for (const m of text.matchAll(/-----END[ A-Z]*PRIVATE KEY-----/g)) endCuoi = m.index ?? endCuoi;
  let out = "";
  let n = 0;
  let tim = 0; // con trỏ tìm BEGIN kế
  let daGhi = 0; // con trỏ đầu ra: text[0..daGhi) đã chép vào `out`
  for (;;) {
    reDau.lastIndex = tim;
    const d = reDau.exec(text);
    if (!d) break;
    const sauDau = d.index + d[0].length;
    // Có END phía sau ⇒ khối này thuộc `chePem` (đã che trước khi tới đây khi gọi qua `chePemDayDu`); bỏ qua.
    if (endCuoi >= sauDau) {
      tim = sauDau;
      continue;
    }
    const kt = ketThucThanPem(text, sauDau);
    if (kt === sauDau) {
      tim = sauDau; // header trơ: giữ nguyên, tìm BEGIN kế
      continue;
    }
    out += text.slice(daGhi, d.index) + thay;
    n++;
    daGhi = kt;
    tim = kt;
  }
  if (n === 0) return { text, n };
  return { text: out + text.slice(daGhi), n };
}

/** Đường chung: cặp BEGIN…END (ngữ nghĩa regex gốc) rồi BEGIN thiếu END có thân. */
export function chePemDayDu(text: string, thay: string): KetQuaThay {
  const a = chePem(text, thay);
  const b = chePemThieuEnd(a.text, thay);
  return { text: b.text, n: a.n + b.n };
}
