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
type Reply = string | null | { reply: string | null; delayMs: number }; // null = im lặng; fix round 5: reply trễ
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
        const ans = fake.respond(cmd);
        const { reply, delayMs } = typeof ans === "object" && ans !== null ? ans : { reply: ans, delayMs: 0 };
        if (reply === "__DROP_ALL__") {
          for (const s of socks) s.destroy();
          return;
        }
        if (reply === "__CLOSE__") {
          sock.destroy(); // peer đóng kết nối giữa lệnh
          return;
        }
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
  // final wave (item 3) — MỘT từ vựng với đường OT: SAFETY_BLOCKED / SAFETY_UNKNOWN (trước là
  // SAFETY_PLC_BLOCKED / SAFETY_PLC_NOT_OK); trạng thái đọc được vẫn nằm trong result.safety.
  it.each([
    ["disabled", "SAFETY_UNKNOWN", "UNKNOWN"],
    ["read_error", "SAFETY_UNKNOWN", "UNKNOWN"],
    ["throw", "SAFETY_UNKNOWN", "UNKNOWN"],
    ["estop", "SAFETY_BLOCKED", "BLOCKED"],
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

  // final wave (item 3, final review Important #1) — cùng cờ/cùng mặc định như OT_SAFETY_PREFLIGHT_ENABLED.
  it("ROBOT_SAFETY_PREFLIGHT_ENABLED=false ⇒ bỏ qua preflight: PLC tắt (UNKNOWN) mà chuyển động vẫn chạy, giống OT khi tắt cờ", async () => {
    await connectDriver(2000);
    plc.mode = "disabled";
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "false";
    try {
      const r = await within(dispatchRobotJob(HOME), 10_000);
      expect(r.status).toBe("done");
      expect(allCmds(fake)).toEqual(["CNTLON", "SRVON", expect.stringMatching(/^EXEC/)]);
    } finally {
      delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
    }
  });

  it.each(["0", "off", "no", "FALSE", ""])("chỉ đúng chuỗi \"false\" mới tắt — giá trị %j vẫn BẬT (fail-closed, cùng ngữ nghĩa OT)", async (v) => {
    await connectDriver(2000);
    plc.mode = "disabled";
    process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = v;
    try {
      const r = await within(dispatchRobotJob(HOME), 10_000);
      expect(r.status).toBe("rejected");
      expect(r.error).toBe("SAFETY_UNKNOWN");
      expect(allCmds(fake)).toEqual([]);
    } finally {
      delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
    }
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
    // 1) một POLL hết hạn giờ ở tầng driver ⇒ kết nối bị huỷ, lần gửi sau phải nối lại. (Fix round 4:
    //    dùng poll chứ không dùng lệnh chuyển động — một chuyển động hết hạn nay KHOÁ chuyển động và job
    //    kế tiếp bị từ chối ngay, không còn đi tới hàng rào; ca này đo HÀNG RÀO nên cửa sổ nối lại phải
    //    được tạo bởi thứ không khoá.)
    fake.respond = (cmd) => (cmd === "STATE" ? null : healthy(cmd));
    await expect(within(driver.getState(), 5000)).rejects.toBeTruthy();
    expect(driver.getMotionLock().locked).toBe(false);
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
  // Fix round 2 — sau khi peer đóng, client KHÔNG chết mà "cũ": STOP của abort nối lại (MELFA gửi lại
  // OPEN=) và TỚI được robot trên kết nối MỚI; sổ ghi abort_sent. (Round 1 từng ghim abort_failed.)
  it("robot đóng socket khi EXEC đang chờ ⇒ STOP tới robot trên kết nối MỚI (sau OPEN=), sổ abort_sent", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    await connectDriver(2000);
    const before = fake.conns.length;
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? "__CLOSE__" : healthy(cmd));
    let atFinalize: string[] | null = null;
    ledger.onUpdate = () => {
      if (atFinalize === null) atFinalize = allCmds(fake);
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "line_connection_closed", abort: "abort_sent" });
    expect(ledger.rows[0].errorText).toMatch(/abort_sent/);
    // kết nối đang dùng lúc EXEC bị đóng; STOP đi trên kết nối kế tiếp, sau bắt tay OPEN=.
    expect(fake.conns.length).toBe(before + 1);
    expect(fake.conns[fake.conns.length - 1]).toEqual(["OPEN=AOICTRL", "STOP"]);
    expect(atFinalize).toContain("STOP"); // STOP đã tới robot trước khi sổ chốt
  });
});

