/**
 * Nạp ngân hàng bài: `bai.json` của bộ này + bài TÁI DÙNG từ bộ F (`codegen-chay-duoc/agent-f/bai.json` — cùng dự án,
 * cùng test ẩn, cùng lời giải mẫu; chỉ đổi câu hỏi từ "dự án {DA}" sang "dự án này" vì workspace VSCode CHÍNH LÀ dự án).
 * Mọi đường trả về là TUYỆT ĐỐI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ROOT = path.resolve(BO, "../../..");
const BO_F = path.join(ROOT, "scripts/ai-eval/codegen-chay-duoc/agent-f");

const cauHoiTuF = (s) => s.replaceAll("{DA}/", "").replaceAll("Trong dự án {DA}", "Trong dự án này").replaceAll("{DA}", "này");

/**
 * Ngân hàng bài NGOÀI (2026-10-18, bộ đo ngẫu nhiên `scripts/ai-eval/ngau-nhien/vscode.mjs`): `AI_EVAL_NGAN_HANG` = đường
 * module có `docNganHangVscode()` trả bài cùng hình dạng (nguonAbs/anAbs/mauAbs tuyệt đối). Vắng ⇒ ngân hàng của bộ này.
 */
const NGAN_HANG_NGOAI = process.env.AI_EVAL_NGAN_HANG
  ? await import(pathToFileURL(path.resolve(process.env.AI_EVAL_NGAN_HANG)).href)
  : null;

export function docNganHang() {
  if (NGAN_HANG_NGOAI) return NGAN_HANG_NGOAI.docNganHangVscode();
  const dsF = JSON.parse(fs.readFileSync(path.join(BO_F, "bai.json"), "utf8"));
  const ds = JSON.parse(fs.readFileSync(path.join(BO, "bai.json"), "utf8")).map((b) => {
    if (b.boF) {
      const f = dsF.find((x) => x.id === b.boF);
      if (!f) throw new Error(`bài bộ F không có: ${b.boF}`);
      return {
        ...f,
        ...b,
        cauHoi: cauHoiTuF(f.cauHoi),
        nguonAbs: path.join(ROOT, "sandbox-projects/agent-f", f.id),
        phuAbs: null,
        anAbs: path.join(BO_F, "an", f.id),
        mauAbs: path.join(BO_F, "mau", f.id),
        nguonGoc: `bộ F (${f.id})`,
      };
    }
    const nguonAbs = b.nguon.startsWith("sandbox-projects/") ? path.join(ROOT, b.nguon) : path.join(BO, b.nguon);
    return {
      ...b,
      nguonAbs,
      phuAbs: b.phu ? path.join(BO, b.phu) : null,
      anAbs: path.join(BO, "an", b.id),
      mauAbs: path.join(BO, "mau", b.id),
      nguonGoc: b.nguon.startsWith("sandbox-projects/agentic") ? "agentic A1/A2" : "mới (vscode-e2e)",
    };
  });
  // Bài thiếu thư mục dự án / test ẩn / lời giải mẫu là BỘ ĐO HỎNG — dừng ngay, không để nó thành "model trượt".
  for (const b of ds) {
    for (const [ten, p] of [["dự án", b.nguonAbs], ["lời giải mẫu", b.mauAbs], ...b.testAn.map((t) => ["test ẩn", path.join(b.anAbs, t)])]) {
      if (!fs.existsSync(p)) throw new Error(`bài ${b.id}: thiếu ${ten} ${p}`);
    }
  }
  return ds;
}
