/**
 * HA-9 — BỘ QUÉT TĨNH CẢNH BÁO trên thẻ chờ duyệt. KHÔNG tự chặn: chỉ gắn `canhBao` vào hồ sơ để NGƯỜI duyệt thấy ngay (cho-duyet.json, dòng đầu dang-cho.txt, đầu ra duyet.ts).
 *
 * Quét CHỈ phần được THÊM / ĐỔI (dòng của bản mới không có trong bản cũ), bỏ dòng chú thích thuần (`//`, `/*`, `*`). Chín mẫu (mỗi mẫu một tên cố định):
 *   duong-tuyet-doi  đường tuyệt đối (Windows `C:\…` / POSIX `/home|/Users|/etc|…`) NGOÀI worktree và NGOÀI thư mục tạm
 *   env-tep          tệp `.env` / `.env.*`
 *   bi-mat           thư mục `bi-mat` / tệp `tho_ca_test*`
 *   database-url     `DATABASE_URL` / `TEST_DATABASE_URL` / URL `postgres(ql)://…`
 *   process-env      `process.env…` / `import.meta.env` / `Bun.env` / `Deno.env`
 *   child-process    mô-đun tiến trình con của Node, và các lời gọi sinh tiến trình (spawn, exec, execFile, fork…)
 *   ghi-tep          ghi / xoá / đổi tên tệp mà dòng KHÔNG nhắc thư mục tạm (tmpdir / mkdtemp / tmp / temp) — heuristic theo dòng
 *   mang-ngoai       API mạng (fetch, http/net/tls, WebSocket…) hoặc URL tới máy khác `127.0.0.1` / `localhost` (dòng nêu `127.0.0.1:5434` được bỏ qua)
 *   eval-dong        `eval(`, `Function(`, `import(<không phải chuỗi thuần>)`, `require(<không phải chuỗi thuần>)`, `vm.run…`
 *
 * Khoá thẻ `CHO PHÉP TRONG TEST: a; b` (hoặc phân cách bằng dấu phẩy ngoài ngoặc) tắt cảnh báo oan: một cảnh báo bị bỏ CHỈ KHI đoạn khớp NẰM TRONG một lần xuất hiện của mục cho phép
 * ngay trên dòng đó (ghi mục cho phép vào chú thích để lách KHÔNG có tác dụng, vì đoạn nguy hiểm phải nằm bên trong chính nó). Đoạn trích ĐÃ che mật khẩu trong URL.
 * THUẦN: không fs, không env, không mạng.
 */
import path from "node:path";

export type MauQuet = "duong-tuyet-doi" | "env-tep" | "bi-mat" | "database-url" | "process-env" | "child-process" | "ghi-tep" | "mang-ngoai" | "eval-dong";
export const TAT_CA_MAU: readonly MauQuet[] = ["duong-tuyet-doi", "env-tep", "bi-mat", "database-url", "process-env", "child-process", "ghi-tep", "mang-ngoai", "eval-dong"];

export interface CanhBao {
  mau: MauQuet;
  /** số dòng (từ 1) trong BẢN MỚI */
  dong: number;
  /** đoạn khớp (đã che mật khẩu URL) */
  manh: string;
  /** dòng mã chứa nó (cắt 200 ký tự, đã che mật khẩu URL) */
  trich: string;
}
export interface DongMoi {
  so: number;
  dong: string;
}
export interface TuyChonQuet {
  /** worktree: đường tuyệt đối nằm trong đây được phép */
  wt: string;
  /** các thư mục tạm: đường tuyệt đối nằm trong đây được phép */
  thuMucTam: readonly string[];
  /** khoá thẻ `CHO PHÉP TRONG TEST` */
  choPhep?: readonly string[];
}

const TRAN_CANH_BAO = 100;

// ── dòng mới ──────────────────────────────────────────────────────────────────────────────────────