describe("fix round 2 — abort thứ hai KHÔNG rào STOP của abort thứ nhất", () => {
  it("hai abort() liên tiếp khi đang chờ nối lại ⇒ cả hai STOP tới robot, cả hai resolve (không job_fenced_by_abort)", async () => {
    await connectDriver(300);
    fake.respond = (cmd) => (cmd === "STATE" ? null : healthy(cmd));
    await expect(within(driver.getState(), 5000)).rejects.toBeTruthy(); // poll hết hạn ⇒ client "cũ" ⇒ lần gửi sau phải nối lại
    fake.respond = healthy;
    const before = fake.conns.length;
    const a1 = driver.abort().then(() => "ok", (e: Error) => e.message);
    const a2 = driver.abort().then(() => "ok", (e: Error) => e.message);
    expect(await within(a1, 5000)).toBe("ok");
    expect(await within(a2, 5000)).toBe("ok");
    expect(fake.conns.slice(before).flat()).toEqual(["OPEN=AOICTRL", "STOP", "STOP"]);
  });
});

describe("fix round 3 — MELFA rớt kết nối khi rảnh: cổng 3 chặn chuyển động, chỉ STOP được nối lại", () => {
  it("drop khi rảnh ⇒ dispatch home bị từ chối, 0 byte chuyển động; abort (qua dispatcher VÀ trực tiếp) tới robot trên kết nối mới sau OPEN=", async () => {
    await connectDriver(2000);
    // STATE ⇒ server đóng mọi kết nối (robot rớt khi đang rảnh)
    fake.respond = (cmd) => (cmd === "STATE" ? "__DROP_ALL__" : healthy(cmd));
    await driver.getState().catch(() => undefined);
    fake.respond = healthy;
    expect(driver.isConnected()).toBe(false);
    const before = fake.conns.length;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("rejected");
    expect(r.error).toBe("MOTION_LOCKED"); // fix round 4: khoá chuyển động (đặt ngay khi rớt) đứng TRƯỚC kiểm kết nối
    expect(fake.conns.slice(before).flat()).toEqual([]);
    const stop = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(stop.status).toBe("done");
    expect(fake.conns.slice(before)).toEqual([["OPEN=AOICTRL", "STOP"]]);
  });

  it("job đã qua cổng 3 TRƯỚC khi robot rớt (gọi runJob trực tiếp) ⇒ bị từ chối motion_locked_after_link_loss (fix round 4: khoá đặt ngay khi rớt; lớp vận chuyển line_not_connected đo ở tcpLineClient.test.ts), KHÔNG mở kết nối mới, 0 byte", async () => {
    await connectDriver(2000);
    fake.respond = (cmd) => (cmd === "STATE" ? "__DROP_ALL__" : healthy(cmd));
    await driver.getState().catch(() => undefined);
    fake.respond = healthy;
    const before = fake.conns.length;
    const r = await within(driver.runJob({ jobType: "home" }), 5000);
    expect(r.ok).toBe(false);
    expect(r.detail?.reasonCode).toBe("motion_locked_after_link_loss");
    await sleep(100);
    expect(fake.conns.length).toBe(before);
  });

  it("reset kết nối dưới EXEC đang bay (vd một poll song song hết hạn) ⇒ reasonCode line_connection_reset ⇒ dispatcher gửi STOP", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    await connectDriver(3000);
    fake.respond = (cmd) => {
      if (cmd.startsWith("EXEC")) {
        // mô phỏng poll song song hết hạn ⇒ resetConnection() dưới EXEC đang chờ
        setTimeout(() => (driver as any).client.resetConnection("concurrent poll timeout"), 50);
        return null;
      }
      return healthy(cmd);
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "line_connection_reset", abort: "abort_sent" });
    expect(fake.conns[fake.conns.length - 1]).toEqual(["OPEN=AOICTRL", "STOP"]);
  });
});

