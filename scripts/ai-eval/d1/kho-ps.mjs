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
function khoiGia(exe, cheDo, cong, them = {}, thamThem = []) { // D1b M5: thamThem = cờ thêm trên DÒNG LỆNH chủ cũ (vd --api-key-file <tệp giả>)
  const c = spawn(exe, ["--port", String(cong), ...thamThem], { env: envCon({ LLAMA_GIA_CHE_DO: cheDo, ...them }), detached: true, stdio: "ignore", windowsHide: true });
  c.unref();
  return c.pid;
}
let soChay = 0; const chayPs = (tep, thamSo, them = {}) => { const n = ++soChay, fo = path.join(D, `ra-${n}.out`), fe = path.join(D, `ra-${n}.err`), o = fs.openSync(fo, "w"), e = fs.openSync(fe, "w"); let r; try { // D1c C1: TỆP, không ỐNG (exe giả thừa kế ống ⇒ spawnSync chờ hết 180 s)
  r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tep, ...thamSo], { stdio: ["ignore", o, e], env: envCon(them), cwd: D, windowsHide: true, timeout: 180_000 });
  } finally { fs.closeSync(o); fs.closeSync(e); } return { ma: r.status, out: `${fs.readFileSync(fo, "utf8")}\n${fs.readFileSync(fe, "utf8")}` };
};
const coTep = (p) => fs.existsSync(p);

