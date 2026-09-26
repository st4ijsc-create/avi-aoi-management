/**
 * doc 81 Đợt 1B Task 5 — đường lệnh robot: timeout ⇒ gửi dừng, sổ ghi fail-closed, safety-PLC trước
 * chuyển động, manual không bỏ HITL (BE2 §L2 robotCommandDispatcher, §3 S5/S9).
 *
 * Chạy `MitsubishiDriver` THẬT (TcpLineClient thật, socket node:net thật) nói chuyện với một bộ điều
 * khiển MELFA GIẢ trong tiến trình (127.0.0.1, cổng 0, đóng ở afterAll). Server giả viết theo đặc tả
 * lệnh R3 (Ethernet Function Instruction Manual BFP-A3379): khung vào `<robot>;<slot>;<lệnh>\r`, trả
 * `Qok…\r` / `Qe…\r` — các chuỗi trả lời là LITERAL viết sẵn, không lấy từ mã sản phẩm. Server ghi
 * lại mọi lệnh nhận được theo TỪNG kết nối ⇒ test khẳng định chính xác byte nào tới robot (hoặc 0 byte).
 *
 * Safety preflight đi qua `createAdapterFacade().getSafetyStatus()` THẬT (cùng hàm đường OT dùng);
 * chỉ nguồn đọc nền `safetyPlcAdapter` được giả lập (bật/tắt, trạng thái sạch/estop, lỗi đọc).
 *
 * Treo được đo bằng hạn giờ tường minh (`within`), không dựa vào timeout của vitest.
 */
import net from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

// Hạn giờ đo treo nằm trong `within(...)` của từng ca; hạn của vitest nới rộng hơn để KHÔNG bao giờ là
// thứ quyết định kết quả (global-constraints §4).
vi.setConfig({ testTimeout: 30_000 });

type Row = Record<string, any>;

// ── Sổ robot_jobs giả (insert/update/select) ──────────────────────────────────
const ledger = vi.hoisted(() => ({
  rows: [] as Row[],
  seq: 1,
  failInsert: false,
  failUpdate: false,
  noDb: false,
  /** Ảnh chụp lệnh server giả đã nhận, tại thời điểm UPDATE sổ về trạng thái cuối. */
  onUpdate: null as null | (() => void),
}));

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
    if (ledger.noDb) return null;
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
            if (ledger.failInsert) throw new Error("insert failed (simulated DB fault)");
            const row = { id: ledger.seq++, ...vals };
            if (t?.__table === "robot_jobs") ledger.rows.push(row);
            return [{ id: row.id }];
          },
        }),
      }),
      update: (t: any) => ({
        set: (vals: Row) => ({
          where: async (pred: any) => {
            if (ledger.failUpdate) throw new Error("update failed (simulated DB fault)");
            ledger.onUpdate?.();
            for (const r of tableRows(t)) if (matches(r, pred)) Object.assign(r, vals);
          },
        }),
      }),
    };
  }),
}));
vi.mock("../../../drizzle/schema", async (importOriginal) => ({
  // Bảng thật cho chuỗi import của facade an toàn THẬT; ba bảng dispatcher đọc/ghi được thay bằng dấu.
  ...(await importOriginal<Record<string, unknown>>()),
  robotJobs: { __table: "robot_jobs", id: { __name: "id" }, idempotencyKey: { __name: "idempotencyKey" } },
  robots: { __table: "robots", id: { __name: "id" } },
  aiPendingActions: { __table: "ai_pending_actions", id: { __name: "id" } },
}));

// ── Robot đang active: driver do từng test đặt ────────────────────────────────
const active = vi.hoisted(() => ({ driver: null as any }));
vi.mock("./robotManager", () => ({
  getActiveRobot: (id: number) => (id === 7 && active.driver ? { driver: active.driver } : undefined),
}));

// Interlock có test riêng; ở đây chỉ ghi lại khoá được đánh giá.
const interlock = vi.hoisted(() => ({ calls: [] as any[], blocked: false }));
vi.mock("../interlock/interlockGate", () => ({
  evaluateInterlockGate: vi.fn(async (p: any) => {
    interlock.calls.push(p);
    return interlock.blocked
      ? { blocked: true, failClosed: false, violations: [{ ruleId: 91, ruleName: "guard open", action: "stop_line" }] }
      : { blocked: false, failClosed: false, violations: [] };
  }),
}));

