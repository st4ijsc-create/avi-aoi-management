/**
 * doc 81 Đợt 1B Task 5 — TcpLineClient không lệch nhịp sau một lần hết hạn giờ (BE2 §L3b T4, §3 S7).
 *
 * Lỗi đo được (mã cũ): client ghép reply theo FIFO. Lệnh A hết hạn giờ ⇒ waiter của A bị gỡ, nhưng
 * reply MUỘN của A vẫn tới trên CÙNG socket ⇒ nó được giao cho lệnh B đang chờ (`B:MOVE` nhận reply của
 * `A:STOP`), và từ đó mọi reply lệch một nhịp vĩnh viễn.
 *
 * Server giả ở đây viết theo hành vi một bộ điều khiển thật: xử lý TUẦN TỰ từng dòng trên một kết nối
 * (dòng sau chỉ được trả lời sau khi dòng trước xong). `SLOW` mất 300 ms, mọi dòng khác trả ngay. Reply là
 * CHUỖI VIẾT SẴN `<lệnh>-REPLY` — không lấy từ mã sản phẩm. Server chạy trong tiến trình trên 127.0.0.1
 * cổng 0 và đóng trong afterAll.
 *
 * Treo được đo bằng hạn giờ tường minh (`within`), không dựa vào timeout của vitest.
 */
import net from "node:net";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { TcpLineClient, TcpLineTimeoutError, TcpLineClosedError } from "./tcpLineClient";

interface FakeLineServer {
  port: number;
  /** Mỗi phần tử = các dòng đã nhận trên MỘT kết nối, theo thứ tự. */
  perConnection: string[][];
  close(): Promise<void>;
}

async function startSequentialLineServer(delays: Record<string, number>): Promise<FakeLineServer> {
  const perConnection: string[][] = [];
  const socks = new Set<net.Socket>();
  const srv = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
    const lines: string[] = [];
    perConnection.push(lines);
    let buf = "";
    let chain = Promise.resolve();
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.search(/\r\n|\r|\n/)) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + (buf.startsWith("\r\n", i) ? 2 : 1));
        if (!line) continue;
        lines.push(line);
        if (line === "DIE") {
          sock.destroy(); // peer đóng kết nối khi lệnh đang chờ trả lời
          return;
        }
        // TUẦN TỰ: dòng sau đợi dòng trước trả lời xong (như bộ điều khiển thật).
        chain = chain.then(
          () =>
            new Promise<void>((res) => {
              setTimeout(() => {
                if (!sock.destroyed) sock.write(`${line}-REPLY\r\n`);
                res();
              }, delays[line] ?? 0);
            }),
        );
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  return {
    port,
    perConnection,
    close: async () => {
      for (const s of socks) s.destroy();
      await new Promise<void>((r) => srv.close(() => r()));
    },
  };
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: FakeLineServer;
const clients: TcpLineClient[] = [];

beforeAll(async () => {
  server = await startSequentialLineServer({ SLOW: 300 });
});
afterAll(async () => {
  await server.close();
});
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
  server.perConnection.length = 0;
});

async function openClient(opts?: ConstructorParameters<typeof TcpLineClient>[1]): Promise<TcpLineClient> {
  const c = new TcpLineClient("test-line", opts);
  clients.push(c);
  await c.open("127.0.0.1", server.port, 1000);
  return c;
}

describe("TcpLineClient — reply muộn không bị gán cho lệnh kế tiếp (T4)", () => {
  it("A hết hạn giờ, B gửi ngay sau ⇒ B nhận ĐÚNG reply của B, không nhận reply A", async () => {
    const c = await openClient();
    const a = c.send("SLOW\r", 100);
    await expect(within(a, 2000)).rejects.toBeInstanceOf(TcpLineTimeoutError);
    // B gửi NGAY — trước khi reply muộn của A (300 ms) tới.
    const b = await within(c.send("B\r", 1000), 2000);
    expect(b).toBe("B-REPLY");
    expect(b).not.toBe("SLOW-REPLY");
    // Đợi quá thời điểm reply A tới trên kết nối cũ ⇒ không được rò sang lệnh sau.
    await sleep(350);
    const cmd3 = await within(c.send("C\r", 1000), 2000);
    expect(cmd3).toBe("C-REPLY");
    // Cách đã chọn: huỷ kết nối và nối lại ⇒ B đi trên kết nối MỚI.
    expect(server.perConnection.length).toBe(2);
    expect(server.perConnection[0]).toEqual(["SLOW"]);
    expect(server.perConnection[1]).toEqual(["B", "C"]);
  });

  it("lỗi hết hạn giờ mang reasonCode ổn định line_reply_timeout", async () => {
    const c = await openClient();
    const err = await within(c.send("SLOW\r", 50), 2000).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(TcpLineTimeoutError);
    expect((err as TcpLineTimeoutError).reasonCode).toBe("line_reply_timeout");
  });

  it("vẫn báo isConnected() sau khi hết hạn giờ (kết nối lại lười, không đánh rơi robot)", async () => {
    const c = await openClient();
    await within(c.send("SLOW\r", 50), 2000).catch(() => undefined);
    expect(c.isConnected()).toBe(true);
  });

  it("onReconnect (bắt tay phiên) chạy TRƯỚC lệnh đang chờ trên kết nối mới", async () => {
    const c = await openClient({
      onReconnect: async (client) => {
        const r = await client.send("HELLO\r", 1000);
        if (r !== "HELLO-REPLY") throw new Error("handshake failed");
      },
    });
    await within(c.send("SLOW\r", 50), 2000).catch(() => undefined);
    const b = await within(c.send("B\r", 1000), 2000);
    expect(b).toBe("B-REPLY");
    expect(server.perConnection[1]).toEqual(["HELLO", "B"]);
  });

  it("đường hợp lệ không đổi: không có timeout ⇒ một kết nối, reply đúng thứ tự", async () => {
    const c = await openClient();
    expect(await within(c.send("X\r", 1000), 2000)).toBe("X-REPLY");
    expect(await within(c.send("Y\r", 1000), 2000)).toBe("Y-REPLY");
    expect(server.perConnection.length).toBe(1);
  });

  it("resetConnection(): lệnh đang bay bị huỷ ngay, reply của nó không rò sang lệnh sau", async () => {
    const c = await openClient();
    const a = c.send("SLOW\r", 5000);
    await sleep(20);
    c.resetConnection("preempt");
    await expect(within(a, 1000)).rejects.toThrow(/preempt/);
    const b = await within(c.send("B\r", 1000), 2000);
    expect(b).toBe("B-REPLY");
    expect(server.perConnection.length).toBe(2);
  });
});

describe("TcpLineClient — đóng kết nối khi lệnh đang chờ mang reasonCode (fix round 1)", () => {
  it("peer đóng socket khi lệnh đang chờ ⇒ reject TcpLineClosedError, reasonCode line_connection_closed", async () => {
    const c = await openClient();
    const err = await within(c.send("DIE\r", 2000), 3000).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(TcpLineClosedError);
    expect((err as TcpLineClosedError).reasonCode).toBe("line_connection_closed");
  });
});

