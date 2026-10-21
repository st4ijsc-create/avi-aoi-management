/**
 * ★★ Đợt 9 (2026-10-21) — Siemens SCL (TIA Portal, nguồn ngoài) → IEC 61131-3 ST, BẢN CHÍNH (dieu-phoi 2026-10-21).
 * Bản chép cho bộ đo (chạy bằng node thuần, không import được .ts): `scripts/ai-eval/ngau-nhien/lib/st-scl/scl.mjs` —
 * lưới tương đương `sclSangSt.tuongDuong.test.ts` chạy cả hai bản trên mọi mã thật (mau-scl, mẫu kho, câu trả lời đã lưu
 * trong reports) để bắt trôi.
 *
 * Chỉ biến đổi phần MÃ (không chạm chuỗi '…' và chú thích), GIỮ số dòng (chẩn đoán trỏ đúng dòng SCL):
 * bỏ `{ thuộc tính }`, `VERSION : x`, `REGION …`/`END_REGION`, `BEGIN`; `"Tên"` → Tên; `#bien` → bien; TON_TIME… → TON…;
 * IEC_TIMER/IEC_COUNTER theo lời gọi `#x.TON(`; CTU_INT → CTU; MIN/MAX/LIMIT/SEL tham số hình thức → vị trí; `//` → `(* *)`;
 * VAR_TEMP trong FUNCTION → VAR.
 */

export type LoaiDoan = "ma" | "chuoi" | "chu-thich";

/** Tách văn bản thành đoạn mã / chuỗi / chú thích. */
export function tachDoan(text: string): { loai: LoaiDoan; s: string }[] {
  const ra: { loai: LoaiDoan; s: string }[] = [];
  let i = 0;
  let dau = 0;
  const day = (loai: LoaiDoan, den: number) => {
    if (den > dau) ra.push({ loai, s: text.slice(dau, den) });
    dau = den;
  };
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
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

const trenMa = (text: string, f: (ma: string) => string) => tachDoan(text).map((d) => (d.loai === "ma" ? f(d.s) : d.s)).join("");

const DONG_HO_TIA: Record<string, string> = { TON_TIME: "TON", TOF_TIME: "TOF", TP_TIME: "TP", TONR_TIME: "TONR" };

const HAM_BIEN_THIEN = /\b(MIN|MAX|LIMIT|ADD|MUL|AND|OR|XOR|SEL|MUX|CONCAT)\s*\(/gi;

/** MIN/MAX/… dạng tham số hình thức (`MIN(IN1 := a, IN2 := b)`) → vị trí (sắp G/K, rồi IN0, IN1…; LIMIT: MN, IN, MX). */
function boThamSoHinhThuc(ma: string): string {
  let ra = "";
  let i = 0;
  const re = new RegExp(HAM_BIEN_THIEN.source, "gi");
  for (let m: RegExpExecArray | null; (m = re.exec(ma)); ) {
    const mo = m.index + m[0].length - 1;
    let sau = 0;
    let dau = mo + 1;
    let het = -1;
    const ds: string[] = [];
    for (let j = mo + 1; j < ma.length; j++) {
      const c = ma[j];
      if (c === "(" || c === "[") sau++;
      else if ((c === ")" || c === "]") && sau > 0) sau--;
      else if (c === ")") {
        ds.push(ma.slice(dau, j));
        het = j;
        break;
      } else if (c === "," && sau === 0) {
        ds.push(ma.slice(dau, j));
        dau = j + 1;
      }
    }
    if (het < 0) continue;
    const ten = ds.map((d) => /^\s*([A-Za-z]\w*)\s*:=/.exec(d)?.[1]?.toUpperCase());
    const THU_TU: Record<string, number> = { MN: -3, IN: -2, MX: -1 };
    const ham = m[1].toUpperCase();
    const hang = (t: string) => (t === "G" || t === "K" ? -9 : t in THU_TU && ham === "LIMIT" ? THU_TU[t] : Number(/(\d+)$/.exec(t)?.[1] ?? 999));
    const hinhThuc = ten.every(Boolean);
    const xep = ds
      .map((d, k) => ({ d: hinhThuc ? d.replace(/^\s*[A-Za-z]\w*\s*:=\s*/, "") : d, h: hinhThuc ? hang(ten[k] as string) : k }))
      .sort((a, b) => a.h - b.h);
    ra += ma.slice(i, mo + 1) + xep.map((x) => boThamSoHinhThuc(hinhThuc ? x.d.trim() : x.d)).join(hinhThuc ? ", " : ",") + ")";
    i = het + 1;
    re.lastIndex = i;
  }
  return ra + ma.slice(i);
}

export function sclSangSt(text: string): string {
  let s = text.replace(/\r\n/g, "\n").replace(/\{[^{}]*\}/g, (m) => m.replace(/[^\n]/g, " "));
  const kieuDaTheHien: Record<string, string> = {};
  for (const m of s.matchAll(/#?"?(\w+)"?\s*\.\s*(TON|TOF|TP|CTU|CTD|CTUD)\s*\(/gi)) kieuDaTheHien[m[1].toUpperCase()] = m[2].toUpperCase();
  s = tachDoan(s)
    .map((d) => (d.loai === "chu-thich" && d.s.startsWith("//") ? `(*${d.s.slice(2).replace(/\*\)|\(\*/g, "  ")} *)` : d.s))
    .join("");
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
      .replace(/\b(CTU|CTD|CTUD)_INT\b/gi, (_m, k: string) => k.toUpperCase())
      .replace(/(\w+)\s*\.\s*(TON|TOF|TP|CTU|CTD|CTUD)\s*\(/gi, (m, x: string) => (kieuDaTheHien[x.toUpperCase()] ? `${x}(` : m));
    r = r.replace(/(\b\w+)(\s*:\s*)(IEC_TIMER|IEC_COUNTER)\b/gi, (m, ten: string, giua: string) => {
      const k = kieuDaTheHien[ten.toUpperCase()];
      if (!k) return m;
      return `${ten}${giua}${k}`;
    });
    return boThamSoHinhThuc(r);
  });
  return s;
}

/** Dấu hiệu SCL: tên khối trong ngoặc kép, số tham chiếu `#bien`. */
export function dauHieuScl(text: string): { tenKhoiNgoacKep: boolean; soThamChieuThang: number } {
  const ma = tachDoan(text)
    .filter((d) => d.loai === "ma")
    .map((d) => d.s)
    .join("");
  return {
    tenKhoiNgoacKep: /\b(FUNCTION_BLOCK|FUNCTION)\s+"/i.test(ma),
    soThamChieuThang: (ma.match(/(?<![A-Za-z0-9_])#[A-Za-z_]/g) ?? []).length,
  };
}
