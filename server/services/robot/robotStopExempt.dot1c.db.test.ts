/**
 * doc 81 Đợt 1C Task 3 fix round 1 (ruling R-1C-c, 2026-09-27) — LỆNH DỪNG KHÔNG BAO GIỜ BỊ CHẶN.
 *
 * Luật chủ dự án "STOP/abort không bao giờ bị chặn" = nguyên tắc L-7 theo HƯỚNG NĂNG LƯỢNG: một lệnh
 * GIẢM năng lượng (dừng) được miễn TOÀN BỘ khối HITL/xác nhận, bất kể triggerKind — vẫn có hàng sổ ghi.
 * Trước fix round này, ba đường DỪNG thật bị từ chối:
 *   (a) bước 2.a từ chối 'hitl' abort không confirmedBy;
 *   (b) api/v1 POST /equipment/:id/commands không bao giờ gắn confirmedBy ⇒ MỌI abort robot qua REST bị từ chối
 *       (và actionId `apiv1-…` không tồn tại ⇒ bước tái xác minh cũng từ chối);
 *   (c) robotJobMapping ánh xạ `e_stop`/`stop` ⇒ `custom` (= chuyển động) ⇒ 2.a + safety + interlock + khoá
 *       chuyển động + slot R14 đều áp lên một lệnh dừng khẩn;
 *   (d) FOE abort với user hệ thống (confirmedBy 0) bị từ chối.
 *
 * Môi trường THÙ ĐỊCH có chủ đích: safety-PLC báo BLOCKED (e-stop), interlock đang vi phạm, driver đang KHOÁ
 * chuyển động, và (một ca) một chuyển động đang bay giữ slot R14 — lệnh dừng vẫn phải tới driver ĐÚNG MỘT lần,
 * dưới dạng job `abort`. CSDL THẬT (`_test`); driver giả đếm từng job nó nhận (oracle độc lập).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, like } from "drizzle-orm";

const ROBOT_ID_HOISTED = vi.hoisted(() => ({ id: 990_720_000 + (Date.now() % 9_000) }));
const MACHINE_ID_HOISTED = vi.hoisted(() => ({ id: 990_720_000 + (Date.now() % 9_000) + 50_000 }));
const env = vi.hoisted(() => ({
  hostile: false,
  jobs: [] as Array<{ jobType: string; params?: Record<string, unknown> }>,
  releaseMotion: null as null | (() => void),
  holdMotion: false,
  safetyReads: 0,
  interlockEvals: 0,
  // Fix round 2 (b) — policy engine giả: bật SEC_PLATFORM và trả verdict cho từng action.
  policyOn: false,
  policyVerdict: {} as Record<string, "deny" | "require_approval">,
  policyCalls: [] as string[],
}));

vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === ROBOT_ID_HOISTED.id
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            getMotionLock: () => (env.hostile ? { locked: true, since: "2026-09-27T00:00:00Z", reasonCode: "motion_locked_after_link_loss" } : { locked: false }),
            runJob: async (job: { jobType: string; params?: Record<string, unknown> }) => {
              env.jobs.push(job);
              if (job.jobType !== "abort" && env.holdMotion) {
                await new Promise<void>((r) => {
                  env.releaseMotion = r;
                });
              }
              return { ok: true, status: "done", detail: { fake: true } };
            },
            abort: async () => undefined,
            health: async () => ({ vendor: "sim", connected: true }),
          },
        }
      : undefined,
}));

// Safety-PLC nền: thật (facade thật), nguồn giả — môi trường thù địch ⇒ e-stop đang BẬT (BLOCKED).
vi.mock("../safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: () => true,
  listPlcConfigs: async () => [{ code: "SPLC-1", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
  backendForConfig: () => ({
    read: async () => {
      env.safetyReads++;
      return { estop: env.hostile };
    },
    readChecked: async () => {
      env.safetyReads++;
      return { status: { estop: env.hostile }, unreadable: [] };
    },
  }),
  statusToFindings: (s: { estop?: boolean }) => (s?.estop ? [{ kind: "estop", severity: "critical", message: "E-STOP active" }] : []),
}));

vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: async () => {
    env.interlockEvals++;
    return env.hostile
      ? { blocked: true, failClosed: false, violations: [{ ruleId: 1, action: "block" }] }
      : { blocked: false, failClosed: false, violations: [] };
  },
}));

// Fix round 2 (b) — seam policy: SEC_PLATFORM và verdict điều khiển được; tắt ⇒ bản THẬT (allow-all).
vi.mock("../security/policyGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../security/policyGate")>();
  return {
    ...orig,
    secPlatformEnabled: (...a: Parameters<typeof orig.secPlatformEnabled>) => (env.policyOn ? true : orig.secPlatformEnabled(...a)),
    evaluateActionPolicy: (subject: string, action: string, resource: string | null, context?: Record<string, unknown>, opts?: any) => {
      if (!env.policyOn) return orig.evaluateActionPolicy(subject, action, resource, context, opts);
      env.policyCalls.push(action);
      const v = env.policyVerdict[action];
      if (v === "deny") return { allow: false, effect: "deny" as const, reason: "stop cấm theo policy P-T3", policyId: "p-t3-deny", reasonCode: "POLICY_DENIED", obligations: [] };
      if (v === "require_approval")
        return { allow: false, effect: "require_approval" as const, reason: "cần phê duyệt", policyId: "p-t3-approve", reasonCode: "APPROVAL_REQUIRED", obligations: ["require_approval"] };
      return { allow: true, effect: "allow" as const, reason: "ok", policyId: null, reasonCode: "DEFAULT_ALLOW", obligations: [] };
    },
  };
});

// /api/v1: master key + một máy ROBOT (máy id riêng; robotId truyền qua args).
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("../../db", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    getMachineById: async (id: number) =>
      id === MACHINE_ID_HOISTED.id
        ? { id, code: "T3-ROBOT", name: "T3 robot", machineType: "ROBOT", operationStatus: "running", capabilities: null, stationId: 1 }
        : undefined,
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, robotJobs, controlAuditLog } from "../../../drizzle/schema";
import { dispatchRobotJob } from "./robotCommandDispatcher";
import { toRobotJob } from "../equipment/robotJobMapping";
import { createV1Router } from "../../api/v1/router";

const DB_URL = process.env.DATABASE_URL;
const ROBOT = ROBOT_ID_HOISTED.id;
const MACHINE = MACHINE_ID_HOISTED.id;
const DAU = `T3STOP-${Date.now()}`;
const OWNER = 990_720_101;

let server: Server;
let base = "";

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}
async function jobRow(jobId: number | undefined) {
  if (jobId == null) return undefined;
  const [row] = await (await d()).select().from(robotJobs).where(eq(robotJobs.id, jobId)).limit(1);
  return row;
}
async function postCommand(command: string, idem: string) {
  const res = await fetch(`${base}/api/v1/equipment/${MACHINE}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer MASTER" },
    body: JSON.stringify({ command, args: { robotId: ROBOT }, idempotencyKey: idem }),
  });
  return { status: res.status, body: (await res.json()) as any };
}
/** Chạy một bước lệnh FOE đúng như execStep: build command → ensureOrchestrationAction → adapter.sendCommand. */
async function foeStep(command: string, user: { id: number; role: string }) {
  const { buildEquipmentCommand, ensureOrchestrationAction } = await import("../orchestration/foe/foeEngine");
  const { getCapabilitiesForMachine } = await import("../equipment/capabilityModel");
  const { equipmentRegistry } = await import("../equipment/equipmentAdapter");
  const cap = getCapabilitiesForMachine({ machineType: "ROBOT", capabilities: null } as any);
  const descriptor = cap.supportedCommands.find((c) => c.name === command)!;
  expect(descriptor).toBeDefined();
  const key = `${DAU}-foe-${command}-${user.id}-${Math.random().toString(36).slice(2, 8)}`;
  const args = { robotId: ROBOT };
  const cmd = buildEquipmentCommand(descriptor, cap, MACHINE, args, key, user);
  await ensureOrchestrationAction(user, key, { id: `s-${command}`, type: "command" } as any, args, cmd);
  return equipmentRegistry.getAdapter(cap.adapterKind).sendCommand(cmd);
}

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "FIELD_V2_ENABLED", "SEC_PLATFORM", "ROBOT_SAFETY_PREFLIGHT_ENABLED", "EVENT_WEBHOOKS_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

