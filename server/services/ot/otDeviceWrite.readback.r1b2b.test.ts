/**
 * SCADA R1b-2b-1 T6 (mục 42) + T6 fix round 1 (phát hiện ở nghiệm thu T16, ô R1-đc) — đọc lại tag int / float có tỉ lệ, và địa chỉ lớp bit so
 * theo luật bool (Task 2 concern 3).
 *
 * Mô hình ĐÚNG (fix round 1): driver THẬT trả tag int đã scale XUÔI và LÀM TRÒN — `Math.round(raw * scale + offset)` (`otScale.scaleXuoi`, MỌI
 * driver đọc dùng chung). Bản T6 đầu so ở không gian thô `round((e − o)/s) === round((a − o)/s)` trên giá trị ĐÃ làm tròn ⇒ lượt ghi ĐÚNG bị
 * `acked_unverified` (scale 0,5: 2,5 ⇒ thô 5 ⇒ đọc 3 ⇒ round(3/0,5) = 6 ≠ 5). Test T6 cũ dùng driver giả trả 2,5 chưa làm tròn nên không thấy.
 *
 * Phần tỉ lệ dùng `ModbusDriver` THẬT trên một client Modbus giả trong RAM (thanh ghi holding theo từ 16 bit) — giá trị đọc lại do CHÍNH driver
 * giải mã + scale + làm tròn; oracle = số thô test đặt vào thiết bị. Phần lớp bit giữ driver giả (nhánh bool không đổi).
 *
 * GIỚI HẠN đã biết (ghi ở `readbackCompare.ts` + báo cáo; R1b-2b-2 mục 64): khi làm tròn CHE số thô sai (scale 0,5: thô 6 và thô 5 cùng đọc 3)
 * thì không phát hiện được nếu không có đọc lại THÔ thật — ca "giới hạn" dưới GHIM hành vi đó để mục 64 lật nó có chủ ý.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeOtDeviceWrite } from "./otDeviceWrite";
import type { DispatchInput } from "./commandDispatcher";
import type { OtDriver } from "./otDriver";
import { ModbusDriver } from "./drivers/modbusDriver";

const savedRb = process.env.OT_READBACK_ENABLED;
beforeEach(() => {
  delete process.env.OT_READBACK_ENABLED;
});
afterEach(() => {
  if (savedRb === undefined) delete process.env.OT_READBACK_ENABLED;
  else process.env.OT_READBACK_ENABLED = savedRb;
});

function fakeDriver(protocol: string, docLai: unknown): OtDriver {
  return {
    protocol,
    writeTags: async (ws: Array<{ tagKey: string }>) => ws.map((w) => ({ tagKey: w.tagKey, ok: true })),
    readTags: async (ts: Array<{ tagKey: string }>) => ts.map((t) => ({ tagKey: t.tagKey, value: docLai, quality: "good", ts: new Date() })),
  } as unknown as OtDriver;
}

/**
 * "Thiết bị" Modbus trong RAM sau `ModbusDriver` THẬT: holding theo từ 16 bit (`writeRegister` / `writeRegisters` liên tiếp; đọc `count` từ).
 * `epTho(reg, w)` ⇒ thiết bị GIỮ từ `w` thay cho số vừa ghi (mô phỏng thiết bị giữ số thô sai). Ghi lại mọi lượt ghi.
 */
function thietBiModbus() {
  const hold = new Map<number, number>();
  const ep = new Map<number, number>();
  const ghi: Array<[string, number, unknown]> = [];
  const driver = new ModbusDriver();
  Object.assign(driver as unknown as Record<string, unknown>, {
    connected: true,
    client: {
      writeRegister: async (reg: number, w: number) => {
        ghi.push(["writeRegister", reg, w]);
        hold.set(reg, w);
        return {};
      },
      writeRegisters: async (reg: number, ws: number[]) => {
        ghi.push(["writeRegisters", reg, ws]);
        ws.forEach((w, i) => hold.set(reg + i, w));
        return {};
      },
      readHoldingRegisters: async (reg: number, count: number) => ({
        data: Array.from({ length: count }, (_, i) => ep.get(reg + i) ?? hold.get(reg + i) ?? 0),
      }),
    },
  });
  return { driver: driver as unknown as OtDriver, ghi, epTho: (reg: number, w: number) => void ep.set(reg, w) };
}

async function ghi(opts: {
  address: string;
  dataType: string;
  value: unknown;
  driver: OtDriver;
  scale?: number;
  offset?: number;
  stop?: boolean;
}) {
  const input = {
    adapterId: 990_635_778,
    machineId: null,
    commandType: opts.stop ? "stop" : "set_param",
    writes: [{ tagKey: "t", value: opts.value }],
    triggeredBy: { kind: "hitl", confirmedBy: 1, requestedBy: 1 },
    idempotencyKey: `r1b2b-t6-${Math.random()}`,
    docLai: "bat_buoc",
  } as unknown as DispatchInput;
  const resolved = [{ write: input.writes[0], address: opts.address, dataType: opts.dataType, scale: opts.scale, offset: opts.offset }];
  const r = await executeOtDeviceWrite({
    input,
    driver: opts.driver,
    resolved,
    driverWrites: [{ tagKey: "t", address: opts.address, value: opts.value, dataType: opts.dataType, scale: opts.scale, offset: opts.offset }],
    timeoutMs: 1000,
    stopTyped: !!opts.stop,
    ledger: { intentIds: [], confirmedBy: 1 },
    bumpStopEpoch: !!opts.stop,
  });
  return r.outcomes[0];
}

