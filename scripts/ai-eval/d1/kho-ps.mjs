#!/usr/bin/env node
/**
 * Lô D1-script — CHẠY KHÔ các script quản trị llama-server trên exe GIẢ, cổng GIẢ, tệp tạm dừng GIẢ. KHÔNG chạm :8091 / llama thật.
 *
 *   node scripts/ai-eval/d1/kho-ps.mjs --ra <tệp.jsonl> [--ca doi-chung-mac-dinh]
 *
 * Cách ly (mọi ca):
 * - Thư mục tạm D = mkdtemp riêng. exe giả `D/bin/llama-gia.exe` biên dịch tại chỗ (Add-Type, C#; nghe TCP loopback theo --port,
 *   trả HTTP theo LLAMA_GIA_CHE_DO = song | cham | thoat | khong-nghe | nhan-doi). Tên tiến trình `llama-gia`, KHÔNG phải `llama-server`.
 * - Cổng: cổng loopback NGẪU NHIÊN còn trống (≠ 8091, kiểm). Tệp tạm dừng: D/pause (truyền tường minh -TepTamDung).
 * - Env tiến trình con: bỏ mọi biến LLAMA_* / GGUF_* / AI_*, TEMP = TMP = D (đường mặc định %TEMP%\llama-watchdog.pause cũng rơi vào D),
 *   6 cờ luật A = false. Không nạp .env.
 * - Dọn: CHỈ dừng tiến trình có ExecutablePath nằm DƯỚI D (thư mục mkdtemp của chính lượt này). Không Stop-Process theo tên.
 * - Kiểm toàn cục trước / sau MỖI ca: tiến trình `llama-server` thật (PID + CreationDate) và chủ cổng 8091 không đổi. Lệch ⇒ dừng lượt.
 * - Ca `doi-chung-mac-dinh` (khoi-llama-tay MẶC ĐỊNH + -ChiKiem ⇒ kỳ vọng 6): KHÔNG chạy trừ khi có `--ca doi-chung-mac-dinh`
 *   (HST 19/11 13:11 (5): chưa chạy trước khi HST đọc cách dựng). -ChiKiem thoát trước Start-Process ⇒ chốt hỏng cũng không khởi gì.
 * Không in khoá: ca có khoá dùng tệp khoá GIẢ trong D; chỉ kiểm CÓ/KHÔNG `--api-key-file` trên dòng lệnh của exe giả.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GOC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const KHOI_TAY = path.join(GOC, "scripts/ai/khoi-llama-tay.ps1");
const DOI_MODEL = path.join(GOC, "scripts/ai-eval/codegen-chay-duoc/doi-model.ps1");
const START = path.join(GOC, "scripts/ai/start-llama-server.ps1");
const TIM_MMPROJ = path.join(GOC, "scripts/ai/tim-mmproj.ps1");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RA = arg("ra", "");
const CA_RIENG = arg("ca", "");
if (!RA) { console.error("thiếu --ra <tệp.jsonl>"); process.exit(2); }

const D = fs.mkdtempSync(path.join(os.tmpdir(), "kho-ps-"));
const BIN = path.join(D, "bin", "llama-gia.exe");
const BIN_KHAC = path.join(D, "khac", "llama-gia.exe");
const TEP_DUNG = path.join(D, "pause");
const LOG = path.join(D, "log");
const MODEL = path.join(D, "Gia-Q4_K_M.gguf");
const TEP_KHOA = path.join(D, "khoa-gia.key");
const CO_A = ["ROBOT_CONTROL_ENABLED", "OT_CONTROL_ENABLED", "FOE_ENABLED", "FOE_DURABLE", "OT_GATEWAY_ENABLED", "ROBOT_GATEWAY_ENABLED"];

function envCon(them = {}) {
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(LLAMA_|GGUF_|AI_)/i.test(k)) e[k] = v;
  for (const k of CO_A) e[k] = "false";
  e.TEMP = D; e.TMP = D;
  return { ...e, ...them };
}
const ps = (lenh) => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", lenh], { encoding: "utf8", env: envCon(), windowsHide: true, timeout: 60_000 });
const psJson = (lenh) => { const r = ps(`${lenh} | ConvertTo-Json -Compress -Depth 3`); try { return JSON.parse(r.stdout || "null"); } catch { return null; } };

/** Danh tính llama-server THẬT + chủ cổng 8091: chỉ ĐỌC. */
function chupThat() {
  const ds = psJson("@(Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | ForEach-Object { [pscustomobject]@{ id = $_.ProcessId; tao = $_.CreationDate.ToString('o') } })");
  const chu = psJson("@(Get-NetTCPConnection -LocalPort 8091 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)");
  return JSON.stringify({ llama: [ds ?? []].flat().sort((a, b) => a.id - b.id), chu8091: [chu ?? []].flat().sort() });
}
/** Tiến trình có ExecutablePath dưới D (chỉ của lượt này). */
function giaCuaD() {
  const ds = psJson(`@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${D.replace(/'/g, "''")}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { [pscustomobject]@{ id = $_.ProcessId; exe = $_.ExecutablePath; cl = $_.CommandLine } })`);
  return [ds ?? []].flat();
}
function donGia() {
  for (const g of giaCuaD()) ps(`$c = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(g.id)}"; if ($c -and $c.ExecutablePath -and $c.ExecutablePath.StartsWith('${D.replace(/'/g, "''")}', [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id ${Number(g.id)} -Force }`);
}
async function congTrong() {
  for (;;) {
    const p = await new Promise((ok) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const c = s.address().port; s.close(() => ok(c)); }); });
    if (p !== 8091) return p;
  }
}
const ngu = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function choCong(cong, coNghe, giay = 15) {
  for (let i = 0; i < giay * 4; i++) {
    const nghe = await new Promise((ok) => { const s = net.connect(cong, "127.0.0.1"); s.on("connect", () => { s.destroy(); ok(true); }); s.on("error", () => ok(false)); });
    if (nghe === coNghe) return true;
    await ngu(250);
  }
  return false;
}
/** Khởi exe giả do CHÍNH ca tạo (không qua script). */
function khoiGia(exe, cheDo, cong, them = {}) {
  const c = spawn(exe, ["--port", String(cong)], { env: envCon({ LLAMA_GIA_CHE_DO: cheDo, ...them }), detached: true, stdio: "ignore", windowsHide: true });
  c.unref();
  return c.pid;
}
const chayPs = (tep, thamSo, them = {}) => {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tep, ...thamSo], { encoding: "utf8", env: envCon(them), cwd: D, windowsHide: true, timeout: 180_000 });
  return { ma: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
};
const coTep = (p) => fs.existsSync(p);

