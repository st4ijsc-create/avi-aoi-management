/**
 * doc 81 Đợt 10 task D fix review 5 — rulings R-10-bb (STOP-only degraded auth, L-7) and R-10-bc (factory scope of a STOP).
 *
 * THE STOP procedure's authentication (`robotStopProcedure`, used by `robot.consoleStop` ONLY):
 *   1. the session JWT is verified STATELESSLY first (signature + exp, no DB): invalid / expired / absent ⇒ UNAUTHORIZED;
 *   2. in PARALLEL, under ONE bound (STOP_AUTH_BOUND_MS = 300 ms): the full authentication (session ledger + user row + the
 *      forced-password-change gate — sdk.authenticateRequest), the machine_control:canEdit permission, the caller's factory scope
 *      and the robot's factory;
 *   3. a DEFINITE refusal from any of them (revoked / unknown session, account disabled, must change password, permission false,
 *      robot of another factory) ⇒ refused, as everywhere else;
 *   4. if the database did not answer in time (or failed), a valid, unexpired token whose LAST KNOWN identity (robotStopAuthMemo:
 *      what a full authentication resolved for this openId) passes the actuation role floor + 2FA, and whose role carries
 *      machine_control (admin — legacy god-mode — or a remembered canEdit grant), may still STOP. It is audited (best-effort,
 *      retried) and a durable critical alert "STOP accepted on degraded auth" is raised. Nothing remembered ⇒ refused (said so).
 * The procedure accepts STOP verbs only (its input schema); MOTION never takes this path (robot.actuate keeps the full chain).
 * server/_core/context.ts builds the context of a STOP-only request WITHOUT the unbounded auth reads (isStopOnlyCall) — that hunk
 * belongs to the integration commit.
 *
 * Factory scope of a STOP (R-10-bc): the DB scope when it can be read (within the bound); otherwise the caller's last known scope
 * with the robot's factory from robotManager's in-memory map; refused only when both are KNOWN and differ; unknown ⇒ allowed with
 * an anomaly audit (L-7: a STOP is never lost to a scope read).
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { publicProcedure, assertRoleFloor, assertTwoFactorForPrivileged, ACTUATION_ROLES } from "../../_core/trpc";
import { getDb } from "../../db/connection";
import { DbUnavailableError } from "../../_core/dbErrors";
import { appError } from "../../_core/appError";
import {
  STOP_AUTH_BOUND_MS,
  noteAuthenticatedUser,
  noteDefiniteRefusal,
  noteFactoryScope,
  noteMachineControlGrant,
  rememberedFactoryScope,
  rememberedIdentity,
  rememberedMachineControlGrant,
  beginStopAuthWarm,
  type RememberedUser,
} from "./robotStopAuthMemo";

type Leg<T> = { state: "pending" } | { state: "done"; value: T } | { state: "failed"; error: unknown };
function track<T>(p: Promise<T>): { leg: { v: Leg<T> }; done: Promise<void> } {
  const leg: { v: Leg<T> } = { v: { state: "pending" } };
  const done = p.then(
    (value) => void (leg.v = { state: "done", value }),
    (error) => void (leg.v = { state: "failed", error }),
  );
  return { leg, done };
}
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/** A refusal that is an ANSWER (not "the DB could not answer"): 403 / 401 from the auth layer, a TRPCError FORBIDDEN / UNAUTHORIZED. */
function isDefiniteRefusal(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; code?: string; name?: string };
  if (e?.statusCode === 403 || e?.statusCode === 401 || e?.status === 403 || e?.status === 401) return true;
  if (err instanceof TRPCError) return err.code === "FORBIDDEN" || err.code === "UNAUTHORIZED";
  return false;
}

