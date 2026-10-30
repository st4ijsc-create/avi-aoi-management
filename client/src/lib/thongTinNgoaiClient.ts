/**
 * Đợt 10.4b (L1) — gọi `aiChonModel.thongTinNgoai` (CHỈ THÔNG TIN: không giữ chỗ, không gọi mạng ra ngoài) từ `trpc.useUtils()`.
 * Kiểu vào/ra lấy từ hợp đồng chung `shared/ai/sinhChuNgoai.ts`; ép kiểu ở ĐÂY (một chỗ) cho tới khi kiểu thủ tục của máy chủ vào nhánh này.
 */
import type { BeMatSinhChuNgoai, ThongTinNgoai } from "@shared/ai/sinhChuNgoai";

interface UtilsCoThongTinNgoai {
  aiChonModel: { thongTinNgoai: { fetch: (i: { chonModel: string; beMat: BeMatSinhChuNgoai }) => Promise<ThongTinNgoai> } };
}

export function layThongTinNgoai(utils: unknown, beMat: BeMatSinhChuNgoai) {
  return (chonModel: string): Promise<ThongTinNgoai> => (utils as UtilsCoThongTinNgoai).aiChonModel.thongTinNgoai.fetch({ chonModel, beMat });
}
