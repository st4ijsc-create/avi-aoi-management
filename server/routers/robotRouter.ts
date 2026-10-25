/**
 * Phase 3 — Robot router: registry CRUD + read-only telemetry/jobs + connection
 * test. Motion control is NOT exposed here — it goes through the internal
 * robotCommandDispatcher (HITL/dry-run gated), mirroring the OT design.
 */
import { z } from "zod";
import { appError } from "../_core/appError";
import { router, protectedProcedure, adminProcedure, actuationProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { createAuditLog } from "../db";
import { robots, robotTelemetry, robotJobs, systemSettings } from "../../drizzle/schema";
import { readRobotAutomationState, readRobotAutomationStates, robotAutomationOffKey, type RobotAutomationState } from "../services/robot/robotAutomationAction"; // doc 81 Đợt 7 I5
import { phamViCua } from "./_phamViNguoiXem"; // doc 81 Đợt 7 I fix 1 (M-4)
import { idsTrongPhamVi } from "../db/hierarchy";
import { eq, desc, inArray, or, type SQL } from "drizzle-orm";
import { getRobotVendorValidation, ROBOT_VENDOR_VALIDATION } from "../services/robot";
import { dispatchRobotJob, robotInterlockTarget } from "../services/robot/robotCommandDispatcher";
import { getActiveRobot } from "../services/robot/robotManager";
import { MotionLockConflictError, OPERATOR_MOTION_LOCK_REASON_CODE, type MotionLockState, type RobotJobType } from "../services/robot/robotDriver";
import { CONSOLE_STOP_REPLY_BOUND_MS, edgeDeviceRequestErrorCode, edgeDeviceRequestPort, robotOwnerRead, sendConsoleStopForEdgeRobot, sendConsoleStopNoSession } from "../services/robot/robotEdgeCommandPort";
import { sendCentralRobotStop } from "../services/robot/deviceOwnershipService"; // doc 81 Đợt 10 task D fix review 1
import { sendLiveSessionStopFirst } from "../services/robot/robotLiveSessionStop"; // doc 81 Đợt 10 task D fix review 4 (R-10-av)
import { prefetchRobotStopRow } from "../services/robot/robotStopRow"; // fix review 4 (NF-2)
import { raiseCriticalStopAlert } from "../services/robot/criticalStopAlert"; // doc 81 Đợt 10 task D
import { robotStopProcedure, decideStopScope, robotFactoryIdFromDb, userFactoryIds, robotFactoryFromMemory, noteRobotFactoryInMemory, type StopScopeVerdict } from "../services/robot/robotStopAuth"; // fix review 5 (R-10-bb / R-10-bc)
import { STOP_AUTH_BOUND_MS, noteMachineControlGrant, noteFactoryScope, rememberedFactoryScope } from "../services/robot/robotStopAuthMemo";

/**
 * doc 81 Đợt 1B Task 5 fix round 4 (ruling R13) — the LIVE state of a robot in THIS process (what
 * robotManager holds), attached to robot.list / robot.get so the UI that already reads them can
 * show "link lost" and the MOTION LOCK. `active=false` ⇒ the gateway has not loaded this robot
 * (disabled, or ROBOT_GATEWAY_ENABLED off) and there is nothing live to report.
 */
export interface RobotLiveState {
  active: boolean;
  connected: boolean;
  motionLock: MotionLockState | null;
}
function robotLiveState(robotId: number, persisted?: ReadonlyMap<number, MotionLockState>): RobotLiveState {
  const rt = getActiveRobot(robotId);
  // doc 81 Đợt 12 N fix 1 (M-3) — no session here: its PERSISTED central lock row (if any) is still shown, with its reason, so
  // the operator sees why the robot cannot move — and that it cannot be cleared before the gateway attaches it
  if (!rt) return { active: false, connected: false, motionLock: persisted?.get(robotId) ?? null };
  let connected = false;
  try {
    connected = rt.driver.isConnected();
  } catch {
    connected = false;
  }
  // doc 81 Đợt 12 N — a driver with no motion lock: its robot's PERSISTED lock row (what refuses its motion), if any
  const motionLock = typeof rt.driver.getMotionLock === "function" ? rt.driver.getMotionLock() : (persisted?.get(robotId) ?? null);
  return { active: true, connected, motionLock };
}

/**
 * doc 81 Đợt 12 N (+ fix 1 M-3/M-4) — the persisted CENTRAL lock rows of the robots with no live lock in this process (inactive
 * here, or a lockless driver): one batched, bounded read, only when there is such a robot. Marked `persisted` (display: a STOP
 * does not clear it). A failed read shows nothing (as before) — the motion gate still refuses on the row.
 */
async function persistedLocksOfLocklessRobots(robotIds: number[]): Promise<Map<number, MotionLockState>> {
  const out = new Map<number, MotionLockState>();
  const ids = robotIds.filter((id) => {
    const rt = getActiveRobot(id);
    return !rt || typeof rt.driver.getMotionLock !== "function";
  });
  if (ids.length === 0) return out;
  const { loadCentralPersistedLocks } = await import("../services/robot/robotMotionLockStore");
  for (const [id, row] of await loadCentralPersistedLocks(ids)) {
    out.set(id, { locked: true, reasonCode: row.reasonCode, ...(row.detail != null ? { detail: row.detail } : {}), since: row.since, generation: row.generation, persisted: true });
  }
  return out;
}

/**
 * doc 81 Đợt 12 N — robot.clearMotionLock for a robot whose driver has NO motion lock but whose persisted row locks it (see the
 * call site). The caller already checked the factory scope and that no edge node owns the robot. Fail-closed at every step.
 */
async function clearPersistedLockOfLocklessDriver(a: {
  ctx: { user: { id: number; name?: string | null }; req?: { ip?: string; headers?: Record<string, unknown> } };
  input: { robotId: number; reason: string; expectedGeneration: number };
  rt: { code: string; vendor: string };
  connected: boolean;
  conflict: (state: MotionLockState) => Error;
}) {
  const { ctx, input, rt, connected, conflict } = a;
  const { readPersistedMotionLockRow, clearPersistedCentralMotionLock } = await import("../services/robot/robotMotionLockStore");
  const read = await readPersistedMotionLockRow(input.robotId);
  if ("error" in read) {
    throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, `the persisted motion lock of robot ${input.robotId} could not be read (${read.error}) — nothing was cleared`);
  }
  const row = read.row;
  if (!row) {
    throw appError(
      "PRECONDITION_FAILED",
      "OPERATION_FAILED",
      { operation: "clearRobotMotionLock", reason: "motionLockUnsupported" },
      `${rt.vendor} driver has no motion lock (one-shot transport) — nothing to clear`,
    );
  }
  const before: MotionLockState & { authority: string; ownerEpoch: number | null; writerInstanceId: string | null } = {
    locked: true,
    reasonCode: row.reasonCode,
    ...(row.detail != null ? { detail: row.detail } : {}),
    since: row.since,
    generation: row.generation,
    authority: row.authority,
    ownerEpoch: row.ownerEpoch,
    writerInstanceId: row.writerInstanceId,
  };
  // an edge authority's row is never central's to clear (the robot changed owner meanwhile); a generation the operator did not
  // see ⇒ the same CONFLICT as a live lock (re-read and decide again). Both before anything is audited.
  if (row.authority !== "central" || row.generation !== input.expectedGeneration) throw conflict(before);
  const auditBase = {
    userId: ctx.user.id,
    userName: ctx.user.name ?? null,
    action: "robot.clearMotionLock",
    entityType: "robot",
    entityId: input.robotId,
    entityName: rt.code,
    ipAddress: ctx.req?.ip ?? null,
    userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
  };
  // Audit FIRST: if the trail cannot be written the row stays.
  await createAuditLog({ ...auditBase, details: { reason: input.reason, vendor: rt.vendor, via: "persisted_row", before, expectedGeneration: input.expectedGeneration } });
  let deleted: number;
  try {
    deleted = await clearPersistedCentralMotionLock(input.robotId, { generation: row.generation, lockedAtMs: row.lockedAtMs, writerInstanceId: row.writerInstanceId, ownerEpoch: row.ownerEpoch });
  } catch (err) {
    // fix 1 (M-1) — the delete did not land (the DB refused / timed it out ⇒ rolled back) or its outcome is unknown: the trail
    // says so after the up-front row, and the operator is told exactly that (never "cleared")
    const outcome = (err as { outcome?: unknown })?.outcome === "not_cleared" ? "not_cleared" : "unknown";
    const why = String((err as Error)?.message ?? err).slice(0, 300);
    try {
      await createAuditLog({ ...auditBase, status: "failure", details: { reason: input.reason, vendor: rt.vendor, via: "persisted_row", before, expectedGeneration: input.expectedGeneration, outcome, error: why } });
    } catch (auditErr) {
      console.error(`[Robot] audit of a failed persisted motion-lock clear failed (robot ${input.robotId}):`, (auditErr as Error)?.message ?? auditErr);
    }
    throw appError(
      "INTERNAL_SERVER_ERROR",
      "OPERATION_FAILED",
      { operation: "clearRobotMotionLock", reason: outcome === "not_cleared" ? "clearNotApplied" : "clearOutcomeUnknown" },
      outcome === "not_cleared"
        ? `the motion lock of robot ${input.robotId} was NOT cleared: the database refused or timed out the clear (${why}) — it is still locked; try again`
        : `the outcome of clearing the motion lock of robot ${input.robotId} is UNKNOWN (${why}) — re-read the robot state before acting`,
    );
  }
  if (deleted !== 1) {
    // the row changed between the read and the delete (a new relock / another writer / a new owner): nothing was cleared
    const now = await readPersistedMotionLockRow(input.robotId);
    const state: MotionLockState = "row" in now && now.row ? { locked: true, reasonCode: now.row.reasonCode, since: now.row.since, generation: now.row.generation } : before;
    try {
      await createAuditLog({ ...auditBase, status: "failure", details: { reason: input.reason, vendor: rt.vendor, via: "persisted_row", before, expectedGeneration: input.expectedGeneration, conflict: state } });
    } catch (auditErr) {
      console.error(`[Robot] audit of a refused persisted motion-lock clear failed (robot ${input.robotId}):`, (auditErr as Error)?.message ?? auditErr);
    }
    throw conflict(state);
  }
  console.warn(`[Robot] persisted motion lock (${row.reasonCode}, generation ${row.generation}) of robot ${input.robotId} (${rt.code}, ${rt.vendor}: no driver lock) cleared by user ${ctx.user.id}: ${input.reason}`);
  const after: MotionLockState = {
    locked: false,
    reasonCode: row.reasonCode,
    since: row.since,
    generation: row.generation,
    clearedBy: "operator",
    clearedAt: new Date().toISOString(),
    clearedByUserId: ctx.user.id,
    clearReason: input.reason,
  };
  return { robotId: input.robotId, changed: true, connected, motionLock: after };
}
import {
  isTechmanScriptAllowed,
  isTechmanUnvalidatedConsoleVerb,
  TECHMAN_CONSOLE_VERB_UNVALIDATED,
  TECHMAN_SCRIPT_ALLOWLIST,
} from "../services/robot/drivers/techmanScriptAllowlist";

