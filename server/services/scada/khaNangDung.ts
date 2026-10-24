/**
 * SCADA R1b-1 Task 2 fix round 1 (điều phối 2026-10-24) — KHẢO SÁT KHẢ NĂNG DỪNG của một máy: nút DỪNG MÁY (`scadaCommands.dungMay`)
 * sẽ làm gì với TỪNG adapter đang bật, để người vận hành biết TRƯỚC khi cần dừng (không phải lúc nút báo đỏ).
 *
 * Một hàm, dùng ở hai nơi: (a) hộp xác nhận DỪNG MÁY liệt kê từng adapter trước khi gửi; (b) cảnh báo cấp máy ở M4 (faceplate), M10 (và M3
 * khi có). Đưa ra qua hàng `scadaKenh.cheDo.danhSach` (trường `khaNangDung`) — KHÔNG thêm thủ tục (bản nhiều máy một lượt đọc ghim).
 *
 * KẾT LUẬN theo THỨ TỰ của `dispatchCore` (cùng vị từ, không bản sao):
 *   1. không ghim DỪNG hợp lệ (`stopPinsFromTagRows` — luật của `loadStopPins`)  ⇒ `chua_ghim` (dungMay không gửi gì tới adapter này)
 *   2. adapter do edge sở hữu                                                    ⇒ `duoc`, lyDo "edge" (dispatcher định tuyến STOP sang edge)
 *   3. trung tâm không giữ driver (`getActiveDriver`)                            ⇒ `ghim_cu`, lyDo "khong_ket_noi" (dispatch bước 4: ADAPTER_OFFLINE)
 *   4. `!isOtControlEnabled()`                                                    ⇒ `mo_phong`, lyDo "ot_control_tat" (bước 5: writeSimulated)
 *   5. `isCommissioningRequired() && !isCommissioned(adapter)`                    ⇒ `mo_phong`, lyDo "chua_nghiem_thu" (bước 5a: writeSimulated)
 *   6. `!runningConnectionMatchesAdapterRow` (dấu vân tay kết nối ĐANG CHẠY ≠ hàng adapter — sửa adapter mà chưa nối lại)
 *                                                                                ⇒ `ghim_cu`, lyDo "ket_noi_cu" (5a-stop: KHÔNG phải STOP ghim)
 *   7. còn lại                                                                    ⇒ `duoc`
 * tongHop: mọi adapter `duoc` ⇒ "duoc"; không adapter nào `duoc` (kể cả máy không có adapter bật) ⇒ "khong"; còn lại ⇒ "mot_phan".
 * Lỗi đọc (DB / vân tay) ⇒ chiều an toàn: không bao giờ nói `duoc` khi không chứng minh được.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { deviceAdapters, deviceTags } from "../../../drizzle/schema";
import type { getDb } from "../../db/connection";
import { getActiveDriver } from "../ot/otManager";
import { isOtControlEnabled, runningConnectionMatchesAdapterRow } from "../ot/commandDispatcher";
import { isCommissioned, isCommissioningRequired } from "../ot/commissioningService";
import { stopPinsFromTagRows, type StopPinTagRow } from "../ot/stopPin";
import { isEdgeControlSchemaMissing } from "../edge/edgeControlSchema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type TrangThaiKhaNangDung = "duoc" | "mo_phong" | "ghim_cu" | "chua_ghim";
export type LyDoKhaNangDung = "edge" | "khong_ket_noi" | "ot_control_tat" | "chua_nghiem_thu" | "ket_noi_cu";

export interface KhaNangDungAdapter {
  adapterId: number;
  code: string;
  trangThai: TrangThaiKhaNangDung;
  lyDo?: LyDoKhaNangDung;
}

export interface KhaNangDungMay {
  machineId: number;
  adapters: KhaNangDungAdapter[];
  tongHop: "duoc" | "mot_phan" | "khong";
}

export function tongHopKhaNang(adapters: ReadonlyArray<KhaNangDungAdapter>): KhaNangDungMay["tongHop"] {
  const duoc = adapters.filter((a) => a.trangThai === "duoc").length;
  if (adapters.length > 0 && duoc === adapters.length) return "duoc";
  return duoc === 0 ? "khong" : "mot_phan";
}

/** Adapter bật của các máy + chủ edge (mig 0374; thiếu cột ⇒ không adapter nào thuộc edge). */
async function docAdapterBat(db: Db, machineIds: number[]): Promise<Array<{ id: number; code: string; machineId: number; edge: boolean }>> {
  const ids = sql.join(
    machineIds.map((i) => sql`${i}`),
    sql`, `,
  );
  try {
    const rows = (await db.execute(sql`SELECT a."id" AS id, a."code" AS code, a."machineId" AS "machineId", a."edgeNodeId" AS "edgeNodeId"
      FROM device_adapters a WHERE a."isEnabled" = true AND a."machineId" IN (${ids}) ORDER BY a."id"`)) as unknown as Array<{
      id: number;
      code: string;
      machineId: number;
      edgeNodeId: number | null;
    }>;
    return rows.map((r) => ({ id: Number(r.id), code: r.code, machineId: Number(r.machineId), edge: r.edgeNodeId !== null && r.edgeNodeId !== undefined }));
  } catch (err) {
    if (!isEdgeControlSchemaMissing(err)) throw err;
    const rows = await db
      .select({ id: deviceAdapters.id, code: deviceAdapters.code, machineId: deviceAdapters.machineId })
      .from(deviceAdapters)
      .where(and(inArray(deviceAdapters.machineId, machineIds), eq(deviceAdapters.isEnabled, true)))
      .orderBy(asc(deviceAdapters.id));
    return rows.map((r) => ({ id: r.id, code: r.code, machineId: r.machineId as number, edge: false }));
  }
}

