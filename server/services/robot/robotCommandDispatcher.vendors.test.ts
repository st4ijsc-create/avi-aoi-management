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
interface FakeRmi {
  port: number;
  received: string[]; // Command / Communication / Instruction theo thứ tự nhận
  /** Trả lời cho gói; null = im lặng. `delayMs` = trễ trước khi trả lời (xử lý tuần tự). */
  respond: (pkt: RmiPkt) => { reply: RmiPkt | null; delayMs?: number };
}

/** Literal replies per the RMI manual (ErrorID 0 = success). */
function rmiHealthy(pkt: RmiPkt): { reply: RmiPkt | null; delayMs?: number } {
  if (pkt.Communication === "FRC_Connect")
    return { reply: { Communication: "FRC_Connect", ErrorID: 0, PortNumber: 16002, MajorVersion: 1, MinorVersion: 3 } };
  if (pkt.Communication === "FRC_Disconnect") return { reply: { Communication: "FRC_Disconnect", ErrorID: 0 } };
  if (pkt.Command === "FRC_GetStatus")
    return { reply: { Command: "FRC_GetStatus", ErrorID: 0, ServoReady: 1, TPMode: 0, RMIMotionStatus: 0, ProgramStatus: 0, NextSequenceID: 1 } };
  if (pkt.Command === "FRC_Initialize") return { reply: { Command: "FRC_Initialize", ErrorID: 0, GroupMask: 1 } };
  if (pkt.Command === "FRC_Abort") return { reply: { Command: "FRC_Abort", ErrorID: 0 } };
  if (typeof pkt.Instruction === "string") return { reply: { Instruction: pkt.Instruction, ErrorID: 0, SequenceID: pkt.SequenceID } };
  return { reply: { ErrorID: 0 } };
}

async function startFakeRmi(): Promise<FakeRmi> {
  const socks = new Set<net.Socket>();
  const fake: FakeRmi = { port: 0, received: [], respond: rmiHealthy };
  const srv = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
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
        fake.received.push(String(pkt.Command ?? pkt.Communication ?? pkt.Instruction));
        const { reply, delayMs = 0 } = fake.respond(pkt);
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
  return d;
}

describe("FANUC RMI — reply timeout ⇒ FRC_Abort TRƯỚC khi chốt failed (rmi_reply_timeout)", () => {
  it("gói chuyển động không được trả lời ⇒ server giả nhận FRC_Abort; sổ failed + reasonCode rmi_reply_timeout + abort_sent", async () => {
    process.env.ROBOT_CONTROL_TIMEOUT_MS = "5000"; // driver (300 ms) hết hạn trước dispatcher
    const fake = await startFakeRmi();
    await fanucOn(fake, 300);
    fake.respond = (pkt) => (typeof pkt.Instruction === "string" ? { reply: null } : rmiHealthy(pkt));
    let atFinalize: string[] | null = null;
    ledger.snapshotAtFinalize = () => {
      atFinalize = [...fake.received];
    };
    const r = await within(dispatchRobotJob(HOME), 10_000);
    expect(r.status).toBe("failed");
    expect(fake.received).toEqual(["FRC_GetStatus", "FRC_Initialize", "FRC_JointMotionJRep", "FRC_Abort"]);
    expect(atFinalize).toContain("FRC_Abort"); // dừng ĐÃ tới robot trước lúc sổ chốt
    expect(ledger.rows[0].status).toBe("failed");
    expect(ledger.rows[0].result).toMatchObject({ reasonCode: "rmi_reply_timeout", abort: "abort_sent" });
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