// Nguồn đọc NỀN của facade an toàn (facade THẬT gọi nó). mode quyết định kết quả facade.
const plc = vi.hoisted(() => ({ mode: "ok" as "ok" | "estop" | "disabled" | "read_error" | "throw" }));
vi.mock("../safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: () => plc.mode !== "disabled",
  listPlcConfigs: async () => {
    if (plc.mode === "throw") throw new Error("safety module exploded");
    return [{ code: "SPLC-1" }];
  },
  backendForConfig: () => ({
    read: async () => {
      if (plc.mode === "read_error") throw new Error("PLC unreachable");
      return { estop: plc.mode === "estop" };
    },
  }),
  statusToFindings: (s: any) => (s.estop ? ["estop"] : []),
}));

import { dispatchRobotJob, ROBOT_NO_OT_ADAPTER_ID } from "./robotCommandDispatcher";
import { MitsubishiDriver } from "./drivers/mitsubishiRobotDriver";
import { NotImplementedRobotDriver } from "./drivers/notImplementedRobotDriver";

// ── Bộ điều khiển MELFA giả (R3, BFP-A3379) ──────────────────────────────────
type Reply = string | null; // null = im lặng
interface FakeMelfa {
  port: number;
  conns: string[][]; // lệnh (phần sau "<robot>;<slot>;") theo từng kết nối
  respond: (cmd: string) => Reply;
  close(): Promise<void>;
}
const MOTION = /^(CNTLON|SRVON|EXEC)/;

async function startFakeMelfa(): Promise<FakeMelfa> {
  const socks = new Set<net.Socket>();
  const fake: FakeMelfa = {
    port: 0,
    conns: [],
    respond: () => "Qok",
    close: async () => undefined,
  };
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
        const reply = fake.respond(cmd);
        if (reply === "__CLOSE__") {
          sock.destroy(); // peer đóng kết nối giữa lệnh
          return;
        }
        if (reply != null && !sock.destroyed) sock.write(`${reply}\r`);
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

/** Literal replies of a healthy controller (BFP-A3379: success = "Qok"). */
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const motionCmds = (f: FakeMelfa) => allCmds(f).filter((c) => MOTION.test(c));

const ENV_KEYS = [
  "ROBOT_CONTROL_ENABLED",
  "ROBOT_COMMISSIONING_REQUIRED",
  "ROBOT_CONTROL_TIMEOUT_MS",
  "FIELD_V2_ENABLED",
  "SEC_PLATFORM",
] as const;
const saved: Record<string, string | undefined> = {};

let fake: FakeMelfa;
let driver: MitsubishiDriver;

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  fake = await startFakeMelfa();
  // Nạp trước chuỗi module của facade an toàn (dispatcher import động) để thời gian nạp module
  // lúc máy bận không bị tính vào các hạn giờ đo treo bên dưới.
  await import("../ot/adapterFacade");
}, 60_000);
afterAll(async () => {
  await fake.close();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function connectDriver(driverTimeoutMs: number): Promise<void> {
  driver = new MitsubishiDriver();
  await driver.connect({ endpoint: `tcp://127.0.0.1:${fake.port}`, timeoutMs: driverTimeoutMs });
  active.driver = driver;
  // chỉ đếm lệnh từ SAU khi kết nối (OPEN/STATE của connect không tính); giữ mảng của kết nối
  // đang mở (server tiếp tục ghi vào đó), chỉ làm rỗng nội dung.
  for (const c of fake.conns) c.length = 0;
}

beforeEach(() => {
  ledger.rows.length = 0;
  ledger.seq = 1;
  ledger.failInsert = false;
  ledger.failUpdate = false;
  ledger.noDb = false;
  ledger.onUpdate = null;
  interlock.calls.length = 0;
  interlock.blocked = false;
  plc.mode = "ok";
  fake.respond = healthy;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000";
  delete process.env.FIELD_V2_ENABLED;
  delete process.env.SEC_PLATFORM;
});
afterEach(async () => {
  active.driver = null;
  if (driver) await driver.disconnect();
});

const HOME = { robotId: 7, job: { jobType: "home" as const }, triggerKind: "hitl" as const, requestedBy: 3, confirmedBy: 3 };

describe("đường hợp lệ vẫn chạy (không chặn oan)", () => {
  it("safety OK + sổ ghi được ⇒ done; robot nhận CNTLON/SRVON/EXEC; sổ: running → done", async () => {
    await connectDriver(2000);
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("done");
    expect(r.ok).toBe(true);
    expect(motionCmds(fake)).toEqual(["CNTLON", "SRVON", "EXECMOV J=(0,0,0,0,0,0)"]);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]).toMatchObject({ id: r.jobId, status: "done" });
    expect(ledger.rows[0].startedAt).toBeInstanceOf(Date);
    expect(ledger.rows[0].completedAt).toBeInstanceOf(Date);
  });
});

