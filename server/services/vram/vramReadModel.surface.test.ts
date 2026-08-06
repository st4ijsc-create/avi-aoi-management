/**
 * ★★★ Pha 5 Task 5 — **N11 (cắt tại nguồn) + N12 (`owner` THẬT trong `defer.hosts`).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ MỘT PAYLOAD, HAI LUẬT NGƯỢC NHAU — VÀ LƯỚI PHẢI KHOÁ **CẢ HAI CHIỀU**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cách hỏng **rẻ nhất** khi cài N11 là quét đệ quy rồi cắt **mọi chuỗi** — cùng khuôn `locHuuHan()`
 * đã dùng cho số không hữu hạn, nghe rất hợp lý, và nó **phá mặt DANH TÍNH**: `owner` / `leaseKey` /
 * `processKey` / `status.owner` / `retryReach.owner` là những chuỗi Agent lấy từ mặt đọc rồi truyền
 * **THẲNG** vào `vram.preempt` / `vram.releaseStale` / `vram.retryDeferred`. Cắt một trong số đó
 * không làm gãy gì lúc biên dịch — nó làm **lệnh trả `owner-not-in-local-ledger`**, tức hỏng theo
 * chiều IM LẶNG.
 * ⇒ Mọi ca ở §A đo **cả hai** ô trong **CÙNG MỘT** ảnh chụp: cắt một chiều mà quên chiều kia là ĐỎ.
 *
 * ⚠⚠ VÀ CHIỀU "KHÔNG BẮT NHẦM" (§B) — một bản cài "cắt hết cho chắc" cũng làm §A xanh nếu §A chỉ
 * hỏi *"có bị cắt không"*. §B hỏi ngược: câu **ngắn** phải ra **nguyên văn** và **`truncated: false`**.
 *
 * ⚠ VÌ SAO GIẢ BA MODULE, VÀ CHỈ BA:
 *   • `./vramEstimator` — đường **DUY NHẤT** làm `beginVramAllocation()` hỏng thật ⇒ đường duy nhất
 *     ghi `unledgered.lastReason` (`vramWiring.ts:1628` = `err.message`, **KHÔNG cắt một ký tự nào**).
 *     Cùng lý do mà `vramRouter.unledgered.test.ts` tồn tại thành file riêng.
 *   • `./vramEventLog` — chặn một lượt ghi DB trong ca thuần logic.
 *   • `../kbSyncScheduler` — hộ `cron:kb-sync` là hộ **DUY NHẤT** phát ra `reachable-here` (⇒ ô
 *     `retryReach.owner` của N12) và là nguồn `lastRefusalMessage` **KHÔNG CÓ TRẦN** (`note.message`).
 *     Ở tiến trình test, cron **không** chủ trì ⇒ không có đường nào khác chạm tới hai nhánh ấy.
 * Mọi thứ còn lại là mã sản xuất: `broker.reserve()`, `vramDefer.xinVramCoHoan()`,
 * `vramWiring.beginVramAllocation()`, `buildVramAgentState()`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/** Ô sống của hai module bị giả — đặt qua `vi.hoisted` để từng ca đổi được kịch bản. */
const O = vi.hoisted(() => ({
  lyDoUocLuong: "ước lượng hỏng (ca thử nghiệm)",
  kb: {
    hostedHere: false as boolean,
    deferBudgetMs: 21_600_000,
    defer: null as null | {
      attempts: number;
      firstRefusedAt: string | null;
      nextRetryAt: string | null;
      lastRefusalMessage: string;
      budgetMs: number;
      exceeded: boolean;
    },
  },
}));

vi.mock("./vramEstimator", () => ({
  estimateBytesFor: async () => {
    throw new Error(O.lyDoUocLuong);
  },
  recordActual: () => {},
}));
vi.mock("./vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
}));
vi.mock("../kbSyncScheduler", () => ({
  getKbSyncSchedulerStatus: () => O.kb,
}));

