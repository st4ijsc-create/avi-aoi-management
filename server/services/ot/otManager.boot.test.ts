/**
 * doc 81 Đợt 1B Task 2 — bật gateway OT KHÔNG được làm boot treo (BE1 §0 (3)).
 *
 * Tái hiện đúng hình của phép đo BE1: phát lại adapter qua driver + supervisor SẢN PHẨM,
 * với ba đích cục bộ do test tự dựng trên 127.0.0.1 cổng 0:
 *   #1 Modbus TCP giả SỐNG (`ServerTCP` của modbus-serial) — kho thanh ghi là Map của test
 *      (oracle độc lập: giá trị mẫu phải bằng đúng số test ghi vào kho);
 *   #2 Modbus trỏ cổng ĐÓNG (ECONNREFUSED do hệ điều hành trả);
 *   #3 S7 (nodes7 thật) trỏ server TCP IM LẶNG — nhận kết nối nhưng không bao giờ trả lời
 *      bắt tay COTP, hệt một thiết bị treo. Driver tự chờ timeoutMs mặc định (5000 ms, vì
 *      `loadEnabledAdapters` để `timeoutMs: undefined` như DB thật).
 *
 * Hạn khởi động từng adapter trong test: OT_ADAPTER_START_TIMEOUT_MS = 1500 ⇒ nghiệm thu
 * "startOt resolve ≤ hạn + 2 s" = 3500 ms. Mọi khẳng định "không treo" đo bằng
 * `settleWithin` (hạn tường minh), không dựa vào vitest timeout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "node:net";
import type { OtSample } from "./otDriver";
import type { RuntimeAdapter } from "./deviceAdapter";

import * as ModbusSerialNs from "modbus-serial";

// deviceAdapter/ingest giả (hoisted). Ingest giả chỉ GHI LẠI mẫu — oracle là kho thanh ghi của
// server giả, không phải mã sản phẩm. (Ghi chú đo được: trước khi otManager dùng MỘT promise
// import chung, 3 adapter HA gọi import("./ingest") chồng nhau ⇒ vite-node trả ingest.ts THẬT
// cho 2/3 lời gọi — xem loadIngest() trong otManager.ts.)
const hoisted = vi.hoisted(() => ({
  adapters: [] as unknown[],
  /** Nếu đặt: loadEnabledAdapters gọi hàm này (điều khiển thời điểm nạp xong). */
  load: null as null | (() => Promise<unknown[]>),
  onIngest: null as null | ((adapterId: number, s: unknown) => void),
}));
vi.mock("./deviceAdapter", () => ({
  loadEnabledAdapters: async () => (hoisted.load ? hoisted.load() : hoisted.adapters),
}));
vi.mock("./ingest", () => ({
  ingestSample: async (a: { adapterId: number }, s: unknown) => {
    hoisted.onIngest?.(a.adapterId, s);
  },
  ingestSamples: async () => undefined,
}));

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

const START_TIMEOUT_MS = 1500;
const ACCEPT_BOUND_MS = START_TIMEOUT_MS + 2000;

async function settleWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ settled: boolean; ok?: boolean; value?: T; error?: unknown; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<"__pending__">((r) => {
    timer = setTimeout(() => r("__pending__"), ms);
  });
  try {
    const out = await Promise.race([
      p.then(
        (value) => ({ settled: true, ok: true, value }),
        (error) => ({ settled: true, ok: false, error }),
      ),
      guard,
    ]);
    if (out === "__pending__") return { settled: false, elapsed: Date.now() - t0 };
    return { ...(out as object), elapsed: Date.now() - t0 } as {
      settled: boolean;
      ok?: boolean;
      value?: T;
      error?: unknown;
      elapsed: number;
    };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

interface ModbusSim {
  port: number;
  close(): Promise<void>;
}

/** Server Modbus TCP giả theo đặc tả; kho thanh ghi holding là Map của TEST. */
async function startModbusSim(holding: Map<number, number>, port?: number): Promise<ModbusSim> {
  const p = port ?? (await freePort());
  const vector = {
    getHoldingRegister: (addr: number) => holding.get(addr) ?? 0,
    getInputRegister: () => 0,
    getCoil: () => false,
    getDiscreteInput: () => false,
    setRegister: () => undefined,
    setCoil: () => undefined,
  };
  const srv = new ServerTCP(vector, { host: "127.0.0.1", port: p, unitID: 1 });
  await new Promise<void>((resolve, reject) => {
    srv.once("initialized", () => resolve());
    srv.once("serverError", reject);
  });
  return { port: p, close: () => new Promise<void>((resolve) => srv.close(() => resolve())) };
}

/** Server TCP IM LẶNG: nhận kết nối, giữ socket, không bao giờ gửi byte nào. */
async function startSilentServer(): Promise<{ port: number; close(): Promise<void> }> {
  const held: net.Socket[] = [];
  const srv = net.createServer((sock) => {
    held.push(sock);
    sock.on("error", () => undefined);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        held.forEach((s) => s.destroy());
        srv.close(() => r());
      }),
  };
}

