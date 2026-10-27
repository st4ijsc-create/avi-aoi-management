/**
 * R1b-2b-1 T17 fix round 1 (rà soát bảo mật — trôi trạng thái fail-open) — mục rủi ro "lệnh ghi cũ" (B3 `staleWriteRisk`) không bao giờ bị LÀM YẾU:
 * một lần bỏ mới (quá hạn giữ chỗ B3 hoặc huỷ vì mất liên kết lúc đang bay) GỘP vào mục đang có (hạn = max, intent + writes hợp lại); lượt giữ B3
 * nhả trên mục ĐANG ở map và chỉ nới hạn.
 * Đường thật: `executeOtDeviceWrite` với driver ném `LoiMatLienKetKhiDangGui` (OT_CMD_SERIALIZE_ENABLED bật trong tiến trình); đường giữ / nhả
 * của B3 qua seam `_ghiRuiRoGhiCuForTests` (cùng hàm `ghiRuiRoGhiCu` / `nhaGiuRuiRo` mà `holdSlotAfterTimedOutWrite` gọi).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  executeOtDeviceWrite,
  _ghiRuiRoGhiCuForTests,
  _staleWriteRiskForTests,
  _sweepStaleWriteRiskForTests,
} from "./otDeviceWrite";
import { LoiMatLienKetKhiDangGui } from "./drivers/dangBay";
import type { OtDriver } from "./otDriver";

const cu = process.env.OT_CMD_SERIALIZE_ENABLED;
beforeEach(() => {
  process.env.OT_CMD_SERIALIZE_ENABLED = "true";
});
afterEach(() => {
  vi.useRealTimers();
  if (cu === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
  else process.env.OT_CMD_SERIALIZE_ENABLED = cu;
});

const lenh = (adapterId: number, tagKey: string, value: unknown, key: string) =>
  ({ adapterId, machineId: null, commandType: "stop", idempotencyKey: key, writes: [{ tagKey, value }] }) as any;

/** Driver giả: lệnh ghi bị huỷ vì mất liên kết lúc đang bay (đúng lỗi có kiểu của driver thật). */
const driverMatLienKet = (): OtDriver =>
  ({
    protocol: "modbus",
    writeTags: async () => {
      throw new LoiMatLienKetKhiDangGui("modbus", "socket close");
    },
    readTags: async () => [],
  }) as unknown as OtDriver;

async function huyViMatLienKet(adapterId: number, tagKey: string, value: unknown, intentIds: number[]) {
  return executeOtDeviceWrite({
    input: lenh(adapterId, tagKey, value, `mlk-${adapterId}-${tagKey}`),
    driver: driverMatLienKet(),
    resolved: [{ write: { tagKey, value }, address: "coil:1", dataType: "int" }],
    driverWrites: [{ tagKey, address: "coil:1", value, dataType: "int" }],
    timeoutMs: 5000,
    stopTyped: true,
    bumpStopEpoch: false,
    ledger: { intentIds, confirmedBy: 1 },
  });
}

describe("R1b-2b-1 T17 fix round 1 — gộp mục rủi ro lệnh ghi cũ, không làm yếu", () => {
  afterEach(() => _sweepStaleWriteRiskForTests(Number.POSITIVE_INFINITY));

  it("mục ĐANG GIỮ (B3, hạn ∞) rồi huỷ vì mất liên kết ⇒ hạn VẪN ∞; writes + intent của CẢ HAI", async () => {
    const id = 992_001;
    const nha = _ghiRuiRoGhiCuForTests(lenh(id, "toc_do", 50, "b3"), { intentIds: [11], confirmedBy: 1 }, "giu");
    expect(_staleWriteRiskForTests(id)!.until).toBe(Number.POSITIVE_INFINITY);
    const ex = await huyViMatLienKet(id, "dung", 1, [22]);
    expect(ex.outcomes[0].status).toBe("timeout");
    const r = _staleWriteRiskForTests(id)!;
    expect(r.until).toBe(Number.POSITIVE_INFINITY);
    expect(r.intentIds).toEqual([11, 22]);
    expect(r.writes).toEqual([
      { tagKey: "toc_do", value: 50 },
      { tagKey: "dung", value: 1 },
    ]);
    nha();
    // giữ nhả SAU khi gộp ⇒ mục gộp KHÔNG mất, hạn hữu hạn, còn cả hai
    const sau = _staleWriteRiskForTests(id)!;
    expect(Number.isFinite(sau.until)).toBe(true);
    expect(sau.until).toBeGreaterThan(Date.now());
    expect(sau.intentIds).toEqual([11, 22]);
    expect(sau.writes).toHaveLength(2);
  });

  it("mục có hạn MUỘN HƠN rồi một lần huỷ có hạn sớm hơn ⇒ giữ hạn muộn", async () => {
    const id = 992_002;
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = new Date("2026-10-27T10:00:00Z").getTime();
    vi.setSystemTime(t0 + 30_000);
    await huyViMatLienKet(id, "a", 1, [31]); // hạn = t0 + 30 s + cửa sổ
    const muon = _staleWriteRiskForTests(id)!.until;
    vi.setSystemTime(t0); // lần sau mang hạn sớm hơn (đồng hồ khác / cửa sổ ngắn hơn)
    await huyViMatLienKet(id, "b", 0, [32]);
    const r = _staleWriteRiskForTests(id)!;
    expect(r.until).toBe(muon);
    expect(r.intentIds).toEqual([31, 32]);
    expect(r.writes.map((w) => w.tagKey)).toEqual(["a", "b"]);
  });

  it("HAI lượt giữ chồng nhau: nhả lượt đầu ⇒ vẫn ∞ (lượt kia còn đặt lại phiên); nhả lượt sau ⇒ hữu hạn; không lượt nào đè mục", () => {
    const id = 992_003;
    const nhaA = _ghiRuiRoGhiCuForTests(lenh(id, "x", 1, "A"), { intentIds: [41], confirmedBy: 1 }, "giu");
    const nhaB = _ghiRuiRoGhiCuForTests(lenh(id, "y", 2, "B"), { intentIds: [42], confirmedBy: 1 }, "giu");
    nhaA();
    expect(_staleWriteRiskForTests(id)!.until).toBe(Number.POSITIVE_INFINITY);
    nhaB();
    const r = _staleWriteRiskForTests(id)!;
    expect(Number.isFinite(r.until)).toBe(true);
    expect(r.intentIds).toEqual([41, 42]);
  });

  it("đối chứng: adapter chưa có mục ⇒ huỷ vì mất liên kết tạo mục hữu hạn chỉ của nó", async () => {
    const id = 992_004;
    await huyViMatLienKet(id, "z", 1, [51]);
    const r = _staleWriteRiskForTests(id)!;
    expect(Number.isFinite(r.until)).toBe(true);
    expect(r.intentIds).toEqual([51]);
    expect(r.writes).toEqual([{ tagKey: "z", value: 1 }]);
  });
});
