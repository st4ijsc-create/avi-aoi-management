/**
 * SCADA R1b-2b-1 (điều tra bench B1b lượt 1, 2026-10-27; điều phối duyệt Phương án A + nhãn (a) "không rõ kết cục") —
 * lần ghi ĐANG BAY khi liên kết mất / phiên bị hạ phải được TRẢ LỜI NGAY là `timeout` (không rõ kết cục: lệnh CÓ THỂ đã tới PLC),
 * không treo tới hạn dispatcher (OT_CONTROL_TIMEOUT_MS 5000) và KHÔNG BAO GIỜ thành `failed` hay ack giả.
 *
 * Gốc lỗi (có sẵn từ 1e0ae656c, 2026-09-26): peer đóng lúc FC5 đang bay ⇒ vòng canh legacy hạ phiên (driver.disconnect()) ⇒
 * closeModbusClient ⇒ ModbusRTU.destroy() ⇒ _cancelPendingTransactions() XOÁ hẹn giờ 800 ms của giao dịch mà KHÔNG gọi callback ⇒
 * writeCoil không bao giờ xong ⇒ dispatcher kết thúc ở 5000 ms 'timeout'.
 *
 * Giả lập: server Modbus TCP viết tay (net, 127.0.0.1, cổng OS cấp) — FC1 (đọc coil) và FC5 (ghi coil). Hành vi theo TỪNG FC5 (kịch bản
 * tiêu thụ theo thứ tự; hết kịch bản ⇒ trả lời): "tra_loi" | "dong_khong_tra_loi" (huỷ socket, không áp) | "im_lang" (không trả lời,
 * KHÔNG đóng). Vòng canh legacy mô phỏng đúng otManager.legacyTick + dropLegacySession (500 ms: isConnected() false ⇒ đóng poll +
 * driver.disconnect()). Đường ghi THẬT: executeOtDeviceWrite + ModbusDriver THẬT + modbus-serial 8.0.25 THẬT; hàng đợi THẬT
 * (tryEnqueueAdapterCommand, nối dây như commandDispatcher: priorityStop + holdSlot = slotHold) cho ca OT_CMD_SERIALIZE_ENABLED bật.
 *
 * Ba điểm huỷ (mỗi điểm một ca, mỗi ca chỉ một điểm có thể kích hoạt):
 *   (i)   socket close/error của client hiện tại — peer đóng, KHÔNG vòng canh;
 *   (ii)  disconnect() — peer im lặng (không đóng), ta gọi disconnect();
 *   (iii) connect() trên CÙNG driver trước khi đóng client cũ — peer im lặng, ta gọi connect() lại.
 * Mã cũ: (i) ⇒ 'failed' ~800 ms (hạn giao dịch thư viện); (ii)/(iii) ⇒ đóng êm ⇒ 'failed' ~800 ms; REPRO ⇒ 'timeout' 5000 ms.
 */
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { ModbusDriver } from "./modbusDriver";
import {
  executeOtDeviceWrite,
  tryEnqueueAdapterCommand,
  _resetAdapterCommandQueuesForTests,
  _staleWriteRiskIntentIdsForTests,
  _stopWatchCountForTests,
  _sweepStaleWriteRiskForTests,
  type ExecutedWrite,
  type OtDeviceEventSink,
} from "../otDeviceWrite";
import type { OtSubscriptionHandle } from "../otDriver";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type HanhViGhi = "tra_loi" | "dong_khong_tra_loi" | "im_lang";

interface Sim {
  port: number;
  coil: { v: number };
  soKetNoi: number;
  nhanFc5: number;
  /** hành vi cho các FC5 kế tiếp (tiêu thụ đầu hàng); rỗng ⇒ "tra_loi" */
  kichBan: HanhViGhi[];
  /** gọi mỗi khi nhận một FC5 (số thứ tự từ 1) */
  onFc5?: (n: number) => void;
  /** huỷ mọi socket đang mở (peer cắt liên kết) */
  catKetNoi(): void;
  close(): Promise<void>;
}