// ── Dựng exe giả (C#, .NET Framework qua Add-Type) ────────────────────────────────────────────────────────────────────────────
const NGUON_CS = `using System; using System.Diagnostics; using System.Net; using System.Net.Sockets; using System.Text; using System.Threading;
public static class LlamaGia { public static int Main(string[] a) {
  string cd = Environment.GetEnvironmentVariable("LLAMA_GIA_CHE_DO") ?? "song"; int cong = 0;
  for (int i = 0; i < a.Length - 1; i++) if (a[i] == "--port") int.TryParse(a[i + 1], out cong);
  int c2; string ep = Environment.GetEnvironmentVariable("LLAMA_GIA_CONG"); if (ep != null && int.TryParse(ep, out c2)) cong = c2;
  if (cd == "thoat") return 3;
  if (cd == "khong-nghe") { Thread.Sleep(Timeout.Infinite); return 0; }
  if (cd == "nhan-doi") { var p = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--con-khong-nghe"); p.UseShellExecute = false; p.EnvironmentVariables["LLAMA_GIA_CHE_DO"] = "khong-nghe"; Process.Start(p); }
  var l = new TcpListener(IPAddress.Loopback, cong); l.Start();
  while (true) { using (var c = l.AcceptTcpClient()) { var s = c.GetStream(); s.ReadTimeout = 2000; var b = new byte[8192]; try { s.Read(b, 0, b.Length); } catch { }
    string than = cd == "cham" ? "{\\"error\\":\\"loading\\"}" : "{\\"status\\":\\"ok\\"}"; string tt = cd == "cham" ? "503 Service Unavailable" : "200 OK";
    var r = Encoding.ASCII.GetBytes("HTTP/1.1 " + tt + "\\r\\nContent-Type: application/json\\r\\nContent-Length: " + than.Length + "\\r\\nConnection: close\\r\\n\\r\\n" + than); s.Write(r, 0, r.Length); } }
} }`;
fs.mkdirSync(path.dirname(BIN), { recursive: true });
fs.mkdirSync(path.dirname(BIN_KHAC), { recursive: true });
fs.writeFileSync(path.join(D, "gia.cs"), NGUON_CS);
const dung = ps(`Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${path.join(D, "gia.cs")}') -OutputAssembly '${BIN}' -OutputType ConsoleApplication`);
if (!coTep(BIN)) { console.error(`không dựng được exe giả: ${dung.stderr}`); process.exit(2); }
fs.copyFileSync(BIN, BIN_KHAC);
fs.writeFileSync(MODEL, "");
fs.writeFileSync(TEP_KHOA, `khoa-gia-${Math.random().toString(16).slice(2)}\n`);

