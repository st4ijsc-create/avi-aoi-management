/**
 * SCADA R1b-1 Task 4 — ingest TREO có hạn + `soLanChong` vào bộ đếm, D1 không hạ phiên vì DB chậm.
 *
 * Bệnh: `await o.onSample(s)` không bao giờ xong (ingestSample chờ ghi DB treo) giữ chốt chống chồng của vòng poll ⇒ adapter NGỪNG poll
 * trong im lặng. Chốt (xem vongPoll.ts):
 *   - hạn cho cả lượt phát mẫu của một tick = max(2 × intervalMs, HAN_PHAT_MAU_MS_TOI_THIEU = 5000);
 *   - quá hạn ⇒ bỏ các mẫu còn lại, báo tick `lyDo:"ingest_treo"`, nhả chốt; lượt phát cũ còn chạy nền KHÔNG phát thêm mẫu nào (token lượt);
 *   - hình tick: lần đọc chính ⇒ `{ok:true, timeout:true, lyDo:"ingest_treo", tags:<của lần đọc>}` (thiết bị ĐÃ trả lời); lượt phát
 *     không kèm lần đọc (mẫu muộn V2 tắt / loạt xấu V2) ⇒ `{ok:false, timeout:true, lyDo:"ingest_treo", tags:[]}` (lần đọc đã báo riêng);
 *   - D1 (taoDemTickHong) không đếm ingest treo là tick hỏng; `soLanChong` tới bộ đếm qua trường `chong` của onTick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OnOtSample,
  OtCommandResult,
  OtConnectionConfig,
  OtDriver,
  OtHealth,
  OtProtocol,
  OtSample,
  OtSubscriptionHandle,
  OtTagAddress,
  SuKienDoc,
  TuyChonVongPoll,
} from "./otDriver";
import { HAN_PHAT_MAU_MS_TOI_THIEU, taoVongPoll } from "./vongPoll";
import { laDocTot, laTickHong, taoDemTickHong } from "./reconnectNhanh";
import { __datLaiBoDem, ghiNhanDoc, layBoDem } from "./boDemTruyenThong";

const TAGS: OtTagAddress[] = [
  { tagKey: "t1", address: "1", dataType: "float" },
  { tagKey: "t2", address: "2", dataType: "float" },
];
const mauTot = (tagKey: string, value: unknown = 1): OtSample => ({ tagKey, raw: value, value, quality: "good", timestamp: new Date() });
const phanLoi = () => ({ statusCode: "timeout", reason: "comm_lost" as const });
const treoMai = () => new Promise<void>(() => undefined);

const TICK_TIMEOUT: SuKienDoc = { ok: false, timeout: true, ms: 800, tags: [], statusCode: "timeout", reason: "comm_lost" };
const TAG_GOOD = TAGS.map((t) => ({ tagKey: t.tagKey, quality: "good" as const }));
/** Lần đọc chính thành công, ingest treo. */
const TREO_DOC: SuKienDoc = { ok: true, timeout: true, lyDo: "ingest_treo", ms: 20, tags: TAG_GOOD };
/** Lần đọc chính mà MỌI tag bad/comm_lost, ingest treo — phán quyết của lần đọc vẫn là hỏng. */
const TREO_DOC_COMM_LOST: SuKienDoc = {
  ok: true,
  timeout: true,
  lyDo: "ingest_treo",
  ms: 800,
  tags: TAGS.map((t) => ({ tagKey: t.tagKey, quality: "bad" as const, reason: "comm_lost" as const })),
};
/** Lượt phát không kèm lần đọc (mẫu muộn / loạt xấu) treo. */
const TREO_PHAT: SuKienDoc = { ok: false, timeout: true, lyDo: "ingest_treo", ms: 5000, tags: [] };

