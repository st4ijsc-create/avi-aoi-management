/**
 * D2 (chủ dự án duyệt 14/11; lượt sửa 1 theo phương án (x) của HST) — CHỈ VÒNG QUÉT STOP (sweepPendingCentralStops /
 * executePendingCentralStops → sendCentralStop) trên CSDL CHẮC LÀ `_test` không mở phiên STOP TẠM: robot không có phiên ⇒ không
 * đọc hàng robot, không createRobotDriver; adapter không có driver đang chạy ⇒ không nạp adapter, không createDriver. Đường NOT SENT
 * cũ ghi `central_stop_executions` và phát CRITICAL, với chữ nói đúng lý do (CSDL _test, không phải "central control is off").
 * Tên CSDL không xác định được ⇒ gửi như cũ + MỘT cảnh báo CRITICAL mỗi tiến trình (người nhận: quản trị).
 * Ngoài vòng quét (console STOP sendCentralRobotStop, dự phòng dispatcher sendCentralAdapterStop, robot có phiên, adapter có driver
 * đang chạy): hành vi GIỐNG main 46a47cd11 — driver được gọi, chữ trả về không đổi.
 *
 * Test thuần: DB, driver, sổ ghi, báo động đều giả; tên CSDL đọc thật từ DATABASE_URL (csdlDichStop). Không DB thật, không mạng.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const H = vi.hoisted(() => ({
  /** robot / adapter đang nợ STOP trong device_pending_stops (sweep toàn cục) */
  pendingDevices: [] as Array<{ robotId: number | null; adapterId: number | null }>,
  /** yêu cầu STOP chưa ack của từng thiết bị (lượt chọn FOR UPDATE SKIP LOCKED) */
  pick: [] as Array<{ id: number; requestedBy: number; cannotList: boolean }>,
  robotSession: false,
  runningDriver: null as null | { tag: string },
  alerts: [] as Array<{ kind: string; title: string; message: string; recipients: number[]; entityId?: number | string }>,
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
        if (text.includes("public.users")) return [{ id: 1 }, { id: 2 }];
        return [];
      },
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      select: () => ({ from: () => ({ where: async () => [{ tagKey: "stop_run", address: "40001", dataType: "uint16", scale: null, offset: null }] }) }),
    };
  },
}));
vi.mock("./robotManager", () => ({
  getActiveRobot: () => (H.robotSession ? { id: 7, driver: {} } : undefined),
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
  prefetchRobotStopRow: vi.fn(async () => ({ ok: true, row: { vendor: "fanuc", endpoint: "tcp://127.0.0.1:9", connectionOptions: null } })),
}));
vi.mock("./driverRegistry", () => ({
  createRobotDriver: vi.fn(() => ({ connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) })),
}));
vi.mock("./robotDeviceRun", () => ({ runRobotDeviceStage: vi.fn(async () => ({ status: "done" })) }));
vi.mock("../ot/stopPin", () => ({ loadStopPins: vi.fn(async () => [{ tagKey: "stop_run", value: 0 }]) }));
vi.mock("../ot/otManager", () => ({
  getActiveDriver: () => H.runningDriver ?? undefined,
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
  raiseCriticalStopAlert: vi.fn(async (a: { kind: string; title: string; message: string; recipients: number[]; entityId?: number | string }) => void H.alerts.push(a)),
}));

import { sendCentralRobotStop, sendCentralAdapterStop, sweepPendingCentralStops, executePendingCentralStops, _resetSweepRateLimitsForTests } from "./deviceOwnershipService";
import { createRobotDriver } from "./driverRegistry";
import { prefetchRobotStopRow } from "./robotStopRow";
import { createDriver } from "../ot/driverRegistry";
import { loadEnabledAdapters } from "../ot/deviceAdapter";
import { executeOtDeviceWrite } from "../ot/otDeviceWrite";

const URL_TEST = "postgres://app:pw@127.0.0.1:9/x_test";
const URL_PROD = "postgres://app:pw@127.0.0.1:9/aoi_management";
const URL_KXD = "not a url";
const ROBOT_TEST_DETAIL = "this server's DB is a _test DB (x_test) — the central transient STOP session was not opened — nothing was sent";
const ADAPTER_TEST_DETAIL = "this server's DB is a _test DB (x_test) — the central transient STOP session was not opened — the pinned stop was not written";
const ROBOT_DRY = "dry-run (ROBOT_CONTROL_ENABLED off) — nothing sent";
const ADAPTER_DRY = "dry-run (OT_CONTROL_ENABLED off) — nothing written";

