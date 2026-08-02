import { describe, it, expect, beforeEach, vi } from "vitest";
import { reserve, commit, release, snapshot, __resetBrokerForTests } from "./vramBroker";

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
});
