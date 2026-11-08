/**
 * Q0-2 — detectYieldDrop dùng yield CHUẨN (OK + NTF) / tổng, đọc cả `ntfCount` từ dailyStatistics.
 * kiem-dinh 2026-11-06 (lô C ❌): đột biến y3 (quay về chỉ OK / bỏ ntf) sống sót. Không chạm DB: getDb là bản giả
 * trả hai hàng gộp theo thứ tự (hôm nay, hôm qua).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ hangDoi: [] as unknown[][] }));
function chuoi(kq: unknown[]): any {
  const c: any = new Proxy(function () {}, {
    get(_t, p) {
      if (p === "then") return (res: (v: unknown) => void) => res(kq);
      return () => c;
    },
    apply() { return c; },
  });
  return c;
}
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return { ...actual, getDb: async () => ({ select: () => chuoi(h.hangDoi.shift() ?? []) }) };
});

import { detectYieldDrop } from "./aiSmartAlertRouter";

beforeEach(() => { h.hangDoi.length = 0; });

describe("detectYieldDrop — yield chuẩn có NTF", () => {
  it("y3 — hôm nay 70 OK + 20 NTF / 100 = 90; hôm qua 95/100 ⇒ sụt đúng 5 (chỉ-OK sẽ ra 70 và sụt 25 CRITICAL)", async () => {
    h.hangDoi.push([{ total: 100, ok: 70, ntf: 20 }], [{ total: 100, ok: 95, ntf: 0 }]);
    const ev = await detectYieldDrop(1, 5.0);
    expect(ev).not.toBeNull();
    expect(ev!.data).toMatchObject({ todayYield: 90, yesterdayYield: 95, drop: 5 });
    expect(ev!.severity).toBe("MEDIUM");
  });

  it("NTF KHÔNG phải sụt: hôm nay 70 OK + 30 NTF = 100 ≥ hôm qua 95 ⇒ không cảnh báo (chỉ-OK sẽ báo sụt giả 25)", async () => {
    h.hangDoi.push([{ total: 100, ok: 70, ntf: 30 }], [{ total: 100, ok: 95, ntf: 0 }]);
    expect(await detectYieldDrop(1, 5.0)).toBeNull();
  });

  it("ít hơn 10 mẫu ⇒ không đủ dữ liệu ⇒ null", async () => {
    h.hangDoi.push([{ total: 5, ok: 0, ntf: 0 }], [{ total: 100, ok: 95, ntf: 0 }]);
    expect(await detectYieldDrop(1, 5.0)).toBeNull();
  });
});
