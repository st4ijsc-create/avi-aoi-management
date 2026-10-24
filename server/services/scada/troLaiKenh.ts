/**
 * SCADA R1b-1 Task 9 (kiem-dinh, điều phối duyệt 2026-10-24) — TRỎ LẠI / TẠO / XOÁ / TẮT một tag hoặc adapter mà mức tác động, kênh chế độ
 * hoặc luật interlock đã duyệt đang trỏ tới. MỘT tệp luật cho MỌI đường ghi `device_tags` / `device_adapters` ngoài M12:
 * `deviceAdapter.tags.update|create|delete`, `mappingAsCode.applyImport` (cập nhật / tạo / prune), và cổng ADAPTER dùng chung
 * (`congAdapterTx`) cho `deviceAdapter.update` (đổi đích / tắt), `deviceAdapter.delete`, `scadaDiag.tamTat`.
 *
 * ĐỊNH NGHĨA (fix round 3, phán quyết T9 r3 — N2 + N4):
 *   • tag ĐÃ KHAI — mức tác động / loại kênh / một cận dải khác NULL, hoặc là kênh chế độ của một máy (`tagDaKhaiKenh`);
 *   • luật LIÊN QUAN của tag — luật interlock KHÔNG phải `alert` mà tag là ĐÍCH (`targetAdapterId` + `commandTag`) HOẶC NGUỒN (`telemetry_tag`,
 *     `machineId` = máy của adapter, `sourceKey` = tagKey);
 *   • tag ĐƯỢC BẢO VỆ — đã khai, HOẶC có luật liên quan ĐANG BẬT HOẶC ĐÃ DUYỆT (`luatBaoVe`) ⇒ "tắt luật → trỏ lại tag → bật lại" cần TOTP ở
 *     bước trỏ lại (luật đã duyệt vẫn bảo vệ khi tắt);
 *   • TỪ CHỐI mất đích / mất nguồn (`INTERLOCK_MAT_DICH`) — chỉ luật liên quan ĐANG BẬT (`luatBatCoGhi`): đổi tên / chuyển adapter / tắt / xoá
 *     tag, tắt / xoá adapter;
 *   • khoá MỒ CÔI — (adapterId, tagKey) mà `scada_kenh_che_do` hoặc BẤT KỲ luật interlock nào (đích hoặc nguồn, bật hay tắt) trỏ tới. Tạo /
 *     đổi tên / chuyển adapter / import-tạo LÊN khoá mồ côi = trỏ lại một tag được bảo vệ (I3: kiểm danh tính MỚI).
 *
 * LUẬT:
 *   • Sửa (`kiemSuaTag`): cột trỏ lại THẬT SỰ đổi (`cotTroLaiDoi` — chuẩn hoá như đường ĐỌC: scale null ⇒ 1, 0 GIỮ 0; offset null ⇒ 0; tagKey /
 *     address so CHÍNH XÁC — khác hoa/thường hoặc khoảng trắng LÀ thay đổi, chiều an toàn M6) trên tag được bảo vệ, hoặc danh tính mới là khoá
 *     mồ côi, hoặc TẮT một tag được bảo vệ (N7) ⇒ TOTP TƯƠI (bên gọi `kiemTotpCauHinh`, đặt CUỐI) + kiểm lại nhất quán:
 *       – kênh chế độ không chuyển adapter; dải ↔ dataType; loại kênh ghi ↔ writable;
 *       – ghim DỪNG (tag đã khai): còn ghi được trên định nghĩa mới (`STOP_PIN_NGOAI_DAI`) RỒI "gỡ ghim trước" (`STOP_PIN_GO_TRUOC`) cho MỌI
 *         đổi định nghĩa dây (address/scale/offset/dataType/writable/adapterId) và cho tắt tag (phán quyết T9 b). Chỉ đổi tên ⇒ ghim giữ;
 *       – luật ĐÍCH đang bật trên danh tính CŨ: đổi dataType/writable/scale/offset ⇒ giá trị GỬI phải còn ghi được (`INTERLOCK_NGOAI_DAI`);
 *         đổi tên / chuyển adapter / tắt tag là đích hoặc nguồn của luật bật ⇒ `INTERLOCK_MAT_DICH` (I2);
 *       – luật ĐÍCH đang bật trên danh tính MỚI ⇒ giá trị GỬI phải ghi được lên tag này (I3).
 *   • Tạo (`kiemTaoTag`): lên khoá mồ côi ⇒ TOTP + luật đích đang bật ở khoá đó phải ghi được lên tag mới.
 *   • Xoá / prune (`kiemXoaTag`): kênh chế độ ⇒ từ chối (`scadaKenhCheDoGoTruoc`); đích / nguồn của luật bật ⇒ `INTERLOCK_MAT_DICH`; đã khai
 *     đang ghim ⇒ `STOP_PIN_GO_TRUOC`; còn lại được bảo vệ ⇒ TOTP.
 *   • Adapter (`congAdapterTx`, N1/N3): xoá mà còn kênh chế độ ⇒ từ chối; đổi máy mà còn kênh chế độ ⇒ từ chối; tắt / xoá / đổi máy (T10b m1) mà
 *     một tag của nó là đích / nguồn của luật bật ⇒ `INTERLOCK_MAT_DICH`; tag đã khai đang ghim ⇒ `STOP_PIN_GO_TRUOC`; còn tag được bảo vệ / kênh chế độ ⇒ TOTP +
 *     audit.
 *   • Không được bảo vệ, không mồ côi ⇒ hành vi cũ (không đòi mã; luật gỡ ghim doc 81 cũ vẫn chạy cho tag chưa khai).
 *
 * ★ THỨ TỰ KHOÁ DUY NHẤT (fix round 3, N6): ADAPTER → LUẬT → TAG → KÊNH CHẾ ĐỘ. Mỗi đường lấy một DÃY CON theo đúng thứ tự này:
 *     tags.update / create / delete, import:   adapter FOR SHARE (theo id) → luật FOR SHARE → tag FOR UPDATE → kênh chế độ;
 *     deviceAdapter.update / delete, tamTat:   adapter FOR UPDATE → luật FOR SHARE → tag FOR UPDATE → kênh chế độ FOR SHARE (`congAdapterTx`);
 *     interlockRouter create/update/approve/enable: luật FOR UPDATE → tag FOR SHARE (enable, T10b: + tag nguồn FOR SHARE; adapter đọc
 *     KHÔNG khoá — khoá nó sau luật là đảo thứ tự);   scadaKenh.capNhat: adapter FOR SHARE (R1b-1 T10: machineId của phép kiểm phạm vi đọc ở đây) → luật FOR SHARE → tag FOR UPDATE;
 *     scadaKenh.cheDo.dat: adapter FOR SHARE → tag FOR SHARE → kênh chế độ FOR UPDATE.
 *   LUẬT đứng TRƯỚC TAG (không phải sau) vì interlockRouter / scadaKenh.capNhat đã khoá luật trước tag từ R1a — đảo lại sẽ tạo vòng chờ với
 *   chúng. Không đường nào khoá ngược một cặp ⇒ không vòng chờ (40P01).
 */