async function startSim(): Promise<Sim> {
  const sockets = new Set<net.Socket>();
  const sim: Sim = {
    port: 0,
    coil: { v: 0 },
    soKetNoi: 0,
    nhanFc5: 0,
    kichBan: [],
    catKetNoi: () => {
      for (const s of sockets) s.destroy();
    },
    close: async () => undefined,
  };
  const server = net.createServer((sock) => {
    sim.soKetNoi += 1;
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) return;
        const frame = buf.subarray(0, 6 + len);
        buf = buf.subarray(6 + len);
        const tid = frame.readUInt16BE(0);
        const unit = frame[6];
        const fc = frame[7];
        const reply = (pdu: Buffer) => {
          const h = Buffer.alloc(7);
          h.writeUInt16BE(tid, 0);
          h.writeUInt16BE(0, 2);
          h.writeUInt16BE(pdu.length + 1, 4);
          h[6] = unit;
          if (!sock.destroyed) sock.write(Buffer.concat([h, pdu]));
        };
        if (fc === 1) {
          reply(Buffer.from([1, 1, sim.coil.v & 1]));
        } else if (fc === 5) {
          sim.nhanFc5 += 1;
          const hanhVi = sim.kichBan.shift() ?? "tra_loi";
          sim.onFc5?.(sim.nhanFc5);
          if (hanhVi === "dong_khong_tra_loi") {
            sock.destroy(); // peer bỏ kết nối đúng lúc nhận lệnh ghi, không trả lời, KHÔNG áp giá trị
            return;
          }
          if (hanhVi === "im_lang") continue; // không trả lời, không đóng, KHÔNG áp
          const val = frame.readUInt16BE(10);
          sim.coil.v = val === 0xff00 ? 1 : 0;
          reply(frame.subarray(7, 12));
        } else {
          reply(Buffer.from([fc | 0x80, 1]));
        }
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  sim.port = (server.address() as net.AddressInfo).port;
  sim.close = () =>
    new Promise<void>((r) => {
      for (const s of sockets) s.destroy();
      server.close(() => r());
    });
  return sim;
}

/** Mô phỏng vòng canh legacy của otManager (legacyTick ⇒ xuLyMatLegacy ⇒ dropLegacySession). */
function vongCanhLegacy(driver: ModbusDriver, getHandle: () => OtSubscriptionHandle | null, log: string[], t0: number) {
  let busy = false;
  let dropped = false;
  const timer = setInterval(() => {
    if (busy || dropped) return;
    if (driver.isConnected()) return;
    busy = true;
    dropped = true;
    log.push(`${Date.now() - t0}ms legacyTick: driver reported disconnected ⇒ dropLegacySession`);
    void (async () => {
      const h = getHandle();
      if (h) await h.close();
      await driver.disconnect(); // closeModbusClient ⇒ isOpen=false ⇒ skipGraceful ⇒ client.destroy() ⇒ _cancelPendingTransactions()
      log.push(`${Date.now() - t0}ms driver.disconnect() xong`);
      busy = false;
    })();
  }, 500);
  return () => clearInterval(timer);
}

const ADAPTER_ID = 990_001;
const cfg = (port: number) => ({ endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 800, options: { unitId: 1, timeoutMs: 800 } });

function chayStopKhongCho(
  driver: ModbusDriver,
  adapterId = ADAPTER_ID,
  timeoutMs = 5000,
  them: { intentIds?: number[]; sink?: OtDeviceEventSink } = {},
): Promise<ExecutedWrite> {
  return executeOtDeviceWrite({
    input: { adapterId, machineId: null, commandType: "stop", idempotencyKey: `repro-${adapterId}-${Math.random()}`, writes: [{ tagKey: "icoil", value: 1 }] } as any,
    driver,
    resolved: [{ write: { tagKey: "icoil", value: 1 }, address: "coil:1", dataType: "int" }],
    driverWrites: [{ tagKey: "icoil", address: "coil:1", value: 1, dataType: "int" }],
    timeoutMs,
    stopTyped: true,
    bumpStopEpoch: true,
    ledger: { intentIds: them.intentIds ?? [1], confirmedBy: 1 },
    ...(them.sink ? { sink: them.sink } : {}),
  });
}

async function chayStop(driver: ModbusDriver, adapterId = ADAPTER_ID, timeoutMs = 5000) {
  const t0 = performance.now();
  const ex = await chayStopKhongCho(driver, adapterId, timeoutMs);
  return { ex, ms: Math.round(performance.now() - t0) };
}

/** Chờ điều kiện (có hạn tường minh). */
async function choToi(dk: () => boolean, ms: number, nhan: string): Promise<void> {
  const het = performance.now() + ms;
  while (!dk()) {
    if (performance.now() > het) throw new Error(`${nhan}: không xảy ra trong ${ms} ms`);
    await sleep(5);
  }
}

/** Không ack giả: mọi write báo ok ⇒ coil THẬT đã lên 1. */
function khongAckGia(ex: ExecutedWrite, coil: number): void {
  for (const o of ex.outcomes) {
    if (o.ok || String(o.status).startsWith("acked")) expect(coil).toBe(1);
  }
}

/** "Không rõ kết cục" của dispatcher: status 'timeout', ok=false, KHÔNG 'failed', câu "outcome unknown". */
function laKhongRoKetCuc(ex: ExecutedWrite): void {
  expect(ex.timedOut).toBe(true);
  expect(ex.outcomes).toHaveLength(1);
  expect(ex.outcomes[0].ok).toBe(false);
  expect(ex.outcomes[0].status).toBe("timeout");
  expect(String(ex.outcomes[0].errorText)).toMatch(/outcome unknown: the write may have been applied/);
}

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
  _resetAdapterCommandQueuesForTests();
  _sweepStaleWriteRiskForTests(Number.MAX_SAFE_INTEGER);
});

