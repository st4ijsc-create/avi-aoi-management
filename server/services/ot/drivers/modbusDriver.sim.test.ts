/**
 * doc 81 Đợt 1B Task 1 — Modbus TCP driver chạy với giả lập THẬT trong tiến trình
 * (`ServerTCP` của `modbus-serial`, 127.0.0.1, cổng do hệ điều hành cấp), không mock.
 *
 * Tái hiện P0 của BE1 §0 (1): `modbus-serial` chỉ gọi `close(cb)` khi socket phát
 * `close` VÀ `openFlag` còn true (tcpport.js:145-155, 203). Socket đã đứt/chưa từng mở
 * ⇒ callback không bao giờ chạy ⇒ driver treo ở nhánh catch của `connect()` và ở
 * `disconnect()`; supervisor kẹt ở `reconnecting`, `stop()` treo.
 *
 * Oracle ĐỘC LẬP với mã sản phẩm: kho thanh ghi của server giả (Map do test giữ), mã lỗi
 * hệ điều hành (ECONNREFUSED), địa chỉ TEST-NET-1 192.0.2.1 (RFC 5737 — dành cho tài
 * liệu, không bao giờ định tuyến tới thiết bị thật), và socket half-open do test tự dựng.
 * Mọi khẳng định "không treo" đo bằng `settleWithin` (hạn giờ tường minh), KHÔNG dựa vào
 * vitest timeout.
 */
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { ModbusDriver } from "./modbusDriver";
import { ConnectionSupervisor } from "../connectionSupervisor";
import type { OtSample } from "../otDriver";

import * as ModbusSerialNs from "modbus-serial";

const ServerTCP: any = (ModbusSerialNs as any).ServerTCP ?? (ModbusSerialNs as any).default?.ServerTCP;

/** Chờ p tối đa `ms`; trả về đã xong hay chưa + thời gian đo được (không ném). */
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

/** Server Modbus TCP giả theo đặc tả: kho thanh ghi là Map của TEST (oracle độc lập). */
interface SimServer {
  port: number;
  holding: Map<number, number>;
  writes: Array<{ addr: number; value: number }>;
  close(): Promise<void>;
}

async function startSim(port?: number, holding = new Map<number, number>()): Promise<SimServer> {
  const p = port ?? (await freePort());
  const writes: Array<{ addr: number; value: number }> = [];
  const vector = {
    getHoldingRegister: (addr: number) => holding.get(addr) ?? 0,
    getInputRegister: (addr: number) => 100 + addr,
    getCoil: (addr: number) => addr === 0,
    getDiscreteInput: () => false,
    setRegister: (addr: number, value: number) => {
      writes.push({ addr, value });
      holding.set(addr, value);
    },
    setCoil: () => undefined,
  };
  const srv = new ServerTCP(vector, { host: "127.0.0.1", port: p, unitID: 1 });
  await new Promise<void>((resolve, reject) => {
    srv.once("initialized", () => resolve());
    srv.once("serverError", reject);
  });
  return {
    port: p,
    holding,
    writes,
    close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!;
    try {
      await settleWithin(Promise.resolve().then(fn), 3000);
    } catch {
      /* ignore */
    }
  }
});

