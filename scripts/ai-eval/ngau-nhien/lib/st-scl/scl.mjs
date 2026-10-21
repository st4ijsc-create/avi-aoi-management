/**
 * ★★ Đợt 9 (2026-10-21) — PHƯƠNG NGỮ Siemens SCL (TIA Portal, nguồn ngoài) cho bộ plc-st-v1.
 * Không có trình dịch SCL mã nguồn mở ⇒ bộ chấm CHUẨN HOÁ SCL → IEC 61131-3 ST rồi biên dịch + chạy test bằng trình
 * dịch ST đã kiểm (RuSTy mặc định, MATIEC tuỳ chọn). Bật: `AI_EVAL_ST_PHUONG_NGU=scl`.
 *
 *  sclSangSt(text)  SCL → ST: bỏ `{ thuộc tính }`, `VERSION : x`, `REGION …`/`END_REGION`, `BEGIN`; `"Tên"` → Tên;
 *                   `#bien` → bien; TON_TIME/TOF_TIME/TP_TIME → TON/TOF/TP; IEC_TIMER/IEC_COUNTER theo lời gọi
 *                   `#x.TON(` / `.CTU(` …; chỉ biến đổi phần MÃ (không chạm chuỗi '…' và chú thích).
 *  stSangScl(text)  ST → SCL cho tệp KHUNG hiển thị trong đề (tên khối trong ngoặc kép, thuộc tính, `#` trong thân).
 *  dauHieuScl(text) đếm dấu hiệu SCL của câu trả lời (để báo "model trả ST thuần" — không chặn).
 */

/** Tách văn bản thành đoạn { loai: "ma"|"chuoi"|"chu-thich", s }. */
export function tachDoan(text) {
  const ra = [];
  let i = 0, dau = 0;
  const day = (loai, den) => { if (den > dau) ra.push({ loai, s: text.slice(dau, den) }); dau = den; };
  while (i < text.length) {
    const c = text[i], c2 = text[i + 1];
    if (c === "(" && c2 === "*") {
      day("ma", i);
      const k = text.indexOf("*)", i + 2);
      i = k < 0 ? text.length : k + 2;
      day("chu-thich", i);
    } else if (c === "/" && c2 === "/") {
      day("ma", i);
      const k = text.indexOf("\n", i);
      i = k < 0 ? text.length : k;
      day("chu-thich", i);
    } else if (c === "/" && c2 === "*") {
      day("ma", i);
      const k = text.indexOf("*/", i + 2);
      i = k < 0 ? text.length : k + 2;
      day("chu-thich", i);
    } else if (c === "'") {
      day("ma", i);
      for (i++; i < text.length && text[i] !== "'"; i++) if (text[i] === "$") i++;
      i++;
      day("chuoi", Math.min(i, text.length));
    } else i++;
  }
  day("ma", text.length);
  return ra;
}

const trenMa = (text, f) => tachDoan(text).map((d) => (d.loai === "ma" ? f(d.s) : d.s)).join("");

const DONG_HO_TIA = { TON_TIME: "TON", TOF_TIME: "TOF", TP_TIME: "TP", TONR_TIME: "TONR" };

/**
 * Hàm chuẩn có số đối số thay đổi (MIN/MAX/…): TIA viết tham số hình thức `MIN(IN1 := a, IN2 := b)`; RuSTy chỉ nhận dạng
 * vị trí ⇒ bỏ tên hình thức (sắp theo tên: G/K trước, rồi IN0, IN1, …).
 */