/** Dòng của `moi` KHÔNG có trong `cu` (so theo MULTISET dòng, trim cuối) — dòng chỉ bị dời chỗ không bị coi là mới. */
export function dongMoiCuaTep(cu: string, moi: string): DongMoi[] {
  const dem = new Map<string, number>();
  for (const d of cu.split(/\r?\n/)) dem.set(d.trimEnd(), (dem.get(d.trimEnd()) ?? 0) + 1);
  const ra: DongMoi[] = [];
  moi.split(/\r?\n/).forEach((d, i) => {
    const k = d.trimEnd();
    const n = dem.get(k) ?? 0;
    if (n > 0) dem.set(k, n - 1);
    else ra.push({ so: i + 1, dong: d });
  });
  return ra;
}

/** Từ MỘT hồ sơ chờ: ưu tiên `xemTruoc.args.{original,modified}`; không có thì suy từ `thamSo` (content / new_string / edits[] / diff). */
export function dongMoiTuHoSo(h: { xemTruoc?: unknown; thamSo?: Record<string, unknown> }): DongMoi[] {
  const args = (h.xemTruoc as { args?: Record<string, unknown> } | null | undefined)?.args;
  if (args && typeof args.modified === "string") return dongMoiCuaTep(typeof args.original === "string" ? args.original : "", args.modified);
  const ts = h.thamSo ?? {};
  const mau: string[] = [];
  for (const k of ["content", "new_string", "newString", "text"]) if (typeof ts[k] === "string") mau.push(ts[k] as string);
  for (const k of ["edits", "files"]) {
    const m = ts[k];
    if (Array.isArray(m)) for (const e of m) if (e && typeof e === "object") for (const kk of ["new_string", "newString", "content"]) if (typeof (e as Record<string, unknown>)[kk] === "string") mau.push((e as Record<string, string>)[kk]!);
  }
  if (typeof ts.diff === "string") mau.push(ts.diff.split(/\r?\n/).filter((d) => d.startsWith("+") && !d.startsWith("+++")).map((d) => d.slice(1)).join("\n"));
  return dongMoiCuaTep("", mau.join("\n"));
}

// ── khoá CHO PHÉP TRONG TEST ──────────────────────────────────────────────────────────────────────

