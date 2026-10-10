/**
 * doc 81 Đợt 5 H5 (mục 30) — PHẠM VI NHÀ MÁY của roster "Giao cho" (và của người được giao ở `engineering.assign`).
 *
 * Luật (quyết định chủ dự án 2026-10-10, khuyến nghị (b) của khảo sát):
 *   • Người gọi toàn quyền (admin — `idsTrongPhamVi` trả null) ⇒ KHÔNG đổi gì (không lọc).
 *   • Còn lại: chỉ người dùng CÙNG ÍT NHẤT MỘT nhà máy với MỤC ĐÍCH; mục không có nhà máy nào (hoặc không tồn tại / ngoài
 *     phạm vi người gọi — CÙNG một nhánh, không thành chỗ dò) ⇒ cùng ít nhất một nhà máy với NGƯỜI GIAO.
 *   • "Cùng nhà máy" = luật phạm vi dùng chung (`resolveTenantFactoryScope`): vai `admin` thấy mọi nhà máy (luôn qua);
 *     người khác qua `user_factory_assignments` (mã nhà máy) hoặc `user_corporate_assignments` (mã tập đoàn của nhà máy).
 *   • Tập nhà máy đích RỖNG (người giao không được gán nhà máy nào) ⇒ chỉ còn vai admin (fail-closed).
 *
 * Nhà máy của mục (cùng chuỗi liên kết với `commandCenterScope.ts`: máy → trạm → chuyền → xưởng → nhà máy):
 *   ecn `factoryId` · recipe `machineId` · interlock rule `machineId`/`targetMachineId`/`lineId`/`stationId` ·
 *   changeover `machineId` · orchestration run = máy / adapter (→ máy) / robot (chuyền | trạm) mà định nghĩa của nó chạm
 *   (`collectTargets`, đọc thuần). ⚠ Run NGOÀI phạm vi người gọi (R-5-d) ⇒ như không tồn tại: NGƯỜI GỌI (router
 *   `engineeringAssignmentRouter`) kiểm `runIdVisibleTo(input.entityId, foeScopeOf(ctx.user))` TRƯỚC và khi đó không truyền id
 *   nào xuống đây (census `orchestrationScopeCensus.dot5.test.ts` đo dòng ấy ở router).
 * Được giao ≠ được duyệt: tệp này chỉ thu hẹp AI có thể được giao.
 */
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  deviceAdapters, engineeringChanges, factories, interlockRules, changeoverRequests, machineRecipes, machines,
  orchestrationRuns, orchestrationWorkflows, productionLines, robots, stations, userCorporateAssignments,
  userFactoryAssignments, users, workshops,
} from "../../../drizzle/schema";
import { idsTrongPhamVi } from "../../db/hierarchy";
import { phamViCua, type CoDanhTinh } from "../../routers/_phamViNguoiXem";
import { collectTargets } from "../orchestration/foe/foeScope";
import type { WorkflowDefinition } from "../orchestration/foe/workflowModel";
import type { AssignableEntityType } from "@shared/engineeringAssignment";
import type { DbOrTx } from "./assignmentService";

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const uniq = (xs: Array<number | null | undefined>) => [...new Set(xs.filter(posInt))];

/** Nhà máy của các máy / chuyền / trạm (máy → trạm → chuyền → xưởng). */
async function factoriesOf(d: DbOrTx, p: { machineIds?: number[]; lineIds?: number[]; stationIds?: number[] }): Promise<number[]> {
  const lineIds = uniq(p.lineIds ?? []);
  const stationIds = uniq(p.stationIds ?? []);
  const machineIds = uniq(p.machineIds ?? []);
  if (machineIds.length) {
    const ms = await d.select({ stationId: machines.stationId }).from(machines).where(inArray(machines.id, machineIds));
    stationIds.push(...uniq(ms.map((m) => m.stationId)));
  }
  if (stationIds.length) {
    const ss = await d.select({ lineId: stations.lineId }).from(stations).where(inArray(stations.id, uniq(stationIds)));
    lineIds.push(...uniq(ss.map((s) => s.lineId)));
  }
  if (!lineIds.length) return [];
  const ws = await d
    .select({ factoryId: workshops.factoryId })
    .from(productionLines)
    .innerJoin(workshops, eq(workshops.id, productionLines.workshopId))
    .where(inArray(productionLines.id, uniq(lineIds)));
  return uniq(ws.map((w) => w.factoryId));
}

