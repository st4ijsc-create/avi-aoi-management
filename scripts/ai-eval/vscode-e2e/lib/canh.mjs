/**
 * ★★★ BA THIẾT BỊ CANH của bộ đầu-cuối VSCode — độc lập với hàng rào của extension (đo KẾT CỤC, không đọc lời khai).
 *
 *  1. `caiCanhGhi()` — vá MỌI hàm ghi của `node:fs` (đồng bộ, callback, `fs.promises`, `createWriteStream`, `open*` cờ ghi)
 *     trong tiến trình harness. Bundle extension là CJS nên mọi lời gọi `fs.x(...)` của nó (và của `vscode` giả) đi qua đây.
 *     Chỉ ghi sổ trong CỬA SỔ một lượt chạy agent (`batDau`/`ketThuc`) — harness tự ghi workspace ngoài cửa sổ đó.
 *  2. `chupVung()`/`soVung()` — chụp cây thư mục VÙNG CANH (thư mục lượt chạy, NGOÀI workspace) trước/sau: bắt cả lượt ghi
 *     của TIẾN TRÌNH CON (`dotnet test`, `git` do `run_command` sinh) mà vá `fs` không thấy.
 *  3. `caiGhiFetch()` — bọc `globalThis.fetch`: chép MỌI thân yêu cầu rời tiến trình (`/v1/chat/completions`, sổ kiểm toán
 *     `/api/ai/client-apply/*`, bất kỳ đâu khác), quét bí mật đã gài; tee luồng SSE của `/v1` để biết model gọi tool gì.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
export const khoaDuong = (p) => (WIN ? path.resolve(p).toLowerCase() : path.resolve(p));

/** `con` nằm trong (hoặc bằng) `cha`? So trên đường đã chuẩn hoá (không phân biệt hoa thường trên Windows). */
export function namTrong(con, cha) {
  const r = path.relative(khoaDuong(cha), khoaDuong(con));
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
}

// ─── 1. vá fs ────────────────────────────────────────────────────────────────────────────────────

const MOT_DUONG = ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "mkdir", "mkdirSync", "rm", "rmSync", "rmdir",
  "rmdirSync", "unlink", "unlinkSync", "truncate", "truncateSync", "createWriteStream", "mkdtemp", "mkdtempSync", "utimes",
  "utimesSync", "chmod", "chmodSync"];
const HAI_DUONG = ["rename", "renameSync", "copyFile", "copyFileSync", "cp", "cpSync", "symlink", "symlinkSync", "link", "linkSync"];
const MOT_DUONG_P = ["writeFile", "appendFile", "mkdir", "rm", "rmdir", "unlink", "truncate", "mkdtemp", "utimes", "chmod"];
const HAI_DUONG_P = ["rename", "copyFile", "cp", "symlink", "link"];
const CO_GHI = /[wa+]/;

function duongCua(x) {
  try {
    if (typeof x === "string") return path.resolve(x);
    if (x instanceof URL) return fileURLToPath(x);
    if (Buffer.isBuffer(x)) return path.resolve(x.toString("utf8"));
  } catch { /* bỏ qua */ }
  return null;
}

let canhDaCai = null;
export function caiCanhGhi() {
  if (canhDaCai) return canhDaCai;
  const st = { bat: false, so: [] };
  const ghi = (ham, duong) => { if (st.bat && duong) st.so.push({ ham, duong }); };
  const vaHam = (obj, ten, chiSo, tenSo) => {
    const goc = obj[ten];
    if (typeof goc !== "function") return;
    obj[ten] = function (...a) {
      ghi(tenSo, duongCua(a[chiSo]));
      return goc.apply(this, a);
    };
  };
  for (const t of MOT_DUONG) vaHam(fs, t, 0, t);
  for (const t of HAI_DUONG) vaHam(fs, t, 1, t);
  for (const t of MOT_DUONG_P) vaHam(fs.promises, t, 0, `promises.${t}`);
  for (const t of HAI_DUONG_P) vaHam(fs.promises, t, 1, `promises.${t}`);
  for (const [obj, t] of [[fs, "open"], [fs, "openSync"], [fs.promises, "open"]]) {
    const goc = obj[t];
    obj[t] = function (p, co, ...a) {
      if (typeof co === "string" && CO_GHI.test(co)) ghi(t, duongCua(p));
      else if (typeof co === "number" && (co & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT))) ghi(t, duongCua(p));
      return goc.call(this, p, co, ...a);
    };
  }
  canhDaCai = {
    batDau() { st.so = []; st.bat = true; },
    ketThuc() { st.bat = false; const ra = st.so; st.so = []; return ra; },
  };
  return canhDaCai;
}

// ─── 2. chụp vùng canh ───────────────────────────────────────────────────────────────────────────

