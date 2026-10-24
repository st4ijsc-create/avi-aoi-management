/**
 * SCADA R1b-1 Task 9 (kiem-dinh, điều phối duyệt 2026-10-24) — TRỎ LẠI một tag: đổi định nghĩa dây / danh tính của nó.
 *
 * Hai đường ghi `device_tags` ngoài M12 — `deviceAdapter.tags.update` và `mappingAsCode.applyImport` — đổi được các cột trỏ lại
 * (`COT_TRO_LAI`) mà không đi qua TOTP / kiểm nhất quán của `scadaKenh.capNhat`. Một tag ĐÃ KHAI kênh (mức tác động / loại kênh / dải
 * khác NULL) hoặc là KÊNH CHẾ ĐỘ của một máy mà bị trỏ lại thì mức / dải / kênh chế độ đã duyệt áp lên một điểm KHÁC trên thiết bị. Luật
 * (một tệp cho cả hai đường):
 *
 *   • Đã khai (`tagDaKhaiKenh`) + có cột trỏ lại THẬT SỰ đổi so với hàng DB (`cotTroLaiDoi`; scale/offset so theo HIỆU LỰC — form gửi lại
 *     giá trị cũ, ô trống cho 1/0, không tính) ⇒ TOTP TƯƠI (`kiemTotpCauHinh`, bên gọi đặt CUỐI) VÀ kiểm lại nhất quán trên hàng SAU khi đổi
 *     (`kiemNhatQuanSauTroLai`): dải ↔ dataType, loại kênh ↔ writable, dải/lưới ↔ giá trị DỪNG ghim.
 *   • MỌI tag (đã khai hay chưa), đổi dataType / writable / scale / offset ⇒ luật interlock ĐANG BẬT (không phải `alert`) nhắm tag phải còn
 *     ghi được giá trị GỬI (`giaTriLenhInterlock`) ⇒ không thì `INTERLOCK_NGOAI_DAI` (`kiemInterlockSauSua`). Đổi tagKey / adapterId ⇒ luật
 *     bật nhắm danh tính CŨ mất đích ⇒ `INTERLOCK_MAT_DICH`.
 *   • Kênh chế độ: đổi tagKey ⇒ bên gọi cập nhật `scada_kenh_che_do` trong CÙNG giao dịch (kênh chế độ vẫn chỉ cùng một tag vật lý);
 *     đổi adapterId ⇒ từ chối (kênh chế độ phải là tag của adapter gắn đúng máy — khai lại qua M12).
 *   • Tag chưa khai và không chạm luật interlock nào ⇒ hành vi cũ, không đòi mã.
 *
 * ⚠ GHIM DỪNG (phán quyết R1b-1 T9, xem báo cáo): luật gỡ ghim cũ (`lyDoGoStopPinKhiSuaTag`, doc 81 Đợt 1D) gỡ ghim khi đổi định nghĩa
 *   dây. Với tag ĐÃ KHAI, ghim được kiểm trên khai báo MỚI TRƯỚC luật gỡ: ghim không còn ghi được ⇒ `STOP_PIN_NGOAI_DAI` (người sửa gỡ /
 *   đổi ghim có chủ đích qua `setStopPin`, có lý do + audit), không để nó biến mất lặng lẽ như hệ quả phụ của việc trỏ lại. Ghim còn ghi
 *   được ⇒ luật gỡ cũ giữ nguyên.
 *
 * Thứ tự khoá LUẬT → TAG (như `scadaKenh.capNhat` / `interlockRouter`): bên gọi khoá luật FOR SHARE (`khoaLuatNhamTagTx` / theo adapter)
 * TRƯỚC khi khoá tag FOR UPDATE.
 */
import { and, eq } from "drizzle-orm";
import { interlockRules, scadaKenhCheDo, type DeviceTag } from "../../../drizzle/schema";
import { appError } from "../../_core/appError";
import { offsetHieuLuc, scaleHieuLuc } from "@shared/stopPinTagRule";
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

/** Trần số tag ĐÃ KHAI bị trỏ lại trong MỘT lô import (= trần khai kênh hàng loạt đã lên kế hoạch). */
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
  | "stopValue"
  | "channelKind"
  | "writeMin"
  | "writeMax"
  | "writeStep"
  | "actuationLevel"
>;

/** Giá trị các cột trỏ lại SAU khi gộp patch (scale/offset giữ dạng cột: chuỗi decimal | null). */
export type GiaTriTroLai = Pick<DeviceTag, CotTroLai>;

