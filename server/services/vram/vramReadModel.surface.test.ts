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

import {
  buildVramAgentState,
  vramBackgroundHostForOwner,
  VRAM_BACKGROUND_STATIC_OWNERS,
  type VramAgentDisplayText,
} from "./vramReadModel";
import * as broker from "./vramBroker";
import { __resetDecisionTickForTests } from "./vramTickCell";
import {
  __resetSharedLedgerForTests,
  __setSharedLedgerSelfKeyForTests,
  publishSharedLedgerReplica,
} from "./vramSharedLedger";
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

/**
 * Một lượt hoãn THẬT qua mã sản xuất (ngân sách 0 ⇒ quá đáy ngay lượt từ chối đầu tiên).
 * Trả về **độ dài THÔ** của câu từ chối — để ca dưới so với `rawLength` mà mặt đọc khai, thay vì
 * ghim một con số chép tay (con số ấy đổi theo câu chữ của `buildVramRefusal`).
 */
async function hoanThat(owner: string, cauTuChoi = "") {
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
  let doDaiTho = -1;
  await expect(
    xinVramCoHoan({
      owner,
      leaseKind: "gguf-context",
      priority: "background",
      budgetMs: 0,
      xin: async () => {
        const e = new VramRefusedError(facts);
        // ⚠ Câu từ chối THẬT do người dựng của sản xuất sinh ra; phần nối thêm (nếu có) chỉ để
        //   đẩy độ dài lên — ca I-3 dưới đây chạy với `cauTuChoi = ""`, tức câu THẬT không thêm gì.
        e.message = `${e.message}${cauTuChoi}`;
        doDaiTho = e.message.length;
        throw e;
      },
    }),
  ).rejects.toThrow();
  return doDaiTho;
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

  /**
   * ★★★ I-3 (review) — **CA THỨ TƯ, VÀ NÓ ĐI TRÊN NGUỒN *CÓ TRẦN Ở TẦNG DƯỚI*.**
   *
   * Ba ca trên đều đi `unledgered.lastReason` — nguồn **KHÔNG** có trần. Đường **mặc định của 5/6
   * hộ** thì ngược lại: `vramDefer.catCau()` cắt ở **đúng 400** = **đúng trần của mặt đọc** ⇒ nếu
   * mặt đọc chỉ khai lượt cắt **của chính nó** thì `truncated` là một **HẰNG SỐ `false`** — không
   * đầu vào nào bật được. Ca này chạy với một câu từ chối **THẬT, KHÔNG nối thêm một ký tự nào**.
   */
  it("★★★ I-3 — nguồn CÓ TRẦN Ở TẦNG DƯỚI: câu THẬT (không nối gì) vượt trần ⇒ `truncated === true`", async () => {
    const doDaiTho = await hoanThat("cuda-backend:reranker");
    expect(doDaiTho, "câu từ chối THẬT phải dài hơn trần — nếu không, ca này không đo gì").toBeGreaterThan(TRAN);

    const s = await buildVramAgentState();
    const ho = s.defer.hosts.find((h) => h.host === "reranker")!;
    if (ho.status.kind !== "exceeded") throw new Error("phải là exceeded");
    const cau = ho.status.lastRefusalMessage!;
    expect(cau.text.length).toBe(TRAN);
    expect(cau.truncated, "148 ký tự đã mất ở vramDefer ⇒ khai `false` là NÓI DỐI").toBe(true);
    // ⚠ Độ dài GỐC = độ dài trước **lượt cắt ĐẦU TIÊN**, không phải độ dài mảnh vừa tới tay.
    expect(cau.rawLength).toBe(doDaiTho);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// §D — LƯỢNG TỪ: hai luật "VỚI MỌI", vì năm ca trên đều là khẳng định TRÊN MỘT THỂ HIỆN
//
// ⚠⚠⚠ (A) của review: *"không tồn tại luật 'với mọi ô VramAgentDisplayText trong ảnh chụp'"* — và
// đó chính là kẽ mà ca thứ tư (nguồn có trần ở tầng dưới) chui qua: payload hỏng **nằm sẵn trong
// fixture §A** mà không ca nào nhìn tới. Hai luật dưới đây phát biểu ở chiều **PHẢI-LÀ** và quét
// **toàn bộ** ảnh chụp, nên một ô hiển thị **thứ N+1** thêm vào sáu tháng nữa cũng bị hỏi.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Mọi chuỗi trong payload, kèm ĐƯỜNG DẪN — cùng khuôn đường dẫn mà `locHuuHan()` dựng. */
function quetChuoi(v: unknown, duong: string, ra: { duong: string; gia: string }[]): void {
  if (typeof v === "string") {
    ra.push({ duong, gia: v });
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => quetChuoi(x, `${duong}[${i}]`, ra));
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      quetChuoi(x, duong === "" ? k : `${duong}.${k}`, ra);
    }
  }
}

/** Mọi ô `VramAgentDisplayText` trong payload (nhận theo HÌNH DẠNG, không theo một danh sách tên). */
function quetODisplay(v: unknown, duong: string, ra: { duong: string; o: VramAgentDisplayText }[]): void {
  if (Array.isArray(v)) {
    v.forEach((x, i) => quetODisplay(x, `${duong}[${i}]`, ra));
    return;
  }
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string" && typeof o.truncated === "boolean" && typeof o.rawLength === "number") {
      ra.push({ duong, o: o as unknown as VramAgentDisplayText });
    }
    for (const [k, x] of Object.entries(o)) quetODisplay(x, duong === "" ? k : `${duong}.${k}`, ra);
  }
}