import { and, eq } from "drizzle-orm";
import { deviceAdapters, deviceTags, interlockRules, scadaKenhCheDo, type DeviceTag } from "../../../drizzle/schema";
import { appError } from "../../_core/appError";
import { validateStopValue } from "../ot/stopPin";
import { laKenhGhi } from "./kenhScada";
import { giaTriLenhInterlock, kiemNhatQuanKenh, luatCoGhiLenh, soHienThi, type DbHoacTx, type KenhNhatQuan, type LuatNhamTag, type MaViPham } from "./nhatQuanKenh";

/** Cột TRỎ LẠI của một tag (brief: address/scale/offset/dataType/writable/tagKey; + adapterId — tags.update chuyển được tag sang adapter khác). */
export const COT_TRO_LAI = ["adapterId", "tagKey", "address", "dataType", "scale", "offset", "writable"] as const;
export type CotTroLai = (typeof COT_TRO_LAI)[number];

/** Cột làm giá trị lệnh của luật interlock có thể không còn ghi được (ép kiểu / lưới thô / tag thôi ghi). */
const COT_ANH_HUONG_GHI: ReadonlySet<CotTroLai> = new Set(["dataType", "writable", "scale", "offset"]);
/** Cột đổi DANH TÍNH (adapterId, tagKey) — luật nhắm danh tính cũ mất đích. */
const COT_DANH_TINH: ReadonlySet<CotTroLai> = new Set(["adapterId", "tagKey"]);
/** Cột ĐỊNH NGHĨA DÂY (phán quyết T9 b) — tag đã khai đang ghim DỪNG: đổi một trong số này ⇒ "gỡ ghim trước". tagKey KHÔNG thuộc. */
const COT_DINH_NGHIA_DAY: ReadonlySet<CotTroLai> = new Set(["address", "scale", "offset", "dataType", "writable", "adapterId"]);

/** Trần số tag ĐƯỢC BẢO VỆ bị đụng (trỏ lại / tạo lên khoá mồ côi / xoá) trong MỘT lô import (= trần khai kênh hàng loạt đã lên kế hoạch). */
export const TRAN_KENH_DA_KHAI_MOT_LO = 200;

export type HangTagTroLai = Pick<
  DeviceTag,
  | "id"
  | "adapterId"
  | "tagKey"
  | "address"
  | "dataType"
  | "scale"
  | "offset"
  | "writable"
  | "isEnabled"
  | "stopValue"
  | "channelKind"
  | "writeMin"
  | "writeMax"
  | "writeStep"
  | "actuationLevel"
>;

/** Giá trị các cột trỏ lại SAU khi gộp patch (scale/offset giữ dạng cột: chuỗi decimal | null). */
export type GiaTriTroLai = Pick<DeviceTag, CotTroLai>;

/** Luật liên quan một tag (đích hoặc nguồn), kèm đích / nguồn / trạng thái duyệt (để lọc theo cặp khi khoá theo adapter / máy). */
export type LuatCoDich = LuatNhamTag & { commandTag: string | null; sourceKey: string | null; approvedBy: number | null };

/**
 * I1 (phán quyết T9) — chuẩn hoá NHƯ ĐƯỜNG ĐỌC: mọi driver đọc `raw * (scale ?? 1) + offset` ⇒ scale null/"" ⇒ 1, `0` GIỮ `0` (nhân 0 —
 * tag luôn đọc ra offset) ⇒ 0 ↔ 1 là MỘT thay đổi. offset null/"" ⇒ 0.
 */
export function scaleDoc(v: unknown): number {
  if (v === null || v === undefined || v === "") return 1;
  return Number(v);
}
export function offsetDoc(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  return Number(v);
}

/** THUẦN — tag ĐÃ KHAI kênh: mức / loại kênh / một cận dải khác NULL, hoặc là kênh chế độ của một máy. */
export function tagDaKhaiKenh(
  tag: Pick<DeviceTag, "actuationLevel" | "channelKind" | "writeMin" | "writeMax" | "writeStep">,
  laKenhCheDo: boolean,
): boolean {
  return laKenhCheDo || tag.actuationLevel != null || tag.channelKind != null || tag.writeMin != null || tag.writeMax != null || tag.writeStep != null;
}