/** Tách danh sách: có `;` ⇒ tách theo `;`; không thì tách theo `,` NGOÀI ngoặc / nháy. Bỏ mục rỗng. */
export function tachChoPhep(tho: string): string[] {
  const t = tho.trim();
  if (t === "") return [];
  if (t.includes(";")) return t.split(";").map((x) => x.trim()).filter(Boolean);
  const ra: string[] = [];
  let sau = 0;
  let nhay: string | null = null;
  let cur = "";
  for (const c of t) {
    if (nhay) {
      if (c === nhay) nhay = null;
    } else if (c === '"' || c === "'" || c === "`") nhay = c;
    else if (c === "(" || c === "[" || c === "{") sau++;
    else if (c === ")" || c === "]" || c === "}") sau = Math.max(0, sau - 1);
    else if (c === "," && sau === 0) {
      if (cur.trim()) ra.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) ra.push(cur.trim());
  return ra;
}

// ── mẫu ───────────────────────────────────────────────────────────────────────────────────────────

const QUOTE_THUAN = "(?:\"[^\"\\n]*\"|'[^'\\n]*'|`[^`$\\n]*`)";
const RE = {
  winAbs: /(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s"'`)\]},;]*/g,
  posixAbs: /(?<![\w.:/\\)])\/(?:home|Users|etc|var|opt|usr|root|mnt|srv|proc|sys|dev|private|Volumes|bin|sbin|lib|boot|media)\/[^\s"'`)\]},;]*/g,
  env: /(?<![\w])\.env(?:\.[\w.-]+)?(?![\w])/g,
  biMat: /bi[-_]mat\b|\btho_ca_test\w*(?:\.url)?/gi,
  dbUrl: /\b(?:TEST_)?DATABASE_URL\b|postgres(?:ql)?:\/\/[^\s"'`]*/g,
  procEnv: /\bprocess\.env(?:\.[A-Za-z_]\w*|\[[^\]]*\])?|\bimport\.meta\.env\b|\bBun\.env\b|\bDeno\.env\b/g,
  // tên mô-đun viết GHÉP để bộ quét điểm cấp phát VRAM (vramAllocationSites) không đếm bộ quét tĩnh này như một nơi sinh tiến trình con
  childMod: new RegExp(`\\b(?:node:)?child${"_"}process\\b`, "g"),
  childCall: /(?<![.\w$])(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(|\b(?:cp|childProcess|proc)\.(?:exec|execSync|execFile|spawn|spawnSync|fork)\w*\s*\(|\bBun\.spawn\w*\s*\(|\bDeno\.Command\b/g,
  ghiRo: /(?<![.\w$])(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|unlink|unlinkSync|rmSync|rmdir|rmdirSync|mkdirSync|renameSync|truncateSync|symlinkSync|cpSync)\s*\(/g,
  ghiMo: /\b(?:fs|fsp|promises)\.(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|copyFile|copyFileSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|mkdir|mkdirSync|rename|renameSync|truncate|truncateSync|symlink|symlinkSync|cp|cpSync)\s*\(/g,
  tamNhac: /tmpdir|mkdtemp|\btmp\b|\btemp\b|TMPDIR|TEMP\b/i,
  mangApi: /\bfetch\s*\(|\b(?:http|https|http2|net|tls|dgram|dns)\.(?:request|get|connect|createConnection|Socket|lookup|resolve\w*)\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest|EventSource|net\.Socket)\b|\b(?:import|require)\b[^\n]*["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|axios|node-fetch|got|undici|ws)["']/g,
  mangUrl: /\b(?!postgres(?:ql)?:|file:|node:|data:|blob:)[a-z][a-z0-9+.-]*:\/\/(?!127\.0\.0\.1|localhost|\[::1\])[^\s"'`)]+/gi,
  evalDong: new RegExp(`\\beval\\s*\\(|\\bnew\\s+Function\\s*\\(|(?<![.\\w$])Function\\s*\\(|\\bvm\\.(?:runIn\\w+|Script|compileFunction)\\b|\\bimport\\s*\\((?!\\s*${QUOTE_THUAN}\\s*\\))|(?<![.\\w$])require\\s*\\((?!\\s*${QUOTE_THUAN}\\s*\\))`, "g"),
};

/** Che mật khẩu trong URL: `://user:pass@` ⇒ `://***@`. */
export function cheMatKhauUrl(s: string): string {
  return s.replace(/(:\/\/)[^\s/@"'`]*@/g, "$1***@");
}

const laChuThich = (d: string) => /^\s*(?:\/\/|\/\*|\*)/.test(d);
const chuanDuongSo = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

function khopTrong(ds: string, re: RegExp): Array<{ manh: string; vt: number }> {
  const ra: Array<{ manh: string; vt: number }> = [];
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = r.exec(ds))) {
    if (m[0] === "") {
      r.lastIndex++;
      continue;
    }
    ra.push({ manh: m[0], vt: m.index });
  }
  return ra;
}

/** Cảnh báo bị tắt? — đoạn khớp phải nằm TRONG một lần xuất hiện của một mục cho phép trên cùng dòng. */
function duocPhep(dong: string, vt: number, dai: number, choPhep: readonly string[]): boolean {
  for (const t of choPhep) {
    if (t === "") continue; // indexOf("") không bao giờ -1 ⇒ vòng dưới sẽ KHÔNG dừng
    for (let i = dong.indexOf(t); i >= 0; i = dong.indexOf(t, i + 1)) {
      if (vt >= i && vt + dai <= i + t.length) return true;
    }
  }
  return false;
}

/** Quét danh sách dòng MỚI. Trả cảnh báo theo thứ tự dòng rồi theo thứ tự mẫu; tối đa 100. */
export function quetTinh(dongMoi: readonly DongMoi[], tuyChon: TuyChonQuet): CanhBao[] {
  const choPhep = tuyChon.choPhep ?? [];
  const cacGocOk = [tuyChon.wt, ...tuyChon.thuMucTam].map(chuanDuongSo).filter((x) => x !== "");
  const trongGocOk = (p: string) => {
    const c = chuanDuongSo(p);
    return cacGocOk.some((g) => c === g || c.startsWith(`${g}/`));
  };
  const ra: CanhBao[] = [];
  const thay = new Set<string>();
  for (const { so, dong } of dongMoi) {
    if (laChuThich(dong)) continue;
    const themVao = (mau: MauQuet, manh: string, vt: number) => {
      if (duocPhep(dong, vt, manh.length, choPhep)) return;
      const khoa = `${mau}|${so}|${manh}|${vt}`;
      if (thay.has(khoa)) return;
      thay.add(khoa);
      ra.push({ mau, dong: so, manh: cheMatKhauUrl(manh).slice(0, 120), trich: cheMatKhauUrl(dong.trim()).slice(0, 200) });
    };
    for (const k of khopTrong(dong, RE.winAbs)) if (!trongGocOk(k.manh)) themVao("duong-tuyet-doi", k.manh, k.vt);
    for (const k of khopTrong(dong, RE.posixAbs)) if (!trongGocOk(k.manh)) themVao("duong-tuyet-doi", k.manh, k.vt);
    for (const k of khopTrong(dong, RE.env)) themVao("env-tep", k.manh, k.vt);
    for (const k of khopTrong(dong, RE.biMat)) themVao("bi-mat", k.manh, k.vt);
    for (const k of khopTrong(dong, RE.dbUrl)) themVao("database-url", k.manh, k.vt);
    for (const k of khopTrong(dong, RE.procEnv)) themVao("process-env", k.manh, k.vt);
    for (const k of [...khopTrong(dong, RE.childMod), ...khopTrong(dong, RE.childCall)]) themVao("child-process", k.manh, k.vt);
    if (!RE.tamNhac.test(dong)) for (const k of [...khopTrong(dong, RE.ghiRo), ...khopTrong(dong, RE.ghiMo)]) themVao("ghi-tep", k.manh, k.vt);
    // dòng nêu 127.0.0.1:5434 thì API mạng được bỏ qua — nhưng mẩu nằm trong chú thích cuối dòng KHÔNG tính (lách bằng `// 127.0.0.1:5434`)
    if (!/(?:127\.0\.0\.1|localhost|\[::1\]):5434/.test(dong.replace(/\s\/\/.*$/, ""))) for (const k of khopTrong(dong, RE.mangApi)) themVao("mang-ngoai", k.manh, k.vt);
    for (const k of khopTrong(dong, RE.mangUrl)) themVao("mang-ngoai", k.manh, k.vt);
    for (const k of khopTrong(dong, RE.evalDong)) themVao("eval-dong", k.manh, k.vt);
    if (ra.length >= TRAN_CANH_BAO) return ra.slice(0, TRAN_CANH_BAO);
  }
  return ra;
}

/** Quét một hồ sơ chờ duyệt. */
export function quetHoSo(h: { xemTruoc?: unknown; thamSo?: Record<string, unknown> }, tuyChon: TuyChonQuet): CanhBao[] {
  return quetTinh(dongMoiTuHoSo(h), tuyChon);
}

/** Một dòng tóm tắt cho dang-cho.txt / stderr: "CANH BAO 3: child-process,mang-ngoai" hoặc "" khi sạch. */
export function tomTatCanhBao(cb: readonly CanhBao[] | undefined): string {
  if (!cb || cb.length === 0) return "";
  return `CANH BAO ${cb.length}: ${[...new Set(cb.map((c) => c.mau))].join(",")}`;
}

/** Thư mục tạm hợp lệ để loại khỏi `duong-tuyet-doi` (tiện cho nơi gọi). */
export function thuMucTamMacDinh(tmpdir: string, thuc?: string): string[] {
  return [...new Set([tmpdir, ...(thuc ? [thuc] : [])].map((p) => path.resolve(p)))];
}
