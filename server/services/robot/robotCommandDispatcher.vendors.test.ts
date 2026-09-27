/**
 * doc 81 Đợt 1B Task 5 fix round 1 — "timeout ⇒ dừng" và "không byte chuyển động nào sau STOP" với
 * driver FANUC RMI và Techman THẬT, qua dispatcher thật, nói chuyện với thiết bị GIẢ trong tiến trình
 * (127.0.0.1, cổng 0, đóng ở afterEach/afterAll).
 *
 *   • FANUC RMI giả — viết theo RMI manual (JSON một dòng, kết thúc CRLF). Xử lý TUẦN TỰ như bộ điều
 *     khiển thật (gói sau chỉ được trả lời sau gói trước). Mọi câu trả lời là JSON LITERAL viết sẵn
 *     theo manual (FRC_Connect/GetStatus/Initialize/Abort/Instruction, ErrorID 0) — không lấy từ mã sản
 *     phẩm. Ghi lại từng gói nhận được theo thứ tự.
 *   • Techman Listen Node giả — mỗi kết nối một hành vi (im lặng / trả OK). Khung và checksum là
 *     LITERAL tính độc lập (Python, XOR mọi byte giữa `$` và `*`):
 *       home id 1  : $TMSCT,39,1,PTP("JPP",0,0,0,0,0,0,35,200,0,false),*00   (vector Task 4)
 *       abort id 2 : $TMSCT,22,2,StopAndClearBuffer(),*64
 *       OK id 2    : $TMSCT,4,2,OK,*5F
 *
 * Safety-PLC được giả OK (có test riêng ở robotCommandDispatcher.safety.test.ts); sổ robot_jobs giả.
 * Treo đo bằng `within(...)` tường minh; hạn vitest nới rộng để không bao giờ là thứ quyết định.
 */
import net from "node:net";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

type Row = Record<string, any>;

const ledger = vi.hoisted(() => ({
  rows: [] as Row[],
  seq: 1,
  /** Ảnh chụp tại lần UPDATE (chốt trạng thái cuối) ĐẦU TIÊN. */
  snapshotAtFinalize: null as null | (() => void),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, val: any) => ({ __op: "eq", __k: col?.__name, __v: val }) };
});
const matches = (row: Row, pred: any) => !pred || pred.__op !== "eq" || row[pred.__k] === pred.__v;

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [], then: (r: any, j: any) => Promise.resolve([]).then(r, j) }) }),
    }),
    insert: () => ({
      values: (vals: Row) => ({
        returning: async () => {
          const row = { id: ledger.seq++, ...vals };
          ledger.rows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
    update: () => ({
      set: (vals: Row) => ({
        where: async (pred: any) => {
          ledger.snapshotAtFinalize?.();
          ledger.snapshotAtFinalize = null;
          for (const r of ledger.rows) if (matches(r, pred)) Object.assign(r, vals);
        },
      }),
    }),
  })),
}));
vi.mock("../../../drizzle/schema", () => ({
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
vi.mock("../ot/adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: "" }) }),
}));

import { dispatchRobotJob } from "./robotCommandDispatcher";
import { FanucDriver } from "./drivers/fanucDriver";
import { TechmanDriver } from "./drivers/techmanDriver";
import { startFakeTmModbus, type FakeTmModbus } from "./drivers/__fakeTechman";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENV_KEYS = ["ROBOT_CONTROL_ENABLED", "ROBOT_COMMISSIONING_REQUIRED", "ROBOT_CONTROL_TIMEOUT_MS", "FIELD_V2_ENABLED", "SEC_PLATFORM"] as const;
const saved: Record<string, string | undefined> = {};
const closers: Array<() => Promise<void>> = [];

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  ledger.rows.length = 0;
  ledger.seq = 1;
  ledger.snapshotAtFinalize = null;
  process.env.ROBOT_CONTROL_ENABLED = "true";
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
  delete process.env.FIELD_V2_ENABLED;
  delete process.env.SEC_PLATFORM;
});
afterEach(async () => {
  if (active.driver) {
    try { await active.driver.disconnect(); } catch { /* ignore */ }
  }
  active.driver = null;
  while (closers.length) await closers.pop()!();
});

const HOME = { robotId: 7, job: { jobType: "home" as const }, triggerKind: "hitl" as const, requestedBy: 3, confirmedBy: 3 };

