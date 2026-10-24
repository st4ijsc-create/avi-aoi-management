/**
 * SCADA R1b-1 Task 2 fix round 1/2 (điều phối 2026-10-24) — KHẢO SÁT KHẢ NĂNG DỪNG của một máy: nút DỪNG MÁY (`scadaCommands.dungMay`)
 * sẽ làm gì với TỪNG adapter đang bật, để người vận hành biết TRƯỚC khi cần dừng (không phải lúc nút báo đỏ).
 *
 * Một hàm, dùng ở hai nơi: (a) hộp xác nhận DỪNG MÁY liệt kê từng adapter trước khi gửi; (b) cảnh báo cấp máy ở M4 (faceplate), M10 (và M3
 * khi có). Đưa ra qua hàng `scadaKenh.cheDo.danhSach` (trường `khaNangDung`) — KHÔNG thêm thủ tục (bản nhiều máy một lượt đọc ghim).
 *
 * KẾT LUẬN theo THỨ TỰ của `dispatchCore` (cùng vị từ, không bản sao):
 *   1. không ghim DỪNG hợp lệ (`stopPinsFromTagRows` — luật của `loadStopPins`)  ⇒ `chua_ghim` (dungMay không gửi gì tới adapter này)
 *   2. adapter do edge sở hữu                                                    ⇒ `qua_edge` (dispatcher định tuyến STOP sang node edge;
 *      chỉ xác nhận khi edge báo lại — KHÔNG tính là `duoc`); kèm `edgeCode` + `edgeToiDuoc` (`edgeNodeReachability`: lượt kéo trong
 *      tiến trình này, không có thì tuổi heartbeat — MỘT lượt đọc rẻ). fix round 3: dưới hạn STOP_DB_STEP_DEADLINE_MS (khuôn của
 *      dispatcher ở routeEdgeOwnedAdapterCommand), quá hạn / lỗi ⇒ KHÔNG tới được (chiều an toàn cho cảnh báo); MỘT lượt hỏi mỗi node
 *      trong một lần khảo sát (bộ nhớ đệm theo lượt gọi)
 *   3. trung tâm không giữ driver (`getActiveDriver`)                            ⇒ `mat_ket_noi` (dispatch bước 4: ADAPTER_OFFLINE, không gửi gì)
 *   4. `!isOtControlEnabled()`                                                    ⇒ `mo_phong`, lyDo "ot_control_tat" (bước 5: writeSimulated)
 *   5. `isCommissioningRequired() && !isCommissioned(adapter)`                    ⇒ `mo_phong`, lyDo "chua_nghiem_thu" (bước 5a: writeSimulated)
 *   6. `!runningConnectionMatchesAdapterRow` (dấu vân tay kết nối ĐANG CHẠY ≠ hàng adapter — sửa adapter mà chưa nối lại)
 *                                                                                ⇒ `ghim_cu` (5a-stop: KHÔNG phải STOP ghim)
 *   7. còn lại                                                                    ⇒ `duoc`
 * fix round 2: lỗi khi kiểm MỘT adapter (đọc nghiệm thu / vân tay / edge …) ⇒ `khong_kiem_duoc` cho adapter đó — KHÔNG BAO GIỜ `duoc`,
 * không làm hỏng cả danh sách. Lỗi đọc CHUNG (adapter / ghim) ⇒ mọi máy `loiKhaoSat: true`, adapters rỗng (UI nói "không kiểm được").
 * tongHop: mọi adapter `duoc` ⇒ "duoc"; không adapter nào `duoc` (kể cả máy không có adapter bật / lỗi khảo sát) ⇒ "khong"; còn lại ⇒
 * "mot_phan". `qua_edge` không tính là `duoc`.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { deviceAdapters, deviceTags } from "../../../drizzle/schema";
import type { getDb } from "../../db/connection";
import { logger } from "../../logger";
import { getActiveDriver } from "../ot/otManager";
import { isOtControlEnabled, runningConnectionMatchesAdapterRow } from "../ot/commandDispatcher";
import { isCommissioned, isCommissioningRequired } from "../ot/commissioningService";
import { stopPinsFromTagRows, type StopPinTagRow } from "../ot/stopPin";
import { isEdgeControlSchemaMissing } from "../edge/edgeControlSchema";
import { edgeNodeReachability } from "../edge/edgeNodeCommands";
import { withDeadline } from "../ot/drivers/boundedClose";
import { STOP_DB_STEP_DEADLINE_MS } from "../robot/stopJob";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type TrangThaiKhaNangDung = "duoc" | "qua_edge" | "mat_ket_noi" | "mo_phong" | "ghim_cu" | "chua_ghim" | "khong_kiem_duoc";
export type LyDoKhaNangDung = "ot_control_tat" | "chua_nghiem_thu";

export interface KhaNangDungAdapter {
  adapterId: number;
  code: string;
  trangThai: TrangThaiKhaNangDung;
  lyDo?: LyDoKhaNangDung;
  /** qua_edge: mã node edge sở hữu (hoặc id khi node không còn mã) */
  edgeCode?: string;
  /** qua_edge: node có liên lạc được với trung tâm không (false ⇒ cảnh báo) */
  edgeToiDuoc?: boolean;
}

