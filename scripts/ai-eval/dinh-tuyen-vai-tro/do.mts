/**
 * ★★ Đợt 7.3 — ĐO tầng 4 (phân loại ngữ nghĩa) của bộ định tuyến vai trò trên 100 câu nhãn tay (`cau-hoi.jsonl`).
 *   npx tsx scripts/ai-eval/dinh-tuyen-vai-tro/do.mts [--nguong 0.55] [--cach-biet 0.02] [--quet]
 * Nhúng bằng ĐÚNG model embedding của sản phẩm (GGUF_EMBED_MODEL, mặc định Qwen3-Embedding-0.6B-f16) qua node-llama-cpp,
 * trong tiến trình riêng (không qua server). Câu đo KHÔNG được trùng câu mẫu (kiểm ở đầu — trùng ⇒ exit 1).
 * Chấm: câu dưới ngưỡng ⇒ rơi về vai trò mặc định của bề mặt chat = "chat" (đúng như sản phẩm sẽ làm).
 * `--quet`: bảng quét ngưỡng — CHỈ để tham khảo; số cổng là số ở tham số mặc định, chọn TRƯỚC khi đo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cauMauTheoVaiTro, chonVaiTroTheoNhung, tamCum, TIEN_TO_NHUNG } from "../../../server/services/ai/soModel/phanLoaiNguNghia";
import { vaiTroTuCauHoi } from "../../../shared/aiRoles";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const NGUONG = Number(arg("--nguong", "0.3"));
const CACH = Number(arg("--cach-biet", "0"));
const TEP = arg("--tep", "cau-hoi.jsonl");
const MODEL = path.join(process.env.GGUF_MODELS_DIR || "D:/SOURCES/16.AI", (process.env.GGUF_EMBED_MODEL || "Qwen3-Embedding-0.6B-f16").replace(/\.gguf$/i, "") + ".gguf");

const cau = fs.readFileSync(path.join(DIR, TEP), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as { cauHoi: string; vaiTro: string });
const mauChu = cauMauTheoVaiTro();
const tatCaMau = new Set([...mauChu.values()].flat().map((s) => s.trim().toLowerCase()));
const trung = cau.filter((c) => tatCaMau.has(c.cauHoi.trim().toLowerCase()));
if (trung.length) {
  console.error(`✗ ${trung.length} câu đo TRÙNG câu mẫu: ${trung.map((c) => c.cauHoi).join(" | ")}`);
  process.exit(1);
}

const { getLlama } = await import("node-llama-cpp");
const llama = await getLlama();
const model = await llama.loadModel({ modelPath: MODEL });
const ctx = await model.createEmbeddingContext();
const nhung = async (ts: string[]) => {
  const ra: number[][] = [];
  for (const t of ts) ra.push([...(await ctx.getEmbeddingFor(t)).vector]);
  return ra;
};
const mau = new Map<string, number[][]>();
for (const [vt, ds] of mauChu) mau.set(vt, [tamCum(await nhung(ds.map((c) => TIEN_TO_NHUNG + c)))]);
const vec = await nhung(cau.map((c) => TIEN_TO_NHUNG + c.cauHoi));

function cham(nguong: number, cach: number) {
  let dung = 0, roi = 0, plcSangSw = 0, swSangPlc = 0;
  const sai: string[] = [];
  const theoVt: Record<string, { dung: number; tong: number }> = {};
  cau.forEach((c, i) => {
    // Tầng 3 (tín hiệu chữ) trước — như bộ định tuyến sản phẩm; rồi tầng 4.
    const t3 = vaiTroTuCauHoi(c.cauHoi);
    const kq = t3 ? { vaiTro: t3.vaiTro, lyDo: `tầng 3: ${t3.bangChung}` } : chonVaiTroTheoNhung(vec[i], mau, nguong, cach);
    const du = kq.vaiTro ?? "chat";
    if (!kq.vaiTro) roi++;
    theoVt[c.vaiTro] ??= { dung: 0, tong: 0 };
    theoVt[c.vaiTro].tong++;
    if (du === c.vaiTro) { dung++; theoVt[c.vaiTro].dung++; }
    else sai.push(`[${c.vaiTro} → ${du}${kq.vaiTro ? "" : " (dưới ngưỡng)"}] ${c.cauHoi} — ${kq.lyDo}`);
    if (c.vaiTro === "code.plc" && du === "code.software") plcSangSw++;
    if (c.vaiTro === "code.software" && du === "code.plc") swSangPlc++;
  });
  return { dung, roi, plcSangSw, swSangPlc, sai, theoVt };
}

const kq = cham(NGUONG, CACH);
console.log(`\n══ tầng 4 — ngưỡng ${NGUONG}, cách biệt ${CACH}, model ${path.basename(MODEL)} ══`);
const kho = cau.map((c, i) => [c, i] as const).filter(([c]) => (c as { kho?: boolean }).kho);
const khoSai = kho.filter(([c]) => kq.sai.some((s) => s.includes(`] ${c.cauHoi} — `))).length;
console.log(`đúng ${kq.dung}/${cau.length} = ${Math.round((100 * kq.dung) / cau.length)} %${kho.length ? ` · câu khó ${kho.length - khoSai}/${kho.length}` : ""} · dưới ngưỡng (rơi về chat) ${kq.roi} · PLC→phần mềm ${kq.plcSangSw} · phần mềm→PLC ${kq.swSangPlc}`);
console.log("| vai trò | đúng |\n|---|---|");
for (const [vt, v] of Object.entries(kq.theoVt)) console.log(`| ${vt} | ${v.dung}/${v.tong} |`);
console.log("\nsai:\n" + kq.sai.map((s) => "  " + s).join("\n"));
if (process.argv.includes("--quet")) {
  console.log("\nQUÉT (tham khảo, không phải số cổng):\n| ngưỡng | cách biệt | đúng | rơi |\n|---|---|---|---|");
  for (const n of [0.4, 0.45, 0.5, 0.55, 0.6, 0.65]) for (const c of [0, 0.01, 0.02, 0.04]) {
    const k = cham(n, c);
    console.log(`| ${n} | ${c} | ${k.dung} | ${k.roi} |`);
  }
}
await ctx.dispose();
await model.dispose();
