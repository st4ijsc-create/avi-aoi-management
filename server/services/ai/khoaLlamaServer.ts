/**
 * F5 (kế hoạch cải tiến Thợ Cả): MỘT nơi đọc khoá của llama-server. `LLAMA_SERVER_API_KEY_FILE` (đường tệp, khớp `--api-key-file`) thắng
 * `LLAMA_SERVER_API_KEY` (khoá trong env, giữ cho cấu hình cũ).
 *
 * Đặt tệp mà đọc không được ⇒ KHÔNG rơi về khoá env: cấu hình đã hỏng thì trả rỗng, llama-server trả 401, người vận hành thấy ngay; chỉ cảnh báo
 * một lần, không bao giờ in khoá. Đệm 5 s theo đường tệp vì hàm nằm trên đường sinh chữ; xoay khoá có hiệu lực sau tối đa 5 s.
 */
import fs from "node:fs";

const HAN_DEM_MS = 5_000;
let dem: { tep: string; luc: number; khoa: string } | null = null;
let daCanhBao = false;

export function khoaLlamaServer(env: NodeJS.ProcessEnv = process.env, bayGio = Date.now()): string {
  const tep = (env.LLAMA_SERVER_API_KEY_FILE || "").trim();
  if (!tep) return (env.LLAMA_SERVER_API_KEY || "").trim();
  if (dem && dem.tep === tep && bayGio - dem.luc < HAN_DEM_MS) return dem.khoa;
  let khoa = "";
  try {
    khoa = fs.readFileSync(tep, "utf8").trim();
    if (!khoa) throw new Error("tệp rỗng");
  } catch (e) {
    if (!daCanhBao) {
      daCanhBao = true;
      console.warn(`[khoaLlamaServer] không đọc được khoá từ LLAMA_SERVER_API_KEY_FILE (${(e as NodeJS.ErrnoException)?.code ?? (e as Error)?.message}): gọi llama-server sẽ bị 401`);
    }
  }
  dem = { tep, luc: bayGio, khoa };
  return khoa;
}

export function tieuDeLlamaServer(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const khoa = khoaLlamaServer(env);
  return khoa ? { authorization: `Bearer ${khoa}` } : {};
}

/** Lưới: quên đệm và cờ cảnh báo. */
export function _datLaiKhoaLlamaServer(): void {
  dem = null;
  daCanhBao = false;
}