export interface KhaNangDungMay {
  machineId: number;
  adapters: KhaNangDungAdapter[];
  tongHop: "duoc" | "mot_phan" | "khong";
  /** lỗi đọc chung (adapter / ghim) — không kết luận được cho máy này */
  loiKhaoSat?: true;
}

export function tongHopKhaNang(adapters: ReadonlyArray<KhaNangDungAdapter>): KhaNangDungMay["tongHop"] {
  const duoc = adapters.filter((a) => a.trangThai === "duoc").length;
  if (adapters.length > 0 && duoc === adapters.length) return "duoc";
  return duoc === 0 ? "khong" : "mot_phan";
}

type HangAdapter = { id: number; code: string; machineId: number; edgeNodeId: number | null; edgeCode: string | null };

/** Adapter bật của các máy + chủ edge (mig 0374; thiếu cột ⇒ không adapter nào thuộc edge). */
async function docAdapterBat(db: Db, machineIds: number[]): Promise<HangAdapter[]> {
  const ids = sql.join(
    machineIds.map((i) => sql`${i}`),
    sql`, `,
  );
  try {
    const rows = (await db.execute(sql`SELECT a."id" AS id, a."code" AS code, a."machineId" AS "machineId", a."edgeNodeId" AS "edgeNodeId",
        n."code" AS "edgeCode"
      FROM device_adapters a LEFT JOIN edge_nodes n ON n."id" = a."edgeNodeId"
      WHERE a."isEnabled" = true AND a."machineId" IN (${ids}) ORDER BY a."id"`)) as unknown as Array<{
      id: number;
      code: string;
      machineId: number;
      edgeNodeId: number | null;
      edgeCode: string | null;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      code: r.code,
      machineId: Number(r.machineId),
      edgeNodeId: r.edgeNodeId === null || r.edgeNodeId === undefined ? null : Number(r.edgeNodeId),
      edgeCode: r.edgeCode ?? null,
    }));
  } catch (err) {
    if (!isEdgeControlSchemaMissing(err)) throw err;
    const rows = await db
      .select({ id: deviceAdapters.id, code: deviceAdapters.code, machineId: deviceAdapters.machineId })
      .from(deviceAdapters)
      .where(and(inArray(deviceAdapters.machineId, machineIds), eq(deviceAdapters.isEnabled, true)))
      .orderBy(asc(deviceAdapters.id));
    return rows.map((r) => ({ id: r.id, code: r.code, machineId: r.machineId as number, edgeNodeId: null, edgeCode: null }));
  }
}