const vendorEnum = z.enum(["fanuc", "mitsubishi", "delta", "techman", "sim", "vda5050"]);
const kindEnum = z.enum(["arm", "scara", "cobot", "agv"]);

// ENG-F1 (doc 40) — các lệnh đơn lẻ Command Console được phép PHÁT qua HITL dispatcher.
// Đây là verb PackML/capability (start/stop/home/reset/pause/abort) — KHÔNG phải motion tự do.
const consoleCommandEnum = z.enum(["start", "stop", "home", "reset", "pause", "abort"]);

/**
 * Map một verb console → RobotJobType. 'stop'/'abort' → 'abort' (driver dừng chuyển động),
 * 'home' → 'home'; các verb điều-khiển-trạng-thái còn lại (start/reset/pause) → 'custom' với
 * verb kèm trong params (driver honest-log; real-run vẫn qua mode+commissioning+interlock gate).
 */
function verbToJobType(verb: z.infer<typeof consoleCommandEnum>): RobotJobType {
  switch (verb) {
    case "stop":
    case "abort":
      return "abort";
    case "home":
      return "home";
    default:
      return "custom";
  }
}

/**
 * doc 81 Đợt 7 I fix 1 (review M-4) — is this robot inside the caller's FACTORY scope? The orchestration rule for robots
 * (foeScope): through its line or its station; an orphan robot (no line, no station) is in nobody's restricted scope.
 * Admin / unrestricted ⇒ true. The scope is resolved STRICT: a lookup that cannot be done THROWS (no change is made).
 */
async function robotInCallerScope(ctx: { user: { id: number; role?: string | null } }, r: { lineId: number | null; stationId: number | null }): Promise<boolean> {
  const scope = phamViCua(ctx as never);
  const strict = { strict: true };
  const [lines, stations] = await Promise.all([idsTrongPhamVi("line", scope, strict), idsTrongPhamVi("station", scope, strict)]);
  if (lines === null) return true; // the shared resolver: unrestricted
  return (r.lineId != null && lines.includes(r.lineId)) || (r.stationId != null && (stations ?? []).includes(r.stationId));
}