async function moDriver(sim: Sim): Promise<ModbusDriver> {
  const driver = new ModbusDriver();
  cleanup.push(() => sim.close(), () => driver.disconnect());
  await driver.connect(cfg(sim.port) as any);
  return driver;
}

describe("R1b-2b-1 — lần ghi đang bay khi liên kết mất / phiên bị hạ ⇒ trả lời NGAY 'timeout' (không rõ kết cục)", () => {
  it("REPRO B1b lượt 1: peer đóng lúc nhận FC5 + poll + vòng canh legacy ⇒ 'timeout' (không rõ) trong < 1000 ms, không treo 5000 ms", async () => {
    const sim = await startSim();
    const driver = await moDriver(sim);
    let handle: OtSubscriptionHandle | null = await driver.subscribe([{ tagKey: "icoil", address: "coil:1", dataType: "int" }], () => undefined, 1000);
    cleanup.push(() => handle?.close());
    await sleep(1200); // vài lần đọc poll thành công trên đúng kết nối này
    const t0 = Date.now();
    const log: string[] = [];
    cleanup.push(vongCanhLegacy(driver, () => { const h = handle; handle = null; return h; }, log, t0));

    sim.kichBan = ["dong_khong_tra_loi"];
    const r = await chayStop(driver);
    // eslint-disable-next-line no-console
    console.log("[repro]", JSON.stringify({ ms: r.ms, timedOut: r.ex.timedOut, outcomes: r.ex.outcomes, log, nhanFc5: sim.nhanFc5, coil: sim.coil.v }));

    expect(sim.nhanFc5).toBe(1); // lệnh ghi ĐÃ tới peer (không bị chặn bởi phần mềm phía ta)
    laKhongRoKetCuc(r.ex); // CÓ THỂ đã tới PLC ⇒ không bao giờ 'failed'
    expect(r.ms).toBeLessThan(1000); // trước bản vá: ≥ 5000 (hạn dispatcher)
    expect(sim.coil.v).toBe(0);
    khongAckGia(r.ex, sim.coil.v);
  }, 15_000);

  it("(i) socket close/error: peer đóng lúc nhận FC5, KHÔNG vòng canh, KHÔNG ai gọi disconnect ⇒ 'timeout' (không rõ) trong < 500 ms", async () => {
    const sim = await startSim();
    const driver = await moDriver(sim);
    await sleep(100);
    sim.kichBan = ["dong_khong_tra_loi"];
    const r = await chayStop(driver);
    // eslint-disable-next-line no-console
    console.log("[i-socket-close]", JSON.stringify({ ms: r.ms, outcomes: r.ex.outcomes }));
    expect(sim.nhanFc5).toBe(1);
    laKhongRoKetCuc(r.ex); // trước bản vá: 'failed' "Timed out" ~800 ms
    expect(r.ms).toBeLessThan(500);
    khongAckGia(r.ex, sim.coil.v);
  }, 15_000);

  it("(ii) disconnect(): peer IM LẶNG (không đóng) ⇒ ta gọi disconnect() khi FC5 đang bay ⇒ 'timeout' (không rõ) trong < 500 ms kể từ disconnect", async () => {
    const sim = await startSim();
    const driver = await moDriver(sim);
    await sleep(100);
    sim.kichBan = ["im_lang"];
    const p = chayStopKhongCho(driver);
    await choToi(() => sim.nhanFc5 === 1, 2000, "FC5 tới peer");
    const t0 = performance.now();
    void driver.disconnect();
    const ex = await p;
    const ms = Math.round(performance.now() - t0);
    // eslint-disable-next-line no-console
    console.log("[ii-disconnect]", JSON.stringify({ ms, outcomes: ex.outcomes }));
    laKhongRoKetCuc(ex); // trước bản vá: đóng êm ⇒ hạn giao dịch thư viện ⇒ 'failed' ~800 ms
    expect(ms).toBeLessThan(500);
    khongAckGia(ex, sim.coil.v);
  }, 15_000);

  it("(iii) connect() trên CÙNG driver (supervisor nối lại) khi FC5 đang bay trên client cũ ⇒ 'timeout' (không rõ) trong < 500 ms kể từ connect", async () => {
    const sim = await startSim();
    const driver = await moDriver(sim);
    await sleep(100);
    sim.kichBan = ["im_lang"];
    const p = chayStopKhongCho(driver);
    await choToi(() => sim.nhanFc5 === 1, 2000, "FC5 tới peer");
    const t0 = performance.now();
    const pc = driver.connect(cfg(sim.port) as any);
    const ex = await p;
    const ms = Math.round(performance.now() - t0);
    await pc;
    // eslint-disable-next-line no-console
    console.log("[iii-connect]", JSON.stringify({ ms, outcomes: ex.outcomes, soKetNoi: sim.soKetNoi }));
    laKhongRoKetCuc(ex); // trước bản vá: client cũ đóng êm ⇒ 'failed' ~800 ms
    expect(ms).toBeLessThan(500);
    expect(driver.isConnected()).toBe(true); // phiên MỚI không bị ảnh hưởng
    khongAckGia(ex, sim.coil.v);
  }, 15_000);

  it("ĐỐI CHỨNG: peer trả lời bình thường, có poll + vòng canh ⇒ acked ~ms, coil 0 → 1 (B1b lượt 2/3)", async () => {
    const sim = await startSim();
    const driver = await moDriver(sim);
    let handle: OtSubscriptionHandle | null = await driver.subscribe([{ tagKey: "icoil", address: "coil:1", dataType: "int" }], () => undefined, 1000);
    cleanup.push(() => handle?.close());
    const log: string[] = [];
    cleanup.push(vongCanhLegacy(driver, () => { const h = handle; handle = null; return h; }, log, Date.now()));
    await sleep(1200);
    const r = await chayStop(driver);
    expect(r.ex.outcomes[0].status).toBe("acked");
    expect(sim.coil.v).toBe(1);
    expect(r.ms).toBeLessThan(500);
    expect(log).toEqual([]);
  }, 15_000);

  it("CƠ CHẾ thư viện (oracle độc lập với mã sản phẩm): ModbusRTU.destroy() khi một giao dịch đang chờ ⇒ promise của thư viện không bao giờ xong", async () => {
    const sim = await startSim();
    cleanup.push(() => sim.close());
    const mod: any = await import("modbus-serial");
    const ModbusRTU = mod.default ?? mod;
    const c = new ModbusRTU();
    await c.connectTCP("127.0.0.1", { port: sim.port });
    c.setID(1);
    c.setTimeout(800);
    sim.kichBan = ["dong_khong_tra_loi"];
    let settled = false;
    const p = c.writeCoil(0, true).then(
      () => (settled = true),
      () => (settled = true),
    );
    void p;
    await sleep(100);
    c.destroy(() => undefined);
    await sleep(2000); // > 800 ms hạn giao dịch
    expect(settled).toBe(false);
  }, 10_000);
});