describe("ModbusDriver × ServerTCP thật (doc 81 Đợt 1B Task 1)", () => {
  it("đọc được int16 âm / input / coil từ server giả (đường hợp lệ vẫn chạy)", async () => {
    const sim = await startSim(undefined, new Map([[0, 0xfffb]])); // −5 ở dạng bù 2
    cleanups.push(() => sim.close());
    const d = new ModbusDriver();
    cleanups.push(() => d.disconnect());
    await d.connect({ endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs: 1000 });
    const s = await d.readTags([
      { tagKey: "h", address: "40001", dataType: "int" },
      { tagKey: "ir", address: "30003", dataType: "int" },
      { tagKey: "c", address: "coil:1", dataType: "bool" },
    ]);
    expect(s.map((x) => [x.tagKey, x.quality, x.value])).toEqual([
      ["h", "good", -5],
      ["ir", "good", 102],
      ["c", "good", true],
    ]);
    const r = await settleWithin(d.disconnect(), 3000);
    expect(r.settled, `disconnect sau phiên hợp lệ phải trả về (đo ${r.elapsed} ms)`).toBe(true);
  });

  it("cổng ĐÓNG ⇒ connect bị từ chối trong timeoutMs + 1s (không treo ở close(cb))", async () => {
    const port = await freePort(); // đã đóng ⇒ ECONNREFUSED
    const d = new ModbusDriver();
    const r = await settleWithin(d.connect({ endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 1000 }), 2000);
    expect(r.settled, `connect cổng đóng treo > 2000 ms`).toBe(true);
    expect(r.ok).toBe(false);
    expect(String((r.error as Error)?.message ?? r.error)).toMatch(/ECONNREFUSED/);
    expect(d.isConnected()).toBe(false);
  });

  it("IP KHÔNG định tuyến (TEST-NET-1 192.0.2.1) ⇒ connect lỗi trong timeoutMs + 1s", async () => {
    const d = new ModbusDriver();
    const r = await settleWithin(d.connect({ endpoint: "tcp://192.0.2.1:502", timeoutMs: 1000 }), 2000);
    expect(r.settled, `connect IP không định tuyến treo > 2000 ms`).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.elapsed).toBeGreaterThanOrEqual(900); // tôn trọng timeoutMs, không trả sớm giả
  });

  it("server half-open (nhận FIN nhưng không bao giờ đóng) ⇒ disconnect trả về ≤ 2s + biên VÀ socket bị destroy", async () => {
    const held: net.Socket[] = [];
    const srv = net.createServer({ allowHalfOpen: true }, (sock) => {
      held.push(sock);
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    cleanups.push(
      () =>
        new Promise<void>((r) => {
          held.forEach((s) => s.destroy());
          srv.close(() => r());
        }),
    );
    const port = (srv.address() as net.AddressInfo).port;
    const d = new ModbusDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 1000 });
    const sock: net.Socket = (d as any).client?._port?._client;
    expect(sock, "không lấy được socket nền để kiểm").toBeTruthy();

    const r = await settleWithin(d.disconnect(), 3500);
    expect(r.settled, `disconnect treo > 3500 ms khi peer không đóng`).toBe(true);
    expect(r.elapsed).toBeLessThan(3500);
    expect(sock.destroyed, "socket nền phải bị destroy() — không rò").toBe(true);
    expect(d.isConnected()).toBe(false);
  });

  it("ghi 70000 vào int16 và uint16 ⇒ ok:false kèm lý do, server KHÔNG nhận ghi; giá trị hợp lệ vẫn ghi đúng", async () => {
    const sim = await startSim();
    cleanups.push(() => sim.close());

    const signed = new ModbusDriver();
    cleanups.push(() => signed.disconnect());
    await signed.connect({ endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs: 1000 });
    const r1 = await signed.writeTags([
      { tagKey: "a", address: "40001", value: 70000, dataType: "int" },
      { tagKey: "b", address: "40002", value: 40000, dataType: "int" }, // > 32767 ⇒ ngoài int16
      { tagKey: "c", address: "40003", value: -5, dataType: "int" },
    ]);
    expect(r1[0].ok).toBe(false);
    expect(r1[0].error).toMatch(/70000/);
    expect(r1[0].error).toMatch(/-32768/);
    expect(r1[1].ok).toBe(false);
    expect(r1[2].ok).toBe(true);

    const unsigned = new ModbusDriver();
    cleanups.push(() => unsigned.disconnect());
    await unsigned.connect({
      endpoint: `tcp://127.0.0.1:${sim.port}`,
      timeoutMs: 1000,
      options: { signed: false },
    });
    const r2 = await unsigned.writeTags([
      { tagKey: "d", address: "40004", value: 70000, dataType: "int" },
      { tagKey: "e", address: "40005", value: -1, dataType: "int" },
      { tagKey: "f", address: "40006", value: 40000, dataType: "int" },
    ]);
    expect(r2[0].ok).toBe(false);
    expect(r2[0].error).toMatch(/65535/);
    expect(r2[1].ok).toBe(false);
    expect(r2[2].ok).toBe(true);

    // Oracle = kho server: chỉ 2 ghi hợp lệ tới nơi; −5 ⇒ 0xFFFB (bù 2, hằng số cố định).
    expect(sim.writes).toEqual([
      { addr: 2, value: 0xfffb },
      { addr: 5, value: 40000 },
    ]);
  });

  it("kill server ⇒ reconnecting, số lần thử TĂNG; bật lại ⇒ có mẫu mới ≤5s; stop() < 3s", async () => {
    const holding = new Map([[0, 7]]);
    let sim = await startSim(undefined, holding);
    const port = sim.port;
    cleanups.push(() => sim.close());

    const samples: Array<{ at: number; s: OtSample }> = [];
    const sup = new ConnectionSupervisor({
      adapterId: 1,
      code: "SIM-MB",
      protocol: "modbus",
      tags: [{ tagKey: "h", address: "40001", dataType: "int" }],
      pollIntervalMs: 200,
      healthIntervalMs: 100,
      endpoints: [{ label: "primary", connection: { endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 800 } }],
      createDriver: () => new ModbusDriver(),
      onSample: (s) => {
        samples.push({ at: Date.now(), s });
      },
      backoff: { initialMs: 100, maxMs: 400, factor: 2, jitter: 0 },
      linkLossFailThreshold: 1,
    });
    cleanups.push(() => sup.stop());

    await sup.start();
    expect(sup.status().state).toBe("connected");
    await sleep(600);
    expect(samples.length).toBeGreaterThan(0);

    // ── kill ──
    await sim.close();
    const tKill = Date.now();
    let sawReconnecting = false;
    while (Date.now() - tKill < 2000) {
      const st = sup.status().state;
      if (st === "reconnecting" || st === "failed") sawReconnecting = true;
      await sleep(50);
    }
    expect(sawReconnecting, "supervisor phải ra reconnecting/failed sau khi server chết").toBe(true);
    const attemptsA = sup.status().attempts;
    await sleep(1500);
    const attemptsB = sup.status().attempts;
    expect(attemptsB, `số lần thử phải TĂNG khi server chết (A=${attemptsA}, B=${attemptsB})`).toBeGreaterThan(
      attemptsA,
    );

    // ── bật lại cùng cổng ──
    holding.set(0, 42);
    sim = await startSim(port, holding);
    const tUp = Date.now();
    let fresh: OtSample | undefined;
    while (Date.now() - tUp < 5000 && !fresh) {
      fresh = samples.find((x) => x.at >= tUp && x.s.quality === "good" && x.s.value === 42)?.s;
      await sleep(50);
    }
    expect(fresh, "phải có mẫu mới (giá trị 42 do server bật lại cấp) trong 5 s").toBeTruthy();
    expect(sup.status().state).toBe("connected");
    expect(sup.status().reconnects).toBeGreaterThanOrEqual(1);

    const r = await settleWithin(sup.stop(), 3000);
    expect(r.settled, `sup.stop() treo > 3000 ms`).toBe(true);
    expect(sup.status().state).toBe("stopped");
  }, 30_000);
});
