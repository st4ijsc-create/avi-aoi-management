/**
 * ★★★ 2026-08-18 — TRỤC PHẠM VI cho HỌ BÁO ĐỘNG (`andon_events` / `safety_events` /
 * `predictive_alerts`). Nhóm B mục #5.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * **Lỗ đã đo.** `commandCenter.recentAlerts`, `commandCenter.kpiSummary` và
 * `alarmKpi.summary` đều có `ctx` trong tay mà KHÔNG dùng: ba thủ tục đọc toàn bộ
 * `andon_events` + `safety_events` + `predictive_alerts` của MỌI nhà máy rồi trả cho
 * bất kỳ ai qua được cổng `machine_monitoring/canView`.
 *
 * **Vì sao phải có file này thay vì gắn thẳng `getAccessFilterConditions`.** Mệnh đề
 * ấy nói về `"product_inspections"."factoryCode"` — ba bảng báo động KHÔNG có cột đó:
 *   • `andon_events`  : chỉ `lineId` / `stationId` / `machineId`, KHÔNG cột tenant nào.
 *   • `safety_events` : có `factoryId` + `corporateCode` (nullable) + `lineId`/`stationId`.
 *   • `predictive_alerts` : có `machineId` + `factoryId` (nullable).
 * Nên phải CHIẾU tập nhà máy trong phạm vi (`resolveTenantFactoryScope` — bộ phân giải
 * DUY NHẤT của trục `factoryId`, dùng lại `getUserAssignmentCodes`) xuống các cột liên
 * kết ấy. Ở đây KHÔNG dựng lại luật gán nhà máy: `factoryIds` vào, vị từ ra.
 *
 * **Vì sao ƯU TIÊN đường LIÊN KẾT hơn cột `factoryId` có sẵn.** `safety_events` và
 * `predictive_alerts` mang sẵn `factoryId`, nhưng đó là một ô GHI RỜI — không ràng buộc
 * gì với `lineId`/`machineId` của chính hàng đó. Tuần này đã cắn đúng lớp lỗi ấy một lần
 * (`daily_statistics` mang `factoryId` của nhà máy KHÁC). Nên luật là:
 *   1. Có cột liên kết (line/station/machine) ⇒ phán quyết theo LIÊN KẾT, cột `factoryId`
 *      của hàng KHÔNG được phép ghi đè.
 *   2. Mọi cột liên kết đều NULL ⇒ mới lùi về `factoryId` của hàng.
 *   3. Không đường nào ra được nhà máy ⇒ hàng MỒ CÔI ⇒ **fail-closed** cho người bị thu
 *      hẹp (admin vẫn thấy — họ không đi qua cổng này).
 *
 * ⚠⚠ BỐN BẪY đã cắn tuần này, đều được né TẠI ĐÂY:
 *  1. **Lỗi vòng JSON** — hàm `resolveAlertScope` trả `{ factoryIds, labels }`, KHÔNG có ô
 *     `filter`. `ResolvedDataScope.filter` (đối tượng SQL drizzle, tham chiếu vòng
 *     `PgTable → PgSerial → table`) không có đường lọt ra đáp ứng tRPC. `tsc` KHÔNG bắt
 *     được lớp lỗi đó, nên nó phải bị chặn bằng KIỂU, không bằng quy ước phải nhớ.
 *  2. **Bí danh SQL** — mọi truy vấn phụ dưới đây viết bằng đối tượng bảng drizzle
 *     (`${productionLines}`), KHÔNG đặt bí danh. Drizzle kết xuất cột theo TÊN BẢNG
 *     (`"production_lines"."id"`), nên một `FROM production_lines pl` sẽ vỡ `42P01`.
 *  3. **`Date` vào truy vấn thô** — họ vị từ ở đây KHÔNG mang tham số thời gian nào; cửa
 *     sổ thời gian do nơi gọi ghép bằng drizzle (`gte(col, Date)`), không đi qua `sql``.
 *  4. **Tập rỗng phải là `1 = 0` TƯỜNG MINH** — mọi nhánh đều đi qua `factoryIdGate`, hàm
 *     đã bảo đảm `[] ⇒ sql`1 = 0`` chứ không bao giờ `undefined` (= "không lọc").
 * ════════════════════════════════════════════════════════════════════════════
 */