/** Luật ĐANG BẬT, không phải `alert` — lớp TỪ CHỐI mất đích / mất nguồn (`INTERLOCK_MAT_DICH`) và kiểm giá trị GỬI. */
const luatBatCoGhi = (r: LuatNhamTag): boolean => r.enabled === true && luatCoGhiLenh(r.action);
/**
 * N2 (fix round 3) — luật BẢO VỆ tag: không phải `alert`, ĐANG BẬT HOẶC ĐÃ DUYỆT (tắt luật không gỡ được bảo vệ của nó).
 * R1b-1 T10b (n2) — `approvedBy` BẮT BUỘC trong kiểu (`number | null`, không `?`): một bộ nạp quên chọn cột sẽ lỗi BIÊN DỊCH thay vì lặng lẽ
 * rơi về "chỉ luật đang bật". `undefined` lọt qua lúc chạy (dữ liệu không qua kiểu) ⇒ coi như ĐÃ DUYỆT (chiều an toàn: bảo vệ thừa, không thiếu).
 */
export const luatBaoVe = (r: LuatNhamTag & { approvedBy: number | null }): boolean =>
  luatCoGhiLenh(r.action) && (r.enabled === true || r.approvedBy !== null);

/**
 * R1b-1 T10b (n1) — CÔNG THỨC DUY NHẤT "tag / adapter ĐƯỢC BẢO VỆ": đã khai kênh (kể cả kênh chế độ), HOẶC một luật liên quan — đích hoặc
 * nguồn — bảo vệ nó (`luatBaoVe`). `kiemSuaTag`, `kiemXoaTag` và `congAdapterTx` đều gọi ĐÚNG hàm này (trước: chép tay ba lần).
 */
export function duocBaoVe(daKhai: boolean, ...luatLienQuan: ReadonlyArray<ReadonlyArray<LuatNhamTag & { approvedBy: number | null }>>): boolean {
  return daKhai || luatLienQuan.some((ds) => ds.some(luatBaoVe));
}

/** THUẦN — gộp patch (trường `undefined` = giữ nguyên) lên các cột trỏ lại của hàng DB. */
export function giaTriSauTroLai(cu: HangTagTroLai, patch: Record<string, unknown>): GiaTriTroLai {
  const lay = <K extends CotTroLai>(k: K): GiaTriTroLai[K] => (patch[k] !== undefined ? (patch[k] as GiaTriTroLai[K]) : cu[k]);
  return {
    adapterId: lay("adapterId"),
    tagKey: lay("tagKey"),
    address: lay("address"),
    dataType: lay("dataType"),
    scale: lay("scale"),
    offset: lay("offset"),
    writable: lay("writable"),
  };
}

/** THUẦN — cột trỏ lại THẬT SỰ đổi so với hàng DB (scale/offset chuẩn hoá như đường đọc — I1). */
export function cotTroLaiDoi(cu: HangTagTroLai, sau: GiaTriTroLai): CotTroLai[] {
  const doi: CotTroLai[] = [];
  if (sau.adapterId !== cu.adapterId) doi.push("adapterId");
  if (sau.tagKey !== cu.tagKey) doi.push("tagKey");
  if (sau.address !== cu.address) doi.push("address");
  if (sau.dataType !== cu.dataType) doi.push("dataType");
  if (scaleDoc(sau.scale) !== scaleDoc(cu.scale)) doi.push("scale");
  if (offsetDoc(sau.offset) !== offsetDoc(cu.offset)) doi.push("offset");
  if ((sau.writable === true) !== (cu.writable === true)) doi.push("writable");
  return doi;
}

/** Khai báo kênh (cột mig 0431 của hàng) với các cột trỏ lại MỚI — đầu vào của `kiemNhatQuanKenh`. */
function kenhMoiCua(cu: Pick<DeviceTag, "channelKind" | "writeMin" | "writeMax" | "writeStep"> | null, sau: GiaTriTroLai): KenhNhatQuan {
  return {
    dataType: sau.dataType,
    writable: sau.writable,
    channelKind: cu?.channelKind ?? null,
    writeMin: cu?.writeMin ?? null,
    writeMax: cu?.writeMax ?? null,
    writeStep: cu?.writeStep ?? null,
    scale: sau.scale,
    offset: sau.offset,
  };
}

// ─── Khoá / đọc ngữ cảnh (thứ tự ADAPTER → LUẬT → TAG → KÊNH CHẾ ĐỘ, xem đầu tệp) ─────────────────────────────────────────────────

const COT_LUAT = {
  id: interlockRules.id,
  name: interlockRules.name,
  action: interlockRules.action,
  enabled: interlockRules.enabled,
  approvedBy: interlockRules.approvedBy,
  commandValue: interlockRules.commandValue,
  commandTag: interlockRules.commandTag,
  sourceKey: interlockRules.sourceKey,
};

/**
 * ADAPTER — khoá FOR SHARE các adapter (theo id tăng dần), trả `machineId` của từng cái (máy quyết luật NGUỒN của tag). Adapter không tồn tại
 * ⇒ vắng trong Map. Chỉ `eq` (FakeDb của test router cũ hiểu được).
 */
export async function khoaAdapterTx(tx: DbHoacTx, ids: ReadonlyArray<number>): Promise<Map<number, { machineId: number | null }>> {
  const out = new Map<number, { machineId: number | null }>();
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const [a] = await tx.select({ id: deviceAdapters.id, machineId: deviceAdapters.machineId }).from(deviceAdapters).where(eq(deviceAdapters.id, id)).for("share");
    if (a) out.set(id, { machineId: a.machineId ?? null });
  }
  return out;
}

