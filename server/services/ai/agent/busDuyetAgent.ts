/**
 * ★★ Đợt 1 · T4 (2026-10-17) — BUS QUYẾT ĐỊNH DUYỆT của vòng agent (trong bộ nhớ tiến trình).
 *
 * Vì sao cần: ở chế độ `sua`, bộ thực thi máy chủ (`boThucThiMayChu`) đề xuất một lượt ghi rồi DỪNG
 * chờ người. Người quyết định ở MỘT lượt HTTP khác (tRPC `aiAgent.duyet`/`aiAgent.bac`, hoặc thẻ duyệt
 * cũ gọi thẳng `aiCopilot.confirmAction`). Bus này là đường ĐÁNH THỨC NHANH giữa hai lượt ấy.
 *
 * ⚠ Bus KHÔNG phải nguồn sự thật — hàng `ai_pending_actions` mới là. Bộ thực thi còn KIỂM ĐỊNH KỲ
 *   trạng thái hàng (`getAction`) nên một lượt duyệt đi đường cũ (không qua bus) vẫn được thấy, chậm
 *   tối đa một nhịp kiểm. Mất bus (restart) ⇒ lượt chạy cũng mất (sống trong bộ nhớ) — không có trạng
 *   thái treo nào để dọn.
 * ⚠ Bus KHÔNG mang quyền: một tin "duyệt" trên bus chỉ đánh thức; kết quả ghi THẬT luôn đọc từ
 *   `confirmAction` (đã chạy RBAC + hàng rào) hoặc từ `resultJson` của hàng.
 */

export type QuyetDinhDuyet =
  /** Người đã xác nhận — `ketQua` là `ConfirmResult` của `confirmAction` (nếu bên đánh thức có). */
  | { loai: "duyet"; ketQua?: unknown }
  /** Người bác, kèm lý do để model đọc. */
  | { loai: "bac"; lyDo: string };

type NguoiCho = (qd: QuyetDinhDuyet) => void;

const nguoiChoTheoAction = new Map<string, Set<NguoiCho>>();
/** Quyết định đến TRƯỚC khi có người chờ (đua giữa propose và phát `can-duyet`) — giữ ngắn hạn. */
const quyetDinhSom = new Map<string, { qd: QuyetDinhDuyet; luc: number }>();
const GIU_QUYET_DINH_SOM_MS = 10 * 60_000;

function donQuyetDinhSom(bayGio: number): void {
  for (const [k, v] of quyetDinhSom) if (bayGio - v.luc > GIU_QUYET_DINH_SOM_MS) quyetDinhSom.delete(k);
}

/** Báo một quyết định cho `actionId`. Không ai chờ ⇒ giữ lại để người chờ đến sau nhận được. */
export function baoQuyetDinhDuyet(actionId: string, qd: QuyetDinhDuyet): void {
  const ds = nguoiChoTheoAction.get(actionId);
  if (!ds || ds.size === 0) {
    donQuyetDinhSom(Date.now());
    quyetDinhSom.set(actionId, { qd, luc: Date.now() });
    return;
  }
  for (const f of [...ds]) {
    try {
      f(qd);
    } catch {
      /* một người nghe hỏng không chặn người khác */
    }
  }
}

/**
 * Đăng ký nghe quyết định của `actionId`. Trả hàm huỷ đăng ký. Nếu quyết định đã đến sớm ⇒ gọi ngay
 * (đồng bộ) và xoá khỏi bộ giữ.
 */
export function ngheQuyetDinhDuyet(actionId: string, f: NguoiCho): () => void {
  const som = quyetDinhSom.get(actionId);
  if (som) {
    quyetDinhSom.delete(actionId);
    f(som.qd);
    return () => {};
  }
  let ds = nguoiChoTheoAction.get(actionId);
  if (!ds) {
    ds = new Set();
    nguoiChoTheoAction.set(actionId, ds);
  }
  ds.add(f);
  return () => {
    const hien = nguoiChoTheoAction.get(actionId);
    if (!hien) return;
    hien.delete(f);
    if (hien.size === 0) nguoiChoTheoAction.delete(actionId);
  };
}

/** Chỉ dùng trong lưới. */
/**
 * ★★★ LÝ DO BÁC GHI TRƯỚC KHI HUỶ (đo 2026-10-17 dưới tải): `thuTucBac` = `cancelAction` (DB) rồi mới
 * `baoQuyetDinhDuyet` (bus). Bộ kiểm định kỳ `getAction` (1 s) của lượt chạy có thể thấy hàng `cancelled`
 * GIỮA hai bước ⇒ kết thúc "bác" KHÔNG lý do ⇒ model nhận "User rejected this change." và mất thứ người
 * dùng gõ. Nên lý do được ghi vào đây TRƯỚC khi huỷ; nhánh nào thắng cuộc đua cũng đọc được nó.
 */
const lyDoBacTheoAction = new Map<string, { lyDo: string; luc: number }>();

export function ghiLyDoBacTruoc(actionId: string, lyDo: string): void {
  const bayGio = Date.now();
  for (const [k, v] of lyDoBacTheoAction) if (bayGio - v.luc > GIU_QUYET_DINH_SOM_MS) lyDoBacTheoAction.delete(k);
  lyDoBacTheoAction.set(actionId, { lyDo, luc: bayGio });
}

/** Lý do đã ghi (nếu có) — đọc rồi XOÁ (một lượt chờ dùng một lần). */
export function layLyDoBac(actionId: string): string | null {
  const v = lyDoBacTheoAction.get(actionId);
  if (!v) return null;
  lyDoBacTheoAction.delete(actionId);
  return v.lyDo;
}

/** Huỷ thất bại ⇒ bỏ lý do đã ghi (không để nó dính vào một lần bác khác). */
export function boLyDoBac(actionId: string): void {
  lyDoBacTheoAction.delete(actionId);
}

export function _xoaBusDuyet(): void {
  nguoiChoTheoAction.clear();
  quyetDinhSom.clear();
  lyDoBacTheoAction.clear();
}
