/**
 * doc 81 Đợt 1B Task 2 — boot không chờ OT (BE1 §0 (3)).
 *
 * Không khởi động server thật (không chạm :3000): chứng minh bằng
 *   (a) hàm tách ra `startBackgroundOt`: trả về trước khi startFn kịp chạy, không bao giờ
 *       reject, startFn treo vĩnh viễn không giữ người gọi;
 *   (b) thứ tự trong CHÍNH `server/_core/index.ts` (đọc mã nguồn): `server.listen(` đứng TRƯỚC
 *       lời gọi `startBackgroundOt(`, lời gọi không bị await, và không còn `await startOt()`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { startBackgroundOt } from "./backgroundStart";

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

describe("server/_core/index.ts — OT khởi động SAU listen, không await", () => {
  const src = readFileSync(path.resolve(__dirname, "../../_core/index.ts"), "utf8");

  it("không còn `await startOt()` nào TRƯỚC server.listen (đường boot)", () => {
    const listenAt = src.indexOf("server.listen(port");
    expect(listenAt).toBeGreaterThan(0);
    expect(src.slice(0, listenAt)).not.toMatch(/await\s+startOt\s*\(/);
  });

  it("`server.listen(port` đứng TRƯỚC lời gọi startBackgroundOt và chuỗi gọi không bị await", () => {
    const listenAt = src.indexOf("server.listen(port");
    const loads = [...src.matchAll(/(await|void)?\s*import\("\.\.\/services\/ot\/backgroundStart"\)/g)];
    const calls = [...src.matchAll(/startBackgroundOt\(/g)];
    expect(listenAt, "không tìm thấy server.listen(port").toBeGreaterThan(0);
    expect(loads, "phải nạp backgroundStart đúng một chỗ").toHaveLength(1);
    expect(calls, "phải có đúng một lời gọi startBackgroundOt").toHaveLength(1);
    expect(loads[0].index!, "nạp/gọi OT phải nằm SAU server.listen").toBeGreaterThan(listenAt);
    expect(calls[0].index!).toBeGreaterThan(listenAt);
    expect(loads[0][1]?.trim(), "chuỗi khởi động OT không được await (void)").toBe("void");
    // nằm trong startServer — trước `startServer().catch` (ngoài hàm).
    expect(calls[0].index!).toBeLessThan(src.indexOf("startServer().catch"));
  });
});
