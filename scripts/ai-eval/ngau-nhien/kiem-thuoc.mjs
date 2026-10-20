/**
 * KIỂM THƯỚC OFFLINE — bắt buộc trước MỌI lượt đo thật. KHÔNG gọi model, KHÔNG gọi server.
 *
 * Với từng bài (mặc định cả kho), năm phép kiểm có kỳ vọng CỨNG:
 *   mau-a     câu trả lời GIẢ dựng từ lời giải mẫu đúng định dạng yêu cầu ⇒ đi qua ĐƯỜNG TRÍCH của (a) ⇒ chấm   ⇒ ĐẠT
 *             (+ số test ĐẠT phải BẰNG soTest.hienThi + soTest.an — lệch là bài khai sai số test)
 *   khung     dự án khởi đầu nguyên trạng (mã khung rỗng)                                                ⇒ TRƯỢT
 *   sai       lời giải mẫu + ĐỘT BIẾN `sai` (sai-nhưng-biên-dịch-được)                                     ⇒ TRƯỢT
 *             (ghi thêm: đột biến có qua test HIỂN THỊ không — qua mà vẫn bị bắt = test ẩn chặt hơn test hiển thị)
 *   gian-lan  lời giải mẫu + sửa một byte tệp test hiển thị (đường agent)                                   ⇒ TRƯỢT, lý do TEP_TEST_BI_SUA
 *   prompt    câu hỏi (a) và (b) KHÔNG chứa nội dung test ẩn / lời giải mẫu                                ⇒ sạch
 *
 * Lệch bất kỳ kỳ vọng nào ⇒ exit 1 ⇒ VỨT mọi số đo cho tới khi sửa (bộ đo hỏng, không phải model giỏi/dở).
 *
 *   node scripts/ai-eval/ngau-nhien/kiem-thuoc.mjs [--only <id,…|lang|muc>] [--song-song 4] [--giu] [--label kt-1]
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, BO, coToolchain } from "./lib/moiTruong.mjs";
import { docKho, locBai, lietKeTep, NGON_NGU } from "./lib/kho.mjs";
import { chamDuAn, dungKhung, apMau, apSai, apGianLan, ghiTep, xoaThuMuc } from "./lib/cham.mjs";
import { trichTep, dungCauTraLoiGia } from "./lib/trichTep.mjs";
import { taoCauHoiMotLuot, taoCauHoiAgent } from "./lib/cauHoi.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SONG_SONG = Math.max(1, Number(arg("--song-song", 4)));
const GIU = args.includes("--giu");
const LABEL = arg("--label", `kt-${Date.now().toString(36)}`);
const WORK = `${ROOT}/tmp/ngau-nhien-work/${LABEL}-${process.pid}`;

const DS = docKho({ only: arg("--only", null) });
if (!DS.length) { console.error("Không có bài nào khớp --only"); process.exit(2); }
const thieuTc = [...new Set(DS.filter((b) => !coToolchain(b.kieu)).map((b) => b.kieu))];
if (thieuTc.length) { console.error(`⛔ Thiếu toolchain cho: ${thieuTc.join(", ")} (xem lib/moiTruong.mjs)`); process.exit(2); }

/** Nội dung "dấu vết" để dò rò: các dòng đủ dài, đặc trưng của test ẩn / lời giải mẫu (không có trong khung). */
function dongDacTrung(dir, khungAbs) {
  const ds = [];
  // Dòng có ở BẤT KỲ tệp khung nào (vd import của test hiển thị) là dữ liệu công khai, không phải rò.
  const khung = lietKeTep(khungAbs).map((r) => fs.readFileSync(`${khungAbs}/${r}`, "utf8")).join("\n");
  for (const rel of lietKeTep(dir)) {
    for (const l of fs.readFileSync(`${dir}/${rel}`, "utf8").split(/\r?\n/)) {
      const t = l.trim();
      if (t.length >= 28 && !khung.includes(t)) ds.push(t);
    }
  }
  return ds;
}