describe("R1b-1 T4 — vongPoll: lượt phát mẫu có hạn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hằng: HAN_PHAT_MAU_MS_TOI_THIEU = 5000", () => {
    expect(HAN_PHAT_MAU_MS_TOI_THIEU).toBe(5000);
  });

  it("onSample không bao giờ xong ⇒ ở hạn max(2×1000, 5000)=5000 báo ingest_treo (kèm tag của lần đọc + chong), nhả chốt, tick sau VẪN chạy", async () => {
    const ticks: SuKienDoc[] = [];
    const doc = vi.fn(async (tags: OtTagAddress[]) => tags.map((t) => mauTot(t.tagKey)));
    let chongLucBao = -1;
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc,
      onSample: () => treoMai(),
      onTick: (e) => {
        ticks.push(e);
        if (chongLucBao < 0) chongLucBao = h.soLanChong();
      },
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(4900);
    expect(ticks).toHaveLength(0); // chưa tới hạn
    expect(doc).toHaveBeenCalledTimes(1);
    expect(h.soLanChong()).toBe(4); // tick 1000..4000 bị chốt chặn
    await vi.advanceTimersByTimeAsync(200); // 5100: quá hạn
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: true, timeout: true, lyDo: "ingest_treo", tags: TAG_GOOD });
    expect(ticks[0].chong).toBe(chongLucBao); // mọi lần chồng tới lúc báo
    expect(ticks[0].chong).toBeGreaterThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(1000); // 6100: tick 6000 chạy (trước sửa: chốt giữ mãi ⇒ doc 1 lần)
    expect(doc).toHaveBeenCalledTimes(2);
    await h.close();
  });

  it("KHÔNG mẫu cũ nào được phát sau khi nhả chốt: lượt phát quá hạn còn chạy nền dừng ở token lượt (thứ tự theo giờ nhận — R0 I4)", async () => {
    const phat: string[] = [];
    const ticks: SuKienDoc[] = [];
    let thaTreo: () => void = () => undefined;
    let lan = 0;
    const doc = vi.fn(async (tags: OtTagAddress[]) => {
      lan++;
      return tags.map((t) => mauTot(t.tagKey, lan));
    });
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc,
      onSample: (s) => {
        phat.push(`${s.tagKey}=${String(s.value)}`);
        // mẫu ĐẦU của tick 1 treo (ghi DB treo) tới khi test thả; mọi mẫu khác xong ngay
        if (s.value === 1 && s.tagKey === "t1") return new Promise<void>((r) => (thaTreo = r));
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(6100); // hạn 5000 ⇒ nhả; tick 6000 đọc lần 2 — lượt phát bị BỎ (back-pressure: t1=1 còn treo)
    expect(doc).toHaveBeenCalledTimes(2);
    expect(phat).toEqual(["t1=1"]);
    expect(ticks).toHaveLength(2);
    expect(ticks[1]).toMatchObject({ ok: true, timeout: true, lyDo: "ingest_treo", tags: TAG_GOOD });
    thaTreo(); // ghi DB treo của tick 1 cuối cùng cũng xong — lượt phát cũ KHÔNG được đi tiếp tới t2=1
    await vi.advanceTimersByTimeAsync(50);
    expect(phat).not.toContain("t2=1");
    await vi.advanceTimersByTimeAsync(1000); // tick 7000: sink rảnh ⇒ phát bình thường
    expect(phat).toEqual(["t1=1", "t1=3", "t2=3"]);
    expect(ticks[2]).toMatchObject({ ok: true, timeout: false });
    await h.close();
  });

  it("V2 tắt: phát mẫu MUỘN treo ⇒ chốt (giaoMuon) nhả ở hạn, báo ingest_treo ok:false, không mẫu muộn nào sau đó, tick sau đọc lại", async () => {
    const ticks: SuKienDoc[] = [];
    const phat: string[] = [];
    let thaTreo: () => void = () => undefined;
    let lan = 0;
    const doc = vi.fn((tags: OtTagAddress[]) => {
      lan++;
      const v = lan;
      if (v === 1) return new Promise<OtSample[]>((res) => setTimeout(() => res(tags.map((t) => mauTot(t.tagKey, v))), 2500));
      return Promise.resolve(tags.map((t) => mauTot(t.tagKey, v)));
    });
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 300,
      doc,
      onSample: (s) => {
        phat.push(`${s.tagKey}=${String(s.value)}`);
        if (s.value === 1 && s.tagKey === "t1") return new Promise<void>((r) => (thaTreo = r));
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: false,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(2600); // đọc 1 timeout ở 300, xong muộn ở 2500 ⇒ phát muộn t1=1 treo
    // fix round 1: tick 1000/2000 bị chặn khi docP CÒN treo ⇒ tick hỏng; từ 2500 (docP xong, chốt do việc phát muộn giữ) ⇒ trung tính
    expect(ticks).toHaveLength(3);
    expect(ticks.every((e) => e.ok === false && e.timeout === true && e.lyDo === undefined)).toBe(true);
    expect(phat).toEqual(["t1=1"]);
    await vi.advanceTimersByTimeAsync(4800); // 7400: chưa tới hạn phát muộn (2500 + 5000); tick 3000..7000 bị chặn, KHÔNG báo
    expect(doc).toHaveBeenCalledTimes(1);
    expect(ticks).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(200); // 7600: quá hạn ⇒ nhả chốt
    expect(ticks).toHaveLength(4);
    expect(ticks[3]).toMatchObject({ ok: false, timeout: true, lyDo: "ingest_treo", tags: [] });
    await vi.advanceTimersByTimeAsync(500); // 8100: tick 8000 đọc lại; lượt phát bị bỏ (t1=1 còn treo — back-pressure)
    expect(doc).toHaveBeenCalledTimes(2);
    expect(ticks[4]).toMatchObject({ ok: true, timeout: true, lyDo: "ingest_treo" });
    thaTreo();
    await vi.advanceTimersByTimeAsync(50);
    expect(phat).not.toContain("t2=1");
    await vi.advanceTimersByTimeAsync(1000); // tick 9000 phát bình thường
    expect(phat).toEqual(["t1=1", "t1=3", "t2=3"]);
    await h.close();
  });

  it("V2 bật: loạt mẫu XẤU khi mất liên lạc treo ⇒ nhả ở hạn, báo ingest_treo ok:false, tick sau vẫn chạy", async () => {
    const ticks: SuKienDoc[] = [];
    const phat: string[] = [];
    let thaTreo: () => void = () => undefined;
    let lan = 0;
    const doc = vi.fn(async (tags: OtTagAddress[]) => {
      lan++;
      if (lan === 1) throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
      return tags.map((t) => mauTot(t.tagKey));
    });
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc,
      onSample: (s) => {
        phat.push(`${s.tagKey}:${s.quality}`);
        // mẫu xấu ĐẦU (t1) treo tới khi test thả
        if (s.quality === "bad" && s.tagKey === "t1") return new Promise<void>((r) => (thaTreo = r));
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: () => ({ statusCode: "comm_lost", reason: "comm_lost" as const }),
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: false, reason: "comm_lost" });
    await vi.advanceTimersByTimeAsync(5000); // 5100: hạn loạt xấu
    expect(ticks).toHaveLength(2);
    expect(ticks[1]).toMatchObject({ ok: false, timeout: true, lyDo: "ingest_treo", tags: [] });
    expect(phat).toEqual(["t1:bad"]);
    thaTreo(); // ghi DB của t1:bad cuối cùng xong SAU khi chốt đã nhả — mẫu xấu thứ hai (t2) KHÔNG được phát (token lượt)
    await vi.advanceTimersByTimeAsync(50);
    expect(phat).not.toContain("t2:bad");
    await vi.advanceTimersByTimeAsync(1000);
    expect(phat).toEqual(["t1:bad", "t1:good", "t2:good"]);
    expect(doc).toHaveBeenCalledTimes(2);
    expect(ticks[2]).toMatchObject({ ok: true, timeout: false });
    await h.close();
  });

  it("onSample nhanh: không có tick ingest_treo, không có trường lyDo (hồi quy)", async () => {
    const ticks: SuKienDoc[] = [];
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc: async (tags) => tags.map((t) => mauTot(t.tagKey)),
      onSample: async () => {
        await new Promise((r) => setTimeout(r, 100));
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(3500);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.every((e) => e.lyDo === undefined && e.ok && !e.timeout)).toBe(true);
    await h.close();
  });
});

