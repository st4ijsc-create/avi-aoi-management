/**
 * ★★★ Pha 4 Task 4 — **"LỆNH NÀO VỚI TỚI HỘ NÀY TỪ CHỖ ĐỨNG HIỆN TẠI"** (bàn giao I-3 + (D)),
 * TTL của giấy phép (đồng hồ #6 của bảng Pha 4), và `detailTruncated` đo Ở NGUỒN (M-5 nửa sau).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LƯỚI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE (ràng buộc 6 — đã tái diễn MƯỜI lần)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không một module nào bị giả. Trạng thái dựng bằng **đúng những ô mà mã sản xuất ghi vào**
 * (`vramBroker.reserve()`/`adoptLease()`, `publishSharedLedgerReplica()`), rồi đọc **đúng object mà
 * `buildVramAgentState()` gửi đi**. Câu hỏi mọi ca ở đây hỏi là câu hỏi của Agent: *"tôi có nên bắn
 * lệnh này không"* — và câu trả lời phải KHỚP với cái lệnh THẬT sẽ trả về.
 */
import { describe, it, expect, beforeEach } from "vitest";

import * as broker from "./vramBroker";
import { buildVramAgentState } from "./vramReadModel";
import { vramPreemptCommand } from "./vramCommands";
import {
  __resetSharedLedgerForTests,
  __setSharedLedgerSelfKeyForTests,
  publishSharedLedgerReplica,
  type SharedLeaseRow,
} from "./vramSharedLedger";
import { __resetDecisionTickForTests } from "./vramTickCell";
import { __resetVramDeferForTests } from "./vramDefer";
import { __resetVramBeginFailureState } from "./vramWiring";

const MIB = 1024 * 1024;

beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  __resetVramBeginFailureState();
});