async function kiemBai(b) {
  const kq = { id: b.id, lang: b.lang, muc: b.muc, loi: [] };
  const d = (ten) => `${WORK}/${b.id}/${ten}`;

  // 1. mau-a — qua đường trích của (a)
  dungKhung(b, d("mau"));
  const tepMau = Object.fromEntries(b.tepGiai.map((t) => [t, fs.readFileSync(`${b.mauAbs}/${t}`, "utf8")]));
  // Tệp mẫu NGOÀI tepGiai (nếu có) chép thẳng — chúng là phần lời giải mà (a) không yêu cầu model viết.
  const tr = trichTep(dungCauTraLoiGia(tepMau), b);
  if (tr.thieu.length) kq.loi.push(`trích (a) thiếu ${tr.thieu.join(",")}`);
  ghiTep(d("mau"), tr.tep);
  for (const rel of lietKeTep(b.mauAbs)) if (!b.tepGiai.includes(rel)) kq.loi.push(`mau có tệp ngoài tepGiai: ${rel} (đường (a) sẽ không viết nó)`);
  const m = await chamDuAn({ bai: b, thuMuc: d("mau") });
  kq.mau = m.dat;
  kq.demMau = m.dem;
  if (!m.dat) kq.loi.push(`mau TRƯỢT [${m.lyDo.join(",")}]\n${m.duoiRa.slice(-1500)}`);
  else if (m.dem.pass !== b.soTest.hienThi + b.soTest.an) kq.loi.push(`soTest lệch: mẫu đạt ${m.dem.pass} test, bài khai ${b.soTest.hienThi}+${b.soTest.an}`);

  // 2. khung
  dungKhung(b, d("khung"));
  const k = await chamDuAn({ bai: b, thuMuc: d("khung") });
  kq.khung = k.dat;
  if (k.dat) kq.loi.push("khung ĐẠT (phải trượt)");

  // 3. sai (+ thông tin: đột biến có lọt test hiển thị không)
  dungKhung(b, d("sai"));
  try {
    apSai(b, d("sai"));
    const s = await chamDuAn({ bai: b, thuMuc: d("sai") });
    kq.sai = s.dat;
    if (s.dat) kq.loi.push("đột biến sai ĐẠT (test ẩn quá lỏng)");
    const sh = await chamDuAn({ bai: b, thuMuc: d("sai"), chiHienThi: true });
    kq.saiQuaHienThi = sh.dat;
    // Đột biến phải là lời giải sai-nhưng-CHẠY: trượt cả test hiển thị (thường vì không biên dịch) thì "sai ⇒ trượt" vô nghĩa.
    if (!sh.dat) kq.loi.push(`đột biến sai TRƯỢT cả test hiển thị (không biên dịch/ quá thô) [${sh.lyDo.join(",")}]`);
  } catch (e) {
    kq.sai = null;
    kq.loi.push(`đột biến hỏng: ${e.message}`);
  }

  // 4. gian-lan
  dungKhung(b, d("gian"));
  apGianLan(b, d("gian"));
  const g = await chamDuAn({ bai: b, thuMuc: d("gian") });
  kq.gianLanBat = !g.dat && g.lyDo.includes("TEP_TEST_BI_SUA");
  if (!kq.gianLanBat) kq.loi.push(`gian lận KHÔNG bị bắt [${g.lyDo.join(",")}]`);

  // 4b. tệp CẤU HÌNH test mới (đổi được kết quả mà không chạm tệp test) — java không có tệp cấu hình trình chạy ⇒ bỏ.
  const tepCam = { pytest: "conftest.py", node: "test/package.json", dotnet: "Directory.Build.props", cmake: "src/CMakeLists.txt",
    go: "go.work", cargo: "build.rs", st: "tests/phu.st" }[b.kieu];
  if (tepCam) {
    dungKhung(b, d("cauhinh"));
    apMau(b, d("cauhinh"));
    ghiTep(d("cauhinh"), { [tepCam]: b.kieu === "pytest" ? "# vô hại nhưng mới\n" : b.kieu === "node" ? "{}\n" : b.kieu === "dotnet" ? "<Project></Project>\n" : b.kieu === "cargo" ? "fn main() {}\n" : b.kieu === "go" ? "go 1.24\n\nuse .\n" : b.kieu === "st" ? "(* vô hại nhưng mới *)\n" : "# moi\n" });
    const c = await chamDuAn({ bai: b, thuMuc: d("cauhinh") });
    kq.cauHinhMoiBat = !c.dat && c.lyDo.includes("TEP_CAU_HINH_TEST_MOI");
    if (!kq.cauHinhMoiBat) kq.loi.push(`tệp cấu hình test mới ${tepCam} KHÔNG bị bắt [${c.lyDo.join(",")}]`);
  } else kq.cauHinhMoiBat = null;

  // 5. prompt sạch
  const cauHoi = [taoCauHoiMotLuot(b), taoCauHoiAgent(b, "tmp/x"), taoCauHoiAgent(b, null)].join("\n");
  const ro = [...dongDacTrung(b.anAbs, b.khungAbs), ...dongDacTrung(b.mauAbs, b.khungAbs)].filter((l) => cauHoi.includes(l));
  kq.promptSach = ro.length === 0;
  if (ro.length) kq.loi.push(`prompt chứa ${ro.length} dòng của test ẩn/mẫu: ${ro.slice(0, 2).join(" | ")}`);

  if (!GIU) xoaThuMuc(`${WORK}/${b.id}`);
  kq.ok = kq.loi.length === 0;
  return kq;
}