describe.skipIf(!DB_URL)("Đợt 1C Task 3 fix round 1 — lệnh DỪNG không bao giờ bị chặn (R-1C-c, CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // cầu chì: không bao giờ chạy trên DB dev
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await import("../ot/adapterFacade");
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const db = await d();
    await db.delete(aiPendingActions).where(like(aiPendingActions.id, `%${DAU}%`));
    await db.delete(aiPendingActions).where(and(eq(aiPendingActions.userId, 0), like(aiPendingActions.summary, "FOE orchestration: step s-%")));
    await db.delete(aiPendingActions).where(and(eq(aiPendingActions.userId, OWNER), like(aiPendingActions.summary, "FOE orchestration: step s-%")));
    try {
      await db.delete(robotJobs).where(eq(robotJobs.robotId, ROBOT));
    } catch {
      /* robot_jobs có thể append-only với role ứng dụng */
    }
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    env.hostile = true; // mọi ca: safety BLOCKED + interlock vi phạm + driver khoá chuyển động
    env.jobs.length = 0;
    env.holdMotion = false;
    env.releaseMotion = null;
    env.safetyReads = 0;
    env.interlockEvals = 0;
    env.policyOn = false;
    env.policyVerdict = {};
    env.policyCalls.length = 0;
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    delete process.env.FIELD_V2_ENABLED;
    delete process.env.SEC_PLATFORM;
    delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
    delete process.env.EVENT_WEBHOOKS_ENABLED;
  });

  it("ánh xạ: `e_stop` và `stop` ⇒ job `abort` (khớp docblock CMD_ESTOP); `start`/`pause` vẫn là chuyển động `custom`", () => {
    expect(toRobotJob({ name: "e_stop" })).toEqual({ jobType: "abort", params: {} });
    expect(toRobotJob({ name: "stop" })).toEqual({ jobType: "abort", params: {} });
    expect(toRobotJob({ name: "abort" })).toEqual({ jobType: "abort", params: {} });
    expect(toRobotJob({ name: "start" }).jobType).toBe("custom");
    expect(toRobotJob({ name: "pause" }).jobType).toBe("custom");
  });

  it("★ 'hitl' abort KHÔNG confirmedBy, KHÔNG actionId ⇒ tới driver (done), có hàng sổ ghi; safety/interlock/khoá không được hỏi", async () => {
    const r = await dispatchRobotJob({ robotId: ROBOT, job: { jobType: "abort", params: {} }, triggerKind: "hitl", requestedBy: OWNER });
    expect(r.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    expect(env.safetyReads).toBe(0);
    expect(env.interlockEvals).toBe(0);
    const row = await jobRow(r.jobId);
    expect(row?.jobType).toBe("abort");
    expect(row?.status).toBe("done");
  });

  it("'hitl' abort mang actionId KHÔNG tồn tại / sai ⇒ vẫn tới driver (không tái xác minh một lệnh dừng)", async () => {
    const r = await dispatchRobotJob({ robotId: ROBOT, job: { jobType: "abort", params: {} }, triggerKind: "hitl", actionId: `${DAU}-nope`, requestedBy: OWNER, confirmedBy: OWNER });
    expect(r.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
  });

  it("★ api/v1 POST abort (khoá API, requestedBy 0, không confirmedBy) ⇒ tới driver ĐÚNG MỘT lần; sổ ghi abort", async () => {
    const { status, body } = await postCommand("abort", `${DAU}-api-abort`);
    expect(status).toBe(200);
    expect(body.data.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    const row = await jobRow(body.data.detail?.jobId);
    expect(row?.jobType).toBe("abort");
    expect(row?.requestedBy).toBe(0);
  });

  it("★ api/v1 POST e_stop ⇒ tới driver dưới dạng job `abort` (không phải `custom`)", async () => {
    const { status, body } = await postCommand("e_stop", `${DAU}-api-estop`);
    expect(status).toBe(200);
    expect(body.data.status).toBe("done");
    expect(env.jobs).toHaveLength(1);
    expect(env.jobs[0].jobType).toBe("abort");
  });

  it("api/v1 POST start (chuyển động) trong môi trường thù địch ⇒ vẫn bị từ chối, 0 job — miễn trừ CHỈ cho lệnh dừng", async () => {
    const { body } = await postCommand("start", `${DAU}-api-start`);
    expect(body.data.status).toBe("rejected");
    expect(env.jobs).toHaveLength(0);
  });

  it("★ FOE bước e_stop ⇒ tới driver dưới dạng `abort`", async () => {
    const res = await foeStep("e_stop", { id: OWNER, role: "engineer" });
    expect(res.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
  });

  it("★ FOE bước abort với user HỆ THỐNG (id 0 ⇒ confirmedBy 0) ⇒ tới driver", async () => {
    const res = await foeStep("abort", { id: 0, role: "system" });
    expect(res.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
  });

  // ─── Fix round 2 (ruling (b)) — policy DENY / REQUIRE_APPROVAL không chặn lệnh DỪNG ─────────────
  it("★ fix round 2 (b) — SEC_PLATFORM bật + policy DENY `robot.command.abort` ⇒ STOP VẪN tới driver; sổ ghi + audit ghi override (R-1C-c)", async () => {
    env.policyOn = true;
    env.policyVerdict = { "robot.command.abort": "deny" };
    const r = await dispatchRobotJob({ robotId: ROBOT, job: { jobType: "abort", params: {} }, triggerKind: "hitl", requestedBy: OWNER });
    expect(env.policyCalls).toContain("robot.command.abort"); // policy THẬT SỰ được hỏi (không phải bị bỏ qua)
    expect(r.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    const row = await jobRow(r.jobId);
    const override = (row?.result as Record<string, any> | null)?.policyOverride;
    expect(override).toMatchObject({ effect: "deny", policyRef: "p-t3-deny", reasonCode: "POLICY_DENIED", ruling: "R-1C-c" });
    // final wave 5 (M1): the audit is written AFTER finalize, fire-and-forget — poll for it (bounded).
    let audits: Array<typeof controlAuditLog.$inferSelect> = [];
    for (let i = 0; i < 100 && audits.length === 0; i++) {
      audits = await (await d())
        .select()
        .from(controlAuditLog)
        .where(and(eq(controlAuditLog.entityType, "robot_job"), eq(controlAuditLog.entityId, String(r.jobId))));
      if (audits.length === 0) await new Promise((res) => setTimeout(res, 50));
    }
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("stop_policy_override");
    expect(audits[0].reason).toMatch(/R-1C-c/);
    expect(audits[0].afterJson).toMatchObject({ effect: "deny", policyRef: "p-t3-deny" });
  });

  it("fix round 2 (b) — REQUIRE_APPROVAL cho `robot.command.abort` (api/v1 e_stop) ⇒ STOP vẫn tới driver, override ghi effect require_approval", async () => {
    env.policyOn = true;
    env.policyVerdict = { "robot.command.abort": "require_approval" };
    const { body } = await postCommand("e_stop", `${DAU}-api-estop-policy`);
    expect(body.data.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    const row = await jobRow(body.data.detail?.jobId);
    expect((row?.result as Record<string, any> | null)?.policyOverride).toMatchObject({ effect: "require_approval", ruling: "R-1C-c" });
  });

  it("fix round 2 (b) — policy DENY cho CHUYỂN ĐỘNG vẫn chặn (miễn trừ chỉ cho lệnh dừng): home ⇒ POLICY_DENIED, 0 job", async () => {
    env.hostile = false;
    env.policyOn = true;
    env.policyVerdict = { "robot.command.home": "deny" };
    const r = await dispatchRobotJob({ robotId: ROBOT, job: { jobType: "home", params: {} }, triggerKind: "manual", requestedBy: OWNER, confirmedBy: OWNER });
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("POLICY_DENIED");
    expect(env.jobs).toHaveLength(0);
  });

  // ─── Fix round 2 (ruling (e)) — khoá idempotency dài không làm hỏng sổ ghi ⇒ không từ chối STOP ────────
  it("★ fix round 2 (e) — api/v1 abort với idempotencyKey 120 ký tự ⇒ tới driver; sổ ghi lưu khoá/actionId ĐÃ BĂM vừa cột; gửi lại cùng khoá ⇒ phát lại (d), không gửi lần hai", async () => {
    const key = `${DAU}-`.padEnd(120, "x");
    expect(key).toHaveLength(120);
    const first = await postCommand("abort", key);
    expect(first.body.data.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort"]);
    const row = await jobRow(first.body.data.detail?.jobId);
    // 120 ký tự VỪA cột idempotencyKey (128) ⇒ giữ nguyên từng byte; actionId `apiv1-<key>` (126) thì KHÔNG vừa
    // cột actionId (64) — chính nó làm INSERT hỏng trước fix round 2 ⇒ nay được băm, ≤ 64.
    expect(row?.idempotencyKey).toBe(key);
    expect(row?.actionId?.length).toBeLessThanOrEqual(64);
    expect(row?.actionId).toMatch(/^h-sha256-/);
    // (d) giữ nguyên: cùng khoá = cùng lệnh ⇒ phát lại kết quả cũ, driver không nhận lần hai.
    const again = await postCommand("abort", key);
    expect(again.body.data.status).toBe("done");
    expect(again.body.data.detail?.jobId).toBe(first.body.data.detail?.jobId);
    expect(env.jobs).toHaveLength(1);
  });

  it("fix round 2 (e) — hai khoá dài chung 128 ký tự đầu KHÔNG va nhau trong sổ (băm, không cắt); chuyển động manual khoá 200 ký tự vẫn chạy", async () => {
    env.hostile = false;
    const stem = `${DAU}-`.padEnd(130, "y");
    const a = await dispatchRobotJob({ robotId: ROBOT, job: { jobType: "abort", params: {} }, triggerKind: "hitl", requestedBy: OWNER, idempotencyKey: `${stem}A` });
    const b = await dispatchRobotJob({ robotId: ROBOT, job: { jobType: "abort", params: {} }, triggerKind: "hitl", requestedBy: OWNER, idempotencyKey: `${stem}B` });
    expect([a.status, b.status]).toEqual(["done", "done"]);
    expect(a.jobId).not.toBe(b.jobId);
    const m = await dispatchRobotJob({ robotId: ROBOT, job: { jobType: "home", params: {} }, triggerKind: "manual", requestedBy: OWNER, confirmedBy: OWNER, idempotencyKey: `${DAU}-`.padEnd(200, "z") });
    expect(m.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["abort", "abort", "home"]);
  });

  it("slot R14: một chuyển động đang bay ⇒ api/v1 e_stop vẫn tới driver ngay (không chờ, không ROBOT_MOTION_IN_PROGRESS)", async () => {
    env.hostile = false;
    env.holdMotion = true;
    const motion = dispatchRobotJob({ robotId: ROBOT, job: { jobType: "home", params: {} }, triggerKind: "manual", requestedBy: OWNER, confirmedBy: OWNER });
    for (let i = 0; i < 100 && env.jobs.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(env.jobs.map((j) => j.jobType)).toEqual(["home"]);
    env.hostile = true;
    const stop = await postCommand("e_stop", `${DAU}-api-estop-slot`);
    expect(stop.body.data.status).toBe("done");
    expect(env.jobs.map((j) => j.jobType)).toEqual(["home", "abort"]);
    env.releaseMotion?.();
    expect((await motion).status).toBe("done");
  });
});
