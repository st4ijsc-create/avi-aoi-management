/**
 * ★★ Đợt 9 — KIỂM THƯỚC phương ngữ Siemens SCL cho plc-st-v1 (bộ chuẩn hoá `lib/st-scl/scl.mjs` + trình dịch ST).
 *   AI_EVAL_ST_PHUONG_NGU=scl [AI_EVAL_ST_TRINH_DICH=rusty|matiec] node scripts/ai-eval/ngau-nhien/kiem-thuoc-st-scl.mjs [--only …]
 * Mỗi bài (thước = lời giải SCL do agent viết TAY theo phong cách TIA, `lib/st-scl/mau-scl/<id>/` + sai.json):
 *   mau-scl     ⇒ ĐẠT đủ soTest            sai-scl  ⇒ TRƯỢT ở pha CHẠY (không phải biên dịch)
 *   khung-scl   (stSangScl của khung)  ⇒ TRƯỢT     vong-st  stSangScl(mẫu ST) ⇒ ĐẠT (khung hiển thị cho model chuẩn hoá lại được)
 *   dau-hieu    mẫu SCL có tên khối trong ngoặc kép + tham chiếu `#`
 * Lệch ⇒ exit 1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./lib/moiTruong.mjs";
import { docKho, lietKeTep } from "./lib/kho.mjs";
import { chamDuAn, dungKhung, apMau, xoaThuMuc, ST_PHUONG_NGU, ST_TRINH_DICH } from "./lib/cham.mjs";
import { stSangScl, dauHieuScl } from "./lib/st-scl/scl.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (ST_PHUONG_NGU !== "scl") { console.error("đặt AI_EVAL_ST_PHUONG_NGU=scl"); process.exit(2); }
const DS = docKho({ only: arg("--only", null) }).filter((b) => b.lang === "st");
const SONG = Math.max(1, Number(arg("--song-song", 4)));
const WORK = `${ROOT}/tmp/ngau-nhien-work/kt-st-scl-${process.pid}`;
const MAU_SCL = `${DIR}/lib/st-scl/mau-scl`;

const chiChay = (r) => /\[chay\b/.test(r.duoiRa ?? "");

async function motBai(b) {
  const kq = { id: b.id, loi: [] };
  const tong = b.soTest.hienThi + b.soTest.an;
  const d = `${WORK}/${b.id}`;
  const goc = `${MAU_SCL}/${b.id}`;
  if (!fs.existsSync(goc)) { kq.loi.push("thiếu mau-scl"); return kq; }
  const chepScl = () => { for (const rel of lietKeTep(`${goc}/src`)) fs.copyFileSync(`${goc}/src/${rel}`, `${d}/src/${rel}`); };
  // khung-scl
  dungKhung(b, d);
  for (const rel of b.tepGiai) fs.writeFileSync(`${d}/${rel}`, stSangScl(fs.readFileSync(`${d}/${rel}`, "utf8")));
  const k = await chamDuAn({ bai: b, thuMuc: d });
  kq.khung = k.dat ? "ĐẠT" : "trượt";
  if (k.dat) kq.loi.push("khung-scl ĐẠT");
  // mau-scl
  dungKhung(b, d);
  chepScl();
  const m = await chamDuAn({ bai: b, thuMuc: d });
  kq.mau = `${m.dem?.pass ?? 0}/${tong}`;
  if (!m.dat || m.dem?.pass !== tong) { kq.loi.push(`mau-scl ${kq.mau}`); kq.duoi = m.duoiRa?.slice(-1200); }
  const dh = b.tepGiai.map((rel) => dauHieuScl(fs.readFileSync(`${d}/${rel}`, "utf8")));
  kq.dauHieu = dh.every((x) => x.tenKhoiNgoacKep && x.soThamChieuThang > 0) ? "đủ" : "THIẾU";
  if (kq.dauHieu !== "đủ") kq.loi.push("mau-scl thiếu dấu hiệu SCL");
  // sai-scl
  dungKhung(b, d);
  chepScl();
  for (const s of JSON.parse(fs.readFileSync(`${goc}/sai.json`, "utf8"))) {
    const p = `${d}/${s.tep}`;
    const t = fs.readFileSync(p, "utf8");
    if (t.split(s.tu).length !== 2) { kq.loi.push(`sai-scl "${s.tu.slice(0, 40)}" không đúng 1 lần`); continue; }
    fs.writeFileSync(p, t.replace(s.tu, () => s.den));
  }
  const s = await chamDuAn({ bai: b, thuMuc: d });
  kq.sai = s.dat ? "ĐẠT" : chiChay(s) ? "trượt" : "trượt (biên dịch)";
  if (s.dat) kq.loi.push("sai-scl ĐẠT");
  else if (!chiChay(s)) kq.loi.push("sai-scl trượt ở BIÊN DỊCH");
  // vòng stSangScl(mẫu ST)
  dungKhung(b, d);
  // MATIEC: lời giải mẫu dùng tên cấm (dt/le) ⇒ bản mẫu-openplc như kiem-thuoc-st-matiec.mjs
  const mauOpenplc = `${DIR}/lib/st-matiec/mau-openplc/${b.id}`;
  apMau(ST_TRINH_DICH === "matiec" && fs.existsSync(mauOpenplc) ? { ...b, mauAbs: mauOpenplc } : b, d);
  fs.rmSync(`${d}/sai.json`, { force: true });
  for (const rel of b.tepGiai) fs.writeFileSync(`${d}/${rel}`, stSangScl(fs.readFileSync(`${d}/${rel}`, "utf8")));
  const v = await chamDuAn({ bai: b, thuMuc: d });
  kq.vong = `${v.dem?.pass ?? 0}/${tong}`;
  if (!v.dat || v.dem?.pass !== tong) { kq.loi.push(`vong-st ${kq.vong}`); kq.duoiVong = v.duoiRa?.slice(-800); }
  xoaThuMuc(d);
  xoaThuMuc(`${WORK}/_scl-${b.id}`);
  return kq;
}

const ra = [];
for (let i = 0; i < DS.length; i += SONG) ra.push(...(await Promise.all(DS.slice(i, i + SONG).map(motBai))));
console.log(`phương ngữ scl · trình dịch ${ST_TRINH_DICH}`);
console.log("| bài | mau-scl | khung-scl | sai-scl | vòng ST→SCL→ST | dấu hiệu | lệch |\n|---|---|---|---|---|---|---|");
for (const k of ra) console.log(`| ${k.id} | ${k.mau ?? "-"} | ${k.khung ?? "-"} | ${k.sai ?? "-"} | ${k.vong ?? "-"} | ${k.dauHieu ?? "-"} | ${k.loi.join("; ")} |`);
const dem = (f) => ra.filter(f).length;
console.log(
  `\nĐẠT kỳ vọng ${dem((k) => !k.loi.length)}/${ra.length} · mau-scl đạt đủ ${dem((k) => !k.loi.some((l) => l.startsWith("mau-scl ")))}/${ra.length}` +
    ` · khung-scl trượt ${dem((k) => k.khung === "trượt")}/${ra.length} · sai-scl bị bắt ở pha chạy ${dem((k) => k.sai === "trượt")}/${ra.length}` +
    ` · vòng ST→SCL→ST ${dem((k) => !k.loi.some((l) => l.startsWith("vong")))}/${ra.length}`,
);
for (const k of ra.filter((x) => x.duoi || x.duoiVong)) console.log(`\n── ${k.id}\n${k.duoi ?? ""}\n${k.duoiVong ?? ""}`);
xoaThuMuc(WORK);
process.exit(ra.every((k) => !k.loi.length) ? 0 : 1);