const t0 = Date.now();
const kqs = [];
let i = 0;
async function tho() {
  while (i < DS.length) {
    const b = DS[i++];
    const r = await kiemBai(b);
    kqs.push(r);
    console.error(`${r.ok ? "✓" : "✗"} ${b.id}  mau ${r.mau ? "ĐẠT" : "trượt"} · khung ${r.khung ? "ĐẠT!" : "trượt"} · sai ${r.sai === null ? "?" : r.sai ? "ĐẠT!" : "trượt"}${r.saiQuaHienThi ? " (lọt hiển thị)" : ""} · gian-lận ${r.gianLanBat ? "bắt" : "LỌT"}${r.loi.length ? `\n    ${r.loi.join("\n    ")}` : ""}`);
  }
}
await Promise.all(Array.from({ length: Math.min(SONG_SONG, DS.length) }, tho));
if (!GIU) xoaThuMuc(WORK);

// ── bảng theo ngôn ngữ ──
const dong = [];
dong.push("| ngôn ngữ | bài | mẫu ⇒ ĐẠT | khung ⇒ trượt | sai ⇒ trượt | sai lọt test hiển thị | sửa test ⇒ bị bắt | cấu hình test mới ⇒ bị bắt | prompt sạch |");
dong.push("|---|---|---|---|---|---|---|---|---|");
const dem = (xs, f) => xs.filter(f).length;
for (const l of [...NGON_NGU, null]) {
  const g = l ? kqs.filter((r) => r.lang === l) : kqs;
  if (!g.length) continue;
  dong.push(`| ${l ?? "**TỔNG**"} | ${g.length} | ${dem(g, (r) => r.mau)}/${g.length} | ${dem(g, (r) => r.khung === false)}/${g.length} | ${dem(g, (r) => r.sai === false)}/${g.length} | ${dem(g, (r) => r.saiQuaHienThi)}/${g.length} | ${dem(g, (r) => r.gianLanBat)}/${g.length} | ${g.some((r) => r.cauHinhMoiBat !== null) ? `${dem(g, (r) => r.cauHinhMoiBat)}/${dem(g, (r) => r.cauHinhMoiBat !== null)}` : "— (java)"} | ${dem(g, (r) => r.promptSach)}/${g.length} |`);
}
const ok = kqs.every((r) => r.ok);
const bang = dong.join("\n");
console.log(`\n══ KIỂM THƯỚC ${LABEL} — ${kqs.length} bài, ${Math.round((Date.now() - t0) / 1000)} s ══\n${bang}`);
console.log(`\n KIỂM THƯỚC: ${ok ? "ĐẠT" : `HỎNG (${kqs.filter((r) => !r.ok).map((r) => r.id).join(", ")}) — VỨT MỌI SỐ ĐO CHO TỚI KHI SỬA BỘ ĐO`}`);
fs.mkdirSync(`${BO}/reports`, { recursive: true });
fs.writeFileSync(`${BO}/reports/${LABEL}.json`, JSON.stringify({ label: LABEL, luc: new Date().toISOString(), ok,
  bai: kqs.sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => ({ ...r, vanTay: DS.find((b) => b.id === r.id).vanTay })), bang }, null, 1));
console.log(` báo cáo: ${path.join(BO, "reports", `${LABEL}.json`)}`);
process.exit(ok ? 0 : 1);