/** LUẬT ĐÍCH — mọi luật interlock nhắm (adapterId, tagKey), bật hay tắt, khoá FOR SHARE theo id. */
export async function khoaLuatNhamCapTx(tx: DbHoacTx, e: { adapterId: number; tagKey: string }): Promise<LuatCoDich[]> {
  return tx
    .select(COT_LUAT)
    .from(interlockRules)
    .where(and(eq(interlockRules.targetAdapterId, e.adapterId), eq(interlockRules.commandTag, e.tagKey)))
    .orderBy(interlockRules.id)
    .for("share");
}

/** LUẬT ĐÍCH theo adapter — mọi luật nhắm một adapter (bật hay tắt), khoá FOR SHARE theo id (import / cổng adapter khoá MỘT lần). */
export async function khoaLuatNhamAdapterTx(tx: DbHoacTx, adapterId: number): Promise<LuatCoDich[]> {
  return tx.select(COT_LUAT).from(interlockRules).where(eq(interlockRules.targetAdapterId, adapterId)).orderBy(interlockRules.id).for("share");
}

/**
 * LUẬT NGUỒN (N4) — luật `telemetry_tag` của máy `machineId` (cổng đọc giá trị sống theo (máy, sourceKey) trên mọi adapter của máy), lọc theo
 * `tagKey` khi có. Máy NULL ⇒ không luật nào (adapter không gắn máy không làm nguồn được). Khoá FOR SHARE theo id.
 */
export async function khoaLuatNguonTx(tx: DbHoacTx, machineId: number | null | undefined, tagKey?: string): Promise<LuatCoDich[]> {
  if (machineId == null) return [];
  const dk =
    tagKey === undefined
      ? and(eq(interlockRules.sourceType, "telemetry_tag"), eq(interlockRules.machineId, machineId))
      : and(eq(interlockRules.sourceType, "telemetry_tag"), eq(interlockRules.machineId, machineId), eq(interlockRules.sourceKey, tagKey));
  return tx.select(COT_LUAT).from(interlockRules).where(dk).orderBy(interlockRules.id).for("share");
}

/**
 * KÊNH CHẾ ĐỘ trỏ tới (adapterId, tagKey) — khoá FOR UPDATE (bên gọi có thể đổi tag_key của chúng trong cùng giao dịch). Hàng chưa có
 * không bị khoá, nhưng `scadaKenh.cheDo.dat` khoá TAG FOR SHARE trước khi chèn (M1) ⇒ chờ giao dịch đang giữ tag FOR UPDATE.
 */
export async function kenhCheDoCuaTagTx(tx: DbHoacTx, e: { adapterId: number; tagKey: string }): Promise<Array<{ machineId: number }>> {
  return tx
    .select({ machineId: scadaKenhCheDo.machineId })
    .from(scadaKenhCheDo)
    .where(and(eq(scadaKenhCheDo.adapterId, e.adapterId), eq(scadaKenhCheDo.tagKey, e.tagKey)))
    .for("update");
}

/** Có tag nào (khác `boQuaId`) đang mang (adapterId, tagKey) không — kiểm trùng TRƯỚC kiểm mã (M3: trùng không tiêu mã). */
export async function trungKhoaTagTx(tx: DbHoacTx, e: { adapterId: number; tagKey: string; boQuaId?: number }): Promise<boolean> {
  const rows = await tx
    .select({ id: deviceTags.id })
    .from(deviceTags)
    .where(and(eq(deviceTags.adapterId, e.adapterId), eq(deviceTags.tagKey, e.tagKey)));
  return rows.some((r) => r.id !== e.boQuaId);
}

export const loiTrungKhoaTag = () => appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "deviceTag" }, "Tag key đã tồn tại trong adapter này.");

/** Luật trong một tập (khoá theo adapter) nhắm `tagKey`. */
export const luatCuaTag = (luat: ReadonlyArray<LuatCoDich>, tagKey: string): LuatCoDich[] => luat.filter((r) => r.commandTag === tagKey);
/** Luật nguồn trong một tập (khoá theo máy) đọc `tagKey`. */
export const nguonCuaTag = (luat: ReadonlyArray<LuatCoDich>, tagKey: string): LuatCoDich[] => luat.filter((r) => r.sourceKey === tagKey);

// ─── Cổng ADAPTER dùng chung (N1 / N3 / I5 / r2) ─────────────────────────────────────────────────────────────────────────────────

export type ViecAdapter = "doi_dich" | "tat" | "xoa";

const AUDIT_THEO_VIEC: Record<ViecAdapter, string> = {
  doi_dich: "adapter_bao_ve_doi_dich",
  tat: "adapter_bao_ve_tat",
  xoa: "adapter_bao_ve_xoa",
};
const LOI_THEO_VIEC: Record<ViecAdapter, string> = { doi_dich: "đổi thiết bị đích của adapter", tat: "tắt adapter", xoa: "xoá adapter" };

