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
 *
 * ⚠ `kenhDaKhai` là BẢN SAO của `commandDispatcher.kenhDaKhaiGhi` (không import: `stopPin.ts` nhập tệp này và `commandDispatcher.ts` nhập
 *   `stopPin.ts` ⇒ vòng import). Test `stopPin.dai.r1a.db.test.ts` so hai bản trên mọi tổ hợp NULL/khác NULL.
 */
import { and, eq, ne } from "drizzle-orm";
import { deviceTags, interlockRules, type DeviceTag } from "../../../drizzle/schema";
import type { getDb } from "../../db/connection";
import { kiemGiaTriGhi, laKenhGhi } from "./kenhScada";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** db drizzle đã resolve HOẶC một transaction của nó. */
export type DbHoacTx = Db | Tx;

export type KenhNhatQuan = Pick<DeviceTag, "dataType" | "channelKind" | "writable" | "writeMin" | "writeMax" | "writeStep">;

export type KetQuaNhatQuan =
  | { ok: true }
  | { ok: false; ma: "CHANNEL_READ_ONLY" | "TYPE_MISMATCH" | "OUT_OF_RANGE" | "OFF_STEP"; chiTiet: string };

/** Bản sao của `commandDispatcher.kenhDaKhaiGhi` (xem đầu tệp). */
export function kenhDaKhai(tag: Pick<DeviceTag, "channelKind" | "writeMin" | "writeMax" | "writeStep">): boolean {
  return tag.channelKind != null || tag.writeMin != null || tag.writeMax != null || tag.writeStep != null;
}

/** THUẦN — giá trị `giaTri` (đã cam kết sẵn) có ghi được lên kênh với khai báo `tag` không, theo đúng luật cổng kênh của `dispatch()`. */
export function kiemNhatQuanKenh(tag: KenhNhatQuan, giaTri: unknown): KetQuaNhatQuan {
  if (!kenhDaKhai(tag)) return { ok: true };
  if (!laKenhGhi(tag)) return { ok: false, ma: "CHANNEL_READ_ONLY", chiTiet: `Kênh loại ${tag.channelKind} không nhận lệnh ghi.` };
  const kq = kiemGiaTriGhi(tag, giaTri);
  return kq.ok ? { ok: true } : { ok: false, ma: kq.ma, chiTiet: kq.chiTiet };
}

/** Hành động của luật interlock có ghi xuống thiết bị không: `alert` không bao giờ dispatch (interlockEngine chỉ auto-block hành động khác). */
export function luatCoGhiLenh(action: string): boolean {
  return action !== "alert";
}

/** Giá trị luật interlock thật sự ghi: `interlockEngine` gửi `rule.commandValue ?? true` (dispatcher so đúng giá trị đó). */
export function giaTriLenhInterlock(commandValue: unknown): unknown {
  return commandValue ?? true;
}

/** Tham số hiển thị của một cận (NULL ⇒ "—", khuôn `scadaCommandsRouter`). */
export const soHienThi = (n: number | null | undefined): string | number => (n == null ? "—" : n);

export type MaViPham = Exclude<KetQuaNhatQuan, { ok: true }>["ma"];
export type ViPhamInterlock = { ruleId: number; ruleName: string; ma: MaViPham; chiTiet: string };

/**
 * Luật interlock ĐANG BẬT, có ghi lệnh, nhắm tới (adapterId, tagKey) mà `commandValue` không ghi được lên khai báo `tag` mới. Đọc
 * `FOR SHARE` (luật đang bật không đổi giữa lúc kiểm và lúc thay đổi kênh commit). Trả vi phạm ĐẦU TIÊN (theo id), không có ⇒ null.
 */
export async function viPhamInterlockTx(
  tx: DbHoacTx,
  e: { adapterId: number; tagKey: string; tag: KenhNhatQuan },
): Promise<ViPhamInterlock | null> {
  if (!kenhDaKhai(e.tag)) return null;
  const rows = await tx
    .select({ id: interlockRules.id, name: interlockRules.name, commandValue: interlockRules.commandValue })
    .from(interlockRules)
    .where(
      and(
        eq(interlockRules.enabled, true),
        eq(interlockRules.targetAdapterId, e.adapterId),
        eq(interlockRules.commandTag, e.tagKey),
        ne(interlockRules.action, "alert"),
      ),
    )
    .orderBy(interlockRules.id)
    .for("share");
  for (const r of rows) {
    const kq = kiemNhatQuanKenh(e.tag, giaTriLenhInterlock(r.commandValue));
    if (!kq.ok) return { ruleId: r.id, ruleName: r.name, ma: kq.ma, chiTiet: kq.chiTiet };
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
): Promise<{ tag: KenhNhatQuan & { tagKey: string }; ma: MaViPham; chiTiet: string } | null> {
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
    })
    .from(deviceTags)
    .where(and(eq(deviceTags.adapterId, luat.targetAdapterId), eq(deviceTags.tagKey, luat.commandTag)))
    .limit(1)
    .for("share");
  if (!tag) return null;
  const kq = kiemNhatQuanKenh(tag, giaTriLenhInterlock(luat.commandValue));
  return kq.ok ? null : { tag, ma: kq.ma, chiTiet: kq.chiTiet };
}
