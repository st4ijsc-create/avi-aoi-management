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
  queueTtlMsFor,
  isSuperseded,
  _resetAdapterCommandQueuesForTests,
  _adapterCommandQueueCountForTests,
  _adapterCommandQueueDepthForTests,
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

  it("fix round 1 — hạn của lệnh không bao giờ TẮT TTL (fail-closed): deadlineMs lẻ / ≤0 / NaN / thiếu ⇒ hạn hợp lệ > 0", () => {
    expect(queueTtlMsFor({})).toBe(60_000);
    expect(queueTtlMsFor({ deadlineMs: 2_000 })).toBe(2_000);
    expect(queueTtlMsFor({ deadlineMs: 0.5 })).toBe(60_000); // trước: trunc(0.5)=0, `0 ?? 60000` = 0 ⇒ hàng đợi coi là KHÔNG hạn
    expect(queueTtlMsFor({ deadlineMs: 0 })).toBe(60_000);
    expect(queueTtlMsFor({ deadlineMs: -5 })).toBe(60_000);
    expect(queueTtlMsFor({ deadlineMs: Number.NaN })).toBe(60_000);
    expect(queueTtlMsFor({ deadlineMs: Number.POSITIVE_INFINITY })).toBe(60_000);
    expect(queueTtlMsFor({ deadlineMs: 1.7 })).toBe(1);
  });

  it("R1a final I-2 — queueTtlMs (CHỈ hạn chờ) thắng deadlineMs; queueTtlMs không hợp lệ ⇒ quay về deadlineMs / mặc định (không bao giờ tắt TTL)", () => {
    expect(queueTtlMsFor({ queueTtlMs: 30_000 })).toBe(30_000);
    expect(queueTtlMsFor({ queueTtlMs: 30_000, deadlineMs: 2_000 })).toBe(30_000);
    expect(queueTtlMsFor({ queueTtlMs: 4_500.9 })).toBe(4_500);
    expect(queueTtlMsFor({ queueTtlMs: 0.5, deadlineMs: 2_000 })).toBe(2_000);
    expect(queueTtlMsFor({ queueTtlMs: 0 })).toBe(60_000);
    expect(queueTtlMsFor({ queueTtlMs: -1 })).toBe(60_000);
    expect(queueTtlMsFor({ queueTtlMs: Number.NaN })).toBe(60_000);
    expect(queueTtlMsFor({ queueTtlMs: Number.POSITIVE_INFINITY })).toBe(60_000);
  });

  it("fix round 1 (3a) — job ĐÃ quá hạn mà còn CHỜ khi DỪNG tới ⇒ kết thúc ĐÚNG MỘT lần, là Superseded (không bao giờ chạy, không QueueExpired); depth không âm", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: 60_000 }));
    let settledB = 0;
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B"), { queueTtlMs: 60_000 }));
    const outB: unknown[] = [];
    void rB.then((v) => {
      settledB++;
      outB.push(v);
    });
    await vi.advanceTimersByTimeAsync(61_000); // B quá hạn nhưng chưa tới lượt (hạn chỉ kiểm ở `run`)
    const rS = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true, stopRef: { idempotencyKey: "S" } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(settledB).toBe(1);
    expect(isSuperseded(outB[0])).toBe(true);
    expect(isQueueExpired(outB[0])).toBe(false);
    expect(_adapterCommandQueueDepthForTests(ADAPTER)).toBe(2); // A đang bay + S
    ctl.get("A")!.resolve("a");
    await rA;
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "S"]);
    ctl.get("S")!.resolve("s");
    await expect(rS).resolves.toBe("s");
    await vi.advanceTimersByTimeAsync(0);
    expect(settledB).toBe(1); // không lần thứ hai
    expect(_adapterCommandQueueDepthForTests(ADAPTER)).toBe(0);
    expect(_adapterCommandQueueCountForTests()).toBe(0);
  });

  it("fix round 1 (3b) — OT_CMD_QUEUE_MAX=2: lệnh thứ ba BUSY; lệnh quá hạn vẫn giữ chỗ tới lượt của nó; tới lượt ⇒ hết hạn, nhả chỗ; lệnh mới được nhận và chạy", async () => {
    process.env.OT_CMD_QUEUE_MAX = "2";
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: 60_000 }));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B"), { queueTtlMs: 60_000 }));
    expect(tryEnqueueAdapterCommand(ADAPTER, job("C"), { queueTtlMs: 60_000 })).toEqual({ accepted: false, depth: 2, max: 2 });
    await vi.advanceTimersByTimeAsync(61_000);
    // kiểm hạn lúc tới lượt, không timer ⇒ B quá hạn vẫn đếm trong depth khi A còn bay (giới hạn đã biết, ghi trong báo cáo)
    expect(tryEnqueueAdapterCommand(ADAPTER, job("C2"), { queueTtlMs: 60_000 }).accepted).toBe(false);
    ctl.get("A")!.resolve("a");
    await rA;
    expect(isQueueExpired(await rB)).toBe(true);
    expect(_adapterCommandQueueDepthForTests(ADAPTER)).toBe(0);
    const rD = accepted(tryEnqueueAdapterCommand(ADAPTER, job("D"), { queueTtlMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["A", "D"]); // B, C, C2 never ran
    ctl.get("D")!.resolve("d");
    await expect(rD).resolves.toBe("d");
    expect(_adapterCommandQueueCountForTests()).toBe(0);
  });

  it("lệnh đầu hàng (không phải chờ) chạy NGAY dù hạn rất ngắn: hạn chỉ đếm thời gian CHỜ trong hàng", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A"), { queueTtlMs: 1 }));
    expect(log).toEqual(["A"]);
    ctl.get("A")!.resolve("a");
    await expect(rA).resolves.toBe("a");
  });
});