/**
 * NÉM appError — cổng ADAPTER cho `deviceAdapter.update` (đổi đích / tắt), `deviceAdapter.delete`, `scadaDiag.tamTat`. Bên gọi ĐÃ khoá hàng
 * adapter FOR UPDATE (ADAPTER), hàm này khoá LUẬT (đích theo adapter + nguồn theo máy) FOR SHARE → TAG FOR UPDATE → KÊNH CHẾ ĐỘ FOR SHARE.
 * Thứ tự từ chối (mọi kiểm TRƯỚC TOTP — bên gọi gọi `kiemTotpCauHinh` khi `canTotp`):
 *   1. xoá mà còn kênh chế độ ⇒ `scadaKenhCheDoGoTruocXoaAdapter`; đổi máy mà còn kênh chế độ ⇒ `scadaKenhCheDoDoiMay`;
 *   2. tắt / xoá / ĐỔI MÁY (T10b m1) mà một luật ĐANG BẬT (không `alert`) nhắm adapter, hoặc đọc nguồn từ một tag của nó ⇒ `INTERLOCK_MAT_DICH`;
 *   3. tag đã khai (kể cả kênh chế độ) đang ghim DỪNG ⇒ `STOP_PIN_GO_TRUOC` nêu tên tag;
 *   4. `canTotp` khi adapter còn kênh chế độ / tag đã khai / luật liên quan bật hoặc đã duyệt.
 */
export async function congAdapterTx(
  tx: DbHoacTx,
  e: { adapterId: number; code: string; machineId: number | null; viec: ViecAdapter; doiMay?: boolean; machineIdMoi?: number | null },
): Promise<{ canTotp: boolean; auditAction: string; baoVe: boolean }> {
  const luatDich = await khoaLuatNhamAdapterTx(tx, e.adapterId);
  const luatNguonMay = await khoaLuatNguonTx(tx, e.machineId);
  // đổi máy ⇒ tag của adapter thành NGUỒN cho luật telemetry_tag của máy MỚI cùng sourceKey (danh tính mới — I3 ở cấp adapter)
  const luatNguonMayMoi = e.doiMay === true ? await khoaLuatNguonTx(tx, e.machineIdMoi ?? null) : [];
  const tags = await tx
    .select({
      tagKey: deviceTags.tagKey,
      stopValue: deviceTags.stopValue,
      actuationLevel: deviceTags.actuationLevel,
      channelKind: deviceTags.channelKind,
      writeMin: deviceTags.writeMin,
      writeMax: deviceTags.writeMax,
      writeStep: deviceTags.writeStep,
    })
    .from(deviceTags)
    .where(eq(deviceTags.adapterId, e.adapterId))
    .orderBy(deviceTags.tagKey)
    .for("update");
  const kenh = await tx
    .select({ machineId: scadaKenhCheDo.machineId, tagKey: scadaKenhCheDo.tagKey })
    .from(scadaKenhCheDo)
    .where(eq(scadaKenhCheDo.adapterId, e.adapterId))
    .for("share");

  const tagKeys = new Set(tags.map((t) => t.tagKey));
  const luatNguon = luatNguonMay.filter((r) => r.sourceKey != null && tagKeys.has(r.sourceKey));
  const luatNguonMoi = luatNguonMayMoi.filter((r) => r.sourceKey != null && tagKeys.has(r.sourceKey));
  const luatLienQuan = [...luatDich, ...luatNguon];
  const kenhCheDoTag = new Set(kenh.map((k) => k.tagKey));

  if (e.viec === "xoa" && kenh.length > 0) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "adapterId", reason: "scadaKenhCheDoGoTruocXoaAdapter" },
      `Adapter ${e.code} đang mang ${kenh.length} kênh chế độ của máy — gỡ kênh chế độ (trang Kênh & giới hạn, cần mã xác thực) trước khi xoá adapter.`,
    );
  }
  if (e.doiMay === true && kenh.length > 0) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "machineId", reason: "scadaKenhCheDoDoiMay" },
      `Adapter ${e.code} đang mang ${kenh.length} kênh chế độ của máy — gỡ kênh chế độ trước khi gán adapter sang máy khác.`,
    );
  }
  // R1b-1 T10b (m1) — ĐỔI MÁY là đổi danh tính NGUỒN ở cấp adapter (luật telemetry_tag đọc theo (máy, sourceKey)) — tương đương đổi tên /
  // chuyển adapter một tag ⇒ cùng từ chối `INTERLOCK_MAT_DICH` như cấp tag (R-FR3-2), không chỉ đòi TOTP: luật ĐANG BẬT đọc nguồn từ một tag
  // của adapter sẽ mù, luật ĐANG BẬT ghi lệnh lên adapter sẽ ghi xuống thiết bị đã thuộc máy khác. Đứng TRƯỚC kiểm ghim và TOTP.
  if (e.viec !== "doi_dich" || e.doiMay === true) {
    const bat = luatLienQuan.find(luatBatCoGhi);
    const viec = e.viec === "doi_dich" ? "chuyển adapter sang máy khác" : LOI_THEO_VIEC[e.viec];
    if (bat) loiMatDich((luatDich.includes(bat) ? bat.commandTag : bat.sourceKey) ?? "—", bat, viec);
  }
  const ghimDaKhai = tags
    .filter((t) => t.stopValue !== null && t.stopValue !== undefined && tagDaKhaiKenh(t, kenhCheDoTag.has(t.tagKey)))
    .map((t) => ({ tagKey: t.tagKey, stopValue: t.stopValue }));
  kiemGhimAdapter(ghimDaKhai, LOI_THEO_VIEC[e.viec]);

  const daKhai = kenh.length > 0 || tags.some((t) => tagDaKhaiKenh(t, false));
  // n1 — cùng công thức với cấp tag; + khoá MỒ CÔI ở máy mới (BẤT KỲ luật nguồn nào của máy mới đọc một tagKey của adapter — như kiemTaoTag).
  const baoVe = duocBaoVe(daKhai, luatDich, luatNguon) || luatNguonMoi.length > 0;
  return { canTotp: baoVe, auditAction: AUDIT_THEO_VIEC[e.viec], baoVe };
}

