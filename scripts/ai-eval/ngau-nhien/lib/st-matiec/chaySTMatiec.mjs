/**
 * ★★ Đợt 9 (2026-10-21) — BIÊN DỊCH + CHẠY ST bằng MATIEC (`iec2c`) ĐÚNG BẢN của OpenPLC v3 trên bench, trong Docker
 * (ảnh `st-openplc-matiec:b5d41356`, `--network none`). Cùng hợp đồng với `../st/chayST.mjs` (RuSTy) để bộ chấm chọn
 * trình dịch bằng `AI_EVAL_ST_TRINH_DICH=matiec`.
 *
 * Khác RuSTy — bộ chấm làm ADAPTER, ghi rõ ở đây vì nó chạm mã ứng viên:
 *  - `tests/kt.st` (RuSTy: printf/REF/VAR_GLOBAL) KHÔNG dùng — thay bằng `prelude-matiec.st` (cùng tên, cùng dòng in).
 *  - Tệp test: `FUNCTION main : DINT` → `PROGRAM KT_MAIN`; `main := KT_TONG();` → `KT_KQ := KT_TONG(FALSE);`.
 *  - `G_NOW` (đọc đồng hồ giả) → `KT_NOW(FALSE)` trong MỌI tệp (MATIEC không có VAR_GLOBAL ngoài CONFIGURATION).
 *  - `TIME_TO_LINT` / `LINT_TO_TIME` → bản NANO giây của prelude (đề bài hứa TIME = ns như RuSTy; MATIEC trả ms).
 *  - Đồng hồ: TON/TOF/TP CHUẨN của thư viện MATIEC (đúng cái OpenPLC chạy), chạy theo `__CURRENT_TIME` mà `KT_BUOC` tăng
 *    — KHÔNG phải bộ định thì của prelude RuSTy. `dongHo: "gia"` đổi kiểu TON/TOF/TP → KT_TON/KT_TOF/KT_TP (bản chép
 *    của prelude RuSTy) để TÁCH khác biệt trình dịch khỏi khác biệt ngữ nghĩa bộ định thì.
 *  - `cheDo: "noi"` (mặc định): thêm `;` sau END_IF/END_FOR/END_WHILE/END_CASE/END_REPEAT nếu thiếu (CODESYS/RuSTy cho bỏ,
 *    MATIEC/OpenPLC BẮT BUỘC — lỗi thường gặp nhất) để đo NGỮ NGHĨA trên runtime OpenPLC. `cheDo: "nghiem"`: không nới.
 *    Cả hai chế độ đều trả `openplcNghiem` = mã GỐC (không nới) có qua cờ OpenPLC hay không.
 * Pha A (cờ OpenPLC thật) chỉ có prelude + mã ứng viên ⇒ lỗi ở đây = OpenPLC cũng từ chối.
 *
 * Trả: { ok, giaiDoan: "bien-dich"|"chay"|"het-gio"|"ha-tang", pha?: "openplc"|"day-du"|"gcc", chanDoan, stdout, maThoat, ms }
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THU_MUC = path.dirname(fileURLToPath(import.meta.url));
export const ANH_MATIEC = process.env.AI_EVAL_ST_MATIEC_IMAGE?.trim() || "st-openplc-matiec:b5d41356";
const STDOUT_MAX = 64 * 1024;

// /w/kiem.st:12-5..12-9: error: msg   (iec2c -f)   ·   /w/kiem.st:12: error: msg
const RE_IEC2C = /^(?:\/w\/)?([\w.-]+\.st):(\d+)(?:-(\d+))?(?:\.\.[\d-]+)?:\s*(error|warning)\s*:\s*(.*)$/;

function docNeuCo(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function chayLenh(lenh, thamSo, tranMs) {
  return new Promise((res) => {
    const p = spawn(lenh, thamSo, { windowsHide: true });
    let so = "";
    let se = "";
    let biGiet = false;
    p.stdout.on("data", (d) => (so += d));
    p.stderr.on("data", (d) => (se += d));
    const t = setTimeout(() => {
      biGiet = true;
      p.kill("SIGKILL");
    }, tranMs);
    p.on("close", (ma) => {
      clearTimeout(t);
      res({ ma, so, se, biGiet });
    });
    p.on("error", (e) => {
      clearTimeout(t);
      res({ ma: -1, so, se: se + String(e), biGiet });
    });
  });
}

export async function coAnhMatiec() {
  const r = await chayLenh("docker", ["image", "inspect", ANH_MATIEC, "--format", "{{.Id}}"], 20_000);
  return r.ma === 0;
}

const laTepKt = (ten) => /(^|\/)kt\.st$/i.test(ten);
const laTepTest = (s) => /\bFUNCTION\s+main\s*:\s*DINT\b/i.test(s);

/** Nới: `;` sau từ khoá kết khối nếu thiếu. */
export function themChamPhay(s) {
  return s.replace(/\b(END_IF|END_FOR|END_WHILE|END_CASE|END_REPEAT)\b(?!\s*;)/gi, "$1;");
}

