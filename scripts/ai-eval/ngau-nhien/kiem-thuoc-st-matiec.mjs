/**
 * ★★ Đợt 9 — KIỂM THƯỚC bài ST (plc-st-v1) trên trình dịch MATIEC của OpenPLC v3 (bench) — TRƯỚC khi đo model trên nó.
 *   AI_EVAL_ST_TRINH_DICH=matiec [AI_EVAL_ST_DONG_HO=chuan|gia] [AI_EVAL_ST_MATIEC_CHE_DO=noi|nghiem] \
 *     node scripts/ai-eval/ngau-nhien/kiem-thuoc-st-matiec.mjs [--only st-tv3-nhap-nhay,…] [--song-song 4]
 * Mỗi bài TRONG TẬP OpenPLC (`lib/st-matiec/tap-openplc.json`): mẫu ⇒ ĐẠT với ĐÚNG soTest · khung ⇒ TRƯỢT · đột biến
 * `sai` ⇒ TRƯỢT. Bài NGOÀI TẬP (giao diện không mang sang OpenPLC): mẫu PHẢI trượt (bằng chứng lý do loại còn đúng).
 * Lời giải mẫu không mang sang được (tên biến cục bộ) ⇒ `lib/st-matiec/mau-openplc/<id>/` (src + sai.json) — KHÔNG đổi kho.
 * Kèm: mã MẪU GỐC (không nới `;`) có qua cờ OpenPLC thật không. Lệch kỳ vọng ⇒ exit 1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./lib/moiTruong.mjs";
import { docKho } from "./lib/kho.mjs";
import { chamDuAn, dungKhung, apMau, apSai, xoaThuMuc, ST_TRINH_DICH } from "./lib/cham.mjs";
import { chaySTMatiec, lyDoNgoaiTapOpenplc } from "./lib/st-matiec/chaySTMatiec.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (ST_TRINH_DICH !== "matiec") { console.error("đặt AI_EVAL_ST_TRINH_DICH=matiec"); process.exit(2); }
// docKho bỏ bài ngoài tập khi trình dịch = matiec ⇒ đọc kho ở chế độ rusty để vẫn kiểm được "ngoài tập ⇒ mẫu trượt".
process.env.AI_EVAL_ST_TRINH_DICH = "rusty";
const DS = docKho({ only: arg("--only", null) }).filter((b) => b.lang === "st");
process.env.AI_EVAL_ST_TRINH_DICH = "matiec";
const SONG = Math.max(1, Number(arg("--song-song", 4)));
const WORK = `${ROOT}/tmp/ngau-nhien-work/kt-st-matiec-${process.pid}`;
const TAP = JSON.parse(fs.readFileSync(`${DIR}/lib/st-matiec/tap-openplc.json`, "utf8"));
const MAU_OPENPLC = `${DIR}/lib/st-matiec/mau-openplc`;

async function motBai(b0) {
  const rieng = `${MAU_OPENPLC}/${b0.id}`;
  const b = fs.existsSync(rieng) ? { ...b0, mauAbs: rieng, sai: JSON.parse(fs.readFileSync(`${rieng}/sai.json`, "utf8")) } : b0;
  const ngoai = lyDoNgoaiTapOpenplc(b.id);
  const kq = { id: b.id, loi: [], ngoai, mauRieng: b !== b0 };
  const d = `${WORK}/${b.id}`;
  const tong = b.soTest.hienThi + b.soTest.an;
  dungKhung(b, d);
  const k = await chamDuAn({ bai: b, thuMuc: d });
  kq.khung = k.dat ? "ĐẠT" : "trượt";
  if (k.dat) kq.loi.push("khung ĐẠT");
  dungKhung(b, d);
  apMau(b, d);
  fs.rmSync(`${d}/sai.json`, { force: true });
  const m = await chamDuAn({ bai: b, thuMuc: d });
  kq.mau = `${m.dem?.pass ?? 0}/${tong}`;
  if (ngoai) {
    if (m.dat) kq.loi.push("ngoài tập nhưng mẫu ĐẠT — xem lại tap-openplc.json");
  } else if (!m.dat || m.dem?.pass !== tong) {
    kq.loi.push(`mẫu ${kq.mau}`);
    kq.duoiMau = m.duoiRa?.slice(-1500);
  }
  const src = fs.readdirSync(`${d}/src`).filter((f) => /\.st$/i.test(f)).sort().map((f) => ({ ten: `src/${f}`, duong: `${d}/src/${f}` }));
  const n = await chaySTMatiec({ tep: src, thuMucViec: `${WORK}/_jobs` });
  kq.openplcNghiem = n.openplcNghiem;
  kq.loiNghiem = [...new Set((n.chanDoanNghiem ?? []).map((x) => x.thongDiep))].slice(0, 3);
  dungKhung(b, d);
  apSai(b, d);
  fs.rmSync(`${d}/sai.json`, { force: true });
  const s = await chamDuAn({ bai: b, thuMuc: d });
  kq.sai = s.dat ? "ĐẠT" : "trượt";
  if (s.dat) kq.loi.push("đột biến ĐẠT");
  // Đột biến phải trượt vì HÀNH VI (test chạy), không vì biên dịch hỏng — trượt biên dịch là bắt GIẢ.
  else if (!ngoai && !/\[chay\b/.test(s.duoiRa ?? "")) kq.loi.push("đột biến trượt ở BIÊN DỊCH, không phải ở test");
  xoaThuMuc(d);
  return kq;
}

const ra = [];
for (let i = 0; i < DS.length; i += SONG) ra.push(...(await Promise.all(DS.slice(i, i + SONG).map(motBai))));
console.log(`trình dịch matiec · đồng hồ ${process.env.AI_EVAL_ST_DONG_HO || "chuan"} · chế độ ${process.env.AI_EVAL_ST_MATIEC_CHE_DO || "noi"}`);
console.log("| bài | mẫu | khung | đột biến | mẫu gốc qua cờ OpenPLC | lệch kỳ vọng |\n|---|---|---|---|---|---|");
for (const k of ra) {
  const nhan = `${k.ngoai ? " (NGOÀI TẬP)" : ""}${k.mauRieng ? " (mẫu-openplc)" : ""}`;
  console.log(`| ${k.id}${nhan} | ${k.mau} | ${k.khung} | ${k.sai} | ${k.openplcNghiem ? "qua" : "TRƯỢT: " + k.loiNghiem.join(" / ")} | ${k.loi.join("; ")} |`);
}
const ok = ra.filter((k) => !k.loi.length).length;
const tap = ra.filter((k) => !k.ngoai);
const dem = (f) => tap.filter(f).length;
console.log(
  `\nĐẠT kỳ vọng ${ok}/${ra.length} · TẬP OpenPLC ${tap.length} bài: mẫu đạt đủ ${dem((k) => !k.loi.some((l) => l.startsWith("mẫu")))}/${tap.length}` +
    ` · khung trượt ${dem((k) => k.khung === "trượt")}/${tap.length} · đột biến bị bắt ${dem((k) => k.sai === "trượt")}/${tap.length}` +
    ` · ngoài tập mẫu trượt ${ra.filter((k) => k.ngoai && !k.loi.length).length}/${ra.length - tap.length}` +
    ` · mẫu gốc (chưa nới ;) qua cờ OpenPLC ${ra.filter((k) => k.openplcNghiem).length}/${ra.length}`,
);
for (const k of ra.filter((x) => x.duoiMau)) console.log(`\n── ${k.id} (mẫu)\n${k.duoiMau}`);
xoaThuMuc(WORK);
process.exit(ok === ra.length ? 0 : 1);
