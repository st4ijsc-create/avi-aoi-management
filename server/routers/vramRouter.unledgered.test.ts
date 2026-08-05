/**
 * ★★★ Pha 4 Task 1 — **`unledgeredBytes` LÀ ƯỚC LƯỢNG, VÀ `unknownCount > 0` LÀM NÓ MẤT TIN CẬY.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO FILE RIÊNG (và đây là một quyết định, không phải cho gọn)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ô `unknownCount` chỉ lớn lên khi `beginVramAllocation()` **HỎNG THẬT**, và đường hỏng duy nhất
 * đi qua được từ bộ test là làm `vramEstimator.estimateBytesFor()` ném. Một `vi.mock` như thế
 * phủ **cả file** ⇒ trộn vào `vramRouter.test.ts` là bắt mọi ca khác chạy dưới một ống cấp phát
 * đã hỏng — tức đo một hệ khác với hệ đang chạy.
 *
 * ⚠ VÀ NÓ ĐI THEO **ĐƯỜNG THOÁT**, không theo file: ca dưới đây gọi `beginVramAllocation()` THẬT
 * (mã sản xuất), để nó rơi vào `catch` cuối hàm THẬT, rồi đọc payload của router THẬT. Không ca
 * nào tự đặt `unknownCount` bằng tay.
 *
 * BẰNG CHỨNG đằng sau ràng buộc này (đã trả giá ba vòng ở Pha 2B): GGUF 30B `fileBytes`
 * **17.690.497.440 B** so với `actualBytes` đo được **17.511.354.368 B** ⇒ file **CAO HƠN
 * 170,8 MiB**; reranker thì **ngược 2,1 lần** ⇒ **KHÔNG có hệ số chung**. Con số ấy là một ƯỚC
 * LƯỢNG, và mọi hộ ONNX/sidecar/`gguf-context` đóng góp **0 byte** vào nó — chúng **chỉ** hiện ở
 * `unknownCount`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../services/vram/vramEstimator", () => ({
  estimateBytesFor: async () => {
    throw new Error("ước lượng hỏng (ca thử nghiệm)");
  },
  recordActual: () => {},
}));
vi.mock("../services/vram/vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));

import { vramRouter } from "./vramRouter";
import * as broker from "../services/vram/vramBroker";
import { __resetDecisionTickForTests, publishDecisionTick } from "../services/vram/vramTickCell";
import { __resetSharedLedgerForTests, publishSharedLedgerReplica, sharedLedgerSelfKey } from "../services/vram/vramSharedLedger";
import { __resetVramDeferForTests } from "../services/vram/vramDefer";
import { beginVramAllocation, __resetVramBeginFailureState } from "../services/vram/vramWiring";

const MIB = 1024 * 1024;
/** Đúng con số của GGUF 30B trong bằng chứng ở đầu file — `fileBytes`, tức CẬN TRÊN đo được. */
const FILE_BYTES_30B = 17_690_497_440;

function caller() {
  return vramRouter.createCaller({ user: { id: 1, role: "admin", name: "Tester" } } as never);
}

beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  __resetVramBeginFailureState();
});

describe("vramRouter.state — ống 'chạy NGOÀI SỔ' phơi ra ĐÚNG độ chắc chắn của nó", () => {
  it("★★★ có `fileBytes` ⇒ ƯỚC LƯỢNG được, `unknownCount === 0` ⇒ `estimateUsable === true`", async () => {
    const t = await beginVramAllocation({
      owner: "gguf:qwen30b",
      kind: "gguf-model",
      priority: "interactive",
      fileBytes: FILE_BYTES_30B,
    });
    t.release();

    const s = await caller().state();
    expect(s.unledgered.beginFailureCount).toBe(1);
    expect(s.unledgered.lastReason).toMatch(/ước lượng hỏng/);
    expect(s.unledgered.estimateBytes).toBe(FILE_BYTES_30B);
    expect(s.unledgered.unknownCount).toBe(0);
    expect(s.unledgered.estimateUsable).toBe(true);
    // ⚠ VẪN là ƯỚC LƯỢNG, kể cả khi dùng được: nhãn KHÔNG BAO GIỜ đổi thành "measurement".
    expect(s.unledgered.estimateKind).toBe("estimate");
  });

  it("★★★ CHIỀU KIA — một lượt hỏng KHÔNG ước được byte ⇒ `unknownCount > 0` ⇒ `estimateUsable === false` + caveat 'không đáng tin'", async () => {
    // (1) một lượt CÓ `fileBytes` — sinh ra con số ước lượng;
    (await beginVramAllocation({ owner: "gguf:qwen30b", kind: "gguf-model", priority: "interactive", fileBytes: FILE_BYTES_30B })).release();
    // (2) một lượt KHÔNG có căn cứ nào để ước — đây là hộ `gguf-context`, đóng góp 0 byte.
    (await beginVramAllocation({ owner: "gguf-ctx:x", kind: "gguf-context", priority: "interactive" })).release();

    const s = await caller().state();
    expect(s.unledgered.beginFailureCount).toBe(2);
    // Con số KHÔNG lớn lên (một `0` giả sẽ để cuốn sổ hụt tự khai là đủ)…
    expect(s.unledgered.estimateBytes).toBe(FILE_BYTES_30B);
    // …nhưng nó đã MẤT TIN CẬY, và API nói ra điều đó ở HAI ô độc lập.
    expect(s.unledgered.unknownCount).toBe(1);
    expect(s.unledgered.estimateUsable).toBe(false);
    expect(s.unattributed.caveat).toBe("vramUnattributedUnreliable");
    expect(s.headroom.degradedReasons).toContain("unledgered-unknown");
  });

  it("★★ `unknownCount > 0` THẮNG cả khi sổ đã giải thích hết phần thiết bị (caveat không bị nhánh khác cướp)", async () => {
    (await beginVramAllocation({ owner: "gguf-ctx:x", kind: "gguf-context", priority: "interactive" })).release();
    // Sổ giải thích hết: thiết bị = 0, sổ = 0, tick tươi, nền đã xác minh, sổ chung tươi.
    publishDecisionTick({ attributableBytes: 0, baselineVerified: true }, Date.now());
    publishSharedLedgerReplica([], Date.now(), sharedLedgerSelfKey());

    const s = await caller().state();
    expect(s.unattributed.bytes).toBe(0);
    expect(s.unledgered.unknownCount).toBe(1);
    expect(s.unattributed.caveat).toBe("vramUnattributedUnreliable");
    expect(s.unledgered.estimateUsable).toBe(false);
  });

  it("đối chứng — KHÔNG lượt nào hỏng ⇒ đếm 0, ước lượng 0, và caveat KHÔNG phải 'không đáng tin'", async () => {
    publishDecisionTick({ attributableBytes: 0, baselineVerified: true }, Date.now());
    publishSharedLedgerReplica([], Date.now(), sharedLedgerSelfKey());
    const s = await caller().state();
    expect(s.unledgered.beginFailureCount).toBe(0);
    expect(s.unledgered.unknownCount).toBe(0);
    expect(s.unledgered.estimateUsable).toBe(true);
    expect(s.unattributed.caveat).not.toBe("vramUnattributedUnreliable");
    expect(s.unattributed.caveat).toBe("vramLedgerCoverageOnly");
    void MIB;
  });
});