describe("R1b-1 T4 fix round 1 — back-pressure: ≤ 1 lời gọi sink đang bay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ghi DB treo VĨNH VIỄN: suốt 30 s chỉ đúng 1 lời gọi onSample đang treo; poll vẫn chạy, mỗi tick báo ingest_treo ok:true kèm tag", async () => {
    let dangBay = 0;
    let dinh = 0;
    const ticks: SuKienDoc[] = [];
    const doc = vi.fn(async (tags: OtTagAddress[]) => tags.map((t) => mauTot(t.tagKey)));
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      doc,
      onSample: () => {
        dangBay++;
        dinh = Math.max(dinh, dangBay);
        return treoMai();
      },
      onTick: (e) => ticks.push(e),
      phanLoiLoi: phanLoi,
      chatLuongV2: true,
      nhan: "t",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(dinh).toBe(1);
    expect(dangBay).toBe(1);
    expect(doc.mock.calls.length).toBeGreaterThanOrEqual(20);
    expect(ticks.length).toBeGreaterThanOrEqual(20);
    expect(ticks.every((e) => e.ok === true && e.lyDo === "ingest_treo" && e.tags.length === 2)).toBe(true);
    await h.close();
  });
});

/**
 * Ruling T4 c2 — LẦN ĐỌC treo (docP không bao giờ xong) ⇒ mọi tick bị chặn báo tick hỏng ⇒ D1 K=2 hạ phiên; DB treo (ingest) ⇒ không.
 * D1 thật (taoDemTickHong K=2) nối vào onTick; cả hai giá trị chatLuongV2 (V2 tắt: chot.giaoMuon đặt ở hạn, TRƯỚC khi docP xong — bẫy).
 */
