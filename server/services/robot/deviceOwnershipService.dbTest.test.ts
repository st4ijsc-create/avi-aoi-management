/**
 * D2 (chủ dự án duyệt 14/11) — CSDL đích của tiến trình là `_test` ⇒ phiên STOP TẠM của trung tâm chỉ mô phỏng.
 *
 * `sendRobotStop` / `sendAdapterStop` (deviceOwnershipService.ts): ngay SAU chốt cờ (ROBOT_CONTROL_ENABLED / OT_CONTROL_ENABLED) và
 * TRƯỚC mọi lần đọc hàng, `createRobotDriver` / `createDriver`, `connect`: tên CSDL mà pool của `getDb()` dùng (DATABASE_URL, đọc như
 * postgres.js đọc) khớp `/_test$/` ⇒ `{ ok: true, sent: "simulated" }`, không gửi gì. Không xác định được tên ⇒ coi như `_test`
 * (fail-closed). Đường "NOT SENT" có sẵn của sweep phát báo động CRITICAL và ghi `central_stop_executions` như dry-run.
 *
 * Test thuần: DB, driver, sổ ghi, báo động đều giả. Không DB thật, không mạng.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const H = vi.hoisted(() => ({
  /** robot / adapter đang nợ STOP trong device_pending_stops (sweep toàn cục) */
  pendingDevices: [] as Array<{ robotId: number | null; adapterId: number | null }>,
  /** yêu cầu STOP chưa ack của từng thiết bị (lượt chọn FOR UPDATE SKIP LOCKED) */
  pick: [] as Array<{ id: number; requestedBy: number; cannotList: boolean }>,
  /** số lần đọc device_tags (đọc hàng của adapter) */
  tagReads: 0,
  alerts: [] as Array<{ kind: string; title: string; message: string; entityId: number }>,
  records: [] as Array<{ kind: string; deviceId: number; ok: boolean; detail: string }>,
  acks: [] as number[],
  dispatched: [] as number[],
}));

vi.mock("../../db/connection", () => ({
  isEdgeProcessRole: () => false,
  getDb: async () => {
    const tx = {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("robot_motion_lock_requests")) return H.pick;
        return []; // SET LOCAL … / khoá hàng thiết bị FOR SHARE
      },
      transaction: async (fn: (sp: unknown) => Promise<unknown>) => fn(tx),
    };
    return {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("device_pending_stops")) return H.pendingDevices;
        return [];
      },
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      select: () => ({
        from: () => ({
          where: async () => {
            H.tagReads += 1;
            return [{ tagKey: "stop_run", address: "40001", dataType: "uint16", scale: null, offset: null }];
          },
        }),
      }),
    };
  },
}));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => undefined, // không có phiên ⇒ đường phiên TẠM
  activeRobotIds: () => [],
  isCentralRobotGatewayOn: () => false,
  robotTriedAtStart: () => true,
  attachRobot: async () => true,
  detachRobot: async () => true,
}));
vi.mock("./robotCommandDispatcher", () => ({
  dispatchRobotJob: async (i: { robotId: number }) => (H.dispatched.push(i.robotId), { ok: true, status: "done", jobId: 1 }),
}));
vi.mock("./robotStopRow", () => ({
  prefetchRobotStopRow: vi.fn(async () => ({ ok: true, row: { vendor: "fanuc", endpoint: "tcp://10.0.0.1", connectionOptions: null } })),
}));
vi.mock("./driverRegistry", () => ({
  createRobotDriver: vi.fn(() => ({ connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) })),
}));
vi.mock("./robotDeviceRun", () => ({ runRobotDeviceStage: vi.fn(async () => ({ status: "done" })) }));
vi.mock("../ot/stopPin", () => ({ loadStopPins: vi.fn(async () => [{ tagKey: "stop_run", value: 0 }]) }));
vi.mock("../ot/otManager", () => ({
  getActiveDriver: () => undefined, // không có driver đang chạy ⇒ đường phiên TẠM
  isOtGatewayOn: () => false,
  getActiveAdapter: () => undefined,
  otAdapterTriedAtStart: () => true,
  onOtGatewayStarted: () => () => undefined,
}));
vi.mock("../ot/otDeviceWrite", () => ({ executeOtDeviceWrite: vi.fn(async () => ({ timedOut: false, outcomes: [{ ok: true, status: "acked" }] })) }));
vi.mock("../ot/commandDispatcher", () => ({ NO_CONFIRMER: -1 }));
vi.mock("../ot/hanLenhOt", () => ({ hanLenhOtMacDinhMs: () => 1_000 }));
vi.mock("../ot/deviceAdapter", () => ({
  loadEnabledAdapters: vi.fn(async () => [{ adapterId: 21, code: "A21", machineId: null, protocol: "modbus", connection: { host: "127.0.0.1", port: 9 }, pollIntervalMs: 1000, tags: [] }]),
}));
vi.mock("../ot/driverRegistry", () => ({
  createDriver: vi.fn(() => ({ connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) })),
}));
vi.mock("../edge/edgeControlSchema", () => ({
  recordCentralStopExecution: vi.fn(async (_tx: unknown, a: { kind: string; deviceId: number; ok: boolean; detail: string }) => (H.records.push(a), 900 + H.records.length)),
  ackCentralStop: vi.fn(async (_tx: unknown, a: { requestId: number }) => void H.acks.push(a.requestId)),
  isEdgeControlSchemaMissing: () => false,
}));
vi.mock("./criticalStopAlert", () => ({
  raiseCriticalStopAlert: vi.fn(async (a: { kind: string; title: string; message: string; entityId: number }) => void H.alerts.push(a)),
}));

