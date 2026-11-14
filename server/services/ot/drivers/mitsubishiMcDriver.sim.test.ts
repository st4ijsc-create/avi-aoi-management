/**
 * doc 81 Đợt 1B Task 1 — Mitsubishi MC (`mcprotocol` 0.1.2 THẬT, không mock) không bao giờ
 * làm sập tiến trình và không treo.
 *
 * BE1 §0 (2): `dropConnection()` không nhận callback ⇒ `disconnect()` treo; và
 * `connectionCleanup()` gỡ MỌI listener `error` khỏi socket còn sống (mcprotocol.js:1211-1219)
 * ⇒ lỗi socket đến SAU đó (ETIMEDOUT ~21 s khi SYN không ai trả lời; ECONNRESET khi PLC
 * reset) thành `uncaughtException` ⇒ handler ở server/_core/index.ts gọi `process.exit(1)`.
 *
 * Kịch bản (mọi server giả chạy trong tiến trình, 127.0.0.1, cổng 0):
 *   S1 server nhận kết nối, im lặng, và RESET (RST) socket ngay sau khi nhận FIN của ta.
 *   S2 server nhận kết nối rồi IM LẶNG HẲN (allowHalfOpen — không bao giờ trả lời, không đóng).
 *   S3 đích IM LẶNG: lỗ đen giả trong tiến trình tại 127.0.0.1:9 (`datLoDen`): SYN không ai trả lời, và nếu socket
 *      chưa bị hạ thì ~21 s sau nhận ETIMEDOUT như hệ điều hành báo (đo trên máy này 21 055 ms). Trước đây S3 dùng
 *      TEST-NET-1 192.0.2.1 thật (gửi SYN ra gateway); test chỉ kết nối tới loopback (nguyên tắc C, chủ dự án duyệt 14/11).
 * Khẳng định: trong 30 s KHÔNG có `uncaughtException` nào (bắt bằng process.on trong test),
 * mọi connect/disconnect/readTags trả về trong hạn giờ tường minh.
 */
