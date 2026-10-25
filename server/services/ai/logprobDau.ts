/**
 * Module LÁ (0 import) — logprob của những token ĐẦU câu trả lời + độ tin cậy NHÃN suy ra từ chúng (lô độ-tin-cậy `ai.phan-loai`, 2026-10-26).
 *
 * Chỉ đường llama-server trả logprobs (`/v1/chat/completions` với `logprobs:true, top_logprobs:N`); đường in-process KHÔNG ⇒ `undefined`.
 * Token đầu thường là MẢNH TỪ (vd "mechan" / "elect") nên gộp xác suất top-N theo TIỀN TỐ của từng nhãn, không so cả từ.
 */
export interface LogprobTopToken {
  token: string;
  logprob: number;
}
export interface LogprobToken extends LogprobTopToken {
  top: LogprobTopToken[];
}

/** Số token đầu giữ lại (đủ để bỏ qua dấu nháy/khoảng trắng mở đầu; không giữ cả câu). */
export const SO_TOKEN_DAU_GIU = 8;

/** Chuẩn hoá `choices[0].logprobs.content` của llama-server ⇒ ≤ SO_TOKEN_DAU_GIU token; dạng lạ ⇒ undefined (không bịa). */
export function chuanHoaLogprobDau(raw: unknown): LogprobToken[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ra: LogprobToken[] = [];
  for (const x of raw.slice(0, SO_TOKEN_DAU_GIU)) {
    const o = x as { token?: unknown; logprob?: unknown; top_logprobs?: unknown };
    if (typeof o?.token !== "string" || typeof o.logprob !== "number" || !Number.isFinite(o.logprob)) return undefined;
    const top = Array.isArray(o.top_logprobs)
      ? (o.top_logprobs as Array<{ token?: unknown; logprob?: unknown }>)
          .filter((t) => typeof t?.token === "string" && typeof t.logprob === "number" && Number.isFinite(t.logprob))
          .map((t) => ({ token: t.token as string, logprob: t.logprob as number }))
      : [];
    ra.push({ token: o.token, logprob: o.logprob, top });
  }
  return ra.length ? ra : undefined;
}

/** Token chỉ gồm khoảng trắng / nháy / dấu mở đầu — bỏ qua khi tìm token-nhãn đầu tiên. */
const CHI_DAU_NHAY = /^[\s"'`*_.:\-([]*$/;

/**
 * Độ tin cậy của `nhan` ∈ [0,1] = tổng xác suất (exp logprob) của các token ứng viên ở vị trí token-nhãn ĐẦU TIÊN (bỏ token chỉ là khoảng trắng/nháy/dấu)
 * mà token (đã cắt, chữ thường) là TIỀN TỐ của nhãn hoặc bắt đầu bằng nhãn. Token khớp MƠ HỒ (≥ 2 nhãn) không tính cho nhãn nào ⇒ chỉ làm điểm THẤP đi (an toàn).
 * `null` = không có logprobs (đường không hỗ trợ) — KHÔNG bịa số. Nhãn không thuộc danh sách ⇒ 0.
 */
export function tinCayNhan(lp: readonly LogprobToken[] | undefined | null, nhan: string | null, nhanHopLe: readonly string[]): number | null {
  if (!lp?.length) return null;
  const viTri = lp.find((t) => !CHI_DAU_NHAY.test(t.token));
  if (!viTri) return null;
  const chuan = nhanHopLe.map((n) => n.toLowerCase());
  const dich = nhan === null ? -1 : chuan.indexOf(nhan.toLowerCase());
  if (dich < 0) return 0;
  const ungVien = viTri.top.length ? viTri.top : [{ token: viTri.token, logprob: viTri.logprob }];
  let tong = 0;
  for (const u of ungVien) {
    const t = u.token.trim().toLowerCase();
    if (!t) continue;
    const khop = chuan.map((l, i) => (l.startsWith(t) || t.startsWith(l) ? i : -1)).filter((i) => i >= 0);
    if (khop.length === 1 && khop[0] === dich) tong += Math.exp(u.logprob);
  }
  return Math.min(1, Math.max(0, tong));
}
