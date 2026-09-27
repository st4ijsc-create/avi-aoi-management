/**
 * doc 81 Đợt 1B Task 4 — "deploy" robot-tm phải TRUNG THỰC (BE2 §L3 `robot-tm`, T1-F).
 *
 * Lỗi đo được: job "program download" gửi đúng `ScriptExit()` xuống Listen Node rồi ghi `deployed`.
 * Adapter CHƯA hỗ trợ tải chương trình ⇒ phải trả trạng thái thất bại có sẵn (`failed`) kèm mã lý do
 * `techman_program_download_unsupported` và KHÔNG ghi gì xuống robot.
 *
 * Để test có nghĩa (ĐỎ trên mã cũ), mọi cổng phía trước được mở như trên máy thật đã sẵn sàng:
 * robot đang active với `TechmanDriver` THẬT đã kết nối (Modbus giả + Listen Node giả trên 127.0.0.1
 * cổng 0, trả `$TMSCT,4,1,OK,*5C` — checksum tính độc lập), ROBOT_CONTROL_ENABLED=true, không đòi
 * commissioning, interlock không chặn, HITL có người xác nhận. Khẳng định: 0 kết nối, 0 byte tới
 * Listen Node giả, kết quả KHÔNG phải `deployed`.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { TechmanDriver } from "../../robot/drivers/techmanDriver";
import {
  startFakeListenNode,
  startFakeTmModbus,
  type FakeListenNode,
  type FakeTmModbus,
} from "../../robot/drivers/__fakeTechman";

const active = vi.hoisted(() => ({ driver: null as unknown }));
vi.mock("../../robot/robotManager", () => ({
  getActiveRobot: (id: number) => (id === 42 && active.driver ? { driver: active.driver } : undefined),
}));
vi.mock("../../interlock/interlockGate", () => ({
  evaluateInterlockGate: async () => ({ blocked: false, failClosed: false, violations: [] }),
}));
vi.mock("../../../db/connection", () => ({ getDb: async () => null }));

import { RobotTmAdapter } from "./robotTmAdapter";

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "FIELD_V2_ENABLED", "SEC_PLATFORM"] as const;
const saved: Record<string, string | undefined> = {};

let modbus: FakeTmModbus;
let node: FakeListenNode;
let driver: TechmanDriver;

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  modbus = await startFakeTmModbus();
  node = await startFakeListenNode({ kind: "reply", chunks: ["$TMSCT,4,1,OK,*5C\r\n"] });
  driver = new TechmanDriver();
  await driver.connect({
    endpoint: `tcp://127.0.0.1:${modbus.port}`,
    timeoutMs: 1000,
    options: { listenHost: "127.0.0.1", listenPort: node.port },
  });
  active.driver = driver;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.FIELD_V2_ENABLED;
  delete process.env.SEC_PLATFORM;
});

afterAll(async () => {
  active.driver = null;
  await driver.disconnect();
  await node.close();
  await modbus.close();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("RobotTmAdapter.deploy — không tải chương trình giả (doc 81 Đợt 1B Task 4)", () => {
  it("mọi cổng mở, robot active ⇒ 0 byte tới Listen Node, kết quả failed + techman_program_download_unsupported", async () => {
    expect(driver.isConnected()).toBe(true);
    const r = await new RobotTmAdapter().deploy(
      { ok: true, diagnostics: [], outputRef: "tm://job/abc" },
      { stage: "staging", idempotencyKey: "t4-deploy-1", hitl: { requestedBy: 1, confirmedBy: 2 }, deviceId: 42 },
    );
    // đợi một nhịp để mọi byte (nếu có) kịp tới server giả
    await new Promise((res) => setTimeout(res, 100));
    expect(node.connections()).toBe(0);
    expect(node.received).toEqual([]);
    expect(r.status).not.toBe("deployed");
    expect(r.status).toBe("failed");
    expect(r.ok).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.detail?.reasonCode).toBe("techman_program_download_unsupported");
    expect(r.error).toMatch(/techman_program_download_unsupported/);
  });

  it("capabilities không còn quảng cáo canDownload", () => {
    expect(new RobotTmAdapter().capabilities.canDownload).toBe(false);
  });
});
