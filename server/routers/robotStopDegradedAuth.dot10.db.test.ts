/**
 * doc 81 Đợt 10 task D fix review 5 — rulings R-10-bb (STOP-only degraded auth, L-7), R-10-be (its memory) and R-10-bc (factory
 * scope), through the REAL chain: real createContext (STOP-only branch) → real tRPC middlewares (password gate, robotStopProcedure,
 * actuationProcedure + requirePermission for robot.actuate) → the router. Real `_test` rows (user, session, permission, factory
 * chain, robots, assignment); the DATABASE is made to hang / die by wrapping getDb only; the robot driver is a fake live session.
 *   • DB hanging: the STOP reaches the driver within the bound, accepted on degraded auth (alert + audit);
 *   • DB dead: STOP accepted + "STOP accepted on degraded auth";
 *   • an invalid / expired token is refused; MOTION never takes the STOP route; MOTION with the DB hanging never reaches the driver;
 *   • R-10-be: a revoked session, a disabled user, an expired memory, a role change ⇒ no STOP from memory;
 *   • R-10-bc: another factory's STOP and MOVE are refused (scope known).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
// the session JWT secret (read by _core/env at import): a test secret when the environment has none
vi.hoisted(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "dot10-stop-degraded-auth-test-secret-0123456789";
});
const H = vi.hoisted(() => ({ audits: [] as Array<{ action: string; entityType: string; at: number }>, mode: "ok" as "ok" | "hang" | "dead" | "slow" | "delay", sent: [] as Array<{ robot: number; jobType: string; at: number }>, t0: 0, alerts: [] as string[], live: new Set<number>() }));
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return {
    ...actual,
    getDb: async (...args: unknown[]) => {
      if (H.mode === "hang") return new Promise<never>(() => undefined);
      if (H.mode === "dead") throw new Error("connect ECONNREFUSED 127.0.0.1:5434");
      if (H.mode === "slow") await new Promise((r) => setTimeout(r, 450));
      if (H.mode === "delay") await new Promise((r) => setTimeout(r, 35));
      return (actual.getDb as (...a: unknown[]) => unknown)(...args);
    },
  };
});
vi.mock("../services/robot/robotManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/robot/robotManager")>();
  return {
    ...actual,
    getActiveRobot: (id: number) =>
      H.live.has(id)
        ? {
            id,
            code: `R${id}`,
            vendor: "fanuc",
            driver: {
              vendor: "fanuc",
              isConnected: () => true,
              runJob: async (job: { jobType: string }) => (H.sent.push({ robot: id, jobType: job.jobType, at: Date.now() - H.t0 }), { ok: true }),
            },
          }
        : undefined,
  };
});
vi.mock("../services/auditTrailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/auditTrailService")>();
  return {
    ...actual,
    logCrudOperation: async (...a: Parameters<typeof actual.logCrudOperation>) => {
      const e = a[1] as unknown as { action: string; entityType: string };
      H.audits.push({ action: e.action, entityType: e.entityType, at: Date.now() - H.t0 });
      return actual.logCrudOperation(...a);
    },
  };
});
vi.mock("../services/robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: { message: string }) => void H.alerts.push(a.message),
}));

import { createContext } from "../_core/context";
import { sdk } from "../_core/sdk";
import { COOKIE_NAME } from "@shared/const";
import { robotRouter } from "./robotRouter";
import { invalidateAuthSession, invalidateAuthUser, clearAuthSessionCache } from "../services/authSessionCache";
import { _resetStopAuthMemoForTests, _setStopAuthMemoTtlMsForTests, invalidatesStopAuthMemo, clearAllStopAuthMemo, invalidateForAuthorizationChange } from "../services/robot/robotStopAuthMemo";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `D10BB-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
const ids = { user: 0, f1: 0, w1: 0, l1: 0, f2: 0, w2: 0, l2: 0, robot: 0, other: 0 };
const openId = `${TAG}-oid`;
const env: Record<string, string | undefined> = {};

async function token(expiresInMs = 60 * 60 * 1000): Promise<string> {
  const t = await sdk.signSession({ openId, appId: "dot10-test", name: "dot10 engineer" }, { expiresInMs });
  await sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${ids.user}, ${t}, now() + interval '1 hour', true)`;
  return t;
}
async function call(tok: string, path: "robot.consoleStop" | "robot.actuate" | "robot.list") {
  const req = { headers: { cookie: `${COOKIE_NAME}=${tok}` }, ip: "127.0.0.1" } as never;
  const ctx = await createContext({ req, res: {} as never, info: { calls: [{ path }] } as never });
  return robotRouter.createCaller(ctx as never);
}
async function stop(tok: string, robotId = ids.robot) {
  H.t0 = Date.now();
  return (await call(tok, "robot.consoleStop")).consoleStop({ robotId, command: "stop" });
}
/** a normal STOP with the DB up: the session's memory is written by the real chain (identity + grant + scope) */
async function warm(tok: string) {
  H.mode = "ok";
  const r = await stop(tok);
  expect(r).toMatchObject({ ok: true, status: "done" });
  expect((r as { degradedAuth?: boolean }).degradedAuth).toBe(false);
  H.sent = [];
  H.alerts = [];
}

