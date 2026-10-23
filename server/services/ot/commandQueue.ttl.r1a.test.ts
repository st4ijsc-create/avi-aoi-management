/**
 * SCADA R1a Task 5 (K9) — HẠN HÀNG ĐỢI lệnh trung tâm: lệnh KHÔNG phải DỪNG chờ trong hàng đợi per-adapter lâu hơn hạn của nó
 * thì KHÔNG BAO GIỜ chạy (người gọi nhận `QueueExpired`; dispatcher ghi `rejected QUEUE_EXPIRED` cho dòng ý định đã có — xem
 * commandDispatcher.hanHangDoi.r1a.db.test.ts). DỪNG (ghim hay theo nội dung) và hành động interlock bảo vệ KHÔNG có hạn.
 *
 * THUẦN: chỉ `tryEnqueueAdapterCommand` (không DB, không driver), đồng hồ giả (vi.useFakeTimers giả cả Date.now). Oracle = nhật ký
 * job THẬT SỰ được chạy, do test ghi (không lấy từ mã sản phẩm). Hạn kiểm lúc lệnh TỚI LƯỢT (`run`), không có timer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  tryEnqueueAdapterCommand,
  isQueueExpired,
  HAN_HANG_DOI_MAC_DINH_MS,
  _resetAdapterCommandQueuesForTests,
  _adapterCommandQueueCountForTests,
} from "./commandDispatcher";

const ADAPTER = 4343;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeJobs() {
  const log: string[] = [];
  const ctl = new Map<string, ReturnType<typeof deferred<string>>>();
  const job = (name: string) => {
    const d = deferred<string>();
    ctl.set(name, d);
    return () => {
      log.push(name);
      return d.promise;
    };
  };
  return { log, ctl, job };
}

function accepted<T>(o: ReturnType<typeof tryEnqueueAdapterCommand<T>>) {
  if (!o.accepted) throw new Error(`expected accepted, got BUSY depth=${o.depth} max=${o.max}`);
  return o.result;
}

const saved = process.env.OT_CMD_QUEUE_MAX;
beforeEach(() => {
  vi.useFakeTimers();
  _resetAdapterCommandQueuesForTests();
  process.env.OT_CMD_QUEUE_MAX = "5";
});
afterEach(() => {
  vi.useRealTimers();
  if (saved === undefined) delete process.env.OT_CMD_QUEUE_MAX;
  else process.env.OT_CMD_QUEUE_MAX = saved;
  _resetAdapterCommandQueuesForTests();
});

describe("R1a T5 (K9) — hạn hàng đợi lệnh trung tâm", () => {
  it("hằng HAN_HANG_DOI_MAC_DINH_MS = 60 000 ms", () => {
    expect(HAN_HANG_DOI_MAC_DINH_MS).toBe(60_000);
  });

  it("★ A treo 61 s, B (hạn 60 s) chờ sau A ⇒ B QueueExpired, fn của B KHÔNG BAO GIỜ chạy; hàng dọn sạch", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: HAN_HANG_DOI_MAC_DINH_MS }));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B"), { queueTtlMs: HAN_HANG_DOI_MAC_DINH_MS }));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(log).toEqual(["A"]);
    ctl.get("A")!.resolve("a");
    await expect(rA).resolves.toBe("a");
    const b = await rB;
    expect(isQueueExpired(b)).toBe(true);
    expect(b).toMatchObject({ queueExpired: true, ttlMs: 60_000 });
    expect((b as { waitedMs: number }).waitedMs).toBeGreaterThanOrEqual(61_000);
    expect(log).toEqual(["A"]); // B không bao giờ tới driver
    expect(_adapterCommandQueueCountForTests()).toBe(0);
  });

  it("B chờ 59 s (< hạn 60 s) ⇒ B chạy bình thường", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: 60_000 }));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B"), { queueTtlMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(59_000);
    ctl.get("A")!.resolve("a");
    await rA;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "B"]);
    ctl.get("B")!.resolve("b");
    await expect(rB).resolves.toBe("b");
  });

  it("hạn lấy theo LỆNH (queueTtlMs = deadlineMs của người gọi): B hạn 2 s chờ 3 s ⇒ hết hạn; C hạn mặc định chờ cùng 3 s ⇒ chạy", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: 60_000 }));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B"), { queueTtlMs: 2_000 }));
    const rC = accepted(tryEnqueueAdapterCommand(ADAPTER, job("C"), { queueTtlMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(3_000);
    ctl.get("A")!.resolve("a");
    await rA;
    expect(isQueueExpired(await rB)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "C"]); // hết hạn của B không chặn lệnh sau nó
    ctl.get("C")!.resolve("c");
    await expect(rC).resolves.toBe("c");
  });

  it("★ DỪNG (priorityStop) chờ 120 s sau A treo ⇒ VẪN chạy (DỪNG không có hạn, kể cả khi người gọi lỡ đưa queueTtlMs)", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: 60_000 }));
    const rS = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true, queueTtlMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(120_000);
    ctl.get("A")!.resolve("a");
    await rA;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "S"]);
    ctl.get("S")!.resolve("s");
    await expect(rS).resolves.toBe("s");
  });

  it("DỪNG theo NỘI DUNG (contentStop) chờ 120 s ⇒ vẫn chạy", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rS = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true, stopRef: { contentStop: true }, queueTtlMs: 1 }));
    await vi.advanceTimersByTimeAsync(120_000);
    ctl.get("A")!.resolve("a");
    await rA;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "S"]);
    ctl.get("S")!.resolve("s");
    await expect(rS).resolves.toBe("s");
  });

  it("hành động interlock BẢO VỆ (protective) chờ 120 s ⇒ vẫn chạy (hướng an toàn — miễn hạn như DỪNG)", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rP = accepted(tryEnqueueAdapterCommand(ADAPTER, job("P"), { protective: true, queueTtlMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(120_000);
    ctl.get("A")!.resolve("a");
    await rA;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "P"]);
    ctl.get("P")!.resolve("p");
    await expect(rP).resolves.toBe("p");
  });

  it("không đưa queueTtlMs (đường edge, người gọi cũ) ⇒ không hạn: chờ 120 s vẫn chạy (như trước)", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B")));
    await vi.advanceTimersByTimeAsync(120_000);
    ctl.get("A")!.resolve("a");
    await rA;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "B"]);
    ctl.get("B")!.resolve("b");
    await expect(rB).resolves.toBe("b");
  });

  it("lệnh đầu hàng (không phải chờ) chạy NGAY dù hạn rất ngắn: hạn chỉ đếm thời gian CHỜ trong hàng", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: 1 }));
    expect(log).toEqual(["A"]);
    ctl.get("A")!.resolve("a");
    await expect(rA).resolves.toBe("a");
  });
});