/** G_NOW (đọc) → KT_NOW(FALSE). */
export function doiGNow(s) {
  // + TIME_TO_LINT / LINT_TO_TIME → bản NANO giây của prelude (đề bài hứa TIME = ns như RuSTy; MATIEC trả ms).
  return s
    .replace(/\bG_NOW\b/gi, "KT_NOW(FALSE)")
    .replace(/(?<![.\w])(TIME_TO_LINT|LINT_TO_TIME)(?=\s*\()/gi, (m) => `KT_${m.toUpperCase()}`);
}

/** dongHo "gia": kiểu TON/TOF/TP (sau `:` hoặc `OF`) → bản chép prelude RuSTy. */
export function doiDongHoGia(s) {
  return s.replace(/(:|\bOF)(\s*)(TON|TOF|TP)\b/gi, (_, a, b, c) => `${a}${b}KT_${c.toUpperCase()}`);
}

/** Tách đối số MỨC NGOÀI của lời gọi bắt đầu ở `mo` (vị trí '('); trả { ds, het } (het = vị trí ')' khớp) hoặc null. */
function tachDoiSo(s, mo) {
  const ds = [];
  let sau = 0, dau = mo + 1;
  for (let i = mo + 1; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { // chuỗi ST: '' và $' là thoát
      for (i++; i < s.length && s[i] !== "'"; i++) if (s[i] === "$") i++;
    } else if (c === "(" && s[i + 1] === "*") { // chú thích (* … *)
      const k = s.indexOf("*)", i + 2);
      i = k < 0 ? s.length : k + 1;
    } else if (c === "(" || c === "[") sau++;
    else if ((c === ")" || c === "]") && sau > 0) sau--;
    else if (c === ")") { ds.push(s.slice(dau, i).trim()); return { ds, het: i }; }
    else if (c === "," && sau === 0) { ds.push(s.slice(dau, i).trim()); dau = i + 1; }
  }
  return null;
}

/**
 * MATIEC KHÔNG nới kiểu khi truyền đối số hàm (INT → DINT, REAL → LREAL là lỗi) và không có TO_DINT đa kiểu ⇒ KT_DINT /
 * KT_REAL / KT_TIME / KT_BOOL của tệp test đổi thành KT_XET(tên, <biểu thức so>) — phép so `=`/`<=` của MATIEC tự khớp
 * kiểu hằng. Cái giá: dòng TRUOT không in giá trị thực/mong (chỉ tên test).
 */
const KIEU_SO = new Set(["SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT", "REAL", "LREAL", "BYTE", "WORD", "DWORD", "LWORD"]);

/** Bảng kiểu tối thiểu: thành viên vào/ra của FB/FUNCTION (mã nguồn) + biến khai trong tệp test. */
export function bangKieu(cacTep) {
  const fb = {};
  const bien = {};
  const docKhai = (than, dich) => {
    for (const k of than.matchAll(/\bVAR(?:_INPUT|_OUTPUT|_IN_OUT)?\b([\s\S]*?)\bEND_VAR\b/gi)) {
      for (const d of k[1].replace(/\(\*[\s\S]*?\*\)/g, "").split(";")) {
        const i = d.indexOf(":");
        if (i < 0) continue;
        const kieu = d.slice(i + 1).split(":=")[0].trim().toUpperCase();
        for (const ten of d.slice(0, i).split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z_]\w*$/.test(x))) dich[ten] = kieu;
      }
    }
  };
  for (const s of cacTep) {
    for (const m of s.matchAll(/\bFUNCTION_BLOCK\s+(\w+)([\s\S]*?)\bEND_FUNCTION_BLOCK\b/gi)) docKhai(m[2], (fb[m[1].toUpperCase()] = {}));
    const main = /\bFUNCTION\s+main\s*:\s*DINT\b([\s\S]*?)\bEND_FUNCTION\b/i.exec(s);
    if (main) docKhai(main[1], bien);
  }
  const kieuCua = (e) => {
    e = e.trim().toUpperCase();
    let m;
    if ((m = /^(\w+)\s*\[[^\]]*\]$/.exec(e))) return /\bOF\s+(\w+)$/.exec(bien[m[1]] ?? "")?.[1] ?? null;
    if ((m = /^(\w+)\.(\w+)$/.exec(e))) return fb[bien[m[1]]]?.[m[2]] ?? null;
    if (/^[A-Z_]\w*$/.test(e)) return bien[e] ?? null;
    return null;
  };
  return { kieuCua };
}

