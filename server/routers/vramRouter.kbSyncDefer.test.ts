/**
 * ★★★ Pha 4 Task 1 — I-1 (review): **HỘ THỨ SÁU (`cron:kb-sync`) PHẢI CÓ LƯỚI THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — MỘT ĐỘT BIẾN ĐÃ SỐNG SÓT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Reviewer cắt hẳn lượt đọc `getKbSyncSchedulerStatus().defer` trong `vramReadModel.docSauHo()` ⇒
 * hộ `cron:kb-sync` **luôn** khai "không có chuỗi hoãn" ⇒ **722/722 XANH, 0 ĐỎ**. Năm hộ kia có
 * lưới thật (đi qua `xinVramCoHoan()`); hộ thứ sáu — **hàng số 1 của bảng "đồng hồ không kim"**,
 * thứ cả Pha 4 sinh ra để đóng — chỉ được khẳng định ở chiều "rỗng", tức một sợi dây **chưa ai đo**.
 *
 * Ca dưới đây đẩy `kbSyncScheduler` vào một chuỗi hoãn **THẬT** qua `runKbSyncNow()` (đường sản
 * xuất: cổng VRAM từ chối → `ghiNhanKbSyncBiTuChoi()` → `deferStreak`), rồi đọc payload của
 * **router thật**. Cắt sợi dây ấy ⇒ ca ĐỎ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO FILE RIÊNG (cùng lý do với `vramRouter.unledgered.test.ts`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bắt cổng VRAM TỪ CHỐI cần thay `beginVramAllocation` — một `vi.mock` phủ **cả file**. Trộn vào
 * file chính là bắt mọi ca khác chạy dưới một cổng cấp phát luôn từ chối.
 * ⚠ `importActual` giữ **mọi export khác** của `vramWiring` là hàng THẬT (`vramBeginFailureState`,
 * `vramUnledgeredFact` — thứ mặt đọc gọi), nên chỉ đúng MỘT hành vi bị thay.
 * ⚠ KHÔNG dùng `vi.resetModules()`: `await import()` trong mã sản xuất sẽ trả một **bản sao khác**
 * và chuỗi hoãn ta vừa dựng sẽ nằm ở một module khác với module router đọc.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.hoisted(() => {
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
import { runKbSyncNow, getKbSyncSchedulerStatus, __resetKbSyncDeferForTests } from "../services/kbSyncScheduler";
import * as broker from "../services/vram/vramBroker";
import { __resetDecisionTickForTests } from "../services/vram/vramTickCell";
import { __resetSharedLedgerForTests } from "../services/vram/vramSharedLedger";

function caller() {
  return vramRouter.createCaller({ user: { id: 1, role: "admin", name: "Tester" } } as never);
}

beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetKbSyncDeferForTests();
});
afterEach(() => {
  // Gỡ hẹn giờ 15 phút mà chuỗi hoãn vừa vũ trang — một hẹn giờ mồ côi là một ô trạng thái nói dối.
  __resetKbSyncDeferForTests();
});

describe("vramRouter.state — hộ `cron:kb-sync` (cơ chế hoãn RIÊNG) phải hiện ra ĐÚNG chuỗi đang sống", () => {
  it("★★★ một chuỗi hoãn THẬT (qua `runKbSyncNow()`) ⇒ `deferring` + `attempts` + `firstRefusedAt` + ngân sách CỦA CHUỖI", async () => {
    // Đường sản xuất: cổng VRAM từ chối ⇒ `ghiNhanKbSyncBiTuChoi()` dựng chuỗi hoãn.
    const stats = await runKbSyncNow();
    expect(stats.reason, "cổng VRAM phải từ chối ⇒ đây là ca dựng chuỗi hoãn").toBe("vram_refused");

    // Nguồn THẬT đã có chuỗi — nếu không, ca dưới sẽ xanh vì lý do sai.
    const nguon = getKbSyncSchedulerStatus().defer;
    expect(nguon, "chuỗi hoãn chưa được dựng ⇒ ca này không đo được gì").not.toBeNull();

    const s = await caller().state();
    const kb = s.defer.hosts.find((d) => d.host === "cron:kb-sync")!;
    expect(kb.status.kind).toBe("deferring");
    if (kb.status.kind !== "deferring") throw new Error("chuỗi hoãn đang sống");
    expect(kb.status.owner).toBe("cron:kb-sync");
    expect(kb.status.attempts).toBe(1);
    expect(kb.status.firstRefusedAt).toBe(nguon!.firstRefusedAt);
    expect(kb.status.nextRetryAt).toBe(nguon!.nextRetryAt);
    // ★ M-7 — ngân sách CHỐT LÚC BỊ TỪ CHỐI (không phải cấu hình hiện tại).
    expect(kb.status.chainBudgetMs).toBe(nguon!.budgetMs);
    // ⚠ `hostedHere` vẫn nói đúng chỗ đứng: cron chưa đăng ký trong tiến trình test.
    expect(kb.hostedHere).toBe(false);
  });

  it("★★ lượt từ chối THỨ HAI ⇒ `attempts` tăng (ô này theo được chuỗi, không phải một cờ)", async () => {
    await runKbSyncNow();
    await runKbSyncNow();
    const s = await caller().state();
    const kb = s.defer.hosts.find((d) => d.host === "cron:kb-sync")!;
    if (kb.status.kind !== "deferring") throw new Error("chuỗi hoãn đang sống");
    expect(kb.status.attempts).toBe(2);
  });

  it("đối chứng — CHƯA có lượt nào bị từ chối ⇒ KHÔNG khai `deferring`, và vẫn nói rõ không quan sát được", async () => {
    const s = await caller().state();
    const kb = s.defer.hosts.find((d) => d.host === "cron:kb-sync")!;
    expect(kb.status.kind).toBe("not-observable-here");
    if (kb.status.kind !== "not-observable-here") throw new Error("cron chưa đăng ký ở tiến trình test");
    expect(kb.status.meaning).toBe("host-not-running-in-this-process");
  });
});
