/**
 * SCADA R1a Task 5 (K7) — ĐỌC LẠI BẮT BUỘC cho đường HMI: `DispatchInput.docLai: "bat_buoc"` ⇒ lớp ghi thiết bị
 * (executeOtDeviceWrite) đọc lại sau một lệnh ghi được ack KỂ CẢ KHI `OT_READBACK_ENABLED` tắt. Logic so giữ nguyên
 * (`readbackMatches` + quality "good"). Không `docLai` ⇒ y như trước (cờ tắt ⇒ `acked`, không gọi readTags).
 *
 * Thiết bị = StubDriver THẬT (ghi RAM; `simDatLoi({giaTri})` ép giá trị đọc). Oracle độc lập: giá trị stub bị ép (245) và số lần
 * readTags do test đếm (spy), không lấy từ mã sản phẩm.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StubDriver } from "./drivers/stubDriver";
import { executeOtDeviceWrite } from "./otDeviceWrite";
import type { DispatchInput } from "./commandDispatcher";

const ADAPTER = 990_635_777;
const savedRb = process.env.OT_READBACK_ENABLED;
const savedSer = process.env.OT_CMD_SERIALIZE_ENABLED;

async function stub(endpoint: string): Promise<StubDriver> {
  const d = new StubDriver();
  await d.connect({ endpoint });
  return d;
}

function input(over: Partial<DispatchInput> = {}): DispatchInput {
  return {
    adapterId: ADAPTER,
    machineId: null,
    commandType: "set_param",
    writes: [{ tagKey: "sp", value: 240 }],
    triggeredBy: { kind: "hitl", confirmedBy: 1, requestedBy: 1 },
    idempotencyKey: `r1a-t5-${Math.random()}`,
    ...over,
  };
}

async function ghi(driver: StubDriver, inp: DispatchInput) {
  const resolved = inp.writes.map((w) => ({ write: w, address: "DB1.8", dataType: "float" }));
  return executeOtDeviceWrite({
    input: inp,
    driver,
    resolved,
    driverWrites: resolved.map((r) => ({ tagKey: r.write.tagKey, address: r.address, value: r.write.value, dataType: "float" })),
    timeoutMs: 1000,
    stopTyped: false,
    ledger: { intentIds: [], confirmedBy: 1 },
    bumpStopEpoch: false,
  });
}

beforeEach(() => {
  delete process.env.OT_READBACK_ENABLED; // cờ TẮT (mặc định)
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
});
afterEach(() => {
  if (savedRb === undefined) delete process.env.OT_READBACK_ENABLED;
  else process.env.OT_READBACK_ENABLED = savedRb;
  if (savedSer === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
  else process.env.OT_CMD_SERIALIZE_ENABLED = savedSer;
});

describe("R1a T5 (K7) — docLai:'bat_buoc' ép đọc lại dù OT_READBACK_ENABLED tắt", () => {
  it("★ cờ tắt + docLai:'bat_buoc' + stub ép sp=245 sau khi ghi 240 ⇒ có readTags, acked_unverified, readBackValue=245, ok giữ true", async () => {
    const d = await stub("stub://r1a-t5-lech");
    d.simDatLoi({ giaTri: { sp: 245 } });
    const spy = vi.spyOn(d, "readTags");
    const r = await ghi(d, input({ docLai: "bat_buoc" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: "acked_unverified", readBackValue: 245 });
    expect(r.outcomes[0].errorText).toMatch(/readback mismatch: expected=240 actual=245/);
    await d.disconnect();
  });

  it("cờ tắt + docLai:'bat_buoc' + thiết bị giữ đúng giá trị ⇒ acked_verified, readBackValue=240", async () => {
    const d = await stub("stub://r1a-t5-khop");
    const spy = vi.spyOn(d, "readTags");
    const r = await ghi(d, input({ docLai: "bat_buoc" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: "acked_verified", readBackValue: 240 });
    await d.disconnect();
  });

  it("cờ tắt + docLai:'bat_buoc' + mẫu đọc lại quality 'uncertain' ⇒ acked_unverified (logic so giữ nguyên: chỉ 'good' xác minh)", async () => {
    const d = await stub("stub://r1a-t5-nghi");
    d.simDatLoi({ tagNghiNgo: ["sp"] });
    const r = await ghi(d, input({ docLai: "bat_buoc" }));
    expect(r.outcomes[0].status).toBe("acked_unverified");
    await d.disconnect();
  });

  it("cờ tắt + docLai:'bat_buoc' + readTags ném ⇒ acked_unverified 'readback unavailable' (không ném, ok giữ true)", async () => {
    const d = await stub("stub://r1a-t5-nem");
    vi.spyOn(d, "readTags").mockRejectedValue(new Error("boom"));
    const r = await ghi(d, input({ docLai: "bat_buoc" }));
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: "acked_unverified", errorText: "readback unavailable" });
    await d.disconnect();
  });

  it("fix round 1 — hẹn giờ của cuộc đua đọc lại được XOÁ khi đọc xong: không còn timer treo sau lệnh ghi", async () => {
    vi.useFakeTimers();
    try {
      const d = await stub("stub://r1a-t5-timer");
      const r = await ghi(d, input({ docLai: "bat_buoc" }));
      expect(r.outcomes[0].status).toBe("acked_verified");
      expect(vi.getTimerCount()).toBe(0);
      await d.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it("KHÔNG docLai + cờ tắt ⇒ như cũ: acked, readTags 0 lần (dù stub lệch)", async () => {
    const d = await stub("stub://r1a-t5-cu");
    d.simDatLoi({ giaTri: { sp: 245 } });
    const spy = vi.spyOn(d, "readTags");
    const r = await ghi(d, input());
    expect(spy).not.toHaveBeenCalled();
    expect(r.outcomes[0]).toMatchObject({ ok: true, status: "acked", readBackValue: null });
    await d.disconnect();
  });

  it("KHÔNG docLai + cờ BẬT ⇒ như cũ: đọc lại, lệch ⇒ acked_unverified 245", async () => {
    process.env.OT_READBACK_ENABLED = "true";
    const d = await stub("stub://r1a-t5-co");
    d.simDatLoi({ giaTri: { sp: 245 } });
    const r = await ghi(d, input());
    expect(r.outcomes[0]).toMatchObject({ status: "acked_unverified", readBackValue: 245 });
    await d.disconnect();
  });

  it("docLai:'bat_buoc' + ghi THẤT BẠI (stub mất kết nối) ⇒ failed, không đọc lại (chỉ đọc lại write đã ack — như cờ bật)", async () => {
    const d = await stub("stub://r1a-t5-mat");
    d.simDatLoi({ matKetNoi: true });
    const spy = vi.spyOn(d, "readTags");
    const r = await ghi(d, input({ docLai: "bat_buoc" }));
    expect(r.outcomes[0]).toMatchObject({ ok: false, status: "failed" });
    expect(spy).not.toHaveBeenCalled();
    d.simDatLoi({});
    await d.disconnect();
  });
});
