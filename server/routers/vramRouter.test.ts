/**
 * ★★★ Pha 4 Task 1 — ROUTER ĐỌC: **MỖI TRƯỜNG PHẢI NÓI ĐÚNG ĐỘ CHẮC CHẮN CỦA NÓ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LƯỚI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE (ràng buộc 5, đã tái diễn MƯỜI lần)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * File này **KHÔNG giả một module nào**. Nó dựng trạng thái bằng **đúng những ô mà mã sản xuất
 * ghi vào** — `vramBroker.reserve()`, `vramTickCell.publishDecisionTick()`,
 * `vramSharedLedger.publishSharedLedgerReplica()`, `vramDefer.xinVramCoHoan()` — rồi gọi
 * **router THẬT** qua `createCaller()` và đọc **đúng object mã sản xuất gửi đi**. Không ca nào
 * tự đặt một con số rồi khẳng định lại chính con số đó.
 *
 * ⚠ `unknownCount > 0` cần một lượt `beginVramAllocation()` HỎNG THẬT ⇒ phải giả `vramEstimator`
 * ⇒ nằm ở **FILE RIÊNG** (`vramRouter.unledgered.test.ts`). Trộn vào đây là bắt mọi ca khác chạy
 * dưới một ống cấp phát đã hỏng.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { vramRouter } from "./vramRouter";
import { readAppErrorMeta } from "../_core/appError";
import * as broker from "../services/vram/vramBroker";
import { __resetDecisionTickForTests, publishDecisionTick, __tickFieldsForTests } from "../services/vram/vramTickCell";
import {
  __resetSharedLedgerForTests,
  __setSharedLedgerSelfKeyForTests,
  publishSharedLedgerReplica,
  sharedLedgerSelfKey,
  type SharedLeaseRow,
} from "../services/vram/vramSharedLedger";
import { __resetVramDeferForTests, xinVramCoHoan } from "../services/vram/vramDefer";
import { __resetVramBeginFailureState } from "../services/vram/vramWiring";
import { buildVramRefusal, VramRefusedError } from "../services/vram/vramRefusal";
import type { VramAgentState } from "../services/vram/vramReadModel";

const MIB = 1024 * 1024;

function caller(user: unknown = { id: 1, role: "admin", name: "Tester" }) {
  return vramRouter.createCaller({ user } as never);
}

/**
 * ★★★ Pha 5 Task 2 (N8) — **VAI ĐĂNG NHẬP MÀ KHÔNG CÓ MỘT BIT `machine_control` NÀO.**
 *
 * Cả hai qua được `protectedProcedure` (`_core/trpc.ts:171` chỉ đòi có `ctx.user`) — đó chính là
 * lỗ: mặt đọc phơi `processKey` / `owner` / tên model đang nạp, tức **thông tin hạ tầng**, và từ
 * Pha 3 thì `owner` có thể do **một tiến trình khác** ghi vào sổ chung.
 *
 * ⚠ `checkPermission()` (`_core/accessControl.ts:129`) chỉ short-circuit cho `admin`; mọi role
 * khác phải có một hàng `permissions` cấp tường minh — và không ca nào ở đây cấp. Hai id dưới đây
 * dùng đúng hai id mà `vramRouter.commands.test.ts:95,98` đã dùng cho cùng chiều từ chối.
 */
const engineerKhongQuyen = { id: 3, role: "engineer", name: "Eng", twoFactorEnabled: true };
const operatorKhongQuyen = { id: 6, role: "operator", name: "Op", twoFactorEnabled: true };

/** Sổ chung: một hàng của **TIẾN TRÌNH KHÁC**. Hình dạng đúng bằng bảng `vram_leases`. */
function hangAnhEm(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return {
    leaseKey: "worker:999:1#lease-7",
    processKey: "worker:999:1",
    pid: 999,
    role: "worker",
    leaseId: "lease-7",
    owner: "gguf:qwen30b",
    leaseKind: "gguf-model",
    priority: "background",
    bytes: 17_000 * MIB,
    measured: true,
    refCount: 0,
    reclaimer: "gguf-idle-model",
    acquiredAtMs: 1,
    updatedAtMs: 1,
    ...over,
  };
}

/** Mọi ô TRẠNG THÁI TOÀN CỤC mà một ca có thể chạm tới. */
beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  __resetVramBeginFailureState();
});

