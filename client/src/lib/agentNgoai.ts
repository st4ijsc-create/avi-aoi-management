/**
 * Đợt 10.4b L4 — agent (nhiều bước, CHỈ ĐỌC) bằng model NGOÀI ở màn lập trình. Hàm THUẦN để lưới ghim quyết định:
 *   • bề mặt `agent` do MÁY CHỦ mở (danh mục khai `duocDungO` chứa "agent") — client không tự mở; thiếu/đóng ⇒ không bày công tắc;
 *   • công tắc chỉ có nghĩa khi đang chọn model ngoài (`ngoai:…`) — đổi về model cục bộ ⇒ công tắc không còn hiệu lực (không rò sang lượt cục bộ).
 */
import { DUOC_DUNG_O, type MucModel } from "./chonModel";
import { tachMaNgoai } from "./dongYNgoai";

/** Model `ma` là model ngoài VÀ máy chủ khai phục vụ bề mặt agent? */
export function agentNgoaiMo(danhMuc: readonly MucModel[], ma: string): boolean {
  if (ma === "auto" || tachMaNgoai(ma) === null) return false;
  const m = danhMuc.find((x) => x.ma === ma && x.loai === "ngoai");
  return !!m && Array.isArray(m.duocDungO) && m.duocDungO.includes(DUOC_DUNG_O.agent);
}

/** Lượt gửi kế tiếp đi đường agent-ngoài? (công tắc bật VÀ vẫn chọn đúng model ngoài đã mở agent). */
export function dungAgentNgoai(batCongTac: boolean, danhMuc: readonly MucModel[], ma: string): boolean {
  return batCongTac && agentNgoaiMo(danhMuc, ma);
}
