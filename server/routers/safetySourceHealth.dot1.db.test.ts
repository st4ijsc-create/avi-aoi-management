/**
 * doc 80 Đợt 1 Task 4 — SAF-02 (`safety.sourceHealth`) + ORC-13 (`orchestration.listRuns`
 * hiện DRY-RUN) trên CSDL THẬT `_test`.
 *
 * ★ Phép đối chiếu ĐỘC LẬP: báo cáo nguồn KHÔNG được tự khẳng định — mỗi kết luận của nó về
 *   preflight được so với chính `adapterFacade.getSafetyStatus()` (hàm mà dispatcher OT/robot
 *   gọi) chạy trên CÙNG CSDL, CÙNG cờ, CÙNG thời điểm.
 * ⚠ `safety_plc_configs` / `orchestration_runs` của `_test` dùng chung với tệp chạy song song ⇒
 *   khẳng định chỉ trên hàng CỦA RIÊNG lượt này (mã theo RUN) hoặc là phép kiểm "chứa"/"≥".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `t4s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const PLC_CODE = `SIM-T4-${RUN}`.slice(0, 64);
const WF_ID = 900_000_000 + Math.floor(Math.random() * 90_000_000);

const ctxAdmin = { user: { id: 954401, role: "admin", name: "u954401" } } as never;
// Vai KHÔNG phải admin (admin bypass requirePermission), có quyền xem THẬT nhưng KHÔNG được gán
// nhà máy nào ⇒ phạm vi rỗng.
const U_SCOPED = 954402;
const ctxScoped = { user: { id: U_SCOPED, role: "operator", name: "u954402" } } as never;

const ENV_KEYS = [
  "SAFETY_PLC_ADAPTER_ENABLED",
  "OT_CONTROL_ENABLED",
  "ROBOT_CONTROL_ENABLED",
  "OT_SAFETY_PREFLIGHT_ENABLED",
  "ROBOT_SAFETY_PREFLIGHT_ENABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};

let sql: ReturnType<typeof postgres>;
const ids = { plc: 0, runSim: 0, runLive: 0, runSeed: 0 };

describe.skipIf(!DB_URL)("Task 4 — safety.sourceHealth + listRuns DRY-RUN (CSDL THẬT)", () => {
  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView")
              VALUES (${U_SCOPED}, 'machine_monitoring', 'machine_status', true)`;
    ids.plc = await one(sql`
      INSERT INTO safety_plc_configs (code, name, vendor, backend, enabled, scope)
      VALUES (${PLC_CODE}, 'T4 sim PLC', 'generic', 'sim', true, 'sim') RETURNING id`);

    const run = (ctx: object) =>
      one(sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "contextJson")
              VALUES (${WF_ID}, ${"t4-" + RUN}, 'completed', ${sql.json(ctx as never)}) RETURNING id`);
    ids.runSim = await run({});
    ids.runLive = await run({});
    ids.runSeed = await run({ seed: true });
    const step = (runId: number, stepId: string, type: string, result: object) =>
      sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, "resultJson")
          VALUES (${runId}, ${stepId}, ${type}, 'completed', ${sql.json(result as never)})`;
    // Hình dạng kết quả do foeEngine.execCommand ghi.
    await step(ids.runSim, "s1", "command", { routedTo: "ot-dispatcher", status: "simulated", accepted: true, simulated: true });
    await step(ids.runSim, "s2", "hitl_gate", { ok: true });
    await step(ids.runSim, "s3", "command", { routedTo: "robot-dispatcher", status: "simulated", accepted: true, detail: { jobId: 1 } });
    await step(ids.runLive, "s1", "command", { routedTo: "ot-dispatcher", status: "acked", accepted: true, simulated: false });
    await step(ids.runSeed, "s1", "command", { ok: true }); // đúng hình dạng 17 run_steps seed trên DB dev
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  afterAll(async () => {
    if (!sql) return;
    const runIds = [ids.runSim, ids.runLive, ids.runSeed].filter(Boolean);
    if (runIds.length) {
      await sql`DELETE FROM orchestration_run_steps WHERE "runId" IN ${sql(runIds)}`;
      await sql`DELETE FROM orchestration_runs WHERE id IN ${sql(runIds)}`;
    }
    if (ids.plc) await sql`DELETE FROM safety_plc_configs WHERE id = ${ids.plc}`;
    await sql`DELETE FROM permissions WHERE "userId" = ${U_SCOPED}`;
    await sql.end();
  });

  const safety = async (ctx: never) => (await import("./safetyRouter")).safetyRouter.createCaller(ctx);
  const facadeReading = async () =>
    (await import("../services/ot/adapterFacade")).createAdapterFacade({ adapterId: -1, machineId: null }).getSafetyStatus();
  // Đợt 1C Task 1 — CHÍNH lượt đọc mà preflight OT/robot dùng trước lệnh THẬT.
  const facadeRealActuation = async () =>
    (await import("../services/ot/adapterFacade"))
      .createAdapterFacade({ adapterId: -1, machineId: null })
      .getSafetyStatus({ forRealActuation: true });

  it("adapter TẮT ⇒ báo 'blocked'/SAFETY_UNKNOWN — và facade THẬT cũng trả UNKNOWN", async () => {
    delete process.env.SAFETY_PLC_ADAPTER_ENABLED;
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const h = await (await safety(ctxAdmin)).sourceHealth();
    expect(h.safetyPlc.basis).toBe("adapter_off");
    expect(h.preflight.ot.realWrites).toBe("blocked");
    expect(h.preflight.robot.realWrites).toBe("blocked");
    expect(h.preflight.ot.refusalReason).toBe("SAFETY_UNKNOWN");
    expect((await facadeReading()).state).toBe("UNKNOWN");
  });

  // Đợt 1C Task 1 (quyết định chủ dự án 2026-09-27) — đổi kỳ vọng: trước đây bảng báo "sim_basis" /
  // "sim_can_satisfy" (lệnh thật đi qua nhờ SIM). Nay SIM không thoả preflight lệnh THẬT ⇒ bảng báo
  // blocked/SAFETY_SIM_ONLY, và lượt đọc THẬT của preflight (forRealActuation) nói ĐÚNG điều đó.
  // Lượt đọc cũ (không tham số — cổng AI L-7) giữ nguyên: SIM sạch vẫn OK.
  // ⚠ `_test` dùng chung: safetySimOnly.dot1c chạy song song có thể thêm một cấu hình `real` trong
  //   đúng một ca của nó ⇒ nhánh realConfigs > 0 được chấp nhận (khi đó bảng phải nói real_basis).
  it("adapter BẬT + cấu hình SIM ⇒ lệnh THẬT bị chặn SAFETY_SIM_ONLY — khớp lượt đọc forRealActuation của facade THẬT", async () => {
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const h = await (await safety(ctxAdmin)).sourceHealth();
    expect(h.safetyPlc.simConfigs).toBeGreaterThanOrEqual(1);
    expect(["sim", "mixed"]).toContain(h.safetyPlc.basis);
    const mine = h.safetyPlc.configs.find((c) => c.code === PLC_CODE);
    expect(mine).toMatchObject({ backend: "sim", effective: "sim_empty", provenance: "SIM" });
    if (h.safetyPlc.realConfigs === 0) {
      expect(h.preflight.ot.realWrites).toBe("blocked");
      expect(h.preflight.ot.refusalReason).toBe("SAFETY_SIM_ONLY");
      expect(h.preflight.robot.refusalReason).toBe("SAFETY_SIM_ONLY");
      const strict = await facadeRealActuation();
      expect(strict.state).toBe("UNKNOWN");
      expect(strict.basis).toBe("sim_only");
    } else {
      expect(h.preflight.ot.realWrites).toBe("real_basis");
    }
    const reading = await facadeReading();
    expect(reading.state).not.toBe("UNKNOWN");
    expect(reading.source).toMatch(/^safety_plc/);
  });

  it("OT_CONTROL tắt ⇒ dry_run (lệnh chỉ mô phỏng); cờ ROBOT preflight='false' ⇒ unguarded", async () => {
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    delete process.env.OT_CONTROL_ENABLED;
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "false";
    const h = await (await safety(ctxAdmin)).sourceHealth();
    expect(h.preflight.ot.realWrites).toBe("dry_run");
    expect(h.preflight.robot.realWrites).toBe("unguarded");
  });

  it("phạm vi: người dùng không được gán nhà máy KHÔNG thấy mã cấu hình, nhưng số tổng (nền preflight) giống admin", async () => {
    process.env.SAFETY_PLC_ADAPTER_ENABLED = "true";
    const a = await (await safety(ctxAdmin)).sourceHealth();
    const u = await (await safety(ctxScoped)).sourceHealth();
    expect(u.safetyPlc.configs.find((c) => c.code === PLC_CODE)).toBeUndefined();
    expect(u.safetyPlc.hiddenConfigs).toBeGreaterThanOrEqual(1);
    expect(u.safetyPlc.enabledConfigs).toBe(a.safetyPlc.enabledConfigs);
  });

  it("Fix round 1 #3: adapter e-stop VENDOR đã đăng ký ⇒ health() KHÔNG bị gọi mỗi request, endpoint KHÔNG lộ", async () => {
    const estop = await import("../services/safety/estop/safetyEstopAdapter");
    let healthCalls = 0;
    const fake = {
      kind: "pilz-pnozmulti",
      isRated: () => false,
      health: async () => {
        healthCalls += 1; // một vendor adapter thật sẽ readBoolTag ⇒ connect driver tại đây
        return { reachable: true, rated: false, label: "pilz skeleton (modbus @ tcp://10.9.9.9:502) — NOT safety-rated" };
      },
      triggerEmergencyStop: async () => ({ ok: false, rated: false, actuated: false, adapter: "fake" }),
      label: () => "pilz skeleton (modbus @ tcp://10.9.9.9:502) — NOT safety-rated",
    };
    const prev = estop.registerSafetyPlcAdapter(fake);
    try {
      process.env.SAFETY_ESTOP_ADAPTER_ENABLED = "true";
      const caller = await safety(ctxAdmin);
      const h1 = await caller.sourceHealth();
      const h2 = await caller.sourceHealth();
      expect(healthCalls).toBe(0);
      for (const h of [h1, h2]) {
        expect(JSON.stringify(h)).not.toContain("10.9.9.9");
        expect(h.estop).toMatchObject({ enabled: true, adapter: "pilz-pnozmulti", rated: false });
        expect(h.estop.label).toContain("pilz skeleton");
      }
    } finally {
      estop.registerSafetyPlcAdapter(prev);
      delete process.env.SAFETY_ESTOP_ADAPTER_ENABLED;
    }
  });

  it("ORC-13: listRuns mang chế độ gửi lệnh — DRY-RUN / thật / seed không có lệnh", async () => {
    const orch = (await import("./orchestrationRouter")).orchestrationRouter.createCaller(ctxAdmin);
    const rows = (await orch.listRuns({ workflowId: WF_ID, limit: 10 })) as Array<{ id: number; dispatch: { mode: string; simulated: number; live: number; unconfirmed: number } }>;
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get(ids.runSim)?.dispatch).toEqual({ mode: "simulated", simulated: 2, live: 0, unconfirmed: 0 });
    expect(by.get(ids.runLive)?.dispatch).toEqual({ mode: "live", simulated: 0, live: 1, unconfirmed: 0 });
    expect(by.get(ids.runSeed)?.dispatch).toEqual({ mode: "none", simulated: 0, live: 0, unconfirmed: 0 });
  });
});
