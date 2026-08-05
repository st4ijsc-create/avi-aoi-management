/**
 * ★★★ Pha 4 Task 2 — **`retryDeferred` TRÊN HỘ DUY NHẤT CÓ CƠ CHẾ THẬT (`cron:kb-sync`).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO FILE RIÊNG (cùng lý do với `vramRouter.kbSyncDefer.test.ts`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dựng một chuỗi hoãn THẬT đòi cổng VRAM **TỪ CHỐI**, tức thay `beginVramAllocation` — một
 * `vi.mock` phủ **cả file**. Trộn vào bộ ca chính là bắt mọi ca khác chạy dưới một cổng cấp phát
 * luôn từ chối. `importActual` giữ mọi export khác của `vramWiring` là hàng THẬT.
 *
 * ⚠⚠ LƯỚI ĐI THEO ĐƯỜNG THOÁT: chuỗi hoãn ở đây do **`runKbSyncNow()` thật** dựng
 * (`ghiNhanKbSyncBiTuChoi` → `deferStreak` → `armDeferTimer`), và lệnh đi qua **router thật**. Ca
 * ★★★ khoá đúng thứ mà một lệnh "im lặng thành công" sẽ phá: **hẹn giờ có thật sự bị DỜI không**
 * (`__hasKbSyncDeferTimer()` + `nextRetryAt` trước/sau), chứ không chỉ một chuỗi `outcome`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.KB_AUTOSYNC_ENABLED = "true";
  // Cổng eval TẮT ⇒ `runKbSyncNow()` không chụp ảnh KB trên đĩa; ta chỉ cần tới cổng VRAM.
  process.env.KB_AUTOSYNC_EVAL_GATE = "false";
});

vi.mock("../services/vram/vramWiring", async (importActual) => {
  const actual = await importActual<typeof import("../services/vram/vramWiring")>();
  const { buildVramRefusal, VramRefusedError } = await import("../services/vram/vramRefusal");
  return {
    ...actual,
    beginVramAllocation: async (opts: { owner: string; priority: "background" }) => {
      throw new VramRefusedError(
        buildVramRefusal({
          requestedBytes: 1251 * 1024 * 1024,
          owner: opts.owner,
          priority: opts.priority,
          headroomBytes: 0,
          degradedReasons: [],
          blind: false,
          ledgerTotalBytes: 0,
          foreignLedgerBytes: 0,
          usedBytes: 0,
          holders: [],
          preemptable: [],
          unledgered: { bytes: 0, unknownCount: 0 },
          slotsNeeded: 0,
        }),
      );
    },
  };
});
vi.mock("../services/vram/vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
  __vramDroppedEventCount: () => 0,
}));

import { vramRouter } from "./vramRouter";
import {
  __hasKbSyncDeferTimer,
  __resetKbSyncDeferForTests,
  getKbSyncSchedulerStatus,
  runKbSyncNow,
  startKbSyncScheduler,
  stopKbSyncScheduler,
} from "../services/kbSyncScheduler";
import * as broker from "../services/vram/vramBroker";
import { __resetDecisionTickForTests } from "../services/vram/vramTickCell";
import { __resetSharedLedgerForTests } from "../services/vram/vramSharedLedger";

const admin2fa = { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true };

function caller() {
  return vramRouter.createCaller({
    user: admin2fa,
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
    sessionToken: "t",
  } as never);
}

beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetKbSyncDeferForTests();
  delete process.env.KB_SYNC_MAX_DEFER_HOURS;
});
afterEach(() => {
  stopKbSyncScheduler();
  __resetKbSyncDeferForTests();
  delete process.env.KB_SYNC_MAX_DEFER_HOURS;
});

describe("vramRouter.retryDeferred — `cron:kb-sync`, hộ DUY NHẤT có cơ chế đánh thức từ ngoài", () => {
  it("★★★ chủ trì ở đây + chuỗi hoãn ĐANG SỐNG ⇒ DỜI hẹn giờ về ngay, qua ĐÚNG `armDeferTimer()`", async () => {
    startKbSyncScheduler();
    expect(getKbSyncSchedulerStatus().hostedHere, "cron phải được đăng ký ở tiến trình test").toBe(true);

    const stats = await runKbSyncNow();
    expect(stats.reason, "cổng VRAM phải từ chối ⇒ đây là ca dựng chuỗi hoãn").toBe("vram_refused");
    const truoc = getKbSyncSchedulerStatus().defer;
    expect(truoc, "chuỗi hoãn chưa dựng ⇒ ca này không đo được gì").not.toBeNull();
    expect(__hasKbSyncDeferTimer(), "đường sản xuất phải đã vũ trang một hẹn giờ 15 phút").toBe(true);

    const r = await caller().retryDeferred({ owner: "cron:kb-sync" });

    expect(r.outcome).toBe("retry-armed");
    expect(r.reason).toBeNull();
    expect(r.hostedHere).toBe(true);
    expect(r.host).toBe("cron:kb-sync");
    expect(r.attempts).toBe(1);
    // Hạn CŨ được nêu ra — người đọc thấy lệnh đã dời cái gì, không phải một lời "đã làm".
    expect(r.previousNextRetryAt).toBe(truoc!.nextRetryAt);
    // ⚠ Ngân sách KHÔNG được nới: chuỗi vẫn đếm từ lượt từ chối ĐẦU TIÊN.
    expect(getKbSyncSchedulerStatus().defer!.firstRefusedAt).toBe(truoc!.firstRefusedAt);
  });

  it("★★★ chuỗi ĐÃ QUÁ ĐÁY ⇒ TỪ CHỐI vũ trang lại (cơ chế chống-hoãn-mãi không được tự phá)", async () => {
    process.env.KB_SYNC_MAX_DEFER_HOURS = "0"; // "đừng hoãn, kêu ngay"
    startKbSyncScheduler();
    await runKbSyncNow();
    expect(getKbSyncSchedulerStatus().defer!.exceeded).toBe(true);

    const r = await caller().retryDeferred({ owner: "cron:kb-sync" });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("defer-budget-exceeded");
    expect(r.hostedHere).toBe(true);
    expect(r.attempts).toBe(1);
    expect(__hasKbSyncDeferTimer(), "một chuỗi đã tuyên bố quá đáy KHÔNG được hẹn giờ lại").toBe(false);
  });

  it("chủ trì ở đây nhưng KHÔNG có chuỗi hoãn nào ⇒ TỪ CHỐI, và nói rõ là không có chuỗi", async () => {
    startKbSyncScheduler();
    const r = await caller().retryDeferred({ owner: "cron:kb-sync" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("no-defer-chain-in-this-process");
    expect(r.hostedHere).toBe(true);
  });

  it("★★★ ĐỘT BIẾN GHIM: cron đã DỪNG ⇒ `host-not-running-in-this-process`, KHÔNG hẹn giờ nào bị đụng", async () => {
    startKbSyncScheduler();
    await runKbSyncNow();
    stopKbSyncScheduler(); // ← tiến trình này thôi chủ trì (ở sản xuất: `api` chưa bao giờ chủ trì)

    const r = await caller().retryDeferred({ owner: "cron:kb-sync" });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("host-not-running-in-this-process");
    expect(r.hostedHere).toBe(false);
    expect(__hasKbSyncDeferTimer()).toBe(false);
  });
});