// ── FANUC RMI giả ─────────────────────────────────────────────────────────────
type RmiPkt = Record<string, any>;
interface RmiAnswer {
  reply: RmiPkt | null;
  delayMs?: number;
  /** true ⇒ server ĐÓNG kết nối ngay khi nhận gói này (không trả lời). */
  drop?: boolean;
}
interface FakeRmi {
  port: number;
  received: string[]; // Command / Communication / Instruction theo thứ tự nhận
  /** Cùng danh sách, tách theo TỪNG kết nối. */
  conns: string[][];
  /** Trả lời cho gói; null = im lặng. `delayMs` = trễ trước khi trả lời. */
  respond: (pkt: RmiPkt) => RmiAnswer;
  /** true (mặc định) = xử lý TUẦN TỰ như bộ điều khiển thật; false = mỗi gói trễ ĐỘC LẬP (trả lời lệch thứ tự). */
  sequential: boolean;
}

/** Literal replies per the RMI manual (ErrorID 0 = success). */
function rmiHealthy(pkt: RmiPkt): RmiAnswer {
  if (pkt.Communication === "FRC_Connect")
    return { reply: { Communication: "FRC_Connect", ErrorID: 0, PortNumber: 16002, MajorVersion: 1, MinorVersion: 3 } };
  if (pkt.Communication === "FRC_Disconnect") return { reply: { Communication: "FRC_Disconnect", ErrorID: 0 } };
  if (pkt.Command === "FRC_GetStatus")
    return { reply: { Command: "FRC_GetStatus", ErrorID: 0, ServoReady: 1, TPMode: 0, RMIMotionStatus: 0, ProgramStatus: 0, NextSequenceID: 1 } };
  if (pkt.Command === "FRC_Initialize") return { reply: { Command: "FRC_Initialize", ErrorID: 0, GroupMask: 1 } };
  // Fix round 4 — getState() also reads the live pose [RMI §2.3.14]; the reply echoes the Command name
  // (without it the correlated client discards the reply and the pose read times out ⇒ session reset).
  if (pkt.Command === "FRC_ReadCartesianPosition")
    return { reply: { Command: "FRC_ReadCartesianPosition", ErrorID: 0, Configuration: { UToolNumber: 1, UFrameNumber: 1 }, Position: { X: 100.5, Y: -20, Z: 300, W: 180, P: 0, R: 90 } } };
  if (pkt.Command === "FRC_Abort") return { reply: { Command: "FRC_Abort", ErrorID: 0 } };
  if (typeof pkt.Instruction === "string") return { reply: { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: pkt.SequenceID } };
  return { reply: { ErrorID: 0 } };
}

async function startFakeRmi(): Promise<FakeRmi> {
  const socks = new Set<net.Socket>();
  const fake: FakeRmi = { port: 0, received: [], conns: [], respond: rmiHealthy, sequential: true };
  const srv = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
    const mine: string[] = [];
    fake.conns.push(mine);
    let buf = "";
    let chain = Promise.resolve();
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const pkt = JSON.parse(line) as RmiPkt;
        const name = String(pkt.Command ?? pkt.Communication ?? pkt.Instruction);
        fake.received.push(name);
        mine.push(name);
        const { reply, delayMs = 0, drop } = fake.respond(pkt);
        if (drop) {
          sock.destroy();
          return;
        }
        if (!fake.sequential) {
          setTimeout(() => {
            if (reply && !sock.destroyed) sock.write(JSON.stringify(reply) + "\r\n");
          }, delayMs);
          continue;
        }
        // TUẦN TỰ như bộ điều khiển thật.
        chain = chain.then(
          () =>
            new Promise<void>((res) => {
              setTimeout(() => {
                if (reply && !sock.destroyed) sock.write(JSON.stringify(reply) + "\r\n");
                res();
              }, delayMs);
            }),
        );
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  fake.port = (srv.address() as net.AddressInfo).port;
  closers.push(async () => {
    for (const s of socks) s.destroy();
    await new Promise<void>((r) => srv.close(() => r()));
  });
  return fake;
}

async function fanucOn(fake: FakeRmi, driverTimeoutMs: number): Promise<FanucDriver> {
  const d = new FanucDriver();
  await d.connect({ endpoint: `127.0.0.1:${fake.port}`, timeoutMs: driverTimeoutMs, options: { skipPortReconnect: true } });
  active.driver = d;
  fake.received.length = 0; // chỉ tính gói SAU khi kết nối
  for (const c of fake.conns) c.length = 0;
  return d;
}