const TAG = { tagKey: "h", address: "40001", dataType: "int" as const };

const cleanups: Array<() => Promise<unknown> | unknown> = [];

async function runCleanups(): Promise<void> {
  while (cleanups.length) {
    const fn = cleanups.pop()!;
    await settleWithin(Promise.resolve().then(fn), 4000);
  }
}

interface Rig {
  mgr: typeof import("./otManager");
  samples: Array<{ at: number; adapterId: number; s: OtSample }>;
  livePort: number;
  holding: Map<number, number>;
  live: { sim: ModbusSim };
  mk: (adapterId: number, code: string, protocol: "modbus" | "s7", endpoint: string) => RuntimeAdapter;
}

/**
 * Dựng ba adapter (thứ tự: #3 im lặng, #2 cổng đóng, #1 sống — adapter chết đứng TRƯỚC để
 * chứng minh nó không chặn adapter sống) và nạp otManager với deviceAdapter/ingest giả.
 */
async function rig(): Promise<Rig> {
  const holding = new Map<number, number>([[0, 1234]]);
  const live = { sim: await startModbusSim(holding) };
  cleanups.push(() => live.sim.close());
  const closedPort = await freePort();
  const silent = await startSilentServer();
  cleanups.push(() => silent.close());

  const registry = await import("./driverRegistry");
  const { createModbusDriver } = await import("./drivers/modbusDriver");
  const { createS7Driver } = await import("./drivers/s7Driver");
  registry.registerDriver("modbus", createModbusDriver);
  registry.registerDriver("s7", createS7Driver);

  const mk = (adapterId: number, code: string, protocol: "modbus" | "s7", endpoint: string): RuntimeAdapter => ({
    adapterId,
    code,
    machineId: null,
    protocol,
    // timeoutMs undefined — y như loadEnabledAdapters() dựng từ DB.
    connection: { endpoint, options: undefined, timeoutMs: undefined },
    pollIntervalMs: 200,
    tags: [TAG],
    driver: registry.createDriver(protocol),
  });
  const adapters = [
    mk(3, "SILENT-S7", "s7", `127.0.0.1:${silent.port}`),
    mk(2, "CLOSED-MB", "modbus", `tcp://127.0.0.1:${closedPort}`),
    mk(1, "LIVE-MB", "modbus", `tcp://127.0.0.1:${live.sim.port}`),
  ];

  const samples: Rig["samples"] = [];
  hoisted.adapters = adapters;
  hoisted.onIngest = (adapterId, s) => samples.push({ at: Date.now(), adapterId, s: s as OtSample });

  const mgr = await import("./otManager");
  cleanups.push(() => mgr.stopOt());
  return { mgr, samples, livePort: live.sim.port, holding, live, mk };
}

function goodFrom(r: Rig, adapterId: number, value: number, since = 0): OtSample | undefined {
  return r.samples.find((x) => x.adapterId === adapterId && x.at >= since && x.s.quality === "good" && x.s.value === value)
    ?.s;
}

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await sleep(25);
  }
  return pred();
}