import { buildVramAgentState, vramBackgroundHostForOwner, VRAM_BACKGROUND_STATIC_OWNERS } from "./vramReadModel";
import * as broker from "./vramBroker";
import { __resetDecisionTickForTests } from "./vramTickCell";
import { __resetSharedLedgerForTests } from "./vramSharedLedger";
import { __resetVramDeferForTests, xinVramCoHoan } from "./vramDefer";
import { beginVramAllocation, __resetVramBeginFailureState } from "./vramWiring";
import { buildVramRefusal, VramRefusedError } from "./vramRefusal";

const MIB = 1024 * 1024;

/** ⚠ ĐÚNG trần của mặt đọc (`CAU_HIEN_THI_TOI_DA`). Ca nào cũng phải so với con số này, không "≈". */
const TRAN = 400;

/**
 * Một `owner` **DÀI HƠN TRẦN** — và nó không phải một con quái vật tưởng tượng: `owner` thật gồm
 * **đường dẫn model tuyệt đối** (`reranker:<modelPath>`), thứ do `.env` + tên tệp `.gguf` quyết định.
 */
const OWNER_DAI = `gguf:${"D:/mo/hinh/rat/sau/".repeat(40)}qwen30b.gguf`;
/** `owner` ĐỘNG của hộ `gguf-embed-ctx` — cũng dài hơn trần. */
const OWNER_HOAN_DAI = `gguf-embed-ctx:${"z".repeat(600)}`;

