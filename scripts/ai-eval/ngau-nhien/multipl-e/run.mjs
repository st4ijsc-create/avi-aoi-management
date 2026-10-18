/**
 * LÁT CHUẨN CÔNG KHAI MultiPL-E (HumanEval + MBPP dịch đa ngôn ngữ) — để SO SÁNH, báo RIÊNG, KHÔNG trộn vào số chính.
 *
 * ⚠⚠ RỦI RO NHIỄM DỮ LIỆU HUẤN LUYỆN: HumanEval (2021) và MBPP (2021) cùng bản dịch MultiPL-E (2022) công khai trên
 *   GitHub/HuggingFace nhiều năm — model hiện đại gần như chắc chắn đã thấy đề (có thể cả lời giải). Điểm cao ở đây
 *   KHÔNG chứng minh năng lực tổng quát; dùng để đặt model cạnh bảng công bố, còn kết luận dựa trên KHO bài mới
 *   (`mot-luot.mjs`/`agent.mjs`). Mỗi báo cáo in lại cảnh báo này.
 *
 * Dữ liệu: `node scripts/ai-eval/ngau-nhien/multipl-e/tai.mjs` (một lần) ⇒ tmp/ngau-nhien/multipl-e/.
 *
 *   --config raw | pipeline     đo (raw = llama-server; pipeline = /api/ai/local-kb/stream, CHỈ chế độ chat)
 *   --config mau | sai | rong | mau-chat   KIỂM THƯỚC trên 3 bài cố định mỗi ngôn ngữ (mau.json): mau ⇒ 100 %,
 *                               sai/rong ⇒ 0 %, mau-chat (lời giải mẫu bọc thành câu trả lời chat ⇒ qua bộ ghép chat) ⇒ 100 %
 *   --che-do hoan-thanh | chat  hoan-thanh = giao thức GỐC (prompt thô + stop token, /v1/completions); chat = model chat
 *                               trả cả hàm (khác giao thức gốc — xem ghep.mjs)
 *   --ngon-ngu py,cpp,cs,go,java,js,rs,ts   --bo humaneval,mbpp   --seed <chuỗi>   --n <số bài MỖI ngôn ngữ> (mặc định 10)
 *   --max-tokens (hoan-thanh 1024 · chat 16000) · --khong-nghi · --sampling · --raw-url · --model · --label · --du-lieu
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, BO, coToolchain } from "../lib/moiTruong.mjs";
import { taoRng, xao } from "../lib/chon.mjs";
import { taoGoiModel, tuyChonTuArgs } from "../lib/goiModel.mjs";
import { trungVi } from "../lib/baoCao.mjs";
import { xoaThuMuc } from "../lib/cham.mjs";
import { NGON_NGU_MPE, docBo, ghepHoanThanh, ghepChat, khoiMaChat, cauHoiChat, tenHam } from "./ghep.mjs";
import { chayLo } from "./chay.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const CONFIG = arg("--config", "raw");
if (!["raw", "pipeline", "mau", "sai", "rong", "mau-chat"].includes(CONFIG)) { console.error(`--config lạ: ${CONFIG}`); process.exit(2); }
const CHE_DO = CONFIG === "mau-chat" || CONFIG === "pipeline" ? "chat" : arg("--che-do", "hoan-thanh");
if (!["hoan-thanh", "chat"].includes(CHE_DO)) { console.error(`--che-do lạ: ${CHE_DO}`); process.exit(2); }
const GOI_MODEL = CONFIG === "raw" || CONFIG === "pipeline";
const DU_LIEU = path.resolve(arg("--du-lieu", `${ROOT}/tmp/ngau-nhien/multipl-e`));
const NGON_NGU = arg("--ngon-ngu", NGON_NGU_MPE.join(",")).split(",").filter((l) => NGON_NGU_MPE.includes(l));
const BO_DE = arg("--bo", "humaneval,mbpp").split(",");
const SEED = arg("--seed", null) ?? `t${Date.now()}`;
const N = Number(arg("--n", 10));
const LABEL = arg("--label", `MPE-${CONFIG}-${CHE_DO}-1`);
const WORK = `${ROOT}/tmp/ngau-nhien-work/mpe-${LABEL}-${process.pid}`;
const MAU = JSON.parse(fs.readFileSync(new URL("./mau.json", import.meta.url), "utf8"));
const CO_DINH = ["HumanEval_0_has_close_elements", "HumanEval_23_strlen", "HumanEval_53_add"];

if (!fs.existsSync(`${DU_LIEU}/nguon.json`)) { console.error(`⛔ Chưa có dữ liệu ở ${DU_LIEU} — chạy multipl-e/tai.mjs trước.`); process.exit(2); }
const KIEU = { py: "pytest", go: "go", rs: "cargo" };
const thieu = NGON_NGU.filter((l) => KIEU[l] && !coToolchain(KIEU[l]));
if (thieu.length) { console.error(`⛔ Thiếu toolchain: ${thieu.join(", ")}`); process.exit(2); }

// ── CHỌN BÀI ─────────────────────────────────────────────────────────────────────────────────────────
const chon = [];
for (const l of NGON_NGU) {
  const theoBo = Object.fromEntries(BO_DE.map((b) => [b, docBo(DU_LIEU, b, l)]).filter(([, r]) => r.length));
  if (!Object.keys(theoBo).length) { console.error(`  ⚠ ${l}: không có dữ liệu cho bộ ${BO_DE.join(",")} — bỏ`); continue; }
  if (!GOI_MODEL) {
    const ten = CONFIG === "sai" ? ["HumanEval_23_strlen"] : CO_DINH;
    for (const n of ten) {
      const r = (theoBo.humaneval ?? []).find((x) => x.name === n);
      if (r) chon.push(r); else console.error(`  ⚠ ${l}: thiếu bài kiểm thước ${n}`);
    }
    continue;
  }
  // Phân tầng theo bộ đề: luân phiên humaneval / mbpp (xáo theo seed + ngôn ngữ).
  const rng = taoRng(`${SEED}:${l}`);
  const hang = Object.keys(theoBo).sort().map((b) => xao(theoBo[b], rng));
  for (let i = 0; chon.filter((r) => r.lang === l).length < N && hang.some((h) => i < h.length); i++) {
    for (const h of hang) if (i < h.length && chon.filter((r) => r.lang === l).length < N) chon.push(h[i]);
  }
}
console.error(`ℹ ${LABEL}: config=${CONFIG} · chế độ=${CHE_DO} · seed=${SEED} · ${chon.length} bài (${NGON_NGU.join(",")})`);
console.error("⚠ MultiPL-E/HumanEval/MBPP công khai từ 2021–2022 ⇒ NGUY CƠ NHIỄM DỮ LIỆU HUẤN LUYỆN — báo riêng, không trộn vào số chính.");

// ── SINH ─────────────────────────────────────────────────────────────────────────────────────────────
const tuyChon = tuyChonTuArgs(args, CHE_DO === "chat" ? 16000 : 1024);
let goi = taoGoiModel(tuyChon);
if (CONFIG === "pipeline") {
  const { ck } = await import("../../codegen-chay-duoc/cookie.mjs");
  goi = taoGoiModel({ ...tuyChon, cookie: ck(arg("--cookie", `${ROOT}/tmp/audit-ai/ck.txt`)) });
}
if (GOI_MODEL) await goi.kiemSong("TRƯỚC khi đo", { pipeline: CONFIG === "pipeline" });

function hoanThanhGia(r) {
  if (CONFIG === "rong") return "";
  const bang = CONFIG === "sai" ? MAU.sai : MAU.mau;
  if (r.lang === "py") return CONFIG === "sai" ? bang.py?.[r.name] ?? "" : r.canonical;
  return bang[r.lang]?.[r.name] ?? "";
}

const hangKq = [];
for (const r of chon) {
  process.stderr.write(`▶ ${r.lang} ${r.name} … `);
  let g, prog;
  if (GOI_MODEL) {
    try {
      g = CHE_DO === "hoan-thanh" ? await goi.hoanThanhRaw(r.prompt, r.stop)
        : CONFIG === "pipeline" ? await goi.chatPipeline(cauHoiChat(r)) : await goi.chatRaw(null, cauHoiChat(r));
    } catch (e) { g = { text: "", err: String(e).slice(0, 300), cut: false }; }
  } else if (CONFIG === "mau-chat") {
    // Câu trả lời chat GIẢ: prompt (chữ ký + chú thích) + phần hoàn thành mẫu + đóng hàm nếu tests mở bằng `}`.
    const dong = /^\s*\}/.test(r.tests) && r.lang !== "py" ? (r.lang === "java" || r.lang === "cs" ? "    }\n" : "}\n") : "";
    const than = r.lang === "py" ? r.canonical : MAU.mau[r.lang]?.[r.name] ?? "";
    const hamDayDu = r.lang === "java" || r.lang === "cs"
      ? `class Problem {\n${r.prompt.slice(r.prompt.indexOf("class Problem {") + "class Problem {".length)}${than}${dong}}\n`
      : `${r.prompt}${than}${dong}`;
    g = { text: `Đây là lời giải:\n\n\`\`\`\n${hamDayDu}\`\`\`\n`, totalMs: 0, cut: false };
  } else {
    g = { text: hoanThanhGia(r), totalMs: 0, cut: false };
  }
  try {
    prog = CHE_DO === "hoan-thanh" ? ghepHoanThanh(r, g.text) : ghepChat(r, khoiMaChat(g.text, tenHam(r)));
  } catch (e) {
    prog = null;
    g.err = (g.err ? g.err + " · " : "") + `ghép hỏng: ${e.message}`;
  }
  hangKq.push({ ...r, prompt: undefined, tests: undefined, stop: undefined, canonical: undefined, g, prog });
  process.stderr.write(`${g.err ? `lỗi ${g.err} ` : ""}${g.cut ? "CỤT " : ""}${g.totalMs ?? 0} ms${g.genTok ? ` · ${g.genTok} tok` : ""}\n`);
}
if (GOI_MODEL) await goi.kiemSong("SAU khi đo", { pipeline: CONFIG === "pipeline" });

// ── CHẤM theo lô ngôn ngữ ────────────────────────────────────────────────────────────────────────────
for (const l of NGON_NGU) {
  const lo = hangKq.filter((h) => h.lang === l && h.prog);
  if (!lo.length) continue;
  process.stderr.write(`⚙ chấm ${l} (${lo.length}) … `);
  const kq = await chayLo(l, lo.map((h) => ({ khoa: h.name, prog: h.prog })), { goc: `${WORK}/${l}`, duLieu: DU_LIEU });
  for (const h of lo) Object.assign(h, kq.get(h.name));
  process.stderr.write(`${lo.filter((h) => h.dat).length}/${lo.length}\n`);
}
xoaThuMuc(WORK);

// ── BÁO CÁO ──────────────────────────────────────────────────────────────────────────────────────────
const dong = [];
dong.push(`\n══ ${LABEL} — MultiPL-E (${CHE_DO}), config=${CONFIG}, seed=${SEED} — ⚠ NGUY CƠ NHIỄM: báo riêng, không trộn số chính ══`);
dong.push("| ngôn ngữ | humaneval | mbpp | TỔNG pass@1 | cụt |");
dong.push("|---|---|---|---|---|");
const ty = (xs) => (xs.length ? `${xs.filter((h) => h.dat).length}/${xs.length}` : "—");
for (const l of [...NGON_NGU, null]) {
  const g = l ? hangKq.filter((h) => h.lang === l) : hangKq;
  if (!g.length) continue;
  const d = g.filter((h) => h.dat).length;
  dong.push(`| ${l ?? "**TỔNG**"} | ${ty(g.filter((h) => h.bo === "humaneval"))} | ${ty(g.filter((h) => h.bo === "mbpp"))} | **${d}/${g.length} = ${Math.round((100 * d) / g.length)} %** | ${g.filter((h) => h.g.cut).length} |`);
}
const cut = hangKq.filter((h) => h.g.cut).length;
if (cut) dong.push(` ⚠ ${cut} lượt CỤT ⇒ số là chặn dưới.`);
if (GOI_MODEL) dong.push(` độ trễ trung vị ${trungVi(hangKq.map((h) => h.g.totalMs))} ms · token ra trung vị ${trungVi(hangKq.map((h) => h.g.genTok))}`);
const bang = dong.join("\n");
console.log(bang);
fs.mkdirSync(`${BO}/reports`, { recursive: true });
const nguon = JSON.parse(fs.readFileSync(`${DU_LIEU}/nguon.json`, "utf8"));
fs.writeFileSync(`${BO}/reports/${LABEL}.json`, JSON.stringify({
  label: LABEL, lat: "multipl-e", canhBao: "NGUY CƠ NHIỄM DỮ LIỆU HUẤN LUYỆN — không trộn vào số chính", config: CONFIG, cheDo: CHE_DO,
  seed: SEED, nMoiNgonNgu: N, luc: new Date().toISOString(), duLieu: nguon, tuyChon: GOI_MODEL ? tuyChon : null, bang,
  rows: hangKq.map((h) => ({ name: h.name, lang: h.lang, bo: h.bo, dat: !!h.dat, hetGio: !!h.hetGio, cut: h.g.cut, err: h.g.err ?? null,
    totalMs: h.g.totalMs ?? null, genTok: h.g.genTok ?? null, duoiRa: h.dat ? undefined : h.duoiRa, vanBan: GOI_MODEL ? (h.g.text ?? "").slice(0, 20000) : undefined })),
}, null, 1));
console.log(` báo cáo: ${BO}/reports/${LABEL}.json`);

if (!GOI_MODEL) {
  const d = hangKq.filter((h) => h.dat).length;
  const ok = CONFIG === "mau" || CONFIG === "mau-chat" ? d === hangKq.length && hangKq.length > 0 : d === 0;
  console.log(` KIỂM THƯỚC MultiPL-E ${CONFIG}: ${ok ? "ĐẠT" : "HỎNG — VỨT SỐ CỦA LÁT NÀY CHO TỚI KHI SỬA"} (${d}/${hangKq.length})`);
  process.exit(ok ? 0 : 1);
}