/** The robot's factory id from the DB (robot: COALESCE(station line, robot line) → workshop → factory). null = no factory. */
export async function robotFactoryIdFromDb(robotId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError("database unavailable (robot factory)");
  const rows = (await db.execute(sql`SELECT w."factoryId" AS f FROM public.robots r
      LEFT JOIN public.stations s ON s.id = r."stationId"
      LEFT JOIN public.production_lines l ON l.id = COALESCE(s."lineId", r."lineId")
      LEFT JOIN public.workshops w ON w.id = l."workshopId"
     WHERE r.id = ${robotId}`)) as unknown as Array<{ f: number | null }>;
  const r = Array.isArray(rows) ? rows[0] : (rows as unknown as { rows: Array<{ f: number | null }> }).rows?.[0];
  return r?.f == null ? null : Number(r.f);
}
/** The caller's factory scope (factory ids; null = unrestricted), STRICT: an unanswerable read throws. */
export async function userFactoryIds(user: { id: number; role?: string | null }): Promise<number[] | null> {
  const { resolveTenantFactoryScope } = await import("../../db/reportAggregators");
  const pv = await resolveTenantFactoryScope({ userId: user.id, userRole: String(user.role ?? "") }, { strict: true });
  return pv.factoryIds;
}

export type StopScopeVerdict = { allowed: true; basis: "db" | "memory" | "unrestricted"; unknown?: string } | { allowed: false; detail: string };
/** R-10-bc — decide a STOP's factory scope from what is KNOWN (never reads anything itself). */
export function decideStopScope(a: { robotId: number; userScope: number[] | null | undefined; robotFactory: number | null | undefined; basis: "db" | "memory" }): StopScopeVerdict {
  if (a.userScope === null) return { allowed: true, basis: "unrestricted" };
  // R-10-be — refused only when BOTH are known and they mismatch (an orphan robot is in no restricted scope — M-4)
  if (a.userScope === undefined || a.robotFactory === undefined) {
    const what = [a.userScope === undefined ? "the caller's factory scope" : null, a.robotFactory === undefined ? `robot ${a.robotId}'s factory` : null].filter(Boolean).join(" and ");
    return { allowed: true, basis: a.basis, unknown: `${what} unknown` };
  }
  if (a.robotFactory === null || !a.userScope.includes(a.robotFactory)) return { allowed: false, detail: `robot ${a.robotId} is outside the caller's factories` };
  return { allowed: true, basis: a.basis };
}

export type StopAuthInfo = {
  degraded: boolean;
  /** what could not be verified (degraded) */
  reasons: string[];
  scope: StopScopeVerdict;
};

async function auditLater(entry: { userId: number | null; userName: string | null; action: string; robotId: number | null; details: Record<string, unknown>; ip: string | null }): Promise<void> {
  const write = async () => {
    const { logCrudOperation } = await import("../auditTrailService");
    await logCrudOperation(
      { userId: entry.userId, userName: entry.userName, ipAddress: entry.ip, userAgent: null, source: "trpc" } as never,
      { action: entry.action, entityType: "robot", entityId: entry.robotId ?? undefined, details: entry.details, status: "success" } as never,
    );
  };
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const { withDeadline } = await import("../ot/drivers/boundedClose");
      await withDeadline(write(), 5_000, "stop auth audit");
      return;
    } catch (err) {
      if (attempt === 0) console.error(`[RobotStopAuth] audit "${entry.action}" not written yet (${errText(err)}) — retrying in the background`);
      await new Promise((r) => setTimeout(r, 30_000).unref?.());
    }
  }
  console.error(`[RobotStopAuth] audit "${entry.action}" could not be written: ${JSON.stringify(entry.details).slice(0, 400)}`);
}

/**
 * The middleware. Built on `publicProcedure` (the forced-password-change gate stays the FIRST middleware of the chain — census
 * buocDoiMatKhau §1; with the STOP-only context its user is null there, and the same gate runs INSIDE authenticateRequest here).
 */
/** fix review 6 (NF5-6) — the ONLY verbs this procedure ever lets through (checked on the raw input, before anything else) */
export const STOP_ONLY_VERBS: ReadonlySet<string> = new Set(["stop", "abort"]);