/** Một adapter có ghim: các bước 2–7 (thứ tự dispatchCore). */
async function ketLuanCoGhim(db: Db, a: { id: number; edge: boolean }): Promise<Pick<KhaNangDungAdapter, "trangThai" | "lyDo">> {
  if (a.edge) return { trangThai: "duoc", lyDo: "edge" };
  if (!getActiveDriver(a.id)) return { trangThai: "ghim_cu", lyDo: "khong_ket_noi" };
  if (!isOtControlEnabled()) return { trangThai: "mo_phong", lyDo: "ot_control_tat" };
  if (isCommissioningRequired() && !(await isCommissioned(a.id))) return { trangThai: "mo_phong", lyDo: "chua_nghiem_thu" };
  if (!(await runningConnectionMatchesAdapterRow(db, a.id))) return { trangThai: "ghim_cu", lyDo: "ket_noi_cu" };
  return { trangThai: "duoc" };
}

/** Bản nhiều máy (một lượt đọc adapter + một lượt đọc ghim) — `scadaKenh.cheDo.danhSach` dùng. Máy không có adapter bật ⇒ adapters rỗng. */
export async function khaoSatKhaNangDungNhieu(db: Db, machineIds: number[]): Promise<Map<number, KhaNangDungMay>> {
  const out = new Map<number, KhaNangDungMay>();
  for (const m of machineIds) out.set(m, { machineId: m, adapters: [], tongHop: "khong" });
  if (machineIds.length === 0) return out;
  const adapters = await docAdapterBat(db, machineIds);
  const ghim = new Map<number, StopPinTagRow[]>();
  if (adapters.length > 0) {
    const rows = await db
      .select({
        adapterId: deviceTags.adapterId,
        tagKey: deviceTags.tagKey,
        dataType: deviceTags.dataType,
        stopValue: deviceTags.stopValue,
        writable: deviceTags.writable,
        isEnabled: deviceTags.isEnabled,
      })
      .from(deviceTags)
      .where(
        and(
          inArray(
            deviceTags.adapterId,
            adapters.map((a) => a.id),
          ),
          eq(deviceTags.isEnabled, true),
          eq(deviceTags.writable, true),
          isNotNull(deviceTags.stopValue),
        ),
      );
    for (const r of rows) ghim.set(r.adapterId, [...(ghim.get(r.adapterId) ?? []), r]);
  }
  const ketLuan = await Promise.all(
    adapters.map(async (a): Promise<KhaNangDungAdapter & { machineId: number }> => {
      const coGhim = stopPinsFromTagRows(ghim.get(a.id) ?? []).length > 0;
      const kl = coGhim ? await ketLuanCoGhim(db, a) : { trangThai: "chua_ghim" as const };
      return { machineId: a.machineId, adapterId: a.id, code: a.code, ...kl };
    }),
  );
  for (const { machineId, ...k } of ketLuan) out.get(machineId)?.adapters.push(k);
  for (const v of out.values()) v.tongHop = tongHopKhaNang(v.adapters);
  return out;
}

/** Khả năng dừng của MỘT máy (hộp xác nhận + cảnh báo cấp máy). */
export async function khaoSatKhaNangDung(db: Db, machineId: number): Promise<KhaNangDungMay> {
  return (await khaoSatKhaNangDungNhieu(db, [machineId])).get(machineId) as KhaNangDungMay;
}