// ── doc 81 Đợt 1B Task 5 fix round 4 (ruling R13) ────────────────────────────
// Tách "vận chuyển đã lên" khỏi "được phép chuyển động": poll chỉ đọc nối lại được sau peer drop; KHOÁ
// CHUYỂN ĐỘNG của driver giữ tới khi một STOP được driver xác nhận hoặc người vận hành gỡ. Cổng 3 của
// dispatcher từ chối chuyển động khi khoá (MOTION_LOCKED); STOP vẫn đi.
describe("fix round 4 (R13) — poll nối lại vận chuyển; KHOÁ CHUYỂN ĐỘNG giữ tới STOP xác nhận / người vận hành gỡ", () => {
  it("drop khi rảnh ⇒ getState nối lại (OPEN=, STATE, PPOSF) ⇒ isConnected; dispatch home ⇒ MOTION_LOCKED, 0 byte chuyển động, sổ ghi reasonCode; abort ⇒ STOP trên kết nối đã lên ⇒ gỡ khoá ⇒ home chạy", async () => {
    await connectDriver(2000);
    fake.respond = (cmd) => (cmd === "STATE" ? "__DROP_ALL__" : healthy(cmd));
    await driver.getState().catch(() => undefined);
    fake.respond = healthy;
    expect(driver.isConnected()).toBe(false);
    expect(driver.getMotionLock()).toMatchObject({ locked: true, reasonCode: "line_connection_closed" });
    const before = fake.conns.length;
    const s = await within(driver.getState(), 5000); // poll chỉ đọc (tick của subscribeState) nối lại
    expect(s.mode).toBe("auto");
    expect(fake.conns.slice(before)).toEqual([["OPEN=AOICTRL", "STATE", "PPOSF"]]);
    expect(driver.isConnected()).toBe(true); // vận chuyển đã lên
    expect(driver.getMotionLock().locked).toBe(true); // chuyển động vẫn khoá
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r).toMatchObject({ ok: false, status: "rejected", error: "MOTION_LOCKED" });
    expect(motionCmds(fake)).toEqual([]);
    expect(ledger.rows[0]).toMatchObject({ status: "rejected" });
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "motion_locked_after_link_loss" });
    const stop = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(stop.status).toBe("done");
    expect(fake.conns[fake.conns.length - 1]).toEqual(["OPEN=AOICTRL", "STATE", "PPOSF", "STOP"]); // cùng kết nối đã lên lại
    expect(driver.getMotionLock()).toMatchObject({ locked: false, clearedBy: "stop_confirmed" });
    const home = await within(dispatchRobotJob(HOME), 10_000);
    expect(home.status).toBe("done");
    expect(motionCmds(fake)).toEqual(["CNTLON", "SRVON", "EXECMOV J=(0,0,0,0,0,0)"]);
  });

  it("N1: ROBOT_CONTROL_ENABLED tắt (STOP không bao giờ tới driver) ⇒ poll vẫn nối lại (telemetry sống); khoá giữ ⇒ dispatch home MOTION_LOCKED (không 'simulated'); người vận hành gỡ ⇒ simulated", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    await connectDriver(2000);
    fake.respond = (cmd) => (cmd === "STATE" ? "__DROP_ALL__" : healthy(cmd));
    await driver.getState().catch(() => undefined);
    fake.respond = healthy;
    expect(driver.isConnected()).toBe(false);
    const s = await within(driver.getState(), 5000);
    expect(s.mode).toBe("auto");
    expect(driver.isConnected()).toBe(true);
    const stop = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(stop.status).toBe("simulated"); // dry-run: STOP không tới driver
    expect(allCmds(fake)).not.toContain("STOP");
    expect(driver.getMotionLock().locked).toBe(true);
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r).toMatchObject({ status: "rejected", error: "MOTION_LOCKED" });
    driver.clearMotionLock({ reason: "checked on site", userId: 3, expectedGeneration: driver.getMotionLock().generation! });
    const r2 = await within(dispatchRobotJob(HOME), 10_000);
    expect(r2.status).toBe("simulated");
  });

  it("STOP bị robot từ chối (Qe) ⇒ khoá KHÔNG gỡ; STOP kế tiếp thành công ⇒ gỡ", async () => {
    await connectDriver(2000);
    fake.respond = (cmd) => (cmd === "STATE" ? "__DROP_ALL__" : healthy(cmd));
    await driver.getState().catch(() => undefined);
    fake.respond = (cmd) => (cmd === "STOP" ? "QeR0001" : healthy(cmd));
    const first = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(first.status).toBe("failed");
    expect(driver.getMotionLock().locked).toBe(true);
    fake.respond = healthy;
    const second = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(second.status).toBe("done");
    expect(driver.getMotionLock().locked).toBe(false);
  });

  it("poll nối lại THẤT BẠI (robot vẫn tắt) ⇒ poll kế tiếp vẫn THỬ LẠI (không chết tới khi restart); robot lành ⇒ nối được", async () => {
    await connectDriver(500);
    fake.respond = (cmd) => (cmd === "STATE" ? "__DROP_ALL__" : healthy(cmd));
    await driver.getState().catch(() => undefined);
    // robot vẫn "tắt": mọi kết nối mới bị đóng ngay khi nhận OPEN= (bắt tay hỏng)
    fake.respond = (cmd) => (cmd.startsWith("OPEN=") ? "__CLOSE__" : healthy(cmd));
    const c0 = fake.conns.length;
    await expect(within(driver.getState(), 5000)).rejects.toBeTruthy();
    expect(driver.isConnected()).toBe(false);
    await expect(within(driver.getState(), 5000)).rejects.toBeTruthy();
    expect(fake.conns.length).toBe(c0 + 2); // mỗi poll một lần thử nối
    fake.respond = healthy;
    const s = await within(driver.getState(), 5000);
    expect(s.mode).toBe("auto");
    expect(fake.conns.length).toBe(c0 + 3);
    expect(driver.isConnected()).toBe(true);
  });
});