/** THUẦN — tag ĐÃ KHAI kênh (phán quyết 1): mức / loại kênh / một cận dải khác NULL, hoặc là kênh chế độ của một máy. */
export function tagDaKhaiKenh(
  tag: Pick<DeviceTag, "actuationLevel" | "channelKind" | "writeMin" | "writeMax" | "writeStep">,
  laKenhCheDo: boolean,
): boolean {
  return laKenhCheDo || tag.actuationLevel != null || tag.channelKind != null || tag.writeMin != null || tag.writeMax != null || tag.writeStep != null;
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

/** THUẦN — cột trỏ lại THẬT SỰ đổi so với hàng DB. scale/offset so theo hiệu lực (null/0 ⇒ 1; null ⇒ 0 — quy ước `inverseScale`). */
export function cotTroLaiDoi(cu: HangTagTroLai, sau: GiaTriTroLai): CotTroLai[] {
  const doi: CotTroLai[] = [];
  if (sau.adapterId !== cu.adapterId) doi.push("adapterId");
  if (sau.tagKey !== cu.tagKey) doi.push("tagKey");
  if (sau.address !== cu.address) doi.push("address");
  if (sau.dataType !== cu.dataType) doi.push("dataType");
  if (scaleHieuLuc(sau.scale) !== scaleHieuLuc(cu.scale)) doi.push("scale");
  if (offsetHieuLuc(sau.offset) !== offsetHieuLuc(cu.offset)) doi.push("offset");
  if ((sau.writable === true) !== (cu.writable === true)) doi.push("writable");
  return doi;
}

/** Khai báo kênh (cột mig 0431 của hàng) với các cột trỏ lại MỚI — đầu vào của `kiemNhatQuanKenh`. */
function kenhMoiCua(cu: HangTagTroLai, sau: GiaTriTroLai): KenhNhatQuan {
  return {
    dataType: sau.dataType,
    writable: sau.writable,
    channelKind: cu.channelKind,
    writeMin: cu.writeMin,
    writeMax: cu.writeMax,
    writeStep: cu.writeStep,
    scale: sau.scale,
    offset: sau.offset,
  };
}

/**
 * Kênh chế độ trỏ tới (adapterId, tagKey) — khoá FOR UPDATE (bên gọi có thể đổi tag_key của chúng trong cùng giao dịch). Chỉ dùng `eq`/`and`
 * (FakeDb của test router cũ hiểu được).
 */
export async function kenhCheDoCuaTagTx(tx: DbHoacTx, e: { adapterId: number; tagKey: string }): Promise<Array<{ machineId: number }>> {
  return tx
    .select({ machineId: scadaKenhCheDo.machineId })
    .from(scadaKenhCheDo)
    .where(and(eq(scadaKenhCheDo.adapterId, e.adapterId), eq(scadaKenhCheDo.tagKey, e.tagKey)))
    .for("update");
}

/** Mọi luật interlock nhắm một adapter (bật hay tắt), khoá FOR SHARE theo id — import khoá MỘT lần cho cả lô, TRƯỚC khi khoá tag. */
export async function khoaLuatNhamAdapterTx(tx: DbHoacTx, adapterId: number): Promise<Array<LuatNhamTag & { commandTag: string | null }>> {
  return tx
    .select({
      id: interlockRules.id,
      name: interlockRules.name,
      action: interlockRules.action,
      enabled: interlockRules.enabled,
      commandValue: interlockRules.commandValue,
      commandTag: interlockRules.commandTag,
    })
    .from(interlockRules)
    .where(eq(interlockRules.targetAdapterId, adapterId))
    .orderBy(interlockRules.id)
    .for("share");
}

const luatBatCoGhi = (r: LuatNhamTag): boolean => r.enabled === true && luatCoGhiLenh(r.action);

/**
 * THUẦN — vi phạm đầu tiên của luật ĐANG BẬT (không phải `alert`) với tag sau khi sửa: tag thôi ghi được (writable !== true ⇒ dispatch
 * từ chối TAG_NOT_WRITABLE, bất kể khai báo kênh) hoặc giá trị GỬI không ghi được lên khai báo mới (`kiemNhatQuanKenh`).
 */
export function viPhamInterlockSauSua(
  luat: ReadonlyArray<LuatNhamTag>,
  kenhMoi: KenhNhatQuan,
): { ruleId: number; ruleName: string; ma: MaViPham; chiTiet: string } | null {
  for (const r of luat) {
    if (!luatBatCoGhi(r)) continue;
    if (kenhMoi.writable !== true) {
      return { ruleId: r.id, ruleName: r.name, ma: "CHANNEL_READ_ONLY", chiTiet: "Tag không còn cho phép ghi (writable=false) — dispatch từ chối mọi lệnh ghi." };
    }
    const kq = kiemNhatQuanKenh(kenhMoi, giaTriLenhInterlock(r));
    if (!kq.ok) return { ruleId: r.id, ruleName: r.name, ma: kq.ma, chiTiet: kq.chiTiet };
  }
  return null;
}

/**
 * NÉM appError — kiểm interlock cho MỌI tag (đã khai hay chưa) khi các cột trỏ lại `doi` chạm giá trị lệnh hoặc danh tính.
 * `luat` = luật nhắm (adapterId, tagKey) CŨ của tag.
 */
export function kiemInterlockSauSua(cu: HangTagTroLai, sau: GiaTriTroLai, doi: ReadonlyArray<CotTroLai>, luat: ReadonlyArray<LuatNhamTag>): void {
  if (doi.some((c) => COT_DANH_TINH.has(c))) {
    const mat = luat.find(luatBatCoGhi);
    if (mat) {
      throw appError(
        "BAD_REQUEST",
        "INTERLOCK_MAT_DICH",
        { ma: "INTERLOCK_MAT_DICH", tagKey: cu.tagKey, ruleId: mat.id },
        `Luật interlock đang bật #${mat.id} (${mat.name}) ghi lệnh lên tag ${cu.tagKey} — đổi tên / chuyển adapter sẽ làm hành động bảo vệ mất đích. Sửa đích của luật trước.`,
      );
    }
  }
  if (!doi.some((c) => COT_ANH_HUONG_GHI.has(c))) return;
  const vp = viPhamInterlockSauSua(luat, kenhMoiCua(cu, sau));
  if (!vp) return;
  throw appError(
    "BAD_REQUEST",
    "INTERLOCK_NGOAI_DAI",
    {
      ma: "INTERLOCK_NGOAI_DAI",
      lyDo: vp.ma,
      tagKey: cu.tagKey,
      min: soHienThi(cu.writeMin),
      max: soHienThi(cu.writeMax),
      step: soHienThi(cu.writeStep),
      ruleId: vp.ruleId,
    },
    `Luật interlock đang bật #${vp.ruleId} (${vp.ruleName}) ghi một giá trị không ghi được lên tag ${cu.tagKey} sau khi sửa (${vp.chiTiet}).`,
  );
}

/**
 * NÉM appError — kiểm lại nhất quán của tag ĐÃ KHAI sau khi trỏ lại (bên gọi chỉ gọi khi `tagDaKhaiKenh` và `doi` khác rỗng):
 *   1. kênh chế độ không đổi adapter;
 *   2. dải/bước ↔ dataType (dải chỉ cho kênh số — cùng lý do `scadaKenh.capNhat`);
 *   3. loại kênh GHI ↔ writable (cùng lý do `scadaKenh.capNhat` fix round 1 minor 4);
 *   4. giá trị DỪNG ghim còn ghi được trên khai báo mới (xem ⚠ đầu tệp).
 */
export function kiemNhatQuanSauTroLai(cu: HangTagTroLai, sau: GiaTriTroLai, doi: ReadonlyArray<CotTroLai>, laKenhCheDo: boolean): void {
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
  if (cu.stopValue !== null && cu.stopValue !== undefined) {
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
  }
}

/** Before/after của dòng audit `kenh_da_khai_tro_lai` (control_audit_log, WORM). */
export function anhTroLai(g: GiaTriTroLai): Record<string, unknown> {
  return {
    adapterId: g.adapterId,
    tagKey: g.tagKey,
    address: g.address,
    dataType: g.dataType,
    scale: scaleHieuLuc(g.scale),
    offset: offsetHieuLuc(g.offset),
    writable: g.writable,
  };
}

export const AUDIT_TRO_LAI = "kenh_da_khai_tro_lai";
export const AUDIT_KENH_CHE_DO_DOI_TAG = "scada_kenh_che_do_doi_tag";

/** QUA_NHIEU_KENH_DA_KHAI — lô import đụng quá trần tag đã khai. */
export function loiQuaNhieuKenhDaKhai(soTag: number): never {
  throw appError(
    "BAD_REQUEST",
    "QUA_NHIEU_KENH_DA_KHAI",
    { soTag, toiDa: TRAN_KENH_DA_KHAI_MOT_LO },
    `Lô import trỏ lại ${soTag} tag đã khai kênh — tối đa ${TRAN_KENH_DA_KHAI_MOT_LO} mỗi lô. Chia nhỏ file rồi nhập lại.`,
  );
}
