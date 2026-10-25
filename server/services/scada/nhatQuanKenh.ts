/**
 * SCADA R1a Task 12 — NHẤT QUÁN LÚC CẤU HÌNH giữa khai báo kênh (mig 0431: loại kênh, dải, bước) và hai giá trị đã CAM KẾT sẵn sẽ được
 * ghi xuống kênh đó mà không có người xem lại lúc chạy:
 *
 *   • giá trị DỪNG ghim (`device_tags.stop_value`) — `dispatch()` miễn dải/bước cho DỪNG ghim (điều phối 2026-10-24 mục 4), đổi lại cấu
 *     hình phải nhất quán: khai dải mà ghim nằm ngoài ⇒ từ chối; ghim ngoài dải đang khai ⇒ từ chối (`STOP_PIN_NGOAI_DAI`);
 *   • `commandValue` của luật interlock nhắm tới kênh (`targetAdapterId` + `commandTag`) — lệnh bảo vệ KHÔNG được miễn dải lúc chạy, nên
 *     một dải loại nó ra sẽ làm hành động bảo vệ bị `OUT_OF_RANGE` đúng lúc cần (review T3 M-3) ⇒ từ chối (`INTERLOCK_NGOAI_DAI`).
 *
 * LUẬT (một hàm cho mọi nơi gọi — `scadaKenh.capNhat`, `datStopPin`, `interlockRouter` create/update/approve/enable):
 *   1. kênh KHÔNG khai mô hình ghi (channel_kind, write_min, write_max, write_step đều NULL) ⇒ không kiểm (hành vi cũ, "dải NULL ⇒ không kiểm");
 *   2. đã khai mà loại kênh không nhận lệnh ghi (`laKenhGhi` false: input / calculated) ⇒ `CHANNEL_READ_ONLY` — cổng kênh sớm của
 *      `dispatch()` từ chối mọi lệnh ghi trên kênh đó, KHÔNG có miễn trừ cho DỪNG ghim;
 *   3. còn lại ⇒ `kiemGiaTriGhi` (CÙNG hàm `dispatch()` dùng: ép kiểu, dải, bước) — mọi kết cục không `ok` là từ chối.
 *   R1b-1 T13 — riêng giá trị lệnh INTERLOCK (`kiemLenhInterlockTrenKenh`): kênh KHÔNG khai mà là int có scale ≠ 1 / offset ≠ 0 ⇒ lưới thô
 *   (`kiemLuoiThoChuaKhai`, CÙNG hàm cổng kênh sớm của `dispatch()` dùng cho tag chưa khai). Lệnh bảo vệ không được miễn lúc chạy, nên một
 *   giá trị lệch lưới phải bị từ chối LÚC CẤU HÌNH, không phải `OFF_STEP` đúng lúc cần. Ghim DỪNG trên kênh chưa khai KHÔNG kiểm (được miễn
 *   lúc chạy ⇒ không có lệch cấu hình ↔ chạy; ghim lệch lưới là phát hiện cấu hình, xem báo cáo T13).
 *
 * ⚠ `kenhDaKhai` là BẢN SAO của `commandDispatcher.kenhDaKhaiGhi` (không import: `stopPin.ts` nhập tệp này và `commandDispatcher.ts` nhập
 *   `stopPin.ts` ⇒ vòng import). Test `stopPin.dai.r1a.db.test.ts` so hai bản trên mọi tổ hợp NULL/khác NULL.
 */
import { and, eq } from "drizzle-orm";
import { deviceTags, interlockRules, type DeviceTag } from "../../../drizzle/schema";
import type { getDb } from "../../db/connection";
import { kiemGiaTriGhi, kiemLuoiThoChuaKhai, laKenhGhi, type KetQuaGiaTri } from "./kenhScada";
import { giaTriLenhInterlock } from "../interlock/giaTriLenh";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** db drizzle đã resolve HOẶC một transaction của nó. */
export type DbHoacTx = Db | Tx;

export type KenhNhatQuan = Pick<DeviceTag, "dataType" | "channelKind" | "writable" | "writeMin" | "writeMax" | "writeStep"> &
  // kiem-dinh P1-3 — cùng luật lưới thô (int có scale/offset) với `dispatch()` cho kênh ĐÃ khai.
  Partial<Pick<DeviceTag, "scale" | "offset">>;

/**
 * R1b-1 T13 polish (m1) — lưới vừa trượt của một OFF_STEP (lưới = `gocLuoi` + k·`buoc`; `goiY` = điểm lưới gần nhất), để lời từ chối nêu ĐÚNG
 * lưới (bước khai báo, hoặc |scale| / offset của lưới thô) thay vì "bước —" khi tag không khai `write_step`.
 */
export type LuoiLech = { buoc?: number; goiY?: number; gocLuoi?: number };

export type KetQuaNhatQuan =
  | { ok: true }
  | { ok: false; ma: "CHANNEL_READ_ONLY" | "TYPE_MISMATCH" | "OUT_OF_RANGE" | "OFF_STEP"; chiTiet: string; luoi?: LuoiLech };