describe("fix round 4 (R13) — MELFA: chuyển động hết hạn giờ KHOÁ; chỉ STOP được xác nhận mới gỡ", () => {
  it("EXEC im lặng ⇒ khoá line_reply_timeout; STOP bị từ chối (Qe) ⇒ khoá GIỮ ⇒ home kế tiếp MOTION_LOCKED (0 byte chuyển động); STOP tốt ⇒ gỡ", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    await connectDriver(300); // driver hết hạn trước dispatcher
    fake.respond = (cmd) => (cmd.startsWith("EXEC") ? null : cmd === "STOP" ? "QeR0001" : healthy(cmd));
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "line_reply_timeout", abort: "abort_failed" });
    expect(driver.getMotionLock()).toMatchObject({ locked: true, reasonCode: "line_reply_timeout" });
    fake.respond = healthy;
    const before = allCmds(fake).length;
    const r2 = await within(dispatchRobotJob(HOME), 10_000);
    expect(r2).toMatchObject({ status: "rejected", error: "MOTION_LOCKED" });
    expect(allCmds(fake).length).toBe(before); // không byte nào
    const stop = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(stop.status).toBe("done");
    expect(driver.getMotionLock()).toMatchObject({ locked: false, clearedBy: "stop_confirmed" });
    const r3 = await within(dispatchRobotJob(HOME), 10_000);
    expect(r3.status).toBe("done");
  });
});

// ── doc 81 Đợt 1B Task 5 fix round 5 ─────────────────────────────────────────
describe("fix round 5 — (c) khoá TRƯỚC khi gửi dừng ở hạn dispatcher; (b) guard mỗi lần ghi tái kiểm khoá", () => {
  it("(c) hạn dispatcher rơi ⇒ driver.lockMotion(dispatch_deadline_outcome_unknown) được gọi TRƯỚC abort() (driver giả ghi thứ tự)", async () => {
    const calls: string[] = [];
    active.driver = {
      vendor: "sim",
      isConnected: () => true,
      runJob: () => new Promise(() => undefined), // chuyển động không bao giờ trả lời
      lockMotion: (code: string) => {
        calls.push(`lock:${code}`);
      },
      abort: async () => {
        calls.push("abort");
      },
    };
    const r = await within(dispatchRobotJob(HOME), 12_000);
    expect(r.status).toBe("failed");
    expect(calls).toEqual(["lock:dispatch_deadline_outcome_unknown", "abort"]);
  });

  it("(c) driver không có lockMotion (Techman/UR) ⇒ vẫn gửi dừng, không lỗi", async () => {
    let aborts = 0;
    active.driver = {
      vendor: "techman",
      isConnected: () => true,
      runJob: () => new Promise(() => undefined),
      abort: async () => {
        aborts++;
      },
    };
    const r = await within(dispatchRobotJob(HOME), 12_000);
    expect(r.status).toBe("failed");
    expect(aborts).toBe(1);
    expect(ledger.rows[0].result).toMatchObject({ timeout: true, abort: "abort_sent" });
  });

  it("(b) MELFA: job đã qua kiểm khoá đầu vào, khoá đặt khi CNTLON đang chờ ⇒ guard trước SRVON từ chối ⇒ robot chỉ nhận CNTLON, job failed motion_locked_after_link_loss", async () => {
    await connectDriver(2000);
    fake.respond = (cmd) => (cmd === "CNTLON" ? { reply: "Qok", delayMs: 300 } : healthy(cmd));
    const job = driver.runJob({ jobType: "home" });
    await sleep(50); // CNTLON đã đi, reply còn 250 ms nữa
    driver.lockMotion("test_link_loss", "injected by test");
    const r = await within(job, 5000);
    expect(r.ok).toBe(false);
    expect(r.detail?.reasonCode).toBe("motion_locked_after_link_loss");
    await sleep(100);
    expect(motionCmds(fake)).toEqual(["CNTLON"]);
  });
});