const ENV_KEYS = ["DATABASE_URL", "ROBOT_CONTROL_ENABLED", "OT_CONTROL_ENABLED", "PGDATABASE", "PGUSERNAME", "PGUSER"] as const;
let savedEnv: Record<string, string | undefined> = {};
let spies: Array<{ mockRestore: () => void }> = [];
function datEnv(k: (typeof ENV_KEYS)[number], v: string | undefined): void {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
const choBaoDong = () => new Promise<void>((r) => setTimeout(r, 20)); // báo động là `void import(...).then(...)`
const pendingMotRobotMotAdapter = () => {
  H.pendingDevices = [
    { robotId: 28438, adapterId: null },
    { robotId: null, adapterId: 21 },
  ];
  H.pick = [{ id: 501, requestedBy: 7, cannotList: false }];
};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) datEnv(k, undefined);
  datEnv("ROBOT_CONTROL_ENABLED", "true");
  datEnv("OT_CONTROL_ENABLED", "true");
  H.pendingDevices = [];
  H.pick = [];
  H.robotSession = false;
  H.runningDriver = null;
  H.alerts.length = 0;
  H.records.length = 0;
  H.acks.length = 0;
  H.dispatched.length = 0;
  vi.mocked(createRobotDriver).mockClear();
  vi.mocked(prefetchRobotStopRow).mockClear();
  vi.mocked(createDriver).mockClear();
  vi.mocked(loadEnabledAdapters).mockClear();
  vi.mocked(executeOtDeviceWrite).mockClear();
  _resetSweepRateLimitsForTests();
  spies = [vi.spyOn(console, "error").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined)];
});
afterEach(() => {
  for (const k of ENV_KEYS) datEnv(k, savedEnv[k]);
  for (const s of spies) s.mockRestore();
});

describe("D2 — vòng quét trên CSDL chắc là _test: không mở phiên tạm, NOT SENT + CRITICAL, chữ đúng", () => {
  it("★ sweep toàn cục, 1 robot + 1 adapter nợ STOP ⇒ 0 đọc hàng robot, 0 driver, 0 nạp adapter; kết quả simulated + notSent", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    pendingMotRobotMotAdapter();
    const out = await sweepPendingCentralStops();
    expect(prefetchRobotStopRow).not.toHaveBeenCalled();
    expect(createRobotDriver).not.toHaveBeenCalled();
    expect(loadEnabledAdapters).not.toHaveBeenCalled();
    expect(createDriver).not.toHaveBeenCalled();
    expect(executeOtDeviceWrite).not.toHaveBeenCalled();
    expect(out).toEqual([
      { requestIds: [501], outcome: "failed", sent: "simulated", detail: ROBOT_TEST_DETAIL, ackErrors: [], notSent: true },
      { requestIds: [501], outcome: "failed", sent: "simulated", detail: ADAPTER_TEST_DETAIL, ackErrors: [], notSent: true },
    ]);
    expect(H.acks).toEqual([]);
  });

  it("★ bản ghi central_stop_executions và báo động CRITICAL nói đúng lý do _test (không 'central control is off', không 'enable central control')", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    pendingMotRobotMotAdapter();
    await sweepPendingCentralStops();
    await choBaoDong();
    expect(H.records).toEqual([
      { kind: "robot", deviceId: 28438, ok: false, detail: `NOT SENT — ${ROBOT_TEST_DETAIL}` },
      { kind: "adapter", deviceId: 21, ok: false, detail: `NOT SENT — ${ADAPTER_TEST_DETAIL}` },
    ]);
    expect(H.alerts.map((a) => [a.kind, a.entityId, a.recipients])).toEqual([
      ["central_stop_after_transfer", 28438, [7]],
      ["central_stop_after_transfer", 21, [7]],
    ]);
    expect(H.alerts[0].message).toContain(`the STOP was NOT SENT: ${ROBOT_TEST_DETAIL} — requests #501 stay PENDING. Stop the equipment on site (hardware E-STOP)`);
    expect(H.alerts[1].message).toContain(`the STOP was NOT SENT: ${ADAPTER_TEST_DETAIL} — requests #501 stay PENDING. Stop the equipment on site (hardware E-STOP)`);
    for (const a of H.alerts) {
      expect(a.message).not.toContain("central control is off");
      expect(a.message).not.toContain("enable central control");
    }
  });

  it("★ STOP nợ sau chuyển chủ về trung tâm (executePendingCentralStops, robot không phiên) trên _test ⇒ không driver", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    H.pick = [{ id: 601, requestedBy: 3, cannotList: false }];
    const r = await executePendingCentralStops("robot", 28440, 3);
    expect(createRobotDriver).not.toHaveBeenCalled();
    expect(r).toEqual({ requestIds: [601], outcome: "failed", sent: "simulated", detail: ROBOT_TEST_DETAIL, ackErrors: [], notSent: true });
  });

  it("★ _test nhưng KHÔNG neo cuối (x_test_bak) ⇒ không phải _test: vòng quét mở phiên tạm, driver đúng 1 lần mỗi thiết bị", async () => {
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9/x_test_bak");
    pendingMotRobotMotAdapter();
    const out = await sweepPendingCentralStops();
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(out.map((o) => [o.outcome, o.sent])).toEqual([
      ["done", "sent"],
      ["done", "sent"],
    ]);
  });

  it("★ không path + PGDATABASE=…_test (chuỗi lùi của postgres.js) ⇒ chắc là _test ⇒ không driver", async () => {
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9");
    datEnv("PGDATABASE", "x_test");
    pendingMotRobotMotAdapter();
    await sweepPendingCentralStops();
    expect(createRobotDriver).not.toHaveBeenCalled();
    expect(createDriver).not.toHaveBeenCalled();
  });
});

