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
 *
 * Fix round 1 (review I1 + ruling R-5-m + M4):
 *   • R-5-m — MỤC phải trong phạm vi NGƯỜI GIAO, nếu không ⇒ NOT_FOUND Y HỆT mục không tồn tại (`resolveTargetForAssigner`):
 *     mọi nhà máy của mục ⊆ nhà máy của người giao (mục không có nhà máy ⇒ trong phạm vi; admin ⇒ mọi mục). Run: luật
 *     của chính E (`runIdVisibleTo` ở router). Id không tồn tại ⇒ NOT_FOUND ở CẢ roster lẫn `assign` (trước: assigneeInvalid).
 *   • I1 — MỘT luật người được giao cho roster VÀ `assign` (`assigneeRuleSql`). Run: người được giao phải XEM được run =
 *     MỌI đích KHÔNG-DỪNG trong phạm vi của họ — đúng luật `definitionVisibleTo` của E (máy → nhà máy của máy; adapter →
 *     máy của adapter; robot → nhà máy của chuyền HOẶC trạm; đích không ra nhà máy nào ⇒ chỉ admin; định nghĩa thiếu ⇒ chỉ
 *     admin), dựng thành SQL một lượt cho cả danh sách; DỪNG phân loại bằng chính `verifiedStopStepIds` (R-5-j). Áp cho
 *     MỌI người gọi (cũng là luật `assign` của E). Lưới `engineeringAssignment.db.test.ts` §12 đo SQL này == `runIdVisibleTo`.
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
import { verifiedStopStepIds } from "../orchestration/foe/foeStepClass";
import { validateWorkflow, type MachineForValidation, type WorkflowDefinition } from "../orchestration/foe/workflowModel";
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