/**
 * phạm vi người dùng (L4 2026-10-25) — robot thấy được cho ĐỌC: CÙNG luật `robotInCallerScope` của đường GHI (chuyền HOẶC trạm của nó trong phạm vi; robot mồ côi chỉ toàn quyền thấy). Ngoài phạm vi ≡ không tồn tại
 * (get ⇒ null, telemetry/jobs ⇒ rỗng, list ⇒ vắng mặt). `undefined` = toàn quyền.
 */
async function dieuKienRobotThay(ctx: { user: { id: number; role?: string | null } }): Promise<SQL | undefined> {
  const scope = phamViCua(ctx as never);
  const [lines, stations] = await Promise.all([idsTrongPhamVi("line", scope, { strict: true }), idsTrongPhamVi("station", scope, { strict: true })]);
  if (lines === null) return undefined;
  return or(inArray(robots.lineId, lines.length > 0 ? lines : [-1]), inArray(robots.stationId, (stations ?? []).length > 0 ? (stations ?? []) : [-1]));
}
async function robotThayDuoc(ctx: { user: { id: number; role?: string | null } }, robotId: number): Promise<boolean> {
  if ((await dieuKienRobotThay(ctx)) === undefined) return true; // toàn quyền: không kiểm (cả tồn tại) — giữ hành vi cũ
  const db = await getDb();
  if (!db) return false;
  const [r] = await db.select({ lineId: robots.lineId, stationId: robots.stationId }).from(robots).where(eq(robots.id, robotId)).limit(1);
  return !!r && (await robotInCallerScope(ctx, r));
}

/**
 * doc 81 Đợt 7 I5 — set a robot's automation switch: robot must exist AND be inside the caller's factory scope (fix 1,
 * M-4: outside it ⇒ the SAME NOT_FOUND as a missing robot), audit FIRST, then the setting (upsert).
 */
async function setRobotAutomation(
  ctx: { user: { id: number; name?: string | null }; req?: { ip?: string; headers?: Record<string, unknown> } },
  robotId: number,
  enabled: boolean,
  reason: string,
): Promise<{ robotId: number; automation: RobotAutomationState; changed: boolean }> {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
  const [r] = await db.select().from(robots).where(eq(robots.id, robotId)).limit(1);
  // the scope is resolved for a missing robot too (same path, same answer)
  const inScope = await robotInCallerScope(ctx, { lineId: r?.lineId ?? null, stationId: r?.stationId ?? null });
  if (!r || !inScope) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
  const before = await readRobotAutomationState(db, robotId);
  await createAuditLog({
    userId: ctx.user.id,
    userName: ctx.user.name ?? null,
    action: enabled ? "robot.enableAutomation" : "robot.disableAutomation",
    entityType: "robot",
    entityId: robotId,
    entityName: r.code,
    ipAddress: ctx.req?.ip ?? null,
    userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
    details: { reason, before, after: enabled ? "on" : "off" },
  });
  const value = enabled ? "false" : "true";
  await db
    .insert(systemSettings)
    .values({
      settingKey: robotAutomationOffKey(robotId),
      settingValue: value,
      category: "robot_automation",
      description: `doc 81 Dot 7 I5 - automation switch of robot ${robotId} (true = automation OFF)`,
      updatedBy: ctx.user.id,
    })
    .onConflictDoUpdate({ target: systemSettings.settingKey, set: { settingValue: value, updatedBy: ctx.user.id, updatedAt: new Date() } });
  const after = await readRobotAutomationState(db, robotId);
  console.warn(`[Robot] automation of robot ${robotId} (${r.code}) turned ${enabled ? "ON" : "OFF"} by user ${ctx.user.id}: ${reason}`);
  return { robotId, automation: after, changed: before !== after };
}

/**
 * doc 81 Đợt 10 task D (R-10-k / R-10-ak / NF-2) — a console STOP for a robot this process holds NO session for: edge-owned ⇒
 * queued for the node; central-owned / owner unreadable ⇒ the transient-session STOP (+ the edge queue when unknown), answered at
 * the 2 s bound from request entry. null ⇒ no robot row / a DB without 0374: the caller's dispatcher path answers.
 * (fix review 5: shared by robot.actuate and robot.consoleStop.)
 */
/**
 * doc 81 Đợt 10 task D fix review 5 (R-10-bc) — the factory scope of a STOP sent through robot.actuate (full auth chain): the DB
 * scope (caller's factories + the robot's factory) read under STOP_AUTH_BOUND_MS; otherwise the caller's last known scope with the
 * robot → factory map in robotManager's memory; refused only when both are known and differ; unknown ⇒ allowed + anomaly audit.
 */
async function stopScopeForActuate(user: { id: number; role?: string | null; name?: string | null }, robotId: number, token: string | null): Promise<StopScopeVerdict> {
  type L<T> = { done: boolean; value?: T };
  const leg = <T,>(p: Promise<T>) => {
    const l: L<T> = { done: false };
    const d = p.then((v) => void Object.assign(l, { done: true, value: v }), () => undefined);
    return { l, d };
  };
  const scope = leg(userFactoryIds({ id: user.id, role: user.role }));
  const rf = leg(robotFactoryIdFromDb(robotId));
  let t: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all([scope.d, rf.d]), new Promise<void>((r) => (t = setTimeout(r, STOP_AUTH_BOUND_MS)))]);
  clearTimeout(t);
  const robotFactoryIdInMemory = await robotFactoryFromMemory();
  if (rf.l.done) await noteRobotFactoryInMemory(robotId, rf.l.value ?? null);
  if (scope.l.done) noteFactoryScope(token, user.id, scope.l.value ?? null);
  const verdict =
    scope.l.done && rf.l.done
      ? decideStopScope({ robotId, userScope: scope.l.value ?? null, robotFactory: rf.l.value ?? null, basis: "db" })
      : decideStopScope({ robotId, userScope: scope.l.done ? (scope.l.value ?? null) : rememberedFactoryScope(token, user.id), robotFactory: rf.l.done ? (rf.l.value ?? null) : robotFactoryIdInMemory(robotId), basis: "memory" });
  if (verdict.allowed && verdict.unknown) {
    // R-10-be — allowed (L-7) with a durable alert + an anomaly audit
    void raiseCriticalStopAlert({ kind: "stop_scope_unknown", title: `STOP with an unknown factory scope — robot ${robotId}`, message: `STOP accepted with an UNKNOWN factory scope: ${verdict.unknown} (user #${user.id}, robot ${robotId})`, recipients: [user.id], dedupKey: `stop_scope_unknown:${robotId}:${Date.now()}`, source: "robot", entityType: "robot", entityId: robotId, retryUntilPersisted: { everyMs: 30_000, attempts: 20 } });
    void import("../services/auditTrailService")
      .then(({ logCrudOperation }) =>
        logCrudOperation({ userId: user.id, userName: user.name ?? null, ipAddress: null, userAgent: null, source: "trpc" } as never, { action: "robot.stop.scopeUnknown", entityType: "robot", entityId: robotId, details: { anomaly: verdict.unknown, basis: verdict.basis, ruling: "R-10-bc" }, status: "success" } as never),
      )
      .catch((err) => console.error(`[Robot] STOP scope-unknown audit for robot ${robotId} not written: ${(err as Error)?.message ?? err}`));
  }
  return verdict;
}

