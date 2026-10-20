/**
 * CHẤM LẠI một báo cáo đường (a) từ CÂU TRẢ LỜI ĐÃ LƯU (`rows[].vanBanGoc`) — KHÔNG gọi model.
 * Dùng khi THƯỚC (bộ trích / trình chấm) được sửa sau lượt đo: số mới so được với số cũ trên CÙNG câu trả lời.
 *   node scripts/ai-eval/ngau-nhien/cham-lai.mjs <nhãn báo cáo> [--song-song 3]
 * Ghi `reports/<nhãn>-cl.json` + in bảng mức × đạt, kèm số lượt ĐỔI kết quả so với báo cáo gốc.
 * Bài có vân tay khác lúc đo ⇒ BỎ (không chấm câu trả lời cũ bằng đề đã sửa).
 */
import fs from "node:fs";
import { BO, ROOT } from "./lib/moiTruong.mjs";
import { docKho } from "./lib/kho.mjs";
import { chamDuAn, dungKhung, ghiTep, xoaThuMuc } from "./lib/cham.mjs";
import { trichTep } from "./lib/trichTep.mjs";

const nhan = process.argv[2];
if (!nhan) { console.error("cần <nhãn báo cáo>"); process.exit(2); }
const i = process.argv.indexOf("--song-song");
const SONG_SONG = i > 0 ? Math.max(1, Number(process.argv[i + 1])) : 3;
const bc = JSON.parse(fs.readFileSync(`${BO}/reports/${nhan}.json`, "utf8"));
const kho = new Map(docKho({}).map((b) => [b.id, b]));
const goc = `${ROOT}/tmp/ngau-nhien-cham-lai/${nhan}-${process.pid}`;

const hang = bc.rows.filter((r) => r.vanBanGoc !== undefined);
const ra = [];
let boQua = 0;
let con = 0;
async function lam(r) {
  const b = kho.get(r.id);
  if (!b || b.vanTay !== r.vanTay) { boQua++; return; }
  const dir = `${goc}/${r.id}-${r.luot}`;
  dungKhung(b, dir);
  const tr = trichTep(r.vanBanGoc, b);
  let loiGhi = null;
  try { ghiTep(dir, tr.tep); } catch (e) { loiGhi = String(e.message ?? e); }
  const kq = await chamDuAn({ bai: b, thuMuc: dir });
  xoaThuMuc(dir);
  ra.push({ id: r.id, muc: r.muc, luot: r.luot, datCu: r.dat, dat: kq.dat && !loiGhi && tr.thieu.length === 0,
    lyDo: [...(tr.thieu.length ? [`THIEU_TEP:${tr.thieu.join("+")}`] : []), ...kq.lyDo], cach: tr.cach, dem: kq.dem, duoiRa: kq.duoiRa });
}
const viec = [...hang];
await Promise.all(Array.from({ length: SONG_SONG }, async () => {
  while (viec.length) { await lam(viec.shift()); con++; }
}));
const muc = ["thuat-toan", "thu-vien", "ung-dung"];
const dem = (f) => ra.filter(f).length;
console.log(`\n══ CHẤM LẠI ${nhan} — ${ra.length} lượt (bỏ ${boQua} vì vân tay đổi) ══`);
console.log(`| | ${muc.join(" | ")} | TỔNG |\n|---|---|---|---|---|`);
console.log(`| gốc | ${muc.map((m) => `${dem((x) => x.muc === m && x.datCu)}/${dem((x) => x.muc === m)}`).join(" | ")} | ${dem((x) => x.datCu)}/${ra.length} |`);
console.log(`| chấm lại | ${muc.map((m) => `${dem((x) => x.muc === m && x.dat)}/${dem((x) => x.muc === m)}`).join(" | ")} | **${dem((x) => x.dat)}/${ra.length} = ${Math.round((100 * dem((x) => x.dat)) / Math.max(1, ra.length))} %** |`);
console.log(`đổi: trượt→đạt ${dem((x) => !x.datCu && x.dat)} · đạt→trượt ${dem((x) => x.datCu && !x.dat)}`);
fs.writeFileSync(`${BO}/reports/${nhan}-cl.json`, JSON.stringify({ nhanGoc: nhan, luc: new Date().toISOString(), rows: ra }, null, 2));
xoaThuMuc(goc);
