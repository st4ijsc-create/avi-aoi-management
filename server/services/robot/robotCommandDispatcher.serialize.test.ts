/**
 * doc 81 Đợt 1B final wave (ruling R14) — MỘT robot, MỘT chuyển động tại một thời điểm (trong tiến trình).
 *
 * Lỗi được ghim (Task 5, PARKED): dispatcher không tuần tự hoá job theo robot ⇒ hai chuyển động chồng
 * nhau dùng chung một phiên transport (FANUC: SequenceID khởi động lại sau mỗi FRC_Initialize ⇒ trả lời
 * của M2 có thể "đóng" M1). Sửa: chuyển động thứ hai bị TỪ CHỐI (`robot_motion_in_progress`, không xếp
 * hàng) khi một chuyển động khác của cùng robot đang chạy; lệnh DỪNG không bao giờ bị từ chối vì thế.
 *
 * Harness như robotCommandDispatcher.safety.test.ts: `MitsubishiDriver` THẬT + bộ điều khiển MELFA GIẢ
 * trong tiến trình (127.0.0.1, cổng 0, đóng ở afterAll), trả lời literal theo BFP-A3379. Oracle = BYTE
 * server giả nhận được theo từng kết nối: chuyển động bị từ chối phải gửi 0 byte.
 */
import net from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
// doc 81 Đợt 4 final wave R-4-x — this suite does not measure the motion "robot enabled" gate (robotEnabledGate.dot4.test.ts does).
vi.mock("./robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));

vi.setConfig({ testTimeout: 30_000 });

type Row = Record<string, any>;

const ledger = vi.hoisted(() => ({ rows: [] as Row[], seq: 1 }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: any) => ({ __op: "eq", __k: col?.__name, __v: val }),
    and: (...preds: any[]) => ({ __op: "and", preds }),
  };
});

function matches(row: Row, pred: any): boolean {
  if (!pred) return true;
  if (pred.__op === "eq") return row[pred.__k] === pred.__v;
  if (pred.__op === "and") return pred.preds.every((p: any) => matches(row, p));
  return true;
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => {
    const tableRows = (t: any) => (t?.__table === "robot_jobs" ? ledger.rows : []);
    return {
      select: () => ({
        from: (t: any) => ({
          where: (pred: any) => {
            const out = tableRows(t).filter((r) => matches(r, pred));
            return { limit: async () => out.slice(0, 1), then: (res: any, rej: any) => Promise.resolve(out).then(res, rej) };
          },
        }),
      }),
      insert: (t: any) => ({
        values: (vals: Row) => ({
          returning: async () => {
            const row = { id: ledger.seq++, ...vals };
            if (t?.__table === "robot_jobs") ledger.rows.push(row);
            return [{ id: row.id }];
          },
        }),
      }),
      update: (t: any) => ({
        set: (vals: Row) => ({
          where: async (pred: any) => {
            for (const r of tableRows(t)) if (matches(r, pred)) Object.assign(r, vals);
          },
        }),
      }),
    };
  }),
}));
vi.mock("../../../drizzle/schema", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  robotJobs: { __table: "robot_jobs", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" } },
  robots: { __table: "robots", id: { __name: "id" } },
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" } },
}));

const active = vi.hoisted(() => ({ driver: null as any }));
vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) => (id === 7 && active.driver ? { driver: active.driver } : undefined),
}));
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async () => ({ blocked: false, failClosed: false, violations: [] })),
}));
// Nguồn đọc nền của facade an toàn THẬT: PLC sạch (OK) trong cả tệp này.
vi.mock("../safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: () => true,
  // Đợt 1C Task 1 (2026-09-27): preflight lệnh THẬT chỉ nhận PLC `real` (endpoint + tag an toàn gán) đọc qua
  // readChecked — cấu hình giả mang hình dạng đó (endpoint TEST-NET-1, không bao giờ được nối: backend bị giả).
  listPlcConfigs: async () => [{ code: "SPLC-1", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
  backendForConfig: () => ({
    read: async () => ({ estop: false }),
    readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
  }),
  statusToFindings: () => [],
}));

import { dispatchRobotJob, ROBOT_MOTION_IN_PROGRESS } from "./robotCommandDispatcher";
import { MitsubishiDriver } from "./drivers/mitsubishiRobotDriver";

// ── Bộ điều khiển MELFA giả (R3, BFP-A3379) ──────────────────────────────────
type Reply = string | null | { reply: string | null; delayMs: number };
interface FakeMelfa {
  port: number;
  conns: string[][];
  respond: (cmd: string) => Reply;
  close(): Promise<void>;
}
const MOTION = /^(CNTLON|SRVON|EXEC)/;