describe("FANUC RMI — reply timeout ⇒ FRC_Abort TRƯỚC khi chốt failed (rmi_reply_timeout)", () => {
  it("gói chuyển động không được trả lời ⇒ FRC_Abort trên CÙNG phiên (không FRC_Connect); sổ failed + reasonCode rmi_reply_timeout + abort_sent; sau STOP phiên nhiễm bị hạ, poll mở phiên mới", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000"; // driver (300 ms) hết hạn trước dispatcher
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 300);
    const connsBefore = fake.conns.length;
    fake.respond = (pkt) => (typeof pkt.Instruction === "string" ? { reply: null } : rmiHealthy(pkt));
    let atFinalize: string[] | null = null;
    ledger.snapshotAtFinalize = () => {
      atFinalize = [...fake.received];
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    // Fix round 4 (R13) — Instruction timeout KHÔNG reset phiên: FRC_Abort đi ngay trên socket hiện có.
    expect(fake.received).toEqual(["FRC_GetStatus", "FRC_Initialize", "FRC_JointMotionJRep", "FRC_Abort"]);
    expect(fake.conns.length).toBe(connsBefore);
    expect(atFinalize).toContain("FRC_Abort"); // dừng ĐÃ tới robot trước lúc sổ chốt
    expect(ledger.rows[0].status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_sent" });
    expect(d.getMotionLock()).toMatchObject({ locked: false, clearedBy: "stop_confirmed" });
    // Sau STOP đã xác nhận: phiên còn mang một Instruction chưa có reply bị HẠ (SequenceID khởi động lại sau
    // FRC_Initialize kế tiếp ⇒ reply muộn không được phép gặp waiter mới cùng khoá). Poll chỉ đọc mở phiên mới.
    expect(d.isConnected()).toBe(false);
    fake.received.length = 0;
    const s = await within(d.getState(), 5000);
    expect(s.mode).toBe("auto");
    expect(fake.received).toEqual(["FRC_Connect", "FRC_GetStatus", "FRC_ReadCartesianPosition"]);
    expect(d.isConnected()).toBe(true);
  });

  it("fix round 4 — reply MUỘN của Instruction đã hết hạn KHÔNG được làm ack cho Instruction kế tiếp mang CÙNG SequenceID (phiên nhiễm bị hạ sau STOP)", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 1000);
    fake.sequential = false;
    let instructions = 0;
    fake.respond = (pkt) => {
      if (typeof pkt.Instruction === "string") {
        instructions++;
        // #1: trả RẤT muộn (1600 ms > hạn driver 1000 ms); #2: không bao giờ trả lời
        return instructions === 1
          ? { reply: { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: pkt.SequenceID }, delayMs: 1600 }
          : { reply: null };
      }
      return rmiHealthy(pkt);
    };
    const first = await within(dispatchRobotJob(HOME), 10_000);
    expect(first.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_sent" });
    await within(d.getState(), 5000); // poll mở phiên mới (phiên cũ đã bị hạ sau STOP)
    const second = await within(dispatchRobotJob(HOME), 10_000); // Instruction #2 lại mang SequenceID 1 sau Initialize
    expect(instructions).toBe(2);
    expect(second.status).not.toBe("done"); // reply muộn của #1 chết cùng socket cũ, không thành ack của #2
    expect(second.status).toBe("failed");
  });
});

describe("FANUC RMI — hạn dispatcher rơi GIỮA chuỗi GetStatus→Initialize→motion ⇒ 0 gói chuyển động sau FRC_Abort", () => {
  it("GetStatus trả lời chậm hơn hạn ⇒ FRC_Abort đi, job mồ côi KHÔNG gửi FRC_Initialize / lệnh chuyển động nào sau đó", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000";
    const fake = await startFakeRmi();
    await fanucOn(fake, 3000);
    fake.respond = (pkt) => (pkt.Command === "FRC_GetStatus" ? { ...rmiHealthy(pkt), delayMs: 1500 } : rmiHealthy(pkt));
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ timeout: true, abort: "abort_sent" });
    await sleep(500); // cho job mồ côi mọi cơ hội gửi tiếp
    const afterAbort = fake.received.slice(fake.received.indexOf("FRC_Abort") + 1);
    expect(fake.received).toContain("FRC_Abort");
    expect(afterAbort).toEqual([]);
    expect(fake.received).not.toContain("FRC_Initialize");
    expect(fake.received).not.toContain("FRC_JointMotionJRep");
  });
});

describe("FANUC RMI — robot rớt kết nối giữa lệnh chuyển động (rmi_connection_closed, fix round 2)", () => {
  it("server đóng socket khi nhận gói chuyển động ⇒ phiên RMI MỚI (FRC_Connect) rồi FRC_Abort; sổ abort_sent", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    await fanucOn(fake, 1000);
    const before = fake.conns.length;
    fake.respond = (pkt) => (typeof pkt.Instruction === "string" ? { reply: null, drop: true } : rmiHealthy(pkt));
    let atFinalize: string[] | null = null;
    ledger.snapshotAtFinalize = () => {
      atFinalize = [...fake.received];
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_connection_closed", abort: "abort_sent" });
    expect(fake.conns.length).toBe(before + 1);
    expect(fake.conns[fake.conns.length - 1]).toEqual(["FRC_Connect", "FRC_Abort"]);
    expect(atFinalize).toContain("FRC_Abort");
  });
});

