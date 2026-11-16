/**
 * ★ Đợt 12 H3.2b — NGÂN SÁCH NGỮ CẢNH của vòng agent theo MÔ TẢ model (`shared/ai/moTaModel.ts`) thay cho 65 536 gắn cứng ở lõi (khớp
 * `-c` của :8091 bằng TAY). Kiểm một lần với khe thật (`/props` n_ctx, đệm 10 phút): lệch ⇒ cảnh báo MỘT lần + dùng số NHỎ HƠN (không bao
 * giờ tin con số lớn hơn thực tế); không đọc được ⇒ số của mô tả (fail-open về hành vi hôm nay). Với Qwen3.6 + `-c 65536` ⇒ 65 536 = như cũ.
 *
 * ★ (HST 15/11) cờ ÉP ĐO `AI_AGENT_NGAN_SACH_EP` — CHỈ cho máy đo :3013 (đo cơ chế nén ở ngân sách nhỏ), KHÔNG phải cấu hình vận hành.
 *   CHỈ HẠ: số nguyên dương nhỏ hơn ngân sách thật ⇒ dùng nó, kẹp dưới `NGAN_SACH_EP_TOI_THIEU`; lớn hơn/bằng ngân sách thật, rỗng, âm, 0,
 *   thập phân, chữ ⇒ BỎ QUA như vắng (không ném, không nới). Vắng ⇒ y hệt trước cờ. Áp ở ĐÚNG một chỗ này; mọi nơi dùng ngân sách
 *   (ngưỡng + đích nén, ctx%, "ngữ cảnh đầy", con kế thừa) đọc cùng `gh.nganSachNguCanhToken` do hàm này trả.
 *   GIỚI HẠN ĐÃ BIẾT: khi hàm này NÉM (quanLyLuotChay.ts `.catch(() => undefined)`), khi lượt có `goiModel` tiêm / lượt ngoài, hoặc người gọi
 *   đã đặt `gioiHan.nganSachNguCanhToken`, lõi dùng mặc định `shared/agentCore/kieu.ts` (65 536) và cờ KHÔNG áp — máy đo phải kiểm ngân sách
 *   hiệu dụng của từng lượt.
 */
import { moTaCho } from "../../../../shared/ai/moTaModel";

let daCanhBaoLech = false;

/** Kẹp dưới của cờ ép: thấp hơn thế thì system + sơ đồ công cụ + đề đã chiếm gần hết, phép đo nén vô nghĩa. */
export const NGAN_SACH_EP_TOI_THIEU = 8_192;

/** Giá trị cờ `AI_AGENT_NGAN_SACH_EP` ⇒ số nguyên dương, hoặc `undefined` (vắng / không hợp lệ ⇒ như vắng). Thuần. */
export function nganSachEpTuEnv(giaTri: string | undefined): number | undefined {
  const s = String(giaTri ?? "").trim();
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** Áp cờ ép lên ngân sách thật: CHỈ HẠ, kẹp dưới `NGAN_SACH_EP_TOI_THIEU`, không bao giờ vượt `that`. Thuần. */
export function apNganSachEp(that: number, ep: number | undefined): number {
  if (ep === undefined) return that;
  // MỘT chốt "chỉ hạ": `Math.min(that, …)` — ép ≥ thật ⇒ ra đúng `that` (= bỏ qua như vắng); cũng giữ ≤ thật khi thật < kẹp dưới.
  return Math.min(that, Math.max(NGAN_SACH_EP_TOI_THIEU, ep));
}

export interface PhuThuocNganSach {
  /** `tenModel` = model lượt này định dùng (khoá đệm — đổi model ⇒ hỏi lại khe). */
  nCtxKhe: (tenModel: string) => Promise<number | null>;
  tenModelMacDinh: () => string;
}

const phuThuocThat = async (): Promise<PhuThuocNganSach> => {
  const c = await import("../../aiLlamaServerClient");
  return { nCtxKhe: (ten) => c.nCtxKheServer(1500, Date.now(), ten), tenModelMacDinh: () => c.tenModelKheMacDinh() };
};

export async function nganSachNguCanhCho(
  modelId: string | undefined,
  dep?: PhuThuocNganSach,
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  const d = dep ?? (await phuThuocThat());
  const ten = modelId ?? d.tenModelMacDinh();
  const moTa = moTaCho(ten).nguCanh.macDinh;
  let khe: number | null = null;
  try {
    khe = await d.nCtxKhe(ten);
  } catch {
    khe = null;
  }
  const ep = nganSachEpTuEnv(env.AI_AGENT_NGAN_SACH_EP);
  if (khe === null) return apNganSachEp(moTa, ep);
  if (khe !== moTa && !daCanhBaoLech) {
    daCanhBaoLech = true;
    console.warn(`[nganSachNguCanh] khe llama-server n_ctx=${khe} ≠ mô tả ${ten} (${moTa}) ⇒ dùng ${Math.min(khe, moTa)} (số nhỏ hơn)`);
  }
  return apNganSachEp(Math.min(khe, moTa), ep);
}

export function _datLaiCanhBaoNganSach(): void {
  daCanhBaoLech = false;
}
