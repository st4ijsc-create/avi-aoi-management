/**
 * doc 81 Đợt 1E Task 1 — DỪNG OT ghim chen hàng đợi lệnh per-adapter (ruling R-1E-a).
 *
 * THUẦN: chỉ hàng đợi `tryEnqueueAdapterCommand` (không DB, không driver). Mỗi job là một lời hứa do TEST giữ
 * (deferred) + một nhật ký gọi: oracle = thứ tự job THẬT SỰ được chạy, do test ghi, không lấy từ mã sản phẩm.
 *
 *   (a) đầy + lệnh thường ⇒ BUSY như cũ.
 *   (b) đầy + DỪNG ghim ⇒ nhận; lệnh đang CHỜ trước nó bị huỷ (Superseded, không bao giờ chạy); DỪNG chạy ngay
 *       sau lệnh đang bay.
 *   (c) hàng rỗng + DỪNG ⇒ chạy ngay.
 *   (d) hai DỪNG liên tiếp ⇒ không huỷ nhau, chạy theo thứ tự tới.
 *   (e) lệnh đang bay NÉM ⇒ DỪNG vẫn chạy; hàng cạn ⇒ entry bị xoá khỏi map.
 *   (f) lệnh thường tới SAU DỪNG ⇒ xếp sau DỪNG (FIFO), không bị huỷ.
 * Treo đo bằng `within(...)` tường minh.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tryEnqueueAdapterCommand,
  _resetAdapterCommandQueuesForTests,
  _adapterCommandQueueCountForTests,
  _adapterCommandQueueDepthForTests,
} from "./commandDispatcher";

const ADAPTER = 4242;
const SUPERSEDED = { superseded: true, byStop: true };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Job giả có điều khiển: ghi tên vào `log` khi được CHẠY, kết thúc khi test resolve/reject. */
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