/** Lưới của một kết cục `kiemGiaTriGhi` / `kiemLuoiThoChuaKhai` không ok (chỉ OFF_STEP có); không có ⇒ undefined. */
function luoiCua(kq: { buoc?: number; goiY?: number; gocLuoi?: number }): LuoiLech | undefined {
  if (kq.buoc === undefined) return undefined;
  return { buoc: kq.buoc, ...(kq.goiY !== undefined ? { goiY: kq.goiY } : {}), ...(kq.gocLuoi !== undefined ? { gocLuoi: kq.gocLuoi } : {}) };
}

const tuChoiTu = (kq: Extract<KetQuaGiaTri, { ok: false }>): KetQuaNhatQuan => {
  const luoi = luoiCua(kq);
  return { ok: false, ma: kq.ma, chiTiet: kq.chiTiet, ...(luoi ? { luoi } : {}) };
};

/**
 * R1b-1 T13 polish (m1) — tham số `INTERLOCK_NGOAI_DAI` { min, max, step, goc, goiY } cho câu vi/en/zh (MỌI nơi phát mã này dùng hàm này):
 * OFF_STEP có lưới ⇒ `step` = bước vừa trượt (writeStep, hoặc |scale| của lưới thô), `goc` = gốc lưới (writeMin ?? 0, hoặc offset), `goiY` =
 * giá trị hợp lệ gần nhất ("—" khi không có điểm lưới trong dải); còn lại ⇒ `step` = write_step khai báo, `goc` / `goiY` = "—".
 * min/max = dải khai báo ("—" khi không khai).
 */
export function thamSoNgoaiDaiInterlock(
  tag: Pick<DeviceTag, "writeMin" | "writeMax" | "writeStep"> | null | undefined,
  vp: { ma: string; luoi?: LuoiLech },
): { min: string | number; max: string | number; step: string | number; goc: string | number; goiY: string | number } {
  const luoi = vp.ma === "OFF_STEP" ? vp.luoi : undefined;
  const buoc = luoi?.buoc;
  return {
    min: soHienThi(tag?.writeMin),
    max: soHienThi(tag?.writeMax),
    step: buoc !== undefined ? buoc : soHienThi(tag?.writeStep),
    goc: buoc !== undefined ? soHienThi(luoi?.gocLuoi) : "—",
    goiY: buoc !== undefined ? soHienThi(luoi?.goiY) : "—",
  };
}

/** Bản sao của `commandDispatcher.kenhDaKhaiGhi` (xem đầu tệp). */
export function kenhDaKhai(tag: Pick<DeviceTag, "channelKind" | "writeMin" | "writeMax" | "writeStep">): boolean {
  return tag.channelKind != null || tag.writeMin != null || tag.writeMax != null || tag.writeStep != null;
}

/** THUẦN — giá trị `giaTri` (đã cam kết sẵn) có ghi được lên kênh với khai báo `tag` không, theo đúng luật cổng kênh của `dispatch()`. */
export function kiemNhatQuanKenh(tag: KenhNhatQuan, giaTri: unknown): KetQuaNhatQuan {
  if (!kenhDaKhai(tag)) return { ok: true };
  if (!laKenhGhi(tag)) return { ok: false, ma: "CHANNEL_READ_ONLY", chiTiet: `Kênh loại ${tag.channelKind} không nhận lệnh ghi.` };
  const kq = kiemGiaTriGhi(tag, giaTri);
  return kq.ok ? { ok: true } : tuChoiTu(kq);
}

/**
 * THUẦN — R1b-1 T13: giá trị lệnh của luật interlock có ghi được lên kênh không, theo ĐÚNG cổng kênh sớm của `dispatch()` — kênh đã khai ⇒
 * `kiemNhatQuanKenh`; kênh chưa khai ⇒ lưới thô của tag int có scale/offset (`kiemLuoiThoChuaKhai`; scale 1 / offset 0 / không phải int ⇒ ok).
 */
export function kiemLenhInterlockTrenKenh(tag: KenhNhatQuan, giaTri: unknown): KetQuaNhatQuan {
  if (kenhDaKhai(tag)) return kiemNhatQuanKenh(tag, giaTri);
  const kq = kiemLuoiThoChuaKhai(tag, giaTri);
  return kq.ok ? { ok: true } : tuChoiTu(kq);
}

/** Hành động của luật interlock có ghi xuống thiết bị không: `alert` không bao giờ dispatch (interlockEngine chỉ auto-block hành động khác). */
export function luatCoGhiLenh(action: string): boolean {
  return action !== "alert";
}

/**
 * Giá trị luật interlock THẬT SỰ GỬI — fix round 1 (c1): CHÍNH hàm `interlockEngine` dùng khi dispatch và `dispatch()` dùng khi so
 * (`server/services/interlock/giaTriLenh.ts`; luật không khai giá trị ⇒ `true`). Re-export để nơi gọi cũ giữ nguyên.
 */
export { giaTriLenhInterlock };

/** Tham số hiển thị của một cận (NULL ⇒ "—", khuôn `scadaCommandsRouter`). */
export const soHienThi = (n: number | null | undefined): string | number => (n == null ? "—" : n);