/** Bộ nhớ đệm "node edge tới được không" của MỘT lần khảo sát (khoá: edgeNodeId). */
type DemToiEdge = Map<number, Promise<boolean>>;

/** fix round 3 — tới được node edge? Dưới hạn; quá hạn / lỗi ⇒ false (không bao giờ treo danh sách, không bao giờ nói "tới được" khi không biết). */
function edgeToiDuoc(dem: DemToiEdge, nodeId: number): Promise<boolean> {
  let p = dem.get(nodeId);
  if (!p) {
    p = withDeadline(
      Promise.resolve().then(() => edgeNodeReachability(nodeId)),
      STOP_DB_STEP_DEADLINE_MS,
      `edge node ${nodeId} reachability (khảo sát khả năng dừng)`,
    ).then(
      (r) => r.reachable === true,
      () => false,
    );
    dem.set(nodeId, p);
  }
  return p;
}

/** Một adapter có ghim: các bước 2–7 (thứ tự dispatchCore). Có thể ném — nơi gọi đổi thành `khong_kiem_duoc`. */
async function ketLuanCoGhim(db: Db, a: HangAdapter, dem: DemToiEdge): Promise<Omit<KhaNangDungAdapter, "adapterId" | "code">> {
  if (a.edgeNodeId !== null) {
    return { trangThai: "qua_edge", edgeCode: a.edgeCode ?? String(a.edgeNodeId), edgeToiDuoc: await edgeToiDuoc(dem, a.edgeNodeId) };
  }
  if (!getActiveDriver(a.id)) return { trangThai: "mat_ket_noi" };
  if (!isOtControlEnabled()) return { trangThai: "mo_phong", lyDo: "ot_control_tat" };
  if (isCommissioningRequired() && !(await isCommissioned(a.id))) return { trangThai: "mo_phong", lyDo: "chua_nghiem_thu" };
  if (!(await runningConnectionMatchesAdapterRow(db, a.id))) return { trangThai: "ghim_cu" };
  return { trangThai: "duoc" };
}

/** Bản nhiều máy (một lượt đọc adapter + một lượt đọc ghim) — `scadaKenh.cheDo.danhSach` dùng. Không bao giờ ném. */
export async function khaoSatKhaNangDungNhieu(db: Db, machineIds: number[]): Promise<Map<number, KhaNangDungMay>> {
  const out = new Map<number, KhaNangDungMay>();
  for (const m of machineIds) out.set(m, { machineId: m, adapters: [], tongHop: "khong" });
  if (machineIds.length === 0) return out;
  let adapters: HangAdapter[];
  const ghim = new Map<number, StopPinTagRow[]>();
  try {
    adapters = await docAdapterBat(db, machineIds);
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
  } catch (err) {
    // fix round 2 — đọc chung hỏng: KHÔNG làm hỏng danh sách; mọi máy "không kiểm được" (không bao giờ "được")
    logger.error({ err: (err as Error)?.message ?? String(err) }, "[SCADA] khảo sát khả năng dừng: đọc adapter/ghim lỗi");
    for (const v of out.values()) v.loiKhaoSat = true;
    return out;
  }
  const dem: DemToiEdge = new Map();
  const ketLuan = await Promise.all(
    adapters.map(async (a): Promise<KhaNangDungAdapter & { machineId: number }> => {
      const co = { machineId: a.machineId, adapterId: a.id, code: a.code };
      try {
        if (stopPinsFromTagRows(ghim.get(a.id) ?? []).length === 0) return { ...co, trangThai: "chua_ghim" };
        return { ...co, ...(await ketLuanCoGhim(db, a, dem)) };
      } catch (err) {
        // fix round 2 — lỗi khi kiểm MỘT adapter ⇒ chỉ adapter đó "không kiểm được"
        logger.error({ err: (err as Error)?.message ?? String(err), adapterId: a.id }, "[SCADA] khảo sát khả năng dừng: kiểm adapter lỗi");
        return { ...co, trangThai: "khong_kiem_duoc" };
      }
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