/**
 * STOP KẾ TIẾP không xếp sau lần ghi treo — cả hai chế độ OT_CMD_SERIALIZE_ENABLED (đặt trong tiến trình).
 * Kịch bản: STOP1 — FC5 #1 im lặng, peer CẮT liên kết 150 ms sau khi nhận nó; vòng canh legacy hạ phiên (≤ 500 ms). STOP2 được phát ngay
 * khi FC5 #1 tới peer (lúc STOP1 đang bay); FC5 sau đó được trả lời bình thường.
 *   • tắt: không có hàng ⇒ STOP2 chạy song song trên cùng phiên, tới peer, acked (coil 1) — đúng cả trước bản vá.
 *   • bật: STOP2 xếp sau STOP1 (priorityStop + holdSlot như dispatcher). Trước bản vá: STOP1 treo 5000 ms rồi giữ chỗ thêm ân hạn 1 s ⇒
 *     STOP2 trả lời sau > 6 s. Sau: STOP1 trả lời 'timeout' lúc liên kết mất ⇒ chỗ nhả ⇒ STOP2 chạy NGAY (liên kết đã mất ⇒ không gửi gì,
 *     'failed' DeviceUnreachable — đúng: không thử lại, không chờ nối lại).
 * Bất biến cả hai: STOP2 trả lời < 1500 ms sau khi phát; STOP1 'timeout' (không rõ) — không bao giờ 'failed'/ack; không ack giả.
 */
