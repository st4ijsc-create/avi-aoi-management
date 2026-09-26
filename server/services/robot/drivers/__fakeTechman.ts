/**
 * doc 81 Đợt 1B Task 4 — thiết bị Techman GIẢ cho test (chỉ dùng trong vitest, không nạp ở runtime).
 *
 * Hai server TCP trong tiến trình, luôn trên 127.0.0.1 với cổng 0 (hệ điều hành cấp):
 *   • `startFakeTmModbus()`   — Modbus TCP tối giản theo đặc tả MBAP/FC04 (Modbus Application
 *     Protocol v1.1b3 §6.4), trả toàn 0 — đủ để `TechmanDriver.connect()` thăm dò thanh ghi.
 *   • `startFakeListenNode()` — "Listen Node" TMflow giả. Nó KHÔNG tính checksum và KHÔNG import
 *     mã sản phẩm: mỗi câu trả lời là CHUỖI GIAO THỨC VIẾT SẴN (literal) do test truyền vào, với
 *     checksum đã tính độc lập ngoài sản phẩm (xem task-4-report.md). Nó ghi lại MỌI byte nhận được
 *     để test khẳng định chính xác khung đã gửi (hoặc rằng KHÔNG có byte nào tới).
 *
 * Hành vi Listen Node:
 *   • `reply`  — đợi tới khi nhận đủ một dòng (`\r\n`) rồi ghi lần lượt các mảnh `chunks`
 *                (mỗi mảnh cách nhau một nhịp ngắn ⇒ kiểm được ghép khung khi TCP xé nhỏ);
 *   • `close`  — nhận lệnh rồi ĐÓNG kết nối, không trả lời;
 *   • `silent` — nhận lệnh rồi IM LẶNG, không đóng (driver phải tự hết hạn giờ).
 */
import net from "node:net";

export type FakeListenNodeBehaviour =
  | { kind: "reply"; chunks: string[] }
  | { kind: "close" }
  | { kind: "silent" };

export interface FakeListenNode {
  port: number;
  /** Chuỗi (latin1) nhận được, gộp theo từng kết nối. */
  received: string[];
  /** Số kết nối TCP server đã nhận. */
  connections: () => number;
  close(): Promise<void>;
}

export interface FakeTmModbus {
  port: number;
  close(): Promise<void>;
}

async function listenLocal(srv: net.Server): Promise<number> {
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
  return (srv.address() as net.AddressInfo).port;
}

function closer(srv: net.Server, socks: Set<net.Socket>): () => Promise<void> {
  return async () => {
    for (const s of socks) s.destroy();
    socks.clear();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  };
}

export async function startFakeListenNode(behaviour: FakeListenNodeBehaviour): Promise<FakeListenNode> {
  const received: string[] = [];
  const socks = new Set<net.Socket>();
  let conns = 0;
  const srv = net.createServer({ allowHalfOpen: true }, (sock) => {
    conns++;
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
    const idx = received.push("") - 1;
    let answered = false;
    sock.on("data", (d) => {
      received[idx] += d.toString("latin1");
      if (answered || !received[idx].includes("\r\n")) return;
      answered = true;
      if (behaviour.kind === "close") {
        sock.destroy();
        return;
      }
      if (behaviour.kind === "silent") return;
      const chunks = [...behaviour.chunks];
      const writeNext = () => {
        const c = chunks.shift();
        if (c === undefined || sock.destroyed) return;
        sock.write(Buffer.from(c, "latin1"));
        if (chunks.length > 0) setTimeout(writeNext, 15);
      };
      writeNext();
    });
  });
  const port = await listenLocal(srv);
  return { port, received, connections: () => conns, close: closer(srv, socks) };
}

export async function startFakeTmModbus(): Promise<FakeTmModbus> {
  const socks = new Set<net.Socket>();
  const srv = net.createServer((sock) => {
    socks.add(sock);
    sock.on("close", () => socks.delete(sock));
    sock.on("error", () => undefined);
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
  });
  const port = await listenLocal(srv);
  return { port, close: closer(srv, socks) };
}