/**
 * Fix round 2 (phán quyết T9 b ở cấp adapter) — adapter còn tag ĐÃ KHAI đang ghim DỪNG ⇒ `STOP_PIN_GO_TRUOC` nêu tên (các) tag; gỡ ghim từng
 * tag trước (thao tác riêng có lý do). Tag CHƯA khai đang ghim giữ luật gỡ tự động của doc 81 (`goMoiStopPinCuaAdapterTx`) khi đổi đích.
 */
export function kiemGhimAdapter(ghimDaKhai: ReadonlyArray<{ tagKey: string; stopValue: unknown }>, viec: string): void {
  if (ghimDaKhai.length === 0) return;
  const dau = ghimDaKhai.slice(0, 5);
  const them = ghimDaKhai.length > 5 ? ", …" : "";
  const ten = dau.map((g) => g.tagKey).join(", ") + them;
  throw appError(
    "BAD_REQUEST",
    "STOP_PIN_GO_TRUOC",
    { ma: "STOP_PIN_GO_TRUOC", tagKey: ten, stopValue: dau.map((g) => String(g.stopValue)).join(", ") + them, soTag: ghimDaKhai.length },
    `Adapter còn ${ghimDaKhai.length} tag đã khai đang ghim giá trị DỪNG (${ten}) — ${viec} sẽ làm mất STOP. Gỡ ghim từng tag trước (có lý do), rồi làm lại.`,
  );
}

// ─── Lỗi ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function loiMatDich(tagKey: string, r: LuatNhamTag, viec: string): never {
  throw appError(
    "BAD_REQUEST",
    "INTERLOCK_MAT_DICH",
    { ma: "INTERLOCK_MAT_DICH", tagKey, ruleId: r.id },
    `Luật interlock đang bật #${r.id} (${r.name}) dùng tag ${tagKey} (đích ghi lệnh hoặc nguồn đọc) — ${viec} sẽ làm hành động bảo vệ mất đích / mất nguồn. Sửa luật (hoặc tắt luật) trước.`,
  );
}

function loiGoGhimTruoc(cu: Pick<DeviceTag, "tagKey" | "stopValue">, viec: string): never {
  throw appError(
    "BAD_REQUEST",
    "STOP_PIN_GO_TRUOC",
    { ma: "STOP_PIN_GO_TRUOC", tagKey: cu.tagKey, stopValue: String(cu.stopValue) },
    `Kênh ${cu.tagKey} đang ghim giá trị DỪNG (${String(cu.stopValue)}) — ${viec} sẽ làm mất STOP. Gỡ ghim trước (Tag dừng phần mềm, có lý do), rồi làm lại.`,
  );
}

function loiNgoaiDai(tagKey: string, cu: Pick<DeviceTag, "writeMin" | "writeMax" | "writeStep"> | null, vp: { ruleId: number; ruleName: string; ma: MaViPham; chiTiet: string }): never {
  throw appError(
    "BAD_REQUEST",
    "INTERLOCK_NGOAI_DAI",
    {
      ma: "INTERLOCK_NGOAI_DAI",
      lyDo: vp.ma,
      tagKey,
      min: soHienThi(cu?.writeMin),
      max: soHienThi(cu?.writeMax),
      step: soHienThi(cu?.writeStep),
      ruleId: vp.ruleId,
    },
    `Luật interlock đang bật #${vp.ruleId} (${vp.ruleName}) ghi một giá trị không ghi được lên tag ${tagKey} (${vp.chiTiet}).`,
  );
}

/** QUA_NHIEU_KENH_DA_KHAI — lô import đụng quá trần tag được bảo vệ. */
export function loiQuaNhieuKenhDaKhai(soTag: number): never {
  throw appError(
    "BAD_REQUEST",
    "QUA_NHIEU_KENH_DA_KHAI",
    { soTag, toiDa: TRAN_KENH_DA_KHAI_MOT_LO },
    `Lô import đụng ${soTag} tag đã khai kênh / được bảo vệ — tối đa ${TRAN_KENH_DA_KHAI_MOT_LO} mỗi lô. Chia nhỏ file rồi nhập lại.`,
  );
}

// ─── Kiểm thuần ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * THUẦN — vi phạm đầu tiên của luật ĐANG BẬT (không phải `alert`) với định nghĩa tag `kenhMoi`: tag không ghi được (writable !== true ⇒
 * dispatch từ chối TAG_NOT_WRITABLE, bất kể khai báo kênh) hoặc giá trị GỬI không ghi được lên khai báo (`kiemNhatQuanKenh`).
 */
export function viPhamInterlockSauSua(
  luat: ReadonlyArray<LuatNhamTag>,
  kenhMoi: KenhNhatQuan,
): { ruleId: number; ruleName: string; ma: MaViPham; chiTiet: string } | null {
  for (const r of luat) {
    if (!luatBatCoGhi(r)) continue;
    if (kenhMoi.writable !== true) {
      return { ruleId: r.id, ruleName: r.name, ma: "CHANNEL_READ_ONLY", chiTiet: "Tag không cho phép ghi (writable=false) — dispatch từ chối mọi lệnh ghi." };
    }
    const kq = kiemNhatQuanKenh(kenhMoi, giaTriLenhInterlock(r));
    if (!kq.ok) return { ruleId: r.id, ruleName: r.name, ma: kq.ma, chiTiet: kq.chiTiet };
  }
  return null;
}

