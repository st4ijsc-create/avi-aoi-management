/**
 * doc 81 Đợt 1B Task 3 — HIL TRUNG THỰC (BE2 §L3 T2: "HIL PASS cho URScript hỏng").
 *
 * Hai lớp, đột biến từng lớp:
 *   (1) harness `validateUrscriptOnUrsim` — `accepted` chỉ khi quan sát được "Program running:
 *       true" + an toàn NORMAL (test ở ursimHarnessTrungThuc.test.ts + e2e dưới đây);
 *   (2) `runHilStage` — PASS chỉ khi `running && accepted && !error` (test với validator tiêm
 *       trả `accepted:true, running:false`, tức hình dạng cũ "robotmode RUNNING").
 * Và: resolver MẶC ĐỊNH của HIL đi qua sổ đích giả lập (`resolveSimTarget`) — URSIM_HOST
 * trùng host một robot thật trong CSDL ⇒ HIL KHÔNG gửi gì (không power on / brake release).
 *
 * Oracle: bộ điều khiển UR giả viết theo văn bản giao thức Dashboard của hãng, trên
 * 127.0.0.1 cổng 0, đóng trong afterEach.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// CSDL giả CHỈ cho truy vấn đọc-chỉ của sổ đích giả lập: select(...).from(robots|deviceAdapters).
const dbRows = vi.hoisted(() => ({ robots: [] as any[], adapters: [] as any[] }));
vi.mock("../../../db/connection", async () => {
  const schema = await import("../../../../drizzle/schema");
  return {
    getDb: async () => ({
      select: () => ({
        from: (t: unknown) =>
          Promise.resolve(t === schema.robots ? dbRows.robots : t === schema.deviceAdapters ? dbRows.adapters : []),
      }),
    }),
  };
});

import { FakeUrController } from "../../robot/ursim/__fakeUrController";
import { runHilStage } from "./hilGate";
import { transpileToUrscript } from "./transpilers/irToUrscript";
import type { Flow } from "./irModel";
import type { UrsimValidationResult } from "../../robot/ursim/ursimHarness";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`bounded timeout ${ms}ms`)), ms).unref?.()),
  ]);
}

const FLOW: Flow = {
  flow_id: "hil_honest",
  target_device_type: "universal-robots",
  version: 1,
  blocks: [
    { id: "b1", type: "move_joint", joints: [0, -0.5, 0.5, 0, 0.5, 0], speed_pct: 40 },
    { id: "b2", type: "set_output", signal: "1", value: true },
  ],
};
// Lỗi cú pháp (thiếu ngoặc đóng) — bộ điều khiển không biên dịch được.
const BROKEN = "def hil_broken():\n  movej([0, -0.5, 0.5, 0, 0.5, 0], a=1.2, v=0.25\nend";

const fakes: FakeUrController[] = [];
beforeEach(() => {
  for (const k of ["URSIM_HOST", "URSIM_PRIMARY_PORT", "URSIM_DASHBOARD_PORT", "URSIM_TIMEOUT_MS"]) delete process.env[k];
});
afterEach(async () => {
  while (fakes.length) await fakes.pop()!.close();
  delete process.env.DPC_HIL_ENABLED;
  delete process.env.URSIM_HOST;
  delete process.env.URSIM_PRIMARY_PORT;
  delete process.env.URSIM_DASHBOARD_PORT;
  delete process.env.URSIM_TIMEOUT_MS;
  dbRows.robots = [];
  dbRows.adapters = [];
});

async function startFake(): Promise<FakeUrController> {
  const f = new FakeUrController();
  await f.start();
  fakes.push(f);
  return f;
}

const fast = { pollIntervalMs: 50, runWaitMs: 600 };

describe("HIL e2e — harness THẬT + bộ điều khiển UR giả", () => {
  it("script HỎNG: robotmode RUNNING nhưng 'Program running: false' ⇒ HIL FAIL", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const fake = await startFake();
    const r = await withTimeout(
      runHilStage(BROKEN, true, {
        resolveEndpoint: () => ({ host: "127.0.0.1", dashboardPort: fake.dashboardPort, scriptPort: fake.primaryPort, timeoutMs: 2000 }),
        validationOptions: fast,
      }),
      8000,
    );
    expect(fake.robotMode).toBe("RUNNING");
    expect(fake.compileErrors.length).toBe(1);
    expect(r.ran).toBe(true);
    expect(r.validation?.robotMode).toBe("Robotmode: RUNNING");
    expect(r.validation?.running).toBe(false);
    expect(r.pass).toBe(false);
    // fix round 1: lý do trung thực — "không quan sát được chạy", không khẳng định "transpile hỏng".
    expect(r.validation?.reasonCode).toBe("not_observed_running");
    expect(r.reason).toMatch(/not observed running/i);
    expect(r.reason).not.toMatch(/broken transpile/i);
  });

  it("script transpile HỢP LỆ chạy thật trên bộ điều khiển giả ⇒ HIL PASS", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const fake = await startFake();
    const code = transpileToUrscript(FLOW).code;
    const r = await withTimeout(
      runHilStage(code, true, {
        resolveEndpoint: () => ({ host: "127.0.0.1", dashboardPort: fake.dashboardPort, scriptPort: fake.primaryPort, timeoutMs: 2000 }),
        validationOptions: fast,
      }),
      8000,
    );
    expect(fake.compileErrors).toEqual([]);
    expect(fake.programs.length).toBe(1);
    expect(r.ran).toBe(true);
    expect(r.validation?.running).toBe(true);
    expect(r.pass).toBe(true);
  });
});

describe("runHilStage — lớp cổng tự nó đòi running (không tin 'accepted' đơn lẻ)", () => {
  const v = (over: Partial<UrsimValidationResult>): UrsimValidationResult => ({
    sent: true, accepted: false, running: false, elapsedMs: 1, ...over,
  });
  const ep = { host: "127.0.0.1", dashboardPort: 1, scriptPort: 2, timeoutMs: 100 };

  it("validator trả accepted:true + running:false (hình dạng cũ 'robotmode RUNNING') ⇒ FAIL", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const r = await runHilStage("def p():\nend", true, {
      resolveEndpoint: () => ep,
      validate: async () => v({ accepted: true, running: false, robotMode: "Robotmode: RUNNING" }),
    });
    expect(r.ran).toBe(true);
    expect(r.pass).toBe(false);
  });

  it("validator trả running:true nhưng accepted:false (an toàn bất thường) ⇒ FAIL", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const r = await runHilStage("def p():\nend", true, {
      resolveEndpoint: () => ep,
      validate: async () => v({ accepted: false, running: true, safetyStatus: "PROTECTIVE_STOP" }),
    });
    expect(r.pass).toBe(false);
  });

  it("running:true + accepted:true ⇒ PASS (đường hợp lệ vẫn qua)", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const r = await runHilStage("def p():\nend", true, {
      resolveEndpoint: () => ep,
      validate: async () => v({ accepted: true, running: true, safetyStatus: "NORMAL" }),
    });
    expect(r.pass).toBe(true);
  });
});

describe("runHilStage — resolver MẶC ĐỊNH đi qua sổ đích giả lập", () => {
  function envTo(fake: FakeUrController) {
    process.env.URSIM_HOST = "127.0.0.1";
    process.env.URSIM_PRIMARY_PORT = String(fake.primaryPort);
    process.env.URSIM_DASHBOARD_PORT = String(fake.dashboardPort);
    process.env.URSIM_TIMEOUT_MS = "2000";
  }

  it("URSIM_HOST trùng host một robot thật trong CSDL ⇒ HIL bị chặn, KHÔNG gửi power on/brake release", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const fake = await startFake();
    envTo(fake);
    dbRows.robots = [{ endpoint: "127.0.0.1:30002", connectionOptions: null }];
    const r = await withTimeout(runHilStage(transpileToUrscript(FLOW).code, true, { validationOptions: fast }), 8000);
    expect(r.ran).toBe(false);
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/refused/i);
    expect(fake.dashboardLog).toEqual([]); // không một lệnh dashboard nào tới "robot"
    expect(fake.programs).toEqual([]);
  });

  it("URSIM_HOST không trùng thiết bị nào ⇒ HIL chạy qua sổ và PASS với script hợp lệ", async () => {
    process.env.DPC_HIL_ENABLED = "true";
    const fake = await startFake();
    envTo(fake);
    dbRows.robots = [{ endpoint: "192.0.2.40:30002", connectionOptions: null }];
    dbRows.adapters = [{ endpoint: "modbus-tcp://192.0.2.41:502", connectionOptions: null }];
    const r = await withTimeout(runHilStage(transpileToUrscript(FLOW).code, true, { validationOptions: fast }), 8000);
    expect(r.ran).toBe(true);
    expect(r.pass).toBe(true);
    expect(fake.dashboardLog).toContain("power on");
  });
});