export function doiLoiKiem(s, bang = null) {
  let ra = "";
  let i = 0;
  const re = /\bKT_(BOOL|DINT|REAL|TIME)\s*\(/gi;
  for (let m; (m = re.exec(s)); ) {
    const mo = m.index + m[0].length - 1;
    const t = tachDoiSo(s, mo);
    if (!t) continue;
    const [ten, thuc0, mong, saiSo] = t.ds;
    // Hai vế KHÁC kiểu số (vd INT với phần tử ARRAY OF DINT) ⇒ ép vế thực về kiểu vế mong — MATIEC không tự nới.
    const k1 = bang?.kieuCua(thuc0);
    const k2 = bang?.kieuCua(mong);
    const thuc = k1 && k2 && k1 !== k2 && KIEU_SO.has(k1) && KIEU_SO.has(k2) ? `${k1}_TO_${k2}(${thuc0})` : thuc0;
    const xet = m[1].toUpperCase() === "REAL" ? `ABS((${thuc}) - (${mong})) <= (${saiSo})` : `(${thuc}) = (${mong})`;
    ra += s.slice(i, m.index) + `KT_XET(${ten}, ${xet})`;
    i = t.het + 1;
    re.lastIndex = i;
  }
  return ra + s.slice(i);
}

// Tên POU / từ khoá của thư viện MATIEC: dùng làm TÊN BIẾN là lỗi cú pháp ("rs", "le", "dt"…), có khi báo ở POU khác.
const TEN_CAM_MATIEC = new Set(("ABS ACOS ADD AND ASIN ATAN CONCAT COS CTD CTU CTUD DELETE DERIVATIVE DIV EQ EXP EXPT FIND F_TRIG " +
  "GE GT HYSTERESIS INSERT INTEGRAL LE LEFT LEN LIMIT LN LOG LT MAX MID MIN MOD MOVE MUL MUX NE NOT OR PID RAMP REPLACE " +
  "RIGHT ROL ROR RS RTC R_TRIG SEL SEMA SHL SHR SIN SQRT SR SUB TAN TOF TON TP TRUNC XOR DT DATE TIME TOD EN ENO").split(" "));

/** Biến KHAI trong tệp TEST trùng tên cấm ⇒ đổi thành KTX_<tên> (IEC cấm hai gạch dưới liền) (chỉ tệp test — mã ứng viên giữ nguyên để bị chấm thật). */
export function doiTenBienTest(s) {
  const khai = new Set();
  for (const k of s.matchAll(/\bVAR(?:_INPUT|_OUTPUT|_IN_OUT)?\b([\s\S]*?)\bEND_VAR\b/gi)) {
    for (const d of k[1].replace(/\(\*[\s\S]*?\*\)/g, "").split(";")) {
      const tr = d.split(":")[0];
      if (!d.includes(":")) continue;
      for (const ten of tr.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z_]\w*$/.test(x))) {
        if (TEN_CAM_MATIEC.has(ten.toUpperCase())) khai.add(ten.toUpperCase());
      }
    }
  }
  for (const ten of khai) {
    const re = new RegExp(`(?<![.\\w])${ten}(?!\\w)`, "gi");
    s = s.replace(re, (m, viTri, toan) => {
      const truoc = toan.slice(0, viTri).trimEnd().slice(-1);
      if (truoc === ":" || /\bOF\s*$/i.test(toan.slice(0, viTri))) return m; // vị trí KIỂU (`rs : RS;`)
      return `KTX_${m}`;
    });
  }
  return s;
}