/**
 * Ruling R12 — đối chiếu reply theo `Command`/`Instruction` (+ `SequenceID`) thay vì FIFO. Hai đường
 * reviewer lần ra, tái hiện bằng server giả trả lời MUỘN và LỆCH THỨ TỰ (mỗi gói trễ độc lập):
 */
describe("FANUC RMI — reply muộn/lệch thứ tự không bao giờ thành ack sai (R12, fix round 2)", () => {
  it("(a) FRC_Abort tiền-khởi-tạo hết hạn, reply muộn của nó KHÔNG được làm ack cho Initialize, reply Initialize KHÔNG làm ack cho chuyển động ⇒ không 'done'", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    await fanucOn(fake, 300);
    fake.sequential = false;
    fake.respond = (pkt) => {
      if (pkt.Command === "FRC_GetStatus")
        return { reply: { Command: "FRC_GetStatus", ErrorID: 0, ServoReady: 1, TPMode: 0, RMIMotionStatus: 1, ProgramStatus: 1, NextSequenceID: 1 } };
      if (pkt.Command === "FRC_Abort") return { reply: { Command: "FRC_Abort", ErrorID: 0 }, delayMs: 450 };
      if (pkt.Command === "FRC_Initialize") return { reply: { Command: "FRC_Initialize", ErrorID: 0, GroupMask: 1 }, delayMs: 350 };
      if (typeof pkt.Instruction === "string") return { reply: null }; // chuyển động KHÔNG BAO GIỜ được xác nhận
      return rmiHealthy(pkt);
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).not.toBe("done");
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout" });
  });

  it("(b) reply MUỘN của lệnh chuyển động KHÔNG được làm ack cho FRC_Abort ⇒ robot không xác nhận dừng ⇒ abort_failed, không abort_sent", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    await fanucOn(fake, 400);
    fake.sequential = false;
    fake.respond = (pkt) => {
      if (typeof pkt.Instruction === "string")
        return { reply: { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: pkt.SequenceID }, delayMs: 600 };
      if (pkt.Command === "FRC_Abort") return { reply: null }; // robot KHÔNG xác nhận dừng
      return rmiHealthy(pkt);
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(fake.received).toContain("FRC_Abort");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_failed" });
  });
});

/**
 * Mỗi LỚP của phép đối chiếu R12 có ca riêng (một lớp không được che đột biến của lớp kia):
 *   (c) khoá theo tên gói — hai yêu cầu KHÁC tên cùng đang chờ, trả lời LỆCH thứ tự (không có timeout ⇒
 *       không có bia mộ nào che);
 *   (d) bia mộ — reply muộn của một FRC_Abort đã hết hạn tới đúng lúc FRC_Abort MỚI (cùng tên) đang chờ;
 *   (e) SequenceID — reply chuyển động mang SequenceID KHÁC không phải ack của lệnh này.
 */
describe("FANUC RMI — từng lớp đối chiếu reply (R12, fix round 2)", () => {
  it("(c) FRC_Abort gửi khi lệnh chuyển động còn chờ; robot TỪ CHỐI dừng (ErrorID 9) trước, ack chuyển động tới sau ⇒ abort_failed (FIFO từng ghi abort_sent)", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000"; // hạn dispatcher < hạn driver
    const fake = await startFakeRmi();
    await fanucOn(fake, 3000);
    fake.sequential = false;
    fake.respond = (pkt) => {
      if (typeof pkt.Instruction === "string")
        return { reply: { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: pkt.SequenceID }, delayMs: 1500 };
      if (pkt.Command === "FRC_Abort") return { reply: { Command: "FRC_Abort", ErrorID: 9 } };
      return rmiHealthy(pkt);
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ timeout: true, abort: "abort_failed" });
    expect(String(ledger.rows[0].result.abortError)).toMatch(/ErrorID 9/);
  });

  it("(d) reply MUỘN của FRC_Abort tiền-khởi-tạo (đã hết hạn) KHÔNG được làm ack cho FRC_Abort của lệnh dừng ⇒ abort_failed", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    await fanucOn(fake, 400);
    fake.sequential = false;
    let aborts = 0;
    fake.respond = (pkt) => {
      if (pkt.Command === "FRC_GetStatus")
        return { reply: { Command: "FRC_GetStatus", ErrorID: 0, ServoReady: 1, TPMode: 0, RMIMotionStatus: 1, ProgramStatus: 1, NextSequenceID: 1 } };
      if (pkt.Command === "FRC_Abort") {
        aborts++;
        // lần 1 (tiền-khởi-tạo): trả lời RẤT muộn; lần 2 (lệnh dừng): robot KHÔNG xác nhận
        return aborts === 1 ? { reply: { Command: "FRC_Abort", ErrorID: 0 }, delayMs: 1000 } : { reply: null };
      }
      if (typeof pkt.Instruction === "string") return { reply: null };
      return rmiHealthy(pkt);
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(aborts).toBe(2);
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_failed" });
  });

  it("(e) reply chuyển động mang SequenceID KHÁC ⇒ không phải ack của lệnh này ⇒ không 'done'", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    await fanucOn(fake, 400);
    fake.respond = (pkt) =>
      typeof pkt.Instruction === "string"
        ? { reply: { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: Number(pkt.SequenceID) + 100 } }
        : rmiHealthy(pkt);
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).not.toBe("done");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_sent" });
  });
});