describe("D2 — vòng quét trên CSDL chắc KHÔNG phải _test: như cũ, không cảnh báo thêm", () => {
  it("★ …/aoi_management ⇒ mỗi thiết bị đúng 1 driver, STOP gửi, yêu cầu được ack, 0 báo động", async () => {
    datEnv("DATABASE_URL", URL_PROD);
    pendingMotRobotMotAdapter();
    const out = await sweepPendingCentralStops();
    await choBaoDong();
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createRobotDriver).toHaveBeenCalledWith("fanuc");
    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(out.map((o) => [o.outcome, o.sent, o.detail])).toEqual([
      ["done", "sent", "abort sent on a transient session"],
      ["done", "sent", "pinned stop written (stop_run)"],
    ]);
    expect(H.acks).toEqual([501, 501]);
    expect(H.alerts).toEqual([]);
  });

  it("★ không path + PGDATABASE prod (lỗi chặn A của bản trước) ⇒ GỬI, 0 báo động", async () => {
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9/");
    datEnv("PGDATABASE", "aoi_management");
    pendingMotRobotMotAdapter();
    await sweepPendingCentralStops();
    await choBaoDong();
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(H.alerts).toEqual([]);
  });

  it("★ …/AOI_MANAGEMENT_TEST (_TEST viết HOA) ⇒ chac-khong-phai-test ⇒ GỬI như cũ, 0 báo động", async () => {
    // ruling dieu-phoi 14/11: Postgres so tên CSDL nguyên văn (phân biệt hoa thường) và (x) chỉ mô phỏng khi CHẮC là _test ⇒
    // "_TEST" hoa không phải _test. Đột biến so không phân biệt hoa thường (/_test$/i) phải làm ca này đỏ.
    // CSDL thử phải đặt tên chữ thường kết thúc _test thì D2 mới nhận ra.
    datEnv("DATABASE_URL", "postgres://app:pw@127.0.0.1:9/AOI_MANAGEMENT_TEST");
    pendingMotRobotMotAdapter();
    const out = await sweepPendingCentralStops();
    await choBaoDong();
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(out.map((o) => [o.outcome, o.sent])).toEqual([
      ["done", "sent"],
      ["done", "sent"],
    ]);
    expect(H.alerts).toEqual([]);
  });
});

describe("D2 — vòng quét khi KHÔNG xác định được tên CSDL: gửi như cũ + MỘT cảnh báo mỗi tiến trình", () => {
  it("★ URL hỏng ⇒ driver được gọi (gửi như cũ); đúng MỘT cảnh báo CRITICAL central_stop_db_name_unknown tới quản trị, qua hai lượt quét", async () => {
    // TỔ HỢP GIẢ LẬP, KHÔNG xảy ra thật: "URL hỏng" + "DB giả vẫn trả hàng chờ và danh sách admin". Thật ra khong-xac-dinh chỉ có khi
    // getDb() KHÔNG dựng được pool ⇒ không đọc được hàng chờ / người nhận ⇒ cảnh báo không vào hộp thư (chỉ log + luồng cảnh báo).
    // Ca này CHỈ kiểm logic: D2 không chặn (gửi như cũ) và cảnh báo phát MỘT lần mỗi tiến trình — KHÔNG chứng minh cảnh báo bền.
    datEnv("DATABASE_URL", URL_KXD);
    pendingMotRobotMotAdapter();
    const lan1 = await sweepPendingCentralStops();
    const lan2 = await sweepPendingCentralStops();
    await choBaoDong();
    expect(createRobotDriver).toHaveBeenCalledTimes(2);
    expect(createDriver).toHaveBeenCalledTimes(2);
    expect([...lan1, ...lan2].map((o) => o.sent)).toEqual(["sent", "sent", "sent", "sent"]);
    const canhBao = H.alerts.filter((a) => a.kind === "central_stop_db_name_unknown");
    expect(canhBao).toHaveLength(1);
    expect(canhBao[0].recipients).toEqual([1, 2]);
    expect(canhBao[0].message).toContain("could not be determined");
    expect(canhBao[0].message).toContain("STOPs owed are sent as before");
    expect(H.alerts).toHaveLength(1);
  });
});

