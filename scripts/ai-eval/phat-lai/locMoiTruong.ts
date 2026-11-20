/**
 * PHATLAI-2 (HST 20/11 15:57, 16:27): bước lọc cờ agent cho `lenh.moiTruong` của fixture phát lại, TÁCH khỏi `main()` của dongGoi.ts để có
 * ca HÀNH VI (locMoiTruong.test.ts). THUẦN: không đọc tệp, không mạng, không CSDL. Commit tách GIỮ NGUYÊN hành vi của dongGoi.ts:50–62.
 *   noiDungEnv      — nội dung `.env` (dongGoi đọc tệp rồi đưa chữ vào đây).
 *   moiTruongThamSo — giá trị `--moi-truong K=V,K=V` (ghi đè / thêm).
 * Trả `co` (qua `locCo` của run-eval.mjs, hai lớp GIÁ TRỊ + TÊN), `boDi` (tên bị bỏ: boQua + tên ngoài tiền tố) và `dongBao` (dòng stderr
 * CHỈ TÊN; `null` khi không bỏ gì).
 */
import { locCo } from "../tasks/run-eval.mjs";

export function locMoiTruongFixture(noiDungEnv: string, moiTruongThamSo: string): { co: Record<string, string>; boDi: string[]; dongBao: string | null } {
  const moiTruong: Record<string, string> = {};
  for (const m of noiDungEnv.matchAll(/^(AI_AGENT_[A-Z0-9_]+|AI_AGENTIC_[A-Z0-9_]+|AI_CODING_[A-Z0-9_]+)=(.*)$/gm)) {
    if (/HOUSEKEEPING/.test(m[1]!)) continue;
    moiTruong[m[1]!] = m[2]!.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
  }
  for (const kv of moiTruongThamSo.split(",").filter(Boolean)) {
    const i = kv.indexOf("=");
    if (i <= 0) throw new Error(`--moi-truong sai dạng: ${kv}`);
    moiTruong[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const { co } = locCo(moiTruong);
  const boDi = Object.keys(moiTruong).filter((k) => !(k in co)); // boQua + tên ngoài tiền tố (locCo bỏ lặng lẽ) — CHỈ TÊN, không giá trị
  return { co, boDi, dongBao: boDi.length ? `dongGoi: bỏ khỏi lenh.moiTruong (chỉ tên): ${boDi.join(", ")}` : null };
}