describe("R1b-2b-1 T6 fix round 1 — đọc lại tag có tỉ lệ qua ModbusDriver THẬT (giá trị đọc đã scale xuôi + làm tròn)", () => {
  it("★ int scale 0,5 ghi 2,5 ⇒ thô 5; thiết bị giữ đúng ⇒ đọc 3 ⇒ acked_verified (bản T6 đầu: acked_unverified giả)", async () => {
    const tb = thietBiModbus();
    const o = await ghi({ address: "holding:10", dataType: "int", value: 2.5, scale: 0.5, driver: tb.driver });
    expect(tb.ghi).toEqual([["writeRegister", 9, 5]]);
    expect(o.readBackValue).toBe(3);
    expect(o.status).toBe("acked_verified");
  });

  it("★ int scale 0,1 ghi 2,3 ⇒ thô 23; thiết bị giữ đúng ⇒ đọc 2 ⇒ acked_verified", async () => {
    const tb = thietBiModbus();
    const o = await ghi({ address: "holding:11", dataType: "int", value: 2.3, scale: 0.1, driver: tb.driver });
    expect(tb.ghi).toEqual([["writeRegister", 10, 23]]);
    expect(o.readBackValue).toBe(2);
    expect(o.status).toBe("acked_verified");
  });

  it("★ int scale 0,5 ghi 2,5; thiết bị giữ thô 7 (thay vì 5) ⇒ đọc round(3,5) = 4 ≠ 3 ⇒ acked_unverified", async () => {
    const tb = thietBiModbus();
    tb.epTho(9, 7);
    const o = await ghi({ address: "holding:10", dataType: "int", value: 2.5, scale: 0.5, driver: tb.driver });
    expect(tb.ghi).toEqual([["writeRegister", 9, 5]]);
    expect(o.readBackValue).toBe(4);
    expect(o.status).toBe("acked_unverified");
    expect(o.errorText).toBe("readback mismatch: expected=2.5 actual=4");
  });

  it("int scale 0,5 offset 10 ghi 12,5 ⇒ thô 5 ⇒ đọc round(12,5) = 13 ⇒ acked_verified; thiết bị giữ thô 3 ⇒ đọc 12 (round 11,5) ⇒ acked_unverified", async () => {
    const tb = thietBiModbus();
    const ok = await ghi({ address: "holding:12", dataType: "int", value: 12.5, scale: 0.5, offset: 10, driver: tb.driver });
    expect(tb.ghi).toEqual([["writeRegister", 11, 5]]);
    expect(ok.status).toBe("acked_verified");
    const tb2 = thietBiModbus();
    tb2.epTho(11, 3);
    const lech = await ghi({ address: "holding:12", dataType: "int", value: 12.5, scale: 0.5, offset: 10, driver: tb2.driver });
    expect(lech.readBackValue).toBe(12);
    expect(lech.status).toBe("acked_unverified");
  });

  it("int scale 10 ghi 30 ⇒ thô 3 ⇒ đọc 30 ⇒ acked_verified; thiết bị giữ thô 4 ⇒ đọc 40 ⇒ acked_unverified", async () => {
    const tb = thietBiModbus();
    expect((await ghi({ address: "holding:13", dataType: "int", value: 30, scale: 10, driver: tb.driver })).status).toBe("acked_verified");
    const tb2 = thietBiModbus();
    tb2.epTho(12, 4);
    expect((await ghi({ address: "holding:13", dataType: "int", value: 30, scale: 10, driver: tb2.driver })).status).toBe("acked_unverified");
  });

  it("KHÔNG thang đo ⇒ hành vi cũ: int ghi 7 giữ 7 ⇒ acked_verified; thiết bị giữ 8 ⇒ acked_unverified", async () => {
    const tb = thietBiModbus();
    const o = await ghi({ address: "holding:14", dataType: "int", value: 7, driver: tb.driver });
    expect(tb.ghi).toEqual([["writeRegister", 13, 7]]);
    expect(o.status).toBe("acked_verified");
    const tb2 = thietBiModbus();
    tb2.epTho(13, 8);
    expect((await ghi({ address: "holding:14", dataType: "int", value: 7, driver: tb2.driver })).status).toBe("acked_unverified");
  });

  it("float scale 0,1 ghi 2,3 (2 từ float32) ⇒ đọc lại khớp trong dung sai ⇒ acked_verified", async () => {
    const tb = thietBiModbus();
    const o = await ghi({ address: "holding:15", dataType: "float", value: 2.3, scale: 0.1, driver: tb.driver });
    expect(tb.ghi.map((g) => g[0])).toEqual(["writeRegisters"]);
    expect(o.status).toBe("acked_verified");
  });

  it("GIỚI HẠN đã biết (R1b-2b-2 mục 64): scale 0,5 ghi 2,5, thiết bị giữ thô 6 ⇒ đọc round(3,0) = 3 = đọc của thô 5 ⇒ acked_verified (làm tròn che lỗi)", async () => {
    const tb = thietBiModbus();
    tb.epTho(9, 6);
    const o = await ghi({ address: "holding:10", dataType: "int", value: 2.5, scale: 0.5, driver: tb.driver });
    expect(o.readBackValue).toBe(3);
    expect(o.status).toBe("acked_verified");
  });
});

describe("R1b-2b-1 T6 — địa chỉ lớp bit (Task 2 concern 3)", () => {
  it("★ STOP ghim 255 trên coil Modbus dataType int, đọc lại 1 ⇒ acked_verified", async () => {
    const o = await ghi({ address: "00001", dataType: "int", value: 255, driver: fakeDriver("modbus", 1), stop: true });
    expect(o.status).toBe("acked_verified");
  });
  it("STOP ghim 255 trên coil dataType int, đọc lại 0 ⇒ acked_unverified", async () => {
    const o = await ghi({ address: "00001", dataType: "int", value: 255, driver: fakeDriver("modbus", 0), stop: true });
    expect(o.status).toBe("acked_unverified");
  });
});