import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import {
  productionLines,
  workshops,
  stations,
  machines,
  andonEvents,
  safetyEvents,
  predictiveAlerts,
  wipTracking,
  robots,
  tasks,
  productionOrders,
} from "../../../drizzle/schema";
import { factoryIdGate, resolveTenantFactoryScope } from "../../db/reportAggregators";
import {
  SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT,
  type ScopeLabels,
} from "../../_core/accessControlLabels";

/**
 * ★★ Câu "rỗng" TRUNG THỰC cho BỀ MẶT BÁO ĐỘNG.
 *
 * Câu dùng chung (`NO_FACTORY_ASSIGNMENT_MESSAGE`) nói về "bản ghi kiểm" — đúng cho màn
 * sản lượng, SAI cho màn cảnh báo. Nhưng cái phải giữ nguyên là MÃ máy-đọc-được
 * (`no_factory_assignment`, xem `resolveAlertScope`): một mã, ba bề mặt, i18n en/zh dùng
 * lại được. Chỉ câu chữ hiển thị là riêng.
 *
 * ⚠ Câu này cố ý KHÔNG chứa cụm "không có cảnh báo nào" — kể cả trong vế PHỦ ĐỊNH. Người
 * vận hành đọc lướt chỉ bắt được cụm từ, không bắt được vế phủ định, nên "…không phải là
 * không có cảnh báo nào…" vẫn đọng lại đúng cái hiểu sai mà bản vá này đi xoá — và trên
 * màn hình cảnh báo, cái hiểu sai ấy đọc thành **"đang yên ổn"**. Đó là lời khai sai về
 * thế giới ở đúng chỗ nguy hiểm nhất. `commandCenterScope.test.ts` canh chính cụm ấy.
 */
export const NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE =
  "Tài khoản của bạn chưa được gán nhà máy nào, nên phạm vi xem của bạn đang RỖNG: danh " +
  "sách báo động trống vì lý do PHÂN QUYỀN, chứ KHÔNG phải vì xưởng đang yên ổn. Xưởng có " +
  "thể đang có báo động mà bạn không được phép thấy. Liên hệ quản trị viên để được gán nhà máy.";

/**
 * ★★★ 2026-08-18 — Câu "rỗng" TRUNG THỰC cho DẢI KPI (`commandCenter.kpiSummary`).
 *
 * **Vì sao KHÔNG dùng lại câu báo động ở trên.** Từ lượt này dải KPI có NĂM ô bị thu hẹp
 * (`oee` · `wip` · `alarms` · `fleet` — và `sites` bị chặn hẳn, xem docblock `buildKpiSummary`).
 * Câu kia chỉ nói về "danh sách báo động", nên đặt nó dưới một dải mà OEE hiện 0% và WIP hiện
 * 0 là **khai THIẾU**: người đọc kết luận rằng bốn ô kia là số ĐO ĐƯỢC. Mã máy-đọc-được vẫn
 * là MỘT (`no_factory_assignment`) — chỉ câu chữ hiển thị đổi theo bề mặt.
 *
 * ⚠ Cụm bị cấm ở đây RỘNG HƠN bề mặt báo động. Ngoài "không có dữ liệu" / "không có cảnh
 * báo", câu này còn không được chứa "yên ổn"/"bình thường" ở BẤT KỲ vế nào: một dải KPI toàn
 * số 0 tự nó đã đọc thành "xưởng đang yên ổn", nên nhắc lại cụm ấy — kể cả để phủ định —
 * là bồi thêm đúng cái hiểu sai. `commandCenterScope.test.ts` canh cả bốn cụm.
 */