describe("FANUC RMI — một reply bị mất không đầu độc phiên (fix round 3)", () => {
  it("FRC_Abort lần 1 không được trả lời ⇒ abort() thất bại; phiên bị reset ⇒ abort() lần 2 (phiên MỚI) thành công", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 300);
    let aborts = 0;
    fake.respond = (pkt) => {
      if (pkt.Command === "FRC_Abort") {
        aborts++;
        return aborts === 1 ? { reply: null } : rmiHealthy(pkt); // reply lần 1 MẤT
      }
      return rmiHealthy(pkt);
    };
    await expect(within(d.abort(), 5000)).rejects.toThrow(/rmi_reply_timeout|timeout/);
    await expect(within(d.abort(), 5000)).resolves.toBeUndefined();
    expect(fake.conns[fake.conns.length - 1]).toEqual(["FRC_Connect", "FRC_Abort"]);
  });

  it("FRC_GetStatus bị mất reply ⇒ job failed + dừng (mở phiên mới); job KẾ TIẾP chạy trọn GetStatus→Initialize→motion ⇒ done", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    await fanucOn(fake, 300);
    let statuses = 0;
    fake.respond = (pkt) => {
      if (pkt.Command === "FRC_GetStatus") {
        statuses++;
        if (statuses === 1) return { reply: null }; // reply GetStatus đầu tiên MẤT
      }
      return rmiHealthy(pkt);
    };
    const first = await within(dispatchRobotJob(HOME), 10_000);
    expect(first.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_sent" });
    const second = await within(dispatchRobotJob(HOME), 10_000);
    expect(second.status).toBe("done");
    expect(fake.conns[fake.conns.length - 1]).toEqual([
      "FRC_Connect",
      "FRC_Abort",
      "FRC_GetStatus",
      "FRC_Initialize",
      "FRC_JointMotionJRep",
    ]);
  });
});

describe("FANUC RMI — mở lại phiên là single-flight (fix round 3)", () => {
  it("hai abort() đồng thời sau khi robot rớt kết nối ⇒ ĐÚNG MỘT FRC_Connect, hai FRC_Abort trên cùng phiên mới, cả hai resolve", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 1000);
    // rớt kết nối khi đang rảnh: server đóng socket phiên hiện tại
    fake.respond = (pkt) => (pkt.Command === "FRC_GetStatus" ? { reply: null, drop: true } : rmiHealthy(pkt));
    await d.getState().catch(() => undefined); // GetStatus ⇒ server đóng ⇒ client "dropped"
    fake.respond = rmiHealthy;
    expect(d.isConnected()).toBe(false);
    const before = fake.conns.length;
    const [a1, a2] = await within(
      Promise.all([d.abort().then(() => "ok", (e: Error) => e.message), d.abort().then(() => "ok", (e: Error) => e.message)]),
      5000,
    );
    expect([a1, a2]).toEqual(["ok", "ok"]);
    const fresh = fake.conns.slice(before);
    expect(fresh).toEqual([["FRC_Connect", "FRC_Abort", "FRC_Abort"]]);
  });

  it("runJob khi không có client ⇒ failed có mã rmi_not_connected (không dùng non-null assertion)", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const d = new FanucDriver();
    (d as any).connected = true; // trạng thái lệch: cờ bật nhưng không có client
    const r = await d.runJob({ jobType: "home" });
    expect(r.ok).toBe(false);
    expect(r.detail?.reasonCode).toBe("rmi_not_connected");
  });
});