/**
 * NÉM appError — kiểm nhất quán của tag được bảo vệ sau khi trỏ lại (`doi` khác rỗng):
 *   1. kênh chế độ không đổi adapter; 2. dải/bước ↔ dataType; 3. loại kênh GHI ↔ writable;
 *   4. tag ĐÃ KHAI đang ghim DỪNG: ghim còn ghi được (`STOP_PIN_NGOAI_DAI`, kiểm TRƯỚC — test của brief) rồi "gỡ ghim trước" cho mọi đổi
 *      định nghĩa dây (`STOP_PIN_GO_TRUOC`).
 */
export function kiemNhatQuanSauTroLai(cu: HangTagTroLai, sau: GiaTriTroLai, doi: ReadonlyArray<CotTroLai>, laKenhCheDo: boolean, daKhai: boolean): void {
  if (laKenhCheDo && doi.includes("adapterId")) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "adapterId", reason: "scadaKenhCheDoKhongDoiAdapter" },
      `Tag ${cu.tagKey} là kênh chế độ của một máy — không chuyển sang adapter khác được; gỡ / khai lại kênh chế độ ở trang Kênh & giới hạn.`,
    );
  }
  const coDai = cu.writeMin != null || cu.writeMax != null || cu.writeStep != null;
  if (coDai && doi.includes("dataType") && sau.dataType !== "int" && sau.dataType !== "float") {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "dataType", reason: "scadaDaiChiChoKenhSo" },
      `Tag ${cu.tagKey} đã khai dải / bước — chỉ áp cho kênh số (int / float); không đổi sang ${sau.dataType} được. Bỏ khai dải trước.`,
    );
  }
  if (doi.includes("writable") && cu.channelKind != null && laKenhGhi({ channelKind: cu.channelKind, writable: sau.writable }) && sau.writable !== true) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "writable", reason: "scadaKenhGhiTrenTagKhongGhi" },
      `Loại kênh ${cu.channelKind} nhận lệnh ghi nhưng tag ${cu.tagKey} sẽ không cho phép ghi (writable=false). Đổi loại kênh trước.`,
    );
  }
  if (daKhai && cu.stopValue !== null && cu.stopValue !== undefined) {
    const v = validateStopValue(String(sau.dataType), cu.stopValue);
    const nq = v.ok ? kiemNhatQuanKenh(kenhMoiCua(cu, sau), v.value) : ({ ok: false, ma: "TYPE_MISMATCH", chiTiet: v.reason } as const);
    if (!nq.ok) {
      throw appError(
        "BAD_REQUEST",
        "STOP_PIN_NGOAI_DAI",
        {
          ma: "STOP_PIN_NGOAI_DAI",
          lyDo: nq.ma,
          tagKey: cu.tagKey,
          stopValue: String(cu.stopValue),
          min: soHienThi(cu.writeMin),
          max: soHienThi(cu.writeMax),
          step: soHienThi(cu.writeStep),
        },
        `Giá trị DỪNG đang ghim của kênh ${cu.tagKey} không ghi được với định nghĩa mới (${nq.chiTiet}). Gỡ / đổi ghim trước.`,
      );
    }
    if (doi.some((c) => COT_DINH_NGHIA_DAY.has(c))) loiGoGhimTruoc(cu, "đổi định nghĩa dây (địa chỉ / kiểu / scale / offset / ghi được / adapter)");
  }
}

export type KetQuaKiemSua = { sau: GiaTriTroLai; doi: CotTroLai[]; daKhai: boolean; baoVe: boolean; moCoi: boolean; canTotp: boolean };

/** Luật bật (không alert) đầu tiên trong luật đích rồi luật nguồn, kèm tagKey để nêu trong lỗi. */
function luatBatDauTien(dich: ReadonlyArray<LuatCoDich>, nguon: ReadonlyArray<LuatCoDich>): LuatCoDich | undefined {
  return dich.find(luatBatCoGhi) ?? nguon.find(luatBatCoGhi);
}

/**
 * NÉM appError — mọi kiểm của MỘT lượt sửa tag (tags.update / import-cập nhật), TRỪ TOTP (bên gọi gọi `kiemTotpCauHinh` khi `canTotp`).
 * `luatCu` / `nguonCu` = luật ĐÍCH / NGUỒN của danh tính CŨ; `luatMoi` / `nguonMoi` / `kenhCheDoMoi` = của danh tính MỚI (chỉ khi đổi tên /
 * chuyển adapter, ngược lại bỏ trống).
 */
