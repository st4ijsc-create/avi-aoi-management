/**
 * SCADA R1b-1 T1 — GHIM: nhịp tim deadband 60 s (otManager) < ngưỡng stale 70 s của bộ đệm giá trị hiện tại.
 * Nếu ai nâng nhịp tim lên ≥ 70 s (hoặc hạ NGUONG_DEADBAND_MS xuống ≤ 60 s) thì tag đứng yên bị coi `stale` oan.
 * Đồng hồ giả; KHÔNG đặt DEADBAND_HEARTBEAT_MS ⇒ chạy giá trị mặc định thật. Không DB (đọc DB mock).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OtSample } from "../ot/otDriver";

vi.mock("../../db/otTelemetry", () => ({ layMoiNhatTheoThietBi: vi.fn(async () => []) }));

import {
  __datLaiBoDemHienTai,
  layGiaTri,
  napTuOt,
  NGUONG_DEADBAND_MS,
  thongTinAdapter,
} from "./boDemHienTai";
import { baoThongTinChoBoDem, makeDeadbandSink } from "../ot/otManager";
import type { RuntimeAdapter } from "../ot/deviceAdapter";

const T0 = 1_800_000_000_000;
const ADAPTER_ID = 41;

function adapter(poll = 1000): RuntimeAdapter {
  return {
    adapterId: ADAPTER_ID,
    code: "DB-R1B",
    machineId: null,
    protocol: "stub",
    connection: { endpoint: "stub://" },
    pollIntervalMs: poll,
    tags: [{ tagKey: "pressure", address: "p", dataType: "float", deadband: 2 }],
    driver: {} as never,
  };
}

function mau(now: number): OtSample {
  return { tagKey: "pressure", raw: 100, value: 100, quality: "good", timestamp: new Date(now) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  __datLaiBoDemHienTai();
  process.env.SCADA_LIVE_CACHE_ENABLED = "true";
  process.env.OT_TAG_DEADBAND_ENABLED = "true";
  delete process.env.DEADBAND_HEARTBEAT_MS;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.SCADA_LIVE_CACHE_ENABLED;
  delete process.env.OT_TAG_DEADBAND_ENABLED;
});

describe("R1b-1 T1 — bộ đệm: ngưỡng stale của adapter deadband = 70 s", () => {
  it("hằng ngưỡng là 70 000 ms và adapter có tag deadband (cờ BẬT) được đăng ký coDeadband", () => {
    expect(NGUONG_DEADBAND_MS).toBe(70_000);
    baoThongTinChoBoDem(adapter());
    expect(thongTinAdapter(ADAPTER_ID)?.coDeadband).toBe(true);
  });

  it("mẫu cuối cách 60 s ⇒ stale=false; cách 70 000 ms ⇒ false (biên); cách 70 001 ms ⇒ true", () => {
    baoThongTinChoBoDem(adapter());
    napTuOt({ adapterId: ADAPTER_ID, machineId: null }, [mau(T0)], T0);
    expect(layGiaTri(ADAPTER_ID, "pressure", T0 + 60_000)?.stale).toBe(false);
    expect(layGiaTri(ADAPTER_ID, "pressure", T0 + 70_000)?.stale).toBe(false);
    const cu = layGiaTri(ADAPTER_ID, "pressure", T0 + 70_001);
    expect(cu?.ageMs).toBe(70_001);
    expect(cu?.stale).toBe(true);
  });

  it("đối chứng: cờ deadband TẮT ⇒ ngưỡng chỉ 3·poll ⇒ mẫu cách 60 s đã stale (poll 1 s)", () => {
    delete process.env.OT_TAG_DEADBAND_ENABLED;
    baoThongTinChoBoDem(adapter(1000));
    expect(thongTinAdapter(ADAPTER_ID)?.coDeadband).toBe(false);
    napTuOt({ adapterId: ADAPTER_ID, machineId: null }, [mau(T0)], T0);
    expect(layGiaTri(ADAPTER_ID, "pressure", T0 + 60_000)?.stale).toBe(true);
  });
});

describe("R1b-1 T1 — chuỗi: sink deadband (nhịp tim mặc định) → bộ đệm ⇒ không bao giờ stale", () => {
  it("giá trị đứng yên 10 phút, mẫu 1 s/lần qua sink ⇒ mọi lần đọc mỗi giây đều stale=false", () => {
    const a = adapter();
    baoThongTinChoBoDem(a);
    const sink = makeDeadbandSink(a, (s) => {
      napTuOt({ adapterId: ADAPTER_ID, machineId: null }, [s], Date.now());
    });
    sink(mau(Date.now()));
    let lanDoc = 0;
    let luotNap = 1;
    for (let s = 1; s <= 600; s++) {
      vi.advanceTimersByTime(1000);
      const truoc = layGiaTri(ADAPTER_ID, "pressure", Date.now());
      expect(truoc?.stale, `giây ${s}: tuổi ${truoc?.ageMs} ms`).toBe(false);
      lanDoc++;
      sink(mau(Date.now()));
      if (layGiaTri(ADAPTER_ID, "pressure", Date.now())?.ageMs === 0) luotNap++;
    }
    expect(lanDoc).toBe(600);
    expect(luotNap).toBe(11); // 1 đầu + 10 nhịp tim 60 s
    // tuổi lớn nhất thấy được ngay trước một nhịp tim là 59 s < 70 s
  });
});
