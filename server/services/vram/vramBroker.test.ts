import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  reserve as reserveRaw, commit, release, snapshot, deviceTotalBytes, noteDeviceTotalBytes,
  markMeasureFailed, __resetBrokerForTests,
} from "./vramBroker";
import { __freshSharedLedgerFactForTests } from "./vramSharedLedger";


/**
 * ★★★ Pha 2B Task 5 — `reserve()` NAY ĐÒI NGỮ CẢNH QUYẾT ĐỊNH (ô tick · ống ngoài sổ · đồng hồ).
 *
 * Lớp bọc dưới đây truyền một ngữ cảnh **SẠCH** (có số, nền đã xác minh, vừa chạy, ống ngoài sổ đã
 * hỏi và rỗng) cho các ca CŨ, và đó là một lựa chọn có chủ đích: những ca này sinh ra để kiểm SỔ
 * CÁI và THƯỚC ĐO, không phải để kiểm cưỡng chế. Truyền một ngữ cảnh suy giảm vào đây sẽ làm chúng
 * đỏ vì một lý do chẳng liên quan gì tới thứ chúng đang canh. Cưỡng chế có bộ ca RIÊNG:
 * `enforcement.test.ts`.
 */
function ctxSachChoCaCu(): import("./vramBroker").VramDecisionContext {
  const now = Date.now();
  return {
    tick: { attributableBytes: 0, baselineVerified: true, atMs: now, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    sharedLedger: __freshSharedLedgerFactForTests(),
    nowMs: now,
  };
}
const reserve = (r: import("./types").VramReserveRequest) => reserveRaw(r, ctxSachChoCaCu());

const MIB = 1024 * 1024;

function req(owner: string, bytes: number, priority: "production" | "interactive" | "background" = "interactive") {
  return { owner, kind: "gguf-model" as const, estimatedBytes: bytes, priority };
}

describe("vramBroker — sổ cái", () => {
  beforeEach(() => {
    // ★ Task 7 — bộ ca NÀY canh SỔ CÁI và THƯỚC ĐO, không canh trần ĐẾM mới. Xem
    // `consolidation.test.ts` cho trần `GGUF_MAX_LOADED_MODELS`.
    process.env.GGUF_MAX_LOADED_MODELS = "64";
    __resetBrokerForTests();
  });

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

  /**
   * ★★★ Pha 2B Task 5 — CA NÀY ĐÃ ĐỔI CHIỀU, và đó là toàn bộ nội dung của task.
   *
   * Bản Pha 1 khẳng định *"KHÔNG BAO GIỜ từ chối, kể cả khi vượt trần"* (cấp giấy phép + bật cờ
   * `wouldRefuse` như một phán quyết BÓNG). Từ Task 5, `wouldRefuse` KHÔNG còn là bóng: nó luôn
   * bằng `lease === null`. Giữ nguyên ca cũ ở đây sẽ là một cái lưới KHOÁ CHÍNH SÁCH ĐÃ CHẾT vào
   * hợp đồng — đúng lớp lỗi mà `aiGgufEngine.test.ts` khối "VRAM OOM fallback" đã mắc (Task 3):
   * nó XANH SUỐT trong khi đường lùi thật chưa bao giờ chạy.
   */
  it("PHA 2B: vượt trần ⇒ TỪ CHỐI THẬT (không còn phán quyết bóng)", () => {
    reserve(req("gguf:A", 30_000 * MIB));
    const r = reserve(req("gguf:B", 30_000 * MIB));
    expect(r.lease).toBeNull();          // KHÔNG cấp
    expect(r.wouldRefuse).toBe(true);
    expect(r.refusal).not.toBeNull();    // và nói ra được VÌ SAO (bốn thứ §5.3)
    // Sổ KHÔNG được cộng gì cho lượt bị từ chối — nếu cộng, lượt xin sau bị từ chối trên BYTE MA.
    expect(snapshot().totalReservedBytes).toBe(30_000 * MIB);
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
