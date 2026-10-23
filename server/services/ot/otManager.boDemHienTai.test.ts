/**
 * SCADA R0 Task 7 - otManager -> bo dem gia tri hien tai: coDeadband chi dung khi co OT_TAG_DEADBAND_ENABLED.
 * Co tat => khong co report-by-exception (khong heartbeat 60 s) => nguong stale phai la 3*poll, khong phai 70 s.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { baoThongTinChoBoDem, detachOtAdapter, stopOt } from "./otManager";
import { __datLaiBoDemHienTai, datThongTinAdapter, layGiaTri, napTuOt, thongTinAdapter } from "../scada/boDemHienTai";
import type { RuntimeAdapter } from "./deviceAdapter";
import type { OtSample } from "./otDriver";

const T0 = 1_800_000_000_000;

function adapter(tags: RuntimeAdapter["tags"]): RuntimeAdapter {
  return {
    adapterId: 7,
    code: "A7",
    machineId: 3,
    protocol: "stub",
    connection: { endpoint: "stub://" },
    pollIntervalMs: 1000,
    tags,
    driver: {} as never,
  };
}
const TAG_DB = { tagKey: "t", address: "t", dataType: "float" as const, deadband: 0.5 };
const TAG_THUONG = { tagKey: "u", address: "u", dataType: "float" as const };
const mauT: OtSample = { tagKey: "t", raw: 1, value: 1, quality: "good", timestamp: new Date(T0) };
const nap = (): void => void napTuOt({ adapterId: 7, machineId: 3 }, [mauT], T0);

beforeEach(() => {
  __datLaiBoDemHienTai();
  delete process.env.OT_TAG_DEADBAND_ENABLED;
  process.env.SCADA_LIVE_CACHE_ENABLED = "true";
});
afterEach(() => {
  delete process.env.OT_TAG_DEADBAND_ENABLED;
  delete process.env.SCADA_LIVE_CACHE_ENABLED;
});

describe("baoThongTinChoBoDem - coDeadband", () => {
  it("co TAT + tag co deadband => coDeadband false, stale o 3*poll", () => {
    baoThongTinChoBoDem(adapter([TAG_DB]));
    expect(thongTinAdapter(7)).toEqual({ pollMs: 1000, coDeadband: false, machineId: 3, code: "A7" });
    nap();
    expect(layGiaTri(7, "t", T0 + 3000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 3001)?.stale).toBe(true);
  });

  it("co BAT + tag co deadband => coDeadband true, con tuoi o 60 s", () => {
    process.env.OT_TAG_DEADBAND_ENABLED = "true";
    baoThongTinChoBoDem(adapter([TAG_DB]));
    expect(thongTinAdapter(7)?.coDeadband).toBe(true);
    nap();
    expect(layGiaTri(7, "t", T0 + 60_000)?.stale).toBe(false);
    expect(layGiaTri(7, "t", T0 + 70_001)?.stale).toBe(true);
  });

  it("co BAT nhung khong tag nao co deadband => false", () => {
    process.env.OT_TAG_DEADBAND_ENABLED = "true";
    baoThongTinChoBoDem(adapter([TAG_THUONG]));
    expect(thongTinAdapter(7)?.coDeadband).toBe(false);
  });
});

describe("M3 - gỡ adapter khỏi bộ đệm", () => {
  it("detachOtAdapter xoá thông tin + mục của adapter đó, adapter khác giữ", async () => {
    baoThongTinChoBoDem(adapter([TAG_THUONG]));
    napTuOt({ adapterId: 7, machineId: 3 }, [mauT], T0);
    datThongTinAdapter(8, { pollMs: 1000, coDeadband: false, machineId: 3, code: "A8" });
    napTuOt({ adapterId: 8, machineId: 3 }, [mauT], T0);
    await detachOtAdapter(7);
    expect(layGiaTri(7, "t", T0)).toBeNull();
    expect(thongTinAdapter(7)).toBeNull();
    expect(layGiaTri(8, "t", T0)).not.toBeNull();
  });

  it("stopOt xoá toàn bộ thông tin + mục", async () => {
    baoThongTinChoBoDem(adapter([TAG_THUONG]));
    nap();
    await stopOt();
    expect(layGiaTri(7, "t", T0)).toBeNull();
    expect(thongTinAdapter(7)).toBeNull();
  });
});
