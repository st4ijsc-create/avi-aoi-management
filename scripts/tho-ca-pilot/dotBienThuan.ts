/**
 * Pilot "Thợ Cả nhận việc" — L3b, phần THUẦN (không fs, không git): phân tích khoá `ĐỘT BIẾN` / `KHÔNG ĐƯỢC KHẲNG ĐỊNH` của thẻ và quét tệp test.
 * Tách riêng để `theViec.ts` (thuần) dùng được. Phần chạy thật (áp đột biến lên đĩa) ở `dotBien.ts`.
 */

export interface DotBienThe {
  tep: string;
  tim: string;
  thay: string;
}

/** `tệp|tìm|thay` mỗi dòng; `thay` được chứa '|' (mọi thứ sau dấu '|' thứ hai). `tìm` không được rỗng, không chứa '|'. Dòng trống / bắt đầu '#' bỏ qua. */
export function docDotBien(tho: string): { ds: DotBienThe[]; loi: string[] } {
  const ds: DotBienThe[] = [];
  const loi: string[] = [];
  for (const d0 of tho.replace(/\r\n/g, "\n").split("\n")) {
    const d = d0.replace(/^\s*[-*]\s+/, "").trim();
    if (d === "" || d.startsWith("#")) continue;
    const i = d.indexOf("|");
    const j = i < 0 ? -1 : d.indexOf("|", i + 1);
    if (i < 0 || j < 0) {
      loi.push(`ĐỘT BIẾN "${d.slice(0, 60)}": thiếu dạng tệp|tìm|thay`);
      continue;
    }
    const tep = d.slice(0, i).trim().replace(/\\/g, "/");
    const tim = d.slice(i + 1, j);
    const thay = d.slice(j + 1);
    if (tep === "" || /^\/|\.\.|^[A-Za-z]:/.test(tep)) loi.push(`ĐỘT BIẾN "${d.slice(0, 60)}": đường tệp không hợp lệ`);
    else if (tim === "") loi.push(`ĐỘT BIẾN "${d.slice(0, 60)}": phần "tìm" rỗng`);
    else if (tim === thay) loi.push(`ĐỘT BIẾN "${d.slice(0, 60)}": "tìm" trùng "thay" (không đổi gì)`);
    else ds.push({ tep, tim, thay });
  }
  return { ds, loi };
}

/** Mỗi dòng là một chuỗi cấm; dạng /regex/flags được hiểu là biểu thức chính quy. */
export function docKhangDinhCam(tho: string): Array<string | RegExp> {
  const ra: Array<string | RegExp> = [];
  for (const d0 of tho.replace(/\r\n/g, "\n").split("\n")) {
    const d = d0.replace(/^\s*[-*]\s+/, "").trim();
    if (d === "") continue;
    const m = /^\/(.+)\/([a-z]*)$/.exec(d);
    if (m) {
      try {
        ra.push(new RegExp(m[1], m[2]));
        continue;
      } catch {
        /* không phải regex hợp lệ ⇒ coi là chuỗi */
      }
    }
    ra.push(d.replace(/^["'`]|["'`]$/g, ""));
  }
  return ra;
}

export interface KhangDinhCamTrung {
  dong: number;
  cam: string;
  trich: string;
}

/** Tách các câu `expect(`…`;` (đến `;` đầu tiên ở độ sâu ngoặc 0) kèm số dòng bắt đầu. */
export function tachCauExpect(nguon: string): Array<{ dong: number; text: string }> {
  const ra: Array<{ dong: number; text: string }> = [];
  const re = /\bexpect\s*(?:\.\w+)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nguon)) !== null) {
    let sau = m.index;
    let sau0 = 0;
    let q: string | null = null;
    for (; sau < nguon.length; sau++) {
      const c = nguon[sau];
      if (q) {
        if (c === "\\") sau++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "(" || c === "[" || c === "{") sau0++;
      else if (c === ")" || c === "]" || c === "}") sau0--;
      else if (c === ";" && sau0 <= 0) break;
    }
    const text = nguon.slice(m.index, Math.min(sau + 1, nguon.length));
    ra.push({ dong: nguon.slice(0, m.index).split("\n").length, text });
    re.lastIndex = m.index + 1;
  }
  return ra;
}

export function quetKhangDinhCam(nguon: string, cam: ReadonlyArray<string | RegExp>): KhangDinhCamTrung[] {
  const hits: KhangDinhCamTrung[] = [];
  if (cam.length === 0) return hits;
  for (const c of tachCauExpect(nguon)) {
    for (const x of cam) {
      const trung = typeof x === "string" ? c.text.includes(x) : new RegExp(x.source, x.flags.replace("g", "")).test(c.text);
      if (trung) hits.push({ dong: c.dong, cam: String(x), trich: c.text.replace(/\s+/g, " ").slice(0, 120) });
    }
  }
  return hits;
}

const RE_NGHI_NGO = /hiện\s*trạng|known\s*bug|ghi\s*lại|tạm\s*thời|current\s+behaviou?r|documents?\s+(?:the\s+)?bug/i;

export interface GhimNghiNgo {
  dong: number;
  trich: string;
}
/** Dòng nhắc "hiện trạng / known bug / ghi lại / tạm thời" trong tệp test: dấu hiệu model GHIM một lỗi của mã nguồn làm kỳ vọng. Chỉ cảnh báo. */
export function quetGhimNghiNgo(nguon: string): GhimNghiNgo[] {
  const ra: GhimNghiNgo[] = [];
  nguon.split("\n").forEach((d, i) => {
    if (RE_NGHI_NGO.test(d)) ra.push({ dong: i + 1, trich: d.trim().slice(0, 140) });
  });
  return ra;
}