/** fix review 6 (NF5-4) — a definite auth refusal as a tRPC answer (401 / 403), never INTERNAL_SERVER_ERROR */
function refusalAsTrpc(err: unknown): unknown {
  if (err instanceof TRPCError) return err;
  const msg = String((err as Error)?.message ?? err);
  if (/MUST_CHANGE_PASSWORD/.test(msg)) return appError("FORBIDDEN", "MUST_CHANGE_PASSWORD", undefined, msg);
  return appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, `STOP refused: ${msg}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stopAuthMiddleware = async (opts: any) => {
  const { ctx, next } = opts;
  const startedAt = Date.now();
  // R-10-bg — the invalidation generation at the START of this request: its warm writes are dropped if one landed meanwhile
  const warmTicket = beginStopAuthWarm();
  const { sdk } = await import("../../_core/sdk");
  const token = (ctx as { sessionToken?: string | null }).sessionToken ?? null;
  // 1. stateless: signature + expiry
  const jwt = token ? await sdk.verifySession(token) : null;
  if (!jwt) throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "STOP refused: no valid, unexpired session token");
  const raw = (await (opts as unknown as { getRawInput?: () => Promise<unknown> }).getRawInput?.().catch(() => undefined)) as { robotId?: unknown; command?: unknown } | undefined;
  // NF5-6 — STOP verbs only, whatever route is ever built on this procedure
  if (typeof raw?.command !== "string" || !STOP_ONLY_VERBS.has(raw.command)) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "command", reason: "stopOnly" }, "this route accepts STOP verbs only (stop / abort)");
  }
  const robotId = Number.isSafeInteger(raw?.robotId) ? Number(raw!.robotId) : null;
  // R-10-be — the memo of THIS session (jti), ≤ 15 min, never a refused / invalidated one
  const remembered = rememberedIdentity(token);
  const remainingMs = () => Math.max(0, STOP_AUTH_BOUND_MS - (Date.now() - startedAt));
  const settle = async (ps: Array<Promise<void>>) => {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(ps), new Promise<void>((r) => (timer = setTimeout(r, remainingMs())))]);
    clearTimeout(timer);
  };

  // 2. parallel, one bound. Permission / scope start on the remembered identity (if any) so they run CONCURRENTLY with the auth;
  //    without one they wait for the fresh user.
  const auth = track(Promise.resolve().then(() => sdk.authenticateRequest(ctx.req as never)));
  const freshUser = auth.done.then(() => (auth.leg.v.state === "done" ? (auth.leg.v.value as unknown as RememberedUser) : Promise.reject(new Error("identity not resolved"))));
  freshUser.catch(() => undefined); // observed: its rejection is an answer handled below, never an unhandled one
  // NF5-3 — a definite refusal is remembered EVEN when it arrives after the bound (a slow DB that says "revoked")
  void auth.done.then(() => {
    if (auth.leg.v.state === "failed" && isDefiniteRefusal(auth.leg.v.error)) noteDefiniteRefusal(token);
  });
  const startPerm = (u: RememberedUser) =>
    track(
      (async () => {
        const { checkPermission } = await import("../../_core/accessControl");
        return checkPermission(u.id, String(u.role), "machine_control", "canEdit");
      })(),
    );
  const startScope = (u: RememberedUser) => track(userFactoryIds(u));
  let permFor: RememberedUser | null = remembered;
  let perm: ReturnType<typeof startPerm> = remembered ? startPerm(remembered) : { leg: { v: { state: "pending" } }, done: new Promise<void>(() => undefined) };
  let scope = remembered ? startScope(remembered) : null;
  const robotFactory = track(robotId === null ? Promise.resolve(undefined as number | null | undefined) : robotFactoryIdFromDb(robotId));
  if (!remembered) {
    // no memo: permission + scope follow the fresh user (still inside the same bound)
    const chained = freshUser.then((u) => {
      permFor = u;
      perm = startPerm(u);
      scope = startScope(u);
      return Promise.all([perm.done, scope.done]).then(() => undefined);
    });
    await settle([auth.done, robotFactory.done, chained.catch(() => undefined)]);
  } else {
    await settle([auth.done, perm.done, scope!.done, robotFactory.done]);
  }

  // 3. definite refusals — and a refused session is remembered AS refused (R-10-be)
  const reasons: string[] = [];
  const a = auth.leg.v;
  if (a.state === "failed" && isDefiniteRefusal(a.error)) {
    noteDefiniteRefusal(token);
    throw refusalAsTrpc(a.error);
  }
  let user: RememberedUser | null = null;
  let fresh = false;
  if (a.state === "done") {
    user = a.value as unknown as RememberedUser;
    fresh = true;
    noteAuthenticatedUser(a.value as never, token, warmTicket);
    // FRESH WINS: a permission / scope computed for a remembered identity that is not exactly this user + role is discarded and
    // redone for the fresh user within what is left of the bound
    if (!permFor || permFor.id !== user.id || permFor.role !== user.role) {
      permFor = user;
      perm = startPerm(user);
      scope = startScope(user);
      await settle([perm.done, scope.done]);
    }
  } else {
    reasons.push(a.state === "pending" ? `session / user not verified within ${STOP_AUTH_BOUND_MS} ms` : `session / user check failed (${errText(a.error)})`);
    if (remembered) {
      if (remembered.isActive === false) throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "insufficientRole" }, "STOP refused: account disabled");
      user = remembered;
    }
  }
  if (!user) {
    void raiseDegradedAlert(null, robotId, `STOP REFUSED on degraded auth: the database did not answer and this server holds no valid memory of the session (${reasons.join("; ")}) — use the hardware E-STOP`);
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "STOP refused: identity could not be verified (database unavailable) — use the hardware E-STOP");
  }
  assertRoleFloor(user, ACTUATION_ROLES);
  assertTwoFactorForPrivileged(user);
  const p = perm.leg.v;
  if (p.state === "done") {
    if (p.value !== true) throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "insufficientRole" }, "STOP refused: machine_control:canEdit is required");
  } else {
    reasons.push(p.state === "failed" ? `permission check failed (${errText(p.error)})` : "permission not verified in time");
    const adminGodMode = user.role === "admin" && process.env.RBAC_SCOPED_ADMIN !== "true";
    if (!adminGodMode && !rememberedMachineControlGrant(token, user.id)) {
      void raiseDegradedAlert(user, robotId, `STOP REFUSED on degraded auth: user #${user.id}'s session holds no remembered machine_control grant (${reasons.join("; ")}) — use the hardware E-STOP`);
      throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "insufficientRole" }, "STOP refused: permission could not be verified (database unavailable) — use the hardware E-STOP");
    }
  }
  // the scope: DB when read in time, else memory (this session's last scope + robotManager's robot → factory map)
  const s = scope ? scope.leg.v : ({ state: "pending" } as Leg<number[] | null>);
  const rf = robotFactory.leg.v;
  if (rf.state === "done" && robotId !== null && rf.value !== undefined) await noteRobotFactoryInMemory(robotId, rf.value);
  if (s.state === "done") noteFactoryScope(token, user.id, s.value, warmTicket);
  const inMemory = await robotFactoryFromMemory();
  const verdict = decideStopScope({
    robotId: robotId ?? -1,
    userScope: s.state === "done" ? s.value : rememberedFactoryScope(token, user.id),
    robotFactory: rf.state === "done" ? rf.value : robotId === null ? undefined : inMemory(robotId),
    basis: s.state === "done" && rf.state === "done" ? "db" : "memory",
  });
  if (!verdict.allowed) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "robot not found");

  const degraded = reasons.length > 0;
  if (fresh && p.state === "done" && p.value === true) noteMachineControlGrant(token, user.id, String(user.role), warmTicket);
  if (degraded) {
    const what = `STOP accepted on degraded auth: user #${user.id} (${user.role}), robot ${robotId ?? "?"} — ${reasons.join("; ")}`;
    void raiseDegradedAlert(user, robotId, what);
    void auditLater({ userId: user.id, userName: user.name ?? null, action: "robot.stop.degradedAuth", robotId, details: { reasons, ruling: "R-10-bb" }, ip: (ctx.req as { ip?: string } | undefined)?.ip ?? null });
  }
  if (verdict.allowed && verdict.unknown) {
    // R-10-be — scope unknown (L-7: the STOP is not lost to it): anomaly audit + durable alert
    void raiseDegradedAlert(user, robotId, `STOP accepted with an UNKNOWN factory scope: ${verdict.unknown} (user #${user.id}, robot ${robotId ?? "?"})`);
    void auditLater({ userId: user.id, userName: user.name ?? null, action: "robot.stop.scopeUnknown", robotId, details: { anomaly: verdict.unknown, basis: verdict.basis, ruling: "R-10-bc" }, ip: (ctx.req as { ip?: string } | undefined)?.ip ?? null });
  }
  const info: StopAuthInfo = { degraded, reasons, scope: verdict };
  return next({ ctx: { ...ctx, user: user as never, stopAuth: info } });
};