// ── Ca ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Mỗi ca: dung() dựng tiền cảnh, chay() trả {ma,out}, kyVong: { ma, pause: "co"|"khong", giaSong: số exe giả còn sống SAU lệnh,
// (tuỳ) dongLenhCo: chuỗi phải có trên dòng lệnh exe giả }. Kỳ vọng ghi TRƯỚC khi chạy.
const tay = (cong, them = [], env = {}) => chayPs(KHOI_TAY, ["-ArgStr", `--port ${cong}`, "-Ten", "gia", "-Exe", BIN, "-Cong", String(cong), "-TepTamDung", TEP_DUNG, "-ThuMucLog", LOG, "-ChoGiay", "6", ...them], env);
const doi = (cong, them = [], env = {}) => chayPs(DOI_MODEL, ["-Model", MODEL, "-Exe", BIN, "-Cong", String(cong), "-TepTamDung", TEP_DUNG, "-ThuMucLog", LOG, "-ChoGiay", "6", "-Mmproj", "off", ...them], env);
const khoaKhac = () => fs.writeFileSync(TEP_DUNG, JSON.stringify({ chu: "nguoi-khac", lyDo: "kho-ps", hetHan: new Date(Date.now() + 600_000).toISOString() }));

const CA = [
  { ten: "tay-6-co-gia-nghe", dung: async (c) => { khoiGia(BIN, "song", c); await choCong(c, true); }, chay: (c) => tay(c), kyVong: { ma: 6, pause: "khong", giaSong: 1 } },
  { ten: "tay-7-pause-co", dung: async () => fs.writeFileSync(TEP_DUNG, "nguoi-khac"), chay: (c) => tay(c), kyVong: { ma: 7, pause: "co", giaSong: 0 } },
  { ten: "tay-2-khai-khoa-thieu-co", chay: (c) => tay(c, [], { LLAMA_SERVER_API_KEY_FILE: TEP_KHOA }), kyVong: { ma: 2, pause: "khong", giaSong: 0 } },
  { ten: "tay-4-thoat-som", chay: (c) => tay(c, [], { LLAMA_GIA_CHE_DO: "thoat" }), kyVong: { ma: 4, pause: "khong", giaSong: 0 } },
  { ten: "tay-8-hai-tien-trinh", chay: (c) => tay(c, [], { LLAMA_GIA_CHE_DO: "nhan-doi" }), kyVong: { ma: 8, pause: "khong", giaSong: 2 } },
  { ten: "tay-5-het-gio", chay: (c) => tay(c, [], { LLAMA_GIA_CHE_DO: "cham" }), kyVong: { ma: 5, pause: "co", giaSong: 1 } },
  { ten: "tay-0-san-sang", chay: (c) => tay(c, [], { LLAMA_GIA_CHE_DO: "song" }), kyVong: { ma: 0, pause: "khong", giaSong: 1 } },
  { ten: "doi-2-khong-model", chay: (c) => chayPs(DOI_MODEL, ["-Model", path.join(D, "khong-co.gguf"), "-Exe", BIN, "-Cong", String(c), "-TepTamDung", TEP_DUNG, "-ThuMucLog", LOG]), kyVong: { ma: 2, pause: "khong", giaSong: 0 } },
  { ten: "doi-2-tep-khoa-khong-co", chay: (c) => doi(c, [], { LLAMA_SERVER_API_KEY_FILE: path.join(D, "khong-co.key") }), kyVong: { ma: 2, pause: "khong", giaSong: 0 } },
  { ten: "doi-3-khoa-khe-chu-khac", dung: async () => khoaKhac(), chay: (c) => doi(c), kyVong: { ma: 3, pause: "co", giaSong: 0 } },
  { ten: "doi-9-chu-cong-exe-khac-duong", dung: async (c) => { khoiGia(BIN_KHAC, "song", c); await choCong(c, true); }, chay: (c) => doi(c), kyVong: { ma: 9, pause: "khong", giaSong: 1 } },
  // đúng exe, nghe cổng c (LLAMA_GIA_CONG) nhưng dòng lệnh mang --port KHÁC c ⇒ không đủ điều kiện "--port c".
  { ten: "doi-9-dung-exe-sai-port", dung: async (c) => { khoiGia(BIN, "song", c === 65535 ? c - 1 : c + 1, { LLAMA_GIA_CONG: String(c) }); await choCong(c, true); },
    chay: (c) => doi(c), kyVong: { ma: 9, pause: "khong", giaSong: 1 } },
  { ten: "doi-9-cung-ten-khong-nghe", dung: async () => { khoiGia(BIN, "khong-nghe", 9); await ngu(800); }, chay: (c) => doi(c), kyVong: { ma: 9, pause: "khong", giaSong: 1 } },
  { ten: "doi-4-thoat-som", chay: (c) => doi(c, [], { LLAMA_GIA_CHE_DO: "thoat" }), kyVong: { ma: 4, pause: "khong", giaSong: 0 } },
  { ten: "doi-5-het-gio", chay: (c) => doi(c, [], { LLAMA_GIA_CHE_DO: "cham" }), kyVong: { ma: 5, pause: "co", giaSong: 1 } },
  { ten: "doi-0-cong-trong-co-khoa", chay: (c) => doi(c, [], { LLAMA_GIA_CHE_DO: "song", LLAMA_SERVER_API_KEY_FILE: TEP_KHOA }),
    kyVong: { ma: 0, pause: "khong", giaSong: 1, dongLenhCo: "--api-key-file" } },
  { ten: "doi-0-dung-dung-chu-roi-khoi", dung: async (c) => { khoiGia(BIN, "song", c); await choCong(c, true); }, chay: (c) => doi(c, [], { LLAMA_GIA_CHE_DO: "song" }),
    kyVong: { ma: 0, pause: "khong", giaSong: 1, chuCuBiDung: true } },
  // start-llama-server -Force (HST 13:34): ba ca âm ⇒ exit 3 + chủ cổng còn sống; một ca dương ⇒ dừng ĐÚNG PID chủ cổng rồi khởi.
  // PID 0 / ExecutablePath rỗng / CIM lỗi KHÔNG dựng được bằng tiến trình thật ⇒ chỉ đọc mã (giới hạn có tên).
  { ten: "force-3-exe-khac-duong", dung: async (c) => { khoiGia(BIN_KHAC, "song", c); await choCong(c, true); }, chay: (c) => force(c), kyVong: { ma: 3, pause: "khong", giaSong: 1 } },
  { ten: "force-3-dung-exe-sai-port", dung: async (c) => { khoiGia(BIN, "song", c === 65535 ? c - 1 : c + 1, { LLAMA_GIA_CONG: String(c) }); await choCong(c, true); },
    chay: (c) => force(c), kyVong: { ma: 3, pause: "khong", giaSong: 1 } },
  { ten: "force-3-chu-khong-phai-llama", dung: async (c) => { conNode.push(khoiNodeNghe(c)); await choCong(c, true); }, chay: (c) => force(c),
    kyVong: { ma: 3, pause: "khong", giaSong: 0, nodeSong: true } },
  { ten: "force-0-dung-dung-chu-roi-khoi", dung: async (c) => { khoiGia(BIN, "song", c); await choCong(c, true); }, chay: (c) => force(c, { LLAMA_GIA_CHE_DO: "song" }),
    kyVong: { ma: 0, pause: "khong", giaSong: 1, chuCuBiDung: true } },
];
/** start-llama-server -Force trên bản chép trong D (log rơi vào D), .env tạm trỏ exe giả + cổng giả. */
/** Chủ cổng KHÔNG phải llama: node nghe cổng c. Dọn bằng handle con (của chính ca), không theo tên. */
const conNode = [];
function khoiNodeNghe(c) {
  return spawn(process.execPath, ["-e", `require("net").createServer(()=>{}).listen(${Number(c)},"127.0.0.1")`], { env: envCon(), stdio: "ignore", windowsHide: true });
}
function force(c, them = {}) {
  const cay = path.join(D, "repo", "scripts", "ai");
  fs.mkdirSync(cay, { recursive: true });
  fs.copyFileSync(START, path.join(cay, "start-llama-server.ps1"));
  fs.copyFileSync(TIM_MMPROJ, path.join(cay, "tim-mmproj.ps1"));
  const env = path.join(D, "force.env");
  fs.writeFileSync(env, [`GGUF_MODELS_DIR=${D}`, `LLAMA_SERVER_MODEL=${path.basename(MODEL)}`, `LLAMA_SERVER_URL=http://127.0.0.1:${c}`, `LLAMA_SERVER_BIN=${BIN}`,
    `LLAMA_SERVER_SELECTION_FILE=${path.join(D, "khong-co.json")}`, "LLAMA_SERVER_MMPROJ=off"].join("\n"));
  return chayPs(path.join(cay, "start-llama-server.ps1"), ["-EnvFile", env, "-Force", "-WaitSeconds", "6"], them);
}
if (CA_RIENG === "doi-chung-mac-dinh") {
  CA.length = 0;
  CA.push({ ten: "doi-chung-mac-dinh", chay: () => chayPs(KHOI_TAY, ["-ArgStr", "--khong-dung", "-Ten", "doi-chung", "-ChiKiem"]), kyVong: { ma: 6, pause: "khong", giaSong: 0 } });
}

