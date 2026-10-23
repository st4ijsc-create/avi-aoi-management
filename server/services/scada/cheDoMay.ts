/**
 * SCADA R1a Task 4 (K2 / D3) — CHẾ ĐỘ MÁY: LOCAL hay REMOTE, suy từ kênh chế độ đã khai (`scada_kenh_che_do`) + bộ đệm giá trị hiện tại.
 *
 * REMOTE **chỉ khi** TẤT CẢ đúng: máy đã khai kênh chế độ, bộ đệm bật, có mẫu cho (adapter, tag), `q === "good"`, `!stale`, và giá trị
 * (ép kiểu theo `dataType` của tag chế độ, cùng luật `kiemGiaTriGhi`) có dạng canonical (`canonicalOtValue`) bằng `gia_tri_remote`.
 * Mọi trường hợp khác là LOCAL kèm `lyDo` (fail-closed). Hàm KHÔNG BAO GIỜ ném: lỗi đọc DB / db không có ⇒ LOCAL `chua_khai` (không
 * xác lập được khai báo), lỗi đọc bộ đệm ⇒ LOCAL `chua_co_mau`.
 *
 * Chi phí: MỘT truy vấn nhỏ theo PK `machine_id` (LEFT JOIN device_tags theo khoá duy nhất (adapterId, tagKey) để lấy `dataType`).
 * Không cache (quyết định điều phối: giá trị chế độ đổi theo giây, khai báo đổi bất kỳ lúc nào).
 */
import { and, eq } from "drizzle-orm";
import { deviceTags, scadaKenhCheDo, type DeviceTag } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { canonicalOtValue } from "../ot/otActionBinding";
import { boDemDangBat, layGiaTri } from "./boDemHienTai";
import { kiemGiaTriGhi } from "./kenhScada";

export type LyDoCheDo = "remote" | "chua_khai" | "bo_dem_tat" | "chua_co_mau" | "chat_luong_xau" | "cu" | "khac_remote";

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

export async function cheDoMay(machineId: number | null, now: number = Date.now()): Promise<CheDo> {
  if (machineId == null) return { cheDo: "LOCAL", lyDo: "chua_khai" };

  let hang: { adapterId: number; tagKey: string; giaTriRemote: unknown; dataType: DeviceTag["dataType"] | null } | undefined;
  try {
    const db = await getDb();
    if (!db) return { cheDo: "LOCAL", lyDo: "chua_khai" };
    const rows = await db
      .select({
        adapterId: scadaKenhCheDo.adapterId,
        tagKey: scadaKenhCheDo.tagKey,
        giaTriRemote: scadaKenhCheDo.giaTriRemote,
        dataType: deviceTags.dataType,
      })
      .from(scadaKenhCheDo)
      .leftJoin(deviceTags, and(eq(deviceTags.adapterId, scadaKenhCheDo.adapterId), eq(deviceTags.tagKey, scadaKenhCheDo.tagKey)))
      .where(eq(scadaKenhCheDo.machineId, machineId))
      .limit(1);
    hang = rows[0];
  } catch (err) {
    console.warn(`[SCADA] đọc kênh chế độ máy ${machineId} lỗi (coi là LOCAL):`, (err as Error)?.message ?? err);
    return { cheDo: "LOCAL", lyDo: "chua_khai" };
  }
  if (!hang) return { cheDo: "LOCAL", lyDo: "chua_khai" };

  const kenh = { adapterId: hang.adapterId, tagKey: hang.tagKey };
  const local = (lyDo: LyDoCheDo): CheDo => ({ cheDo: "LOCAL", lyDo, kenh });
  try {
    if (!boDemDangBat()) return local("bo_dem_tat");
    const g = layGiaTri(hang.adapterId, hang.tagKey, now);
    if (!g) return local("chua_co_mau");
    if (g.q !== "good") return local("chat_luong_xau");
    if (g.stale) return local("cu");
    if (g.v === null || g.v === undefined) return local("khac_remote");
    const giaTri = canonicalOtValue(epTheoKieu(hang.dataType, g.v));
    const remote = canonicalOtValue(epTheoKieu(hang.dataType, hang.giaTriRemote));
    return giaTri === remote ? { cheDo: "REMOTE", lyDo: "remote", kenh } : local("khac_remote");
  } catch (err) {
    console.warn(`[SCADA] đọc bộ đệm kênh chế độ máy ${machineId} lỗi (coi là LOCAL):`, (err as Error)?.message ?? err);
    return local("chua_co_mau");
  }
}
