/**
 * SCADA R0 (C9) — stub có kịch bản: rớt kết nối, tag xấu/nghi ngờ, ghi RAM, tự rớt theo thời gian, đăng ký instance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StubDriver, layStubDangChay } from "./stubDriver";
import { DeviceUnreachableError } from "../../../_core/deviceErrors";
import type { OtSample, OtTagAddress } from "../otDriver";

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
    await vi.advanceTimersByTimeAsync(1000);
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
    const h = await d.subscribe([t1], (s) => { got.push(s); }, 1000);
    d.simDatLoi({ matKetNoi: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(got).toHaveLength(0);
    await h.close();
  });

  it("subscribe chuyển onTick của tuỳ chọn", async () => {
    const d = await noi();
    const ticks: boolean[] = [];
    const h = await d.subscribe([t1], () => {}, 1000, { onTick: (e) => ticks.push(e.ok) });
    await vi.advanceTimersByTimeAsync(1000);
    d.simDatLoi({ matKetNoi: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ticks).toEqual([true, false]);
    await h.close();
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
