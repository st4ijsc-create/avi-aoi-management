/**
 * doc 81 Đợt 1B Task 1 — Techman driver (Modbus TCP qua `modbus-serial`) KHÔNG treo.
 *
 * BE1 §1.3: connect tới cổng đóng / thiết bị nhận rồi đóng ⇒ treo >12 s (cùng lỗi
 * `close(cb)` của modbus-serial, techmanDriver.ts:234,244). Ở đây chạy lib THẬT với server
 * TCP giả trong tiến trình (127.0.0.1, cổng 0):
 *   • server "nhận rồi đóng ngay" ⇒ connect phải trả lỗi trong timeoutMs + 1s;
 *   • server Modbus tối giản viết theo đặc tả MBAP/FC04 (Modbus Application Protocol
 *     v1.1b3 §6.4), allowHalfOpen=true — nhận FIN nhưng KHÔNG BAO GIỜ đóng ⇒ disconnect
 *     phải trả về trong hạn đóng (2 s) + biên VÀ socket nền bị destroy.
 * Không mock `modbus-serial`; oracle là byte cố định của server giả, không phải mã sản phẩm.
 */
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { TechmanDriver } from "./techmanDriver";

async function settleWithin<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ settled: boolean; ok?: boolean; error?: unknown; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<"__pending__">((r) => {
    timer = setTimeout(() => r("__pending__"), ms);
  });
  try {
    const out = await Promise.race([
      p.then(
        () => ({ settled: true, ok: true }),
        (error) => ({ settled: true, ok: false, error }),
      ),
      guard,
    ]);
    if (out === "__pending__") return { settled: false, elapsed: Date.now() - t0 };
    return { ...(out as { settled: boolean; ok: boolean; error?: unknown }), elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const servers: net.Server[] = [];
const sockets: net.Socket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.destroy());
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function listen(srv: net.Server): Promise<number> {
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return (srv.address() as net.AddressInfo).port;
}

/** Modbus TCP tối giản theo đặc tả: chỉ FC04 (Read Input Registers), trả toàn 0. */
function modbusFc04Responder(sock: net.Socket): void {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 12) {
      const tid = buf.readUInt16BE(0);
      const len = buf.readUInt16BE(4);
      if (buf.length < 6 + len) return;
      const unit = buf[6];
      const fc = buf[7];
      const qty = buf.readUInt16BE(10);
      buf = buf.subarray(6 + len);
      if (fc !== 0x04) continue;
      const out = Buffer.alloc(9 + qty * 2);
      out.writeUInt16BE(tid, 0);
      out.writeUInt16BE(0, 2);
      out.writeUInt16BE(3 + qty * 2, 4);
      out[6] = unit;
      out[7] = 0x04;
      out[8] = qty * 2;
      sock.write(out);
    }
  });
}

describe("TechmanDriver × TCP thật (doc 81 Đợt 1B Task 1)", () => {
  it("server nhận rồi ĐÓNG ngay ⇒ connect trả lỗi trong timeoutMs + 1s; disconnect trả về ngay", async () => {
    const port = await listen(
      net.createServer((sock) => {
        sock.on("error", () => undefined);
        sock.destroy();
      }),
    );
    const d = new TechmanDriver();
    const r = await settleWithin(d.connect({ endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 1000 }), 2000);
    expect(r.settled, `connect treo > 2000 ms (đo ${r.elapsed})`).toBe(true);
    expect(r.ok).toBe(false);
    expect(d.isConnected()).toBe(false);
    const r2 = await settleWithin(d.disconnect(), 2500);
    expect(r2.settled, "disconnect sau connect lỗi phải trả về").toBe(true);
  });

  it("cổng ĐÓNG ⇒ connect trả lỗi trong timeoutMs + 1s", async () => {
    const tmp = net.createServer();
    await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", () => r()));
    const port = (tmp.address() as net.AddressInfo).port;
    await new Promise<void>((r) => tmp.close(() => r()));
    const d = new TechmanDriver();
    const r = await settleWithin(d.connect({ endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 1000 }), 2000);
    expect(r.settled, `connect cổng đóng treo > 2000 ms`).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("robot trả lời Modbus nhưng KHÔNG đóng khi nhận FIN ⇒ disconnect ≤ 2s + biên, socket nền bị destroy", async () => {
    const port = await listen(
      net.createServer({ allowHalfOpen: true }, (sock) => {
        sockets.push(sock);
        sock.on("error", () => undefined);
        modbusFc04Responder(sock);
      }),
    );
    const d = new TechmanDriver();
    const rc = await settleWithin(d.connect({ endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 1000 }), 2500);
    expect(rc.settled && rc.ok, `connect tới server Modbus hợp lệ phải thành công (${String(rc.error)})`).toBe(true);
    expect(d.isConnected()).toBe(true);
    const sock: net.Socket = (d as any).mbClient?._port?._client;
    expect(sock).toBeTruthy();

    const r = await settleWithin(d.disconnect(), 3500);
    expect(r.settled, `disconnect treo > 3500 ms khi peer không đóng`).toBe(true);
    expect(sock.destroyed, "socket nền phải bị destroy()").toBe(true);
    expect(d.isConnected()).toBe(false);
  });
});
