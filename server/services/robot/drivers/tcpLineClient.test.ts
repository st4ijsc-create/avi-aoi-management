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
import { TcpLineClient, TcpLineTimeoutError, TcpLineClosedError, TcpLineResetError, TcpLineNotConnectedError } from "./tcpLineClient";

interface FakeLineServer {
  port: number;
  /** Mỗi phần tử = các dòng đã nhận trên MỘT kết nối, theo thứ tự. */
  perConnection: string[][];
  /** Fix round 4 — a line in this set makes the server DESTROY the socket instead of replying (peer kills the handshake). */
  killOn: Set<string>;
  /** Destroy every open socket (robot drops while idle) but keep listening. */
  dropAll(): void;
  close(): Promise<void>;
}

async function startSequentialLineServer(delays: Record<string, number>): Promise<FakeLineServer> {
  const perConnection: string[][] = [];
  const socks = new Set<net.Socket>();
  const killOn = new Set<string>();
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
        if (line === "DIE" || killOn.has(line)) {
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
    killOn,
    dropAll: () => {
      for (const s of socks) s.destroy();
    },
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
  server.killOn.clear();
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

describe("TcpLineClient — peer đóng ⇒ client 'cũ' (nối lại được), không chết (fix round 2)", () => {
  // Fix round 3 — sau peer drop: isConnected() = false; lệnh thường bị TỪ CHỐI (0 byte, không nối lại).
  // Fix round 4 (R13) — lệnh ĐẶC QUYỀN (`allowAfterPeerDrop`: lệnh dừng VÀ poll chỉ đọc) được nối lại (chạy
  // onReconnect); lệnh thường chỉ đi được khi MỘT lệnh đặc quyền đã HOÀN TẤT (bắt tay + reply) trên kết nối mới.
  it("sau khi peer đóng giữa lệnh: không còn 'connected', lệnh thường bị từ chối; chỉ STOP (allowAfterPeerDrop) nối lại", async () => {
    const c = await openClient({
      onReconnect: async (client) => {
        await client.send("HELLO\r", 1000);
      },
    });
    await within(c.send("DIE\r", 2000), 3000).catch(() => undefined);
    expect(c.isConnected()).toBe(false);
    const refused = await within(c.send("MOVE\r", 1000), 3000).then(
      () => null,
      (e) => e,
    );
    expect(refused).toBeInstanceOf(TcpLineNotConnectedError);
    expect(server.perConnection.length).toBe(1); // không nối lại cho lệnh thường
    const b = await within(c.send("STOP\r", 1000, { allowAfterPeerDrop: true }), 3000);
    expect(b).toBe("STOP-REPLY");
    expect(server.perConnection.length).toBe(2);
    expect(server.perConnection[1]).toEqual(["HELLO", "STOP"]);
    expect(c.isConnected()).toBe(true);
  });

  it("fix round 4 (R13) — poll chỉ đọc (allowAfterPeerDrop) cũng nối lại được sau khi robot rớt lúc RẢNH; lệnh thường trước đó bị từ chối", async () => {
    const c = await openClient({
      onReconnect: async (client) => {
        await client.send("HELLO\r", 1000);
      },
    });
    expect(await within(c.send("X\r", 1000), 2000)).toBe("X-REPLY");
    server.dropAll(); // robot rớt khi rảnh (không lệnh nào đang chờ)
    await sleep(50);
    expect(c.isConnected()).toBe(false);
    const refused = await within(c.send("MOVE\r", 1000), 3000).then(
      () => null,
      (e) => e,
    );
    expect(refused).toBeInstanceOf(TcpLineNotConnectedError);
    expect(server.perConnection.length).toBe(1);
    const st = await within(c.send("STATE\r", 1000, { allowAfterPeerDrop: true }), 3000);
    expect(st).toBe("STATE-REPLY");
    expect(server.perConnection[1]).toEqual(["HELLO", "STATE"]);
    expect(c.isConnected()).toBe(true);
    // Vận chuyển đã lên lại ⇒ lệnh thường đi được ở TẦNG NÀY (chuyển động bị từ chối ở tầng driver: khoá chuyển động).
    expect(await within(c.send("Y\r", 1000), 2000)).toBe("Y-REPLY");
    expect(server.perConnection[1]).toEqual(["HELLO", "STATE", "Y"]);
  });

  it("fix round 4 (N2) — trong lúc STOP đang bắt tay (OPEN= chậm), lệnh thường đồng thời bị TỪ CHỐI, không chen lên kết nối mới trước STOP; STOP thứ hai xếp SAU", async () => {
    // Bắt tay = "SLOW" (server trả sau 300 ms) ⇒ cửa sổ bắt tay đủ rộng để chen một lệnh thường vào.
    const c = await openClient({
      onReconnect: async (client) => {
        const r = await client.send("SLOW\r", 2000);
        if (r !== "SLOW-REPLY") throw new Error("handshake failed");
      },
    });
    await within(c.send("DIE\r", 2000), 3000).catch(() => undefined);
    const stop = c.send("STOP\r", 2000, { allowAfterPeerDrop: true });
    await sleep(100); // đang trong bắt tay SLOW (300 ms)
    const refused = await within(c.send("MOVE\r", 1000), 3000).then(
      () => null,
      (e) => e,
    );
    expect(refused).toBeInstanceOf(TcpLineNotConnectedError);
    const stop2 = c.send("STOP\r", 2000, { allowAfterPeerDrop: true }); // đặc quyền: đợi bắt tay, đi SAU STOP 1
    expect(await within(stop, 3000)).toBe("STOP-REPLY");
    expect(await within(stop2, 3000)).toBe("STOP-REPLY");
    expect(server.perConnection.length).toBe(2);
    expect(server.perConnection[1]).toEqual(["SLOW", "STOP", "STOP"]);
    // Sau khi STOP hoàn tất: lệnh thường đi được (tầng vận chuyển); khoá chuyển động là tầng driver.
    expect(await within(c.send("MOVE\r", 1000), 2000)).toBe("MOVE-REPLY");
    expect(server.perConnection[1]).toEqual(["SLOW", "STOP", "STOP", "MOVE"]);
  });

  it("fix round 4 (N2) — lệnh thường tới SAU khi bắt tay xong nhưng TRƯỚC khi STOP có reply vẫn bị từ chối", async () => {
    // Bắt tay nhanh (HELLO), "STOP" chậm (dùng dòng SLOW: server trả sau 300 ms) ⇒ cửa sổ [bắt tay xong, STOP xong).
    const c = await openClient({
      onReconnect: async (client) => {
        await client.send("HELLO\r", 1000);
      },
    });
    await within(c.send("DIE\r", 2000), 3000).catch(() => undefined);
    const stop = c.send("SLOW\r", 2000, { allowAfterPeerDrop: true });
    await sleep(120); // HELLO đã xong (tức thì), SLOW còn chờ
    expect(server.perConnection[1]).toEqual(["HELLO", "SLOW"]);
    const refused = await within(c.send("MOVE\r", 1000), 3000).then(
      () => null,
      (e) => e,
    );
    expect(refused).toBeInstanceOf(TcpLineNotConnectedError);
    expect(await within(stop, 3000)).toBe("SLOW-REPLY");
    expect(server.perConnection[1]).toEqual(["HELLO", "SLOW"]); // MOVE chưa bao giờ chạm dây
  });

  it("fix round 4 (N3) — nối lại của STOP THẤT BẠI (server tắt hẳn) ⇒ reject (đã thật sự thử), isConnected() false, không kết nối mới", async () => {
    const lone = await startSequentialLineServer({});
    const c = new TcpLineClient("lone");
    clients.push(c);
    await c.open("127.0.0.1", lone.port, 500);
    await lone.close();
    await sleep(50);
    expect(c.isConnected()).toBe(false);
    const err = await within(c.send("STOP\r", 500, { allowAfterPeerDrop: true }), 3000).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TcpLineNotConnectedError); // không phải từ chối trước: đã thử nối (ECONNREFUSED)
    expect(c.isConnected()).toBe(false);
    expect(lone.perConnection.length).toBe(1);
  });

  it("fix round 4 (N3) — bắt tay của STOP bị peer giết ⇒ reject + không 'connected'; poll KẾ TIẾP thử lại và nối được khi server lành", async () => {
    const c = await openClient({
      onReconnect: async (client) => {
        const r = await client.send("HELLO\r", 1000);
        if (r !== "HELLO-REPLY") throw new Error("handshake failed");
      },
    });
    await within(c.send("DIE\r", 2000), 3000).catch(() => undefined);
    server.killOn.add("HELLO"); // server nhận HELLO rồi đóng socket ⇒ bắt tay thất bại
    const err = await within(c.send("STOP\r", 1000, { allowAfterPeerDrop: true }), 3000).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(c.isConnected()).toBe(false);
    expect(server.perConnection[1]).toEqual(["HELLO"]);
    // Lệnh thường vẫn bị từ chối, không tạo kết nối.
    const refused = await within(c.send("MOVE\r", 1000), 3000).then(
      () => null,
      (e) => e,
    );
    expect(refused).toBeInstanceOf(TcpLineNotConnectedError);
    expect(server.perConnection.length).toBe(2);
    // Server lành lại ⇒ poll đặc quyền THỬ LẠI (không chết sau một lần nối lại hỏng): bắt tay + reply ⇒ connected.
    server.killOn.clear();
    expect(await within(c.send("STATE\r", 1000, { allowAfterPeerDrop: true }), 3000)).toBe("STATE-REPLY");
    expect(server.perConnection[2]).toEqual(["HELLO", "STATE"]);
    expect(c.isConnected()).toBe(true);
  });

  it("fix round 4 — onLinkLoss được gọi khi peer đóng (kể cả lúc rảnh) với mã line_connection_closed; không gọi khi close() chủ động", async () => {
    const losses: string[] = [];
    const c = await openClient({
      onLinkLoss: (code) => {
        losses.push(code);
      },
    });
    expect(await within(c.send("X\r", 1000), 2000)).toBe("X-REPLY");
    server.dropAll();
    await sleep(50);
    expect(losses).toEqual(["line_connection_closed"]);
    c.close();
    await sleep(20);
    expect(losses).toEqual(["line_connection_closed"]);
  });
});

describe("TcpLineClient — reset kết nối dưới lệnh đang bay mang reasonCode (fix round 3)", () => {
  it("lệnh khác hết hạn giờ khi lệnh A còn chờ ⇒ A bị huỷ với TcpLineResetError, reasonCode line_connection_reset", async () => {
    const c = await openClient();
    const a = c.send("SLOW\r", 5000).then(
      () => null,
      (e) => e,
    );
    const b = c.send("SLOW\r", 50).catch((e) => e); // poll song song, hạn ngắn ⇒ reset kết nối
    expect(await within(b, 3000)).toBeInstanceOf(TcpLineTimeoutError);
    const errA = await within(a, 3000);
    expect(errA).toBeInstanceOf(TcpLineResetError);
    expect((errA as TcpLineResetError).reasonCode).toBe("line_connection_reset");
  });
});