// ── Dựng exe giả (C#, .NET Framework qua Add-Type) ────────────────────────────────────────────────────────────────────────────
const NGUON_CS = `using System; using System.Diagnostics; using System.Net; using System.Net.Sockets; using System.Text; using System.Threading;
public static class LlamaGia { public static int Main(string[] a) {
  string cd = Environment.GetEnvironmentVariable("LLAMA_GIA_CHE_DO") ?? "song"; int cong = 0; string kd = Environment.GetEnvironmentVariable("LLAMA_GIA_KHOA_CHI_DOC");
  for (int i = 0; i < a.Length - 1; i++) if (a[i] == "--port") int.TryParse(a[i + 1], out cong);
  int c2; string ep = Environment.GetEnvironmentVariable("LLAMA_GIA_CONG"); if (ep != null && int.TryParse(ep, out c2)) cong = c2;
  if (cd == "thoat") return 3;
  if (cd == "khong-nghe") { Thread.Sleep(Timeout.Infinite); return 0; }
  if (cd == "nhan-doi") { var p = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--con-khong-nghe"); p.UseShellExecute = false; p.EnvironmentVariables["LLAMA_GIA_CHE_DO"] = "khong-nghe"; Process.Start(p); }
  var l = new TcpListener(IPAddress.Loopback, cong); l.Start();
  while (true) { using (var c = l.AcceptTcpClient()) { var s = c.GetStream(); s.ReadTimeout = 2000; var b = new byte[8192]; try { s.Read(b, 0, b.Length); } catch { } if (kd != null && cd == "song") { try { System.IO.File.SetAttributes(kd, System.IO.FileAttributes.ReadOnly); } catch { } }
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
const tay = (cong, them = [], env = {}, tep = TEP_DUNG) => chayPs(KHOI_TAY, ["-ArgStr", `--port ${cong}`, "-Ten", "gia", "-Exe", BIN, "-Cong", String(cong), "-TepTamDung", tep, "-ThuMucLog", LOG, "-ChoGiay", "6", ...them], env);
const doi = (cong, them = [], env = {}, tep = TEP_DUNG) => chayPs(DOI_MODEL, ["-Model", MODEL, "-Exe", BIN, "-Cong", String(cong), "-TepTamDung", tep, "-ThuMucLog", LOG, "-ChoGiay", "6", "-Mmproj", "off", ...them], env);
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
function force(c, them = {}, cheDo = "off", thamThem = []) { // D1c C4: cheDo = LLAMA_SERVER_MMPROJ trong force.env; thamThem = cờ thêm (vd -ChonMmproj off)
  const cay = path.join(D, "repo", "scripts", "ai");
  fs.mkdirSync(cay, { recursive: true });
  fs.copyFileSync(START, path.join(cay, "start-llama-server.ps1"));
  fs.copyFileSync(TIM_MMPROJ, path.join(cay, "tim-mmproj.ps1"));
  const env = path.join(D, "force.env");
  fs.writeFileSync(env, [`GGUF_MODELS_DIR=${D}`, `LLAMA_SERVER_MODEL=${path.basename(MODEL)}`, `LLAMA_SERVER_URL=http://127.0.0.1:${c}`, `LLAMA_SERVER_BIN=${BIN}`,
    `LLAMA_SERVER_SELECTION_FILE=${path.join(D, "khong-co.json")}`, `LLAMA_SERVER_MMPROJ=${cheDo}`].join("\n"));
  return chayPs(path.join(cay, "start-llama-server.ps1"), ["-EnvFile", env, "-Force", "-WaitSeconds", "6", ...thamThem], them);
}
if (CA_RIENG === "doi-chung-mac-dinh") {
  CA.length = 0;
  CA.push({ ten: "doi-chung-mac-dinh", chay: () => chayPs(KHOI_TAY, ["-ArgStr", "--khong-dung", "-Ten", "doi-chung", "-ChiKiem"]), kyVong: { ma: 6, pause: "khong", giaSong: 0 } });
} else {
  // HST 19/11 18:2x (3): tệp tạm dừng KHÔNG ghi được (thư mục cha không có, dưới D) ⇒ thoát 2, không khởi exe giả nào; doi-model
  // KHÔNG dừng chủ cũ (đúng exe + đúng --port, đủ điều kiện bị dừng nếu script đi tiếp). Đặt sau các ca cũ: không dời dòng các điểm spawn.
  const TEP_HONG = path.join(D, "khong-co-thu-muc", "pause");
  CA.push({ ten: "tay-2-pause-khong-ghi-duoc", chay: (c) => tay(c, [], { LLAMA_GIA_CHE_DO: "song" }, TEP_HONG), kyVong: { ma: 2, pause: "khong", giaSong: 0 } },
    { ten: "doi-2-pause-khong-ghi-duoc-chu-cu-song", dung: async (c) => { khoiGia(BIN, "song", c); await choCong(c, true); },
      chay: (c) => doi(c, [], { LLAMA_GIA_CHE_DO: "song" }, TEP_HONG), kyVong: { ma: 2, pause: "khong", giaSong: 1 } });
  // ── Lô D1b (HST 20/11 00:50). Chỉ thêm ở đây: không dời dòng các điểm spawn đã khai (vramAllocationSites). ──
  const TEP_CHAN = path.join(D, "tep-chan"); // một TỆP: thư mục log "dưới" nó không tạo được
  const TEP_KHOA2 = path.join(D, "khoa-gia-2.key");
  fs.writeFileSync(TEP_CHAN, ""); fs.writeFileSync(TEP_KHOA2, `khoa-gia-2-${Math.random().toString(16).slice(2)}\n`);
  const chuCu = (co = []) => async (c) => { khoiGia(BIN, "song", c, {}, co); await choCong(c, true); };
  const DOI_SONG = { LLAMA_GIA_CHE_DO: "song" };
  CA.push(
    // M1: thư mục log hỏng ⇒ 2 TRƯỚC khi dừng chủ cũ (bản cũ: dừng chủ rồi exit 4).
    { ten: "doi-2-log-khong-tao-duoc-chu-cu-song", dung: chuCu([]), kyVong: { ma: 2, pause: "khong", giaSong: 1 },
      chay: (c) => chayPs(DOI_MODEL, ["-Model", MODEL, "-Exe", BIN, "-Cong", String(c), "-TepTamDung", TEP_DUNG, "-ThuMucLog", path.join(TEP_CHAN, "log"), "-ChoGiay", "6", "-Mmproj", "off"], DOI_SONG) },
    // M1, đúng lỗi kiem-dinh 01:05 đo được (HST 01:08): ĐƯỜNG log CHÍNH LÀ một TỆP ⇒ New-Item -Force không ném ⇒ hậu điều kiện ⇒ 2, chủ cũ còn.
    { ten: "doi-2-log-la-tep-chu-cu-song", dung: chuCu([]), kyVong: { ma: 2, pause: "khong", giaSong: 1, outCo: "KHONG TAO DUOC THU MUC LOG" },
      chay: (c) => chayPs(DOI_MODEL, ["-Model", MODEL, "-Exe", BIN, "-Cong", String(c), "-TepTamDung", TEP_DUNG, "-ThuMucLog", TEP_CHAN, "-ChoGiay", "6", "-Mmproj", "off"], DOI_SONG) },
    // M2: start-llama-server -Force, `<RepoRoot>/logs` là TỆP ⇒ 2 TRƯỚC khối -Force (chủ cũ còn sống).
    { ten: "force-2-log-khong-tao-duoc-chu-cu-song", dung: async (c) => { const lg = path.join(D, "repo", "logs"); fs.rmSync(lg, { recursive: true, force: true }); fs.mkdirSync(path.dirname(lg), { recursive: true }); fs.writeFileSync(lg, ""); await chuCu([])(c); },
      chay: (c) => force(c, DOI_SONG), kyVong: { ma: 2, pause: "khong", giaSong: 1 } },
    // M3: đối chứng dương (bàn giao được ⇒ 0, khoá của người nhận còn) rồi ca âm (exe giả đặt ReadOnly lên tệp tạm dừng khi trả /health ⇒ 10).
    { ten: "doi-0-ban-giao-khoa-chuyen", chay: (c) => doi(c, ["-GiuKhoa", "nguoi-nhan-gia"], DOI_SONG), kyVong: { ma: 0, pause: "co", giaSong: 1, outCo: "BAN GIAO khoa cho: nguoi-nhan-gia" } },
    { ten: "doi-10-ban-giao-khoa-khong-chuyen", chay: (c) => doi(c, ["-GiuKhoa", "nguoi-nhan-gia"], { ...DOI_SONG, LLAMA_GIA_KHOA_CHI_DOC: TEP_DUNG }),
      kyVong: { ma: 10, pause: "khong", giaSong: 1, outCo: "KHOA KHONG CHUYEN DUOC", outKhong: "BAN GIAO khoa cho" } },
    // M5 (bảng 8 dòng; dòng 1, 3 = mã 9 sẵn có; dòng 6 = doi-0-dung-dung-chu-roi-khoi; dòng 8 = giới hạn, không dựng được).
    { ten: "doi-0-m5-4a-chu-co-khoa-cung-tep", dung: chuCu(["--api-key-file", TEP_KHOA]), chay: (c) => doi(c, [], { ...DOI_SONG, LLAMA_SERVER_API_KEY_FILE: TEP_KHOA }),
      kyVong: { ma: 0, pause: "khong", giaSong: 1, chuCuBiDung: true, dongLenhCo: "--api-key-file" } },
    { ten: "doi-11-m5-4b-chu-co-khoa-khac-tep", dung: chuCu(["--api-key-file", TEP_KHOA]), chay: (c) => doi(c, [], { ...DOI_SONG, LLAMA_SERVER_API_KEY_FILE: TEP_KHOA2 }),
      kyVong: { ma: 11, pause: "khong", giaSong: 1, outCo: "TEP KHOA KHAC" } },
    { ten: "doi-11-m5-4c-chu-co-api-key-gia-tri", dung: chuCu(["--api-key", "gia-tri-gia-khong-phai-khoa"]), chay: (c) => doi(c, [], { ...DOI_SONG, LLAMA_SERVER_API_KEY_FILE: TEP_KHOA }),
      kyVong: { ma: 11, pause: "khong", giaSong: 1, outCo: "--api-key <che>", outKhong: "gia-tri-gia-khong-phai-khoa" } },
    { ten: "doi-11-m5-5-chu-co-khoa-shell-thieu-bien", dung: chuCu(["--api-key-file", TEP_KHOA]), chay: (c) => doi(c, [], DOI_SONG),
      kyVong: { ma: 11, pause: "khong", giaSong: 1, outCo: "DANG CO KHOA" } },
    { ten: "doi-0-m5-5p-chu-co-khoa-KhongKhoa", dung: chuCu(["--api-key-file", TEP_KHOA]), chay: (c) => doi(c, ["-KhongKhoa"], DOI_SONG),
      kyVong: { ma: 0, pause: "khong", giaSong: 1, chuCuBiDung: true, dongLenhKhong: "--api-key", outCo: "KHONG KHOA THEO -KhongKhoa" } },
    { ten: "doi-2-m5-7-KhongKhoa-mau-thuan", chay: (c) => doi(c, ["-KhongKhoa"], { ...DOI_SONG, LLAMA_SERVER_API_KEY_FILE: TEP_KHOA }), kyVong: { ma: 2, pause: "khong", giaSong: 0 } },
    { ten: "doi-0-m5-2-cong-trong-khong-bien", chay: (c) => doi(c, [], DOI_SONG), kyVong: { ma: 0, pause: "khong", giaSong: 1, outCo: "KHONG CO CHU CONG" } },
    // D1c C2 (HST 03:03): khoi-llama-tay khởi CÓ khoá ⇒ dòng `CMDLINE:` phải che đường tệp khoá thành `<tep-khoa>` (kiểm chung bên dưới bắt đường thật).
    // D1c C4: đối chứng (auto + có tệp mmproj cạnh model ⇒ có --mmproj) rồi -ChonMmproj off thắng cấu hình env ⇒ KHÔNG --mmproj.
    { ten: "force-0-mmproj-auto-doi-chung", dung: async (c) => { fs.writeFileSync(path.join(D, "Gia-mmproj-F16.gguf"), ""); await chuCu([])(c); }, chay: (c) => force(c, DOI_SONG, "auto"), kyVong: { ma: 0, pause: "khong", giaSong: 1, chuCuBiDung: true, dongLenhCo: "--mmproj" } },
    { ten: "force-0-mmproj-off-qua-tham-so", dung: chuCu([]), chay: (c) => force(c, DOI_SONG, "auto", ["-ChonMmproj", "off"]), kyVong: { ma: 0, pause: "khong", giaSong: 1, chuCuBiDung: true, dongLenhKhong: "--mmproj" } },
    { ten: "tay-0-co-khoa-cmdline-che", kyVong: { ma: 0, pause: "khong", giaSong: 1, outCo: "--api-key-file <tep-khoa>" },
      chay: (c) => chayPs(KHOI_TAY, ["-ArgStr", `--port ${c} --api-key-file ${TEP_KHOA}`, "-Ten", "gia", "-Exe", BIN, "-Cong", String(c), "-TepTamDung", TEP_DUNG, "-ThuMucLog", LOG, "-ChoGiay", "6"], { ...DOI_SONG, LLAMA_SERVER_API_KEY_FILE: TEP_KHOA }) });
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
    if (kv.dongLenhKhong && sau.some((g) => String(g.cl ?? "").includes(kv.dongLenhKhong))) loi.push(`dong lenh CO ${kv.dongLenhKhong}`); // D1b
    if (kv.outCo && !out.includes(kv.outCo)) loi.push(`dau ra thieu "${kv.outCo}"`);
    if (kv.outKhong && out.includes(kv.outKhong)) loi.push(`dau ra CO "${kv.outKhong}"`);
    // D1c C2 kiểm CHUNG (mọi ca): đầu ra không lộ ĐƯỜNG tệp khoá giả (lời báo chỉ được nói có/không, trùng/khác).
    for (const t of [TEP_KHOA, path.join(D, "khoa-gia-2.key"), path.join(D, "khong-co.key")]) if (out.includes(t)) loi.push(`dau ra LO duong tep khoa ${path.basename(t)}`);
    // kiem-dinh 03:54 (c): thêm theo TÊN TỆP, không phân biệt hoa/thường (bắt cả dạng `/`, 8.3, khác hoa/thường của thư mục cha).
    if (/khoa-gia(-2)?\.key|khong-co\.key/i.test(out)) loi.push("dau ra LO ten tep khoa gia");
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