describe.each([true, false])("R1b-1 T4 fix round 1 — đọc treo vs DB treo, D1 K=2 (chatLuongV2=%s)", (v2) => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const dung = (doc: (tags: OtTagAddress[]) => Promise<OtSample[]>, onSample: OnOtSample) => {
    const ticks: SuKienDoc[] = [];
    const ha = vi.fn();
    const dem = taoDemTickHong(2, ha);
    const h = taoVongPoll({
      tags: TAGS,
      intervalMs: 1000,
      deadlineMs: 2000,
      doc,
      onSample,
      onTick: (e) => {
        ticks.push(e);
        dem(e);
      },
      phanLoiLoi: phanLoi,
      chatLuongV2: v2,
      nhan: "t",
    });
    return { h, ticks, ha };
  };

  it("(a) lần đọc KHÔNG BAO GIỜ xong ⇒ tick bị chặn đầu tiên sau hạn là tick hỏng thứ 2 ⇒ D1 hạ; chong tới onTick", async () => {
    const { h, ticks, ha } = dung(() => new Promise<OtSample[]>(() => undefined), () => undefined);
    await vi.advanceTimersByTimeAsync(2100); // hạn đọc 2000 ⇒ tick hỏng 1
    expect(ticks).toHaveLength(1);
    expect(ha).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); // tick 3000 bị chặn bởi lần đọc treo ⇒ tick hỏng 2 ⇒ D1
    expect(ticks).toHaveLength(2);
    expect(ticks[1]).toMatchObject({ ok: false, timeout: true, tags: [] });
    expect(ticks[1].lyDo).toBeUndefined();
    expect(ticks[1].chong).toBeGreaterThanOrEqual(1);
    expect(ha).toHaveBeenCalledTimes(1);
    await h.close();
  });

  it("(c) đường chính: ingest treo mãi ⇒ D1 KHÔNG hạ (30 s)", async () => {
    const { h, ticks, ha } = dung(async (tags) => tags.map((t) => mauTot(t.tagKey)), () => treoMai());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ticks.length).toBeGreaterThanOrEqual(10);
    expect(ha).not.toHaveBeenCalled();
    await h.close();
  });

  if (!v2) {
    it("(b) V2 tắt: lần đọc xong muộn rồi việc phát muộn TREO (DB) ⇒ tick bị chặn trung tính, D1 KHÔNG hạ (30 s)", async () => {
      let lan = 0;
      const { h, ticks, ha } = dung(
        (tags) => {
          lan++;
          if (lan === 1) return new Promise<OtSample[]>((res) => setTimeout(() => res(tags.map((t) => mauTot(t.tagKey))), 2500));
          return Promise.resolve(tags.map((t) => mauTot(t.tagKey)));
        },
        () => treoMai(),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(ticks[0]).toMatchObject({ ok: false, timeout: true }); // hạn 2000 cắt lần đọc (tick hỏng 1)
      expect(ticks.filter((e) => e.ok === false && e.lyDo === undefined)).toHaveLength(1); // docP xong 2500: không tick hỏng nào nữa
      expect(ticks.some((e) => e.lyDo === "ingest_treo")).toBe(true);
      expect(ha).not.toHaveBeenCalled();
      await h.close();
    });
  }
});