/**
 * ★★★ TẬP ĐƯỜNG DẪN **DANH TÍNH** — bản khai DUY NHẤT, và nó **hỏng theo chiều ĐỎ**: một ô mới
 * mang chuỗi dài mà không nằm trong danh sách này ⇒ ca đỏ ⇒ có người phải phân loại nó là DANH
 * TÍNH (thêm vào đây) hay HIỂN THỊ (bọc `VramAgentDisplayText`). Đó là chỗ *"phần tử thứ N+1"*
 * được ép phải khai, thay vì lọt im lặng.
 */
const DUONG_DANH_TINH: readonly RegExp[] = [
  /^processKey$/,
  /^ledger\.localHolders\[\d+\]\.(owner|processKey|leaseKey)$/,
  /^ledger\.foreign\.holders\[\d+\]\.(owner|processKey|leaseKey)$/,
  /^defer\.observedFromProcessKey$/,
  /^defer\.hosts\[\d+\]\.status\.owner$/,
  /^defer\.hosts\[\d+\]\.retryReach\.owner$/,
];

describe("★★★ §D — HAI LUẬT 'VỚI MỌI' trên toàn ảnh chụp (không phải khẳng định trên một thể hiện)", () => {
  /** Ảnh chụp GIÀU: cả năm ô danh tính đều DÀI HƠN TRẦN, và cả hai nguồn câu chữ đều có mặt. */
  async function anhChupGiau() {
    __setSharedLedgerSelfKeyForTests(`api:${"7".repeat(500)}:1`);
    O.lyDoUocLuong = `ước lượng hỏng: ${"chi tiết rất dài — ".repeat(60)}hết`;
    reserveThat(OWNER_DAI);
    publishSharedLedgerReplica(
      [
        {
          leaseKey: `worker:9:1#${"L".repeat(500)}`,
          processKey: `worker:${"9".repeat(500)}:1`,
          pid: 9,
          role: "worker",
          leaseId: "L".repeat(500),
          owner: `gguf:${"M".repeat(500)}`,
          leaseKind: "gguf-model",
          priority: "background",
          bytes: 17_000 * MIB,
          measured: true,
          refCount: 0,
          reclaimer: "gguf-idle-model",
          acquiredAtMs: 1,
          updatedAtMs: 1,
        },
      ],
      Date.now(),
      `api:${"7".repeat(500)}:1`,
    );
    // Câu từ chối THẬT (đã bị `vramDefer` cắt ở 400) + một `owner` ĐỘNG dài hơn trần.
    await hoanThat(OWNER_HOAN_DAI);
    await beginHongThat();
    return buildVramAgentState();
  }

  it("★★★ VỚI MỌI ô hiển thị: cắt đúng trần, và cờ NÓI ĐÚNG (`truncated ⇔ rawLength > text.length`)", async () => {
    const s = await anhChupGiau();
    const o: { duong: string; o: VramAgentDisplayText }[] = [];
    quetODisplay(s, "", o);
    // Lưới của lưới: quét rỗng thì mọi khẳng định dưới đây vô nghĩa.
    expect(o.length, "không thấy ô hiển thị nào ⇒ chính lưới này đã mù").toBeGreaterThanOrEqual(2);
    for (const { duong, o: x } of o) {
      expect(x.text.length, `${duong}: vượt trần`).toBeLessThanOrEqual(TRAN);
      expect(x.rawLength, `${duong}: rawLength < text.length là vô nghĩa`).toBeGreaterThanOrEqual(x.text.length);
      expect(x.truncated, `${duong}: cờ PHẢI khớp sự thật (mất chữ ⇔ khai đã cắt)`).toBe(
        x.rawLength > x.text.length,
      );
    }
    // ⚠ Và ít nhất MỘT ô phải thật sự bị cắt — nếu không, luật trên xanh vì không có gì để cắt.
    expect(o.some((x) => x.o.truncated), "fixture phải chứa ít nhất một ô ĐÃ CẮT").toBe(true);
  });

  it("★★★ VỚI MỌI chuỗi dài hơn trần: đường dẫn của nó PHẢI nằm trong tập DANH TÍNH đã khai", async () => {
    const s = await anhChupGiau();
    const ch: { duong: string; gia: string }[] = [];
    quetChuoi(s, "", ch);
    const dai = ch.filter((x) => x.gia.length > TRAN);
    /**
     * ⚠ Lưới của lưới, và nó đóng luôn **M-6**: fixture phải chạm **cả năm** ô danh tính
     * (`owner` · `status.owner` · `retryReach`-family · `processKey` · `leaseKey`), nếu không thì
     * luật "chuỗi dài chỉ được là danh tính" xanh vì **không có chuỗi dài nào**.
     */
    expect(dai.length, "không có chuỗi dài nào ⇒ lưới mù").toBeGreaterThanOrEqual(5);
    const laDanhTinh = (d: string) => DUONG_DANH_TINH.some((re) => re.test(d));
    const viPham = dai.filter((x) => !laDanhTinh(x.duong)).map((x) => `${x.duong} (${x.gia.length} ký tự)`);
    expect(
      viPham,
      "một chuỗi KHÔNG TRẦN ở một đường dẫn không phải DANH TÍNH = một ô hiển thị chưa qua cửa cắt",
    ).toEqual([]);
    // Đối chứng DƯƠNG: đúng những ô danh tính ta chờ đợi thật sự có mặt và thật sự dài.
    const cham = new Set(dai.map((x) => x.duong.replace(/\[\d+\]/g, "[]")));
    expect([...cham].sort()).toEqual(
      [
        "defer.hosts[].status.owner",
        "ledger.foreign.holders[].leaseKey",
        "ledger.foreign.holders[].owner",
        "ledger.foreign.holders[].processKey",
        "ledger.localHolders[].owner",
        "processKey",
        "defer.observedFromProcessKey",
      ].sort(),
    );
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
