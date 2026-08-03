import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  reserve, commit, release, snapshot, deviceTotalBytes, noteDeviceTotalBytes,
  markMeasureFailed, __resetBrokerForTests,
} from "./vramBroker";

const MIB = 1024 * 1024;

function req(owner: string, bytes: number, priority: "production" | "interactive" | "background" = "interactive") {
  return { owner, kind: "gguf-model" as const, estimatedBytes: bytes, priority };
}

describe("vramBroker — sổ cái", () => {
  beforeEach(() => __resetBrokerForTests());

  it("cấp giấy phép và cộng vào tổng đã cấp", () => {
    const r = reserve(req("gguf:A", 100 * MIB));
    expect(r.lease).not.toBeNull();
    expect(snapshot().totalReservedBytes).toBe(100 * MIB);
  });

  it("commit thay ước lượng bằng SỐ THẬT trong tổng", () => {
    const r = reserve(req("gguf:A", 100 * MIB));
    commit(r.lease!, 137 * MIB);
    expect(snapshot().totalReservedBytes).toBe(137 * MIB);
  });

  it("release trả chỗ", () => {
    const r = reserve(req("gguf:A", 100 * MIB));
    release(r.lease!);
    expect(snapshot().totalReservedBytes).toBe(0);
  });

  it("release HAI LẦN bằng release MỘT LẦN (bất biến)", () => {
    const a = reserve(req("gguf:A", 100 * MIB));
    const b = reserve(req("gguf:B", 50 * MIB));
    release(a.lease!);
    release(a.lease!);
    expect(snapshot().totalReservedBytes).toBe(50 * MIB);
    expect(snapshot().leases.length).toBe(1);
    expect(snapshot().leases[0].request.owner).toBe("gguf:B");
    // Cờ `released` trên CHÍNH đối tượng lease phải được set true — nếu chỉ dựa vào
    // việc xoá khỏi sổ (ledger.delete) thì bất biến "gọi 2 lần = gọi 1 lần" vẫn đúng
    // NHỜ side-effect khác, che giấu việc dòng gán cờ bị xoá mất (lưới giả).
    expect(a.lease!.released).toBe(true);
    void b;
  });

  it("PHA 1: KHÔNG BAO GIỜ từ chối, kể cả khi vượt trần", () => {
    reserve(req("gguf:A", 30_000 * MIB));
    const r = reserve(req("gguf:B", 30_000 * MIB));
    expect(r.lease).not.toBeNull();      // vẫn cấp
    expect(r.wouldRefuse).toBe(true);    // nhưng ghi nhận là SẼ từ chối ở Pha 2
  });

  it("wouldPreempt nêu ĐÚNG các giấy phép nền có thể nhường", () => {
    reserve(req("bg:kb-sync", 20_000 * MIB, "background"));
    reserve(req("prod:aoi", 10_000 * MIB, "production"));
    const r = reserve(req("gguf:big", 10_000 * MIB, "interactive"));
    expect(r.wouldRefuse).toBe(true);
    expect(r.wouldPreempt).toEqual(["bg:kb-sync"]);   // KHÔNG được nêu prod:aoi
  });

  // ⚠ Tên test canh ĐÚNG PHẠM VI thật của nó: chỉ "đầu dò không bị gọi", KHÔNG PHẢI
  // "reserve() không I/O nói chung". Đã thử: chèn fs.readFileSync(__filename) thẳng vào
  // reserve() (I/O THẬT, không qua vramProbe) — test này vẫn XANH, không bắt được.
  // Bảo đảm "không I/O" rộng hơn nằm ở CẤU TRÚC mã (xem JSDoc reserve() trong vramBroker.ts:
  // hàm đồng bộ, không async, không import fs/net/child_process), không phải ở test này.
  it("reserve KHÔNG gọi đầu dò thiết bị (vramProbe.readDeviceVram)", async () => {
    const probe = await import("./vramProbe");
    const spy = vi.spyOn(probe, "readDeviceVram");
    reserve(req("gguf:A", 100 * MIB));
    expect(spy).not.toHaveBeenCalled();
  });

  /**
   * I-3 (review TOÀN NHÁNH) — trần thiết bị phải là SỐ ĐO, hằng số chỉ là dự phòng.
   * Bản trước ghim `32607` MiB (dung lượng RTX 5090 của MỘT máy) làm mặc định TOÀN ĐỘI, trong
   * khi `vramProbe.probeOnce()` đã đọc `totalBytes` từ thiết bị ở đúng dòng `:72` rồi vứt đi.
   */
  describe("I-3 — trần thiết bị: số ĐO thắng hằng số dự phòng", () => {
    it("chưa đo được ⇒ dùng trần dự phòng 32.607 MiB", () => {
      expect(deviceTotalBytes()).toBe(32_607 * MIB);
    });

    it("đầu dò báo trần THẬT ⇒ trần đổi theo, và headroom tính trên trần mới", () => {
      // Một máy 8 GiB (laptop) — trần dự phòng của RTX 5090 sai gấp bốn lần trên máy này.
      noteDeviceTotalBytes(8 * 1024 * MIB);
      expect(deviceTotalBytes()).toBe(8 * 1024 * MIB);

      // headroom = 8192 − SAFETY_RESERVE(1024) − sổ(0) = 7168 ⇒ xin 7500 MiB PHẢI bị đánh dấu
      // "sẽ từ chối ở Pha 2". Với trần dự phòng 32.607 thì nó lọt — đó chính là dữ liệu bóng
      // sai mà Pha 2 sẽ cưỡng chế trên đó.
      expect(reserve(req("gguf:big", 7_500 * MIB)).wouldRefuse).toBe(true);
    });

    it("số vô lý (0/NaN) KHÔNG được ghi đè trần đang dùng", () => {
      noteDeviceTotalBytes(8 * 1024 * MIB);
      noteDeviceTotalBytes(0);
      noteDeviceTotalBytes(Number.NaN);
      expect(deviceTotalBytes()).toBe(8 * 1024 * MIB);
    });
  });

  /**
   * ★ Pha 2A Task 3 — `commit()` nay khai THƯỚC đã đẻ ra con số (`VramMeasureSource`).
   * Mặc định `"device-delta"` CÓ CHỦ Ý: mọi lời gọi CŨ đo bằng `used` toàn thiết bị, và một con
   * số "không rõ nguồn" là thứ mời người sau đem so với số của bộ đếm (Đ4 cấm).
   */
  describe("Pha 2A — commit() ghi THƯỚC vào giấy phép", () => {
    it("khai nguồn tường minh ⇒ giấy phép giữ đúng nguồn đó", () => {
      const r = reserve(req("gguf:A", 100 * MIB));
      commit(r.lease!, 137 * MIB, "process-delta");
      expect(snapshot().leases[0].measureSource).toBe("process-delta");
    });

    it("KHÔNG khai nguồn ⇒ mặc định 'device-delta' (mọi lời gọi cũ đo bằng thước thiết bị)", () => {
      const r = reserve(req("gguf:A", 100 * MIB));
      commit(r.lease!, 137 * MIB);
      expect(snapshot().leases[0].measureSource).toBe("device-delta");
    });

    it("đo hỏng ⇒ nguồn về 'none', không giữ nguồn của một lượt commit trước", () => {
      const r = reserve(req("gguf:A", 100 * MIB));
      commit(r.lease!, 137 * MIB, "process-delta");
      markMeasureFailed(r.lease!);
      expect(snapshot().leases[0].measureSource).toBe("none");
    });
  });
});