describe("FANUC RMI — rớt kết nối khi rảnh ⇒ cổng 3 chặn chuyển động, STOP vẫn tới robot (fix round 3)", () => {
  it("drop khi rảnh ⇒ dispatch home bị từ chối, 0 gói; abort qua dispatcher mở phiên mới và gửi FRC_Abort", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 1000);
    fake.respond = (pkt) => (pkt.Command === "FRC_GetStatus" ? { reply: null, drop: true } : rmiHealthy(pkt));
    await d.getState().catch(() => undefined);
    fake.respond = rmiHealthy;
    fake.received.length = 0;
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("rejected");
    expect(fake.received).toEqual([]);
    const stop = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(stop.status).toBe("done");
    expect(fake.received).toEqual(["FRC_Connect", "FRC_Abort"]);
  });

  it("job chuyển động đã qua cổng 3 TRƯỚC khi rớt (runJob trực tiếp) ⇒ motion_locked_after_link_loss (fix round 4), KHÔNG mở phiên mới, 0 gói", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 1000);
    fake.respond = (pkt) => (pkt.Command === "FRC_GetStatus" ? { reply: null, drop: true } : rmiHealthy(pkt));
    await d.getState().catch(() => undefined);
    fake.respond = rmiHealthy;
    fake.received.length = 0;
    const before = fake.conns.length;
    const r = await within(d.runJob({ jobType: "home" }), 5000);
    expect(r.ok).toBe(false);
    expect(r.detail?.reasonCode).toBe("motion_locked_after_link_loss"); // fix round 4: khoá đặt ngay khi rớt đứng trước rmi_not_connected
    await sleep(100);
    expect(fake.conns.length).toBe(before);
    expect(fake.received).toEqual([]);
  });
});