import { sendCentralRobotStop, sendCentralAdapterStop, sweepPendingCentralStops, _resetSweepRateLimitsForTests, _allowTransientStopOnTestDbForTests } from "./deviceOwnershipService";
import { createRobotDriver } from "./driverRegistry";
import { prefetchRobotStopRow } from "./robotStopRow";
import { runRobotDeviceStage } from "./robotDeviceRun";
import { createDriver } from "../ot/driverRegistry";
import { loadEnabledAdapters } from "../ot/deviceAdapter";
import { executeOtDeviceWrite } from "../ot/otDeviceWrite";

const URL_TEST = "postgres://app:pw@127.0.0.1:9/x_test";
const URL_KHONG_TEST = "postgres://app:pw@127.0.0.1:9/x";
const ROBOT_TEST_DETAIL = "DB _test (x_test) — central transient STOP session not opened — nothing sent";
const ROBOT_UNKNOWN_DETAIL = "DB name unknown — treated as _test (fail-closed) — central transient STOP session not opened — nothing sent";
const ADAPTER_TEST_DETAIL = "DB _test (x_test) — central STOP session not opened, pinned stop not written — nothing sent";
const ADAPTER_UNKNOWN_DETAIL = "DB name unknown — treated as _test (fail-closed) — central STOP session not opened, pinned stop not written — nothing sent";

const ENV_KEYS = ["DATABASE_URL", "ROBOT_CONTROL_ENABLED", "OT_CONTROL_ENABLED"] as const;
let savedEnv: Record<string, string | undefined> = {};
let spies: Array<{ mockRestore: () => void }> = [];
function datEnv(k: (typeof ENV_KEYS)[number], v: string | undefined): void {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  datEnv("ROBOT_CONTROL_ENABLED", "true");
  datEnv("OT_CONTROL_ENABLED", "true");
  H.pendingDevices = [];
  H.pick = [];
  H.tagReads = 0;
  H.alerts.length = 0;
  H.records.length = 0;
  H.acks.length = 0;
  H.dispatched.length = 0;
  vi.mocked(createRobotDriver).mockClear();
  vi.mocked(prefetchRobotStopRow).mockClear();
  vi.mocked(runRobotDeviceStage).mockClear();
  vi.mocked(createDriver).mockClear();
  vi.mocked(loadEnabledAdapters).mockClear();
  vi.mocked(executeOtDeviceWrite).mockClear();
  _resetSweepRateLimitsForTests();
  spies = [vi.spyOn(console, "error").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
});
afterEach(() => {
  _allowTransientStopOnTestDbForTests(false);
  for (const k of ENV_KEYS) datEnv(k, savedEnv[k]);
  for (const s of spies) s.mockRestore();
});

