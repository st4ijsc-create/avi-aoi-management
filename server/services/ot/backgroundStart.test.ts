/**
 * doc 81 Đợt 1B Task 2 — boot không chờ OT (BE1 §0 (3)).
 *
 * Không khởi động server thật của app (không chạm :3000): chứng minh bằng
 *   (a) hàm tách ra `startBackgroundOt`: trả về trước khi startFn kịp chạy, không bao giờ
 *       reject, startFn treo vĩnh viễn không giữ người gọi;
 *   (b) HÀNH VI của `listenThenStartOt` (đuôi boot tách khỏi index.ts) với server http THẬT
 *       trên 127.0.0.1 cổng 0 và startFn không bao giờ xong: socket NHẬN kết nối trong lúc OT
 *       còn treo, và lúc OT bắt đầu thì server đã listen;
 *   (c) cấu trúc CHÍNH `server/_core/index.ts`, neo TRONG thân `startServer` (Fix round 1: bản
 *       trước neo vào `server.listen(port` của server dò cổng tạm ở isPortAvailable ⇒ xanh cả
 *       trên base chưa vá): startServer gọi `listenThenStartOt(` đúng một lần, không await, không
 *       còn `server.listen(` trực tiếp và không còn `await startOt()`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { startBackgroundOt, listenThenStartOt } from "./backgroundStart";

const never = <T>() => new Promise<T>(() => undefined);

async function settleWithin<T>(p: Promise<T>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<false>((r) => {
    timer = setTimeout(() => r(false), ms);
  });
  try {
    return await Promise.race([p.then(() => true, () => true), guard]);
  } finally {
    clearTimeout(timer);
  }
}

describe("startBackgroundOt (doc 81 Đợt 1B Task 2)", () => {
  it("trả về NGAY: phần boot sau lời gọi (listen) chạy trước khi OT bắt đầu", async () => {
    const events: string[] = [];
    const p = startBackgroundOt(() => {
      events.push("ot-start");
      return never<void>(); // OT treo vĩnh viễn (adapter chết)
    }, () => undefined);
    events.push("boot-continues"); // ví dụ: server.listen đã gọi, request bắt đầu được phục vụ
    expect(events).toEqual(["boot-continues"]);
    await new Promise((r) => setImmediate(r));
    expect(events).toEqual(["boot-continues", "ot-start"]);
    // promise của OT vẫn treo — nhưng không ai phải chờ nó.
    expect(await settleWithin(p, 100)).toBe(false);
  });

  it("startFn reject ⇒ chỉ log, promise trả về RESOLVE (không unhandled rejection)", async () => {
    const logged: unknown[][] = [];
    const p = startBackgroundOt(
      async () => {
        throw new Error("boom");
      },
      (m, d) => logged.push([m, d]),
    );
    await expect(p).resolves.toBeUndefined();
    expect(logged).toEqual([["[OT] init failed:", "boom"]]);
  });

  it("startFn ném ĐỒNG BỘ ⇒ cũng chỉ log", async () => {
    const logged: unknown[][] = [];
    const p = startBackgroundOt(
      () => {
        throw new Error("sync boom");
      },
      (m, d) => logged.push([m, d]),
    );
    await expect(p).resolves.toBeUndefined();
    expect(logged).toEqual([["[OT] init failed:", "sync boom"]]);
  });

  it("logger hỏng cũng không biến thành rejection", async () => {
    const p = startBackgroundOt(
      () => Promise.reject(new Error("x")),
      () => {
        throw new Error("logger down");
      },
    );
    await expect(p).resolves.toBeUndefined();
  });
});

describe("listenThenStartOt — hành vi với server http THẬT (cổng 0)", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    while (servers.length) {
      const srv = servers.pop()!;
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it("OT treo vĩnh viễn ⇒ socket VẪN nhận kết nối + trả HTTP; lúc OT bắt đầu server đã listen", async () => {
    const srv = http.createServer((_req, res) => res.end("ok"));
    servers.push(srv);
    let listeningWhenOtStarted: boolean | null = null;
    let onListeningCalled = false;
    const otDone = listenThenStartOt(
      srv,
      0,
      () => {
        onListeningCalled = true;
      },
      () => {
        listeningWhenOtStarted = srv.listening;
        return never<void>(); // OT không bao giờ xong (adapter chết)
      },
      () => undefined,
    );
    await new Promise<void>((r) => (srv.listening ? r() : srv.once("listening", () => r())));
    const port = (srv.address() as net.AddressInfo).port;

    // Kết nối TCP + một request HTTP thật trong khi OT còn treo.
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", agent: false }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve(b));
      });
      req.on("error", reject);
      req.setTimeout(2000, () => req.destroy(new Error("request timeout")));
    });
    expect(body).toBe("ok");
    expect(onListeningCalled, "callback listening của boot phải chạy").toBe(true);
    expect(listeningWhenOtStarted, "OT phải bắt đầu SAU khi server đã listen").toBe(true);
    expect(await settleWithin(otDone, 50), "OT vẫn đang treo — boot không chờ nó").toBe(false);
  });

  it("OT lỗi ⇒ chỉ log, server vẫn listen", async () => {
    const srv = http.createServer((_req, res) => res.end("ok"));
    servers.push(srv);
    const logged: unknown[] = [];
    await listenThenStartOt(
      srv,
      0,
      () => undefined,
      async () => {
        throw new Error("ot down");
      },
      (_m, d) => logged.push(d),
    );
    expect(logged).toEqual(["ot down"]);
    expect(srv.listening).toBe(true);
  });
});

describe("server/_core/index.ts — startServer listen rồi mới khởi động OT, không await", () => {
  const src = readFileSync(path.resolve(__dirname, "../../_core/index.ts"), "utf8");
  // Neo TRONG thân startServer (tới `startServer().catch` ngoài hàm) — KHÔNG dùng
  // `server.listen(port` đầu tệp: đó là server dò cổng tạm của isPortAvailable.
  const bodyStart = src.indexOf("async function startServer(");
  const bodyEnd = src.indexOf("startServer().catch");
  const body = src.slice(bodyStart, bodyEnd);

  it("tìm được thân startServer", () => {
    expect(bodyStart).toBeGreaterThan(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
  });

  it("startServer không còn tự `server.listen(` (listen đi qua listenThenStartOt)", () => {
    expect(body).not.toMatch(/\bserver\.listen\(/);
  });

  it("startServer gọi `listenThenStartOt(server, port, …)` đúng MỘT lần, không await, không `await startOt()` nào TRƯỚC nó", () => {
    const calls = [...body.matchAll(/(await|void)?\s*listenThenStartOt\(\s*server\s*,\s*port\s*,/g)];
    expect(calls, "phải có đúng một lời gọi listenThenStartOt(server, port, …)").toHaveLength(1);
    expect(calls[0][1], "lời gọi không được await").toBe("void");
    expect(body.slice(0, calls[0].index!)).not.toMatch(/await\s+startOt\s*\(/);
  });
});
