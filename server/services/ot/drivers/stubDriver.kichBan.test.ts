/**
 * SCADA R0 (C9) — stub có kịch bản: rớt kết nối, tag xấu/nghi ngờ, ghi RAM, tự rớt theo thời gian, đăng ký instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StubDriver, StubTimeoutError, layStubDangChay } from "./stubDriver";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import type { OtSample, OtTagAddress, SuKienDoc } from "../otDriver";
import { laLoiHuyTickPoll, laLoiMucLienKet, laLoiTimeout } from "../chatLuong";

const t1: OtTagAddress = { tagKey: "t1", address: "DB1.0", dataType: "float" };
const t2: OtTagAddress = { tagKey: "t2", address: "DB1.4", dataType: "float" };
const sp: OtTagAddress = { tagKey: "sp", address: "DB1.8", dataType: "float" };

async function noi(opts?: Record<string, unknown>, endpoint = "stub://x"): Promise<StubDriver> {
  const d = new StubDriver();
  await d.connect({ endpoint, options: opts });
  return d;
}

describe("StubDriver kịch bản (C9)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OT_CHAT_LUONG_V2_ENABLED;
  });

  it("matKetNoi: isConnected false, readTags ném DeviceUnreachableError, health connected:false; {} đọc lại được", async () => {
    const d = await noi();
    d.simDatLoi({ matKetNoi: true });
    expect(d.isConnected()).toBe(false);
    await expect(d.readTags([t1])).rejects.toBeInstanceOf(DeviceUnreachableError);
    expect((await d.health()).connected).toBe(false);

    d.simDatLoi({});
    expect(d.isConnected()).toBe(true);
    expect((await d.readTags([t1]))[0].quality).toBe("good");
    expect((await d.health()).connected).toBe(true);
  });

  it("connect trong lúc mô phỏng mất kết nối ⇒ ném DeviceUnreachableError (không nối lại được); hết lỗi ⇒ nối lại được", async () => {
    const d = await noi({}, "stub://nl");
    d.simDatLoi({ matKetNoi: true });
    await d.disconnect();
    await expect(d.connect({ endpoint: "stub://nl" })).rejects.toBeInstanceOf(DeviceUnreachableError);
    expect(d.isConnected()).toBe(false);
    expect(layStubDangChay("stub://nl")).toBe(d); // giữ đăng ký trong lúc mất thủ công: nút Lab còn tìm được để xoá lỗi
    d.simDatLoi({});
    await d.connect({ endpoint: "stub://nl" });
    expect(d.isConnected()).toBe(true);
    await d.disconnect();
    expect(layStubDangChay("stub://nl")).toBeUndefined(); // hết lỗi ⇒ quy tắc thường: gỡ khi disconnect
  });

  it("connect trong cửa sổ simKichBan đang chạy ⇒ ném và KHÔNG khởi động lại cửa sổ; hết cửa sổ ⇒ nối được", async () => {
    const d = await noi({ simKichBan: { matKetNoiSauMs: 0, matKetNoiTrongMs: 5000 } }, "stub://kb-nl");
    expect(d.isConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(d.connect({ endpoint: "stub://kb-nl", options: { simKichBan: { matKetNoiSauMs: 0, matKetNoiTrongMs: 5000 } } })).rejects.toBeInstanceOf(
      DeviceUnreachableError,
    );
    await vi.advanceTimersByTimeAsync(3100); // quá 5 s kể từ lần connect ĐẦU (cửa sổ không bị kéo dài bởi lần nối lại hỏng)
    expect(d.isConnected()).toBe(true);
  });

  it("tagXau: t2 bad (stub_bad/device_error), t1 vẫn good", async () => {
    const d = await noi();
    d.simDatLoi({ tagXau: ["t2"] });
    const [a, b] = await d.readTags([t1, t2]);
    expect(a.quality).toBe("good");
    expect(a.statusCode).toBeUndefined();
    expect(b.quality).toBe("bad");
    expect(b.value).toBeNull();
    expect(b.statusCode).toBe("stub_bad");
    expect(b.reason).toBe("device_error");
  });

  it("tagNghiNgo: t1 uncertain, giữ giá trị số", async () => {
    const d = await noi();
    d.simDatLoi({ tagNghiNgo: ["t1"] });
    const [a, b] = await d.readTags([t1, t2]);
    expect(a.quality).toBe("uncertain");
    expect(typeof a.value).toBe("number");
    expect(a.statusCode).toBe("stub_uncertain");
    expect(b.quality).toBe("good");
  });

  it("tagXau/tagNghiNgo áp dụng cả khi cờ OT_CHAT_LUONG_V2_ENABLED tắt", async () => {
    delete process.env.OT_CHAT_LUONG_V2_ENABLED;
    const d = await noi();
    d.simDatLoi({ tagXau: ["t2"] });
    expect((await d.readTags([t2]))[0].quality).toBe("bad");
  });

  it("giaTri ghi đè: ưu tiên giaTri > đã ghi > sin", async () => {
    const d = await noi();
    await d.writeTags([{ tagKey: "sp", address: "DB1.8", value: 42 }]);
    expect((await d.readTags([sp]))[0].value).toBe(42);
    d.simDatLoi({ giaTri: { sp: 7 } });
    expect((await d.readTags([sp]))[0].value).toBe(7);
    d.simDatLoi({}); // hết lỗi: giaTri bị xoá, giá trị đã ghi còn (RAM)
    expect((await d.readTags([sp]))[0].value).toBe(42);
  });

  it("simDatLoi ghi đè TOÀN BỘ trạng thái lỗi trước đó", async () => {
    const d = await noi();
    d.simDatLoi({ tagXau: ["t1"], matKetNoi: true });
    d.simDatLoi({ tagNghiNgo: ["t2"] });
    const [a, b] = await d.readTags([t1, t2]);
    expect(a.quality).toBe("good");
    expect(b.quality).toBe("uncertain");
  });

  it("writeTags ghi RAM: ok:true, readTags trả 42", async () => {
    const d = await noi();
    const r = await d.writeTags([{ tagKey: "sp", address: "DB1.8", value: 42 }]);
    expect(r).toEqual([{ tagKey: "sp", ok: true }]);
    const [s] = await d.readTags([sp]);
    expect(s.value).toBe(42);
    expect(s.quality).toBe("good");
  });

  it("simKichBan: mất từ 1 s tới 3 s", async () => {
    const d = await noi({ simKichBan: { matKetNoiSauMs: 1000, matKetNoiTrongMs: 2000 } });
    expect(d.isConnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(d.isConnected()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(d.isConnected()).toBe(false);
    await expect(d.readTags([t1])).rejects.toBeInstanceOf(DeviceUnreachableError);
    await vi.advanceTimersByTimeAsync(1999);
    expect(d.isConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(d.isConnected()).toBe(true);
    expect((await d.readTags([t1]))[0].quality).toBe("good");
  });

  it("layStubDangChay: trả đúng instance sau connect, undefined sau disconnect", async () => {
    expect(layStubDangChay("stub://a")).toBeUndefined();
    const d = await noi(undefined, "stub://a");
    expect(layStubDangChay("stub://a")).toBe(d);
    expect(layStubDangChay("stub://khac")).toBeUndefined();
    await d.disconnect();
    expect(layStubDangChay("stub://a")).toBeUndefined();
  });

  it("disconnect của instance cũ không gỡ instance mới cùng endpoint", async () => {
    const cu = await noi(undefined, "stub://b");
    const moi = await noi(undefined, "stub://b");
    await cu.disconnect();
    expect(layStubDangChay("stub://b")).toBe(moi);
    await moi.disconnect();
  });

  it("subscribe qua vòng poll: rớt kết nối + cờ BẬT ⇒ MỘT loạt mẫu bad comm_lost; có lại ⇒ mẫu good", async () => {
    process.env.OT_CHAT_LUONG_V2_ENABLED = "true";
    const d = await noi();
    const got: OtSample[] = [];
    const h = await d.subscribe([t1, t2], (s) => { got.push(s); }, 1000);
    await vi.advanceTimersByTimeAsync(0); // lần đọc đầu NGAY lúc subscribe (T12 D2)
    expect(got.map((s) => s.quality)).toEqual(["good", "good"]);

    got.length = 0;
    d.simDatLoi({ matKetNoi: true });
    await vi.advanceTimersByTimeAsync(3000); // 3 tick lỗi liên tiếp
    expect(got).toHaveLength(2); // MỘT loạt, không lặp mỗi tick
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost")).toBe(true);

    got.length = 0;
    d.simDatLoi({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(got.map((s) => s.quality)).toEqual(["good", "good"]);
    await h.close();
  });

  it("subscribe: cờ TẮT ⇒ rớt kết nối không phát mẫu bad", async () => {
    const d = await noi();
    const got: OtSample[] = [];
    d.simDatLoi({ matKetNoi: true }); // trước subscribe: lần đọc đầu chạy NGAY (T12 D2)
    const h = await d.subscribe([t1], (s) => { got.push(s); }, 1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(got).toHaveLength(0);
    await h.close();
  });

  it("subscribe chuyển onTick của tuỳ chọn", async () => {
    const d = await noi();
    const ticks: boolean[] = [];
    const h = await d.subscribe([t1], () => {}, 1000, { onTick: (e) => ticks.push(e.ok) });
    await vi.advanceTimersByTimeAsync(0); // lần đọc đầu NGAY (T12 D2)
    d.simDatLoi({ matKetNoi: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks).toEqual([true, false]);
    await h.close();
  });

  it("T12 treo (cáp rút sau switch): isConnected VẪN true; readTags CÔNG KHAI không trả lời tới timeoutMs rồi trả mẫu bad/comm_lost/timeout theo từng tag (không ném); hết treo ⇒ đọc được", async () => {
    process.env.OT_CHAT_LUONG_V2_ENABLED = "true";
    const d = new StubDriver();
    await d.connect({ endpoint: "stub://treo1", timeoutMs: 800 });
    d.simDatLoi({ treo: true });
    expect(d.isConnected()).toBe(true); // nửa mở: không ai nói với client là đã mất
    expect((await d.health()).connected).toBe(true);
    let out: OtSample[] | null = null;
    void d.readTags([t1]).then((o) => {
      out = o;
    });
    await vi.advanceTimersByTimeAsync(790);
    expect(out).toBeNull(); // chưa có câu trả lời nào
    await vi.advanceTimersByTimeAsync(50);
    expect(out).not.toBeNull();
    expect(out![0]).toMatchObject({ quality: "bad", value: null, reason: "comm_lost", statusCode: "timeout" });
    d.simDatLoi({});
    expect((await d.readTags([t1]))[0].quality).toBe("good");
    await d.disconnect();
  });

  it("T12b fix round 1: lỗi treo là lớp QUÁ HẠN (StubTimeoutError) — laLoiHuyTickPoll coi là quá hạn, KHÔNG phải lỗi liên kết; đường poll huỷ ở giao dịch ĐẦU (3 tag ⇒ tick hỏng sau ~1 × timeoutMs, không 3 ×)", async () => {
    const e = new StubTimeoutError("transaction", 800);
    expect(laLoiTimeout(e)).toBe(true);
    expect(laLoiHuyTickPoll(e)).toBe(true);
    expect(laLoiMucLienKet(e)).toBe(false);
    expect(e).not.toBeInstanceOf(DeviceUnreachableError);

    process.env.OT_CHAT_LUONG_V2_ENABLED = "true";
    const d = new StubDriver();
    await d.connect({ endpoint: "stub://treo4", timeoutMs: 800 });
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe([t1, t2, sp], () => undefined, 5000, { onTick: (ev) => void ticks.push(ev) });
    await vi.advanceTimersByTimeAsync(0);
    ticks.length = 0;
    d.simDatLoi({ treo: true });
    await vi.advanceTimersByTimeAsync(5000 + 850); // tick 5000, giao dịch đầu quá hạn ở 5800
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ ok: false, timeout: true, reason: "comm_lost", statusCode: "timeout" });
    expect(ticks[0].ms).toBeLessThan(1000);
    await h.close();
    d.simDatLoi({});
    await d.disconnect();
  });

  it("T12 treo + vòng poll (cờ BẬT): tick lỗi timeout/comm_lost mỗi chu kỳ, đúng MỘT loạt bad/comm_lost/timeout; hết treo ⇒ good", async () => {
    process.env.OT_CHAT_LUONG_V2_ENABLED = "true";
    const d = new StubDriver();
    await d.connect({ endpoint: "stub://treo2", timeoutMs: 800 });
    const got: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe([t1, t2], (s) => void got.push(s), 1000, { onTick: (e) => void ticks.push(e) });
    await vi.advanceTimersByTimeAsync(0);
    expect(got.map((s) => s.quality)).toEqual(["good", "good"]);
    got.length = 0;
    ticks.length = 0;
    d.simDatLoi({ treo: true });
    await vi.advanceTimersByTimeAsync(3000); // tick 1000, 2000, 3000 (tick 3000 chưa tới hạn 800)
    expect(ticks).toHaveLength(2);
    expect(ticks.every((e) => !e.ok && e.timeout && e.reason === "comm_lost" && e.statusCode === "timeout")).toBe(true);
    expect(got).toHaveLength(2);
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.statusCode === "timeout")).toBe(true);
    d.simDatLoi({}); // lần đọc của tick 3000 đang chờ ⇒ được trả lời muộn (good); tick 4000 good
    await vi.advanceTimersByTimeAsync(1100);
    expect(got.length).toBeGreaterThanOrEqual(4);
    expect(got.slice(2).every((s) => s.quality === "good")).toBe(true);
    await h.close();
    await d.disconnect();
  });

  it("T12 treo: connect chờ tới timeoutMs rồi ném (quá hạn); treo hết GIỮA lúc chờ ⇒ connect thành công; disconnect lúc treo giữ đăng ký", async () => {
    const d = new StubDriver();
    await d.connect({ endpoint: "stub://treo3", timeoutMs: 800 });
    d.simDatLoi({ treo: true });
    await d.disconnect();
    expect(layStubDangChay("stub://treo3")).toBe(d); // nút Lab / nghiệm thu còn tìm được để xoá lỗi
    let loi: unknown = null;
    const p1 = d.connect({ endpoint: "stub://treo3", timeoutMs: 800 }).catch((e) => {
      loi = e;
    });
    await vi.advanceTimersByTimeAsync(850);
    await p1;
    expect(loi).toBeInstanceOf(StubTimeoutError);
    expect(laLoiTimeout(loi)).toBe(true);
    expect(d.isConnected()).toBe(false);

    let ok = false;
    const p2 = d.connect({ endpoint: "stub://treo3", timeoutMs: 800 }).then(() => {
      ok = true;
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(ok).toBe(false);
    d.simDatLoi({}); // cắm lại giữa lúc SYN đang chờ
    await vi.advanceTimersByTimeAsync(100);
    await p2;
    expect(ok).toBe(true);
    expect(d.isConnected()).toBe(true);
    await d.disconnect();
  });

  it("API checksum cũ vẫn chạy", async () => {
    const d = await noi({ simProgram: "P1" });
    const a = await d.readProgramChecksum();
    expect(a.supported).toBe(true);
    d.simLoadProgram("P2");
    const b = await d.readProgramChecksum();
    expect(b).not.toEqual(a);
    d.simSetProgramReadFault("error");
    await expect(d.readProgramChecksum()).rejects.toBeInstanceOf(DeviceUnreachableError);
    expect(d.simPendingReads).toBe(0);
  });
});
