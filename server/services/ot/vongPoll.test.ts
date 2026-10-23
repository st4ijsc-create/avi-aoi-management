/**
 * SCADA R0 Task 2 — vòng poll dùng chung: chống chồng tick, deadline, mẫu xấu MỘT lần khi mất, hồi phục.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtSample, OtTagAddress, SuKienDoc } from "./otDriver";
import { taoVongPoll } from "./vongPoll";

const TAGS: OtTagAddress[] = [
  { tagKey: "t1", address: "1", dataType: "float" },
  { tagKey: "t2", address: "2", dataType: "float" },
];

function mauTot(tagKey: string): OtSample {
  return { tagKey, raw: 1, value: 1, quality: "good", timestamp: new Date() };
}
const docTot = async (tags: OtTagAddress[]) => tags.map((t) => mauTot(t.tagKey));
const phanLoi = () => ({ statusCode: "timeout", reason: "comm_lost" as const });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("taoVongPoll", () => {
  it("tick tới khi tick trước chưa xong thì bỏ qua và đếm soLanChong", async () => {
    const doc = vi.fn(
      () => new Promise<OtSample[]>((res) => setTimeout(() => res([mauTot("t1")]), 1500)),
    );
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 5000,
      doc,
      onSample: () => undefined,
      phanLoiLoi: phanLoi,
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(doc).toHaveBeenCalledTimes(2);
    expect(h.soLanChong()).toBeGreaterThanOrEqual(1);
    await h.close();
  });

  it("hạn mặc định = max(2×chu kỳ, 6000): lần đọc chậm-nhưng-khoẻ (5 s, chu kỳ 1 s) KHÔNG bị cắt", async () => {
    const ticks: SuKienDoc[] = [];
    const got: OtSample[] = [];
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc: () => new Promise<OtSample[]>((res) => setTimeout(() => res([mauTot("t1")]), 5000)),
      onSample: (s) => void got.push(s),
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(6100); // tick đầu ở 1000, đọc xong ở 6000
    expect(ticks).toHaveLength(1);
    expect(ticks[0].ok).toBe(true);
    expect(got).toHaveLength(1);
    await h.close();
  });

  it("hạn mặc định: đọc treo mãi bị cắt ở max(2×chu kỳ, 6000) — chu kỳ 4 s ⇒ 8 s, không sớm hơn", async () => {
    const ticks: SuKienDoc[] = [];
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 4000,
      doc: () => new Promise<OtSample[]>(() => undefined),
      onSample: () => undefined,
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(4000 + 7900); // tick ở 4000; hạn 8000 ⇒ 12000
    expect(ticks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: false, timeout: true });
    await h.close();
  });

  it("doc treo mãi: onTick nhận timeout:true ở khoảng deadlineMs", async () => {
    const ticks: SuKienDoc[] = [];
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 800,
      doc: () => new Promise<OtSample[]>(() => undefined),
      onSample: () => undefined,
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(1000); // tick bắt đầu ở 1000
    expect(ticks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(799);
    expect(ticks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: false, timeout: true, tags: [] });
    expect(ticks[0].ms).toBeGreaterThanOrEqual(790);
    expect(ticks[0].ms).toBeLessThan(900);
    await h.close();
  });

  it("chatLuongV2: ném 3 tick ⇒ đúng MỘT loạt xấu; tick 4 tốt ⇒ mẫu tốt; tick 5 ném ⇒ thêm MỘT loạt (đợt mới)", async () => {
    const mau: OtSample[] = [];
    let n = 0;
    const doc = async (tags: OtTagAddress[]) => {
      n++;
      if (n === 4) return docTot(tags);
      throw new Error("boom");
    };
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 100,
      doc,
      onSample: (s) => {
        mau.push(s);
      },
      phanLoiLoi: () => ({ statusCode: "sc_x", reason: "device_error" }),
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(n).toBe(3);
    expect(mau).toHaveLength(2); // một loạt = mỗi tag một mẫu
    expect(mau.map((s) => s.tagKey).sort()).toEqual(["t1", "t2"]);
    for (const s of mau) {
      expect(s).toMatchObject({ quality: "bad", value: null, statusCode: "sc_x", reason: "device_error" });
    }
    await vi.advanceTimersByTimeAsync(100); // tick 4 tốt
    expect(mau).toHaveLength(4);
    expect(mau.slice(2).every((s) => s.quality === "good")).toBe(true);
    await vi.advanceTimersByTimeAsync(100); // tick 5 ném
    expect(mau).toHaveLength(6);
    expect(mau.slice(4).every((s) => s.quality === "bad")).toBe(true);
    await h.close();
  });

  it("chatLuongV2:false: doc ném ⇒ không phát mẫu (hành vi cũ), onTick vẫn báo lỗi", async () => {
    const mau: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 100,
      doc: async () => {
        throw new Error("boom");
      },
      onSample: (s) => {
        mau.push(s);
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(350);
    expect(mau).toHaveLength(0);
    expect(ticks.length).toBe(3);
    expect(ticks.every((e) => !e.ok && !e.timeout && e.tags.length === 0)).toBe(true);
    await h.close();
  });

  it("chập chờn: ném ở tick 1, tốt ở tick 2 ⇒ mẫu cuối của mỗi tag là good", async () => {
    const mau: OtSample[] = [];
    let n = 0;
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 100,
      doc: async (tags) => {
        n++;
        if (n === 1) throw new Error("boom");
        return docTot(tags);
      },
      onSample: (s) => {
        mau.push(s);
      },
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(n).toBe(2);
    for (const k of ["t1", "t2"]) {
      const cuoi = [...mau].reverse().find((s) => s.tagKey === k);
      expect(cuoi?.quality).toBe("good");
    }
    await h.close();
  });

  it("thành công: onTick mang chất lượng từng tag; lỗi onSample một mẫu bị nuốt", async () => {
    const ticks: SuKienDoc[] = [];
    const nhan: string[] = [];
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 100,
      doc: docTot,
      onSample: (s) => {
        nhan.push(s.tagKey);
        if (s.tagKey === "t1") throw new Error("callback hỏng");
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(nhan).toEqual(["t1", "t2"]); // t1 ném nhưng t2 vẫn tới
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: true, timeout: false });
    expect(ticks[0].tags).toEqual([
      { tagKey: "t1", quality: "good" },
      { tagKey: "t2", quality: "good" },
    ]);
    await h.close();
  });

  it("close() khi một tick đang chờ ⇒ không còn onSample sau đó", async () => {
    const mau: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const doc = vi.fn(
      () => new Promise<OtSample[]>((res) => setTimeout(() => res([mauTot("t1")]), 500)),
    );
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc,
      onSample: (s) => {
        mau.push(s);
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(1100); // tick đang chờ doc
    expect(doc).toHaveBeenCalledTimes(1);
    await h.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mau).toHaveLength(0);
    expect(ticks).toHaveLength(0);
    expect(doc).toHaveBeenCalledTimes(1);
  });

  it("hồi quy: doc treo mãi, deadlineMs < intervalMs ⇒ doc gọi đúng 1 lần, soLanChong>0, đúng MỘT loạt xấu timeout", async () => {
    const mau: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const doc = vi.fn(() => new Promise<OtSample[]>(() => undefined));
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 300,
      doc,
      onSample: (s) => {
        mau.push(s);
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(5500); // 5 tick
    expect(doc).toHaveBeenCalledTimes(1);
    expect(h.soLanChong()).toBeGreaterThan(0);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: false, timeout: true });
    expect(mau).toHaveLength(2);
    expect(mau.every((s) => s.quality === "bad")).toBe(true);
    await h.close();
  });

  it("đọc đã bỏ ở hạn rồi xong muộn: kết quả muộn bị nuốt, chốt nhả, tick sau đọc lại bình thường", async () => {
    const mau: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    let n = 0;
    const doc = vi.fn((tags: OtTagAddress[]) => {
      n++;
      if (n === 1) {
        return new Promise<OtSample[]>((res) => setTimeout(() => res(tags.map((t) => mauTot(t.tagKey))), 2500));
      }
      return docTot(tags);
    });
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 300,
      doc,
      onSample: (s) => {
        mau.push(s);
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(3000); // đọc 1 bắt đầu ở 1000, hạn ở 1300, xong muộn ở 3500 -> chưa
    expect(doc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600); // 3600: đọc 1 xong muộn (3500), tick 4000 chưa tới
    expect(mau.filter((s) => s.quality === "good")).toHaveLength(0); // kết quả muộn không phát
    expect(ticks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500); // 4100: tick 4000 đọc lại
    expect(doc).toHaveBeenCalledTimes(2);
    expect(mau.filter((s) => s.quality === "good")).toHaveLength(2);
    await h.close();
  });

  it("chatLuongV2: đường timeout phát loạt xấu mang phanLoiLoi(err) và onTick timeout:true", async () => {
    const mau: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const phan = vi.fn(() => ({ statusCode: "sc_timeout", reason: "comm_lost" as const }));
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 400,
      doc: () => new Promise<OtSample[]>(() => undefined),
      onSample: (s) => {
        mau.push(s);
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phan,
      chatLuongV2: true,
      nhan: "plc1",
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(ticks).toHaveLength(1);
    expect(ticks[0].timeout).toBe(true);
    expect(phan).toHaveBeenCalledTimes(1);
    const err = (phan.mock.calls[0] as unknown[])[0];
    expect((err as Error).message).toMatch(/plc1 read timeout after 400ms/);
    expect(mau).toHaveLength(2);
    for (const s of mau) {
      expect(s).toMatchObject({ quality: "bad", statusCode: "sc_timeout", reason: "comm_lost", value: null });
    }
    await h.close();
  });
});
