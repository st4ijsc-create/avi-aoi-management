/**
 * ★★★ ĐỢT 4C — gọi `POST {serverUrl}/v1/completions` (FIM: `prompt` + `suffix`, `model: "fim"`) cho ghost-text bằng
 * token cá nhân `avgw_…` (phạm vi `fim`, device flow — SecretStorage).
 *
 * ⚠ KHÔNG BAO GIỜ NÉM: ghost-text chạy mỗi lần gõ phím — mọi lỗi thành GIÁ TRỊ để tầng UI ghi nhật ký im lặng, không
 *   bật hộp thoại. `huy` (người dùng gõ tiếp) không phải lỗi.
 * Đọc mã cổng 2026-10-17 (`server/routes/openaiGateway.ts` POST /completions): nhận `prompt`, `suffix`, `model`,
 * `max_tokens`, `temperature`, `top_p`, `stream`, và (từ 4C-server) `stop` — chuỗi/mảng ≤ 4 × ≤ 64 ký tự, nối thêm vào
 * FIM_STOP của engine; máy chủ cũ bỏ qua ô này ⇒ extension VẪN tự cắt bằng `catGoiY` (phòng thủ hai lớp).
 */
import { kiemTraServerUrl } from "../loi/dangNhap";
import type { ThanYeuCauFim } from "../loi/ghostText";

export type KetQuaFim =
  | { ok: true; text: string; ms: number }
  | { ok: false; loai: "huy" | "chua-dang-nhap" | "url" | "mang" | "http" | "tu-choi"; status?: number; thongDiep: string; ms: number };

export interface DauVaoGoiFim {
  serverUrl: string;
  token: string | undefined;
  than: ThanYeuCauFim;
  signal: AbortSignal;
  fetch?: typeof fetch;
  /** Trần thời gian một yêu cầu — quá thì gợi ý đã vô dụng (người dùng đã gõ tiếp). */
  hetGioMs?: number;
}

export const HET_GIO_FIM_MS = 5_000;

export async function goiFim(dv: DauVaoGoiFim): Promise<KetQuaFim> {
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const kt = kiemTraServerUrl(dv.serverUrl);
  if (!kt.ok) return { ok: false, loai: "url", thongDiep: kt.lyDo, ms: ms() };
  if (!dv.token) return { ok: false, loai: "chua-dang-nhap", thongDiep: "chưa có token /v1 (đăng nhập device flow)", ms: ms() };
  if (dv.signal.aborted) return { ok: false, loai: "huy", thongDiep: "đã huỷ", ms: ms() };

  // Gộp tay (không phụ thuộc `AbortSignal.any`): huỷ của người dùng HOẶC hết giờ ⇒ huỷ fetch.
  const ac = new AbortController();
  let hetGio = false;
  const henGio = setTimeout(() => {
    hetGio = true;
    ac.abort();
  }, dv.hetGioMs ?? HET_GIO_FIM_MS);
  const khiHuy = () => ac.abort();
  dv.signal.addEventListener("abort", khiHuy);
  try {
    let res: Response;
    try {
      res = await (dv.fetch ?? fetch)(`${kt.url}/v1/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${dv.token}` },
        body: JSON.stringify(dv.than),
        signal: ac.signal,
      });
    } catch (e) {
      if (dv.signal.aborted && !hetGio) return { ok: false, loai: "huy", thongDiep: "đã huỷ", ms: ms() };
      return {
        ok: false,
        loai: "mang",
        thongDiep: hetGio ? `quá ${dv.hetGioMs ?? HET_GIO_FIM_MS} ms` : `không nối được ${kt.url}: ${(e as Error)?.message ?? e}`,
        ms: ms(),
      };
    }
    let than: unknown = null;
    try {
      than = await res.json();
    } catch {
      than = null;
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, loai: "tu-choi", status: res.status, thongDiep: thongDiepLoi(than) ?? `HTTP ${res.status}`, ms: ms() };
    }
    if (res.status !== 200) {
      return { ok: false, loai: "http", status: res.status, thongDiep: thongDiepLoi(than) ?? `HTTP ${res.status}`, ms: ms() };
    }
    const text = (than as { choices?: Array<{ text?: unknown }> } | null)?.choices?.[0]?.text;
    if (typeof text !== "string") return { ok: false, loai: "http", status: 200, thongDiep: "phản hồi không đúng khuôn text_completion", ms: ms() };
    return { ok: true, text, ms: ms() };
  } finally {
    clearTimeout(henGio);
    dv.signal.removeEventListener("abort", khiHuy);
  }
}

function thongDiepLoi(than: unknown): string | undefined {
  const m = (than as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === "string" ? m.slice(0, 200) : undefined;
}