describe("D2 — robot: phiên STOP tạm trên CSDL _test chỉ mô phỏng", () => {
  it("★ URL …/x_test + ROBOT_CONTROL_ENABLED=true ⇒ không đọc hàng robot, không createRobotDriver, simulated với câu rõ", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    const r = await sendCentralRobotStop(28438);
    expect(r).toEqual({ ok: true, sent: "simulated", detail: ROBOT_TEST_DETAIL });
    expect(prefetchRobotStopRow).not.toHaveBeenCalled();
    expect(createRobotDriver).not.toHaveBeenCalled();
    expect(runRobotDeviceStage).not.toHaveBeenCalled();
  });

  it("★ URL …/x (không phải _test) ⇒ đường phiên tạm cũ: createRobotDriver đúng 1 lần, đúng vendor, abort gửi", async () => {
    datEnv("DATABASE_URL", URL_KHONG_TEST);
    const r = await sendCentralRobotStop(28438);
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createRobotDriver).toHaveBeenCalledWith("fanuc");
    expect(r).toEqual({ ok: true, sent: "sent", detail: "abort sent on a transient session" });
  });

  it("★ tên chứa _test nhưng KHÔNG kết thúc bằng _test (x_test_bak) ⇒ không phải _test: createRobotDriver đúng 1 lần", async () => {
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9/x_test_bak");
    const r = await sendCentralRobotStop(5);
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe("sent");
  });

  it.each([
    ["DATABASE_URL không đặt", undefined],
    ["không phải URL", "not a url"],
    ["URL không có tên CSDL", "postgres://app:pw@127.0.0.1:9"],
    ["URL tên CSDL rỗng", "postgres://app:pw@127.0.0.1:9/"],
  ])("★ fail-closed — %s ⇒ coi như _test: không đọc hàng, không createRobotDriver", async (_ten, url) => {
    datEnv("DATABASE_URL", url);
    const r = await sendCentralRobotStop(28438);
    expect(r).toEqual({ ok: true, sent: "simulated", detail: ROBOT_UNKNOWN_DETAIL });
    expect(prefetchRobotStopRow).not.toHaveBeenCalled();
    expect(createRobotDriver).not.toHaveBeenCalled();
  });

  it("★ nguồn tên đúng như postgres.js: ?database= ghi đè đường dẫn (…/x?database=x_test ⇒ _test; …/x_test?database=x ⇒ không)", async () => {
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9/x?database=x_test");
    expect(await sendCentralRobotStop(1)).toEqual({ ok: true, sent: "simulated", detail: ROBOT_TEST_DETAIL });
    expect(createRobotDriver).not.toHaveBeenCalled();
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9/x_test?database=x");
    expect((await sendCentralRobotStop(1)).sent).toBe("sent");
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
  });

  it("URL nhiều host (h1,h2) đọc được tên ⇒ …/x vẫn gửi (không fail-closed nhầm trên production)", async () => {
    datEnv("DATABASE_URL", "postgres://app:pw@10.1.1.1:5432,10.1.1.2:5432/aoi_management");
    expect((await sendCentralRobotStop(1)).sent).toBe("sent");
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
  });

  it("★ không hồi quy — cờ TẮT trên _test ⇒ câu dry-run cũ, nguyên văn", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    datEnv("ROBOT_CONTROL_ENABLED", undefined);
    expect(await sendCentralRobotStop(28438)).toEqual({ ok: true, sent: "simulated", detail: "dry-run (ROBOT_CONTROL_ENABLED off) — nothing sent" });
    datEnv("ROBOT_CONTROL_ENABLED", "false");
    expect(await sendCentralRobotStop(28438)).toEqual({ ok: true, sent: "simulated", detail: "dry-run (ROBOT_CONTROL_ENABLED off) — nothing sent" });
    expect(createRobotDriver).not.toHaveBeenCalled();
  });

  it("★ console STOP (sendCentralRobotStop có hàng đọc sẵn) trên _test ⇒ không driver, không dùng hàng đọc sẵn", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    let daDoc = false;
    const row = Promise.resolve({ ok: true as const, row: { vendor: "fanuc", endpoint: "tcp://10.0.0.1", connectionOptions: null } }).then((x) => ((daDoc = true), x));
    const r = await sendCentralRobotStop(28438, { row });
    await row;
    expect(r).toEqual({ ok: true, sent: "simulated", detail: ROBOT_TEST_DETAIL });
    expect(createRobotDriver).not.toHaveBeenCalled();
    expect(runRobotDeviceStage).not.toHaveBeenCalled();
    expect(daDoc).toBe(true); // lời hứa của người gọi vẫn tự xong — chỉ là không được dùng
  });
});