describe("FANUC RMI — fix round 4 (R13): poll mở lại phiên sau rớt; KHOÁ CHUYỂN ĐỘNG giữ tới STOP xác nhận / người vận hành gỡ", () => {
  it("drop khi rảnh ⇒ getState mở phiên mới (FRC_Connect) ⇒ isConnected; dispatch home ⇒ MOTION_LOCKED, 0 gói; abort ⇒ FRC_Abort trên phiên đã mở ⇒ gỡ khoá ⇒ home chạy trọn", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 1000);
    fake.respond = (pkt) => (pkt.Command === "FRC_GetStatus" ? { reply: null, drop: true } : rmiHealthy(pkt));
    await d.getState().catch(() => undefined);
    fake.respond = rmiHealthy;
    expect(d.isConnected()).toBe(false);
    expect(d.getMotionLock()).toMatchObject({ locked: true, reasonCode: "rmi_connection_closed" });
    fake.received.length = 0;
    const before = fake.conns.length;
    const s = await within(d.getState(), 5000);
    expect(s.mode).toBe("auto");
    expect(fake.conns.slice(before)).toEqual([["FRC_Connect", "FRC_GetStatus", "FRC_ReadCartesianPosition"]]);
    expect(d.isConnected()).toBe(true);
    expect(d.getMotionLock().locked).toBe(true);
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r).toMatchObject({ ok: false, status: "rejected", error: "MOTION_LOCKED" });
    expect(fake.received).toEqual(["FRC_Connect", "FRC_GetStatus", "FRC_ReadCartesianPosition"]); // không thêm gói nào
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "motion_locked_after_link_loss" });
    const stop = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(stop.status).toBe("done");
    expect(fake.conns[fake.conns.length - 1]).toEqual(["FRC_Connect", "FRC_GetStatus", "FRC_ReadCartesianPosition", "FRC_Abort"]);
    expect(d.getMotionLock()).toMatchObject({ locked: false, clearedBy: "stop_confirmed" });
    const home = await within(dispatchRobotJob(HOME), 10_000);
    expect(home.status).toBe("done");
    expect(fake.received.slice(-3)).toEqual(["FRC_GetStatus", "FRC_Initialize", "FRC_JointMotionJRep"]);
  });

  it("N1: ROBOT_CONTROL_ENABLED tắt ⇒ STOP không tới driver, nhưng poll vẫn mở lại phiên (telemetry sống); khoá giữ ⇒ MOTION_LOCKED; người vận hành gỡ ⇒ simulated", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "false";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 1000);
    fake.respond = (pkt) => (pkt.Command === "FRC_GetStatus" ? { reply: null, drop: true } : rmiHealthy(pkt));
    await d.getState().catch(() => undefined);
    fake.respond = rmiHealthy;
    const s = await within(d.getState(), 5000);
    expect(s.mode).toBe("auto");
    expect(d.isConnected()).toBe(true);
    const stop = await within(dispatchRobotJob({ ...HOME, job: { jobType: "abort" as const } }), 10_000);
    expect(stop.status).toBe("simulated");
    expect(fake.received).not.toContain("FRC_Abort");
    expect(d.getMotionLock().locked).toBe(true);
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r).toMatchObject({ status: "rejected", error: "MOTION_LOCKED" });
    d.clearMotionLock({ reason: "checked on site", userId: 3, expectedGeneration: d.getMotionLock().generation! });
    const r2 = await within(dispatchRobotJob(HOME), 10_000);
    expect(r2.status).toBe("simulated");
  });

  it("Command (poll GetStatus) hết hạn khi KHÔNG có chuyển động ⇒ phiên reset (Command timeout) nhưng KHÔNG khoá; poll kế tiếp mở phiên mới", async () => {
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 300);
    let statuses = 0;
    fake.respond = (pkt) => {
      if (pkt.Command === "FRC_GetStatus") {
        statuses++;
        if (statuses === 1) return { reply: null };
      }
      return rmiHealthy(pkt);
    };
    await expect(within(d.getState(), 5000)).rejects.toThrow(/timeout/);
    expect(d.isConnected()).toBe(false); // phiên bị reset (Command timeout)
    expect(d.getMotionLock().locked).toBe(false);
    fake.received.length = 0;
    const s = await within(d.getState(), 5000);
    expect(s.mode).toBe("auto");
    expect(fake.received).toEqual(["FRC_Connect", "FRC_GetStatus", "FRC_ReadCartesianPosition"]);
  });

  it("người vận hành gỡ khoá trên phiên NHIỄM (Instruction chưa có reply, STOP bị ErrorID) ⇒ phiên bị hạ ngay; poll mở phiên mới", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 300);
    fake.respond = (pkt) =>
      typeof pkt.Instruction === "string"
        ? { reply: null }
        : pkt.Command === "FRC_Abort"
          ? { reply: { Command: "FRC_Abort", ErrorID: 9 } }
          : rmiHealthy(pkt);
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_failed" });
    expect(d.getMotionLock().locked).toBe(true);
    expect(d.isConnected()).toBe(true); // không Command nào timeout ⇒ phiên còn, nhưng NHIỄM
    const before = fake.conns.length;
    d.clearMotionLock({ reason: "checked on site", userId: 3, expectedGeneration: d.getMotionLock().generation! });
    expect(d.isConnected()).toBe(false); // phiên nhiễm bị hạ ngay khi gỡ khoá
    fake.respond = rmiHealthy;
    fake.received.length = 0;
    await within(d.getState(), 5000);
    expect(fake.conns.length).toBe(before + 1);
    expect(fake.received).toEqual(["FRC_Connect", "FRC_GetStatus", "FRC_ReadCartesianPosition"]);
  });
});

