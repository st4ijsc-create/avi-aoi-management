// Chẩn đoán 2026-10-23 — khởi động server app lặp lại N lần (spawn node TRỰC TIẾP để bắt đúng exit code, vd 3221226356 = 0xC0000374).
// usage: node scripts/chan-doan/boot-lap.mjs <N> [KEY=VAL…]   (KEY=VAL ghi đè biến môi trường của tiến trình con)
// Biến điều khiển: BOOT_DIR(.boot20) BOOT_GIU_MS(25000) BOOT_TRAN_MS(180000) BOOT_NODE(node hệ thống) BOOT_SAVE_LOG=1 BOOT_CLEAN_EVERY=N.
// Mặc định: PORT 3016, DATABASE_URL → DB _test, tắt warm model + llama-server + watchdog. Xem README.md.
// Khởi động lặp server app trên :3016 (DB _test, không warm model, không llama-server/watchdog). Ghi mã thoát từng lần.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import postgres from "postgres";

const LAN = Number(process.argv[2] ?? 20);
const GHI_DE = Object.fromEntries(process.argv.slice(3).map((a) => a.split(/=(.*)/s).slice(0, 2)));
const THU_MUC_LOG = process.env.BOOT_DIR ?? ".boot20";
const GIU_MS = Number(process.env.BOOT_GIU_MS ?? 25_000); // giữ sau khi cổng nghe
const TRAN_LEN_MS = Number(process.env.BOOT_TRAN_MS ?? 180_000); // cổng không nghe sau 180 s ⇒ coi là treo
const PORT = 3016;

const envFile = fs.readFileSync(".env", "utf8").split(/\r?\n/);
const dbLine = envFile.filter((l) => /^DATABASE_URL=/.test(l)).pop();
const dbUrl = dbLine.replace(/^DATABASE_URL=/, "").trim().replace(/\s+#.*$/, "").replace(/\/aoi_management(\?|$)/, "/aoi_management_test$1");
if (!/aoi_management_test/.test(dbUrl)) throw new Error("không dựng được URL DB _test");

const env = {
  ...process.env,
  PORT: String(PORT),
  DATABASE_URL: dbUrl,
  GGUF_WARM_DEEP_MODEL_ON_BOOT: "false",
  LLAMA_SERVER_ENABLED: "false",
  LLAMA_WATCHDOG_ENABLED: "false",
  // Không-GPU mặc định (census VRAM): aiWatcher tắt; DIAG_NO_KB_WARM chỉ có hiệu lực khi áp diag-boot.patch (nếu không, warmUp KB nạp CUDA backend + embedder 0.6B).
  AI_ORCHESTRATION_ENABLED: "false",
  DIAG_NO_KB_WARM: "1",
  VITEST: "", // không phải môi trường test
  ...GHI_DE,
};

const nghe = () =>
  new Promise((ok) => {
    const s = net.connect({ port: PORT, host: "127.0.0.1" }, () => { s.destroy(); ok(true); });
    s.on("error", () => ok(false));
    s.setTimeout(800, () => { s.destroy(); ok(false); });
  });
const ngu = (ms) => new Promise((r) => setTimeout(r, ms));

function giet(pid) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
}

const ketQua = [];
// Mỗi lần khởi động sinh ~6.000 thông báo ALERT (quét STOP/factory-drift trên dữ liệu test) — dọn định kỳ để DB _test không phình và gây treo giả.
const DON_MOI = Number(process.env.BOOT_CLEAN_EVERY ?? 0);
async function donThongBao() {
  const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from notifications where type = 'ALERT' and "createdAt" >= now() - interval '2 hours' and (title ~ 'factory changed while edge' or title ~ '^STOP owed after transfer' or title ~ '^OT STOP sync between central' or title ~ '^STOP not confirmed')`;
  } finally { await sql.end(); }
}
fs.mkdirSync(THU_MUC_LOG, { recursive: true });
for (let i = 1; i <= LAN; i++) {
  if (await nghe()) { console.log(`#${i} cổng ${PORT} ĐANG có người nghe trước khi chạy — dừng`); break; }
  const t0 = Date.now();
  const log = [];
  const child = spawn(process.env.BOOT_NODE ?? process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/_core/index.ts"], { env, cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let thoat = null;
  child.on("exit", (code, signal) => { thoat = { code, signal, ms: Date.now() - t0 }; });
  const nap = (b) => { for (const dong of b.toString("utf8").split(/\r?\n/)) if (dong && !dong.startsWith("[SLOW QUERY]")) { log.push(dong); if (log.length > 20000) log.shift(); } };
  child.stdout.on("data", nap);
  child.stderr.on("data", nap);

  let tgNghe = null;
  let ketCuc = null;
  while (ketCuc === null) {
    await ngu(500);
    if (thoat) { ketCuc = tgNghe ? "chet-sau-khi-nghe" : "chet-truoc-khi-nghe"; break; }
    if (tgNghe === null && (await nghe())) tgNghe = Date.now() - t0;
    if (tgNghe !== null && Date.now() - t0 - tgNghe >= GIU_MS) { ketCuc = "song-het-giu"; break; }
    if (tgNghe === null && Date.now() - t0 > TRAN_LEN_MS) { ketCuc = "treo-khong-nghe"; break; }
  }
  const pid = child.pid;
  if (!thoat) { giet(pid); await ngu(1500); }
  const r = { lan: i, ketCuc, tgNgheMs: tgNghe, thoat, tongMs: Date.now() - t0 };
  ketQua.push(r);
  const hex = thoat?.code != null ? "0x" + (thoat.code >>> 0).toString(16) : "-";
  console.log(`#${i} ${ketCuc} nghe=${tgNghe}ms exit=${thoat ? `${thoat.code}(${hex})/${thoat.signal}` : "bị-ta-giết"} tong=${r.tongMs}ms`);
  if (ketCuc.startsWith("chet") || ketCuc.startsWith("treo") || process.env.BOOT_SAVE_LOG === "1") fs.writeFileSync(`${THU_MUC_LOG}/lan${i}.log`, log.slice(-20000).join("\n"));
  if (DON_MOI > 0 && i % DON_MOI === 0) await donThongBao().catch((e) => console.log("dọn thông báo lỗi:", e.message));
  await ngu(2000);
}
fs.writeFileSync(`${THU_MUC_LOG}/tom-tat.json`, JSON.stringify(ketQua, null, 1));
const chet = ketQua.filter((r) => r.ketCuc.startsWith("chet") || r.ketCuc.startsWith("treo"));
console.log(`TONG ${ketQua.length} lần: sống ${ketQua.length - chet.length}, chết/treo ${chet.length}`);
