/**
 * ★★★ Đợt 5.1 (VSCode) — gửi phiếu 👍/👎 (+ lý do) cho câu trả lời CUỐI của lượt agent CHẠY CỤC BỘ trong extension.
 *
 * Tuyến: `POST /api/ai/client-feedback` (`server/routes/aiGatewayTokenBearerApi.ts`) — Bearer `avgw_…` (token device flow),
 * phạm vi `chat`. Máy chủ lấy NGƯỜI từ token; khoá phiếu = (chủ token, `luotId` — uuid lượt do `PhienAgent` sinh,
 * `chiSoKhoi`) ⇒ gửi lại / đổi phiếu = sửa cùng một hàng.
 *
 * ⚠ VÌ SAO GỬI VĂN BẢN: lượt cục bộ không có sổ `ai_agent_runs` trên máy chủ (khác phiếu web — máy chủ tự tra sổ), nên
 *   câu hỏi + câu trả lời đi kèm phiếu. Máy chủ che bí mật + cắt trần + đánh dấu `nguon = 'vscode'` (mức tin riêng, không
 *   trộn với phiếu web). Ở đây: che bí mật LỚP CLIENT (`cheBiMat`) và cắt về ĐÚNG trần máy chủ — hằng số nhập từ
 *   `shared/phanHoiAgent.ts`, một chủ cho hai phía (bản sao hằng số là cách 400 oan xuất hiện).
 * ⚠ Phản hồi là PHỤ: `guiPhanHoiAgent` KHÔNG BAO GIỜ ném — lỗi ⇒ `{ok:false, lyDo}` để phía gọi ghi kênh Output, không
 *   hộp thoại, không làm hỏng khung chat.
 */
import { kiemTraServerUrl } from "../loi/dangNhap";
import { cheBiMat } from "../loi/nguCanh";
import { TRAN_KY_TU_CAU_HOI_CLIENT, TRAN_KY_TU_TRA_LOI_CLIENT, TRAN_KY_TU_LY_DO } from "../../../shared/phanHoiAgent";

export const DUONG_PHAN_HOI = "/api/ai/client-feedback";

export interface PhieuPhanHoi {
  luotId: string;
  chiSoKhoi: number;
  /** 1 = 👍 · −1 = 👎 · null = bỏ phiếu. */
  danhGia: 1 | -1 | null;
  lyDo?: string | null;
  cauHoi: string;
  traLoi: string;
  duAn?: string | null;
}

export interface ThanPhanHoi {
  luotId: string;
  chiSoKhoi: number;
  danhGia: 1 | -1 | null;
  lyDo: string | null;
  cauHoi: string;
  traLoi: string;
  duAn: string | null;
}

/** Thân gửi đi (THUẦN): che bí mật rồi cắt về trần máy chủ; lý do rỗng ⇒ null; nhãn dự án sai hình dạng ⇒ null. */
export function dungThanPhanHoi(p: PhieuPhanHoi): ThanPhanHoi {
  const lyDo = (p.lyDo ?? "").trim();
  return {
    luotId: p.luotId,
    chiSoKhoi: p.chiSoKhoi,
    danhGia: p.danhGia,
    lyDo: lyDo ? cheBiMat(lyDo).slice(0, TRAN_KY_TU_LY_DO) : null,
    cauHoi: cheBiMat(p.cauHoi).slice(0, TRAN_KY_TU_CAU_HOI_CLIENT),
    traLoi: cheBiMat(p.traLoi).slice(0, TRAN_KY_TU_TRA_LOI_CLIENT),
    duAn: typeof p.duAn === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.duAn) ? p.duAn : null,
  };
}

export type KetQuaGuiPhanHoi = { ok: true } | { ok: false; lyDo: string };

/** Gửi một phiếu. KHÔNG BAO GIỜ ném. Token rỗng ⇒ không chạm mạng. */
export async function guiPhanHoiAgent(serverUrl: string, token: string, p: PhieuPhanHoi): Promise<KetQuaGuiPhanHoi> {
  if (!token) return { ok: false, lyDo: "chưa có token cá nhân (đăng nhập AI Local bằng device flow)" };
  const kt = kiemTraServerUrl(serverUrl);
  if (!kt.ok) return { ok: false, lyDo: kt.lyDo };
  try {
    const res = await fetch(`${kt.url}${DUONG_PHAN_HOI}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(dungThanPhanHoi(p)),
    });
    if (res.status === 200) return { ok: true };
    let than: unknown = null;
    try {
      than = await res.json();
    } catch {
      than = null;
    }
    const e = (than && typeof than === "object" ? (than as { error?: unknown }).error : undefined) as { code?: unknown; message?: unknown } | undefined;
    const chiTiet = [typeof e?.code === "string" ? e.code : "", typeof e?.message === "string" ? e.message : ""].filter(Boolean).join(": ");
    return { ok: false, lyDo: `máy chủ trả ${res.status}${chiTiet ? ` — ${chiTiet}` : ""}` };
  } catch (err) {
    return { ok: false, lyDo: `không gửi được: ${cheBiMat((err as Error)?.message ?? String(err))}` };
  }
}