/**
 * fix review 6 (NF5-7) — robot.consoleStop is audited like every other mutation (a trpc_mutation row, success | failure), but only
 * AFTER the procedure has run — the STOP is sent first, the audit never delays it (L-7). Fire-and-forget.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const auditAfterStopMiddleware = async (opts: any) => {
  const { ctx, next, path } = opts;
  const startedAt = Date.now();
  const result = await next();
  try {
    const u = ctx.user as { id?: number; name?: string } | null;
    const errorCode = result.ok ? undefined : (result as { error?: { code?: string } }).error?.code;
    const degraded = (ctx as { stopAuth?: StopAuthInfo }).stopAuth?.degraded;
    void import("../auditTrailService")
      .then(({ logCrudOperation }) =>
        logCrudOperation(
          { userId: u?.id ?? null, userName: u?.name ?? null, ipAddress: ctx.req?.ip ?? null, userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null, source: "trpc" } as never,
          {
            action: path,
            entityType: "trpc_mutation",
            details: { operation: "mutation", duration: Date.now() - startedAt, metadata: { path, ok: result.ok, ...(degraded ? { degradedAuth: true } : {}) }, ...(errorCode ? { errorMessage: errorCode } : {}) },
            status: result.ok ? "success" : "failure",
          } as never,
        ),
      )
      .catch(() => undefined);
  } catch {
    /* auditing never affects the STOP */
  }
  return result;
};

