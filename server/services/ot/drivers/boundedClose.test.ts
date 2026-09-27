/**
 * doc 81 Đợt 1B Task 1 — boundedClose: đóng êm có hạn, quá hạn ⇒ destroy() rồi trả về.
 * Hạn giờ đo tường minh bằng Promise.race, không dựa vào vitest timeout.
 */
import { describe, it, expect, vi } from "vitest";
import {
  boundedClose,
  closeModbusClient,
  withDeadline,
  DEFAULT_CLOSE_TIMEOUT_MS,
} from "./boundedClose";

async function within<T>(p: Promise<T>, ms: number): Promise<{ settled: boolean; value?: T; elapsed: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<"__p">((r) => {
    timer = setTimeout(() => r("__p"), ms);
  });
  try {
    const v = await Promise.race([p, guard]);
    if (v === "__p") return { settled: false, elapsed: Date.now() - t0 };
    return { settled: true, value: v as T, elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

describe("boundedClose (doc 81 Đợt 1B Task 1)", () => {
  it("mặc định closeTimeoutMs = 2000", () => {
    expect(DEFAULT_CLOSE_TIMEOUT_MS).toBe(2000);
  });

  it("close không bao giờ gọi done ⇒ destroy() đúng một lần, trả 'destroyed' trong hạn", async () => {
    const destroy = vi.fn();
    const r = await within(boundedClose({ close: () => undefined, destroy, closeTimeoutMs: 150 }), 1000);
    expect(r.settled, `treo (${r.elapsed} ms)`).toBe(true);
    expect(r.value).toBe("destroyed");
    expect(r.elapsed).toBeGreaterThanOrEqual(140);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("close gọi done kịp ⇒ 'closed', KHÔNG destroy", async () => {
    const destroy = vi.fn();
    const r = await within(
      boundedClose({ close: (done) => setTimeout(done, 10), destroy, closeTimeoutMs: 500 }),
      1000,
    );
    expect(r.value).toBe("closed");
    await new Promise((res) => setTimeout(res, 600));
    expect(destroy).not.toHaveBeenCalled();
  });

  it("close ném ⇒ destroy ngay, không ném ra ngoài", async () => {
    const destroy = vi.fn();
    const r = await within(
      boundedClose({
        close: () => {
          throw new Error("boom");
        },
        destroy,
        closeTimeoutMs: 5000,
      }),
      500,
    );
    expect(r.value).toBe("destroyed");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("destroy ném ⇒ vẫn trả về", async () => {
    const r = await within(
      boundedClose({
        close: () => undefined,
        destroy: () => {
          throw new Error("x");
        },
        closeTimeoutMs: 50,
      }),
      1000,
    );
    expect(r.value).toBe("destroyed");
  });

  it("skipGraceful ⇒ destroy ngay, không gọi close", async () => {
    const close = vi.fn();
    const destroy = vi.fn();
    const r = await within(boundedClose({ close, destroy, skipGraceful: true }), 100);
    expect(r.value).toBe("destroyed");
    expect(close).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe("closeModbusClient", () => {
  it("client null ⇒ 'noop'", async () => {
    expect(await closeModbusClient(null)).toBe("noop");
  });

  it("isOpen === false (chưa từng mở / đã đứt) ⇒ destroy client + socket nền ngay, không đợi close(cb)", async () => {
    const sock = { destroyed: false, destroy: vi.fn(function (this: any) { this.destroyed = true; }) };
    const client = { isOpen: false, close: vi.fn(), destroy: vi.fn(), _port: { _client: sock } };
    const r = await within(closeModbusClient(client, 5000), 200);
    expect(r.value).toBe("destroyed");
    expect(client.close).not.toHaveBeenCalled();
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(sock.destroy).toHaveBeenCalledTimes(1);
  });

  it("isOpen === true và close(cb) không gọi cb ⇒ destroy sau closeTimeoutMs", async () => {
    const client = { isOpen: true, close: vi.fn(), destroy: vi.fn() };
    const r = await within(closeModbusClient(client, 100), 1000);
    expect(r.value).toBe("destroyed");
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("client giả (không có isOpen) gọi cb ngay ⇒ 'closed' như cũ", async () => {
    const client = { close: vi.fn((cb: () => void) => cb()) };
    expect(await closeModbusClient(client)).toBe("closed");
  });
});

describe("withDeadline", () => {
  it("hết hạn ⇒ Error `${label} timeout after ${ms}ms`", async () => {
    await expect(withDeadline(new Promise(() => undefined), 20, "x connect")).rejects.toThrow(
      "x connect timeout after 20ms",
    );
  });
  it("kịp ⇒ trả giá trị", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000, "x")).resolves.toBe(7);
  });
});