describe("D2 — adapter: phiên STOP tạm trên CSDL _test chỉ mô phỏng", () => {
  it("★ URL …/x_test + OT_CONTROL_ENABLED=true (có tag ghim) ⇒ không đọc tag, không nạp adapter, không createDriver, simulated", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    const r = await sendCentralAdapterStop(21);
    expect(r).toEqual({ ok: true, sent: "simulated", detail: ADAPTER_TEST_DETAIL });
    expect(H.tagReads).toBe(0);
    expect(loadEnabledAdapters).not.toHaveBeenCalled();
    expect(createDriver).not.toHaveBeenCalled();
    expect(executeOtDeviceWrite).not.toHaveBeenCalled();
  });

  it("★ URL …/x ⇒ đường phiên tạm cũ: createDriver đúng 1 lần, ghi STOP ghim", async () => {
    datEnv("DATABASE_URL", URL_KHONG_TEST);
    const r = await sendCentralAdapterStop(21);
    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledWith("modbus");
    expect(executeOtDeviceWrite).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, sent: "sent", detail: "pinned stop written (stop_run)" });
  });

  it("★ tên x_test_bak ⇒ không phải _test: createDriver đúng 1 lần", async () => {
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9/x_test_bak");
    expect((await sendCentralAdapterStop(21)).sent).toBe("sent");
    expect(createDriver).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["DATABASE_URL không đặt", undefined],
    ["không phải URL", "not a url"],
    ["URL không có tên CSDL", "postgres://app:pw@127.0.0.1:9"],
  ])("★ fail-closed — %s ⇒ coi như _test: không createDriver", async (_ten, url) => {
    datEnv("DATABASE_URL", url);
    const r = await sendCentralAdapterStop(21);
    expect(r).toEqual({ ok: true, sent: "simulated", detail: ADAPTER_UNKNOWN_DETAIL });
    expect(H.tagReads).toBe(0);
    expect(createDriver).not.toHaveBeenCalled();
  });

  it("★ không hồi quy — cờ TẮT trên _test ⇒ câu dry-run cũ, nguyên văn", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    datEnv("OT_CONTROL_ENABLED", undefined);
    expect(await sendCentralAdapterStop(21)).toEqual({ ok: true, sent: "simulated", detail: "dry-run (OT_CONTROL_ENABLED off) — nothing written" });
    expect(createDriver).not.toHaveBeenCalled();
  });
});

