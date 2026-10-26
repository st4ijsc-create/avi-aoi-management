/**
 * ★ Đợt 10.3 lô sau nghiệm thu (dieu-phoi e — SSRF `llm.ts`) — tải ẢNH http(s) cho model thị giác CỤC BỘ an toàn.
 * Nguồn URL do người dùng / thiết bị điều khiển được (`annotation.analyzeImage` nhận chuỗi tự do; `inspection.analyzeWithAI` đọc
 * `measurement_results.imageUrl` mà Machine API ghi). Trước đây là `fetch(url)` thô: theo chuyển hướng, không kiểm DNS/IP, không trần.
 * Nay CÙNG lớp mạng của Luồng: DNS một lần + ghim IP (`kiemDichDen`), metadata / link-local LUÔN cấm, địa chỉ NỘI BỘ chỉ khi
 * `host:cổng` có trong env `AI_IMAGE_HOST_CHO_PHEP` (rỗng ⇒ đóng), không chuyển hướng, không proxy env (`fetchGhim`), trần 20 MB,
 * hạn 15 s, `content-type` phải `image/*`.
 */
import { appError } from "./appError";
import { docBytesCoTran, fetchGhim, kiemDichDen, type DichDen } from "../services/flow/nut/mangAnToan";

export const TRAN_ANH_BYTE = 20 * 1024 * 1024;
export const HAN_TAI_ANH_MS = 15_000;

/** `AI_IMAGE_HOST_CHO_PHEP` = danh sách `host:cổng` (phẩy) được phép là đích NỘI BỘ. Mục sai dạng bị bỏ. */
export function hostAnhChoPhep(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.AI_IMAGE_HOST_CHO_PHEP ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase().replace(/\.(?=:)/, ""))
      .filter((x) => /^[a-z0-9.-]{1,253}:\d{1,5}$/.test(x)),
  );
}

const loi = (lyDo: string) => appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "taiAnhAi", reason: lyDo }, `không tải được ảnh (${lyDo})`);

export async function taiAnhQuaMang(url: string): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw loi("anh-url-sai");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw loi("anh-url-sai");
  if (u.username || u.password) throw loi("anh-url-sai");
  let dich: DichDen;
  try {
    dich = await kiemDichDen(u, hostAnhChoPhep());
  } catch {
    throw loi("anh-dich-cam");
  }
  let r: Response;
  try {
    r = await fetchGhim(u, { method: "GET", headers: { Accept: "image/*" }, signal: AbortSignal.timeout(HAN_TAI_ANH_MS) }, dich);
  } catch {
    throw loi("anh-ket-noi");
  }
  if (r.status >= 300 && r.status < 400) {
    await r.body?.cancel().catch(() => undefined);
    throw loi("anh-chuyen-huong");
  }
  if (!r.ok) {
    await r.body?.cancel().catch(() => undefined);
    throw loi("anh-http-loi");
  }
  if (!/^image\//i.test(r.headers.get("content-type") ?? "")) {
    await r.body?.cancel().catch(() => undefined);
    throw loi("anh-khong-phai-anh");
  }
  try {
    return await docBytesCoTran(r, TRAN_ANH_BYTE);
  } catch {
    throw loi("anh-qua-lon");
  }
}
