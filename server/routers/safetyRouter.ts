/**
 * S1 (doc 16 §8 / §15 S1) — SAFETY + WORKFORCE router.
 * Flags: SAFETY_AUDIT_ENABLED, WORKFORCE_ENABLED, ANDON_ROBOT_DISPATCH_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the S1 software-only slice of Khối 3:
 *   • safety_events feed + near-miss trend + near-miss ingest (advisory)
 *   • collaboration (human↔robot handover) sessions
 *   • mixed-workforce operator assignments + the current board
 *
 * ⚠ CRITICAL HONESTY / SAFETY: NOTHING here is safety-rated. The safety feed is an
 *   ADVISORY monitoring/logging record; near-miss ingest raises a yellow Andon +
 *   logs + (at most) PROPOSES a speed reduction via the EXISTING gate — it NEVER
 *   auto-executes a device command. The software performs NO SIL stop and gives NO
 *   sub-second guarantee; a hardware-rated stop is deferred to S2.
 *
 * RBAC (module-level, mirrors fleetRouter; no dedicated 'safety' perm exists):
 *   • read  ops → machine_monitoring / canView
 *   • mutations → machine_control   / canCreate  (+ the relevant flag)
 * ctx.user is the source of truth — never the request body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { eq, desc, isNull, and, or, inArray, asc, sql, type SQL } from "drizzle-orm";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_OT_CONTROL (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { collaborationSessions, operatorAssignments, shiftConfigs, factories, workshops, productionLines, stations, users } from "../../drizzle/schema";
import { idsTrongPhamVi } from "../db/hierarchy";
import { isValidTimeZone } from "../utils/factoryTime";
import {
  safetyAuditEnabled,
  record as recordSafetyEvent,
  queryFeed,
  nearMissTrend,
  auditEvent,
} from "../services/safety/safetyAuditService";
import { processDetection } from "../services/safety/nearMissAdvisor";
import {
  safetyZoneSwEnabled,
  listZones,
  createZone,
  updateZone,
  evaluateAndRecord,
  evaluateFromProximity,
} from "../services/safety/safetyZoneService";
import { workforceEnabled, assignOperator, reassignOperator, confirmAssignment, closeAssignment, getCurrentBoard } from "../services/workforce/workforceService";
import { startCollaboration, signalHandshake, advancePhase, abortCollaboration } from "../services/workforce/collaborationService";
// S2b — vision human-detection producer + safety-PLC status adapter (advisory).
import {
  safetyVisionEnabled,
  listCalibrations,
  upsertCalibration,
  produce,
} from "../services/safety/vision/humanDetectionProducer";
import type { PersonDetection } from "../services/safety/vision/humanDetectionProducer";
import {
  safetyPlcAdapterEnabled,
  listPlcConfigs,
  upsertPlcConfig,
  readConfigById,
  SimSafetyPlcBackend,
} from "../services/safety/plc/safetyPlcAdapter";
// doc 80 Đợt 1 Task 4 (SAF-02) — read-only source-health report for the Safety page.
import { loadSafetySourceHealth } from "../services/safety/safetySourceHealth";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";
import { resolveTenantFactoryScope } from "../db/reportAggregators";
import { deviceAdapters, robots } from "../../drizzle/schema";

/**
 * doc 81 Đợt 4 fix round 1 (security scan on 7a0dd5632) — every id of a `safety.sourceHealth` target must resolve
 * SERVER-SIDE into the caller's scope: adapter ⇒ its machine, machine ⇒ itself, robot ⇒ its station's line and its
 * line (each that is set; an unplaced robot has nothing in scope). Out of scope, nonexistent, or not attributable ⇒ ONE
 * NOT_FOUND (same code, key, params and message for every case). Every supplied id is always looked up — no early
 * exit — so the work done does not depend on which check fails. Full scope (admin) ⇒ no check.
 */
async function assertSourceHealthTargetInScope(
  ctx: CoDanhTinh,
  t: { adapterId?: number; machineId?: number; robotId?: number },
): Promise<void> {
  const scope = phamViCua(ctx);
  const [machineIds, lineIds] = await Promise.all([idsTrongPhamVi("machine", scope), idsTrongPhamVi("line", scope)]);
  if (machineIds === null && lineIds === null) return;
  const inList = (ids: number[] | null, id: number | null | undefined) => id != null && (ids === null || ids.includes(id));
  const d = await getDb();
  let ok = d != null;
  if (t.adapterId != null && t.adapterId > 0) {
    const [a] = d ? await d.select({ m: deviceAdapters.machineId }).from(deviceAdapters).where(eq(deviceAdapters.id, t.adapterId)).limit(1) : [];
    ok = inList(machineIds, a?.m ?? null) && ok;
  }
  if (t.machineId != null) ok = inList(machineIds, t.machineId) && ok;
  if (t.robotId != null) {
    const [r] = d
      ? await d
          .select({ lineId: robots.lineId, stationLine: stations.lineId })
          .from(robots)
          .leftJoin(stations, eq(stations.id, robots.stationId))
          .where(eq(robots.id, t.robotId))
          .limit(1)
      : [];
    const lines = [r?.lineId ?? null, r?.stationLine ?? null].filter((x): x is number => x != null);
    ok = lines.length > 0 && lines.every((l) => inList(lineIds, l)) && ok;
  }
  if (!ok) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Safety target not found");
}

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

type FactoryScope = number[] | null;

/** Phạm vi nhà máy của người gọi (`null` = không lọc: admin / vai toàn quyền). */
async function callerFactoryScope(ctx: CoDanhTinh): Promise<FactoryScope> {
  return (await resolveTenantFactoryScope(phamViCua(ctx))).factoryIds;
}
const inFactoryScope = (scope: FactoryScope, factoryId: number): boolean => scope === null || scope.includes(factoryId);