import { describe, it, expect, afterAll } from "vitest";
import net from "node:net";
import { MitsubishiMcDriver } from "./mitsubishiMcDriver";

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
    return { ...(out as { settled: boolean }), elapsed: Date.now() - t0 } as {
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

const servers: net.Server[] = [];
const held: net.Socket[] = [];
afterAll(async () => {
  held.splice(0).forEach((s) => s.destroy());
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

/**
 * Ghi lại MỌI socket `mcprotocol` tạo (lib gọi `net.connect` của module dựng sẵn `net` —
 * cùng đối tượng exports với `node:net` ở đây). Oracle độc lập: socket của hệ điều hành,
 * không phải trạng thái driver tự khai.
 */
function recordNetConnect(): { sockets: net.Socket[]; restore: () => void } {
  const mod = net as unknown as { connect: (...a: unknown[]) => net.Socket };
  const orig = mod.connect;
  const sockets: net.Socket[] = [];
  mod.connect = function (this: unknown, ...a: unknown[]) {
    const sock = orig.apply(this, a);
    sockets.push(sock);
    return sock;
  };
  return { sockets, restore: () => (mod.connect = orig) };
}

/**
 * Lỗ đen giả trong tiến trình: thay `net.Socket.prototype.connect` (khuôn của edgeGatewayBoot.dot10.test.ts). Lời connect tới
 * ĐÚNG (host, port) không bao giờ xong và không gửi gói nào (như SYN không ai trả lời); socket ở trạng thái `connecting`. Nếu
 * socket chưa bị destroy sau `etimedoutSauMs` thì nó nhận lỗi ETIMEDOUT như hệ điều hành báo (đo ~21 s). Đích khác: connect thật.
 * Đích nên là loopback cổng đóng: nếu lỗ đen hỏng, connect thật bị từ chối ngay trên máy, không rời máy.
 */
function datLoDen(host: string, port: number, etimedoutSauMs = 21_000): { bat: net.Socket[]; goLai: () => void } {
  const goc = net.Socket.prototype.connect;
  const bat: net.Socket[] = [];
  const hen: NodeJS.Timeout[] = [];
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    // net.connect() gọi socket.connect(mảng đã chuẩn hoá [options, cb]); gọi thẳng thì (options, cb) hoặc (port, host, cb).
    const a0 = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const dich = typeof a0 === "object" && a0 !== null ? (a0 as { host?: string; port?: number | string }) : { port: a0 as number, host: args[1] as string | undefined };
    if (dich.host === host && Number(dich.port) === port) {
      bat.push(this);
      (this as unknown as { connecting: boolean }).connecting = true;
      const t = setTimeout(() => {
        if (!this.destroyed) this.destroy(Object.assign(new Error(`connect ETIMEDOUT ${host}:${port}`), { code: "ETIMEDOUT" }));
      }, etimedoutSauMs);
      t.unref();
      hen.push(t);
      return this;
    }
    return (goc as (...x: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
  return {
    bat,
    goLai: () => {
      net.Socket.prototype.connect = goc;
      hen.splice(0).forEach(clearTimeout);
    },
  };
}

async function listen(srv: net.Server): Promise<number> {
  servers.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return (srv.address() as net.AddressInfo).port;
}

describe("MitsubishiMcDriver × mcprotocol THẬT (doc 81 Đợt 1B Task 1)", () => {
  it("30 s: server im lặng / RST sau FIN / IP không định tuyến ⇒ 0 uncaughtException, mọi lời gọi có hạn giờ", async () => {
    const uncaught: string[] = [];
    const onUncaught = (e: unknown) => {
      uncaught.push(`${(e as NodeJS.ErrnoException)?.code ?? ""} ${(e as Error)?.message ?? String(e)}`);
    };
    process.on("uncaughtException", onUncaught);
    const rec = recordNetConnect();
    const lo = datLoDen("127.0.0.1", 9);
    const t0 = Date.now();
    try {
      // ── S1: im lặng, RST ngay sau khi nhận FIN của client ──
      const p1 = await listen(
        net.createServer({ allowHalfOpen: true }, (sock) => {
          held.push(sock);
          sock.on("error", () => undefined);
          sock.on("end", () => setTimeout(() => sock.resetAndDestroy(), 150));
        }),
      );
      // ── S2: im lặng hẳn, không bao giờ đóng ──
      const p2 = await listen(
        net.createServer({ allowHalfOpen: true }, (sock) => {
          held.push(sock);
          sock.on("error", () => undefined);
        }),
      );

      const d3 = new MitsubishiMcDriver();
      // S3 chạy song song (không await) để ETIMEDOUT ~21 s rơi vào cửa sổ 30 s.
      const c3 = settleWithin(d3.connect({ endpoint: "tcp://127.0.0.1:9", timeoutMs: 1000 }), 2000);

      const d1 = new MitsubishiMcDriver();
      const c1 = await settleWithin(d1.connect({ endpoint: `tcp://127.0.0.1:${p1}`, timeoutMs: 1000 }), 2000);
      const d2 = new MitsubishiMcDriver();
      const c2 = await settleWithin(d2.connect({ endpoint: `tcp://127.0.0.1:${p2}`, timeoutMs: 1000 }), 2000);

      const r3 = await c3;
      expect.soft(r3.settled, `S3 connect đích im lặng treo > 2000 ms`).toBe(true);
      expect.soft(r3.ok).toBe(false);
      const dc3 = await settleWithin(d3.disconnect(), 3000);
      expect.soft(dc3.settled, "S3 disconnect sau connect lỗi phải trả về").toBe(true);

      // S1/S2: kết nối TCP phải được (server có nhận) — nếu driver đã từ chối MC 1E
      // (nhánh dự phòng "dùng SLMP 3E") thì cả hai phải lỗi RÕ, không mở socket.
      const refused = c1.ok === false && /SLMP/i.test(String((c1.error as Error)?.message ?? c1.error));
      expect.soft(lo.bat, "S3 phải rơi vào lỗ đen (nếu không: cổng 9 từ chối ngay, S3 mất nghĩa)").toHaveLength(refused ? 0 : 1);
      if (!refused) {
        expect.soft(c1.settled && c1.ok, `S1 connect phải thành công (${String(c1.error)})`).toBe(true);
        expect.soft(c2.settled && c2.ok, `S2 connect phải thành công (${String(c2.error)})`).toBe(true);

        // S2: đọc khi server im lặng ⇒ trả về có hạn (bad hoặc lỗi), không treo.
        const rd = await settleWithin(d2.readTags([{ tagKey: "d", address: "D100", dataType: "int" }]), 8000);
        expect.soft(rd.settled, `S2 readTags treo > 8000 ms`).toBe(true);
        if (rd.ok) expect.soft((rd.value as Array<{ quality: string }>)[0].quality).not.toBe("good");

        const dc1 = await settleWithin(d1.disconnect(), 3000);
        expect.soft(dc1.settled, `S1 disconnect treo > 3000 ms`).toBe(true);
        const sock2: net.Socket | undefined = (d2 as any).conn?.isoclient;
        const dc2 = await settleWithin(d2.disconnect(), 3000);
        expect.soft(dc2.settled, `S2 disconnect treo > 3000 ms (peer không bao giờ đóng)`).toBe(true);
        expect.soft(sock2?.destroyed, "S2 socket nền phải bị destroy()").toBe(true);
      } else {
        expect.soft(c2.ok).toBe(false);
      }

      // Mọi socket lib đã tạo (S1, S2, S3) phải bị hạ sau khi connect lỗi / disconnect —
      // kể cả socket S3 đang dở SYN (nếu không destroy, hệ điều hành báo ETIMEDOUT ~21 s sau).
      expect.soft(rec.sockets.length, "số socket lib tạo").toBe(refused ? 0 : 3);
      expect.soft(
        rec.sockets.map((x) => x.destroyed),
        "mọi socket lib tạo phải destroyed",
      ).toEqual(rec.sockets.map(() => true));

      // Giữ cửa sổ quan sát tới 30 s kể từ đầu (ETIMEDOUT của S3 ~21 s, RST của S1 ngay).
      const remain = 30_000 - (Date.now() - t0);
      if (remain > 0) await sleep(remain);
      expect.soft(uncaught, `uncaughtException trong 30 s: ${uncaught.join(" | ")}`).toEqual([]);
    } finally {
      lo.goLai();
      rec.restore();
      process.off("uncaughtException", onUncaught);
    }
  }, 45_000);

  it("lib tự nối lại: socket cũ bị destroy; SAU disconnect lib không mở lại socket tới PLC", async () => {
    const accepted: net.Socket[] = [];
    const port = await listen(
      net.createServer({ allowHalfOpen: true }, (sock) => {
        accepted.push(sock);
        held.push(sock);
        sock.on("error", () => undefined);
      }),
    );
    const d = new MitsubishiMcDriver();
    const c = await settleWithin(d.connect({ endpoint: `tcp://127.0.0.1:${port}`, timeoutMs: 1000 }), 2000);
    expect(c.ok, String(c.error)).toBe(true);
    const conn: any = (d as any).conn;
    const first: net.Socket = conn.isoclient;

    // Mô phỏng đúng đường lib tự nối lại (readWriteError ⇒ isoConnectionState=0 ⇒
    // sendReadPacket lên lịch connectNow): socket cũ bị lib bỏ lại phải bị destroy.
    conn.isoConnectionState = 0;
    conn.connectNow(conn.connectionParams);
    const second: net.Socket = conn.isoclient;
    expect(second).not.toBe(first);
    expect(first.destroyed, "socket cũ lib bỏ lại phải bị destroy").toBe(true);
    await sleep(200);
    expect(accepted.length).toBe(2);

    const dc = await settleWithin(d.disconnect(), 3000);
    expect(dc.settled).toBe(true);
    expect(second.destroyed).toBe(true);

    // Timer connectNow/readAllItems lib đã lên lịch TRƯỚC khi ta ngắt chạy SAU khi ngắt:
    // không được mở socket mới tới PLC.
    conn.connectNow(conn.connectionParams);
    conn.readAllItems(() => undefined);
    await sleep(300);
    expect(accepted.length, "sau disconnect lib không được nối lại").toBe(2);
  });
});
