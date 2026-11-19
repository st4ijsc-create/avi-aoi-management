/**
 * Lô D1-script — tiêu đề khoá chung cho mọi script gọi thẳng llama-server (:8091).
 *
 * Luật:
 * - CHỈ đọc ĐƯỜNG DẪN trong `LLAMA_SERVER_API_KEY_FILE`. KHÔNG bao giờ đọc giá trị `LLAMA_SERVER_API_KEY`
 *   (cùng nguyên tắc scripts/tho-ca-pilot/napEnv.ts:30): giá trị khoá không đi qua env của script đo.
 * - Biến trống ⇒ `{}`: server chưa khoá vẫn gọi như cũ.
 * - Biến có giá trị mà đọc hỏng hoặc tệp rỗng ⇒ NÉM. Không lặng lẽ gửi không khoá rồi ăn 401 khó đoán
 *   (cùng nguyên tắc start-llama-server.ps1:222: khai tệp mà không có ⇒ dừng).
 * - Thông báo lỗi chỉ mang tên biến và mã lỗi hệ thống; không mang nội dung tệp, không in khoá.
 */
import fs from "node:fs";

const TEN_BIEN = "LLAMA_SERVER_API_KEY_FILE";

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ authorization?: string }}
 */
export function tieuDeLlama(env = process.env) {
  const tep = (env[TEN_BIEN] ?? "").trim();
  if (!tep) return {};
  let noiDung;
  try {
    noiDung = fs.readFileSync(tep, "utf8");
  } catch (e) {
    const ma = e && typeof e === "object" && "code" in e ? String(e.code) : "LOI_DOC";
    throw new Error(`${TEN_BIEN} trỏ tệp không đọc được (${ma})`);
  }
  const khoa = noiDung.trim();
  if (!khoa) throw new Error(`${TEN_BIEN} trỏ tệp rỗng`);
  return { authorization: `Bearer ${khoa}` };
}

/** Gốc llama-server khai báo khi không có `LLAMA_SERVER_URL`. */
export const GOC_LLAMA_MAC_DINH = "http://127.0.0.1:8091";

/**
 * Tiêu đề khoá cho MỘT yêu cầu tới `url`: chỉ khi gốc (origin) của `url` TRÙNG gốc llama-server khai báo
 * (`LLAMA_SERVER_URL`, mặc định {@link GOC_LLAMA_MAC_DINH}). Đích khác (cờ --url / --raw-url / --openai trỏ máy chủ khác,
 * ollama, máy chủ thị giác cổng khác) ⇒ `{}` và KHÔNG đọc tệp khoá: khoá không đi ra ngoài llama-server của nó.
 * URL hỏng ⇒ `{}`.
 * @param {string} url
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ authorization?: string }}
 */
export function tieuDeLlamaCho(url, env = process.env) {
  let dich, goc;
  try {
    dich = new URL(url).origin;
    goc = new URL(urlLlama(GOC_LLAMA_MAC_DINH, env)).origin;
  } catch {
    return {};
  }
  return dich === goc ? tieuDeLlama(env) : {};
}

/**
 * URL llama-server: `LLAMA_SERVER_URL` (đã cắt khoảng trắng) nếu có, không thì mặc định người gọi đưa.
 * @param {string} macDinh
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function urlLlama(macDinh, env = process.env) {
  const u = (env.LLAMA_SERVER_URL ?? "").trim();
  return u || macDinh;
}