/**
 * doc 81 Đợt 3b final wave (post-review, chủ dự án duyệt) — MỘT luật "nhà máy của phân công" cho CẢ đọc (lọc hàng, soát hàng
 * đích) lẫn ghi (kiểm ca ⇄ nhà máy, đóng dấu `factoryId`): CHUYỀN (`production_lines` → `workshops.factoryId`) › TRẠM
 * (`stations` → chuyền → xưởng) › cột/ô `factoryId`. Vị trí VẬT LÝ là sự thật; cột `factoryId` chỉ là dự phòng khi không có
 * chuyền/trạm (hay id của chúng không còn). Trước: đọc = factoryId › chuyền › trạm, ghi = chuyền › trạm › factoryId ⇒ hàng cũ có
 * factoryId lệch chuyền bị xếp nhà máy khác nhau giữa đọc và ghi. NULL = mồ côi (không bậc nào ra).
 */
function assignmentFactorySql(line: SQL | typeof operatorAssignments.lineId, station: SQL | typeof operatorAssignments.stationId, factory: SQL | typeof operatorAssignments.factoryId): SQL {
  return sql`COALESCE(
  (SELECT w."factoryId" FROM production_lines l JOIN workshops w ON w."id" = l."workshopId" WHERE l."id" = ${line}),
  (SELECT w."factoryId" FROM stations s JOIN production_lines l ON l."id" = s."lineId" JOIN workshops w ON w."id" = l."workshopId"
    WHERE s."id" = ${station}),
  ${factory}
)`;
}
/** Nhà máy của một HÀNG phân công (luật ở trên, trên chính các cột của hàng). */
const ASSIGNMENT_FACTORY_SQL = assignmentFactorySql(operatorAssignments.lineId, operatorAssignments.stationId, operatorAssignments.factoryId);

/**
 * Nhà máy của một phân công SẮP ghi (input) — CÙNG `assignmentFactorySql`. Gọi SAU `assertAssignmentInputsInScope` (với
 * người bị thu hẹp mọi id đã TRONG phạm vi). `assignableShifts` (chỉ đọc, không soát input) tự bỏ chuyền/trạm ngoài phạm vi
 * trước khi gọi — ngoài phạm vi ≡ không tồn tại.
 */
async function assignmentFactoryId(input: { lineId?: number | null; stationId?: number | null; factoryId?: number | null }): Promise<number | null> {
  const d = await db();
  const p = (v: number | null | undefined) => sql`${v ?? null}::int`;
  const [r] = (await d.execute(sql`SELECT ${assignmentFactorySql(p(input.lineId), p(input.stationId), p(input.factoryId))} AS "f"`)) as unknown as Array<{ f: number | string | null }>;
  return r?.f == null ? null : Number(r.f);
}

/**
 * doc 81 Đợt 3b final wave (rà soát bảo mật) — nhà máy GHI vào hàng phân công mới: `assignmentFactoryId` (CÙNG luật đọc) ›
 * phạm vi người gọi đúng MỘT nhà máy ⇒ nhà máy đó › `null` (người không lọc — admin — thấy mọi hàng). Nhờ vậy người bị thu
 * hẹp thấy lại được chính phân công mình vừa tạo khi `listAssignments` lọc theo phạm vi.
 */
async function stampAssignmentFactory(
  input: { lineId?: number | null; stationId?: number | null; factoryId?: number | null },
  scope: FactoryScope,
): Promise<number | null> {
  const fac = await assignmentFactoryId(input);
  if (fac != null) return fac;
  if (scope !== null && scope.length === 1) return scope[0];
  // post-review (3): phạm vi NHIỀU nhà máy mà không chỉ ra nhà máy (chuyền / trạm / factoryId) ⇒ hàng tạo ra mồ côi, chính người
  // tạo cũng không thấy lại (lọc phạm vi loại hàng mồ côi) ⇒ đòi nhà máy, TRƯỚC khi ghi gì.
  if (scope !== null && scope.length > 1) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "factoryId", reason: "factoryRequired" }, "Pick a factory, line or station for this assignment");
  }
  return null;
}

function assignmentScopeCond(scope: FactoryScope): SQL | undefined {
  if (scope === null) return undefined;
  if (scope.length === 0) return sql`false`;
  return inArray(ASSIGNMENT_FACTORY_SQL, scope);
}
/** Phân công `id` tồn tại VÀ trong phạm vi người gọi (ngoài phạm vi ≡ không tồn tại). */
async function assignmentVisible(id: number, scope: FactoryScope): Promise<boolean> {
  const d = await db();
  const cond = assignmentScopeCond(scope);
  const rows = await d
    .select({ id: operatorAssignments.id })
    .from(operatorAssignments)
    .where(cond ? and(eq(operatorAssignments.id, id), cond) : eq(operatorAssignments.id, id))
    .limit(1);
  return rows.length > 0;
}

/**
 * doc 81 Đợt 3b final wave (rà soát bảo mật — vượt phạm vi khi GHI). Trước: `assignOperator`/`reassignOperator` ghi BẤT KỲ id
 * người vận hành / chuyền / trạm / nhà máy (bảng không FK, không kiểm phạm vi) ⇒ người nhà máy A tạo/chuyển được phân công
 * lên nhân sự, chuyền, trạm của nhà máy B. Nay mỗi id phải TỒN TẠI và TRONG PHẠM VI người gọi; ngoài phạm vi ⇒ CÙNG lỗi như id
 * không tồn tại (ENTITY_NOT_FOUND cùng `entity`, câu KHÔNG vọng id). Dùng helper phạm vi CHUNG: `idsTrongPhamVi` (chuyền/trạm,
 * cùng safetySourceHealth / mqtt) và `resolveTenantFactoryScope` (nhà máy; người vận hành = phạm vi của CHÍNH người đó giao với
 * phạm vi người gọi — người không lọc như admin được coi là toàn hệ thống). Người gọi không lọc (admin) ⇒ chỉ đòi TỒN TẠI.
 */