/** Nhà máy của MỤC. `null` = mục KHÔNG TỒN TẠI; [] = tồn tại nhưng không liên kết nhà máy nào. */
export async function targetFactoryIds(d: DbOrTx, type: AssignableEntityType, entityId: number): Promise<number[] | null> {
  switch (type) {
    case "ecn": {
      const [r] = await d.select({ f: engineeringChanges.factoryId }).from(engineeringChanges).where(eq(engineeringChanges.id, entityId)).limit(1);
      return r ? uniq([r.f]) : null;
    }
    case "recipe": {
      const [r] = await d.select({ m: machineRecipes.machineId }).from(machineRecipes).where(eq(machineRecipes.id, entityId)).limit(1);
      return r ? factoriesOf(d, { machineIds: uniq([r.m]) }) : null;
    }
    case "interlock_rule": {
      const [r] = await d
        .select({ m: interlockRules.machineId, tm: interlockRules.targetMachineId, l: interlockRules.lineId, s: interlockRules.stationId })
        .from(interlockRules).where(eq(interlockRules.id, entityId)).limit(1);
      return r ? factoriesOf(d, { machineIds: uniq([r.m, r.tm]), lineIds: uniq([r.l]), stationIds: uniq([r.s]) }) : null;
    }
    case "changeover": {
      const [r] = await d.select({ m: changeoverRequests.machineId }).from(changeoverRequests).where(eq(changeoverRequests.id, entityId)).limit(1);
      return r ? factoriesOf(d, { machineIds: uniq([r.m]) }) : null;
    }
    case "orchestration_run": {
      const [r] = await d
        .select({ def: orchestrationWorkflows.definitionJson })
        .from(orchestrationRuns)
        .innerJoin(orchestrationWorkflows, eq(orchestrationWorkflows.id, orchestrationRuns.workflowId))
        .where(eq(orchestrationRuns.id, entityId)).limit(1);
      if (!r) return null;
      const def = r.def as WorkflowDefinition | undefined;
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

type Caller = CoDanhTinh & { user: { id: number; role: string } };

/** Nhà máy trong phạm vi NGƯỜI GIAO (`null` = toàn quyền — admin). Lỗi tra ⇒ ném (yêu cầu thất bại, fail-closed). */
export async function assignerFactoryIds(ctx: Caller): Promise<number[] | null> {
  return idsTrongPhamVi("factory", phamViCua(ctx));
}

/**
 * R-5-m — mục như NGƯỜI GIAO được thấy nó: `null` ⇒ NOT_FOUND (không tồn tại HOẶC ngoài phạm vi — cùng một câu trả lời).
 * Run: router đã kiểm `runIdVisibleTo(…, foeScopeOf(ctx.user))` (luật của E, census đo ở router); ở đây chỉ còn tồn tại.
 */
export async function resolveTargetForAssigner(
  d: DbOrTx,
  ctx: Caller,
  type: AssignableEntityType,
  entityId: number,
): Promise<{ factories: number[] } | null> {
  const factoryIds = await targetFactoryIds(d, type, entityId);
  if (factoryIds === null) return null;
  if (type === "orchestration_run") return { factories: factoryIds };
  const assigner = await assignerFactoryIds(ctx);
  if (assigner !== null && !factoryIds.every((f) => assigner.includes(f))) return null;
  return { factories: factoryIds };
}

/** Nhà máy thoả MỘT đích không-DỪNG của run (máy / adapter / robot) — tập rỗng ⇒ không phạm vi nhà máy nào chứa được nó. */
async function runTargetFactorySets(d: DbOrTx, def: WorkflowDefinition): Promise<number[][]> {
  const referenced = validateWorkflow(def, null).referencedMachineIds;
  const machineMap = new Map<number, MachineForValidation>();
  if (referenced.length) {
    const ms = await d
      .select({ id: machines.id, machineType: machines.machineType, capabilities: machines.capabilities })
      .from(machines)
      .where(inArray(machines.id, referenced));
    for (const m of ms) machineMap.set(m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities } as MachineForValidation);
  }
  const stops = await verifiedStopStepIds(def, machineMap, d);
  const t = collectTargets(def, machineMap, stops.ids);
  const nonStop = (m: Map<number, boolean>) => [...m.entries()].filter(([, ns]) => ns).map(([id]) => id);
  const sets: number[][] = [];
  for (const id of nonStop(t.machines)) sets.push(await factoriesOf(d, { machineIds: [id] }));
  for (const id of nonStop(t.adapters)) {
    const [a] = await d.select({ m: deviceAdapters.machineId }).from(deviceAdapters).where(eq(deviceAdapters.id, id)).limit(1);
    sets.push(a && posInt(a.m) ? await factoriesOf(d, { machineIds: [a.m] }) : []);
  }
  for (const id of nonStop(t.robots)) {
    const [r] = await d.select({ l: robots.lineId, s: robots.stationId }).from(robots).where(eq(robots.id, id)).limit(1);
    const viaLine = r && posInt(r.l) ? await factoriesOf(d, { lineIds: [r.l] }) : [];
    const viaStation = r && posInt(r.s) ? await factoriesOf(d, { stationIds: [r.s] }) : [];
    sets.push(uniq([...viaLine, ...viaStation]));
  }
  return sets;
}

/**
 * I1 — người được giao XEM được run (luật `definitionVisibleTo` của E): với MỌI đích không-DỪNG, có ít nhất một nhà máy
 * thoả đích đó trong phạm vi của họ; admin luôn qua. Run / định nghĩa thiếu ⇒ chỉ admin.
 */
export async function runAssigneeVisibilitySql(d: DbOrTx, runId: number): Promise<SQL> {
  const [r] = await d
    .select({ def: orchestrationWorkflows.definitionJson })
    .from(orchestrationRuns)
    .innerJoin(orchestrationWorkflows, eq(orchestrationWorkflows.id, orchestrationRuns.workflowId))
    .where(eq(orchestrationRuns.id, runId))
    .limit(1);
  const def = r?.def as WorkflowDefinition | undefined;
  if (!def || !Array.isArray(def.steps)) return sql`${users.role} = 'admin'`;
  const sets = await runTargetFactorySets(d, def);
  const seen = new Set<string>();
  const parts: SQL[] = [];
  for (const set of sets) {
    const key = [...set].sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(userSharesFactorySql(set));
  }
  return parts.length ? sql`(${sql.join(parts, sql` AND `)})` : sql`TRUE`;
}

/**
 * MỘT luật người được giao — roster (`assignableUsers`) và `assign` gọi CÙNG hàm này. `undefined` = không lọc.
 *   • luật nhà máy (H5): người gọi không phải admin ⇒ cùng ≥1 nhà máy với mục (mục không có nhà máy / không gửi mục ⇒ với
 *     người giao);
 *   • run (I1): VÀ người được giao xem được run (mọi người gọi, kể cả admin — cũng là luật `assign` của E).
 * `targetFactories` = kết quả `resolveTargetForAssigner` (mục đã qua kiểm phạm vi), `undefined` khi không gửi mục.
 */
export async function assigneeRuleSql(
  d: DbOrTx,
  ctx: Caller,
  type: AssignableEntityType,
  entityId: number | undefined,
  targetFactories: number[] | undefined,
): Promise<SQL | undefined> {
  const parts: SQL[] = [];
  const assigner = await assignerFactoryIds(ctx);
  if (assigner !== null) parts.push(userSharesFactorySql(targetFactories?.length ? targetFactories : assigner));
  if (type === "orchestration_run" && entityId != null) parts.push(await runAssigneeVisibilitySql(d, entityId));
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : sql`(${sql.join(parts, sql` AND `)})`;
}
