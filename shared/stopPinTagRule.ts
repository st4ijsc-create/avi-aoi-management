/**
 * doc 81 Đợt 4 Task C1 — LUẬT DUY NHẤT "sửa tag này có GỠ ghim DỪNG không" (chuyển từ
 * `server/services/ot/stopPin.ts`, nơi đó RE-EXPORT chính hàm này — một bản cài đặt).
 *
 *   • server — `deviceAdapter.tags.update` + `mappingAsCode.apply` gỡ ghim trong CÙNG transaction khi hàm
 *     này trả một nguồn gỡ (kèm audit);
 *   • client — form/công tắc sửa tag ở màn Device Adapter HỎI TRƯỚC (khoá `deviceAdapter.stopPin.confirmOff.*`)
 *     khi đúng hàm này nói lượt lưu sẽ gỡ ghim.
 *
 * Bản .mjs của CLI (`scripts/lib/stopPinCli.mjs#lyDoGoStopPinCli`) không nạp được TS — nó được so từng vector
 * với hàm này ở `scripts/lib/stopPinCli.unit.test.ts`.
 *
 * Thuần, không phụ thuộc drizzle/DB: nhận hình dạng cấu trúc của một hàng `device_tags` (server: hàng drizzle;
 * client: hàng `tags.listByAdapter`). Trường vắng ⇒ coi như KHÔNG đạt (vd `writable` vắng ⇒ "tag_not_writable")
 * — chiều an toàn: hỏi/gỡ thay vì im lặng giữ ghim.
 */

/** Nguồn gỡ ghim TỰ ĐỘNG (khác "manual" = setStopPin). */
export type NguonGoStopPinTuDong =
  | "tag_not_writable"
  | "tag_disabled"
  | "tag_redefined"
  | "tag_deleted"
  | "adapter_deleted"
  | "adapter_redefined";

/** Hình dạng tối thiểu của một hàng tag mà luật đọc. */
export interface TagChoLuatGoGhim {
  stopValue?: unknown;
  writable?: boolean | null;
  isEnabled?: boolean | null;
  address?: string | null;
  dataType?: string | null;
  adapterId?: number | null;
  scale?: unknown;
  offset?: unknown;
}

function soHoacNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * scale/offset HIỆU LỰC trên dây — cùng quy ước `inverseScale` (drivers/otScale.ts): scale null/0 ⇒ 1,
 * offset null ⇒ 0. So theo hiệu lực để form gửi ô trống (null) cho tag đang 1/0 không gỡ oan.
 */
function scaleHieuLuc(v: unknown): number | null {
  const n = soHoacNull(v);
  return n === null || n === 0 ? 1 : n;
}
function offsetHieuLuc(v: unknown): number | null {
  const n = soHoacNull(v);
  return n === null ? 0 : n;
}

/**
 * Sửa tag có làm ghim DỪNG mất hiệu lực không. Chỉ xét khi tag ĐANG có ghim. Trả nguồn gỡ hoặc null.
 *   • tag thành không ghi được / bị tắt;
 *   • đổi ĐỊNH NGHĨA DÂY — address, dataType, scale, offset, adapterId: cùng giá trị ghim sẽ đi tới một
 *     điểm/ý nghĩa KHÁC trên thiết bị (vd bit dừng đổi địa chỉ thành bit chạy) mà không qua lý do +
 *     audit của setStopPin ⇒ gỡ, người sửa phải ghim lại có chủ đích.
 *   Đổi tên tagKey, unit, deadband, samplingMs: không đổi gì trên dây ⇒ ghim giữ nguyên.
 * `patch`: trường vắng (undefined) = giữ giá trị hiện có.
 */
export function lyDoGoStopPinKhiSuaTag(
  existing: TagChoLuatGoGhim,
  patch: Record<string, unknown>,
): Extract<NguonGoStopPinTuDong, "tag_not_writable" | "tag_disabled" | "tag_redefined"> | null {
  if (existing.stopValue === null || existing.stopValue === undefined) return null;
  const moi = <K extends keyof TagChoLuatGoGhim>(k: K): unknown => (patch[k as string] !== undefined ? patch[k as string] : existing[k]);
  if (moi("writable") !== true) return "tag_not_writable";
  if (moi("isEnabled") !== true) return "tag_disabled";
  if (moi("address") !== existing.address) return "tag_redefined";
  if (moi("dataType") !== existing.dataType) return "tag_redefined";
  if (moi("adapterId") !== existing.adapterId) return "tag_redefined";
  if (scaleHieuLuc(moi("scale")) !== scaleHieuLuc(existing.scale)) return "tag_redefined";
  if (offsetHieuLuc(moi("offset")) !== offsetHieuLuc(existing.offset)) return "tag_redefined";
  return null;
}