async function startFakeMelfa(): Promise<FakeMelfa> {
  const socks = new Set<net.Socket>();
  const fake: FakeMelfa = { port: 0, conns: [], respond: () => "Qok", close: async () => undefined };
  const srv = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
    const cmds: string[] = [];
    fake.conns.push(cmds);
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      let i: number;
      while ((i = buf.indexOf("\r")) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const cmd = frame.split(";").slice(2).join(";");
        cmds.push(cmd);
        const ans = fake.respond(cmd);
        const { reply, delayMs } = typeof ans === "object" && ans !== null ? ans : { reply: ans, delayMs: 0 };
        if (reply != null) {
          if (delayMs > 0) setTimeout(() => { if (!sock.destroyed) sock.write(`${reply}\r`); }, delayMs);
          else if (!sock.destroyed) sock.write(`${reply}\r`);
        }
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  fake.port = (srv.address() as net.AddressInfo).port;
  fake.close = async () => {
    for (const s of socks) s.destroy();
    await new Promise<void>((r) => srv.close(() => r()));
  };
  return fake;
}

function healthy(cmd: string): Reply {
  if (cmd.startsWith("OPEN=")) return "Qok";
  if (cmd === "STATE") return "Qok1;0;0";
  return "Qok";
}

async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`still pending after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(t);
  }
}
const allCmds = (f: FakeMelfa) => f.conns.flat();
const motionCmds = (f: FakeMelfa) => allCmds(f).filter((c) => MOTION.test(c));
/** Chờ tới khi server giả THẤY lệnh `cmd` (M1 đã cầm slot và đang chạy) — không dựa vào sleep mù. */
async function untilSeen(f: FakeMelfa, cmd: string, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!allCmds(f).includes(cmd)) {
    if (Date.now() - t0 > ms) throw new Error(`fake never saw ${cmd} within ${ms}ms`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "FIELD_V2_ENABLED", "SEC_PLATFORM", "ROBOT_SAFETY_PREFLIGHT_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};
let fake: FakeMelfa;
let driver: MitsubishiDriver;

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  fake = await startFakeMelfa();
  await import("../ot/adapterFacade");
}, 60_000);
afterAll(async () => {
  await fake.close();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(async () => {
  ledger.rows.length = 0;
  ledger.seq = 1;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
  delete process.env.FIELD_V2_ENABLED;
  delete process.env.SEC_PLATFORM;
  delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
  fake.respond = healthy;
  driver = new MitsubishiDriver();
  await driver.connect({ endpoint: `tcp://127.0.0.1:${fake.port}`, timeoutMs: 2000 });
  active.driver = driver;
  for (const c of fake.conns) c.length = 0;
});
afterEach(async () => {
  active.driver = null;
  await driver.disconnect().catch(() => undefined);
});

const manual = (job: { jobType: "home" | "abort"; params?: Record<string, unknown> }, key?: string) => ({
  robotId: 7,
  job,
  triggerKind: "manual" as const,
  requestedBy: 7,
  confirmedBy: 7,
  idempotencyKey: key,
});

describe("R14 — tuần tự hoá chuyển động theo robot", () => {
  it("★ hai chuyển động chồng nhau trên một robot ⇒ M2 bị từ chối robot_motion_in_progress, server giả chỉ nhận BYTE của M1; slot được nhả sau khi M1 xong", async () => {
    // EXEC của M1 được trả lời TRỄ để M1 còn "đang chạy" khi M2 tới.
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? { reply: "Qok", delayMs: 900 } : healthy(cmd));
    const m1 = dispatchRobotJob(manual({ jobType: "home" }));
    await untilSeen(fake, "CNTLON");

    const m2 = await within(dispatchRobotJob(manual({ jobType: "home" })), 3000);
    expect(m2.status).toBe("rejected");
    expect(m2.error).toBe(ROBOT_MOTION_IN_PROGRESS);
    expect(m2.ok).toBe(false);
    // Sổ: dòng rejected mang reasonCode máy-đọc.
    const rej = ledger.rows.find((r) => r.status === "rejected");
    expect(rej?.result?.reasonCode).toBe(ROBOT_MOTION_IN_PROGRESS);

    const r1 = await within(m1, 5000);
    expect(r1.status).toBe("done");
    // Oracle độc lập: đúng MỘT chuỗi CNTLON → SRVON → EXEC tới robot (của M1); M2 gửi 0 byte.
    const motion = motionCmds(fake);
    expect(motion).toHaveLength(3);
    expect(motion[0]).toBe("CNTLON");
    expect(motion[1]).toBe("SRVON");
    expect(motion[2]).toMatch(/^EXEC/);

    // Slot đã nhả: chuyển động kế tiếp (sau khi M1 kết thúc) đi qua bình thường.
    fake.respond = healthy;
    const m3 = await within(dispatchRobotJob(manual({ jobType: "home" })), 5000);
    expect(m3.status).toBe("done");
    expect(motionCmds(fake)).toHaveLength(6);
  });

  it("★ DỪNG trong lúc M1 đang chạy KHÔNG bị từ chối vì slot: STOP vẫn tới robot", async () => {
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? { reply: "Qok", delayMs: 900 } : healthy(cmd));
    const m1 = dispatchRobotJob(manual({ jobType: "home" }));
    await untilSeen(fake, "CNTLON");

    const ab = await within(dispatchRobotJob(manual({ jobType: "abort" })), 5000);
    expect(ab.error).not.toBe(ROBOT_MOTION_IN_PROGRESS);
    expect(ab.status).toBe("done");
    expect(allCmds(fake)).toContain("STOP");
    // M1 kết thúc (kết cục nào cũng được: STOP đã ưu tiên kết nối); không treo.
    await within(m1, 8000);
    expect(ledger.rows.filter((r) => r.status === "rejected" && r.result?.reasonCode === ROBOT_MOTION_IN_PROGRESS)).toHaveLength(0);
  });

  it("slot chỉ được cầm trên đường chạy THẬT: dry-run (ROBOT_CONTROL_ENABLED=false) song song ⇒ cả hai 'simulated'", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const [a, b] = await within(Promise.all([dispatchRobotJob(manual({ jobType: "home" })), dispatchRobotJob(manual({ jobType: "home" }))]), 5000);
    expect([a.status, b.status]).toEqual(["simulated", "simulated"]);
    expect(motionCmds(fake)).toHaveLength(0);
  });
});
