/**
 * R1b-1 T10 fix round 1 (I-2) — `aiCopilot.confirmAction` từ chối VĨNH VIỄN lệnh mức tác động ≥ 4 của trợ lý AI bằng một lỗi tRPC
 * (FORBIDDEN, appCode `SCADA_AI_LEVEL_TOO_HIGH`) chứ không còn trả `{status:"denied"}`. Mọi bề mặt xác nhận phải đóng thẻ ở trạng thái
 * `denied` (không để nút Xác nhận sống — mỗi lượt bấm lại bị từ chối và ghi nhật ký lại) và hiện câu đã dịch MỘT lần.
 *
 * Module THUẦN (không React): mỗi bề mặt gọi `tuChoiTuLoiXacNhan(err)` trong `catch`.
 */
import { mapTrpcError } from "./trpcErrors";

export const MA_AI_MUC_QUA_CAO = "SCADA_AI_LEVEL_TOO_HIGH" as const;

/** Lỗi tRPC này có phải "AI không bao giờ được ra lệnh mức ≥ 4" không (đọc `error.data.appCode`, cùng đường với `mapTrpcError`). */
export function laTuChoiAiMucCao(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: { appCode?: unknown } }).data;
  return !!data && data.appCode === MA_AI_MUC_QUA_CAO;
}

/** Lỗi xác nhận ⇒ kết cục thẻ `denied` + câu đã dịch (vi/en/zh theo i18n hiện hành); không phải ca này ⇒ null (người gọi xử lý như cũ). */
export function tuChoiTuLoiXacNhan(error: unknown): { state: "denied"; message: string } | null {
  return laTuChoiAiMucCao(error) ? { state: "denied", message: mapTrpcError(error) } : null;
}