describe("D2 — sweep toàn cục trên _test: 0 lần driver, NOT SENT CRITICAL, ghi như dry-run", () => {
  it("★ 1 robot + 1 adapter nợ STOP ⇒ 0 driver; mỗi thiết bị 1 bản ghi NOT SENT và 1 báo động CRITICAL; yêu cầu vẫn PENDING", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    H.pendingDevices = [
      { robotId: 28438, adapterId: null },
      { robotId: null, adapterId: 21 },
    ];
    H.pick = [{ id: 501, requestedBy: 7, cannotList: false }];
    const out = await sweepPendingCentralStops();
    expect(createRobotDriver).not.toHaveBeenCalled();
    expect(createDriver).not.toHaveBeenCalled();
    expect(prefetchRobotStopRow).not.toHaveBeenCalled();
    expect(H.dispatched).toEqual([]);
    expect(out).toEqual([
      { requestIds: [501], outcome: "failed", sent: "simulated", detail: ROBOT_TEST_DETAIL, ackErrors: [], notSent: true },
      { requestIds: [501], outcome: "failed", sent: "simulated", detail: ADAPTER_TEST_DETAIL, ackErrors: [], notSent: true },
    ]);
    // ghi central_stop_executions đúng như nhánh dry-run (ok=false, "NOT SENT — …"), không ack nào
    expect(H.records).toEqual([
      { kind: "robot", deviceId: 28438, ok: false, detail: `NOT SENT — central control is off (${ROBOT_TEST_DETAIL})` },
      { kind: "adapter", deviceId: 21, ok: false, detail: `NOT SENT — central control is off (${ADAPTER_TEST_DETAIL})` },
    ]);
    expect(H.acks).toEqual([]);
    await vi.waitFor(() => expect(H.alerts).toHaveLength(2));
    expect(H.alerts.map((a) => [a.kind, a.entityId])).toEqual([
      ["central_stop_after_transfer", 28438],
      ["central_stop_after_transfer", 21],
    ]);
    expect(H.alerts[0].message).toContain(`the STOP was NOT SENT: central control is off (${ROBOT_TEST_DETAIL}) — requests #501 stay PENDING`);
    expect(H.alerts[1].message).toContain(`the STOP was NOT SENT: central control is off (${ADAPTER_TEST_DETAIL}) — requests #501 stay PENDING`);
  });

  it("đối chứng: cùng sweep trên …/x ⇒ mỗi thiết bị đúng 1 driver, STOP gửi, yêu cầu được ack", async () => {
    datEnv("DATABASE_URL", URL_KHONG_TEST);
    H.pendingDevices = [
      { robotId: 28438, adapterId: null },
      { robotId: null, adapterId: 21 },
    ];
    H.pick = [{ id: 501, requestedBy: 7, cannotList: false }];
    const out = await sweepPendingCentralStops();
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(out.map((o) => [o.outcome, o.sent])).toEqual([
      ["done", "sent"],
      ["done", "sent"],
    ]);
    expect(H.acks).toEqual([501, 501]);
  });
});

describe("D2 — chốt mở CHỈ CHO TEST (_allowTransientStopOnTestDbForTests)", () => {
  it("★ bật ⇒ đường phiên tạm cũ chạy trên _test; trả lại ⇒ chốt về đóng", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    _allowTransientStopOnTestDbForTests(true);
    expect((await sendCentralRobotStop(1)).sent).toBe("sent");
    expect((await sendCentralAdapterStop(21)).sent).toBe("sent");
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledTimes(1);
    _allowTransientStopOnTestDbForTests(false);
    expect(await sendCentralRobotStop(1)).toEqual({ ok: true, sent: "simulated", detail: ROBOT_TEST_DETAIL });
    expect(await sendCentralAdapterStop(21)).toEqual({ ok: true, sent: "simulated", detail: ADAPTER_TEST_DETAIL });
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledTimes(1);
  });

  it("★ census — không tệp nào ngoài *.test.ts nhắc _allowTransientStopOnTestDbForTests (trừ nơi định nghĩa)", () => {
    const goc = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const BO_QUA = new Set(["node_modules", ".git", "dist", "obj", "bin", ".vite", "coverage"]);
    const tep: string[] = [];
    const di = (d: string) => {
      for (const ten of readdirSync(d)) {
        if (BO_QUA.has(ten)) continue;
        const full = join(d, ten);
        if (statSync(full).isDirectory()) di(full);
        else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(ten) && !/\.test\.tsx?$/.test(ten)) tep.push(full);
      }
    };
    for (const thuMuc of ["server", "shared", "scripts", "e2e", "client/src"]) di(join(goc, thuMuc));
    expect(tep.length).toBeGreaterThan(500); // quét thật (không phải glob rỗng)
    const dinhNghia = join(goc, "server", "services", "robot", "deviceOwnershipService.ts");
    expect(tep).toContain(dinhNghia);
    const viPham = tep.filter((f) => f !== dinhNghia && readFileSync(f, "utf8").includes("_allowTransientStopOnTestDbForTests")).map((f) => relative(goc, f).split(sep).join("/"));
    expect(viPham).toEqual([]);
    // nơi định nghĩa: đúng một lần khai báo export
    expect(readFileSync(dinhNghia, "utf8").match(/export function _allowTransientStopOnTestDbForTests\(/g)).toHaveLength(1);
  });
});