describe("R1b-1 T4 — D1 / đọc tốt với tick ingest_treo (thuần)", () => {
  it("laTickHong: ingest treo KHÔNG phải tick hỏng tự thân; lần đọc kèm theo được phán như mọi lần đọc", () => {
    expect(laTickHong(TREO_PHAT)).toBe(false);
    expect(laTickHong(TREO_DOC)).toBe(false);
    expect(laTickHong(TREO_DOC_COMM_LOST)).toBe(true); // lần đọc tự nó đã hỏng (mọi tag comm_lost)
  });

  it("taoDemTickHong K=2: chuỗi ingest_treo (cả hai hình) không bao giờ hạ phiên", () => {
    const dat = vi.fn();
    const dem = taoDemTickHong(2, dat);
    for (let i = 0; i < 5; i++) {
      dem(TREO_PHAT);
      dem(TREO_DOC);
    }
    expect(dat).not.toHaveBeenCalled();
  });

  it("taoDemTickHong K=2: timeout, ingest_treo (không kèm lần đọc), timeout ⇒ hai lần ĐỌC hỏng liên tiếp vẫn hạ (báo treo trung tính)", () => {
    const dat = vi.fn();
    const dem = taoDemTickHong(2, dat);
    dem(TICK_TIMEOUT);
    dem(TREO_PHAT);
    expect(dat).not.toHaveBeenCalled();
    dem(TICK_TIMEOUT);
    expect(dat).toHaveBeenCalledTimes(1);
  });

  it("taoDemTickHong K=2: timeout, ingest_treo kèm lần đọc TỐT, timeout ⇒ không hạ (thiết bị đã trả lời ở giữa)", () => {
    const dat = vi.fn();
    const dem = taoDemTickHong(2, dat);
    dem(TICK_TIMEOUT);
    dem(TREO_DOC);
    dem(TICK_TIMEOUT);
    expect(dat).not.toHaveBeenCalled();
  });

  it("laDocTot (chốt T4): lần đọc thành công mà ingest treo VẪN là đọc tốt; báo treo không kèm lần đọc thì không", () => {
    expect(laDocTot(TREO_DOC)).toBe(true);
    expect(laDocTot(TREO_DOC_COMM_LOST)).toBe(false);
    expect(laDocTot(TREO_PHAT)).toBe(false);
  });
});

describe("R1b-1 T4 — bộ đếm truyền thông: chong + ingestTreo", () => {
  const T0 = 1_800_000_000_000;
  beforeEach(() => __datLaiBoDem());

  it("chong cộng dồn; ingest_treo kèm lần đọc = 1 request thành công (không loi/timeout); báo treo không kèm lần đọc chỉ tăng ingestTreo", () => {
    ghiNhanDoc(7, { ok: true, timeout: false, ms: 10, tags: TAG_GOOD, chong: 2 }, T0);
    ghiNhanDoc(7, { ...TREO_DOC, chong: 3 }, T0 + 1);
    ghiNhanDoc(7, TREO_PHAT, T0 + 2);
    const b = layBoDem(7, undefined, T0 + 10);
    expect(b.chong).toBe(5);
    expect(b.ingestTreo).toBe(2);
    expect(b.request).toBe(2);
    expect(b.loi).toBe(0);
    expect(b.timeout).toBe(0);
    expect(b.theoTag.t1).toMatchObject({ request: 2, good: 2 });
    expect(b.p50Ms).not.toBeNull();
  });

  it("adapter không có số liệu ⇒ chong 0, ingestTreo 0", () => {
    expect(layBoDem(999, undefined, T0)).toMatchObject({ chong: 0, ingestTreo: 0 });
  });
});

// ───────────────────────────── otManager (legacy + HA thật) — đầu cuối với vongPoll THẬT và ingestSample treo ─────────────────────────────

interface Phien {
  onTick: ((e: SuKienDoc) => void) | undefined;
  closed: boolean;
}

/**
 * Fix round 1 — điều khiển chung cho mọi driver giả (HA tạo driver trong supervisor): chế độ lần đọc (đọc LÚC GỌI), ingest treo hay không
 * (đọc lúc gọi), và tham số chatLuongV2 của vòng poll (đọc lúc subscribe; tách khỏi cờ env để phủ nhánh giaoMuon trong khi D1 vẫn bật).
 */
let cheDoDoc: "tot" | "treo" | "muon" = "tot";
let ingestTreoChung = false;
let v2VongPoll = true;