describe("D2 — cờ TẮT: chữ dry-run cũ nguyên văn (không hồi quy)", () => {
  it("★ _test + cả hai cờ tắt ⇒ ghi và báo động y như main", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    datEnv("ROBOT_CONTROL_ENABLED", undefined);
    datEnv("OT_CONTROL_ENABLED", "false");
    pendingMotRobotMotAdapter();
    const out = await sweepPendingCentralStops();
    await choBaoDong();
    expect(out.map((o) => o.detail)).toEqual([ROBOT_DRY, ADAPTER_DRY]);
    expect(H.records.map((r) => r.detail)).toEqual([`NOT SENT — central control is off (${ROBOT_DRY})`, `NOT SENT — central control is off (${ADAPTER_DRY})`]);
    expect(H.alerts[0].message).toContain(`the STOP was NOT SENT: central control is off (${ROBOT_DRY}) — requests #501 stay PENDING. Stop the equipment on site (hardware E-STOP) or enable central control`);
    expect(H.alerts[1].message).toContain(`the STOP was NOT SENT: central control is off (${ADAPTER_DRY}) — requests #501 stay PENDING. Stop the equipment on site (hardware E-STOP) or enable central control`);
  });
});

describe("D2 — NGOÀI vòng quét trên _test (cờ bật): giống main 46a47cd11", () => {
  it("★ console STOP (sendCentralRobotStop, không phiên) ⇒ phiên tạm mở như main: createRobotDriver 1 lần, chữ trả về không đổi, 0 báo động D2", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    const r = await sendCentralRobotStop(28438);
    await choBaoDong();
    expect(prefetchRobotStopRow).toHaveBeenCalledTimes(1);
    expect(createRobotDriver).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, sent: "sent", detail: "abort sent on a transient session" });
    expect(H.alerts).toEqual([]);
  });

  it("★ console STOP với tên CSDL không xác định ⇒ như main, KHÔNG cảnh báo db-name-unknown (cảnh báo chỉ của vòng quét)", async () => {
    datEnv("DATABASE_URL", URL_KXD);
    expect(await sendCentralRobotStop(28438)).toEqual({ ok: true, sent: "sent", detail: "abort sent on a transient session" });
    await choBaoDong();
    expect(H.alerts).toEqual([]);
  });

  it("★ dự phòng dispatcher (sendCentralAdapterStop) ⇒ như main: nạp adapter, createDriver 1 lần, chữ không đổi", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    const r = await sendCentralAdapterStop(21);
    expect(loadEnabledAdapters).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledTimes(1);
    expect(createDriver).toHaveBeenCalledWith("modbus");
    expect(r).toEqual({ ok: true, sent: "sent", detail: "pinned stop written (stop_run)" });
  });

  it("★ vòng quét, adapter có driver ĐANG CHẠY ⇒ ghi qua driver đó như main (không phiên tạm, không bị D2 chặn)", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    H.runningDriver = { tag: "running" };
    H.pendingDevices = [{ robotId: null, adapterId: 21 }];
    H.pick = [{ id: 501, requestedBy: 7, cannotList: false }];
    const out = await sweepPendingCentralStops();
    expect(createDriver).not.toHaveBeenCalled();
    expect(executeOtDeviceWrite).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeOtDeviceWrite).mock.calls[0][0].driver).toBe(H.runningDriver);
    expect(out).toEqual([{ requestIds: [501], outcome: "done", sent: "sent", detail: "pinned stop written (stop_run)", ackErrors: [] }]);
  });

  it("★ vòng quét, robot có phiên ⇒ dispatchRobotJob như main (không bị D2 chặn)", async () => {
    datEnv("DATABASE_URL", URL_TEST);
    H.robotSession = true;
    H.pendingDevices = [{ robotId: 7, adapterId: null }];
    H.pick = [{ id: 502, requestedBy: 7, cannotList: false }];
    const out = await sweepPendingCentralStops();
    expect(H.dispatched).toEqual([7]);
    expect(createRobotDriver).not.toHaveBeenCalled();
    expect(out).toEqual([{ requestIds: [502], outcome: "done", sent: "sent", detail: "robot_jobs #1 done", ackErrors: [] }]);
  });
});
