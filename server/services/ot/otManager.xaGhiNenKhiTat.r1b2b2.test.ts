/**
 * SCADA R1b-2b-2a Task 1 fix round 1 (điều phối, điều kiện 4) — tắt tiến trình xả hàng chờ ghi nền của đường STOP qua ĐÚNG đường tắt mà R1b-2b-1 T8
 * dùng cho `stopOt` (`server/_core/index.ts` gracefulShutdown → `stopOt({ tatTienTrinh: true })`; `server.close` chờ cùng promise trước khi thoát).
 *   · `stopOt({ tatTienTrinh: true })` ⇒ `xaHangChoKhiTat()` được gọi ĐÚNG một lần và `stopOt` CHỜ nó (≤ 2 s là việc của module hàng chờ);
 *   · `stopOt()` trần (khởi động lại khung OT / gateway tắt) ⇒ KHÔNG xả (tiến trình còn sống, hàng chờ tự xả).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ goi: 0, giai: null as null | (() => void) }));
vi.mock("./ghiTreoCoTran", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ghiTreoCoTran")>();
  return {
    ...real,
    xaHangChoKhiTat: () => {
      H.goi += 1;
      return new Promise<void>((r) => (H.giai = r));
    },
  };
});

import { stopOt } from "./otManager";

afterEach(() => {
  H.goi = 0;
  H.giai = null;
});

describe("R1b-2b-2a T1 fix round 1 — stopOt({ tatTienTrinh }) xả hàng chờ ghi nền đường STOP", () => {
  it("tatTienTrinh ⇒ gọi xaHangChoKhiTat MỘT lần và CHỜ nó xong", { timeout: 30_000 }, async () => {
    let xong = false;
    const p = stopOt({ tatTienTrinh: true }).then(() => (xong = true));
    // fix round 3 (kiem-dinh: đỏ một lần trên worktree lạnh) — `import("./ghiTreoCoTran")` động trong stopOt có thể mất > 1 s lúc biến đổi lạnh:
    // chờ theo SỰ KIỆN (lượt gọi tới) với hạn rộng, không theo đồng hồ; "stopOt chờ" chứng minh bằng việc nó CHƯA xong khi lượt xả chưa giải
    await vi.waitFor(() => expect(H.goi).toBe(1), { timeout: 20_000, interval: 10 });
    for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
    expect(xong, "stopOt chờ lượt xả").toBe(false);
    H.giai?.();
    await p;
    expect(xong).toBe(true);
    expect(H.goi).toBe(1);
  });

  it("stopOt() trần ⇒ KHÔNG xả", async () => {
    await stopOt();
    expect(H.goi).toBe(0);
  });
});