/** Driver giả: subscribe dựng vongPoll THẬT nối vào sink ingest của otManager; giữ onTick để test phát tick tay. */
class PollThatDriver implements OtDriver {
  readonly protocol: OtProtocol = "stub";
  connected = false;
  soLanDoc = 0;
  readonly phien: Phien[] = [];
  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    return tags.map((t) => mauTot(t.tagKey));
  }
  async subscribe(tags: OtTagAddress[], onSample: OnOtSample, ms?: number, tuyChon?: TuyChonVongPoll): Promise<OtSubscriptionHandle> {
    if (!this.connected) throw new Error("not connected");
    const p: Phien = { onTick: tuyChon?.onTick, closed: false };
    this.phien.push(p);
    const vong = taoVongPoll({
      tags,
      intervalMs: ms ?? 1000,
      deadlineMs: tuyChon?.deadlineMs,
      doc: (ds) => {
        this.soLanDoc++;
        if (cheDoDoc === "treo") return new Promise<OtSample[]>(() => undefined); // thiết bị / driver treo: docP không bao giờ xong
        if (cheDoDoc === "muon") {
          cheDoDoc = "tot"; // MỘT lần đọc xong muộn (2500 > hạn 2000), các lần sau nhanh
          return new Promise<OtSample[]>((res) => setTimeout(() => res(ds.map((t) => mauTot(t.tagKey))), 2500));
        }
        return Promise.resolve(ds.map((t) => mauTot(t.tagKey)));
      },
      onSample,
      onTick: tuyChon?.onTick,
      phanLoiLoi: phanLoi,
      chatLuongV2: v2VongPoll,
      nhan: "t4",
    });
    return {
      close: async () => {
        p.closed = true;
        await vong.close();
      },
    };
  }
  async writeTags(): Promise<OtCommandResult[]> {
    return [];
  }
  async health(): Promise<OtHealth> {
    return { protocol: this.protocol, connected: this.connected };
  }
}

const ID = 4444;

