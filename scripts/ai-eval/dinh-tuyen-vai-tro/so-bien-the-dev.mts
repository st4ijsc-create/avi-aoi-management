/**
 * Đợt 7.3 — SO BIẾN THỂ tầng 4 trên bộ DEV (`cau-hoi-dev.jsonl`, 60 câu) — KHÔNG chạm bộ đo 100 câu.
 *   npx tsx scripts/ai-eval/dinh-tuyen-vai-tro/so-bien-the-dev.mts
 * Biến thể: tiền tố chỉ dẫn (cả hai / chỉ câu hỏi / không) × gộp (max / tâm cụm) × có/không TÍN HIỆU CHỮ (từ khoá tất định).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cauMauTheoVaiTro, TIEN_TO_NHUNG } from "../../../server/services/ai/soModel/phanLoaiNguNghia";
import { vaiTroTuCauHoi } from "../../../shared/aiRoles";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const tep = process.argv[2] ?? "cau-hoi-dev.jsonl";
const cau = fs.readFileSync(path.join(DIR, tep), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as { cauHoi: string; vaiTro: string });
const MODEL = path.join(process.env.GGUF_MODELS_DIR || "D:/SOURCES/16.AI", "Qwen3-Embedding-0.6B-f16.gguf");
const { getLlama } = await import("node-llama-cpp");
const llama = await getLlama();
const model = await llama.loadModel({ modelPath: MODEL });
const ctx = await model.createEmbeddingContext();
const nhung = async (t: string) => [...(await ctx.getEmbeddingFor(t)).vector];
const cos = (a: number[], b: number[]) => {
  let t = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { t += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return t / Math.sqrt(x * y);
};
const mauChu = cauMauTheoVaiTro();
const ketQua: string[] = [];
for (const tienTo of ["ca-hai", "chi-cau-hoi", "khong"] as const) {
  const pMau = tienTo === "ca-hai" ? TIEN_TO_NHUNG : "";
  const pHoi = tienTo === "khong" ? "" : TIEN_TO_NHUNG;
  const mau = new Map<string, number[][]>();
  for (const [vt, ds] of mauChu) mau.set(vt, await Promise.all(ds.map((c) => nhung(pMau + c))));
  const vec = await Promise.all(cau.map((c) => nhung(pHoi + c.cauHoi)));
  for (const gop of ["max", "tam"] as const) {
    for (const chu of [false, true]) {
      let dung = 0;
      cau.forEach((c, i) => {
        let du: string | null = chu ? vaiTroTuCauHoi(c.cauHoi)?.vaiTro ?? null : null;
        if (!du) {
          let best = "chat", bd = -2;
          for (const [vt, vs] of mau) {
            const d = gop === "max" ? Math.max(...vs.map((v) => cos(vec[i], v))) : cos(vec[i], vs[0].map((_, k) => vs.reduce((s, v) => s + v[k], 0) / vs.length));
            if (d > bd) { bd = d; best = vt; }
          }
          du = best;
        }
        if (du === c.vaiTro) dung++;
      });
      ketQua.push(`| ${tienTo} | ${gop} | ${chu ? "có" : "không"} | ${dung}/${cau.length} |`);
    }
  }
}
console.log(`\n${tep}\n| tiền tố | gộp | tín hiệu chữ | đúng |\n|---|---|---|---|\n${ketQua.join("\n")}`);
await ctx.dispose();
await model.dispose();