/** Tệp test RuSTy (`FUNCTION main : DINT … main := KT_TONG(); END_FUNCTION`) → PROGRAM KT_MAIN của MATIEC. */
export function chuyenTest(s, bang = null) {
  s = doiLoiKiem(doiTenBienTest(s), bang);
  const m = /\bFUNCTION\s+main\s*:\s*DINT\b/i.exec(s);
  if (!m) return s;
  const dau = s.slice(0, m.index);
  let than = s.slice(m.index + m[0].length);
  const ket = /\bEND_FUNCTION\b/i.exec(than);
  if (!ket) return s;
  const sau = than.slice(ket.index + ket[0].length);
  than = than.slice(0, ket.index).replace(/\bmain\s*:=\s*KT_TONG\s*\(\s*\)\s*;/gi, "KT_KQ := KT_TONG(FALSE);");
  // Biến kết quả vào khối VAR đầu tiên (giữ số dòng: chèn trên CÙNG dòng `VAR`).
  if (/^\s*VAR\s*$/im.test(than)) than = than.replace(/^(\s*VAR)\s*$/im, "$1 KT_KQ : DINT;");
  else than = " VAR KT_KQ : DINT; END_VAR" + than;
  return `${dau}PROGRAM KT_MAIN${than}END_PROGRAM${sau}`;
}

const CAU_HINH = `
CONFIGURATION KT_CFG
  RESOURCE KT_RES ON PLC
    TASK KT_TASK(INTERVAL := T#10ms, PRIORITY := 0);
    PROGRAM KT_INST WITH KT_TASK : KT_MAIN;
  END_RESOURCE
END_CONFIGURATION
`;

/** Ghép các phần thành MỘT tệp (iec2c nhận một tệp) + bảng dòng để đổi chẩn đoán về tệp gốc. */
function ghep(phan) {
  let dong = 1;
  const bang = [];
  let text = "";
  for (const p of phan) {
    const nd = p.noiDung.replace(/\r\n/g, "\n").replace(/\n?$/, "\n");
    bang.push({ ten: p.ten, tu: dong, den: dong + nd.split("\n").length - 2 });
    text += nd;
    dong += nd.split("\n").length - 1;
  }
  return { text, bang };
}

function phanTich(log, bang, tenTep) {
  const ra = [];
  const daThay = new Set();
  for (const dong of log.split(/\r?\n/)) {
    const m = RE_IEC2C.exec(dong.trim());
    if (!m || m[1] !== tenTep) continue;
    const so = Number(m[2]);
    const p = bang.find((b) => so >= b.tu && so <= b.den);
    const d = { tep: p?.ten ?? null, dong: p ? so - p.tu + 1 : so, cot: m[3] ? Number(m[3]) : null, mucDo: m[4], ma: null, thongDiep: m[5].trim() };
    const k = JSON.stringify(d);
    if (!daThay.has(k)) {
      daThay.add(k);
      ra.push(d);
    }
  }
  if (!ra.length) {
    const tho = log.split(/\r?\n/).filter((l) => /error|Bailing/i.test(l)).slice(0, 10);
    for (const l of tho) ra.push({ tep: null, dong: null, cot: null, mucDo: "error", ma: null, thongDiep: l.trim() });
  }
  return ra;
}