async function assertAssignmentInputsInScope(
  input: { operatorId: number; lineId?: number | null; stationId?: number | null; factoryId?: number | null },
  ctx: CoDanhTinh,
  scope: FactoryScope,
): Promise<void> {
  const d = await db();
  // Mã lỗi viết LITERAL từng chỗ (appErrorParamsCoverage đọc được `entity` — không đi qua biến).
  const [op] = await d
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, input.operatorId))
    .limit(1);
  let opOk = !!op && op.isActive;
  if (opOk && scope !== null) {
    const opScope = (await resolveTenantFactoryScope({ userId: op!.id, userRole: op!.role })).factoryIds;
    opOk = opScope === null || opScope.some((f) => scope.includes(f));
  }
  if (!opOk) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, "Operator not found");
  for (const [cap, id] of [
    ["line", input.lineId],
    ["station", input.stationId],
  ] as const) {
    if (id == null) continue;
    let ok: boolean;
    if (scope === null) {
      const t = cap === "line" ? productionLines : stations;
      ok = (await d.select({ id: t.id }).from(t).where(eq(t.id, id)).limit(1)).length > 0;
    } else {
      ok = ((await idsTrongPhamVi(cap, phamViCua(ctx))) ?? []).includes(id);
    }
    if (!ok && cap === "line") throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "line" }, "Line not found");
    if (!ok) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "station" }, "Station not found");
  }
  if (input.factoryId != null) {
    const ok =
      scope === null
        ? (await d.select({ id: factories.id }).from(factories).where(eq(factories.id, input.factoryId)).limit(1)).length > 0
        : scope.includes(input.factoryId);
    if (!ok) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "factory" }, "Factory not found");
  }
}

/**
 * doc 81 Đợt 3b Task 1 (doc 81 §12 "Đã chốt 2026-10-06") — ca gắn vào phân công (`shiftConfigId`, TUỲ CHỌN) phải:
 *   1. TỒN TẠI trong `shift_configs`;
 *   2. nằm TRONG PHẠM VI người gọi — ca toàn hệ thống (`factoryId IS NULL`, như `getShiftConfigs`) thuộc mọi phạm vi; ca của
 *      một nhà máy chỉ khi nhà máy đó thuộc `resolveTenantFactoryScope(phamViCua(ctx))` (admin/không lọc ⇒ `null` ⇒ mọi ca).
 *      Ngoài phạm vi ⇒ CÙNG lỗi như id không tồn tại (không lộ sự tồn tại của ca nhà máy khác);
 *   3. (final wave I2) ca của MỘT nhà máy chỉ khi phân công thuộc CÙNG nhà máy (`assignmentFactoryId`: chuyền › trạm ›
 *      `factoryId`, chỉ bậc TRONG phạm vi; không rõ ⇒ không kiểm) ⇒ INVALID_VALUE `shiftFactoryMismatch`. Kiểm sau (2);
 *      câu lỗi KHÔNG vọng id nhà máy nào;
 *   4. ĐANG HOẠT ĐỘNG (`isActive`).
 * Bỏ ca ⇒ không kiểm gì, hành vi y như trước. Gọi SAU cổng cờ nhân lực (thứ tự cổng cũ không đổi) và TRƯỚC khi ghi (phân
 * công lại với ca sai không huỷ phân công cũ).
 */
async function assertAssignableShift(
  shiftConfigId: number | null | undefined,
  scope: FactoryScope,
  target: { lineId?: number | null; stationId?: number | null; factoryId?: number | null } = {},
): Promise<void> {
  if (shiftConfigId == null) return;
  const d = await db();
  const [ca] = await d
    .select({ id: shiftConfigs.id, factoryId: shiftConfigs.factoryId, isActive: shiftConfigs.isActive })
    .from(shiftConfigs)
    .where(eq(shiftConfigs.id, shiftConfigId))
    .limit(1);
  const inScope = !!ca && (ca.factoryId == null || inFactoryScope(scope, ca.factoryId));
  if (!ca || !inScope) {
    throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "shiftConfig" }, `Shift ${shiftConfigId} not found`);
  }
  if (ca.factoryId != null) {
    const fac = await assignmentFactoryId(target);
    if (fac != null && fac !== ca.factoryId) {
      throw appError(
        "BAD_REQUEST",
        "INVALID_VALUE",
        { field: "shiftConfigId", reason: "shiftFactoryMismatch" },
        "The shift belongs to a different factory than the assignment",
      );
    }
  }
  if (!ca.isActive) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "shiftConfigId", reason: "shiftInactive" },
      `Shift ${shiftConfigId} is inactive`,
    );
  }
}

