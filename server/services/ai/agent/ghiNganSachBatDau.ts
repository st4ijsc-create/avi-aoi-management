/**
 * (HST 15/11) máy đo cờ ép `AI_AGENT_NGAN_SACH_EP`: ghi ngân sách ngữ cảnh HIỆU DỤNG của lượt vào `bat-dau.model.nganSachNguCanh`.
 * THUẦN. Chỉ GHI (sự kiện/sổ), KHÔNG vào tin gửi model; mã ÁP cờ nằm ở `nganSachNguCanh.ts` (một chỗ).
 * - Biến CÓ MẶT (kể cả giá trị lạ bị bỏ qua, kể cả chuỗi rỗng) ⇒ ghi số lõi SẼ dùng: `gioiHan.nganSachNguCanhToken`, vắng thì mặc định lõi
 *   (`GIOI_HAN_MAC_DINH`, 65 536) — để máy đo THẤY khi cờ không áp được (ví dụ hỏi ngân sách ném ⇒ rơi về 65 536) thay vì lặng lẽ.
 * - Biến VẮNG ⇒ không ghi gì ⇒ `thongTinModel` giữ NGUYÊN đối tượng cũ ⇒ sự kiện như trước từng byte.
 */
import { GIOI_HAN_MAC_DINH, type GioiHanVong, type ThongTinModelBatDau } from "@shared/agentCore";

export function banGhiNganSachBatDau(
  env: Record<string, string | undefined>,
  gioiHan: Partial<GioiHanVong> | undefined,
): { nganSachNguCanh: number } | null {
  if (env.AI_AGENT_NGAN_SACH_EP === undefined) return null;
  return { nganSachNguCanh: gioiHan?.nganSachNguCanhToken ?? GIOI_HAN_MAC_DINH.nganSachNguCanhToken };
}

/** Gắn bản ghi vào thông tin model của `bat-dau`; `ghi` null ⇒ trả NGUYÊN đối tượng vào (không sao chép). */
export function ganNganSachVaoThongTin<T extends ThongTinModelBatDau>(thongTin: T, ghi: { nganSachNguCanh: number } | null): T {
  return ghi ? { ...thongTin, ...ghi } : thongTin;
}
