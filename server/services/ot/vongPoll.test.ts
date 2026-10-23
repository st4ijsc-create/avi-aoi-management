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
  it("D2 (T12): lần đọc ĐẦU chạy NGAY lúc subscribe (t=0), rồi mỗi intervalMs", async () => {
    const lucDoc: number[] = [];
    const t0 = Date.now();
    const doc = vi.fn(async (tags: OtTagAddress[]) => {
      lucDoc.push(Date.now() - t0);
      return tags.map((t) => mauTot(t.tagKey));
    });
    const got: OtSample[] = [];
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc,
      onSample: (s) => void got.push(s),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(doc).toHaveBeenCalledTimes(1); // không chờ một chu kỳ
    expect(got).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(lucDoc).toEqual([0, 1000, 2000]);
    await h.close();
  });

  it("D2 (T12): lần đọc đầu NGAY vẫn giữ chốt chống chồng tới khi doc() xong (tick 1000 bị bỏ khi đọc đầu kéo 1500 ms)", async () => {
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
    await vi.advanceTimersByTimeAsync(0);
    expect(doc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100); // tick 1000: đọc đầu chưa xong ⇒ bỏ qua
    expect(doc).toHaveBeenCalledTimes(1);
    expect(h.soLanChong()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000); // đọc đầu xong ở 1500; tick 2000 đọc lại
    expect(doc).toHaveBeenCalledTimes(2);
    await h.close();
  });

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
    await vi.advanceTimersByTimeAsync(6100); // đọc đầu ở 0 (D2), xong ở 5000; đọc thứ hai (5000) chưa xong
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
    await vi.advanceTimersByTimeAsync(7900); // đọc đầu ở 0 (D2); hạn 8000
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
    await vi.advanceTimersByTimeAsync(0); // đọc đầu bắt đầu ngay (D2)
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
    await vi.advanceTimersByTimeAsync(250); // đọc ở 0 (D2), 100, 200
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
    await vi.advanceTimersByTimeAsync(250); // đọc ở 0 (D2), 100, 200
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
    await vi.advanceTimersByTimeAsync(150); // đọc ở 0 (D2) và 100
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
    await vi.advanceTimersByTimeAsync(50); // chỉ lần đọc đầu (D2: ở 0)
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
    await vi.advanceTimersByTimeAsync(100); // lần đọc đầu (D2: ở 0) đang chờ doc
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
    await vi.advanceTimersByTimeAsync(2000); // đọc 1 bắt đầu ở 0 (D2), hạn ở 300, xong muộn ở 2500 -> chưa; tick 1000/2000 bị bỏ
    expect(doc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600); // 2600: đọc 1 xong muộn (2500), tick 3000 chưa tới
    expect(mau.filter((s) => s.quality === "good")).toHaveLength(0); // kết quả muộn không phát
    expect(ticks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500); // 3100: tick 3000 đọc lại
    expect(doc).toHaveBeenCalledTimes(2);
    expect(mau.filter((s) => s.quality === "good")).toHaveLength(2);
    await h.close();
  });

  it("final I1: chatLuongV2:false — đọc quá hạn rồi xong muộn ⇒ mẫu muộn VẪN được phát, tick vẫn báo timeout, chốt giữ tới khi xong", async () => {
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
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(400); // hạn 300 đã cắt
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: false, timeout: true });
    expect(mau).toHaveLength(0); // V2 tắt ⇒ không có loạt xấu
    await vi.advanceTimersByTimeAsync(1700); // 2100: tick 1000/2000 bị chốt chặn (đọc 1 còn treo)
    expect(doc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500); // 2600: đọc 1 xong muộn ⇒ phát
    expect(mau.map((s) => s.tagKey)).toEqual(["t1", "t2"]);
    expect(mau.every((s) => s.quality === "good")).toBe(true);
    expect(ticks).toHaveLength(1); // tick đó vẫn là timeout, không thêm tick "ok"
    await vi.advanceTimersByTimeAsync(500); // 3100: tick 3000 đọc lại bình thường
    expect(doc).toHaveBeenCalledTimes(2);
    expect(mau).toHaveLength(4);
    await h.close();
  });

  it("final I1: chatLuongV2:false — close() trước khi đọc muộn xong ⇒ không phát gì", async () => {
    const mau: OtSample[] = [];
    const doc = vi.fn(
      (tags: OtTagAddress[]) =>
        new Promise<OtSample[]>((res) => setTimeout(() => res(tags.map((t) => mauTot(t.tagKey))), 2500)),
    );
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 300,
      doc,
      onSample: (s) => {
        mau.push(s);
      },
      phanLoiLoi: phanLoi,
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(400); // quá hạn
    await h.close();
    await vi.advanceTimersByTimeAsync(5000); // đọc muộn xong sau close
    expect(mau).toHaveLength(0);
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
    expect(ticks[0]).toMatchObject({ statusCode: "sc_timeout", reason: "comm_lost" }); // T12 D1: tick lỗi mang phân loại
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
