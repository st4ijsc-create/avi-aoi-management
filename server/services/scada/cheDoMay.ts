/**
 * SCADA R1a Task 4 (K2 / D3) — CHẾ ĐỘ MÁY: LOCAL hay REMOTE, suy từ kênh chế độ đã khai (`scada_kenh_che_do`) + bộ đệm giá trị hiện tại.
 *
 * REMOTE **chỉ khi** TẤT CẢ đúng: máy đã khai kênh chế độ, adapter của kênh CÒN thuộc máy này và đang bật, bộ đệm bật, có mẫu cho
 * (adapter, tag) của đúng máy này, `q === "good"`, `!stale`, và giá trị (ép kiểu theo `dataType` của tag chế độ, cùng luật
 * `kiemGiaTriGhi`) có dạng canonical (`canonicalOtValue`) bằng `gia_tri_remote`. Mọi trường hợp khác là LOCAL kèm `lyDo` (fail-closed).
 * Hàm KHÔNG BAO GIỜ ném: lỗi đọc DB / db không có / lỗi đọc bộ đệm ⇒ LOCAL `loi_doc`.
 *
 * fix round 1 (I-1): `scada_kenh_che_do` không có FK nối `adapter_id` với `machine_id` — adapter của kênh bị chuyển sang máy khác, bị
 * gỡ hay bị tắt thì bộ chọn nó đọc KHÔNG còn là của máy này ⇒ LOCAL `kenh_sai_may` (không bao giờ hiện REMOTE theo bộ chọn của máy
 * khác). Đối chiếu thêm máy hiệu lực của mục bộ đệm (`GiaTriCoTuoi.machineId`, theo đăng ký OT trong tiến trình).
 *
 * Chi phí: MỘT truy vấn nhỏ theo PK `machine_id` (LEFT JOIN device_adapters theo PK + device_tags theo khoá duy nhất (adapterId,
 * tagKey) để lấy `dataType`). Không cache (quyết định điều phối: giá trị chế độ đổi theo giây, khai báo đổi bất kỳ lúc nào).
 */
import { and, eq } from "drizzle-orm";
import { deviceAdapters, deviceTags, scadaKenhCheDo, type DeviceTag } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { canonicalOtValue } from "../ot/otActionBinding";
import { boDemDangBat, layGiaTri } from "./boDemHienTai";
import { kiemGiaTriGhi } from "./kenhScada";

export type LyDoCheDo =
  | "remote"
  | "chua_khai"
  | "kenh_sai_may"
  | "loi_doc"
  | "bo_dem_tat"
  | "chua_co_mau"
  | "chat_luong_xau"
  | "cu"
  | "khac_remote";

export type CheDo = {
  cheDo: "REMOTE" | "LOCAL";
  lyDo: LyDoCheDo;
  kenh?: { adapterId: number; tagKey: string };
};

/** Tool của lệnh ghi từ HMI SCADA (R1a Task 8/9): cổng chế độ LUÔN chạy cho nó, bất kể cờ. */
export const TOOL_HMI_GHI_TAG = "hmi.write_tag";

/** Cổng K2 trong `dispatch()` cho người gọi KHÔNG phải HMI (mặc định OFF). */
export function congCheDoBat(): boolean {
  return process.env.SCADA_CONG_CHE_DO_ENABLED === "true";
}

/** Ép kiểu theo dataType của tag chế độ (không dải/bước); không biết dataType hoặc ép thất bại ⇒ giá trị nguyên dạng. */
function epTheoKieu(dataType: DeviceTag["dataType"] | null, v: unknown): unknown {
  if (!dataType) return v;
  const kq = kiemGiaTriGhi({ dataType, writeMin: null, writeMax: null, writeStep: null }, v);
  return kq.ok ? kq.giaTri : v;
}

type HangKenh = {
  adapterId: number;
  tagKey: string;
  giaTriRemote: unknown;
  dataType: DeviceTag["dataType"] | null;
  /** device_adapters của kênh (LEFT JOIN): null ⇔ adapter không còn. */
  adapterMachineId: number | null;
  adapterEnabled: boolean | null;
};

export async function cheDoMay(machineId: number | null, now: number = Date.now()): Promise<CheDo> {
  if (machineId == null) return { cheDo: "LOCAL", lyDo: "chua_khai" };

  let hang: HangKenh | undefined;
  try {
    const db = await getDb();
    if (!db) return { cheDo: "LOCAL", lyDo: "loi_doc" };
    const rows: HangKenh[] = await db
      .select({
        adapterId: scadaKenhCheDo.adapterId,
        tagKey: scadaKenhCheDo.tagKey,
        giaTriRemote: scadaKenhCheDo.giaTriRemote,
        dataType: deviceTags.dataType,
        adapterMachineId: deviceAdapters.machineId,
        adapterEnabled: deviceAdapters.isEnabled,
      })
      .from(scadaKenhCheDo)
      .leftJoin(deviceAdapters, eq(deviceAdapters.id, scadaKenhCheDo.adapterId))
      .leftJoin(deviceTags, and(eq(deviceTags.adapterId, scadaKenhCheDo.adapterId), eq(deviceTags.tagKey, scadaKenhCheDo.tagKey)))
      .where(eq(scadaKenhCheDo.machineId, machineId))
      .limit(1);
    hang = rows[0];
  } catch (err) {
    console.warn(`[SCADA] đọc kênh chế độ máy ${machineId} lỗi (coi là LOCAL):`, (err as Error)?.message ?? err);
    return { cheDo: "LOCAL", lyDo: "loi_doc" };
  }
  if (!hang) return { cheDo: "LOCAL", lyDo: "chua_khai" };

  const kenh = { adapterId: hang.adapterId, tagKey: hang.tagKey };
  const local = (lyDo: LyDoCheDo): CheDo => ({ cheDo: "LOCAL", lyDo, kenh });
  // I-1: adapter của kênh phải CÒN thuộc máy này và đang bật (gỡ ⇒ machineId null qua LEFT JOIN).
  if (hang.adapterMachineId !== machineId || hang.adapterEnabled !== true) return local("kenh_sai_may");
  try {
    if (!boDemDangBat()) return local("bo_dem_tat");
    const g = layGiaTri(hang.adapterId, hang.tagKey, now);
    if (!g) return local("chua_co_mau");
    // Máy hiệu lực của mục bộ đệm (đăng ký OT trong tiến trình) phải là máy này — đăng ký chưa theo kịp việc chuyển máy ⇒ không tin.
    if (g.machineId !== machineId) return local("kenh_sai_may");
    if (g.q !== "good") return local("chat_luong_xau");
    if (g.stale) return local("cu");
    if (g.v === null || g.v === undefined) return local("khac_remote");
    const giaTri = canonicalOtValue(epTheoKieu(hang.dataType, g.v));
    const remote = canonicalOtValue(epTheoKieu(hang.dataType, hang.giaTriRemote));
    return giaTri === remote ? { cheDo: "REMOTE", lyDo: "remote", kenh } : local("khac_remote");
  } catch (err) {
    console.warn(`[SCADA] đọc bộ đệm kênh chế độ máy ${machineId} lỗi (coi là LOCAL):`, (err as Error)?.message ?? err);
    return local("loi_doc");
  }
}