/** THE STOP-only procedure (census: robot.consoleStop is its ONLY user — robotStopProcedureCensus.dot10.test.ts). */
export const robotStopProcedure = publicProcedure.use(stopAuthMiddleware).use(auditAfterStopMiddleware);

/** robotManager's robot → factory map, read defensively: an unreadable map is "unknown", never an error on the STOP path */
export async function robotFactoryFromMemory(): Promise<(robotId: number) => number | null | undefined> {
  try {
    const m = await import("./robotManager");
    const f = m.robotFactoryIdInMemory;
    return (id) => {
      try {
        return f(id);
      } catch {
        return undefined;
      }
    };
  } catch {
    return () => undefined;
  }
}
export async function noteRobotFactoryInMemory(robotId: number, factoryId: number | null): Promise<void> {
  try {
    (await import("./robotManager")).noteRobotFactory(robotId, factoryId);
  } catch {
    /* the memory map is best-effort */
  }
}

function raiseDegradedAlert(user: { id: number } | null, robotId: number | null, message: string): Promise<void> {
  return import("./criticalStopAlert").then(({ raiseCriticalStopAlert }) =>
    raiseCriticalStopAlert({
      kind: "stop_degraded_auth",
      title: `STOP on degraded auth — robot ${robotId ?? "?"}`,
      message,
      recipients: user ? [user.id] : [],
      dedupKey: `stop_degraded_auth:${robotId ?? "?"}:${Date.now()}`,
      source: "robot",
      entityType: "robot",
      entityId: robotId ?? undefined,
      retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
    }),
  );
}