describe("timeout ⇒ gửi dừng TRƯỚC khi ghi failed (S5)", () => {
  it("hết hạn giờ của dispatcher ⇒ server giả nhận STOP (kết nối mới, sau OPEN=), sổ failed + abort_sent", async () => {
    await connectDriver(3000); // driver đợi lâu hơn hạn dispatcher (1000 ms)
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? null : healthy(cmd)); // chuyển động không trả lời
    // Ảnh chụp tại lần UPDATE sổ ĐẦU TIÊN (lần chốt trạng thái cuối) — phải đã có STOP.
    let cmdsAtFinalize: string[] | null = null;
    let updates = 0;
    ledger.onUpdate = () => {
      updates++;
      if (cmdsAtFinalize === null) cmdsAtFinalize = allCmds(fake);
    };
    const r = await within(dispatchRobotJob(HOME), 12_000);
    expect(r.status).toBe("failed");
    expect(r.ok).toBe(false);
    expect(allCmds(fake)).toContain("STOP");
    // STOP đã tới robot TRƯỚC lúc sổ được chốt 'failed'.
    expect(cmdsAtFinalize).toContain("STOP");
    expect(updates).toBe(1); // một lần chốt duy nhất, không ghi 'failed' trước rồi sửa sau
    // STOP không xếp hàng sau lệnh EXEC đang bay: đi trên kết nối MỚI, sau bắt tay OPEN=.
    expect(fake.conns[fake.conns.length - 1]).toEqual(["OPEN=AOICTRL", "STOP"]);
    expect(ledger.rows[0].status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ timeout: true, abort: "abort_sent" });
    expect(ledger.rows[0].errorText).toMatch(/timeout.*abort_sent/);
  });

  it("driver tự hết hạn giờ (line_reply_timeout) ⇒ cũng gửi STOP, sổ ghi abort_sent", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    await connectDriver(300);
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? null : healthy(cmd));
    const r = await within(dispatchRobotJob(HOME), 12_000);
    expect(r.status).toBe("failed");
    expect(allCmds(fake)).toContain("STOP");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "line_reply_timeout", abort: "abort_sent" });
  });

  it("STOP bị robot từ chối (Qe…) ⇒ sổ ghi abort_failed, không bao giờ abort_sent", async () => {
    await connectDriver(3000);
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? null : cmd === "STOP" ? "QeR0001" : healthy(cmd));
    const r = await within(dispatchRobotJob(HOME), 12_000);
    expect(r.status).toBe("failed");
    expect(allCmds(fake)).toContain("STOP");
    expect(ledger.rows[0].result).toMatchObject({ abort: "abort_failed" });
    expect(ledger.rows[0].errorText).toMatch(/abort_failed/);
  });

  it("driver không có lệnh dừng ⇒ sổ ghi abort_unsupported", async () => {
    const noStop = new NotImplementedRobotDriver("sim", "no stop in this driver");
    active.driver = {
      vendor: "sim",
      isConnected: () => true,
      runJob: () => new Promise(() => undefined), // chuyển động không bao giờ trả lời
      abort: () => noStop.abort(),
    };
    const r = await within(dispatchRobotJob(HOME), 12_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ timeout: true, abort: "abort_unsupported" });
    expect(ledger.rows[0].errorText).toMatch(/abort_unsupported/);
  });

  it("lệnh abort tự hết hạn giờ ⇒ không gửi abort lồng (không vòng lặp), sổ failed", async () => {
    let aborts = 0;
    active.driver = {
      vendor: "sim",
      isConnected: () => true,
      runJob: () => new Promise(() => undefined),
      abort: async () => {
        aborts++;
      },
    };
    const r = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 12_000);
    expect(r.status).toBe("failed");
    expect(aborts).toBe(0);
  });
});