async function consoleStopNoSessionPath(
  robotId: number,
  command: string,
  userId: number,
  enteredAt: number,
  /** fix review 5 — the reads the caller STARTED at request entry (in parallel with its scope check) */
  pre?: { stopRow: ReturnType<typeof prefetchRobotStopRow>; owner: ReturnType<typeof robotOwnerRead> },
) {
  // fix review 4 (NF-2) — the two reads before the send run IN PARALLEL under one STOP bound (owner + the robot row a transient
  // STOP needs); the 2 s reply bound counts from request entry
  const stopRow = pre?.stopRow ?? prefetchRobotStopRow(robotId);
  const owner = await (pre?.owner ?? robotOwnerRead(robotId));
  if ("edge" in owner) {
    // R-10-k (L-7) — never a silent no-op: queue for the owner; on failure the central STOP (if a session exists) AND a
    // re-queue for the current owner; neither ⇒ critical alert + an error the user sees.
    const stop = await sendConsoleStopForEdgeRobot({
      robotId: robotId,
      requestedBy: userId,
      reason: `console ${command}`,
      centralStop: async () =>
        getActiveRobot(robotId)
          ? dispatchRobotJob({ robotId: robotId, job: { jobType: "abort", params: {} }, triggerKind: "manual", requestedBy: userId, confirmedBy: userId })
          : null,
      // final fix wave (I-3, R-10-br) — the owning node is unreachable ⇒ central's fallback STOP at once (session, else transient)
      fallbackStop: () => sendCentralRobotStop(robotId, { row: stopRow }),
      replyBoundMs: Math.max(0, CONSOLE_STOP_REPLY_BOUND_MS - (Date.now() - enteredAt)),
    });
    if (stop.ok && stop.edgeUnreachable) {
      // a WARNING, not ok-green: queued, but the node is not reachable; the fallback leg and the alert are said truthfully
      const fb = stop.centralFallback;
      return {
        ok: true,
        status: "queued_edge_unreachable" as const,
        error: undefined as string | undefined,
        queuedOnEdge: { requestId: stop.requestId ?? null, edgeNodeId: stop.edgeNodeId ?? owner.edge, via: stop.via },
        centralFallback: (!fb ? "none" : fb.state === "pending" ? "in_progress" : fb.state === "done" && fb.value.ok ? (fb.value.sent === "simulated" ? "simulated" : "done") : "failed") as "done" | "simulated" | "failed" | "in_progress" | "none",
      };
    }
    if (stop.ok) {
      return { ok: true, status: "queued_on_edge" as const, error: undefined as string | undefined, queuedOnEdge: { requestId: stop.requestId ?? null, edgeNodeId: stop.edgeNodeId ?? owner.edge, via: stop.via } };
    }
    return { ok: false, status: "rejected" as const, error: stop.error as string | undefined, queuedOnEdge: undefined };
  }
  if ("central" in owner || "unknown" in owner) {
    // fix review 1/2 (R-10-v, M-2, R-10-ak) — no session here for a robot central owns (an ownership change not yet applied, a
    // failed connect) or whose owner could not be read: the transient-session STOP starts at once (owner unknown: the edge queue
    // in parallel, bounded), the answer comes at the STOP bound at the latest (partial), with a durable critical alert.
    const r = await sendConsoleStopNoSession({
      robotId: robotId,
      requestedBy: userId,
      reason: `console ${command}`,
      ownerUnknown: "unknown" in owner ? owner.unknown : null,
      centralStop: (id) => sendCentralRobotStop(id, { row: stopRow }),
      replyBoundMs: Math.max(0, CONSOLE_STOP_REPLY_BOUND_MS - (Date.now() - enteredAt)),
      alert: (message) =>
        void raiseCriticalStopAlert({
          retryUntilPersisted: { everyMs: 30_000, attempts: 20 }, // R-10-av — durable even when the DB is down right now
          kind: "console_stop_no_session",
          title: `STOP without a session — robot ${robotId}`,
          message,
          recipients: [userId],
          dedupKey: `console_stop_no_session:robot:${robotId}:${Date.now()}`,
          source: "robot",
          entityType: "robot",
          entityId: robotId,
        }),
    });
    if (!r.ok) return { ok: false, status: "rejected" as const, error: r.error as string | undefined, queuedOnEdge: undefined };
    const centralDone = r.central.state === "done" && r.central.value.ok;
    return {
      ok: true,
      status: (centralDone ? (r.central.state === "done" && r.central.value.sent === "simulated" ? "simulated" : "done") : r.central.state === "pending" ? "stop_in_progress" : "queued_on_edge") as "done",
      error: undefined as string | undefined,
      queuedOnEdge: r.queued?.state === "done" ? { requestId: r.queued.value.requestId, edgeNodeId: r.queued.value.edgeNodeId, via: "edge_queue" } : undefined,
    };
  }
  return null;
}