export const NO_FACTORY_ASSIGNMENT_KPI_MESSAGE =
  "Tài khoản của bạn chưa được gán nhà máy nào, nên phạm vi xem của bạn đang RỖNG: dải KPI " +
  "hiển thị toàn số 0 vì lý do PHÂN QUYỀN — đây KHÔNG phải số đo của xưởng. Sản lượng, OEE, " +
  "WIP, đội thiết bị và báo động thật của xưởng có thể đang khác 0 mà bạn không được phép " +
  "thấy. Liên hệ quản trị viên để được gán nhà máy.";

/** Phạm vi báo động của một người xem. KHÔNG có ô `filter` — xem bẫy 1 ở đầu file. */
export interface AlertScope {
  /** `null` = vai toàn quyền / lối đi KHÔNG mang danh tính ⇒ KHÔNG áp cổng nào. */
  factoryIds: number[] | null;
  labels: ScopeLabels;
}

/**
 * Bộ phân giải phạm vi cho ba thủ tục báo động. Danh tính LUÔN đến từ `ctx.user` — không
 * bao giờ từ `input` (một `input.userId` là lời TỰ KHAI của người gọi).
 *
 * Tập RỖNG (`[]`) luôn kèm lý do + câu chữ: đó là điểm khác biệt giữa "0 vì xưởng yên
 * tĩnh" và "0 vì phạm vi của bạn rỗng". `resolveTenantFactoryScope` chỉ gắn lý do khi
 * người dùng KHÔNG có bản gán nào; nó KHÔNG gắn khi có bản gán nhưng mã gán không chiếu
 * được sang hàng `factories` nào (mã sai / nhà máy đã xoá) — trường hợp đó màn hình vẫn
 * 0 dòng, và nếu không nói gì thì lại thành đúng lời khai sai kia. Nên ở đây: **hễ tập
 * rỗng là phải có lý do.**
 */
export async function resolveAlertScope(user?: {
  id?: number | null;
  role?: string | null;
} | null): Promise<AlertScope> {
  return resolveScopeWithMessage(user, NO_FACTORY_ASSIGNMENT_ALERTS_MESSAGE);
}

/**
 * ★★★ 2026-08-18 — cùng phép phân giải, câu chữ của DẢI KPI.
 *
 * Đây KHÔNG phải nguồn thứ hai: `factoryIds` vẫn do `resolveScopeWithMessage` →
 * `resolveTenantFactoryScope` quyết định, chỉ ô `scopeMessage` khác. Nếu mai này có bề mặt
 * thứ tư, thêm một hằng số câu chữ chứ đừng thêm một bộ phân giải.
 */
export async function resolveKpiScope(user?: {
  id?: number | null;
  role?: string | null;
} | null): Promise<AlertScope> {
  return resolveScopeWithMessage(user, NO_FACTORY_ASSIGNMENT_KPI_MESSAGE);
}

