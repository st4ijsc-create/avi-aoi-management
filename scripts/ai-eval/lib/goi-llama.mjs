#!/usr/bin/env node
/**
 * Lô D1-script — thay `curl -s -m 5 http://127.0.0.1:8091/<đường>` trong các script .sh đo đạc.
 *
 *   node scripts/ai-eval/lib/goi-llama.mjs /props          # GET, in THÂN trả về ra stdout (như curl -s)
 *   node scripts/ai-eval/lib/goi-llama.mjs /metrics 5      # tham số 2 = trần giây (mặc định 5)
 *
 * - Gốc = `LLAMA_SERVER_URL` (mặc định http://127.0.0.1:8091); khoá qua `LLAMA_SERVER_API_KEY_FILE` (tieuDeLlama.mjs).
 *   Khoá KHÔNG nằm trên dòng lệnh (dòng lệnh lộ qua Win32_Process), chỉ đi trong tiêu đề HTTP của tiến trình này.
 * - Chỉ GET. Lỗi mạng / HTTP ≠ 2xx ⇒ stdout RỖNG (như `curl -s` khi hỏng), một dòng lý do ra stderr (không có khoá), thoát 1.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tieuDeLlamaCho, urlLlama, GOC_LLAMA_MAC_DINH } from "./tieuDeLlama.mjs";

/**
 * @param {string} duong đường bắt đầu bằng "/"
 * @param {number} [giay]
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<{ ok: boolean, than: string, ma: number | null, lyDo?: string }>}
 */
export async function goiLlama(duong, giay = 5, env = process.env) {
  if (!duong || !duong.startsWith("/")) return { ok: false, than: "", ma: null, lyDo: "đường phải bắt đầu bằng /" };
  const url = `${urlLlama(GOC_LLAMA_MAC_DINH, env).replace(/\/+$/, "")}${duong}`;
  let tieuDe;
  try {
    tieuDe = tieuDeLlamaCho(url, env);
  } catch (e) {
    return { ok: false, than: "", ma: null, lyDo: String(e?.message ?? e) };
  }
  try {
    const r = await fetch(url, { headers: tieuDe, signal: AbortSignal.timeout(giay * 1000) });
    const than = await r.text();
    return r.ok ? { ok: true, than, ma: r.status } : { ok: false, than: "", ma: r.status, lyDo: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, than: "", ma: null, lyDo: String(e?.name ?? "loi-mang") };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const giay = Number(process.argv[3] ?? 5);
  const kq = await goiLlama(process.argv[2] ?? "", Number.isFinite(giay) && giay > 0 ? giay : 5);
  if (kq.ok) process.stdout.write(kq.than);
  else {
    process.stderr.write(`goi-llama: ${kq.lyDo}\n`);
    process.exitCode = 1;
  }
}