export const robotRouter = router({
  // Doc 38 Đợt Q — these rows carry `endpoint` + `connectionOptions` (device address
  // and, potentially, connection credentials). Gate behind machine_control/canView so
  // the connection surface is not exposed to every authenticated user.
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(robots).where(await dieuKienRobotThay(ctx)).orderBy(desc(robots.updatedAt)); // phạm vi người dùng (L4 2026-10-25)
      // doc 81 Đợt 7 I5 — the per-robot automation switch ("unknown" = unreadable: automation is refused then).
      const automation = await readRobotAutomationStates(db, rows.map((r) => r.id));
      const persisted = await persistedLocksOfLocklessRobots(rows.map((r) => r.id)); // doc 81 Đợt 12 N
      // CTL-05 — kèm validationStatus per-vendor để UI badge (spec-verified/assumed/mock).
      // Fix round 4 (R13) — kèm `live` (kết nối + khoá chuyển động của tiến trình này).
      return rows.map((r) => ({
        ...r,
        validationStatus: getRobotVendorValidation(r.vendor),
        live: robotLiveState(r.id, persisted),
        automation: (automation.get(r.id) ?? "unknown") as RobotAutomationState,
      }));
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select().from(robots).where(eq(robots.id, input.id)).limit(1);
      if (!row || !(await robotInCallerScope(ctx, row))) return null; // phạm vi người dùng (L4 2026-10-25): ngoài phạm vi ≡ không tồn tại
      return {
        ...row,
        validationStatus: getRobotVendorValidation(row.vendor),
        live: robotLiveState(row.id, await persistedLocksOfLocklessRobots([row.id])), // doc 81 Đợt 12 N
        automation: await readRobotAutomationState(db, row.id), // doc 81 Đợt 7 I5
      };
    }),

  // doc 81 Đợt 1B Task 5 fix round 4 (ruling R13) — NGƯỜI VẬN HÀNH GỠ KHOÁ CHUYỂN ĐỘNG.
  // Sau một lần rớt kết nối / kết cục chuyển động không rõ, driver (MELFA/Delta/FANUC) KHOÁ chuyển
  // động; poll chỉ đọc vẫn nối lại được nhưng chuyển động bị cổng 3 của dispatcher từ chối
  // (MOTION_LOCKED). Khoá tự gỡ khi một STOP được driver xác nhận; đường còn lại là mutation này:
  //   • sàn vai actuation (admin/supervisor/engineer + 2FA theo cấu hình) + machine_control/canEdit,
  //   • ghi audit (createAuditLog) TRƯỚC khi gỡ — không ghi được thì KHÔNG gỡ (fail-closed),
  //   • trả trạng thái mới. Không gửi byte nào tới robot.
  //   • fix round 5 (item 2): COMPARE-AND-CLEAR — the UI sends the lock `generation` it displayed; a
  //     new link loss during the dialog or the audit write bumps it and the clear is refused with
  //     CONFLICT (the newer lock is never erased by a decision taken about the older one).
  clearMotionLock: actuationProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      robotId: z.number().int().positive(),
      reason: z.string().trim().min(3).max(500),
      expectedGeneration: z.number().int().nonnegative(),
    }))
    .mutation(async ({ ctx, input }) => {
      const conflict = (state: MotionLockState) =>
        appError(
          "CONFLICT",
          "OPERATION_FAILED",
          { operation: "clearRobotMotionLock", reason: "motionLockChanged" },
          `motion lock changed while you were confirming — now generation ${state.generation ?? "?"} (${state.reasonCode ?? "link loss"} since ${state.since ?? "?"}); re-read the robot state and confirm again`,
        );
      // doc 81 Đợt 10 final fix wave residual (NEW-1, R-10-bt) — a clear RAISES energy: the robot must exist AND be inside the
      // caller's factory scope (strict resolver: unresolvable ⇒ throws ⇒ refused — NEVER allowed on an unknown scope); out of scope
      // or missing ⇒ the SAME NOT_FOUND (M-4). Checked before anything is audited, queued or cleared (operator hold included).
      // (the R-10-bc MOTION pattern: an UNRESTRICTED caller needs no row read; a restricted one needs the row inside its scope)
      {
        const scope = phamViCua(ctx as never);
        const [lines, stations] = await Promise.all([idsTrongPhamVi("line", scope, { strict: true }), idsTrongPhamVi("station", scope, { strict: true })]);
        if (lines !== null) {
          const db = await getDb();
          if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable — clear refused (factory scope unverifiable)");
          const [row] = await db.select({ lineId: robots.lineId, stationId: robots.stationId }).from(robots).where(eq(robots.id, input.robotId)).limit(1);
          const inScope = !!row && ((row.lineId != null && lines.includes(row.lineId)) || (row.stationId != null && (stations ?? []).includes(row.stationId)));
          if (!inScope) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
        }
      }
      const rt = getActiveRobot(input.robotId);
      // doc 81 Đợt 10 task D (design §2.11) — a robot an EDGE node owns: its lock authority is the node. The clear goes there as a
      // signed command (compare-and-clear on `expectedGeneration` at the edge); audited first. fix review 1 (M-3): also when this
      // process still holds a stale session (an ownership change not yet applied here) — its in-memory lock is not the authority.
      const owner = await robotOwnerRead(input.robotId);
      if (!rt || "edge" in owner) {
        const edgeNodeId = "edge" in owner ? owner.edge : null;
        if (edgeNodeId !== null) {
          await createAuditLog({
            userId: ctx.user.id,
            userName: ctx.user.name ?? null,
            action: "robot.clearMotionLock",
            entityType: "robot",
            entityId: input.robotId,
            ipAddress: ctx.req?.ip ?? null,
            userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
            details: { reason: input.reason, expectedGeneration: input.expectedGeneration, edgeNodeId, via: "edge_command" },
          });
          try {
            const q = await edgeDeviceRequestPort().enqueue({ kind: "clear", robotId: input.robotId, expectedGeneration: input.expectedGeneration, reason: input.reason, requestedBy: ctx.user.id });
            return { robotId: input.robotId, changed: false, connected: false, motionLock: null, queuedOnEdge: { requestId: q.requestId, edgeNodeId: q.edgeNodeId } };
          } catch (err) {
            const code = edgeDeviceRequestErrorCode(err);
            if (code !== "notEdgeOwned") {
              throw appError(
                "PRECONDITION_FAILED",
                "OPERATION_FAILED",
                { operation: "clearRobotMotionLock", reason: "edgeCommandNotQueued" },
                `robot ${input.robotId} is owned by edge node ${edgeNodeId}; the clear could not be queued for it (${code}) — nothing was cleared`,
              );
            }
            // the owner changed back to central meanwhile — fall through to the central answer
          }
        }
      }
      if (!rt) {
        throw appError(
          "PRECONDITION_FAILED",
          "OPERATION_FAILED",
          { operation: "clearRobotMotionLock", reason: "robotNotActive" },
          `robot ${input.robotId} is not active in this process (not loaded by the robot gateway) — there is no live motion lock to clear`,
        );
      }
      const driver = rt.driver;
      const connectedNow = () => {
        try {
          return driver.isConnected();
        } catch {
          return false;
        }
      };
      if (typeof driver.getMotionLock !== "function" || typeof driver.clearMotionLock !== "function") {
        // doc 81 Đợt 12 task N (OWNER-SETUP B2) — a driver with NO motion lock (one-shot transport) whose robot carries a PERSISTED
        // lock row (e.g. the DB's ownerChanged relock after a release from an edge): central refuses its motion on that row and
        // nothing else can ever remove it. Cleared HERE only — the scope check above, this procedure's role + permission, the
        // required reason, the generation the operator saw, the audit row FIRST, then exactly that row (generation, lockedAt,
        // writer, owner epoch, central authority, central-owned robot). No row ⇒ the pre-Đợt-12 answer.
        return clearPersistedLockOfLocklessDriver({ ctx, input, rt, connected: connectedNow(), conflict });
      }
      const before = driver.getMotionLock();
      if (!before.locked) {
        return { robotId: input.robotId, changed: false, connected: connectedNow(), motionLock: before };
      }
      // Fix round 5 — cheap pre-check before any write: the operator decided about an older lock.
      if (before.generation !== input.expectedGeneration) throw conflict(before);
      const auditBase = {
        userId: ctx.user.id,
        userName: ctx.user.name ?? null,
        action: "robot.clearMotionLock",
        entityType: "robot",
        entityId: input.robotId,
        entityName: rt.code,
        ipAddress: ctx.req?.ip ?? null,
        userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
      };
      // Audit FIRST: if the trail cannot be written the lock stays set.
      await createAuditLog({
        ...auditBase,
        details: { reason: input.reason, vendor: rt.vendor, before, expectedGeneration: input.expectedGeneration },
      });
      let after: MotionLockState;
      try {
        after = driver.clearMotionLock({ reason: input.reason, userId: ctx.user.id, expectedGeneration: input.expectedGeneration });
      } catch (err) {
        if (!(err instanceof MotionLockConflictError)) throw err;
        // The lock changed between the audit row and the clear (a new link loss). Nothing was cleared;
        // record that outcome on the trail (best effort) and refuse.
        try {
          await createAuditLog({
            ...auditBase,
            status: "failure",
            details: { reason: input.reason, vendor: rt.vendor, before, expectedGeneration: input.expectedGeneration, conflict: err.state },
          });
        } catch (auditErr) {
          console.error(`[Robot] audit of a refused motion-lock clear failed (robot ${input.robotId}):`, (auditErr as Error)?.message ?? auditErr);
        }
        throw conflict(err.state);
      }
      console.warn(`[Robot] motion lock cleared by user ${ctx.user.id} on robot ${input.robotId} (${rt.code}): ${input.reason}`);
      return { robotId: input.robotId, changed: true, connected: connectedNow(), motionLock: after };
    }),

  // doc 81 Đợt 10 final fix wave (M-5, R-10-br) — THE central "lock" route (design §2.11): an operator HOLDS a robot's motion.
  // Factory scope (R-10-bc): the caller's scope must contain the robot, read strictly — fail-closed (scan follow-up).
  // Locking only withholds motion ⇒ machine_control:canEdit (never behind the actuation floor, like disableAutomation); a reason
  // is required and the audit row is written FIRST (no audit ⇒ nothing locked). The lock is an OPERATOR hold (`centralLock`):
  // a confirmed STOP does not clear it — only the audited robot.clearMotionLock does.
  //   • EDGE-owned robot ⇒ a signed `lock` command queued for its node (the edge locks with `centralLock`);
  //   • a robot this process holds a session for ⇒ its in-memory lock (persisted like any lock);
  //   • neither ⇒ PRECONDITION_FAILED robotNotActive.
  requestMotionLock: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ robotId: z.number().int().positive(), reason: z.string().trim().min(3).max(300) }))
    .mutation(async ({ ctx, input }) => {
      // scan (R-10-bc, fail-closed like motion) — the robot must exist AND be inside the caller's factory scope (strict resolver: an
      // unresolvable scope throws ⇒ refused); outside it or missing ⇒ the SAME NOT_FOUND (M-4). Nothing is audited / queued / locked.
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable — lock refused (factory scope unverifiable)");
      const [row] = await db.select({ lineId: robots.lineId, stationId: robots.stationId }).from(robots).where(eq(robots.id, input.robotId)).limit(1);
      const inScope = await robotInCallerScope(ctx, { lineId: row?.lineId ?? null, stationId: row?.stationId ?? null });
      if (!row || !inScope) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
      const owner = await robotOwnerRead(input.robotId);
      const auditBase = {
        userId: ctx.user.id,
        userName: ctx.user.name ?? null,
        action: "robot.requestMotionLock",
        entityType: "robot",
        entityId: input.robotId,
        ipAddress: ctx.req?.ip ?? null,
        userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
      };
      if ("edge" in owner) {
        await createAuditLog({ ...auditBase, details: { reason: input.reason, edgeNodeId: owner.edge, via: "edge_command" } });
        try {
          const q = await edgeDeviceRequestPort().enqueue({ kind: "lock", robotId: input.robotId, reason: input.reason, requestedBy: ctx.user.id });
          return { robotId: input.robotId, changed: false, motionLock: null, queuedOnEdge: { requestId: q.requestId, edgeNodeId: q.edgeNodeId } };
        } catch (err) {
          throw appError(
            "PRECONDITION_FAILED",
            "OPERATION_FAILED",
            { operation: "lockRobotMotion", reason: "edgeCommandNotQueued" },
            `robot ${input.robotId} is owned by edge node ${owner.edge}; the lock could not be queued for it (${edgeDeviceRequestErrorCode(err)}) — nothing was locked`,
          );
        }
      }
      const lock = getActiveRobot(input.robotId)?.driver.motionLockController?.();
      if (!lock) {
        throw appError(
          "PRECONDITION_FAILED",
          "OPERATION_FAILED",
          { operation: "lockRobotMotion", reason: "robotNotActive" },
          `robot ${input.robotId} is not active in this process and no edge node owns it — there is no motion lock to set here`,
        );
      }
      await createAuditLog({ ...auditBase, details: { reason: input.reason, via: "central_session", before: lock.snapshot() } });
      lock.lock(OPERATOR_MOTION_LOCK_REASON_CODE, input.reason);
      console.warn(`[Robot] motion of robot ${input.robotId} HELD by user ${ctx.user.id} (operator lock): ${input.reason}`);
      return { robotId: input.robotId, changed: true, motionLock: lock.snapshot(), queuedOnEdge: null };
    }),

  // doc 81 Đợt 7 task I5 — PER-ROBOT AUTOMATION SWITCH (owner decision 2026-10-11). OFF ⇒ the VDA5050 / ROS2 automation
  // self-grant is refused for this robot (robotAutomationAction + the dispatcher); STOPs are never affected; an operator's
  // own 'manual' command is not automation. Turning automation OFF only withholds motion ⇒ machine_control/canEdit is
  // enough (never held behind the actuation role floor / 2FA); turning it back ON re-enables automated motion ⇒ the
  // actuation floor (admin/supervisor/engineer + 2FA) + canEdit. Both need a reason and write the audit row FIRST (no
  // audit ⇒ no change, fail-closed).
  disableAutomation: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ robotId: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => setRobotAutomation(ctx, input.robotId, false, input.reason)),

  enableAutomation: actuationProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({ robotId: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }))
    .mutation(async ({ ctx, input }) => setRobotAutomation(ctx, input.robotId, true, input.reason)),

  // CTL-05 — bản đồ vendor → validationStatus (spec-verified/assumed/mock) cho UI badge.
  vendorValidation: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(() => ROBOT_VENDOR_VALIDATION),

  // doc 54 Wave B — telemetry + job log were ungated while list/get are gated; require the
  // machine_monitoring/canView read floor so fleet observation isn't open to every user.
  telemetry: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ robotId: z.number(), limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      if (!(await robotThayDuoc(ctx, input.robotId))) return []; // phạm vi người dùng (L4 2026-10-25)
      return db.select().from(robotTelemetry)
        .where(eq(robotTelemetry.robotId, input.robotId))
        .orderBy(desc(robotTelemetry.timestamp))
        .limit(input.limit);
    }),

  jobs: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ robotId: z.number(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      if (!(await robotThayDuoc(ctx, input.robotId))) return []; // phạm vi người dùng (L4 2026-10-25)
      return db.select().from(robotJobs)
        .where(eq(robotJobs.robotId, input.robotId))
        .orderBy(desc(robotJobs.createdAt))
        .limit(input.limit);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(255),
      vendor: vendorEnum,
      model: z.string().max(128).optional(),
      kind: kindEnum.default("arm"),
      endpoint: z.string().min(1).max(255),
      connectionOptions: z.record(z.string(), z.unknown()).optional(),
      pollIntervalMs: z.number().min(250).max(600000).default(5000),
      lineId: z.number().optional(),
      stationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [row] = await db.insert(robots).values({ ...input, isEnabled: false }).returning();
      return row;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().max(255).optional(),
      model: z.string().max(128).optional(),
      endpoint: z.string().max(255).optional(),
      connectionOptions: z.record(z.string(), z.unknown()).optional(),
      pollIntervalMs: z.number().min(250).max(600000).optional(),
      lineId: z.number().optional(),
      stationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const { id, ...rest } = input;
      const [row] = await db.update(robots).set({ ...rest, updatedAt: new Date() }).where(eq(robots.id, id)).returning();
      return row;
    }),

  setEnabled: adminProcedure
    .input(z.object({ id: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [row] = await db.update(robots)
        .set({ isEnabled: input.enabled, updatedAt: new Date() })
        .where(eq(robots.id, input.id)).returning();
      return row;
    }),

  // Read-only connection test: open, read state once, disconnect. No motion.
  testConnection: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const [r] = await db.select().from(robots).where(eq(robots.id, input.id)).limit(1);
      if (!r) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
      const { createRobotDriver } = await import("../services/robot");
      const { probeRobotConnection } = await import("../services/robot/probeRobotConnection");
      const driver = createRobotDriver(r.vendor);
      // doc 81 Đợt 1B Task 2 (R8) — connect + getState + disconnect trong MỘT hạn tổng; robot im
      // lặng / disconnect treo không giữ được request, kết nối muộn vẫn bị hạ.
      try {
        const state = await probeRobotConnection(driver, {
          endpoint: r.endpoint,
          options: r.connectionOptions ?? undefined,
        });
        return { ok: true, state };
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? String(err) };
      }
    }),

  // ENG-F1 (doc 40) — INTERLOCK PREVIEW (read-only). Chạy CHÍNH XÁC phép đánh giá interlock
  // mà dispatcher sẽ dùng cho robot này (robotInterlockTarget: machineId=robotId) nhưng
  // KHÔNG ghi gì — để Command Console hiển thị interlock-check TRƯỚC khi gửi. Đây chỉ là bản
  // xem trước; gate THẬT vẫn nằm trong robotCommandDispatcher (fail-closed, đồng bộ).
  interlockPreview: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ robotId: z.number() }))
    .query(async ({ input, ctx }) => {
      const { evaluateInterlockGate } = await import("../services/interlock/interlockGate");
      // phạm vi người dùng (L4 2026-10-25): robot ngoài phạm vi ≡ robot không tồn tại ⇒ đánh giá trên khoá KHÔNG có luật (-1), không lộ luật interlock của nhà máy khác
      const mucTieu = (await robotThayDuoc(ctx, input.robotId)) ? input.robotId : -1;
      // doc 81 Đợt 1B Task 5 — CÙNG khoá với cổng thật (robotInterlockTarget), không hai định nghĩa.
      const gate = await evaluateInterlockGate(robotInterlockTarget(mucTieu));
      return { blocked: gate.blocked, failClosed: gate.failClosed, violations: gate.violations };
    }),

  // ENG-F1 (doc 40) — GATED COMMAND CONSOLE: phát MỘT lệnh đơn lẻ (start/stop/home/reset/
  // pause/abort) qua robotCommandDispatcher. GIỮ NGUYÊN MỌI GATE của dispatcher:
  // idempotency · mode gate (dry-run khi ROBOT_CONTROL_ENABLED≠true) · commissioning/FAT ·
  // interlock fail-closed · command-authz (FIELD_V2). Đây là đường operator trực tiếp
  // (triggerKind='manual') — typed-confirm ở UI là human-in-the-loop; requestedBy=confirmedBy
  // =chính operator đã đăng nhập + có quyền machine_control/canEdit. KHÔNG bao giờ fake
  // success: trả trạng thái honest (done/failed/simulated/rejected) đúng như dispatcher.
  // doc 40 QA-3 (blocker): actuate là đường real-motion → PHẢI qua actuationProcedure
  // (role-floor admin/supervisor/engineer + 2FA) như mọi actuation khác, không chỉ
  // protectedProcedure+bit. Dispatcher không kiểm 2FA nên gate phải nằm ở procedure.
  /**
   * doc 81 Đợt 10 task D fix review 5 — ruling R-10-bb (L-7): THE console STOP route. STOP verbs only (its input schema — never
   * motion). Authentication = robotStopProcedure: stateless JWT first, then session / user / permission / factory scope in
   * parallel under 300 ms; on a DB timeout / failure a valid token whose last known identity carries machine_control may still
   * STOP (audited + durable alert "STOP accepted on degraded auth"). Then the same STOP as robot.actuate: the live session first
   * (R-10-av), else the no-session path, else the dispatcher's canonical abort.
   */
  consoleStop: robotStopProcedure
    .input(z.object({ robotId: z.number().int(), command: z.enum(["stop", "abort"]), idempotencyKey: z.string().min(1).max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      const enteredAt = Date.now();
      const user = (ctx as unknown as { user: { id: number } }).user;
      const live = await sendLiveSessionStopFirst({ robotId: input.robotId, requestedBy: user.id, idempotencyKey: input.idempotencyKey, command: input.command });
      if (live) return { ...live, degradedAuth: (ctx as unknown as { stopAuth?: { degraded: boolean } }).stopAuth?.degraded === true };
      if (!getActiveRobot(input.robotId)) {
        const r = await consoleStopNoSessionPath(input.robotId, input.command, user.id, enteredAt);
        if (r) return r;
      }
      return dispatchRobotJob({ robotId: input.robotId, job: { jobType: "abort", params: { command: input.command } }, triggerKind: "manual", requestedBy: user.id, confirmedBy: user.id, idempotencyKey: input.idempotencyKey });
    }),

  actuate: actuationProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      robotId: z.number(),
      command: consoleCommandEnum,
      params: z.record(z.string(), z.unknown()).optional(),
      idempotencyKey: z.string().min(1).max(128).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // doc 81 Đợt 10 task D fix review 4 (R-10-av, L-7) — a STOP for a robot this process holds a LIVE session for is SENT FIRST,
      // before any database read (ledger after the send, bounded): a hung / dead DB never delays the STOP of an attached robot.
      const enteredAt = Date.now();
      let noSessionPre: Parameters<typeof consoleStopNoSessionPath>[4];
      noteMachineControlGrant(ctx.sessionToken ?? null, ctx.user.id); // R-10-bb — this user passed the full machine_control:canEdit chain just now
      if (verbToJobType(input.command) === "abort") {
        // NF-2 — a no-session STOP's owner + robot-row reads start NOW, in parallel with the scope check below (one bound)
        noSessionPre = getActiveRobot(input.robotId) ? undefined : { stopRow: prefetchRobotStopRow(input.robotId), owner: robotOwnerRead(input.robotId) };
        // fix review 5 (R-10-bc) — another factory's robot is refused when the scope is KNOWN (DB within the bound, else memory)
        const sc = await stopScopeForActuate(ctx.user, input.robotId, ctx.sessionToken ?? null);
        if (!sc.allowed) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
        const live = await sendLiveSessionStopFirst({ robotId: input.robotId, requestedBy: ctx.user.id, idempotencyKey: input.idempotencyKey, command: input.command });
        if (live) return live;
      }
      // doc 81 Đợt 1B Task 4 (BE2 T1-G) — `params` được trải thẳng vào job và TechmanDriver đặt
      // nguyên văn `params.script` vào khung TMSCT ⇒ trước đây gửi được BẤT KỲ TM script nào.
      // Có khoá `script` ⇒ tra vendor; Techman chỉ nhận đúng TECHMAN_SCRIPT_ALLOWLIST. Driver còn
      // tự chặn lần nữa (phòng thủ sâu).
      // doc 81 Đợt 1B Task 5 (R10) — cùng mẫu hai lớp (router FORBIDDEN + driver từ chối):
      //   • Techman + verb start/reset/pause ⇒ từ chối `techman_console_verb_unvalidated` (job
      //     `custom` mặc định ScriptExit() ⇒ TMflow chạy tiếp flow, có thể chuyển động);
      //   • UR + `params.script` ⇒ từ chối (URScript tuỳ ý đi thẳng xuống robot);
      //   • UR + `params.home` ⇒ từ chối (movej tới đích tuỳ ý); home CHỈ lấy từ cấu hình robot.
      // Không có khoá script/home và không phải verb start/reset/pause ⇒ không tra CSDL, đường cũ
      // giữ nguyên.
      const params = input.params ?? {};
      const hasParam = (k: string) => Object.prototype.hasOwnProperty.call(params, k);
      if (hasParam("script") || hasParam("home") || isTechmanUnvalidatedConsoleVerb(input.command)) {
        const db = await getDb();
        if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
        const [r] = await db
          .select({ vendor: robots.vendor })
          .from(robots)
          .where(eq(robots.id, input.robotId))
          .limit(1);
        if (!r) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
        if (r.vendor === "techman" && hasParam("script") && !isTechmanScriptAllowed(params.script)) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "sendTechmanScript", reason: "techmanScriptNotAllowlisted" },
            `Techman script is not in the allowlist (${TECHMAN_SCRIPT_ALLOWLIST.join(", ")}) — refused, nothing was sent.`,
          );
        }
        if (r.vendor === "techman" && isTechmanUnvalidatedConsoleVerb(input.command)) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "sendTechmanConsoleVerb", reason: "techmanConsoleVerbUnvalidated" },
            `${TECHMAN_CONSOLE_VERB_UNVALIDATED}: Techman console '${input.command}' is not validated (it would send ScriptExit() and TMflow would continue the flow) — refused, nothing was sent.`,
          );
        }
        if (r.vendor === "ur" && hasParam("script")) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "sendUrScript", reason: "urScriptForbidden" },
            "ur_script_forbidden: raw URScript is not accepted from the console — refused, nothing was sent.",
          );
        }
        if (r.vendor === "ur" && hasParam("home")) {
          throw appError(
            "FORBIDDEN",
            "PERMISSION_DENIED",
            { action: "overrideUrHome", reason: "urHomeParamForbidden" },
            "ur_home_param_forbidden: the UR home pose comes only from the robot's stored configuration — refused, nothing was sent.",
          );
        }
      }
      // doc 81 Đợt 10 task D (design §2.8 / §2.11) — a console STOP for a robot an EDGE node owns (no session here): queued for
      // the node as a signed `stop` command, which the edge SENDS at once (even on a failed signature check — L-7). Motion to
      // such a robot is refused by the dispatcher (ROBOT_OWNED_BY_EDGE). Only when this process has no session for the robot.
      if (verbToJobType(input.command) !== "abort") {
        // fix review 5 (R-10-bc) — MOTION requires the caller's factory scope, read from the DB, fail-closed: unreadable ⇒ refused;
        // another factory's robot (or a missing one) ⇒ the SAME NOT_FOUND (M-4)
        const scope = phamViCua(ctx as never);
        const [lines, stations] = await Promise.all([idsTrongPhamVi("line", scope, { strict: true }), idsTrongPhamVi("station", scope, { strict: true })]);
        if (lines !== null) {
          // a RESTRICTED caller: the robot's line / station must be inside the scope (an unrestricted caller needs no row read)
          const db = await getDb();
          if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable — motion refused (factory scope unverifiable)");
          const [row] = await db.select({ lineId: robots.lineId, stationId: robots.stationId }).from(robots).where(eq(robots.id, input.robotId)).limit(1);
          const inScope = !!row && ((row.lineId != null && lines.includes(row.lineId)) || (row.stationId != null && (stations ?? []).includes(row.stationId)));
          if (!inScope) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");
        }
      }
      if (verbToJobType(input.command) === "abort" && !getActiveRobot(input.robotId)) {
        const r = await consoleStopNoSessionPath(input.robotId, input.command, ctx.user.id, enteredAt, noSessionPre);
        if (r) return r;
        // no robot row / a DB without 0374 ⇒ the existing path (the dispatcher answers honestly)
      }
      const res = await dispatchRobotJob({
        robotId: input.robotId,
        job: {
          jobType: verbToJobType(input.command),
          params: { command: input.command, ...(input.params ?? {}) },
        },
        triggerKind: "manual",
        requestedBy: ctx.user.id,
        confirmedBy: ctx.user.id,
        idempotencyKey: input.idempotencyKey,
      });
      return res;
    }),
});