/** Đi qua ĐÚNG đường thoát: một lượt `reserve()` thật ghi vào sổ cục bộ. */
function xinThat(owner: string, bytes: number, priority: "background" | "production" = "background") {
  return broker.reserve(
    { owner, kind: "gguf-model", estimatedBytes: bytes, priority, reclaimer: "gguf-idle-model" },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 5 Task 2 (N8) — HAI MẶT ĐỌC PHẢI TRẢ LỜI CÙNG MỘT MỨC QUYỀN
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("vramRouter.state — mặt đọc tRPC đòi ĐÚNG mức quyền của tool `get_vram_state`", () => {
  /**
   * ⚠⚠ **MỘT CA, HAI CHIỀU, CÙNG MỘT TRẠNG THÁI ĐÃ DỰNG.** Tách đôi thì lượt **bị từ chối** và
   * lượt **được phép** có thể **cùng rỗng** mà ca vẫn xanh — đúng lớp lỗi đã để `215/215` xanh
   * suốt thời gian một tool chết. Ở đây chiều cho phép phải khai **con số cụ thể** dựng từ đúng
   * những ô mã sản xuất ghi vào (`reserve()` + `publishSharedLedgerReplica()`), nên "cùng rỗng"
   * **không viết ra được**.
   */
  it("★★★ vai KHÔNG có `machine_control/canView` ⇒ TỪ CHỐI; vai CÓ quyền ⇒ dữ liệu THẬT khác rỗng", async () => {
    __setSharedLedgerSelfKeyForTests("api:100:1");
    xinThat("gguf:local-model", 1_000 * MIB);
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1");

    // ── CHIỀU TỪ CHỐI ──────────────────────────────────────────────────────────────────────
    // `engineer` là vai ĐANG TỚI ĐƯỢC màn `/ai-brain` (`client/src/lib/navigation.tsx:1381`
    // requiredRole: ['admin','engineer']) ⇒ đây là chiều đắt nhất, không phải một vai giả định.
    await expect(caller(engineerKhongQuyen).state()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(operatorKhongQuyen).state()).rejects.toMatchObject({ code: "FORBIDDEN" });

    // ⚠ Từ chối phải đến từ ĐÚNG cái cổng này, không phải một FORBIDDEN bất kỳ: mã máy-đọc-được
    // phải gọi tên đúng `canView` — nếu không, một cổng khác chặn nhầm cũng làm ca xanh.
    const err = await caller(engineerKhongQuyen)
      .state()
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err, "phải NÉM, không được trả dữ liệu").not.toBeNull();
    expect(readAppErrorMeta(err)).toMatchObject({ appCode: "PERMISSION_DENIED", appParams: { action: "canView" } });

    // ── CHIỀU CHO PHÉP (ĐỐI CHỨNG DƯƠNG CÓ RĂNG) ───────────────────────────────────────────
    // CÙNG trạng thái vừa dựng ⇒ vai đủ quyền phải nhận **đúng những con số này**.
    const s: VramAgentState = await caller().state();
    expect(s.ledger.totalBytes).toBe(1_000 * MIB + 17_000 * MIB);
    expect(s.ledger.localHolders.map((h) => h.owner)).toContain("gguf:local-model");
    expect(s.ledger.foreign.known).toBe(true);
    if (!s.ledger.foreign.known) throw new Error("bản sao đã công bố ⇒ phải known");
    expect(s.ledger.foreign.bytes).toBe(17_000 * MIB);
    expect(s.ledger.foreign.holders.map((h) => h.owner)).toEqual(["gguf:qwen30b"]);
    // ⚠ Đúng ba trường mà quyết định siết dựa vào: `processKey`, `owner`, tên model đang nạp.
    expect(s.ledger.foreign.holders[0]!.processKey).toBe("worker:999:1");
    expect(s.ledger.foreign.holders[0]!.leaseKey).toBe("worker:999:1#lease-7");
    expect(s.defer.hosts).toHaveLength(6);
  });
});

describe("vramRouter.state — sổ chung: hộ CỤC BỘ và hộ của ANH EM phải PHÂN BIỆT ĐƯỢC", () => {
  it("hộ cục bộ có `processKey === null`; hộ anh em mang ĐÚNG `processKey` của tiến trình kia", async () => {
    __setSharedLedgerSelfKeyForTests("api:100:1");
    xinThat("gguf:local-model", 1_000 * MIB);
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1");

    const s: VramAgentState = await caller().state();

    expect(s.ledger.localHolders.map((h) => h.owner)).toContain("gguf:local-model");
    for (const h of s.ledger.localHolders) expect(h.processKey).toBeNull();

    expect(s.ledger.foreign.known).toBe(true);
    if (!s.ledger.foreign.known) throw new Error("bản sao đã công bố ⇒ phải known");
    expect(s.ledger.foreign.holders.map((h) => h.owner)).toEqual(["gguf:qwen30b"]);
    expect(s.ledger.foreign.holders[0]!.processKey).toBe("worker:999:1");
    expect(s.ledger.foreign.bytes).toBe(17_000 * MIB);
    // Tổng = cục bộ + chung, cùng phép cộng mà `reserve()` dùng.
    expect(s.ledger.totalBytes).toBe(1_000 * MIB + 17_000 * MIB);
  });

  it("★★★ CHƯA LÀM MỚI LẦN NÀO ⇒ `foreign.known === false` — KHÔNG được đọc thành 'không có anh em'", async () => {
    xinThat("gguf:local-model", 1_000 * MIB);
    const s = await caller().state();

    expect(s.ledger.foreign.known).toBe(false);
    if (s.ledger.foreign.known) throw new Error("chưa công bố ⇒ phải KHÔNG known");
    expect(s.ledger.foreign.meaning).toBe("never-refreshed-blind-to-siblings");
    // ⚠ Bất biến: KHÔNG có ô `bytes: 0` nào ở nhánh này — một số 0 là một lời KHẲNG ĐỊNH.
    expect(Object.hasOwn(s.ledger.foreign, "bytes")).toBe(false);
    expect(s.headroom.degradedReasons).toContain("shared-ledger-unasked");
  });

  it("★★ danh sách 'đang giữ' TỰ KHAI LÀ CẬN DƯỚI, và khai cả tỉ lệ bao phủ", async () => {
    const s = await caller().state();
    expect(s.unattributed.holderListIsLowerBound).toBe(true);
    expect(s.unattributed.wiredSiteCount).toBeGreaterThan(0);
    expect(s.unattributed.knownSiteRowCount).toBeGreaterThan(s.unattributed.wiredSiteCount!);
  });

  it("★★★ sổ RỖNG vẫn phải mang phần KHÔNG QUY TRÁCH NHIỆM ĐƯỢC (`caveat`)", async () => {
    const s = await caller().state();
    expect(s.unattributed.caveat).toBeTruthy();
    // Chưa có nhịp nào ⇒ MÙ ⇒ không đo được phần ngoài sổ. `null` ≠ `0`.
    expect(s.unattributed.bytes).toBeNull();
    expect(s.unattributed.caveat).toBe("vramUnattributedUnknownExtent");
  });

  it("★★ tuổi bản sao đọc + nhịp làm mới 60 s (ĐỘ TRỄ CƯỠNG CHẾ THẬT) phải KHAI RA", async () => {
    publishSharedLedgerReplica([], Date.now() - 5_000, sharedLedgerSelfKey());
    const s = await caller().state();
    if (!s.ledger.foreign.known) throw new Error("đã công bố ⇒ phải known");
    expect(s.ledger.foreign.ageMs).toBeGreaterThanOrEqual(5_000);
    expect(s.ledger.sharedRefreshIntervalMs).toBeGreaterThan(0);
    expect(s.ledger.sharedStaleAfterMs).toBeGreaterThan(0);
  });
});

describe("vramRouter.state — `attributable === null` là CHẶN TRÊN, không phải 'không biết' trung tính", () => {
  it("CHƯA có nhịp nào ⇒ `known:false` + `reason:'no-tick'` + nghĩa 'headroom-upper-bound'", async () => {
    const s = await caller().state();
    expect(s.attributable.known).toBe(false);
    if (s.attributable.known) throw new Error("chưa có tick ⇒ phải KHÔNG known");
    expect(s.attributable.meaning).toBe("headroom-upper-bound");
    expect(s.attributable.reason).toBe("no-tick");
    expect(s.headroom.basis).toBe("ledger-only");
    expect(s.headroom.blind).toBe(true);
    expect(s.tick.present).toBe(false);
  });

  it("CÓ nhịp nhưng nhịp đó không tính được ⇒ `reason:'probe-blind'` (KHÁC 'no-tick')", async () => {
    publishDecisionTick(__tickFieldsForTests(null, true), Date.now());
    const s = await caller().state();
    expect(s.attributable.known).toBe(false);
    if (s.attributable.known) throw new Error("attributable null ⇒ phải KHÔNG known");
    expect(s.attributable.reason).toBe("probe-blind");
    expect(s.tick.present).toBe(true);
  });

  it("CÓ số ⇒ `known:true` + con số, và `basis` nói vế nào thắng", async () => {
    xinThat("gguf:local-model", 1_000 * MIB);
    publishDecisionTick(__tickFieldsForTests(9_000 * MIB, true), Date.now());
    const s = await caller().state();
    expect(s.attributable.known).toBe(true);
    if (!s.attributable.known) throw new Error("có số ⇒ phải known");
    expect(s.attributable.bytes).toBe(9_000 * MIB);
    expect(s.headroom.blind).toBe(false);
    // thiết bị (9.000) > sổ (1.000) ⇒ vế `attributable` thắng.
    expect(s.headroom.basis).toBe("attributable");
    expect(s.headroom.usedBytes).toBe(9_000 * MIB);
  });
});

describe("vramRouter.state — `trusted` / `degradedReasons` / `baselineVerified` ở CẢ HAI chiều", () => {
  it("nền CHƯA xác minh ⇒ `verified:false` + lý do `unverified-baseline`", async () => {
    publishDecisionTick(__tickFieldsForTests(1 * MIB, false), Date.now());
    const s = await caller().state();
    expect(s.baseline.verified).toBe(false);
    expect(s.headroom.degradedReasons).toContain("unverified-baseline");
    expect(s.headroom.trusted).toBe(false);
  });

  it("nền ĐÃ xác minh + tick tươi + sổ chung tươi ⇒ `verified:true`, KHÔNG còn hai lý do kia", async () => {
    publishDecisionTick(__tickFieldsForTests(1 * MIB, true), Date.now());
    publishSharedLedgerReplica([], Date.now(), sharedLedgerSelfKey());
    const s = await caller().state();
    expect(s.baseline.verified).toBe(true);
    expect(s.headroom.degradedReasons).not.toContain("unverified-baseline");
    expect(s.headroom.degradedReasons).not.toContain("no-tick");
    expect(s.headroom.degradedReasons).not.toContain("shared-ledger-unasked");
    expect(s.headroom.trusted).toBe(true);
  });

  it("`unverifiedReasons === null` khi CHƯA CÓ NHỊP NÀO — KHÔNG phải mảng rỗng", async () => {
    const s = await caller().state();
    expect(s.tick.present).toBe(false);
    expect(s.baseline.unverifiedReasons).toBeNull();
    expect(s.baseline.origin).toBeNull();
  });

  /**
   * ★★★ (D) — BA Ô CỦA `baseline` PHẢI ĐẾN TỪ **CÙNG MỘT NHỊP**.
   *
   * Chiều nguy hiểm mà review gọi tên: `verified:false` (nhịp MỚI) + `unverifiedReasons: []`
   * (bản ghi CŨ, hồi đó sạch) ⇒ Agent đọc *"chưa xác minh nhưng không có lý do nào"* ⇒ kết luận
   * **"chỉ là chưa kịp chụp"** rồi bỏ qua. Ca này đi qua ĐÚNG ô mà `reserve()` đọc.
   */
  it("★★★ ba ô `baseline` đọc MỘT ô tick — `verified:false` KHÔNG BAO GIỜ đi với `unverifiedReasons: []`", async () => {
    publishDecisionTick(
      {
        attributableBytes: 1 * MIB,
        baselineVerified: false,
        baselineUnverifiedReasons: ["co-tan-du-giu-gpu"],
        baselineOrigin: "captured",
      },
      Date.now(),
    );
    const s = await caller().state();
    expect(s.baseline.verified).toBe(false);
    expect(s.baseline.unverifiedReasons).toEqual(["co-tan-du-giu-gpu"]);
    expect(s.baseline.origin).toBe("captured");
    // ⚠ Bất biến: cờ TẮT ⇒ danh sách lý do KHÔNG rỗng.
    expect(s.baseline.unverifiedReasons!.length).toBeGreaterThan(0);
  });

  it("CHIỀU KIA — nền ĐÃ xác minh ⇒ `unverifiedReasons` RỖNG (có nhịp), KHÔNG phải `null`", async () => {
    publishDecisionTick(__tickFieldsForTests(1 * MIB, true), Date.now());
    const s = await caller().state();
    expect(s.baseline.verified).toBe(true);
    expect(s.baseline.unverifiedReasons).toEqual([]);
    expect(s.baseline.origin).toBe("local");
  });

  it("★★ tick CŨ ⇒ `stale:true` + lý do `stale-tick`, nhưng con số VẪN CÒN (không bị xoá)", async () => {
    publishDecisionTick(__tickFieldsForTests(5_000 * MIB, true), Date.now() - 500_000);
    const s = await caller().state();
    expect(s.tick.present).toBe(true);
    if (!s.tick.present) throw new Error("đã công bố tick");
    expect(s.tick.stale).toBe(true);
    expect(s.tick.ageMs).toBeGreaterThan(s.tick.staleAfterMs);
    expect(s.headroom.degradedReasons).toContain("stale-tick");
    // ⚠ Giữ SỐ, cộng biên — KHÔNG đi qua `null` (đó là phép LÀM LỎNG).
    expect(s.attributable.known).toBe(true);
    expect(s.headroom.charges.staleMarginBytes).toBeGreaterThan(0);
  });
});

describe("vramRouter.state — `unledgeredBytes` là ƯỚC LƯỢNG, và nó KHÔNG BAO GIỜ ra ngoài một mình", () => {
  it("★★★ ô ước lượng LUÔN đi kèm `unknownCount` + `estimateUsable` + nhãn `estimateKind`", async () => {
    const s = await caller().state();
    expect(s.unledgered.estimateKind).toBe("estimate");
    expect(Object.hasOwn(s.unledgered, "unknownCount")).toBe(true);
    expect(Object.hasOwn(s.unledgered, "estimateUsable")).toBe(true);
    // Chưa có lượt nào hỏng ⇒ đếm 0 ⇒ ước lượng DÙNG ĐƯỢC (nhưng vẫn là ƯỚC LƯỢNG).
    expect(s.unledgered.unknownCount).toBe(0);
    expect(s.unledgered.estimateUsable).toBe(true);
    expect(s.unledgered.estimateBytes).toBe(0);
    expect(s.unledgered.beginFailureCount).toBe(0);
    expect(s.unledgered.lastReason).toBeNull();
  });
});

describe("vramRouter.state — trạng thái hoãn của CẢ SÁU hộ `background`", () => {
  it("★★★ đủ SÁU hộ, và MỖI hộ khai `mechanism` + `hostedHere` RIÊNG khỏi `status`", async () => {
    const s = await caller().state();
    expect(s.defer.hosts).toHaveLength(6);
    expect(s.defer.hosts.map((d) => d.host).sort()).toEqual(
      [
        "cron:kb-eval-gate",
        "cron:kb-sync",
        "gguf-embed-ctx",
        "reranker",
        "sidecar:llm-finetune",
        "sidecar:local-trainer",
      ].sort(),
    );
    for (const d of s.defer.hosts) {
      expect(Object.hasOwn(d, "mechanism"), `hộ ${d.host} thiếu 'mechanism'`).toBe(true);
      expect(Object.hasOwn(d, "status"), `hộ ${d.host} thiếu 'status'`).toBe(true);
      expect(Object.hasOwn(d, "hostedHere"), `hộ ${d.host} thiếu 'hostedHere'`).toBe(true);
    }
  });

  /**
   * ★★★ C-1 — KHỐI HOÃN PHẢI KHAI **PHẠM VI** CỦA CHÍNH NÓ.
   *
   * Cả hai nguồn là ảnh chụp trong bộ nhớ của tiến trình đang trả lời, trong khi cron KB-sync và
   * hai sidecar job sống ở `worker`. Không có ba ô dưới đây, mọi `status` là một lời khẳng định
   * toàn cục mà dữ liệu không đỡ nổi — và Task 2 (`retryDeferred`) đọc thẳng khối này.
   */
  it("★★★ khối `defer` khai PHẠM VI TIẾN TRÌNH + ai đang quan sát + vết BỀN xuyên tiến trình", async () => {
    const s = await caller().state();
    expect(s.defer.scope).toBe("this-process-only");
    expect(s.defer.observedFromProcessKey).toBe(s.processKey);
    expect(s.defer.durableTrace).toBe("vram_events(defer|defer_exceeded)");
  });

  /**
   * ★★★ C-1 — hộ `cron:kb-sync` KHÔNG chạy ở tiến trình test (cron chưa đăng ký) ⇒ **KHÔNG ĐƯỢC**
   * khai `no-chain-in-this-process`. Đó là lời khẳng định *"ở đây không có chuỗi hoãn nào"* cho một
   * hộ mà tiến trình này **không nhìn thấy** — đúng câu ràng buộc 11 cấm.
   */
  it("★★★ hộ KHÔNG chủ trì ở tiến trình này ⇒ `not-observable-here`, KHÔNG phải `no-chain-in-this-process`", async () => {
    const s = await caller().state();
    const kb = s.defer.hosts.find((d) => d.host === "cron:kb-sync")!;
    expect(kb.hostedHere).toBe(false);
    expect(kb.status.kind).toBe("not-observable-here");
    if (kb.status.kind !== "not-observable-here") throw new Error("cron chưa đăng ký ở tiến trình test");
    expect(kb.status.meaning).toBe("host-not-running-in-this-process");
  });

  it("★★ năm hộ đi qua `vramDefer` KHÔNG chứng minh được chỗ đứng ⇒ `hostedHere === null` (không bịa `false`)", async () => {
    const s = await caller().state();
    for (const d of s.defer.hosts.filter((x) => x.host !== "cron:kb-sync")) {
      expect(d.hostedHere, `hộ ${d.host}`).toBeNull();
      expect(d.status.kind, `hộ ${d.host}`).toBe("no-chain-in-this-process");
    }
  });

  it("★★★ BA hộ 'không có cơ chế hoãn' (ngân sách 0) PHÂN BIỆT ĐƯỢC với ba hộ có chờ", async () => {
    const s = await caller().state();
    const khongCho = s.defer.hosts.filter((d) => d.mechanism === "no-wait-degrades-in-place").map((d) => d.host);
    const coCho = s.defer.hosts.filter((d) => d.mechanism === "waits-and-retries").map((d) => d.host);
    expect(khongCho.sort()).toEqual(["cron:kb-eval-gate", "gguf-embed-ctx", "reranker"]);
    expect(coCho.sort()).toEqual(["cron:kb-sync", "sidecar:llm-finetune", "sidecar:local-trainer"]);
    // ⚠ Với hộ không-chờ, "không có chuỗi" KHÔNG nghĩa "đã xin được" — chính vì thế hai ô phải TÁCH.
    for (const d of s.defer.hosts) expect(d.status.kind).not.toBe("deferring");
  });

  it("★★ một hộ ĐANG HOÃN THẬT (đi qua `xinVramCoHoan`) hiện ra `status.kind === 'exceeded'` + ngân sách CỦA CHUỖI", async () => {
    // ⚠ Lời từ chối dựng bằng ĐÚNG người dựng của mã sản xuất — không bịa một Error khác hình dạng.
    const facts = buildVramRefusal({
      requestedBytes: 1_000 * MIB,
      owner: "cuda-backend:reranker",
      priority: "background",
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
    });
    // Ngân sách 0 ⇒ lượt từ chối đầu tiên đã quá đáy ⇒ ném lại, và để lại ô trạng thái.
    await expect(
      xinVramCoHoan({
        owner: "cuda-backend:reranker",
        leaseKind: "gguf-backend",
        priority: "background",
        budgetMs: 0,
        xin: async () => {
          throw new VramRefusedError(facts);
        },
      }),
    ).rejects.toThrow();

    const s = await caller().state();
    const ho = s.defer.hosts.find((d) => d.host === "reranker")!;
    expect(ho.status.kind).toBe("exceeded");
    if (ho.status.kind !== "exceeded") throw new Error("đã quá đáy");
    expect(ho.status.attempts).toBe(1);
    // ★ N11 — ô CÂU CHỮ nay là `VramAgentDisplayText` (cắt tại nguồn + KHAI đã cắt), không phải
    //   một `string` trần. Câu vẫn phải mang DANH TÍNH của hộ bị từ chối — đó là thứ người trực đọc.
    expect(ho.status.lastRefusalMessage?.text).toContain("cuda-backend:reranker");
    /**
     * ★★★ I-3 (review Task 5) — **CÂU TỪ CHỐI THẬT, KHÔNG NỐI THÊM MỘT KÝ TỰ NÀO, ĐÃ VƯỢT TRẦN.**
     * `buildVramRefusal()` sinh ~548 ký tự ⇒ `vramDefer.catCau` cắt còn 400. Bản trước của ca này
     * khẳng định `truncated === false` — và nó **XANH**, vì mặt đọc khai lượt cắt của **riêng nó**
     * trong khi 148 ký tự đã mất ở tầng dưới. Đây là **đường mặc định của 5/6 hộ**, không phải góc
     * hiếm: ô `truncated` khi ấy là một **hằng số `false`**.
     */
    expect(ho.status.lastRefusalMessage?.truncated, "câu THẬT dài 548 > trần 400 ⇒ PHẢI khai là đã cắt").toBe(true);
    expect(ho.status.lastRefusalMessage?.text.length).toBe(400);
    expect(ho.status.lastRefusalMessage!.rawLength, "độ dài GỐC, không phải độ dài mảnh còn lại").toBeGreaterThan(400);
    // ★ M-7 — ngân sách CHỐT LÚC BỊ TỪ CHỐI, không phải cấu hình hiện tại.
    expect(ho.status.chainBudgetMs).toBe(0);
    // ⚠ Và `mechanism` vẫn nói đúng bản chất của hộ — hai ô KHÔNG gộp.
    expect(ho.mechanism).toBe("no-wait-degrades-in-place");
  });
});

/**
 * ★★★ (E) — DÂN SỐ SÁU HỘ CÓ MÁY QUÉT. **BA CA ẤY ĐÃ DỜI SANG
 * `server/services/vram/vramReadModel.roster.test.ts`** (vá I-4, review TOÀN NHÁNH Pha 4).
 *
 * ⚠ VÌ SAO DỜI CHỨ KHÔNG CHÉP: `vramReadModel.ts:508-517` khẳng định đích danh *"lưới nằm ở
 * `vramReadModel.roster.test.ts`"* — một file khi đó **không tồn tại**. Cơ chế thì có thật, nhưng ở
 * một cái tên khác, nên người mở `server/services/vram/` ra sửa `HO_BACKGROUND` không tìm thấy nó.
 * Giữ lại một bản ở đây là dựng **bản sao thứ hai của một vị từ** — đúng lớp lỗi cả nhánh đang gỡ.
 */

describe("vramRouter.state — KHÔNG một giá trị KHÔNG HỮU HẠN nào rời khỏi API", () => {
  it("★★★ `attributableBytes` không hữu hạn ⇒ payload sạch + `nonFiniteFields` GỌI TÊN từng ô", async () => {
    publishDecisionTick(__tickFieldsForTests(Number.POSITIVE_INFINITY, true), Date.now());
    const s = await caller().state();

    const bay = quetSoKhongHuuHan(s);
    expect(bay, `còn giá trị không hữu hạn: ${bay.join(", ")}`).toEqual([]);

    // ⚠ CHẶN CÓ TÊN, đừng nuốt: mỗi ô bị chặn phải được kể tên kèm giá trị gốc.
    expect(s.nonFiniteFields.length).toBeGreaterThan(0);
    const duong = s.nonFiniteFields.map((f) => f.path);
    expect(duong).toContain("headroom.rawBytes");
    // ★ Pha 6 Task 2 — con số đi CÙNG MỐC ĐỌC ⇒ đường của nó cũng nói ra điều đó.
    expect(duong).toContain("headroom.effective.bytesAtReadMs");
    for (const f of s.nonFiniteFields) expect(["Infinity", "-Infinity", "NaN"]).toContain(f.was);
    expect(s.headroom.rawBytes).toBeNull();
    expect(s.headroom.effective.bytesAtReadMs).toBeNull();
    // ⚠ Mốc đọc **không** bị chặn theo: nó luôn hữu hạn, và không có nó thì con số `null` kia lại
    //   thành một ô trần để ai đó so trước/sau.
    expect(s.headroom.effective.readAtMs).toBe(s.atMs);
    expect(s.headroom.degradedReasons).toContain("invalid-input");
  });

  it("fixture ĐỐI CHỨNG — cùng đường, chỉ khác ở CHIỀU đang kiểm: số hữu hạn ⇒ `nonFiniteFields` RỖNG", async () => {
    publishDecisionTick(__tickFieldsForTests(9_000 * MIB, true), Date.now());
    const s = await caller().state();
    expect(s.nonFiniteFields).toEqual([]);
    expect(quetSoKhongHuuHan(s)).toEqual([]);
    expect(s.headroom.rawBytes).not.toBeNull();
    expect(s.headroom.degradedReasons).not.toContain("invalid-input");
  });
});

describe("vramRouter.state — con số phơi ra PHẢI là con số đang cưỡng chế", () => {
  /**
   * ⚠⚠ Pha 6 Task 2 — **CA NÀY LÀ CHIỀU "KHÔNG BẮT NHẦM" CỦA LƯỢT ĐỔI KIỂU.** Phép so ở đây là
   * **CÙNG MỘT MỐC** (mặt đọc ↔ quyết định cưỡng chế), tức đúng thứ vẫn **PHẢI viết ra được** sau
   * khi `effectiveBytes` bị gói cùng mốc đọc. Nếu một bản vá tương lai làm ca này không viết nổi
   * nữa thì bản vá ấy đã bắt nhầm — xem `VramAgentEffectiveHeadroom` (đường "brand" đã bị loại
   * đúng vì nó làm ca này đỏ).
   */
  it("★★ `headroom.effective.bytesAtReadMs` khớp ĐÚNG `decision.effectiveHeadroomBytes` của một lượt `reserve()` cùng ngữ cảnh", async () => {
    publishDecisionTick(__tickFieldsForTests(3_000 * MIB, true), Date.now());
    publishSharedLedgerReplica([hangAnhEm({ bytes: 2_000 * MIB })], Date.now(), sharedLedgerSelfKey());
    xinThat("gguf:local-model", 1_000 * MIB);

    const s = await caller().state();
    // Cùng ô, cùng thời điểm ⇒ lượt xin 0 byte chỉ để ĐỌC con số cưỡng chế đã dùng.
    const nowMs = Date.now();
    const { sharedLedgerFact } = await import("../services/vram/vramSharedLedger");
    const { readDecisionTick } = await import("../services/vram/vramTickCell");
    const out = broker.reserve(
      { owner: "probe", kind: "gguf-context", estimatedBytes: 0, priority: "background" },
      { tick: readDecisionTick(), unledgered: { bytes: 0, unknownCount: 0 }, sharedLedger: sharedLedgerFact(nowMs), nowMs },
    );
    // Biên theo tuổi đổi theo mili giây ⇒ so trong một dung sai nhỏ, nhưng CÙNG một bậc.
    expect(s.headroom.effective.bytesAtReadMs).not.toBeNull();
    expect(Math.abs(s.headroom.effective.bytesAtReadMs! - out.decision.effectiveHeadroomBytes)).toBeLessThan(50 * MIB);
    expect(s.headroom.usedBytes).toBe(out.decision.usedBytes);
    expect(s.ledger.totalBytes).toBe(out.decision.ledgerTotalBytes);
    expect(s.headroom.ceilingBytes).toBe(out.decision.ceilingBytes);
  });
});

/** Quét ĐỆ QUY mọi số trong payload — lưới cuối cho ràng buộc "không giá trị không hữu hạn nào ra API". */
function quetSoKhongHuuHan(v: unknown, duong = ""): string[] {
  if (typeof v === "number") return Number.isFinite(v) ? [] : [`${duong}=${String(v)}`];
  if (Array.isArray(v)) return v.flatMap((x, i) => quetSoKhongHuuHan(x, `${duong}[${i}]`));
  if (v !== null && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
      quetSoKhongHuuHan(x, duong === "" ? k : `${duong}.${k}`),
    );
  }
  return [];
}