describe("FANUC RMI — fix round 5: hạn dispatcher rơi TRƯỚC timer Instruction của driver (đường R12 false-done tái mở)", () => {
  it("(a) STOP xác nhận khi Instruction M1 CÒN CHỜ ⇒ phiên bị hạ (M1 bị huỷ, KHÔNG khoá lại); M2 sau poll KHÔNG bao giờ 'done' nhờ reply muộn của M1", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000"; // hạn dispatcher (1000) < timer Instruction của driver (1500)
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 1500);
    fake.sequential = false;
    let instructions = 0;
    fake.respond = (pkt) => {
      if (typeof pkt.Instruction === "string") {
        instructions++;
        // M1: trả lời SAU hạn dispatcher VÀ sau timer driver ⇒ lúc reply tới, waiter M1 đã bị gỡ (nếu phiên còn, reply
        // sẽ rơi vào waiter cùng khoá của M2 — SequenceID 1 tái dùng sau Initialize). M2: không bao giờ được trả lời.
        return instructions === 1
          ? { reply: { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: pkt.SequenceID }, delayMs: 2200 }
          : { reply: null };
      }
      return rmiHealthy(pkt);
    };
    const first = await within(dispatchRobotJob(HOME), 10_000);
    expect(first.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ timeout: true, abort: "abort_sent" });
    // (a) phiên đã bị hạ dù Instruction M1 CHƯA hết hạn; khoá đã gỡ bởi STOP và KHÔNG bị M1 (bị huỷ vì STOP) đặt lại.
    expect(d.isConnected()).toBe(false);
    expect(d.getMotionLock().locked).toBe(false);
    await within(d.getState(), 5000); // poll mở phiên mới
    const second = await within(dispatchRobotJob(HOME), 10_000);
    expect(instructions).toBe(2);
    expect(second.status).not.toBe("done"); // reply muộn của M1 chết cùng socket cũ
    expect(second.status).toBe("failed");
  });

  it("(b) khoá đặt khi GetStatus của job đang chờ ⇒ guard trước FRC_Initialize từ chối ⇒ robot chỉ nhận FRC_GetStatus, job failed motion_locked_after_link_loss", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 3000);
    fake.respond = (pkt) => (pkt.Command === "FRC_GetStatus" ? { ...rmiHealthy(pkt), delayMs: 300 } : rmiHealthy(pkt));
    const job = d.runJob({ jobType: "home" });
    await sleep(50);
    d.lockMotion("test_link_loss", "injected by test");
    const r = await within(job, 5000);
    expect(r.ok).toBe(false);
    expect(r.detail?.reasonCode).toBe("motion_locked_after_link_loss");
    await sleep(100);
    expect(fake.received).toEqual(["FRC_GetStatus"]);
  });

  it("(c) hạn dispatcher rơi, STOP bị từ chối (ErrorID 9) ⇒ khoá ĐÃ đặt ngay (dispatch_deadline_outcome_unknown) trước khi timer driver chạy; home kế tiếp MOTION_LOCKED", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "1000";
    const fake = await startFakeRmi();
    const d = await fanucOn(fake, 3000);
    fake.sequential = false;
    fake.respond = (pkt) =>
      typeof pkt.Instruction === "string"
        ? { reply: null }
        : pkt.Command === "FRC_Abort"
          ? { reply: { Command: "FRC_Abort", ErrorID: 9 } }
          : rmiHealthy(pkt);
    const first = await within(dispatchRobotJob(HOME), 10_000);
    expect(first.status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ timeout: true, abort: "abort_failed" });
    expect(d.getMotionLock()).toMatchObject({ locked: true, reasonCode: "dispatch_deadline_outcome_unknown" });
    const second = await within(dispatchRobotJob(HOME), 10_000);
    expect(second).toMatchObject({ status: "rejected", error: "MOTION_LOCKED" });
  });
});

// ── Techman Listen Node giả, mỗi kết nối một hành vi ─────────────────────────
const HOME_ID1 = '$TMSCT,39,1,PTP("JPP",0,0,0,0,0,0,35,200,0,false),*00\r\n';
const ABORT_ID2 = "$TMSCT,22,2,StopAndClearBuffer(),*64\r\n";
const OK_ID2 = "$TMSCT,4,2,OK,*5F\r\n";

async function startListenNodeSeq(behaviours: Array<"silent" | string>): Promise<{ port: number; received: string[] }> {
  const socks = new Set<net.Socket>();
  const received: string[] = [];
  const srv = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
    const idx = received.push("") - 1;
    const b = behaviours[idx] ?? "silent";
    sock.on("data", (d) => {
      received[idx] += d.toString("latin1");
      if (b !== "silent" && received[idx].includes("\r\n") && !sock.destroyed) sock.write(Buffer.from(b, "latin1"));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  closers.push(async () => {
    for (const s of socks) s.destroy();
    await new Promise<void>((r) => srv.close(() => r()));
  });
  return { port: (srv.address() as net.AddressInfo).port, received };
}

let tmModbus: FakeTmModbus;
beforeAll(async () => {
  tmModbus = await startFakeTmModbus();
});
afterAll(async () => {
  await tmModbus.close();
});

describe("Techman — tm_reply_timeout đầu-cuối ⇒ StopAndClearBuffer() TRƯỚC khi chốt failed", () => {
  it("Listen Node im lặng với lệnh chuyển động ⇒ kết nối thứ hai nhận khung abort đúng từng byte; sổ reasonCode tm_reply_timeout + abort_sent", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000";
    const node = await startListenNodeSeq(["silent", OK_ID2]);
    const d = new TechmanDriver();
    await d.connect({
      endpoint: `tcp://127.0.0.1:${tmModbus.port}`,
      timeoutMs: 300,
      options: { listenHost: "127.0.0.1", listenPort: node.port },
    });
    active.driver = d;
    let atFinalize: string[] | null = null;
    ledger.snapshotAtFinalize = () => {
      atFinalize = [...node.received];
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(node.received).toEqual([HOME_ID1, ABORT_ID2]);
    expect(atFinalize).toEqual([HOME_ID1, ABORT_ID2]);
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "tm_reply_timeout", abort: "abort_sent" });
  });
});
