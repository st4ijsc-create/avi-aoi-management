/**
 * Đợt 9 — chỉ TẦNG 3 (tín hiệu chữ, không nạp model): bao phủ + độ chính xác trên một bộ câu.
 *   npx tsx scripts/ai-eval/dinh-tuyen-vai-tro/tang3.mts <tệp.jsonl> [--sai]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vaiTroTuCauHoiTuDong } from "../../../shared/aiRoles";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const tep = process.argv[2] ?? "cau-hoi-dev-2.jsonl";
const cau = fs.readFileSync(path.join(DIR, tep), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l) as { cauHoi: string; vaiTro: string });
let phu = 0, dung = 0;
const sai: string[] = [];
for (const c of cau) {
  const k = vaiTroTuCauHoiTuDong(c.cauHoi);
  if (!k) continue;
  phu++;
  if (k.vaiTro === c.vaiTro) dung++;
  else sai.push(`[${c.vaiTro} → ${k.vaiTro}] ${c.cauHoi} — ${k.bangChung}`);
}
console.log(`${tep}: tầng 3 bắt ${phu}/${cau.length}, đúng ${dung}/${phu}`);
if (process.argv.includes("--sai")) console.log(sai.map((s) => "  " + s).join("\n"));