const HAM_BIEN_THIEN = /\b(MIN|MAX|LIMIT|ADD|MUL|AND|OR|XOR|SEL|MUX|CONCAT)\s*\(/gi;
function boThamSoHinhThuc(ma) {
  let ra = "";
  let i = 0;
  const re = new RegExp(HAM_BIEN_THIEN.source, "gi"); // riêng mỗi lần gọi — hàm đệ quy cho lời gọi lồng
  for (let m; (m = re.exec(ma)); ) {
    const mo = m.index + m[0].length - 1;
    let sau = 0, dau = mo + 1, het = -1;
    const ds = [];
    for (let j = mo + 1; j < ma.length; j++) {
      const c = ma[j];
      if (c === "(" || c === "[") sau++;
      else if ((c === ")" || c === "]") && sau > 0) sau--;
      else if (c === ")") { ds.push(ma.slice(dau, j)); het = j; break; }
      else if (c === "," && sau === 0) { ds.push(ma.slice(dau, j)); dau = j + 1; }
    }
    if (het < 0) continue;
    const ten = ds.map((d) => /^\s*([A-Za-z]\w*)\s*:=/.exec(d)?.[1]?.toUpperCase());
    const THU_TU = { MN: -3, IN: -2, MX: -1 }; // LIMIT(MN, IN, MX)
    const hang = (t) => (t === "G" || t === "K" ? -9 : t in THU_TU && m[1].toUpperCase() === "LIMIT" ? THU_TU[t] : Number(/(\d+)$/.exec(t)?.[1] ?? 999));
    const hinhThuc = ten.every(Boolean); // không phải TOÀN BỘ dạng hình thức ⇒ giữ thứ tự, chỉ xử lý lồng bên trong
    const xep = ds
      .map((d, k) => ({ d: hinhThuc ? d.replace(/^\s*[A-Za-z]\w*\s*:=\s*/, "") : d, h: hinhThuc ? hang(ten[k]) : k }))
      .sort((a, b) => a.h - b.h);
    ra += ma.slice(i, mo + 1) + xep.map((x) => boThamSoHinhThuc(hinhThuc ? x.d.trim() : x.d)).join(hinhThuc ? ", " : ",") + ")";
    i = het + 1;
    re.lastIndex = i;
  }
  return ra + ma.slice(i);
}

export function sclSangSt(text) {
  // Thuộc tính { … } (có thể chứa chuỗi) — bỏ trước khi tách đoạn; giữ số dòng.
  let s = text.replace(/\r\n/g, "\n").replace(/\{[^{}]*\}/g, (m) => m.replace(/[^\n]/g, " "));
  // IEC_TIMER / IEC_COUNTER: kiểu thật lấy từ lời gọi `#x.TON(` — đổi khai báo + bỏ `.TON` ở lời gọi.
  const kieuDaTheHien = {};
  for (const m of s.matchAll(/#?"?(\w+)"?\s*\.\s*(TON|TOF|TP|CTU|CTD|CTUD)\s*\(/gi)) kieuDaTheHien[m[1].toUpperCase()] = m[2].toUpperCase();
  // Chú thích dòng `// …` (SCL, CODESYS) → `(* … *)` — MATIEC/OpenPLC không nhận `//`.
  s = tachDoan(s)
    .map((d) => (d.loai === "chu-thich" && d.s.startsWith("//") ? `(*${d.s.slice(2).replace(/\*\)|\(\*/g, "  ")} *)` : d.s))
    .join("");
  // VAR_TEMP trong FUNCTION → VAR (biến của FUNCTION vốn không giữ giữa các lần gọi; MATIEC từ chối VAR_TEMP ở FUNCTION).
  s = s.replace(/\bFUNCTION\b(?!_BLOCK)[\s\S]*?\bEND_FUNCTION\b(?!_BLOCK)/gi, (f) => f.replace(/\bVAR_TEMP\b/gi, "VAR"));
  s = trenMa(s, (ma) => {
    let r = ma
      .replace(/^[ \t]*VERSION\s*:\s*[\d.]+[ \t]*;?/gim, (m) => " ".repeat(m.length))
      .replace(/^[ \t]*REGION\b[^\n]*/gim, "")
      .replace(/^[ \t]*END_REGION\b[ \t]*;?/gim, "")
      .replace(/(?<![\w#])BEGIN\b/gi, "")
      .replace(/"([A-Za-z_][\w.]*)"/g, "$1")
      .replace(/(?<![A-Za-z0-9_])#(?=[A-Za-z_])/g, "")
      .replace(/\b(TON_TIME|TOF_TIME|TP_TIME|TONR_TIME)\b/gi, (m) => DONG_HO_TIA[m.toUpperCase()])
      // Bộ đếm INT của TIA: CTU_INT… = CTU chuẩn IEC (đếm INT) — MATIEC không có tên _INT, RuSTy có cả hai.
      .replace(/\b(CTU|CTD|CTUD)_INT\b/gi, (m, k) => k.toUpperCase())
      .replace(/(\w+)\s*\.\s*(TON|TOF|TP|CTU|CTD|CTUD)\s*\(/gi, (m, x) => (kieuDaTheHien[x.toUpperCase()] ? `${x}(` : m));
    // Khai báo `x : IEC_TIMER;` → kiểu theo lời gọi (IEC_COUNTER của TIA đếm INT ⇒ CTU_INT/CTD_INT/CTUD_INT).
    r = r.replace(/(\b\w+)(\s*:\s*)(IEC_TIMER|IEC_COUNTER)\b/gi, (m, ten, giua, kieu) => {
      const k = kieuDaTheHien[ten.toUpperCase()];
      if (!k) return m;
      return `${ten}${giua}${k}`; // IEC_COUNTER của TIA đếm INT = CTU/CTD/CTUD chuẩn
    });
    return boThamSoHinhThuc(r);
  });
  return s;
}

/** Tên khai trong các khối VAR… (để thêm `#` vào thân khi đổi ST → SCL). */
function tenKhai(text) {
  const ten = new Set();
  for (const k of text.matchAll(/\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP)?\b([\s\S]*?)\bEND_VAR\b/gi)) {
    for (const d of k[1].replace(/\(\*[\s\S]*?\*\)/g, "").split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      for (const t of d.slice(0, i).split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x))) ten.add(t.toUpperCase());
    }
  }
  return ten;
}

/** ST → SCL (cho tệp KHUNG trong đề — tất định, không phải thước). */
export function stSangScl(text) {
  const t = text.replace(/\r\n/g, "\n");
  return t.replace(/\b(FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_]\w*)([^\n]*)\n([\s\S]*?)\bEND_\1\b/g, (m, loai, ten, duoi, than) => {
    const ds = tenKhai(than);
    if (loai.toUpperCase() === "FUNCTION") ds.add(ten.toUpperCase());
    const cuoiKhai = than.search(/\bEND_VAR\b(?![\s\S]*\bEND_VAR\b)/);
    const tach = cuoiKhai < 0 ? 0 : cuoiKhai + "END_VAR".length;
    const khai = trenMa(than.slice(0, tach), (ma) => ma.replace(/:\s*(TON|TOF|TP)\s*;/gi, (x, k) => `: ${k.toUpperCase()}_TIME;`));
    const thanMa = trenMa(than.slice(tach), (ma) =>
      ma
        .replace(/(?<![.\w#])([A-Za-z_]\w*)/g, (x) => (ds.has(x.toUpperCase()) ? `#${x}` : x))
        .replace(/\b(END_IF|END_FOR|END_WHILE|END_CASE|END_REPEAT)\b(?!\s*;)/gi, "$1;"),
    );
    return `${loai} "${ten}"${duoi}\n{ S7_Optimized_Access := 'TRUE' }\nVERSION : 0.1\n${khai}\nBEGIN${thanMa}END_${loai}`;
  });
}

/** Dấu hiệu SCL trong câu trả lời: tên khối trong ngoặc kép, `#` tham chiếu biến. */
export function dauHieuScl(text) {
  const ma = tachDoan(text).filter((d) => d.loai === "ma").map((d) => d.s).join("");
  return {
    tenKhoiNgoacKep: /\b(FUNCTION_BLOCK|FUNCTION)\s+"/i.test(ma),
    soThamChieuThang: (ma.match(/(?<![A-Za-z0-9_])#[A-Za-z_]/g) ?? []).length,
  };
}

export const HUONG_DAN_SCL =
  "Phương ngữ BẮT BUỘC: **Siemens SCL (TIA Portal V17+, nguồn ngoài)** — tên khối trong ngoặc kép (`FUNCTION_BLOCK \"Ten\"`), " +
  "tham chiếu biến cục bộ/giao diện trong thân viết `#ten`, khối định thời IEC dùng kiểu đa thể hiện `TON_TIME`/`TOF_TIME`/`TP_TIME` " +
  "(hoặc `IEC_TIMER` gọi `#x.TON(...)`), mọi lệnh kết thúc bằng `;` (kể cả `END_IF;`). Biến toàn cục viết trong ngoặc kép (`\"G_NOW\"`). " +
  "Giữ NGUYÊN tên, kiểu và thứ tự biến vào/ra như khung; tệp vẫn lưu đúng đường dẫn đã cho.";