/** Thân chung của hai bộ phân giải trên — luật phạm vi ở ĐÚNG MỘT chỗ, câu chữ là tham số. */
async function resolveScopeWithMessage(
  user: { id?: number | null; role?: string | null } | null | undefined,
  emptyMessage: string,
): Promise<AlertScope> {
  const scope = await resolveTenantFactoryScope({
    userId: user?.id ?? undefined,
    userRole: user?.role ?? undefined,
  });
  const empty = Array.isArray(scope.factoryIds) && scope.factoryIds.length === 0;
  if (!empty && scope.labels.scopeEmptyReason == null) {
    return { factoryIds: scope.factoryIds, labels: scope.labels };
  }
  return {
    factoryIds: scope.factoryIds,
    labels: {
      scopeApplied: scope.labels.scopeApplied,
      scopeEmptyReason: empty || scope.labels.scopeEmptyReason != null
        ? SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT
        : null,
      scopeMessage: empty || scope.labels.scopeEmptyReason != null
        ? emptyMessage
        : null,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TRUY VẤN PHỤ — chiếu tập nhà máy xuống line / station / machine.
// KHÔNG đặt bí danh bảng (bẫy 2). Tập rỗng đi qua `factoryIdGate` ⇒ `1 = 0` (bẫy 4).
// ════════════════════════════════════════════════════════════════════════════

/** `production_lines.id` thuộc các nhà máy trong phạm vi (line → workshop → factory). */
function scopedLineIds(factoryIds: number[]): SQL {
  return sql`SELECT ${productionLines.id} FROM ${productionLines}
             INNER JOIN ${workshops} ON ${workshops.id} = ${productionLines.workshopId}
             WHERE ${factoryIdGate(workshops.factoryId, factoryIds)}`;
}

/** `stations.id` thuộc các nhà máy trong phạm vi (station → line → …). */
function scopedStationIds(factoryIds: number[]): SQL {
  return sql`SELECT ${stations.id} FROM ${stations}
             WHERE ${stations.lineId} IN (${scopedLineIds(factoryIds)})`;
}

/** `machines.id` thuộc các nhà máy trong phạm vi (machine → station → line → …). */
function scopedMachineIds(factoryIds: number[]): SQL {
  return sql`SELECT ${machines.id} FROM ${machines}
             WHERE ${machines.stationId} IN (${scopedStationIds(factoryIds)})`;
}

/**
 * `robots.id` thuộc phạm vi. `robots` KHÔNG có cột tenant nào — chỉ `lineId`/`stationId`,
 * nên robot mồ côi (cả hai NULL, hoặc trỏ vào tuyến/trạm đã xoá) KHÔNG có đường nào ra
 * được nhà máy ⇒ bị loại, đúng luật fail-closed.
 */
function scopedRobotIds(factoryIds: number[]): SQL {
  return sql`SELECT ${robots.id} FROM ${robots}
             WHERE ${robots.lineId} IN (${scopedLineIds(factoryIds)})
                OR ${robots.stationId} IN (${scopedStationIds(factoryIds)})`;
}

/**
 * `production_orders.id` thuộc phạm vi — phân giải qua `lineId` (cột NOT NULL, liên kết
 * THẬT), cố ý KHÔNG qua `production_orders."factoryId"`.
 *
 * ⚠ Lệnh sản xuất mang CẢ HAI cột và chúng có thể BẤT ĐỒNG (không ràng buộc nào bắt
 * `factoryId` phải khớp nhà máy của `lineId`). Chọn cột rời ở đây là mở lại đúng lớp lỗi
 * "hàng mang `factoryId` của nhà máy KHÁC" mà cả file này đi tránh.
 */
function scopedWorkOrderIds(factoryIds: number[]): SQL {
  return sql`SELECT ${productionOrders.id} FROM ${productionOrders}
             WHERE ${productionOrders.lineId} IN (${scopedLineIds(factoryIds)})`;
}

// ════════════════════════════════════════════════════════════════════════════
// CỔNG THEO BẢNG
//
// ⚠ Vì sao mọi nhánh đều là `IN (truy-vấn-phụ)` chứ không `= ANY(mảng)`: `col = ANY(${js})`
// khiến postgres.js gửi mảng JS sang thành `text[]` ⇒ `42809` (đã cắn 10 chỗ).
//
// ⚠ FAIL-CLOSED theo cấu tạo: `NULL IN (…)` cho `NULL`, và `NULL` KHÔNG phải `TRUE` nên
// hàng bị LOẠI. Một `lineId` trỏ tới tuyến đã xoá cũng không nằm trong truy vấn phụ ⇒ loại.
// Đó chính là hành vi cần cho HÀNG MỒ CÔI — không phải hiệu ứng phụ tình cờ.
// ════════════════════════════════════════════════════════════════════════════

/**
 * `andon_events` — KHÔNG có cột tenant nào, nối bằng cả ba cột liên kết.
 * Mồ côi (cả ba NULL, hoặc cả ba trỏ vào hàng đã biến mất) ⇒ bị loại.
 */
export function andonFactoryGate(factoryIds: number[]): SQL {
  return sql`(${andonEvents.lineId} IN (${scopedLineIds(factoryIds)})
           OR ${andonEvents.stationId} IN (${scopedStationIds(factoryIds)})
           OR ${andonEvents.machineId} IN (${scopedMachineIds(factoryIds)}))`;
}

/**
 * `safety_events` — có `factoryId` nhưng chỉ được dùng khi KHÔNG còn đường liên kết nào
 * (xem "ƯU TIÊN đường LIÊN KẾT" ở đầu file: một ô ghi rời không được quyền ghi đè liên kết).
 */
export function safetyFactoryGate(factoryIds: number[]): SQL {
  return sql`(${safetyEvents.lineId} IN (${scopedLineIds(factoryIds)})
           OR ${safetyEvents.stationId} IN (${scopedStationIds(factoryIds)})
           OR (${safetyEvents.lineId} IS NULL
               AND ${safetyEvents.stationId} IS NULL
               AND ${safetyEvents.factoryId} IS NOT NULL
               AND ${factoryIdGate(safetyEvents.factoryId, factoryIds)}))`;
}

/**
 * `predictive_alerts` — `machineId` là liên kết thật; `factoryId` chỉ là lối lùi khi
 * hàng không gắn máy nào.
 *
 * ⚠ Vị từ này nói về bảng `predictive_alerts`, nên nơi gọi phải đã JOIN bảng ấy vào
 * (`predictive_alert_occurrences INNER JOIN predictive_alerts`) — nếu không sẽ `42P01`.
 */
export function predictiveAlertFactoryGate(factoryIds: number[]): SQL {
  return sql`(${predictiveAlerts.machineId} IN (${scopedMachineIds(factoryIds)})
           OR (${predictiveAlerts.machineId} IS NULL
               AND ${predictiveAlerts.factoryId} IS NOT NULL
               AND ${factoryIdGate(predictiveAlerts.factoryId, factoryIds)}))`;
}

// ════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-18 — CỔNG cho BỐN NGUỒN CÒN LẠI của dải KPI (`buildKpiSummary`).
//
// Khảo sát bốn bảng TRƯỚC khi vá (đo trên `aoi_management` cùng ngày):
//
//  ┌────────────────┬──────────────────────┬───────────────────────────────┬──────────┐
//  │ bảng           │ cột tenant           │ đường LIÊN KẾT ra nhà máy      │ mồ côi   │
//  ├────────────────┼──────────────────────┼───────────────────────────────┼──────────┤
//  │ wip_tracking   │ KHÔNG có             │ lineId · currentStationId ·    │ 0/7.047  │
//  │                │                      │ currentMachineId               │          │
//  │ robots         │ KHÔNG có             │ lineId · stationId             │ 0/3      │
//  │ tasks          │ factoryId ·          │ assignedDeviceId(kind=robot) → │ 0/2      │
//  │                │ corporateCode (rời)  │ robots; sourceWorkOrderId →    │          │
//  │                │                      │ production_orders.lineId       │          │
//  │ site_kpi_rollup│ corporateCode (rời)  │ KHÔNG CÓ — xem docblock         │ (n/a)    │
//  │                │                      │ `buildKpiSummary`               │          │
//  └────────────────┴──────────────────────┴───────────────────────────────┴──────────┘
//
// `site_kpi_rollup` KHÔNG có cổng ở đây, và đó là một QUYẾT ĐỊNH chứ không phải bỏ sót:
// xem lời khai đầy đủ ở docblock ô `sites` trong `commandCenterService.buildKpiSummary`.
// ════════════════════════════════════════════════════════════════════════════

/**
 * `wip_tracking` — KHÔNG có cột tenant nào (đã kiểm cả schema lẫn `information_schema`),
 * nên nối bằng cả ba cột liên kết và KHÔNG có lối lùi. Hàng mồ côi ⇒ bị loại.
 */
export function wipFactoryGate(factoryIds: number[]): SQL {
  return sql`(${wipTracking.lineId} IN (${scopedLineIds(factoryIds)})
           OR ${wipTracking.currentStationId} IN (${scopedStationIds(factoryIds)})
           OR ${wipTracking.currentMachineId} IN (${scopedMachineIds(factoryIds)}))`;
}

/** `robots` — KHÔNG có cột tenant; nối bằng `lineId`/`stationId`, không có lối lùi. */
export function robotFactoryGate(factoryIds: number[]): SQL {
  return sql`(${robots.lineId} IN (${scopedLineIds(factoryIds)})
           OR ${robots.stationId} IN (${scopedStationIds(factoryIds)}))`;
}

/**
 * `tasks` — có `factoryId` GHI RỜI, nhưng nó là hạng CHÓT.
 *
 * Thứ tự phán quyết (đúng luật "ưu tiên LIÊN KẾT" ở đầu file):
 *   1. Có thiết bị được gán ⇒ phán quyết theo THIẾT BỊ. Chỉ `assignedDeviceKind = 'robot'`
 *      phân giải được (đó là kiểu DUY NHẤT mà `taskAllocator`/`fleetRouter` từng ghi). Một
 *      hàng có `assignedDeviceId` với kiểu KHÁC là không phân giải được ⇒ loại — chứ không
 *      lặng lẽ tụt xuống đọc `factoryId`, vì như thế thiết bị của nhà máy B mà `factoryId`
 *      ghi A sẽ lọt sang A.
 *   2. Không có thiết bị nhưng có lệnh sản xuất ⇒ phán quyết theo `production_orders.lineId`.
 *   3. CẢ HAI liên kết đều NULL ⇒ mới được lùi về `tasks."factoryId"`.
 */
export function taskFactoryGate(factoryIds: number[]): SQL {
  return sql`((${tasks.assignedDeviceKind} = 'robot'
               AND ${tasks.assignedDeviceId} IN (${scopedRobotIds(factoryIds)}))
           OR (${tasks.assignedDeviceId} IS NULL
               AND ${tasks.sourceWorkOrderId} IN (${scopedWorkOrderIds(factoryIds)}))
           OR (${tasks.assignedDeviceId} IS NULL
               AND ${tasks.sourceWorkOrderId} IS NULL
               AND ${tasks.factoryId} IS NOT NULL
               AND ${factoryIdGate(tasks.factoryId, factoryIds)}))`;
}

/**
 * Cổng dùng chung cho MỘT CỘT `machineId` của bảng bất kỳ (hiện dùng cho `oee_metrics` —
 * tầng dự phòng của ô `oee`).
 *
 * ⚠ Vì sao KHÔNG dùng `reportAggregators.tenantMachineGate`: hàm ấy suy ra tập máy từ
 * `product_inspections` TRONG MỘT CỬA SỔ THỜI GIAN — tức "máy nào ĐÃ KIỂM trong khoảng
 * này", không phải "máy nào THUỘC nhà máy này". Một máy không chạy trong cửa sổ sẽ biến
 * mất khỏi phạm vi, và số OEE của nó lặng lẽ rơi ra ngoài mẫu. Ở đây cần đúng quan hệ
 * PHÂN CẤP, nên chiếu qua `machines → stations → production_lines → workshops`.
 */
export function machineIdFactoryGate(machineIdCol: SQL | AnyColumn, factoryIds: number[]): SQL {
  return sql`${machineIdCol} IN (${scopedMachineIds(factoryIds)})`;
}
