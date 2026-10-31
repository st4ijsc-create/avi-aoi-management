/**
 * ★ Đợt 12 H3.2b — NGÂN SÁCH NGỮ CẢNH của vòng agent theo MÔ TẢ model (`shared/ai/moTaModel.ts`) thay cho 65 536 gắn cứng ở lõi (khớp
 * `-c` của :8091 bằng TAY). Kiểm một lần với khe thật (`/props` n_ctx, đệm 10 phút): lệch ⇒ cảnh báo MỘT lần + dùng số NHỎ HƠN (không bao
 * giờ tin con số lớn hơn thực tế); không đọc được ⇒ số của mô tả (fail-open về hành vi hôm nay). Với Qwen3.6 + `-c 65536` ⇒ 65 536 = như cũ.
 */
import { moTaCho } from "../../../../shared/ai/moTaModel";

let daCanhBaoLech = false;

export interface PhuThuocNganSach {
  /** `tenModel` = model lượt này định dùng (khoá đệm — đổi model ⇒ hỏi lại khe). */
  nCtxKhe: (tenModel: string) => Promise<number | null>;
  tenModelMacDinh: () => string;
}

const phuThuocThat = async (): Promise<PhuThuocNganSach> => {
  const c = await import("../../aiLlamaServerClient");
  return { nCtxKhe: (ten) => c.nCtxKheServer(1500, Date.now(), ten), tenModelMacDinh: () => c.tenModelKheMacDinh() };
};

export async function nganSachNguCanhCho(modelId: string | undefined, dep?: PhuThuocNganSach): Promise<number> {
  const d = dep ?? (await phuThuocThat());
  const ten = modelId ?? d.tenModelMacDinh();
  const moTa = moTaCho(ten).nguCanh.macDinh;
  let khe: number | null = null;
  try {
    khe = await d.nCtxKhe(ten);
  } catch {
    khe = null;
  }
  if (khe === null) return moTa;
  if (khe !== moTa && !daCanhBaoLech) {
    daCanhBaoLech = true;
    console.warn(`[nganSachNguCanh] khe llama-server n_ctx=${khe} ≠ mô tả ${ten} (${moTa}) ⇒ dùng ${Math.min(khe, moTa)} (số nhỏ hơn)`);
  }
  return Math.min(khe, moTa);
}

export function _datLaiCanhBaoNganSach(): void {
  daCanhBaoLech = false;
}