/** Cho mọi vi-tác vụ / then đang chờ chạy hết. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${what}: không trả về trong ${ms} ms (treo)`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(t);
  }
}

function accepted<T>(o: ReturnType<typeof tryEnqueueAdapterCommand<T>>) {
  if (!o.accepted) throw new Error(`expected accepted, got BUSY depth=${o.depth} max=${o.max}`);
  return o.result;
}

const saved = process.env.OT_CMD_QUEUE_MAX;
beforeEach(() => {
  _resetAdapterCommandQueuesForTests();
  process.env.OT_CMD_QUEUE_MAX = "2";
});
afterEach(() => {
  if (saved === undefined) delete process.env.OT_CMD_QUEUE_MAX;
  else process.env.OT_CMD_QUEUE_MAX = saved;
  _resetAdapterCommandQueuesForTests();
});

describe("Đợt 1E T1 — DỪNG ghim trong hàng đợi lệnh per-adapter (R-1E-a)", () => {
  it("(a) max=2: A đang bay, B chờ; lệnh THƯỜNG C ⇒ BUSY (accepted:false, depth 2, max 2), như cũ; A rồi B chạy", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B")));
    await flush();
    const c = tryEnqueueAdapterCommand(ADAPTER, job("C"));
    expect(c).toEqual({ accepted: false, depth: 2, max: 2 });
    // tường minh: không có cờ ⇒ y như priorityStop:false
    expect(tryEnqueueAdapterCommand(ADAPTER, job("C2"), { priorityStop: false }).accepted).toBe(false);
    expect(log).toEqual(["A"]);
    ctl.get("A")!.resolve("a");
    await expect(within(rA, 2000, "A")).resolves.toBe("a");
    await flush();
    expect(log).toEqual(["A", "B"]);
    ctl.get("B")!.resolve("b");
    await expect(within(rB, 2000, "B")).resolves.toBe("b");
    expect(log).toEqual(["A", "B"]); // C, C2 không bao giờ chạy
  });

  it("(b) max=2: A đang bay, B chờ; DỪNG ghim S ⇒ nhận; B trả Superseded NGAY và không bao giờ chạy; A xong ⇒ S chạy; nhật ký ĐÚNG [A, S]", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B")));
    await flush();
    const s = tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true });
    expect(s.accepted).toBe(true);
    const rS = accepted(s);
    // B bị huỷ TRƯỚC khi A xong — người gọi của B nhận kết quả, không treo, không ném.
    await expect(within(rB, 2000, "B bị huỷ")).resolves.toEqual(SUPERSEDED);
    await flush();
    expect(log).toEqual(["A"]); // lệnh đang bay KHÔNG bị ngắt; S chưa chạy
    ctl.get("A")!.resolve("a");
    await expect(within(rA, 2000, "A")).resolves.toBe("a");
    await flush();
    expect(log).toEqual(["A", "S"]);
    ctl.get("S")!.resolve("s");
    await expect(within(rS, 2000, "S")).resolves.toBe("s");
    await flush();
    expect(log).toEqual(["A", "S"]); // B KHÔNG BAO GIỜ chạy
    expect(ctl.has("B")).toBe(true);
  });

  it("(b2) Superseded mang danh tính của DỪNG đã huỷ nó (stopRef của S), không phải của lệnh bị huỷ", async () => {
    const { ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rB = accepted(tryEnqueueAdapterCommand(ADAPTER, job("B"), { priorityStop: false, stopRef: { k: "B-tu-khai" } }));
    const rS = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true, stopRef: { k: "S" } }));
    await expect(within(rB, 2000, "B bị huỷ")).resolves.toEqual({ ...SUPERSEDED, stop: { k: "S" } });
    ctl.get("A")!.resolve("a");
    await within(rA, 2000, "A");
    await flush();
    ctl.get("S")!.resolve("s");
    await expect(within(rS, 2000, "S")).resolves.toBe("s");
  });

  it("(c) hàng RỖNG + DỪNG ghim ⇒ chạy NGAY (không chờ gì)", async () => {
    const { log, ctl, job } = makeJobs();
    const rS = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true }));
    await flush();
    expect(log).toEqual(["S"]);
    ctl.get("S")!.resolve("s");
    await expect(within(rS, 2000, "S")).resolves.toBe("s");
    await flush();
    expect(_adapterCommandQueueCountForTests()).toBe(0);
  });

  it("(d) A đang bay, S1 rồi S2 (cùng ghim) ⇒ không cái nào huỷ cái nào; nhật ký [A, S1, S2]", async () => {
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rS1 = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S1"), { priorityStop: true }));
    const rS2 = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S2"), { priorityStop: true }));
    await flush();
    expect(log).toEqual(["A"]);
    ctl.get("A")!.resolve("a");
    await expect(within(rA, 2000, "A")).resolves.toBe("a");
    await flush();
    expect(log).toEqual(["A", "S1"]);
    ctl.get("S1")!.resolve("s1");
    await expect(within(rS1, 2000, "S1")).resolves.toBe("s1"); // KHÔNG Superseded
    await flush();
    expect(log).toEqual(["A", "S1", "S2"]);
    ctl.get("S2")!.resolve("s2");
    await expect(within(rS2, 2000, "S2")).resolves.toBe("s2");
  });

  it("(e) A NÉM ⇒ người gọi A thấy lỗi; S vẫn chạy; S xong ⇒ entry adapter bị XOÁ khỏi map, độ sâu mới từ 0", async () => {
    process.env.OT_CMD_QUEUE_MAX = "1";
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rS = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true }));
    await flush();
    expect(_adapterCommandQueueDepthForTests(ADAPTER)).toBe(2);
    ctl.get("A")!.reject(new Error("driver fault"));
    await expect(within(rA, 2000, "A")).rejects.toThrow("driver fault");
    await flush();
    expect(log).toEqual(["A", "S"]);
    ctl.get("S")!.resolve("s");
    await expect(within(rS, 2000, "S")).resolves.toBe("s");
    await flush();
    expect(_adapterCommandQueueCountForTests()).toBe(0);
    expect(_adapterCommandQueueDepthForTests(ADAPTER)).toBe(0);
    // độ sâu mới: max=1 vẫn nhận một lệnh thường
    const rN = tryEnqueueAdapterCommand(ADAPTER, job("N"));
    expect(rN.accepted).toBe(true);
    ctl.get("N")!.resolve("n");
    await expect(within(accepted(rN), 2000, "N")).resolves.toBe("n");
  });

  it("(f) A đang bay, S chờ, rồi lệnh THƯỜNG D ⇒ D xếp SAU S (FIFO), không bị huỷ; nhật ký [A, S, D]", async () => {
    process.env.OT_CMD_QUEUE_MAX = "3";
    const { log, ctl, job } = makeJobs();
    const rA = accepted(tryEnqueueAdapterCommand(ADAPTER, job("A")));
    const rS = accepted(tryEnqueueAdapterCommand(ADAPTER, job("S"), { priorityStop: true }));
    const rD = accepted(tryEnqueueAdapterCommand(ADAPTER, job("D")));
    await flush();
    ctl.get("A")!.resolve("a");
    await expect(within(rA, 2000, "A")).resolves.toBe("a");
    await flush();
    expect(log).toEqual(["A", "S"]);
    ctl.get("S")!.resolve("s");
    await expect(within(rS, 2000, "S")).resolves.toBe("s");
    await flush();
    expect(log).toEqual(["A", "S", "D"]);
    ctl.get("D")!.resolve("d");
    await expect(within(rD, 2000, "D")).resolves.toBe("d"); // KHÔNG Superseded
  });
});