function requireSafetyFlag() {
  if (!safetyAuditEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "safetyAudit" }, "Safety audit disabled (set SAFETY_AUDIT_ENABLED=true) — ADVISORY only, not safety-rated");
  }
}
function requireWorkforceFlag() {
  if (!workforceEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "workforce" }, "Workforce disabled (set WORKFORCE_ENABLED=true)");
  }
}
function requireSafetyZoneFlag() {
  if (!safetyZoneSwEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "safetyZones" }, "Safety zones disabled (set SAFETY_ZONE_SW_ENABLED=true) — ADVISORY only, not SIL");
  }
}
function requireSafetyVisionFlag() {
  if (!safetyVisionEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "safetyVision" }, "Safety vision disabled (set SAFETY_VISION_ENABLED=true) — ADVISORY only, not SIL; needs a real camera + calibration + exported ONNX model");
  }
}
function requireSafetyPlcFlag() {
  if (!safetyPlcAdapterEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "safetyPlcAdapter" }, "Safety-PLC adapter disabled (set SAFETY_PLC_ADAPTER_ENABLED=true) — READ-ONLY monitoring; the certified Safety PLC performs the rated stop itself");
  }
}

// S2a geometry input: an AABB and/or a polygon (advisory, mm). Both optional.
const zoneGeometrySchema = z
  .object({
    aabb: z
      .object({
        min: z.object({ x: z.number(), y: z.number(), z: z.number().optional() }),
        max: z.object({ x: z.number(), y: z.number(), z: z.number().optional() }),
      })
      .optional(),
    polygon: z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(3) }).optional(),
  })
  .optional();

// Simulated human/robot tracks for the evaluator (no real UWB/LiDAR — testing input).
const simHumanSchema = z.object({
  id: z.union([z.string(), z.number()]),
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
  confidence: z.number().min(0).max(1).default(1),
});
const simRobotSchema = z.object({
  id: z.union([z.string(), z.number()]),
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
});

const EVENT_TYPES = ["estop", "collision", "intrusion", "zone_intrusion", "force_limit", "speed_violation", "near_miss"] as const;

// S2b — a pixel-space person detection bbox (from any detector / test).
const personDetectionSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  confidence: z.number().min(0).max(1),
  id: z.union([z.string(), z.number()]).optional(),
});

// S2b — a precomputed 3×3 homography (9 numbers, row-major).
const homographySchema = z.array(z.number()).length(9);
// S2b — an image↔floor correspondence pair (to solve a homography from ≥4).
const calibrationPairSchema = z.object({
  image: z.object({ u: z.number(), v: z.number() }),
  floor: z.object({ x: z.number(), y: z.number() }),
});

// S2b — a safety-PLC status snapshot (sim-injected, for testing).
const plcStatusSnapshotSchema = z.object({
  estop: z.boolean().optional(),
  zoneOccupied: z.boolean().optional(),
  resetRequired: z.boolean().optional(),
  muting: z.boolean().optional(),
});