describe("sổ ghi fail-closed: record lỗi ⇒ không gửi chuyển động", () => {
  it("insert sổ ném lỗi ⇒ rejected LEDGER_WRITE_FAILED, server giả nhận 0 byte chuyển động", async () => {
    await connectDriver(2000);
    ledger.failInsert = true;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("LEDGER_WRITE_FAILED");
    expect(allCmds(fake)).toEqual([]);
  });

  it("không có DB ⇒ không có sổ ⇒ không gửi chuyển động", async () => {
    await connectDriver(2000);
    ledger.noDb = true;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("LEDGER_WRITE_FAILED");
    expect(allCmds(fake)).toEqual([]);
  });

  it("nhánh không chuyển động (simulated) + insert lỗi ⇒ không còn trả ok:true như thể đã ghi sổ", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    await connectDriver(2000);
    ledger.failInsert = true;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("LEDGER_WRITE_FAILED");
    expect(allCmds(fake)).toEqual([]);
  });

  it("update cuối lỗi SAU chuyển động ⇒ trả kết quả thật + ledgerError, sổ vẫn 'running' (trung thực)", async () => {
    await connectDriver(2000);
    ledger.failUpdate = true;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("done");
    expect(r.ledgerError).toBe("LEDGER_FINALIZE_FAILED");
    expect(ledger.rows[0].status).toBe("running");
  });
});

describe("safety-PLC preflight trước chuyển động (S9) — cùng facade với đường OT", () => {
  it.each([
    ["disabled", "SAFETY_PLC_NOT_OK", "UNKNOWN"],
    ["read_error", "SAFETY_PLC_NOT_OK", "UNKNOWN"],
    ["throw", "SAFETY_PLC_NOT_OK", "UNKNOWN"],
    ["estop", "SAFETY_PLC_BLOCKED", "BLOCKED"],
  ] as const)("safety %s ⇒ chặn (%s), 0 byte tới robot", async (mode, error, state) => {
    await connectDriver(2000);
    plc.mode = mode;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("rejected");
    expect(r.error).toBe(error);
    expect(allCmds(fake)).toEqual([]);
    expect(ledger.rows[0]).toMatchObject({ status: "rejected" });
    expect(ledger.rows[0].result).toMatchObject({ safety: state });
  });

  it("lệnh dừng (abort) KHÔNG bị safety chặn — dừng không bao giờ bị khoá", async () => {
    await connectDriver(2000);
    plc.mode = "disabled";
    const r = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(r.status).toBe("done");
    expect(allCmds(fake)).toEqual(["STOP"]);
  });
});

describe("manual KHÔNG bỏ qua HITL cho chuyển động", () => {
  it("manual + chuyển động + không confirmedBy ⇒ rejected, 0 byte", async () => {
    await connectDriver(2000);
    const r = await within(
      dispatchRobotJob({ robotId: 7, job: { jobType: "home" }, triggerKind: "manual", requestedBy: 3 }),
      10_000,
    );
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("HITL confirmation required");
    expect(allCmds(fake)).toEqual([]);
  });

  it("manual + chuyển động + confirmedBy (người vận hành đã xác nhận) ⇒ chạy", async () => {
    await connectDriver(2000);
    const r = await within(
      dispatchRobotJob({ robotId: 7, job: { jobType: "home" }, triggerKind: "manual", requestedBy: 3, confirmedBy: 3 }),
      10_000,
    );
    expect(r.status).toBe("done");
  });

  it("manual + abort (dừng) không confirmedBy ⇒ vẫn đi (dừng không bị khoá)", async () => {
    await connectDriver(2000);
    const r = await within(
      dispatchRobotJob({ robotId: 7, job: { jobType: "abort" }, triggerKind: "manual", requestedBy: 3 }),
      10_000,
    );
    expect(r.status).toBe("done");
    expect(allCmds(fake)).toEqual(["STOP"]);
  });
});

describe("interlock robot: khoá đánh giá", () => {
  it("cổng interlock nhận machineId=robotId và adapterId không thể là adapter thật", async () => {
    await connectDriver(2000);
    await within(dispatchRobotJob(HOME), 10_000);
    expect(interlock.calls).toEqual([{ adapterId: ROBOT_NO_OT_ADAPTER_ID, machineId: 7, tagKeys: [] }]);
    expect(ROBOT_NO_OT_ADAPTER_ID).toBeLessThan(1);
  });
});

// ── doc 81 Đợt 1B Task 5 fix round 1 ─────────────────────────────────────────
describe("fix round 1 — manual: confirmedBy phải là chính người khởi tạo (R11)", () => {
  it("manual + chuyển động + confirmedBy ≠ requestedBy (không actionId) ⇒ rejected MANUAL_CONFIRMER_MISMATCH, 0 byte", async () => {
    await connectDriver(2000);
    const r = await within(
      dispatchRobotJob({ robotId: 7, job: { jobType: "home" }, triggerKind: "manual", requestedBy: 3, confirmedBy: 99 }),
      10_000,
    );
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("MANUAL_CONFIRMER_MISMATCH");
    expect(allCmds(fake)).toEqual([]);
  });

  it("hitl + confirmedBy ≠ requestedBy vẫn qua (quy tắc chỉ cho manual)", async () => {
    await connectDriver(2000);
    const r = await within(dispatchRobotJob({ ...HOME, requestedBy: 3, confirmedBy: 99 }), 10_000);
    expect(r.status).toBe("done");
  });
});