export type MaViPham = Exclude<KetQuaNhatQuan, { ok: true }>["ma"];
export type ViPhamInterlock = { ruleId: number; ruleName: string; ma: MaViPham; chiTiet: string; luoi?: LuoiLech };

export type LuatNhamTag = { id: number; name: string; action: string; enabled: boolean; commandValue: unknown };

/**
 * fix round 1 (minor 1, thứ tự khoá) — khoá `FOR SHARE` MỌI luật interlock nhắm (adapterId, tagKey), BẤT KỂ đang bật hay không, theo id.
 * `scadaKenh.capNhat` gọi hàm này TRƯỚC khi khoá tag `FOR UPDATE` ⇒ cùng thứ tự LUẬT → TAG với `interlockRouter` (khoá luật FOR UPDATE rồi
 * tag FOR SHARE) ⇒ không có vòng chờ (40P01). Khoá cả luật đang tắt: `enable` (đổi tắt → bật, KHÔNG đổi đích) giữ luật FOR UPDATE ⇒ ta
 * chờ nó commit rồi đọc bản mới nhất (READ COMMITTED đánh giá lại hàng bị khoá). `create`/`update` không bao giờ để luật ở trạng thái bật
 * (tạo luôn tắt; sửa luật đã duyệt/bật ⇒ MOC tắt) nên một luật đổi đích sang tag này không thể "bật" mà lọt khỏi tập khoá.
 */
export async function khoaLuatNhamTagTx(tx: DbHoacTx, e: { adapterId: number; tagKey: string }): Promise<LuatNhamTag[]> {
  return tx
    .select({
      id: interlockRules.id,
      name: interlockRules.name,
      action: interlockRules.action,
      enabled: interlockRules.enabled,
      commandValue: interlockRules.commandValue,
    })
    .from(interlockRules)
    .where(and(eq(interlockRules.targetAdapterId, e.adapterId), eq(interlockRules.commandTag, e.tagKey)))
    .orderBy(interlockRules.id)
    .for("share");
}

/**
 * THUẦN — luật ĐANG BẬT, có ghi lệnh (không phải `alert`) trong `luat` mà giá trị GỬI (`giaTriLenhInterlock`) không ghi được trên khai báo
 * `tag` mới. Trả vi phạm ĐẦU TIÊN (theo thứ tự đầu vào), không có ⇒ null.
 */
export function viPhamInterlock(luat: ReadonlyArray<LuatNhamTag>, tag: KenhNhatQuan): ViPhamInterlock | null {
  for (const r of luat) {
    if (r.enabled !== true || !luatCoGhiLenh(r.action)) continue;
    const kq = kiemLenhInterlockTrenKenh(tag, giaTriLenhInterlock(r)); // R1b-1 T13: kênh chưa khai ⇒ lưới thô (trước: bỏ qua mọi kênh chưa khai)
    if (!kq.ok) return { ruleId: r.id, ruleName: r.name, ma: kq.ma, chiTiet: kq.chiTiet, ...(kq.luoi ? { luoi: kq.luoi } : {}) };
  }
  return null;
}

/**
 * Chiều ngược lại (interlockRouter create/update/approve/enable): `commandValue` của luật (đã gộp patch) phải ghi được lên khai báo HIỆN
 * TẠI của tag đích. Tag đích đọc `FOR SHARE` (một `scadaKenh.capNhat` đồng thời giữ `FOR UPDATE` ⇒ chờ nó commit rồi kiểm khai báo mới).
 * Luật `alert`, thiếu targetAdapterId/commandTag, tag đích không tồn tại ⇒ không kiểm (cổng khác lo). Trả vi phạm hoặc null.
 */
export async function kiemLenhInterlockTx(
  tx: DbHoacTx,
  luat: { action: string; targetAdapterId: number | null | undefined; commandTag: string | null | undefined; commandValue: unknown },
): Promise<{ tag: KenhNhatQuan & { tagKey: string }; ma: MaViPham; chiTiet: string; luoi?: LuoiLech } | null> {
  if (!luatCoGhiLenh(luat.action) || luat.targetAdapterId == null || !luat.commandTag) return null;
  const [tag] = await tx
    .select({
      tagKey: deviceTags.tagKey,
      dataType: deviceTags.dataType,
      channelKind: deviceTags.channelKind,
      writable: deviceTags.writable,
      writeMin: deviceTags.writeMin,
      writeMax: deviceTags.writeMax,
      writeStep: deviceTags.writeStep,
      scale: deviceTags.scale,
      offset: deviceTags.offset,
    })
    .from(deviceTags)
    .where(and(eq(deviceTags.adapterId, luat.targetAdapterId), eq(deviceTags.tagKey, luat.commandTag)))
    .limit(1)
    .for("share");
  if (!tag) return null;
  const kq = kiemLenhInterlockTrenKenh(tag, giaTriLenhInterlock(luat)); // R1b-1 T13: kênh chưa khai ⇒ lưới thô
  return kq.ok ? null : { tag, ma: kq.ma, chiTiet: kq.chiTiet, ...(kq.luoi ? { luoi: kq.luoi } : {}) };
}