describe.each([
  ["legacy", "false", true],
  ["legacy", "false", false],
  ["HA (ConnectionSupervisor thật)", "true", true],
  ["HA (ConnectionSupervisor thật)", "true", false],
] as const)("R1b-1 T4 — ingest treo không hạ phiên, poll không dừng; đọc treo thì hạ (%s, OT_CONN_HA_ENABLED=%s, chatLuongV2 vòng poll=%s)", (_nhan, ha, v2) => {
  let ot: typeof import("./otManager");
  let tt: typeof import("./trangThaiAdapter");
  let bd: typeof import("./boDemTruyenThong");
  let drv: PollThatDriver;
  let legacyDrv: PollThatDriver;
  let haDrv: PollThatDriver[];

  const trangThai = () => tt.layTrangThaiAdapter(ID)?.tt;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_CONN_HA_ENABLED", ha);
    vi.stubEnv("OT_CONN_HA_BACKOFF_MS", "2000");
    vi.stubEnv("OT_CONN_HA_HEALTH_INTERVAL_MS", "100");
    vi.stubEnv("OT_CONN_HA_BACKOFF_JITTER", "0");
    vi.stubEnv("OT_LEGACY_RECONNECT_MS", "5000");
    vi.stubEnv("OT_POLL_BATCH_ENABLED", "false"); // đường mặc định: sink trả promise của ingestSample (ghi DB) ⇒ DB treo giữ vòng poll
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
    cheDoDoc = "tot";
    ingestTreoChung = false;
    v2VongPoll = v2;
    legacyDrv = new PollThatDriver();
    haDrv = [];
    vi.doMock("./driverRegistry", () => ({
      createDriver: () => {
        const d = new PollThatDriver();
        haDrv.push(d);
        return d;
      },
    }));
    vi.doMock("./ingest", () => ({
      ingestSample: () => (ingestTreoChung ? treoMai() : Promise.resolve()), // ghi DB treo mãi khi test bật
      ingestSamples: () => (ingestTreoChung ? treoMai() : Promise.resolve()),
    }));
    vi.doMock("./deviceAdapter", () => ({
      loadEnabledAdapters: async () => [
        {
          adapterId: ID,
          code: "T4-INGEST-TREO",
          machineId: null,
          protocol: "stub" as OtProtocol,
          connection: { endpoint: "stub://t4", timeoutMs: 800 } as OtConnectionConfig,
          pollIntervalMs: 1000,
          tags: TAGS,
          driver: legacyDrv,
        },
      ],
    }));
    ot = await import("./otManager");
    tt = await import("./trangThaiAdapter");
    bd = await import("./boDemTruyenThong");
    tt.__datLaiTrangThaiAdapter();
    tt.__datGhiDb(async () => undefined);
    bd.__datLaiBoDem();
    expect(await ot.startOt()).toBe(true);
    await vi.waitFor(() => {
      drv = ha === "true" ? haDrv[0] : legacyDrv;
      expect(drv).toBeDefined();
      expect(drv.phien).toHaveLength(1);
    });
  });

  afterEach(async () => {
    await ot.stopOt();
    tt.__datGhiDb(null);
    tt.__datLaiTrangThaiAdapter();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("(c) DB treo mãi: vẫn connected (đọc tốt — thiết bị đã trả lời), phiên KHÔNG bị hạ, poll tiếp tục, bộ đếm thấy ingestTreo + chong", async () => {
    ingestTreoChung = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(trangThai()).toBe("connected"); // mẫu good đầu của phiên (T3)
    await vi.advanceTimersByTimeAsync(20_000);
    expect(trangThai()).toBe("connected");
    expect(drv.phien).toHaveLength(1);
    expect(drv.phien[0].closed).toBe(false);
    expect(drv.soLanDoc).toBeGreaterThanOrEqual(3); // trước sửa: 1 — chốt bị ghi DB treo giữ mãi
    const b = bd.layBoDem(ID);
    expect(b.ingestTreo).toBeGreaterThanOrEqual(3);
    expect(b.chong).toBeGreaterThanOrEqual(3);
    expect(b.timeout).toBe(0);
    expect(b.loi).toBe(0);
  });

  it("D1: hai (và hơn) tick ingest_treo không kèm lần đọc liên tiếp ⇒ KHÔNG hạ phiên", async () => {
    await vi.advanceTimersByTimeAsync(500);
    expect(trangThai()).toBe("connected");
    const p = drv.phien[0];
    p.onTick!(TREO_PHAT);
    p.onTick!(TREO_PHAT);
    p.onTick!(TREO_PHAT);
    await vi.advanceTimersByTimeAsync(1000);
    expect(trangThai()).toBe("connected");
    expect(p.closed).toBe(false);
    expect(drv.phien).toHaveLength(1);
    // đối chứng: hai timeout THẬT liên tiếp vẫn hạ (D1 còn sống)
    p.onTick!(TICK_TIMEOUT);
    p.onTick!(TICK_TIMEOUT);
    await vi.waitFor(() => expect(p.closed).toBe(true));
  });

  it("(a) ruling T4 c2: lần đọc KHÔNG BAO GIỜ xong ⇒ tick bị chặn báo tick hỏng ⇒ D1 K=2 hạ phiên", async () => {
    await vi.advanceTimersByTimeAsync(500);
    expect(trangThai()).toBe("connected");
    const p = drv.phien[0];
    cheDoDoc = "treo";
    await vi.advanceTimersByTimeAsync(4000); // lần đọc 1000 treo, hạn 2000 ⇒ 3000 tick hỏng 1; tick 4000 bị chặn ⇒ tick hỏng 2 ⇒ D1
    await vi.waitFor(() => expect(p.closed).toBe(true));
    expect(bd.layBoDem(ID).timeout).toBeGreaterThanOrEqual(2);
    expect(bd.layBoDem(ID).chong).toBeGreaterThanOrEqual(1);
  });

  if (!v2) {
    it("(b) V2 tắt (vòng poll): lần đọc xong muộn rồi việc phát muộn TREO (DB) ⇒ KHÔNG hạ phiên (chot.giaoMuon không phải đọc treo)", async () => {
      await vi.advanceTimersByTimeAsync(500);
      expect(trangThai()).toBe("connected");
      const p = drv.phien[0];
      cheDoDoc = "muon";
      ingestTreoChung = true;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(p.closed).toBe(false);
      expect(drv.phien).toHaveLength(1);
      expect(trangThai()).toBe("connected");
      const b = bd.layBoDem(ID);
      expect(b.timeout).toBe(1); // chỉ tick của lần đọc bị hạn cắt
      expect(b.ingestTreo).toBeGreaterThanOrEqual(2);
    });
  }
});
