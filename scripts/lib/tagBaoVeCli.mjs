/**
 * kiem-dinh R1b-1 I2 (điều phối 2026-10-25) — ĐỊNH NGHĨA "tag ĐƯỢC BẢO VỆ" của `server/services/scada/troLaiKenh.ts` (T9 r3, `duocBaoVe`) viết
 * lại bằng SQL cho CLI `scripts/mappings-import.mjs` (SQL thô — không nạp được mã TS của server). Giữ KHỚP: `scripts/mappings-import.tagBaoVe.db.test.ts`
 * so hàm này với CHÍNH các hàm TS (`tagDaKhaiKenh`, `luatBaoVe`, `khoaLuatNhamCapTx`, `khoaLuatNguonTx`, `kenhCheDoCuaTagTx`) trên cùng dữ liệu.
 *
 *   • tag ĐÃ KHAI — `actuation_level` / `channel_kind` / `write_min` / `write_max` / `write_step` khác NULL, hoặc là kênh chế độ của một máy
 *     (`scada_kenh_che_do` trỏ (adapter, tagKey));
 *   • luật BẢO VỆ (`luatBaoVe`) — không phải `alert`, ĐANG BẬT HOẶC ĐÃ DUYỆT (`approvedBy` khác NULL), nhắm tag làm ĐÍCH (`targetAdapterId` +
 *     `commandTag`) hoặc đọc tag làm NGUỒN (`telemetry_tag`, `machineId` = máy của adapter, `sourceKey` = tagKey);
 *   • tag ĐƯỢC BẢO VỆ = đã khai HOẶC có luật bảo vệ;
 *   • khoá MỒ CÔI = (adapter, tagKey) mà kênh chế độ hoặc BẤT KỲ luật nào (đích / nguồn, mọi action, bật hay tắt) trỏ tới — TẠO tag lên khoá này
 *     là trỏ lại một tag được bảo vệ.
 *
 * Đọc KHÔNG khoá luật / kênh chế độ: CLI đã khoá tag FOR UPDATE; khoá luật SAU tag là đảo thứ tự ADAPTER → LUẬT → TAG của mọi đường khác
 * (troLaiKenh.ts) ⇒ có thể vòng chờ. Đua với một lượt bật / duyệt luật đồng thời: bám định nghĩa lúc duyệt (kiem-dinh I1 a) làm mọi duyệt cũ hết
 * hiệu lực khi định nghĩa tag đổi — CLI không mở được cửa nào mà bám đó không đóng lại.
 */

/** Cột tag mà đổi chúng là "trỏ lại / tắt" (khớp COT_TRO_LAI của troLaiKenh trừ tagKey/adapterId — CLI không đổi được hai cột đó — cộng `enabled`). */
export const COT_FILE_CHAM_BAO_VE = ["address", "datatype", "scale", "offset", "writable", "enabled"];

/**
 * Tập tagKey ĐƯỢC BẢO VỆ và tập khoá MỒ CÔI của MỘT adapter. `tx` = kết nối / giao dịch `postgres` (tagged template).
 * @returns {Promise<{ baoVe: Map<string, string[]>, moCoi: Map<string, string[]> }>} tagKey → lý do (để in)
 */
export async function tagBaoVeCuaAdapterTx(tx, adapterId) {
  const baoVe = new Map();
  const moCoi = new Map();
  const them = (m, k, lyDo) => {
    if (!k) return;
    const ds = m.get(k) ?? [];
    if (!ds.includes(lyDo)) ds.push(lyDo);
    m.set(k, ds);
  };
  const [ad] = await tx`SELECT "machineId" FROM device_adapters WHERE id = ${adapterId}`;
  const machineId = ad?.machineId ?? null;

  const daKhai = await tx`SELECT "tagKey" FROM device_tags WHERE "adapterId" = ${adapterId}
    AND (actuation_level IS NOT NULL OR channel_kind IS NOT NULL OR write_min IS NOT NULL OR write_max IS NOT NULL OR write_step IS NOT NULL)`;
  for (const r of daKhai) them(baoVe, r.tagKey, "da_khai_kenh");

  const cheDo = await tx`SELECT tag_key FROM scada_kenh_che_do WHERE adapter_id = ${adapterId}`;
  for (const r of cheDo) {
    them(baoVe, r.tag_key, "kenh_che_do");
    them(moCoi, r.tag_key, "kenh_che_do");
  }

  const dich = await tx`SELECT id, "commandTag" AS k, action::text AS action, enabled, "approvedBy" FROM interlock_rules
    WHERE "targetAdapterId" = ${adapterId} AND "commandTag" IS NOT NULL`;
  for (const r of dich) {
    them(moCoi, r.k, `luat_dich_${r.id}`);
    if (r.action !== "alert" && (r.enabled === true || r.approvedBy !== null)) them(baoVe, r.k, `luat_dich_${r.id}`);
  }

  if (machineId !== null) {
    const nguon = await tx`SELECT id, "sourceKey" AS k, action::text AS action, enabled, "approvedBy" FROM interlock_rules
      WHERE "sourceType"::text = 'telemetry_tag' AND "machineId" = ${machineId} AND "sourceKey" IS NOT NULL`;
    for (const r of nguon) {
      them(moCoi, r.k, `luat_nguon_${r.id}`);
      if (r.action !== "alert" && (r.enabled === true || r.approvedBy !== null)) them(baoVe, r.k, `luat_nguon_${r.id}`);
    }
  }
  return { baoVe, moCoi };
}

/**
 * THUẦN — các thao tác của một lô import đụng tag được bảo vệ / khoá mồ côi:
 *   • tạo lên khoá mồ côi (hoặc khoá đang được bảo vệ);
 *   • cập nhật một tag được bảo vệ ở cột trỏ lại / bật-tắt (`COT_FILE_CHAM_BAO_VE`; unit / deadband / sampling_ms không tính — như UI);
 *   • prune (xoá) một tag được bảo vệ.
 * @returns {Array<{ tagKey: string, viec: "tao" | "sua" | "xoa", lyDo: string[] }>}
 */
export function thaoTacChamBaoVe({ creates, updates, deletes }, { baoVe, moCoi }) {
  const ra = [];
  for (const k of creates) {
    const ly = [...(moCoi.get(k) ?? []), ...(baoVe.get(k) ?? [])];
    if (ly.length) ra.push({ tagKey: k, viec: "tao", lyDo: [...new Set(ly)] });
  }
  for (const u of updates) {
    if (!u.fields.some((f) => COT_FILE_CHAM_BAO_VE.includes(f))) continue;
    const ly = baoVe.get(u.tagKey);
    if (ly) ra.push({ tagKey: u.tagKey, viec: "sua", lyDo: ly });
  }
  for (const k of deletes) {
    const ly = baoVe.get(k);
    if (ly) ra.push({ tagKey: k, viec: "xoa", lyDo: ly });
  }
  return ra;
}