// ── Chạy ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ra = fs.openSync(RA, "a");
const ghi = (o) => fs.writeSync(ra, JSON.stringify(o) + "\n");
const that0 = chupThat();
ghi({ luc: new Date().toISOString(), D, that: JSON.parse(that0) });
let dat = 0, truot = 0;
try {
  for (const ca of CA) {
    const cong = await congTrong();
    for (const t of [TEP_DUNG]) fs.rmSync(t, { force: true });
    if (ca.dung) await ca.dung(cong);
    const truoc = giaCuaD().map((g) => g.id);
    const t0 = Date.now();
    const { ma, out } = ca.chay(cong);
    await ngu(500);
    const sau = giaCuaD();
    const pause = coTep(TEP_DUNG) ? "co" : "khong";
    const kv = ca.kyVong;
    const loi = [];
    if (ma !== kv.ma) loi.push(`ma ${ma} != ${kv.ma}`);
    if (pause !== kv.pause) loi.push(`pause ${pause} != ${kv.pause}`);
    if (sau.length !== kv.giaSong) loi.push(`gia song ${sau.length} != ${kv.giaSong}`);
    if (kv.dongLenhCo && !sau.some((g) => String(g.cl ?? "").includes(kv.dongLenhCo))) loi.push(`dong lenh thieu ${kv.dongLenhCo}`);
    if (kv.chuCuBiDung && truoc.some((id) => sau.some((g) => g.id === id))) loi.push("chu cong cu KHONG bi dung");
    if (kv.nodeSong && !conNode.some((n) => n.exitCode === null && n.signalCode === null)) loi.push("chu cong node KHONG con song");
    if (!kv.chuCuBiDung && truoc.some((id) => !sau.some((g) => g.id === id)) && kv.ma !== 0) loi.push("tien trinh co truoc bi DUNG");
    const that = chupThat();
    if (that !== that0) loi.push("LLAMA THAT / CHU 8091 DOI");
    ghi({ ca: ca.ten, cong, ma, kyVong: kv, pause, giaSong: sau.length, ms: Date.now() - t0, dat: loi.length === 0, loi, out: out.slice(-1500) });
    console.log(`${loi.length ? "TRUOT" : "DAT  "} ${ca.ten} ma=${ma} pause=${pause} gia=${sau.length}${loi.length ? " · " + loi.join(" · ") : ""}`);
    loi.length ? truot++ : dat++;
    donGia();
    for (const n of conNode.splice(0)) n.kill();
    await ngu(300);
    fs.rmSync(TEP_DUNG, { force: true });
    if (that !== that0) { console.error("⛔ llama-server THẬT / chủ 8091 đổi — DỪNG lượt"); break; }
  }
} finally {
  donGia();
  for (const n of conNode.splice(0)) n.kill();
  const conLai = giaCuaD().length;
  ghi({ ket: { dat, truot, conLaiDuoiD: conLai, thatCuoi: JSON.parse(chupThat()) } });
  fs.closeSync(ra);
  console.log(`KET: dat ${dat} · truot ${truot} · exe gia con lai ${conLai} · D=${D}`);
  process.exitCode = truot || conLai ? 1 : 0;
}
