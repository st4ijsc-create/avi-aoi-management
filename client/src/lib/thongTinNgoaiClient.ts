/**
 * Đợt 10.4b (L1) — gọi `aiChonModel.thongTinNgoai` (CHỈ THÔNG TIN: không giữ chỗ, không gọi mạng ra ngoài) từ `trpc.useUtils()`.
 * Kiểu vào/ra lấy từ hợp đồng chung `shared/ai/sinhChuNgoai.ts`; thủ tục máy chủ đã có kiểu ⇒ không còn ép kiểu.
 */
import type { BeMatSinhChuNgoai, ThongTinNgoai } from "@shared/ai/sinhChuNgoai";
import type { trpc } from "@/lib/trpc";

type Utils = ReturnType<typeof trpc.useUtils>;

export function layThongTinNgoai(utils: Utils, beMat: BeMatSinhChuNgoai) {
  return (chonModel: string): Promise<ThongTinNgoai> => utils.aiChonModel.thongTinNgoai.fetch({ chonModel, beMat });
}