export function kiemSuaTag(x: {
  cu: HangTagTroLai;
  patch: Record<string, unknown>;
  luatCu: ReadonlyArray<LuatCoDich>;
  nguonCu?: ReadonlyArray<LuatCoDich>;
  kenhCheDoCu: boolean;
  luatMoi?: ReadonlyArray<LuatCoDich>;
  nguonMoi?: ReadonlyArray<LuatCoDich>;
  kenhCheDoMoi?: boolean;
}): KetQuaKiemSua {
  const { cu, patch, luatCu, kenhCheDoCu } = x;
  const nguonCu = x.nguonCu ?? [];
  const sau = giaTriSauTroLai(cu, patch);
  const doi = cotTroLaiDoi(cu, sau);
  const daKhai = tagDaKhaiKenh(cu, kenhCheDoCu);
  const baoVe = duocBaoVe(daKhai, luatCu, nguonCu); // N2 + N4 (n1: một công thức)
  const doiDanhTinh = doi.some((c) => COT_DANH_TINH.has(c));
  const luatMoi = doiDanhTinh ? (x.luatMoi ?? []) : [];
  const nguonMoi = doiDanhTinh ? (x.nguonMoi ?? []) : [];
  const moCoi = doiDanhTinh && (x.kenhCheDoMoi === true || luatMoi.length > 0 || nguonMoi.length > 0);
  const tat = patch.isEnabled === false && cu.isEnabled === true;

  if (baoVe && doi.length > 0) kiemNhatQuanSauTroLai(cu, sau, doi, kenhCheDoCu, daKhai);
  if (tat && daKhai && cu.stopValue !== null && cu.stopValue !== undefined) loiGoGhimTruoc(cu, "tắt tag");

  const batCu = luatBatDauTien(luatCu, nguonCu);
  if (batCu && doiDanhTinh) loiMatDich(cu.tagKey, batCu, "đổi tên / chuyển adapter");
  if (batCu && tat) loiMatDich(cu.tagKey, batCu, "tắt tag"); // I2 — dispatch từ chối tag tắt (TAG_NOT_FOUND); nguồn tắt ⇒ luật mù
  if (doi.some((c) => COT_ANH_HUONG_GHI.has(c))) {
    const vp = viPhamInterlockSauSua(luatCu, kenhMoiCua(cu, sau));
    if (vp) loiNgoaiDai(cu.tagKey, cu, vp);
  }
  if (doiDanhTinh) {
    // I3 — danh tính MỚI: luật đích đang bật nhắm khoá đó sẽ ghi lên tag này.
    const vp = viPhamInterlockSauSua(luatMoi, kenhMoiCua(cu, sau));
    if (vp) loiNgoaiDai(sau.tagKey, cu, vp);
  }
  // N7 — tắt một tag được bảo vệ (đã khai / kênh chế độ / luật liên quan bật hoặc đã duyệt) cần mã, như tắt adapter.
  return { sau, doi, daKhai, baoVe, moCoi, canTotp: (baoVe && doi.length > 0) || moCoi || (tat && baoVe) };
}

/**
 * NÉM appError — tạo tag (tags.create / import-tạo) lên (adapterId, tagKey). Khoá mồ côi (kênh chế độ, hoặc BẤT KỲ luật đích / nguồn nào trỏ
 * tới) ⇒ `canTotp`; luật đích đang bật ở khoá đó phải ghi được lên tag mới (tag mới chưa khai cột kênh nào).
 */
export function kiemTaoTag(x: {
  moi: GiaTriTroLai & { isEnabled: boolean };
  luat: ReadonlyArray<LuatCoDich>;
  nguon?: ReadonlyArray<LuatCoDich>;
  coKenhCheDo: boolean;
}): { moCoi: boolean; canTotp: boolean } {
  const nguon = x.nguon ?? [];
  const moCoi = x.coKenhCheDo || x.luat.length > 0 || nguon.length > 0;
  const bat = luatBatDauTien(x.luat, nguon);
  if (bat && x.moi.isEnabled !== true) loiMatDich(x.moi.tagKey, bat, "tạo tag ở trạng thái tắt");
  const vp = viPhamInterlockSauSua(x.luat, kenhMoiCua(null, x.moi));
  if (vp) loiNgoaiDai(x.moi.tagKey, null, vp);
  return { moCoi, canTotp: moCoi };
}

/**
 * NÉM appError — xoá tag (tags.delete / import prune). Kênh chế độ ⇒ từ chối (gỡ kênh chế độ trước, qua `scadaKenh.cheDo.go` có TOTP);
 * đích / nguồn của luật bật ⇒ `INTERLOCK_MAT_DICH`; đã khai mà đang ghim DỪNG ⇒ `STOP_PIN_GO_TRUOC`; được bảo vệ ⇒ `canTotp`.
 */
export function kiemXoaTag(x: {
  cu: HangTagTroLai;
  luat: ReadonlyArray<LuatCoDich>;
  nguon?: ReadonlyArray<LuatCoDich>;
  coKenhCheDo: boolean;
}): { daKhai: boolean; baoVe: boolean; canTotp: boolean } {
  const { cu } = x;
  const nguon = x.nguon ?? [];
  if (x.coKenhCheDo) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "tagKey", reason: "scadaKenhCheDoGoTruoc" },
      `Tag ${cu.tagKey} là kênh chế độ của một máy — gỡ kênh chế độ (trang Kênh & giới hạn, cần mã xác thực) trước khi xoá tag.`,
    );
  }
  const bat = luatBatDauTien(x.luat, nguon);
  if (bat) loiMatDich(cu.tagKey, bat, "xoá tag");
  const daKhai = tagDaKhaiKenh(cu, false);
  if (daKhai && cu.stopValue !== null && cu.stopValue !== undefined) loiGoGhimTruoc(cu, "xoá tag");
  const baoVe = duocBaoVe(daKhai, x.luat, nguon);
  return { daKhai, baoVe, canTotp: baoVe };
}

// ─── Audit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Before/after của dòng audit `kenh_da_khai_tro_lai` (control_audit_log, WORM). */
export function anhTroLai(g: GiaTriTroLai): Record<string, unknown> {
  return {
    adapterId: g.adapterId,
    tagKey: g.tagKey,
    address: g.address,
    dataType: g.dataType,
    scale: scaleDoc(g.scale),
    offset: offsetDoc(g.offset),
    writable: g.writable,
  };
}

export const AUDIT_TRO_LAI = "kenh_da_khai_tro_lai";
export const AUDIT_TAO_KHOA_MO_COI = "kenh_tao_tren_khoa_mo_coi";
export const AUDIT_XOA_DA_KHAI = "kenh_da_khai_xoa";
export const AUDIT_KENH_CHE_DO_DOI_TAG = "scada_kenh_che_do_doi_tag";
