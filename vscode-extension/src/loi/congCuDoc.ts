/**
 * ★★★ ĐỢT 4B — định dạng kết quả các tool ĐỌC của lõi agent phía extension (THUẦN). Mọi chuỗi rời máy đi qua
 * `cheBiMat`; tệp/đường nhạy cảm đã bị lọc ở tầng I/O (`duocPhepDoc`/`duocPhepRoiMay`) TRƯỚC khi tới đây.
 * Tiếng Anh vì đây là chữ cho MODEL đọc (prompt + tool đều tiếng Anh — README lõi mục 7).
 */
import { CHE, cheBiMat } from "./nguCanh";

export const TRAN_BYTE_DOC_FILE = 64 * 1024;
export const TRAN_KET_QUA_GREP_AGENT = 200;
export const TRAN_KY_TU_DONG = 300;
export const TRAN_CHAN_DOAN = 200;

/** `read_file`: đánh số dòng (1-based) theo kiểu `cat -n`, cắt theo khoảng dòng + trần byte, che bí mật. */
export function dinhDangDocFile(rel: string, noiDung: string, tu?: number, den?: number, tranByte = TRAN_BYTE_DOC_FILE): string {
  const dong = noiDung.split(/\r?\n/);
  if (dong.length > 1 && dong[dong.length - 1] === "") dong.pop();
  const tong = dong.length;
  const a = Math.max(1, tu ?? 1);
  const b = Math.min(tong, den ?? tong);
  if (tong === 0 || (noiDung === "" && a === 1)) return `File: ${rel} (empty file)`;
  if (a > tong) return `File: ${rel} has only ${tong} lines; start_line ${a} is past the end.`;
  const ra: string[] = [];
  let byte = 0;
  let catO: number | undefined;
  let trongPem = false;
  for (let i = a; i <= b; i++) {
    const goc = dong[i - 1];
    if (/-----BEGIN .*PRIVATE KEY-----/.test(goc)) trongPem = true;
    const than = trongPem ? CHE : cheBiMat(goc);
    if (/-----END .*-----/.test(goc)) trongPem = false;
    const s = `${String(i).padStart(6)}\t${than}`;
    byte += Buffer.byteLength(s, "utf8") + 1;
    if (byte > tranByte) {
      catO = i;
      break;
    }
    ra.push(s);
  }
  const dau = `File: ${rel} (lines ${a}-${catO ? catO - 1 : b} of ${tong})`;
  const duoi = catO
    ? `\n[output cut after line ${catO - 1}: output limit ${tranByte} bytes — call read_file again with start_line=${catO}]`
    : "";
  return `${dau}\n${ra.join("\n")}${duoi}`;
}

export interface TepQuet {
  rel: string;
  noiDung: string;
}

/** Biên dịch mẫu grep: regex JS; sai cú pháp ⇒ tìm NGUYÊN VĂN (và nói rõ). */
export function bienDichMau(mau: string): { re: RegExp; ghiChu?: string } {
  try {
    return { re: new RegExp(mau) };
  } catch {
    return { re: new RegExp(mau.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), ghiChu: "pattern is not a valid regular expression; searched it as literal text" };
  }
}

/** `grep`: dòng khớp dạng `rel:line: text`, trần số kết quả + độ dài dòng, khối khoá riêng PEM không bao giờ in. */
export function grepTrenTep(mau: string, tep: TepQuet[], opts: { tran?: number; tapNguonBiCat?: boolean; soBoQua?: number } = {}): string {
  const tran = opts.tran ?? TRAN_KET_QUA_GREP_AGENT;
  const { re, ghiChu } = bienDichMau(mau);
  const ra: string[] = [];
  let daCat = false;
  outer: for (const t of tep) {
    const dong = t.noiDung.split(/\r?\n/);
    let trongPem = false;
    for (let i = 0; i < dong.length; i++) {
      if (/-----BEGIN .*PRIVATE KEY-----/.test(dong[i])) {
        trongPem = true;
        continue;
      }
      if (/-----END .*-----/.test(dong[i])) {
        trongPem = false;
        continue;
      }
      if (trongPem || !re.test(dong[i])) continue;
      if (ra.length >= tran) {
        daCat = true;
        break outer;
      }
      let s = cheBiMat(dong[i].trim());
      if (s.length > TRAN_KY_TU_DONG) s = `${s.slice(0, TRAN_KY_TU_DONG)} …[line cut]`;
      ra.push(`${t.rel}:${i + 1}: ${s}`);
    }
  }
  const dau = ra.length === 0 ? `No matches for /${cheBiMat(mau)}/ in ${tep.length} files.` : `${ra.length} matches for /${cheBiMat(mau)}/ (${tep.length} files searched):`;
  const them: string[] = [];
  if (ghiChu) them.push(`(${ghiChu})`);
  if (daCat) them.push(`[cut at ${tran} matches — narrow the pattern, path or include]`);
  if (opts.tapNguonBiCat) them.push("[not every file was searched: the file list hit its limit — pass path/include to narrow]");
  if (opts.soBoQua) them.push(`(${opts.soBoQua} sensitive/binary/large files skipped)`);
  return [dau, ...ra, ...them].join("\n");
}

export interface MucChanDoan {
  rel: string;
  dong: number;
  cot: number;
  mucDo: "error" | "warning" | "info" | "hint";
  thongDiep: string;
  nguon?: string;
  ma?: string;
}

/** `get_diagnostics`: lỗi trước, cảnh báo sau; trần số mục; che bí mật trong thông điệp. */
export function dinhDangChanDoan(ds: MucChanDoan[], phamVi: string, tran = TRAN_CHAN_DOAN): string {
  const thuTu = { error: 0, warning: 1, info: 2, hint: 3 } as const;
  const sap = [...ds].sort((a, b) => thuTu[a.mucDo] - thuTu[b.mucDo] || a.rel.localeCompare(b.rel) || a.dong - b.dong);
  const dem = (m: MucChanDoan["mucDo"]) => ds.filter((d) => d.mucDo === m).length;
  if (ds.length === 0) return `No problems reported by VSCode for ${phamVi}. (Language servers may still be analysing recently changed files.)`;
  const dau = `${phamVi}: ${dem("error")} errors, ${dem("warning")} warnings, ${dem("info") + dem("hint")} infos.`;
  const dong = sap.slice(0, tran).map((d) => {
    const nguon = d.nguon ? ` [${d.nguon}${d.ma ? ` ${d.ma}` : ""}]` : "";
    return `${d.rel}:${d.dong}:${d.cot} ${d.mucDo}: ${cheBiMat(d.thongDiep.replace(/\s+/g, " ").trim())}${nguon}`;
  });
  if (sap.length > tran) dong.push(`[cut: ${sap.length - tran} more]`);
  return [dau, ...dong].join("\n");
}
