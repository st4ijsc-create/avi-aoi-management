/**
 * ĐƯỜNG (a) — MỘT LƯỢT sinh mã: đặc tả + tệp khung ⇒ model trả các tệp lời giải ⇒ máy chấm (test hiển thị + ẩn).
 *
 *   --config raw       gọi THẲNG llama-server (trục M — model thuần; `--raw-url`, mặc định :8091)
 *   --config pipeline  đường SẢN PHẨM `/api/ai/local-kb/stream` (codingMode) như `codegen-chay-duoc/run.mjs` (trục H)
 *   --config v1        đường SẢN PHẨM `/v1/chat/completions` (AI_EVAL_BASE, token người dùng ở `--token-file` JSON {token,ten},
 *                      `--v1-model` mặc định `code.plc`) — trục H của vòng kiểm biên dịch ST (cờ AI_KIEM_BIEN_DICH_ST CỦA SERVER)
 *                      `--ab-kiem`: A/B XEN KẼ trên CÙNG server (cờ phải có `v1`): mỗi (bài, lượt) chạy LIỀN hai nhánh — "tat"
 *                      (gửi `st4i_kiem_bien_dich:false`, server bỏ vòng) và "bat"; thứ tự đảo theo lượt (lẻ tat→bat, chẵn
 *                      bat→tat) để trôi nhiệt/khe không dồn một phía. Hàng mang `nhanh`; bảng in riêng từng nhánh + cặp lệch.
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
import { chamDuAn, dungKhung, ghiTep, xoaThuMuc, apSai, ST_TRINH_DICH, ST_PHUONG_NGU } from "./lib/cham.mjs";
import { trichTep, dungCauTraLoiGia } from "./lib/trichTep.mjs";
import { taoCauHoiMotLuot, SYS_MOT_LUOT } from "./lib/cauHoi.mjs";
import { bangTomTat, trungVi } from "./lib/baoCao.mjs";
import { taoGoiModel, tuyChonTuArgs } from "./lib/goiModel.mjs";
import { chayST } from "./lib/st/chayST.mjs";
import { giuKhoaKhe } from "../lib/khoaKhe.mjs";
import { chaySTMatiec } from "./lib/st-matiec/chaySTMatiec.mjs";
import { sclSangSt } from "./lib/st-scl/scl.mjs";
import { TEN_TRINH_DICH_ST, cauNhacSuaST, dongLoiST } from "../../../shared/stNhacSua.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const co = (k) => args.includes(k);

const CONFIG = arg("--config", "raw");
if (!["raw", "pipeline", "v1", "mau", "khung", "sai"].includes(CONFIG)) { console.error(`--config lạ: ${CONFIG}`); process.exit(2); }
const GOI_MODEL = CONFIG === "raw" || CONFIG === "pipeline" || CONFIG === "v1";
/** Cấu hình dùng khe :8091 (giữ khoá khe + đọc model đầu/cuối): raw gọi thẳng; v1 qua app nhưng app gọi :8091. */
const DUNG_KHE = CONFIG === "raw" || CONFIG === "v1";
const SEED = arg("--seed", null) ?? `t${Date.now()}`;
const KHO_LOC = docKho({ only: arg("--only", null) });
const N = co("--tat-ca") ? KHO_LOC.length : Number(arg("--n", 18));
const SO_LUOT = Math.max(1, Number(arg("--luot", 1)));
const LABEL = arg("--label", `NN-a-${CONFIG}-1`);
const SONG_SONG_CHAM = Math.max(1, Number(arg("--song-song-cham", 2)));
const WORK = `${ROOT}/tmp/ngau-nhien-work/${LABEL}-${process.pid}`;
/**
 * ★★ Đợt 7.3+ (2026-10-21) — `--vong-sua N` (chỉ config raw, chỉ bài `st`): sau câu trả lời, BIÊN DỊCH RIÊNG mã nguồn (src +
 * hàm `main` rỗng — KHÔNG có test nào, không lộ test hiển thị/ẩn) bằng RuSTy; lỗi biên dịch ⇒ gửi lại model trong CÙNG hội
 * thoại, tối đa N vòng. Đúng cơ chế node `ai.sinh-ma` của Luồng AI ⇒ A/B đo tác dụng của vòng kiểm biên dịch.
 * ★ Đợt 9 — theo chế độ chấm: `AI_EVAL_ST_TRINH_DICH=matiec` ⇒ biên dịch bằng MATIEC (pha A, cờ OpenPLC thật, chỉ src);
 * `AI_EVAL_ST_PHUONG_NGU=scl` ⇒ chuẩn hoá SCL → ST trước khi biên dịch (số dòng giữ nguyên ⇒ lỗi trỏ đúng dòng SCL).
 */