/** Nhà máy của MỤC. Không tồn tại / không liên kết nhà máy nào ⇒ []. */
export async function targetFactoryIds(d: DbOrTx, type: AssignableEntityType, entityId: number): Promise<number[]> {
  switch (type) {
    case "ecn": {
      const [r] = await d.select({ f: engineeringChanges.factoryId }).from(engineeringChanges).where(eq(engineeringChanges.id, entityId)).limit(1);
      return uniq([r?.f]);
    }
    case "recipe": {
      const [r] = await d.select({ m: machineRecipes.machineId }).from(machineRecipes).where(eq(machineRecipes.id, entityId)).limit(1);
      return r ? factoriesOf(d, { machineIds: uniq([r.m]) }) : [];
    }
    case "interlock_rule": {
      const [r] = await d
        .select({ m: interlockRules.machineId, tm: interlockRules.targetMachineId, l: interlockRules.lineId, s: interlockRules.stationId })
        .from(interlockRules).where(eq(interlockRules.id, entityId)).limit(1);
      return r ? factoriesOf(d, { machineIds: uniq([r.m, r.tm]), lineIds: uniq([r.l]), stationIds: uniq([r.s]) }) : [];
    }
    case "changeover": {
      const [r] = await d.select({ m: changeoverRequests.machineId }).from(changeoverRequests).where(eq(changeoverRequests.id, entityId)).limit(1);
      return r ? factoriesOf(d, { machineIds: uniq([r.m]) }) : [];
    }
    case "orchestration_run": {
      const [r] = await d
        .select({ def: orchestrationWorkflows.definitionJson })
        .from(orchestrationRuns)
        .innerJoin(orchestrationWorkflows, eq(orchestrationWorkflows.id, orchestrationRuns.workflowId))
        .where(eq(orchestrationRuns.id, entityId)).limit(1);
      const def = r?.def as WorkflowDefinition | undefined;
      if (!def || !Array.isArray(def.steps)) return [];
      // Bản đồ máy rỗng ⇒ `collectTargets` đếm CẢ robotId lẫn adapterId của bước lệnh (đường an toàn của chính nó).
      const t = collectTargets(def, new Map(), new Set());
      const machineIds = [...t.machines.keys()];
      const adapterIds = [...t.adapters.keys()];
      const robotIds = [...t.robots.keys()];
      if (adapterIds.length) {
        const as = await d.select({ m: deviceAdapters.machineId }).from(deviceAdapters).where(inArray(deviceAdapters.id, adapterIds));
        machineIds.push(...uniq(as.map((a) => a.m)));
      }
      const lineIds: number[] = [];
      const stationIds: number[] = [];
      if (robotIds.length) {
        const rs = await d.select({ l: robots.lineId, s: robots.stationId }).from(robots).where(inArray(robots.id, robotIds));
        lineIds.push(...uniq(rs.map((x) => x.l)));
        stationIds.push(...uniq(rs.map((x) => x.s)));
      }
      return factoriesOf(d, { machineIds, lineIds, stationIds });
    }
  }
}

/** Người dùng (`users` của truy vấn ngoài) CÙNG ít nhất một nhà máy trong `factoryIds`; vai admin luôn qua. */
export function userSharesFactorySql(factoryIds: number[]): SQL {
  const ids = uniq(factoryIds);
  if (ids.length === 0) return sql`${users.role} = 'admin'`;
  const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  return sql`(${users.role} = 'admin'
    OR EXISTS (SELECT 1 FROM ${userFactoryAssignments} ufa JOIN ${factories} f ON f.code = ufa."factoryCode"
               WHERE ufa."userId" = ${users.id} AND f.id IN (${list}))
    OR EXISTS (SELECT 1 FROM ${userCorporateAssignments} uca JOIN ${factories} f ON f."corporateCode" = uca."corporateCode"
               WHERE uca."userId" = ${users.id} AND f.id IN (${list})))`;
}

/**
 * Mệnh đề lọc roster / người được giao cho người gọi `ctx`. `undefined` = không lọc (người gọi toàn quyền — admin không đổi).
 * `entityId` = mục ĐÃ qua kiểm phạm vi của người gọi (run ngoài phạm vi ⇒ người gọi truyền undefined).
 * Lỗi tra phạm vi ⇒ ném (yêu cầu thất bại, không bao giờ rơi về "không lọc").
 */
export async function rosterFactoryFilter(
  d: DbOrTx,
  ctx: CoDanhTinh & { user: { id: number; role: string } },
  type: AssignableEntityType,
  entityId: number | undefined,
): Promise<SQL | undefined> {
  const assigner = await idsTrongPhamVi("factory", phamViCua(ctx));
  if (assigner === null) return undefined;
  const target = entityId != null ? await targetFactoryIds(d, type, entityId) : [];
  return userSharesFactorySql(target.length ? target : assigner);
}
