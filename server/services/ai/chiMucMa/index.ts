/**
 * ★★★ Đợt 2 — CHỈ MỤC MÃ theo dự án: mặt tiếp xúc DUY NHẤT cho vòng agent (hợp đồng spec
 * `2026-10-17-ai-local-dot2-ngu-canh-tri-nho-design.md` §3). Agent nạp module này qua giao diện tiêm được
 * (`server/services/ai/agent/chiMucMaAgent.ts`, kiểm hình dạng lúc chạy) — tệp này KHÔNG nối gì vào agent.
 *
 *   • `timKyHieu`  — định nghĩa + tham chiếu theo mẫu (`kyHieu.ts`), thuần đọc qua hộp cát;
 *   • `timMaNgu`   — tìm theo nghĩa trên pgvector (`nguNghia.ts`); `chua-co` ⇒ kích hoạt dựng nền và trả ngay;
 *   • `lamTuoiTep` — làm tươi theo băm sau mỗi lượt ghi;
 *   • `dungChiMuc` — dựng toàn bộ (nền `nen`, huỷ được);
 *   • `trangThaiChiMuc` — TUỲ CHỌN (ngoài §3): hỏi trạng thái, không kích hoạt gì.
 * Mọi trường thêm vào chữ ký §3 đều tuỳ chọn (`projectId`, trần cho lưới).
 */
export { timKyHieu, dungBangKyHieu, trichKyHieu, xoaBoDemKyHieu } from "./kyHieu";
export type { KetQuaTimKyHieu, KyHieu, LoaiKyHieu } from "./kyHieu";
export {
  timMaNgu,
  lamTuoiTep,
  dungChiMuc,
  trangThaiChiMuc,
  kichHoatDungNen,
  huyDungChiMuc,
  choDungXong,
  datBoNhung,
} from "./nguNghia";
export type { BoNhung, KetQuaDung, KetQuaTimMaNgu } from "./nguNghia";