describe("R1b-2b-1 — STOP kế tiếp KHÔNG xếp sau lần ghi treo (OT_CMD_SERIALIZE_ENABLED tắt / bật)", () => {
  const cu = process.env.OT_CMD_SERIALIZE_ENABLED;
  afterEach(() => {
    if (cu === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
    else process.env.OT_CMD_SERIALIZE_ENABLED = cu;
  });

  for (const bat of [false, true]) {
    it(`OT_CMD_SERIALIZE_ENABLED=${bat ? "true" : "false"}: STOP2 phát lúc STOP1 đang bay ⇒ STOP2 trả lời < 1500 ms; STOP1 'timeout' không rõ; không ack giả`, async () => {
      process.env.OT_CMD_SERIALIZE_ENABLED = bat ? "true" : "false";
      const adapterId = bat ? 990_011 : 990_010;
      const sim = await startSim();
      const driver = await moDriver(sim);
      const log: string[] = [];
      cleanup.push(vongCanhLegacy(driver, () => null, log, Date.now()));
      await sleep(100);
      sim.kichBan = ["im_lang"];
      sim.onFc5 = (n) => {
        if (n === 1) setTimeout(() => sim.catKetNoi(), 150);
      };

      const guiStop = (): Promise<ExecutedWrite> => {
        if (!bat) return chayStopKhongCho(driver, adapterId);
        const enq = tryEnqueueAdapterCommand(adapterId, () => chayStopKhongCho(driver, adapterId), {
          priorityStop: true,
          stopRef: { idempotencyKey: `q-${Math.random()}`, commandType: "stop" },
          holdSlot: (v) => ("slotHold" in v ? v.slotHold : undefined),
        });
        expect(enq.accepted).toBe(true);
        return (enq as { result: Promise<unknown> }).result as Promise<ExecutedWrite>;
      };

      const t1 = performance.now();
      const p1 = guiStop().then((ex) => ({ ex, ms: Math.round(performance.now() - t1) }));
      await choToi(() => sim.nhanFc5 === 1, 2000, "FC5 #1 tới peer");
      const t2 = performance.now();
      const p2 = guiStop().then((ex) => ({ ex, ms: Math.round(performance.now() - t2) }));
      // Hạn tường minh 9 s: trước bản vá STOP2 (bật) trả lời sau > 6 s — đo được, không treo test.
      const r2 = await Promise.race([p2, sleep(9000).then(() => null)]);
      const r1 = await Promise.race([p1, sleep(9000).then(() => null)]);
      // eslint-disable-next-line no-console
      console.log(`[stop-ke-tiep serialize=${bat}]`, JSON.stringify({ r1, r2, nhanFc5: sim.nhanFc5, coil: sim.coil.v, log }));

      expect(r2).not.toBeNull();
      expect(r2!.ms).toBeLessThan(1500);
      expect(r1).not.toBeNull();
      laKhongRoKetCuc(r1!.ex);
      expect(r1!.ms).toBeLessThan(1000);
      khongAckGia(r1!.ex, sim.coil.v);
      khongAckGia(r2!.ex, sim.coil.v);
      if (!bat) {
        // không có hàng: STOP2 tới peer trên cùng phiên và được trả lời
        expect(sim.nhanFc5).toBe(2);
        expect(r2!.ex.outcomes[0].status).toBe("acked");
        expect(sim.coil.v).toBe(1);
      } else {
        // có hàng: STOP2 chạy sau khi STOP1 trả lời (liên kết đã mất) ⇒ không gửi gì, nói thật 'failed' (không thử lại)
        expect(sim.nhanFc5).toBe(1);
        expect(r2!.ex.outcomes[0].status).toBe("failed");
        expect(r2!.ex.outcomes[0].ok).toBe(false);
      }
    }, 25_000);
  }
});

/**
 * R1b-2b-1 T17 fix round 1 (I1 của review) — lệnh bị huỷ vì mất liên kết lúc đang bay có kết cục KHÔNG RÕ: byte đã vào socket vẫn có thể tới PLC
 * SAU (khi ta tự hạ một socket còn sống). Với OT_CMD_SERIALIZE_ENABLED bật, nó phải được ghi vào rủi ro "lệnh ghi cũ" (B3) như một lệnh quá hạn —
 * KHÔNG giữ chỗ, KHÔNG đặt lại phiên — để STOP acked kế tiếp có canh chỉ-báo-động (startStopWatch, R-4-q).
 */
describe("R1b-2b-1 T17 fix round 1 (I1) — rủi ro lệnh ghi cũ sau huỷ vì mất liên kết", () => {
  const cu = process.env.OT_CMD_SERIALIZE_ENABLED;
  afterEach(() => {
    if (cu === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
    else process.env.OT_CMD_SERIALIZE_ENABLED = cu;
  });

  it("serialize BẬT: STOP1 bị huỷ (peer đóng lúc FC5) ⇒ mục rủi ro mang intent của STOP1, không giữ chỗ; STOP2 acked trên phiên mới ⇒ có canh STOP (1) và báo động liên kết tới intent STOP1", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    const adapterId = 990_021;
    const sim = await startSim();
    const driver = await moDriver(sim);
    await sleep(100);
    sim.kichBan = ["dong_khong_tra_loi"];
    const su: Array<{ action: string; detail: Record<string, unknown> }> = [];
    const sink: OtDeviceEventSink = (ev) => su.push({ action: ev.action, detail: ev.detail });
    const r1 = await chayStopKhongCho(driver, adapterId, 5000, { intentIds: [71, 72], sink });
    laKhongRoKetCuc(r1);
    expect(r1.slotHold).toBeUndefined(); // không giữ chỗ, không đặt lại phiên
    expect(_staleWriteRiskIntentIdsForTests(adapterId)).toEqual([71, 72]);

    await driver.connect(cfg(sim.port) as any); // phiên mới (như vòng canh nối lại)
    const r2 = await chayStopKhongCho(driver, adapterId, 5000, { intentIds: [81], sink });
    expect(r2.outcomes[0].status).toBe("acked");
    expect(sim.coil.v).toBe(1);
    expect(_stopWatchCountForTests(adapterId)).toBe(1); // canh chỉ-báo-động đã chạy cho STOP2
    // canh không thấy driver hoạt động (không có otManager trong test) ⇒ MỘT báo động, liên kết tới lệnh BỊ BỎ (intent của STOP1)
    await choToi(() => su.some((e) => e.action === "ot_stop_unverified"), 3000, "báo động canh STOP");
    const bd = su.find((e) => e.action === "ot_stop_unverified")!;
    expect(JSON.stringify(bd.detail)).toMatch(/71/);
    await choToi(() => _stopWatchCountForTests(adapterId) === 0, 3000, "canh STOP kết thúc");
  }, 15_000);

  it("serialize TẮT: không ghi rủi ro (B3 chỉ áp khi tuần tự hoá bật — hành vi như trước)", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "false";
    const adapterId = 990_022;
    const sim = await startSim();
    const driver = await moDriver(sim);
    await sleep(100);
    sim.kichBan = ["dong_khong_tra_loi"];
    const r1 = await chayStopKhongCho(driver, adapterId, 5000, { intentIds: [91] });
    laKhongRoKetCuc(r1);
    expect(_staleWriteRiskIntentIdsForTests(adapterId)).toBeNull();
  }, 15_000);
});