// ★ (2026-10-22) lời nhắc sửa dùng CHUNG với sản phẩm (shared/stNhacSua.mjs — chữ giữ từng byte, lưới ghim).
const TEN_TRINH_DICH = ST_TRINH_DICH === "matiec" ? TEN_TRINH_DICH_ST.matiec : TEN_TRINH_DICH_ST.rusty;
const VONG_SUA = Math.max(0, Number(arg("--vong-sua", 0)));
const AB_KIEM = co("--ab-kiem");
// ★ Đợt 9 (2026-10-23) — pipeline (trợ lý lập trình): opt-out `context.kiemBienDichST:false`; cờ server phải có `tro-ly`.
if (AB_KIEM && CONFIG !== "v1" && CONFIG !== "pipeline") { console.error("--ab-kiem chỉ cho --config v1 | pipeline."); process.exit(2); }
if (VONG_SUA > 0 && CONFIG !== "raw") { console.error("--vong-sua chỉ cho --config raw (v1: vòng kiểm là của SERVER, bật bằng cờ)."); process.exit(2); }

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

async function kiemSong(luc, thoat = true) {
  return GOI_MODEL ? goi.kiemSong(luc, { pipeline: CONFIG === "pipeline" || CONFIG === "v1", thoat }) : true;
}

// ── VÒNG ─────────────────────────────────────────────────────────────────────────────────────────────
if (CONFIG === "pipeline") {
  const { ck } = await import("../codegen-chay-duoc/cookie.mjs");
  goi = taoGoiModel({ ...TUY_CHON, cookie: ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`)) });
}
/** ★ Đợt 9 — token /v1 RIÊNG cho phép đo (tên ghi vào báo cáo; KHÔNG ghi token). */
let TOKEN_V1 = null;
if (CONFIG === "v1") {
  const tf = arg("--token-file", `${ROOT}/tmp/token-do.json`);
  try { TOKEN_V1 = JSON.parse(fs.readFileSync(tf, "utf8")); } catch (e) { console.error(`⛔ không đọc được --token-file ${tf}: ${e?.message ?? e}`); process.exit(2); }
  goi = taoGoiModel({ ...TUY_CHON, v1Token: TOKEN_V1.token, v1Model: arg("--v1-model", "code.plc") });
}
await kiemSong("TRƯỚC khi đo");
// ★ Đợt 9 — KHOÁ KHE suốt lượt (server/services/ai/khoaKhe.ts): app không được đổi khe :8091 giữa phép đo; gia hạn 30 s,
// tự hết hạn ≤ 5 phút nếu tiến trình này chết.
const KHOA = GOI_MODEL && DUNG_KHE ? giuKhoaKhe({ chu: `mot-luot ${LABEL} (PID ${process.pid})`, lyDo: "đo plc/ngẫu nhiên trên :8091" }) : null;
// ★ Đợt 9 — model THỰC chạy đầu + cuối lượt (khe nặng của một tiến trình khác có thể đổi :8091 giữa chừng).
const MODEL_DAU = GOI_MODEL && DUNG_KHE ? await goi.modelDangChay() : null;
if (MODEL_DAU) console.error(`ℹ model :8091 lúc bắt đầu: ${MODEL_DAU}`);
let dungSom = null;

const rows = [];
/**
 * ★ Đợt 9 (2026-10-22) — `--noi-tiep <nhãn>`: NỐI TIẾP một lượt dừng sớm (lỗi hạ tầng) — nạp các hàng ĐÃ CHẤM của báo cáo
 * `<nhãn>.json` (cùng cấu hình: config/ab-kiem phải khớp, kiểm dưới) và CHỈ chạy các (bài, lượt, nhánh) còn thiếu. Hàng nạp
 * lại mang `noiTiep: true`; báo cáo ghi `noiTiepTu`.
 */
const NOI_TIEP = arg("--noi-tiep", null);
const daCo = new Set();
if (NOI_TIEP) {
  const cu = JSON.parse(fs.readFileSync(`${BO}/reports/${NOI_TIEP}.json`, "utf8"));
  if (cu.config !== CONFIG || !!cu.abKiem !== AB_KIEM) { console.error(`⛔ --noi-tiep ${NOI_TIEP}: cấu hình khác (config ${cu.config}, abKiem ${cu.abKiem})`); process.exit(2); }
  for (const r of cu.rows) {
    rows.push({ ...r, noiTiep: true });
    daCo.add(`${r.id}#${r.luot}#${r.nhanh ?? ""}`);
  }
  console.error(`ℹ nối tiếp ${NOI_TIEP}: nạp ${cu.rows.length} hàng đã chấm`);
}
const dangCham = new Set();
async function cham(b, luot, g, nhanh = undefined) {
  // thư mục theo NHÁNH — hai nhánh của cùng (bài, lượt) không bao giờ chấm chung một thư mục
  const dir = `${WORK}/${b.id}-${luot}${nhanh ? `-${nhanh}` : ""}`;
  dungKhung(b, dir);
  const tr = trichTep(g.text || "", b);
  let loiGhi = null;
  try { ghiTep(dir, tr.tep); } catch (e) { loiGhi = String(e.message ?? e); }
  const kq = await chamDuAn({ bai: b, thuMuc: dir });
  xoaThuMuc(dir);
  const row = {
    id: b.id, lang: b.lang, muc: b.muc, luot, vanTay: b.vanTay, config: CONFIG, nhanh,
    dat: kq.dat && !loiGhi && tr.thieu.length === 0,
    trich: { thieu: tr.thieu, soKhoi: tr.soKhoi, cach: tr.cach },
    loiGhi, lyDo: kq.lyDo, dem: kq.dem, canToiThieu: kq.canToiThieu,
    duoiRa: kq.dat ? undefined : kq.duoiRa.slice(-1500),
    totalMs: g.totalMs ?? null, ttftMs: g.ttftMs ?? null, promptTok: g.promptTok ?? null, genTok: g.genTok ?? null,
    finish: g.finish ?? null, cut: !!g.cut, evs: g.evs ?? null, err: g.err ?? null, chamMs: kq.ms,
    tep: tr.tep, vanBanGoc: GOI_MODEL ? (g.text || "").slice(0, 40000) : undefined, vongSua: g.vongSua,
    hdr: g.hdr ?? undefined, requestId: g.requestId ?? undefined, usage: g.usage ?? undefined,
  };
  if (tr.thieu.length && !row.lyDo.includes("THIEU_TEP")) row.lyDo = ["THIEU_TEP:" + tr.thieu.join("+"), ...row.lyDo];
  rows.push(row);
  console.error(`  ${row.dat ? "ĐẠT " : "TRƯỢT"} ${b.id}#${luot}${nhanh ? `[${nhanh}]` : ""}  ${row.dem ? `${row.dem.pass}✓/${row.dem.fail}✗ (cần ≥${row.canToiThieu})` : ""} ${row.lyDo.join(",")}` +
    `${row.cut ? " · CỤT" : ""}${row.genTok ? ` · ${row.genTok} tok` : ""}${row.totalMs ? ` · ${row.totalMs} ms` : ""}` +
    `${row.hdr?.["x-st4i-bien-dich"] ? ` · BD[${row.hdr["x-st4i-bien-dich"]}]` : ""}`);
}

/** Biên dịch CHỈ `src/*.st` của câu trả lời (+ `main` rỗng). Trả danh sách lỗi (rỗng = biên dịch được). */
async function loiBienDichST(b, text, nhan) {
  const tr = trichTep(text, b);
  const dir = `${WORK}/_vong/${b.id}-${nhan}`;
  xoaThuMuc(dir);
  fs.mkdirSync(`${dir}/src`, { recursive: true });
  const tep = [];
  for (const [rel, nd] of Object.entries(tr.tep)) {
    if (!/^src\/[^/]+\.st$/i.test(rel)) continue;
    fs.writeFileSync(`${dir}/${rel}`, ST_PHUONG_NGU === "scl" ? sclSangSt(nd) : nd);
    tep.push({ ten: rel, duong: `${dir}/${rel}` });
  }
  if (ST_TRINH_DICH !== "matiec") { // MATIEC: chỉ src (pha A, cờ OpenPLC) — không cần main
    fs.writeFileSync(`${dir}/_main.st`, "FUNCTION main : DINT\n    main := 0;\nEND_FUNCTION\n");
    tep.push({ ten: "_main.st", duong: `${dir}/_main.st` });
  }
  if (tr.thieu.length) return [`thiếu tệp: ${tr.thieu.join(", ")} — trả về ĐỦ mọi tệp, mỗi tệp một khối mã có dòng \`// tệp: …\``];
  const r = await (ST_TRINH_DICH === "matiec" ? chaySTMatiec : chayST)({ tep, thuMucViec: `${WORK}/_st-jobs`, giayChay: 5 });
  xoaThuMuc(dir);
  if (r.giaiDoan !== "bien-dich" || r.ok) return []; // MATIEC chỉ src: biên dịch được ⇒ giaiDoan "bien-dich" + ok
  return r.chanDoan.filter((d) => d.mucDo === "error").slice(0, 15).map(dongLoiST);
}

async function sinhCoVongSua(b) {
  const tin = [{ role: "system", content: SYS_MOT_LUOT }, { role: "user", content: taoCauHoiMotLuot(b) }];
  let g = await goi.chatRawTin(tin);
  const vet = { vong: 0, loiTungVong: [] };
  for (let k = 1; k <= VONG_SUA && !g.err && g.text; k++) {
    const loi = await loiBienDichST(b, g.text, `${k}-${Date.now()}`);
    vet.loiTungVong.push(loi.length);
    if (!loi.length) break;
    tin.push({ role: "assistant", content: g.text });
    tin.push({ role: "user", content: cauNhacSuaST({ trinhDich: TEN_TRINH_DICH, laScl: ST_PHUONG_NGU === "scl", loi, dinhDangTep: true }) });
    const g2 = await goi.chatRawTin(tin);
    vet.vong = k;
    g = { ...g2, totalMs: (g.totalMs ?? 0) + (g2.totalMs ?? 0), genTok: (g.genTok ?? 0) + (g2.genTok ?? 0) };
  }
  return { ...g, vongSua: vet };
}

for (const b of DS) {
  for (let luot = 1; luot <= SO_LUOT; luot++) {
    // --ab-kiem: hai nhánh LIỀN nhau, thứ tự đảo theo lượt (lẻ tat→bat, chẵn bat→tat).
    for (const nhanh of AB_KIEM ? (luot % 2 ? ["tat", "bat"] : ["bat", "tat"]) : [undefined]) {
      if (daCo.has(`${b.id}#${luot}#${nhanh ?? ""}`)) continue;
      process.stderr.write(`▶ ${b.id} (${b.lang}/${b.muc}) lượt ${luot}${nhanh ? ` [${nhanh}]` : ""} … sinh\n`);
      let g;
      try {
        g = CONFIG === "raw" && VONG_SUA > 0 && b.kieu === "st" ? await sinhCoVongSua(b)
          : CONFIG === "raw" ? await goi.chatRaw(SYS_MOT_LUOT, taoCauHoiMotLuot(b)) : CONFIG === "pipeline" ? await goi.chatPipeline(taoCauHoiMotLuot(b), { tatKiem: nhanh === "tat" })
          : CONFIG === "v1" ? await goi.chatV1(SYS_MOT_LUOT, taoCauHoiMotLuot(b), { tatKiem: nhanh === "tat" }) : genGia(b);
      } catch (e) {
        g = { text: "", err: String(e).slice(0, 300) };
      }
      // ★ Đợt 9 — pipeline: tóm tắt vòng kiểm đi ở `done.kiemBienDichST` ⇒ đặt vào CÙNG ô header của /v1 (kiểm nhánh + báo cáo dùng chung).
      if (CONFIG === "pipeline" && g.kiemBienDich) g.hdr = { "x-st4i-bien-dich": g.kiemBienDich };
      // ★ Đợt 9 — lượt hỏng (lỗi gọi / chữ rỗng) ⇒ hỏi sức khoẻ; server chết ⇒ DỪNG NGAY, KHÔNG chấm lượt này (lỗi máy, không
      // phải lỗi model), ghi báo cáo phần đã xong rồi thoát 2.
      // ★ v1 (2026-10-22, A/B lần 3: HTTP 500 "khe bị khoá" bị CHẤM thành trượt 20–40 ms/lượt) — server sản phẩm trả LỖI ⇒ lỗi
      // hạ tầng/định tuyến, không phải câu trả lời của model ⇒ dừng, không chấm.
      if ((CONFIG === "v1" || CONFIG === "pipeline") && g.err) {
        dungSom = { id: b.id, luot, nhanh, loi: `v1 trả lỗi: ${String(g.err).slice(0, 200)}`, luc: new Date().toISOString() };
        break;
      }
      if (GOI_MODEL && (g.err || !g.text) && !(await kiemSong(`SAU lượt ${b.id}#${luot}`, false))) {
        dungSom = { id: b.id, luot, nhanh, loi: String(g.err ?? "chữ rỗng").slice(0, 200), luc: new Date().toISOString() };
        break;
      }
      // ★ Đợt 9 (dieu-phoi) — KIỂM NHÁNH của --ab-kiem: "tat" mà server vẫn chạy vòng (header khác vắng/`ok=skip`) ⇒ công tắc
      // không hiệu lực; "bat" mà KHÔNG có header ⇒ cờ server không có `v1`. Cả hai ⇒ DỪNG, số vô giá trị (exit 2 ở dưới).
      if (AB_KIEM && !g.err) {
        const h = g.hdr?.["x-st4i-bien-dich"];
        const hong = nhanh === "tat" && h && h !== "ok=skip" ? `nhánh tat có header "${h}"` : nhanh === "bat" && !h ? `nhánh bat KHÔNG có tóm tắt vòng kiểm (cờ server thiếu ${CONFIG === "pipeline" ? "tro-ly" : "v1"}?)` : null;
        if (hong) {
          dungSom = { id: b.id, luot, nhanh, loi: `KIỂM NHÁNH HỎNG: ${hong}`, luc: new Date().toISOString() };
          console.error(`\n⛔ ${dungSom.loi} — dừng, vứt số.`);
          break;
        }
      }
      // Chấm song song với lượt sinh kế tiếp (CPU ↔ GPU), giới hạn SONG_SONG_CHAM.
      while (dangCham.size >= SONG_SONG_CHAM) await Promise.race(dangCham);
      const p = cham(b, luot, g, nhanh).catch((e) => console.error(`  ⚠ lỗi chấm ${b.id}: ${e?.stack ?? e}`)).finally(() => dangCham.delete(p));
      dangCham.add(p);
    }
    if (dungSom) break;
  }
  if (dungSom) break;
}
await Promise.all(dangCham);
const songSau = dungSom ? false : await kiemSong("SAU khi đo", false);
const MODEL_CUOI = GOI_MODEL && DUNG_KHE ? await goi.modelDangChay() : null;
if (MODEL_DAU && MODEL_CUOI !== MODEL_DAU) console.error(`⚠ model :8091 ĐỔI giữa lượt: đầu ${MODEL_DAU} · cuối ${MODEL_CUOI ?? "không đọc được"}`);
xoaThuMuc(WORK);
KHOA?.go();

// ── BÁO CÁO ──────────────────────────────────────────────────────────────────────────────────────────
rows.sort((a, b) => (a.id === b.id ? (a.luot === b.luot ? String(a.nhanh).localeCompare(String(b.nhanh)) : a.luot - b.luot) : a.id < b.id ? -1 : 1));
const bang = AB_KIEM
  ? ["tat", "bat"].map((n) => bangTomTat(rows.filter((r) => r.nhanh === n), { tieuDe: `${LABEL} [${n}] — đường (a) một lượt, config=${CONFIG}, seed=${SEED}` })).join("\n")
  : bangTomTat(rows, { tieuDe: `${LABEL} — đường (a) một lượt, config=${CONFIG}, seed=${SEED}` });
console.log(bang);
if (AB_KIEM) {
  // Cặp (bài, lượt) có CẢ hai nhánh: bật đạt/tắt trượt vs ngược lại — chênh thuần của vòng kiểm.
  const cap = new Map();
  for (const r of rows) cap.set(`${r.id}#${r.luot}`, { ...(cap.get(`${r.id}#${r.luot}`) ?? {}), [r.nhanh]: r.dat });
  const du = [...cap.entries()].filter(([, v]) => "tat" in v && "bat" in v);
  const loi = du.filter(([, v]) => v.bat && !v.tat).map(([k]) => k);
  const hai = du.filter(([, v]) => !v.bat && v.tat).map(([k]) => k);
  console.log(` A/B cặp đủ hai nhánh: ${du.length} · bật ĐẠT/tắt TRƯỢT ${loi.length} [${loi.join(", ")}] · bật TRƯỢT/tắt ĐẠT ${hai.length} [${hai.join(", ")}]`);
}
const lat = rows.map((r) => r.totalMs).filter((x) => x);
if (CONFIG === "v1" || CONFIG === "pipeline") {
  // ★ Đợt 9 — server đã làm gì với vòng kiểm biên dịch (header `x-st4i-bien-dich`; vắng = cờ tắt / không phải code.plc).
  const dem = {};
  for (const r of rows) {
    const h = r.hdr?.["x-st4i-bien-dich"];
    const k = !h ? "(không header)" : h === "ok=skip" ? "bo-qua" : (/trang-thai=([a-z-]+)/.exec(h)?.[1] ?? h);
    dem[k] = (dem[k] ?? 0) + 1;
  }
  console.log(` vòng kiểm biên dịch (server): ${Object.entries(dem).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
}
if (GOI_MODEL && lat.length) console.log(` độ trễ sinh: trung vị ${trungVi(lat)} ms · max ${Math.max(...lat)} ms · token ra trung vị ${trungVi(rows.map((r) => r.genTok))}`);
const dirBc = `${BO}/reports`;
fs.mkdirSync(dirBc, { recursive: true });
fs.writeFileSync(`${dirBc}/${LABEL}.json`, JSON.stringify({
  label: LABEL, duong: "a-mot-luot", config: CONFIG, seed: SEED, n: N, soLuot: SO_LUOT, luc: new Date().toISOString(),
  base: CONFIG === "pipeline" || CONFIG === "v1" ? TUY_CHON.base : null,
  v1: CONFIG === "v1" ? { model: arg("--v1-model", "code.plc"), tokenTen: TOKEN_V1?.ten ?? null, tokenId: TOKEN_V1?.id ?? null, tokenTienTo: TOKEN_V1?.tienTo ?? null } : null, rawUrl: CONFIG === "raw" ? TUY_CHON.rawUrl : null, maxTokens: GOI_MODEL ? TUY_CHON.maxTokens : null,
  abKiem: AB_KIEM, noiTiepTu: NOI_TIEP, khongNghi: co("--khong-nghi"), sampling: arg("--sampling", "hien-tai"), vongSua: VONG_SUA, stTrinhDich: ST_TRINH_DICH, stPhuongNgu: ST_PHUONG_NGU,
  modelDau: MODEL_DAU, modelCuoi: MODEL_CUOI, dungSom, songSau,
  bai: DS.map((b) => ({ id: b.id, lang: b.lang, muc: b.muc, vanTay: b.vanTay })), bang, rows,
}, null, 1));
console.log(` báo cáo: ${path.join(dirBc, `${LABEL}.json`)}`);
if (dungSom || !songSau || (MODEL_DAU && MODEL_CUOI !== MODEL_DAU)) {
  console.error(
    `\n⛔ LƯỢT KHÔNG TRỌN: ${dungSom ? `dừng sớm sau ${dungSom.id}#${dungSom.luot}${dungSom.nhanh ? `[${dungSom.nhanh}]` : ""} (${dungSom.loi})` : !songSau ? "server không khoẻ SAU khi đo" : "model đổi giữa lượt"}` +
      ` — báo cáo ĐÃ GHI ${rows.length} lượt hợp lệ (dungSom/songSau/modelDau/modelCuoi trong JSON). KHÔNG ghi sổ nguyên trạng.`,
  );
  process.exit(2);
}

const dat = rows.filter((r) => r.dat).length;
const KY_VONG = { mau: rows.length, khung: 0, sai: 0 };
if (CONFIG in KY_VONG) {
  const ok = dat === KY_VONG[CONFIG] && rows.length === DS.length * SO_LUOT;
  console.log(` KIỂM THƯỚC (a) ${CONFIG}: ${ok ? "ĐẠT" : "HỎNG — VỨT MỌI SỐ ĐO CHO TỚI KHI SỬA BỘ ĐO"} (kỳ vọng ${KY_VONG[CONFIG]}/${rows.length}, được ${dat}/${rows.length})`);
  process.exit(ok ? 0 : 1);
}