describe.skipIf(!onTest)("R-10-bb / R-10-be / R-10-bc — the console STOP route through the real chain (_test)", () => {
  beforeAll(async () => {
    for (const k of ["ROBOT_CONTROL_ENABLED", "AUTH_CACHE_TTL_S"]) env[k] = process.env[k];
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.AUTH_CACHE_TTL_S = "0"; // no auth cache: the DB answers (or not) every time
    sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
    ids.user = Number((await sql`INSERT INTO users ("openId", name, role, "isActive", two_factor_enabled, "loginMethod") VALUES (${openId}, 'dot10 engineer', 'engineer', true, true, 'local') RETURNING id`)[0].id);
    const [{ c }] = await sql`SELECT e.enumlabel AS c FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = (SELECT udt_name FROM information_schema.columns WHERE table_name = 'permissions' AND column_name = 'category') ORDER BY e.enumsortorder LIMIT 1`;
    await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${ids.user}, ${c}, 'machine_control', true, true)`;
    const chain = async (s: string) => {
      const f = Number((await sql`INSERT INTO factories (code, name) VALUES (${`${TAG}-F${s}`}, 'f') RETURNING id`)[0].id);
      const w = Number((await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`${TAG}-W${s}`}, 'w') RETURNING id`)[0].id);
      const l = Number((await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w}, ${`${TAG}-L${s}`}, 'l') RETURNING id`)[0].id);
      return { f, w, l };
    };
    const a = await chain("1");
    const b = await chain("2");
    Object.assign(ids, { f1: a.f, w1: a.w, l1: a.l, f2: b.f, w2: b.w, l2: b.l });
    ids.robot = Number((await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId") VALUES (${`${TAG}-R1`}, 'r', 'fanuc', 'tcp://192.0.2.1:1', true, ${a.l}) RETURNING id`)[0].id);
    ids.other = Number((await sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId") VALUES (${`${TAG}-R2`}, 'r', 'fanuc', 'tcp://192.0.2.1:1', true, ${b.l}) RETURNING id`)[0].id);
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.user}, ${`${TAG}-F1`})`;
    H.live = new Set([ids.robot, ids.other]);
  });
  afterAll(async () => {
    H.mode = "ok";
    _setStopAuthMemoTtlMsForTests(null);
    for (const [k, v] of Object.entries(env)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
    await sql`DELETE FROM robot_jobs WHERE "robotId" IN (${ids.robot}, ${ids.other})`.catch(() => undefined);
    await sql`DELETE FROM robots WHERE id IN (${ids.robot}, ${ids.other})`.catch(() => undefined);
    await sql`DELETE FROM user_factory_assignments WHERE "userId" = ${ids.user}`.catch(() => undefined);
    await sql`DELETE FROM permissions WHERE "userId" = ${ids.user}`.catch(() => undefined);
    await sql`DELETE FROM user_sessions WHERE "userId" = ${ids.user}`.catch(() => undefined);
    for (const t of ["production_lines", "workshops", "factories"] as const) {
      const col = { production_lines: [ids.l1, ids.l2], workshops: [ids.w1, ids.w2], factories: [ids.f1, ids.f2] }[t];
      await sql`DELETE FROM ${sql(t)} WHERE id IN ${sql(col)}`.catch(() => undefined);
    }
    await sql`DELETE FROM users WHERE id = ${ids.user}`.catch(() => undefined);
    await sql.end();
  });
  beforeEach(async () => {
    H.mode = "ok";
    H.sent = [];
    H.alerts = [];
    _resetStopAuthMemoForTests();
    _setStopAuthMemoTtlMsForTests(null);
    await clearAuthSessionCache().catch(() => undefined);
    await sql`UPDATE users SET role = 'engineer', "isActive" = true WHERE id = ${ids.user}`;
  });

  it("★ DB HANGING ⇒ the STOP reaches the driver within the bound, accepted on degraded auth (durable alert)", async () => {
    const tok = await token();
    await warm(tok);
    H.mode = "hang";
    const r = await stop(tok);
    expect(H.sent).toEqual([expect.objectContaining({ robot: ids.robot, jobType: "abort" })]);
    expect(H.sent[0].at).toBeLessThan(600); // 300 ms auth bound + the send
    expect(r).toMatchObject({ ok: true, status: "done", degradedAuth: true });
    expect(H.alerts.join("\n")).toMatch(/STOP accepted on degraded auth/);
  });

  it("★ DB DEAD ⇒ STOP accepted + 'STOP accepted on degraded auth'", async () => {
    const tok = await token();
    await warm(tok);
    H.mode = "dead";
    const r = await stop(tok);
    expect(r).toMatchObject({ ok: true, degradedAuth: true });
    expect(H.sent.map((s) => s.jobType)).toEqual(["abort"]);
    expect(H.alerts.join("\n")).toMatch(/STOP accepted on degraded auth/);
  });

  it("★ an invalid or EXPIRED token is refused (even with the DB hanging); no memory of the session ⇒ refused", async () => {
    const tok = await token();
    await warm(tok);
    H.mode = "hang";
    await expect(stop(`${tok.slice(0, -4)}AAAA`)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const expired = await sdk.signSession({ openId, appId: "dot10-test", name: "dot10 engineer" }, { expiresInMs: -60_000 });
    await expect(stop(expired)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const fresh = await (async () => {
      H.mode = "ok";
      const t = await token();
      H.mode = "hang";
      return t;
    })();
    await expect(stop(fresh)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); // valid token, never fully authenticated here
    expect(H.sent).toEqual([]);
  });

  it("★ MOTION never takes the STOP route; MOTION with the DB hanging never reaches the driver", async () => {
    const tok = await token();
    await warm(tok);
    H.mode = "hang";
    await expect((await call(tok, "robot.consoleStop")).consoleStop({ robotId: ids.robot, command: "home" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const move = (async () => (await call(tok, "robot.actuate")).actuate({ robotId: ids.robot, command: "home" }))().then(
      (v) => ({ settled: true, v }),
      (e) => ({ settled: true, e }),
    );
    const res = await Promise.race([move, new Promise((r) => setTimeout(() => r({ settled: false }), 1_500))]);
    expect(res).toMatchObject({ settled: false }); // still waiting on the DB — never sent
    expect(H.sent).toEqual([]);
  });

  it("★ R-10-be — a REVOKED session cannot STOP from memory (logout path, and a definite DB answer is remembered as a refusal)", async () => {
    const tok = await token();
    await warm(tok);
    await invalidateAuthSession(tok); // the product's logout / revoke path
    H.mode = "hang";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const tok2 = await token();
    await warm(tok2);
    await sql`UPDATE user_sessions SET "isActive" = false WHERE "sessionToken" = ${tok2}`; // revoked behind the product's back
    H.mode = "ok";
    await expect(stop(tok2)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); // the DB answers: revoked (NF5-4: 401)
    H.mode = "hang";
    await expect(stop(tok2)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); // remembered AS refused
    expect(H.sent).toEqual([]);
  });

  it("★ R-10-be — a DISABLED user cannot STOP from memory", async () => {
    const tok = await token();
    await warm(tok);
    await sql`UPDATE users SET "isActive" = false WHERE id = ${ids.user}`;
    await invalidateAuthUser(ids.user); // what the product's disable path calls
    H.mode = "hang";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(H.sent).toEqual([]);
  });

  it("★ R-10-be — the memory EXPIRES (≤ 15 min; seam-shortened here)", async () => {
    const tok = await token();
    await warm(tok);
    _setStopAuthMemoTtlMsForTests(50);
    await new Promise((r) => setTimeout(r, 80));
    H.mode = "hang";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(H.sent).toEqual([]);
  });

  it("★ R-10-be — a ROLE change invalidates the memory; a permissions mutation drops every session's memory", async () => {
    const tok = await token();
    await warm(tok);
    await sql`UPDATE users SET role = 'viewer' WHERE id = ${ids.user}`;
    await invalidateAuthUser(ids.user); // updateUserRole's invalidation
    H.mode = "hang";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await sql`UPDATE users SET role = 'engineer' WHERE id = ${ids.user}`;
    const tok2 = await token();
    await warm(tok2);
    expect(invalidatesStopAuthMemo("permissions.updateUserPermission")).toBe(true);
    expect(invalidatesStopAuthMemo("user.updateProfile")).toBe(false); // self-service: per user, in the db layer (NF5-1)
    expect(invalidatesStopAuthMemo("robot.consoleStop")).toBe(false);
    clearAllStopAuthMemo(); // what the tRPC audit middleware does for such a path
    H.mode = "hang";
    await expect(stop(tok2)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("★ R-10-bc — another factory's STOP is refused (scope known); its MOVE is refused too; the own factory's MOVE is not refused on scope", async () => {
    const tok = await token();
    await warm(tok);
    await expect(stop(tok, ids.other)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect((await call(tok, "robot.actuate")).actuate({ robotId: ids.other, command: "home" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect((await call(tok, "robot.actuate")).actuate({ robotId: ids.other, command: "stop" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(H.sent).toEqual([]);
    const own = await (await call(tok, "robot.actuate")).actuate({ robotId: ids.robot, command: "home" });
    expect((own as { error?: string }).error).not.toBe("ENTITY_NOT_FOUND");
  });
  it("★ R-10-be — FRESH results win: a role changed behind the product's back (no invalidation) is applied as soon as the DB answers", async () => {
    const tok = await token();
    await warm(tok);
    await sql`UPDATE users SET role = 'viewer' WHERE id = ${ids.user}`; // no invalidateAuthUser: the memo still says engineer
    H.mode = "ok";
    await expect(stop(tok)).rejects.toMatchObject({ code: "FORBIDDEN" }); // the fresh row (viewer) decides
    expect(H.sent).toEqual([]);
  });
  it("★ R-10-be — FRESH results win for the permission too: memo says admin (no permission read needed), the DB now says engineer WITHOUT machine_control ⇒ refused", async () => {
    await sql`UPDATE users SET role = 'admin' WHERE id = ${ids.user}`;
    const tok = await token();
    await warm(tok);
    await sql`UPDATE users SET role = 'engineer' WHERE id = ${ids.user}`; // behind the product's back
    await sql`UPDATE permissions SET "canEdit" = false WHERE "userId" = ${ids.user} AND "moduleName" = 'machine_control'`;
    try {
      H.mode = "ok";
      await expect(stop(tok)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(H.sent).toEqual([]);
    } finally {
      await sql`UPDATE permissions SET "canEdit" = true WHERE "userId" = ${ids.user} AND "moduleName" = 'machine_control'`;
    }
  });
  // ── fix review 6 (R-10-bf) ─────────────────────────────────────────────────────────────────────────────────────────────────
  it("★ NF5-1 — an engineer who has only BROWSED (robot list) can STOP with the DB hanging AND dead; the grant came from the read the chain already did", async () => {
    const tok = await token();
    H.mode = "ok";
    await (await call(tok, "robot.list" as never)).list(); // requirePermission(machine_control, canView): the row carries canEdit
    await new Promise((r) => setTimeout(r, 50)); // the memo is warmed fire-and-forget
    H.mode = "hang";
    expect(await stop(tok)).toMatchObject({ ok: true, degradedAuth: true });
    H.mode = "dead";
    expect(await stop(tok)).toMatchObject({ ok: true, degradedAuth: true });
    expect(H.sent.map((s) => s.jobType)).toEqual(["abort", "abort"]);
  });

  it("★ NF5-1 — invalidation is PER USER: a viewer editing their own profile (and a permissions change for that viewer) leaves the engineer's memory", async () => {
    const tok = await token();
    await warm(tok);
    const viewerOpenId = `${TAG}-viewer-${Date.now()}`;
    const viewer = Number((await sql`INSERT INTO users ("openId", name, role, "isActive", two_factor_enabled, "loginMethod") VALUES (${viewerOpenId}, 'dot10 viewer', 'viewer', true, false, 'local') RETURNING id`)[0].id);
    try {
      const vt = await sdk.signSession({ openId: viewerOpenId, appId: "dot10-test", name: "dot10 viewer" }, { expiresInMs: 3_600_000 });
      await sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${viewer}, ${vt}, now() + interval '1 hour', true)`;
      const { appRouter } = await import("../routers");
      const req = { headers: { cookie: `${COOKIE_NAME}=${vt}` }, ip: "127.0.0.1" } as never;
      const vctx = await createContext({ req, res: {} as never, info: { calls: [{ path: "user.updateProfile" }] } as never });
      await appRouter.createCaller(vctx as never).user.updateProfile({ name: "dot10 viewer renamed" }); // through the real audit middleware
      invalidateForAuthorizationChange({ userId: viewer }); // what a permissions.* / userAssignment.* mutation for the viewer does
      H.mode = "hang";
      expect(await stop(tok)).toMatchObject({ ok: true, degradedAuth: true }); // the engineer is untouched
    } finally {
      H.mode = "ok";
      await sql`DELETE FROM user_sessions WHERE "userId" = ${viewer}`.catch(() => undefined);
      await sql`DELETE FROM users WHERE id = ${viewer}`.catch(() => undefined);
    }
    invalidateForAuthorizationChange({}); // no affected user named ⇒ every user (fail-closed)
    H.mode = "hang";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("★ NF5-3 — a 'revoked' answer that arrives AFTER the bound is remembered: the next STOP from memory is refused", async () => {
    const tok = await token();
    await warm(tok);
    await sql`UPDATE user_sessions SET "isActive" = false WHERE "sessionToken" = ${tok}`; // another replica's revoke
    H.mode = "slow"; // every query 450 ms: the answer lands after the 300 ms bound
    expect(await stop(tok)).toMatchObject({ ok: true, degradedAuth: true }); // the first STOP cannot know yet (bounded)
    await new Promise((r) => setTimeout(r, 1_200)); // the late "revoked" lands
    H.mode = "hang";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("★ NF5-4 — a revoked session gets UNAUTHORIZED (401), never INTERNAL_SERVER_ERROR", async () => {
    const tok = await token();
    await sql`UPDATE user_sessions SET "isActive" = false WHERE "sessionToken" = ${tok}`;
    H.mode = "ok";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("★ NF5-7 — robot.consoleStop is audited (trpc_mutation) AFTER the send, never before", async () => {
    const tok = await token();
    await warm(tok);
    H.audits.length = 0;
    await stop(tok);
    const t0 = Date.now();
    while (!H.audits.some((a) => /consoleStop$/.test(a.action)) && Date.now() - t0 < 2_000) await new Promise((r) => setTimeout(r, 20));
    const a = H.audits.find((x) => /consoleStop$/.test(x.action) /* robot.consoleStop on appRouter */);
    expect(a).toMatchObject({ entityType: "trpc_mutation" });
    expect(a!.at).toBeGreaterThanOrEqual(H.sent[0].at); // after the STOP reached the driver
  });
  it("★ NF5-6 — the STOP-only procedure itself refuses a non-STOP verb (any route built on it), before any DB read", async () => {
    const { z } = await import("zod");
    const { router } = await import("../_core/trpc");
    const { robotStopProcedure } = await import("../services/robot/robotStopAuth");
    const probe = router({ any: robotStopProcedure.input(z.any()).mutation(() => "RAN") });
    const tok = await token();
    await warm(tok);
    H.mode = "hang";
    const req = { headers: { cookie: `${COOKIE_NAME}=${tok}` }, ip: "127.0.0.1" } as never;
    const ctx = await createContext({ req, res: {} as never, info: { calls: [{ path: "robot.consoleStop" }] } as never });
    const t0 = Date.now();
    await expect(probe.createCaller(ctx as never).any({ robotId: ids.robot, command: "home" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(Date.now() - t0).toBeLessThan(150); // refused before the 300 ms auth bundle
  });
  it("★ R-10-bg — through the real chain: a session revoked WHILE its STOP's full auth is in flight is not re-warmed by that auth", async () => {
    const tok = await token();
    await warm(tok);
    H.mode = "delay"; // each DB step 35 ms: the full auth finishes INSIDE the 300 ms bound, after the revoke below
    const inflight = stop(tok);
    await new Promise((r) => setTimeout(r, 10));
    await invalidateAuthSession(tok); // the product's logout / revoke lands mid-flight
    const r = await inflight;
    expect((r as { degradedAuth?: boolean }).degradedAuth).toBe(false); // the in-flight FULL auth did finish — its warm write was attempted
    H.mode = "hang";
    await expect(stop(tok)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); // the in-flight auth did NOT resurrect the session
  });
});