describe("fix round 1 — interlock không bao giờ chặn lệnh DỪNG (M3)", () => {
  it("interlock đang vi phạm ⇒ chuyển động bị chặn INTERLOCK_BLOCKED, 0 byte", async () => {
    await connectDriver(2000);
    interlock.blocked = true;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.error).toBe("INTERLOCK_BLOCKED");
    expect(allCmds(fake)).toEqual([]);
  });

  it("interlock đang vi phạm ⇒ abort VẪN đi: robot nhận STOP", async () => {
    await connectDriver(2000);
    interlock.blocked = true;
    const r = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(r.status).toBe("done");
    expect(allCmds(fake)).toEqual(["STOP"]);
  });
});

describe("fix round 1 — idempotency không ép 'running' vào union kết quả (M1)", () => {
  it("khoá đã có hàng 'running' ⇒ rejected IDEMPOTENT_JOB_IN_PROGRESS, không chạy lại, 0 byte", async () => {
    await connectDriver(2000);
    ledger.rows.push({ id: 500, idempotencyKey: "k-running", status: "running" });
    const r = await within(dispatchRobotJob({ ...HOME, idempotencyKey: "k-running" }), 10_000);
    expect(r).toEqual({ ok: false, status: "rejected", jobId: 500, error: "IDEMPOTENT_JOB_IN_PROGRESS" });
    expect(allCmds(fake)).toEqual([]);
  });

  it.each([
    ["done", true],
    ["simulated", true],
    ["failed", false],
    ["rejected", false],
  ] as const)("khoá đã có hàng '%s' ⇒ trả lại đúng trạng thái đó (ok=%s)", async (status, ok) => {
    await connectDriver(2000);
    ledger.rows.push({ id: 501, idempotencyKey: `k-${status}`, status });
    const r = await within(dispatchRobotJob({ ...HOME, idempotencyKey: `k-${status}` }), 10_000);
    expect(r).toEqual({ ok, status, jobId: 501 });
  });
});

describe("fix round 1 — hàng rào abort MELFA: không lệnh chuyển động nào sau STOP (cửa sổ nối lại)", () => {
  it("job đang chờ nối lại khi abort() được gọi ⇒ kết nối mới chỉ nhận OPEN= rồi STOP, KHÔNG CNTLON/SRVON/EXEC", async () => {
    await connectDriver(300);
    // 1) một lệnh hết hạn giờ ở tầng driver ⇒ kết nối bị huỷ, lần gửi sau phải nối lại.
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? null : healthy(cmd));
    const first = await within(driver.runJob({ jobType: "home" }), 5000);
    expect(first.detail?.reasonCode).toBe("line_reply_timeout");
    fake.respond = healthy;
    const before = fake.conns.length;
    // 2) job mới bắt đầu (đang chờ nối lại), abort() tới ngay sau — như hạn dispatcher rơi giữa chừng.
    const job = driver.runJob({ jobType: "home" });
    const stop = driver.abort();
    await within(stop, 5000);
    const r = await within(job, 5000);
    expect(r.ok).toBe(false);
    expect(r.detail?.reasonCode).toBe("job_fenced_by_abort");
    await sleep(200);
    const fresh = fake.conns.slice(before).flat();
    expect(fresh).toEqual(["OPEN=AOICTRL", "STOP"]);
  });
});

describe("fix round 1 — đóng kết nối giữa lệnh chuyển động = kết cục không rõ (line_connection_closed)", () => {
  it("robot đóng socket khi EXEC đang chờ ⇒ dispatcher thử dừng và ghi rõ kết quả dừng (không im lặng failed)", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    await connectDriver(2000);
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? "__CLOSE__" : healthy(cmd));
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "line_connection_closed" });
    // Kết nối đã mất ⇒ STOP không gửi được: sổ ghi abort_failed một cách trung thực.
    expect(ledger.rows[0].result.abort).toBe("abort_failed");
    expect(ledger.rows[0].errorText).toMatch(/line_connection_closed|socket closed/);
    expect(ledger.rows[0].errorText).toMatch(/abort_failed/);
  });
});