/**
 * R1b-2b-1 T17 fix round 2 (re-review New-1) — hạn của LỆNH (deadline ngắn) hết TRƯỚC ⇒ đường giữ chỗ B3; TRONG ân hạn 1 s phiên bị hạ (vòng canh /
 * resetSession HA / connect() của supervisor) ⇒ driver reject lệnh treo bằng lỗi có kiểu. Lần reject đó KHÔNG được coi là "đã xong": kết cục không rõ ⇒ ghi
 * rủi ro "lệnh ghi cũ" (gộp), không đặt lại phiên; STOP acked kế tiếp có canh chỉ-báo-động. Trước T17 với Modbus: promise mồ côi ⇒ hết ân hạn ⇒ có ghi rủi ro.
 */
describe("R1b-2b-1 T17 fix round 2 (New-1) — huỷ vì mất liên kết TRONG ân hạn B3 vẫn ghi rủi ro lệnh ghi cũ", () => {
  const cu = process.env.OT_CMD_SERIALIZE_ENABLED;
  afterEach(() => {
    if (cu === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
    else process.env.OT_CMD_SERIALIZE_ENABLED = cu;
  });

  it("serialize BẬT: lệnh hạn 200 ms, driver treo (peer im lặng, hạn driver 5 s) ⇒ timeout + slotHold; disconnect() trong ân hạn ⇒ intent ghi vào rủi ro; STOP2 acked ⇒ canh = 1", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    const adapterId = 990_031;
    const sim = await startSim();
    const driver = new ModbusDriver();
    cleanup.push(() => sim.close(), () => driver.disconnect());
    const cfgCham = { endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs: 5000, options: { unitId: 1, timeoutMs: 5000 } };
    await driver.connect(cfgCham as any);
    await sleep(100);
    sim.kichBan = ["im_lang"];
    const su: Array<{ action: string; detail: Record<string, unknown> }> = [];
    const sink: OtDeviceEventSink = (ev) => su.push({ action: ev.action, detail: ev.detail });

    const r1 = await chayStopKhongCho(driver, adapterId, 200, { intentIds: [61, 62], sink });
    expect(r1.timedOut).toBe(true);
    expect(r1.outcomes[0].status).toBe("timeout");
    expect(r1.outcomes[0].errorText).toMatch(/write timeout after 200ms/); // hạn của LỆNH, không phải mất liên kết
    expect(r1.slotHold).toBeDefined(); // đường giữ chỗ B3
    expect(_staleWriteRiskIntentIdsForTests(adapterId)).toBeNull(); // chưa hết ân hạn, chưa có gì
    await driver.disconnect(); // hạ phiên TRONG ân hạn 1 s ⇒ lệnh treo bị reject bằng lỗi có kiểu
    const t0 = performance.now();
    await r1.slotHold;
    expect(performance.now() - t0).toBeLessThan(500); // nhả chỗ ngay, không chờ hết ân hạn / không đặt lại phiên
    expect(_staleWriteRiskIntentIdsForTests(adapterId)).toEqual([61, 62]);

    sim.kichBan = [];
    await driver.connect(cfgCham as any);
    const r2 = await chayStopKhongCho(driver, adapterId, 5000, { intentIds: [63], sink });
    expect(r2.outcomes[0].status).toBe("acked");
    expect(sim.coil.v).toBe(1);
    expect(_stopWatchCountForTests(adapterId)).toBe(1);
    await choToi(() => _stopWatchCountForTests(adapterId) === 0, 3000, "canh STOP kết thúc");
    expect(JSON.stringify(su.find((e) => e.action === "ot_stop_unverified")?.detail ?? {})).toMatch(/61/);
  }, 20_000);
});
