/**
 * ĐƯỜNG (a) — MỘT LƯỢT sinh mã: đặc tả + tệp khung ⇒ model trả các tệp lời giải ⇒ máy chấm (test hiển thị + ẩn).
 *
 *   --config raw       gọi THẲNG llama-server (trục M — model thuần; `--raw-url`, mặc định :8091)
 *   --config pipeline  đường SẢN PHẨM `/api/ai/local-kb/stream` (codingMode) như `codegen-chay-duoc/run.mjs` (trục H)
 *   --config mau|khung|sai   KHÔNG gọi model — kiểm thước đường (a) trên CHÍNH mẫu được chọn:
 *                            mau ⇒ phải 100 % · khung ⇒ phải 0 % · sai ⇒ phải 0 % (lệch ⇒ exit 1, vứt số)
 *
 * Chọn bài: `--seed <chuỗi>` + `--n <số>` (lấy mẫu phân tầng ngôn ngữ × mức, xem lib/chon.mjs) · `--tat-ca` ·
 *           `--only <id,…|lang|muc|kieu>` lọc TRƯỚC khi rút. Không `--seed` ⇒ sinh từ đồng hồ và IN RA (ghi vào báo cáo).
 * Khác: `--luot N` (lặp mỗi bài N lần, đo nhiễu) · `--max-tokens` (mặc định 16000 — model biết nghĩ cần trần rộng) ·
 *       `--khong-nghi` · `--sampling hien-tai|chinh-hang` · `--model` · `--raw-url` · `--cookie` · `--che-do-nghi` ·
 *       `--label` (kết thúc bằng số lượt, vd `NN-a-raw-1`) · `--song-song-cham N` (chấm song song với sinh, mặc định 2).
 * Server đo (pipeline): AI_EVAL_BASE (mặc định http://127.0.0.1:3000). Cổng sức khoẻ llama trước/sau: exit 2 nếu chết.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, BO, coToolchain } from "./lib/moiTruong.mjs";
import { docKho } from "./lib/kho.mjs";
import { chonPhanTang } from "./lib/chon.mjs";
import { chamDuAn, dungKhung, ghiTep, xoaThuMuc, apSai } from "./lib/cham.mjs";
import { trichTep, dungCauTraLoiGia } from "./lib/trichTep.mjs";
import { taoCauHoiMotLuot, SYS_MOT_LUOT } from "./lib/cauHoi.mjs";
import { bangTomTat, trungVi } from "./lib/baoCao.mjs";
import { taoGoiModel, tuyChonTuArgs } from "./lib/goiModel.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const co = (k) => args.includes(k);

const CONFIG = arg("--config", "raw");
if (!["raw", "pipeline", "mau", "khung", "sai"].includes(CONFIG)) { console.error(`--config lạ: ${CONFIG}`); process.exit(2); }
const GOI_MODEL = CONFIG === "raw" || CONFIG === "pipeline";
const SEED = arg("--seed", null) ?? `t${Date.now()}`;
const KHO_LOC = docKho({ only: arg("--only", null) });
const N = co("--tat-ca") ? KHO_LOC.length : Number(arg("--n", 18));
const SO_LUOT = Math.max(1, Number(arg("--luot", 1)));
const LABEL = arg("--label", `NN-a-${CONFIG}-1`);
const SONG_SONG_CHAM = Math.max(1, Number(arg("--song-song-cham", 2)));
const WORK = `${ROOT}/tmp/ngau-nhien-work/${LABEL}-${process.pid}`;

const DS = chonPhanTang(KHO_LOC, { seed: SEED, n: N });
if (!DS.length) { console.error("Không có bài nào (kho rỗng hoặc --only không khớp)."); process.exit(2); }
const thieuTc = [...new Set(DS.filter((b) => !coToolchain(b.kieu)).map((b) => b.kieu))];
if (thieuTc.length) { console.error(`⛔ Thiếu toolchain cho: ${thieuTc.join(", ")} — vứt lượt (xem lib/moiTruong.mjs).`); process.exit(2); }
console.error(`ℹ ${LABEL}: config=${CONFIG} · seed=${SEED} · ${DS.length} bài (kho lọc ${KHO_LOC.length}) × ${SO_LUOT} lượt`);
console.error(`  bài: ${DS.map((b) => b.id).join(", ")}`);

// ── SINH ─────────────────────────────────────────────────────────────────────────────────────────────
const TUY_CHON = tuyChonTuArgs(args, 16000);
let goi = taoGoiModel(TUY_CHON);
function genGia(b) {
  if (CONFIG === "khung") return { text: "", totalMs: 0 };
  const tep = Object.fromEntries(b.tepGiai.map((t) => [t, fs.readFileSync(`${b.mauAbs}/${t}`, "utf8")]));
  if (CONFIG === "sai") {
    const tam = `${WORK}/_sai/${b.id}`;
    dungKhung(b, tam);
    apSai(b, tam);
    for (const t of b.tepGiai) tep[t] = fs.readFileSync(`${tam}/${t}`, "utf8");
    xoaThuMuc(tam);
  }
  return { text: dungCauTraLoiGia(tep), totalMs: 0 };
}

async function kiemSong(luc) {
  if (GOI_MODEL) await goi.kiemSong(luc, { pipeline: CONFIG === "pipeline" });
}

// ── VÒNG ─────────────────────────────────────────────────────────────────────────────────────────────
if (CONFIG === "pipeline") {
  const { ck } = await import("../codegen-chay-duoc/cookie.mjs");
  goi = taoGoiModel({ ...TUY_CHON, cookie: ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`)) });
}
await kiemSong("TRƯỚC khi đo");

const rows = [];
const dangCham = new Set();
async function cham(b, luot, g) {
  const dir = `${WORK}/${b.id}-${luot}`;
  dungKhung(b, dir);
  const tr = trichTep(g.text || "", b);
  let loiGhi = null;
  try { ghiTep(dir, tr.tep); } catch (e) { loiGhi = String(e.message ?? e); }
  const kq = await chamDuAn({ bai: b, thuMuc: dir });
  xoaThuMuc(dir);
  const row = {
    id: b.id, lang: b.lang, muc: b.muc, luot, vanTay: b.vanTay, config: CONFIG,
    dat: kq.dat && !loiGhi && tr.thieu.length === 0,
    trich: { thieu: tr.thieu, soKhoi: tr.soKhoi, cach: tr.cach },
    loiGhi, lyDo: kq.lyDo, dem: kq.dem, canToiThieu: kq.canToiThieu,
    duoiRa: kq.dat ? undefined : kq.duoiRa.slice(-1500),
    totalMs: g.totalMs ?? null, ttftMs: g.ttftMs ?? null, promptTok: g.promptTok ?? null, genTok: g.genTok ?? null,
    finish: g.finish ?? null, cut: !!g.cut, evs: g.evs ?? null, err: g.err ?? null, chamMs: kq.ms,
    tep: tr.tep, vanBanGoc: GOI_MODEL ? (g.text || "").slice(0, 40000) : undefined,
  };
  if (tr.thieu.length && !row.lyDo.includes("THIEU_TEP")) row.lyDo = ["THIEU_TEP:" + tr.thieu.join("+"), ...row.lyDo];
  rows.push(row);
  console.error(`  ${row.dat ? "ĐẠT " : "TRƯỢT"} ${b.id}#${luot}  ${row.dem ? `${row.dem.pass}✓/${row.dem.fail}✗ (cần ≥${row.canToiThieu})` : ""} ${row.lyDo.join(",")}` +
    `${row.cut ? " · CỤT" : ""}${row.genTok ? ` · ${row.genTok} tok` : ""}${row.totalMs ? ` · ${row.totalMs} ms` : ""}`);
}

for (const b of DS) {
  for (let luot = 1; luot <= SO_LUOT; luot++) {
    process.stderr.write(`▶ ${b.id} (${b.lang}/${b.muc}) lượt ${luot} … sinh\n`);
    let g;
    try {
      g = CONFIG === "raw" ? await goi.chatRaw(SYS_MOT_LUOT, taoCauHoiMotLuot(b)) : CONFIG === "pipeline" ? await goi.chatPipeline(taoCauHoiMotLuot(b)) : genGia(b);
    } catch (e) {
      g = { text: "", err: String(e).slice(0, 300) };
    }
    // Chấm song song với lượt sinh kế tiếp (CPU ↔ GPU), giới hạn SONG_SONG_CHAM.
    while (dangCham.size >= SONG_SONG_CHAM) await Promise.race(dangCham);
    const p = cham(b, luot, g).catch((e) => console.error(`  ⚠ lỗi chấm ${b.id}: ${e?.stack ?? e}`)).finally(() => dangCham.delete(p));
    dangCham.add(p);
  }
}
await Promise.all(dangCham);
await kiemSong("SAU khi đo");
xoaThuMuc(WORK);

// ── BÁO CÁO ──────────────────────────────────────────────────────────────────────────────────────────
rows.sort((a, b) => (a.id === b.id ? a.luot - b.luot : a.id < b.id ? -1 : 1));
const bang = bangTomTat(rows, { tieuDe: `${LABEL} — đường (a) một lượt, config=${CONFIG}, seed=${SEED}` });
console.log(bang);
const lat = rows.map((r) => r.totalMs).filter((x) => x);
if (GOI_MODEL && lat.length) console.log(` độ trễ sinh: trung vị ${trungVi(lat)} ms · max ${Math.max(...lat)} ms · token ra trung vị ${trungVi(rows.map((r) => r.genTok))}`);
const dirBc = `${BO}/reports`;
fs.mkdirSync(dirBc, { recursive: true });
fs.writeFileSync(`${dirBc}/${LABEL}.json`, JSON.stringify({
  label: LABEL, duong: "a-mot-luot", config: CONFIG, seed: SEED, n: N, soLuot: SO_LUOT, luc: new Date().toISOString(),
  base: CONFIG === "pipeline" ? TUY_CHON.base : null, rawUrl: CONFIG === "raw" ? TUY_CHON.rawUrl : null, maxTokens: GOI_MODEL ? TUY_CHON.maxTokens : null,
  khongNghi: co("--khong-nghi"), sampling: arg("--sampling", "hien-tai"),
  bai: DS.map((b) => ({ id: b.id, lang: b.lang, muc: b.muc, vanTay: b.vanTay })), bang, rows,
}, null, 1));
console.log(` báo cáo: ${path.join(dirBc, `${LABEL}.json`)}`);

const dat = rows.filter((r) => r.dat).length;
const KY_VONG = { mau: rows.length, khung: 0, sai: 0 };
if (CONFIG in KY_VONG) {
  const ok = dat === KY_VONG[CONFIG] && rows.length === DS.length * SO_LUOT;
  console.log(` KIỂM THƯỚC (a) ${CONFIG}: ${ok ? "ĐẠT" : "HỎNG — VỨT MỌI SỐ ĐO CHO TỚI KHI SỬA BỘ ĐO"} (kỳ vọng ${KY_VONG[CONFIG]}/${rows.length}, được ${dat}/${rows.length})`);
  process.exit(ok ? 0 : 1);
}