function xinThat(
  owner: string,
  bytes: number,
  priority: "background" | "production" | "interactive" = "background",
  reclaimer: "gguf-idle-model" | undefined = "gguf-idle-model",
) {
  return broker.reserve(
    { owner, kind: "gguf-model", estimatedBytes: bytes, priority, ...(reclaimer ? { reclaimer } : {}) },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
}

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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// I-3 — HỢP KIỂU CÓ NHÃN thay cho `reclaimable: boolean`
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("I-3 — `reclaim` nói ĐÚNG lệnh nào với tới; `reclaimable: boolean` đã CHẾT", () => {
  it("★★★ hộ của ANH EM (còn sống, có người thi hành) KHÔNG BAO GIỜ khai `reclaimable-here`", async () => {
    __setSharedLedgerSelfKeyForTests("api:100:1");
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1");

    const s = await buildVramAgentState();
    expect(s.ledger.foreign.known).toBe(true);
    if (!s.ledger.foreign.known) throw new Error("đã công bố ⇒ known");
    const h = s.ledger.foreign.holders[0]!;

    // Ô cũ khai `true` ở đúng chỗ này, và Agent tiêu một lượt gọi để nhận `owner-not-in-local-ledger`.
    expect(h.reclaim.kind).toBe("declared-by-owner-process");
    if (h.reclaim.kind !== "declared-by-owner-process") throw new Error("nhãn sai");
    expect(h.reclaim.reclaimer).toBe("gguf-idle-model");
  });

  it("★★★ MẶT ĐỌC KHỚP MẶT LỆNH: hộ anh em ⇒ lệnh THẬT trả `owner-not-in-local-ledger`", async () => {
    __setSharedLedgerSelfKeyForTests("api:100:1");
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1");

    const s = await buildVramAgentState();
    if (!s.ledger.foreign.known) throw new Error("đã công bố ⇒ known");
    const h = s.ledger.foreign.holders[0]!;
    expect(h.reclaim.kind).not.toBe("reclaimable-here");

    // Đi qua ĐƯỜNG THẬT — không suy luận: bắn đúng lệnh mà Agent sẽ bắn.
    const kq = await vramPreemptCommand(h.owner);
    expect(kq.outcome).toBe("refused");
    expect(kq.reason).toBe("owner-not-in-local-ledger");
  });

  it("hộ CỤC BỘ nhàn rỗi + có người thi hành ⇒ `reclaimable-here`, VÀ lệnh thật đi tới người thi hành", async () => {
    const r = xinThat("gguf:local-idle", 1_000 * MIB);
    if (r.lease === null) throw new Error("phải cấp được");
    if (r.lease === null) throw new Error("phải cấp được");
    // `reserve()` trả giấy phép với refCount = 1 (= ĐANG DÙNG) — hộ NHÀN RỖI phải hạ về 0.
    broker.setLeaseRefCount(r.lease.id, 0);

    const s = await buildVramAgentState();
    const h = s.ledger.localHolders.find((x) => x.owner === "gguf:local-idle")!;
    expect(h.reclaim.kind).toBe("reclaimable-here");
    if (h.reclaim.kind !== "reclaimable-here") throw new Error("nhãn sai");
    expect(h.reclaim.reclaimer).toBe("gguf-idle-model");
    expect(broker.preemptStepForOwner("gguf:local-idle").kind).toBe("ready");
  });

  it("★★ hộ CỤC BỘ mức `production` ⇒ `no-reclaimer` + `why` NÓI ĐÚNG NGUYÊN NHÂN (§5.2), không phải 'không có người dọn'", async () => {
    const r = xinThat("onnx:aoi-seg", 500 * MIB, "production");
    if (r.lease === null) throw new Error("phải cấp được");
    broker.setLeaseRefCount(r.lease.id, 0);

    const s = await buildVramAgentState();
    const h = s.ledger.localHolders.find((x) => x.owner === "onnx:aoi-seg")!;
    expect(h.reclaim.kind).toBe("no-reclaimer");
    if (h.reclaim.kind !== "no-reclaimer") throw new Error("nhãn sai");
    expect(h.reclaim.why).toBe("production-never-preempted");

    const kq = await vramPreemptCommand("onnx:aoi-seg");
    expect(kq.reason).toBe(h.reclaim.why); // hai mặt KHÔNG trôi khỏi nhau
  });

  it("★★ hộ CỤC BỘ ĐANG DÙNG (refCount = 1) ⇒ `busy-in-use`, khớp lệnh thật", async () => {
    const r = xinThat("gguf:busy", 800 * MIB);
    if (r.lease === null) throw new Error("phải cấp được");
    // KHÔNG hạ refCount: `reserve()` trả 1 = đang dùng.

    const s = await buildVramAgentState();
    const h = s.ledger.localHolders.find((x) => x.owner === "gguf:busy")!;
    if (h.reclaim.kind !== "no-reclaimer") throw new Error("hộ đang dùng KHÔNG được khai thu hồi được");
    expect(h.reclaim.why).toBe("busy-in-use");
    expect((await vramPreemptCommand("gguf:busy")).reason).toBe("busy-in-use");
  });

  it("hộ anh em KHÔNG khai người thi hành ⇒ `no-reclaimer` + `owner-not-in-local-ledger` (lệnh từ ĐÂY không với tới)", async () => {
    __setSharedLedgerSelfKeyForTests("api:100:1");
    publishSharedLedgerReplica([hangAnhEm({ reclaimer: null })], Date.now(), "api:100:1");

    const s = await buildVramAgentState();
    if (!s.ledger.foreign.known) throw new Error("đã công bố ⇒ known");
    const h = s.ledger.foreign.holders[0]!;
    if (h.reclaim.kind !== "no-reclaimer") throw new Error("không người thi hành ⇒ no-reclaimer");
    expect(h.reclaim.why).toBe("owner-not-in-local-ledger");
  });

  it("★ ô cũ ĐÃ BIẾN MẤT khỏi payload (không chỉ khỏi kiểu) — không ai còn đọc được `reclaimable`", async () => {
    const r = xinThat("gguf:x", 100 * MIB);
    if (r.lease === null) throw new Error("phải cấp được");
    const s = await buildVramAgentState();
    for (const h of s.ledger.localHolders) {
      expect(Object.hasOwn(h, "reclaimable"), "ô boolean cũ phải chết cả ở RUN-TIME").toBe(false);
      expect(Object.hasOwn(h, "reclaim")).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Đồng hồ #6 — `VRAM_SIDECAR_TTL_MS` → `request.ttlMs`: NAY CÓ NGƯỜI ĐỌC
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("TTL của giấy phép — người đọc ĐẦU TIÊN (không có nhịp nào tự gặt theo TTL)", () => {
  it("★★ hộ nhận nuôi quá TTL ⇒ `ttlExpired: true` + `ttlMs` phơi ra", async () => {
    const lease = broker.adoptLease(
      {
        owner: "sidecar:orphan-pid-4242",
        kind: "external-process",
        estimatedBytes: 7_825 * MIB,
        priority: "interactive",
        ttlMs: 1_000,
        reclaimer: "orphan-pid",
      },
      7_825 * MIB,
      "nhận nuôi (test)",
    );
    // Đẩy mốc CẤP về quá khứ — đúng ô mà mã sản xuất đọc, không phải một cờ giả.
    (lease as { acquiredAt: Date }).acquiredAt = new Date(Date.now() - 60_000);

    const s = await buildVramAgentState();
    const h = s.ledger.localHolders.find((x) => x.owner === "sidecar:orphan-pid-4242")!;
    expect(h.ttlMs).toBe(1_000);
    expect(h.ttlExpired).toBe(true);
  });

  it("hộ chưa quá TTL ⇒ `false`; hộ KHÔNG khai TTL ⇒ `null` (KHÔNG BIẾT, không phải `false`)", async () => {
    broker.adoptLease(
      {
        owner: "sidecar:fresh",
        kind: "external-process",
        estimatedBytes: 10 * MIB,
        priority: "interactive",
        ttlMs: 900_000,
        reclaimer: "orphan-pid",
      },
      10 * MIB,
      "nhận nuôi (test)",
    );
    xinThat("gguf:no-ttl", 10 * MIB);

    const s = await buildVramAgentState();
    expect(s.ledger.localHolders.find((x) => x.owner === "sidecar:fresh")!.ttlExpired).toBe(false);
    const khongTtl = s.ledger.localHolders.find((x) => x.owner === "gguf:no-ttl")!;
    expect(khongTtl.ttlMs).toBeNull();
    expect(khongTtl.ttlExpired, "không có TTL để so ⇒ KHÔNG BIẾT").toBeNull();
  });

  it("★ hộ của ANH EM: sổ chung KHÔNG mang `ttlMs` ⇒ cả hai ô là `null`, không bịa `false`", async () => {
    __setSharedLedgerSelfKeyForTests("api:100:1");
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1");
    const s = await buildVramAgentState();
    if (!s.ledger.foreign.known) throw new Error("đã công bố ⇒ known");
    expect(s.ledger.foreign.holders[0]!.ttlMs).toBeNull();
    expect(s.ledger.foreign.holders[0]!.ttlExpired).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (D) — `retryReach`: mặt ĐỌC nói trước cái mà lệnh sẽ trả lời
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("(D) — `retryReach` của 6 hộ nền, CÙNG vị từ với lệnh `retryDeferred`", () => {
  it("★★★ 5 hộ đi qua `vramDefer` ⇒ `unreachable / no-retry-mechanism-for-this-host` (đừng tốn lượt gọi)", async () => {
    const s = await buildVramAgentState();
    const nam = s.defer.hosts.filter((h) => h.host !== "cron:kb-sync");
    expect(nam.length).toBe(5);
    for (const h of nam) {
      expect(h.retryReach.kind).toBe("unreachable");
      if (h.retryReach.kind !== "unreachable") throw new Error("nhãn sai");
      expect(h.retryReach.why).toBe("no-retry-mechanism-for-this-host");
    }
  });

  it("★★ `cron:kb-sync` ở tiến trình KHÔNG chủ trì cron ⇒ `host-not-running-in-this-process`", async () => {
    const s = await buildVramAgentState();
    const cron = s.defer.hosts.find((h) => h.host === "cron:kb-sync")!;
    // Bộ test không khởi động cron ⇒ `coChuTriCronODay()` là `false` — đúng chỗ đứng của `api`.
    expect(cron.hostedHere).toBe(false);
    expect(cron.retryReach.kind).toBe("unreachable");
    if (cron.retryReach.kind !== "unreachable") throw new Error("nhãn sai");
    expect(cron.retryReach.why).toBe("host-not-running-in-this-process");
  });

  it("★ MỌI hộ đều mang `retryReach` — không ô nào để Agent tự đoán", async () => {
    const s = await buildVramAgentState();
    expect(s.defer.hosts.length).toBe(6);
    for (const h of s.defer.hosts) expect(Object.hasOwn(h, "retryReach")).toBe(true);
  });
});