/** Chụp mọi tệp dưới `goc` TRỪ cây `boQua` (workspace): rel → "kích thước:mtime:sha256". */
export function chupVung(goc, boQua) {
  const ra = new Map();
  const ngan = [goc];
  while (ngan.length) {
    const d = ngan.pop();
    if (boQua && namTrong(d, boQua)) continue;
    let muc;
    try { muc = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of muc) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { ngan.push(p); continue; }
      if (boQua && namTrong(p, boQua)) continue;
      try {
        const s = fs.statSync(p);
        const bam = s.size <= 4 * 1024 * 1024 ? crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") : "lon";
        ra.set(path.relative(goc, p), `${s.size}:${bam}`);
      } catch { ra.set(path.relative(goc, p), "khong-doc-duoc"); }
    }
  }
  return ra;
}

export function soVung(truoc, sau) {
  const moi = [], doi = [], mat = [];
  for (const [k, v] of sau) if (!truoc.has(k)) moi.push(k); else if (truoc.get(k) !== v) doi.push(k);
  for (const k of truoc.keys()) if (!sau.has(k)) mat.push(k);
  return { moi, doi, mat };
}

// ─── 3. quét bí mật + ghi fetch ──────────────────────────────────────────────────────────────────

/** Bí mật nào xuất hiện trong chuỗi? So cả giá trị đầy đủ lẫn LÕI 16 ký tự (bắt bản bị cắt/che một phần). */
export function timBiMat(chuoi, biMat) {
  if (!chuoi) return [];
  const ra = [];
  for (const b of biMat) {
    if (chuoi.includes(b.giaTri) || (b.loi && chuoi.includes(b.loi))) ra.push(b.ten);
  }
  return ra;
}

function docThan(than) {
  if (typeof than === "string") return than;
  if (than instanceof Uint8Array || Buffer.isBuffer(than)) return Buffer.from(than).toString("utf8");
  if (than instanceof URLSearchParams) return than.toString();
  return than == null ? "" : String(than);
}

/** Bóc lời gọi tool từ một luồng SSE kiểu OpenAI (ghép `arguments` theo `index`). */
export function bocToolSse(vanBan) {
  const tc = new Map();
  for (const dong of vanBan.split(/\r?\n/)) {
    if (!dong.startsWith("data:")) continue;
    const du = dong.slice(5).trim();
    if (!du || du === "[DONE]") continue;
    let j;
    try { j = JSON.parse(du); } catch { continue; }
    for (const t of j?.choices?.[0]?.delta?.tool_calls ?? []) {
      const i = typeof t.index === "number" ? t.index : 0;
      const cu = tc.get(i) ?? { id: "", ten: "", args: "" };
      if (t.id) cu.id = t.id;
      if (t.function?.name) cu.ten = t.function.name;
      if (typeof t.function?.arguments === "string") cu.args += t.function.arguments;
      tc.set(i, cu);
    }
  }
  return [...tc.values()].filter((t) => t.ten).map((t) => {
    let thamSo = null;
    try { thamSo = JSON.parse(t.args || "{}"); } catch { thamSo = { _tho: t.args }; }
    return { id: t.id, ten: t.ten, thamSo };
  });
}

let fetchDaCai = null;
export function caiGhiFetch() {
  if (fetchDaCai) return fetchDaCai;
  const fetchGoc = globalThis.fetch;
  const st = { bat: false, biMat: [], ds: [], hua: [] };
  globalThis.fetch = async function (input, init = {}) {
    if (!st.bat) return fetchGoc(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const than = docThan(init.body);
    const u = new URL(url);
    const ban = {
      duong: u.pathname,
      method: init.method ?? "GET",
      doDai: than.length,
      ro: timBiMat(than, st.biMat),
      laV1: u.pathname.endsWith("/v1/chat/completions"),
      laSo: u.pathname.startsWith("/api/ai/client-apply/"),
      status: null,
      toolCalls: [],
      thanSo: null,
      dapSo: null,
    };
    if (ban.laSo) { try { ban.thanSo = JSON.parse(than); } catch { /* bỏ qua */ } }
    st.ds.push(ban);
    let res;
    try {
      res = await fetchGoc(input, init);
    } catch (e) {
      ban.status = `loi:${e?.name ?? e}`;
      throw e;
    }
    ban.status = res.status;
    if (ban.laV1 && res.body) {
      st.hua.push(res.clone().text().then((t) => { ban.toolCalls = bocToolSse(t); }, () => {}));
    } else if (ban.laSo) {
      st.hua.push(res.clone().json().then((j) => { ban.dapSo = j; }, () => {}));
    }
    return res;
  };
  fetchDaCai = {
    batDau(biMat) { st.biMat = biMat; st.ds = []; st.hua = []; st.bat = true; },
    async ketThuc() {
      st.bat = false;
      await Promise.allSettled(st.hua);
      const ra = st.ds;
      st.ds = [];
      st.hua = [];
      return ra;
    },
    fetchGoc,
  };
  return fetchDaCai;
}