describe("otManager khởi động có hạn (doc 81 Đợt 1B Task 2)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_ADAPTER_START_TIMEOUT_MS", String(START_TIMEOUT_MS));
    vi.stubEnv("OT_LEGACY_RECONNECT_MS", "200");
    vi.stubEnv("OT_TAG_DEADBAND_ENABLED", "false");
    vi.stubEnv("OT_POLL_BATCH_ENABLED", "false");
  });
  afterEach(async () => {
    await runCleanups();
    hoisted.onIngest = null;
    hoisted.adapters = [];
    hoisted.load = null;
    vi.unstubAllEnvs();
  });

  it("hằng số mặc định: hạn khởi động mỗi adapter 10000 ms", async () => {
    const mgr = await import("./otManager");
    expect(mgr.DEFAULT_OT_ADAPTER_START_TIMEOUT_MS).toBe(10_000);
  });

  it("LEGACY: startOt resolve ≤ hạn + 2 s; #1 có mẫu đúng kho; #2 và #3 ở trạng thái error", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    const r = await rig();
    const res = await settleWithin(r.mgr.startOt(), ACCEPT_BOUND_MS);
    expect(res.settled, `startOt treo > ${ACCEPT_BOUND_MS} ms`).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.elapsed).toBeLessThanOrEqual(ACCEPT_BOUND_MS);
    expect(r.mgr.isOtRunning()).toBe(true);

    expect(await waitFor(() => !!goodFrom(r, 1, 1234), 2000), "#1 phải có mẫu = 1234 (kho server giả)").toBe(true);
    expect(r.mgr.getOtAdapterStatus(1)?.state).toBe("active");
    expect(r.mgr.getOtAdapterStatus(2)?.state).toBe("error");
    expect(r.mgr.getOtAdapterStatus(2)?.lastError).toMatch(/ECONNREFUSED/);
    expect(r.mgr.getOtAdapterStatus(3)?.state).toBe("error");
    expect(r.mgr.getOtAdapterStatus(3)?.lastError).toMatch(/timeout/i);
    // #2/#3 không có driver "sống" cho dispatcher; #1 có.
    expect(r.mgr.getActiveDriver(1)).toBeDefined();
    expect(r.mgr.getActiveDriver(2)).toBeUndefined();
    expect(r.mgr.getActiveDriver(3)).toBeUndefined();
  }, 20_000);

  it("LEGACY: adapter chết đứng TRƯỚC không chặn adapter sống (mẫu #1 tới trước khi hạn #3 hết)", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    const r = await rig();
    const t0 = Date.now();
    const p = r.mgr.startOt();
    const got = await waitFor(() => !!goodFrom(r, 1, 1234), START_TIMEOUT_MS - 300);
    expect(got, `mẫu #1 phải tới trong ${START_TIMEOUT_MS - 300} ms (đo ${Date.now() - t0} ms)`).toBe(true);
    await settleWithin(p, ACCEPT_BOUND_MS);
  }, 20_000);

  it("LEGACY: kill server giả rồi bật lại cùng cổng ⇒ có mẫu MỚI (BE1: legacy 0 mẫu sau khi bật lại)", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    const r = await rig();
    const res = await settleWithin(r.mgr.startOt(), ACCEPT_BOUND_MS);
    expect(res.settled).toBe(true);
    expect(await waitFor(() => !!goodFrom(r, 1, 1234), 2000)).toBe(true);

    // ── kill ──
    await r.live.sim.close();
    const lost = await waitFor(() => r.mgr.getOtAdapterStatus(1)?.state !== "active", 3000);
    expect(lost, "mất kết nối phải được phát hiện (state rời 'active')").toBe(true);
    await sleep(800); // vài vòng thử lại khi server còn chết

    // ── bật lại cùng cổng, kho mang giá trị MỚI ──
    r.holding.set(0, 4321);
    r.live.sim = await startModbusSim(r.holding, r.livePort);
    const tUp = Date.now();
    const fresh = await waitFor(() => !!goodFrom(r, 1, 4321, tUp), 6000);
    expect(fresh, "phải có mẫu mới = 4321 trong 6 s sau khi server bật lại").toBe(true);
    expect(r.mgr.getOtAdapterStatus(1)?.state).toBe("active");
    expect(r.mgr.getActiveDriver(1)).toBeDefined();

    const s = await settleWithin(r.mgr.stopOt(), 4000);
    expect(s.settled, "stopOt treo").toBe(true);
    expect(r.mgr.isOtRunning()).toBe(false);
  }, 30_000);

  it("HA: startOt resolve ≤ hạn + 2 s; #1 có mẫu; #2 và #3 ở error/reconnecting", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_BACKOFF_MS", "300");
    const r = await rig();
    const res = await settleWithin(r.mgr.startOt(), ACCEPT_BOUND_MS);
    expect(res.settled, `startOt (HA) treo > ${ACCEPT_BOUND_MS} ms`).toBe(true);
    expect(res.elapsed).toBeLessThanOrEqual(ACCEPT_BOUND_MS);

    expect(await waitFor(() => !!goodFrom(r, 1, 1234), 2000), "#1 phải có mẫu = 1234").toBe(true);
    expect(r.mgr.getOtAdapterStatus(1)?.state).toBe("active");
    expect(r.mgr.getSupervisorStatus(1)?.state).toBe("connected");
    for (const id of [2, 3]) {
      const st = r.mgr.getOtAdapterStatus(id);
      expect(["error", "reconnecting"], `adapter #${id} state=${st?.state}`).toContain(st?.state);
      expect(r.mgr.getSupervisorStatus(id)?.state).not.toBe("connected");
      expect(r.mgr.getActiveDriver(id)).toBeUndefined();
    }
    const s = await settleWithin(r.mgr.stopOt(), 4000);
    expect(s.settled, "stopOt (HA) treo").toBe(true);
  }, 20_000);

  it("HA: supervisor.start() treo (lớp trong hỏng) ⇒ lớp ngoài của otManager vẫn trả về ≤ hạn + 1 s + biên", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "true");
    vi.stubEnv("OT_ADAPTER_START_TIMEOUT_MS", "500");
    vi.doMock("./connectionSupervisor", async (importOriginal) => {
      const m = await importOriginal<typeof import("./connectionSupervisor")>();
      class HangingStartSupervisor extends m.ConnectionSupervisor {
        override start(): Promise<void> {
          return new Promise<void>(() => undefined); // không bao giờ xong
        }
      }
      return { ...m, ConnectionSupervisor: HangingStartSupervisor };
    });
    try {
      const r = await rig();
      const res = await settleWithin(r.mgr.startOt(), 2500);
      expect(res.settled, `startOt (HA, start treo) > 2500 ms`).toBe(true);
      expect(res.ok).toBe(true);
      expect(r.mgr.isOtRunning()).toBe(true);
      // Supervisor vẫn được đăng ký (tiếp tục NỀN) để stopOt hạ được.
      expect(r.mgr.listSupervisorStatuses()).toHaveLength(3);
      const s = await settleWithin(r.mgr.stopOt(), 4000);
      expect(s.settled).toBe(true);
    } finally {
      vi.doUnmock("./connectionSupervisor");
    }
  }, 20_000);

  it("LEGACY: stopOt trong lúc startOt còn chạy ⇒ adapter đang dở (và đã xong) không sống lại, không còn poll", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    const r = await rig();
    // #1 nối được nhưng CHẬM 500 ms ⇒ nó xong SAU khi stopOt đã chạy.
    const live = (hoisted.adapters as RuntimeAdapter[]).find((a) => a.adapterId === 1)!;
    const realConnect = live.driver.connect.bind(live.driver);
    live.driver.connect = async (cfg) => {
      await sleep(500);
      return realConnect(cfg);
    };
    const p = r.mgr.startOt();
    await sleep(150);
    const s = await settleWithin(r.mgr.stopOt(), 4000);
    expect(s.settled).toBe(true);
    const res = await settleWithin(p, ACCEPT_BOUND_MS);
    expect(res.settled).toBe(true);
    expect(res.value).toBe(false);
    expect(r.mgr.isOtRunning()).toBe(false);
    expect(r.mgr.listActiveAdapters()).toHaveLength(0);
    await sleep(700);
    expect(r.samples.filter((x) => x.adapterId === 1), "adapter xong sau stopOt không được poll").toHaveLength(0);
    expect(live.driver.isConnected(), "kết nối xong sau stopOt phải bị hạ").toBe(false);
  }, 20_000);

  it("startOt gọi chồng trong lúc đang khởi động ⇒ cùng một lần khởi động (không nối đôi)", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    const r = await rig();
    let connects = 0;
    const live = (hoisted.adapters as RuntimeAdapter[]).find((a) => a.adapterId === 1)!;
    const realConnect = live.driver.connect.bind(live.driver);
    live.driver.connect = async (cfg) => {
      connects += 1;
      return realConnect(cfg);
    };
    const [a, b] = await Promise.all([
      settleWithin(r.mgr.startOt(), ACCEPT_BOUND_MS),
      settleWithin(r.mgr.startOt(), ACCEPT_BOUND_MS),
    ]);
    expect(a.settled && b.settled).toBe(true);
    expect(a.value).toBe(true);
    expect(b.value).toBe(true);
    expect(connects, "adapter #1 chỉ được connect MỘT lần").toBe(1);
    expect(r.mgr.listActiveAdapters().filter((x) => x.adapterId === 1)).toHaveLength(1);
  }, 20_000);

  // ── Fix round 1 ─────────────────────────────────────────────────────────────

  it("(FR1-2) lượt startOt CŨ nạp adapter xong SAU stopOt + startOt mới ⇒ thế hệ mới giữ nguyên", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    const r = await rig();
    const genB = hoisted.adapters as RuntimeAdapter[];
    // Thế hệ CŨ: cùng id 1 (trỏ server sống) nhưng driver KHÁC.
    const stale = r.mk(1, "STALE-MB", "modbus", `tcp://127.0.0.1:${r.livePort}`);
    let releaseStale!: (v: unknown[]) => void;
    let calls = 0;
    hoisted.load = () => {
      calls += 1;
      if (calls === 1) return new Promise<unknown[]>((res) => (releaseStale = res));
      return Promise.resolve(genB);
    };
    const p1 = r.mgr.startOt(); // lượt cũ: kẹt ở loadEnabledAdapters
    await sleep(30);
    await r.mgr.stopOt();
    const p2 = await settleWithin(r.mgr.startOt(), ACCEPT_BOUND_MS);
    expect(p2.value).toBe(true);
    expect(r.mgr.getOtAdapterStatus(1)?.state).toBe("active");

    releaseStale([stale]); // lượt cũ nạp xong MUỘN
    const p1r = await settleWithin(p1, ACCEPT_BOUND_MS);
    expect(p1r.settled).toBe(true);
    expect(p1r.value).toBe(false);
    await sleep(300);
    const st = r.mgr.getOtAdapterStatus(1);
    expect(st?.code, "entry của thế hệ mới không được bị lượt cũ ghi đè").toBe("LIVE-MB");
    expect(st?.state).toBe("active");
    expect(r.mgr.getActiveAdapter(1)).toBe(genB.find((a) => a.adapterId === 1));
    expect(r.mgr.getOtAdapterStatus(3)?.state, "adapter #3 của thế hệ mới vẫn còn").toBe("error");
    expect(stale.driver.isConnected(), "lượt cũ không được nối driver của nó").toBe(false);
  }, 20_000);

  for (const ha of [false, true]) {
    it(`(FR1-3) ${ha ? "HA" : "LEGACY"}: adapter cấu hình timeoutMs LỚN hơn hạn env ⇒ hạn hiệu lực = max(env, timeoutMs + biên), nối được`, async () => {
      vi.stubEnv("OT_CONN_HA_ENABLED", ha ? "true" : "false");
      vi.stubEnv("OT_ADAPTER_START_TIMEOUT_MS", "1000");
      const r = await rig();
      const live = (hoisted.adapters as RuntimeAdapter[]).find((a) => a.adapterId === 1)!;
      live.connection = { ...live.connection, timeoutMs: 2500 };
      // Thiết bị CHẬM: connect mất 1500 ms (> hạn env 1000 ms, < timeoutMs 2500 của adapter).
      // HA dựng driver MỚI qua registry ⇒ bọc cả registry lẫn driver sẵn có của adapter.
      const slowConnect = (drv: any) => {
        const rc = drv.connect.bind(drv);
        drv.connect = async (cfg: any) => {
          if (cfg?.timeoutMs === 2500) await sleep(1500);
          return rc(cfg);
        };
        return drv;
      };
      const registry = await import("./driverRegistry");
      const { createModbusDriver } = await import("./drivers/modbusDriver");
      registry.registerDriver("modbus", () => slowConnect(createModbusDriver()));
      slowConnect(live.driver);
      const res = await settleWithin(r.mgr.startOt(), 2500 + 1000 + 2000);
      expect(res.settled).toBe(true);
      const st = r.mgr.getOtAdapterStatus(1);
      expect(st?.state, `#1 phải active (state=${st?.state}, err=${st?.lastError})`).toBe("active");
      expect(st?.attempts, "nối được ngay lần đầu, không phải nhờ thử lại").toBe(1);
      expect(await waitFor(() => !!goodFrom(r, 1, 1234), 2000)).toBe(true);
      // adapter KHÔNG cấu hình timeoutMs vẫn theo hạn env (S7 im lặng quá hạn 1000 ms).
      expect(["error", "reconnecting"]).toContain(r.mgr.getOtAdapterStatus(3)?.state);
    }, 20_000);
  }

  it("(FR1-4) LEGACY: connect xong MUỘN sau hạn ⇒ handle bị đóng, driver bị hạ, không 'active' nhờ nó; lần thử lại sau đó nối được", async () => {
    vi.stubEnv("OT_CONN_HA_ENABLED", "false");
    const r = await rig();
    const live = (hoisted.adapters as RuntimeAdapter[]).find((a) => a.adapterId === 1)!;
    const d = live.driver;
    const events: string[] = [];
    let n = 0;
    const realConnect = d.connect.bind(d);
    d.connect = async (cfg) => {
      const k = ++n;
      events.push(`connect-start#${k}`);
      if (k === 1) await sleep(START_TIMEOUT_MS + 500); // xong SAU hạn 1500 ms
      await realConnect(cfg);
      events.push(`connect-done#${k}`);
    };
    const realSubscribe = d.subscribe.bind(d);
    d.subscribe = async (tags, onSample, ms) => {
      const k = n;
      const h = await realSubscribe(tags, onSample, ms);
      events.push(`subscribe#${k}`);
      return {
        close: async () => {
          events.push(`close#${k}`);
          await h.close();
        },
      };
    };
    const realDisconnect = d.disconnect.bind(d);
    d.disconnect = async () => {
      events.push("disconnect");
      await realDisconnect();
    };

    const res = await settleWithin(r.mgr.startOt(), ACCEPT_BOUND_MS);
    expect(res.settled).toBe(true);
    expect(r.mgr.getOtAdapterStatus(1)?.state).toBe("error");
    expect(r.mgr.getOtAdapterStatus(1)?.lastError).toMatch(/timeout/);

    // Kết nối muộn tới rồi bị hạ; lần thử lại (#2) nối được.
    const back = await waitFor(() => r.mgr.getOtAdapterStatus(1)?.state === "active", 5000);
    expect(back, `phải nối lại được (events=${events.join(",")})`).toBe(true);
    const iDone1 = events.indexOf("connect-done#1");
    const iSub1 = events.indexOf("subscribe#1");
    const iClose1 = events.indexOf("close#1");
    const iStart2 = events.indexOf("connect-start#2");
    expect(iDone1, events.join(",")).toBeGreaterThanOrEqual(0);
    expect(iClose1, `handle của kết nối muộn phải bị đóng (${events.join(",")})`).toBeGreaterThan(iSub1);
    const discAfterLate = events.findIndex((e, i) => e === "disconnect" && i > iSub1);
    expect(discAfterLate, `driver phải bị hạ sau kết nối muộn (${events.join(",")})`).toBeGreaterThan(iSub1);
    expect(iStart2, "lần thử lại chỉ bắt đầu SAU khi kết nối muộn đã được dọn").toBeGreaterThan(
      Math.max(iClose1, discAfterLate),
    );
    expect(r.mgr.getOtAdapterStatus(1)?.attempts).toBeGreaterThanOrEqual(2);
    const tBack = Date.now();
    expect(await waitFor(() => !!goodFrom(r, 1, 1234, tBack), 2000)).toBe(true);
  }, 20_000);
});