/**
 * @param {{ tep: {ten: string, duong: string}[], thuMucViec: string, giayChay?: number, giayBienDich?: number, dongHo?: "chuan"|"gia" }} y
 */
export async function chaySTMatiec({
  tep, thuMucViec, giayChay = 10, giayBienDich = 60,
  dongHo = process.env.AI_EVAL_ST_DONG_HO || "chuan", cheDo = process.env.AI_EVAL_ST_MATIEC_CHE_DO || "noi",
}) {
  const t0 = Date.now();
  fs.mkdirSync(thuMucViec, { recursive: true });
  const viec = fs.mkdtempSync(path.join(thuMucViec, "stm-"));
  const doc = (p) => fs.readFileSync(p, "utf8");
  const bienDoiGoc = (s) => (dongHo === "gia" ? doiDongHoGia(doiGNow(s)) : doiGNow(s));
  const bienDoi = (s) => (cheDo === "nghiem" ? bienDoiGoc(s) : themChamPhay(bienDoiGoc(s)));
  let kq;
  try {
    const prelude = [{ ten: "prelude-matiec.st", noiDung: doc(path.join(THU_MUC, "prelude-matiec.st")) }];
    if (dongHo === "gia") prelude.push({ ten: "dong-ho-gia-matiec.st", noiDung: doc(path.join(THU_MUC, "dong-ho-gia-matiec.st")) });
    const nguon = [];
    const nguonGoc = [];
    const test = [];
    const tho = tep.filter((t) => !laTepKt(t.ten)).map((t) => ({ ten: t.ten, nd: doc(t.duong) }));
    const bang = bangKieu(tho.map((t) => t.nd));
    for (const t of tho) {
      if (laTepTest(t.nd)) test.push({ ten: t.ten, noiDung: chuyenTest(bienDoi(t.nd), bang) });
      else {
        nguon.push({ ten: t.ten, noiDung: bienDoi(t.nd) });
        nguonGoc.push({ ten: t.ten, noiDung: bienDoiGoc(t.nd) });
      }
    }
    const A = ghep([...prelude, ...nguon]);
    const A0 = ghep([...prelude, ...nguonGoc]);
    const B = ghep([...prelude, ...nguon, ...test, ...(test.length ? [{ ten: "<cau-hinh>", noiDung: CAU_HINH }] : [])]);
    const lf = (s) => s.replace(/\r\n/g, "\n");
    fs.writeFileSync(path.join(viec, "kiem.st"), A.text);
    fs.writeFileSync(path.join(viec, "kiem-nghiem.st"), A0.text);
    fs.writeFileSync(path.join(viec, "day-du.st"), B.text);
    fs.writeFileSync(path.join(viec, "main.c"), lf(doc(path.join(THU_MUC, "main.c"))));
    fs.writeFileSync(path.join(viec, "run-job.sh"), lf(doc(path.join(THU_MUC, "run-job.sh"))));
    const tenCt = `cham-stm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await chayLenh(
      "docker",
      ["run", "--rm", "--pull", "never", "--name", tenCt, "--network", "none", "--memory", "512m", "--pids-limit", "128",
        "--cpus", "2", "-e", `CT=${giayBienDich}`, "-e", `RT=${giayChay}`, "-v", `${viec}:/w`, ANH_MATIEC, "bash", "/w/run-job.sh"],
      (2 * giayBienDich + giayChay + 30) * 1000,
    );
    if (r.biGiet) await chayLenh("docker", ["rm", "-f", tenCt], 10_000);
    const rc = (f) => docNeuCo(path.join(viec, f)).trim();
    let stdout = docNeuCo(path.join(viec, "run.out"));
    if (stdout.length > STDOUT_MAX) stdout = stdout.slice(0, STDOUT_MAX) + "\n...[cắt bớt]";
    const ms = Date.now() - t0;
    const openplcNghiem = rc("nghiem.rc") === "0";
    const chanDoanNghiem = openplcNghiem ? [] : phanTich(docNeuCo(path.join(viec, "nghiem.log")), A0.bang, "kiem-nghiem.st");
    const hetGio = (c) => c === "124" || c === "137";
    if (r.biGiet || [rc("kiem.rc"), rc("compile.rc"), rc("gcc.rc")].some(hetGio)) {
      kq = { ok: false, giaiDoan: "het-gio", chanDoan: [], stdout, maThoat: -1, ms };
    } else if (rc("kiem.rc") === "") {
      kq = { ok: false, giaiDoan: "ha-tang", chanDoan: [{ tep: null, dong: null, thongDiep: `lỗi hạ tầng docker: ${(r.se || r.so).trim().slice(0, 2000)}` }], stdout: "", maThoat: -1, ms };
    } else if (rc("kiem.rc") !== "0") {
      kq = { ok: false, giaiDoan: "bien-dich", pha: "openplc", chanDoan: phanTich(docNeuCo(path.join(viec, "kiem.log")), A.bang, "kiem.st"), stdout: "", maThoat: Number(rc("kiem.rc")), ms };
    } else if (!test.length) {
      kq = { ok: true, giaiDoan: "bien-dich", pha: "openplc", chanDoan: [], stdout: "", maThoat: 0, ms }; // chỉ kiểm biên dịch
    } else if (rc("compile.rc") !== "0") {
      kq = { ok: false, giaiDoan: "bien-dich", pha: "day-du", chanDoan: phanTich(docNeuCo(path.join(viec, "compile.log")), B.bang, "day-du.st"), stdout: "", maThoat: Number(rc("compile.rc")), ms };
    } else if (rc("gcc.rc") !== "0") {
      const g = docNeuCo(path.join(viec, "gcc.log"));
      kq = { ok: false, giaiDoan: "bien-dich", pha: "gcc", chanDoan: g.split("\n").filter((l) => /error/.test(l)).slice(0, 15).map((l) => ({ tep: null, dong: null, cot: null, mucDo: "error", ma: null, thongDiep: `gcc: ${l.trim()}` })), stdout: "", maThoat: Number(rc("gcc.rc")), ms };
    } else if (hetGio(rc("run.rc"))) {
      kq = { ok: false, giaiDoan: "het-gio", chanDoan: [], stdout, maThoat: -1, ms };
    } else {
      const ma = Number(rc("run.rc") === "" ? -1 : rc("run.rc"));
      kq = { ok: ma === 0, giaiDoan: "chay", chanDoan: [], stdout, maThoat: ma, ms };
    }
    Object.assign(kq, { openplcNghiem, chanDoanNghiem, trinhDich: "matiec", dongHo, cheDo });
  } finally {
    try {
      fs.rmSync(viec, { recursive: true, force: true });
    } catch {
      /* Windows giữ handle */
    }
  }
  return kq;
}

const TAP_OPENPLC = JSON.parse(fs.readFileSync(path.join(THU_MUC, "tap-openplc.json"), "utf8"));

/** Lý do bài `id` NẰM NGOÀI tập OpenPLC (giao diện/runtime không mang sang được), hoặc null. */
export function lyDoNgoaiTapOpenplc(id, dongHo = process.env.AI_EVAL_ST_DONG_HO || "chuan") {
  return TAP_OPENPLC.ngoaiTap[id] ?? (dongHo === "chuan" ? TAP_OPENPLC.ngoaiTapKhiDongHoChuan?.[id] : null) ?? null;
}