export const safetyRouter = router({
  // ── status (UI gating hints) ───────────────────────────────────────────────
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      safetyAudit: safetyAuditEnabled(),
      workforce: workforceEnabled(),
      safetyZoneSw: safetyZoneSwEnabled(), // S2a — advisory 3-level zone evaluator
      safetyVision: safetyVisionEnabled(), // S2b — vision human-detection producer
      safetyPlcAdapter: safetyPlcAdapterEnabled(), // S2b — read-only safety-PLC adapter
      advisory: true, // explicit: this subsystem is advisory, not safety-rated
    })),

  /**
   * doc 80 Đợt 1 Task 4 (SAF-02) — READ-ONLY health of every safety source the page relies on:
   * Safety PLC (real vs SIM backend from safety_plc_configs, and what that means for the OT/robot
   * safety preflight), vision, zone SW, e-stop adapter and the socket server. Never reads a PLC
   * backend, never writes. PLC config codes are shown only inside the viewer's factory scope;
   * the preflight basis counts are system-wide (the preflight reads every enabled config).
   */
  // doc 81 Đợt 4 fix round 1 (finding 8, R-4-d) — optional command target: the panel then predicts with the gate's own
  // resolver + matcher (written adapter's machine ∪ machine ∪ robot). No input ⇒ unchanged (every config).
  sourceHealth: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          target: z
            .object({
              adapterId: z.number().int().optional(),
              machineId: z.number().int().positive().optional(),
              robotId: z.number().int().positive().optional(),
            })
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      // fix round 1 (security scan on 7a0dd5632) — a supplied target must be in the caller's scope, else the panel is a
      // cross-tenant oracle (would the gate block? which PLCs are offline?). No target ⇒ unchanged.
      if (input?.target) await assertSourceHealthTargetInScope(ctx, input.target);
      return loadSafetySourceHealth(phamViCua(ctx), input?.target);
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // SAFETY EVENTS (S1-b) — feed/trend (read) + ingest/audit (mutations)
  // ══════════════════════════════════════════════════════════════════════════
  feed: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          eventType: z.enum(EVENT_TYPES).optional(),
          robotId: z.number().int().positive().optional(),
          isNearMiss: z.boolean().optional(),
          sinceHours: z.number().int().min(1).max(24 * 90).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => queryFeed(input ?? {})),

  nearMissTrend: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ sinceDays: z.number().int().min(1).max(365).default(30) }).optional())
    .query(async ({ input }) => nearMissTrend(input?.sinceDays ?? 30)),

  /** Manually record an advisory safety event (flag-gated). */
  recordEvent: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        eventType: z.enum(EVENT_TYPES),
        robotId: z.number().int().positive().optional(),
        deviceId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        responseTimeMs: z.number().int().min(0).optional(),
        detectedBy: z.enum(["vision", "interlock", "operator", "telemetry", "plc", "sim"]).optional(),
        outcome: z.enum(["stopped", "reduced_speed", "manual_override", "logged_only"]).optional(),
        isNearMiss: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyFlag();
      // operator-recorded events default handledBy=operator (honest provenance).
      return recordSafetyEvent({ ...input, handledBy: "operator" });
    }),

  /** Stamp a human PDCA audit (who reviewed the event). */
  auditEvent: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ eventId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireSafetyFlag();
      const row = await auditEvent(input.eventId, ctx.user.id);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "safetyEvent" }, `Safety event ${input.eventId} not found`);
      return row;
    }),

  /**
   * Ingest an ADVISORY human-proximity detection (S1-d). Below the configured margin
   * → records a near_miss + raises a YELLOW Andon + attaches a speed-reduction
   * PROPOSAL (never auto-executes). Provenance limited to vision/manual/test — the
   * server does NOT fabricate a tracker.
   */
  ingestProximity: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        deviceId: z.number().int().positive().optional(),
        robotId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        distance: z.number().min(0),
        confidence: z.number().min(0).max(1),
        source: z.enum(["vision", "manual", "test"]).default("vision"),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyFlag();
      // S1 near-miss advisory (unchanged behaviour).
      const nearMiss = await processDetection(input);
      // S2a (ADDITIVE) — when SAFETY_ZONE_SW_ENABLED, ALSO drive the zone evaluator
      // off this same proximity detection (3-level reaction). null when the flag is
      // off → response shape is stable; S1 behaviour is never weakened.
      const zone = await evaluateFromProximity(input);
      return { ...nearMiss, zone };
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // SAFETY ZONES (S2a) — zones + 3-level intrusion evaluator (ADVISORY, flag-gated)
  // ⚠ These DETECT/LOG/PROPOSE. rated_stop is LOGGED only — a certified Safety PLC
  //    must perform the actual rated stop (S2 hardware). Software never actuates.
  // ══════════════════════════════════════════════════════════════════════════
  zoneStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ safetyZoneSw: safetyZoneSwEnabled(), advisory: true, ratedStopIsHardware: true })),

  listZones: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          robotId: z.number().int().positive().optional(),
          stationId: z.number().int().positive().optional(),
          lineId: z.number().int().positive().optional(),
          onlyEnabled: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listZones(input ?? {})),

  /** Evaluate a given/simulated human+robot set against zones → 3-level reactions. */
  evaluateZones: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        humans: z.array(simHumanSchema).max(200),
        robots: z.array(simRobotSchema).min(1).max(200),
        filter: z
          .object({
            robotId: z.number().int().positive().optional(),
            stationId: z.number().int().positive().optional(),
            lineId: z.number().int().positive().optional(),
          })
          .optional(),
        minConfidence: z.number().min(0).max(1).optional(),
      }),
    )
    .query(async ({ input }) => {
      requireSafetyZoneFlag();
      // READ-shaped evaluation. Recording is gated by SAFETY_AUDIT_ENABLED inside the
      // service; when audit is off it returns reactions without persisting.
      return evaluateAndRecord({ ...input, source: "sim" });
    }),

  /** Ingest a SIMULATED human track for testing → evaluate + record advisory events. */
  ingestSimulatedHuman: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        humans: z.array(simHumanSchema).max(200),
        robots: z.array(simRobotSchema).min(1).max(200),
        filter: z
          .object({
            robotId: z.number().int().positive().optional(),
            stationId: z.number().int().positive().optional(),
            lineId: z.number().int().positive().optional(),
          })
          .optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyZoneFlag();
      return evaluateAndRecord({ ...input, source: "sim" });
    }),

  createZone: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        robotId: z.number().int().positive().optional(),
        deviceId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        geometry: zoneGeometrySchema,
        speedReduceDistanceMm: z.number().int().positive().optional(),
        stopDistanceMm: z.number().int().positive().optional(),
        ratedStopDistanceMm: z.number().int().positive().optional(),
        reactionSpeedPct: z.number().int().min(0).max(100).optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyZoneFlag();
      const r = await createZone(input);
      if (!r.ok && r.enabled) throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "createSafetyZone" }, r.message ?? "invalid safety zone");
      return r;
    }),

  updateZone: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(64).optional(),
        name: z.string().min(1).max(255).optional(),
        robotId: z.number().int().positive().nullable().optional(),
        deviceId: z.number().int().positive().nullable().optional(),
        stationId: z.number().int().positive().nullable().optional(),
        lineId: z.number().int().positive().nullable().optional(),
        geometry: zoneGeometrySchema,
        speedReduceDistanceMm: z.number().int().positive().optional(),
        stopDistanceMm: z.number().int().positive().optional(),
        ratedStopDistanceMm: z.number().int().positive().optional(),
        reactionSpeedPct: z.number().int().min(0).max(100).optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyZoneFlag();
      const r = await updateZone(input);
      if (!r.ok && r.enabled) throw appError(r.message?.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST", "OPERATION_FAILED", { operation: "updateSafetyZone" }, r.message ?? "update failed");
      return r;
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // S2b — VISION HUMAN-DETECTION PRODUCER (advisory, flag SAFETY_VISION_ENABLED)
  // ⚠ Turns pixel person-detections + a per-camera homography into FLOOR positions
  //    → drives the S2a evaluator. NEVER fabricates a detection: no backend / no
  //    calibration ⇒ produces NOTHING. yolo26n.pt is PyTorch → needs a one-time
  //    ONNX export before the ONNX hook can run. ADVISORY, never a rated stop.
  // ══════════════════════════════════════════════════════════════════════════
  visionStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      safetyVision: safetyVisionEnabled(),
      advisory: true,
      // honest: the model inference is a documented seam until yolo26n.pt→.onnx export.
      onnxPersonModelWired: false,
      note: "ADVISORY. Needs a real camera + per-camera homography calibration + an exported ONNX person model (yolo26n.pt is PyTorch — export to .onnx once). No fabricated detections.",
    })),

  /** List camera calibrations (read — always allowed). */
  listCameraCalibrations: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          cameraId: z.string().max(128).optional(),
          safetyZoneId: z.number().int().positive().optional(),
          robotId: z.number().int().positive().optional(),
          onlyEnabled: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listCalibrations(input ?? {})),

  /**
   * Upsert a camera calibration (flag-gated). Provide a precomputed homography (9
   * numbers) OR ≥4 image↔floor pairs to SOLVE it from. Returns the mean reprojection
   * residual (mm) as a calibration-quality honesty metric.
   */
  upsertCameraCalibration: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        cameraId: z.string().min(1).max(128),
        name: z.string().max(255).optional(),
        homography: homographySchema.optional(),
        pairs: z.array(calibrationPairSchema).min(4).optional(),
        safetyZoneId: z.number().int().positive().optional(),
        robotId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        imageWidth: z.number().int().positive().optional(),
        imageHeight: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyVisionFlag();
      const r = await upsertCalibration({
        ...input,
        homography: input.homography as
          | [number, number, number, number, number, number, number, number, number]
          | undefined,
      });
      if (!r.ok && r.enabled) throw appError(r.message?.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST", "OPERATION_FAILED", { operation: "upsertSafetyCalibration" }, r.message ?? "calibration upsert failed");
      return r;
    }),

  /**
   * Ingest a DETECTION FRAME (pixel person boxes) for a calibrated camera → project to
   * floor positions → S2a evaluator (advisory reactions). For testing + external
   * detectors. NEVER fabricates: empty detections ⇒ nothing produced.
   */
  ingestDetectionFrame: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        cameraId: z.string().min(1).max(128),
        detections: z.array(personDetectionSchema).max(200),
        robots: z.array(simRobotSchema).max(200).optional(),
        minConfidence: z.number().min(0).max(1).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyVisionFlag();
      return produce({
        cameraId: input.cameraId,
        detections: input.detections as PersonDetection[],
        robots: input.robots,
        minConfidence: input.minConfidence,
        scope: input.scope ?? null,
        corporateCode: input.corporateCode ?? null,
        factoryId: input.factoryId ?? null,
      });
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // S2b — SAFETY-PLC STATUS ADAPTER (READ-ONLY, flag SAFETY_PLC_ADAPTER_ENABLED)
  // ⚠ Observes a certified Safety PLC's NON-safety-rated status (e-stop/zone/reset/
  //    muting) over Modbus/OPC-UA (or a scripted sim) → advisory safety_events. NEVER
  //    actuates a rated stop — the certified PLC performs that itself in hardware.
  // ══════════════════════════════════════════════════════════════════════════
  plcStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      safetyPlcAdapter: safetyPlcAdapterEnabled(),
      advisory: true,
      readOnly: true,
      note: "READ-ONLY monitoring. The certified Safety PLC performs the rated stop in hardware; this only OBSERVES status and LOGS advisory events. Default backend is a clearly-labelled sim.",
    })),

  listSafetyPlcConfigs: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          robotId: z.number().int().positive().optional(),
          stationId: z.number().int().positive().optional(),
          lineId: z.number().int().positive().optional(),
          onlyEnabled: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listPlcConfigs(input ?? {})),

  upsertSafetyPlcConfig: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(255),
        vendor: z.enum(["pilz", "sick", "generic"]).optional(),
        backend: z.enum(["sim", "modbus", "opcua"]).optional(),
        endpoint: z.string().max(512).optional(),
        statusMap: z
          .object({
            estop: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            zoneOccupied: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            resetRequired: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            muting: z.object({ address: z.string().optional(), dataType: z.enum(["bool", "int", "float"]).optional(), activeWhen: z.enum(["truthy", "falsy"]).optional() }).optional(),
            simScript: z.array(plcStatusSnapshotSchema).optional(),
          })
          .optional(),
        robotId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        lineId: z.number().int().positive().optional(),
        enabled: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyPlcFlag();
      const r = await upsertPlcConfig(input);
      if (!r.ok && r.enabled) throw appError(r.message?.includes("not found") ? "NOT_FOUND" : "BAD_REQUEST", "OPERATION_FAILED", { operation: "upsertSafetyPlcConfig" }, r.message ?? "safety-PLC config upsert failed");
      return r;
    }),

  /**
   * Read one status snapshot from a safety-PLC config (sim or real) → advisory events.
   * READ-ONLY. An optional `simStatus` injects a scripted status for testing (still a
   * clearly-labelled sim). Never actuates.
   */
  readSafetyPlc: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        configId: z.number().int().positive(),
        /** Optional scripted status to inject (test/sim) — a single snapshot. */
        simStatus: plcStatusSnapshotSchema.optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireSafetyPlcFlag();
      const override = input.simStatus ? new SimSafetyPlcBackend([input.simStatus]) : undefined;
      return readConfigById(input.configId, override);
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // COLLABORATION (S1-a handover) — read + handshake mutations (flag-gated)
  // ══════════════════════════════════════════════════════════════════════════
  listCollaborations: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ phase: z.enum(["human_prep", "robot_work", "human_verify", "done"]).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      return d
        .select()
        .from(collaborationSessions)
        .where(input?.phase ? eq(collaborationSessions.phase, input.phase) : undefined)
        .orderBy(desc(collaborationSessions.startedAt))
        .limit(input?.limit ?? 100);
    }),

  startCollaboration: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        taskId: z.number().int().positive().optional(),
        operationCode: z.string().max(64).optional(),
        humanOperatorId: z.number().int().positive().optional(),
        robotDeviceId: z.number().int().positive().optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      return startCollaboration(input);
    }),

  signalHandshake: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ sessionId: z.number().int().positive(), state: z.enum(["pending", "ack", "clear"]) }))
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      const row = await signalHandshake(input.sessionId, input.state);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "collaboration" }, `Collaboration ${input.sessionId} not found`);
      return row;
    }),

  advancePhase: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      requireWorkforceFlag();
      return advancePhase(input.sessionId);
    }),

  abortCollaboration: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ sessionId: z.number().int().positive(), reason: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      const row = await abortCollaboration(input.sessionId, input.reason, ctx.user.id);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "collaboration" }, `Collaboration ${input.sessionId} not found`);
      return row;
    }),

  // ══════════════════════════════════════════════════════════════════════════
  // WORKFORCE (S1-a) — assignments CRUD + current board
  // ══════════════════════════════════════════════════════════════════════════
  /** Current board — who/which-robot is at each station now (read; always allowed). */
  currentBoard: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => getCurrentBoard()),

  listAssignments: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          operatorId: z.number().int().positive().optional(),
          status: z.enum(["planned", "active", "completed", "cancelled"]).optional(),
          stationId: z.number().int().positive().optional(),
          // doc 81 Đợt 3b Task 1 — lọc ca TRONG SQL (trước `limit`): số = đúng ca đó; `null` = chưa gắn ca (IS NULL);
          // vắng = không lọc (hành vi `{status, limit}` cũ).
          shiftConfigId: z.number().int().positive().nullable().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const conds = [];
      // doc 81 Đợt 3b final wave (rà soát bảo mật): trước — KHÔNG lọc phạm vi (nợ phamViDocBaseline) ⇒ người bị thu hẹp đọc
      // được phân công mọi nhà máy, và bộ lọc ca mới cho phép dò theo id ca của nhà máy khác. Nay chỉ hàng có nhà máy (factoryId
      // › chuyền › trạm) TRONG phạm vi; mồ côi bị loại (fail-closed); admin/không lọc ⇒ như cũ.
      const scopeCond = assignmentScopeCond(await callerFactoryScope(ctx));
      if (scopeCond) conds.push(scopeCond);
      if (input?.operatorId != null) conds.push(eq(operatorAssignments.operatorId, input.operatorId));
      if (input?.status) conds.push(eq(operatorAssignments.status, input.status));
      if (input?.stationId != null) conds.push(eq(operatorAssignments.stationId, input.stationId));
      if (input?.shiftConfigId === null) conds.push(isNull(operatorAssignments.shiftConfigId));
      else if (input?.shiftConfigId != null) conds.push(eq(operatorAssignments.shiftConfigId, input.shiftConfigId));
      // build where lazily to keep the and()-of-conds pattern consistent
      const { and } = await import("drizzle-orm");
      return d
        .select()
        .from(operatorAssignments)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(operatorAssignments.assignedStart))
        .limit(input?.limit ?? 200);
    }),

  /**
   * doc 81 Đợt 3b final wave (I2) — ca cho bộ chọn của sheet phân công: ĐANG HOẠT ĐỘNG, TRONG PHẠM VI người gọi (ca toàn hệ
   * thống thuộc mọi phạm vi — cùng luật `assertAssignableShift`) và, khi đã chọn chuyền/trạm, chỉ ca của NHÀ MÁY chuyền/trạm
   * đó (+ toàn hệ thống). Kèm tên nhà máy để nhãn phân biệt ca trùng tên giữa các nhà máy. Chỉ đọc.
   */
  assignableShifts: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z
        .object({
          lineId: z.number().int().positive().optional(),
          stationId: z.number().int().positive().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const d = await db();
      const factoryIds = await callerFactoryScope(ctx);
      // chuyền/trạm ngoài phạm vi ⇒ bỏ qua Y NHƯ không tồn tại (không lộ chuyền đó có thật / thuộc nhà máy nào), rồi CÙNG
      // luật nhà máy của phân công (post-review).
      const inScope = async (cap: "line" | "station", id: number | undefined) =>
        id == null || factoryIds === null ? id : ((await idsTrongPhamVi(cap, phamViCua(ctx))) ?? []).includes(id) ? id : undefined;
      const target = await assignmentFactoryId({ lineId: await inScope("line", input?.lineId), stationId: await inScope("station", input?.stationId) });
      const conds = [eq(shiftConfigs.isActive, true)];
      if (factoryIds !== null) {
        conds.push(factoryIds.length ? or(isNull(shiftConfigs.factoryId), inArray(shiftConfigs.factoryId, factoryIds))! : isNull(shiftConfigs.factoryId));
      }
      if (target != null) conds.push(or(isNull(shiftConfigs.factoryId), eq(shiftConfigs.factoryId, target))!);
      const rows = await d
        .select({
          id: shiftConfigs.id,
          factoryId: shiftConfigs.factoryId,
          factoryName: factories.name,
          factoryTz: factories.timezone,
          name: shiftConfigs.name,
          code: shiftConfigs.code,
          startHour: shiftConfigs.startHour,
          startMinute: shiftConfigs.startMinute,
          endHour: shiftConfigs.endHour,
          endMinute: shiftConfigs.endMinute,
          isActive: shiftConfigs.isActive,
          orderIndex: shiftConfigs.orderIndex,
        })
        .from(shiftConfigs)
        .leftJoin(factories, eq(factories.id, shiftConfigs.factoryId))
        .where(and(...conds))
        .orderBy(asc(shiftConfigs.orderIndex), asc(shiftConfigs.id));
      // doc 81 Đợt 3c Task 2 — MÚI GIỜ của từng ca (factories.timezone) để sheet chọn "ca đang chạy" theo giờ NHÀ MÁY: ca nhà
      // máy ⇒ múi giờ nhà máy của ca; ca toàn hệ thống ⇒ nhà máy của chuyền/trạm đã chọn › nhà máy DUY NHẤT trong phạm vi
      // (cùng thứ tự `stampAssignmentFactory`) › null. Múi giờ hỏng ⇒ null. Chỉ là mặc định UI — server không nhận "bây giờ".
      const ctxFactory = target ?? (factoryIds !== null && factoryIds.length === 1 ? factoryIds[0] : null);
      let ctxTz: string | null = null;
      if (ctxFactory != null && rows.some((r) => r.factoryId == null)) {
        const [f] = await d.select({ tz: factories.timezone }).from(factories).where(eq(factories.id, ctxFactory)).limit(1);
        ctxTz = f?.tz ?? null;
      } else if (ctxFactory == null && (factoryIds === null || factoryIds.length > 1) && rows.some((r) => r.factoryId == null)) {
        // doc 81 Đợt 5 H4 (mục 22) — không biết nhà máy ngữ cảnh (admin chưa chọn chuyền, hoặc phạm vi NHIỀU nhà máy): nếu MỌI
        // nhà máy đang hoạt động trong phạm vi (admin: mọi nhà máy đang hoạt động) cùng ĐÚNG MỘT múi giờ ⇒ dùng nó. Có nhà máy
        // lệch / không múi giờ (NULL là một giá trị phân biệt) ⇒ null như cũ; múi hỏng ⇒ `okTz` dưới đây trả null.
        const tzs = await d
          .selectDistinct({ tz: factories.timezone })
          .from(factories)
          .where(and(eq(factories.isActive, true), factoryIds === null ? undefined : inArray(factories.id, factoryIds)))
          .limit(2);
        ctxTz = tzs.length === 1 ? tzs[0].tz ?? null : null;
      }
      const okTz = (tz: string | null | undefined) => (tz && isValidTimeZone(tz) ? tz : null);
      return rows.map(({ factoryTz, ...r }) => ({ ...r, factoryTimezone: okTz(r.factoryId != null ? factoryTz : ctxTz) }));
    }),

  assignOperator: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        operatorId: z.number().int().positive(),
        lineId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        shiftConfigId: z.number().int().positive().optional(),
        skillLevel: z.string().max(24).optional(),
        assignedStart: z.coerce.date().optional(),
        assignedEnd: z.coerce.date().optional(),
        requiredSkillId: z.number().int().positive().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      const scope = await callerFactoryScope(ctx);
      await assertAssignmentInputsInScope(input, ctx, scope);
      await assertAssignableShift(input.shiftConfigId, scope, input);
      // final wave (rà soát bảo mật): ghi nhà máy của phân công (để người tạo — bị thu hẹp — thấy lại được nó).
      const r = await assignOperator({ ...input, factoryId: (await stampAssignmentFactory(input, scope)) ?? undefined });
      if (!r.ok && r.conflict) {
        // final wave (rà soát bảo mật): KHÔNG vọng id phân công đụng lịch — nó có thể thuộc nhà máy khác.
        throw appError("CONFLICT", "OPERATION_FAILED", { operation: "assignSafetyOperator" }, `Double-booking: ${r.conflict.reason}`);
      }
      return r;
    }),

  reassignOperator: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        assignmentId: z.number().int().positive(),
        operatorId: z.number().int().positive(),
        lineId: z.number().int().positive().optional(),
        stationId: z.number().int().positive().optional(),
        shiftConfigId: z.number().int().positive().optional(),
        skillLevel: z.string().max(24).optional(),
        assignedStart: z.coerce.date().optional(),
        assignedEnd: z.coerce.date().optional(),
        requiredSkillId: z.number().int().positive().optional(),
        notes: z.string().max(2000).optional(),
        scope: z.string().max(64).optional(),
        corporateCode: z.string().max(50).optional(),
        factoryId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      const scope = await callerFactoryScope(ctx);
      await assertAssignmentInputsInScope(input, ctx, scope);
      await assertAssignableShift(input.shiftConfigId, scope, input);
      const { assignmentId, ...rest } = input;
      // final wave (rà soát bảo mật): phân công NGOÀI phạm vi ⇒ Y HỆT không tồn tại (cùng kết quả của workforceService), không
      // huỷ hàng của nhà máy khác.
      if (!(await assignmentVisible(assignmentId, scope))) {
        return { ok: false, enabled: true, message: `assignment ${assignmentId} not found` };
      }
      const r = await reassignOperator(assignmentId, { ...rest, factoryId: (await stampAssignmentFactory(rest, scope)) ?? undefined });
      if (!r.ok && r.conflict) {
        throw appError("CONFLICT", "OPERATION_FAILED", { operation: "reassignSafetyOperator" }, `Double-booking: ${r.conflict.reason}`);
      }
      return r;
    }),

  confirmAssignment: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ assignmentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      // final wave (rà soát bảo mật): ngoài phạm vi ⇒ CÙNG lỗi như không tồn tại (trước: xác nhận được + trả nguyên hàng).
      if (!(await assignmentVisible(input.assignmentId, await callerFactoryScope(ctx)))) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workforceAssignment" }, `Assignment ${input.assignmentId} not found`);
      }
      const row = await confirmAssignment(input.assignmentId, ctx.user.id);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workforceAssignment" }, `Assignment ${input.assignmentId} not found`);
      return row;
    }),

  closeAssignment: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ assignmentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireWorkforceFlag();
      if (!(await assignmentVisible(input.assignmentId, await callerFactoryScope(ctx)))) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workforceAssignment" }, `Assignment ${input.assignmentId} not found`);
      }
      const row = await closeAssignment(input.assignmentId, ctx.user.id);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "workforceAssignment" }, `Assignment ${input.assignmentId} not found`);
      return row;
    }),
});