function reserveThat(owner: string) {
  return broker.reserve(
    { owner, kind: "gguf-model", estimatedBytes: 100 * MIB, priority: "background", reclaimer: "gguf-idle-model" },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
}

/** Một lượt hoãn THẬT qua mã sản xuất (ngân sách 0 ⇒ quá đáy ngay lượt từ chối đầu tiên). */
async function hoanThat(owner: string, cauTuChoi: string) {
  const facts = buildVramRefusal({
    requestedBytes: 1_000 * MIB,
    owner,
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
  await expect(
    xinVramCoHoan({
      owner,
      leaseKind: "gguf-context",
      priority: "background",
      budgetMs: 0,
      xin: async () => {
        const e = new VramRefusedError(facts);
        // ⚠ Câu từ chối THẬT do người dựng của sản xuất sinh ra; chỉ NỐI thêm phần dài để đo phép cắt.
        e.message = `${e.message}${cauTuChoi}`;
        throw e;
      },
    }),
  ).rejects.toThrow();
}

/** Một lượt `beginVramAllocation()` HỎNG THẬT ⇒ ghi `unledgered.lastReason` (không trần ở nguồn). */
async function beginHongThat() {
  const t = await beginVramAllocation({
    owner: "gguf:qwen30b",
    kind: "gguf-model",
    priority: "interactive",
    fileBytes: 17_690_497_440,
  });
  t.release();
}

beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  __resetVramBeginFailureState();
  O.lyDoUocLuong = "ước lượng hỏng (ca thử nghiệm)";
  O.kb = { hostedHere: false, deferBudgetMs: 21_600_000, defer: null };
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §A — N11: DANH TÍNH NGUYÊN VẸN **VÀ** HIỂN THỊ CẮT-CÓ-KHAI, TRONG CÙNG MỘT ẢNH CHỤP
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ N11 — hai bề mặt, hai luật: DANH TÍNH nguyên vẹn, CÂU CHỮ cắt-và-khai", () => {
  it("★★★ cùng một payload: `owner` dài NGUYÊN VẸN, `lastReason` dài BỊ CẮT và KHAI đã cắt", async () => {
    O.lyDoUocLuong = `ước lượng hỏng: ${"chi tiết đường dẫn model rất dài — ".repeat(60)}hết`;
    reserveThat(OWNER_DAI);
    await hoanThat(OWNER_HOAN_DAI, ` ${"nguyên nhân dài lê thê ".repeat(60)}`);
    await beginHongThat();

    const s = await buildVramAgentState();

    // ── CHIỀU 1: DANH TÍNH — **KHÔNG MỘT KÝ TỰ NÀO ĐƯỢC MẤT** ────────────────────────────────
    const ho = s.ledger.localHolders.find((h) => h.owner.startsWith("gguf:D:/mo/hinh"));
    expect(ho, "hộ cục bộ phải có mặt (nếu không thì ca dưới đây xanh vì rỗng)").toBeDefined();
    expect(ho!.owner).toBe(OWNER_DAI);
    expect(ho!.owner.length).toBeGreaterThan(TRAN);

    const hoHoan = s.defer.hosts.find((h) => h.host === "gguf-embed-ctx")!;
    expect(hoHoan.status.kind).toBe("exceeded");
    if (hoHoan.status.kind !== "exceeded") throw new Error("phải là exceeded");
    // `status.owner` là DANH TÍNH mà `vram.preempt` nhận ⇒ nguyên vẹn, dù nó dài hơn trần.
    expect(hoHoan.status.owner).toBe(OWNER_HOAN_DAI);
    expect(hoHoan.status.owner.length).toBeGreaterThan(TRAN);

    // ── CHIỀU 2: CÂU CHỮ — cắt ĐÚNG trần, và **KHAI RA** ─────────────────────────────────────
    const lyDo = s.unledgered.lastReason;
    expect(lyDo, "`lastReason` phải có mặt — nếu `null` thì cả ca này không đo gì").not.toBeNull();
    expect(lyDo!.truncated, "cắt IM LẶNG là điều ca này tồn tại để cấm").toBe(true);
    expect(lyDo!.text.length).toBe(TRAN);
    expect(lyDo!.text).toBe(O.lyDoUocLuong.slice(0, TRAN));
    // ⚠ Độ dài GỐC, đo tại chỗ cắt — người đọc biết đã mất bao nhiêu, không phải đoán.
    expect(lyDo!.rawLength).toBe(O.lyDoUocLuong.length);
    expect(lyDo!.rawLength).toBeGreaterThan(TRAN);
  });

  it("★★★ nguồn KHÔNG CÓ TRẦN (`kbSyncScheduler.note.message`) ⇒ mặt đọc cắt VÀ khai", async () => {
    const cauDai = `kb:sync bị từ chối: ${"lý do rất dài ".repeat(80)}`;
    O.kb = {
      hostedHere: true,
      deferBudgetMs: 21_600_000,
      defer: {
        attempts: 3,
        firstRefusedAt: new Date(1).toISOString(),
        nextRetryAt: new Date(2).toISOString(),
        lastRefusalMessage: cauDai,
        budgetMs: 21_600_000,
        exceeded: false,
      },
    };

    const s = await buildVramAgentState();
    const cron = s.defer.hosts.find((h) => h.host === "cron:kb-sync")!;
    expect(cron.status.kind).toBe("deferring");
    if (cron.status.kind !== "deferring") throw new Error("phải là deferring");
    expect(cron.status.lastRefusalMessage!.truncated).toBe(true);
    expect(cron.status.lastRefusalMessage!.text.length).toBe(TRAN);
    expect(cron.status.lastRefusalMessage!.rawLength).toBe(cauDai.length);
    // ⚠ DANH TÍNH của cùng hộ đó **KHÔNG** bị đụng tới trong cùng lượt cắt.
    expect(cron.status.owner).toBe("cron:kb-sync");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §B — KHÔNG BẮT NHẦM (chiều bị bỏ qua thường xuyên hơn chiều bắt)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ N11 — chiều KHÔNG BẮT NHẦM: câu ngắn ra nguyên văn, và KHÔNG bị khai là đã cắt", () => {
  it("★★ câu NGẮN: `truncated === false`, `text` nguyên văn, `rawLength === text.length`", async () => {
    O.lyDoUocLuong = "ước lượng hỏng (ngắn)";
    await beginHongThat();

    const s = await buildVramAgentState();
    const lyDo = s.unledgered.lastReason!;
    expect(lyDo.text).toBe("ước lượng hỏng (ngắn)");
    expect(lyDo.truncated).toBe(false);
    expect(lyDo.rawLength).toBe(lyDo.text.length);
  });

  it("★★ câu dài ĐÚNG BẰNG trần ⇒ **KHÔNG** bị khai là đã cắt (biên, không phải ≈ biên)", async () => {
    O.lyDoUocLuong = "x".repeat(TRAN);
    await beginHongThat();

    const s = await buildVramAgentState();
    const lyDo = s.unledgered.lastReason!;
    expect(lyDo.text.length).toBe(TRAN);
    expect(lyDo.truncated, "dài đúng bằng trần thì KHÔNG mất ký tự nào ⇒ khai là đã cắt là SAI").toBe(false);
    expect(lyDo.rawLength).toBe(TRAN);
  });

  it("★ KHÔNG có câu nào ⇒ `null` (một phạm trù RIÊNG, không phải một câu rỗng đã cắt)", async () => {
    const s = await buildVramAgentState();
    expect(s.unledgered.lastReason).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §C — N12: DANH TÍNH THẬT ĐI CÙNG LỜI HỨA "VỚI TỚI ĐƯỢC"
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ N12 — `retryReach.owner` là chuỗi mà LỆNH nhận, không phải một cái tên hộ", () => {
  it("★★★ `reachable-here` ⇒ có `owner`, và `owner` ĐÓ phân giải NGƯỢC về đúng hộ này", async () => {
    O.kb = { hostedHere: true, deferBudgetMs: 21_600_000, defer: null };

    const s = await buildVramAgentState();
    const cron = s.defer.hosts.find((h) => h.host === "cron:kb-sync")!;
    expect(cron.retryReach.kind).toBe("reachable-here");
    if (cron.retryReach.kind !== "reachable-here") throw new Error("phải với tới được");
    /**
     * ⚠⚠ ĐÂY LÀ CỔNG RA CỦA N12: mặt đọc hứa *"gọi được"* thì chuỗi nó đưa ra phải là chuỗi mà
     * **mặt LỆNH** phân giải được (`vramRetryDeferredCommand` gọi đúng vị từ này). Một lời hứa kèm
     * một đầu vào mà lệnh từ chối = `unknown-background-host` = một lượt gọi tiêu vào hư không.
     */
    expect(vramBackgroundHostForOwner(cron.retryReach.owner)).toBe(cron.host);
  });

  it("★★★ ĐO LẠI CÁI SAI: `h.host` KHÔNG phải một danh tính — 2/6 hộ không phân giải được", async () => {
    const s = await buildVramAgentState();
    expect(s.defer.hosts.length).toBe(6);
    const hong = s.defer.hosts.filter((h) => vramBackgroundHostForOwner(h.host) === null).map((h) => h.host);
    /**
     * ⚠ Con số **ĐO ĐƯỢC**, khác brief (brief viết "4/6"). Hai hộ này có `owner` **ĐỘNG**
     * (`reranker:<modelPath>` · `gguf-embed-ctx:<modelId>`) nên **tên hộ không tồn tại như một
     * owner**. Ghim cả TÊN lẫn SỐ: nếu ai đó "sửa" bằng cách thêm tên hộ vào `matches`, ca này đỏ
     * và bắt người sửa nói ra rằng họ vừa đổi ngữ nghĩa của `owner`.
     */
    expect(hong.sort()).toEqual(["gguf-embed-ctx", "reranker"]);
  });

  it("★★ mọi DANH TÍNH TĨNH đã khai đều phân giải NGƯỢC về đúng hàng của nó", () => {
    const coDanhTinh = VRAM_BACKGROUND_STATIC_OWNERS.filter((x) => x.ownerStatic !== null);
    // Lưới của lưới: bảng rỗng thì vòng lặp dưới xanh mà không kiểm gì.
    expect(coDanhTinh.length).toBeGreaterThanOrEqual(4);
    for (const x of coDanhTinh) {
      expect(vramBackgroundHostForOwner(x.ownerStatic!), `danh tính "${x.ownerStatic}" của hộ "${x.host}"`).toBe(
        x.host,
      );
    }
  });

  it("★ hộ KHÔNG với tới được thì **không mang danh tính nào** — mặt đọc không mời một lượt gọi vô ích", async () => {
    const s = await buildVramAgentState();
    for (const h of s.defer.hosts) {
      if (h.retryReach.kind === "reachable-here") continue;
      expect(Object.hasOwn(h.retryReach, "owner"), `hộ "${h.host}" không với tới mà vẫn phát ra owner`).toBe(false);
    }
  });
});
